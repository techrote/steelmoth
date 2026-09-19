#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def require(ok,msg):
    if not ok:errors.append(msg)

def text(path):return (ROOT/path).read_text(encoding='utf-8')
engine=text(Path('engine/webgpu_gtao.js'));visibility=text(Path('engine/webgpu_visibility.js'));doc=text(Path('docs/WEBGPU_GTAO_SM600.md'));det=text(Path('tools/validate_webgpu_gtao.js'));smoke=text(Path('webgpu-gtao-smoke.html'));checks=text(Path('tools/run_checks.py'));workflow=(ROOT/'.github/workflows/sm600-gtao.yml').read_text(encoding='utf-8') if (ROOT/'.github/workflows/sm600-gtao.yml').exists() else ''
require("steelmoth-webgpu-gtao/v1" in engine,'SM-600 module schema missing')
require("Math.ceil(width/2)" in engine and "half-horizon" in engine,'SM-600 must remain explicitly half-resolution')
require("directions:6" in engine and "directions:[4,8]" in engine,'SM-600 bounded 6-direction default / 4-8 range missing')
require("steps:4" in engine and "steps:[2,6]" in engine,'SM-600 bounded sample-step policy missing')
require("depthRangeView" in engine and "normalView" in engine,'SM-600 canonical depth+normal inputs missing')
require("sourceFromPaths(depthHierarchy,gbuffer)" in engine and "depthHierarchy.levelView(0)" in engine,'SM-600 must consume SM-203 hierarchy rather than private depth')
require("source.depthHierarchy.valid===false" in engine,'SM-600 stale hierarchy rejection missing')
require("depth-aware-upsample" in engine and "depthSigma" in engine and "normalPower" in engine,'SM-600 depth/normal-aware reconstruction missing')
require("temporalHistory:false" in engine,'SM-600 must explicitly remain non-temporal')
require("recommendedMaterialAOStrength:.50" in engine and "gtaoStrength:1.0" in engine,'SM-600 material-AO separation recommendation missing')
require("gtaoVisibility" in engine and "SM-307 gtaoVisibilityView" in engine,'SM-600 SM-307 binding contract missing')
require("gtaoVisibilityView" in visibility and "sourceFromPaths" in visibility,'SM-307 reserved GTAO consumer path missing')
require("strongest-occluder/min semantics" in doc and "intra-object" in doc and "inter-surface/world" in doc,'SM-600 material AO / GTAO separation not documented')
require("0.7–1.2 ms" in doc and "SM-601" in doc,'SM-600 must preserve target-hardware timing boundary for SM-601')
for fixture in ('box','bin','cabinet','dense'):
    require(fixture in det,f'SM-600 deterministic representative fixture missing: {fixture}')
require("enabled:false" in det and "neutral visibility" in det,'SM-600 disabled-mode deterministic proof missing')
require("WebGPUDepthHierarchy" in smoke and "hierarchy.build" in smoke,'SM-600 browser smoke must execute production SM-203 hierarchy')
require("WebGPUVisibilityComposition" in smoke and "gtao.bindings().gtaoVisibility" in smoke,'SM-600 browser smoke must prove SM-307 integration')
require("stale canonical depth hierarchy is rejected" in smoke,'SM-600 browser smoke stale-depth rejection missing')
require("js-webgpu-gtao" in checks and "webgpu-gtao" in checks,'repository verification does not include SM-600 deterministic/source checks')
require("validate_webgpu_gtao_browser.py" in workflow and "validate_webgpu_gtao_contract.py" in workflow,'dedicated SM-600 workflow missing browser/contract gates')
require("GTX 1650" not in workflow or "timing" not in workflow.lower(),'SM-600 hosted workflow must not imply physical GTX timing')
if errors:
    print('SM-600 CONTRACT FAIL')
    for e in errors:print(' -',e)
    raise SystemExit(1)
print('SM-600 CONTRACT PASS: half-resolution non-temporal GTAO -> depth/normal-aware upscale -> SM-307 reserved input')
