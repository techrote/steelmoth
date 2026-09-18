'use strict';
const assert=require('assert');
const O=require('../engine/webgpu_occluders.js');
const C=require('../engine/webgpu_clusters.js');

const options={tileSize:32,maxOccluders:32,maxPerTile:16,maxTileRefs:128};
const baseScene={frame:{roomId:'clusters-a',logicalSize:[128,80]},occluders:[
  {id:'bin:a',rect:[10,10,30,40],root:{x:20,y:40},kind:'machine',source:'bin',sections:[{z:18}]},
  {id:'bin:b',rect:[30,12,50,40],root:{x:40,y:40},kind:'machine',source:'bin',sections:[{z:20}]},
  {id:'bin:c',rect:[60,10,80,40],root:{x:70,y:40},kind:'machine',source:'bin',sections:[{z:19}]},
  {id:'tiny:receiver',rect:[50,37,53,40],root:{x:51.5,y:40},kind:'decor',source:'decor',receiverOnly:true}
]};
const occluders=O.buildOccluderSnapshot(baseScene,options);
const clustered=C.buildClusterSnapshot(occluders);
assert.strictEqual(clustered.diagnostics.clusterCount,2,'touching bins a/b should cluster while c remains separate');
const aId=O.objectIdForOccluder(baseScene.occluders[0]),bId=O.objectIdForOccluder(baseScene.occluders[1]),cId=O.objectIdForOccluder(baseScene.occluders[2]),tinyId=O.objectIdForOccluder(baseScene.occluders[3]);
const clusterFor=id=>clustered.clusters.find(c=>c.memberIds.includes(id));
assert(clusterFor(aId)&&clusterFor(aId)===clusterFor(bId),'touching a/b share one cluster');
assert(clusterFor(cId)&&clusterFor(cId)!==clusterFor(aId),'separated c remains independent');
assert(!clusterFor(tinyId),'receiver-only tiny decor cannot become a cluster member');
assert.strictEqual(clusterFor(aId).dominantObjectId,0,'SM-302 dominance must remain unresolved in SM-301');
assert.strictEqual(clusterFor(aId).memberCount,2);
assert.deepStrictEqual(clusterFor(aId).bounds,[10,10,50,40]);
assert.deepStrictEqual(clusterFor(aId).zRange,[0,20]);

const reversed=O.buildOccluderSnapshot({...baseScene,occluders:[...baseScene.occluders].reverse()},options);
const clusteredReversed=C.buildClusterSnapshot(reversed);
assert.deepStrictEqual(C.canonicalMembership(clustered),C.canonicalMembership(clusteredReversed),'membership is independent of source submission order');
assert.deepStrictEqual([...clustered.packedClusters],[...clusteredReversed.packedClusters],'cluster records pack deterministically');
assert.deepStrictEqual([...clustered.packedMembers],[...clusteredReversed.packedMembers],'member buffer packs deterministically');
assert.strictEqual(clustered.signature,clusteredReversed.signature,'cluster signature is deterministic');

for(const delta of [-1,-0.5,-0.25,0.25,0.5,1]){
  const moved=structuredClone(baseScene);const b=moved.occluders.find(o=>o.id==='bin:b');b.rect=b.rect.map((v,i)=>i%2===0?v+delta:v);b.root.x+=delta;
  const s=C.buildClusterSnapshot(O.buildOccluderSnapshot(moved,options));
  const cmp=C.compareMembership(clustered,s);
  assert.strictEqual(cmp.stable,true,`membership should survive ${delta}px horizontal perturbation: ${JSON.stringify(cmp)}`);
}

const overlapScene=structuredClone(baseScene);overlapScene.occluders.find(o=>o.id==='bin:b').rect=[26,12,46,40];
const overlap=C.buildClusterSnapshot(O.buildOccluderSnapshot(overlapScene,options));
assert(C.compareMembership(clustered,overlap).stable,'overlap fixture retains the same cluster topology');

