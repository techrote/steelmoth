#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def read(rel): return (ROOT/rel).read_text(encoding='utf-8')
def require(ok,msg):
    if not ok: raise SystemExit(f'SM-305 CONTRACT FAIL: {msg}')

src=read('engine/webgpu_dark_bloom.js')
web=read('webapp.js')
sw=read('sw.js')
doc=read('docs/WEBGPU_DARK_BLOOM_SM305.md')
smoke=read('webgpu-dark-bloom-smoke.html')
workflow=read('.github/workflows/sm305-dark-bloom.yml') if (ROOT/'.github/workflows/sm305-dark-bloom.yml').exists() else ''
fixture=read('render-tests/fixtures/binsup.json')

require("steelmoth-webgpu-dark-bloom/v1" in src and "steelmoth-webgpu-dark-bloom-snapshot/v1" in src,'stable module and snapshot schemas missing')
require('const SCALE = 2' in src or 'const SCALE=2' in src,'reduced-resolution scale is not explicit')
require('farRadius:8' in src and 'nearStrength:.14' in src and 'farStrength:.45' in src,'bounded Ultra quality controls missing')
require("clamp(Math.round(finite(q[k])), 0, 8)" in src or "clamp(Math.round(finite(q[k])),0,8)" in src,'hard maximum bloom radius clamp missing')
require('texture_2d<f32>' in src and 'rangeTex' in src and 'depthThreshold' in src,'depth-aware pseudo-depth consumption missing')
require('r32float' in src and 'lowBloom' in src and 'full' in src,'reduced and full residual representations missing')
require('temporalAccumulation:false' in src,'SM-306 temporal accumulation must remain absent from SM-305')
require('sourceFromPaths' in src and 'levelView(0)' in src,'canonical SM-203 depth-hierarchy input path missing')
require('TIER_WGSL' in src and 'hierarchyBindings' in src and "gpu-sm304-active-tiles" in src,'SM-501 GPU tier-map path must consume SM-304 spatial buffers')
require("tierSource==='gpu-sm304-active-tiles'" in smoke or "tierSource === 'gpu-sm304-active-tiles'" in smoke,'real-browser smoke must exercise the GPU tier-map production path')
require("webgpu_dark_bloom.js?v=sm305-1" in web,'webapp does not stage SM-305 after the DSO hierarchy')
require(web.index("webgpu_dso_hierarchy.js?v=sm304-1") < web.index("webgpu_dark_bloom.js?v=sm305-1") < web.index("backend_runtime.js?v=sm102-1"),'SM-305 staging order is not hierarchy -> bloom -> runtime')
require("small-machine-web-v1.2.3-r" in sw and "webgpu_dark_bloom.js?v=sm305-1" in sw,'revisioned service-worker cache entry missing')
require('soft feathered residual occlusion' in fixture,'binsup qualitative Dark Bloom target missing')
for term in ('half resolution','hard-core pixels','depth compatibility','No temporal history','binsup','Hosted CI'):
    require(term.lower() in doc.lower(),f'documentation missing contract term: {term}')
require('webgpuDarkBloomDone' in smoke and 'gpuCpuTolerance' in smoke and 'humanVisualReviewClaimed:false' in smoke,'real-browser evidence contract incomplete')
require('sm305-dark-bloom' in workflow and 'validate_webgpu_dark_bloom_browser.py --require-webgpu' in workflow,'dedicated required-WebGPU workflow missing')
print('SM-305 Dark Bloom source/staging contract: PASS')
