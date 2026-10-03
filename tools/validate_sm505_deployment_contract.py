#!/usr/bin/env python3
from __future__ import annotations
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def read(path):return (ROOT/path).read_text(encoding='utf-8')
def need(value,label,errors):
    if not value:errors.append(label)

def main():
    errors=[];sw=read('sw.js');manifest=json.loads(read('DEPLOYMENT_MANIFEST.json'));deploy=read('DEPLOY.md');readme=read('README_WEBAPP.md');index=read('index.html');webapp=read('webapp.js');device=read('engine/webgpu_device.js');presenter=read('engine/webgpu_scene_presenter.js')
    revision='small-machine-web-v1.2.3-r27'
    need(f"const CACHE = '{revision}'" in sw,'service worker cache is not r27',errors)
    need(manifest.get('distribution_revision')==27,'deployment manifest distribution_revision is not 27',errors)
    need(manifest.get('service_worker_cache')==revision,'deployment manifest cache identity does not match r27',errors)
    need(manifest.get('renderer_candidate')=='sm505-normal-webgpu-presentation','deployment manifest missing SM-505 candidate identity',errors)
    need(manifest.get('renderer_presentation_asset_revision')=='sm505-1','deployment manifest missing sm505-1 presentation revision',errors)
    need(manifest.get('auto_webgpu_enabled') is False,'deployment manifest must keep Auto WebGPU disabled',errors)
    need("const AUTO_WEBGPU_ENABLED=false" in device,'source Auto WebGPU gate must remain false',errors)
    for path in ['engine/game.js?v=sm505-1','webapp.js?v=sm505-1']:
        need(path in sw and path in index,f'entry asset revision is not coherent for {path}',errors)
    for path in ['engine/webgl2_scene_adapter.js?v=sm505-1','engine/webgpu_scene_presenter.js?v=sm505-1','engine/backend_runtime.js?v=sm505-1']:
        need(path in sw and path in webapp,f'presentation asset revision is not coherent for {path}',errors)
    need(revision in deploy and revision in readme,'deployment/PWA docs do not both name r27',errors)
    need('small-machine-web-v1.2.3-r1' not in deploy and 'small-machine-web-v1.2.3-r1' not in readme,'stale r1 deployment identity remains in live docs',errors)
    need('webgpu_gtao' not in presenter.lower(),'SM-505 presenter must not auto-enable later GTAO work',errors)
    need("gtao:false" in presenter and "gtaoEnabled:false" in presenter,'SM-505 presenter must explicitly retain GTAO-off candidate semantics',errors)
    if errors:
        print('SM-505 DEPLOYMENT CONTRACT FAIL',file=sys.stderr)
        for e in errors:print(' -',e,file=sys.stderr)
        return 1
    print('SM-505 DEPLOYMENT CONTRACT PASS: r27/sm505-1 cache, manifest, docs, entry assets and GTAO-off candidate identity are coherent')
    return 0
if __name__=='__main__':raise SystemExit(main())
