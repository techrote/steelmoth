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
// Endpoint grid corners touch cells immediately before and after that point.
const endpointCorner=fixture();endpointCorner.mark(2,9);
check(S.rayBlocked(endpointCorner,0,0,2,10),'endpoint corner conservatively includes upper-right tangent occluder');
check(S.rayBlocked(endpointCorner,2,10,0,0),'endpoint corner remains blocked under reverse traversal');
check(!S.rayBlocked(endpointCorner,0,0,1.999,10),'nearby non-corner endpoint does not overblock');
// Floating DDA times may differ on an exact interior grid-corner crossing.
const interiorCorner=fixture();interiorCorner.mark(6,3);
check(S.rayBlocked(interiorCorner,0,0,9,6),'interior diagonal corner touch blocks upper-right neighbour');
check(S.rayBlocked(interiorCorner,9,6,0,0),'interior diagonal corner touch is reversible');
// A degenerate ray at a cell corner still touches four adjoining cells.
const pointCorner=fixture();pointCorner.mark(7,17);
check(S.rayBlocked(pointCorner,8,18,8,18),'zero-length corner touching an adjacent occluder blocks');
check(!S.rayBlocked(pointCorner,8.001,18.001,8.001,18.001),'interior zero-length point is not spuriously blocked');
// Terminate at the actual ray endpoint, not after stepping past an integer
// destination boundary. These were false BLOCKED results in empty fixtures.
const terminationClear = fixture();
check(!S.rayBlocked(terminationClear,40,12,38,13),'grid-edge destination descending ray stays clear');
check(!S.rayBlocked(terminationClear,27,29,34,27),'grid-edge destination mixed-sign ray stays clear');
check(!S.rayBlocked(terminationClear,2,10,0,0),'origin-to-border corner ray stays clear');
check(S.rayBlocked(terminationClear,8.5,18.5,WIDTH,18.5),'right-boundary destination remains fail-closed');
check(S.rayBlocked(terminationClear,8.5,18.5,8.5,HEIGHT),'bottom-boundary destination remains fail-closed');
check(S.rayBlocked(terminationClear,8.5,18.5,-0.25,18.5),'negative out-of-fixture destination remains fail-closed');
const terminationOffPath = fixture();terminationOffPath.mark(15,24);
check(!S.rayBlocked(terminationOffPath,40,12,38,13),'distant unrelated occluder does not falsely block endpoint ray');
const terminationAtEndpoint = fixture();terminationAtEndpoint.mark(37,12);
check(S.rayBlocked(terminationAtEndpoint,40,12,38,13),'incident endpoint occluder still blocks');

