#!/usr/bin/env python3
from __future__ import annotations
import argparse, http.server, json, os, shutil, signal, socket, socketserver, subprocess, tempfile, threading, time, urllib.parse, urllib.request
from pathlib import Path
from PIL import Image
import websocket

ROOT=Path(__file__).resolve().parents[1]
BROWSERS=('google-chrome','google-chrome-stable','chromium','chromium-browser','chrome')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_): pass
class Server(socketserver.ThreadingMixIn,http.server.HTTPServer): daemon_threads=True

def browser():
    for name in BROWSERS:
        p=shutil.which(name)
        if p:return p
    return None

def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def json_get(url:str,timeout=2):
    with urllib.request.urlopen(url,timeout=timeout) as r:return json.loads(r.read().decode('utf-8'))

def raw_fixture_expectations()->dict:
    atlas=json.loads((ROOT/'assets/generated/atlas.json').read_text(encoding='utf-8'))
    albedo=Image.open(ROOT/atlas['image']).convert('RGBA')
    nr=Image.open(ROOT/atlas['material_normal_roughness_image']).convert('RGBA')
    hm=Image.open(ROOT/atlas['material_height_image']).convert('RGBA')
    def region(name):
        r=atlas['regions'].get(name)
        if not r:raise RuntimeError(f'missing fixture atlas region: {name}')
        return tuple(map(int,r[:4]))
    def px(img,r,x,y):return list(img.getpixel((r[0]+x,r[1]+y)))
    def candidates(name):
        r=region(name);out=[]
        for y in range(r[3]):
            for x in range(r[2]):
                a=px(albedo,r,x,y)
                if a[3]>=220:out.append((x,y,a,px(nr,r,x,y),px(hm,r,x,y)))
        if not out:raise RuntimeError(f'no opaque validation pixel in {name}')
        return r,out
    def record(name,item):
        r=region(name);x,y,a,n,h=item
        return {'name':name,'x':x,'y':y,'region':list(r),'albedo':a,'normalRoughness':n,'heightMaterial':h}
    r,items=candidates('floor_plate')
    # Prefer the minimum local-height visible texel, then the most upward-facing
    # normal. This is a direct raw-PNG flat-material control, not a browser 2D
    # compositing result (material alpha stores emissive, not opacity).
    flat=min(items,key=lambda p:(p[4][0],abs(p[3][0]-128)+abs(p[3][1]-128)+abs(p[3][2]-255)))
    r,items=candidates('cargo_crate')
    box=max(items,key=lambda p:p[4][0]-((p[0]-(r[2]-1)/2)**2+(p[1]-(r[3]-1)/2)**2)**.5*.01)
    r,items=candidates('rust_barrel')
    barrel=max(items,key=lambda p:abs(p[3][0]-128)-abs(p[1]-(r[3]-1)/2)*.01)
    mixed=None
    for name in ('dumpster','server_cabinet','pipe_cluster','cargo_crate','rust_barrel'):
        if name not in atlas['regions']:continue
        _r,_items=candidates(name)
        item=max(_items,key=lambda p:abs(p[4][2]-128))
        score=abs(item[4][2]-128)
        if mixed is None or score>mixed[0]:mixed=(score,name,item)
    if mixed is None:raise RuntimeError('no mixed-material fixture region found')
    return {'flat':record('floor_plate',flat),'box':record('cargo_crate',box),'barrel':record('rust_barrel',barrel),'mixed':record(mixed[1],mixed[2])}

class CDP:
    def __init__(self,url:str,timeout=40):self.ws=websocket.create_connection(url,timeout=timeout,origin='http://127.0.0.1');self.seq=0
    def call(self,method,params=None):
        self.seq+=1;i=self.seq;self.ws.send(json.dumps({'id':i,'method':method,'params':params or {}}))
        while True:
            m=json.loads(self.ws.recv())
            if m.get('id')!=i:continue
            if 'error'in m:raise RuntimeError(f"CDP {method}: {m['error']}")
            return m.get('result',{})
    def eval(self,expr):
        r=self.call('Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':True})
        if r.get('exceptionDetails'):raise RuntimeError(f"browser evaluation failed: {r['exceptionDetails']}")
        return r.get('result',{}).get('value')
    def close(self):
        try:self.ws.close()
        except Exception:pass

