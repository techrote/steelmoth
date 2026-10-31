#!/usr/bin/env node
'use strict';
const assert=require('assert');
const Presenter=require('../engine/webgpu_scene_presenter.js');
const Lighting=require('../engine/webgpu_lighting.js');
const GBuffer=require('../engine/webgpu_gbuffer.js');

// Source/descriptor checks exercise the real presenter methods. They are not
// shader execution, GPU readback, physical timing or visual-acceptance evidence.
function checkShader(code){
  assert(/var owner:texture_2d<u32>/.test(code),'owner is sampled as exact u32, never float IDs');
  const guard='if(textureLoad(owner,vec2i(in.p.xy),0).x!=0u){discard;}';
  assert(code.includes(guard),'every owned material pixel must discard before any receiver writes');
  assert(code.indexOf(guard)<code.indexOf('m.g0='),'owner guard must precede material output');
  assert(code.includes('m.g0=textureSampleLevel(background,nearestSampler,in.uv,0)'),'background albedo uses the existing nearest sampled source');
  assert(code.includes('m.g1=vec4f(.5,.5,1,.88)')&&code.includes('m.g2=vec4f(0,0,1,0)'),'background matches accepted WebGL2 neutral material defaults');
  assert(!code.includes('frag_depth')&&!code.includes('textureStore'),'receiver cannot manufacture ownership depth or storage writes');
  assert(!/linear_to_srgb|pow\(|exp\(/.test(code),'receiver never applies a display transfer or tone adjustment');
}

function environment(options={}){
  const state={shaders:[],pipelines:[],samplers:[],groups:[],passes:[],submissions:0,encoders:0,buffers:0,textures:0,compilationCalls:0,closed:false};
  const texture=(name,format)=>({name,format,live:true,createView(){return{texture:this}},destroy(){this.live=false}});
  state.owner=texture('owner','r32uint');state.background=texture('room:one','rgba8unorm-srgb');
  state.materials={g0:texture('g0','rgba8unorm'),g1:texture('g1','rgba16float'),g2:texture('g2','rgba16float')};
  const layouts={};
  function checkPipeline(desc){
    assert.deepEqual(desc.fragment.targets.map(t=>t.format),['rgba8unorm','rgba16float','rgba16float'],'receiver pipeline writes exactly three material formats');
    assert(!('depthStencil' in desc),'receiver pipeline must never attach depth');
    assert(desc.fragment.targets.every(t=>!t.blend),'material seed is an exact write, not blended colour compensation');
  }
  const device={queue:{submit(commands){assert.equal(commands.length,1);state.submissions++}},
    createShaderModule(desc){checkShader(desc.code);state.shaders.push(desc);return typeof options.compilationInfo==='function'?{...desc,getCompilationInfo(){state.compilationCalls++;return options.compilationInfo()}}:desc},
    createRenderPipeline(desc){checkPipeline(desc);state.pipelines.push(desc);return{getBindGroupLayout(i){assert.equal(i,0);return layouts}}},
    createSampler(desc){assert.equal(desc.magFilter,'nearest');assert.equal(desc.minFilter,'nearest');assert.equal(desc.addressModeU,'clamp-to-edge');assert.equal(desc.addressModeV,'clamp-to-edge');state.samplers.push(desc);return desc},
    createBindGroup(desc){assert.strictEqual(desc.layout,layouts);assert.deepEqual(desc.entries.map(e=>e.binding),[0,1,2]);assert.equal(desc.entries[1].resource.texture.format,'rgba8unorm-srgb');assert.equal(desc.entries[2].resource.texture.format,'r32uint');state.groups.push(desc);return desc},
    createBuffer(){state.buffers++;throw new Error('receiver must not allocate per-frame buffers')},
    createTexture(){state.textures++;throw new Error('receiver reuses existing backdrop and G-buffer attachments')},
    createCommandEncoder(){state.encoders++;return{beginRenderPass(desc){assert(!('depthStencilAttachment' in desc),'ID/depth stay unattached');assert.equal(desc.colorAttachments.length,3);assert.deepEqual(desc.colorAttachments.map(a=>a.view.texture),Object.values(state.materials));assert(desc.colorAttachments.every(a=>a.loadOp==='load'&&a.storeOp==='store'&&!('clearValue' in a)),'preserve every owned material texel');state.passes.push(desc);let draw=false;return{setPipeline(p){assert.strictEqual(p,presenter.receiverPipeline)},setBindGroup(i,g){assert.equal(i,0);assert.strictEqual(g,presenter.receiverBindings.group)},draw(n){assert.equal(n,3);draw=true},end(){assert(draw)}}},finish(){return{}}}}
  };
  const presenter=new Presenter.WebGPUScenePresenter({root:{},game:{renderer:{}},manager:{device},api:{}});
  presenter.backdrop=state.background;presenter.gb={formats:{g0:'rgba8unorm',g1:'rgba16float',g2:'rgba16float'},_record(name){assert.equal(name,'object');return{handle:state.owner}},_views(){return Object.fromEntries(Object.entries(state.materials).map(([k,t])=>[k,t.createView()]))},close(){state.closed=true}};
  return{presenter,state,texture,checkPipeline};
}

async function testDescriptorAndCache(){
  const {presenter:p,state:s,texture,checkPipeline}=environment();
  await p._buildBackgroundReceiverPipeline();p._renderBackgroundReceivers();const first=p.receiverBindings.group;p._renderBackgroundReceivers();
  assert.equal(s.groups.length,1);assert.strictEqual(p.receiverBindings.group,first,'ordinary frames reuse the bind group');
  assert.equal(s.pipelines.length,1);assert.equal(s.samplers.length,1);assert.equal(s.shaders.length,1);assert.equal(s.buffers,0);assert.equal(s.textures,0);assert.equal(s.submissions,2);
  p._invalidateForRoom('room:one');p._invalidateForRoom('room:two');p._renderBackgroundReceivers();assert.strictEqual(p.receiverBindings.group,first,'room metadata alone does not invalidate unchanged GPU sources');
  p.backdrop=texture('room:two','rgba8unorm-srgb');p._renderBackgroundReceivers();const second=p.receiverBindings.group;
  assert.notStrictEqual(second,first);assert.strictEqual(s.groups.at(-1).entries[1].resource.texture,p.backdrop,'room/background revision gets a fresh source binding');
  s.owner=texture('resized-owner','r32uint');p._renderBackgroundReceivers();assert.notStrictEqual(p.receiverBindings.group,second);assert.strictEqual(s.groups.at(-1).entries[2].resource.texture,s.owner,'G-buffer recreation cannot sample stale ownership');
  assert.equal(s.groups.length,3);assert.equal(s.pipelines.length,1,'source rebinding does not recreate pipelines');
  const valid=s.pipelines[0];assert.throws(()=>checkPipeline({...valid,fragment:{...valid.fragment,targets:[...valid.fragment.targets,{format:'r32uint'}]}}),/exactly three/,'negative witness: object-ID attachment is forbidden');
  assert.throws(()=>checkPipeline({...valid,depthStencil:{format:'depth32float'}}),/never attach depth/,'negative witness: ownership depth attachment is forbidden');
  p.close();assert.equal(p.receiverBindings,null,'close retires cached source references');assert(s.closed);assert.equal(p.backdrop.live,false);
  const counts=[s.groups.length,s.encoders,s.submissions];assert.throws(()=>p._renderBackgroundReceivers(),e=>e.name==='SM505PresenterClosedError');assert.deepEqual([s.groups.length,s.encoders,s.submissions],counts,'cancelled presenter performs no bind/encode/submit');
}

async function testAsynchronousCompilation(){
  let resolveCompilation;
  const pendingInfo=new Promise(resolve=>{resolveCompilation=resolve});
  const cancelled=environment({compilationInfo:()=>pendingInfo});
  const pending=cancelled.presenter._buildBackgroundReceiverPipeline();
  assert.equal(cancelled.state.compilationCalls,1,'real builder waits for the compiler report');
  assert.equal(cancelled.state.pipelines.length,0);assert.equal(cancelled.state.samplers.length,0);
  cancelled.presenter.close();resolveCompilation({messages:[]});
  await assert.rejects(pending,error=>error.name==='SM505PresenterClosedError','late compiler completion cannot revive a closed presenter');
  assert.equal(cancelled.state.pipelines.length,0);assert.equal(cancelled.state.samplers.length,0);assert.equal(cancelled.state.groups.length,0);
  assert.equal(cancelled.presenter.receiverBindings,null);assert.equal(cancelled.presenter.closed,true);

  const diagnostic={type:'error',message:'synthetic receiver WGSL compilation error',lineNum:17,linePos:4};
  const broken=environment({compilationInfo:async()=>({messages:[diagnostic]})});
  await assert.rejects(broken.presenter._buildBackgroundReceiverPipeline(),/SM-505 background receiver WGSL: synthetic receiver WGSL compilation error/);
  assert.deepEqual(broken.presenter.receiverCompilation,[diagnostic],'compiler error location/message remains available to diagnostics');
  assert.equal(broken.state.pipelines.length,0);assert.equal(broken.state.samplers.length,0);broken.presenter.close();

  const warning={type:'warning',message:'retained synthetic compiler warning',lineNum:8,linePos:2};
  const warned=environment({compilationInfo:async()=>({messages:[warning]})});
  await warned.presenter._buildBackgroundReceiverPipeline();
  assert.deepEqual(warned.presenter.receiverCompilation,[warning],'warnings must survive a successful build');
  assert.equal(warned.state.compilationCalls,1);assert.equal(warned.state.pipelines.length,1);assert.equal(warned.state.samplers.length,1);
  warned.presenter._renderBackgroundReceivers();warned.presenter._renderBackgroundReceivers();
  assert.equal(warned.state.compilationCalls,1);assert.equal(warned.state.pipelines.length,1);assert.equal(warned.state.groups.length,1,'ordinary rendering reuses the compiled pipeline and source bindings');warned.presenter.close();

  const unavailable=environment({compilationInfo:async()=>{throw new Error('synthetic compiler transport failure')}});
  await assert.rejects(unavailable.presenter._buildBackgroundReceiverPipeline(),/synthetic compiler transport failure/);
  assert.equal(unavailable.state.pipelines.length,0);assert.equal(unavailable.state.samplers.length,0);unavailable.presenter.close();
}

function testNegativeShaderWitnesses(){
  checkShader(Presenter.BACKGROUND_RECEIVER_WGSL);
  assert.throws(()=>checkShader(Presenter.BACKGROUND_RECEIVER_WGSL.replace('texture_2d<u32>','texture_2d<f32>')),/exact u32/);
  assert.throws(()=>checkShader(Presenter.BACKGROUND_RECEIVER_WGSL.replace('if(textureLoad(owner,vec2i(in.p.xy),0).x!=0u){discard;}','')),/must discard/);
  assert.throws(()=>checkShader(Presenter.BACKGROUND_RECEIVER_WGSL.replace('vec4f(.5,.5,1,.88)','vec4f(.5,.5,1,.5)')),/neutral material defaults/);
}

function testRealLightingReference(){
  const albedo=GBuffer.srgbToLinear([.5,.5,.5]),sample={albedo:[...albedo,1],normalRoughness:[.5,.5,1,.88],heightMaterial:[0,0,1,0]},settings={lighting:true,ambient:.1};
  const light={id:'light:player-cone:0',type:'cone',x:0,y:0,z:22,range:248,dx:1,dy:0,innerCos:Math.cos(Math.PI/6),outerCos:Math.cos(Math.PI/3),intensity:2,color:[1,1,1]};
  const canonical=source=>Lighting.buildCanonicalLights({lights:[source]},settings);
  const on=Lighting.shadePixelReference(sample,canonical(light),settings,[60,0]);
  const rotated=Lighting.shadePixelReference(sample,canonical({...light,dx:-1}),settings,[60,0]);
  const off=Lighting.shadePixelReference(sample,canonical({...light,intensity:0}),settings,[60,0]);
  assert(on.slice(0,3).every((v,k)=>v>off[k]+.01),'flat background receiver responds to actual canonical direct lighting');
  assert.deepEqual(rotated,off,'rotating the cone away removes its direct contribution without altering ambient/defaults');
  assert(off.slice(0,3).every((v,k)=>Math.abs(v-albedo[k]*.1)<1e-12),'neutral background material receives exact ambient with no invented emissive term');
  const oldEmpty={...sample,albedo:[0,0,0,0]};
  assert.deepEqual(Lighting.shadePixelReference(oldEmpty,canonical(light),settings,[60,0]),[0,0,0,0],'negative witness: pre-fix empty G0 cannot receive any dynamic lighting');
}

(async()=>{
  await testDescriptorAndCache();await testAsynchronousCompilation();testNegativeShaderWitnesses();testRealLightingReference();
  console.log('SM-505 BACKGROUND RECEIVER CPU PASS: material-only load descriptors, exact owner guard, neutral defaults, nearest sRGB source, bounded cache refresh/cleanup, async compiler cancellation/errors/warnings and canonical cone-on/rotated/off/old-empty witnesses; GPU execution not claimed');
})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
