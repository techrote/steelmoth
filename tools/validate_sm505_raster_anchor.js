#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const T=require('../engine/render_transform.js');
const P=require('../engine/webgpu_scene_presenter.js');

const close=(a,b,label)=>assert(Math.abs(a-b)<1e-10,`${label}: ${a} versus ${b}`);
// Independent Canvas2D postmultiply matrices: translate(anchor), rotate, draw
// the authored destination rectangle. Horizontal flip reverses sampled texels
// inside that rectangle, as the sprite source's Canvas2D draw path does.
function multiply(a,b){return[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]}
function apply(m,p){return[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]]}
function canvasCorners(q){
  const c=Math.cos(q.rotation),s=Math.sin(q.rotation),m=multiply([1,0,0,1,q.x,q.y],[c,s,-s,c,0,0]);
  const top=q.anchor==='bottom'?-q.h:q.anchor==='top'?0:-q.h/2;
  return[[-q.w/2,top],[q.w/2,top],[-q.w/2,top+q.h],[q.w/2,top+q.h]].map(p=>apply(m,p));
}
function centeredGpuCorners(q,center){
  const c=Math.cos(q.rotation),s=Math.sin(q.rotation),m=multiply([1,0,0,1,center.x,center.y],[c,s,-s,c,0,0]);
  return[[-q.w/2,-q.h/2],[q.w/2,-q.h/2],[-q.w/2,q.h/2],[q.w/2,q.h/2]].map(p=>apply(m,p));
}
const art={regions:{prop:[0,0,40,32]},regionMeta(){return{material_v2:{root_anchor:[.3,.8]}}}};
let cases=0;
for(const anchor of ['center','bottom','top'])for(const rotation of [0,Math.PI/2,-Math.PI/3,.37])for(const flip of [false,true])for(const subrect of [null,{sx:7,sy:9,sw:13,sh:11}]){
  const q={x:260,y:165,w:subrect?20:40,h:subrect?14:32,anchor,rotation,flip,subrect};
  const before=JSON.stringify(q),rootBefore=T.resolve(art,'prop',q),center=T.rasterCenter(q),expected=canvasCorners(q),actual=centeredGpuCorners(q,center);
  for(let i=0;i<4;i++)for(let axis=0;axis<2;axis++)close(actual[i][axis],expected[i][axis],`${anchor}/${rotation}/${flip}/${!!subrect} corner${i} axis${axis}`);
  assert.equal(JSON.stringify(q),before,'raster conversion must never mutate source transform');
  assert.deepEqual(T.resolve(art,'prop',q),rootBefore,'raster conversion cannot change canonical root including historical subrect behavior');
  assert.deepEqual(T.quadCenter(q),center,'quadCenter is the identical shared helper');
  assert.deepEqual(T.rasterCenter({...q,flip:!flip}),center,'flip changes UV orientation, not anchor offset');
  const scene={frame:{logicalSize:[640,360]},settings:{},sprites:[{id:'prop',category:'static',transform:{x:q.x,y:q.y,w:q.w,h:q.h,rotation,flip},root:{...rootBefore.root,anchorMode:anchor},subrect,style:{alpha:1}}]};
  const sceneBefore=JSON.stringify(scene);
  for(const scale of [1,2,3]){
    const native=P.scaleScene(scene,640*scale,360*scale,null,null,T).scene,derived=native.sprites[0];
    const corners=centeredGpuCorners({...q,w:derived.transform.w,h:derived.transform.h},derived.transform);
    for(let i=0;i<4;i++)for(let axis=0;axis<2;axis++)close(corners[i][axis],expected[i][axis]*scale,'actual presenter derived raster corner');
    close(derived.root.x,rootBefore.root.x*scale,'root X remains canonical');close(derived.root.y,rootBefore.root.y*scale,'root Y remains canonical');
    if(scale===2){const again=P.scaleScene(native,1920,1080,null,null,T).scene.sprites[0];close(again.transform.x,center.x*3,'rederived native X cannot apply anchor twice');close(again.transform.y,center.y*3,'rederived native Y cannot apply anchor twice')}
  }
  assert.equal(JSON.stringify(scene),sceneBefore,'presenter only derives raster geometry');
  if(subrect)assert.deepEqual(T.rasterCenter({...q,subrect:null}),center,'source crop affects UVs, explicit destination extent controls geometry');
  cases++;
}
assert.deepEqual(T.rasterCenter({x:100,y:90,w:40,h:20,anchor:'bottom'}),{x:100,y:80});
assert.deepEqual(T.rasterCenter({x:100,y:70,w:40,h:20,anchor:'top'}),{x:100,y:80});
assert.deepEqual(T.rasterCenter({x:100,y:80,w:40,h:20}),{x:100,y:80});
const rotated={x:100,y:90,w:40,h:20,anchor:'bottom',rotation:Math.PI/2};
close(T.rasterCenter(rotated).x,110,'bottom anchor rotates its offset into X');close(T.rasterCenter(rotated).y,90,'bottom pivot Y retained under90degrees');
const expected=canvasCorners(rotated),old=centeredGpuCorners(rotated,{x:rotated.x,y:rotated.y}),subtractUnrotated=centeredGpuCorners(rotated,{x:rotated.x,y:rotated.y-rotated.h/2});
assert(Math.hypot(old[0][0]-expected[0][0],old[0][1]-expected[0][1])>9,'retained ignored-anchor mutation displaces geometry by half height');
assert(Math.hypot(subtractUnrotated[0][0]-expected[0][0],subtractUnrotated[0][1]-expected[0][1])>14,'retained subtract-half-height-without-pivot mutation fails rotated geometry');
console.log(`SM-505 RASTER ANCHOR CPU PASS: ${cases} independent Canvas2D matrix/quad corner cases, full/subrect center/bottom/top rotation/flip, immutable root semantics and two retained incorrect-placement witnesses; no GPU execution`);
