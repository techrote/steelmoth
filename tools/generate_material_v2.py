#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw
import json, math, hashlib
import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / 'assets' / 'generated'
ATLAS_JSON = GEN / 'atlas.json'
ALBEDO_PATH = GEN / 'sprite_runtime_atlas.png'
LEGACY_BUMP = GEN / 'sprite_bumpmap.png'
LEGACY_SPEC = GEN / 'sprite_specularmap.png'
NR_PATH = GEN / 'sprite_material_normal_roughness.png'
HM_PATH = GEN / 'sprite_material_height_material.png'
REPORT_PATH = GEN / 'material_v2_report.json'
AUDIT_MD = ROOT / 'MATERIAL_V2_AUDIT.md'
CAPTURE_DIR = ROOT / 'docs' / 'material_v2'
MAX_WORLD_Z = 64.0
SEMANTICS_VERSION = 'SM-503/v1'

# Material-v2 channel contract is global and never varies per sprite:
# NR RGB = world-facing encoded normal, A = roughness.
# HM R = authored pseudo-world Z / MAX_WORLD_Z, G = intra-object material AO,
# B = metalness, A = emissive/material auxiliary.
# The runtime may apply a uniform rendered-scale factor to HM.R, but ownership,
# self/contact shadowing and later visibility consumers all decode the same world-Z.

MATERIAL_PRIORS = {
    'painted_steel': dict(rough=.62, metal=.08, ao=.94, intent='dielectric paint over steel; exposed metal is a bounded chip detail'),
    'rusted_steel': dict(rough=.86, metal=.18, ao=.92, intent='oxidised steel; rust is rough and mostly dielectric'),
    'bare_steel': dict(rough=.32, metal=.90, ao=.95, intent='clean exposed steel'),
    'galvanized': dict(rough=.54, metal=.72, ao=.95, intent='zinc-coated steel with broad metallic response'),
    'plastic': dict(rough=.48, metal=.00, ao=.96, intent='non-metallic polymer'),
    'glass': dict(rough=.18, metal=.00, ao=.99, intent='smooth dielectric glass; transmission remains a later renderer concern'),
    'concrete': dict(rough=.90, metal=.00, ao=.91, intent='dry mineral surface'),
    'wet_concrete': dict(rough=.42, metal=.00, ao=.92, intent='dielectric mineral surface with lower roughness'),
    'stone': dict(rough=.88, metal=.00, ao=.91, intent='rough dielectric stone'),
    'plant': dict(rough=.80, metal=.00, ao=.95, intent='organic foliage'),
    'water': dict(rough=.12, metal=.00, ao=1.00, intent='dielectric water; procedural water owns transmission/reflection'),
}

GEOMETRY_PRIORS = {
    'flat': dict(height_fraction=.08, min_height=.7, max_height=3.0, normal_smoothing_px=1.35, intent='near-planar floor with restrained lips/engraving'),
    'vertical_plane': dict(height_fraction=.90, min_height=6.0, max_height=44.0, normal_smoothing_px=1.45, intent='standing plane with shallow trim/fasteners'),
    'box': dict(height_fraction=.90, min_height=5.0, max_height=38.0, normal_smoothing_px=1.55, intent='front/top/side planes with bounded lips and recesses'),
    'barrel': dict(height_fraction=.88, min_height=5.0, max_height=34.0, normal_smoothing_px=1.35, intent='cylindrical shell with coherent rim/hoops'),
    'pole': dict(height_fraction=.95, min_height=8.0, max_height=54.0, normal_smoothing_px=1.25, intent='narrow cylinder rooted at the sprite foot'),
    'frame': dict(height_fraction=.90, min_height=6.0, max_height=48.0, normal_smoothing_px=1.30, intent='independent frame members; alpha gaps remain gaps'),
    'pipe': dict(height_fraction=.90, min_height=5.0, max_height=40.0, normal_smoothing_px=1.25, intent='separate cylindrical runs; alpha gaps remain gaps'),
    'robot': dict(height_fraction=.75, min_height=6.0, max_height=36.0, normal_smoothing_px=1.45, intent='articulated macro body with restrained panel relief'),
    'character': dict(height_fraction=.68, min_height=5.0, max_height=30.0, normal_smoothing_px=1.55, intent='softened character macro volume'),
    'foliage': dict(height_fraction=.72, min_height=3.0, max_height=30.0, normal_smoothing_px=1.40, intent='rooted organic volume'),
    'glass': dict(height_fraction=.45, min_height=2.0, max_height=18.0, normal_smoothing_px=1.50, intent='shallow dielectric pane/effect volume'),
}

