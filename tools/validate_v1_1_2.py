from __future__ import annotations
from pathlib import Path
from PIL import Image
import json, math, re
ROOT=Path(__file__).resolve().parents[1]
A=json.loads((ROOT/'assets/generated/atlas.json').read_text())
M=A['region_meta']; R=A['regions']; ws=float(A['world_scale'])
profiles={n:m['shadow_profile'] for n,m in M.items() if isinstance(m,dict) and m.get('shadow_profile',{}).get('version')=='1.1.2'}
assert len(profiles)>=20, len(profiles)
max_z=0.0
for n,p in profiles.items():
    assert 'height_px' not in p, n
    hr=float(p['height_ratio']); assert 0.04<=hr<=1.2,(n,hr)
    assert p.get('projection_model')=='grounded-sectioned-silhouette',n
    slices=p.get('slices'); assert isinstance(slices,list) and slices,(n,'slices')
    prev=-1
    for sl in slices:
        alt=float(sl['altitude']); assert 0<=alt<=1 and alt>=prev,(n,alt);prev=alt
        spans=sl.get('spans',[]); assert spans,(n,alt)
        for sp in spans:
            assert float(sp['left']) < float(sp['right']), (n,sp)
    world_h=R[n][3]*ws*float(M[n].get('world_scale',1))*hr
    z=world_h*max(float(sl['altitude']) for sl in slices)
    max_z=max(max_z,z)
assert max_z<32, max_z
# v1.1.1 bug put atlas-height values around 140-170 into a logical-pixel projection.
assert max_z<40

# Aligned material atlas contract.
imgs=[Image.open(ROOT/'assets/generated'/fn).convert('RGBA') for fn in ('sprite_runtime_atlas.png','sprite_bumpmap.png','sprite_specularmap.png')]
assert len({im.size for im in imgs})==1 and imgs[0].size==(4096,4096)
for n in profiles:
    x,y,w,h=R[n]
    alphas=[im.crop((x,y,x+w,y+h)).getchannel('A').tobytes() for im in imgs]
    assert alphas[0]==alphas[1]==alphas[2],n

js=(ROOT/'engine/game.js').read_text()
assert "version:'1.2.2'" in js
assert "macro grounded-sectioned-silhouette-v1.1.2 + Material-v2 pseudo-depth self/contact shadows" in js
assert 'height_ratio??.72' in js
assert 'profile.height_px' not in js
assert 'raycastHardLightDistance' in js
assert js.count('raycastHardLightDistance(cone.x,cone.y')>=2
assert 'robotVisibilityAt' in js and 'this.room.raycastDistance(cone.x,cone.y' in js
assert 'addSpriteCaster(name,x,b,w,h' in js
assert 'wall:${key}:${name}' in js
assert 'height:84' in js
assert 'proj=clamp(' in js and ',0,1.60)' in js

# Current authored wall sprites are free-standing prop types, so they should not hard-cut the cone.
maps=json.loads((ROOT/'game_data/maps.json').read_text())
wall_names=set()
for room in maps['rooms'].values():
    for style in room.get('blocker_styles',{}).values():
        n=style.get('sprite')
        if n: wall_names.add(n)
for n in wall_names:
    p=M.get(n,{}).get('shadow_profile')
    if p:
        assert not p.get('hard_light_occluder',False),(n,'unexpected hard beam cut')

print(f'V1.1.2 TERRAIN SHADOW PASS: {len(profiles)} sectioned profiles; max sampled world height={max_z:.2f}px; material alpha alignment exact')
