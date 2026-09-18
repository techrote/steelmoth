#!/usr/bin/env python3
from __future__ import annotations
import argparse,http.server,json,os,shutil,signal,socket,socketserver,subprocess,tempfile,threading,time,urllib.parse,urllib.request
from pathlib import Path
from PIL import Image
import websocket
ROOT=Path(__file__).resolve().parents[1];BROWSERS=('google-chrome','google-chrome-stable','chromium','chromium-browser','chrome')
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
def raw_material_controls()->dict:
    atlas=json.loads((ROOT/'assets/generated/atlas.json').read_text(encoding='utf-8'))
    albedo=Image.open(ROOT/atlas['image']).convert('RGBA');nr=Image.open(ROOT/atlas['material_normal_roughness_image']).convert('RGBA');hm=Image.open(ROOT/atlas['material_height_image']).convert('RGBA')
    out={}
    for name in ('cargo_crate','rust_barrel','server_cabinet','hex_maintenance_idle_0'):
        r=atlas['regions'].get(name)
        if not r:raise RuntimeError(f'missing SM-204 control region: {name}')
        x0,y0,w,h=map(int,r[:4]);best=None
        for y in range(h):
            for x in range(w):
                a=list(albedo.getpixel((x0+x,y0+y)))
                if a[3]<220:continue
                n=list(nr.getpixel((x0+x,y0+y)));m=list(hm.getpixel((x0+x,y0+y)))
                center=((x-(w-1)/2)**2+(y-(h-1)/2)**2)**.5
                score=abs(n[0]-128)+abs(n[1]-128)+abs(n[2]-255)*.15+abs(n[3]-128)*.08+abs(m[0]-128)*.06+abs(m[2]-128)*.05-center*.01
                if best is None or score>best[0]:best=(score,x,y,a,n,m)
        if best is None:raise RuntimeError(f'no opaque SM-204 validation pixel in {name}')
        _,x,y,a,n,m=best;out[name]={'x':x,'y':y,'albedo':a,'normalRoughness':n,'heightMaterial':m}
    return out
class CDP:
    def __init__(self,url,timeout=55):self.ws=websocket.create_connection(url,timeout=timeout,origin='http://127.0.0.1');self.seq=0
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
    if not smoke.get('ok'):raise RuntimeError(smoke.get('error','SM-204 lighting page reported failure'))
    diag=smoke.get('diagnostics') or {}
    if diag.get('schema')!='steelmoth-webgpu-lighting/v1':raise RuntimeError(f"unexpected lighting schema: {diag.get('schema')}")
    if diag.get('lightCount')!=3:raise RuntimeError(f"expected three canonical mixed lights, got {diag.get('lightCount')}")
    if diag.get('lightBufferBytes')!=diag.get('maxLights')*diag.get('lightStride'):raise RuntimeError('canonical light-buffer byte accounting mismatch')
    if set(diag.get('debugModes') or [])!={'final','diffuse','specular','light-count'}:raise RuntimeError(f"debug modes incomplete: {diag.get('debugModes')}")
    if len(smoke.get('angles') or [])!=8:raise RuntimeError('eight-angle parity control incomplete')
    required={'cargo_crate','rust_barrel','server_cabinet','hex_maintenance_idle_0'}
    if not required<=set(smoke.get('materialControls') or {}):raise RuntimeError(f"missing real material lighting controls: {sorted(required-set(smoke.get('materialControls') or {}))}")
    if len(smoke.get('checks') or [])<40:raise RuntimeError(f"insufficient lighting assertions: {len(smoke.get('checks') or [])}")
    if not all((c.get('ok') for c in smoke.get('checks') or [])):raise RuntimeError('one or more SM-204 browser assertions failed')
    if require_webgpu and not diag:raise RuntimeError('real WebGPU lighting diagnostics missing')
def main():
    ap=argparse.ArgumentParser(description='Real-browser canonical WebGPU light-buffer and deferred Material-v2 PBR validation for SM-204.');ap.add_argument('--report',type=Path,default=Path('artifacts/webgpu-lighting-browser.json'));ap.add_argument('--timeout',type=float,default=120);ap.add_argument('--require-webgpu',action='store_true');a=ap.parse_args();exe=browser();path=a.report if a.report.is_absolute() else ROOT/a.report;path.parent.mkdir(parents=True,exist_ok=True);controls=raw_material_controls();report={'schema':'steelmoth-webgpu-lighting-browser-report/v1','ok':False,'browserExecutable':exe,'requireWebGPU':a.require_webgpu,'materialControls':controls,'materialControlSource':'raw generated Material-v2 PNG bytes decoded by Pillow; avoids browser premultiplication of emissive-alpha material data','evidenceBoundary':'Real hosted WebGPU canonical-light buffer, eight-angle deferred Material-v2 PBR, real crate/barrel/cabinet/robot material controls, normal-axis and debug readback correctness. Not target-GPU performance, DSO/self/contact shadow parity, procedural integration, or final product visual approval.'}
    if not exe:report['error']='Chrome/Chromium executable not found';path.write_text(json.dumps(report,indent=2)+'\n');return 1
    handler=lambda *x,**k:Quiet(*x,directory=str(ROOT),**k);srv=Server(('127.0.0.1',0),handler);threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];proc=None;cdp=None
    try:
        with tempfile.TemporaryDirectory(prefix='steelmoth-sm204-chrome-') as profile:
            debug=free_port();query=urllib.parse.urlencode({'controls':json.dumps(controls,separators=(',',':'))});url=f'http://127.0.0.1:{port}/webgpu-lighting-smoke.html?{query}';cmd=[exe,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run','--enable-webgl','--enable-unsafe-webgpu','--remote-allow-origins=*',f'--remote-debugging-port={debug}',f'--user-data-dir={profile}',url];proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True);deadline=time.monotonic()+a.timeout;target=None
            while time.monotonic()<deadline and proc.poll() is None:
                try:target=next((t for t in json_get(f'http://127.0.0.1:{debug}/json/list') if t.get('type')=='page' and 'webgpu-lighting-smoke.html' in t.get('url','')),None)
                except Exception:pass
                if target:break
                time.sleep(.15)
            if not target:raise RuntimeError('Chrome DevTools SM-204 page target did not become available')
            cdp=CDP(target['webSocketDebuggerUrl'],timeout=max(25,min(80,a.timeout*.75)));cdp.call('Runtime.enable');report['browserVersion']=cdp.call('Browser.getVersion')
            while time.monotonic()<deadline:
                if cdp.eval("document.body && document.body.dataset.webgpuLightingDone==='1'"):break
                time.sleep(.15)
            else:raise RuntimeError('SM-204 lighting page did not publish before timeout')
            text=cdp.eval("document.getElementById('webgpuLightingResult')?.textContent || ''")
            if not text:raise RuntimeError('webgpuLightingResult missing after readiness signal')
            smoke=json.loads(text);report['smoke']=smoke;report['browserCommand']=cmd[:-1]+['<local-sm204-url-with-raw-material-controls>'];validate(smoke,a.require_webgpu);report['ok']=True
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
                tail=proc.stderr.read()[-5000:]
                if tail and not report['ok']:report['browserStderrTail']=tail
            except Exception:pass
        srv.shutdown();srv.server_close()
    path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8');smoke=report.get('smoke') or {};print(f"SM-204 WEBGPU LIGHTING {'PASS' if report['ok'] else 'FAIL'}: browser={exe} checks={len(smoke.get('checks') or [])} angles={len(smoke.get('angles') or [])} controls={len(smoke.get('materialControls') or {})}")
    if not report['ok']:print('ERROR:',report.get('error','unknown'))
    return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
