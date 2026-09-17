'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUDevice=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const BACKENDS=Object.freeze({AUTO:'auto',WEBGPU:'webgpu',WEBGL2:'webgl2'});
  const AUTO_WEBGPU_ENABLED=false; // SM-505 is the only task allowed to change this release default.
  const AUTO_POLICY='webgl2-until-sm505';
  const DEFAULT_OPTIONAL_FEATURES=Object.freeze(['timestamp-query']);
  const KNOWN_LIMITS=Object.freeze([
    'maxTextureDimension1D','maxTextureDimension2D','maxTextureDimension3D','maxTextureArrayLayers',
    'maxBindGroups','maxBindGroupsPlusVertexBuffers','maxBindingsPerBindGroup','maxDynamicUniformBuffersPerPipelineLayout',
    'maxDynamicStorageBuffersPerPipelineLayout','maxSampledTexturesPerShaderStage','maxSamplersPerShaderStage',
    'maxStorageBuffersPerShaderStage','maxStorageTexturesPerShaderStage','maxUniformBuffersPerShaderStage',
    'maxUniformBufferBindingSize','maxStorageBufferBindingSize','minUniformBufferOffsetAlignment','minStorageBufferOffsetAlignment',
    'maxVertexBuffers','maxBufferSize','maxVertexAttributes','maxVertexBufferArrayStride','maxInterStageShaderComponents',
    'maxInterStageShaderVariables','maxColorAttachments','maxColorAttachmentBytesPerSample','maxComputeWorkgroupStorageSize',
    'maxComputeInvocationsPerWorkgroup','maxComputeWorkgroupSizeX','maxComputeWorkgroupSizeY','maxComputeWorkgroupSizeZ',
    'maxComputeWorkgroupsPerDimension'
  ]);

  const normalizeBackend=value=>{
    const v=String(value||'').trim().toLowerCase();
    if(v==='webgpu'||v==='gpu')return BACKENDS.WEBGPU;
    if(v==='webgl2'||v==='webgl'||v==='gl')return BACKENDS.WEBGL2;
    return BACKENDS.AUTO;
  };

  function resolveBackendPolicy(requested,autoWebGPUEnabled=AUTO_WEBGPU_ENABLED){
    requested=normalizeBackend(requested);
    if(requested===BACKENDS.AUTO)return {requested,selected:autoWebGPUEnabled?BACKENDS.WEBGPU:BACKENDS.WEBGL2,reason:autoWebGPUEnabled?'auto-webgpu-promoted':AUTO_POLICY};
    return {requested,selected:requested,reason:'explicit-selection'};
  }

  const featureList=features=>Array.from(features||[]).map(String).sort();
  const limitInventory=limits=>{
    const out={};
    for(const key of KNOWN_LIMITS){const value=Number(limits?.[key]);if(Number.isFinite(value))out[key]=value}
    return out;
  };
  const adapterInfo=async adapter=>{
    try{
      const info=adapter?.info||((typeof adapter?.requestAdapterInfo==='function')?await adapter.requestAdapterInfo():null);
      if(!info)return null;
      const out={};for(const key of ['vendor','architecture','device','description','subgroupMinSize','subgroupMaxSize'])if(info[key]!=null&&String(info[key]))out[key]=info[key];
      return out;
    }catch(_error){return null}
  };
  const errorRecord=error=>({name:String(error?.name||'Error'),message:String(error?.message||error||'unknown error')});

  class WebGPUDeviceManager{
    constructor(options={}){
      this.navigatorRef=options.navigatorRef||((typeof navigator!=='undefined')?navigator:null);
      this.desiredFeatures=Array.from(options.desiredFeatures||DEFAULT_OPTIONAL_FEATURES).map(String);
      this.powerPreference=options.powerPreference||'high-performance';
      this.onDeviceLost=typeof options.onDeviceLost==='function'?options.onDeviceLost:null;
      this.onUncapturedError=typeof options.onUncapturedError==='function'?options.onUncapturedError:null;
      this.failureStage=options.failureStage||'';
      this.adapter=null;this.device=null;this.context=null;this.canvas=null;this.format=null;this.configuration=null;
      this.status='idle';this.initializedAt=0;this.features=[];this.requestedFeatures=[];this.limits={};this.info=null;
      this.uncapturedErrors=[];this.loss=null;this.lastError=null;this.configureCount=0;this.resizeCount=0;
      this._generation=0;
    }
    _fail(stage){if(this.failureStage===stage)throw new Error(`deliberate WebGPU ${stage} failure`)}
    async _configure(width,height,dpr=1){
      if(!this.device||!this.context||!this.canvas)throw new Error('WebGPU device/context not ready');
      this._fail('configure');
      const w=Math.max(1,Math.round(Number(width)||this.canvas.width||1)),h=Math.max(1,Math.round(Number(height)||this.canvas.height||1)),scale=Math.max(.1,Number(dpr)||1);
      this.canvas.width=Math.max(1,Math.round(w*scale));this.canvas.height=Math.max(1,Math.round(h*scale));
      const descriptor={device:this.device,format:this.format,alphaMode:'premultiplied'};
      let thrown=null,scoped=null;
      if(typeof this.device.pushErrorScope==='function')this.device.pushErrorScope('validation');
      try{this.context.configure(descriptor)}catch(error){thrown=error}
      if(typeof this.device.popErrorScope==='function'){
        try{scoped=await this.device.popErrorScope()}catch(error){if(!thrown)thrown=error}
      }
      if(thrown)throw thrown;
      if(scoped)throw new Error(`WebGPU validation error during canvas configure: ${scoped.message||scoped}`);
      this.configuration={format:this.format,alphaMode:'premultiplied',width:this.canvas.width,height:this.canvas.height,dpr:scale};this.configureCount++;
      return this.configuration;
    }
    _bindDeviceEvents(device,generation){
      if(typeof device.addEventListener==='function')device.addEventListener('uncapturederror',event=>{
        if(generation!==this._generation)return;const record={at:Date.now(),...errorRecord(event?.error||event)};this.uncapturedErrors.push(record);if(this.uncapturedErrors.length>16)this.uncapturedErrors.splice(0,this.uncapturedErrors.length-16);this.onUncapturedError?.(record);
      });
      Promise.resolve(device.lost).then(info=>{
        if(generation!==this._generation||this.device!==device)return;
        this.status='lost';this.loss={at:Date.now(),reason:String(info?.reason||'unknown'),message:String(info?.message||'')};this.onDeviceLost?.(this.loss);
      }).catch(error=>{
        if(generation!==this._generation||this.device!==device)return;
        this.status='lost';this.loss={at:Date.now(),reason:'lost-promise-rejected',message:String(error?.message||error)};this.onDeviceLost?.(this.loss);
      });
    }
    async initialize(options={}){
      this.close();this._generation++;const generation=this._generation;this.status='initializing';this.lastError=null;this.loss=null;this.uncapturedErrors=[];
      this.canvas=options.canvas||null;const nav=options.navigatorRef||this.navigatorRef,gpu=nav?.gpu;
      try{
        this._fail('navigator');if(!gpu||typeof gpu.requestAdapter!=='function')throw new Error('WebGPU unavailable: navigator.gpu is not exposed');
        this._fail('adapter');const adapter=await gpu.requestAdapter({powerPreference:options.powerPreference||this.powerPreference});if(!adapter)throw new Error('WebGPU unavailable: requestAdapter returned null');this.adapter=adapter;
        this.features=featureList(adapter.features);this.limits=limitInventory(adapter.limits);this.info=await adapterInfo(adapter);
        const desired=Array.from(options.desiredFeatures||this.desiredFeatures).map(String);this.requestedFeatures=desired.filter(name=>adapter.features?.has?.(name));
        this._fail('device');this.device=await adapter.requestDevice({requiredFeatures:this.requestedFeatures});if(!this.device)throw new Error('WebGPU requestDevice returned no device');
        this._bindDeviceEvents(this.device,generation);
        this._fail('context');if(!this.canvas||typeof this.canvas.getContext!=='function')throw new Error('WebGPU canvas is missing');this.context=this.canvas.getContext('webgpu');if(!this.context)throw new Error('WebGPU canvas context unavailable');
        if(typeof gpu.getPreferredCanvasFormat!=='function')throw new Error('WebGPU preferred canvas format API unavailable');this.format=gpu.getPreferredCanvasFormat();
        const width=options.width||this.canvas.width||1,height=options.height||this.canvas.height||1,dpr=options.dpr||1;await this._configure(width,height,dpr);
        this.status='ready';this.initializedAt=Date.now();return this.diagnostics();
      }catch(error){
        this.status='failed';this.lastError=errorRecord(error);const preserved=this.lastError;this._releaseResources(false);this.lastError=preserved;throw error;
      }
    }
    async resize(width,height,dpr=1){if(this.status!=='ready')throw new Error(`cannot resize WebGPU context while status=${this.status}`);this.resizeCount++;return this._configure(width,height,dpr)}
    _releaseResources(incrementGeneration=true){
      if(incrementGeneration)this._generation++;
      try{this.context?.unconfigure?.()}catch(_error){}
      try{this.device?.destroy?.()}catch(_error){}
      this.adapter=null;this.device=null;this.context=null;this.canvas=null;this.format=null;this.configuration=null;
    }
    close(){const hadResources=!!(this.device||this.context||this.adapter);this._releaseResources(true);if(hadResources||this.status!=='idle')this.status='closed'}
    diagnostics(){return {schema:'steelmoth-webgpu-device/v1',status:this.status,available:!!this.navigatorRef?.gpu,initializedAt:this.initializedAt,adapterInfo:this.info,adapterFeatures:[...this.features],adapterLimits:{...this.limits},requestedFeatures:[...this.requestedFeatures],preferredCanvasFormat:this.format,configuration:this.configuration?{...this.configuration}:null,configureCount:this.configureCount,resizeCount:this.resizeCount,deviceLost:this.loss?{...this.loss}:null,uncapturedErrors:this.uncapturedErrors.map(x=>({...x})),lastError:this.lastError?{...this.lastError}:null}}
  }

  return {BACKENDS,AUTO_WEBGPU_ENABLED,AUTO_POLICY,DEFAULT_OPTIONAL_FEATURES,KNOWN_LIMITS,normalizeBackend,resolveBackendPolicy,WebGPUDeviceManager};
});
