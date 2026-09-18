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
    def __init__(self,url:str,timeout=20):self.ws=websocket.create_connection(url,timeout=timeout,origin='http://127.0.0.1');self.seq=0
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

def main()->int:
    ap=argparse.ArgumentParser(description='Hosted browser smoke for SM-103 WebGPU resource/frame infrastructure.')
    ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-resource-browser-smoke.json'));ap.add_argument('--timeout',type=float,default=45);args=ap.parse_args()
    exe=browser();report_path=args.report if args.report.is_absolute() else ROOT/args.report;report_path.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'steelmoth-webgpu-resource-browser-validation/v1','ok':False,'browser':exe,'evidenceBoundary':'Hosted browser API/resource lifecycle correctness only; this is not target-GPU compatibility, visual parity, VRAM residency or performance evidence.'}
    if not exe:report['error']='Chrome/Chromium executable not found';report_path.write_text(json.dumps(report,indent=2)+'\n');print(report['error']);return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();server_port=srv.server_address[1]
    proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-webgpu-resources-chrome-') as profile:
            debug_port=free_port();url=f'http://127.0.0.1:{server_port}/webgpu-resources-smoke.html';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug_port}',f'--user-data-dir={profile}',url]
            proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    targets=json_get(f'http://127.0.0.1:{debug_port}/json/list');target=next((t for t in targets if t.get('type')=='page' and 'webgpu-resources-smoke.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools resource-smoke page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(10,min(30,args.timeout*.6)));cdp.call('Runtime.enable')
            while time.monotonic()<deadline:
                done=cdp.eval("document.body && document.body.dataset.webgpuResourceSmokeDone==='1'")
                if done:break
                time.sleep(.15)
            else:raise RuntimeError('WebGPU resource smoke did not publish before browser timeout')
            text=cdp.eval("document.getElementById('webgpuResourceSmokeResult')?.textContent || ''")
            if not text:raise RuntimeError('webgpuResourceSmokeResult missing after readiness signal')
            smoke=json.loads(text);report['smoke']=smoke;report['browserCommand']=cmd[:-1]+['<local-webgpu-resource-smoke-url>']
            if not smoke.get('ok'):raise RuntimeError(smoke.get('error','resource browser smoke reported failure'))
            actual=smoke.get('actual',{});report['actualWebGPUAvailable']=bool(actual.get('available'));report['actualWebGPUInitialized']=bool(actual.get('initialized'))
            if actual.get('initialized'):
                d=actual.get('diagnostics') or {};r=d.get('resources') or {};g=d.get('frameGraph') or {};pdiag=d.get('pipelines') or {}
                if d.get('frameCount')!=3 or g.get('executionCount')!=3 or r.get('resizeCount')!=2:raise RuntimeError('real WebGPU resource lifecycle did not complete three frames/two resizes')
                if pdiag.get('hits',0)<1 or pdiag.get('misses')!=1:raise RuntimeError('real WebGPU pipeline cache diagnostics mismatch')
            report['ok']=True
    except Exception as exc:
        report['error']=str(exc)
    finally:
        if cdp:cdp.close()
        if proc and proc.poll() is None:
            try:os.killpg(proc.pid,signal.SIGTERM);proc.wait(timeout=4)
            except Exception:
                try:os.killpg(proc.pid,signal.SIGKILL)
                except Exception:pass
        if proc and proc.stderr:
            try:
                tail=proc.stderr.read()[-2500:]
                if tail and not report['ok']:report['browserStderrTail']=tail
            except Exception:pass
        srv.shutdown();srv.server_close()
    report_path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');actual=report.get('smoke',{}).get('actual',{});print(f"SM-103 WEBGPU RESOURCE BROWSER SMOKE {'PASS' if report['ok'] else 'FAIL'}: browser={exe} navigator.gpu={actual.get('available')} initialized={actual.get('initialized')} status={actual.get('status','n/a')}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
