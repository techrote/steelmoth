#!/usr/bin/env node
'use strict';
const assert=require('assert');
const crypto=require('crypto');
const L=require('../engine/webgpu_lighting.js');
const close=(a,b,e=1e-10)=>{if(typeof e==='string')e=1e-10;assert.equal(a.length,b.length);a.forEach((v,i)=>assert(Math.abs(v-b[i])<=e,`channel${i}: ${v} != ${b[i]}`))};
const sample={albedo:[.42,.3,.2,1],normalRoughness:[.5,.5,1,.6],heightMaterial:[.1,.2,.45,.25]};
const settings={lighting:true,ambient:.18,materialAOStrength:.62,metalnessScale:1,pbrSpecularStrength:.7};
const scene={lights:[{id:'light:a',x:10,y:10,z:40,radius:200,intensity:8,color:[1,.8,.6]},{id:'light:b',x:25,y:10,z:40,radius:200,intensity:6,color:[.4,.8,1]}]};
const lights=L.buildCanonicalLights(scene,settings),xy=[15,10],add=(a,b)=>a.map((v,i)=>v+b[i]);

function testNumericComposition(){
  const a=L.shadeDirectReference(sample,[lights[0]],settings,xy),b=L.shadeDirectReference(sample,[lights[1]],settings,xy),all=L.shadeDirectReference(sample,lights,settings,xy);
  close(add(a,b),all);assert.equal(all[3],0,'accumulator alpha is never material coverage');
  const ao=1-(1-sample.heightMaterial[2])*settings.materialAOStrength;
  close(L.resolveDirectReference(sample,all,settings,ao),L.shadePixelReference(sample,lights,settings,xy),'neutral per-light integration preserves the accepted final equation');
  const blocked=L.shadeDirectReference(sample,[lights[0]],settings,xy,0),unrelated=L.shadeDirectReference(sample,[lights[1]],settings,xy,1);
  close(blocked,[0,0,0,0]);close(add(blocked,unrelated),b);assert(b.some(v=>v>.1),'unrelated point-light witness has a real contribution');
  const wrongGlobal=all.map(v=>v*0);assert(wrongGlobal.some((v,i)=>Math.abs(v-b[i])>.1),'negative witness: applying one driver mask globally erases unrelated light');
  const compress=v=>v/(1+.22*v),wrong=a.slice(0,3).map((v,i)=>compress(v)+compress(b[i])),correct=all.slice(0,3).map(compress);
  assert(wrong.some((v,i)=>Math.abs(v-correct[i])>.01),'negative witness: compressing each light before sum changes the accepted response');
  const noEmissive={...sample,heightMaterial:[.1,.2,.45,0]},base=L.resolveDirectReference(noEmissive,[0,0,0,0],settings,.4);
  const metal=.2,expected=sample.albedo.slice(0,3).map((al,i)=>al*.18*(.72+.28*.4)*(1+([-.04,0,.03][i])*metal*.15));close(base,[...expected,1]);
  const withEmissive=L.resolveDirectReference(sample,[0,0,0,0],settings,0),without=L.resolveDirectReference(noEmissive,[0,0,0,0],settings,0);
  close(withEmissive.slice(0,3).map((v,i)=>v-without[i]),sample.albedo.slice(0,3).map(v=>v*.25*.8),'emissive survives a fully dark direct/ambient visibility input');
  assert(expected.some((v,i)=>Math.abs(v*ao-base[i])>1e-4),'negative witness: multiplying already-composed ambient by material AO again is wrong');
  close(L.resolveDirectReference({...sample,albedo:[0,0,0,0]},all,settings,.4),[0,0,0,0]);
  assert.equal(crypto.createHash('sha256').update(L.DEFERRED_WGSL).digest('hex'),'159c7773f9074fa50af5766a046f26437922afae8f412fdc4aaa48de4612a6fa','accepted default shader bytes from0a432bc remain unchanged');
  for(const encoding of ['xyz','oct8']){
    const code=L.streamedDirectWgsl(encoding);assert(code.includes('diffSum+specSum)*visibility'));assert(!code.includes('let ambient=al.rgb*'));assert(!code.includes('directLight/(vec3f(1)+directLight*.22)'));assert(code.includes('textureDimensions(directVisibility)'));
  }
  assert(L.RESOLVE_DIRECT_WGSL.includes('.72+.28*visibility'));assert(L.RESOLVE_DIRECT_WGSL.includes('direct/(vec3f(1)+direct*.22)'));assert(L.RESOLVE_DIRECT_WGSL.includes('ambient+direct+al.rgb*hm.a*.8'));
}

