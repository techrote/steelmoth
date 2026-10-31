'use strict';
// CPU transport/lifecycle controls only. Fake readbacks are never GPU evidence.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const L=require('../engine/webgpu_lighting.js');
const {sm505EmissiveHalf:half}=require('./sm505_emissive_probe.js');
for(const [value,word] of [[0,0],[-0,0x8000],[1,0x3c00],[.5,0x3800],[.25,0x3400],[.535,0x3848],[65504,0x7bff],[2**-24,1],[1+2**-11,0x3c00],[1+3*2**-11,0x3c02]])assert.equal(half(value),word,'independent IEEE binary16 vector');
for(const value of [NaN,Infinity,65505])assert.throws(()=>half(value),/finite half/);
const encode=values=>{const bytes=new Uint8Array(256),view=new DataView(bytes.buffer);values.forEach((v,i)=>view.setUint16(i*2,half(v),true));return bytes};
const decode=texture=>Array.from({length:4},(_,i)=>texture.format==='rgba8unorm'?texture.bytes[i]/255:L.halfToFloat(new DataView(texture.bytes.buffer).getUint16(i*2,true)));
function environment(options={}){
  const state={textures:[],buffers:[],draws:[],closes:0,clears:0,pushes:0,pops:0,resolves:0};
  const texture=(name,format)=>{const t={name,format,bytes:new Uint8Array(256),destroyed:0,createView(){return{texture:this}},destroy(){this.destroyed++}};state.textures.push(t);return t};
  const queue={writeTexture({texture},data,layout,size){assert.equal(layout.bytesPerRow,256);assert.deepEqual(size,{width:1,height:1});texture.bytes.set(data)},submit(commands){for(const command of commands)for(const op of command.ops)op()}};
  const device={queue,pushErrorScope(kind){assert.equal(kind,'validation');state.pushes++},async popErrorScope(){state.pops++;return options.validationError?{message:'injected validation failure'}:null},
    createBuffer(desc){assert.equal(desc.size,256);const b={bytes:new Uint8Array(256),destroyed:0,mapped:false,async mapAsync(){this.mapped=true},getMappedRange(){assert(this.mapped);return this.bytes.buffer},unmap(){this.mapped=false},destroy(){this.destroyed++}};state.buffers.push(b);return b},
    createCommandEncoder(){const ops=[];return{clearBuffer(buffer){ops.push(()=>buffer.bytes.fill(0))},copyTextureToBuffer({texture},{buffer,bytesPerRow},size){assert.equal(bytesPerRow,256);assert.deepEqual(size,{width:1,height:1});ops.push(()=>buffer.bytes.set(texture.bytes))},finish(){return{ops}}}}};
  class Registry{
    constructor(desc){assert.equal(desc.device,device);assert.equal(desc.width,1);assert.equal(desc.height,1);this.records=new Map();state.registry=this}
    defineTexture(name,desc){this.records.set(name,{handle:texture(name,desc.format)})}
    require(name){assert(this.records.has(name),name);return this.records.get(name)}
    diagnostics(){return{testOnlyMock:true,resources:this.records.size}}
    close(){state.closes++;for(const record of this.records.values())record.handle.destroy()}
  }
  class Cache{constructor(d){assert.equal(d,device)}clear(){state.clears++}}
  class Lighting{
    constructor(desc){this.registry=desc.registry;this.compilation=[{testOnlyMock:true}];for(const name of ['raw','lit'])this.registry.defineTexture(name,{format:'rgba16float'})}
    async initializeStreamedDirect(){if(options.initializeError)throw new Error('injected initialization failure')}
    async accumulateDirect(gb,scene,settings,opts){assert.equal(gb.registry,this.registry);assert.equal(opts.clear,true,'each independent control begins with clear');assert.equal(opts.wait,false);state.draws.push({kind:'accumulate',clear:opts.clear});const sample={g0:decode(this.registry.require('sm200:g0').handle),g1:decode(this.registry.require('sm200:g1').handle),g2:decode(this.registry.require('sm200:g2').handle)},mask=decode(opts.visibilityView.texture);this.registry.require('raw').handle.bytes=encode(L.shadeDirectReference(sample,L.buildCanonicalLights(scene,settings),settings,[.5,.5],mask[1]));}
    async resolveDirect(gb,scene,settings,opts){state.resolves++;if(options.failSecondResolve&&state.resolves===2)throw new Error('injected second control failure');state.draws.push({kind:'resolve'});const sample={g0:decode(this.registry.require('sm200:g0').handle),g2:decode(this.registry.require('sm200:g2').handle)},mask=decode(opts.ambientVisibilityView.texture),raw=decode(this.registry.require('raw').handle);let result=L.resolveDirectReference(sample,raw,settings,mask[2]);if(options.wrongGlobalMask)result=result.map(v=>v*mask[1]);this.registry.require('lit').handle.bytes=encode(result)}
    directAccumulationTexture(){return this.registry.require('raw').handle}outputTexture(){return this.registry.require('lit').handle}close(){state.lightingClosed=true}
  }
  const game={renderScene:{frame:{roomId:'unchanged'},settings:{artisticDefault:17}}},presenter={device,ready:true,closed:false,rendering:false,pending:null,presentedFrames:9,submittedFrames:9,completedFrames:9};
  const sandbox={console:{log(){}},Uint8Array,DataView,Math,Number,JSON,Array,RangeError,Error,crypto:crypto.webcrypto,btoa:s=>Buffer.from(s,'binary').toString('base64'),GPUMapMode:{READ:1},GPUBufferUsage:{COPY_DST:8,MAP_READ:1},GPUTextureUsage:{TEXTURE_BINDING:4,COPY_DST:2,COPY_SRC:1},game,steelMothBackendRuntime:{presenter,presentationBackend:'webgpu'},SteelMothWebGPULighting:{...L,WebGPUDeferredLighting:Lighting},SteelMothWebGPUResources:{ResourceRegistry:Registry,PipelineCache:Cache}};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require.resolve('./sm505_emissive_probe.js'),'utf8'),sandbox);return{state,sandbox,run:()=>sandbox.sm505EmissiveProbe()};
}
function cleaned(e){assert(e.state.lightingClosed);assert.equal(e.state.closes,1);assert.equal(e.state.clears,1);assert.equal(e.state.pushes,1);assert.equal(e.state.pops,1);assert(e.state.textures.every(t=>t.destroyed===1));assert(e.state.buffers.every(b=>b.destroyed===1&&!b.mapped))}
async function main(){
  const e=environment(),result=await e.run();assert(result.ok,JSON.stringify(result.errors));assert.equal(result.cases.length,4);assert.equal(result.items.length,18);assert.equal(result.normalGameMaterialEmissive,'NOT RUN');assert(!result.physicalAcceptance&&!result.visualAcceptance&&!result.releaseAcceptance);assert.equal(result.gpuTiming,'NOT RUN');assert.equal(e.state.draws.length,8);cleaned(e);
  for(const item of result.items){const bytes=Buffer.from(item.base64,'base64');assert.equal(bytes.length,256);assert.equal(item.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(item.width,1);assert.equal(item.height,1);assert.equal(item.rowBytes,256);assert(bytes.subarray(item.format==='rgba8unorm'?4:8).every(v=>v===0),'all original padded transport bytes retained')}
  assert.equal(e.sandbox.game.renderScene.settings.artisticDefault,17);assert.equal(e.sandbox.steelMothBackendRuntime.presenter.presentedFrames,9);
  const broken=environment({wrongGlobalMask:true}),wrong=await broken.run();assert(!wrong.ok);assert(wrong.checks.some(c=>!c.ok&&c.label.includes('emissive survives')),'injected old global-mask corruption is detected');cleaned(broken);
  const failed=environment({failSecondResolve:true}),partial=await failed.run();assert(!partial.ok);assert.equal(partial.cases.length,1);assert(partial.items.length>6,'failure retains original first-control/readback evidence');assert.equal(failed.state.resolves,2,'failed control never retries');assert(partial.errors.some(e=>e.includes('second control')));cleaned(failed);
  const invalid=environment({validationError:true}),badScope=await invalid.run();assert(!badScope.ok);assert(badScope.errors.some(e=>e.includes('injected validation')));cleaned(invalid);
  const init=environment({initializeError:true}),badInit=await init.run();assert(!badInit.ok);assert.equal(init.state.draws.length,0);cleaned(init);
  const busy=environment();busy.sandbox.steelMothBackendRuntime.presenter.rendering=true;await assert.rejects(busy.run(),/frozen idle/);assert.equal(busy.state.pushes,0);assert.equal(busy.state.textures.length,0);
  console.log('SM-505 EMISSIVE PROBE CPU PASS: IEEE binary16 vectors, synthetic-only result custody, quantized 256-byte payloads/hashes, independent controls, old global-mask detection, partial failure evidence/no retry, scope/lifecycle cleanup and busy-presenter refusal; mocked transport is not GPU evidence');
}
main().catch(error=>{console.error(error);process.exit(1)});
