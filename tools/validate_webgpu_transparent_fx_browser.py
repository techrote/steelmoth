#!/usr/bin/env python3
from __future__ import annotations
import argparse,http.server,json,os,shutil,signal,socket,socketserver,subprocess,tempfile,threading,time,urllib.request
from pathlib import Path
import websocket
ROOT=Path(__file__).resolve().parents[1]
BROWSERS=('google-chrome','google-chrome-stable','chromium','chromium-browser','chrome')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
class Server(socketserver.ThreadingMixIn,http.server.HTTPServer):daemon_threads=True
def browser():
    for name in BROWSERS:
        p=shutil.which(name)
        if p:return p
    return None
def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def json_get(url,timeout=2):
    with urllib.request.urlopen(url,timeout=timeout) as r:return json.loads(r.read().decode())
class CDP:
    def __init__(self,url,timeout=100):self.ws=websocket.create_connection(url,timeout=timeout,origin='http://127.0.0.1');self.seq=0
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
def validate(smoke,require_webgpu):
    if not smoke.get('ok'):raise RuntimeError(smoke.get('error','SM-206 transparent FX page reported failure'))
    checks=smoke.get('checks') or []
    if len(checks)<22:raise RuntimeError(f'insufficient SM-206 browser assertions: {len(checks)}')
    if not all(c.get('ok') for c in checks):raise RuntimeError('SM-206 smoke contains failed checks')
    diag=smoke.get('diagnostics') or {}
    if diag.get('schema')!='steelmoth-webgpu-transparent-fx/v1':raise RuntimeError(f"unexpected diagnostics schema: {diag.get('schema')}")
    if diag.get('maxShaderFx')!=16 or diag.get('maxTransparentSprites')!=640:raise RuntimeError('transparent batch caps changed')
    stages=['world-alpha','world-additive','post-effects','top-additive','top-alpha','objective','guide']
    if diag.get('stages')!=stages:raise RuntimeError(f"stage order drifted: {diag.get('stages')}")
    blend=diag.get('blend') or {}
    if blend.get('alpha',{}).get('color',{}).get('dstFactor')!='one-minus-src-alpha':raise RuntimeError('alpha blend contract missing')
    if blend.get('additive',{}).get('color',{}).get('dstFactor')!='one':raise RuntimeError('additive blend contract missing')
    if 'canonical-if-supplied' not in str((diag.get('depthPolicy') or {}).get('world')):raise RuntimeError('canonical transparent depth hook missing')
    if 'WebGL2' not in str(diag.get('fallback')):raise RuntimeError('fallback authority missing')
    samples=smoke.get('samples') or {}
    if not samples.get('alpha') or not samples.get('additive'):raise RuntimeError('alpha/additive readback samples missing')
    if require_webgpu and not diag:raise RuntimeError('required real WebGPU evidence missing')
def main():
    ap=argparse.ArgumentParser(description='Real-browser WebGPU transparent sprite/particle/objective/guide validation for SM-206.')
    ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-transparent-fx-browser.json'));ap.add_argument('--timeout',type=float,default=190);ap.add_argument('--require-webgpu',action='store_true');args=ap.parse_args()
    exe=browser();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'steelmoth-webgpu-transparent-fx-browser-report/v1','ok':False,'browserExecutable':exe,'requireWebGPU':args.require_webgpu,'evidenceBoundary':'Real hosted WebGPU validates bounded transparent atlas batches, explicit alpha/additive blending, canonical depth composition hooks, compatibility stage ordering and procedural pulse/objective/guide positioning. It does not claim SM-207 bloom/post parity, SM-402 water/foliage ordering, target-GPU performance, or human visual approval.'}
    if not exe:report['error']='Chrome/Chromium executable not found';path.write_text(json.dumps(report,indent=2)+'\n');return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-sm206-chrome-') as profile:
            debug=free_port();url=f'http://127.0.0.1:{port}/webgpu-transparent-fx-smoke.html';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}',url]
            proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    target=next((t for t in json_get(f'http://127.0.0.1:{debug}/json/list') if t.get('type')=='page' and 'webgpu-transparent-fx-smoke.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools SM-206 page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(50,min(150,args.timeout*.8)));cdp.call('Runtime.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            while time.monotonic()<deadline:
                if cdp.eval("document.body && document.body.dataset.webgpuTransparentFxDone==='1'"):break
                time.sleep(.2)
            else:raise RuntimeError('SM-206 transparent FX page did not publish before timeout')
            text=cdp.eval("document.getElementById('webgpuTransparentFxResult')?.textContent || ''")
            if not text:raise RuntimeError('webgpuTransparentFxResult missing after readiness signal')
            smoke=json.loads(text);report['smoke']=smoke;report['browserCommand']=cmd[:-1]+['<local-sm206-url>'];validate(smoke,args.require_webgpu);report['ok']=True
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
    path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');smoke=report.get('smoke') or {};print(f"SM-206 WEBGPU TRANSPARENT FX {'PASS' if report['ok'] else 'FAIL'}: browser={exe} checks={len(smoke.get('checks') or [])}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
