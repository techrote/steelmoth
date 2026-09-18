'use strict';

(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUResources=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  const BUFFER_USAGE=Object.freeze({COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,COPY_DST:0x02,TEXTURE_BINDING:0x04,STORAGE_BINDING:0x08,RENDER_ATTACHMENT:0x10});
  const FORMAT_BYTES=Object.freeze({
    r8unorm:1,r8snorm:1,r8uint:1,r8sint:1,
    rg8unorm:2,rg8snorm:2,rg8uint:2,rg8sint:2,r16uint:2,r16sint:2,r16float:2,depth16unorm:2,
    rgba8unorm:4,'rgba8unorm-srgb':4,bgra8unorm:4,'bgra8unorm-srgb':4,rgb10a2unorm:4,rg11b10ufloat:4,
    rg16uint:4,rg16sint:4,rg16float:4,r32uint:4,r32sint:4,r32float:4,depth24plus:4,'depth24plus-stencil8':4,depth32float:4,
    rgba16uint:8,rgba16sint:8,rgba16float:8,rg32uint:8,rg32sint:8,rg32float:8,
    rgba32uint:16,rgba32sint:16,rgba32float:16
  });
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const align=(value,multiple=4)=>Math.ceil(Math.max(0,Number(value)||0)/multiple)*multiple;
  const nextPow2=value=>{let n=1,v=Math.max(1,Math.ceil(Number(value)||1));while(n<v)n*=2;return n};
  const dataBytes=data=>{
    if(data instanceof ArrayBuffer)return new Uint8Array(data);
    if(ArrayBuffer.isView(data))return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    throw new TypeError('upload data must be an ArrayBuffer or ArrayBufferView');
  };
  const bytesPerPixel=format=>FORMAT_BYTES[String(format)]||0;
  const estimateTextureBytes=descriptor=>{
    const size=descriptor?.size||{},width=Math.max(1,Number(size.width??size[0]??1)||1),height=Math.max(1,Number(size.height??size[1]??1)||1),depth=Math.max(1,Number(size.depthOrArrayLayers??size[2]??1)||1),mips=Math.max(1,Number(descriptor?.mipLevelCount)||1),samples=Math.max(1,Number(descriptor?.sampleCount)||1),bpp=bytesPerPixel(descriptor?.format);
    if(!bpp)return 0;
    let pixels=0,w=width,h=height,d=depth;for(let i=0;i<mips;i++){pixels+=Math.max(1,w)*Math.max(1,h)*Math.max(1,d);w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));d=descriptor?.dimension==='3d'?Math.max(1,Math.floor(d/2)):d}
    return Math.round(pixels*bpp*samples);
  };
  const usageValue=(group,name,fallback)=>Number(root?.[group]?.[name]??fallback);

  class ResourceRegistry{
    constructor(options={}){
      if(!options.device)throw new Error('ResourceRegistry requires a GPUDevice');
      this.device=options.device;this.queue=options.queue||options.device.queue||null;
      this.labelPrefix=options.labelPrefix||'SteelMoth';this.width=Math.max(1,Math.round(options.width||1));this.height=Math.max(1,Math.round(options.height||1));this.defaultDynamicUploadBytes=Math.max(256,align(options.dynamicUploadBytes||1024*1024,256));
      this.definitions=new Map();this.resources=new Map();this.dynamicArenas=new Map();this.frameIndex=0;this.generation=1;this.resizeCount=0;this.rebuildCount=0;this.createCount=0;this.destroyCount=0;this.staticUploadCount=0;this.staticUploadBytes=0;this.dynamicUploadCount=0;this.dynamicUploadBytes=0;
    }
    _label(name){return `${this.labelPrefix}:${name}`}
    _destroyRecord(record){if(!record)return;try{record.handle?.destroy?.()}catch(_error){}this.destroyCount++}
    _replaceRecord(name,record){const old=this.resources.get(name);if(old)this._destroyRecord(old);record.createCount=(old?.createCount||0)+1;record.rebuildCount=(old?.rebuildCount||0)+(old?1:0);record.generation=this.generation;this.resources.set(name,record);this.createCount++;if(old)this.rebuildCount++;return record}
    _resolveTextureDescriptor(def){
      const source=def.descriptor,sizeSpec=def.sizeSpec;let width,height,depthOrArrayLayers=Math.max(1,Number(source.depthOrArrayLayers||1));
      if(sizeSpec==='surface'){width=Math.max(1,Math.round(this.width*def.scale));height=Math.max(1,Math.round(this.height*def.scale))}
      else{width=Math.max(1,Math.round(Number(sizeSpec?.width??sizeSpec?.[0]??source.width??1)));height=Math.max(1,Math.round(Number(sizeSpec?.height??sizeSpec?.[1]??source.height??1)));depthOrArrayLayers=Math.max(1,Math.round(Number(sizeSpec?.depthOrArrayLayers??sizeSpec?.[2]??depthOrArrayLayers)))}
      return {label:this._label(def.name),size:{width,height,depthOrArrayLayers},mipLevelCount:source.mipLevelCount||1,sampleCount:source.sampleCount||1,dimension:source.dimension||'2d',format:source.format,usage:source.usage,viewFormats:Array.isArray(source.viewFormats)?[...source.viewFormats]:[]};
    }
    _buildDefinition(def){
      if(def.kind==='texture'){
        const descriptor=this._resolveTextureDescriptor(def),handle=this.device.createTexture(descriptor),bytes=estimateTextureBytes(descriptor);
        return this._replaceRecord(def.name,{name:def.name,kind:'texture',lifetime:def.lifetime,resizeDependent:def.resizeDependent,descriptor,handle,width:descriptor.size.width,height:descriptor.size.height,depthOrArrayLayers:descriptor.size.depthOrArrayLayers,format:descriptor.format,usage:descriptor.usage,estimatedBytes:bytes});
      }
      const descriptor={label:this._label(def.name),size:align(def.size,4),usage:def.usage,mappedAtCreation:!!def.mappedAtCreation},handle=this.device.createBuffer(descriptor);
      return this._replaceRecord(def.name,{name:def.name,kind:'buffer',lifetime:def.lifetime,resizeDependent:false,descriptor,handle,size:descriptor.size,usage:descriptor.usage,estimatedBytes:descriptor.size});
    }
    defineTexture(name,options={}){
      name=String(name);if(!name)throw new Error('texture name is required');if(!options.format)throw new Error(`texture ${name} requires format`);if(!Number(options.usage))throw new Error(`texture ${name} requires usage`);
      const sizeSpec=options.size||'surface',def={name,kind:'texture',lifetime:options.lifetime||'persistent',resizeDependent:options.resizeDependent??(sizeSpec==='surface'),scale:Math.max(.01,Number(options.scale)||1),sizeSpec,descriptor:{format:String(options.format),usage:Number(options.usage),mipLevelCount:options.mipLevelCount||1,sampleCount:options.sampleCount||1,dimension:options.dimension||'2d',depthOrArrayLayers:options.depthOrArrayLayers||1,viewFormats:options.viewFormats||[]}};
      if(this.definitions.has(name))throw new Error(`resource already defined: ${name}`);this.definitions.set(name,def);return this._buildDefinition(def);
    }
    defineBuffer(name,options={}){
      name=String(name);if(!name)throw new Error('buffer name is required');const size=align(options.size,4);if(size<4)throw new Error(`buffer ${name} requires size >= 4`);if(!Number(options.usage))throw new Error(`buffer ${name} requires usage`);
      const def={name,kind:'buffer',lifetime:options.lifetime||'persistent',size,usage:Number(options.usage),mappedAtCreation:!!options.mappedAtCreation};if(this.definitions.has(name))throw new Error(`resource already defined: ${name}`);this.definitions.set(name,def);return this._buildDefinition(def);
    }
    get(name){return this.resources.get(String(name))||null}
    require(name){const record=this.get(name);if(!record)throw new Error(`resource not found: ${name}`);return record}
    _ensureUploadBuffer(name,required,options,kind){
      const maxBytes=Math.max(4,Number(options.maxBytes)||Math.max(required,kind==='dynamic'?this.defaultDynamicUploadBytes:required));if(required>maxBytes)throw new RangeError(`${kind} upload ${name} exceeds maxBytes ${maxBytes}`);
      let def=this.definitions.get(name),record=this.resources.get(name);const usage=(Number(options.usage)||0)|usageValue('GPUBufferUsage','COPY_DST',BUFFER_USAGE.COPY_DST);
      if(def&&def.kind!=='buffer')throw new Error(`upload resource is not a buffer: ${name}`);
      if(!def){const capacity=kind==='dynamic'?align(maxBytes,256):align(Math.min(maxBytes,nextPow2(required)),4);def={name,kind:'buffer',lifetime:'persistent',size:capacity,usage,mappedAtCreation:false};this.definitions.set(name,def);record=this._buildDefinition(def)}
      else if(def.size<required){const grown=Math.min(maxBytes,kind==='dynamic'?align(maxBytes,256):align(nextPow2(required),4));if(grown<required)throw new RangeError(`${kind} upload ${name} cannot grow within maxBytes ${maxBytes}`);def.size=grown;def.usage|=usage;record=this._buildDefinition(def)}
      return record;
    }
    uploadStatic(name,data,options={}){
      const bytes=dataBytes(data),record=this._ensureUploadBuffer(String(name),bytes.byteLength,options,'static');if(!this.queue?.writeBuffer)throw new Error('static upload requires GPUQueue.writeBuffer');this.queue.writeBuffer(record.handle,0,bytes);this.staticUploadCount++;this.staticUploadBytes+=bytes.byteLength;return {buffer:record.handle,offset:0,size:bytes.byteLength,capacity:record.size,name:record.name};
    }
    ensureDynamicArena(name,options={}){
      name=String(name);let arena=this.dynamicArenas.get(name);if(arena)return arena;const capacity=Math.max(256,align(options.capacity||options.maxBytes||this.defaultDynamicUploadBytes,256)),resourceName=`dynamic:${name}`,record=this._ensureUploadBuffer(resourceName,4,{usage:options.usage,maxBytes:capacity},'dynamic');
      if(record.size!==capacity){const def=this.definitions.get(resourceName);def.size=capacity;this._buildDefinition(def)}
      arena={name,resourceName,capacity,usage:Number(options.usage)||0,alignment:Math.max(4,align(options.alignment||256,4)),cursor:0,peakBytes:0,uploads:0};this.dynamicArenas.set(name,arena);return arena;
    }
    uploadDynamic(name,data,options={}){
      const bytes=dataBytes(data),arena=this.dynamicArenas.get(String(name))||this.ensureDynamicArena(name,options),offset=align(arena.cursor,options.alignment||arena.alignment),end=offset+bytes.byteLength;if(end>arena.capacity)throw new RangeError(`dynamic upload arena ${name} exhausted: ${end} > ${arena.capacity}`);
      const record=this.require(arena.resourceName);if(!this.queue?.writeBuffer)throw new Error('dynamic upload requires GPUQueue.writeBuffer');this.queue.writeBuffer(record.handle,offset,bytes);arena.cursor=end;arena.peakBytes=Math.max(arena.peakBytes,end);arena.uploads++;this.dynamicUploadCount++;this.dynamicUploadBytes+=bytes.byteLength;return {buffer:record.handle,offset,size:bytes.byteLength,capacity:arena.capacity,name:record.name};
    }
    beginFrame(){this.frameIndex++;for(const arena of this.dynamicArenas.values()){arena.cursor=0;arena.uploads=0}return this.frameIndex}
    resize(width,height){
      width=Math.max(1,Math.round(width||1));height=Math.max(1,Math.round(height||1));if(width===this.width&&height===this.height)return false;this.width=width;this.height=height;this.resizeCount++;for(const def of this.definitions.values())if(def.kind==='texture'&&def.resizeDependent)this._buildDefinition(def);return true;
    }
    resetDevice(device,queue=device?.queue){
      if(!device)throw new Error('resetDevice requires GPUDevice');this.device=device;this.queue=queue||null;this.generation++;for(const def of this.definitions.values())this._buildDefinition(def);return this.generation;
    }
    close(){for(const record of this.resources.values())this._destroyRecord(record);this.resources.clear();this.dynamicArenas.clear()}
    diagnostics(){
      const resources=Array.from(this.resources.values()).map(r=>({name:r.name,kind:r.kind,lifetime:r.lifetime,resizeDependent:!!r.resizeDependent,width:r.width||null,height:r.height||null,depthOrArrayLayers:r.depthOrArrayLayers||null,format:r.format||null,size:r.size||null,usage:r.usage,estimatedBytes:r.estimatedBytes,createCount:r.createCount,rebuildCount:r.rebuildCount,generation:r.generation})).sort((a,b)=>a.name.localeCompare(b.name));
      const arenas=Array.from(this.dynamicArenas.values()).map(a=>({name:a.name,capacity:a.capacity,alignment:a.alignment,cursor:a.cursor,peakBytes:a.peakBytes,uploads:a.uploads})).sort((a,b)=>a.name.localeCompare(b.name));
      return {schema:'steelmoth-webgpu-resources/v1',extent:{width:this.width,height:this.height},frameIndex:this.frameIndex,generation:this.generation,definitionCount:this.definitions.size,resourceCount:resources.length,estimatedBytes:resources.reduce((n,r)=>n+(r.estimatedBytes||0),0),createCount:this.createCount,destroyCount:this.destroyCount,rebuildCount:this.rebuildCount,resizeCount:this.resizeCount,uploads:{static:{count:this.staticUploadCount,bytes:this.staticUploadBytes},dynamic:{count:this.dynamicUploadCount,bytes:this.dynamicUploadBytes}},dynamicArenas:arenas,resources};
    }
  }

  class PipelineCache{
    constructor(device,options={}){if(!device)throw new Error('PipelineCache requires GPUDevice');this.device=device;this.labelPrefix=options.labelPrefix||'SteelMothPipeline';this.cache=new Map();this.hits=0;this.misses=0;this.generation=1;this.clearCount=0}
    _cacheKey(kind,key){return `${kind}:${String(key)}`}
    async _scopedCreate(kind,key,creator){
      const cacheKey=this._cacheKey(kind,key);if(this.cache.has(cacheKey)){this.hits++;return this.cache.get(cacheKey)}this.misses++;
      let thrown=null,pipeline=null,scoped=null;if(typeof this.device.pushErrorScope==='function')this.device.pushErrorScope('validation');
      try{pipeline=await creator(this.device,`${this.labelPrefix}:${key}`)}catch(error){thrown=error}
      if(typeof this.device.popErrorScope==='function'){try{scoped=await this.device.popErrorScope()}catch(error){if(!thrown)thrown=error}}
      if(thrown)throw thrown;if(scoped)throw new Error(`WebGPU validation error creating ${kind} pipeline ${key}: ${scoped.message||scoped}`);if(!pipeline)throw new Error(`${kind} pipeline factory returned no pipeline: ${key}`);this.cache.set(cacheKey,pipeline);return pipeline;
    }
    getRender(key,descriptorOrFactory){return this._scopedCreate('render',key,(device,label)=>typeof descriptorOrFactory==='function'?descriptorOrFactory(device,label):device.createRenderPipeline({...descriptorOrFactory,label:descriptorOrFactory?.label||label}))}
    getCompute(key,descriptorOrFactory){return this._scopedCreate('compute',key,(device,label)=>typeof descriptorOrFactory==='function'?descriptorOrFactory(device,label):device.createComputePipeline({...descriptorOrFactory,label:descriptorOrFactory?.label||label}))}
    clear(){this.cache.clear();this.generation++;this.clearCount++}
    resetDevice(device){if(!device)throw new Error('PipelineCache reset requires GPUDevice');this.device=device;this.clear()}
    diagnostics(){return {schema:'steelmoth-webgpu-pipeline-cache/v1',generation:this.generation,count:this.cache.size,hits:this.hits,misses:this.misses,clearCount:this.clearCount,keys:Array.from(this.cache.keys()).sort()}}
  }

  class FrameGraph{
    constructor(options={}){this.device=options.device||null;this.labelPrefix=options.labelPrefix||'SteelMothPass';this.passes=new Map();this.order=[];this.dirty=true;this.executionCount=0;this.compileCount=0;this.lastError=null;this.passStats=new Map()}
    setDevice(device){this.device=device;return this}
    addPass(nameOrOptions,options={}){
      const p=typeof nameOrOptions==='string'?{...options,name:nameOrOptions}:{...(nameOrOptions||{})},name=String(p.name||'');if(!name)throw new Error('frame graph pass name is required');if(this.passes.has(name))throw new Error(`frame graph pass already exists: ${name}`);if(typeof p.execute!=='function')throw new Error(`frame graph pass ${name} requires execute()`);
      const pass={name,after:Array.from(p.after||p.dependsOn||[]).map(String),reads:Array.from(p.reads||[]).map(String),writes:Array.from(p.writes||[]).map(String),enabled:p.enabled!==false,execute:p.execute};this.passes.set(name,pass);this.dirty=true;return pass;
    }
    removePass(name){const changed=this.passes.delete(String(name));if(changed)this.dirty=true;return changed}
    compile(){
      if(!this.dirty)return [...this.order];const indegree=new Map(),edges=new Map(),index=new Map();let i=0;for(const name of this.passes.keys()){indegree.set(name,0);edges.set(name,[]);index.set(name,i++)}
      for(const pass of this.passes.values())for(const dep of pass.after){if(!this.passes.has(dep))throw new Error(`frame graph pass ${pass.name} depends on missing pass ${dep}`);edges.get(dep).push(pass.name);indegree.set(pass.name,indegree.get(pass.name)+1)}
      const ready=Array.from(this.passes.keys()).filter(n=>indegree.get(n)===0);const order=[];while(ready.length){ready.sort((a,b)=>index.get(a)-index.get(b));const name=ready.shift();order.push(name);for(const next of edges.get(name)){indegree.set(next,indegree.get(next)-1);if(indegree.get(next)===0)ready.push(next)}}
      if(order.length!==this.passes.size)throw new Error('frame graph contains a dependency cycle');this.order=order;this.dirty=false;this.compileCount++;return [...order];
    }
    async execute(context={}){
      const device=context.device||this.device;if(!device)throw new Error('FrameGraph.execute requires GPUDevice');const order=this.compile();this.lastError=null;const executed=[];
      for(const name of order){const pass=this.passes.get(name);if(!pass.enabled)continue;let thrown=null,scoped=null;if(typeof device.pushErrorScope==='function')device.pushErrorScope('validation');
        try{await pass.execute({...context,device,pass,frameGraph:this})}catch(error){thrown=error}
        if(typeof device.popErrorScope==='function'){try{scoped=await device.popErrorScope()}catch(error){if(!thrown)thrown=error}}
        if(scoped&&!thrown)thrown=new Error(`WebGPU validation error in pass ${name}: ${scoped.message||scoped}`);
        if(thrown){this.lastError={pass:name,message:String(thrown?.message||thrown)};throw thrown}
        const stat=this.passStats.get(name)||{executions:0};stat.executions++;this.passStats.set(name,stat);executed.push(name);
      }
      this.executionCount++;return executed;
    }
    diagnostics(){return {schema:'steelmoth-webgpu-frame-graph/v1',compiledOrder:this.dirty?null:[...this.order],passCount:this.passes.size,compileCount:this.compileCount,executionCount:this.executionCount,lastError:this.lastError?{...this.lastError}:null,passes:Array.from(this.passes.values()).map(p=>({name:p.name,after:[...p.after],reads:[...p.reads],writes:[...p.writes],enabled:p.enabled,executions:this.passStats.get(p.name)?.executions||0}))}}
  }

  class WebGPUInfrastructure{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUInfrastructure requires GPUDevice');this.device=options.device;this.registry=new ResourceRegistry(options);this.pipelines=new PipelineCache(options.device,{labelPrefix:options.pipelineLabelPrefix});this.graph=new FrameGraph({device:options.device,labelPrefix:options.passLabelPrefix});this.frameCount=0;this.resetCount=0;this.closed=false;
    }
    resize(width,height){return this.registry.resize(width,height)}
    resetDevice(device){this.device=device;this.registry.resetDevice(device,device.queue);this.pipelines.resetDevice(device);this.graph.setDevice(device);this.resetCount++;return this.diagnostics()}
    async executeFrame(context={}){if(this.closed)throw new Error('WebGPUInfrastructure is closed');const frameIndex=this.registry.beginFrame();const shared={...context,device:this.device,registry:this.registry,pipelines:this.pipelines,frameIndex};if(typeof context.prepare==='function')await context.prepare(shared);const executed=await this.graph.execute(shared);this.frameCount++;return {frameIndex,executed}}
    close(){if(this.closed)return;this.registry.close();this.pipelines.clear();this.closed=true}
    diagnostics(){return {schema:'steelmoth-webgpu-infrastructure/v1',closed:this.closed,frameCount:this.frameCount,resetCount:this.resetCount,resources:this.registry.diagnostics(),pipelines:this.pipelines.diagnostics(),frameGraph:this.graph.diagnostics()}}
  }

  return {BUFFER_USAGE,TEXTURE_USAGE,FORMAT_BYTES,align,bytesPerPixel,estimateTextureBytes,ResourceRegistry,PipelineCache,FrameGraph,WebGPUInfrastructure};
});
