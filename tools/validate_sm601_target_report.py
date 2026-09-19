#!/usr/bin/env python3
from __future__ import annotations
import argparse,json,math,sys
from pathlib import Path

def need(cond,msg):
    if not cond: raise ValueError(msg)
def finite(v):
    try:return math.isfinite(float(v))
    except Exception:return False

def main():
    ap=argparse.ArgumentParser(description='Validate physical GTX 1650 SUPER SM-601 GTAO benchmark evidence without inventing target timings.');ap.add_argument('report',type=Path);args=ap.parse_args()
    data=json.loads(args.report.read_text(encoding='utf-8'))
    try:
        need(data.get('schema')=='steelmoth-sm601-target-report/v1','wrong schema')
        env=data.get('environment') or {}; adapter=env.get('adapter') or {}; display=env.get('display') or {}
        text=' '.join(str(adapter.get(k,'')) for k in ('vendor','architecture','device','description','name')).lower()
        need('1650' in text and ('super' in text or 'gtx 1650' in text),'adapter must identify the physical GTX 1650 SUPER target')
        need(adapter.get('fallback') is False,'fallback/software adapters are not target evidence')
        need(display.get('width')==1920 and display.get('height')==1080,'target benchmark must run at native 1920x1080')
        need(float(display.get('devicePixelRatio',0))==1.0,'target benchmark must use DPR 1')
        need(str(data.get('quality','')).lower()=='medium','target benchmark must use Medium GTAO')
        method=data.get('methodology') or {};need(int(method.get('warmupFrames',0))>=300,'need at least 300 warmup frames');need(int(method.get('measuredFrames',0))>=600,'need at least 600 measured frames per run');need(method.get('timestampQuery') is True,'genuine GPU timestamp-query evidence required')
        runs=data.get('runs') or [];need(len(runs)>=3,'need three target-hardware runs')
        for idx,run in enumerate(runs[:3],1):
            gpu=run.get('gtaoGpuMs') or {};need(int(run.get('measuredFrames',method.get('measuredFrames',0)))>=600,f'run {idx}: insufficient measured frames');need(all(finite(gpu.get(k)) for k in ('mean','p50','p95')),f'run {idx}: missing finite GTAO GPU distribution');need(float(gpu['mean'])>=0 and float(gpu['p95'])>=float(gpu['p50'])>=0,f'run {idx}: invalid GPU distribution ordering')
        visual=data.get('validation') or {};need(visual.get('movingSceneStable') is True,'moving-light/actor stability must be signed off');need(visual.get('noDoubleDarkening') is True,'material-AO/GTAO double-darkening check must pass');need(visual.get('historyRejection') is True,'temporal discontinuity rejection must pass on target')
        means=[float(r['gtaoGpuMs']['mean']) for r in runs[:3]];p95s=[float(r['gtaoGpuMs']['p95']) for r in runs[:3]];mean=sum(means)/len(means);p95=max(p95s);within=mean<=1.2
        result={'schema':'steelmoth-sm601-target-validation/v1','ok':True,'runCount':len(runs),'meanOfRunMeansMs':mean,'worstRunP95Ms':p95,'planningGuardrailMs':[0.7,1.2],'withinWorkingMeanGuardrail':within,'note':'0.7-1.2 ms is a planning guardrail, not fabricated acceptance. Results above it require architecture investigation before visual weakening.'}
        print(json.dumps(result,indent=2,sort_keys=True));return 0
    except Exception as exc:
        print(f'SM-601 TARGET REPORT FAIL: {exc}',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
