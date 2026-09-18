'use strict';
const assert=require('assert');
const T=require('../engine/webgpu_dark_bloom_temporal.js');

function field(width,height,cx,cy,amp=.4,radius=8){
  const out=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const d=Math.hypot(x-cx,y-cy);out[y*width+x]=d<=radius?amp*Math.max(0,1-d/(radius+1)):0;
  }
  return out;
}
function ranges(width,height,d=.8){const out=new Float32Array(width*height*2);for(let i=0;i<width*height;i++){out[i*2]=d;out[i*2+1]=d;}return out;}
function maxError(a,b){let m=0;for(let i=0;i<Math.min(a.length,b.length);i++)m=Math.max(m,Math.abs(a[i]-b[i]));return m;}

assert.strictEqual(T.SCHEMA,'steelmoth-webgpu-dark-bloom-temporal/v1');
const cfg=T.settings({historyWeight:.72,depthThreshold:.02,maxLightAngleDeg:6,maxLightMovePixels:12});
assert(cfg.historyWeight>0&&cfg.historyWeight<1);assert.strictEqual(T.settings({historyWeight:99}).historyWeight,.95);assert.strictEqual(T.settings({historyWeight:-2}).historyWeight,0);

const c0=T.clusterSignature({jobs:[{clusterId:7,ownerObjectId:10,memberIds:[12,11],clusterBounds:[10,10,40,50]}]},4);
const c0b=T.clusterSignature({jobs:[{clusterId:7,ownerObjectId:10,memberIds:[11,12],clusterBounds:[11,10,41,50]}]},4);
const c1=T.clusterSignature({jobs:[{clusterId:7,ownerObjectId:10,memberIds:[11,12],clusterBounds:[22,10,52,50]}]},4);
assert.strictEqual(c0,c0b,'sub-quantum geometry noise should not reset temporal history');assert.notStrictEqual(c0,c1,'large geometry movement must change cluster validity signature');
const light0=T.lightState({id:'player',direction:[1,0],position:[20,20]});
const lightSlow=T.lightState({id:'player',direction:[Math.cos(Math.PI/90),Math.sin(Math.PI/90)],position:[21,20]});
const lightTeleport=T.lightState({id:'player',direction:[0,1],position:[80,20]});
assert.strictEqual(T.lightDiscontinuity(light0,lightSlow,cfg).reject,false,'2 degree/1px light motion should retain soft history');
assert.strictEqual(T.lightDiscontinuity(lightSlow,lightTeleport,cfg).reject,true,'large light discontinuity must reject history');

const width=48,height=32,count=width*height,hard=new Float32Array(count),objects=new Uint32Array(count),depth=ranges(width,height,.8);
for(let y=11;y<19;y++)for(let x=10;x<18;x++){hard[y*width+x]=1;objects[y*width+x]=42;}
const a=field(width,height,27,15,.42,9),b=field(width,height,28,15,.42,9);
for(let i=0;i<count;i++)if(hard[i]){a[i]=0;b[i]=0;}
const first=T.temporalReference({width,height,current:a,hardMask:hard,currentDepth:depth,currentObject:objects,historyValid:false,globalReject:true},{historyWeight:.72});
assert(maxError(first.full,a)<1e-7,'first invalid-history frame must use current soft field exactly');assert.strictEqual(first.diagnostics.accepted,0);assert.strictEqual(first.diagnostics.rejected,count);
const second=T.temporalReference({width,height,current:b,hardMask:hard,currentDepth:depth,currentObject:objects,previous:first.full,previousDepth:depth,previousObject:objects,historyValid:true,globalReject:false},{historyWeight:.72});
assert(second.diagnostics.accepted>count*.9,'stable soft history should be accepted for almost all non-core pixels');assert(T.rmsDelta(second.full,first.full)<T.rmsDelta(b,a),'temporal residual should reduce slow-light frame-to-frame penumbra change');
for(let i=0;i<count;i++)if(hard[i])assert.strictEqual(second.full[i],0,'hard DSO core must never inherit temporal residual');

const tele=T.temporalReference({width,height,current:b,hardMask:hard,currentDepth:depth,currentObject:objects,previous:second.full,previousDepth:depth,previousObject:objects,historyValid:true,globalReject:true},{historyWeight:.72});
assert(maxError(tele.full,b)<1e-7,'light teleport/global rejection must return the current field without a trail');assert.strictEqual(tele.diagnostics.accepted,0);

const movedDepth=Float32Array.from(depth),movedObjects=Uint32Array.from(objects),probe=15*width+30;movedDepth[probe*2]=.45;movedDepth[probe*2+1]=.45;movedObjects[probe]=99;
const local=T.temporalReference({width,height,current:b,hardMask:hard,currentDepth:movedDepth,currentObject:movedObjects,previous:second.full,previousDepth:depth,previousObject:objects,historyValid:true,globalReject:false},{historyWeight:.72});
assert(local.diagnostics.reasons.depth>=1,'depth discontinuity must be visible in rejection counters');
const objectProbe=15*width+31,movedObjectsOnly=Uint32Array.from(objects);movedObjectsOnly[objectProbe]=77;
const objectReject=T.temporalReference({width,height,current:b,hardMask:hard,currentDepth:depth,currentObject:movedObjectsOnly,previous:second.full,previousDepth:depth,previousObject:objects,historyValid:true,globalReject:false},{historyWeight:.72});
assert(objectReject.diagnostics.reasons.object>=1,'object ownership discontinuity must be visible in rejection counters');

const zero=new Float32Array(count);const cleared=T.temporalReference({width,height,current:zero,hardMask:hard,currentDepth:depth,currentObject:objects,previous:second.full,previousDepth:depth,previousObject:objects,historyValid:true,globalReject:true},{historyWeight:.72});
assert(Array.from(cleared.full).every(v=>v===0),'invalidation with an empty current field must leave no stale bin silhouette');
assert.strictEqual(cleared.diagnostics.rejectedPercent,100);

console.log('SM-306 Dark Bloom temporal deterministic tests: PASS',JSON.stringify({acceptedPercent:second.diagnostics.acceptedPercent,rejectedPercent:second.diagnostics.rejectedPercent,rawRms:T.rmsDelta(b,a),temporalRms:T.rmsDelta(second.full,first.full),teleportRejected:tele.diagnostics.rejected,depthRejected:local.diagnostics.reasons.depth,objectRejected:objectReject.diagnostics.reasons.object,clusterStable:c0===c0b,clusterMoved:c0!==c1}));
