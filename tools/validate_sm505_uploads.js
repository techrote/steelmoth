#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {WebGPUScenePresenter}=require('../engine/webgpu_scene_presenter.js');
const U={COPY_SRC:1,COPY_DST:2,TEXTURE_BINDING:4,STORAGE_BINDING:8,RENDER_ATTACHMENT:16};
const previousUsage=globalThis.GPUTextureUsage;
globalThis.GPUTextureUsage=U;

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await Promise.resolve()}throw new Error('expected asynchronous stage was not reached')}
function environment(){
  const textures=[],copies=[],writes=[],events=[];
  const state={validation:null,popGate:null,popEntered:false,removed:0,unconfigured:0};
  const queue={
    copyExternalImageToTexture(source,destination,size){
      const d=destination.texture.descriptor;
      assert((d.usage&(U.COPY_DST|U.RENDER_ATTACHMENT))===(U.COPY_DST|U.RENDER_ATTACHMENT),'external-image destination requires COPY_DST and RENDER_ATTACHMENT');
      assert.equal(destination.colorSpace,'srgb','external image destination has explicit canonical colour space');
      assert.equal(d.format,'rgba8unorm-srgb');
      assert.equal(size.width,source.source.width);assert.equal(size.height,source.source.height);
      copies.push({source,destination,size});
    },
    writeTexture(destination,data,layout,size){assert(destination.texture.descriptor.usage&U.COPY_DST);writes.push({destination,data:Array.from(data),layout,size})}
  };
  const device={queue,
    createTexture(descriptor){const t={descriptor,alive:true,destroys:0,destroy(){this.alive=false;this.destroys++}};textures.push(t);return t},
    pushErrorScope(type){assert.equal(type,'validation');events.push('push')},
    async popErrorScope(){events.push('pop');state.popEntered=true;if(state.popGate)await state.popGate.promise;return state.validation}
  };
  const background={width:640,height:360},atlas={width:512,height:256};
  const game={renderer:{nativeW:64,nativeH:36,webgpuPresentationSources:{background,backgroundRevision:1}},atlas:{canvas:atlas,s:{orb:{x:1,y:2,w:3,h:4}}}};
  const context={configure(options){assert.equal(options.colorSpace,'srgb');events.push('configure')},unconfigure(){state.unconfigured++}};
  const canvas={style:{},getContext:()=>context,remove(){state.removed++}};
  const p=new WebGPUScenePresenter({root:{},game,manager:{device,format:'bgra8unorm'},api:{}});
  p._assertApi=()=>{};p._makeCanvas=()=>canvas;
  return{p,device,queue,game,context,canvas,textures,copies,writes,events,state};
}

function testUploadDestinations(){
  const e=environment(),p=e.p;
  p._uploadLegacyAtlas();
  assert.equal(e.copies.length,1);assert.equal(e.textures[0].descriptor.usage,U.COPY_DST|U.TEXTURE_BINDING|U.RENDER_ATTACHMENT);
  assert.deepEqual(p.legacyMeta.regions.orb,[1,2,3,4]);
  p._uploadBackdrop();const initial=p.backdrop;
  assert.equal(e.copies.length,2);assert.equal(initial.descriptor.usage,U.COPY_DST|U.TEXTURE_BINDING|U.RENDER_ATTACHMENT);
  p._uploadBackdrop();assert.equal(p.backdrop,initial);assert.equal(e.textures.length,2);assert.equal(e.copies.length,2,'unchanged backdrop revision must not upload or allocate');
  e.game.renderer.webgpuPresentationSources.backgroundRevision=2;p._uploadBackdrop();
  assert.equal(initial.destroys,1);assert.notEqual(p.backdrop,initial);assert.equal(e.copies.length,3);
  const revised=p.backdrop;p._uploadBackdrop(true);assert.equal(revised.destroys,1);assert.equal(e.copies.length,4);
  delete e.game.renderer.webgpuPresentationSources.background;e.game.renderer.webgpuPresentationSources.backgroundRevision=3;p._uploadBackdrop();
  assert.equal(e.writes.length,1);assert.deepEqual(e.writes[0].data,[0,0,0,255]);assert.deepEqual(e.writes[0].size,{width:1,height:1});
  p.close();assert(e.textures.every(t=>!t.alive));
  // Retain the old descriptor as a negative API-contract witness. This is a
  // descriptor validator, not a claim that a physical adapter executed the copy.
  const invalid=e.device.createTexture({format:'rgba8unorm-srgb',usage:U.COPY_DST|U.TEXTURE_BINDING});
  assert.throws(()=>e.queue.copyExternalImageToTexture({source:{width:1,height:1}},{texture:invalid,colorSpace:'srgb'},{width:1,height:1}),/RENDER_ATTACHMENT/);
  invalid.destroy();
  const failure=environment();failure.queue.copyExternalImageToTexture=()=>{throw new Error('copy rejected')};
  assert.throws(()=>failure.p._uploadLegacyAtlas(),/copy rejected/);failure.p.close();assert(failure.textures.every(t=>!t.alive),'failed legacy upload must already be owned for cleanup');
}

