#!/usr/bin/env python3
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[1]
# Required static runtime payload.
required=[
 'index.html','style.css','webapp.js','sw.js','manifest.webmanifest','game_manifest.json','DEPLOYMENT_MANIFEST.json',
 'engine/game.js','engine/editor.js','engine/surfacefx.js','engine/foliagefx.js',
 'game_data/maps.json','game_data/story.json','game_data/sprites.json','game_data/luts.json','game_data/effects.json',
 'assets/generated/atlas.json','assets/generated/sprite_runtime_atlas.png','assets/generated/sprite_material_normal_roughness.png','assets/generated/sprite_material_height_material.png',
 'assets/generated/sprite_bumpmap.png','assets/generated/sprite_specularmap.png'
]
for f in required: assert (ROOT/f).is_file(),f
# HTML relative JS/style closure.
h=(ROOT/'index.html').read_text()
for src in re.findall(r'(?:src|href)="([^"]+)"',h):
    if src.startswith(('http:','https:','#','data:')):continue
    q=src.split('?',1)[0]
    if q.endswith(('.js','.css','.webmanifest')):assert (ROOT/q).is_file(),q
# JS data fetch closure and atlas-owned material images.
js=(ROOT/'engine/game.js').read_text()
for p in re.findall(r"loadJSON\('([^']+)'",js):
    q=p.split('?',1)[0]
    assert (ROOT/q).is_file(),p
atlas=json.loads((ROOT/'assets/generated/atlas.json').read_text())
for k in ['image','bump_image','specular_image','material_normal_roughness_image','material_height_image']:
    p=atlas[k];assert (ROOT/p).is_file(),(k,p)
assert atlas.get('material_v2',{}).get('schema')=='steel-moth-material-v2/v1'
# Project / deploy versions and PWA cache.
gm=json.loads((ROOT/'game_manifest.json').read_text());dm=json.loads((ROOT/'DEPLOYMENT_MANIFEST.json').read_text())
assert gm['version']=='1.2.3';assert dm['game_version']=='1.2.3';assert gm['graphics_namespace']=='signalOrchardGraphicsV123'
sw=(ROOT/'sw.js').read_text();assert "small-machine-web-v1.2.3-r1" in sw
assert (ROOT/'0Play-Webapp-v1.2.3.bat').is_file()
# Story/map core unchanged.
story=json.loads((ROOT/'game_data/story.json').read_text());maps=json.loads((ROOT/'game_data/maps.json').read_text())
assert len(story['rooms'])==9 and len(maps['rooms'])==9
assert sum(len(r.get('objects',[])) for r in story['rooms'])==27
# Material/renderer source contracts.
for token in ['materialV2:true','materialPipelineLegacy:false','getSpriteFootAnchor(','makeGBuffer(','renderGBuffer(','renderDeferredLighting(','renderContactShadows(']:assert token in js,token
# Static deployment cannot accidentally depend on Python/Node runtime.
assert dm.get('server_side_runtime_required') is False
print('WEBAPP V1.2 FAMILY PASS: static dependency closure, current manifests/cache, 9 rooms/27 objectives, Material-v2/G-buffer runtime assets present')
