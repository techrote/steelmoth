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
    performance=text('engine/webgpu_performance.js');performance_test=text('tools/validate_webgpu_performance.js');performance_docs=text('docs/WEBGPU_PERFORMANCE_INSTRUMENTATION_SM500.md');resource_smoke=text('webgpu-resources-smoke.html');workflow_path=ROOT/'.github/workflows/sm500-performance-instrumentation.yml';workflow=workflow_path.read_text(encoding='utf-8') if workflow_path.exists() else None
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

    # SM-500 layers optional measurement on SM-103 without changing the base resource contract.
    for token in ['class WebGPUPerformanceInstrumentation','timestamp-query','timestampWrites','gpuMs','cpuCallbackMs','scenePrepMs','encodingMs','attachFrameGraph','setWorkload','recordRegistryMemory','historyBytes','exportJSON','boundarySubmissionsPerGpuPass','timestamp-query-feature-unavailable']:
        require(token in performance,f'missing SM-500 performance contract token: {token}',errors)
    require('onSubmittedWorkDone' not in performance,'SM-500 must not use queue completion wall time as GPU timing',errors)
    require("DEFAULT_OPTIONAL_FEATURES=Object.freeze(['timestamp-query'])" in text('engine/webgpu_device.js'),'device lifecycle must continue negotiating timestamp-query only when exposed',errors)
    for token in ['gbuffer','lighting','dso','dark-bloom','post','timestamp ordering','gpuMs,null','enabled:false']:
        require(token in performance_test,f'SM-500 deterministic validator missing coverage token: {token}',errors)
    require("engine/webgpu_performance.js?v=sm500-1" in resource_smoke,'real-browser resource smoke must load SM-500 performance instrumentation',errors)
    for token in ['performanceDiagnostics','cpu.scenePrepMs','cpu.encodingMs','dsoTiles','totalEstimatedBytes','gpuTiming.supported','gpuMs!==null']:
        require(token in resource_smoke,f'real-browser smoke missing SM-500 assertion token: {token}',errors)
    for heading in ['Timing authority and units','Frame-graph integration','CPU preparation and encoding','Workload counters','Renderer-owned memory estimates','JSON diagnostics and distributions','Disabled and unavailable paths','Benchmark protocol for SM-501','Verification and evidence boundary']:
        require(heading in performance_docs,f'SM-500 documentation missing heading: {heading}',errors)
    require('300 warmup frames' in performance_docs and '600 measured frames' in performance_docs and 'three runs' in performance_docs,'SM-500 docs must preserve canonical benchmark sampling protocol',errors)
    require('GTX 1650 SUPER' in performance_docs and 'timestamp-query' in performance_docs and 'SM-501' in performance_docs,'SM-500 docs must record target capability evidence without claiming performance acceptance',errors)
    # Repository workflows are intentionally omitted from the clean source package. Validate
    # the dedicated workflow whenever repository metadata is present, but do not make an
    # extracted source package depend on .github/ files it deliberately does not ship.
    if workflow is not None:
        for token in ['node tools/validate_webgpu_performance.js','validate_webgpu_resources_browser.py','sm500-performance-browser.json']:
            require(token in workflow,f'SM-500 dedicated workflow missing token: {token}',errors)
    require("require('./validate_webgpu_performance.js')" in text('tools/validate_webgpu_resources.js'),'normal deterministic resource gate must execute SM-500 validator',errors)

    if errors:
        print('SM-103/SM-500 WEBGPU RESOURCE CONTRACT FAIL',file=sys.stderr)
        for e in errors:print(' -',e,file=sys.stderr)
        return 1
    print('SM-103/SM-500 WEBGPU RESOURCE CONTRACT PASS: persistent resources plus optional pass-level timestamp instrumentation, separate CPU phases, workload/memory export and unavailable-feature fallback are wired')
    return 0
if __name__=='__main__':raise SystemExit(main())
