#!/usr/bin/env node
'use strict';
const assert=require('assert');
const S=require('../engine/webgpu_local_shadows.js');
const L=require('../engine/webgpu_lighting.js');
const scene={lights:[{id:'light:player-cone:0',type:'cone',x:10,y:16,z:22,dx:1,dy:0,range:248,intensity:2,color:[1,1,1],innerCos:.95,outerCos:.8},{id:'light:other',group:'pulse',x:51,y:9,z:19,radius:160,intensity:1.2,color:[.4,.8,1]}]};
const settings={lighting:true,selfShadowing:true,selfShadowQuality:2,selfShadowLightCount:2,contactShadows:true,contactShadowQuality:2};

function model(){
  const commands=[],draws=[],clears=[],records=new Map();let waits=0,submits=0;
  const make=name=>{const handle={name,bytes:new Uint8Array(2048),createView(){return{handle:this}}};const r={handle,width:64,height:32};records.set(name,r);return r};
  for(const name of [L.LIGHT_BUFFER_NAME,'sm205:self-frame','sm205:contact-frame','sm205:self','sm205:contact','sm205:contact-visibility','sm200:g0','sm200:g2'])make(name);
  const registry={width:64,height:32,require:name=>{assert(records.has(name));return records.get(name)}};
  const flush=()=>{while(commands.length)commands.shift()()};
  const queue={writeBuffer(buffer,offset,data){const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice();commands.push(()=>buffer.bytes.set(bytes,offset))},submit(buffers){submits++;for(const b of buffers)commands.push(()=>{for(const operation of b.operations)operation()})},async onSubmittedWorkDone(){waits++;flush()}};
  const device={queue,createCommandEncoder(){const operations=[];return{beginRenderPass(desc){let bind=null;return{setPipeline(){},setBindGroup(_i,b){bind=b},draw(){const b=bind;operations.push(()=>{const entry=b.entries.find(e=>e.binding===2),light=entry?.resource?.buffer;draws.push({label:desc.label,lightBytes:light?.name===L.LIGHT_BUFFER_NAME?Array.from(light.bytes.slice(0,L.MAX_LIGHTS*L.LIGHT_STRIDE)):null})})},end(){if(!bind)operations.push(()=>clears.push({name:desc.colorAttachments[0].view.handle.name,value:desc.colorAttachments[0].clearValue.r}))}}},finish(){return{operations}}}},createBindGroup:desc=>desc};
  const p=Object.create(S.WebGPULocalShadows.prototype);Object.assign(p,{device,queue,registry,width:64,height:32,labelPrefix:'queue-test',renderCount:0,selfPipeline:{getBindGroupLayout:()=>({})},contactPipeline:{getBindGroupLayout:()=>({})},reconstructPipeline:{getBindGroupLayout:()=>({})},initialize:async()=>{}});
  return{p,device,queue,registry,draws,clears,records,flush,get waits(){return waits},get submits(){return submits}};
}

async function testRealRenderOrdering(){
  const m=model(),selected=S.selectSelfShadowLights(scene,settings),contact=S.selectContactLight(scene,settings,[64,32]);
  assert.equal(selected.length,2);assert.notEqual(selected[1].position[0],contact.position[0]);
  await m.p.render({registry:m.registry},scene,settings,{wait:false});
  assert.equal(m.waits,0,'wait:false never inserts a CPU completion wait');assert.equal(m.submits,2,'self submits before contact overwrites their shared buffer');assert.equal(m.draws.length,0,'queue model defers GPU execution until the explicit test flush');
  m.flush();assert.equal(m.draws.length,3);
  assert.deepEqual(m.draws.find(d=>d.label.endsWith(':self-pass')).lightBytes,Array.from(L.packLights(selected)),'self observes all selected canonical light records');
  assert.deepEqual(m.draws.find(d=>d.label.endsWith(':contact-pass')).lightBytes,Array.from(L.packLights([contact])),'contact observes only its canonical driver');
  assert.equal(m.records.size,8,'no second canonical light buffer is introduced');
  const waited=model();await waited.p.render({registry:waited.registry},scene,settings);assert.equal(waited.waits,1,'default completion wait happens once after both submissions');assert.equal(waited.draws.length,3);
}

function testPreFixSingleEncoderWitness(){
  const m=model(),selected=S.selectSelfShadowLights(scene,settings),contact=S.selectContactLight(scene,settings,[64,32]),light=m.registry.require(L.LIGHT_BUFFER_NAME).handle;
  const encoder=m.device.createCommandEncoder();
  const record=label=>m.p._renderPass(encoder,label,m.p.selfPipeline,m.registry.require('sm205:self'),[{binding:2,resource:{buffer:light}}],1);
  m.queue.writeBuffer(light,0,L.packLights(selected));record('old-self');
  m.queue.writeBuffer(light,0,L.packLights([contact]));record('old-contact');
  m.queue.submit([encoder.finish()]);m.flush();
  assert.notDeepEqual(m.draws[0].lightBytes,Array.from(L.packLights(selected)),'retained pre-fix witness must lose selected-light data');
  assert.deepEqual(m.draws[0].lightBytes,Array.from(L.packLights([contact])),'late combined submit makes self read the contact-only payload');
  assert.deepEqual(m.draws[0].lightBytes.slice(L.LIGHT_STRIDE,L.LIGHT_STRIDE*2),Array(L.LIGHT_STRIDE).fill(0),'second selected light is incorrectly zero-filled before the repair');
}

async function testDisabledClears(){
  const m=model();await m.p.render({registry:m.registry},scene,{...settings,selfShadowing:false,contactShadows:false},{wait:false});m.flush();assert.equal(m.draws.length,0);assert.deepEqual(m.clears,[{name:'sm205:self',value:1},{name:'sm205:contact',value:0},{name:'sm205:contact-visibility',value:1}]);assert.equal(m.waits,0);
  const contactOff=model();await contactOff.p.render({registry:contactOff.registry},scene,{...settings,contactShadows:false},{wait:false});contactOff.flush();assert.equal(contactOff.draws.length,1);assert.deepEqual(contactOff.draws[0].lightBytes,Array.from(L.packLights(S.selectSelfShadowLights(scene,settings))));
}

(async()=>{await testRealRenderOrdering();testPreFixSingleEncoderWitness();await testDisabledClears();console.log('SM-205 LIGHT QUEUE PASS: real render queue ordering, two distinct selected lights, contact-only driver, no added light buffer/CPU wait, neutral clears and retained pre-fix overwrite witness; GPU execution not claimed')})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
