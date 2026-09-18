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
    module=text('engine/webgpu_local_shadows.js');node=text('tools/validate_webgpu_local_shadows.js');smoke=text('webgpu-local-shadows-smoke.html');runner=text('tools/validate_webgpu_local_shadows_browser.py');checks=text('tools/run_checks.py');workflow=text('.github/workflows/verification.yml',required=False);webapp=text('webapp.js');sw=text('sw.js');package=text('tools/validate_clean_package.py');docs=text('docs/WEBGPU_LOCAL_SHADOWS_SM205.md');index=text('docs/INDEX.md')
    for needle in ["SCHEMA='steelmoth-webgpu-local-shadows/v1'","SELF_QUALITY_SAMPLES=Object.freeze([0,8,12,16,28])","CONTACT_QUALITY_SAMPLES=Object.freeze([0,4,8,12])","MAX_SELF_LIGHTS=8","DEBUG_MODES=Object.freeze(['self-shadow','contact-shadow'])",'SELF_WGSL','CONTACT_WGSL','RECONSTRUCT_WGSL','selfShadowReference','contactOcclusionReference','reconstructContactReference','WebGPULocalShadows','sm205:self','sm205:contact','sm205:contact-visibility','Lighting.LIGHT_BUFFER_NAME']:
        need(module,needle,'local shadow module')
    for forbidden in ['DSO','Dark Bloom','GTAO','SSGI']:
        # These words may appear only in diagnostics/docs, not as implementation ownership markers.
        if f'class {forbidden}' in module or f'function {forbidden}' in module:errors.append(f'local shadow module must not implement later effect {forbidden!r}')
    for needle in ['8-angle local-height matrix','short-range depth-aware contact reconstruction','height step should self-shadow','contact shadow must remain short-range']:
        need(node,needle,'deterministic local-shadow test')
    for needle in ['webgpuLocalShadowsDone','cargo_crate','rust_barrel','server_cabinet','hex_maintenance_idle_0','synthetic height step produces bounded self shadow','20 px contact distance does not become a macro shadow']:
        need(smoke,needle,'browser smoke')
    for needle in ['webgpu-local-shadows-smoke.html','steelmoth-webgpu-local-shadows-browser-report/v1','--require-webgpu']:
        need(runner,needle,'browser runner')
    for needle in ['js-webgpu-local-shadows','webgpu-local-shadows','webgpu-local-shadows-contract']:
        need(checks,needle,'run_checks registration')
    if workflow:
        for needle in ['validate_webgpu_local_shadows_browser.py','webgpu-local-shadows-browser.json']:
            need(workflow,needle,'workflow local-shadow gate')
    need(webapp,'webgpu_local_shadows.js?v=sm205-1','runtime module load');need(sw,'webgpu_local_shadows.js?v=sm205-1','offline core')
    for needle in ['engine/webgpu_local_shadows.js','webgpu-local-shadows-smoke.html','validate_webgpu_local_shadows_contract.py','WEBGPU_LOCAL_SHADOWS_SM205.md']:
        need(package,needle,'clean-package inventory')
    for needle in ['0/8/12/16/28 samples','0/4/8/12 samples','3×3 depth-aware reconstruction','ownership depth','CPU submit/wait wall time','SM-307']:
        need(docs,needle,'SM-205 documentation')
    need(index,'WEBGPU_LOCAL_SHADOWS_SM205.md','documentation index')
    if errors:
        print('SM-205 local shadow contract: FAIL',file=sys.stderr)
        for e in errors:print(' -',e,file=sys.stderr)
        return 1
    print('SM-205 local shadow contract: PASS')
    return 0
if __name__=='__main__':raise SystemExit(main())
