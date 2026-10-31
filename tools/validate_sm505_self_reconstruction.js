#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const S=require('../engine/webgpu_local_shadows.js');
const L=require('../engine/webgpu_lighting.js');
const settings={selfShadowQuality:2,selfShadowLightCount:1,selfShadowMaxDistance:176,heightStrength:1};
const driver={id:'far',type:'point',typeValue:0,position:[-500,0,22],radius:10000,direction:[1,0],outerCos:-1};
const close=(a,b,message,tol=1e-9)=>assert(Math.abs(a-b)<=tol,`${message}: ${a} vs ${b}`);
const sum=a=>Array.from(a).reduce((a,b)=>a+b,0);
function fixture(width=23,height=17){const n=width*height;return{width,height,visibility:new Float64Array(n).fill(1),objectIds:new Uint32Array(n),coverage:new Float64Array(n).fill(1),heights:new Float64Array(n),depth:new Float64Array(n).fill(1)}}
function energy(a,w,h){let e=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(x+1<w)e+=(a[i]-a[i+1])**2;if(y+1<h)e+=(a[i]-a[i+w])**2}return e}
function numeric(){
  const constant=fixture();constant.visibility.fill(.38);assert.deepEqual(Array.from(S.selfReconstructionReference(constant,driver,settings)),Array.from(constant.visibility),'constant field remains constant including rejected bounds');
  let seed=514;const noise=fixture(47,29);for(let i=0;i<noise.visibility.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;noise.visibility[i]=.2+.8*seed/4294967296}
  const out=S.selfReconstructionReference(noise,driver,settings);close(sum(out),sum(noise.visibility),'symmetric pair weights conserve total visibility/occlusion');assert(out.every(v=>v>=Math.min(...noise.visibility)&&v<=Math.max(...noise.visibility)),'convex update preserves original range');assert(energy(out,noise.width,noise.height)<energy(noise.visibility,noise.width,noise.height)*.3,'white-noise high-frequency energy decreases substantially');
  const boundary=fixture(9,5);for(let i=0;i<boundary.visibility.length;i++)boundary.visibility[i]=i%9<4?.2:1;
  for(const guide of ['objectIds','coverage','heights','depth']){
    const f={...boundary,[guide]:boundary[guide].slice()};for(let y=0;y<f.height;y++)for(let x=4;x<f.width;x++)f[guide][y*f.width+x]=guide==='objectIds'?9:guide==='coverage'?0:guide==='heights'?.1:.9;
    const r=S.selfReconstructionReference(f,driver,settings);r.forEach((v,i)=>close(v,f.visibility[i],`${guide} rejection cannot bleed a halo across its symmetric boundary`));
  }
  const stripe=fixture(21,15);for(let y=0;y<stripe.height;y++)stripe.visibility[y*stripe.width+10]=.2;
  const line=S.selfReconstructionReference(stripe,driver,settings);close(sum(line),sum(stripe.visibility),'thin shadow occlusion mass retained');assert(Math.min(...line)<.65,'thin far shadow remains visibly attenuating after diffusion');assert(line.some(v=>v<1&&v>.65),'spatial reconstruction redistributes rather than deletes the thin shadow');
  const near=fixture(13,9),nearDriver={...driver,position:[6.5,4.5,22]};for(let i=0;i<near.visibility.length;i++)near.visibility[i]=i%2?.2:1;
  S.selfReconstructionReference(near,nearDriver,settings).forEach((v,i)=>close(v,near.visibility[i],'near samples below6-world-pixel trace step are protected'));
  close(S.selfAliasStrength({x:60,y:0},{...driver,position:[0,0,22]},settings),0,'step5 is unchanged');close(S.selfAliasStrength({x:144,y:0},{...driver,position:[0,0,22]},settings),1,'step12 receives full reconstruction');
  close(S.selfAliasStrength({x:108,y:0},{...driver,position:[0,0,22]},settings),.5,'smooth transition at step9');
  const cone={...driver,type:'cone',typeValue:1,position:[10.5,7.5,22],direction:[1,0],radius:9,outerCos:.8};
  const coneOut=S.selfReconstructionReference(noise,cone,settings);close(sum(coneOut),sum(noise.visibility),'point radius/cone support gating is symmetric and mass preserving');
  for(let y=0;y<noise.height;y++)for(let x=0;x<noise.width;x++)if(!S.selfDriverSupports({x:x+.5,y:y+.5},cone))close(coneOut[y*noise.width+x],noise.visibility[y*noise.width+x],'no halo beyond canonical driver support');
  const pair=fixture(2,1);pair.visibility[0]=.2;const p=S.selfReconstructionReference(pair,driver,settings);close(p[0],.3,'out-of-bounds weights return to center rather than clamp neighbors');close(p[1],.9,'single axial exchange has weight2/16');
  const varying=S.selfReconstructionReference(noise,{...driver,position:[0,0,22]},settings);close(sum(varying),sum(noise.visibility),'adaptive strength uses symmetric min endpoints');
  // Deliberately wrong one-sided averaging on a finite boundary changes mass.
  const wrong=Array.from(noise.visibility,(_v,i)=>{const x=i%noise.width;return x===noise.width-1?noise.visibility[i]:(noise.visibility[i]+noise.visibility[i+1])*.5});
  assert(Math.abs(sum(wrong)-sum(noise.visibility))>1e-3,'retained nonsymmetric normalization witness loses global occlusion mass');
  return{rawHF:energy(noise.visibility,noise.width,noise.height),filteredHF:energy(out,noise.width,noise.height)};
}
function environment(compilationInfo=null){
  const state={modules:[],pipelines:[],textureCreates:0,commands:[],draws:[],waits:0,submits:0},records=new Map();
  const make=(name,desc={})=>{const handle={name,bytes:new Uint8Array(2048),createView(){return{handle:this}}};const r={name,handle,width:32,height:16,estimatedBytes:1024,...desc};records.set(name,r);return r};
  const registry={width:32,height:16,get:n=>records.get(n)||null,require(n){assert(records.has(n),n);return records.get(n)},defineBuffer(n,d){return make(n,d)},defineTexture(n,d){state.textureCreates++;return make(n,d)}};
  for(const n of ['sm200:g0','sm200:g2','sm200:object','sm200:depth'])make(n);
  const flush=()=>{while(state.commands.length)state.commands.shift()()};
  const queue={writeBuffer(handle,offset,data){const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice();state.commands.push(()=>handle.bytes.set(bytes,offset))},submit(buffers){state.submits++;for(const b of buffers)state.commands.push(()=>b.operations.forEach(f=>f()))},async onSubmittedWorkDone(){state.waits++;flush()}};
  const device={queue,createShaderModule(d){state.modules.push(d);return{...d,...(compilationInfo?{getCompilationInfo:compilationInfo}:{})}},createRenderPipeline(d){state.pipelines.push(d);return{getBindGroupLayout:()=>({})}},createBindGroup:d=>d,createCommandEncoder(){const operations=[];return{beginRenderPass(desc){let bindings;return{setPipeline(){},setBindGroup(_i,b){bindings=b},draw(){const b=bindings;operations.push(()=>{const lb=b.entries.find(e=>e.resource?.buffer?.name===L.LIGHT_BUFFER_NAME);state.draws.push({label:desc.label,lights:lb?Array.from(lb.resource.buffer.bytes.slice(0,L.MAX_LIGHTS*L.LIGHT_STRIDE)):null})})},end(){}}},finish(){return{operations}}}}};
  const pipelines={async getRender(_key,create){return create()}};
  const pass=new S.WebGPULocalShadows({device,registry,pipelines});return{pass,state,registry,flush};
}
async function lifecycle(){
  const m=environment();assert.equal(m.state.textureCreates,3,'default path retains existing three textures');assert.equal(m.pass.reconstructionTexture(),null);
  await m.pass.initializeSelfReconstruction();assert.equal(m.state.textureCreates,4,'one optional persistent R16 target');await m.pass.initializeSelfReconstruction();assert.equal(m.state.textureCreates,4,'repeated init reuses target');
  assert.equal(m.state.pipelines.length,1);assert.equal(m.state.pipelines[0].fragment.targets[0].format,'r16float');
  const scene={lights:[{id:'single',x:1,y:2,z:22,radius:200,intensity:1,color:[1,1,1]}]},s={...settings,lighting:true,contactShadows:true};
  await m.pass.render({registry:m.registry},scene,s,{reconstructSelf:true,wait:false});assert.equal(m.state.submits,3);assert.equal(m.state.waits,0);assert.strictEqual(m.pass.selfTexture(),m.pass.reconstructionTexture());m.flush();
  const filtered=m.state.draws.find(x=>x.label.endsWith(':self-reconstruction-pass'));assert(filtered);assert.deepEqual(filtered.lights,Array.from(L.packLights(S.selectSelfShadowLights(scene,s))),'filter reads single-driver canonical payload before contact overwrite');
  assert(m.state.draws.findIndex(x=>x.label.endsWith(':self-pass'))<m.state.draws.indexOf(filtered));assert(m.state.draws.indexOf(filtered)<m.state.draws.findIndex(x=>x.label.endsWith(':contact-pass')));
  const different=environment(),differentScene={lights:[{...scene.lights[0],id:'player-self',group:'playerOmni',intensity:.1},{...scene.lights[0],id:'strong-contact',x:21,intensity:5}]};
  assert.notEqual(S.selectSelfShadowLights(differentScene,s)[0].id,S.selectContactLight(differentScene,s).id,'ordering witness uses genuinely different driver payloads');
  await different.pass.render({registry:different.registry},differentScene,s,{reconstructSelf:true,wait:false});different.flush();
  assert.deepEqual(different.state.draws.find(x=>x.label.endsWith(':self-reconstruction-pass')).lights,Array.from(L.packLights(S.selectSelfShadowLights(differentScene,s))),'self reconstruction must precede overwrite even when contact chooses a different point light');
  assert.notDeepEqual(different.state.draws.find(x=>x.label.endsWith(':self-reconstruction-pass')).lights,different.state.draws.find(x=>x.label.endsWith(':contact-pass')).lights,'late shared-buffer overwrite mutation is observable');
  await m.pass.render({registry:m.registry},scene,s,{wait:false});assert.strictEqual(m.pass.selfTexture(),m.pass.rawSelfTexture(),'global/default render restores raw texture selection');assert.equal(m.state.textureCreates,4);assert.equal(m.pass.selfReconstructionCount,1);
  const multiple={lights:[...scene.lights,{...scene.lights[0],id:'second'}]};await assert.rejects(()=>m.pass.render({registry:m.registry},multiple,{...s,selfShadowLightCount:2},{reconstructSelf:true}),/exactly one/);
  await assert.rejects(()=>m.pass.render({registry:m.registry},scene,{...s,selfShadowing:false},{reconstructSelf:true}),/exactly one/);
  let resolve;const pending=environment(()=>new Promise(r=>{resolve=r})),promise=pending.pass.initializeSelfReconstruction();await Promise.resolve();pending.pass.close();resolve({messages:[]});await assert.rejects(promise,{name:'SM205ShadowsClosedError'});assert.equal(pending.state.pipelines.length,0);assert.equal(pending.state.textureCreates,3,'pending compilation cannot allocate after close');
  const error=environment(async()=>({messages:[{type:'error',message:'intentional invalid reconstruction'}]}));await assert.rejects(()=>error.pass.initializeSelfReconstruction(),/intentional invalid reconstruction/);assert.equal(error.state.pipelines.length,0);assert.equal(error.state.textureCreates,3);
  const warning=environment(async()=>({messages:[{type:'warning',message:'test warning'}]}));await warning.pass.initializeSelfReconstruction();assert.equal(warning.pass.compilation[0].messages[0].type,'warning');
  m.pass.close();await assert.rejects(()=>m.pass.render({registry:m.registry},scene,s),{name:'SM205ShadowsClosedError'});
}
(async()=>{const metrics=numeric();await lifecycle();console.log(`SM-505 SELF RECONSTRUCTION CPU PASS: symmetric guide-gated conservative diffusion, range/constant/bounds/no-halo/near protection/thin shadow/HF controls, real optional resource/queue/lifecycle; rawHF=${metrics.rawHF},filteredHF=${metrics.filteredHF}; no GPU execution`)})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
