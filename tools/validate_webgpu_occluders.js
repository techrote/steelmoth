'use strict';
const assert=require('assert');
const O=require('../engine/webgpu_occluders.js');
const scene={frame:{roomId:'room-a',logicalSize:[96,64]},occluders:[
 {id:'wall:b',rect:[30,4,70,20],kind:'terrain',source:'wall:b',sections:[{z:18}]},
 {id:'tiny:spark',rect:[5,5,8,8],kind:'decor',source:'decor',receiverOnly:true},
 {id:'robot:2',rect:[50,28,70,40],kind:'robot',source:'robot',dynamic:true,sections:[{z:12}]},
 {id:'wall:a',rect:[1,1,20,18],kind:'terrain',source:'wall:a',sections:[{z:16}]}
]};
const snap=O.buildOccluderSnapshot(scene,{tileSize:32,maxOccluders:8,maxPerTile:4,maxTileRefs:32});
assert.strictEqual(snap.records.length,4);
assert.strictEqual(snap.staticRecords.length,3);
assert.strictEqual(snap.dynamicRecords.length,1);
assert.strictEqual(snap.diagnostics.substantialCount,3);
assert.strictEqual(snap.diagnostics.receiverOnlyCount,1);
assert(!O.debugTileOverlay(snap).some(t=>t.objectIds.includes(O.objectIdForOccluder(scene.occluders[1]))),'receiver-only tiny decor absent from major tile membership');
const reversed=O.buildOccluderSnapshot({...scene,occluders:[...scene.occluders].reverse()},{tileSize:32,maxOccluders:8,maxPerTile:4,maxTileRefs:32});
assert.deepStrictEqual([...snap.packed],[...reversed.packed]);
assert.deepStrictEqual([...snap.tileHeaders],[...reversed.tileHeaders]);
assert.deepStrictEqual([...snap.tileRefs],[...reversed.tileRefs]);
assert.strictEqual(snap.staticSignature,reversed.staticSignature);
assert.strictEqual(snap.dynamicSignature,reversed.dynamicSignature);
const dv=new DataView(snap.packed.buffer,snap.packed.byteOffset,snap.packed.byteLength);
assert.strictEqual(dv.getUint32(0,true),snap.records[0].objectId);
assert.strictEqual(dv.getUint32(4,true),snap.records[0].flags);
assert.strictEqual(dv.getFloat32(16,true),snap.records[0].bounds[0]);
assert.strictEqual(O.RECORD_STRIDE,64);
assert.strictEqual(O.TILE_HEADER_STRIDE,8);
const dense={frame:{roomId:'dense',logicalSize:[64,64]},occluders:Array.from({length:20},(_,i)=>({id:`d:${i}`,rect:[0,0,40,40],kind:'terrain',majorOccluder:true}))};
const capped=O.buildOccluderSnapshot(dense,{tileSize:32,maxOccluders:10,maxPerTile:3,maxTileRefs:8});
assert.strictEqual(capped.records.length,10);
assert.strictEqual(capped.diagnostics.occluderOverflow,10);
assert(capped.diagnostics.overflowTileCount>0);
assert(capped.tileRefs.length<=8);
assert(capped.diagnostics.tileRefOverflow>0);
const explicitTiny=O.classifyOccluder({rect:[0,0,2,2],majorOccluder:true,kind:'decor'});
assert.strictEqual(explicitTiny.substantial,true);
const metadataReceiver=O.classifyOccluder({rect:[0,0,100,100],receiverOnly:true,kind:'terrain'});
assert.strictEqual(metadataReceiver.substantial,false);
assert.strictEqual(O.updateClassFor({kind:'robot'}),'dynamic');
assert.strictEqual(O.updateClassFor({kind:'terrain'}),'static');
console.log('SM-300 occluder/tile deterministic tests: PASS');
