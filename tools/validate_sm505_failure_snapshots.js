'use strict';
// No browser/device/queue calls: capture failures using controlled plain diagnostics.
const assert=require('assert');
const {BackendRuntime}=require('../engine/backend_runtime.js');

function environment(options={}){
  const events=[],managers=[],presenters=[];
  const documentRef={querySelector:()=>null,querySelectorAll:()=>presenters.filter(p=>!p.closed).map(p=>p.canvas)};
  const root={document:documentRef},resourceState={resourceCount:11,createCount:12,destroyCount:1,estimatedBytes:1234};
  const registry={diagnostics(){events.push('registry-diagnostics');return{...resourceState}},close(){}};
  const pipelines={diagnostics(){events.push('pipeline-diagnostics');return{count:5,hits:10,misses:5}}};
  const game={renderer:{nativeW:1920,nativeH:1080},renderScene:{frame:{logicalSize:[640,360],sequence:211,roomId:'failure-room'}}};
  const runtime=new BackendRuntime({root,documentRef,storage:null,locationRef:{search:'',hostname:'example.test'},navigatorRef:{gpu:{}},
    canvasFactory:()=>({width:2,height:2,style:{}}),
    managerFactory:callbacks=>{
      const manager={status:'idle',device:{queue:{}},configuration:{width:2,height:2},loss:null,uncapturedErrors:[],diagnosticsThrows:false,
        async initialize(){this.status='ready'},
        diagnostics(){events.push('manager-diagnostics');if(this.diagnosticsThrows)throw new Error('manager diagnostics broken');return{status:this.status,adapterInfo:{vendor:'nvidia',architecture:'turing'},deviceLost:this.loss,uncapturedErrors:this.uncapturedErrors,configuration:this.configuration,configureCount:1,resizeCount:0}},
        close(){events.push('manager-close');this.status='closed';this.configuration=null},
        lose(info={reason:'unknown',message:'original GPU loss'}){this.loss=info;callbacks.onDeviceLost(info)},
        uncaptured(record={message:'original validation error'}){this.uncapturedErrors.push(record);callbacks.onUncapturedError(record)}};
      managers.push(manager);return manager;
    },
    infrastructureFactory:()=>({diagnostics(){events.push('infrastructure-diagnostics');return{resources:{resourceCount:0,createCount:0,destroyCount:0}}},close(){events.push('infrastructure-close')}}),
    presenterFactory:({onFailure})=>{
      const p={ready:false,closed:false,width:1920,height:1080,presentedFrames:83,droppedFrames:5,rendering:true,pending:{id:'bounded-pending-scene'},canvas:{id:'webgpuPresentation',width:1920,height:1080},
        nativeUnits:{worldScale:3},lastOpaqueVisibilityPlan:{batches:[{ids:['cone'],selfShadow:true}]},gb:{registry,pipelines},lighting:{registry,pipelines},
        async initialize(){if(options.initializationFailure)throw new Error('initialization failed');this.ready=true;return this},
        diagnostics(){events.push('presenter-diagnostics');if(this.diagnosticsThrows)throw new Error('presenter diagnostics broken');const result={ready:this.ready,closed:this.closed,extent:{width:this.width,height:this.height},presentedFrames:this.presentedFrames};if(this.circular){result.circular=result;result.handle=new (class GPUTexture {})()}return result},
        close(){events.push('presenter-close');this.closed=true;this.ready=false;this.canvas=null;this.nativeUnits.worldScale=99;resourceState.resourceCount=0;resourceState.destroyCount=12},
        fail(error=new Error('original presenter failure')){onFailure(error,this)}};
      presenters.push(p);return p;
    }});
  runtime.attachGame(game);
  return{runtime,game,events,managers,presenters,registry,resourceState};
}

async function beforeCloseCapture(){
  const e=environment();await e.runtime.select('webgpu',{persist:false});e.events.length=0;
  const manager=e.runtime.manager;e.runtime.presenter.completedFrames=80;e.runtime.presenter.submittedFrames=84;e.runtime.presenter.inFlightFrames=4;
  manager.lose({reason:'destroyed',message:'exact first loss'});
  const d=e.runtime.diagnostics(),s=d.firstFailure;
  assert.equal(d.activeBackend,'webgl2');assert.equal(d.presentationBackend,'webgl2');assert.equal(d.status,'fallback-device-lost');
  assert.equal(s.requestedBackend,'webgpu');assert.equal(s.activeBackend,'webgpu');assert.equal(s.presentationBackend,'webgpu');assert.equal(s.statusBeforeFallback,'ready');
  assert.equal(s.generation,e.runtime._generation-1);assert.equal(s.details.deviceLoss.reason,'destroyed');assert.equal(s.manager.deviceLost.message,'exact first loss');
  assert.equal(s.surface.id,'webgpuPresentation');assert.equal(s.surface.count,1);assert.equal(s.surface.width,1920);
  assert.deepEqual(s.sourceExtent,{nativeWidth:1920,nativeHeight:1080,logicalSize:[640,360],sceneSequence:211,roomId:'failure-room'});
  assert.equal(s.nativeUnits.worldScale,3);assert.equal(s.opaqueVisibilityPlan.batches[0].ids[0],'cone');
  assert.equal(s.frames.presented,83);assert.equal(s.frames.submitted,84);assert.equal(s.frames.completed,80);assert.equal(s.frames.inFlight,4);assert.equal(s.frames.pending,true);
  assert.equal(s.producerResources.gb.registry.resourceCount,11);assert.equal(s.producerResources.gb.registry.destroyCount,1);
  assert.deepEqual(s.producerResources.lighting.registry,{sharedWith:'gb.registry'});
  assert.equal(s.producerResources.gb.pipelines.count,5);
  for(const name of ['registry-diagnostics','pipeline-diagnostics','manager-diagnostics','presenter-diagnostics','infrastructure-diagnostics'])assert(e.events.indexOf(name)<e.events.indexOf('presenter-close'),`${name} must precede teardown`);
  d.firstFailure.nativeUnits.worldScale=-1;assert.equal(e.runtime.diagnostics().firstFailure.nativeUnits.worldScale,3,'public diagnostics must deep-clone retained snapshots');
  assert.equal(e.resourceState.resourceCount,0,'real close still ran');
}

