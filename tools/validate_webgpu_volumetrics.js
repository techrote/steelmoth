'use strict';
const assert = require('node:assert/strict');
const S = require('../engine/webgpu_volumetrics.js');
let passed = 0;
function check(value, label) {assert.ok(value, label); passed++;}
const WIDTH = 49, HEIGHT = 33, SIZE = WIDTH * HEIGHT;
function fixture() {
  const depthLevel0 = new Float32Array(SIZE * 2);
  for (let i = 0; i < SIZE; i++) {depthLevel0[2*i] = 1; depthLevel0[2*i+1] = 0;}
  const f = {width:WIDTH,height:HEIGHT,depthLevel0,objectIds:new Uint32Array(SIZE),occluderMask:new Uint8Array(SIZE),dsoLightVisibility:new Float32Array(SIZE).fill(1),playerCone:{type:'cone',typeValue:1,position:[8.5,18.5,22],direction:[1,0],radius:41,intensity:2,color:[1,1,1],innerCos:0.96,outerCos:0.65}};
  f.mark = (x,y,id=9)=>{const i=y*WIDTH+x;f.depthLevel0[2*i]=0.35;f.depthLevel0[2*i+1]=0.35;f.objectIds[i]=id;f.occluderMask[i]=1;};
  return f;
}
const opt = {enabled:true,steps:16,strength:0.1,density:0.16};
const qIndex=(x,y)=>Math.floor(y/4)*Math.ceil(WIDTH/4)+Math.floor(x/4);
const base = fixture(), clear = S.referenceScattering(base,opt);
check(clear.width===13&&clear.height===9,'odd full-resolution dimensions ceil to exact quarter extent');
check(clear.data[qIndex(30,18)]>0,'clear air inside canonical player cone is illuminated');
check(clear.data[qIndex(4,18)]===0,'behind player is unlit');
check(clear.data[qIndex(12,0)]===0,'off-angle corner is unlit');
check(clear.data.every(v=>Number.isFinite(v)&&v>=0&&v<=0.12),'all results finite, nonnegative and hard bounded');
check(clear.diagnostics.runtimeIntegrated===false,'reference does not imply production integration');
check(S.referenceScattering(base,{enabled:false}).data.every(v=>v===0),'explicit disabled mode is exact zero');
check(S.referenceScattering(base).data.every(v=>v===0),'default disabled mode is exact zero');
check(S.referenceScattering(base,{...opt,strength:0}).data.every(v=>v===0),'zero strength exact neutral');
check(S.referenceScattering(base,{...opt,density:0}).data.every(v=>v===0),'zero density exact neutral');
check(S.normalizeOptions({steps:999,strength:Infinity,density:-4}).steps===20,'traversal integration count is capped');
check(S.normalizeOptions({steps:-10}).steps===12,'traversal integration has floor');
const wall=fixture();for(let y=13;y<=27;y++)for(let x=21;x<=22;x++)wall.mark(x,y);
const w=S.referenceScattering(wall,opt);
check(w.data[qIndex(30,18)]===0&&w.blocked[qIndex(30,18)]===1,'occluder blocks transmitted beam without requiring prepainted DSO shadow');
check(w.data[qIndex(14,18)]>0,'beam remains illuminated before wall');
check(w.data[qIndex(12,0)]===0,'outside-cone air stays neutral');
check(wall.objectIds[18*WIDTH+22]===9,'fixture retains canonical object ownership');
const hole=fixture();hole.mark(21,18);hole.occluderMask[18*WIDTH+21]=0;
check(S.referenceScattering(hole,opt).data[qIndex(30,18)]===clear.data[qIndex(30,18)],'non-occluder geometry does not invent a shadow');
const empty=fixture();empty.mark(21,18);empty.depthLevel0[2*(18*WIDTH+21)]=1;empty.depthLevel0[2*(18*WIDTH+21)+1]=0;
check(S.referenceScattering(empty,opt).data[qIndex(30,18)]===clear.data[qIndex(30,18)],'invalid/unoccupied SM-203 range does not cast');
const dso=fixture();dso.dsoLightVisibility[18*WIDTH+30]=0;
check(S.referenceScattering(dso,opt).data[qIndex(30,18)]===0,'per-light DSO zero is never interpreted as lit');
const partial=fixture();partial.dsoLightVisibility[18*WIDTH+30]=0.5;
check(Math.abs(S.referenceScattering(partial,opt).data[qIndex(30,18)]-clear.data[qIndex(30,18)]/2)<1e-8,'per-cone DSO strength scales scattering');
const backwards=fixture();backwards.playerCone.direction=[-1,0];
check(S.referenceScattering(backwards,opt).data[qIndex(30,18)]===0,'scattering rotates with canonical cone');
check(Buffer.compare(Buffer.from(clear.data.buffer),Buffer.from(S.referenceScattering(base,opt).data.buffer))===0,'reference deterministic bitwise');
check(base.occluderMask.every(v=>v===0),'reference does not mutate caller mask');
check(S.rayBlocked({width:WIDTH,height:HEIGHT,...wall},8.5,18.5,30.5,18.5),'supercover crosses thick wall');
const diagonal=fixture();diagonal.mark(19,19);check(S.rayBlocked(diagonal,8.5,8.5,29.5,29.5),'diagonal exact-cell occluder is not skipped');
const corner=fixture();corner.mark(12,11);check(S.rayBlocked(corner,8.5,8.5,16.5,16.5),'corner-adjacent occluder conservatively interrupts supercover');
// True supercover also includes the *other* row/column for rays on a grid edge.
// The former DDA considered only floor(y) or floor(x), leaking at edge-aligned beams.
const edgeRow=fixture();edgeRow.mark(21,17);
check(S.rayBlocked(edgeRow,8.5,18,30.5,18),'horizontal grid-edge ray blocks occluder in upper-adjacent row');
check(S.rayBlocked(edgeRow,30.5,18,8.5,18),'reverse horizontal grid-edge ray also blocks adjacent row');
check(!S.rayBlocked(edgeRow,8.5,18.5,30.5,18.5),'horizontal non-edge ray does not overblock neighbouring row');
const edgeColumn=fixture();edgeColumn.mark(20,21);
check(S.rayBlocked(edgeColumn,21,8.5,21,29.5),'vertical grid-edge ray blocks occluder in left-adjacent column');
check(S.rayBlocked(edgeColumn,21,29.5,21,8.5),'reverse vertical grid-edge ray also blocks adjacent column');
check(!S.rayBlocked(edgeColumn,22.5,8.5,22.5,29.5),'vertical non-edge ray remains clear outside adjacent column');
// Exported ray traversal must fail closed for malformed/out-of-bounds inputs.
check(S.rayBlocked(base,-1,-1,-1,-1),'zero-length out-of-bounds source is blocked');
check(S.rayBlocked(base,-1,18,-1,18),'zero-length horizontal outside source is blocked');
check(S.rayBlocked(base,NaN,18,30,18),'non-finite ray origin is blocked');
check(S.rayBlocked(base,8.5,18.5,Infinity,18.5),'non-finite ray endpoint is blocked');
check(!S.rayBlocked(base,8.5,18.5,8.5,18.5),'valid zero-length clear-air ray remains clear');
const blockedStart=fixture();blockedStart.mark(8,18);
check(S.rayBlocked(blockedStart,8.5,18.5,8.5,18.5),'valid zero-length macro-occluder ray remains blocked');
// An extreme one-dimensional fixture would evade the former area-only cap.
assert.throws(()=>S.referenceScattering({...base,width:513,height:1},opt),/fixture dimensions/);passed++;
assert.throws(()=>S.referenceScattering({...base,width:1,height:513},opt),/fixture dimensions/);passed++;
const missing=fixture();delete missing.dsoLightVisibility;
assert.throws(()=>S.referenceScattering(missing,opt),/per-cone DSO/);passed++;
assert.throws(()=>S.referenceScattering({...base,width:2048,height:2048},opt),/fixture dimensions/);passed++;
assert.throws(()=>S.referenceScattering({...base,playerCone:{...base.playerCone,innerCos:0.5,outerCos:0.8}},opt),/geometry/);passed++;
assert.throws(()=>S.referenceScattering({...base,playerCone:{...base.playerCone,direction:[0,0]}},opt),/geometry/);passed++;
console.log('SM-700 REFERENCE PASS: ' + passed + ' assertions; quarter extent, cone, supercover, depth/DSO, off, bounds, no mutation');
