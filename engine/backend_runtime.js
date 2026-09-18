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
      this.requestedBackend=Device.BACKENDS.AUTO;this.activeBackend=Device.BACKENDS.WEBGL2;this.presentationBackend=Device.BACKENDS.WEBGL2;
      this.selectionSource='default';this.policy=Device.resolveBackendPolicy(Device.BACKENDS.AUTO);this.manager=null;this.infrastructure=null;this.probeCanvas=null;this.status='idle';this.fallbackReason='';this.lastError=null;this.lastTransitionAt=0;this._generation=0;this._attachedGame=null;this._originalDiagnostics=null;this._controlsInstalled=false;this._readyPromise=null;
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
    _closeInfrastructure(){try{this.infrastructure?.close?.()}catch(_error){}this.infrastructure=null}
    async select(mode,options={}){
      const persist=options.persist!==false;mode=Device.normalizeBackend(mode);const generation=++this._generation;
      this._closeInfrastructure();this.manager?.close?.();this.manager=null;this.probeCanvas=null;this.requestedBackend=mode;this.policy=Device.resolveBackendPolicy(mode);this.fallbackReason='';this.lastError=null;if(persist)this._persist(mode);
      if(this.policy.selected===Device.BACKENDS.WEBGL2){this.activeBackend=Device.BACKENDS.WEBGL2;this.presentationBackend=Device.BACKENDS.WEBGL2;this._setStatus('ready');return this.diagnostics()}
      this._setStatus('initializing');
      const manager=this.managerFactory({navigatorRef:this.navigatorRef,failureStage:this._failureStage(),onDeviceLost:info=>this._deviceLost(manager,info),onUncapturedError:record=>this._uncaptured(record)});this.manager=manager;
      const canvas=this.canvasFactory();this.probeCanvas=canvas;if(canvas){canvas.width=2;canvas.height=2;if(canvas.style)canvas.style.display='none'}
      try{
        await manager.initialize({canvas,width:2,height:2,dpr:1});if(generation!==this._generation){manager.close?.();return this.diagnostics()}
        const cfg=manager.configuration||{width:2,height:2};this.infrastructure=this.infrastructureFactory({device:manager.device,queue:manager.device?.queue,width:cfg.width||2,height:cfg.height||2,dynamicUploadBytes:1024*1024,labelPrefix:'SteelMoth'});
        this.activeBackend=Device.BACKENDS.WEBGPU;this.presentationBackend=Device.BACKENDS.WEBGL2;this._setStatus('ready-platform');return this.diagnostics();
      }catch(error){
        if(generation!==this._generation)return this.diagnostics();this._closeInfrastructure();this.lastError={name:String(error?.name||'Error'),message:String(error?.message||error)};this.fallbackReason=this.lastError.message;this.activeBackend=Device.BACKENDS.WEBGL2;this.presentationBackend=Device.BACKENDS.WEBGL2;this._setStatus('fallback');return this.diagnostics();
      }
    }
    _deviceLost(manager,info){if(manager!==this.manager)return;this._closeInfrastructure();this.fallbackReason=`device-lost:${info?.reason||'unknown'}${info?.message?`: ${info.message}`:''}`;this.activeBackend=Device.BACKENDS.WEBGL2;this.presentationBackend=Device.BACKENDS.WEBGL2;this._setStatus('fallback-device-lost')}
    _uncaptured(record){this.lastError={name:'GPUUncapturedError',message:String(record?.message||'uncaptured WebGPU error')};this.updateControls()}
    async resizeProbe(width,height,dpr=1){if(this.activeBackend!==Device.BACKENDS.WEBGPU||this.manager?.status!=='ready')return null;const config=await this.manager.resize(width,height,dpr);const rebuilt=this.infrastructure?.resize?.(config.width,config.height)||false;return {...config,infrastructureResized:!!rebuilt}}
    attachGame(game){
      if(!game||game===this._attachedGame)return game;this._attachedGame=game;game.backendRuntime=this;
      if(typeof game.diagnostics==='function'&&!game.__smBackendDiagnosticsWrapped){const runtime=this,original=game.diagnostics.bind(game);this._originalDiagnostics=original;game.diagnostics=function(){const base=original();base.backend=runtime.diagnostics();return base};game.__smBackendDiagnosticsWrapped=true}
      return game;
    }
    installControls(){
      if(this._controlsInstalled||!this.documentRef)return;const grid=this.documentRef.querySelector?.('#graphicsMenu .settingsGrid');if(!grid)return;
      const section=this.documentRef.createElement('section');section.id='backendSettings';section.innerHTML='<h3>RENDER BACKEND</h3><label>Migration backend <select id="backendSelect"><option value="auto">Auto</option><option value="webgpu">WebGPU (device test)</option><option value="webgl2">WebGL2</option></select></label><div class="settingsNote" id="backendStatus"></div>';
      grid.insertBefore(section,grid.firstChild);const select=section.querySelector('#backendSelect');if(select){select.value=this.requestedBackend;select.addEventListener('change',()=>{this.selectionSource='ui';this.select(select.value,{persist:true})})}
      this._controlsInstalled=true;this.updateControls();
    }
    updateControls(){
      if(!this.documentRef)return;const select=this.documentRef.querySelector?.('#backendSelect'),status=this.documentRef.querySelector?.('#backendStatus');if(select&&select.value!==this.requestedBackend)select.value=this.requestedBackend;
      if(status){const auto=this.requestedBackend===Device.BACKENDS.AUTO?'Auto is gated to WebGL2 until SM-505. ':'';const compat=this.activeBackend===Device.BACKENDS.WEBGPU?'WebGPU device/context and persistent resource infrastructure ready; frame presentation remains WebGL2 compatibility during migration. ':'';const fallback=this.fallbackReason?`Fallback: ${this.fallbackReason}. `:'';status.textContent=`${auto}${compat}${fallback}requested=${this.requestedBackend} · active=${this.activeBackend} · presentation=${this.presentationBackend}`}
    }
    diagnostics(){return {schema:'steelmoth-backend-runtime/v1',requestedBackend:this.requestedBackend,activeBackend:this.activeBackend,presentationBackend:this.presentationBackend,status:this.status,selectionSource:this.selectionSource,policy:clone(this.policy),autoWebGPUEnabled:Device.AUTO_WEBGPU_ENABLED,autoPolicy:Device.AUTO_POLICY,fallbackReason:this.fallbackReason,lastError:this.lastError?{...this.lastError}:null,lastTransitionAt:this.lastTransitionAt,webgpu:this.manager?.diagnostics?.()||null,webgpuInfrastructure:this.infrastructure?.diagnostics?.()||null,note:'SM-103 initializes persistent WebGPU resource/frame infrastructure only; rendering remains WebGL2 compatibility until later WebGPU rendering tasks.'}}
    async start(){if(this._readyPromise)return this._readyPromise;const mode=this.initialSelection(),persist=this.selectionSource!=='query';this._readyPromise=this.select(mode,{persist}).then(result=>{this.installControls();return result});return this._readyPromise}
    close(){this._generation++;this._closeInfrastructure();this.manager?.close?.();this.manager=null;this.probeCanvas=null;this._setStatus('closed')}
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
