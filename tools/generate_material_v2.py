#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw
import json, math, hashlib
import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter, label

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

# Atlas B channels: R = world pseudo-Z / MAX_WORLD_Z, G = material AO,
# B = metalness, A = emissive/material auxiliary. This is intentionally global
# and never changes meaning per sprite.


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
    if any(k in n for k in ('barrel',)):
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


def material_defaults(material: str, cls: str):
    if material == 'stone': return dict(rough=.88, metal=.0, ao=.90)
    if material == 'glass': return dict(rough=.20, metal=.0, ao=.98)
    if material == 'organic': return dict(rough=.70, metal=.02, ao=.92)
    if material == 'foliage': return dict(rough=.78, metal=.0, ao=.94)
    # metal sprites contain paint/rust/bare metal spatially; these are center values.
    # Ground plates are overwhelmingly oxidised/painted, so their broad response is
    # dielectric/rough; only spatially detected bare scratches rise toward metal.
    if cls == 'flat': return dict(rough=.78, metal=.18, ao=.94)
    rough = .58 if cls in ('box','frame','pipe') else .48
    if cls == 'barrel': rough = .56
    if cls == 'pole': rough = .46
    return dict(rough=rough, metal=.58, ao=.93)


def height_scale_for(cls: str, region_h: int, world_scale: float, meta: dict):
    wh = region_h * world_scale * float(meta.get('world_scale', 1.0))
    if cls == 'flat': return min(3.0, max(.7, wh * .08))
    if cls == 'vertical_plane': return min(44.0, max(6.0, wh * .90))
    if cls == 'box': return min(38.0, max(5.0, wh * .90))
    if cls == 'barrel': return min(34.0, max(5.0, wh * .88))
    if cls == 'pole': return min(54.0, max(8.0, wh * .95))
    if cls == 'frame': return min(48.0, max(6.0, wh * .90))
    if cls == 'pipe': return min(40.0, max(5.0, wh * .90))
    if cls == 'robot': return min(36.0, max(6.0, wh * .75))
    if cls == 'character': return min(30.0, max(5.0, wh * .68))
    if cls == 'foliage': return min(30.0, max(3.0, wh * .72))
    if cls == 'glass': return min(18.0, max(2.0, wh * .45))
    return min(32.0, max(3.0, wh * .60))


def normalize(vx, vy, vz):
    l = np.sqrt(vx*vx + vy*vy + vz*vz)
    l = np.maximum(l, 1e-6)
    return vx/l, vy/l, vz/l


def smooth_masked(arr, mask, sigma=1.0):
    w = gaussian_filter(mask.astype(np.float32), sigma=sigma)
    v = gaussian_filter(arr.astype(np.float32) * mask, sigma=sigma)
    return np.where(w > 1e-5, v / np.maximum(w, 1e-5), 0.0)


