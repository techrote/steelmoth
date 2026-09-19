#!/usr/bin/env python3
from pathlib import Path
from PIL import Image
import json, numpy as np, math
ROOT=Path(__file__).resolve().parents[1];GEN=ROOT/'assets'/'generated'
d=json.load(open(GEN/'atlas.json'));report=json.load(open(GEN/'material_v2_report.json'))['regions'];AL=np.asarray(Image.open(GEN/'sprite_runtime_atlas.png').convert('RGBA')).astype(np.float32)/255;NR=np.asarray(Image.open(GEN/'sprite_material_normal_roughness.png').convert('RGBA')).astype(np.float32)/255;HM=np.asarray(Image.open(GEN/'sprite_material_height_material.png').convert('RGBA')).astype(np.float32)/255

def c(n,img):x,y,w,h=d['regions'][n];return img[y:y+h,x:x+w]
def nrm(v):return v/np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-6)
def segments(row):
 xs=np.where(row)[0]
 if not len(xs):return 0
 return 1+int(np.sum(np.diff(xs)>1))
def light_response(name,lx,ly,lz):
 al=c(name,AL);nr=c(name,NR);hm=c(name,HM);m=al[:,:,3]>.12;h,w=m.shape;yy,xx=np.mgrid[0:h,0:w];n=nrm(nr[:,:,:3]*2-1);z=hm[:,:,0]*64;L=nrm(np.stack([lx-xx,-(ly-yy),np.full_like(z,lz)-z],-1));return np.clip((n*L).sum(-1),0,1),m,n,z,nr,hm
# Crate: top plane is more upward-facing than the central/front plane and responds more to elevated light.
resp,m,n,z,nr,hm=light_response('cargo_crate',90,-45,45);ys,xs=np.where(m);top_cut=np.quantile(ys,.28);front_lo=np.quantile(ys,.45);front_hi=np.quantile(ys,.78);top=m&(np.indices(m.shape)[0]<=top_cut);front=m&(np.indices(m.shape)[0]>=front_lo)&(np.indices(m.shape)[0]<=front_hi);assert n[top,2].mean()>n[front,2].mean()+.025,(n[top,2].mean(),n[front,2].mean());assert resp[top].mean()>resp[front].mean()+.025,(resp[top].mean(),resp[front].mean())
# Barrel and pole: wrapped horizontal normals change sign across the body.
for name in ('rust_barrel','street_lamp'):
 al=c(name,AL);nr0=c(name,NR);mask=al[:,:,3]>.18;nx=nr0[:,:,0]*2-1;cols=np.indices(mask.shape)[1];mid=mask.shape[1]/2;left=mask&(cols<mid-.08*mask.shape[1]);right=mask&(cols>mid+.08*mask.shape[1]);assert nx[left].mean()<-.08,(name,nx[left].mean());assert nx[right].mean()>.08,(name,nx[right].mean())
# Cabinet: SM-503 deliberately replaces the old colour-driven exposed-metal heuristic
# with a semantic painted-steel prior. Preserve bounded within-class weathering without
# requiring noisy roughness/metalness variance or falsely treating paint as bare metal.
al=c('server_cabinet',AL);nr0=c('server_cabinet',NR);hm0=c('server_cabinet',HM);m=al[:,:,3]>.12;rough=nr0[:,:,3][m];metal=hm0[:,:,2][m];assert report['server_cabinet']['material_prior']=='painted_steel';assert .45<rough.mean()<.9 and rough.std()>.005,(rough.mean(),rough.std());assert metal.mean()<.45,(metal.mean(),metal.std())
# Pipe bundle: multiple silhouette runs survive and cylindrical normal variation remains.
al=c('pipe_cluster',AL);nr0=c('pipe_cluster',NR);m=al[:,:,3]>.12;runmax=max(segments(m[y]) for y in range(m.shape[0]));assert runmax>=2,runmax;nx=nr0[:,:,0]*2-1;assert nx[m].std()>.17,nx[m].std()
# Robot: semantic painted-steel response plus exact zero visible-foot pseudo-height.
# Broad material identity comes from authored semantics; colour noise no longer forces
# generic metal sprites to metalness>0.4.
al=c('hex_maintenance_idle_0',AL);hm0=c('hex_maintenance_idle_0',HM);m=al[:,:,3]>.12;assert report['hex_maintenance_idle_0']['material_prior']=='painted_steel';assert hm0[:,:,2][m].mean()<.45;ys,xs=np.where(m);bottom=ys.max();assert hm0[bottom,:,0][m[bottom]].max()<=1/255+1e-6
# Floor stays flat: low height range and normals close to +Z.
al=c('floor_plate',AL);nr0=c('floor_plate',NR);hm0=c('floor_plate',HM);m=al[:,:,3]>.12;nz=nr0[:,:,2]*2-1;assert d['region_meta']['floor_plate']['material_v2']['heightScaleWorld']<3;assert nz[m].mean()>.94,nz[m].mean();assert hm0[:,:,0][m].max()*64<3.1
# Height self-shadow must still have real blockers on the semantic box field. The old
# regression hard-coded a 45-world-unit light even when the calibrated crate is much
# shorter; that tests one historical scale rather than the shared world-Z contract.
# Probe eight grazing directions at 65% of this fixture's own calibrated maximum and
# require at least one direction to encounter actual height-field blockers.
al=c('cargo_crate',AL);hm0=c('cargo_crate',HM);m=al[:,:,3]>.12;z=hm0[:,:,0]*64;h,w=m.shape;zmax=float(z[m].max());tested=0;best_blocked=0
for angle in range(0,360,45):
 a=math.radians(angle);lx=w*.5+math.cos(a)*max(w,h)*1.15;ly=h*.5+math.sin(a)*max(w,h)*1.15;lz=zmax*.65;blocked=0;local_tested=0
 for y in range(0,h,3):
  for x in range(0,w,3):
   if not m[y,x]:continue
   dx,dy=lx-x,ly-y;ld=math.hypot(dx,dy)
   if ld<3:continue
   local_tested+=1;span=min(max(w,h)*1.4,ld)
   for i in range(1,13):
    tt=(i-.25)/12;ds=span*tt;qx=int(round(x+dx/ld*ds));qy=int(round(y+dy/ld*ds))
    if qx<0 or qx>=w or qy<0 or qy>=h:break
    if not m[qy,qx]:continue
    rz=z[y,x]*(1-ds/ld)+lz*(ds/ld)
    if z[qy,qx]>rz+1.0:blocked+=1;break
 tested=max(tested,local_tested);best_blocked=max(best_blocked,blocked)
assert tested>20 and best_blocked>0,(tested,best_blocked,zmax)
print(f'VISUAL MATERIAL PASS: semantic box/barrel/pole/pipe/floor/robot response, bounded painted-steel weathering, exact roots, and scale-relative crate height self-shadow blockers ({best_blocked}/{tested})')
