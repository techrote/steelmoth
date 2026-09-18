#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def text(path):return (ROOT/path).read_text(encoding='utf-8')
def require(cond,msg):
    if not cond:raise SystemExit(f'FAIL: {msg}')

src=text('engine/webgpu_gbuffer.js')
webapp=text('webapp.js')
sw=text('sw.js')
doc=text('docs/WEBGPU_GBUFFER_SM200.md')
baseline=text('GBUFFER_LAYOUT.md')

for token in ["g0:'rgba8unorm'","g1:'rgba16float'","g2:'rgba16float'","objectId:'r32uint'","depth:'depth32float'","depthWriteEnabled:false","depthCompare:'always'","copyTextureToBuffer","getCompilationInfo","textureSample","alphaCutoff","DEBUG_MODES","buildSceneInstances","compatibilityHeightFactor"]:
    require(token in src,f'production G-buffer contract missing {token}')
for token in ['static','dynamic','foreground']:
    require(token in src,f'G-buffer category missing {token}')
require("engine/webgpu_gbuffer.js?v=sm200-1" in webapp,'webapp does not register SM-200 module')
require("engine/webgpu_gbuffer.js?v=sm200-1" in sw,'offline core does not include SM-200 module')
workflow_path=ROOT/'.github/workflows/verification.yml'
if workflow_path.is_file():
    workflow=workflow_path.read_text(encoding='utf-8')
    require('validate_webgpu_gbuffer_browser.py --require-webgpu' in workflow,'required real-WebGPU G-buffer browser gate missing')
    require('webgpu-gbuffer-browser.json' in workflow,'SM-200 browser evidence is not uploaded')
for token in ['WebGPU Material-v2 G-buffer','rgba8unorm','rgba16float','r32uint','depth32float','SM-201','SM-202','object ID','deterministic clear','0.12','0.88']:
    require(token in doc,f'WEBGPU_GBUFFER_SM200.md missing contract phrase: {token}')
for token in ['G2.R is not final visibility depth','R = normalized local pseudo-height','G = metalness','B = material AO']:
    require(token in baseline,f'inherited G-buffer semantic missing: {token}')
print('SM-200 WebGPU G-buffer source contract: PASS')
