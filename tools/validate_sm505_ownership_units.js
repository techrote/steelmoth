#!/usr/bin/env node
'use strict';
const assert=require('assert');
const crypto=require('crypto');
const O=require('../engine/webgpu_ownership.js');
const G=require('../engine/webgpu_gbuffer.js');
const P=require('../engine/pseudo_depth.js');

// Exercise the real renderInstances packing and pass descriptors. The small
// independent model below is CPU evidence, never shader/GPU execution evidence.
function environment(){
  const state={writes:[],passes:[],draws:[],submits:0,waits:0};
  const object=Object.create(O.WebGPUOwnershipGBuffer.prototype);
  Object.assign(object,{width:1920,height:1080,atlas:{width:256,height:128},alphaCutoff:.12,maxInstances:32,labelPrefix:'test',materialPipeline:{},bindGroup:{},renderCount:0,ownershipRenderCount:0});
  object.initialize=async()=>object;
  object._record=name=>({handle:name});
  object._views=()=>Object.fromEntries(['g0','g1','g2','objectId','depth'].map(k=>[k,k]));
  object.queue={writeBuffer(name,offset,data){assert.equal(offset,0);state.writes.push({name,bytes:new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice()})},submit(){state.submits++},async onSubmittedWorkDone(){state.waits++}};
  object.device={createCommandEncoder(){return{beginRenderPass(desc){state.passes.push(desc);return{setPipeline(p){assert.strictEqual(p,object.materialPipeline)},setBindGroup(i,g){assert.equal(i,0);assert.strictEqual(g,object.bindGroup)},draw(...args){state.draws.push(args)},end(){}}},finish(){return{}}}}};
  return{object,state};
}
function modelDepth(nativeY,localHeight,layer,bias,scale){
  const z=Math.max(0,Math.min(1,localHeight))*64;
  return Math.max(0,Math.min(1,(3072-(layer*1024+nativeY/scale+z+bias))/5120));
}
function winner(fragments,scale,convert=true){
  let depth=1,id=0;
  for(const f of fragments){if(f.alpha<.12)continue;const d=modelDepth(f.y*scale,f.height,f.layer,f.bias,convert?scale:1);if(d<depth){depth=d;id=f.id}}
  return{id,depth};
}
const base={id:'unit',objectId:G.objectIdForStableId('unit'),category:'dynamic',rootY:180,x:20,y:160,w:16,h:24,rotation:0,flip:false,uv:[0,0,1,1],tint:[1,1,1],alpha:1,heightFactor:1,tintStrength:.07,materialModeValue:0};
async function main(){
  assert.equal(crypto.createHash('sha256').update(O.PSEUDO_DEPTH_WGSL).digest('hex'),'8421b0dc21d4c0483b1d09dbca55468fd9e5ea2789f34813103596ba1fba1881','accepted logical pseudo-depth kernel remains byte-identical');
  assert(O.MATERIAL_WGSL.includes('alphaCutoff:f32, worldScale:f32, _pad0:vec2f'),'32-byte frame scalar offsets follow WGSL alignment');
  const call='smOwnershipDepth(in.position.y/frame.worldScale,localHeight,in.depthMeta.x,in.depthMeta.y)';
  assert(O.MATERIAL_WGSL.includes(call),'native Y must convert before the unchanged logical depth formula');
  assert(!O.MATERIAL_WGSL.replace(call,'smOwnershipDepth(in.position.y,localHeight,in.depthMeta.x,in.depthMeta.y)').includes(call),'retained missing-conversion source mutation is rejected');
  assert.equal(P.MAX_WORLD_Z,64);assert.equal(P.LAYER_STRIDE,1024);
  for(const value of [undefined,null,0,-1,Infinity,NaN])assert.equal(O.ownershipWorldScale(value),1);
  assert.equal(O.ownershipWorldScale(1e-8),1/16);assert.equal(O.ownershipWorldScale(1e8),16);
  const fragments=[{id:11,y:140,height:.5,layer:0,bias:.25,alpha:1},{id:22,y:160,height:.1,layer:0,bias:0,alpha:1},{id:33,y:500,height:1,layer:1,bias:0,alpha:0}];
  const expected=winner(fragments,1);
  assert.equal(expected.id,11,'raised surface wins the logical pseudo-depth comparison');
  assert.equal(winner(fragments,3,false).id,22,'retained old native-Y model incorrectly reverses ownership');
  for(const scale of [1,2,3]){
    assert.deepEqual(winner(fragments,scale),expected,'object ID and depth invariant at corresponding logical sample');
    assert.deepEqual(winner([...fragments].reverse(),scale),expected,'coverage resolution is independent of draw ordering for unequal depths');
    for(const f of fragments){
      const actual=O.referenceDepthForPixel(f.y*scale,f.height,'dynamic',f.layer,f.bias,scale);
      assert.equal(actual.depth01,modelDepth(f.y*scale,f.height,f.layer,f.bias,scale));
      assert.equal(actual.depth01,O.referenceDepthForPixel(f.y,f.height,'dynamic',f.layer,f.bias).depth01);
    }
    const {object,state}=environment();object.width=640*scale;object.height=360*scale;
    await object.renderInstances([{...base,x:base.x*scale,y:base.y*scale,w:base.w*scale,h:base.h*scale}],{worldScale:scale,wait:false});
    const frameWrite=state.writes.find(x=>x.name==='frame'),frame=new Float32Array(frameWrite.bytes.buffer);
    assert.equal(frameWrite.bytes.byteLength,32);assert.deepEqual(Array.from(frame),[640*scale,360*scale,256,128,Math.fround(.12),scale,0,0]);
    const instanceWrite=state.writes.find(x=>x.name==='instances'),dv=new DataView(instanceWrite.bytes.buffer);
    assert.equal(dv.getUint32(64,true),base.objectId,'stable ID unchanged by frame unit conversion');
    assert.equal(dv.getFloat32(72,true),0);assert.equal(dv.getFloat32(76,true),0);
    assert.deepEqual(state.draws,[[6,1,0,0]]);assert.equal(state.submits,1);assert.equal(state.waits,0);
    const pass=state.passes[0];assert.equal(pass.colorAttachments.length,4);assert.equal(pass.depthStencilAttachment.depthClearValue,1);assert.equal(pass.depthStencilAttachment.depthStoreOp,'store');
  }
  const {object,state}=environment();await object.renderInstances([base]);
  const frame=new Float32Array(state.writes.find(x=>x.name==='frame').bytes.buffer);assert.equal(frame[5],1,'omitted option preserves accepted logical behavior');assert.equal(state.waits,1);
  console.log('SM-505 OWNERSHIP UNITS CPU PASS: real frame/instance packing, canonical logical depth and stable winning IDs at1/2/3x, default compatibility, alpha discard and retained old native-Y reversal; no GPU execution');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
