#!/usr/bin/env python3
from __future__ import annotations
import argparse, base64, hashlib, http.server, json, os, pathlib, shutil, signal, socket, socketserver, subprocess, sys, tempfile, threading, time, urllib.parse, urllib.request
import websocket

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

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0)); return s.getsockname()[1]

def json_get(url:str,timeout=2):
    with urllib.request.urlopen(url,timeout=timeout) as r: return json.loads(r.read().decode('utf-8'))

class CDP:
    def __init__(self,url:str,timeout=5):
        self.ws=websocket.create_connection(url,timeout=timeout,origin='http://127.0.0.1');self.seq=0
    def call(self,method:str,params=None):
        self.seq+=1;ident=self.seq;self.ws.send(json.dumps({'id':ident,'method':method,'params':params or {}}))
        while True:
            msg=json.loads(self.ws.recv())
            if msg.get('id')!=ident: continue
            if 'error' in msg: raise RuntimeError(f"CDP {method}: {msg['error']}")
            return msg.get('result',{})
    def eval(self,expr:str):
        r=self.call('Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':True})
        if r.get('exceptionDetails'): raise RuntimeError(f"browser evaluation failed: {r['exceptionDetails']}")
        return r.get('result',{}).get('value')
    def close(self):
        try:self.ws.close()
        except Exception:pass

