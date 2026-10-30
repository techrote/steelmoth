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

  class BackendRuntime{
    constructor(options={}){
      this.root=options.root||root||null;this.documentRef=options.documentRef||this.root?.document||null;this.locationRef=options.locationRef||this.root?.location||null;
      this.storage=options.storage||this.root?.localStorage||null;this.navigatorRef=options.navigatorRef||this.root?.navigator||null;
      this.managerFactory=options.managerFactory||((opts)=>new Device.WebGPUDeviceManager(opts));this.infrastructureFactory=options.infrastructureFactory||((opts)=>new Resources.WebGPUInfrastructure(opts));this.canvasFactory=options.canvasFactory||(()=>this.documentRef?.createElement?.('canvas')||null);
      this.presenterFactory=options.presenterFactory||((opts)=>this.root?.SteelMothWebGPUScenePresenter?.create?.(opts)||null);
      this.requestedBackend=Device.BACKENDS.AUTO;this.activeBackend=Device.BACKENDS.WEBGL2;this.presentationBackend=Device.BACKENDS.WEBGL2;
      this.selectionSource='default';this.policy=Device.resolveBackendPolicy(Device.BACKENDS.AUTO);this.manager=null;this.infrastructure=null;this.presenter=null;this.probeCanvas=null;this.status='idle';this.fallbackReason='';this.lastError=null;this.lastTransitionAt=0;this._generation=0;this._attachedGame=null;this._originalDiagnostics=null;this._controlsInstalled=false;this._readyPromise=null;
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
    _closePresenter(){const p=this.presenter;this.presenter=null;try{p?.close?.()}catch(_error){}if(this.presentationBackend===Device.BACKENDS.WEBGPU)this.presentationBackend=Device.BACKENDS.WEBGL2}
    _closeInfrastructure(){try{this.infrastructure?.close?.()}catch(_error){}this.infrastructure=null}
    _recordError(error){this.lastError={name:String(error?.name||'Error'),message:String(error?.message||error)};this.fallbackReason=this.lastError.message}
    _fallback(error,status='fallback'){
      ++this._generation;this._recordError(error);this._closePresenter();this._closeInfrastructure();try{this.manager?.close?.()}catch(_error){}this.manager=null;this.probeCanvas=null;this.activeBackend=Device.BACKENDS.WEBGL2;this.presentationBackend=Device.BACKENDS.WEBGL2;this._setStatus(status);return this.diagnostics();
    }
    async _activatePresenter(generation=this._generation){
      if(generation!==this._generation||this.activeBackend!==Device.BACKENDS.WEBGPU||this.manager?.status!=='ready'||!this._attachedGame)return false;
      this._closePresenter();const manager=this.manager;
      const presenter=this.presenterFactory({root:this.root,game:this._attachedGame,manager,infrastructure:this.infrastructure,onFailure:(error,source)=>this._presenterFailed(source,error)});
      if(!presenter)throw new Error('SM-505 WebGPU presentation consumer is unavailable');
      await presenter.initialize?.();
      if(generation!==this._generation||manager!==this.manager){try{presenter.close?.()}catch(_error){}return false}
      if(presenter.ready===false)throw new Error('SM-505 WebGPU presentation consumer did not become ready');
      this.presenter=presenter;this.presentationBackend=Device.BACKENDS.WEBGPU;this._setStatus('ready');return true;
    }
    _presenterFailed(source,error){
      if(source&&source!==this.presenter)return;this._fallback(error||new Error('WebGPU presentation consumer failed'),'fallback-runtime');
    }
    async select(mode,options={}){
      const persist=options.persist!==false;mode=Device.normalizeBackend(mode);const generation=++this._generation;
      this._closePresenter();this._closeInfrastructure();try{this.manager?.close?.()}catch(_error){}this.manager=null;this.probeCanvas=null;this.requestedBackend=mode;this.policy=Device.resolveBackendPolicy(mode);this.fallbackReason='';this.lastError=null;if(persist)this._persist(mode);
      if(this.policy.selected===Device.BACKENDS.WEBGL2){this.activeBackend=Device.BACKENDS.WEBGL2;this.presentationBackend=Device.BACKENDS.WEBGL2;this._setStatus('ready');return this.diagnostics()}
      this._setStatus('initializing');
      const manager=this.managerFactory({navigatorRef:this.navigatorRef,failureStage:this._failureStage(),onDeviceLost:info=>this._deviceLost(manager,info),onUncapturedError:record=>this._uncaptured(record)});this.manager=manager;
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
    _deviceLost(manager,info){if(manager!==this.manager)return;this._fallback(new Error(`device-lost:${info?.reason||'unknown'}${info?.message?`: ${info.message}`:''}`),'fallback-device-lost')}
    _uncaptured(record){const error=new Error(String(record?.message||'uncaptured WebGPU error'));if(this.presentationBackend===Device.BACKENDS.WEBGPU)this._fallback(error,'fallback-runtime');else{this.lastError={name:'GPUUncapturedError',message:error.message};this.updateControls()}}
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
    diagnostics(){return {schema:'steelmoth-backend-runtime/v2',requestedBackend:this.requestedBackend,activeBackend:this.activeBackend,presentationBackend:this.presentationBackend,status:this.status,selectionSource:this.selectionSource,policy:clone(this.policy),autoWebGPUEnabled:Device.AUTO_WEBGPU_ENABLED,autoPolicy:Device.AUTO_POLICY,fallbackReason:this.fallbackReason,lastError:this.lastError?{...this.lastError}:null,lastTransitionAt:this.lastTransitionAt,webgpu:this.manager?.diagnostics?.()||null,webgpuInfrastructure:this.infrastructure?.diagnostics?.()||null,webgpuPresenter:this.presenter?.diagnostics?.()||null,note:'SM-505 reports WebGPU presentation only after the normal-game RenderScene consumer owns the presentation canvas. Auto remains WebGL2 pending exact-candidate physical acceptance.'}}
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
