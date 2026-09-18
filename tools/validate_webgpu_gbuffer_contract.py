#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def text(path):return (ROOT/path).read_text(encoding='utf-8')
def require(cond,msg):
    if not cond:raise SystemExit(f'FAIL: {msg}')

src=text('engine/webgpu_gbuffer.js')
webapp=text('webapp.js')
sw=text('sw.js')
workflow=text('.github/workflows/verification.yml')
doc=text('GBUFFER_LAYOUT.md')

for token in ["g0:'rgba8unorm'","g1:'rgba16float'","g2:'rgba16float'","objectId:'r32uint'","depth:'depth32float'","depthWriteEnabled:false","depthCompare:'always'","copyTextureToBuffer","getCompilationInfo","textureSample","alphaCutoff","DEBUG_MODES","buildSceneInstances"]:
    require(token in src,f'production G-buffer contract missing {token}')
for token in ['static','dynamic','foreground']:
    require(token in src,f'G-buffer category missing {token}')
require("engine/webgpu_gbuffer.js?v=sm200-1" in webapp,'webapp does not register SM-200 module')
require("engine/webgpu_gbuffer.js?v=sm200-1" in sw,'offline core does not include SM-200 module')
require('validate_webgpu_gbuffer_browser.py --require-webgpu' in workflow,'required real-WebGPU G-buffer browser gate missing')
require('webgpu-gbuffer-browser.json' in workflow,'SM-200 browser evidence is not uploaded')
for token in ['WebGPU Material-v2 G-buffer','rgba8unorm','rgba16float','r32uint','depth32float','SM-201','SM-202','object ID','deterministic clear']:
    require(token in doc,f'GBUFFER_LAYOUT.md missing SM-200 contract phrase: {token}')
print('SM-200 WebGPU G-buffer source contract: PASS')