CALIBRATION_FIXTURES = {
    'floor_plate': ('flat', 'painted_steel'),
    'cargo_crate': ('box', 'painted_steel'),
    'rust_barrel': ('barrel', 'rusted_steel'),
    'street_lamp': ('pole', 'galvanized'),
    'pipe_cluster': ('pipe', 'galvanized'),
    'scaffold': ('frame', 'galvanized'),
}


def classify(name: str, meta: dict) -> str:
    n = name.lower()
    sp = (meta.get('shadow_profile') or {}).get('kind')
    if sp in {'box','barrel','pole','frame','pipe'}:
        return sp
    if n.startswith(('floor_', 'manhole', 'platform_low')):
        return 'flat'
    if any(k in n for k in ('door_', 'window_', 'wall_', 'shutter', 'fence_panel')):
        return 'vertical_plane'
    if n.startswith('hex_') or n.startswith('utility_drone'):
        return 'robot'
    if n.startswith('player_'):
        return 'character'
    if meta.get('material') == 'foliage' or n.startswith('foliage_'):
        return 'foliage'
    if meta.get('material') == 'glass' or n.startswith('fx_') or n.startswith('fragment_'):
        return 'glass'
    if 'barrel' in n:
        return 'barrel'
    if any(k in n for k in ('pole','bollard','post','lamp')):
        return 'pole'
    if any(k in n for k in ('frame','scaffold')):
        return 'frame'
    if 'pipe' in n:
        return 'pipe'
    if any(k in n for k in ('crate','cabinet','terminal','vending','dumpster','hvac','fan','barrier','bench','objective_')):
        return 'box'
    return 'flat' if meta.get('element') == 'ground' else 'box'


def material_prior_for(name: str, material: str, cls: str, meta: dict) -> str:
    explicit = str(meta.get('material_v2_prior') or '').strip().lower()
    if explicit in MATERIAL_PRIORS:
        return explicit
    n = name.lower()
    material = str(material or 'metal').lower()
    if material == 'stone':
        if 'wet' in n:
            return 'wet_concrete'
        if 'concrete' in n or 'barrier' in n:
            return 'concrete'
        return 'stone'
    if material in ('organic','foliage'):
        return 'plant'
    if material == 'glass':
        return 'glass'
    if material == 'water' or 'water' in n:
        return 'water'
    if material == 'plastic':
        return 'plastic'
    if material == 'metal':
        if 'rust' in n:
            return 'rusted_steel'
        if any(k in n for k in ('galvanized','pipe','pole','bollard','street_lamp','fence','scaffold','frame')):
            return 'galvanized'
        if any(k in n for k in ('bare_steel','baresteel','unpainted')):
            return 'bare_steel'
        return 'painted_steel'
    return 'painted_steel' if cls not in ('foliage','glass') else ('plant' if cls == 'foliage' else 'glass')


def height_scale_for(cls: str, region_h: int, world_scale: float, meta: dict) -> float:
    p = GEOMETRY_PRIORS.get(cls, GEOMETRY_PRIORS['box'])
    wh = region_h * world_scale * float(meta.get('world_scale', 1.0))
    return min(float(p['max_height']), max(float(p['min_height']), wh * float(p['height_fraction'])))


def normalize(vx, vy, vz):
    l = np.sqrt(vx*vx + vy*vy + vz*vz)
    l = np.maximum(l, 1e-6)
    return vx/l, vy/l, vz/l


def smooth_masked(arr, mask, sigma=1.0):
    w = gaussian_filter(mask.astype(np.float32), sigma=sigma)
    v = gaussian_filter(arr.astype(np.float32) * mask, sigma=sigma)
    return np.where(w > 1e-5, v / np.maximum(w, 1e-5), 0.0)


def _srgb_to_linear(rgb):
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)


