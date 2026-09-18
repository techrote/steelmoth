#!/usr/bin/env python3
from __future__ import annotations
import argparse, http.server, json, os, shutil, signal, socket, socketserver, subprocess, tempfile, threading, time, urllib.request
from pathlib import Path
import websocket

ROOT=Path(__file__).resolve().parents[1]
BROWSERS=('google-chrome','google-chrome-stable','chromium','chromium-browser','chrome')

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_): pass
class Server(socketserver.ThreadingMixIn,http.server.HTTPServer): daemon_threads=True

def browser():
    for name in BROWSERS:
        path=shutil.which(name)
        if path:return path
    return None

def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def json_get(url:str,timeout=2):
    with urllib.request.urlopen(url,timeout=timeout) as r:return json.loads(r.read().decode('utf-8'))

class CDP:
    def __init__(self,url:str,timeout=30):self.ws=websocket.create_connection(url,timeout=timeout,origin='http://127.0.0.1');self.seq=0
    def call(self,method:str,params=None):
        self.seq+=1;ident=self.seq;self.ws.send(json.dumps({'id':ident,'method':method,'params':params or {}}))
        while True:
            msg=json.loads(self.ws.recv())
            if msg.get('id')!=ident:continue
            if 'error' in msg:raise RuntimeError(f"CDP {method}: {msg['error']}")
            return msg.get('result',{})
    def eval(self,expr:str):
        r=self.call('Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':True})
        if r.get('exceptionDetails'):raise RuntimeError(f"browser evaluation failed: {r['exceptionDetails']}")
        return r.get('result',{}).get('value')
    def close(self):
        try:self.ws.close()
        except Exception:pass

def validate_smoke(smoke:dict,require_webgpu:bool)->None:
    if not smoke.get('ok'):raise RuntimeError(smoke.get('error','WebGPU validation page reported failure'))
    actual=smoke.get('actual') or {}
    if require_webgpu and (not actual.get('available') or not actual.get('initialized')):
        raise RuntimeError(f"real WebGPU required but unavailable: {actual.get('status','unknown')}")
    if not actual.get('initialized'):return
    validation=actual.get('validation') or {}
    if not validation.get('ok'):raise RuntimeError('production WebGPU validation report did not pass')
    shaders=validation.get('shaders') or [];pipelines=validation.get('pipelines') or []
    if len(shaders)<2 or len(pipelines)<2:raise RuntimeError('production shader/pipeline inventory is incomplete')
    if any(s.get('errors') for s in shaders):raise RuntimeError('WGSL compilation inventory contains errors')
    if require_webgpu and any(not s.get('compilationInfoSupported') for s in shaders):raise RuntimeError('getCompilationInfo unavailable for a production shader in required WebGPU run')
    resources=(validation.get('resources') or {}).get('layouts') or []
    profiles={r.get('profile') for r in resources}
    if not {'core','fallback'}<=profiles:raise RuntimeError('core/fallback production resource profiles were not both created')
    atlas=validation.get('atlasUpload') or {};exercise=validation.get('pipelineExercise') or {};deliberate=validation.get('deliberateValidation') or {}
    if not atlas.get('ok') or not exercise.get('ok'):raise RuntimeError('atlas upload or real pipeline command exercise failed')
    if not deliberate.get('ok') or not (deliberate.get('capturedByErrorScope') or deliberate.get('thrown')):raise RuntimeError('deliberate validation error was not observed')
    optional=actual.get('optionalFeatureAbsence') or {};fallback=actual.get('fallback') or {};loss=actual.get('deviceLoss') or {}
    if not optional.get('ok') or optional.get('requestedFeatures')!=[]:raise RuntimeError('optional-feature-absence path failed')
    if not fallback.get('ok') or fallback.get('activeBackend')!='webgl2' or fallback.get('presentationBackend')!='webgl2' or not fallback.get('stateUnchanged'):raise RuntimeError('initialization failure did not preserve safe WebGL2 fallback')
    if not loss.get('ok') or loss.get('activeBackend')!='webgl2' or loss.get('presentationBackend')!='webgl2' or not loss.get('stateUnchanged'):raise RuntimeError('device-loss path did not preserve safe WebGL2 fallback')

def main()->int:
    ap=argparse.ArgumentParser(description='Browser WebGPU WGSL/pipeline/resource/failure validation for SM-104.')
    ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-validation-browser.json'))
    ap.add_argument('--timeout',type=float,default=60)
    ap.add_argument('--require-webgpu',action='store_true',help='fail instead of recording an impossible run when hosted WebGPU is unavailable')
    args=ap.parse_args();exe=browser();report_path=args.report if args.report.is_absolute() else ROOT/args.report;report_path.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'steelmoth-webgpu-validation-browser-report/v1','ok':False,'browserExecutable':exe,'requireWebGPU':args.require_webgpu,'evidenceBoundary':'API/WGSL/pipeline/resource/failure-path correctness in the reported hosted browser/adapter only; never target-GPU performance or visual acceptance.','notExecuted':[{'environment':'Firefox','reason':'GitHub hosted SM-104 job uses Chromium CDP; the standalone validation page is browser-neutral and Firefox target-hardware execution remains a required later cross-browser gate.'}]}
    if not exe:report['error']='Chrome/Chromium executable not found';report_path.write_text(json.dumps(report,indent=2)+'\n');print(report['error']);return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();server_port=srv.server_address[1]
    proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-webgpu-validation-chrome-') as profile:
            debug_port=free_port();url=f'http://127.0.0.1:{server_port}/webgpu-validation-smoke.html';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug_port}',f'--user-data-dir={profile}',url]
            proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    targets=json_get(f'http://127.0.0.1:{debug_port}/json/list');target=next((t for t in targets if t.get('type')=='page' and 'webgpu-validation-smoke.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools validation page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(15,min(40,args.timeout*.7)));cdp.call('Runtime.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            while time.monotonic()<deadline:
                if cdp.eval("document.body && document.body.dataset.webgpuValidationDone==='1'"):break
                time.sleep(.15)
            else:raise RuntimeError('WebGPU validation page did not publish before browser timeout')
            text=cdp.eval("document.getElementById('webgpuValidationResult')?.textContent || ''")
            if not text:raise RuntimeError('webgpuValidationResult missing after readiness signal')
            smoke=json.loads(text);report['smoke']=smoke;report['browserCommand']=cmd[:-1]+['<local-webgpu-validation-url>'];validate_smoke(smoke,args.require_webgpu);report['ok']=True
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
                tail=proc.stderr.read()[-3000:]
                if tail and not report['ok']:report['browserStderrTail']=tail
            except Exception:pass
        srv.shutdown();srv.server_close()
    report_path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');actual=(report.get('smoke') or {}).get('actual') or {};validation=actual.get('validation') or {}
    print(f"SM-104 WEBGPU VALIDATION {'PASS' if report['ok'] else 'FAIL'}: browser={exe} initialized={actual.get('initialized')} shaders={len(validation.get('shaders') or [])} pipelines={len(validation.get('pipelines') or [])}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
