#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, html, http.server, json, os, pathlib, re, shutil, signal, socketserver, subprocess, sys, tempfile, threading, urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[1]
BROWSERS=['chromium','chromium-browser','google-chrome','google-chrome-stable','chrome']
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_): pass
class Server(socketserver.ThreadingMixIn,http.server.HTTPServer): daemon_threads=True

def browser():
    for name in BROWSERS:
        p=shutil.which(name)
        if p: return p
    return None

def parse_result(dom:str):
    m=re.search(r'<script id="renderTestResult" type="application/json">(.*?)</script>',dom,re.S)
    if not m: raise RuntimeError('renderTestResult not found in dumped DOM')
    return json.loads(html.unescape(m.group(1)))

def main():
    ap=argparse.ArgumentParser(description='Capture deterministic Steel Moth renderer fixture with local Chrome/Chromium.')
    ap.add_argument('--fixture',default='harness-smoke'); ap.add_argument('--backend',default='webgl2')
    ap.add_argument('--quality',default='high',choices=['low','medium','high','ultra','runtime-default'])
    ap.add_argument('--angle',type=float,default=0); ap.add_argument('--width',type=int,default=640); ap.add_argument('--height',type=int,default=360)
    ap.add_argument('--dpr',type=float,default=1); ap.add_argument('--seed',type=int,default=1397572098); ap.add_argument('--fixed-time-ms',type=float,default=12000)
    ap.add_argument('--repeat',type=int,default=1); ap.add_argument('--browser-timeout',type=float,default=20.0); ap.add_argument('--out',type=pathlib.Path,default=pathlib.Path('render-captures/harness-smoke'))
    ap.add_argument('--render-transform-baseline',action='store_true',help='render-test only: bypass SM-101 transform integration to reproduce the immediately-pre-SM-101 SM-100 boundary')
    a=ap.parse_args(); exe=browser()
    if not exe: print('No Chrome/Chromium executable found; no capture produced.',file=sys.stderr); return 2
    a.out.mkdir(parents=True,exist_ok=True)
    handler=lambda *x,**k: Quiet(*x,directory=str(ROOT),**k)
    srv=Server(('127.0.0.1',0),handler); threading.Thread(target=srv.serve_forever,daemon=True).start(); port=srv.server_address[1]
    results=[]; hashes=[]
    try:
        for i in range(a.repeat):
            run_dir=a.out/(f'run-{i+1:02d}' if a.repeat>1 else '.'); run_dir.mkdir(parents=True,exist_ok=True)
            query_data={'renderTest':1,'fixture':a.fixture,'backend':a.backend,'quality':a.quality,'width':a.width,'height':a.height,'dpr':a.dpr,'lightAngle':a.angle,'seed':a.seed,'fixedTimeMs':a.fixed_time_ms}
            if a.render_transform_baseline: query_data['renderTransformBaseline']=1
            query=urllib.parse.urlencode(query_data)
            url=f'http://127.0.0.1:{port}/render-test.html?{query}'; shot=(run_dir/'capture.png').resolve()
            cssw=max(160,round(a.width/a.dpr)); cssh=max(90,round(a.height/a.dpr))
            with tempfile.TemporaryDirectory(prefix='steelmoth-chrome-') as profile:
                # Chrome 152 no longer automatically falls back to software WebGL
                # in headless environments. These are trusted, local deterministic
                # fixtures, so explicitly allow SwiftShader rather than accepting a
                # timeout or silently treating a non-render as parity evidence.
                cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--enable-unsafe-swiftshader',f'--user-data-dir={profile}',f'--force-device-scale-factor={a.dpr}',f'--window-size={cssw},{cssh}','--virtual-time-budget=6000',f'--screenshot={shot}','--dump-dom',url]
                proc=subprocess.Popen(cmd,cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
                try:
                    stdout,stderr=proc.communicate(timeout=a.browser_timeout)
                except subprocess.TimeoutExpired:
                    try: os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                    stdout,stderr=proc.communicate()
                    print('Chrome/Chromium did not produce a render-test DOM within the timeout. This environment may lack a usable EGL/GL backend; no capture was accepted.',file=sys.stderr)
                    if stderr: print(stderr[-2000:],file=sys.stderr)
                    return 2
                cp=type('Completed',(object,),{'returncode':proc.returncode,'stdout':stdout,'stderr':stderr})()
            if cp.returncode!=0:
                print(f'Chromium exited {cp.returncode}; no capture was accepted.\n{cp.stderr[-2000:]}',file=sys.stderr)
                return 2
            result=parse_result(cp.stdout)
            if not result.get('ok'): raise RuntimeError(result.get('error','render harness failed'))
            (run_dir/'diagnostics.json').write_text(json.dumps(result,indent=2,sort_keys=True)+'\n',encoding='utf-8')
            (run_dir/'performance.json').write_text(json.dumps(result.get('performance',{}),indent=2,sort_keys=True)+'\n',encoding='utf-8')
            h=hashlib.sha256(shot.read_bytes()).hexdigest(); hashes.append(h); results.append(result)
            (run_dir/'capture.sha256').write_text(f'{h}  capture.png\n',encoding='ascii')
        fingerprints={r['sceneFingerprint'] for r in results}; canvas_hashes={r['canvasPng']['sha256'] for r in results}; screenshot_hashes=set(hashes)
        summary={'runs':len(results),'renderTransformMode':'baseline-sm100' if a.render_transform_baseline else 'shared-sm101','sceneFingerprints':sorted(fingerprints),'canvasPngSha256':sorted(canvas_hashes),'viewportScreenshotSha256':sorted(screenshot_hashes),'deterministicMetadata':len(fingerprints)==1,'deterministicCanvas':len(canvas_hashes)==1,'deterministicViewportScreenshot':len(screenshot_hashes)==1,'browser':exe}
        (a.out/'summary.json').write_text(json.dumps(summary,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        print(json.dumps(summary,indent=2))
        return 0 if summary['deterministicMetadata'] and summary['deterministicCanvas'] and summary['deterministicViewportScreenshot'] else 1
    finally: srv.shutdown(); srv.server_close()
if __name__=='__main__': raise SystemExit(main())
