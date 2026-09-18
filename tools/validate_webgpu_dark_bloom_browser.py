#!/usr/bin/env python3
from __future__ import annotations
import argparse,base64,http.server,json,os,shutil,signal,socket,socketserver,subprocess,tempfile,threading,time,urllib.request
from pathlib import Path
import websocket
ROOT=Path(__file__).resolve().parents[1];BROWSERS=('google-chrome','google-chrome-stable','chromium','chromium-browser','chrome')
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
    if not smoke.get('ok'):raise RuntimeError(smoke.get('error','SM-305 Dark Bloom page reported failure'))
    checks=smoke.get('checks') or []
    if len(checks)<35:raise RuntimeError(f'insufficient SM-305 browser assertions: {len(checks)}')
    failed=[c for c in checks if not c.get('ok')]
    if failed:raise RuntimeError(f'SM-305 smoke contains failed checks: {failed[:2]}')
    captures=smoke.get('captures') or []
    if [c.get('quality') for c in captures]!=['Low','Medium','High','Ultra']:raise RuntimeError('Dark Bloom quality capture matrix incomplete')
    if any(c.get('maxError',1)>=2e-5 for c in captures):raise RuntimeError('GPU/CPU Dark Bloom reference mismatch present')
    if any(not (0<c.get('peak',0)<1) for c in captures):raise RuntimeError('Dark Bloom peak must remain subordinate to hard-core occlusion')
    if any(c.get('peak',1)>c.get('farStrength',0)+2e-5 for c in captures):raise RuntimeError('Dark Bloom peak exceeded configured residual strength')
    if not (captures[0].get('maxRadiusPixels',0)<captures[-1].get('maxRadiusPixels',0)):raise RuntimeError('quality-dependent radius evidence missing')
    if not (captures[0].get('farStrength',0)<captures[-1].get('farStrength',0)):raise RuntimeError('distance/quality-dependent residual strength evidence missing')
    diag=smoke.get('diagnostics') or {};snap=diag.get('snapshot') or {};sd=snap.get('diagnostics') or {}
    if diag.get('schema')!='steelmoth-webgpu-dark-bloom/v1':raise RuntimeError(f"unexpected diagnostics schema: {diag.get('schema')}")
    if not sd.get('boundedRadius') or not sd.get('depthAwareUpsample'):raise RuntimeError('Dark Bloom bounded/depth-aware contract diagnostics missing')
    if sd.get('temporalAccumulation'):raise RuntimeError('SM-306 temporal history leaked into SM-305 baseline')
    rb=smoke.get('readback') or {}
    if not rb.get('noCoreZero') or rb.get('depthBarrierLeak')!=0 or not rb.get('hardOwnershipPreserved'):raise RuntimeError('no-core/depth-barrier/hard-ownership evidence incomplete')
    binsup=smoke.get('binsup') or {}
    if binsup.get('fixture')!='binsup' or binsup.get('automatedResidualPixels',0)<=0 or not binsup.get('hardOwnershipPreserved'):raise RuntimeError('binsup residual evidence missing')
    if binsup.get('humanVisualReviewClaimed'):raise RuntimeError('hosted CI must not claim human visual review')
    timing=smoke.get('timing') or {}
    if timing.get('gpuTimingClaimed'):raise RuntimeError('hosted SM-305 gate must not mislabel wall timing as target-GPU evidence')
    if len(timing.get('submitWallMs') or [])!=4:raise RuntimeError('per-quality hosted dispatch wall-time diagnostics missing')
    if require_webgpu:
        if rb.get('format')!='r32float' or rb.get('pixelCount',0)<=0 or rb.get('gpuCpuTolerance')!=2e-5:raise RuntimeError('required real-WebGPU Dark Bloom readback evidence missing')

def main():
    ap=argparse.ArgumentParser(description='Real-browser WebGPU Dark Bloom validation for SM-305.');ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-dark-bloom-browser.json'));ap.add_argument('--timeout',type=float,default=220);ap.add_argument('--require-webgpu',action='store_true');args=ap.parse_args()
    exe=browser();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True);shot=path.with_suffix('.png');report={'schema':'steelmoth-webgpu-dark-bloom-browser-report/v1','ok':False,'browserExecutable':exe,'requireWebGPU':args.require_webgpu,'screenshot':str(shot.relative_to(ROOT) if shot.is_relative_to(ROOT) else shot),'evidenceBoundary':'Real hosted WebGPU validates SM-305 reduced-resolution bounded Dark Bloom WGSL execution, r32float GPU/CPU readback parity, Low/Medium/High/Ultra radius and strength controls, exact no-core zero behavior, hard-core preservation, depth-discontinuity rejection and the binsup residual contract. The screenshot is retained for later human review. Hosted CI wall time is diagnostic only and is not GTX 1650 Super GPU timing evidence. Temporal accumulation remains deferred to SM-306.'}
    if not exe:report['error']='Chrome/Chromium executable not found';path.write_text(json.dumps(report,indent=2)+'\n');return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-sm305-chrome-') as profile:
            debug=free_port();url=f'http://127.0.0.1:{port}/webgpu-dark-bloom-smoke.html';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}',url]
            proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    target=next((t for t in json_get(f'http://127.0.0.1:{debug}/json/list') if t.get('type')=='page' and 'webgpu-dark-bloom-smoke.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools SM-305 page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(50,min(170,args.timeout*.8)));cdp.call('Runtime.enable');cdp.call('Page.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            while time.monotonic()<deadline:
                if cdp.eval("document.body && document.body.dataset.webgpuDarkBloomDone==='1'"):break
                time.sleep(.2)
            else:raise RuntimeError('SM-305 Dark Bloom page did not publish before timeout')
            text=cdp.eval("document.getElementById('webgpuDarkBloomResult')?.textContent || ''")
            if not text:raise RuntimeError('webgpuDarkBloomResult missing after readiness signal')
            smoke=json.loads(text);report['smoke']=smoke;report['browserCommand']=cmd[:-1]+['<local-sm305-url>'];validate(smoke,args.require_webgpu);png=cdp.call('Page.captureScreenshot',{'format':'png','fromSurface':True}).get('data','')
            if not png:raise RuntimeError('SM-305 debug screenshot capture returned no data')
            shot.write_bytes(base64.b64decode(png));report['screenshotBytes']=shot.stat().st_size;report['ok']=True
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
    path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');smoke=report.get('smoke') or {};print(f"SM-305 WEBGPU DARK BLOOM {'PASS' if report['ok'] else 'FAIL'}: browser={exe} checks={len(smoke.get('checks') or [])}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
