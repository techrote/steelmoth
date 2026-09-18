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
    module=text('engine/webgpu_lighting.js');node=text('tools/validate_webgpu_lighting.js');smoke=text('webgpu-lighting-smoke.html');runner=text('tools/validate_webgpu_lighting_browser.py');checks=text('tools/run_checks.py');workflow=text('.github/workflows/verification.yml',required=False);webapp=text('webapp.js');sw=text('sw.js');package=text('tools/validate_clean_package.py');docs=text('docs/WEBGPU_LIGHTING_SM204.md');index=text('docs/INDEX.md')
    for needle in ["SCHEMA='steelmoth-webgpu-lighting/v1'","MAX_LIGHTS=17","LIGHT_STRIDE=64","OUTPUT_FORMAT='rgba16float'","DEBUG_MODES=Object.freeze(['final','diffuse','specular','light-count'])","sm204:lights",'buildCanonicalLights','packLights','shadePixelReference','D_GGX','G1(NoV','fres(F0','WebGPUDeferredLighting']:
        need(module,needle,'lighting module')
    for needle in ['playerOmniRadius:80','playerOmniIntensity:1.6','playerConeInnerAngle:30','playerConeOuterAngle:60']:
        need(module,needle,'diagnostic preset')
    for forbidden in ['yellow','SurfaceFX','foliageFX','waterFX']:
        if forbidden in module:errors.append(f'opaque lighting module must not depend on procedural subsystem marker {forbidden!r}')
    for needle in ['8-angle reference matrix','player cone must be de-duplicated','one canonical light buffer']:
        need(node,needle,'deterministic lighting test')
    for needle in ['webgpuLightingDone','floor_plate','cargo_crate','rust_barrel','server_cabinet','hex_maintenance_idle_0',"['diffuse','specular','final']"]:
        need(smoke,needle,'browser smoke')
    for needle in ['webgpu-lighting-smoke.html','steelmoth-webgpu-lighting-browser-report/v1','--require-webgpu']:
        need(runner,needle,'browser runner')
    for needle in ['js-webgpu-lighting','webgpu-lighting','webgpu-lighting-contract']:
        need(checks,needle,'run_checks registration')
    if workflow:
        for needle in ['validate_webgpu_lighting_browser.py','webgpu-lighting-browser.json']:
            need(workflow,needle,'workflow lighting gate')
    need(webapp,'webgpu_lighting.js?v=sm204-1','runtime module load');need(sw,'webgpu_lighting.js?v=sm204-1','offline core')
    for needle in ['engine/webgpu_lighting.js','webgpu-lighting-smoke.html','validate_webgpu_lighting_contract.py','WEBGPU_LIGHTING_SM204.md']:
        need(package,needle,'clean-package inventory')
    for needle in ['one persistent storage buffer named `sm204:lights`','GGX','Schlick','Smith','material AO applied to ambient only','SM-205']:
        need(docs,needle,'SM-204 documentation')
    need(index,'WEBGPU_LIGHTING_SM204.md','documentation index')
    if errors:
        print('SM-204 canonical lighting contract: FAIL',file=sys.stderr)
        for e in errors:print(' -',e,file=sys.stderr)
        return 1
    print('SM-204 canonical lighting contract: PASS')
    return 0
if __name__=='__main__':raise SystemExit(main())
