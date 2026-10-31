'use strict';
const assert=require('assert');
const {WebGPUScenePresenter}=require('../engine/webgpu_scene_presenter.js');

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await Promise.resolve()}throw new Error('deferred lifecycle stage was not reached')}

function environment(blockedStage=null){
  const events=[],owned=[],gate=deferred(),state={blockedStage,entered:false,failures:0,canvasRemoved:0,unconfigured:0};
  async function stage(name,resource){
    events.push(name);
    if(name===state.blockedStage){state.entered=true;await gate.promise}
    // Model a subsystem allocating after its awaited compiler/upload finishes.
    // Calling close before this await alone cannot retire that late allocation.
    if(resource)resource.live=true;
  }
  function resource(name,target={}){const r=Object.assign(target,{name,live:true,closes:0,close(){this.live=false;this.closes++},destroy(){this.close()},createView(){return{}}});owned.push(r);events.push('allocate:'+name);return r}
  function producer(name){return class{
    constructor(options={}){
      resource(name==='fx'?options.labelPrefix:name,this);this.registry=options.registry||{members:[]};this.pipelines={};this.registry.members.push(this);
      // SM-204/205 use the G-buffer's registry; its close owns those targets.
      if(name==='gb')this.close=function(){for(const r of this.registry.members){r.live=false;r.closes++}};
    }
    async initialize(){await stage('init:'+this.name,this);return this}
    async initializeStreamedDirect(){await stage('init:lighting-stream',this);return this}
    async initializeSelfReconstruction(){await stage('init:shadow-reconstruction',this);return this}
    async setAtlases(){await stage('init:atlases',this)}
  }}
  const canvas={style:{},setAttribute(){},getContext(){return context},remove(){state.canvasRemoved++}};
  const context={configure(){events.push('configure')},unconfigure(){state.unconfigured++},getCurrentTexture(){events.push('present-texture');return{createView:()=>({})}}};
  const queue={submit(){events.push('submit')},async onSubmittedWorkDone(){await stage('render:completion')},writeBuffer(){},writeTexture(){},copyExternalImageToTexture(){}};
  const device={queue,createTexture:()=>resource('world'),createCommandEncoder:()=>({finish:()=>({})})};
  const api={
    Ownership:{WebGPUOwnershipGBuffer:producer('gb'),buildOwnershipSceneInstances:()=>[]},Depth:{WebGPUDepthHierarchy:producer('depth')},Shadows:{WebGPULocalShadows:producer('shadows')},Lighting:{WebGPUDeferredLighting:producer('lighting')},
    Occluders:{WebGPUOccluderBins:producer('occluders')},Clusters:{WebGPUOccluderClusters:producer('clusters')},Dominance:{WebGPUDominantOccluders:producer('dominance')},DSO:{WebGPUDSOHardCore:producer('dso')},DSOHierarchy:{WebGPUDSOHierarchy:producer('dsoHierarchy')},
    Bloom:{WebGPUDarkBloom:producer('bloom')},BloomTemporal:{WebGPUDarkBloomTemporal:producer('bloomTemporal')},Visibility:{WebGPUVisibilityComposition:producer('visibility')},Water:{WebGPUWaterPass:producer('water')},
    Foliage:{FoliageFrameAuthority:class{},WebGPUFoliagePass:producer('foliage')},Post:{WebGPUPost:producer('post')},Transparent:{WebGPUTransparentFX:producer('fx')},
    Scene:{validateRenderScene(){}},Pseudo:{},Quality:{localShadowSettings:()=>({})},Ordering:{buildFramePlan:()=>({})}
  };
  const game={renderer:{nativeW:64,nativeH:36,webgpuPresentationSources:{}},canvas:{parentNode:{insertBefore(){events.push('insert-canvas')}}},art:{manifest:{}},graphics:{}};
  const p=new WebGPUScenePresenter({root:{document:{createElement:()=>canvas}},game,manager:{device,format:'bgra8unorm'},api,onFailure:()=>state.failures++});
  // Keep synchronous raster setup separate: cancellation tests execute the real
  // producer orchestration without requiring a fake GPU pipeline implementation.
  for(const method of ['_buildCompositePipelines','_buildBackgroundReceiverPipeline','_buildFoliageRaster','_uploadLegacyAtlas','_uploadBackdrop'])p[method]=()=>events.push(method);
  return{p,events,owned,gate,state,stage,resource,context};
}