def _linear_to_srgb(rgb):
    return np.where(rgb <= .0031308, rgb * 12.92, 1.055 * np.maximum(rgb, 0) ** (1/2.4) - .055)


def generate_region(name: str, rgba: np.ndarray, meta: dict, world_scale: float):
    rgb = rgba[:,:,:3].astype(np.float32) / 255.0
    alpha = rgba[:,:,3].astype(np.float32) / 255.0
    mask = alpha > .02
    h,w = mask.shape
    if not mask.any():
        return np.zeros((h,w,4),np.uint8), np.zeros((h,w,4),np.uint8), {}
    cls = classify(name, meta)
    source_material = meta.get('material','metal') or 'metal'
    prior_name = material_prior_for(name, source_material, cls, meta)
    prior = MATERIAL_PRIORS[prior_name]
    geom_prior = GEOMETRY_PRIORS.get(cls, GEOMETRY_PRIORS['box'])
    normal_sigma = float(geom_prior['normal_smoothing_px'])
    yy,xx = np.mgrid[0:h,0:w].astype(np.float32)

    # Geometry/root bounds use visibly opaque coverage rather than antialiased fringe.
    # The visible foot/root therefore owns exact Z=0, shared by depth/contact/shadows.
    geom_mask = alpha >= .125
    if not geom_mask.any(): geom_mask = mask
    ys,xs = np.where(geom_mask); top=float(ys.min()); bottom=float(ys.max()); left=float(xs.min()); right=float(xs.max())
    yn = np.clip((yy-top)/max(1.0,bottom-top),0,1)
    xn = np.clip((xx-left)/max(1.0,right-left),0,1)
    lum = .2126*rgb[:,:,0] + .7152*rgb[:,:,1] + .0722*rgb[:,:,2]
    sat = rgb.max(2) - rgb.min(2)
    edt = distance_transform_edt(mask)
    edt_n = edt / max(1e-5, edt.max())

    # Macro/meso geometry is owned by the class prior. Source luminance is only a
    # restrained structural cue for authored lips, seams and recesses; it cannot
    # replace the macro shape or turn colour noise into pseudo-height.
    local = smooth_masked(lum, mask, .95)
    broad = smooth_masked(lum, mask, 2.8)
    detail = np.clip((local - broad) * .42 + .5, 0, 1)
    edge = np.clip(1.0 - edt_n*2.7, 0, 1)
    struct_lum = smooth_masked(lum, mask, 1.05)
    hgrad = np.abs(np.gradient(struct_lum, axis=0))
    vgrad = np.abs(np.gradient(struct_lum, axis=1))
    hs=max(float(np.percentile(hgrad[mask],95)),1e-5); vs=max(float(np.percentile(vgrad[mask],95)),1e-5)
    hline=np.clip(hgrad/hs,0,1); vline=np.clip(vgrad/vs,0,1)
    dark_recess=np.clip((broad-local)*1.65,0,1)

    if cls == 'flat':
        local_h = np.clip(.045 + (detail-.5)*.055 + edge*.018 + hline*.010, 0, .14)
    else:
        vertical = np.clip(1.0 - yn, 0, 1)
        if cls == 'vertical_plane':
            local_h = np.clip(vertical*.88 + hline*.040 + vline*.012 - dark_recess*.024, 0, 1)
        elif cls == 'box':
            cap=np.exp(-((yn-.16)/.14)**2)*.085
            local_h = np.clip(vertical*.82 + cap + hline*.050 + vline*.014 - dark_recess*.034 + edt_n*.018, 0, 1)
        elif cls == 'barrel':
            rim=np.exp(-((yn-.08)/.060)**2)*.105
            local_h = np.clip(vertical*.84 + rim + hline*.046 - dark_recess*.016 + edt_n*.018, 0, 1)
        elif cls == 'pole':
            local_h = np.clip(vertical*.92 + hline*.028 + edt_n*.015, 0, 1)
        elif cls in ('frame','pipe'):
            local_h = np.clip(vertical*.86 + edt_n*.030 + hline*.040 + vline*.014 - dark_recess*.016, 0, 1)
        elif cls in ('robot','character'):
            local_h = np.clip(vertical*.78 + edt_n*.050 + hline*.035 + vline*.012 - dark_recess*.025, 0, 1)
        elif cls in ('foliage','glass'):
            local_h = np.clip(vertical*.76 + edt_n*.055, 0, 1)
        else:
            local_h = vertical
    if cls != 'flat':
        root_gate = np.clip((1.0-yn)/.08, 0, 1)
        local_h *= root_gate
    local_h *= mask

    height_scale_world = height_scale_for(cls, h, world_scale, meta)
    height_bias_world = float(meta.get('material_v2_height_bias_world', 0.0) or 0.0)
    # Explicit authored-scale contract: worldZ = localShapeHeight*scale + bias.
    # Bias is zero for all current calibrated sprites so the visible root stays Z=0.
    world_z = np.where(mask, np.maximum(0.0, local_h * height_scale_world + height_bias_world), 0.0)
    encoded_z = np.clip(world_z / MAX_WORLD_Z, 0, 1)

    nx = np.zeros((h,w),np.float32); ny = np.zeros_like(nx); nz = np.ones_like(nx)
    if cls == 'flat':
        macro=smooth_masked(local_h,mask,normal_sigma);gx=np.gradient(macro,axis=1);gy=np.gradient(macro,axis=0)
        nx,ny,nz = normalize(-gx*.30, gy*.30, np.ones_like(gx))
    elif cls == 'vertical_plane':
        nx[:] = 0; ny[:] = -.62; nz[:] = .785
        relief=smooth_masked(local_h,mask,normal_sigma);gx=np.gradient(relief,axis=1);gy=np.gradient(relief,axis=0)
        nx += -gx*.09; ny += gy*.05; nx,ny,nz = normalize(nx,ny,nz)
    elif cls in ('barrel','pole'):
        for y in range(h):
            row=np.where(mask[y])[0]
            if row.size < 2: continue
            l,r=float(row.min()),float(row.max());cx=(l+r)*.5;rad=max(1,(r-l)*.5)
            q=np.clip((np.arange(w)-cx)/rad,-1,1)
            nx[y]=q*.78; nz[y]=np.sqrt(np.maximum(.04,1.0-np.clip(q*q*.72,0,.96))); ny[y]=-.18 if cls=='barrel' else -.12
        nx,ny,nz = normalize(nx,ny,nz)
    elif cls == 'box':
        top_zone = yn < .24; side_left = xn < .18; side_right = xn > .82
        nx[:] = 0; ny[:] = -.48; nz[:] = .88
        ny[top_zone] = -.12; nz[top_zone] = .99; nx[side_left] = -.35; nx[side_right] = .35
        relief=smooth_masked(local_h,mask,normal_sigma);gx=np.gradient(relief,axis=1);gy=np.gradient(relief,axis=0)
        nx += -gx*.06; ny += gy*.035; nx,ny,nz = normalize(nx,ny,nz)
    elif cls in ('frame','pipe'):
        dist = gaussian_filter(distance_transform_edt(mask).astype(np.float32), sigma=max(.55,normal_sigma*.55))
        gx = np.gradient(dist, axis=1); gy=np.gradient(dist, axis=0)
        if cls=='pipe': nx,ny,nz = normalize(-gx*.44, -gy*.18-.22, np.ones_like(gx)*.84)
        else: nx,ny,nz = normalize(-gx*.23, -gy*.09-.36, np.ones_like(gx)*.91)
    elif cls == 'robot':
        macro=smooth_masked(local_h,mask,normal_sigma);gx=np.gradient(macro,axis=1);gy=np.gradient(macro,axis=0)
        nx,ny,nz=normalize(-gx*.42, gy*.22-.30, np.ones_like(gx)*.94)
    elif cls == 'character':
        macro=smooth_masked(local_h,mask,normal_sigma);gx=np.gradient(macro,axis=1);gy=np.gradient(macro,axis=0)
        nx,ny,nz=normalize(-gx*.24, gy*.14-.16, np.ones_like(gx)*.985)
    else:
        macro=smooth_masked(local_h,mask,normal_sigma);gx=np.gradient(macro,axis=1);gy=np.gradient(macro,axis=0)
        nx,ny,nz=normalize(-gx*.18, gy*.10-.12, np.ones_like(gx))
    nx*=mask; ny*=mask; nz=np.where(mask,nz,1.0)

    # Material classification owns broad roughness/metalness. Pixel colour may only
    # introduce bounded chips/weathering inside that class, never choose the class.
    base_r=float(prior['rough']); base_m=float(prior['metal'])
    pale=np.clip(1.0-sat*2.0,0,1)*np.clip(lum*1.25,0,1)
    dark=1.0-np.clip(lum*1.8,0,1)
    chip=np.clip((pale-.45)*1.8,0,1)*(1-edge*.45)
    if prior_name == 'painted_steel':
        metal=np.clip(base_m+chip*.30,.02,.42);rough=np.clip(base_r-chip*.15+edge*.035,.32,.90)
    elif prior_name == 'rusted_steel':
        metal=np.clip(base_m+chip*.16,.04,.38);rough=np.clip(base_r-chip*.10+edge*.025,.62,.96)
    elif prior_name == 'bare_steel':
        metal=np.clip(base_m-chip*.08,.72,.96);rough=np.clip(base_r+edge*.05+dark*.04,.20,.62)
    elif prior_name == 'galvanized':
        metal=np.clip(base_m+chip*.10,.55,.88);rough=np.clip(base_r+edge*.045-dark*.02,.34,.76)
    elif prior_name == 'glass':
        metal=np.zeros_like(lum);rough=np.clip(base_r+(1-lum)*.10+edge*.035,.08,.38)
    elif prior_name in ('concrete','stone'):
        metal=np.zeros_like(lum);rough=np.clip(base_r+edge*.04+dark*.025,.72,.98)
    elif prior_name == 'wet_concrete':
        metal=np.zeros_like(lum);rough=np.clip(base_r+edge*.035+dark*.02,.28,.68)
    elif prior_name in ('plant','plastic','water'):
        metal=np.full_like(lum,base_m);rough=np.clip(base_r+edge*.025+dark*.02,.08,.96)
    else:
        metal=np.full_like(lum,base_m);rough=np.full_like(lum,base_r)

    # Material AO is strictly local/intra-object cavity evidence. It intentionally
    # excludes scene adjacency, DSO, contact shadows and any future GTAO/SSGI term.
    cavity=np.clip((broad-local)*1.20 + edge*.11 + dark*.035,0,.42)
    ao=np.clip(float(prior['ao'])-cavity,.52,1.0)
    emissive=np.zeros_like(lum)
    if meta.get('element') in ('tree_lights','fx_magic','fx_objective','fx_portal','fx_teleport','moth_spark') or name.startswith('fx_'):
        emissive=np.clip((lum-.55)*2.2,0,1)*alpha

    nr=np.zeros((h,w,4),np.uint8)
    nr[:,:,0]=np.clip((nx*.5+.5)*255,0,255).astype(np.uint8)
    nr[:,:,1]=np.clip((ny*.5+.5)*255,0,255).astype(np.uint8)
    nr[:,:,2]=np.clip((nz*.5+.5)*255,0,255).astype(np.uint8)
    nr[:,:,3]=np.clip(rough*255,0,255).astype(np.uint8)
    hm=np.zeros((h,w,4),np.uint8)
    hm[:,:,0]=np.clip(encoded_z*255,0,255).astype(np.uint8)
    hm[:,:,1]=np.clip(ao*255,0,255).astype(np.uint8)
    hm[:,:,2]=np.clip(metal*255,0,255).astype(np.uint8)
    hm[:,:,3]=np.clip(emissive*255,0,255).astype(np.uint8)
    nr[~mask]=np.array([128,128,255,255],np.uint8); hm[~mask]=np.array([0,255,0,0],np.uint8)
    report=dict(
        material_class=cls, material_prior=prior_name, source_material=source_material,
        heightScaleWorld=round(height_scale_world,4), heightBiasWorld=round(height_bias_world,4), rootAnchor=[.5,1.0],
        heightEncodingMaxWorld=MAX_WORLD_Z, material_ao_semantics='intra-object-cavity-only',
        # Legacy aliases are retained while downstream metadata readers migrate.
        height_scale=round(height_scale_world,4), height_bias=round(height_bias_world,4), root_anchor=[.5,1.0],
        roughness_mean=round(float(rough[mask].mean()),4), metalness_mean=round(float(metal[mask].mean()),4),
        ao_mean=round(float(ao[mask].mean()),4), emissive_mean=round(float(emissive[mask].mean()),4),
        normal_smoothing_px=normal_sigma,
        channels={'normal_roughness':'RGB=encoded XYZ normal; A=roughness','height_material':f'R=worldZ/{MAX_WORLD_Z:g}; G=intra-object material AO; B=metalness; A=emissive'})
    return nr,hm,report


