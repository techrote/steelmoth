#!/usr/bin/env python3
"""Capture matched normal index.html WebGL2/WebGPU fixture stages, without acceptance claims."""
from __future__ import annotations
import argparse
import base64
import datetime as dt
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import threading
import time
import urllib.parse

import numpy as np
from PIL import Image
from validate_webgpu_ssgi_browser import CDP, QuietHandler, browser_path, gpu_inventory, stop_browser, wait_for_page
from validate_sm603_ssgi_browser import video_controller_inventory
from validate_sm603_target_report import hardware_errors

TOOLS_ROOT=Path(__file__).resolve().parents[1]

class ObserverCDP(CDP):
    def __init__(self,url):
        super().__init__(url);self.events=[]
    def call(self,method,params=None):
        self.serial+=1;ident=self.serial
        self.ws.send(json.dumps({'id':ident,'method':method,'params':params or {}}))
        while True:
            m=json.loads(self.ws.recv())
            if m.get('method') in ('Runtime.exceptionThrown','Runtime.consoleAPICalled','Log.entryAdded'):
                self.events.append(m)
                if m['method']=='Runtime.exceptionThrown':self.exceptions.append(m.get('params',{}))
            if m.get('id')!=ident:continue
            if 'error' in m:raise RuntimeError(f'{method}: {m["error"]}')
            return m.get('result',{})
    def evaluate(self, expression):
        r=self.call('Runtime.evaluate',{'expression':expression,'returnByValue':True,'awaitPromise':True})
        if r.get('exceptionDetails'):raise RuntimeError(f'Browser evaluation: {r["exceptionDetails"]}')
        return r.get('result',{}).get('value')

def source_identity(root):
    def git(*args):return subprocess.run(['git','-C',str(root),*args],capture_output=True,text=True,check=True).stdout.strip()
    paths=sorted([*root.glob('engine/*.js'),*root.glob('game_data/*.json'),root/'index.html',root/'webapp.js',root/'sw.js',root/'DEPLOYMENT_MANIFEST.json',*root.glob('render-tests/fixtures/*.json')])
    return {'commit':git('rev-parse','HEAD') if (root/'.git').exists() else None,
            'tree':git('rev-parse','HEAD^{tree}') if (root/'.git').exists() else None,
            'status':git('status','--porcelain=v1','--untracked-files=all') if (root/'.git').exists() else 'archive; see archive commit and checksum',
            'root':str(root),'fileSha256':{p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
            'observerSha256':{str(p.name):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),TOOLS_ROOT/'tools/sm505_capture_stages.js',TOOLS_ROOT/'tools/sm505_receiver_probe.js',TOOLS_ROOT/'tools/sm505_visibility_probe.js'] if p.is_file()}}

