#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw
import json, numpy as np, math
ROOT=Path(__file__).resolve().parents[1];GEN=ROOT/'assets'/'generated';OUT=ROOT/'docs'/'v120_captures';OUT.mkdir(parents=True,exist_ok=True)
a=json.loads((GEN/'atlas.json').read_text())
AL=np.asarray(Image.open(GEN/'sprite_runtime_atlas.png').convert('RGBA')).astype(np.float32)/255
NR=np.asarray(Image.open(GEN/'sprite_material_normal_roughness.png').convert('RGBA')).astype(np.float32)/255
HM=np.asarray(Image.open(GEN/'sprite_material_height_material.png').convert('RGBA')).astype(np.float32)/255
BP=np.asarray(Image.open(GEN/'sprite_bumpmap.png').convert('RGBA')).astype(np.float32)/255
SP=np.asarray(Image.open(GEN/'sprite_specularmap.png').convert('RGBA')).astype(np.float32)/255

def crop(arr,n):
 x,y,w,h=a['regions'][n];return arr[y:y+h,x:x+w].copy()
def norm(v):return v/np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-6)
def pbr(name,light=(.1,-.25),self_shadow=True):
 al=crop(AL,name);nr=crop(NR,name);hm=crop(HM,name);h,w=al.shape[:2];mask=al[:,:,3]>.12
 n=norm(nr[:,:,:3]*2-1);z=hm[:,:,0]*64;rough=np.clip(nr[:,:,3],.06,1);metal=hm[:,:,2];ao=hm[:,:,1]
 yy,xx=np.mgrid[0:h,0:w];lx=light[0]*w;ly=light[1]*h;lz=max(24,float(z.max())+14)
 P=np.stack([xx,yy,z],-1);L=np.stack([np.full_like(xx,lx)-xx, -(np.full_like(yy,ly)-yy), np.full_like(z,lz)-z],-1);ld=np.linalg.norm(L,axis=-1);Ln=norm(L);V=np.zeros_like(Ln);V[...,1]=-.12;V[...,2]=1;V=norm(V);H=norm(V+Ln)
 NoL=np.clip((n*Ln).sum(-1),0,1);NoV=np.clip((n*V).sum(-1),.02,1);NoH=np.clip((n*H).sum(-1),0,1);VoH=np.clip((V*H).sum(-1),0,1)
 F0=.04*(1-metal[:,:,None])+al[:,:,:3]*metal[:,:,None];F=F0+(1-F0)*(1-VoH[:,:,None])**5;aa=np.maximum(.045,rough*rough);a2=aa*aa;D=a2/(math.pi*np.maximum((NoH*NoH*(a2-1)+1)**2,1e-5));k=(rough+1)**2/8;G=(NoV/np.maximum(NoV*(1-k)+k,1e-4))*(NoL/np.maximum(NoL*(1-k)+k,1e-4));spec=(D*G)[:,:,None]*F/np.maximum((4*NoV*NoL)[:,:,None],.04);kd=(1-F)*(1-metal[:,:,None]);# Diagnostic full-beam capture: use the production player-cone intensity without
 # point-light falloff so material response remains legible in documentation.
 atten=np.full_like(ld,2.0,dtype=np.float32)
 vis=np.ones((h,w),np.float32)
 if self_shadow:
  # 12-sample height ray toward the light in sprite pixel space.
  for y in range(h):
   for x in range(w):
    if not mask[y,x]:continue
    dx=lx-x;dy=ly-y;d=(dx*dx+dy*dy)**.5
    if d<2:continue
    span=min(d,84);blocked=False
    for i in range(1,13):
     t=(i-.18)/12;ds=span*t;qx=int(round(x+dx/d*ds));qy=int(round(y+dy/d*ds))
     if qx<0 or qx>=w or qy<0 or qy>=h:break
     if not mask[qy,qx]:continue
     rayt=ds/d;rz=z[y,x]*(1-rayt)+lz*rayt
     if z[qy,qx]>rz+1.15:blocked=True;break
    if blocked:vis[y,x]=.28
 amb=al[:,:,:3]*(.10*(.72+.28*ao[:,:,None]));rad=atten[:,:,None]*vis[:,:,None];diff=kd*al[:,:,:3]*(NoL*.86+.14)[:,:,None]*rad;sp=spec*rad*.82;rgb=np.clip(amb+diff+sp+al[:,:,:3]*hm[:,:,3,None]*.8,0,4);rgb=(1.0-np.exp(-rgb*1.60));rgb*=mask[:,:,None]
 return (np.clip(rgb,0,1)*255).astype(np.uint8), (al[:,:,3]*255).astype(np.uint8)
