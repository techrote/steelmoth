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
    if not smoke.get('ok'):raise RuntimeError(smoke.get('error','SM-303 DSO page reported failure'))
    checks=smoke.get('checks') or []
    if len(checks)<80:raise RuntimeError(f'insufficient SM-303 browser assertions: {len(checks)}')
    failed=[c for c in checks if not c.get('ok')]
    if failed:raise RuntimeError(f'SM-303 smoke contains failed checks: {failed[:2]}')
    captures=smoke.get('captures') or []
    if len(captures)!=16:raise RuntimeError(f'expected 16 box/bin eight-angle captures, got {len(captures)}')
    if {c.get('angle') for c in captures}!={0,45,90,135,180,225,270,315}:raise RuntimeError('eight-angle DSO capture set incomplete')
    if {c.get('fixture') for c in captures}!={'box','bins'}:raise RuntimeError('box/bin DSO captures incomplete')
    if any(c.get('mismatchPixels')!=0 for c in captures):raise RuntimeError('GPU/CPU DSO mask mismatch present in capture evidence')
    structural=smoke.get('structural') or {};dso=structural.get('dso') or {};base=structural.get('independentBaseline') or {}
    if not (base.get('disconnectedIslandCount',0)>dso.get('disconnectedIslandCount',999)):raise RuntimeError('DSO disconnected-island reduction evidence missing')
    if not (base.get('totalSmallIslandArea',0)>dso.get('totalSmallIslandArea',999999)):raise RuntimeError('DSO small-island-area reduction evidence missing')
    if not (base.get('silhouetteEdgeLength',0)>dso.get('silhouetteEdgeLength',999999)):raise RuntimeError('DSO structural edge reduction evidence missing')
    if structural.get('secondaryFullStrengthWedges')!=0:raise RuntimeError('secondary members emitted full-strength macro wedges')
    sweep=smoke.get('sweep') or []
    if len(sweep)!=5 or len({x.get('owner') for x in sweep})!=1:raise RuntimeError('moving-light owner-stability evidence incomplete')
    diag=smoke.get('diagnostics') or {}
    if diag.get('schema')!='steelmoth-webgpu-dso/v1':raise RuntimeError(f"unexpected diagnostics schema: {diag.get('schema')}")
    snap=diag.get('snapshot') or {}
    if not snap.get('onePrimaryWedgePerCluster') or not snap.get('secondaryContributionBounded'):raise RuntimeError('DSO primary/secondary contract diagnostics missing')
    if snap.get('distanceSimplification') or snap.get('darkBloom') or snap.get('temporalAccumulation'):raise RuntimeError('later shadow stages leaked into SM-303')
    if require_webgpu:
        rb=smoke.get('readback') or {}
        if not rb.get('gpuCpuExact') or rb.get('format')!='r32float' or rb.get('pixelCount',0)<=0:raise RuntimeError('required real-WebGPU hard-mask readback evidence missing')
def main():
    ap=argparse.ArgumentParser(description='Real-browser WebGPU DSO hard-core validation for SM-303.');ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-dso-browser.json'));ap.add_argument('--timeout',type=float,default=220);ap.add_argument('--require-webgpu',action='store_true');args=ap.parse_args()
    exe=browser();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True);shot=path.with_suffix('.png');report={'schema':'steelmoth-webgpu-dso-browser-report/v1','ok':False,'browserExecutable':exe,'requireWebGPU':args.require_webgpu,'screenshot':str(shot.relative_to(ROOT) if shot.is_relative_to(ROOT) else shot),'evidenceBoundary':'Real hosted WebGPU validates SM-303 tile-local DSO hard-core WGSL execution, exact r32float mask readback against the deterministic CPU structural reference, box/bin eight-angle hard-mask captures, dominant-owner-only long wedges, bounded secondary structure, structural island metrics, invalidation and moving-light ownership stability. It does not validate SM-304 distance simplification, SM-305 Dark Bloom, SM-306 temporal accumulation, final shadow composition, target-GPU performance or human visual quality.'}
    if not exe:report['error']='Chrome/Chromium executable not found';path.write_text(json.dumps(report,indent=2)+'\n');return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-sm303-chrome-') as profile:
            debug=free_port();url=f'http://127.0.0.1:{port}/webgpu-dso-smoke.html';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}',url]
            proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    target=next((t for t in json_get(f'http://127.0.0.1:{debug}/json/list') if t.get('type')=='page' and 'webgpu-dso-smoke.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools SM-303 page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(50,min(170,args.timeout*.8)));cdp.call('Runtime.enable');cdp.call('Page.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            while time.monotonic()<deadline:
                if cdp.eval("document.body && document.body.dataset.webgpuDsoDone==='1'"):break
                time.sleep(.2)
            else:raise RuntimeError('SM-303 DSO page did not publish before timeout')
            text=cdp.eval("document.getElementById('webgpuDSOResult')?.textContent || ''")
            if not text:raise RuntimeError('webgpuDSOResult missing after readiness signal')
            smoke=json.loads(text);report['smoke']=smoke;report['browserCommand']=cmd[:-1]+['<local-sm303-url>'];validate(smoke,args.require_webgpu);png=cdp.call('Page.captureScreenshot',{'format':'png','fromSurface':True}).get('data','')
            if not png:raise RuntimeError('SM-303 debug screenshot capture returned no data')
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
    path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');smoke=report.get('smoke') or {};print(f"SM-303 WEBGPU DSO {'PASS' if report['ok'] else 'FAIL'}: browser={exe} checks={len(smoke.get('checks') or [])}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
