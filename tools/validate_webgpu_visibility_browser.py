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
    if not smoke.get('ok'):raise RuntimeError(smoke.get('error','SM-307 visibility page reported failure'))
    checks=smoke.get('checks') or []
    if len(checks)<28:raise RuntimeError(f'insufficient SM-307 browser assertions: {len(checks)}')
    failed=[c for c in checks if not c.get('ok')]
    if failed:raise RuntimeError(f'SM-307 smoke contains failed checks: {failed[:2]}')
    captures={c.get('label'):c for c in (smoke.get('captures') or [])}
    required={'dense-control','toggle-matrix','debug-matrix','moving-light-a','moving-light-b','gtao-reserved'}
    if not required.issubset(captures):raise RuntimeError(f'visibility capture matrix incomplete: {sorted(captures)}')
    dense=captures['dense-control'];metrics=dense.get('denseMetrics') or {}
    if metrics.get('min',0)<.119 or metrics.get('belowTenPercent')!=0:raise RuntimeError('dense visibility readability bound failed')
    if max(dense.get('errors') or [1])>=.0015:raise RuntimeError('dense GPU/CPU visibility mismatch')
    toggles=(captures['toggle-matrix'].get('terms') or {})
    if set(toggles)!={'dso','selfShadow','contactShadow','darkBloom','materialAO','gtao'}:raise RuntimeError('term toggle matrix incomplete')
    if any((v or {}).get('err',1)>=.0015 for v in toggles.values()):raise RuntimeError('term toggle GPU/CPU mismatch')
    debug=captures['debug-matrix'].get('debugErrors') or {}
    required_debug={'combined','direct','ambient','dso','self-shadow','contact-shadow','dark-bloom','material-ao','gtao','macro','local'}
    if set(debug)!=required_debug or max(debug.values(),default=1)>=2e-5:raise RuntimeError('individual/combined debug view matrix incomplete or mismatched')
    if captures['moving-light-b'].get('motionRms',0)<=.005:raise RuntimeError('moving-input capture did not change current visibility field')
    gtao=captures['gtao-reserved']
    if not gtao.get('missingRejected') or 'reserved input only' not in (gtao.get('interface') or {}).get('ownership',''):raise RuntimeError('reserved GTAO consumer contract missing')
    rb=smoke.get('readback') or {}
    for key in ('denseReadable','termToggleMatrix','debugMatrix','movingInputCurrentFrame','gtaoReserved'):
        if not rb.get(key):raise RuntimeError(f'missing SM-307 readback evidence: {key}')
    diag=smoke.get('diagnostics') or {};snap=diag.get('snapshot') or {}
    if diag.get('schema')!='steelmoth-webgpu-visibility/v1':raise RuntimeError(f"unexpected diagnostics schema: {diag.get('schema')}")
    if 'no independent term multiplication' not in snap.get('composition',''):raise RuntimeError('bounded composition rationale missing from diagnostics')
    if len(diag.get('debugModes') or [])!=11:raise RuntimeError('debug mode diagnostics incomplete')
    timing=smoke.get('timing') or {}
    if timing.get('gpuTimingClaimed'):raise RuntimeError('hosted SM-307 gate must not mislabel wall timing as target-GPU evidence')
    if require_webgpu:
        if rb.get('format')!='rgba16float' or rb.get('debugFormat')!='r32float' or rb.get('pixelCount',0)<=0:raise RuntimeError('required real-WebGPU SM-307 readback evidence missing')

def main():
    ap=argparse.ArgumentParser(description='Real-browser WebGPU bounded visibility validation for SM-307.');ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-visibility-browser.json'));ap.add_argument('--timeout',type=float,default=240);ap.add_argument('--require-webgpu',action='store_true');args=ap.parse_args()
    exe=browser();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True);shot=path.with_suffix('.png');report={'schema':'steelmoth-webgpu-visibility-browser-report/v1','ok':False,'browserExecutable':exe,'requireWebGPU':args.require_webgpu,'screenshot':str(shot.relative_to(ROOT) if shot.is_relative_to(ROOT) else shot),'evidenceBoundary':'Real hosted WebGPU validates SM-307 bounded visibility formula, dense-scene readability floors, term toggles, individual/combined debug views, current-frame moving-input response and the reserved GTAO consumer interface. The screenshot is retained for later human review. Hosted CI wall time is diagnostic only and is not GTX 1650 Super timing evidence.'}
    if not exe:report['error']='Chrome/Chromium executable not found';path.write_text(json.dumps(report,indent=2)+'\n');return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-sm307-chrome-') as profile:
            debug=free_port();url=f'http://127.0.0.1:{port}/webgpu-visibility-smoke.html';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}',url]
            proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    target=next((t for t in json_get(f'http://127.0.0.1:{debug}/json/list') if t.get('type')=='page' and 'webgpu-visibility-smoke.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools SM-307 page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(50,min(180,args.timeout*.8)));cdp.call('Runtime.enable');cdp.call('Page.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            while time.monotonic()<deadline:
                if cdp.eval("document.body && document.body.dataset.webgpuVisibilityDone==='1'"):break
                time.sleep(.2)
            else:raise RuntimeError('SM-307 visibility page did not publish before timeout')
            text=cdp.eval("document.getElementById('webgpuVisibilityResult')?.textContent || ''")
            if not text:raise RuntimeError('webgpuVisibilityResult missing after readiness signal')
            smoke=json.loads(text);report['smoke']=smoke;report['browserCommand']=cmd[:-1]+['<local-sm307-url>'];validate(smoke,args.require_webgpu);png=cdp.call('Page.captureScreenshot',{'format':'png','fromSurface':True}).get('data','')
            if not png:raise RuntimeError('SM-307 debug screenshot capture returned no data')
            shot.write_bytes(base64.b64decode(png));report['screenshotBytes']=shot.stat().st_size;report['ok']=True
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
    path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');smoke=report.get('smoke') or {};print(f"SM-307 WEBGPU VISIBILITY {'PASS' if report['ok'] else 'FAIL'}: browser={exe} checks={len(smoke.get('checks') or [])}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
