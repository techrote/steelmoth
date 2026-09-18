#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def need(ok,msg):
    if not ok: errors.append(msg)
game=(ROOT/'engine/game.js').read_text(encoding='utf-8')
src=(ROOT/'engine/webgpu_transparent_fx.js').read_text(encoding='utf-8')
scene=(ROOT/'engine/render_scene.js').read_text(encoding='utf-8')
effects=json.loads((ROOT/'game_data/effects.json').read_text(encoding='utf-8'))
need("const MAX_SHADER_FX=16" in src,'SM-206 must retain the WebGL2 renderFX 16-effect GPU cap')
need("const MAX_TRANSPARENT_SPRITES=640" in src,'SM-206 transparent sprite batches must remain explicitly bounded')
need("world-alpha','world-additive','post-effects','top-additive','top-alpha','objective','guide" in src,'SM-206 explicit stage order missing')
need("srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'" in src,'alpha blend contract missing')
need("srcFactor:'src-alpha',dstFactor:'one'" in src,'additive blend contract missing')
need('Half-texel inset prevents sampling a neighboring packed sprite' in src and 'clamp((x+w-.5)/aw,0,1)' in src,'atlas edge half-texel clamp missing')
need("depthWriteEnabled:false,depthCompare:'less-equal'" in src,'world transparent path must consume canonical depth without taking depth ownership')
need("resourcePolicy:'persistent-per-stage-buffers; bounded growth; no gameplay ownership'" in src,'diagnostics must state bounded persistent cosmetic ownership')
need("fallback:'WebGL2 compatibility renderer remains authoritative until promotion'" in src,'fallback authority must remain explicit')
need('textureSample(atlas,samp,v.uv)' in src,'transparent sprite path must sample the atlas in WGSL')
need('const int MAX_FX=16' in game,'baseline WebGL2 renderFX cap changed unexpectedly')
need('g.blendFunc(g.SRC_ALPHA,g.ONE)' in game,'baseline additive blend contract changed unexpectedly')
need('g.blendFunc(g.SRC_ALPHA,blendAdd?g.ONE:g.ONE_MINUS_SRC_ALPHA)' in game,'baseline sprite alpha/additive distinction changed unexpectedly')
need('this.p=a.slice(-300)' in game,'ParticleField post-update live cap changed unexpectedly')
need('if(this.items.length>18)this.items.splice(0,this.items.length-18)' in game,'ShaderFX retained-item cap changed unexpectedly')
need('this.renderFX(effects);this.spriteFlush(this.topGlow' in game and 'this.renderObjectiveMarker(objectiveMarker);this.renderGuideFX(guide)' in game,'baseline post/top/objective/guide ordering changed unexpectedly')
need("proceduralLayer('procedural:effects','effects','post-world'" in scene,'RenderScene effects descriptor missing')
need("overlays:{guide:clone(frame.guide||null),objectiveMarker:clone(frame.objectiveMarker||null)}" in scene,'RenderScene objective/guide overlays missing')
need(effects.get('max_active')==18,'game_data/effects.json max_active must remain 18')
need(set(effects.get('presets',{}))=={'pulse','objective_generic','teleport','collectible_pickup','portal_start','portal_end'},'effect preset set changed; review SM-206 parity surface')
need(all(len(v.get('params',[]))==4 for v in effects.get('presets',{}).values()),'all current shader-effect presets require four params')
if errors:
    print('SM-206 transparent FX contract FAIL')
    for e in errors: print(' -',e)
    raise SystemExit(1)
print('SM-206 transparent FX contract PASS: baseline caps/order/blend, atlas sampling, bounded WebGPU ownership and fallback are coherent')