def generate_region(name: str, rgba: np.ndarray, meta: dict, world_scale: float):
    rgb = rgba[:,:,:3].astype(np.float32) / 255.0
    alpha = rgba[:,:,3].astype(np.float32) / 255.0
    mask = alpha > .02
    h,w = mask.shape
    if not mask.any():
        return np.zeros((h,w,4),np.uint8), np.zeros((h,w,4),np.uint8), {}
    cls = classify(name, meta)
    material = meta.get('material','metal') or 'metal'
    defaults = material_defaults(material, cls)
    yy,xx = np.mgrid[0:h,0:w].astype(np.float32)
    # Geometry/root bounds use visibly opaque coverage rather than faint antialiased
    # fringe pixels. Material coverage still keeps the full alpha mask, but the shared
    # pseudo-height zero plane is tied to the visually solid foot/root.
    geom_mask = alpha >= .125
    if not geom_mask.any(): geom_mask = mask
    ys,xs = np.where(geom_mask); top=float(ys.min()); bottom=float(ys.max()); left=float(xs.min()); right=float(xs.max())
    # Geometry coordinates are normalized to the opaque sprite silhouette, not the
    # atlas rectangle padding. The visible foot is therefore exactly Z=0 even for
    # normalized animation frames with transparent gutters below the feet.
    yn = np.clip((yy-top)/max(1.0,bottom-top),0,1)
    xn = np.clip((xx-left)/max(1.0,right-left),0,1)
    lum = .2126*rgb[:,:,0] + .7152*rgb[:,:,1] + .0722*rgb[:,:,2]
    sat = rgb.max(2) - rgb.min(2)
    edt = distance_transform_edt(mask)
    edt_n = edt / max(1e-5, edt.max())
    # Local structure signal; luminance supports geometry but never owns the macro shape.
    local = smooth_masked(lum, mask, .75)
    broad = smooth_masked(lum, mask, 2.2)
    detail = np.clip((local - broad) * .75 + .5, 0, 1)
    edge = np.clip(1.0 - edt_n*2.5, 0, 1)
    # Broad structural ridges/recesses: preserve pixel-art lips/seams without turning
    # every source-pixel contrast edge into height. This supports real self-shadowing.
    struct_lum = smooth_masked(lum, mask, .70)
    hgrad = np.abs(np.gradient(struct_lum, axis=0))
    vgrad = np.abs(np.gradient(struct_lum, axis=1))
    if mask.any():
        hs=max(float(np.percentile(hgrad[mask],95)),1e-5);vs=max(float(np.percentile(vgrad[mask],95)),1e-5)
        hline=np.clip(hgrad/hs,0,1);vline=np.clip(vgrad/vs,0,1)
    else:
        hline=np.zeros_like(lum);vline=np.zeros_like(lum)
    dark_recess=np.clip((broad-local)*2.2,0,1)

    # Height fraction local to each sprite before world-height scaling.
    if cls == 'flat':
        local_h = np.clip(.06 + (detail-.5)*.10 + edge*.03, 0, .18)
    else:
        vertical = np.clip(1.0 - yn, 0, 1)
        local_h = vertical.copy()
        if cls == 'vertical_plane':
            # Nearly planar standing surface, with trim/bolts allowed to protrude.
            local_h = np.clip(vertical*.86 + hline*.075 + vline*.025 - dark_recess*.035, 0, 1)
        elif cls == 'box':
            # Front volume plus coherent top cap and horizontal lips/recessed panels.
            cap=np.exp(-((yn-.16)/.13)**2)*.10
            local_h = np.clip(vertical*.80 + cap + hline*.095 + vline*.025 - dark_recess*.055 + edt_n*.025, 0, 1)
        elif cls == 'barrel':
            # Cylindrical body with a raised rim and coherent hoop/seam ridges.
            rim=np.exp(-((yn-.08)/.055)**2)*.13
            local_h = np.clip(vertical*.82 + rim + hline*.075 - dark_recess*.025 + edt_n*.03, 0, 1)
        elif cls == 'pole':
            local_h = np.clip(vertical*.90 + hline*.045 + edt_n*.025, 0, 1)
        elif cls in ('frame','pipe'):
            local_h = np.clip(vertical*.84 + edt_n*.05 + hline*.075 + vline*.025 - dark_recess*.025, 0, 1)
        elif cls in ('robot','character'):
            local_h = np.clip(vertical*.76 + edt_n*.08 + hline*.07 + vline*.025 - dark_recess*.035, 0, 1)
        elif cls in ('foliage','glass'):
            local_h = np.clip(vertical*.75 + edt_n*.08, 0, 1)
    # The shared foot/root anchor is the zero-height reference. Standing sprites
    # fade the final ~8% into exactly Z=0 so contact/self-shadow and ordering agree.
    if cls != 'flat':
        root_gate = np.clip((1.0-yn)/.08, 0, 1)
        local_h *= root_gate
    local_h *= mask
    height_scale = height_scale_for(cls, h, world_scale, meta)
    world_z = local_h * height_scale
    encoded_z = np.clip(world_z / MAX_WORLD_Z, 0, 1)

    # Macro normals by physical class.
    nx = np.zeros((h,w),np.float32); ny = np.zeros_like(nx); nz = np.ones_like(nx)
    if cls == 'flat':
        # horizontal ground: near +Z, only restrained engraving/crack response
        gx = np.gradient(smooth_masked(local_h,mask,.55), axis=1)
        gy = np.gradient(smooth_masked(local_h,mask,.55), axis=0)
        nx,ny,nz = normalize(-gx*.45, gy*.45, np.ones_like(gx))
    elif cls == 'vertical_plane':
        nx[:] = 0; ny[:] = -.62; nz[:] = .785
        # frame/bolt relief only, low amplitude
        gx = np.gradient(smooth_masked(detail,mask,.8), axis=1)
        gy = np.gradient(smooth_masked(detail,mask,.8), axis=0)
        nx += -gx*.18; ny += gy*.10
        nx,ny,nz = normalize(nx,ny,nz)
    elif cls in ('barrel','pole'):
        # cylindrical wrapping around horizontal sprite axis, softened by alpha-distance centerline
        rows = mask.sum(1)
        for y in range(h):
            xs=np.where(mask[y])[0]
            if xs.size < 2: continue
            l,r=float(xs.min()),float(xs.max()); cx=(l+r)*.5; rad=max(1,(r-l)*.5)
            q=np.clip((np.arange(w)-cx)/rad,-1,1)
            nx[y]=q*.78
            nz[y]=np.sqrt(np.maximum(.04,1.0-np.clip(q*q*.72,0,.96)))
            ny[y]=-.18 if cls=='barrel' else -.12
        nx,ny,nz = normalize(nx,ny,nz)
    elif cls == 'box':
        # coherent front/top/side planes inferred from visible upper band and silhouette sides
        top_zone = yn < .24
        side_left = xn < .18
        side_right = xn > .82
        nx[:] = 0; ny[:] = -.48; nz[:] = .88
        ny[top_zone] = -.12; nz[top_zone] = .99
        nx[side_left] = -.35; nx[side_right] = .35
        gx = np.gradient(smooth_masked(detail,mask,.95), axis=1)
        gy = np.gradient(smooth_masked(detail,mask,.95), axis=0)
        nx += -gx*.10; ny += gy*.06
        nx,ny,nz = normalize(nx,ny,nz)
    elif cls in ('frame','pipe'):
        # distance-field gradients preserve separate struts/runs rather than filling holes
        dist = distance_transform_edt(mask).astype(np.float32)
        gx = np.gradient(dist, axis=1); gy=np.gradient(dist, axis=0)
        if cls=='pipe':
            nx,ny,nz = normalize(-gx*.48, -gy*.20-.22, np.ones_like(gx)*.82)
        else:
            nx,ny,nz = normalize(-gx*.26, -gy*.10-.36, np.ones_like(gx)*.90)
    elif cls == 'robot':
        gx=np.gradient(smooth_masked(local_h,mask,1.0),axis=1);gy=np.gradient(smooth_masked(local_h,mask,1.0),axis=0)
        nx,ny,nz=normalize(-gx*.55, gy*.30-.30, np.ones_like(gx)*.92)
    elif cls == 'character':
        gx=np.gradient(smooth_masked(local_h,mask,1.2),axis=1);gy=np.gradient(smooth_masked(local_h,mask,1.2),axis=0)
        nx,ny,nz=normalize(-gx*.28, gy*.18-.16, np.ones_like(gx)*.98)
    else:
        gx=np.gradient(smooth_masked(local_h,mask,1.0),axis=1);gy=np.gradient(smooth_masked(local_h,mask,1.0),axis=0)
        nx,ny,nz=normalize(-gx*.22, gy*.14-.12, np.ones_like(gx))
    nx*=mask;ny*=mask;nz=np.where(mask,nz,1.0)

    # Roughness / metalness. Rust/paint detected spatially from chroma and warm hue.
    base_r = defaults['rough']; base_m=defaults['metal']
    warm = np.clip((rgb[:,:,0]-rgb[:,:,2])*.95 + (rgb[:,:,0]-rgb[:,:,1])*.55, 0, 1)
    pale = np.clip(1.0 - sat*2.0,0,1) * np.clip(lum*1.35,0,1)
    dark = 1.0-np.clip(lum*1.8,0,1)
    if material=='metal':
        rust = np.clip(warm*.85 + dark*.12,0,1)
        bare = np.clip(pale*(1-rust)*1.15,0,1)
        metal = np.clip(base_m + bare*.30 - rust*.48 - sat*.16, .04, .94)
        rough = np.clip(base_r + rust*.28 + sat*.08 - bare*.22 + edge*.04, .18, .94)
    elif material=='glass':
        metal=np.zeros_like(lum);rough=np.clip(.16 + (1-lum)*.12 + edge*.05,.08,.42)
    elif material=='stone':
        metal=np.zeros_like(lum);rough=np.clip(.82 + edge*.05 + dark*.05,.72,.98)
    elif material in ('organic','foliage'):
        metal=np.zeros_like(lum);rough=np.clip(base_r + edge*.04 + dark*.04,.55,.96)
    else:
        metal=np.full_like(lum,base_m);rough=np.full_like(lum,base_r)

    # Material AO is local cavity only; 1 = unoccluded. Use broad-vs-local darkness and enclosed edge distance.
    cavity = np.clip((broad-local)*1.6 + edge*.16 + dark*.07,0,.55)
    ao = np.clip(1.0 - cavity, .45, 1.0)
    # emissive aux only for explicitly light-like semantic elements / FX; most materials zero.
    emissive = np.zeros_like(lum)
    if meta.get('element') in ('tree_lights','fx_magic','fx_objective','fx_portal','fx_teleport','moth_spark') or name.startswith('fx_'):
        emissive = np.clip((lum-.55)*2.2,0,1) * alpha

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
    # Transparent pixels deliberately carry safe defaults; runtime coverage comes from albedo alpha.
    nr[~mask]=np.array([128,128,255,255],np.uint8)
    hm[~mask]=np.array([0,255,0,0],np.uint8)
    report=dict(material_class=cls,source_material=material,height_scale=round(height_scale,4),height_bias=0.0,root_anchor=[.5,1.0],roughness_mean=round(float(rough[mask].mean()),4),metalness_mean=round(float(metal[mask].mean()),4),ao_mean=round(float(ao[mask].mean()),4),emissive_mean=round(float(emissive[mask].mean()),4),normal_smoothing_px=1.0,channels={'normal_roughness':'RGB=encoded XYZ normal; A=roughness','height_material':f'R=worldZ/{MAX_WORLD_Z:g}; G=AO; B=metalness; A=emissive'})
    return nr,hm,report


