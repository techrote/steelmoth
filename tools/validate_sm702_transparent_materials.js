'use strict';
const assert=require('node:assert/strict');
const FX=require('../engine/webgpu_transparent_fx.js');
const Forward=require('../engine/webgpu_forward_lighting.js');
const Lighting=require('../engine/webgpu_lighting.js');
let checks=0;
const ok=(v,label)=>{assert.ok(v,label);checks++;};
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const throws=(fn,pattern)=>{assert.throws(fn,pattern);checks++;};
const sprite=(id,material,extra={})=>({id,spriteId:'glass',atlas:'legacy',category:'dynamic',transform:{x:20,y:12,w:8,h:6},style:{alpha:.4,forwardLighting:material?{material,worldZ:16,diffuseWeight:.7}:undefined,...extra}});
const meta={source_size:[16,16],regions:{glass:[0,0,8,8]}};
const scene={frame:{logicalSize:[32,24]},sprites:[sprite('clear','clear-glass'),sprite('frost','frosted-glass'),sprite('diffuse','diffuse-surface'),sprite('plain',null),sprite('glow','frosted-glass',{glow:true}),{...sprite('top','diffuse-surface'),category:'top'},sprite('deferred','refractive-volume')]};
const before=JSON.stringify(scene),frame=FX.buildCompatibilityFrame(scene,meta);
eq(JSON.stringify(scene),before,'material classification cannot mutate gameplay scene');
eq(frame.stages['world-alpha'].map(x=>x.id),['clear','frost','diffuse','plain','deferred'],'alpha order remains stable');
eq(frame.stages['world-alpha'].map(x=>x.forwardMaterial.diffuseWeight),[0,.7,.7,0,0],'clear/unsupported/compatibility have no diffuse response');
eq(frame.stages['world-additive'][0].forwardMaterial.role,0,'additive exemption');
eq(frame.stages['top-alpha'][0].forwardMaterial.role,0,'top/readability exemption');
ok(frame.stages['world-alpha'][4].forwardMaterial.deferredReason.includes('transmission'),'unsupported physical model is deferred');
throws(()=>FX.normalizeForwardMaterial(sprite('missing','frosted-glass',{forwardLighting:{material:'frosted-glass'}})),/worldZ/);
throws(()=>FX.normalizeForwardMaterial(sprite('lane','frosted-glass',{forwardLighting:{material:'frosted-glass',worldZ:1,layer:5}})),/layer/);
throws(()=>FX.normalizeForwardMaterial(sprite('colour','frosted-glass',{forwardLighting:{material:'frosted-glass',worldZ:1,colorSpace:'unknown'}})),/colorSpace/);
const advanced=FX.flattenAdvancedStage(frame),legacy=FX.flattenStage(frame,'world-alpha');
eq(legacy.length,5*6*9,'legacy vertex ABI preserved');eq(advanced.length,5*6*17,'one bounded alpha batch');
for(let i=0;i<5*6;i++)eq(Array.from(advanced.slice(i*17,i*17+9)),Array.from(legacy.slice(i*9,i*9+9)),'legacy vertex fields retained');
eq(Array.from(advanced.slice(9,17)),[.25,0,0,1,0,1,1,0],'physical height and clear exemption live on vertices');
throws(()=>FX.flattenAdvancedStage(frame,'world-additive'),/world-alpha/);
const native={depth:.6,object:1,normal:[.5,.5,1]};
ok(Forward.diffuseReference([.08,.04,.02],[.5,.5,.5],.5,{advancedLighting:true,indirectWeight:.7}).every((x,i)=>Math.abs(x-[.014,.007,.0035][i])<1e-12),'new material diffuse consumes B once');
ok(Forward.supportReason(native,{...native,object:2})!==0,'no cross-object quarter leakage');
ok(Forward.surfaceVisible(12,.6,{worldZ:16,category:'dynamic'}),'canonical physical surface projects to native Y');
ok(FX.glassDirectReference([{type:'cone',position:[0,0,22],radius:10,direction:[1,0],innerCos:.9,outerCos:.8,color:[1,1,1],intensity:1}],[8,0],0).every(v=>v>0),'canonical cone range stays planar when elevation exceeds radius');
const radiance={ownDiffuse:[.5,.5,.5],diffuseWeight:.4,ambient:.2,ambientVisibility:.5,incident:[.08,.08,.08],lights:[{position:[0,0,50],radius:100,color:[1,1,1],intensity:100}],screenXY:[0,0]};
ok(FX.glassDiffuseReference({...radiance,directVisibility:0}).every(v=>Math.abs(v-.328)<1e-12),'hard DSO removes direct without erasing base ambient/GI');
ok(FX.glassDiffuseReference({...radiance,directVisibility:1}).every(v=>Math.abs(v-.372)<1e-12),'bounded canonical direct response independently consumes G');
eq(FX.glassDiffuseReference({...radiance,diffuseWeight:0,directVisibility:0}),[.5,.5,.5],'zero diffuse material fraction stays exempt');

