#!/usr/bin/env python3
from __future__ import annotations
import argparse,http.server,json,os,shutil,signal,socket,socketserver,subprocess,tempfile,threading,time,urllib.request
from pathlib import Path
import websocket
ROOT=Path(__file__).resolve().parents[1]; BROWSERS=('google-chrome','google-chrome-stable','chromium','chromium-browser','chrome')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_): pass
class Server(socketserver.ThreadingMixIn,http.server.HTTPServer): daemon_threads=True
def browser():
    for name in BROWSERS:
        p=shutil.which(name)
        if p:return p
    if os.name=='nt':
        for p in (Path(os.environ.get('PROGRAMFILES',''))/'Google/Chrome/Application/chrome.exe',Path(os.environ.get('PROGRAMFILES(X86)',''))/'Google/Chrome/Application/chrome.exe'):
            if p.is_file():return str(p)
    return None
def stop_process(proc):
    if not proc or proc.poll() is not None:return
    try:
        if os.name=='nt':subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10,check=False)
        else:os.killpg(proc.pid,signal.SIGTERM)
        proc.wait(timeout=4)
    except Exception:
        try:proc.kill();proc.wait(timeout=4)
        except Exception:pass
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
            if 'error' in m:raise RuntimeError(f"CDP {method}: {m['error']}")
            return m.get('result',{})
    def eval(self,expr):
        r=self.call('Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':True})
        if r.get('exceptionDetails'):raise RuntimeError(f"browser evaluation failed: {r['exceptionDetails']}")
        return r.get('result',{}).get('value')
    def close(self):
        try:self.ws.close()
        except Exception:pass
def validate(smoke):
    if not smoke.get('ok'):raise RuntimeError(smoke.get('error','SM-601 browser smoke failed'))
    checks=smoke.get('checks') or []
    if len(checks)<10:raise RuntimeError(f'insufficient SM-601 browser assertions: {len(checks)}')
    failed=[c for c in checks if not c.get('ok')]
    if failed:raise RuntimeError(f'SM-601 smoke contains failed checks: {failed[:2]}')
    if not (smoke.get('gpu') or {}).get('realWebGPU'):raise RuntimeError('SM-601 did not execute the real WebGPU temporal pass')
    quality=smoke.get('quality') or {}; medium=quality.get('medium') or {}
    if (medium.get('temporal') or {}).get('historyWeight',1)>.60:raise RuntimeError('Medium temporal history is too aggressive')
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--report',type=Path,default=Path('artifacts/sm601-gtao-stabilization-browser.json'));ap.add_argument('--timeout',type=float,default=180);args=ap.parse_args();exe=browser();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'steelmoth-sm601-browser-report/v1','ok':False,'browserExecutable':exe,'evidenceBoundary':'Hosted WebGPU validates temporal execution, lifecycle/history rejection and bounded quality controls. It is not GTX 1650 SUPER timing or final target-hardware acceptance.'}
    if not exe:report['error']='Chrome/Chromium executable not found';path.write_text(json.dumps(report,indent=2)+'\n');return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-sm601-chrome-') as profile:
            debug=free_port();url=f'http://127.0.0.1:{port}/webgpu-gtao-stabilization-smoke.html';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}',url];proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    target=next((t for t in json_get(f'http://127.0.0.1:{debug}/json/list') if t.get('type')=='page' and 'webgpu-gtao-stabilization-smoke.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools SM-601 target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(50,min(140,args.timeout*.8)));cdp.call('Runtime.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            while time.monotonic()<deadline:
                if cdp.eval("document.body && document.body.dataset.webgpuGtaoStabilizationDone==='1'"):break
                time.sleep(.2)
            else:raise RuntimeError('SM-601 page did not publish before timeout')
            smoke=json.loads(cdp.eval("document.getElementById('webgpuGtaoStabilizationResult')?.textContent || ''"));report['smoke']=smoke;validate(smoke);report['ok']=True
    except Exception as exc:report['error']=str(exc)
    finally:
        if cdp:cdp.close()
        stop_process(proc)
        if proc and proc.stderr:
            try:
                tail=proc.stderr.read()[-6000:]
                if tail and not report['ok']:report['browserStderrTail']=tail
            except Exception:pass
        srv.shutdown();srv.server_close()
    path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');print(f"SM-601 WEBGPU GTAO {'PASS' if report['ok'] else 'FAIL'}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