def main():
    ap=argparse.ArgumentParser(description='Capture deterministic Steel Moth renderer fixture with local Chrome/Chromium.')
    ap.add_argument('--fixture',default='harness-smoke'); ap.add_argument('--backend',default='webgl2')
    ap.add_argument('--quality',default='high',choices=['low','medium','high','ultra','runtime-default'])
    ap.add_argument('--angle',type=float,default=0); ap.add_argument('--width',type=int,default=640); ap.add_argument('--height',type=int,default=360)
    ap.add_argument('--dpr',type=float,default=1); ap.add_argument('--seed',type=int,default=1397572098); ap.add_argument('--fixed-time-ms',type=float,default=12000)
    ap.add_argument('--repeat',type=int,default=1); ap.add_argument('--browser-timeout',type=float,default=60.0); ap.add_argument('--out',type=pathlib.Path,default=pathlib.Path('render-captures/harness-smoke'))
    ap.add_argument('--render-transform-baseline',action='store_true',help='render-test only: bypass SM-101 transform integration to reproduce the immediately-pre-SM-101 SM-100 boundary')
    a=ap.parse_args(); exe=browser()
    if not exe: print('No Chrome/Chromium executable found; no capture produced.',file=sys.stderr); return 2
    a.out.mkdir(parents=True,exist_ok=True)
    handler=lambda *x,**k: Quiet(*x,directory=str(ROOT),**k)
    srv=Server(('127.0.0.1',0),handler); threading.Thread(target=srv.serve_forever,daemon=True).start(); server_port=srv.server_address[1]
    results=[]; hashes=[]
    try:
        for i in range(a.repeat):
            run_dir=a.out/(f'run-{i+1:02d}' if a.repeat>1 else '.'); run_dir.mkdir(parents=True,exist_ok=True)
            query_data={'renderTest':1,'fixture':a.fixture,'backend':a.backend,'quality':a.quality,'width':a.width,'height':a.height,'dpr':a.dpr,'lightAngle':a.angle,'seed':a.seed,'fixedTimeMs':a.fixed_time_ms}
            if a.render_transform_baseline: query_data['renderTransformBaseline']=1
            query=urllib.parse.urlencode(query_data);url=f'http://127.0.0.1:{server_port}/render-test.html?{query}'
            shot=(run_dir/'capture.png').resolve();canvas_shot=(run_dir/'canvas.png').resolve();cssw=max(160,round(a.width/a.dpr));cssh=max(90,round(a.height/a.dpr))
            with tempfile.TemporaryDirectory(prefix='steelmoth-chrome-') as profile:
                port=free_port();log_path=run_dir/'chrome.log'
                with log_path.open('w',encoding='utf-8') as log:
                    cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-swiftshader','--remote-allow-origins=*',f'--remote-debugging-port={port}',f'--user-data-dir={profile}',f'--force-device-scale-factor={a.dpr}',f'--window-size={cssw},{cssh}',url]
                    proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=log,start_new_session=True)
                    cdp=None
                    try:
                        deadline=time.monotonic()+a.browser_timeout;target=None
                        while time.monotonic()<deadline and proc.poll() is None:
                            try:
                                targets=json_get(f'http://127.0.0.1:{port}/json/list')
                                target=next((t for t in targets if t.get('type')=='page' and 'render-test.html' in t.get('url','')),None)
                                if target: break
                            except Exception: pass
                            time.sleep(.2)
                        if not target: raise RuntimeError('Chrome DevTools page target did not become available')
                        cdp=CDP(target['webSocketDebuggerUrl']);cdp.call('Page.enable');cdp.call('Runtime.enable')
                        while time.monotonic()<deadline:
                            ready=cdp.eval("document.body && (document.body.dataset.renderTestReady==='1' || document.body.dataset.renderTestError==='1')")
                            if ready: break
                            time.sleep(.15)
                        else: raise RuntimeError('render-test did not become ready before browser timeout')
                        text=cdp.eval("document.getElementById('renderTestResult')?.textContent || ''")
                        if not text: raise RuntimeError('renderTestResult not found after readiness signal')
                        result=json.loads(text)
                        if not result.get('ok'): raise RuntimeError(result.get('error','render harness failed'))
                        canvas_url=cdp.eval("document.getElementById('game').toDataURL('image/png')")
                        if not isinstance(canvas_url,str) or ',' not in canvas_url: raise RuntimeError('canvas PNG data unavailable')
                        canvas_bytes=base64.b64decode(canvas_url.split(',',1)[1]);canvas_shot.write_bytes(canvas_bytes)
                        if hashlib.sha256(canvas_bytes).hexdigest()!=result.get('canvasPng',{}).get('sha256'): raise RuntimeError('CDP canvas bytes disagree with harness canvas hash')
                        screen=cdp.call('Page.captureScreenshot',{'format':'png','fromSurface':True,'captureBeyondViewport':False});screen_bytes=base64.b64decode(screen['data']);shot.write_bytes(screen_bytes)
                    finally:
                        if cdp: cdp.close()
                        try: os.killpg(proc.pid,signal.SIGTERM)
                        except ProcessLookupError: pass
                        try: proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            try: os.killpg(proc.pid,signal.SIGKILL)
                            except ProcessLookupError: pass
                            proc.wait(timeout=5)
            (run_dir/'diagnostics.json').write_text(json.dumps(result,indent=2,sort_keys=True)+'\n',encoding='utf-8')
            (run_dir/'performance.json').write_text(json.dumps(result.get('performance',{}),indent=2,sort_keys=True)+'\n',encoding='utf-8')
            h=hashlib.sha256(shot.read_bytes()).hexdigest();hashes.append(h);results.append(result);(run_dir/'capture.sha256').write_text(f'{h}  capture.png\n',encoding='ascii')
        fingerprints={r['sceneFingerprint'] for r in results};canvas_hashes={r['canvasPng']['sha256'] for r in results};screenshot_hashes=set(hashes)
        summary={'runs':len(results),'renderTransformMode':'baseline-sm100' if a.render_transform_baseline else 'shared-sm101','sceneFingerprints':sorted(fingerprints),'canvasPngSha256':sorted(canvas_hashes),'viewportScreenshotSha256':sorted(screenshot_hashes),'deterministicMetadata':len(fingerprints)==1,'deterministicCanvas':len(canvas_hashes)==1,'deterministicViewportScreenshot':len(screenshot_hashes)==1,'browser':exe,'captureTransport':'cdp'}
        (a.out/'summary.json').write_text(json.dumps(summary,indent=2,sort_keys=True)+'\n',encoding='utf-8');print(json.dumps(summary,indent=2))
        return 0 if summary['deterministicMetadata'] and summary['deterministicCanvas'] and summary['deterministicViewportScreenshot'] else 1
    except Exception as exc:
        print(f'Browser capture failed: {exc}',file=sys.stderr);return 2
    finally: srv.shutdown();srv.server_close()
if __name__=='__main__': raise SystemExit(main())
