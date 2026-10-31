'use strict';

(function(root,factory){
  const deviceApi=root?.SteelMothWebGPUDevice||((typeof module==='object'&&module.exports)?require('./webgpu_device.js'):null);
  const resourcesApi=root?.SteelMothWebGPUResources||((typeof module==='object'&&module.exports)?require('./webgpu_resources.js'):null);
  const api=factory(deviceApi,resourcesApi,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothBackendRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Device,Resources,root){
  if(!Device)throw new Error('SteelMothWebGPUDevice is required before backend_runtime');
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before backend_runtime');
  const STORAGE_KEY='steelmoth-render-backend-v1';
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const FAILURE_LIMITS=Object.freeze({errors:16,array:32,keys:64,depth:8,nodes:1024,string:512,jsonCharacters:65536});
  const failureString=value=>{try{return String(value??'').slice(0,FAILURE_LIMITS.string)}catch(_error){return '[unreadable]'}};
  const failureRead=(object,key)=>{try{return object?.[key]}catch(_error){return undefined}};
  const failureCount=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
  function failureError(error){return{name:failureString(failureRead(error,'name')||'Error'),message:failureString(failureRead(error,'message')??error)}}
  function failureDiagnostics(object){
    try{if(typeof object?.diagnostics!=='function')return null;return object.diagnostics()}
    catch(error){return{captureError:failureError(error)}}
  }
  function boundedFailureClone(input){
    const seen=new WeakSet();let nodes=0;
    function copy(value,depth=0,key=''){
      if(++nodes>FAILURE_LIMITS.nodes)return '[node-limit]';
      if(value==null)return null;
      if(typeof value==='string')return value.length>FAILURE_LIMITS.string?value.slice(0,FAILURE_LIMITS.string)+'[truncated]':value;
      if(typeof value==='number')return Number.isFinite(value)?value:null;
      if(typeof value==='boolean')return value;
      if(typeof value!=='object')return '[non-json]';
      if(depth>=FAILURE_LIMITS.depth)return '[depth-limit]';
      if(seen.has(value))return '[circular]';
      let proto;try{proto=Object.getPrototypeOf(value)}catch(_error){return '[unreadable-object]'}
      if(!Array.isArray(value)&&proto!==Object.prototype&&proto!==null)return '[opaque-object]';
      seen.add(value);
      if(Array.isArray(value)){
        const limit=key==='uncapturedErrors'?FAILURE_LIMITS.errors:FAILURE_LIMITS.array;
        const out=[];for(let i=0;i<Math.min(value.length,limit);i++)out.push(copy(failureRead(value,i),depth+1));
        if(value.length>limit)out.push({truncatedEntries:value.length-limit});seen.delete(value);return out;
      }
      const out=Object.create(null);let keys;try{keys=Object.keys(value)}catch(_error){return '[unreadable-keys]'}
      for(const name of keys.slice(0,FAILURE_LIMITS.keys))out[name]=copy(failureRead(value,name),depth+1,name);
      if(keys.length>FAILURE_LIMITS.keys)out.truncatedKeys=keys.length-FAILURE_LIMITS.keys;seen.delete(value);return out;
    }
    let result=copy(input),json=JSON.stringify(result);
    if(json.length>FAILURE_LIMITS.jsonCharacters){for(const name of ['manager','presenter','infrastructure','producerResources'])result[name]={omitted:'serialized-snapshot-limit'};json=JSON.stringify(result)}
    if(json.length>FAILURE_LIMITS.jsonCharacters){result={schema:'steelmoth-backend-failure/v1',captureError:'serialized-snapshot-limit',at:input.at,generation:input.generation,trigger:input.trigger,error:input.error};json=JSON.stringify(result)}
    return JSON.parse(json);
  }

  class BackendRuntime{
    constructor(options={}){
      this.root=options.root||root||null;this.documentRef=options.documentRef||this.root?.document||null;this.locationRef=options.locationRef||this.root?.location||null;
      this.storage=options.storage||this.root?.localStorage||null;this.navigatorRef=options.navigatorRef||this.root?.navigator||null;
      this.managerFactory=options.managerFactory||((opts)=>new Device.WebGPUDeviceManager(opts));this.infrastructureFactory=options.infrastructureFactory||((opts)=>new Resources.WebGPUInfrastructure(opts));this.canvasFactory=options.canvasFactory||(()=>this.documentRef?.createElement?.('canvas')||null);
      this.presenterFactory=options.presenterFactory||((opts)=>this.root?.SteelMothWebGPUScenePresenter?.create?.(opts)||null);
      this.requestedBackend=Device.BACKENDS.AUTO;this.activeBackend=Device.BACKENDS.WEBGL2;this.presentationBackend=Device.BACKENDS.WEBGL2;
      this.selectionSource='default';this.policy=Device.resolveBackendPolicy(Device.BACKENDS.AUTO);this.manager=null;this.infrastructure=null;this.presenter=null;this._pendingPresenter=null;this.probeCanvas=null;this.status='idle';this.fallbackReason='';this.lastError=null;this.lastTransitionAt=0;this._generation=0;this._attachedGame=null;this._originalDiagnostics=null;this._controlsInstalled=false;this._readyPromise=null;
      this._firstFailureSnapshot=null;this._lastFailureSnapshot=null;this._failureSnapshotCount=0;
    }
    _query(){try{return new URLSearchParams(this.locationRef?.search||'')}catch(_error){return new URLSearchParams()}}
    initialSelection(){
      const q=this._query(),fromQuery=q.get('rendererBackend')||q.get('backend');if(fromQuery){this.selectionSource='query';return Device.normalizeBackend(fromQuery)}
      try{const stored=this.storage?.getItem?.(STORAGE_KEY);if(stored){this.selectionSource='storage';return Device.normalizeBackend(stored)}}catch(_error){}
      this.selectionSource='default';return Device.BACKENDS.AUTO;
    }
    _failureStage(){const q=this._query(),renderTest=/^(1|true|yes|on)$/i.test(q.get('renderTest')||q.get('render_test')||''),dev=/^(1|true|yes|on)$/i.test(q.get('devWebGPU')||''),local=['localhost','127.0.0.1'].includes(this.locationRef?.hostname||'');return (renderTest||dev||local)?String(q.get('webgpuFail')||''):''}
    _persist(mode){try{this.storage?.setItem?.(STORAGE_KEY,mode)}catch(_error){}}
    _setStatus(status){this.status=status;this.lastTransitionAt=Date.now();this.updateControls()}
    _closePresenter(){const owned=new Set([this.presenter,this._pendingPresenter]);this.presenter=null;this._pendingPresenter=null;for(const p of owned)try{p?.close?.()}catch(_error){}if(this.presentationBackend===Device.BACKENDS.WEBGPU)this.presentationBackend=Device.BACKENDS.WEBGL2}
    _closeInfrastructure(){try{this.infrastructure?.close?.()}catch(_error){}this.infrastructure=null}
    _recordError(error){this.lastError={name:String(error?.name||'Error'),message:String(error?.message||error)};this.fallbackReason=this.lastError.message}
    _captureFailure(error,trigger,details=null){
      // Read-only, synchronous evidence before runtime teardown; never submit,
      // map, wait, or retain a producer/GPU handle in diagnostic history.
      let snapshot;const sequence=++this._failureSnapshotCount;
      try{
        const p=this.presenter||this._pendingPresenter,game=this._attachedGame,renderer=game?.renderer,canvas=p?.canvas;
        let canvasCount=null;try{const nodes=this.documentRef?.querySelectorAll?.('#webgpuPresentation');if(nodes)canvasCount=nodes.length}catch(_error){}
        const resources={},shared=new Map();
        for(const name of ['gb','depth','shadows','lighting','occ','clusters','dominance','dso','dsoHierarchy','bloom','bloomTemporal','visibility','water','foliage','post']){
          const producer=failureRead(p,name);if(!producer)continue;const state={};
          for(const kind of ['registry','pipelines','pipelineCache']){
            const resource=failureRead(producer,kind);if(!resource)continue;
            if(shared.has(resource))state[kind]={sharedWith:shared.get(resource)};
            else{shared.set(resource,name+'.'+kind);state[kind]=failureDiagnostics(resource)}
          }
          resources[name]=state;
        }
        const scene=failureRead(game,'renderScene'),frame=failureRead(scene,'frame');
        snapshot={schema:'steelmoth-backend-failure/v1',sequence,at:Date.now(),generation:this._generation,trigger:failureString(trigger),error:failureError(error),details,
          requestedBackend:this.requestedBackend,activeBackend:this.activeBackend,presentationBackend:this.presentationBackend,statusBeforeFallback:this.status,selectionSource:this.selectionSource,
          sourceExtent:{nativeWidth:failureCount(failureRead(renderer,'nativeW')),nativeHeight:failureCount(failureRead(renderer,'nativeH')),logicalSize:failureRead(frame,'logicalSize'),sceneSequence:failureCount(failureRead(frame,'sequence')),roomId:failureRead(frame,'roomId')},
          surface:{id:failureRead(canvas,'id')??null,count:canvasCount,width:failureCount(failureRead(canvas,'width')),height:failureCount(failureRead(canvas,'height')),presenterWidth:failureCount(failureRead(p,'width')),presenterHeight:failureCount(failureRead(p,'height'))},
          frames:{presented:failureCount(failureRead(p,'presentedFrames')),submitted:failureCount(failureRead(p,'submittedFrames')),completed:failureCount(failureRead(p,'completedFrames')),dropped:failureCount(failureRead(p,'droppedFrames')),rendering:typeof p?.rendering==='boolean'?p.rendering:null,pending:p?!!p.pending:null,inFlight:failureCount(failureRead(p,'inFlightFrames')),note:'Counters are copied only when exposed. Legacy presentedFrames counts CPU queue submissions, not proven GPU completion; unknown completion/in-flight values remain null.'},
          nativeUnits:failureRead(p,'nativeUnits'),opaqueVisibilityPlan:failureRead(p,'lastOpaqueVisibilityPlan'),manager:failureDiagnostics(this.manager),presenter:failureDiagnostics(p),infrastructure:failureDiagnostics(this.infrastructure),producerResources:resources,
          limits:FAILURE_LIMITS,boundary:'First/last failure evidence only; no cause, GPU time, completed frame, visual approval or recovery success is inferred.'};
        snapshot=boundedFailureClone(snapshot);
      }catch(captureError){snapshot={schema:'steelmoth-backend-failure/v1',sequence,at:Date.now(),generation:this._generation,trigger:failureString(trigger),error:failureError(error),captureError:failureError(captureError)}}
      if(!this._firstFailureSnapshot)this._firstFailureSnapshot=snapshot;this._lastFailureSnapshot=snapshot;return snapshot;
    }
    _fallback(error,status='fallback',details=null){
      this._captureFailure(error,status,details);++this._generation;this._recordError(error);this._closePresenter();this._closeInfrastructure();try{this.manager?.close?.()}catch(_error){}this.manager=null;this.probeCanvas=null;this.activeBackend=Device.BACKENDS.WEBGL2;this.presentationBackend=Device.BACKENDS.WEBGL2;this._setStatus(status);return this.diagnostics();
    }
    async _activatePresenter(generation=this._generation){
      if(generation!==this._generation||this.activeBackend!==Device.BACKENDS.WEBGPU||this.manager?.status!=='ready'||!this._attachedGame)return false;
      this._closePresenter();const manager=this.manager;
      const presenter=this.presenterFactory({root:this.root,game:this._attachedGame,manager,infrastructure:this.infrastructure,onFailure:(error,source)=>this._presenterFailed(source,error)});
      if(!presenter)throw new Error('SM-505 WebGPU presentation consumer is unavailable');
      // Own partial initialization so switching/fallback can retire its canvas and resources.
      // Readiness and presentation ownership remain separate until initialization succeeds.
      this._pendingPresenter=presenter;
      try{
        await presenter.initialize?.();
        if(generation!==this._generation||manager!==this.manager||this._pendingPresenter!==presenter){try{presenter.close?.()}catch(_error){}return false}
        if(presenter.ready===false)throw new Error('SM-505 WebGPU presentation consumer did not become ready');
        this._pendingPresenter=null;this.presenter=presenter;this.presentationBackend=Device.BACKENDS.WEBGPU;this._setStatus('ready');return true;
      }catch(error){
        const current=generation===this._generation&&manager===this.manager&&this._pendingPresenter===presenter;
        if(current)this._captureFailure(error,'presenter-initialization-before-close');
        if(this._pendingPresenter===presenter)this._pendingPresenter=null;
        try{presenter.close?.()}catch(_error){}if(!current)return false;throw error;
      }
    }
    _presenterFailed(source,error){
      if(source&&source!==this.presenter&&source!==this._pendingPresenter)return;this._fallback(error||new Error('WebGPU presentation consumer failed'),'fallback-runtime');
    }
    async select(mode,options={}){
      const persist=options.persist!==false;mode=Device.normalizeBackend(mode);const generation=++this._generation;
      this._closePresenter();this._closeInfrastructure();try{this.manager?.close?.()}catch(_error){}this.manager=null;this.probeCanvas=null;this.requestedBackend=mode;this.policy=Device.resolveBackendPolicy(mode);this.fallbackReason='';this.lastError=null;if(persist)this._persist(mode);
      if(this.policy.selected===Device.BACKENDS.WEBGL2){this.activeBackend=Device.BACKENDS.WEBGL2;this.presentationBackend=Device.BACKENDS.WEBGL2;this._setStatus('ready');return this.diagnostics()}
      this._setStatus('initializing');
      const manager=this.managerFactory({navigatorRef:this.navigatorRef,failureStage:this._failureStage(),onDeviceLost:info=>this._deviceLost(manager,info),onUncapturedError:record=>this._uncaptured(record,manager)});this.manager=manager;
      const canvas=this.canvasFactory();this.probeCanvas=canvas;if(canvas){canvas.width=2;canvas.height=2;if(canvas.style)canvas.style.display='none'}
      try{
        await manager.initialize({canvas,width:2,height:2,dpr:1});if(generation!==this._generation){manager.close?.();return this.diagnostics()}
        const cfg=manager.configuration||{width:2,height:2};this.infrastructure=this.infrastructureFactory({device:manager.device,queue:manager.device?.queue,width:cfg.width||2,height:cfg.height||2,dynamicUploadBytes:1024*1024,labelPrefix:'SteelMoth'});
        this.activeBackend=Device.BACKENDS.WEBGPU;this.presentationBackend=Device.BACKENDS.WEBGL2;this._setStatus('ready-platform');
        if(this._attachedGame)await this._activatePresenter(generation);
        return this.diagnostics();
      }catch(error){
        if(generation!==this._generation)return this.diagnostics();return this._fallback(error,'fallback');
      }
    }
    _deviceLost(manager,info){if(manager!==this.manager)return;this._fallback(new Error(`device-lost:${info?.reason||'unknown'}${info?.message?`: ${info.message}`:''}`),'fallback-device-lost',{deviceLoss:info})}
    _uncaptured(record,manager=this.manager){if(manager!==this.manager)return;const error=new Error(String(record?.message||'uncaptured WebGPU error'));if(this.presentationBackend===Device.BACKENDS.WEBGPU||this._pendingPresenter)this._fallback(error,'fallback-runtime',{uncapturedError:record});else{this._captureFailure(error,'uncaptured-error',{uncapturedError:record});this.lastError={name:'GPUUncapturedError',message:error.message};this.updateControls()}}
    async resizeProbe(width,height,dpr=1){if(this.activeBackend!==Device.BACKENDS.WEBGPU||this.manager?.status!=='ready')return null;const config=await this.manager.resize(width,height,dpr);const rebuilt=this.infrastructure?.resize?.(config.width,config.height)||false;return {...config,infrastructureResized:!!rebuilt}}
    consumeScene(scene){
      if(this.presentationBackend!==Device.BACKENDS.WEBGPU||!this.presenter?.ready)return false;
      try{const consumed=this.presenter.consume?.(scene);if(consumed!==true)throw new Error('SM-505 WebGPU presenter rejected a normal-game RenderScene');return true}
      catch(error){this._presenterFailed(this.presenter,error);return false}
    }
    attachGame(game){
      if(!game||game===this._attachedGame)return game;this._attachedGame=game;game.backendRuntime=this;
      if(typeof game.diagnostics==='function'&&!game.__smBackendDiagnosticsWrapped){const runtime=this,original=game.diagnostics.bind(game);this._originalDiagnostics=original;game.diagnostics=function(){const base=original();base.backend=runtime.diagnostics();return base};game.__smBackendDiagnosticsWrapped=true}
      if(this.activeBackend===Device.BACKENDS.WEBGPU&&this.manager?.status==='ready'&&this.presentationBackend!==Device.BACKENDS.WEBGPU){const generation=this._generation;this._activatePresenter(generation).catch(error=>{if(generation===this._generation)this._fallback(error,'fallback')})}
      return game;
    }
    installControls(){
      if(this._controlsInstalled||!this.documentRef)return;const grid=this.documentRef.querySelector?.('#graphicsMenu .settingsGrid');if(!grid)return;
      const section=this.documentRef.createElement('section');section.id='backendSettings';section.innerHTML='<h3>RENDER BACKEND</h3><label>Migration backend <select id="backendSelect"><option value="auto">Auto</option><option value="webgpu">WebGPU (release candidate)</option><option value="webgl2">WebGL2</option></select></label><div class="settingsNote" id="backendStatus"></div>';
      grid.insertBefore(section,grid.firstChild);const select=section.querySelector('#backendSelect');if(select){select.value=this.requestedBackend;select.addEventListener('change',()=>{this.selectionSource='ui';this.select(select.value,{persist:true})})}
      this._controlsInstalled=true;this.updateControls();
    }
    updateControls(){
      if(!this.documentRef)return;const select=this.documentRef.querySelector?.('#backendSelect'),status=this.documentRef.querySelector?.('#backendStatus');if(select&&select.value!==this.requestedBackend)select.value=this.requestedBackend;
      if(status){const auto=this.requestedBackend===Device.BACKENDS.AUTO?'Auto remains WebGL2 until the SM-505 physical release gate. ':'';const candidate=this.presentationBackend===Device.BACKENDS.WEBGPU?'WebGPU is consuming and presenting normal RenderScene frames. ':(this.activeBackend===Device.BACKENDS.WEBGPU?'WebGPU platform is ready; presentation is not yet owned by WebGPU. ':'');const fallback=this.fallbackReason?`Fallback: ${this.fallbackReason}. `:'';status.textContent=`${auto}${candidate}${fallback}requested=${this.requestedBackend} · active=${this.activeBackend} · presentation=${this.presentationBackend}`}
    }
    diagnostics(){return {schema:'steelmoth-backend-runtime/v2',requestedBackend:this.requestedBackend,activeBackend:this.activeBackend,presentationBackend:this.presentationBackend,status:this.status,selectionSource:this.selectionSource,policy:clone(this.policy),autoWebGPUEnabled:Device.AUTO_WEBGPU_ENABLED,autoPolicy:Device.AUTO_POLICY,fallbackReason:this.fallbackReason,lastError:this.lastError?{...this.lastError}:null,lastTransitionAt:this.lastTransitionAt,webgpu:this.manager?.diagnostics?.()||null,webgpuInfrastructure:this.infrastructure?.diagnostics?.()||null,webgpuPresenter:this.presenter?.diagnostics?.()||null,firstFailure:clone(this._firstFailureSnapshot),lastFailure:clone(this._lastFailureSnapshot),failureSnapshotCount:this._failureSnapshotCount,note:'SM-505 reports WebGPU presentation only after the normal-game RenderScene consumer owns the presentation canvas. Auto remains WebGL2 pending exact-candidate physical acceptance.'}}
    async start(){if(this._readyPromise)return this._readyPromise;const mode=this.initialSelection(),persist=this.selectionSource!=='query';this._readyPromise=this.select(mode,{persist}).then(result=>{this.installControls();return result});return this._readyPromise}
    close(){this._generation++;this._closePresenter();this._closeInfrastructure();try{this.manager?.close?.()}catch(_error){}this.manager=null;this.probeCanvas=null;this.activeBackend=Device.BACKENDS.WEBGL2;this.presentationBackend=Device.BACKENDS.WEBGL2;this._setStatus('closed')}
  }

  function install(target=root,options={}){
    if(!target)return null;if(target.steelMothBackendRuntime instanceof BackendRuntime)return target.steelMothBackendRuntime;
    const runtime=new BackendRuntime({...options,root:target});target.steelMothBackendRuntime=runtime;target.steelMothBackendReady=runtime.start();
    const attach=()=>{if(target.game)runtime.attachGame(target.game);runtime.installControls()};attach();
    if(!target.game&&typeof target.setInterval==='function'){let n=0;const timer=target.setInterval(()=>{attach();if(target.game||++n>600)target.clearInterval(timer)},16)}
    return runtime;
  }

  const api={STORAGE_KEY,BackendRuntime,install};
  return api;
});
