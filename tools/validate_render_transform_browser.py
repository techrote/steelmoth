#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, shutil, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CAPTURE=ROOT/'tools'/'capture_render_fixture.py'
DEFAULT_CASES=(('box-pair',45),('dense-mixed',225))

def read(path:Path): return json.loads(path.read_text(encoding='utf-8'))

def run_capture(fixture:str,angle:int,out:Path,baseline:bool)->dict:
    # Hosted Chrome may initialize SwiftShader substantially more slowly than a
    # workstation GL adapter. Keep the per-capture timeout bounded but large enough
    # to distinguish slow initialization from a genuine missing render result.
    cmd=[sys.executable,str(CAPTURE),'--fixture',fixture,'--angle',str(angle),'--repeat','2','--quality','high','--out',str(out),'--browser-timeout','60']
    if baseline: cmd.append('--render-transform-baseline')
    p=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True)
    if p.returncode:
        raise RuntimeError(f"capture failed ({'baseline' if baseline else 'shared'}) {fixture}@{angle}: exit={p.returncode}\nstdout:\n{p.stdout[-4000:]}\nstderr:\n{p.stderr[-4000:]}")
    summary=read(out/'summary.json')
    if not summary.get('deterministicCanvas') or not summary.get('deterministicViewportScreenshot'):
        raise RuntimeError(f"capture was not deterministic for {fixture}@{angle} mode={summary.get('renderTransformMode')}: {summary}")
    return summary

def main()->int:
    ap=argparse.ArgumentParser(description='Compare pre-SM-101 and shared-transform WebGL2 browser captures in the same checkout.')
    ap.add_argument('--out',type=Path,default=Path('artifacts/render-transform-browser'))
    ap.add_argument('--report',type=Path,default=Path('artifacts/render-transform-browser.json'))
    args=ap.parse_args()
    out=args.out if args.out.is_absolute() else ROOT/args.out
    report_path=args.report if args.report.is_absolute() else ROOT/args.report
    if out.exists(): shutil.rmtree(out)
    out.mkdir(parents=True,exist_ok=True);report_path.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'steelmoth-render-transform-browser-parity/v1','ok':False,'cases':[],'evidenceBoundary':'Same hosted Chrome/WebGL2 environment before-vs-after pixel equality only; not target-GPU performance evidence.'}
    try:
        for fixture,angle in DEFAULT_CASES:
            case_dir=out/f'{fixture}-{angle}'
            baseline=run_capture(fixture,angle,case_dir/'baseline',True)
            shared=run_capture(fixture,angle,case_dir/'shared',False)
            b_canvas=baseline.get('canvasPngSha256',[]);s_canvas=shared.get('canvasPngSha256',[])
            b_view=baseline.get('viewportScreenshotSha256',[]);s_view=shared.get('viewportScreenshotSha256',[])
            case={
                'fixture':fixture,'angleDeg':angle,
                'baselineMode':baseline.get('renderTransformMode'),'sharedMode':shared.get('renderTransformMode'),
                'baselineCanvasSha256':b_canvas,'sharedCanvasSha256':s_canvas,
                'baselineViewportSha256':b_view,'sharedViewportSha256':s_view,
                'canvasPixelEqual':len(b_canvas)==1 and b_canvas==s_canvas,
                'viewportPixelEqual':len(b_view)==1 and b_view==s_view,
                'browser':shared.get('browser')
            }
            case['ok']=case['canvasPixelEqual'] and case['viewportPixelEqual'];report['cases'].append(case)
            if not case['ok']:
                raise AssertionError(f"WebGL2 pixel parity changed for {fixture}@{angle}: {case}")
        report['ok']=True
    except Exception as exc:
        report['error']=str(exc)
    report_path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    for c in report['cases']:
        print(f"{'PASS' if c['ok'] else 'FAIL'} {c['fixture']} angle={c['angleDeg']} canvas={c['canvasPixelEqual']} viewport={c['viewportPixelEqual']} browser={c['browser']}")
    if not report['ok']:
        print('ERROR:',report.get('error','browser parity failed'),file=sys.stderr);return 1
    print(f"SM-101 BROWSER PIXEL PARITY PASS: {len(report['cases'])} representative cases, baseline/shared captures byte-identical")
    return 0

if __name__=='__main__': raise SystemExit(main())
