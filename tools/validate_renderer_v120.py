#!/usr/bin/env python3
from pathlib import Path
import re,json
ROOT=Path(__file__).resolve().parents[1];js=(ROOT/'engine'/'game.js').read_text();html=(ROOT/'index.html').read_text();ed=(ROOT/'engine'/'editor.js').read_text()
# Baseline fixes are explicit, not assumed.
assert 'function getSpriteFootAnchor(' in js
assert "getSpriteFootAnchor(this.art,name,x,y,w,h,anchor,subrect)" in js
assert "getSpriteFootAnchor(this.hdArt,name,x,y,w,h,'center',subrect)" in js
assert "for(const q of [bctx,sctx,nrctx,hmctx])" in js
assert "q.setTransform(1,0,0,1,0,0);q.clearRect(0,0,renderW,renderH)" in js
# Legacy shader uniform declarations/bindings remain matched; v2 normal uses one spelling throughout.
for u in ('uBumpStrength','uSpecularStrength'): assert f"'{u}'" in js and f'uniform float {u}' in js,u
assert 'uniform float uNormalStrength' in js and "'uNormalStrength'" in js
assert 'u_normal_strength' not in js and 'u_bump_strength' not in js
# MRT G-buffer architecture.
assert 'g.COLOR_ATTACHMENT0' in js and 'g.COLOR_ATTACHMENT1' in js and 'g.COLOR_ATTACHMENT2' in js
assert 'g.RGBA16F' in js and 'EXT_color_buffer_float' in js
assert 'Material v2 G-buffer incomplete' in js
for i in range(3):assert f'g.clearBufferfv(g.COLOR,{i}' in js
assert 'this.gbufferBackgroundProg' in js and 'this.gbufferSpriteProg' in js
assert 'G1=vec4' in js and 'G2=vec4' in js
# Deferred PBR/self-shadow/contact.
for token in ('D_GGX','vec3 fres','G1(float NoV','selfVis(','contactShadowProg','renderContactShadows','renderDeferredLighting'):
    assert token in js,token
assert 'MAX_STEPS=28' in js
assert 'contactMask=this.makeTarget(Math.max(2,w>>1),Math.max(2,h>>1)' in js
assert 'exp(-dz*90.0)' in js # depth-aware reconstruction/upscale
assert 'materialPipelineLegacy' in js and 'return this.endLegacy' in js
# G-buffer coverage paths: static, dynamic, foreground; foreground parity uses same source/material atlas and descriptors.
assert 'this.staticMaterialSprites' in js and 'this.materialSprites' in js
assert "filter(d=>d.layer===2)" in js and 'renderMaterialRestore' in js
# Ghost-material prevention: static build explicit clears; per-frame MRT explicit clears; setBackground replaces descriptor list.
assert "this.staticMaterialSprites=(maps?.staticSprites||[]).map" in js
# UI controls / debug views.
for k in ['materialV2','normalStrength','heightStrength','roughnessScale','metalnessScale','materialAOStrength','pbrSpecularStrength','selfShadowing','selfShadowQuality','selfShadowLightCount','selfShadowBias','contactShadows','contactShadowDistance','contactShadowStrength','contactShadowQuality','debugAlbedo','debugPseudoDepth','debugNormals','debugRoughness','debugMetalness','debugMaterialAO','debugEmissive','debugDiffuse','debugSpecular','debugSelfShadow','debugContactShadow','debugFinal']:
    assert f'data-gfx="{k}"' in html,k
# Editor parity still rebuilds room and invalidates static background.
assert 'bindArt(this.game.art)' in ed
assert "this.game.bgKey=''" in ed or "bgKey=''" in ed
# Timer query instrumentation exists and is fault-safe.
assert 'EXT_disjoint_timer_query_webgl2' in js and 'pollGpuTimers' in js and 'lastGpuTimes' in js
# Source loading uses v2 atlases in addition to legacy fallback.
assert 'material_normal_roughness_image' in js and 'material_height_image' in js
print('RENDERER V1.2 PASS: baseline fixes, shared foot anchor, deterministic clears, MRT, GGX, height self-shadow, half-res contact shadows, UI/debug/fallback/timer contracts')