def make_capture(atlas, nr, hm, data, names, out_path, title):
    font_h=14;cell_w=260;cell_h=180
    out=Image.new('RGB',(cell_w*3,font_h+cell_h*len(names)),(15,16,18));dr=ImageDraw.Draw(out);dr.text((8,2),title,fill=(235,235,235))
    for row,name in enumerate(names):
        if name not in data['regions']: continue
        x,y,w,h=data['regions'][name]
        al=atlas.crop((x,y,x+w,y+h)).convert('RGBA');n=nr.crop((x,y,x+w,y+h)).convert('RGBA');m=hm.crop((x,y,x+w,y+h)).convert('RGBA')
        for col,(im,labeltxt) in enumerate(((al,'ALBEDO'),(n,'NORMAL / ROUGH'),(m,'HEIGHT / AO / METAL / EMISS'))):
            scale=min(1.0,150/max(1,im.width),125/max(1,im.height));im=im.resize((max(1,int(im.width*scale)),max(1,int(im.height*scale))),Image.Resampling.NEAREST)
            ox=col*cell_w+(cell_w-im.width)//2;oy=font_h+row*cell_h+18
            out.paste(im.convert('RGB'),(ox,oy),im.getchannel('A'))
            dr.text((col*cell_w+6,font_h+row*cell_h+2),f'{name} · {labeltxt}',fill=(210,220,225))
    out.save(out_path,optimize=True)


