'use strict';
const assert=require('assert');
const G=require('../engine/webgpu_gbuffer.js');

assert.equal(G.SCHEMA,'steelmoth-webgpu-gbuffer/v1');
assert.deepEqual(G.FORMATS,{g0:'rgba8unorm',g1:'rgba16float',g2:'rgba16float',objectId:'r32uint',depth:'depth32float'});
assert.deepEqual(G.CLEAR.g0,[0,0,0,0]);
assert.deepEqual(G.CLEAR.g1,[.5,.5,1,1]);
assert.deepEqual(G.CLEAR.g2,[0,0,1,0]);
assert.equal(G.CLEAR.depth,1);
assert.equal(G.halfToFloat(0x3c00),1);
assert.equal(G.halfToFloat(0),0);
assert.notEqual(G.objectIdForStableId('sprite:a'),0);
assert.equal(G.objectIdForStableId('sprite:a'),G.objectIdForStableId('sprite:a'));
assert.notEqual(G.objectIdForStableId('sprite:a'),G.objectIdForStableId('sprite:b'));

const atlas={source_size:[8,4],regions:{crate:[0,0,2,2],barrel:[2,0,2,2]}};
const r=G.regionRect(atlas,'crate');
assert.equal(r.u0,.5/8);assert.equal(r.v0,.5/4);assert.equal(r.u1,1.5/8);assert.equal(r.v1,1.5/4);
const sub=G.regionRect(atlas,'barrel',{sx:1,sy:0,sw:1,sh:2});
assert.equal(sub.u0,3.5/8);assert.equal(sub.u1,3.5/8);

const material={schema:'steelmoth-material-instance/v1',id:'material:crate:normal',heightScale:1.25,heightBias:.05,overrides:{mode:'normal'}};
const sprite=(id,category,x)=>({schema:'steelmoth-sprite-instance/v1',id,category,atlas:'hd',spriteId:'crate',materialId:material.id,transform:{x,y:10,w:2,h:2,rotation:0,flip:false},style:{tint:[1,.5,.25],alpha:.75,glow:false,materialMode:'normal'}});
const scene={materials:[material],sprites:[sprite('dynamic-one','dynamic',30),sprite('static-one','static',10),sprite('foreground-one','foreground',40),{...sprite('glow','dynamic',20),style:{glow:true}},{...sprite('legacy','dynamic',20),atlas:'legacy'}]};
const instances=G.buildSceneInstances(scene,atlas);
assert.deepEqual(instances.map(x=>x.id),['static-one','dynamic-one','foreground-one']);
assert.deepEqual(instances.map(x=>x.category),['static','dynamic','foreground']);
assert.equal(instances[0].heightScale,1.25);assert.equal(instances[0].heightBias,.05);assert.deepEqual(instances[0].tint,[1,.5,.25]);
const packed=G.packInstances(instances);
assert.equal(packed.byteLength,G.INSTANCE_STRIDE*instances.length);
const dv=new DataView(packed.buffer,packed.byteOffset,packed.byteLength);
assert.equal(dv.getUint32(64,true),G.objectIdForStableId('static-one'));
assert.equal(dv.getUint32(72,true),G.CATEGORY_ORDER.static);
assert.equal(dv.getUint32(G.INSTANCE_STRIDE+72,true),G.CATEGORY_ORDER.dynamic);
assert.equal(dv.getUint32(G.INSTANCE_STRIDE*2+72,true),G.CATEGORY_ORDER.foreground);

console.log(JSON.stringify({ok:true,schema:G.SCHEMA,instances:instances.length,instanceStride:G.INSTANCE_STRIDE,debugModes:G.DEBUG_MODES},null,2));