const separatedScene=structuredClone(baseScene);separatedScene.occluders.find(o=>o.id==='bin:b').rect=[36,12,56,40];separatedScene.occluders.find(o=>o.id==='bin:b').root.x=46;
const separated=C.buildClusterSnapshot(O.buildOccluderSnapshot(separatedScene,options));
const sa=separated.clusters.find(c=>c.memberIds.includes(aId)),sb=separated.clusters.find(c=>c.memberIds.includes(bId));
assert(sa&&sb&&sa.clusterId!==sb.clusterId,'6px separation must split a/b');

const chainScene={frame:{roomId:'chain',logicalSize:[128,80]},occluders:[
  {id:'left',rect:[10,10,50,40],root:{x:30,y:40},kind:'machine',sections:[{z:18}]},
  {id:'bridge',rect:[49,36,61,40],root:{x:55,y:40},kind:'machine',sections:[{z:5}]},
  {id:'right',rect:[60,10,100,40],root:{x:80,y:40},kind:'machine',sections:[{z:18}]}
]};
const chain=C.buildClusterSnapshot(O.buildOccluderSnapshot(chainScene,options));
const leftId=O.objectIdForOccluder(chainScene.occluders[0]),bridgeId=O.objectIdForOccluder(chainScene.occluders[1]),rightId=O.objectIdForOccluder(chainScene.occluders[2]);
const leftCluster=chain.clusters.find(c=>c.memberIds.includes(leftId)),rightCluster=chain.clusters.find(c=>c.memberIds.includes(rightId)),bridgeCluster=chain.clusters.find(c=>c.memberIds.includes(bridgeId));
assert(leftCluster&&rightCluster&&bridgeCluster,'all substantial chain records remain represented');
assert.notStrictEqual(leftCluster.clusterId,rightCluster.clusterId,'small non-explicit connector must not chain-connect separated major props');
assert.notStrictEqual(bridgeCluster.clusterId,leftCluster.clusterId,'small connector must not attach on low-overlap sliver');
assert.notStrictEqual(bridgeCluster.clusterId,rightCluster.clusterId,'small connector must not attach on low-overlap sliver');

const classA=occluders.records.find(r=>r.objectId===aId),classB=occluders.records.find(r=>r.objectId===bId);
const rel=C.relationFor(classA,classB);
assert(rel.accepted&&rel.depthClose&&rel.projectedClose,'touch relation exposes geometric/depth signals');
assert.strictEqual(rel.classMatch,true,'same occluder class is observable as a clustering signal');

const dense={frame:{roomId:'dense',logicalSize:[64,64]},occluders:Array.from({length:20},(_,i)=>({id:`dense:${i}`,rect:[0,0,40,40],root:{x:20,y:40},kind:'machine',majorOccluder:true,sections:[{z:12}]}))};
const denseSnap=C.buildClusterSnapshot(O.buildOccluderSnapshot(dense,{tileSize:32,maxOccluders:20,maxPerTile:20,maxTileRefs:80}),{maxCandidatePerTile:4,maxCandidatePairs:4,maxMembers:20,maxClusters:20});
assert(denseSnap.diagnostics.candidatePairCount<=4,'candidate-pair work remains globally bounded');
assert(denseSnap.diagnostics.candidatePairOverflow>0||denseSnap.diagnostics.candidateTileOverflow>0,'dense-scene overflow is explicit rather than unbounded');
assert(denseSnap.diagnostics.memberCount<=20&&denseSnap.diagnostics.clusterCount<=20,'cluster/member storage caps are enforced');

const dv=new DataView(clustered.packedClusters.buffer,clustered.packedClusters.byteOffset,clustered.packedClusters.byteLength);
assert.strictEqual(dv.getUint32(0,true),clustered.clusters[0].clusterId);
assert.strictEqual(dv.getUint32(8,true),clustered.clusters[0].memberCount);
assert.strictEqual(dv.getUint32(48,true),0,'dominant-object field is reserved zero');
assert.strictEqual(C.CLUSTER_RECORD_STRIDE,64);
assert.strictEqual(C.MEMBERSHIP_STRIDE,8);
assert.strictEqual(C.debugClusterOverlay(clustered).length,2);
assert.strictEqual(clustered.diagnostics.lightIndependent,true);
assert.strictEqual(clustered.diagnostics.dominantOwnerDeferred,true);
console.log('SM-301 stable occluder clustering deterministic tests: PASS');
