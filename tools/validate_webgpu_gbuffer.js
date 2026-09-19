'use strict';
const assert=require('assert');
const G=require('../engine/webgpu_gbuffer.js');

assert.equal(G.SCHEMA,'steelmoth-webgpu-gbuffer/v1');
assert.deepEqual(G.FORMATS,{g0:'rgba8unorm',g1:'rgba16float',g2:'rgba16float',objectId:'r32uint',depth:'depth32float'});
assert.deepEqual(G.CLEAR.g0,[0,0,0,0]);
assert.deepEqual(G.CLEAR.g1,[.5,.5,1,.88]);
assert.deepEqual(G.CLEAR.g2,[0,0,1,0]);
assert.equal(G.CLEAR.depth,1);
assert.equal(G.halfToFloat(0x3c00),1);
assert.equal(G.halfToFloat(0),0);
assert.notEqual(G.objectIdForStableId('sprite:a'),0);
assert.equal(G.objectIdForStableId('sprite:a'),G.objectIdForStableId('sprite:a'));
assert.notEqual(G.objectIdForStableId('sprite:a'),G.objectIdForStableId('sprite:b'));

const atlas={source_size:[8,4],world_scale:1,region_meta:{crate:{world_scale:1}},regions:{crate:[0,0,2,2],barrel:[2,0,2,2]}};
const r=G.regionRect(atlas,'crate');
assert.equal(r.u0,.5/8);assert.equal(r.v0,.5/4);assert.equal(r.u1,1.5/8);assert.equal(r.v1,1.5/4);
const sub=G.regionRect(atlas,'barrel',{sx:1,sy:0,sw:1,sh:2});
assert.equal(sub.u0,3.5/8);assert.equal(sub.u1,3.5/8);
assert.equal(G.compatibilityHeightFactor(atlas,'crate',2),1);
assert.equal(G.compatibilityHeightFactor(atlas,'crate',4),2);

const material={schema:'steelmoth-material-instance/v1',id:'material:crate:normal',overrides:{mode:'normal'}};
const sprite=(id,category,x,rootY=10)=>({schema:'steelmoth-sprite-instance/v1',id,category,atlas:'hd',spriteId:'crate',materialId:material.id,root:{y:rootY},transform:{x,y:10,w:2,h:2,rotation:0,flip:false},style:{tint:[1,.5,.25],alpha:.75,glow:false,materialMode:'normal'}});
const scene={materials:[material],sprites:[sprite('dynamic-late','dynamic',30,30),sprite('static-one','static',10),sprite('foreground-one','foreground',40,40),sprite('dynamic-early','dynamic',20,20),{...sprite('glow','dynamic',20),style:{glow:true}},{...sprite('too-transparent','dynamic',20),style:{alpha:.49}},{...sprite('legacy','dynamic',20),atlas:'legacy'}]};
const instances=G.buildSceneInstances(scene,atlas);
assert.deepEqual(instances.map(x=>x.id),['static-one','dynamic-early','dynamic-late','foreground-one']);
assert.deepEqual(instances.map(x=>x.category),['static','dynamic','dynamic','foreground']);
assert.equal(instances[0].heightFactor,1);assert.equal(instances[0].tintStrength,.07);assert.equal(instances[0].materialModeValue,G.MATERIAL_MODE.normal);assert.deepEqual(instances[0].tint,G.srgbToLinear([1,.5,.25]));
const packed=G.packInstances(instances);
assert.equal(packed.byteLength,G.INSTANCE_STRIDE*instances.length);
const dv=new DataView(packed.buffer,packed.byteOffset,packed.byteLength);
assert.equal(dv.getUint32(64,true),G.objectIdForStableId('static-one'));
assert.equal(dv.getUint32(72,true),G.CATEGORY_ORDER.static);
assert.equal(dv.getUint32(G.INSTANCE_STRIDE+72,true),G.CATEGORY_ORDER.dynamic);
assert.equal(dv.getFloat32(G.INSTANCE_STRIDE+52,true),1);
assert(Math.abs(dv.getFloat32(G.INSTANCE_STRIDE+56,true)-.07)<1e-6);
assert.equal(dv.getFloat32(G.INSTANCE_STRIDE+60,true),G.MATERIAL_MODE.normal);

const flatScene={materials:[{id:'m',overrides:{mode:'flat'}}],sprites:[{...sprite('flat','foreground',1),materialId:'m',style:{tint:[.2,.3,.4],alpha:1,glow:false,materialMode:'flat',tintStrength:.33}}]};
const flat=G.buildSceneInstances(flatScene,atlas)[0];assert.equal(flat.materialModeValue,G.MATERIAL_MODE.flat);assert.equal(flat.tintStrength,.33);
const tintScene={materials:[{id:'m2',overrides:{mode:'tint'}}],sprites:[{...sprite('tint','dynamic',1),materialId:'m2',style:{tint:[.2,.3,.4],alpha:1,glow:false,materialMode:'tint'}}]};
const tint=G.buildSceneInstances(tintScene,atlas)[0];assert.equal(tint.materialModeValue,G.MATERIAL_MODE.tint);assert.equal(tint.tintStrength,1);

console.log(JSON.stringify({ok:true,schema:G.SCHEMA,instances:instances.length,instanceStride:G.INSTANCE_STRIDE,debugModes:G.DEBUG_MODES},null,2));
