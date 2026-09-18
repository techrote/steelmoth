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
        p=shutil.which(name)
        if p:return p
    return None

def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def json_get(url:str,timeout=2):
    with urllib.request.urlopen(url,timeout=timeout) as r:return json.loads(r.read().decode('utf-8'))

class CDP:
    def __init__(self,url:str,timeout=90):self.ws=websocket.create_connection(url,timeout=timeout,origin='http://127.0.0.1');self.seq=0
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
    if not smoke.get('ok'):raise RuntimeError(smoke.get('error','SM-205 local-shadow page reported failure'))
    controls=smoke.get('controls') or {};required={'cargo_crate','rust_barrel','server_cabinet','hex_maintenance_idle_0'}
    if required!=set(controls):raise RuntimeError(f"production control set mismatch: {sorted(controls)}")
    for name,rows in controls.items():
        if [r.get('angle') for r in rows]!=[0,45,90,135,180,225,270,315]:raise RuntimeError(f'eight-angle matrix incomplete for {name}')
        if not all(0 <= float(r.get('visibility',-1)) <= 1.001 for r in rows):raise RuntimeError(f'unbounded self visibility for {name}')
    syn=smoke.get('synthetic') or {}
    if not float(syn.get('nearSelf',1)) < .9:raise RuntimeError(f"synthetic self-shadow did not occlude: {syn.get('nearSelf')}")
    if not float(syn.get('nearContact',1)) < .99:raise RuntimeError(f"synthetic contact shadow did not occlude: {syn.get('nearContact')}")
    if not float(syn.get('far20',0)) > .985:raise RuntimeError(f"20px contact path escaped short-range bound: {syn.get('far20')}")
    if not float(syn.get('far36',1)) < float(syn.get('far20',0))-.01:raise RuntimeError('explicit 36px contact range did not extend farther than 20px control')
    if abs(float(syn.get('disabledSelf',0))-1)>.002 or abs(float(syn.get('disabledContact',0))-1)>.002:raise RuntimeError('disabled local-shadow passes are not fully visible')
    diag=smoke.get('diagnostics') or {}
    if diag.get('schema')!='steelmoth-webgpu-local-shadows/v1':raise RuntimeError(f'unexpected diagnostics schema: {diag.get("schema")}')
    quality=diag.get('quality') or {}
    if quality.get('selfSamples')!=[0,8,12,16,28] or quality.get('contactSamples')!=[0,4,8,12]:raise RuntimeError(f'quality/sample caps changed: {quality}')
    if set(diag.get('debugModes') or [])!={'self-shadow','contact-shadow'}:raise RuntimeError('independent self/contact debug modes missing')
    if diag.get('depthHierarchyReuse',{}).get('used') is not False:raise RuntimeError('SM-205 must not substitute ownership-depth hierarchy for local Material-v2 height')
    timing=diag.get('timing') or {}
    if timing.get('gpuMs') is not None or not isinstance(timing.get('cpuSubmitWaitMs'),(int,float)):raise RuntimeError('SM-205 timing evidence is mislabeled or missing')
    if len(smoke.get('checks') or [])<45:raise RuntimeError(f'insufficient SM-205 browser assertions: {len(smoke.get("checks") or [])}')
    if require_webgpu and not diag:raise RuntimeError('real WebGPU local-shadow diagnostics missing')

def main()->int:
    ap=argparse.ArgumentParser(description='Real-browser WebGPU Material-v2 self/contact-shadow validation for SM-205.')
    ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-local-shadows-browser.json'))
    ap.add_argument('--timeout',type=float,default=190)
    ap.add_argument('--require-webgpu',action='store_true')
    args=ap.parse_args();exe=browser();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'steelmoth-webgpu-local-shadows-browser-report/v1','ok':False,'browserExecutable':exe,'requireWebGPU':args.require_webgpu,'evidenceBoundary':'Real hosted WebGPU local Material-v2 self/contact visibility correctness, production-control angle coverage and deterministic short-range contact fixture. CPU submit/wait wall time is not GPU timing; no DSO, Dark Bloom, AO, final composition, target-GPU performance or human visual approval is claimed.'}
    if not exe:report['error']='Chrome/Chromium executable not found';path.write_text(json.dumps(report,indent=2)+'\n');return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-sm205-chrome-') as profile:
            debug=free_port();url=f'http://127.0.0.1:{port}/webgpu-local-shadows-smoke.html';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}',url]
            proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    target=next((t for t in json_get(f'http://127.0.0.1:{debug}/json/list') if t.get('type')=='page' and 'webgpu-local-shadows-smoke.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools SM-205 page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(50,min(150,args.timeout*.8)));cdp.call('Runtime.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            while time.monotonic()<deadline:
                if cdp.eval("document.body && document.body.dataset.webgpuLocalShadowsDone==='1'"):break
                time.sleep(.2)
            else:raise RuntimeError('SM-205 local-shadow page did not publish before timeout')
            text=cdp.eval("document.getElementById('webgpuLocalShadowsResult')?.textContent || ''")
            if not text:raise RuntimeError('webgpuLocalShadowsResult missing after readiness signal')
            smoke=json.loads(text);report['smoke']=smoke;report['browserCommand']=cmd[:-1]+['<local-sm205-url>'];validate(smoke,args.require_webgpu);report['ok']=True
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
                tail=proc.stderr.read()[-6000:]
                if tail and not report['ok']:report['browserStderrTail']=tail
            except Exception:pass
        srv.shutdown();srv.server_close()
    path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');smoke=report.get('smoke') or {};print(f"SM-205 WEBGPU LOCAL SHADOWS {'PASS' if report['ok'] else 'FAIL'}: browser={exe} checks={len(smoke.get('checks') or [])} controls={len((smoke.get('controls') or {}))}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