async function lifecycle(){
  const passes=[],buffers=[],groups=[],queue={writeBuffer(){},writeTexture(){}},device={queue,
    createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createSampler:()=>({}),
    createBuffer:d=>{const b={...d,destroyed:false,destroy(){this.destroyed=true;}};buffers.push(b);return b;},
    createTexture:()=>({createView:()=>({}),destroy(){}}),
    createRenderPipelineAsync:async d=>({...d,getBindGroupLayout:i=>({index:i})}),
    createBindGroup:d=>{groups.push(d);return d;}};
  const fx=new FX.WebGPUTransparentFX({device,width:32,height:24});await fx.initialize();
  eq(fx.diagnostics().advancedLighting.prepared,false,'advanced allocations absent by default');
  await fx.initialize({advanced:true});fx.uploadFrame(frame);
  const depth={},object={},normal={},visibilityView={},incident={},atlas={};
  const producer=extra=>({device,width:32,height:24,generation:1,updateCount:1,...extra});
  const lightBuffer={},sceneTexture={createView:()=>({})};const lighting=producer({activeLightCount:1,registry:{require:n=>{eq(n,Lighting.LIGHT_BUFFER_NAME,'canonical light buffer');return{handle:lightBuffer};}},outputTexture:()=>sceneTexture});
  const gbuffer=producer({_views:()=>({depth,objectId:object,g1:normal})}),hierarchy=producer({valid:true,levelView:()=>({})}),visibility=producer({valid:true,bindings:()=>({visibility:visibilityView})});
  const ssgi=producer({valid:true,bindings:()=>({indirectQuarter:incident,quarterWidth:8,quarterHeight:6})});
  const source=Forward.sourceFromPaths({lighting,gbuffer,hierarchy,visibility,ssgi});
  const encoder={beginRenderPass:d=>{const p={descriptor:d,setPipeline(){},setBindGroup(){},setVertexBuffer(){},draw(n){this.count=n;},end(){this.ended=true;}};passes.push(p);return p;}};
  const args={encoder,targetView:{},frame,atlasView:atlas,depthView:depth,forwardSource:source,advancedEnabled:true,timestampWrites:{querySet:{},beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}};
  eq(fx.renderStage('world-alpha',args),5,'one ordered alpha batch draws all records');
  eq(passes.at(-1).count,30,'no per-object draws');
  ok(passes.at(-1).descriptor.depthStencilAttachment.depthReadOnly,'native depth is safe to sample while attached');
  eq(passes.at(-1).descriptor.timestampWrites,args.timestampWrites,'actual production render pass observer');
  const created=groups.length;fx.renderStage('world-alpha',args);eq(groups.length,created,'no per-frame group churn for stable source');
  throws(()=>fx.renderStage('world-alpha',{...args,depthView:{}}),/match/);
  ssgi.valid=false;throws(()=>fx.renderStage('world-alpha',args),/stale|invalid/);ssgi.valid=true;
  eq(fx.renderStage('world-additive',args),1,'exempt stages remain usable independently of advanced inputs');
  const bloated={...frame,stages:{...frame.stages,'world-alpha':Array.from({length:641},()=>frame.stages['world-alpha'][0])}};
  throws(()=>fx.uploadFrame(bloated),/bounded/);
  fx.close();fx.close();ok(buffers.every(x=>x.destroyed),'all owned buffers released');
  throws(()=>fx.uploadFrame(frame),/initialize/);
  let release,compilationStarted;
  const started=new Promise(resolve=>{compilationStarted=resolve;});
  const ordinaryModule=device.createShaderModule;
  device.createShaderModule=()=>({getCompilationInfo:()=>{compilationStarted();return new Promise(resolve=>{release=resolve;});}});
  const cold=new FX.WebGPUTransparentFX({device,width:32,height:24}),coldWork=cold.initialize();await started;cold.close();const beforeCold=buffers.length;release({messages:[]});await assert.rejects(coldWork,/closed/);checks++;
  eq(buffers.length,beforeCold,'cold compile cannot allocate after close');eq(cold.initialized,false,'cold close cannot publish readiness');
  device.createShaderModule=ordinaryModule;
  const warm=new FX.WebGPUTransparentFX({device,width:32,height:24});await warm.initialize();
  let readyPipeline,releasePipeline;const entered=new Promise(resolve=>{readyPipeline=resolve;});
  device.createRenderPipelineAsync=d=>{readyPipeline();return new Promise(resolve=>{releasePipeline=()=>resolve({...d,getBindGroupLayout:i=>({index:i})});});};
  const advancedWork=warm.prepareAdvanced();await entered;warm.close();const beforeAdvanced=buffers.length;releasePipeline();await assert.rejects(advancedWork,/closed/);checks++;
  eq(buffers.length,beforeAdvanced,'advanced pipeline cannot allocate after close');eq(warm.advancedPrepared,false,'advanced close cannot publish readiness');eq(warm.forwardOwner,null,'no late binding owner survives close');
}
lifecycle().then(()=>console.log(`SM-702 transparent material contract PASS: ${checks} checks`)).catch(e=>{console.error(e);process.exitCode=1;});
