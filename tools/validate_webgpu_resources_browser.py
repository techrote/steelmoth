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
    m=re.search(r'<script id="webgpuResourceSmokeResult" type="application/json">(.*?)</script>',dom,re.S)
    if not m: raise RuntimeError('webgpuResourceSmokeResult not found in dumped DOM')
    return json.loads(html.unescape(m.group(1)))

def main()->int:
    ap=argparse.ArgumentParser(description='Hosted browser smoke for SM-103 WebGPU resource/frame infrastructure.')
    ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-resource-browser-smoke.json'));ap.add_argument('--timeout',type=float,default=50);args=ap.parse_args()
    exe=browser();report_path=args.report if args.report.is_absolute() else ROOT/args.report;report_path.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'steelmoth-webgpu-resource-browser-validation/v1','ok':False,'browser':exe,'evidenceBoundary':'Hosted browser API/resource lifecycle correctness only; this is not target-GPU compatibility, visual parity, VRAM residency or performance evidence.'}
    if not exe: report['error']='Chrome/Chromium executable not found';report_path.write_text(json.dumps(report,indent=2)+'\n');print(report['error']);return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1]
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-webgpu-resources-chrome-') as profile:
            url=f'http://127.0.0.1:{port}/webgpu-resources-smoke.html';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-webgpu',f'--user-data-dir={profile}','--virtual-time-budget=9000','--dump-dom',url];p=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True,timeout=args.timeout)
        report['browserCommand']=cmd[:-1]+['<local-webgpu-resource-smoke-url>'];report['returncode']=p.returncode
        if p.returncode: raise RuntimeError(f'Chrome/Chromium exited {p.returncode}: {p.stderr[-2500:]}')
        smoke=parse(p.stdout);report['smoke']=smoke
        if not smoke.get('ok'): raise RuntimeError(smoke.get('error','resource browser smoke reported failure'))
        actual=smoke.get('actual',{});report['actualWebGPUAvailable']=bool(actual.get('available'));report['actualWebGPUInitialized']=bool(actual.get('initialized'))
        if actual.get('initialized'):
            d=actual.get('diagnostics') or {};r=d.get('resources') or {};g=d.get('frameGraph') or {};pdiag=d.get('pipelines') or {}
            if d.get('frameCount')!=3 or g.get('executionCount')!=3 or r.get('resizeCount')!=2: raise RuntimeError('real WebGPU resource lifecycle did not complete three frames/two resizes')
            if pdiag.get('hits',0)<1 or pdiag.get('misses')!=1: raise RuntimeError('real WebGPU pipeline cache diagnostics mismatch')
        report['ok']=True
    except Exception as exc: report['error']=str(exc)
    finally: srv.shutdown();srv.server_close()
    report_path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');actual=report.get('smoke',{}).get('actual',{});print(f"SM-103 WEBGPU RESOURCE BROWSER SMOKE {'PASS' if report['ok'] else 'FAIL'}: browser={exe} navigator.gpu={actual.get('available')} initialized={actual.get('initialized')} status={actual.get('status','n/a')}")
    if not report['ok']: print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
