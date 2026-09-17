#!/usr/bin/env python3
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[1]
required=[
 'index.html','style.css','webapp.js','sw.js','manifest.webmanifest','game_manifest.json','DEPLOYMENT_MANIFEST.json',
 'engine/game.js','engine/editor.js','engine/surfacefx.js','engine/foliagefx.js',
 'engine/render_transform.js','engine/render_transform_integration.js','engine/render_scene.js','engine/render_transform_scene_adapter.js','engine/webgl2_scene_adapter.js',
 'engine/webgpu_device.js','engine/backend_runtime.js','webgpu-smoke.html',
 'game_data/maps.json','game_data/story.json','game_data/sprites.json','game_data/luts.json','game_data/effects.json',
 'assets/generated/atlas.json','assets/generated/sprite_runtime_atlas.png','assets/generated/sprite_material_normal_roughness.png','assets/generated/sprite_material_height_material.png',
 'assets/generated/sprite_bumpmap.png','assets/generated/sprite_specularmap.png','0Play-Webapp-v1.2.3.bat'
]
for f in required: assert (ROOT/f).is_file(),f
h=(ROOT/'index.html').read_text()
for src in re.findall(r'(?:src|href)="([^"]+)"',h):
    if src.startswith(('http:','https:','#','data:')): continue
    q=src.split('?',1)[0]
    if q.endswith(('.js','.css','.webmanifest')): assert (ROOT/q).is_file(),q
js=(ROOT/'engine/game.js').read_text(); sw=(ROOT/'sw.js').read_text(); web=(ROOT/'webapp.js').read_text()
atlas=json.loads((ROOT/'assets/generated/atlas.json').read_text())
for k in ['image','bump_image','specular_image','material_normal_roughness_image','material_height_image']:
    assert (ROOT/atlas[k]).is_file(),(k,atlas[k])
assert atlas.get('material_v2',{}).get('schema')=='steel-moth-material-v2/v1'
gm=json.loads((ROOT/'game_manifest.json').read_text());dm=json.loads((ROOT/'DEPLOYMENT_MANIFEST.json').read_text())
assert gm['version']=='1.2.3'; assert dm['game_version']=='1.2.3'; assert gm['graphics_namespace']=='signalOrchardGraphicsV123'
assert "small-machine-web-v1.2.3-r3" in sw
assert 'sw.js?v=1.2.3' in web
assert "localPreview = location.hostname === 'localhost' || location.hostname === '127.0.0.1'" in web
assert "k.startsWith('small-machine-web-')" in web and 'clearLocalPreviewCaches' in web
for token in ['engine/game.js?v=1.2.3','engine/surfacefx.js?v=1.2.3','engine/foliagefx.js?v=1.2.3']:
    assert token in h, token
for token in ['render_transform.js?v=sm101-1','render_transform_integration.js?v=sm101-1','render_transform_scene_adapter.js?v=sm101-1','webgpu_device.js?v=sm102-1','backend_runtime.js?v=sm102-1']:
    assert token in web and token in sw, token
story=json.loads((ROOT/'game_data/story.json').read_text()); maps=json.loads((ROOT/'game_data/maps.json').read_text())
assert len(story['rooms'])==9 and len(maps['rooms'])==9 and sum(len(r.get('objects',[])) for r in story['rooms'])==27
assert dm.get('server_side_runtime_required') is False
assert dm.get('player_cone_occlusion_rays_quality3')==193 and dm.get('player_omni_occlusion_rays_quality3')==257
print('WEBAPP V1.2.3 PASS: version/cache closure, 9 rooms/27 objectives, Material-v2 assets, SM-101 transforms and SM-102 lifecycle modules present, 193/257-ray visibility profile declared')
