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
    if not smoke.get('ok'):raise RuntimeError(smoke.get('error','SM-400 water page reported failure'))
    checks=smoke.get('checks') or []
    if len(checks)<20:raise RuntimeError(f'insufficient SM-400 browser assertions: {len(checks)}')
    failed=[c for c in checks if not c.get('ok')]
    if failed:raise RuntimeError(f'SM-400 smoke contains failed checks: {failed[:2]}')
    caps={c.get('label'):c for c in (smoke.get('captures') or [])};required={'eight-angle','dark-scene','depth-refraction','shadow-visibility','ripple','room-transition','diagnostics'}
    if not required.issubset(caps):raise RuntimeError(f'water capture matrix incomplete: {sorted(caps)}')
    angles=caps['eight-angle'].get('rows') or []
    if len(angles)!=8 or max((r.get('err',1) for r in angles),default=1)>=.012:raise RuntimeError('eight-angle real-WebGPU canonical-light matrix incomplete or mismatched')
    if caps['eight-angle'].get('spread',0)<=.0005:raise RuntimeError('water highlight did not respond to canonical light direction')
    dark=caps['dark-scene'].get('pixel') or [1]
    if max(map(abs,dark))>=.002:raise RuntimeError('water self-lit dark-scene regression')
    room=caps['room-transition']
    if not room.get('staleRejected') or room.get('roomDelta',0)<=.02:raise RuntimeError('water room-transition stale-state/resolved-scene contract failed')
    if caps['ripple'].get('rippleDelta',0)<=1e-5:raise RuntimeError('water ripple identity was not observable on the real GPU')
    rb=smoke.get('readback') or {}
    for key in ('eightAngles','darkNoGlow','depthAware','shadowVisibility','rippleIdentity','roomTransition','realWebGPU'):
        if not rb.get(key):raise RuntimeError(f'missing SM-400 readback evidence: {key}')
    diag=smoke.get('diagnostics') or {}
    if diag.get('schema')!='steelmoth-webgpu-water/v1' or diag.get('canonicalLightBuffer')!='sm204:lights':raise RuntimeError('water diagnostics do not identify canonical SM-204 state')
    snap=diag.get('snapshot') or {};inputs=snap.get('inputs') or {}
    if not all(inputs.get(k) for k in ('resolvedScene','canonicalDepth','shadowVisibility')):raise RuntimeError('water diagnostics missing canonical scene/depth/visibility inputs')
    if (smoke.get('timing') or {}).get('gpuTimingClaimed'):raise RuntimeError('hosted SM-400 gate must not claim target-GPU timing')
    if require_webgpu and not rb.get('realWebGPU'):raise RuntimeError('required real-WebGPU water evidence missing')

def main():
    ap=argparse.ArgumentParser(description='Real-browser WebGPU canonical water validation for SM-400.');ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-water-browser.json'));ap.add_argument('--timeout',type=float,default=240);ap.add_argument('--require-webgpu',action='store_true');args=ap.parse_args()
    exe=browser();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True);shot=path.with_suffix('.png');report={'schema':'steelmoth-webgpu-water-browser-report/v1','ok':False,'browserExecutable':exe,'requireWebGPU':args.require_webgpu,'screenshot':str(shot.relative_to(ROOT) if shot.is_relative_to(ROOT) else shot),'evidenceBoundary':'Hosted real WebGPU validates SM-400 shader/pipeline execution, canonical SM-204 light direction/ABI, dark-water behavior, canonical depth/refraction sampling, SM-307 visibility consumption, bounded ripples, and stale-room rejection. Screenshot retained for later human review. No GTX 1650 Super timing claim is made.'}
    if not exe:report['error']='Chrome/Chromium executable not found';path.write_text(json.dumps(report,indent=2)+'\n');return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-sm400-chrome-') as profile:
            debug=free_port();url=f'http://127.0.0.1:{port}/webgpu-water-smoke.html';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}',url]
            proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    target=next((t for t in json_get(f'http://127.0.0.1:{debug}/json/list') if t.get('type')=='page' and 'webgpu-water-smoke.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools SM-400 page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(50,min(180,args.timeout*.8)));cdp.call('Runtime.enable');cdp.call('Page.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            while time.monotonic()<deadline:
                if cdp.eval("document.body && document.body.dataset.webgpuWaterDone==='1'"):break
                time.sleep(.2)
            else:raise RuntimeError('SM-400 water page did not publish before timeout')
            text=cdp.eval("document.getElementById('webgpuWaterResult')?.textContent || ''")
            if not text:raise RuntimeError('webgpuWaterResult missing after readiness signal')
            smoke=json.loads(text);report['smoke']=smoke;report['browserCommand']=cmd[:-1]+['<local-sm400-url>'];validate(smoke,args.require_webgpu);png=cdp.call('Page.captureScreenshot',{'format':'png','fromSurface':True}).get('data','')
            if not png:raise RuntimeError('SM-400 debug screenshot capture returned no data')
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
    path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');smoke=report.get('smoke') or {};print(f"SM-400 WEBGPU WATER {'PASS' if report['ok'] else 'FAIL'}: browser={exe} checks={len(smoke.get('checks') or [])}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
