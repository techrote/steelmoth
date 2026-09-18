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
    if not smoke.get('ok'):raise RuntimeError(smoke.get('error','SM-306 temporal page reported failure'))
    checks=smoke.get('checks') or []
    if len(checks)<34:raise RuntimeError(f'insufficient SM-306 browser assertions: {len(checks)}')
    failed=[c for c in checks if not c.get('ok')]
    if failed:raise RuntimeError(f'SM-306 smoke contains failed checks: {failed[:2]}')
    captures={c.get('label'):c for c in (smoke.get('captures') or [])}
    required={'slow-light','light-teleport','cluster-move','editor-delete','resize-rebuild'}
    if not required.issubset(captures):raise RuntimeError(f'temporal capture matrix incomplete: {sorted(captures)}')
    slow=captures['slow-light']
    if slow.get('gpuCpuMaxError',1)>=2e-5:raise RuntimeError('slow-light GPU/CPU temporal reference mismatch')
    if not (slow.get('temporalRms',1)<slow.get('rawRms',0)):raise RuntimeError('slow-light sequence did not demonstrate temporal stabilization')
    if slow.get('acceptedPercent',0)<=90:raise RuntimeError('stable temporal sequence did not accept enough history')
    if captures['light-teleport'].get('acceptedPercent')!=0:raise RuntimeError('light teleport did not fully reject history')
    if not str(captures['light-teleport'].get('resetReason','')).startswith('light-'):raise RuntimeError('light teleport reset reason missing')
    if captures['cluster-move'].get('resetReason')!='cluster-discontinuity':raise RuntimeError('cluster discontinuity reset evidence missing')
    if captures['editor-delete'].get('nonzero')!=0:raise RuntimeError('stale temporal silhouette remained after editor invalidation')
    rb=smoke.get('readback') or {}
    for key in ('slowLightStabilized','hardCoreUnsmooth','teleportRejected','objectRejected','depthRejected','clusterRejected','roomRejected','resizeRejected','noStaleAfterInvalidation'):
        if not rb.get(key):raise RuntimeError(f'missing SM-306 evidence: {key}')
    diag=smoke.get('diagnostics') or {};snap=diag.get('snapshot') or {};sd=snap.get('diagnostics') or {}
    if diag.get('schema')!='steelmoth-webgpu-dark-bloom-temporal/v1':raise RuntimeError(f"unexpected diagnostics schema: {diag.get('schema')}")
    if not sd.get('hardCoreUnsmooth') or not sd.get('neighborhoodClamp') or not sd.get('softHistoryOnly'):raise RuntimeError('temporal scope diagnostics incomplete')
    if sd.get('historyAcceptedPercent') is None or sd.get('historyRejectedPercent') is None:raise RuntimeError('accepted/rejected history percentages not visible')
    timing=smoke.get('timing') or {}
    if timing.get('gpuTimingClaimed'):raise RuntimeError('hosted SM-306 gate must not mislabel wall timing as target-GPU evidence')
    if len(timing.get('submitWallMs') or [])<10:raise RuntimeError('scripted temporal sequence timing diagnostics incomplete')
    if require_webgpu:
        if rb.get('format')!='r32float' or rb.get('pixelCount',0)<=0 or rb.get('gpuCpuTolerance')!=2e-5:raise RuntimeError('required real-WebGPU SM-306 readback evidence missing')

def main():
    ap=argparse.ArgumentParser(description='Real-browser WebGPU Dark Bloom temporal validation for SM-306.');ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-dark-bloom-temporal-browser.json'));ap.add_argument('--timeout',type=float,default=240);ap.add_argument('--require-webgpu',action='store_true');args=ap.parse_args()
    exe=browser();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True);shot=path.with_suffix('.png');report={'schema':'steelmoth-webgpu-dark-bloom-temporal-browser-report/v1','ok':False,'browserExecutable':exe,'requireWebGPU':args.require_webgpu,'screenshot':str(shot.relative_to(ROOT) if shot.is_relative_to(ROOT) else shot),'evidenceBoundary':'Real hosted WebGPU validates SM-306 low-frequency Dark Bloom history only: slow-light stabilization, exact hard-core exclusion, depth/object/cluster/light discontinuity rejection, room/editor/resize invalidation, accepted/rejected history percentages and zero stale silhouettes after reset. The screenshot is retained for later human review. Hosted CI wall time is diagnostic only and is not GTX 1650 Super GPU timing evidence.'}
    if not exe:report['error']='Chrome/Chromium executable not found';path.write_text(json.dumps(report,indent=2)+'\n');return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-sm306-chrome-') as profile:
            debug=free_port();url=f'http://127.0.0.1:{port}/webgpu-dark-bloom-temporal-smoke.html';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}',url]
            proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    target=next((t for t in json_get(f'http://127.0.0.1:{debug}/json/list') if t.get('type')=='page' and 'webgpu-dark-bloom-temporal-smoke.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools SM-306 page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(50,min(180,args.timeout*.8)));cdp.call('Runtime.enable');cdp.call('Page.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            while time.monotonic()<deadline:
                if cdp.eval("document.body && document.body.dataset.webgpuDarkBloomTemporalDone==='1'"):break
                time.sleep(.2)
            else:raise RuntimeError('SM-306 temporal page did not publish before timeout')
            text=cdp.eval("document.getElementById('webgpuDarkBloomTemporalResult')?.textContent || ''")
            if not text:raise RuntimeError('webgpuDarkBloomTemporalResult missing after readiness signal')
            smoke=json.loads(text);report['smoke']=smoke;report['browserCommand']=cmd[:-1]+['<local-sm306-url>'];validate(smoke,args.require_webgpu);png=cdp.call('Page.captureScreenshot',{'format':'png','fromSurface':True}).get('data','')
            if not png:raise RuntimeError('SM-306 debug screenshot capture returned no data')
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
    path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');smoke=report.get('smoke') or {};print(f"SM-306 WEBGPU DARK BLOOM TEMPORAL {'PASS' if report['ok'] else 'FAIL'}: browser={exe} checks={len(smoke.get('checks') or [])}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
