#!/usr/bin/env python3
from __future__ import annotations
import argparse, functools, json, platform, threading, time, urllib.parse
from pathlib import Path
from validate_webgpu_cross_browser import Quiet, Server, browser_metadata, make_driver, wait_result

ROOT=Path(__file__).resolve().parents[1]

def run_browser(name,base_url,timeout,out_dir):
    report={"browser":name,"ok":False,"environment":None,"failure":None};driver=None;started=time.monotonic()
    try:
        driver=make_driver(name,"hosted-ci");driver.set_page_load_timeout(max(30,timeout));driver.set_script_timeout(max(30,timeout));report["environment"]=browser_metadata(driver,name,"hosted-ci")
        driver.get(f"{base_url}/webgpu-static-submission-smoke.html?"+urllib.parse.urlencode({"runs":3,"cpuWarmupBlocks":4,"cpuMeasureBlocks":12,"framesPerBlock":16,"gpuSamples":24,"rebuildSamples":160}))
        payload=wait_result(driver,timeout)["parsed"];report["result"]=payload;report["durationSeconds"]=round(time.monotonic()-started,3)
        if not payload.get("ok"): raise RuntimeError(str(payload.get("error") or "SM-801 page reported ok=false"))
        if set((payload.get("workloads") or {}).keys())!={"representative","dense"}: raise RuntimeError("SM-801 workload matrix incomplete")
        if len([c for c in payload.get("checks",[]) if not c.get("ok")]): raise RuntimeError("SM-801 structured checks contain failures")
        shot=out_dir/f"{name}-sm801.png";shot.parent.mkdir(parents=True,exist_ok=True);driver.save_screenshot(str(shot));report["screenshot"]=str(shot.relative_to(ROOT));report["ok"]=True
    except Exception as exc: report["durationSeconds"]=round(time.monotonic()-started,3);report["failure"]=str(exc)
    finally:
        if driver:
            try: driver.quit()
            except Exception: pass
    return report

def decision_rows(browsers):
    rows=[]
    for b in browsers:
        p=b.get("result") or {}
        for name,w in (p.get("workloads") or {}).items():
            a=w.get("aggregate") or {};rows.append({"browser":b["browser"],"workload":name,"cpu":a.get("cpu") or {},"gpu":a.get("gpu") or {},"bundleRebuildCpu":a.get("bundleRebuildCpu")})
    return rows

def decide(rows):
    reasons=[];adopt=True
    for r in rows:
        base=(r.get("cpu",{}).get("baseline") or {}).get("p50Ms");bund=(r.get("cpu",{}).get("bundle") or {}).get("p50Ms")
        if not isinstance(base,(int,float)) or base<=0 or not isinstance(bund,(int,float)): adopt=False;reasons.append(f"{r['browser']}/{r['workload']} missing CPU data");continue
        gain=(base-bund)/base
        if gain<.10: adopt=False;reasons.append(f"{r['browser']}/{r['workload']} CPU encode gain {gain*100:.1f}% < 10% threshold")
        gb=(r.get("gpu",{}).get("baseline") or {}).get("p50Ms");gg=(r.get("gpu",{}).get("bundle") or {}).get("p50Ms")
        if isinstance(gb,(int,float)) and gb>0 and isinstance(gg,(int,float)) and gg>gb*1.03: adopt=False;reasons.append(f"{r['browser']}/{r['workload']} GPU p50 regressed {(gg-gb)/gb*100:.1f}%")
    if len(rows)!=4: adopt=False;reasons.append("cross-browser workload matrix incomplete")
    return {"decision":"adopt" if adopt else "reject","adopt":adopt,"thresholds":{"minimumCpuEncodeP50Gain":0.10,"maximumGpuP50Regression":0.03},"reasons":reasons}

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--timeout",type=float,default=180);ap.add_argument("--report",type=Path,default=Path("artifacts/sm801/static-submission-report.json"));args=ap.parse_args();path=args.report if args.report.is_absolute() else ROOT/args.report;path.parent.mkdir(parents=True,exist_ok=True)
    server=Server(("127.0.0.1",0),functools.partial(Quiet,directory=str(ROOT),inject_hosted_firefox_fallback=False));threading.Thread(target=server.serve_forever,daemon=True).start();base=f"http://127.0.0.1:{server.server_address[1]}"
    payload={"schema":"steelmoth-sm801-report/v1","ok":False,"host":{"system":platform.system(),"release":platform.release(),"python":platform.python_version()},"evidenceBoundary":"Hosted Chrome/Firefox WebGPU study; CPU encode and render-bundle rebuild measurements are browser-host CPU measurements. GPU milliseconds are reported only when timestamp-query is exposed. No GTX1650S performance claim.","browsers":[]}
    try:
        payload["browsers"]=[run_browser("chrome",base,args.timeout,path.parent/"screenshots"),run_browser("firefox",base,args.timeout,path.parent/"screenshots")];rows=decision_rows(payload["browsers"]);payload["comparisonRows"]=rows;payload["decision"]=decide(rows);payload["ok"]=all(x.get("ok") for x in payload["browsers"])
    finally: server.shutdown();server.server_close()
    path.write_text(json.dumps(payload,indent=2,sort_keys=True)+"\n",encoding="utf-8");print(f"SM-801 {'PASS' if payload['ok'] else 'FAIL'} decision={payload.get('decision',{}).get('decision')}: {path}");return 0 if payload["ok"] else 1
if __name__=="__main__": raise SystemExit(main())