def make_eight_angle_capture(atlas, nr_img, data, names, out_path):
    cell=116;label_h=18
    out=Image.new('RGB',(cell*8,label_h+cell*len(names)),(12,13,15));dr=ImageDraw.Draw(out)
    for col in range(8):dr.text((col*cell+5,2),f'{col*45:03d}°',fill=(210,218,224))
    for row,name in enumerate(names):
        x,y,w,h=data['regions'][name]
        al=np.asarray(atlas.crop((x,y,x+w,y+h)).convert('RGBA')).astype(np.float32)/255
        nr=np.asarray(nr_img.crop((x,y,x+w,y+h)).convert('RGBA')).astype(np.float32)/255
        n=nr[:,:,:3]*2-1;n/=np.maximum(np.linalg.norm(n,axis=2,keepdims=True),1e-6)
        linear=_srgb_to_linear(al[:,:,:3]);alpha=al[:,:,3]
        for col in range(8):
            a=math.radians(col*45);light=np.array([math.cos(a)*.68,math.sin(a)*.38-.18,.92],np.float32);light/=np.linalg.norm(light)
            ndl=np.clip((n*light).sum(2),0,1);lit=linear*(.14+.86*ndl[:,:,None]);display=np.clip(_linear_to_srgb(lit),0,1)
            rgba=np.dstack((display,alpha));im=Image.fromarray(np.clip(rgba*255,0,255).astype(np.uint8),'RGBA')
            scale=min(1.0,(cell-10)/max(1,w),(cell-16)/max(1,h));im=im.resize((max(1,int(w*scale)),max(1,int(h*scale))),Image.Resampling.NEAREST)
            ox=col*cell+(cell-im.width)//2;oy=label_h+row*cell+12;out.paste(im.convert('RGB'),(ox,oy),im.getchannel('A'))
        dr.text((4,label_h+row*cell+1),name,fill=(224,228,232))
    out.save(out_path,optimize=True)


