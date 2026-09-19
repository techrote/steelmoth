'use strict';
const assert=require('assert');
const Infra=require('../engine/webgpu_resources.js');
require('./validate_webgpu_performance.js');

function makeDevice(options={}){
  const calls={textures:[],buffers:[],writes:[],destroyed:[],push:[],pop:0,renderPipelines:0,computePipelines:0};
  const queue={writeBuffer(buffer,offset,data){calls.writes.push({buffer,offset,bytes:data.byteLength})}};
  let serial=0;
  const device={queue,
    createTexture(desc){const handle={kind:'texture',id:++serial,desc,destroy(){calls.destroyed.push(this.id)}};calls.textures.push(handle);return handle},
    createBuffer(desc){const handle={kind:'buffer',id:++serial,desc,destroy(){calls.destroyed.push(this.id)}};calls.buffers.push(handle);return handle},
    createRenderPipeline(desc){calls.renderPipelines++;return{kind:'render',desc,id:++serial}},
    createComputePipeline(desc){calls.computePipelines++;return{kind:'compute',desc,id:++serial}},
    pushErrorScope(kind){calls.push.push(kind)},async popErrorScope(){calls.pop++;return options.scopeError||null}
  };
  return {device,queue,calls};
}

async function testRegistryPersistenceResizeResetAndDiagnostics(){
  const a=makeDevice();const r=new Infra.ResourceRegistry({device:a.device,width:640,height:360,dynamicUploadBytes:2048});
  const surface=r.defineTexture('scene',{format:'rgba8unorm',usage:Infra.TEXTURE_USAGE.RENDER_ATTACHMENT,size:'surface'});
  const fixed=r.defineTexture('lut',{format:'rgba16float',usage:Infra.TEXTURE_USAGE.TEXTURE_BINDING,size:{width:16,height:8}});
  const staticUpload=r.uploadStatic('static-scenes',new Uint32Array([1,2,3,4]),{usage:Infra.BUFFER_USAGE.STORAGE,maxBytes:1024});
  const before=r.diagnostics();assert.equal(before.resources.find(x=>x.name==='scene').estimatedBytes,640*360*4);assert.equal(before.resources.find(x=>x.name==='lut').estimatedBytes,16*8*8);assert.equal(before.uploads.static.count,1);
  const sceneId=surface.handle.id,lutId=fixed.handle.id,staticId=staticUpload.buffer.id;
  assert.equal(r.resize(640,360),false);assert.equal(r.resize(800,450),true);const afterResize=r.diagnostics(),scene2=r.require('scene'),lut2=r.require('lut'),static2=r.require('static-scenes');
  assert.notEqual(scene2.handle.id,sceneId,'surface texture must rebuild on resize');assert.equal(lut2.handle.id,lutId,'fixed texture must survive resize');assert.equal(static2.handle.id,staticId,'static buffer must survive resize');assert.equal(afterResize.resources.find(x=>x.name==='scene').rebuildCount,1);assert.equal(afterResize.resizeCount,1);
  const oldLutHandle=r.require('lut').handle;const b=makeDevice();r.resetDevice(b.device,b.queue);assert.equal(r.generation,2);assert.notStrictEqual(r.require('lut').handle,oldLutHandle);assert.equal(r.diagnostics().resources.length,3);assert(r.diagnostics().rebuildCount>=4,'resize plus backend reset must rebuild definitions');
  r.close();assert.equal(r.diagnostics().resourceCount,0);
}

async function testBoundedDynamicUploads(){
  const env=makeDevice();const r=new Infra.ResourceRegistry({device:env.device,width:64,height:64,dynamicUploadBytes:1024});
  r.ensureDynamicArena('instances',{capacity:1024,usage:Infra.BUFFER_USAGE.STORAGE,alignment:256});const id=r.require('dynamic:instances').handle.id;
  r.beginFrame();const a=r.uploadDynamic('instances',new Uint8Array(100));const b=r.uploadDynamic('instances',new Uint8Array(40));assert.equal(a.offset,0);assert.equal(b.offset,256);assert.equal(r.require('dynamic:instances').handle.id,id,'dynamic buffer must persist within frame');
  assert.throws(()=>r.uploadDynamic('instances',new Uint8Array(900)),/exhausted/);r.beginFrame();const c=r.uploadDynamic('instances',new Uint8Array(128));assert.equal(c.offset,0,'dynamic cursor must reset each frame');assert.equal(r.require('dynamic:instances').handle.id,id,'dynamic buffer must persist across frames');
  const d=r.diagnostics();assert.equal(d.dynamicArenas[0].capacity,1024);assert.equal(d.uploads.dynamic.count,3);assert.equal(env.calls.buffers.length,1,'bounded arena must not allocate per frame');
}

