#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
errors=[]
def text(path,required=True):
    p=ROOT/path
    if not p.is_file():
        if required:errors.append(f'missing {path}')
        return ''
    return p.read_text(encoding='utf-8')
def need(src,needle,label):
    if needle not in src:errors.append(f'{label}: missing {needle!r}')

def main()->int:
    module=text('engine/webgpu_depth_hierarchy.js')
    smoke=text('webgpu-depth-hierarchy-smoke.html')
    runner=text('tools/validate_webgpu_depth_hierarchy_browser.py')
    node=text('tools/validate_webgpu_depth_hierarchy.js')
    checks=text('tools/run_checks.py')
    workflow=text('.github/workflows/verification.yml',required=False)
    webapp=text('webapp.js');sw=text('sw.js');package=text('tools/validate_clean_package.py')
    docs=text('docs/WEBGPU_DEPTH_HIERARCHY_SM203.md');arch=text('docs/WEBGPU_ARCHITECTURE.md');index=text('docs/INDEX.md')
    for needle in ["FORMAT='rg32float'","EMPTY_MIN=1.0,EMPTY_MAX=0.0",'texture_depth_2d','texture_2d<u32>','texture_storage_2d<rg32float,write>','Math.ceil(width/2)','Math.ceil(height/2)','buildFromOwnership','levelForFootprint','lastInvalidationReason','RANGE_HELPERS_WGSL']:
        need(module,needle,'depth hierarchy module')
    for forbidden in ['float32-filterable','texture-formats-tier1','texture-formats-tier2']:
        if forbidden in module:errors.append(f'depth hierarchy module must not require optional feature {forbidden!r}')
    for needle in ['[[5,3],[3,2],[2,1],[1,1]]','odd right edge','all-empty hierarchy']:
        need(node,needle,'deterministic vector test')
    for needle in ['webgpu-depth-hierarchy-smoke.html','steelmoth-webgpu-depth-hierarchy-browser-report/v1','--require-webgpu']:
        need(runner,needle,'browser runner')
    for needle in ['webgpuDepthHierarchyDone','buildFromOwnership','room-change','renderDebug']:
        need(smoke,needle,'browser smoke')
    for needle in ['js-webgpu-depth-hierarchy','webgpu-depth-hierarchy','webgpu-depth-hierarchy-contract']:
        need(checks,needle,'run_checks registration')
    if workflow:
        for needle in ['validate_webgpu_depth_hierarchy_browser.py','webgpu-depth-hierarchy-browser.json']:
            need(workflow,needle,'workflow hierarchy gate')
    need(webapp,'webgpu_depth_hierarchy.js?v=sm203-1','runtime module load')
    need(sw,'webgpu_depth_hierarchy.js?v=sm203-1','offline core')
    for needle in ['engine/webgpu_depth_hierarchy.js','webgpu-depth-hierarchy-smoke.html','validate_webgpu_depth_hierarchy_contract.py','WEBGPU_DEPTH_HIERARCHY_SM203.md']:
        need(package,needle,'clean-package inventory')
    for needle in ['nearest occupied canonical depth','farthest occupied canonical depth','(1.0, 0.0)','5x3','No effect should construct an independent pseudo-depth pyramid']:
        need(docs,needle,'SM-203 documentation')
    need(arch,'WEBGPU_DEPTH_HIERARCHY_SM203.md','architecture hierarchy status')
    need(index,'WEBGPU_DEPTH_HIERARCHY_SM203.md','documentation index')
    if errors:
        print('SM-203 depth hierarchy contract: FAIL',file=sys.stderr)
        for e in errors:print(' -',e,file=sys.stderr)
        return 1
    print('SM-203 depth hierarchy contract: PASS')
    return 0
if __name__=='__main__':raise SystemExit(main())