def calibration_metrics(name, atlas_arr, nr_arr, hm_arr, data, region_report):
    x,y,w,h=data['regions'][name];al=atlas_arr[y:y+h,x:x+w];nr=nr_arr[y:y+h,x:x+w];hm=hm_arr[y:y+h,x:x+w]
    mask=al[:,:,3]>=32;nn=nr[:,:,:3].astype(np.float32)/255*2-1
    world=hm[:,:,0].astype(np.float32)/255*MAX_WORLD_Z
    rows=np.where(mask.any(axis=1))[0];root=int(rows.max()) if rows.size else h-1;root_mask=mask[root]
    return {
        'geometryClass':region_report['material_class'],'materialPrior':region_report['material_prior'],
        'heightScaleWorld':region_report['heightScaleWorld'],'heightBiasWorld':region_report['heightBiasWorld'],
        'worldZMax':round(float(world[mask].max()),4),'worldZMean':round(float(world[mask].mean()),4),
        'visibleRootWorldZMax':round(float(world[root,root_mask].max()) if root_mask.any() else 0.0,4),
        'normalXStd':round(float(np.std(nn[:,:,0][mask])),4),'normalZMean':round(float(np.mean(nn[:,:,2][mask])),4),
        'roughnessMean':round(float(nr[:,:,3][mask].mean()/255),4),'metalnessMean':round(float(hm[:,:,2][mask].mean()/255),4),
        'materialAOMean':round(float(hm[:,:,1][mask].mean()/255),4),
    }