async function testFrameGraphOrderingAndValidationScopes(){
  const env=makeDevice();const graph=new Infra.FrameGraph({device:env.device});const seen=[];
  graph.addPass({name:'upload',writes:['instances'],execute(){seen.push('upload')}});
  graph.addPass({name:'gbuffer',after:['upload'],reads:['instances'],writes:['g0'],execute(){seen.push('gbuffer')}});
  graph.addPass({name:'lighting',after:['gbuffer'],reads:['g0'],execute(){seen.push('lighting')}});
  assert.deepEqual(graph.compile(),['upload','gbuffer','lighting']);assert.deepEqual(await graph.execute(),['upload','gbuffer','lighting']);assert.deepEqual(seen,['upload','gbuffer','lighting']);assert.deepEqual(env.calls.push,['validation','validation','validation']);assert.equal(env.calls.pop,3);assert.equal(graph.diagnostics().executionCount,1);
  const missing=new Infra.FrameGraph({device:env.device});missing.addPass({name:'a',after:['nope'],execute(){}});assert.throws(()=>missing.compile(),/missing pass/);
  const cycle=new Infra.FrameGraph({device:env.device});cycle.addPass({name:'a',after:['b'],execute(){}});cycle.addPass({name:'b',after:['a'],execute(){}});assert.throws(()=>cycle.compile(),/cycle/);
  const badEnv=makeDevice({scopeError:{message:'bad pass resource'}});const bad=new Infra.FrameGraph({device:badEnv.device});bad.addPass({name:'bad',execute(){}});await assert.rejects(()=>bad.execute(),/validation error in pass bad/);
}

async function testPipelineCache(){
  const env=makeDevice();const cache=new Infra.PipelineCache(env.device);const a=await cache.getRender('sprite',{layout:'auto'}),b=await cache.getRender('sprite',{layout:'auto'});assert.strictEqual(a,b);assert.equal(env.calls.renderPipelines,1);assert.equal(cache.diagnostics().hits,1);assert.equal(cache.diagnostics().misses,1);
  const c=await cache.getCompute('cluster',(_device,label)=>({kind:'fake-compute',label}));assert.equal(c.kind,'fake-compute');assert.equal(cache.diagnostics().count,2);cache.clear();assert.equal(cache.diagnostics().count,0);
}

async function testInfrastructureFramesAndReset(){
  const env=makeDevice();const infra=new Infra.WebGPUInfrastructure({device:env.device,width:32,height:20,dynamicUploadBytes:1024});infra.registry.defineTexture('surface',{format:'rgba8unorm',usage:Infra.TEXTURE_USAGE.RENDER_ATTACHMENT,size:'surface'});infra.registry.ensureDynamicArena('actors',{capacity:1024,usage:Infra.BUFFER_USAGE.STORAGE});
  const order=[];infra.graph.addPass({name:'prepare',execute(){order.push('prepare')}});infra.graph.addPass({name:'consume',after:['prepare'],execute(){order.push('consume')}});
  await infra.executeFrame({prepare:({registry})=>registry.uploadDynamic('actors',new Uint32Array([1,2,3,4]))});await infra.executeFrame({prepare:({registry})=>registry.uploadDynamic('actors',new Uint32Array([5,6]))});assert.deepEqual(order,['prepare','consume','prepare','consume']);assert.equal(infra.diagnostics().frameCount,2);assert.equal(env.calls.buffers.length,1);
  const before=infra.registry.require('surface').handle.id;infra.resize(40,24);assert.notEqual(infra.registry.require('surface').handle.id,before);const env2=makeDevice();infra.resetDevice(env2.device);assert.equal(infra.diagnostics().resetCount,1);infra.close();assert.equal(infra.diagnostics().closed,true);
}

(async()=>{await testRegistryPersistenceResizeResetAndDiagnostics();await testBoundedDynamicUploads();await testFrameGraphOrderingAndValidationScopes();await testPipelineCache();await testInfrastructureFramesAndReset();console.log('SM-103 WEBGPU INFRASTRUCTURE PASS: persistent resources, resize/reset invalidation, bounded uploads, explicit frame graph, validation scopes, pipeline cache and diagnostics verified')})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
