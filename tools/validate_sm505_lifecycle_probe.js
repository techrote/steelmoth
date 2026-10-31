'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const API=require('./sm505_lifecycle_probe.js');
const code=fs.readFileSync(require.resolve('./sm505_lifecycle_probe.js'),'utf8');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJm0AAAAASUVORK5CYII=';

function environment(options={}){
  const state={selections:[],frames:0,failures:0,resizes:0,registryId:0,afterFailureFrames:[],listeners:new Map(),virtualMs:0};
  function style(width,height){const values={width:width+'px',height:height+'px'};return{setProperty(k,v){values[k]=v},getPropertyValue:k=>values[k]||'',getPropertyPriority:()=>'',removeProperty(k){delete values[k]},values}}
  const frame={style:style(1920,1080)},canvas={width:1920,height:1080,style:style(1920,1080),parentNode:frame,toDataURL:()=>png};
  function registry(){const r={identity:++state.registryId,resourceCount:1,generation:1,handle:{},diagnostics(){return{generation:this.generation,resourceCount:this.resourceCount,createCount:1,destroyCount:1-this.resourceCount,rebuildCount:0,resizeCount:0,estimatedBytes:this.resourceCount*4}},close(){this.resourceCount=0}};return r}
  function presenter(){const r=registry(),p={ready:true,closed:false,width:1920,height:1080,rendering:false,pending:null,waitingForGPU:false,submittedFrames:1,completedFrames:1,canvas:{id:'webgpuPresentation',width:1920,height:1080,toDataURL:()=>png},gb:{registry:r,_record(){return{handle:this.registry.handle,generation:1}}},diagnostics(){return{gtaoEnabled:false,quality:'Medium'}},close(){this.closed=true;this.ready=false;this.canvas=null;this.gb.registry.close()}};if(options.legacyCounters)delete p.completedFrames;return p}
  const runtime={activeBackend:'webgpu',presentationBackend:'webgpu',requestedBackend:'webgpu',presenter:presenter(),manager:{uncapturedErrors:[]},status:'ready',failureSnapshotCount:options.priorFailure?1:0,lastFailure:null,
    diagnostics(){return{requestedBackend:this.requestedBackend,activeBackend:this.activeBackend,presentationBackend:this.presentationBackend,status:this.status,autoWebGPUEnabled:false,fallbackReason:this.fallbackReason||'',failureSnapshotCount:this.failureSnapshotCount,lastFailure:this.lastFailure,webgpu:this.manager?{uncapturedErrors:this.manager.uncapturedErrors}:null,webgpuPresenter:this.presenter?.diagnostics()||null}},
    async select(mode,opts){assert.equal(opts.persist,false);state.selections.push(mode);if(options.rejectSelectionAt===state.selections.length)throw new Error('synthetic selection fault');this.presenter?.close();this.presenter=null;this.requestedBackend=mode;this.activeBackend=mode;this.presentationBackend=mode;this.status='ready';if(mode==='webgpu'){this.presenter=presenter();this.manager={uncapturedErrors:[]}}else this.manager=null;return this.diagnostics()},
    _presenterFailed(p,error){state.failures++;this.failureSnapshotCount++;this.lastFailure={presentationBackend:'webgpu',surface:{count:1},error:{message:error.message}};p.close();this.presenter=null;this.manager=null;this.activeBackend='webgl2';this.presentationBackend='webgl2';this.status='fallback-runtime';this.fallbackReason=error.message}}
  const scene={schema:'steelmoth-render-scene/v1',frame:{logicalSize:[640,360],timeMs:12000,roomId:'fixture',sequence:12},sprites:[{id:'box',transform:{x:20,y:20}}],settings:{ambient:.3}};
  const renderer={nativeW:1920,nativeH:1080,gl:{isContextLost:()=>!!state.glLost},resizeToDisplaySize(){const w=parseInt(canvas.style.getPropertyValue('width')),h=parseInt(canvas.style.getPropertyValue('height'));if(w===this.nativeW&&h===this.nativeH)return false;this.nativeW=w;this.nativeH=h;canvas.width=w;canvas.height=h;state.resizes++;return true}};
  if(options.noResize)delete renderer.resizeToDisplaySize;
  const loop=()=>{},renderOnce=()=>{
    state.frames++;scene.frame.sequence++;if(state.failures)state.afterFailureFrames.push(runtime.presentationBackend);
    if(options.glLostAt===state.frames)state.glLost=true;
    const changed=renderer.resizeToDisplaySize?.()||false,p=runtime.presenter;
    if(changed&&p){p.width=renderer.nativeW;p.height=renderer.nativeH;p.canvas.width=p.width;p.canvas.height=p.height;if(!options.noRecreation){p.gb.registry.close();p.gb.registry=registry()}}
    if(options.mutateAt===state.frames)game.x++;
    if(p){p.rendering=true;p.waitingForGPU=true;p.submittedFrames++;if(options.neverComplete){state.neverWaiting=true;return}
      queueMicrotask(()=>{if(options.gpuErrorAt===state.frames)runtime.manager.uncapturedErrors.push({message:'synthetic GPU validation fault'});p.completedFrames++;p.waitingForGPU=false;p.rendering=false})}
  };
  const game={renderer,canvas,loop,paused:true,contextLost:false,frameErrorCount:0,x:1,y:2,vx:0,vy:0,room:{index:0,key:'fixture'},state:{completed:new Set(),moths:new Set(),robots:new Set(),released:new Set()},renderScene:scene,__smHarnessRenderOnce:renderOnce};
  const harness={enabled:true,config:{width:1920,height:1080,dpr:1,quality:'medium',inspection:'development',fixedTimeMs:12000}};
  const context={console:{log(){}},performance:{now(){return performance.now()+(state.neverWaiting?(state.virtualMs+=250):0)}},setTimeout,clearTimeout,queueMicrotask,devicePixelRatio:1,innerWidth:1920,innerHeight:1080,game,steelMothBackendRuntime:runtime,SteelMothRenderHarness:harness,
    document:{scripts:[{src:'http://localhost/engine/game.js?v=sm505-test'}],querySelectorAll:()=>runtime.presenter?.canvas?[runtime.presenter.canvas]:[]},
    addEventListener(name,fn){state.listeners.set(name,fn)},removeEventListener(name,fn){if(state.listeners.get(name)===fn)state.listeners.delete(name)}};
  vm.createContext(context);vm.runInContext(code,context);
  return{context,runtime,game,harness,state,loop,renderOnce,styles:JSON.stringify([canvas.style.values,frame.style.values])};
}

