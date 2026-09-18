#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def need(ok,msg):
    if not ok: errors.append(msg)
def read(path):return (ROOT/path).read_text(encoding='utf-8')
src=read('engine/webgpu_dominance.js');docs=read('docs/WEBGPU_DOMINANCE_SM302.md');smoke=read('webgpu-dominance-smoke.html');runner=read('tools/validate_webgpu_dominance_browser.py');webapp=read('webapp.js');sw=read('sw.js');checks=read('tools/run_checks.py');package=read('tools/validate_clean_package.py')
need("RECORD_STRIDE=48" in src and "maxDominanceRecords:8704" in src,'bounded dominance ABI/default missing')
need("SM-302 requires" in src and "Clusters.SNAPSHOT_SCHEMA" in src and "Occluders.SNAPSHOT_SCHEMA" in src,'SM-301/SM-300 input authority missing')
need("exposedSilhouette" in src and "lightExposure" in src and "pseudoHeight" in src and "frontDepth" in src,'required dominance score components missing')
need("hysteresisAbsolute:.055" in src and "hysteresisRatio:.10" in src and "HYSTERESIS_HELD" in src and "SWITCHED" in src,'explicit hysteresis threshold/state missing')
need("singleOwnerPerClusterLight:true" in src and "allMembersFullShadow:false" in src,'single-owner/no-all-members fallback contract missing')
need("debugDominanceOverlay" in src and "memberScores" in src and "challengerDelta" in src,'owner/score debug data missing')
need("room mismatch" in src and "room-change" in src and "dominant occluders are invalid" in src,'room/editor stale-history invalidation missing')
need("webgpu_dominance.js?v=sm302-1" in webapp,'web app must stage SM-302 module')
need("webgpu_dominance.js?v=sm302-1" in sw,'service worker must cache SM-302 module')
need("webgpuDominanceDone" in smoke and "readback" in smoke and "timeline" in smoke and "HYSTERESIS_HELD" in smoke,'browser smoke must exercise GPU readback, timeline and hysteresis')
need("Page.captureScreenshot" in runner and "--require-webgpu" in runner and "steelmoth-webgpu-dominance-browser-report/v1" in runner,'hosted WebGPU debug-evidence runner contract missing')
need("validate_webgpu_dominance.js" in checks and "validate_webgpu_dominance_contract.py" in checks,'stable verification runner must include SM-302 checks')
need("engine/webgpu_dominance.js" in package and "webgpu-dominance-smoke.html" in package and "WEBGPU_DOMINANCE_SM302.md" in package,'clean-package inventory must include SM-302 artifacts')
for phrase in ['Exposed silhouette','Pseudo-height','Front depth','0.055','±1–2°','48 bytes','8,704','single-owner','SM-303']:
    need(phrase in docs,f'documentation missing {phrase!r}')
if errors:
    print('SM-302 dominance contract FAIL')
    for e in errors:print(' -',e)
    raise SystemExit(1)
print('SM-302 dominance contract PASS: directional exposed-silhouette scoring, stable single-owner hysteresis, bounded GPU data and SM-303 boundary are coherent')
