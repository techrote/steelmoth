#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
from PIL import Image
import hashlib, json, re
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
GEN=ROOT/'assets'/'generated'
DOC=ROOT/'docs'/'MATERIAL_V2_SEMANTICS.md'
REPORT=GEN/'material_v2_report.json'
ATLAS=GEN/'atlas.json'
MAX_WORLD_Z=64.0
FIXTURES={
    'floor_plate':('flat','painted_steel'),
    'cargo_crate':('box','painted_steel'),
    'rust_barrel':('barrel','rusted_steel'),
    'street_lamp':('pole','galvanized'),
    'pipe_cluster':('pipe','galvanized'),
    'scaffold':('frame','galvanized'),
}
MATERIAL_PRIORS={'painted_steel','rusted_steel','bare_steel','galvanized','plastic','glass','concrete','wet_concrete','stone','plant','water'}

errors=[]
def require(ok,msg):
    if not ok: errors.append(msg)

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

report=json.loads(REPORT.read_text(encoding='utf-8'))
atlas=json.loads(ATLAS.read_text(encoding='utf-8'))
doc=DOC.read_text(encoding='utf-8')
pseudo=(ROOT/'engine'/'pseudo_depth.js').read_text(encoding='utf-8')
local=(ROOT/'engine'/'webgpu_local_shadows.js').read_text(encoding='utf-8')
ownership=(ROOT/'engine'/'webgpu_ownership.js').read_text(encoding='utf-8')

require(report.get('version')=='1.3.0','Material-v2 report must be v1.3.0')
require(report.get('semantics_version')=='SM-503/v1','report must name SM-503 semantic contract')
require(float(report.get('max_world_z',0))==MAX_WORLD_Z,'report max_world_z must be 64')
require(atlas.get('material_v2',{}).get('semantics_version')=='SM-503/v1','atlas metadata must name SM-503 semantic contract')
require('heightScaleWorld' in doc and 'heightBiasWorld' in doc and 'rootAnchor' in doc,'world-height metadata vocabulary missing from document')
require('intra-object' in doc and 'GTAO' in doc and 'SSGI' in doc,'material AO separation is not documented')
for prior in MATERIAL_PRIORS:
    require(prior in report.get('material_priors',{}),f'missing material prior {prior}')
    require(f'`{prior}`' in doc,f'material prior {prior} absent from semantics document')
for cls in ('flat','box','barrel','pole','pipe','frame'):
    require(cls in report.get('geometry_priors',{}),f'missing geometry prior {cls}')

regions=report.get('regions',{})
cal=report.get('calibration_fixtures',{})
for name,(cls,prior) in FIXTURES.items():
    require(name in regions,f'missing report fixture {name}')
    require(name in cal,f'missing calibration fixture {name}')
    if name not in regions or name not in cal: continue
    r=regions[name];c=cal[name]
    require(r.get('material_class')==cls,f'{name}: expected geometry class {cls}, got {r.get("material_class")}')
    require(r.get('material_prior')==prior,f'{name}: expected material prior {prior}, got {r.get("material_prior")}')
    require(float(r.get('heightScaleWorld',0))>0,f'{name}: heightScaleWorld must be positive')
    require(float(r.get('heightEncodingMaxWorld',0))==MAX_WORLD_Z,f'{name}: height encoding max must be 64')
    require(r.get('rootAnchor')==[.5,1.0],f'{name}: rootAnchor mismatch')
    require(r.get('material_ao_semantics')=='intra-object-cavity-only',f'{name}: material AO semantics mismatch')
    require(abs(float(c.get('visibleRootWorldZMax',99)))<1e-6,f'{name}: visible root is not exact Z=0')
    require(float(c.get('worldZMax',0))<=float(r['heightScaleWorld'])+MAX_WORLD_Z/255+1e-4,f'{name}: encoded world Z exceeds semantic scale')
    require(.45<=float(c.get('materialAOMean',0))<=1.0,f'{name}: material AO outside bounded local-cavity range')

require(float(cal.get('floor_plate',{}).get('worldZMax',99))<3.0,'floor fixture must remain shallow')
require(float(cal.get('floor_plate',{}).get('normalZMean',0))>.88,'floor normals must remain near +Z')
for name in ('rust_barrel','street_lamp'):
    require(float(cal.get(name,{}).get('normalXStd',0))>.18,f'{name}: cylindrical normal wrap is too flat')
require(float(cal.get('rust_barrel',{}).get('metalnessMean',1))<.45,'rusted steel must not behave as metalness=1')
for name in ('street_lamp','pipe_cluster','scaffold'):
    require(float(cal.get(name,{}).get('metalnessMean',0))>.50,f'{name}: galvanized prior lost metallic response')
require(float(cal.get('cargo_crate',{}).get('metalnessMean',1))<.45,'painted steel should remain broadly dielectric')

capture=ROOT/'docs'/'material_v2'/'material_v2_calibration_8angle.png'
require(capture.exists(),'eight-angle calibration capture is missing')
if capture.exists():
    im=Image.open(capture)
    require(im.width>=8*100 and im.height>=6*90,'eight-angle capture dimensions do not contain 8×6 fixture matrix')

hashes=report.get('sha256',{})
for filename in ('sprite_material_normal_roughness.png','sprite_material_height_material.png'):
    p=GEN/filename
    require(hashes.get(filename)==sha(p),f'{filename}: SHA-256 does not match report')
require(hashes.get('material_v2_calibration_8angle.png')==sha(capture),'eight-angle capture SHA-256 does not match report')

# Runtime-consumer equivalence: all owned height consumers decode the same normalized
# G2.R/HM.R with the canonical 64-world-unit span. No consumer may silently choose a
# second category-specific height scale.
require(re.search(r'const MAX_WORLD_Z=64\b',pseudo) is not None,'pseudo-depth MAX_WORLD_Z must remain 64')
require('worldZFromMaterialHeight' in pseudo,'pseudo-depth must expose explicit Material-v2 world-height decode')
require('textureLoad(g2,q,0).r*64.0' in local,'self/contact shadow path must consume canonical G2.R × 64')
require('SM_MAX_WORLD_Z' in ownership and 'PseudoDepth.MAX_WORLD_Z' in ownership,'ownership depth must inherit pseudo-depth max world Z')
require('material AO' in doc.lower(),'semantics document must name material AO')

if errors:
    print('SM-503 MATERIAL SEMANTICS FAIL')
    for e in errors: print(' -',e)
    raise SystemExit(1)
print(f'SM-503 MATERIAL SEMANTICS PASS: fixtures={len(FIXTURES)} priors={len(MATERIAL_PRIORS)} height-span={MAX_WORLD_Z:g} eight-angle=yes')
