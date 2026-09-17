#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import re,sys
ROOT=Path(__file__).resolve().parents[1]

def text(path:str)->str:return (ROOT/path).read_text(encoding='utf-8')
def require(cond:bool,msg:str,errors:list[str]):
    if not cond:errors.append(msg)

def main()->int:
    errors=[]
    device=text('engine/webgpu_device.js');runtime=text('engine/backend_runtime.js');webapp=text('webapp.js');sw=text('sw.js');checks=text('tools/run_checks.py');docs=text('docs/WEBGPU_DEVICE_LIFECYCLE.md') if (ROOT/'docs/WEBGPU_DEVICE_LIFECYCLE.md').exists() else ''
    require("const AUTO_WEBGPU_ENABLED=false" in device,'Auto WebGPU gate must remain literal false until SM-505',errors)
    require("webgl2-until-sm505" in device,'Auto policy must name the SM-505 gate',errors)
    for token in ['requestAdapter','requestDevice','adapter.features','adapter.limits','getPreferredCanvasFormat','pushErrorScope','popErrorScope','uncapturederror','device.lost','context.configure','unconfigure','resize']:
        require(token in device,f'missing lifecycle contract token: {token}',errors)
    for token in ["requestedBackend","activeBackend","presentationBackend","fallbackReason","WebGPU (device test)","device-lost"]:
        require(token in runtime,f'missing backend runtime contract token: {token}',errors)
    require("import('./engine/webgpu_device.js?v=sm102-1')" in webapp,'webapp must load WebGPU device module',errors)
    require("import('./engine/backend_runtime.js?v=sm102-1')" in webapp,'webapp must load backend runtime module',errors)
    require('engine/webgpu_device.js?v=sm102-1' in sw and 'engine/backend_runtime.js?v=sm102-1' in sw,'offline core must include SM-102 modules',errors)
    require('validate_webgpu_lifecycle.js' in checks,'normal regression gate must execute lifecycle tests',errors)
    require('validate_webgpu_contract.py' in checks,'normal regression gate must execute source contract test',errors)
    for heading in ['Staged backend policy','Device and context lifecycle','Failure isolation','Diagnostics','Verification']:
        require(heading in docs,f'device lifecycle documentation missing heading: {heading}',errors)
    require('SM-505' in docs and 'WebGL2' in docs,'documentation must preserve Auto promotion gate',errors)
    if errors:
        print('SM-102 WEBGPU CONTRACT FAIL',file=sys.stderr)
        for e in errors:print(' -',e,file=sys.stderr)
        return 1
    print('SM-102 WEBGPU CONTRACT PASS: staged Auto policy, lifecycle APIs, runtime diagnostics, offline registration and verification wiring present')
    return 0
if __name__=='__main__':raise SystemExit(main())
