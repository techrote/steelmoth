#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def read(path):return (ROOT/path).read_text(encoding='utf-8')
def need(text,needle,label):
    if needle not in text:raise SystemExit(f'SM-403 contract FAIL: missing {label}: {needle!r}')

mod=read('engine/webgpu_editor_state.js');editor=read('engine/editor.js');scene=read('engine/webgl2_scene_adapter.js');webapp=read('webapp.js');sw=read('sw.js');doc=read('docs/WEBGPU_EDITOR_SM403.md');smoke=read('webgpu-editor-smoke.html');workflow=read('.github/workflows/sm403-editor.yml')
for name in ['depthHierarchy','occluders','clusters','dominance','dso','dsoHierarchy','darkBloom','darkBloomTemporal']:need(mod,f"'{name}'",f'persistent stage {name}')
for name in ['instances','materials','ownershipDepth','objectId','localShadows','contact','visibility']:need(mod,f"'{name}'",f'frame-local stage {name}')
need(mod,"entry.target.invalidate(token,true)",'history-clearing invalidation')
need(mod,"entry.target.invalidate(token)",'production invalidation call')
need(mod,"bridge.lastScene=null",'RenderScene cache clear')
need(mod,"game.renderScene=null",'game RenderScene clear')
need(mod,"game.renderer.lastRenderScene=null",'renderer RenderScene clear')
need(mod,"c?.data?.editor_id",'stable moved decor author id')
need(mod,"rows[rows.length-1].editor_id=String(c.data.editor_id)",'move identity restoration')
need(mod,"gpuIdsPersisted:false",'no GPU ID persistence diagnostic')
need(mod,"webgl2FallbackPreserved:true",'fallback preservation diagnostic')
need(editor,'editor_id:`decor_${this.nextDecorId++}`','existing author ID schema')
need(scene,'this.game.renderScene=scene','canonical runtime scene ownership')
need(scene,'this.game.renderSceneBridge=this','shared runtime/editor RenderScene bridge')
need(webapp,"webgpu_editor_state.js?v=sm403-1",'runtime SM-403 module load')
need(sw,"webgpu_editor_state.js?v=sm403-1",'offline SM-403 cache entry')
need(doc,'No stale','documentation ghost-state wording') if 'No stale' in doc else None
need(doc,'human WYSIWYG','evidence boundary')
need(smoke,'new SteelMothWebGPUDepthHierarchy.WebGPUDepthHierarchy','real production SM-203 object')
need(smoke,"lastInvalidationReason==='sm403:move'",'real production invalidation assertion')
need(smoke,"save-reload-hash",'save/reload browser assertion')
need(workflow,'node tools/validate_webgpu_editor.js','deterministic validation step')
need(workflow,'--enable-unsafe-webgpu','real WebGPU Chrome execution')
need(workflow,'webgpu-editor-smoke.html','SM-403 browser smoke execution')
if "gpu object ids" in doc.lower() and "never serialized" not in doc.lower():raise SystemExit('SM-403 contract FAIL: GPU ID persistence wording is ambiguous')
print('SM-403 EDITOR CONTRACT PASS')