def make_capture(atlas, nr, hm, data, names, out_path, title):
    font_h=14; cell_w=260; cell_h=180
    out=Image.new('RGB',(cell_w*3, font_h+cell_h*len(names)),(15,16,18));dr=ImageDraw.Draw(out);dr.text((8,2),title,fill=(235,235,235))
    for row,name in enumerate(names):
        if name not in data['regions']: continue
        x,y,w,h=data['regions'][name]
        al=atlas.crop((x,y,x+w,y+h)).convert('RGBA'); n=nr.crop((x,y,x+w,y+h)).convert('RGBA'); m=hm.crop((x,y,x+w,y+h)).convert('RGBA')
        for col,(im,labeltxt) in enumerate(((al,'ALBEDO'),(n,'NORMAL / ROUGH'),(m,'HEIGHT / AO / METAL / EMISS'))):
            scale=min(1.0,150/max(1,im.width),125/max(1,im.height)); im=im.resize((max(1,int(im.width*scale)),max(1,int(im.height*scale))),Image.Resampling.NEAREST)
            ox=col*cell_w+(cell_w-im.width)//2; oy=font_h+row*cell_h+18
            out.paste(im.convert('RGB'),(ox,oy),im.getchannel('A') if im.mode=='RGBA' else None)
            dr.text((col*cell_w+6,font_h+row*cell_h+2),f'{name} · {labeltxt}',fill=(210,220,225))
    out.save(out_path)