def validate(smoke:dict,require_webgpu:bool):
    if not smoke.get('ok'):raise RuntimeError(smoke.get('error','SM-200 G-buffer page reported failure'))
    fixtures=smoke.get('fixtures') or {};required={'flat','box','barrel','mixed','categoryParity','alphaCutout','deletion','atlasBoundary'}
    if not required<=set(fixtures):raise RuntimeError(f"missing required G-buffer fixtures: {sorted(required-set(fixtures))}")
    diag=smoke.get('diagnostics') or {};formats=diag.get('formats') or {}
    if formats!={'g0':'rgba8unorm','g1':'rgba16float','g2':'rgba16float','objectId':'r32uint','depth':'depth32float'}:raise RuntimeError(f'unexpected production formats: {formats}')
    if diag.get('ownershipDepth')!='not-implemented-sm201-sm202':raise RuntimeError('SM-200 incorrectly claims final ownership depth')
    modes=set(diag.get('debugModes') or [])
    if not {'albedo','normals','roughness','height','metalness','ao','emissive','object-id'}<=modes:raise RuntimeError('debug view inventory incomplete')
    checks=smoke.get('checks') or []
    if len(checks)<18:raise RuntimeError(f'insufficient executed readback assertions: {len(checks)}')
    if require_webgpu and not diag:raise RuntimeError('real WebGPU G-buffer diagnostics missing')

def main()->int:
    ap=argparse.ArgumentParser(description='Real-browser Material-v2 WebGPU G-buffer/readback validation for SM-200.')
    ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-gbuffer-browser.json'))
    ap.add_argument('--timeout',type=float,default=90)
    ap.add_argument('--require-webgpu',action='store_true')
    args=ap.parse_args();exe=browser();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True)
    expectations=raw_fixture_expectations()
    report={'schema':'steelmoth-webgpu-gbuffer-browser-report/v1','ok':False,'browserExecutable':exe,'requireWebGPU':args.require_webgpu,'fixtureExpectations':expectations,'fixtureExpectationSource':'raw PNG bytes decoded by Pillow; avoids browser 2D premultiplication erasing RGB material channels when emissive alpha is zero','evidenceBoundary':'Production WebGPU G-buffer format/WGSL/readback correctness on the reported hosted browser adapter; not target-GPU performance or final SM-201/SM-202 ownership depth.'}
    if not exe:report['error']='Chrome/Chromium executable not found';path.write_text(json.dumps(report,indent=2)+'\n');return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-sm200-chrome-') as profile:
            debug=free_port();query=urllib.parse.urlencode({'expected':json.dumps(expectations,separators=(',',':'))});url=f'http://127.0.0.1:{port}/webgpu-gbuffer-smoke.html?{query}';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}',url]
            proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    target=next((t for t in json_get(f'http://127.0.0.1:{debug}/json/list') if t.get('type')=='page' and 'webgpu-gbuffer-smoke.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools SM-200 page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(20,min(60,args.timeout*.75)));cdp.call('Runtime.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            while time.monotonic()<deadline:
                if cdp.eval("document.body && document.body.dataset.webgpuGBufferDone==='1'"):break
                time.sleep(.15)
            else:raise RuntimeError('SM-200 G-buffer page did not publish before timeout')
            text=cdp.eval("document.getElementById('webgpuGBufferResult')?.textContent || ''")
            if not text:raise RuntimeError('webgpuGBufferResult missing after readiness signal')
            smoke=json.loads(text);report['smoke']=smoke;report['browserCommand']=cmd[:-1]+['<local-sm200-url-with-raw-png-expectations>'];validate(smoke,args.require_webgpu);report['ok']=True
    except Exception as exc:report['error']=str(exc)
    finally:
        if cdp:cdp.close()
        if proc and proc.poll() is None:
            try:os.killpg(proc.pid,signal.SIGTERM);proc.wait(timeout=4)
            except Exception:
                try:os.killpg(proc.pid,signal.SIGKILL)
                except Exception:pass
        if proc and proc.stderr:
            try:
                tail=proc.stderr.read()[-4000:]
                if tail and not report['ok']:report['browserStderrTail']=tail
            except Exception:pass
        srv.shutdown();srv.server_close()
    path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');smoke=report.get('smoke') or {};print(f"SM-200 WEBGPU GBUFFER {'PASS' if report['ok'] else 'FAIL'}: browser={exe} checks={len(smoke.get('checks') or [])} fixtures={len((smoke.get('fixtures') or {}))}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())