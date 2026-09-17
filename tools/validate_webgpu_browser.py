#!/usr/bin/env python3
from __future__ import annotations
import argparse, html, http.server, json, re, shutil, socketserver, subprocess, tempfile, threading
from pathlib import Path

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

def parse(dom:str)->dict:
    m=re.search(r'<script id="webgpuSmokeResult" type="application/json">(.*?)</script>',dom,re.S)
    if not m: raise RuntimeError('webgpuSmokeResult not found in dumped DOM')
    return json.loads(html.unescape(m.group(1)))

def main()->int:
    ap=argparse.ArgumentParser(description='Hosted browser smoke for SM-102 WebGPU lifecycle/fallback policy.')
    ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-browser-smoke.json'))
    ap.add_argument('--timeout',type=float,default=45)
    args=ap.parse_args();exe=browser();report_path=args.report if args.report.is_absolute() else ROOT/args.report;report_path.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'steelmoth-webgpu-browser-validation/v1','ok':False,'browser':exe,'evidenceBoundary':'Hosted browser API/fallback correctness only; navigator.gpu or a usable adapter may be absent. This is not target-GPU compatibility or performance evidence.'}
    if not exe:
        report['error']='Chrome/Chromium executable not found';report_path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(report['error']);return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1]
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-webgpu-chrome-') as profile:
            url=f'http://127.0.0.1:{port}/webgpu-smoke.html'
            cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-webgpu',f'--user-data-dir={profile}','--virtual-time-budget=7000','--dump-dom',url]
            p=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True,timeout=args.timeout)
        report['browserCommand']=cmd[:-1]+['<local-webgpu-smoke-url>'];report['returncode']=p.returncode
        if p.returncode: raise RuntimeError(f'Chrome/Chromium exited {p.returncode}: {p.stderr[-2500:]}')
        smoke=parse(p.stdout);report['smoke']=smoke
        if not smoke.get('ok'): raise RuntimeError(smoke.get('error','browser smoke reported failure'))
        if smoke.get('autoPolicy',{}).get('selected')!='webgl2': raise RuntimeError('Auto policy did not remain WebGL2-gated')
        if not smoke.get('deliberateFailure',{}).get('ok'): raise RuntimeError('deliberate WebGPU failure path did not execute')
        report['actualWebGPUAvailable']=bool(smoke.get('actual',{}).get('available'));report['actualWebGPUInitialized']=bool(smoke.get('actual',{}).get('initialized'));report['ok']=True
    except Exception as exc: report['error']=str(exc)
    finally: srv.shutdown();srv.server_close()
    report_path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    actual=report.get('smoke',{}).get('actual',{});print(f"SM-102 BROWSER SMOKE {'PASS' if report['ok'] else 'FAIL'}: browser={exe} navigator.gpu={actual.get('available')} initialized={actual.get('initialized')} status={actual.get('status','ready' if actual.get('initialized') else 'n/a')}")
    if not report['ok']: print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__': raise SystemExit(main())