def save_item(out,item):
    raw=base64.b64decode(item.pop('base64'));(out/(item['name']+'.bin')).write_bytes(raw)
    w,h,row=item['width'],item['height'],item['rowBytes']
    data=np.frombuffer(raw,dtype=np.uint8).reshape(h,row)
    if item['format']=='rgba16float':a=data[:,:w*8].copy().view('<f2').reshape(h,w,4).astype(np.float32)
    elif item['format'] in ('r16float','r32float'):
        size=2 if item['format']=='r16float' else 4
        value=data[:,:w*size].copy().view('<f2' if size==2 else '<f4').reshape(h,w).astype(np.float32)
        a=np.repeat(value[:,:,None],4,axis=2);a[:,:,3]=1
    elif item['format']=='r32uint':
        ids=data[:,:w*4].copy().view('<u4').reshape(h,w)
        a=np.stack([(ids*73)%251,(ids*139)%253,(ids*211)%255,np.full_like(ids,255)],axis=-1)/255
        a[ids==0,:3]=0;item['occupiedPixels']=int(np.count_nonzero(ids))
    else:a=data[:,:w*4].reshape(h,w,4).astype(np.float32)/255
    item['finite']=bool(np.isfinite(a).all());rgb=a[:,:,:3]
    if item['kind'] in ('visibility','occlusion','visibility-channels'):
        names=('combined','direct','ambient','dso') if item['kind']=='visibility-channels' else (item['kind'],)
        item['channels']={name:{'minimum':float(a[:,:,i].min()),'maximum':float(a[:,:,i].max()),
          'mean':float(a[:,:,i].mean()),'zeroPixels':int(np.count_nonzero(a[:,:,i]==0)),
          'belowNeutralPixels':int(np.count_nonzero(a[:,:,i]<1-1/1024))} for i,name in enumerate(names)}
    item['rgbMean']=np.mean(rgb,axis=(0,1)).tolist();item['blackFraction']=float(np.mean(np.max(rgb,axis=2)<=1/255))
    if item['kind']=='linear-rgb':
        x=np.maximum(rgb,0);rgb=np.where(x<=.0031308,12.92*x,1.055*np.power(x,1/2.4)-.055)
    rgba=np.concatenate([np.clip(rgb,0,1),np.ones((h,w,1))],axis=2)
    Image.fromarray(np.rint(rgba*255).astype(np.uint8)).save(out/(item['name']+'.png'))
    item['pngDisplay']='IEC sRGB OETF, clipped at1; raw .bin retains HDR' if item['kind']=='linear-rgb' else 'direct numeric/display values; raw .bin retained'
    item['sha256']=hashlib.sha256(raw).hexdigest()
    return item,a

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out',type=Path,required=True);ap.add_argument('--root',type=Path,default=TOOLS_ROOT)
    ap.add_argument('--browser');ap.add_argument('--hardware',action='store_true');ap.add_argument('--fixture',default='single-box')
    ap.add_argument('--angle',type=int,choices=range(0,360,45),default=0);ap.add_argument('--width',type=int,default=1920);ap.add_argument('--height',type=int,default=1080)
    ap.add_argument('--timeout',type=float,default=150)
    ap.add_argument('--receiver-probe',action='store_true',help='Run source-matched background receiver negative/positive/cone readback controls outside timing')
    ap.add_argument('--visibility-probe',action='store_true',help='Run source-matched per-light direct/ambient/emissive numeric visibility controls outside timing')
    ap.add_argument('--inspection',choices=['none','development'],default='none',help='Explicit matched development visibility preset; never performance/release acceptance')
    args=ap.parse_args();root=args.root.resolve();out=args.out.resolve()
    if out.exists():ap.error('--out must be new; original attempts cannot be overwritten')
    if not 1<=args.timeout<=600 or not 160<=args.width<=3840 or not 90<=args.height<=2160:ap.error('invalid bounded extent/deadline')
    out.mkdir(parents=True);report={'schema':'steelmoth-sm505-stage-diagnostic/v1','ok':False,'physicalAcceptance':False,'hardwareRequested':args.hardware,'softwareRequested':not args.hardware,'startedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
      'configuration':{'fixture':args.fixture,'angle':args.angle,'width':args.width,'height':args.height,'dpr':1,'quality':'Medium','gtao':False,'receiverProbe':args.receiver_probe,'visibilityProbe':args.visibility_probe,'inspection':args.inspection},'errors':[],
      'boundary':'Engineering diagnostic using normal index.html bootstrap and canonical deterministic fixture adapter. Neither human visual approval nor performance/release acceptance.'}
    proc=cdp=srv=None
    try:
        report['source']=source_identity(root);report['host']={'platform':platform.platform(),'processor':platform.processor()};report['gpuInventory']=gpu_inventory();report['videoControllers']=video_controller_inventory()
        exe=browser_path(args.browser)
        if not exe:raise RuntimeError('Chrome executable unavailable')
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(root)));srv=server
        threading.Thread(target=server.serve_forever,daemon=True).start()
        query=urllib.parse.urlencode({'rendererBackend':'webgl2','renderTest':1,'backend':'webgl2','quality':'medium','fixture':args.fixture,'width':args.width,'height':args.height,'dpr':1,'lightAngle':args.angle,'seed':1397572098,'fixedTimeMs':12000,'settleFrames':4,'inspection':args.inspection})
        url=f'http://127.0.0.1:{server.server_address[1]}/index.html?{query}'
        with tempfile.TemporaryDirectory(prefix='sm505-diagnostic-',ignore_cleanup_errors=True) as profile:
            command=[exe,'--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--enable-unsafe-webgpu','--force-device-scale-factor=1',f'--window-size={args.width},{args.height}','--remote-debugging-port=0','--remote-allow-origins=*',f'--user-data-dir={profile}']
            if not args.hardware:command+=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']
            command+=['about:blank'];report['command']=command;deadline=time.monotonic()+args.timeout
            with (out/'browser.log').open('wb') as log:
                proc=subprocess.Popen(command,cwd=root,stdout=log,stderr=log,start_new_session=os.name!='nt',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0) if os.name=='nt' else 0)
                target=wait_for_page(proc,Path(profile),deadline);cdp=ObserverCDP(target['webSocketDebuggerUrl']);cdp.call('Runtime.enable');cdp.call('Page.enable')
                report['browser']=cdp.call('Browser.getVersion')
                cdp.call('Emulation.setDeviceMetricsOverride',{'width':args.width,'height':args.height,'deviceScaleFactor':1,'mobile':False})
                injection=(root/'engine/render_fixture_adapter.js').read_text(encoding='utf-8')+'\n'+(root/'engine/render_harness.js').read_text(encoding='utf-8')
                cdp.call('Page.addScriptToEvaluateOnNewDocument',{'source':injection})
                cdp.call('Page.navigate',{'url':url})
                while time.monotonic()<deadline:
                    state=cdp.value('({ready:document.body?.dataset.renderTestReady,error:document.body?.dataset.renderTestError,result:globalThis.SteelMothRenderHarness?.result})') or {}
                    if state.get('error'):raise RuntimeError(f'Fixture bootstrap failed: {state.get("result")}')
                    if state.get('ready')=='1':break
                    time.sleep(.15)
                else:raise TimeoutError('normal application fixture startup timed out')
                report['fixtureMetadata']=state.get('result',{}).get('metadata')
                report['webgl2']=cdp.evaluate("(()=>{const g=game.renderer.gl,e=g.getExtension('WEBGL_debug_renderer_info');game.loop=()=>{};return {renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):null,vendor:e?g.getParameter(e.UNMASKED_VENDOR_WEBGL):null,scene:game.renderScene,diagnostics:game.diagnostics(),display:{screen:[screen.width,screen.height],viewport:[innerWidth,innerHeight],dpr:devicePixelRatio}}})()")
                cdp.evaluate('game.__smHarnessRenderOnce()');report['webgl2']['canvasDataUrl']=cdp.evaluate("game.canvas.toDataURL('image/png')")
                (out/'webgl2-canvas.png').write_bytes(base64.b64decode(report['webgl2'].pop('canvasDataUrl').split(',')[1]))
                (out/'webgl2-presented.png').write_bytes(base64.b64decode(cdp.call('Page.captureScreenshot',{'format':'png'})['data']))
                cdp.evaluate("steelMothBackendRuntime.select('webgpu',{persist:false})")
                report['runtimeAfterSelection']=cdp.evaluate('steelMothBackendRuntime.diagnostics()')
                if report['runtimeAfterSelection']['presentationBackend']!='webgpu':raise RuntimeError(f'WebGPU presenter unavailable: {report["runtimeAfterSelection"]}')
                info=report['runtimeAfterSelection']['webgpu']['adapterInfo']
                fallback=cdp.evaluate('steelMothBackendRuntime.manager.adapter.isFallbackAdapter ?? steelMothBackendRuntime.manager.adapter.info?.isFallbackAdapter ?? null')
                report['smoke']={'gpu':{'adapterInfo':info,'isFallbackAdapter':fallback}}
                if args.hardware:
                    failures=hardware_errors(report)
                    if failures:raise RuntimeError('Physical adapter identity not established: '+'; '.join(failures))
                    if '1650' not in (report['webgl2']['renderer'] or ''):raise RuntimeError('Matched WebGL2 reference is not GTX1650 hardware')
                cdp.evaluate('game.__smHarnessRenderOnce()')
                while time.monotonic()<deadline:
                    ready=cdp.value('({backend:steelMothBackendRuntime.presentationBackend,idle:!steelMothBackendRuntime.presenter?.rendering,frames:steelMothBackendRuntime.presenter?.presentedFrames||0})')
                    if ready['backend']!='webgpu':raise RuntimeError('WebGPU failed while rendering frozen fixture')
                    if ready['idle'] and ready['frames']>=1:break
                    time.sleep(.1)
                else:raise TimeoutError('WebGPU frozen frame deadline')
                report['webgpuPresented']=cdp.evaluate("({canvas:document.querySelector('#webgpuPresentation')?.toDataURL('image/png'),runtime:steelMothBackendRuntime.diagnostics()})")
                (out/'webgpu-canvas.png').write_bytes(base64.b64decode(report['webgpuPresented'].pop('canvas').split(',')[1]))
                (out/'webgpu-presented.png').write_bytes(base64.b64decode(cdp.call('Page.captureScreenshot',{'format':'png'})['data']))
                stages=cdp.evaluate((TOOLS_ROOT/'tools/sm505_capture_stages.js').read_text(encoding='utf-8')+'\nsm505CaptureStages()')
                arrays={};metadata=[]
                for item in stages.pop('items'):
                    meta,array=save_item(out,item);metadata.append(meta);arrays[item['name']]=array
                stages['captures']=metadata;report['stages']=stages
                report['postProbe']={**stages['postProbe'],'inputLinear':np.array(stages['postProbe']['inputHalfWords'],dtype='<u2').view('<f2').astype(float).tolist(),
                    'rawRGB':arrays['post-probe-raw'][0,:,:3].tolist(),'finalRGB':arrays['post-probe-final'][0,:,:3].tolist()}
                id_meta=next(item for item in metadata if item['name']=='object-id')
                ids=np.fromfile(out/'object-id.bin',dtype=np.uint8).reshape(args.height,id_meta['rowBytes'])[:,:args.width*4].copy().view('<u4').reshape(args.height,args.width)
                mask=ids!=0
                final=arrays['final-postprocessed'][:,:,:3];raw=arrays['raw-lighting'][:,:,:3]
                report['opaquePixels']={'maskAuthority':'SM-202 objectID != 0','count':int(mask.sum()),'rawLightingMean':float(raw[mask].mean()) if mask.any() else None,'finalBlackFraction':float(np.mean(np.max(final[mask],axis=1)<=1/255)) if mask.any() else None}
                receiver=(~mask)&(arrays['gbuffer-albedo'][:,:,3]>.002)
                report['receiverPixels']={'maskAuthority':'objectID == 0 and G0.a > .002; no geometry ownership','count':int(receiver.sum()),'rawLightingMean':float(raw[receiver].mean()) if receiver.any() else None,'finalBlackFraction':float(np.mean(np.max(final[receiver],axis=1)<=1/255)) if receiver.any() else None}
                if args.receiver_probe:
                    probe=cdp.evaluate((TOOLS_ROOT/'tools/sm505_receiver_probe.js').read_text(encoding='utf-8')+'\nsm505ReceiverProbe()')
                    probe_out=out/'receiver-probe';probe_out.mkdir();probe_captures=[]
                    for item in probe.pop('items'):
                        meta,_array=save_item(probe_out,item);probe_captures.append(meta)
                    probe['captures']=probe_captures;report['receiverProbe']=probe
                    if not probe['ok']:raise RuntimeError('Background receiver engineering probe failed: '+str(probe.get('errors'))+'; '+str([c for c in probe['checks'] if not c['ok']]))
                if args.visibility_probe:
                    probe=cdp.evaluate((TOOLS_ROOT/'tools/sm505_visibility_probe.js').read_text(encoding='utf-8')+'\nsm505VisibilityProbe()')
                    probe_out=out/'visibility-probe';probe_out.mkdir();probe_captures=[]
                    for item in probe.pop('items'):
                        meta,_array=save_item(probe_out,item);probe_captures.append(meta)
                    probe['captures']=probe_captures;report['visibilityProbe']=probe
                    if not probe['ok']:raise RuntimeError('Opaque visibility engineering probe failed: '+str(probe.get('errors'))+'; '+str([c for c in probe['checks'] if not c['ok']]))
                report['javascriptExceptions']=cdp.exceptions
                if cdp.exceptions:raise RuntimeError('Unexpected JavaScript exceptions; inspect original log')
                report['runtimeAfterProbes']=cdp.evaluate('steelMothBackendRuntime.diagnostics()')
                errors=report['runtimeAfterProbes']['webgpu']['uncapturedErrors']
                if errors:raise RuntimeError(f'Unexpected WebGPU errors: {errors}')
                report['sourceAfter']=source_identity(root)
                if report['source']['fileSha256']!=report['sourceAfter']['fileSha256']:raise RuntimeError('Source changed during capture; evidence not source stable')
                report['ok']=True
    except Exception as error:
        report['errors'].append(f'{type(error).__name__}: {error}')
        if cdp:
            try:
                report['failureState']=cdp.evaluate('({runtime:globalThis.steelMothBackendRuntime?.diagnostics(),frameError:globalThis.game?.lastFrameError,ready:document.body?.dataset.ready})')
                (out/'failure-presented.png').write_bytes(base64.b64decode(cdp.call('Page.captureScreenshot',{'format':'png'})['data']))
            except Exception as capture_error:report['failureCaptureError']=str(capture_error)
    finally:
        if cdp:report['browserEvents']=cdp.events;report['javascriptExceptions']=cdp.exceptions
        if proc:stop_browser(proc,cdp)
        if srv:srv.shutdown();srv.server_close()
        report['completedAt']=dt.datetime.now(dt.timezone.utc).isoformat()
        (out/'report.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n',encoding='utf-8')
        manifest=''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(out).as_posix()}\n' for p in sorted(out.rglob('*')) if p.is_file() and p.name!='SHA256SUMS.txt')
        (out/'SHA256SUMS.txt').write_text(manifest,encoding='utf-8')
    print(json.dumps({'ok':report['ok'],'errors':report['errors'],'opaquePixels':report.get('opaquePixels'),'report':str(out/'report.json')}))
    return 0 if report['ok'] else 1

if __name__=='__main__':raise SystemExit(main())
