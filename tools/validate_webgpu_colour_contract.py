#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def need(path,needle,msg):
    text=(ROOT/path).read_text(encoding='utf-8')
    if needle not in text: errors.append(msg)
need('engine/webgpu_gbuffer.js',"'rgba8unorm-srgb'",'albedo atlas must use sRGB sampling format')
need('engine/webgpu_gbuffer.js',"normalRoughness:make('normal-roughness',normalRoughness,'rgba8unorm')",'normal/roughness atlas must stay linear unorm')
need('engine/webgpu_gbuffer.js',"heightMaterial:make('height-material',heightMaterial,'rgba8unorm')",'height/material atlas must stay linear unorm')
need('engine/webgpu_gbuffer.js',"g0:'rgba8unorm'",'G0 must remain a linear internal target')
need('engine/webgpu_lighting.js',"const OUTPUT_FORMAT='rgba16float'",'lighting output must remain HDR float')
need('engine/webgpu_lighting.js','return GBuffer.srgbToLinear(c)','canonical light colours must decode authored sRGB')
need('engine/webgpu_post.js','linear_to_srgb','post output must encode sRGB')
need('engine/webgpu_post.js',"intermediateFormat||'rgba16float'",'post intermediates must remain HDR float')
need('engine/webgpu_device.js',"colorSpace:'srgb'",'GPU canvas colour space must be explicit')
need('docs/COLOUR_PIPELINE.md','18% linear grey','numeric fixture contract missing')
need('docs/COLOUR_PIPELINE.md','Debug views','debug-space contract missing')
need('webgpu-gbuffer-smoke.html','sRGB-decoded exactly once','GPU albedo decode readback missing')
need('webgpu-post-smoke.html','linear-to-sRGB display transfer','GPU display transfer readback missing')
if errors:
    print('SM-502 COLOUR CONTRACT FAIL')
    for e in errors: print(' -',e)
    raise SystemExit(1)
print('SM-502 COLOUR CONTRACT PASS: source/input -> linear G-buffer -> linear HDR lighting/bloom/post -> explicit sRGB display')