function environment(options={}){
  const records=new Map(),modules=[],pipelines=[],passes=[],writes=[];let submits=0,waits=0,generation=0;
  const handle=name=>({name,generation,createView(){return{handle:this}}});
  const registry={width:8,height:4,get:n=>records.get(n),require:n=>{assert(records.has(n),n);return records.get(n)},defineBuffer(n,desc){records.set(n,{...desc,handle:handle(n)})},defineTexture(n,desc){records.set(n,{...desc,handle:handle(n)})},resize(w,h){if(w===this.width&&h===this.height)return false;this.width=w;this.height=h;generation++;for(const r of records.values())if(r.size==='surface')r.handle=handle(r.handle.name);return true},diagnostics:()=>({}),close(){}};
  for(const n of ['g0','g1','g2'])registry.defineTexture('sm200:'+n,{size:'surface'});
  const device={queue:{writeBuffer(buffer,_offset,data){writes.push({name:buffer.name,bytes:Array.from(new Uint8Array(data.buffer,data.byteOffset,data.byteLength))})},submit(){submits++},async onSubmittedWorkDone(){waits++}},createShaderModule(desc){modules.push(desc);return{...desc,async getCompilationInfo(){return options.compilationInfo?options.compilationInfo(desc):{messages:[]}}}},createRenderPipeline(desc){pipelines.push(desc);return{getBindGroupLayout:()=>({})}},createBindGroup:desc=>desc,createCommandEncoder(){return{beginRenderPass(desc){passes.push(desc);return{setPipeline(){},setBindGroup(){},draw(n){assert.equal(n,3)},end(){}}},finish:()=>({})}}};
  const cache={async getRender(_key,factory){return factory()},diagnostics:()=>({})};
  const lighting=new L.WebGPUDeferredLighting({device,registry,pipelines:cache,width:8,height:4}),gb={registry};
  return{lighting,gb,records,modules,pipelines,passes,writes,get submits(){return submits},get waits(){return waits}};
}

async function testPendingCompilerClose(){
  for(const stage of ['sm505-raw-direct','sm505-direct-resolve']){
    let resolve,entered=false;const gate=new Promise(r=>{resolve=r});
    const e=environment({compilationInfo:desc=>{if(desc.label.endsWith(stage)){entered=true;return gate}return{messages:[]}}});
    await e.lighting.initialize();const pending=e.lighting.initializeStreamedDirect();
    for(let i=0;i<100&&!entered;i++)await Promise.resolve();assert(entered,'deferred optional compiler reached: '+stage);
    const before={pipelines:e.pipelines.length,records:e.records.size,submits:e.submits};
    assert(!e.records.has('sm204:direct-accumulation'),'HDR target is not allocated while compiler awaits');
    e.lighting.close();resolve({messages:[]});await assert.rejects(pending,/streamed direct lighting is closed/);
    assert.deepEqual({pipelines:e.pipelines.length,records:e.records.size,submits:e.submits},before,'late optional compiler completion must not create pipeline/texture/submission: '+stage);
    assert(!e.records.has('sm204:direct-accumulation'));
  }
}

async function testRealAPI(){
  const e=environment(),p=e.lighting,visible={label:'explicit-one-pixel-visibility'};
  await p.initialize();assert.equal(e.pipelines.length,1);assert(!e.records.has('sm204:direct-accumulation'),'default path allocates no new HDR target');
  await assert.rejects(p.resolveDirect(e.gb,scene,settings,{ambientVisibilityView:visible,wait:false}),/cleared current direct accumulation/);
  assert.equal(e.modules.length,3,'optional shader compilation is collected separately');assert.equal(e.records.size,7,'one additional persistent HDR texture only');
  const rawPipeline=e.pipelines.find(x=>x.label.endsWith('sm505-raw-direct'));assert.equal(rawPipeline.fragment.targets[0].format,'rgba16float');assert.equal(rawPipeline.fragment.targets[0].blend.color.srcFactor,'one');assert.equal(rawPipeline.fragment.targets[0].blend.color.dstFactor,'one');
  await assert.rejects(p.accumulateDirect(e.gb,scene,settings,{visibilityView:visible,wait:false}),/begin with clear:true/);
  await p.accumulateDirect(e.gb,{lights:[scene.lights[0]]},settings,{visibilityView:visible,clear:true,wait:false});
  await p.accumulateDirect(e.gb,{lights:[scene.lights[1]]},settings,{visibilityView:visible,clear:false,wait:false});
  assert.equal(e.passes.at(-2).colorAttachments[0].loadOp,'clear');assert.equal(e.passes.at(-1).colorAttachments[0].loadOp,'load');assert.equal(e.waits,0);
  const target=p.directAccumulationTexture();await p.resolveDirect(e.gb,scene,settings,{ambientVisibilityView:visible,wait:false});
  assert.deepEqual(p.lastLights.map(l=>l.id),['light:a','light:b']);assert.equal(p.activeLightCount,2);assert.equal(p.lastDebugMode,'final');assert.equal(p.renderCount,1);
  assert.deepEqual(e.writes.filter(w=>w.name===L.LIGHT_BUFFER_NAME).at(-1).bytes,Array.from(L.packLights(lights)),'final resolve restores full canonical light data for forward consumers');
  assert.equal(p.directAccumulationTexture(),target);assert.equal(e.pipelines.length,3,'ordinary streamed frames reuse both optional pipelines');
  await assert.rejects(p.resolveDirect(e.gb,scene,settings,{ambientVisibilityView:visible,wait:false}),/cleared current direct accumulation/);
  await p.accumulateDirect(e.gb,{lights:[]},settings,{visibilityView:visible,clear:true,wait:false});p.resize(16,8);
  await assert.rejects(p.resolveDirect(e.gb,scene,settings,{ambientVisibilityView:visible,wait:false}),/cleared current direct accumulation/,'resize cannot resolve retired accumulation data');
  p.close();await assert.rejects(p.accumulateDirect(e.gb,scene,settings,{visibilityView:visible,clear:true,wait:false}),/closed/);
}

(async()=>{testNumericComposition();await testRealAPI();await testPendingCompilerClose();console.log('SM-505 STREAMED LIGHTING CPU PASS: uncompressed per-light isolation, one compression, composed AO once, emissive unmasked, unchanged default shader, one lazy HDR target, clear/resize/pending-compiler cancellation and full canonical-state restoration; GPU execution not claimed')})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
