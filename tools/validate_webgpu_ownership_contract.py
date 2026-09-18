#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import re, sys

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
    ownership=text('engine/webgpu_ownership.js')
    pseudo=text('engine/pseudo_depth.js')
    smoke=text('webgpu-ownership-smoke.html')
    runner=text('tools/validate_webgpu_ownership_browser.py')
    checks=text('tools/run_checks.py')
    # Clean source archives deliberately exclude .github. Verify workflow wiring
    # in normal checkouts, but do not make extracted-runtime validation depend on
    # a directory the package contract intentionally omits.
    workflow=text('.github/workflows/verification.yml',required=False)
    webapp=text('webapp.js')
    sw=text('sw.js')
    package=text('tools/validate_clean_package.py')
    docs=text('docs/WEBGPU_OWNERSHIP_SM202.md')
    model=text('docs/PSEUDO_DEPTH_MODEL.md')
    index=text('docs/INDEX.md')

    for needle in ["require('./pseudo_depth.js')",'@builtin(frag_depth)','depthWriteEnabled:true',"depthCompare:'less'",'depthLayer','depthBias','DEPTH_READBACK_WGSL','texture_depth_2d','textureLoad(depthTex','copyBufferToBuffer','depthReadback:\'compute-textureLoad-to-buffer\'']:
        need(ownership,needle,'ownership module')
    need(ownership,'PseudoDepth.MAX_WORLD_Z','ownership module canonical constants')
    need(ownership,'PseudoDepth.LAYER_STRIDE','ownership module canonical constants')
    need(ownership,'PseudoDepth.DEPTH_KEY_MIN','ownership module canonical constants')
    need(ownership,'PseudoDepth.DEPTH_KEY_MAX','ownership module canonical constants')
    if re.search(r'light(?:Pos|Dir|Angle|Direction)',ownership,re.I):errors.append('ownership shader/module must not depend on light state')
    for needle in ['MAX_WORLD_Z=64','LAYER_STRIDE=1024','DEPTH_KEY_MIN=-2048','DEPTH_KEY_MAX=3072']:
        need(pseudo,needle,'pseudo-depth authority')

    for needle in ['engine/webgpu_ownership.js?v=sm202-1','engine/pseudo_depth.js?v=sm201-1','webgpuOwnershipDone','eight-angle matrix']:
        need(smoke,needle,'browser smoke')
    for needle in ['webgpu-ownership-smoke.html','steelmoth-webgpu-ownership-browser-report/v1','--require-webgpu']:
        need(runner,needle,'browser runner')
    for needle in ['js-webgpu-ownership','webgpu-ownership-contract','webgpu-ownership']:
        need(checks,needle,'run_checks registration')
    if workflow:
        for needle in ['validate_webgpu_ownership_browser.py','webgpu-ownership-browser.json']:
            need(workflow,needle,'workflow ownership gate')
    for needle in ['pseudo_depth.js?v=sm201-1','webgpu_ownership.js?v=sm202-1']:
        need(webapp,needle,'runtime module load')
    for needle in ['pseudo_depth.js?v=sm201-1','webgpu_ownership.js?v=sm202-1']:
        need(sw,needle,'offline core')
    for needle in ['engine/pseudo_depth.js','engine/webgpu_ownership.js','webgpu-ownership-smoke.html','validate_webgpu_ownership_contract.py','WEBGPU_OWNERSHIP_SM202.md']:
        need(package,needle,'clean-package inventory')
    for needle in ['@builtin(frag_depth)','depthCompare = "less"','eight diagnostic light angles','SM-203','textureLoad']:
        need(docs,needle,'SM-202 canonical documentation')
    need(model,'SM-202 production adoption complete','pseudo-depth status reconciliation')
    need(index,'WEBGPU_OWNERSHIP_SM202.md','documentation index')
    need(index,'SM-202','documentation state')

    if errors:
        print('SM-202 ownership contract: FAIL',file=sys.stderr)
        for e in errors:print(' -',e,file=sys.stderr)
        return 1
    print('SM-202 ownership contract: PASS')
    return 0
if __name__=='__main__':raise SystemExit(main())
