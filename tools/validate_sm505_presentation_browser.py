#!/usr/bin/env python3
from __future__ import annotations
import argparse,base64,http.server,json,os,shutil,signal,socket,socketserver,subprocess,tempfile,threading,time,urllib.request
from pathlib import Path
import websocket

ROOT=Path(__file__).resolve().parents[1]
BROWSERS=('google-chrome','google-chrome-stable','chromium','chromium-browser','chrome')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
class Server(socketserver.ThreadingMixIn,http.server.HTTPServer):daemon_threads=True
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
    def __init__(self,url,timeout=120):self.ws=websocket.create_connection(url,timeout=timeout,origin='http://127.0.0.1');self.seq=0
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

def wait(cdp,expr,deadline,label):
    while time.monotonic()<deadline:
        try:
            if cdp.eval(expr):return
        except Exception:pass
        time.sleep(.2)
    raise RuntimeError(f'timed out waiting for {label}')

def main():
    ap=argparse.ArgumentParser(description='SM-505 normal-game WebGPU presentation validation on hosted/software WebGPU.')
    ap.add_argument('--report',type=Path,default=Path('artifacts/sm505-presentation-browser.json'))
    ap.add_argument('--timeout',type=float,default=240)
    ap.add_argument('--require-webgpu',action='store_true')
    args=ap.parse_args();exe=browser();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True);shot=path.with_suffix('.png')
    report={'schema':'steelmoth-sm505-presentation-browser/v1','ok':False,'browserExecutable':exe,'requireWebGPU':args.require_webgpu,'evidenceBoundary':'Hosted/software WebGPU validates normal-application RenderScene consumption, truthful presentation ownership and compatibility fallback. It is not GTX 1650 SUPER timing or physical browser acceptance.'}
    if not exe:report['error']='Chrome/Chromium executable not found';path.write_text(json.dumps(report,indent=2)+'\n');return 1
    handler=lambda *a,**k:Quiet(*a,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-sm505-chrome-') as profile:
            debug=free_port();url=f'http://127.0.0.1:{port}/index.html?rendererBackend=webgpu&renderTest=1';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}',url]
            proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+args.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:
                    target=next((t for t in json_get(f'http://127.0.0.1:{debug}/json/list') if t.get('type')=='page' and 'index.html' in t.get('url','')),None)
                    if target:break
                except Exception:pass
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools SM-505 page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(60,min(180,args.timeout*.8)));cdp.call('Runtime.enable');cdp.call('Page.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            wait(cdp,"document.body?.dataset.ready==='1' && !!window.game && !!window.steelMothBackendRuntime",deadline,'normal game/runtime startup')
            wait(cdp,"steelMothBackendRuntime.presentationBackend==='webgpu' && (steelMothBackendRuntime.presenter?.presentedFrames||0)>=2",deadline,'WebGPU normal-game presentation')
            before=cdp.eval("""(()=>{const r=steelMothBackendRuntime,d=r.diagnostics(),p=d.webgpuPresenter,s=game.renderScene;return{requested:d.requestedBackend,active:d.activeBackend,presentation:d.presentationBackend,status:d.status,autoWebGPUEnabled:d.autoWebGPUEnabled,presenter:p,sceneSchema:s?.schema||null,sceneSequence:s?.frame?.sequence??null,canvasId:document.querySelector('#webgpuPresentation')?.id||null,canvasCount:document.querySelectorAll('#webgpuPresentation').length,gtaoEnabled:p?.gtaoEnabled,bridgeInstalled:!!game.renderSceneBridge}})()""")
            if before.get('requested')!='webgpu' or before.get('active')!='webgpu' or before.get('presentation')!='webgpu':raise RuntimeError(f'WebGPU ownership diagnostics false: {before}')
            if before.get('canvasId')!='webgpuPresentation' or before.get('canvasCount')!=1:raise RuntimeError(f'presentation canvas ownership invalid: {before}')
            if before.get('sceneSchema')!='steelmoth-render-scene/v1' or not before.get('bridgeInstalled'):raise RuntimeError(f'normal RenderScene bridge missing: {before}')
            if before.get('gtaoEnabled') is not False:raise RuntimeError('SM-505 candidate unexpectedly enabled GTAO')
            if before.get('autoWebGPUEnabled') is not False:raise RuntimeError('normal Auto gate was promoted before physical acceptance')
            seq=before.get('sceneSequence')
            fallback=cdp.eval("""(()=>{const r=steelMothBackendRuntime,p=r.presenter;r._presenterFailed(p,new Error('sm505-hosted-fallback-probe'));return r.diagnostics()})()""")
            if fallback.get('activeBackend')!='webgl2' or fallback.get('presentationBackend')!='webgl2' or fallback.get('status')!='fallback-runtime':raise RuntimeError(f'runtime fallback left mixed backend state: {fallback}')
            if cdp.eval("document.querySelectorAll('#webgpuPresentation').length")!=0:raise RuntimeError('fallback retained stale WebGPU presentation canvas')
            wait(cdp,f"(game.renderScene?.frame?.sequence??-1)>{int(seq or -1)}",deadline,'WebGL2 frame after fallback')
            cdp.eval("steelMothBackendRuntime.select('webgpu',{persist:false})")
            wait(cdp,"steelMothBackendRuntime.presentationBackend==='webgpu' && (steelMothBackendRuntime.presenter?.presentedFrames||0)>=1",deadline,'WebGPU re-selection after fallback')
            reselected=cdp.eval("steelMothBackendRuntime.diagnostics()")
            if reselected.get('presentationBackend')!='webgpu' or cdp.eval("document.querySelectorAll('#webgpuPresentation').length")!=1:raise RuntimeError('backend re-selection did not build one fresh presenter')
            cdp.eval("steelMothBackendRuntime.select('webgl2',{persist:false})")
            wait(cdp,"steelMothBackendRuntime.presentationBackend==='webgl2' && steelMothBackendRuntime.activeBackend==='webgl2'",deadline,'explicit WebGL2 switch')
            if cdp.eval("document.querySelectorAll('#webgpuPresentation').length")!=0:raise RuntimeError('explicit WebGL2 switch retained stale WebGPU canvas')
            report.update({'beforeFallback':before,'fallback':fallback,'reselected':reselected,'final':cdp.eval("steelMothBackendRuntime.diagnostics()")})
            png=cdp.call('Page.captureScreenshot',{'format':'png','fromSurface':True}).get('data','')
            if png:shot.write_bytes(base64.b64decode(png));report['screenshotBytes']=shot.stat().st_size
            report['browserCommand']=cmd[:-1]+['<local-sm505-url>'];report['ok']=True
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
                tail=proc.stderr.read()[-8000:]
                if tail and not report['ok']:report['browserStderrTail']=tail
            except Exception:pass
        srv.shutdown();srv.server_close()
    path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    print(f"SM-505 PRESENTATION BROWSER {'PASS' if report['ok'] else 'FAIL'}: browser={exe}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
