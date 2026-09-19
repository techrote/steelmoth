#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def require(ok,msg):
    if not ok:errors.append(msg)
module=(ROOT/'engine/webgpu_tile_culling.js').read_text(encoding='utf-8')
test=(ROOT/'tools/validate_webgpu_tile_culling.js').read_text(encoding='utf-8')
browser=(ROOT/'tools/validate_webgpu_tile_culling_browser.py').read_text(encoding='utf-8')
smoke=(ROOT/'webgpu-tile-culling-smoke.html').read_text(encoding='utf-8')
doc=(ROOT/'docs/WEBGPU_TILE_CULLING_SM504.md').read_text(encoding='utf-8')
workflow=(ROOT/'.github/workflows/sm504-tile-culling.yml').read_text(encoding='utf-8') if (ROOT/'.github/workflows/sm504-tile-culling.yml').exists() else ''
for token in ['steelmoth-webgpu-tile-culling-snapshot/v1','sourceOccluderSchema','SM-300 grid reused verbatim','droppedLightRefs','baselinePixelLightTests','submittedPixelLightTests','avoidedPixelLightTests','withDSORelevance','buildDSOWork','shadePixelReferenceCulled','WebGPUSharedTileBuffers','gtao','ssgi','volumetrics']:
    require(token in module,f'module missing required contract token: {token}')
require("require('./webgpu_occluders.js')" in module,'tile module must consume SM-300 rather than inventing an unrelated grid')
require("require('./webgpu_lighting.js')" in module,'tile module must consume canonical SM-204 light semantics')
require('Occluders.tileRange' in module,'tile membership must reuse SM-300 tile range helper')
require('light identity/order mismatch' in module,'stale/reordered light lists must fail closed')
require('DSO relevance drift' in module,'DSO/shared-tile drift must fail closed')
require('droppedLightRefs' in test and 'workReduction>.45' in test,'deterministic validation must prove bounded lists and material light-work reduction')
require('maxError<2e-6' in test,'deterministic validation must retain direct-light parity tolerance')
require('plan.diagnostics.nonEmptyTiles' in test,'deterministic validation must consume authoritative DSO tile headers')
require('realWebGPU:true' in smoke and 'createComputePipelineAsync' in smoke,'browser smoke must execute a real WebGPU consumer of shared tile buffers')
require('lightWorkReduction' in browser and 'dsoWorkReduction' in browser,'browser validator must enforce work-reduction evidence')
for phrase in ['single tile authority','DSO','direct light','work reduction','visual parity','GTX 1650 SUPER','not target-hardware timing','reserved','GTAO','SSGI','volumetrics']:
    require(phrase.lower() in doc.lower(),f'documentation missing evidence boundary/architecture phrase: {phrase}')
require('SM-504 WebGPU shared tile/light culling' in workflow,'dedicated workflow missing or incorrectly named')
require('validate_webgpu_tile_culling.js' in workflow and 'validate_webgpu_tile_culling_browser.py' in workflow,'workflow does not run deterministic + real browser validation')
if errors:
    print('SM-504 CONTRACT FAIL')
    for e in errors:print(' -',e)
    raise SystemExit(1)
print('SM-504 CONTRACT PASS: shared SM-300 tiles + canonical light lists + DSO work plan + real-WebGPU ABI + evidence boundary')
