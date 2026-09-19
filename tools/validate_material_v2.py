#!/usr/bin/env python3
from pathlib import Path
from PIL import Image
import json, hashlib, numpy as np
ROOT=Path(__file__).resolve().parents[1];GEN=ROOT/'assets'/'generated'
a=json.loads((GEN/'atlas.json').read_text());r=json.loads((GEN/'material_v2_report.json').read_text())
assert a.get('material_v2',{}).get('schema')=='steel-moth-material-v2/v1'
assert a.get('material_v2',{}).get('semantics_version')=='SM-503/v1'
assert r.get('schema')=='steel-moth-material-v2-report/v1' and r.get('version')=='1.3.0'
assert r.get('semantics_version')=='SM-503/v1' and r.get('max_world_z')==64.0
regions=a['regions'];meta=a['region_meta'];report=r['regions'];assert len(regions)==314==len(report)
imgs={n:Image.open(GEN/f).convert('RGBA') for n,f in {
'albedo':'sprite_runtime_atlas.png','nr':'sprite_material_normal_roughness.png','hm':'sprite_material_height_material.png','bump':'sprite_bumpmap.png','spec':'sprite_specularmap.png'}.items()}
sizes={im.size for im in imgs.values()};assert sizes=={tuple(a['source_size'])},sizes
for n,(x,y,w,h) in regions.items():
    assert x>=0 and y>=0 and x+w<=imgs['albedo'].width and y+h<=imgs['albedo'].height,n
    assert n in meta and 'material_v2' in meta[n] and n in report,n
    al=np.asarray(imgs['albedo'].crop((x,y,x+w,y+h)))
    nr=np.asarray(imgs['nr'].crop((x,y,x+w,y+h)))
    hm=np.asarray(imgs['hm'].crop((x,y,x+w,y+h)))
    opaque=al[:,:,3]>=32;assert opaque.any(),f'{n}: empty albedo'
    trans=al[:,:,3]<=5
    if trans.any():
        assert np.all(nr[trans,:3]==np.array([128,128,255],dtype=np.uint8)),f'{n}: transparent NR bleed'
        assert np.all(hm[trans]==np.array([0,255,0,0],dtype=np.uint8)),f'{n}: transparent HM bleed'
    nn=nr[opaque,:3].astype(np.float32)/255*2-1;length=np.sqrt((nn*nn).sum(axis=1));assert np.percentile(length,5)>.92 and np.percentile(length,95)<1.08,f'{n}: bad normal lengths'
    assert np.all((nr[opaque,3]>=8)&(nr[opaque,3]<=255)),f'{n}: roughness out of range'
    assert np.all(hm[opaque,1]>=32),f'{n}: AO unexpectedly black'
    mv=meta[n]['material_v2']; rr=report[n]
    assert 0<mv['heightScaleWorld']<=64 and mv['rootAnchor']==[.5,1.0]
    assert mv['heightEncodingMaxWorld']==64.0 and mv['material_ao_semantics']=='intra-object-cavity-only'
    assert mv['height_scale']==mv['heightScaleWorld'] and mv['height_bias']==mv['heightBiasWorld'] and mv['root_anchor']==mv['rootAnchor']
    assert mv['material_prior']==rr['material_prior']

# Standing sprites have a true zero-height visible root shared by pseudo-depth and shadows.
for n in ['cargo_crate','rust_barrel','street_lamp','pipe_cluster','scaffold','hex_maintenance_idle_0','player_idle_0']:
    x,y,w,h=regions[n]
    al=np.asarray(imgs['albedo'].crop((x,y,x+w,y+h)))
    hm=np.asarray(imgs['hm'].crop((x,y,x+w,y+h)))
    mask=al[:,:,3]>=32;ys=np.where(mask.any(axis=1))[0];assert ys.size,n
    bottom=int(ys.max());bm=mask[bottom];assert bm.any(),n
    assert int(hm[bottom,bm,0].max())==0,f'{n}: visible root pseudo-height is non-zero'

classes={n:v['material_class'] for n,v in report.items()}
priors={n:v['material_prior'] for n,v in report.items()}
for n,c in {'floor_plate':'flat','door_heavy':'vertical_plane','cargo_crate':'box','rust_barrel':'barrel','street_lamp':'pole','scaffold':'frame','pipe_cluster':'pipe','hex_maintenance_idle_0':'robot','player_idle_0':'character'}.items():assert classes[n]==c,(n,classes[n])
for n,p in {'floor_plate':'painted_steel','cargo_crate':'painted_steel','rust_barrel':'rusted_steel','street_lamp':'galvanized','pipe_cluster':'galvanized','scaffold':'galvanized'}.items():assert priors[n]==p,(n,priors[n])
assert report['floor_plate']['heightScaleWorld']<3
for n in ['rust_barrel','street_lamp']:
 x,y,w,h=regions[n];al=np.asarray(imgs['albedo'].crop((x,y,x+w,y+h)));nr=np.asarray(imgs['nr'].crop((x,y,x+w,y+h)));m=al[:,:,3]>80;nx=nr[:,:,0].astype(float)/255*2-1;assert np.std(nx[m])>.18,(n,np.std(nx[m]))

# Material priors are semantically bounded: rust/paint are not treated as solid metal,
# while galvanized structural hardware remains metallic.
assert report['rust_barrel']['metalness_mean']<.45
assert report['cargo_crate']['metalness_mean']<.45
for n in ('street_lamp','pipe_cluster','scaffold'):assert report[n]['metalness_mean']>.50,(n,report[n]['metalness_mean'])
assert all(v['material_ao_semantics']=='intra-object-cavity-only' for v in report.values())

# Deterministic generated-file hashes are part of the report; a second regeneration is
# checked separately by the SM-503 workflow with git diff --exit-code.
for filename in ('sprite_material_normal_roughness.png','sprite_material_height_material.png'):
    p=GEN/filename;assert r['sha256'][filename]==hashlib.sha256(p.read_bytes()).hexdigest(),filename
capture=ROOT/'docs'/'material_v2'/'material_v2_calibration_8angle.png';assert capture.exists()
assert r['sha256']['material_v2_calibration_8angle.png']==hashlib.sha256(capture.read_bytes()).hexdigest()
assert set(r.get('calibration_fixtures',{}))=={'floor_plate','cargo_crate','rust_barrel','street_lamp','pipe_cluster','scaffold'}

# Legacy maps retained but v2 authoritative by default.
js=(ROOT/'engine'/'game.js').read_text();assert 'materialV2:true' in js and 'materialPipelineLegacy:false' in js
assert (GEN/'sprite_bumpmap.png').exists() and (GEN/'sprite_specularmap.png').exists()
print('MATERIAL V2 PASS: 314 regions, calibrated geometry/material priors, explicit world-height/AO semantics, deterministic hashes')
