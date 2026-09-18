#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]

def text(path:str)->str:return (ROOT/path).read_text(encoding='utf-8')
def require(cond:bool,msg:str,errors:list[str]):
    if not cond:errors.append(msg)

def main()->int:
    errors=[]
    resources=text('engine/webgpu_resources.js');runtime=text('engine/backend_runtime.js');webapp=text('webapp.js');sw=text('sw.js');checks=text('tools/run_checks.py');docs=text('docs/WEBGPU_RESOURCE_INFRASTRUCTURE.md') if (ROOT/'docs/WEBGPU_RESOURCE_INFRASTRUCTURE.md').exists() else ''
    for token in ['class ResourceRegistry','class PipelineCache','class FrameGraph','class WebGPUInfrastructure','defineTexture','defineBuffer','uploadStatic','ensureDynamicArena','uploadDynamic','resetDevice','estimatedBytes','rebuildCount','pushErrorScope','popErrorScope','dependency cycle','missing pass']:
        require(token in resources,f'missing resource infrastructure contract token: {token}',errors)
    require('createRenderBundle' not in resources and 'executeBundles' not in resources,'SM-103 must not add speculative render bundles',errors)
    require('timestamp-query' not in resources,'SM-103 resource infrastructure must not require optional timestamp-query',errors)
    for token in ['SteelMothWebGPUResources','WebGPUInfrastructure','webgpuInfrastructure','infrastructureFactory']:
        require(token in runtime,f'backend runtime missing infrastructure integration token: {token}',errors)
    require("import('./engine/webgpu_resources.js?v=sm103-1')" in webapp,'webapp must load SM-103 WebGPU resource module',errors)
    require('engine/webgpu_resources.js?v=sm103-1' in sw,'offline core must include SM-103 resource module',errors)
    for token in ['js-webgpu-resources','validate_webgpu_resources.js','validate_webgpu_resources_contract.py']:
        require(token in checks,f'normal verification gate missing SM-103 check: {token}',errors)
    for heading in ['Resource ownership and lifetime','Resize and backend reset','Static and dynamic uploads','Frame graph','Pipeline cache','Diagnostics','Verification and evidence boundary']:
        require(heading in docs,f'resource infrastructure documentation missing heading: {heading}',errors)
    require('render bundles' in docs.lower() and 'SM-104' in docs,'documentation must preserve SM-103 non-goals and SM-104 boundary',errors)
    if errors:
        print('SM-103 WEBGPU RESOURCE CONTRACT FAIL',file=sys.stderr)
        for e in errors:print(' -',e,file=sys.stderr)
        return 1
    print('SM-103 WEBGPU RESOURCE CONTRACT PASS: persistent resource ownership, bounded uploads, explicit frame graph, pipeline cache, diagnostics and runtime/offline wiring present')
    return 0
if __name__=='__main__':raise SystemExit(main())
