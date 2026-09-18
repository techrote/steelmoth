#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def read(path):return (ROOT/path).read_text(encoding='utf-8')
def need(text,needle,label):
    if needle not in text:raise SystemExit(f'SM-404 contract FAIL: missing {label}: {needle!r}')

mod=read('engine/webgpu_transition_state.js')
webapp=read('webapp.js')
sw=read('sw.js')
doc=read('docs/WEBGPU_TRANSITIONS_SM404.md')
workflow=read('.github/workflows/sm404-transitions.yml')
smoke=read('webgpu-transition-smoke.html')

for reason in ['room-change','room-load','project-reload','resize','backend-reconfigure','device-rebuild']:
    need(mod,f"'{reason}'",f'invalidation profile {reason}')
for name in ['objectId','depthHierarchy','occluders','clusters','dominance','dso','dsoHierarchy','darkBloom','darkBloomTemporal','water','foliage','ordering']:
    need(mod,f"'{name}'",f'resource class {name}')
need(mod,"this.roomEpoch++",'room epoch advancement')
need(mod,"this.surfaceEpoch++",'surface epoch advancement')
need(mod,"this.backendEpoch++",'backend epoch advancement')
need(mod,"this.records.delete(name)",'stale derived-record rejection')
need(mod,"target.invalidate(token",'production invalidation dispatch')
need(mod,"clearHistory",'history-clearing dispatch')
need(mod,"clearSceneCapture(this,'room-change')",'pre-enter room scene clear')
need(mod,"original.apply(this,arguments)",'existing room/backend path preservation')
need(mod,"reason==='resize'",'selective resize profile')
need(mod,"blanketReset:false",'no blanket reset diagnostic')
if 'resetEverything' in mod:raise SystemExit('SM-404 contract FAIL: blanket resetEverything implementation is forbidden')
need(webapp,"webgpu_transition_state.js?v=sm404-1",'runtime SM-404 module load')
need(webapp,"installRuntimeIntegration",'runtime transition integration install')
need(sw,"webgpu_transition_state.js?v=sm404-1",'offline SM-404 cache entry')
need(doc,'Geometry-only occluders, clusters','selective resize documentation')
need(doc,'Device loss','device-loss documentation')
need(doc,'cycles every room repeatedly','all-room regression documentation')
need(smoke,'WebGPUDepthHierarchy','real SM-203 resource')
need(smoke,'ResourceRegistry','real SM-103 resource registry')
need(smoke,'surface-texture-rebuilt','real resize-dependent texture assertion')
need(workflow,'node tools/validate_webgpu_transition.js','deterministic validator execution')
need(workflow,'python tools/validate_webgpu_transition_contract.py','contract validator execution')
need(workflow,'--enable-unsafe-webgpu','real WebGPU Chrome execution')
print('SM-404 TRANSITION CONTRACT PASS')
