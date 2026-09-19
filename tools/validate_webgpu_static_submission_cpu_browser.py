#!/usr/bin/env python3
from __future__ import annotations
import argparse, functools, json, threading, time
from pathlib import Path
from validate_webgpu_cross_browser import Quiet, Server, browser_metadata, make_driver

ROOT=Path(__file__).resolve().parents[1]

def wait_cpu(driver,timeout):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        done=driver.execute_script("return document.body?.dataset?.sm801CpuDone==='1'")
        if done:
            raw=driver.execute_script("return document.getElementById('sm801CpuResult')?.textContent||''")
            return json.loads(raw)
        time.sleep(.1)
    raise TimeoutError(f'SM-801 CPU page did not finish within {timeout}s')

def run_browser(name,base,timeout):
    out={'browser':name,'ok':False};driver=None;started=time.monotonic()
    try:
        driver=make_driver(name,'hosted-ci');driver.set_page_load_timeout(max(30,timeout));driver.set_script_timeout(max(30,timeout));out['environment']=browser_metadata(driver,name,'hosted-ci');driver.get(f'{base}/webgpu-static-submission-cpu-smoke.html');payload=wait_cpu(driver,timeout);out['result']=payload;out['durationSeconds']=round(time.monotonic()-started,3)
        if not payload.get('ok'): raise RuntimeError(str(payload.get('error') or 'SM-801 CPU page reported ok=false'))
        for workload in ('representative','dense'):
            agg=((payload.get('workloads') or {}).get(workload) or {}).get('aggregate') or {};base_p=(agg.get('baseline') or {}).get('p50Ms');bundle_p=(agg.get('bundle') or {}).get('p50Ms')
            if not isinstance(base_p,(int,float)) or base_p<=0 or not isinstance(bundle_p,(int,float)) or bundle_p<0: raise RuntimeError(f'{workload} CPU p50 is not measurable: {agg}')
        out['ok']=True
    except Exception as exc: out['durationSeconds']=round(time.monotonic()-started,3);out['failure']=str(exc)
    finally:
        if driver:
            try: driver.quit()
            except Exception: pass
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--timeout',type=float,default=180);ap.add_argument('--report',type=Path,default=Path('artifacts/sm801/cpu-encode-report.json'));args=ap.parse_args();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True)
    server=Server(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT),inject_hosted_firefox_fallback=False));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_address[1]}'
    payload={'schema':'steelmoth-sm801-cpu-report/v1','ok':False,'evidenceBoundary':'CPU command-encoding and render-bundle rebuild cost only. Encoded command buffers are not submitted during timed samples; no GPU-time claim is derived from these values.','browsers':[]}
    try: payload['browsers']=[run_browser('chrome',base,args.timeout),run_browser('firefox',base,args.timeout)];payload['ok']=all(x.get('ok') for x in payload['browsers'])
    finally: server.shutdown();server.server_close()
    path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8');print(f"SM-801 CPU {'PASS' if payload['ok'] else 'FAIL'}: {path}");return 0 if payload['ok'] else 1
if __name__=='__main__': raise SystemExit(main())