async function testInitializationCancellation(){
  const stages=['init:atlases','init:shadows','init:shadow-reconstruction','init:lighting','init:lighting-stream','init:water','init:post',
    'init:SM505WorldLegacy','init:SM505WorldHD','init:SM505TopLegacy','init:SM505TopHD','init:SM505Overlay'];
  for(const name of stages){
    const e=environment(name),promise=e.p.initialize();await until(()=>e.state.entered);
    const count=e.events.length;e.p.close();e.gate.resolve();
    await assert.rejects(promise,error=>error.name==='SM505PresenterClosedError');
    assert.equal(e.p.ready,false);assert.equal(e.p.closed,true);assert.equal(e.p.canvas,null);
    assert.equal(e.state.canvasRemoved,1);assert.equal(e.state.unconfigured,1);assert.equal(e.state.failures,0);
    assert(e.owned.every(r=>!r.live),'late subsystem allocations must be retired after cancellation: '+name);
    assert.deepEqual(e.events.slice(count),[],'no later stage or allocation may run after cancellation: '+name);
    await assert.rejects(e.p.initialize(),/presenter is closed/);
  }
  const e=environment();await e.p.initialize();assert.equal(e.p.ready,true,'live initialization still succeeds');
  assert(e.events.includes('_buildCompositePipelines'));assert(e.events.includes('_uploadBackdrop'));e.p.close();assert(e.owned.every(r=>!r.live));
}

const renderStages=['gb','depth','shadows','occluders','clusters','dominance','dso','dsoHierarchy','bloom','bloomTemporal','visibility','lighting','water','direct','completion'];
function prepareRender(e){
  const p=e.p;p.width=64;p.height=36;p.ready=true;p.canvas={remove(){}};p.context=e.context;
  const fields=['gb','depth','shadows','occ','clusters','dominance','dso','dsoHierarchy','bloom','bloomTemporal','visibility','lighting','water'];
  for(let i=0;i<fields.length;i++){
    const r=e.resource(renderStages[i]);p[fields[i]]=r;
    const run=async()=>e.stage('render:'+r.name,r);r.renderInstances=run;r.buildFromOwnership=run;r.render=run;r.update=run;r.sourceFromPaths=()=>({});r.invalidate=()=>{};
  }
  p.api.Lighting.buildCanonicalLights=()=>[];p.api.Shadows.selectSelfShadowLights=()=>[];p.api.Shadows.selectContactLight=()=>({id:'fallback'});
  p.visibility.bindings=()=>({visibility:{}});
  p.lighting.accumulateDirect=async()=>e.stage('render:direct',p.lighting);
  p.lighting.resolveDirect=p.lighting.render;
  p.gb.close=function(){for(const r of [this,p.shadows,p.lighting]){r.live=false;r.closes++}};
  p.gb._views=()=>({depth:{}});p.gb.atlas={albedo:{createView:()=>({})}};p.water.fieldTexture={};p.water.outputTexture=()=>({createView:()=>({})});
  p.world=e.resource('world');p.legacyTexture=e.resource('legacy');p.resources=[p.world,p.legacyTexture];
  p.fx={};for(const name of ['worldLegacy','worldHd','topLegacy','topHd','overlay'])p.fx[name]=Object.assign(e.resource(name),{uploadFrame(){},renderStage(stage){e.events.push('fx:'+name+':'+stage)}});
  p.post=Object.assign(e.resource('post'),{render(){e.events.push('post')}});
  p._renderBackgroundReceivers=()=>e.events.push('background-receivers');p._opaqueComposite=()=>e.events.push('opaque-composite');p._updateWaterField=()=>{};p._sourceFrames=()=>({legacy:{},hd:{},overlay:{}});p._blendTexture=()=>e.events.push('water-blend');
  return{frame:{logicalSize:[64,36],roomId:'lifecycle-room'},sprites:[],lights:[],settings:{},proceduralLayers:[{kind:'water',descriptor:{}}]};
}

