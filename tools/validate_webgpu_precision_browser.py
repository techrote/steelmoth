#!/usr/bin/env python3
from __future__ import annotations
import argparse, functools, json, platform, threading, time, urllib.parse
from pathlib import Path
from validate_webgpu_cross_browser import Quiet, Server, browser_metadata, make_driver, wait_result

ROOT=Path(__file__).resolve().parents[1]
CANDIDATES=("material8","octMaterial8","hdr11","combined")

def run_browser(name,base_url,timeout,out_dir,width,height,warmup,samples):
    report={"browser":name,"ok":False,"environment":None,"failure":None};driver=None;started=time.monotonic()
    try:
        driver=make_driver(name,"hosted-ci");driver.set_page_load_timeout(max(30,timeout));driver.set_script_timeout(max(30,timeout));report["environment"]=browser_metadata(driver,name,"hosted-ci")
        query=urllib.parse.urlencode({"width":width,"height":height,"warmup":warmup,"samples":samples,"browser":name})
        driver.get(f"{base_url}/webgpu-precision-smoke.html?{query}")
        payload=wait_result(driver,timeout)["parsed"];report["result"]=payload;report["durationSeconds"]=round(time.monotonic()-started,3)
        if not payload.get("ok"): raise RuntimeError(str(payload.get("error") or "SM-800 page reported ok=false"))
        if not all((payload.get("layouts") or {}).get(k,{}).get("supported") for k in ("baseline",)+CANDIDATES): raise RuntimeError("SM-800 format-layout matrix incomplete or unsupported")
        numeric=payload.get("numeric") or {}
        if not all((numeric.get(k) or {}).get("pass") for k in ("oct8","material8","hdr11")): raise RuntimeError("SM-800 numeric parity threshold failed")
        shot=out_dir/f"{name}-sm800.png";shot.parent.mkdir(parents=True,exist_ok=True);driver.save_screenshot(str(shot));report["screenshot"]=str(shot.relative_to(ROOT));report["ok"]=True
    except Exception as exc: report["durationSeconds"]=round(time.monotonic()-started,3);report["failure"]=str(exc)
    finally:
        if driver:
            try: driver.quit()
            except Exception: pass
    return report

def ratio(candidate,baseline):
    if not isinstance(candidate,(int,float)) or not isinstance(baseline,(int,float)) or baseline<=0:return None
    return candidate/baseline

def summarize_candidates(browsers):
    out={}
    for candidate in CANDIDATES:
        rows=[]
        for b in browsers:
            r=b.get("result") or {};layouts=r.get("layouts") or {};base=((layouts.get("baseline") or {}).get("summary") or {}).get("p50Ms");cand=((layouts.get(candidate) or {}).get("summary") or {}).get("p50Ms")
            rows.append({"browser":b.get("browser"),"baselineP50Ms":base,"candidateP50Ms":cand,"p50Ratio":ratio(cand,base),"timestampQuery":r.get("timestampQuery"),"supported":(layouts.get(candidate) or {}).get("supported")})
        out[candidate]={"rows":rows,"hostedDecision":"reject" if any((x.get("p50Ratio") or 1)>1.05 for x in rows if x.get("p50Ratio") is not None) else "target-hardware-required"}
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--timeout",type=float,default=180);ap.add_argument("--report",type=Path,default=Path("artifacts/sm800/precision-bandwidth-report.json"));ap.add_argument("--width",type=int,default=960);ap.add_argument("--height",type=int,default=540);ap.add_argument("--warmup",type=int,default=4);ap.add_argument("--samples",type=int,default=16);args=ap.parse_args();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True)
    server=Server(("127.0.0.1",0),functools.partial(Quiet,directory=str(ROOT),inject_hosted_firefox_fallback=False));threading.Thread(target=server.serve_forever,daemon=True).start();base=f"http://127.0.0.1:{server.server_address[1]}"
    payload={"schema":"steelmoth-sm800-browser-report/v1","ok":False,"host":{"system":platform.system(),"release":platform.release(),"python":platform.python_version()},"evidenceBoundary":"Hosted Chrome/Firefox real-WebGPU numeric/readback and format-write microbenchmark evidence only. It is not GTX 1650 SUPER timing and cannot authorize production packing adoption or close SM-800 target-hardware verification.","targetHardwareAcceptance":False,"browsers":[]}
    try:
        out=path.parent/"screenshots";payload["browsers"]=[run_browser("chrome",base,args.timeout,out,args.width,args.height,args.warmup,args.samples),run_browser("firefox",base,args.timeout,out,args.width,args.height,args.warmup,args.samples)];payload["candidateSummary"]=summarize_candidates(payload["browsers"]);payload["ok"]=all(x.get("ok") for x in payload["browsers"])
    finally: server.shutdown();server.server_close()
    path.write_text(json.dumps(payload,indent=2,sort_keys=True)+"\n",encoding="utf-8");print(f"SM-800 {'PASS' if payload['ok'] else 'FAIL'} targetHardwareAcceptance=false: {path}");return 0 if payload["ok"] else 1
if __name__=="__main__": raise SystemExit(main())