function testPixelArtSampling(){
  const e=environment(),samplers=[],buffers=[];
  e.device.createShaderModule=()=>({});e.device.createRenderPipeline=descriptor=>({descriptor});
  e.device.createSampler=descriptor=>{const sampler={descriptor};samplers.push(sampler);return sampler};
  e.device.createBuffer=descriptor=>{const buffer={descriptor,destroyed:false,destroy(){this.destroyed=true}};buffers.push(buffer);return buffer};
  e.queue.writeBuffer=()=>{};e.p.api.Foliage={MAX_INSTANCES:64};e.p.width=64;e.p.height=36;
  e.p._buildCompositePipelines();e.p._buildFoliageRaster();
  assert.deepEqual(samplers[0].descriptor,{magFilter:'linear',minFilter:'linear'},'float world-composition sampler retains filtering');
  assert.deepEqual(e.p.foliageSampler.descriptor,{magFilter:'nearest',minFilter:'nearest'},'shared pixel-art albedo atlas must use crisp nearest sampling');
  assert.equal(buffers.length,4);e.p.close();assert(buffers.every(b=>b.destroyed),'raster buffers remain owned for cleanup');
}

function uploadBuild(e){e.p._buildResources=async()=>{e.events.push('build');e.p._uploadLegacyAtlas();e.p._uploadBackdrop()}}
async function testScopedConstruction(){
  const good=environment();uploadBuild(good);good.state.popGate=deferred();
  const pending=good.p.initialize();await until(()=>good.state.popEntered);
  assert.equal(good.p.ready,false,'presenter must wait for async validation result before claiming ready');
  good.state.popGate.resolve();await pending;assert.equal(good.p.ready,true);
  assert.deepEqual(good.events,['push','configure','build','pop']);
  good.state.popGate=null;good.state.popEntered=false;await good.p._rebuild(128,72);
  assert.deepEqual(good.events.slice(-4),['push','configure','build','pop'],'resize repeats scoped native configuration and resource creation');
  good.p.close();assert(good.textures.every(t=>!t.alive));

  const bad=environment();uploadBuild(bad);bad.state.validation={message:'synthetic invalid external-image descriptor'};
  await assert.rejects(bad.p.initialize(),/resource validation failed: synthetic invalid external-image descriptor/);
  assert.equal(bad.p.ready,false);assert.equal(bad.p.closed,true);assert.equal(bad.state.removed,1);assert.equal(bad.state.unconfigured,1);assert(bad.textures.every(t=>!t.alive));

  const rebuild=environment();uploadBuild(rebuild);await rebuild.p.initialize();rebuild.state.validation={message:'invalid resized target'};
  await assert.rejects(rebuild.p._rebuild(128,72),/invalid resized target/);assert.equal(rebuild.p.ready,false);assert(rebuild.textures.every(t=>!t.alive));rebuild.p.close();

  const thrown=environment();thrown.p._buildResources=async()=>{thrown.p._uploadLegacyAtlas();throw new Error('producer JS failure')};
  await assert.rejects(thrown.p.initialize(),/producer JS failure/);assert.equal(thrown.events.filter(x=>x==='pop').length,1,'scope is popped even when resource construction throws');assert(thrown.textures.every(t=>!t.alive));

  const canceled=environment();uploadBuild(canceled);canceled.state.popGate=deferred();
  const initialization=canceled.p.initialize();await until(()=>canceled.state.popEntered);canceled.p.close();canceled.state.popGate.resolve();
  await assert.rejects(initialization,error=>error.name==='SM505PresenterClosedError');assert.equal(canceled.p.ready,false);assert(canceled.textures.every(t=>!t.alive));

  const noScope=environment();uploadBuild(noScope);delete noScope.device.pushErrorScope;delete noScope.device.popErrorScope;
  await noScope.p.initialize();assert.equal(noScope.p.ready,true,'minimal deterministic mocks may omit optional scope methods');noScope.p.close();
}

(async()=>{try{testUploadDestinations();testPixelArtSampling();await testScopedConstruction();console.log('SM-505 UPLOADS PASS: canonical external-copy usages/colour space, revision reuse, crisp foliage albedo sampling, old-descriptor rejection, async init/resize validation, cleanup and cancellation')}finally{if(previousUsage===undefined)delete globalThis.GPUTextureUsage;else globalThis.GPUTextureUsage=previousUsage}})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
