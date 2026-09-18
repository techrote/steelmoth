#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def need(ok,msg):
    if not ok: errors.append(msg)
def read(path):return (ROOT/path).read_text(encoding='utf-8')
src=read('engine/webgpu_occluders.js');docs=read('docs/WEBGPU_OCCLUDERS_SM300.md');smoke=read('webgpu-occluders-smoke.html');runner=read('tools/validate_webgpu_occluders_browser.py');webapp=read('webapp.js');sw=read('sw.js')
need("RECORD_STRIDE=64" in src and "TILE_HEADER_STRIDE=8" in src,'packed occluder/tile ABI missing')
need("maxOccluders:512" in src and "maxPerTile:32" in src and "maxTileRefs:8192" in src,'bounded default caps missing')
need("objectIdForStableId" in src and "objectIdForOccluder" in src,'shared stable object-ID authority missing')
need("receiverOnly" in src and "majorOccluder" in src and "tinyArea:72" in src,'metadata/geometry tiny-decor policy missing')
need("staticSignature" in src and "dynamicSignature" in src and "dynamicOffset" in src,'static/dynamic update strategy missing')
need("room-change" in src and "occluder bins are invalid" in src,'room/editor stale-binding invalidation missing')
need("debugTileOverlay" in src,'debug tile visualization data missing')
need("does not build a second depth pyramid" in src,'SM-203 shared-depth boundary missing')
need("webgpu_occluders.js?v=sm300-1" in webapp,'web app must stage SM-300 module')
need("webgpu_occluders.js?v=sm300-1" in sw,'service worker must cache SM-300 module')
need("webgpuOccluderDone" in smoke and "readback" in smoke and "editor-change" in smoke,'browser smoke must exercise readback and invalidation')
need("--require-webgpu" in runner and "steelmoth-webgpu-occluders-browser-report/v1" in runner,'required hosted WebGPU runner contract missing')
for phrase in ['64 bytes','receiver-only','8192','dynamic-only','SM-203','does not create clusters or shade shadows']:
    need(phrase in docs,f'documentation missing {phrase!r}')
if errors:
    print('SM-300 occluder contract FAIL')
    for e in errors:print(' -',e)
    raise SystemExit(1)
print('SM-300 occluder contract PASS: identity, bounded tile relevance, invalidation and SM-203 boundary are coherent')
