#!/usr/bin/env python3
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[1]
game=(ROOT/'engine/game.js').read_text()
surface=(ROOT/'engine/surfacefx.js').read_text()
foliage=(ROOT/'engine/foliagefx.js').read_text()
luts=json.loads((ROOT/'game_data/luts.json').read_text())

# Root-cause regression: Fine GrassField must not use the amber WORLD/MATERIALS LUTs.
assert "baseColor:this.luts.rgb('fx_creature',82)" in game
assert "tipColor:this.luts.rgb('fx_creature',148)" in game
assert "highlightColor:this.luts.rgb('fx_water',190)" in game
render_line=next(x for x in game.splitlines() if 'const water=' in x and 'grass={' in x)
assert "grass={time,baseColor:this.luts.rgb('far_forest'" not in render_line
assert "grass={time,baseColor:this.luts.rgb('fx_creature'" in render_line

# Screenshot evidence maps to the old Dusk Rust vegetation palette.
dusk=luts['themes']['Dusk Rust']['luts']
assert dusk['far_forest'][176].upper()=='#755F40'
assert dusk['far_forest'][250].upper()=='#B98E52'
assert dusk['tree_lights'][244].upper()=='#BE9153'
wet=luts['themes']['Wet Relay']['luts']
assert wet['fx_creature'][82].upper() != dusk['far_forest'][176].upper()

# Fine grass is now scene-light-aware instead of an emissive-looking independent overlay.
for token in ['uniform sampler2D uScene','uniform vec2 uMainLightPos','uUseSceneLight','sceneLum','visibility','clamp(a,0.0,.42)']:
    assert token in surface, token
assert '(1.04+.24*vTint)' not in surface, 'old over-opaque GrassField alpha returned'
assert 'sceneTex||this.fallbackScene' in surface

# FoliageFX shares both the lit-scene visibility and Material-v2 normal field.
for token in ['uNormalRoughnessTex','uUseMaterialV2Normals','uScene','uUseSceneLight','sceneLum','visibility']:
    assert token in foliage, token
assert 'this.materialNRTex' in game

# Angular hard-light occlusion resolution is raised enough that quality 3 is ~1px angular spacing at full throw.
assert 'MAX_CONE_OCCLUSION_RAYS=193,MAX_OMNI_OCCLUSION_RAYS=257' in game
assert 'q===1?[49,65]:q===2?[97,129]:[193,257]' in game

# All three forward/deferred light-direction conventions agree on +X, -screenY, +Z.
assert 'vec3 L=normalize(vec3(delta.x,-delta.y,72.0))' in surface
assert 'vec3 L=normalize(vec3(delta.x,-delta.y,88.0))' in foliage
assert 'vec3 L=normalize(vec3(Ld.x,-Ld.y,Ld.z))' in game

print('V1.2.3 SURFACE COHERENCE PASS: amber Fine GrassField root cause removed; grass/foliage use lit scene; foliage consumes Material-v2 normals; 193/257-ray hard-light profile')