// Independent exact closed-cell geometry oracle. Quarter-pixel coordinates
// keep orientation products integral and exact within JS safe integer range.
// This is fixture-level CPU verification, not a GPU/visual performance test.
const orientation = (a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const onSegment = (a,b,c)=>c[0]>=Math.min(a[0],b[0])&&c[0]<=Math.max(a[0],b[0])&&c[1]>=Math.min(a[1],b[1])&&c[1]<=Math.max(a[1],b[1]);
function segmentsIntersect(a,b,c,d) {
  const p=orientation(a,b,c),q=orientation(a,b,d),r=orientation(c,d,a),s=orientation(c,d,b);
  return (p===0&&onSegment(a,b,c))||(q===0&&onSegment(a,b,d))||
    (r===0&&onSegment(c,d,a))||(s===0&&onSegment(c,d,b))||
    ((p>0)!==(q>0)&&(r>0)!==(s>0));
}
function segmentTouchesPixel(ax,ay,bx,by,x,y) {
  const a=[ax,ay],b=[bx,by],left=4*x,top=4*y,right=left+4,bottom=top+4;
  const inside=v=>v[0]>=left&&v[0]<=right&&v[1]>=top&&v[1]<=bottom;
  return inside(a)||inside(b)||
    segmentsIntersect(a,b,[left,top],[right,top])||
    segmentsIntersect(a,b,[right,top],[right,bottom])||
    segmentsIntersect(a,b,[right,bottom],[left,bottom])||
    segmentsIntersect(a,b,[left,bottom],[left,top]);
}
let seed=0x21ab34cd;
function nextSeed() {seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
const rays=[[0,0,36,24],[32,72,32,72],[8,40,0,0],[32,72,120,72],[32,72,32,116]];
for(let i=0;i<500;i++) {
  let ax=4+(nextSeed()%(4*(WIDTH-2))),ay=4+(nextSeed()%(4*(HEIGHT-2)));
  let bx=4+(nextSeed()%(4*(WIDTH-2))),by=4+(nextSeed()%(4*(HEIGHT-2)));
  if(i%4===0)ay=by;
  if(i%4===1)ax=bx;
  if(i%5===0) {ax=Math.round(ax/4)*4;bx=Math.round(bx/4)*4;ay=Math.round(ay/4)*4;by=Math.round(by/4)*4;}
  rays.push([ax,ay,bx,by]);
}
const sweep=fixture();
let comparisons=0, touchedComparisons=0, clearComparisons=0;
for(const [ax,ay,bx,by] of rays) {
  const touched=[],untouched=[];
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++) {
    (segmentTouchesPixel(ax,ay,bx,by,x,y)?touched:untouched).push([x,y]);
  }
  const cases=touched.map(cell=>[cell,true]);
  for(let i=0;i<5;i++)cases.push([untouched[nextSeed()%untouched.length],false]);
  for(const [cell,expected] of cases) {
    if(!cell)continue;
    const [x,y]=cell,k=y*WIDTH+x;
    sweep.occluderMask[k]=1;sweep.objectIds[k]=9;
    sweep.depthLevel0[2*k]=0.35;sweep.depthLevel0[2*k+1]=0.35;
    assert.equal(S.rayBlocked(sweep,ax/4,ay/4,bx/4,by/4),expected,
      'closed-cell geometry mismatch ray='+[ax/4,ay/4,bx/4,by/4]+' cell='+cell);
    sweep.occluderMask[k]=0;sweep.objectIds[k]=0;
    sweep.depthLevel0[2*k]=1;sweep.depthLevel0[2*k+1]=0;
    comparisons++;if(expected)touchedComparisons++;else clearComparisons++;
  }
}
check(comparisons>14000&&touchedComparisons>11000&&clearComparisons>2000,
  'seeded independent closed-cell geometry sweep checks touched and clear cells');

// A second, independent closed-segment clipping oracle samples arbitrary
// subpixels and near-integer grid crossings; the quarter-pixel sweep above
// does not exercise floating geometry close to pixel boundaries. Check both
// traversal directions without relying on the implementation's DDA.
let subpixelSeed = 0x51a9b0e3;
function subpixelRandom() {
  subpixelSeed ^= subpixelSeed << 13;
  subpixelSeed ^= subpixelSeed >>> 17;
  subpixelSeed ^= subpixelSeed << 5;
  return (subpixelSeed >>> 0) / 4294967296;
}
function slabTouchesCell(ax, ay, bx, by, x, y) {
  let enter = 0, exit = 1;
  for (const [start, delta, min, max] of [[ax, bx-ax, x, x+1], [ay, by-ay, y, y+1]]) {
    if (delta === 0) {
      if (start < min || start > max) return false;
    } else {
      const first = (min-start)/delta, last = (max-start)/delta;
      enter = Math.max(enter, Math.min(first, last));
      exit = Math.min(exit, Math.max(first, last));
      if (enter > exit) return false;
    }
  }
  return true;
}
function subpixelCoordinate(limit, variant) {
  const raw = 1 + subpixelRandom() * (limit - 2);
  switch (variant % 7) {
    case 0: return Math.round(raw);
    case 1: return Math.round(raw) + 1e-9;
    case 2: return Math.round(raw) - 1e-9;
    case 3: return Math.floor(raw) + 1/3;
    case 4: return Math.floor(raw) + 0.25;
    case 5: return Math.floor(raw) + 0.5;
    default: return raw;
  }
}
const subpixelFixture = fixture();
let subpixelCount = 0, subpixelBlocked = 0, subpixelClear = 0;
for (let i = 0; i < 320; i++) {
  const ax = subpixelCoordinate(WIDTH,i), ay = subpixelCoordinate(HEIGHT,i+1);
  const bx = subpixelCoordinate(WIDTH,i+2), by = subpixelCoordinate(HEIGHT,i+3);
  const touched = [];
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    if (slabTouchesCell(ax, ay, bx, by, x, y)) touched.push([x,y]);
  }
  const candidates = [];
  for (let k = 0; k < 8; k++) candidates.push(touched[Math.floor(subpixelRandom()*touched.length)]);
  for (let k = 0; k < 8; k++) candidates.push([Math.floor(subpixelRandom()*WIDTH), Math.floor(subpixelRandom()*HEIGHT)]);
  for (const [x,y] of candidates) {
    const index = y*WIDTH+x, expected = slabTouchesCell(ax,ay,bx,by,x,y);
    subpixelFixture.mark(x,y);
    assert.equal(S.rayBlocked(subpixelFixture,ax,ay,bx,by),expected,'subpixel forward ray='+[ax,ay,bx,by]+' cell='+[x,y]);
    assert.equal(S.rayBlocked(subpixelFixture,bx,by,ax,ay),expected,'subpixel reverse ray='+[ax,ay,bx,by]+' cell='+[x,y]);
    subpixelFixture.occluderMask[index]=0;subpixelFixture.objectIds[index]=0;
    subpixelFixture.depthLevel0[2*index]=1;subpixelFixture.depthLevel0[2*index+1]=0;
    subpixelCount+=2;if(expected)subpixelBlocked+=2;else subpixelClear+=2;
  }
}
check(subpixelCount===10240&&subpixelBlocked>2000&&subpixelClear>1000,
  'independent slab clipping covers 10,240 fractional/near-edge forward and reverse ray-cell checks');

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