async function main(){
  for(const timeoutMs of [0,NaN,Infinity,999,180001])assert.throws(()=>API.sm505LifecycleOptions({timeoutMs}));
  assert.throws(()=>API.sm505LifecycleOptions({rounds:1}),/exactly2/);assert.equal(API.sm505LifecycleOptions().timeoutMs,120000);
  const e=environment(),r=await e.context.sm505LifecycleProbe({sourceIdentity:{commit:'cpu-mock-only'},observerSha256:'cpu-mock-source'});
  assert(r.ok,JSON.stringify(r.errors));assert(r.expectedFallback);assert(r.restoredExtent);assert.equal(r.resizeStatus,'PASS');assert(r.checks.every(c=>c.ok));
  assert.deepEqual(e.state.selections,['webgl2','webgpu','webgl2','webgpu']);assert.equal(e.state.failures,1);assert.deepEqual(e.state.afterFailureFrames,['webgl2'],'last failure may render compatibility frame but never reselect WebGPU');
  assert.equal(e.state.resizes,2);assert.equal(r.checkpoints.length,9);assert.equal(r.screenshots.length,9);assert(r.screenshots.every(s=>s.pngBase64.startsWith('iVBORw0KGgo')&&!('pngBase64' in(s.runtime||{}))));
  assert.equal(r.beforeExpectedFallback.canvasCount,1);assert.equal(r.afterExpectedFallback.canvasCount,0);assert.equal(r.afterExpectedFallback.presentation,'webgl2');
  assert.deepEqual(r.gameplayAfter,r.gameplayBefore);assert.strictEqual(e.game.loop,e.loop);assert.strictEqual(e.game.__smHarnessRenderOnce,e.renderOnce);assert.equal(e.state.listeners.size,0);
  assert.equal(JSON.stringify([e.game.canvas.style.values,e.game.canvas.parentNode.style.values]),e.styles);assert.equal(e.harness.config.width,1920);
  const native=r.checkpoints.filter(c=>c.name==='resize-1280x720'||c.name==='restore-1920x1080');assert.equal(native.length,2);assert(native.every(c=>c.presenter.resources.registryGeneration===1),'replacement numeric generation1 must not masquerade as an increment');
  assert.notEqual(native[0].presenter.resources.registryIdentity,native[1].presenter.resources.registryIdentity);assert.notEqual(native[0].presenter.resources.objectHandleIdentity,native[1].presenter.resources.objectHandleIdentity);
  assert(r.notRun.actualDeviceLoss.startsWith('NOT RUN'));assert(r.notRun.roomEditor.startsWith('NOT RUN'));assert.equal(r.releaseAcceptance,false);assert.equal(r.performanceAcceptance,false);assert.equal(r.visualAcceptance,false);
  const unsupported=environment({noResize:true}),partial=await unsupported.context.sm505LifecycleProbe();assert(!partial.ok);assert.equal(partial.status,'PARTIAL_NOT_RUN');assert.equal(partial.resizeStatus,'NOT RUN');assert(partial.expectedFallback);assert(partial.notRun.resize.startsWith('NOT RUN'));
  const old=environment({legacyCounters:true}),oldResult=await old.context.sm505LifecycleProbe();assert(!oldResult.ok);assert.equal(old.state.frames,0);assert.equal(old.state.selections.length,0);assert.equal(old.state.failures,0);
  const prior=environment({priorFailure:true}),priorResult=await prior.context.sm505LifecycleProbe();assert(!priorResult.ok);assert.equal(prior.state.frames,0);assert.equal(prior.state.selections.length,0);
  for(const fault of [{rejectSelectionAt:2},{mutateAt:3},{gpuErrorAt:6},{glLostAt:2},{noRecreation:true},{neverComplete:true}]){
    const bad=environment(fault),result=await bad.context.sm505LifecycleProbe({timeoutMs:1000});assert(!result.ok,JSON.stringify(fault));assert(result.errors.length);assert(result.unexpectedFailureStoppedWithoutRetry);assert(result.requiresOuterBrowserTeardown);assert(result.failureState||result.failureCaptureError);assert.equal(bad.state.failures,0,'unexpected errors cannot advance to deliberate failure');assert.strictEqual(bad.game.loop,bad.loop);assert.equal(bad.state.listeners.size,0);assert(!result.cleanup.gpuWorkDuringFailureCleanup);
    if(fault.gpuErrorAt===6){assert.equal(bad.game.renderer.nativeW,1280,'failure CSS cleanup must not render/retry a restored GPU target');assert.equal(bad.game.canvas.style.getPropertyValue('width'),'1920px');assert.equal(bad.state.frames,6);assert.equal(bad.state.selections.length,4)}
  }
  assert(!/\.device\.destroy\s*\(/.test(code),'probe must never inject actual device destruction');
  console.log('SM-505 LIFECYCLE PROBE CPU PASS: mocked completed normal-bridge frames, two backend rounds, real-reference generation proof, native1280/1920 extent restoration, retained last controlled fallback, PNG return shape, failure-stop/no-retry, unsupported NOTRUN and no device-loss injection; NO browser/GPU execution');
}
main().catch(error=>{console.error(error?.stack||error);process.exit(1)});
