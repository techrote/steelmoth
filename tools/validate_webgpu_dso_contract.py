#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def text(rel): return (ROOT/rel).read_text(encoding='utf-8')
def need(hay,needle,label):
    if needle not in hay: raise SystemExit(f'SM-303 contract FAIL: {label}: missing {needle!r}')
engine=text('engine/webgpu_dso.js');doc=text('docs/WEBGPU_DSO_SM303.md');webapp=text('webapp.js');sw=text('sw.js');workflow=text('.github/workflows/sm303-dso.yml')
need(engine,"SNAPSHOT_SCHEMA='steelmoth-webgpu-dso-snapshot/v1'",'snapshot schema')
need(engine,'texture_storage_2d<r32float, write>','real WebGPU hard-mask storage output')
need(engine,'onePrimaryWedgePerCluster:true','one full macro owner per cluster')
need(engine,'secondaryFullStrengthWedgeCount:0','secondary members never emit equal full macro wedges')
need(engine,'tileHeaders','tile-local bounded work')
need(engine,'rasterizeDSOReference','deterministic structural reference')
need(engine,'connectedMetrics','mask structural metrics')
need(engine,'distanceSimplification:false','SM-304 remains deferred')
need(engine,'darkBloom:false','SM-305 remains deferred')
need(engine,'temporalAccumulation:false','SM-306 remains deferred')
need(doc,'One dominant owner emits the full-length hard macro wedge','documented dominance contract')
need(doc,'disconnected shadow island count','documented structural metrics')
need(doc,'0°, 45°, 90°, 135°, 180°, 225°, 270°, and 315°','documented eight-angle evidence')
need(doc,'SM-304','distance hierarchy scope boundary');need(doc,'SM-305','Dark Bloom scope boundary');need(doc,'SM-306','temporal scope boundary')
need(webapp,'./engine/webgpu_dso.js?v=sm303-1','runtime staging');need(sw,'./engine/webgpu_dso.js?v=sm303-1','offline cache staging')
need(workflow,'validate_webgpu_dso_browser.py --require-webgpu','required real-WebGPU gate');need(workflow,'webgpu-dso-smoke.html','browser fixture workflow scope')
print('SM-303 DSO source/document/runtime contract: PASS')
