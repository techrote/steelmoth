#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def text(p):return (ROOT/p).read_text(encoding='utf-8')
def optional_text(p):
    q=ROOT/p
    return q.read_text(encoding='utf-8') if q.is_file() else None
def need(src,needle,label,errors):
    if needle not in src:errors.append(f'{label}: missing {needle!r}')
def main():
    errors=[]
    engine=text('engine/webgpu_lighting.js');runner=text('tools/run_checks.py');workflow=optional_text('.github/workflows/verification.yml');webapp=text('webapp.js');sw=text('sw.js');docs=text('docs/WEBGPU_LIGHTING_SM204.md');index=text('docs/INDEX.md');package=text('tools/validate_clean_package.py')
    for needle in ["SCHEMA='steelmoth-webgpu-lighting/v1'","const LIGHT_STRIDE=64","const MAX_LIGHTS=16","buildCanonicalLights","packLights","WebGPUDeferredLighting","D_GGX","G1(","fres(","'light-count'"]:
        need(engine,needle,'engine/webgpu_lighting.js',errors)
    for needle in ['positionRadius:vec4f','colorIntensity:vec4f','directionInnerOuter:vec4f','info:vec4u','@group(0) @binding(3) var<storage,read> lights:array<Light>']:
        need(engine,needle,'canonical light buffer',errors)
    if 'DSO' in engine or 'GTAO' in engine or 'SSGI' in engine or 'volumetric' in engine.lower():errors.append('engine/webgpu_lighting.js: SM-204 must not implement downstream shadow/AO/GI/volumetric systems')
    for needle in ['emissive:2','lightRadius:2','playerOmniRadius:80','playerOmniIntensity:1.6','playerConeInnerAngle:30','playerConeOuterAngle:60']:
        need(engine,needle,'diagnostic preset',errors)
    for needle in ['js-webgpu-lighting','webgpu-lighting','validate_webgpu_lighting.js','validate_webgpu_lighting_contract.py']:
        need(runner,needle,'tools/run_checks.py',errors)
    if workflow is not None:
        need(workflow,'validate_webgpu_lighting_browser.py --require-webgpu','workflow browser gate',errors);need(workflow,'webgpu-lighting-browser.json','workflow artifact',errors)
    need(webapp,"webgpu_lighting.js?v=sm204-1",'webapp staged load',errors);need(sw,"webgpu_lighting.js?v=sm204-1",'service-worker core',errors)
    for needle in ['engine/webgpu_lighting.js','webgpu-lighting-smoke.html','validate_webgpu_lighting_contract.py','WEBGPU_LIGHTING_SM204.md']:
        need(package,needle,'clean package',errors)
    for needle in ['one canonical light buffer','GGX','Schlick','Smith','eight-angle','diffuse','specular','light-count','SM-205']:
        need(docs,needle,'SM-204 documentation',errors)
    need(index,'WEBGPU_LIGHTING_SM204.md','documentation index',errors)
    if errors:
        print('SM-204 LIGHTING CONTRACT FAIL')
        for e in errors:print(' -',e)
        return 1
    print('SM-204 LIGHTING CONTRACT PASS: canonical buffer, deferred PBR, diagnostics, browser/package registration')
    return 0
if __name__=='__main__':raise SystemExit(main())
