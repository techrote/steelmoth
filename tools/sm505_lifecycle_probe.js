'use strict';

function sm505LifecycleStable(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(sm505LifecycleStable).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+sm505LifecycleStable(value[k])).join(',')+'}';
}

function sm505LifecycleOptions(raw={}){
  const options={timeoutMs:120000,...raw};
  if(!Number.isFinite(options.timeoutMs)||options.timeoutMs<1000||options.timeoutMs>180000)throw new Error('lifecycle timeoutMs must be finite1000..180000');
  if(raw.rounds!==undefined&&raw.rounds!==2)throw new Error('lifecycle probe requires exactly2 explicit switch rounds');
  return options;
}

async function sm505LifecycleProbe(rawOptions={}){
  const root=globalThis,result={schema:'steelmoth-sm505-lifecycle-probe/v1',ok:false,checks:[],errors:[],screenshots:[],checkpoints:[],expectedFallback:false,restoredExtent:false,
    notRun:{actualDeviceLoss:'NOT RUN: no device.destroy/loss/driver-reset injection; only controlled runtime presenter failure',roomEditor:'NOT RUN: separate public editor/room mutation contract required'},
    cleanup:{loopRestored:false,cssRestored:false,gpuWorkDuringFailureCleanup:false},visualAcceptance:false,performanceAcceptance:false,releaseAcceptance:false,
    boundary:'Normal-index frozen gameplay lifecycle correctness/captures only. GPU-completed counters are required. Registry/texture reference identities prove replacement, not GPU residency or leak/performance acceptance.'};
  let options,runtime,game,harness,originalLoop,originalStyles=null,gameplayBefore,sceneBefore,harnessBefore,sourceBefore,deadline,expectedStarted=false,successful=false;
  const clock=()=>performance.now(),started=clock(),observerErrors=[],identityMap=new WeakMap();let nextIdentity=1;
  const identity=value=>{if(!value||typeof value!=='object')return null;if(!identityMap.has(value))identityMap.set(value,nextIdentity++);return identityMap.get(value)};
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const errorText=error=>String(error?.stack||error?.message||error);
  const ensure=(condition,message,data)=>{if(!condition){const error=new Error(message);if(data)error.details=clone(data);throw error}};
  const check=(name,condition,data={})=>{result.checks.push({name,ok:!!condition,...clone(data)});ensure(condition,name,data)};
  const remaining=()=>{const ms=deadline-clock();if(ms<=0)throw new Error('SM-505 lifecycle wall-clock deadline expired');return ms};
  async function bounded(promise,label){remaining();let timer;try{return await Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SM-505 lifecycle deadline: '+label)),remaining())})])}finally{clearTimeout(timer)}}
  const observe=event=>{observerErrors.push({type:event.type,message:String(event.error?.stack||event.reason?.stack||event.reason||event.message||'page error').slice(0,2048)});if(observerErrors.length>64)observerErrors.shift()};
  function gameplay(){return sm505LifecycleStable({roomIndex:game.room?.index??null,roomKey:game.room?.key??null,position:[game.x,game.y],velocity:[game.vx,game.vy],paused:game.paused,
    completed:[...game.state.completed].sort(),collectibles:[...game.state.moths].sort(),companions:[...game.state.robots].sort(),released:[...game.state.released].sort()})}
  function canonicalScene(){const value=clone(game.renderScene);if(value?.frame)delete value.frame.sequence;return sm505LifecycleStable(value)}
  function errorsNow(){const d=runtime.diagnostics();return{runtime:d,uncapturedErrors:d.webgpu?.uncapturedErrors||[],pageErrors:clone(observerErrors)}}
  function invariant(label){
    const errors=errorsNow();ensure(errors.uncapturedErrors.length===0,'unexpected uncaptured GPU errors at '+label,errors);ensure(observerErrors.length===0,'unexpected page errors at '+label,errors);
    ensure(game.renderer.gl?.isContextLost?.()===false&&game.contextLost!==true,'WebGL2 compatibility context is lost/unavailable at '+label);
    ensure(game.frameErrorCount===sourceBefore.frameErrorCount,'game render fault counter changed at '+label);
    ensure(gameplay()===gameplayBefore,'gameplay authority changed at '+label);ensure(canonicalScene()===sceneBefore,'canonical RenderScene changed at '+label+' (only frame.sequence may change)');
    ensure(sm505LifecycleStable(harness.config)===harnessBefore,'harness config changed at '+label);ensure(game.__smHarnessRenderOnce===sourceBefore.renderOnce,'frozen bridge render entrypoint changed');
    if(!expectedStarted)ensure((errors.runtime.failureSnapshotCount||0)===sourceBefore.failureSnapshotCount,'unexpected recorded runtime failure at '+label,errors.runtime);
  }
  function resources(p){
    const registry=p?.gb?.registry,record=typeof p?.gb?._record==='function'?p.gb._record('object'):null;
    if(!registry||!record?.handle||typeof registry.diagnostics!=='function')return null;
    const d=registry.diagnostics();return{registryIdentity:identity(registry),registryGeneration:d.generation??null,objectHandleIdentity:identity(record.handle),objectRecordGeneration:record.generation??null,
      resourceCount:d.resourceCount,createCount:d.createCount,destroyCount:d.destroyCount,rebuildCount:d.rebuildCount,resizeCount:d.resizeCount,estimatedBytes:d.estimatedBytes,
      epochMeaning:'Observed actual registry instance plus its numeric generation; replacement registries may reset their numeric generation to1. Texture reference identity independently verifies recreation.'};
  }
  function snapshot(){
    const p=runtime.presenter,d=runtime.diagnostics(),canvasCount=root.document.querySelectorAll('#webgpuPresentation').length;
    return{atMs:clock()-started,requested:d.requestedBackend,active:d.activeBackend,presentation:d.presentationBackend,status:d.status,autoWebGPUEnabled:d.autoWebGPUEnabled,runtime:clone(d),
      canvasCount,gameCanvas:[game.canvas.width,game.canvas.height],rendererNative:[game.renderer.nativeW,game.renderer.nativeH],browserViewport:[root.innerWidth??null,root.innerHeight??null],dpr:root.devicePixelRatio,
      webgl2ContextLost:game.renderer.gl?.isContextLost?.()??null,gameContextLost:game.contextLost??null,frameErrorCount:game.frameErrorCount??null,
      presenter:p?{identity:identity(p),canvasId:p.canvas?.id??null,canvasExtent:[p.canvas?.width??null,p.canvas?.height??null],width:p.width,height:p.height,rendering:!!p.rendering,pending:!!p.pending,waitingForGPU:!!p.waitingForGPU,submittedFrames:p.submittedFrames??null,completedFrames:p.completedFrames??null,resources:resources(p)}:null};
  }
  function png(name){
    remaining();const backend=runtime.presentationBackend,canvas=backend==='webgpu'?runtime.presenter?.canvas:game.canvas;
    ensure(canvas&&typeof canvas.toDataURL==='function','capture canvas unavailable: '+name);
    const value=canvas.toDataURL('image/png'),prefix='data:image/png;base64,';
    ensure(typeof value==='string'&&value.startsWith(prefix)&&value.slice(prefix.length).startsWith('iVBORw0KGgo'),'capture PNG unavailable: '+name);
    result.screenshots.push({name,pngBase64:value.slice(prefix.length),width:canvas.width,height:canvas.height,presentationBackend:backend,kind:'actual-completed-canvas-post',displayBoundary:'Canvas PNG; browser-compositor screenshot must be captured separately by outer runner.'});
  }
  function checkpoint(name,backend,extent){
    invariant(name);const state=snapshot();check(name+' ownership',state.active===backend&&state.presentation===backend&&state.canvasCount===(backend==='webgpu'?1:0),state);
    check(name+' actual extent',state.gameCanvas[0]===extent[0]&&state.gameCanvas[1]===extent[1]&&state.rendererNative[0]===extent[0]&&state.rendererNative[1]===extent[1],{actual:state.rendererNative,expected:extent});
    if(backend==='webgpu')check(name+' completed surface',state.presenter?.completedFrames>=1&&!state.presenter.rendering&&!state.presenter.waitingForGPU&&state.presenter.canvasExtent[0]===extent[0]&&state.presenter.canvasExtent[1]===extent[1],state.presenter);
    result.checkpoints.push({name,...state});png(name);return state;
  }
  async function renderOnce(label){
    remaining();const p=runtime.presentationBackend==='webgpu'?runtime.presenter:null,before=p?.completedFrames;
    if(p)ensure(Number.isSafeInteger(p.submittedFrames)&&Number.isSafeInteger(before),'actual GPU submitted/completed counters unavailable; cannot substitute CPU presentation count');
    game.__smHarnessRenderOnce();
    if(p){
      while(true){remaining();ensure(runtime.presenter===p&&runtime.presentationBackend==='webgpu'&&p.ready&&!p.closed,'WebGPU failed during '+label,runtime.diagnostics());
        if(!p.rendering&&!p.pending&&!p.waitingForGPU&&p.completedFrames>=before+1)break;
        await bounded(new Promise(resolve=>setTimeout(resolve,10)),label+' frame completion');
      }
      ensure(p.completedFrames===before+1,'one frozen bridge render must complete exactly one GPU frame');
      ensure(p.submittedFrames===p.completedFrames,'submitted/completed frame accounting differs after '+label);
    }
    invariant(label);
  }
  async function select(mode,label){remaining();await bounded(runtime.select(mode,{persist:false}),label);const d=runtime.diagnostics();ensure(d.activeBackend===mode&&d.presentationBackend===mode,'explicit backend selection failed: '+label,d);invariant(label)}
  function saveStyles(){return[game.canvas,game.canvas.parentNode].map(node=>({node,values:['width','height'].map(key=>({key,value:node.style.getPropertyValue(key),priority:node.style.getPropertyPriority(key)}))}))}
  function restoreStyles(){if(originalStyles)for(const {node,values} of originalStyles)for(const {key,value,priority}of values){if(value)node.style.setProperty(key,value,priority);else node.style.removeProperty(key)}result.cleanup.cssRestored=!!originalStyles}
  function cssExtent(width,height){for(const {node}of originalStyles){node.style.setProperty('width',width+'px');node.style.setProperty('height',height+'px')}}
  try{
    options=sm505LifecycleOptions(rawOptions);deadline=started+options.timeoutMs;
    runtime=root.steelMothBackendRuntime;game=root.game;harness=root.SteelMothRenderHarness;
    ensure(runtime&&game?.renderer&&game.canvas&&harness?.enabled&&game.paused===true,'lifecycle requires the frozen normal-index fixture/game/runtime');
    ensure(typeof game.__smHarnessRenderOnce==='function'&&typeof game.loop==='function'&&typeof runtime.select==='function','actual normal-game bridge render/selection APIs missing');
    ensure(root.devicePixelRatio===1,'native lifecycle requires DPR1');
    ensure(game.renderer.gl?.isContextLost?.()===false&&game.contextLost!==true,'live WebGL2 compatibility context is required');
    ensure(Number.isSafeInteger(game.frameErrorCount)&&game.frameErrorCount===0,'a clean normal-game frame error counter is required');
    ensure(runtime.presentationBackend==='webgpu'&&runtime.activeBackend==='webgpu'&&runtime.presenter?.ready&&!runtime.presenter.rendering&&!runtime.presenter.pending,'initial WebGPU presenter must already be ready/idle');
    ensure(runtime.presenter.width===1920&&runtime.presenter.height===1080,'initial actual WebGPU extent must be1920x1080');
    ensure(runtime.presenter.diagnostics().gtaoEnabled===false&&runtime.presenter.diagnostics().quality==='Medium','lifecycle requires Medium/GTAOoff candidate');
    ensure((runtime.diagnostics().failureSnapshotCount||0)===0,'lifecycle cannot continue a session with a previously recorded runtime failure');
    originalLoop=game.loop;game.loop=()=>{};
    gameplayBefore=gameplay();sceneBefore=canonicalScene();harnessBefore=sm505LifecycleStable(harness.config);
    sourceBefore={renderOnce:game.__smHarnessRenderOnce,failureSnapshotCount:runtime.diagnostics().failureSnapshotCount||0,frameErrorCount:game.frameErrorCount};
    result.source={identity:clone(options.sourceIdentity||root.SM505LifecycleSourceIdentity||null),observerSha256:options.observerSha256||null,loadedScripts:Array.from(root.document.scripts||[]).map(s=>s.src).filter(Boolean),harnessConfig:clone(harness.config),canonicalScene:clone(game.renderScene),
      boundary:'Outer runner owns exact repository/source-before/after hashes and raw observer SHA-256. JS retains loaded script URLs and the fixed canonical scene/config; unavailable source identity stays null.'};
    root.addEventListener('error',observe);root.addEventListener('unhandledrejection',observe);
    result.gameplayBefore=JSON.parse(gameplayBefore);await renderOnce('initial completion');checkpoint('initial-webgpu','webgpu',[1920,1080]);
    for(let round=1;round<=2;round++){
      const old=runtime.presenter,oldRegistry=old.gb?.registry,oldIdentity=identity(old);
      await select('webgl2','round'+round+' explicit WebGL2');await renderOnce('round'+round+' WebGL2');checkpoint('round'+round+'-webgl2','webgl2',[1920,1080]);
      check('round'+round+' retired prior presenter',old.closed===true&&old.canvas===null,{presenterIdentity:oldIdentity});
      if(oldRegistry?.diagnostics)check('round'+round+' prior registry retired',oldRegistry.diagnostics().resourceCount===0);
      await select('webgpu','round'+round+' explicit WebGPU');check('round'+round+' new presenter identity',runtime.presenter!==old);
      await renderOnce('round'+round+' WebGPU');checkpoint('round'+round+'-webgpu','webgpu',[1920,1080]);
    }
    const resizeSupported=typeof game.renderer.resizeToDisplaySize==='function'&&game.canvas.parentNode?.style?.setProperty&&game.canvas.style?.setProperty&&resources(runtime.presenter)!==null;
    if(resizeSupported){
      originalStyles=saveStyles();let previous=resources(runtime.presenter);
      for(const [width,height,label]of [[1280,720,'resize-1280x720'],[1920,1080,'restore-1920x1080']]){
        const oldRegistry=runtime.presenter.gb.registry;cssExtent(width,height);await renderOnce(label);const state=checkpoint(label,'webgpu',[width,height]),current=state.presenter.resources;
        check(label+' real resource generation replacement',current.registryIdentity!==previous.registryIdentity&&current.objectHandleIdentity!==previous.objectHandleIdentity,{before:previous,after:current});
        check(label+' retired old target registry',oldRegistry!==runtime.presenter.gb.registry&&oldRegistry.diagnostics().resourceCount===0);
        previous=current;
      }
      restoreStyles();await renderOnce('original CSS restore');check('original native extent restored',game.renderer.nativeW===1920&&game.renderer.nativeH===1080&&runtime.presenter.width===1920&&runtime.presenter.height===1080);
      result.restoredExtent=true;result.resizeStatus='PASS';
    }else{
      result.notRun.resize='NOT RUN: public display-size resize or actual registry/texture identity API unavailable; outer viewport driver must exercise two native extents';result.resizeStatus='NOT RUN';
      result.restoredExtent=game.renderer.nativeW===1920&&game.renderer.nativeH===1080;
    }
    result.beforeExpectedFallback=checkpoint('before-controlled-fallback','webgpu',[1920,1080]);
    result.beforeExpectedFallback.canonicalScene=clone(game.renderScene);result.beforeExpectedFallback.gameplay=JSON.parse(gameplayBefore);
    ensure(typeof runtime._presenterFailed==='function','controlled runtime presenter-failure entrypoint unavailable');
    expectedStarted=true;const marker='sm505-lifecycle-controlled-runtime-fallback';
    runtime._presenterFailed(runtime.presenter,new Error(marker));
    const fallback=runtime.diagnostics();
    check('controlled failure only expected runtime fallback',fallback.status==='fallback-runtime'&&fallback.activeBackend==='webgl2'&&fallback.presentationBackend==='webgl2'&&String(fallback.fallbackReason).includes(marker),fallback);
    check('controlled failure retained before-close snapshot',fallback.lastFailure?.presentationBackend==='webgpu'&&fallback.lastFailure.surface?.count===1&&String(fallback.lastFailure.error?.message).includes(marker),fallback.lastFailure);
    check('exactly one expected failure snapshot',fallback.failureSnapshotCount===sourceBefore.failureSnapshotCount+1,{before:sourceBefore.failureSnapshotCount,after:fallback.failureSnapshotCount});
    result.expectedFallback=true;await renderOnce('controlled fallback WebGL2');result.afterExpectedFallback=checkpoint('controlled-fallback-webgl2','webgl2',[1920,1080]);
    result.gameplayAfter=JSON.parse(gameplay());check('gameplay authority unchanged',gameplay()===gameplayBefore);
    result.noWebGPUReselectionAfterExpectedFailure=true;successful=true;result.ok=result.resizeStatus==='PASS'&&result.checks.every(c=>c.ok);result.status=result.ok?'PASS':'PARTIAL_NOT_RUN';
  }catch(error){
    result.errors.push(errorText(error));result.status='FAIL';
    try{result.failureState=snapshot();result.failureState.gameplay=game?JSON.parse(gameplay()):null;result.failureState.scene=clone(game?.renderScene)}catch(captureError){result.failureCaptureError=errorText(captureError)}
    result.unexpectedFailureStoppedWithoutRetry=true;result.requiresOuterBrowserTeardown=true;
  }finally{
    // No render/selection/submission follows an unexpected failure. Restoring
    // CSS and observer-owned hooks alone cannot fabricate restored GPU targets.
    if(!successful&&originalStyles)try{restoreStyles()}catch(error){result.errors.push('CSS restore: '+errorText(error))}
    if(game&&originalLoop!==undefined){game.loop=originalLoop;result.cleanup.loopRestored=game.loop===originalLoop}
    root.removeEventListener?.('error',observe);root.removeEventListener?.('unhandledrejection',observe);
    result.pageErrors=clone(observerErrors);result.durationMs=clock()-started;
    if(result.pageErrors.length||result.errors.length)result.ok=false;
    result.cleanup.nativeExtentAfterCleanup=game?.renderer?[game.renderer.nativeW,game.renderer.nativeH]:null;
    result.cleanup.note='Owned CSS/hook restoration only. Failed probes require outer owned-browser teardown; no automatic retry/reselection or device-loss injection occurs.';
  }
  return result;
}

if(typeof module==='object'&&module.exports)module.exports={sm505LifecycleStable,sm505LifecycleOptions,sm505LifecycleProbe};
