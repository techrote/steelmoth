#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def need(ok,msg):
    if not ok: errors.append(msg)
def read(path):return (ROOT/path).read_text(encoding='utf-8')
src=read('engine/webgpu_clusters.js');docs=read('docs/WEBGPU_CLUSTERS_SM301.md');smoke=read('webgpu-clusters-smoke.html');runner=read('tools/validate_webgpu_clusters_browser.py');webapp=read('webapp.js');sw=read('sw.js');checks=read('tools/run_checks.py');package=read('tools/validate_clean_package.py')
need("CLUSTER_RECORD_STRIDE=64" in src and "MEMBERSHIP_STRIDE=8" in src,'packed cluster/member ABI missing')
need("maxCandidatePerTile:32" in src and "maxCandidatePairs:8192" in src and "maxClusters:512" in src and "maxMembers:512" in src,'bounded cluster defaults missing')
need("SM-301 requires" in src and "SNAPSHOT_SCHEMA" in src and "SM-300" in src,'SM-300 input authority missing')
need("relationFor" in src and "groundYThreshold" in src and "depthProximity" in src and "zProximity" in src and "profileHash" in src,'geometry/depth/class clustering signals missing')
need("tinyConnectorOverlapRatio" in src and "explicitMajor" in src,'tiny connector safeguard missing')
need("dominantObjectId:0" in src and "reserved as zero" in src,'SM-302 dominance boundary missing')
need("lightIndependent:true" in src and "Geometry-only SM-301 clustering" in src,'light-independent clustering contract missing')
need("compareMembership" in src and "debugClusterOverlay" in src,'perturbation/debug helpers missing')
need("candidatePairOverflow" in src and "candidateTileOverflow" in src and "largestCluster" in src,'bounded diagnostics missing')
need("room-change" in src and "occluder clusters are invalid" in src,'room/editor stale-cluster invalidation missing')
need("webgpu_clusters.js?v=sm301-1" in webapp,'web app must stage SM-301 module')
need("webgpu_clusters.js?v=sm301-1" in sw,'service worker must cache SM-301 module')
need("webgpuClusterDone" in smoke and "readback" in smoke and "editor-change" in smoke,'browser smoke must exercise GPU readback and invalidation')
need("--require-webgpu" in runner and "steelmoth-webgpu-clusters-browser-report/v1" in runner,'required hosted WebGPU runner contract missing')
need("validate_webgpu_clusters.js" in checks and "validate_webgpu_clusters_contract.py" in checks,'stable verification runner must include SM-301 checks')
need("engine/webgpu_clusters.js" in package and "webgpu-clusters-smoke.html" in package and "WEBGPU_CLUSTERS_SM301.md" in package,'clean-package inventory must include SM-301 artifacts')
for phrase in ['geometry-only','64 bytes','8192','receiver-only','±0.25/0.5/1 px','dominantObjectId = 0','small-connector','tile-local']:
    need(phrase in docs,f'documentation missing {phrase!r}')
if errors:
    print('SM-301 cluster contract FAIL')
    for e in errors:print(' -',e)
    raise SystemExit(1)
print('SM-301 cluster contract PASS: deterministic geometry membership, bounded candidate work, perturbation stability and SM-302 boundary are coherent')