async function persistsAcrossSelectionsAndClose(){
  const e=environment();await e.runtime.select('webgpu',{persist:false});e.runtime.presenter.fail();
  const original=JSON.stringify(e.runtime.diagnostics().firstFailure);
  assert.equal(e.runtime.diagnostics().firstFailure.frames.completed,null);assert.equal(e.runtime.diagnostics().firstFailure.frames.submitted,null);assert.equal(e.runtime.diagnostics().firstFailure.frames.inFlight,null);
  await e.runtime.select('webgl2',{persist:false});assert.equal(JSON.stringify(e.runtime.diagnostics().firstFailure),original);
  await e.runtime.select('webgpu',{persist:false});e.runtime.manager.uncaptured({name:'GPUValidationError',message:'later failure'});
  const d=e.runtime.diagnostics();assert.equal(JSON.stringify(d.firstFailure),original);assert.equal(d.lastFailure.details.uncapturedError.message,'later failure');assert.equal(d.failureSnapshotCount,2);
  e.runtime.close();assert.equal(JSON.stringify(e.runtime.diagnostics().firstFailure),original,'close must not erase failure evidence');
}

async function staleCallbacksIgnored(){
  const e=environment();await e.runtime.select('webgpu',{persist:false});const old=e.runtime.manager,oldPresenter=e.runtime.presenter;
  await e.runtime.select('webgpu',{persist:false});const current=e.runtime.presenter;
  old.lose();old.uncaptured();oldPresenter.fail();
  assert.equal(e.runtime.presenter,current);assert.equal(e.runtime.presentationBackend,'webgpu');assert.equal(e.runtime.diagnostics().firstFailure,null);assert.equal(e.runtime.diagnostics().failureSnapshotCount,0);
  e.runtime.close();
}

async function brokenAndCircularDiagnosticsCannotBlockFallback(){
  for(const kind of ['throw','circular','resource-throw']){
    const e=environment();await e.runtime.select('webgpu',{persist:false});
    if(kind==='throw'){e.runtime.manager.diagnosticsThrows=true;e.runtime.presenter.diagnosticsThrows=true}
    if(kind==='circular')e.runtime.presenter.circular=true;
    if(kind==='resource-throw')e.registry.diagnostics=()=>{throw new Error('registry diagnostic fault')};
    e.runtime.presenter.fail();const d=e.runtime.diagnostics(),serialized=JSON.stringify(d);
    assert.equal(d.status,'fallback-runtime');assert.equal(d.presentationBackend,'webgl2');assert(e.presenters[0].closed);assert(e.managers[0].status==='closed');
    assert(serialized.includes(kind==='circular'?'[circular]':'captureError'));
    if(kind==='circular'){assert.equal(d.firstFailure.presenter.handle,'[opaque-object]');assert(!serialized.includes('GPUTexture'))}
  }
}

async function boundedErrorsAndPayload(){
  const e=environment();await e.runtime.select('webgpu',{persist:false});
  e.runtime.manager.uncapturedErrors=Array.from({length:100},(_,i)=>({message:'x'.repeat(5000),index:i}));
  e.runtime.presenter.fail();const s=e.runtime.diagnostics().firstFailure;
  assert.equal(s.manager.uncapturedErrors.length,17);assert.equal(s.manager.uncapturedErrors[16].truncatedEntries,84);
  assert(s.manager.uncapturedErrors[0].message.length<600);assert(JSON.stringify(s).length<=65536);
  const f=environment();await f.runtime.select('webgpu',{persist:false});
  f.runtime.manager.diagnostics=()=>Object.fromEntries(Array.from({length:64},(_,i)=>['field'+i,Array(32).fill('z'.repeat(1000))]));
  f.runtime.presenter.fail();const huge=f.runtime.diagnostics();assert.equal(huge.status,'fallback-runtime');assert(JSON.stringify(huge.firstFailure).length<=65536);
}

async function initializationCapturedBeforeRuntimeClose(){
  const e=environment({initializationFailure:true});await e.runtime.select('webgpu',{persist:false});const d=e.runtime.diagnostics();
  assert.equal(d.status,'fallback');assert.equal(d.firstFailure.trigger,'presenter-initialization-before-close');assert.equal(d.firstFailure.presenter.closed,false);assert.equal(d.firstFailure.surface.count,1);assert(e.presenters[0].closed);
}

(async()=>{
  await beforeCloseCapture();await persistsAcrossSelectionsAndClose();await staleCallbacksIgnored();await brokenAndCircularDiagnosticsCannotBlockFallback();await boundedErrorsAndPayload();await initializationCapturedBeforeRuntimeClose();
  console.log('SM-505 FIRST-FAILURE SNAPSHOT PASS: synchronous before-close state, explicit unknown GPU completion, deep-copy isolation, session retention, last-failure update, stale callbacks, circular/opaque/throwing diagnostics, bounded error/payload custody and initialization failure');
})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