def legacy(name,light=(.1,-.25)):
 al=crop(AL,name);bp=crop(BP,name);spm=crop(SP,name);h,w=al.shape[:2];mask=al[:,:,3]>.02;hh=bp[:,:,0]
 hl=np.roll(hh,1,1);hr=np.roll(hh,-1,1);hu=np.roll(hh,1,0);hd=np.roll(hh,-1,0);gx=hr-hl;gy=hd-hu;n=norm(np.stack([-gx*5.8,gy*5.8,np.ones_like(gx)],-1));yy,xx=np.mgrid[0:h,0:w];lx=light[0]*w;ly=light[1]*h;L=norm(np.stack([lx-xx,-(ly-yy),np.full_like(xx,65)],-1));ndl=np.clip((n*L).sum(-1),0,1);V=np.zeros_like(L);V[...,2]=1;R=2*((n*L).sum(-1))[...,None]*n-L;spec=np.clip(R[...,2],0,1)**7*.42*spm[:,:,0];rgb=np.clip(al[:,:,:3]*(.68+ndl[:,:,None]*.38)+spec[:,:,None],0,4);rgb=(1.0-np.exp(-rgb*1.60))*mask[:,:,None];return (np.clip(rgb,0,1)*255).astype(np.uint8),(al[:,:,3]*255).astype(np.uint8)
def tile(rgb,alpha,scale=2):
 im=Image.fromarray(np.dstack([rgb,alpha]),'RGBA');return im.resize((im.width*scale,im.height*scale),Image.Resampling.NEAREST)
def panel(name):
 bef=tile(*legacy(name));v1=tile(*pbr(name,(-.15,-.20)));v2=tile(*pbr(name,(.5,-.30)));v3=tile(*pbr(name,(1.15,-.20)))
 ims=[bef,v1,v2,v3];W=max(i.width for i in ims)+20;H=max(i.height for i in ims)+38;out=Image.new('RGB',(W*4,H),(12,13,15));d=ImageDraw.Draw(out);labels=['LEGACY','V2 · LEFT','V2 · ABOVE','V2 · RIGHT']
 for j,im in enumerate(ims):out.paste(im,(j*W+(W-im.width)//2,28),im);d.text((j*W+6,6),f'{name} · {labels[j]}',fill=(235,235,235))
 out.save(OUT/f'{name}_before_after.png')
for n in ['cargo_crate','rust_barrel','server_cabinet','pipe_cluster','street_lamp','hex_maintenance_idle_0']:panel(n)
# Mixed terrain reference plate from actual runtime sprites, lit consistently from upper-left.
names=['cargo_crate','rust_barrel','server_cabinet','pipe_cluster','street_lamp','barrier_concrete','hvac_unit']
canvas=Image.new('RGBA',(780,300),(18,18,20,255));x=25
for i,n in enumerate(names):
 rgb,aa=pbr(n,(-.25,-.25));im=tile(rgb,aa,1);scale=min(1.0,180/max(1,im.height),120/max(1,im.width));im=im.resize((max(1,int(im.width*scale)),max(1,int(im.height*scale))),Image.Resampling.NEAREST);y=270-im.height;canvas.alpha_composite(im,(x,y));x+=100
canvas.convert('RGB').save(OUT/'mixed_dense_terrain_v2.png')
print('wrote representative captures:',len(list(OUT.glob('*.png'))))
# Deterministic moving-light diagnostic sweeps. These are offline material-field
# validations (not browser screenshots) using the same GGX/height data contract.
def sweep(name, frames=16):
    ims=[]
    for i in range(frames):
        a=i/(frames-1)*math.pi
        # Sweep from upper-left through overhead to upper-right.
        lx=-.25+1.50*(i/(frames-1)); ly=-.28+.05*math.sin(a)
        rgb,aa=pbr(name,(lx,ly),True)
        im=tile(rgb,aa,2).convert('RGBA')
        bg=Image.new('RGBA',im.size,(12,13,15,255));bg.alpha_composite(im);ims.append(bg.convert('P',palette=Image.Palette.ADAPTIVE,colors=128))
    ims[0].save(OUT/f'{name}_light_sweep.gif',save_all=True,append_images=ims[1:],duration=90,loop=0,disposal=2)
for n in ['cargo_crate','rust_barrel','server_cabinet','pipe_cluster','street_lamp','hex_maintenance_idle_0']:
    sweep(n)
print('wrote moving-light sweeps:',len(list(OUT.glob('*_light_sweep.gif'))))
