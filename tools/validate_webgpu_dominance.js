'use strict';
const assert=require('assert');
const O=require('../engine/webgpu_occluders.js');
const C=require('../engine/webgpu_clusters.js');
const D=require('../engine/webgpu_dominance.js');

const options={tileSize:32,maxOccluders:32,maxPerTile:16,maxTileRefs:256};
const scene={frame:{roomId:'dominance-cardinal',logicalSize:[128,96]},occluders:[
  {id:'bin:left',rect:[20,20,48,60],root:{x:34,y:60},kind:'machine',source:'bin',sections:[{z:22}]},
  {id:'bin:middle',rect:[46,30,74,70],root:{x:60,y:70},kind:'machine',source:'bin',sections:[{z:24}]},
  {id:'bin:right',rect:[72,5,100,45],root:{x:86,y:46},kind:'machine',source:'bin',sections:[{z:20}]}
]};
const occ=O.buildOccluderSnapshot(scene,options),clusters=C.buildClusterSnapshot(occ);
assert.strictEqual(clusters.clusters.length,1,'three overlapping/touching bins must form one SM-301 cluster');
const ids=Object.fromEntries(scene.occluders.map(o=>[o.id,O.objectIdForOccluder(o)]));
const cardinal=[
  {id:'light:right',position:[620,38,24],radius:1000,intensity:1,expected:ids['bin:right']},
  {id:'light:down',position:[60,620,24],radius:1000,intensity:1,expected:ids['bin:middle']},
  {id:'light:left',position:[-500,38,24],radius:1000,intensity:1,expected:ids['bin:left']},
  {id:'light:up',position:[60,-500,24],radius:1000,intensity:1,expected:ids['bin:right']}
];
const cardinalSnap=D.buildDominanceSnapshot(clusters,occ,cardinal);
assert.strictEqual(cardinalSnap.records.length,4,'one dominant owner record is emitted per relevant cardinal light');
for(const light of cardinal){
  const r=cardinalSnap.records.find(x=>x.lightId===light.id);assert(r,`missing dominance record for ${light.id}`);
  assert.strictEqual(r.ownerObjectId,light.expected,`${light.id} should choose the exposed expected bin`);
  assert.strictEqual(r.memberScores.length,3,'debug score detail covers every cluster member');
  assert(r.memberScores.every(s=>Number.isFinite(s.score)&&s.components.exposedSilhouette>=0&&s.components.lightExposure>=0),'score components are finite and exposed');
}
assert.strictEqual(cardinalSnap.diagnostics.singleOwnerPerClusterLight,true);
assert.strictEqual(cardinalSnap.diagnostics.allMembersFullShadow,false,'SM-302 must never fall back to all-members full macro shadows');

const cluster=clusters.clusters[0],clusterCenter=[(cluster.bounds[0]+cluster.bounds[2])/2,(cluster.bounds[1]+cluster.bounds[3])/2];
const polar=(id,deg,r=600)=>{const a=deg*Math.PI/180;return{id,position:[clusterCenter[0]+Math.cos(a)*r,clusterCenter[1]+Math.sin(a)*r,24],radius:1200,intensity:1}};
let history=new Map(),owner=null;
for(const deg of [-2,-1,0,1,2]){
  const snap=D.buildDominanceSnapshot(clusters,occ,[polar('light:sweep',deg)],history),r=snap.records[0];
  if(owner===null)owner=r.ownerObjectId;else assert.strictEqual(r.ownerObjectId,owner,`owner must not pop under ${deg} degree perturbation around cardinal light`);
  history=snap.history;
}

const tieScene={frame:{roomId:'hysteresis',logicalSize:[128,80]},occluders:[
  {id:'tie:left',rect:[20,20,50,60],root:{x:35,y:60},kind:'machine',source:'bin',sections:[{z:20}]},
  {id:'tie:right',rect:[48,20,78,60],root:{x:63,y:60},kind:'machine',source:'bin',sections:[{z:20}]}
]};
const tieOcc=O.buildOccluderSnapshot(tieScene,options),tieClusters=C.buildClusterSnapshot(tieOcc);assert.strictEqual(tieClusters.clusters.length,1);
const tc=tieClusters.clusters[0],cc=[(tc.bounds[0]+tc.bounds[2])/2,(tc.bounds[1]+tc.bounds[3])/2];
const tieLight=deg=>{const a=deg*Math.PI/180;return{id:'light:tie',position:[cc[0]+Math.cos(a)*500,cc[1]+Math.sin(a)*500,24],radius:1000,intensity:1}};
const first=D.buildDominanceSnapshot(tieClusters,tieOcc,[tieLight(270)]),firstOwner=first.records[0].ownerObjectId;
let probe=null;
for(const deg of [268,272,267,273]){const raw=D.buildDominanceSnapshot(tieClusters,tieOcc,[tieLight(deg)]);if(raw.records[0].ownerObjectId!==firstOwner){probe={deg,raw};break}}
assert(probe,'small angular challenger must exist around the symmetric tie fixture');
const held=D.buildDominanceSnapshot(tieClusters,tieOcc,[tieLight(probe.deg)],first.history),heldRecord=held.records[0];
assert.strictEqual(heldRecord.ownerObjectId,firstOwner,'small challenger advantage must be held by hysteresis');
assert(heldRecord.flags&D.FLAGS.HYSTERESIS_HELD,'hysteresis hold flag must be explicit');
assert(heldRecord.challengerDelta>0&&heldRecord.challengerDelta<=heldRecord.hysteresisThreshold,'held challenger delta must remain below the explicit threshold');
const farDeg=probe.deg<270?0:180,switched=D.buildDominanceSnapshot(tieClusters,tieOcc,[tieLight(farDeg)],held.history),switchedRecord=switched.records[0];
assert.notStrictEqual(switchedRecord.ownerObjectId,firstOwner,'clear directional advantage must eventually switch owner');
assert(switchedRecord.flags&D.FLAGS.SWITCHED,'clear owner switch must be explicit');
assert(switchedRecord.challengerDelta>switchedRecord.hysteresisThreshold,'switch occurs only after challenger clearly exceeds hysteresis');

const debug=D.debugDominanceOverlay(held);assert.strictEqual(debug.length,1);assert.strictEqual(debug[0].scores.length,2);assert(debug[0].scores.every(s=>'exposedSilhouette'in s&&'pseudoHeight'in s&&'frontDepth'in s),'debug view exposes score components');
const packed=D.packRecords(cardinalSnap.records),dv=new DataView(packed.buffer,packed.byteOffset,packed.byteLength);assert.strictEqual(D.RECORD_STRIDE,48);assert.strictEqual(dv.getUint32(0,true),cardinalSnap.records[0].clusterId);assert(dv.getUint32(8,true)>0,'packed owner ID is non-zero');
const irrelevant=D.buildDominanceSnapshot(clusters,occ,[{id:'too-far',position:[5000,5000,24],radius:10,intensity:1}]);assert.strictEqual(irrelevant.records.length,0,'irrelevant bounded light does not allocate dominance work');
console.log('SM-302 dominant-occluder scoring + hysteresis deterministic tests: PASS');
