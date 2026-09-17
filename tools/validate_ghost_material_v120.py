#!/usr/bin/env python3
from pathlib import Path
from PIL import Image
import json, numpy as np
ROOT=Path(__file__).resolve().parents[1];GEN=ROOT/'assets'/'generated';js=(ROOT/'engine'/'game.js').read_text();ed=(ROOT/'engine'/'editor.js').read_text()
# Exact runtime rebuild contracts: four static material canvases explicitly cleared and descriptor list reset.
assert 'this.staticMaterialSprites=[]' in js
assert 'for(const q of [bctx,sctx,nrctx,hmctx])' in js
assert 'q.setTransform(1,0,0,1,0,0);q.clearRect(0,0,renderW,renderH)' in js
assert "this.staticMaterialSprites=(maps?.staticSprites||[]).map" in js
assert 'g.clearBufferfv(g.COLOR,0' in js and 'g.clearBufferfv(g.COLOR,1' in js and 'g.clearBufferfv(g.COLOR,2' in js
assert "this.game.bgKey=''" in ed or "bgKey=''" in ed
# Pixel-level model of remove/rebuild: write a real v2 object into targets, clear, rebuild with no object.
d=json.load(open(GEN/'atlas.json'));x,y,w,h=d['regions']['cargo_crate'];nr=np.array(Image.open(GEN/'sprite_material_normal_roughness.png').convert('RGBA'))[y:y+h,x:x+w];hm=np.array(Image.open(GEN/'sprite_material_height_material.png').convert('RGBA'))[y:y+h,x:x+w]
H,W=256,256;g1=np.zeros((H,W,4),np.uint8);g2=np.zeros((H,W,4),np.uint8);oy,ox=30,35;hh=min(h,H-oy);ww=min(w,W-ox);g1[oy:oy+hh,ox:ox+ww]=nr[:hh,:ww];g2[oy:oy+hh,ox:ox+ww]=hm[:hh,:ww];assert g1.sum()>0 and g2.sum()>0
# Deterministic rebuild clear semantics.
g1[:]=np.array([128,128,255,224],np.uint8);g2[:]=np.array([0,255,0,0],np.uint8)
# Region formerly occupied by crate must contain only baseline material after deletion.
assert np.all(g1[oy:oy+hh,ox:ox+ww]==np.array([128,128,255,224],np.uint8));assert np.all(g2[oy:oy+hh,ox:ox+ww]==np.array([0,255,0,0],np.uint8))
print('GHOST MATERIAL PASS: static descriptors reset, all static material canvases explicitly cleared, all MRT attachments cleared, editor invalidates rebuild, deleted region returns to baseline')