def main():
    CAPTURE_DIR.mkdir(parents=True,exist_ok=True)
    data=json.loads(ATLAS_JSON.read_text())
    atlas=Image.open(ALBEDO_PATH).convert('RGBA');W,H=atlas.size
    nr_arr=np.zeros((H,W,4),np.uint8);nr_arr[:]=np.array([128,128,255,255],np.uint8)
    hm_arr=np.zeros((H,W,4),np.uint8);hm_arr[:]=np.array([0,255,0,0],np.uint8)
    al=np.asarray(atlas)
    report={'schema':'steel-moth-material-v2-report/v1','version':'1.3.0','semantics_version':SEMANTICS_VERSION,'max_world_z':MAX_WORLD_Z,
            'atlases':{'normal_roughness':NR_PATH.name,'height_material':HM_PATH.name},
            'semantic_contract':{'height':'worldZ = localShapeHeight * heightScaleWorld + heightBiasWorld; HM.R = worldZ / 64 at authored scale','root':'rootAnchor [0.5,1.0] is exact Z=0 for current standing sprites','materialAO':'intra-object cavity only; scene GTAO/SSGI remains a separate visibility term','materialClassification':'semantic prior owns broad response; source colour only supplies bounded within-class wear'},
            'material_priors':MATERIAL_PRIORS,'geometry_priors':GEOMETRY_PRIORS,
            'generation_parameters':{'coverage_alpha_threshold':0.02,'geometry_alpha_threshold':0.125,'macro_luminance_sigma':2.8,'local_luminance_sigma':0.95,'max_world_z':MAX_WORLD_Z,'classes':list(GEOMETRY_PRIORS),'transparent_normal':[128,128,255],'transparent_height_material':[0,255,0,0],'sampling':'region-isolated; no cross-region filters'},'regions':{}}
    data.setdefault('region_meta',{})
    for name in sorted(data['regions']):
        x,y,w,h=data['regions'][name];crop=al[y:y+h,x:x+w,:]
        nr,hm,r=generate_region(name,crop,data['region_meta'].get(name,{}),float(data.get('world_scale',.18)))
        nr_arr[y:y+h,x:x+w]=nr;hm_arr[y:y+h,x:x+w]=hm
        data['region_meta'].setdefault(name,{})['material_v2']={k:r[k] for k in ('material_class','material_prior','heightScaleWorld','heightBiasWorld','rootAnchor','heightEncodingMaxWorld','material_ao_semantics','height_scale','height_bias','root_anchor','roughness_mean','metalness_mean','ao_mean','emissive_mean','normal_smoothing_px')}
        report['regions'][name]=r
    nr_img=Image.fromarray(nr_arr,'RGBA');hm_img=Image.fromarray(hm_arr,'RGBA')
    nr_img.save(NR_PATH,optimize=True);hm_img.save(HM_PATH,optimize=True)
    data['material_normal_roughness_image']='assets/generated/'+NR_PATH.name;data['material_height_image']='assets/generated/'+HM_PATH.name
    data['material_v2']={'schema':'steel-moth-material-v2/v1','semantics_version':SEMANTICS_VERSION,'max_world_z':MAX_WORLD_Z,
        'normal_roughness_channels':'RGB encoded XYZ normal, A roughness','height_material_channels':'R authored pseudo-world Z / 64, G intra-object material AO, B metalness, A emissive/auxiliary',
        'height_contract':'worldZ = localShapeHeight * heightScaleWorld + heightBiasWorld; runtime rendered-scale factor is shared by depth/shadow consumers','material_ao_contract':'intra-object cavity only; GTAO/SSGI separate','coordinate_identity':'identical to sprite_runtime_atlas.png'}
    notes=data.get('notes',[])
    if isinstance(notes,list):
        notes=[n for n in notes if 'Material v2' not in str(n)];notes.append('Material v2 v1.3.0 / SM-503: semantic material priors, macro/meso geometry calibration, explicit world-Z metadata and intra-object-only material AO; legacy bump/spec retained for fallback/debug.')
        data['notes']=notes
    ATLAS_JSON.write_text(json.dumps(data,indent=2)+'\n')
    reps=list(CALIBRATION_FIXTURES)
    make_capture(atlas,nr_img,hm_img,data,reps,CAPTURE_DIR/'material_v2_representative.png','Steel Moth Material v2 · SM-503 calibrated fields')
    make_eight_angle_capture(atlas,nr_img,data,reps,CAPTURE_DIR/'material_v2_calibration_8angle.png')
    report['calibration_fixtures']={n:calibration_metrics(n,al,nr_arr,hm_arr,data,report['regions'][n]) for n in reps}
    report['sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (NR_PATH,HM_PATH,CAPTURE_DIR/'material_v2_calibration_8angle.png')}
    from collections import Counter
    report['class_counts']=dict(sorted(Counter(v['material_class'] for v in report['regions'].values()).items()))
    report['material_prior_counts']=dict(sorted(Counter(v['material_prior'] for v in report['regions'].values()).items()))
    REPORT_PATH.write_text(json.dumps(report,indent=2)+'\n')
    lines=['# MATERIAL V2 AUDIT','','Generated for all **%d** atlas regions.'%len(report['regions']),'',f'Semantics: `{SEMANTICS_VERSION}`.','','Channel contract:','',
           '- Normal/Roughness: `RGB = encoded XYZ normal`, `A = roughness`.','- Height/Material: `R = authored pseudo-world Z / 64`, `G = intra-object material AO`, `B = metalness`, `A = emissive/auxiliary`.','',
           'World-height contract: `worldZ = localShapeHeight × heightScaleWorld + heightBiasWorld`; standing roots are authored at exact Z=0. Runtime render scaling is applied uniformly before depth/self/contact consumers use the same G2.R height.','',
           'Material AO is local cavity evidence only. It must not absorb DSO/contact/GTAO/SSGI scene occlusion.','','Geometry class coverage:','']
    for c,n in report['class_counts'].items():lines.append(f'- `{c}`: {n}')
    lines += ['','Material-prior coverage:','']
    for c,n in report['material_prior_counts'].items():lines.append(f'- `{c}`: {n}')
    lines += ['','Calibration fixtures:','']
    for n in reps:
        r=report['calibration_fixtures'][n];lines.append(f"- **{n}** — `{r['geometryClass']}` / `{r['materialPrior']}`, scale `{r['heightScaleWorld']}` world units, max Z `{r['worldZMax']}`, rough `{r['roughnessMean']}`, metal `{r['metalnessMean']}`, AO `{r['materialAOMean']}`")
    lines += ['','Eight-angle calibration capture: `docs/material_v2/material_v2_calibration_8angle.png`.','Generation parameters and output hashes are recorded machine-readably in `assets/generated/material_v2_report.json`.','',
              'The legacy `sprite_bumpmap.png` and `sprite_specularmap.png` remain in the package only for A/B fallback/debug. Material v2 is authoritative by default.']
    AUDIT_MD.write_text('\n'.join(lines)+'\n')
    print(f'Generated Material v2 {SEMANTICS_VERSION} for {len(report["regions"])} regions -> {NR_PATH.name}, {HM_PATH.name}')

if __name__=='__main__': main()