def main():
    CAPTURE_DIR.mkdir(parents=True,exist_ok=True)
    data=json.loads(ATLAS_JSON.read_text())
    atlas=Image.open(ALBEDO_PATH).convert('RGBA')
    W,H=atlas.size
    nr_arr=np.zeros((H,W,4),np.uint8); nr_arr[:]=np.array([128,128,255,255],np.uint8)
    hm_arr=np.zeros((H,W,4),np.uint8); hm_arr[:]=np.array([0,255,0,0],np.uint8)
    al=np.asarray(atlas)
    report={'schema':'steel-moth-material-v2-report/v1','version':'1.2.2','max_world_z':MAX_WORLD_Z,'atlases':{'normal_roughness':NR_PATH.name,'height_material':HM_PATH.name},'generation_parameters':{'coverage_alpha_threshold':0.02,'geometry_alpha_threshold':0.125,'normal_smoothing_px':1.0,'macro_luminance_sigma':2.2,'local_luminance_sigma':0.75,'max_world_z':MAX_WORLD_Z,'classes':['flat','vertical_plane','box','barrel','pole','frame','pipe','robot','character','foliage','glass'],'transparent_normal':[128,128,255],'transparent_height_material':[0,255,0,0],'sampling':'region-isolated; no cross-region filters'},'regions':{}}
    for name in sorted(data['regions']):
        x,y,w,h=data['regions'][name]; crop=al[y:y+h,x:x+w,:]
        nr,hm,r=generate_region(name,crop,data['region_meta'].get(name,{}),float(data.get('world_scale',.18)))
        nr_arr[y:y+h,x:x+w]=nr; hm_arr[y:y+h,x:x+w]=hm
        data['region_meta'].setdefault(name,{})['material_v2']={k:r[k] for k in ('material_class','height_scale','height_bias','root_anchor','roughness_mean','metalness_mean','ao_mean','emissive_mean','normal_smoothing_px')}
        report['regions'][name]=r
    nr_img=Image.fromarray(nr_arr,'RGBA'); hm_img=Image.fromarray(hm_arr,'RGBA')
    nr_img.save(NR_PATH,optimize=True);hm_img.save(HM_PATH,optimize=True)
    data['material_normal_roughness_image']='assets/generated/'+NR_PATH.name
    data['material_height_image']='assets/generated/'+HM_PATH.name
    data['material_v2']={'schema':'steel-moth-material-v2/v1','max_world_z':MAX_WORLD_Z,'normal_roughness_channels':'RGB encoded XYZ normal, A roughness','height_material_channels':'R normalized pseudo-world Z, G material AO, B metalness, A emissive/auxiliary','coordinate_identity':'identical to sprite_runtime_atlas.png'}
    notes=data.get('notes',[])
    if isinstance(notes,list):
        notes=[n for n in notes if 'Material v2' not in str(n)];notes.append('Material v2 v1.2.2: explicit normal+roughness and pseudo-height+AO+metalness+emissive atlases generated deterministically region-by-region; legacy bump/spec retained as fallback/debug.')
        data['notes']=notes
    ATLAS_JSON.write_text(json.dumps(data,indent=2)+'\n');REPORT_PATH.write_text(json.dumps(report,indent=2)+'\n')
    reps=['cargo_crate','rust_barrel','server_cabinet','pipe_cluster','street_lamp','hex_maintenance_idle_0']
    make_capture(atlas,nr_img,hm_img,data,reps,CAPTURE_DIR/'material_v2_representative.png','Steel Moth Material v2 representative atlas fields')
    # machine-readable hashes prove determinism/output identity
    report['sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (NR_PATH,HM_PATH)}
    REPORT_PATH.write_text(json.dumps(report,indent=2)+'\n')
    from collections import Counter
    counts=Counter(r['material_class'] for r in report['regions'].values())
    report['class_counts']=dict(sorted(counts.items()))
    REPORT_PATH.write_text(json.dumps(report,indent=2)+'\n')
    lines=['# MATERIAL V2 AUDIT','','Generated for all **%d** atlas regions.'%len(report['regions']),'','Channel contract:','',f'- Normal/Roughness: `RGB = encoded XYZ normal`, `A = roughness`.','- Height/Material: `R = pseudo-world Z / 64`, `G = material AO`, `B = metalness`, `A = emissive/auxiliary`.','','Class coverage:','']
    for c,n in sorted(counts.items()): lines.append(f'- `{c}`: {n}')
    lines += ['','Generation parameters are recorded machine-readably in `assets/generated/material_v2_report.json`.','', 'Representative means:','']
    for n in reps:
        r=report['regions'][n];lines.append(f"- **{n}** — `{r['material_class']}`, height `{r['height_scale']}` px, rough `{r['roughness_mean']}`, metal `{r['metalness_mean']}`, AO `{r['ao_mean']}`")
    lines += ['','The legacy `sprite_bumpmap.png` and `sprite_specularmap.png` remain in the package only for A/B fallback/debug. Material v2 is authoritative by default.']
    AUDIT_MD.write_text('\n'.join(lines)+'\n')
    print(f'Generated Material v2 for {len(report["regions"])} regions -> {NR_PATH.name}, {HM_PATH.name}')

if __name__=='__main__': main()