async function testRenderCancellation(){
  for(const name of renderStages){
    const e=environment('render:'+name),scene=prepareRender(e);e.p.rendering=true;
    const drain=e.p._drain(scene);await until(()=>e.state.entered);const count=e.events.length;
    e.p.pending=scene;e.p.close();e.gate.resolve();await drain;
    assert.equal(e.p.rendering,false);assert.equal(e.p.ready,false);assert.equal(e.p.pending,null);assert.equal(e.p.presentedFrames,0);
    assert.equal(e.state.failures,0,'retired render must not trigger fallback against its replacement');assert.equal(e.p.lastError,null);
    assert(e.owned.every(r=>!r.live),'late render allocations must be retired: '+name);
    assert.deepEqual(e.events.slice(count),[],'no later render stage/submission after cancellation: '+name);
    await assert.rejects(e.p._render(scene),/presenter is closed/);
  }
  const e=environment(),scene=prepareRender(e);await e.p._drain(scene);
  assert.equal(e.p.presentedFrames,1,'live render still presents');assert.equal(e.state.failures,0);assert(e.events.includes('post'));assert(e.events.includes('submit'));
  assert.deepEqual(e.events.filter(x=>['render:gb','background-receivers','render:depth','render:shadows','render:direct','render:lighting'].includes(x)),['render:gb','background-receivers','render:depth','render:shadows','render:direct','render:shadows','render:lighting'],'background receivers precede depth, streamed direct and final lighting; forward masks are restored');
  assert.deepEqual(e.events.slice(e.events.indexOf('post')),['post','fx:overlay:post-effects','fx:topLegacy:top-additive','fx:topHd:top-additive','fx:topLegacy:top-alpha','fx:topHd:top-alpha','fx:overlay:objective','fx:overlay:guide','submit','render:completion'],'real _render must execute canonical ordering and await completion before counting a frame');e.p.close();
}

async function testRebuildCancellation(){
  const e=environment();await e.p.initialize();e.state.blockedStage='init:atlases';
  const rebuild=e.p._rebuild(128,72);await until(()=>e.state.entered);const count=e.events.length;
  e.p.close();e.gate.resolve();await assert.rejects(rebuild,error=>error.name==='SM505PresenterClosedError');
  assert.equal(e.p.ready,false);assert.equal(e.p.closed,true);assert(e.owned.every(r=>!r.live));
  assert.deepEqual(e.events.slice(count),[],'resize cancellation must not allocate subsequent resources');
  await assert.rejects(e.p._rebuild(64,36),/presenter is closed/);
}

async function testUnexpectedFailuresStillReport(){
  const e=environment('render:gb'),scene=prepareRender(e),drain=e.p._drain(scene);await until(()=>e.state.entered);
  e.gate.reject(new Error('actual live producer failure'));await drain;
  assert.equal(e.state.failures,1);assert.match(e.p.lastError,/actual live producer failure/);assert.equal(e.p.ready,false);assert.equal(e.p.closed,false);e.p.close();
  const init=environment('init:atlases'),promise=init.p.initialize();await until(()=>init.state.entered);init.gate.reject(new Error('actual initialization failure'));
  await assert.rejects(promise,/actual initialization failure/);assert.equal(init.p.closed,true);assert(init.owned.every(r=>!r.live));
}

(async()=>{
  await testInitializationCancellation();await testRenderCancellation();await testRebuildCancellation();await testUnexpectedFailuresStillReport();
  console.log('SM-505 PRESENTER LIFECYCLE PASS: 12 deferred initialization and 15 render cancellation boundaries, streamed lighting, resize cancellation, live success, canonical post/top/overlay ordering, closed-entry refusal and real-failure reporting');
})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
