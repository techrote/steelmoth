'use strict';

(function(root,factory){
  const Resources=root?.SteelMothWebGPUResources||((typeof module==='object'&&module.exports)?require('./webgpu_resources.js'):null);
  const api=factory(Resources,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUDepthHierarchy=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,root){
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before webgpu_depth_hierarchy');

  const SCHEMA='steelmoth-webgpu-depth-hierarchy/v1';
  const FORMAT='rg32float';
  const EMPTY_MIN=1.0,EMPTY_MAX=0.0;
  const DEBUG_MODES=Object.freeze(['min','max','span','occupancy']);
  const MAP_MODE_READ=0x0001;
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,TEXTURE_BINDING:0x04,STORAGE_BINDING:0x08,RENDER_ATTACHMENT:0x10});
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const textureUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUTextureUsage?.[n]??FALLBACK_TEXTURE_USAGE[n]??0),0);
  const bufferUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;

  function levelDimensions(width,height){
    width=Math.max(1,Math.floor(finite(width,1)));height=Math.max(1,Math.floor(finite(height,1)));const out=[];
    while(true){out.push({level:out.length,width,height,coverage:2**out.length});if(width===1&&height===1)break;width=Math.max(1,Math.ceil(width/2));height=Math.max(1,Math.ceil(height/2));}
    return out;
  }
  function depthIdToRanges(depths,ids,width,height){
    const n=Math.max(1,Math.floor(width))*Math.max(1,Math.floor(height)),out=new Float32Array(n*2);
    for(let i=0;i<n;i++){const occupied=Number(ids?.[i]??0)!==0,d=clamp(finite(depths?.[i],1),0,1);out[i*2]=occupied?d:EMPTY_MIN;out[i*2+1]=occupied?d:EMPTY_MAX;}
    return out;
  }
  function reduceRangeLevelCPU(src,width,height){
    width=Math.max(1,Math.floor(width));height=Math.max(1,Math.floor(height));const dw=Math.max(1,Math.ceil(width/2)),dh=Math.max(1,Math.ceil(height/2)),dst=new Float32Array(dw*dh*2);
    for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
      let mn=EMPTY_MIN,mx=EMPTY_MAX;
      for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++){const sx=x*2+ox,sy=y*2+oy;if(sx>=width||sy>=height)continue;const i=(sy*width+sx)*2,a=Number(src[i]),b=Number(src[i+1]);if(a<=b){mn=Math.min(mn,a);mx=Math.max(mx,b)}}
      const o=(y*dw+x)*2;dst[o]=mn;dst[o+1]=mx;
    }
    return {width:dw,height:dh,data:dst};
  }
  function buildCPUHierarchy(depths,ids,width,height){
    const dims=levelDimensions(width,height),levels=[{...dims[0],data:depthIdToRanges(depths,ids,width,height)}];
    for(let i=1;i<dims.length;i++){const prev=levels[i-1],next=reduceRangeLevelCPU(prev.data,prev.width,prev.height);levels.push({...dims[i],data:next.data});}
    return levels;
  }
  function rangeOccupied(range){return Number(range?.[0])<=Number(range?.[1])}
  function chooseLevelForFootprint(pixelSpan,maxLevel=31){return clamp(Math.floor(Math.log2(Math.max(1,finite(pixelSpan,1)))),0,Math.max(0,Math.floor(maxLevel)))}

  const INIT_WGSL=`
@group(0) @binding(0) var sourceDepth:texture_depth_2d;
@group(0) @binding(1) var sourceObject:texture_2d<u32>;
@group(0) @binding(2) var dst:texture_storage_2d<rg32float,write>;
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){
  let size=textureDimensions(dst);if(gid.x>=size.x||gid.y>=size.y){return;}
  let p=vec2i(gid.xy);let id=textureLoad(sourceObject,p,0).x;
  if(id==0u){textureStore(dst,p,vec4f(1.0,0.0,0.0,1.0));return;}
  let d=textureLoad(sourceDepth,p,0);textureStore(dst,p,vec4f(d,d,0.0,1.0));
}`;
  const REDUCE_WGSL=`
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(1) var dst:texture_storage_2d<rg32float,write>;
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){
  let outSize=textureDimensions(dst);if(gid.x>=outSize.x||gid.y>=outSize.y){return;}let inSize=textureDimensions(src);var mn=1.0;var mx=0.0;
  for(var oy:u32=0u;oy<2u;oy++){for(var ox:u32=0u;ox<2u;ox++){let p=gid.xy*2u+vec2u(ox,oy);if(p.x>=inSize.x||p.y>=inSize.y){continue;}let r=textureLoad(src,vec2i(p),0).rg;if(r.x<=r.y){mn=min(mn,r.x);mx=max(mx,r.y);}}}
  textureStore(dst,vec2i(gid.xy),vec4f(mn,mx,0.0,1.0));
}`;
  const READBACK_WGSL=`
struct Coord{xy:vec2u,_pad:vec2u};struct Out{range:vec2f,_pad:vec2f};
@group(0) @binding(0) var src:texture_2d<f32>;@group(0) @binding(1) var<uniform> coord:Coord;@group(0) @binding(2) var<storage,read_write> out:Out;
@compute @workgroup_size(1) fn cs_main(){out.range=textureLoad(src,vec2i(coord.xy),0).rg;}
`;
  const DEBUG_WGSL=`
struct Debug{mode:u32,_pad:vec3u};@group(0) @binding(0) var src:texture_2d<f32>;@group(0) @binding(1) var<uniform> debug:Debug;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[vi],0,1);}
@fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) vec4f{let size=textureDimensions(src);let q=clamp(vec2i(p.xy),vec2i(0),vec2i(size)-vec2i(1));let r=textureLoad(src,q,0).rg;let occupied=r.x<=r.y;if(!occupied){return vec4f(0,0,0,1);}if(debug.mode==0u){return vec4f(vec3f(1.0-r.x),1);}if(debug.mode==1u){return vec4f(vec3f(1.0-r.y),1);}if(debug.mode==2u){return vec4f(vec3f(clamp(r.y-r.x,0.0,1.0)),1);}return vec4f(1,1,1,1);}
`;
  const RANGE_HELPERS_WGSL=`
fn smDepthRangeOccupied(r:vec2f)->bool{return r.x<=r.y;}
fn smDepthRangeSpan(r:vec2f)->f32{return select(0.0,max(0.0,r.y-r.x),smDepthRangeOccupied(r));}
`;

  class WebGPUDepthHierarchy{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUDepthHierarchy requires GPUDevice');this.device=options.device;this.queue=options.queue||options.device.queue;this.labelPrefix=String(options.labelPrefix||'SteelMothDepthHierarchy');this.width=0;this.height=0;this.levels=[];this.registry=null;this.pipelines=new Resources.PipelineCache(this.device,{labelPrefix:`${this.labelPrefix}:pipeline`});this.initPipeline=null;this.reducePipeline=null;this.readbackPipeline=null;this.debugPipelines=new Map();this.compilation=[];this.valid=false;this.closed=false;this.buildCount=0;this.resizeCount=0;this.invalidationCount=0;this.resourceGeneration=0;this.lastInvalidationReason='uninitialized';
      if(options.width&&options.height)this.configure(options.width,options.height);
    }
    _module(label,code){const module=this.device.createShaderModule({label:`${this.labelPrefix}:${label}`,code});return Promise.resolve(typeof module.getCompilationInfo==='function'?module.getCompilationInfo():null).then(info=>{const messages=Array.from(info?.messages||[]).map(m=>({type:m.type,message:m.message,lineNum:m.lineNum,linePos:m.linePos}));this.compilation.push({label,messages});const errors=messages.filter(m=>m.type==='error');if(errors.length)throw new Error(`${label} WGSL compilation failed: ${errors.map(e=>e.message).join(' | ')}`);return module});}
    async initialize(){if(this.initPipeline&&this.reducePipeline)return this;const init=await this._module('sm203-init',INIT_WGSL),reduce=await this._module('sm203-reduce',REDUCE_WGSL),read=await this._module('sm203-readback',READBACK_WGSL);this.initPipeline=await this.pipelines.getCompute('sm203-init',()=>this.device.createComputePipeline({label:`${this.labelPrefix}:init`,layout:'auto',compute:{module:init,entryPoint:'cs_main'}}));this.reducePipeline=await this.pipelines.getCompute('sm203-reduce',()=>this.device.createComputePipeline({label:`${this.labelPrefix}:reduce`,layout:'auto',compute:{module:reduce,entryPoint:'cs_main'}}));this.readbackPipeline=await this.pipelines.getCompute('sm203-readback',()=>this.device.createComputePipeline({label:`${this.labelPrefix}:readback`,layout:'auto',compute:{module:read,entryPoint:'cs_main'}}));return this;}
    configure(width,height){
      if(this.closed)throw new Error('WebGPUDepthHierarchy is closed');width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));if(width===this.width&&height===this.height&&this.registry)return false;
      if(this.registry){this.registry.close();this.resizeCount++;}this.width=width;this.height=height;this.levels=levelDimensions(width,height);this.registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width,height,labelPrefix:this.labelPrefix});const usage=textureUsage(['TEXTURE_BINDING','STORAGE_BINDING','COPY_SRC']);
      for(const level of this.levels){const record=this.registry.defineTexture(`sm203:level:${level.level}`,{format:FORMAT,usage,size:{width:level.width,height:level.height,depthOrArrayLayers:1},resizeDependent:false,lifetime:'persistent'});level.record=record;}
      this.resourceGeneration++;this.invalidate(this.resizeCount?'resize':'configure');return true;
    }
    resize(width,height){return this.configure(width,height)}
    invalidate(reason='explicit'){this.valid=false;this.invalidationCount++;this.lastInvalidationReason=String(reason||'explicit');return this.invalidationCount}
    _requireLevel(index,allowInvalid=false){index=Math.floor(index);if(index<0||index>=this.levels.length)throw new RangeError(`depth hierarchy level ${index} out of range`);if(!allowInvalid&&!this.valid)throw new Error(`depth hierarchy is invalid: ${this.lastInvalidationReason}`);return this.levels[index]}
    levelInfo(index){const l=this._requireLevel(index,true);return {level:l.level,width:l.width,height:l.height,coverage:l.coverage,format:FORMAT,emptySentinel:[EMPTY_MIN,EMPTY_MAX]}}
    levelView(index){return this._requireLevel(index).record.handle.createView()}
    levelForFootprint(pixelSpan){return Math.min(this.levels.length-1,chooseLevelForFootprint(pixelSpan,this.levels.length-1))}
    sourceFromOwnership(gbuffer){if(!gbuffer||typeof gbuffer._record!=='function')throw new Error('buildFromOwnership requires WebGPUOwnershipGBuffer-compatible source');const depth=gbuffer._record('depth'),objectId=gbuffer._record('object');return {depthTexture:depth.handle,objectIdTexture:objectId.handle,width:depth.width,height:depth.height};}
    async buildFromOwnership(gbuffer,options={}){return this.build(this.sourceFromOwnership(gbuffer),options)}
    async build(source={},options={}){
      await this.initialize();const width=Math.max(1,Math.round(source.width||0)),height=Math.max(1,Math.round(source.height||0));if(!source.depthTexture||!source.objectIdTexture||!width||!height)throw new Error('depth hierarchy build requires depthTexture, objectIdTexture, width and height');this.configure(width,height);
      const encoder=this.device.createCommandEncoder({label:`${this.labelPrefix}:build`}),l0=this.levels[0],initBind=this.device.createBindGroup({label:`${this.labelPrefix}:init-bind`,layout:this.initPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source.depthTexture.createView()},{binding:1,resource:source.objectIdTexture.createView()},{binding:2,resource:l0.record.handle.createView()}]});
      {const pass=encoder.beginComputePass({label:`${this.labelPrefix}:level-0`});pass.setPipeline(this.initPipeline);pass.setBindGroup(0,initBind);pass.dispatchWorkgroups(Math.ceil(l0.width/8),Math.ceil(l0.height/8));pass.end();}
      for(let i=1;i<this.levels.length;i++){const prev=this.levels[i-1],cur=this.levels[i],bind=this.device.createBindGroup({label:`${this.labelPrefix}:reduce-${i}`,layout:this.reducePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:prev.record.handle.createView()},{binding:1,resource:cur.record.handle.createView()}]}),pass=encoder.beginComputePass({label:`${this.labelPrefix}:level-${i}`});pass.setPipeline(this.reducePipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(cur.width/8),Math.ceil(cur.height/8));pass.end();}
      this.queue.submit([encoder.finish()]);if(options.wait!==false&&typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();this.valid=true;this.buildCount++;this.lastInvalidationReason='';return this.diagnostics();
    }
    async readLevelPixel(level,x,y){
      await this.initialize();const l=this._requireLevel(level),px=clamp(Math.floor(x),0,l.width-1),py=clamp(Math.floor(y),0,l.height-1),coord=this.device.createBuffer({label:`${this.labelPrefix}:coord`,size:256,usage:bufferUsage(['UNIFORM','COPY_DST'])}),gpuOut=this.device.createBuffer({label:`${this.labelPrefix}:readout`,size:256,usage:bufferUsage(['STORAGE','COPY_SRC'])}),map=this.device.createBuffer({label:`${this.labelPrefix}:map`,size:256,usage:bufferUsage(['COPY_DST','MAP_READ'])});
      this.queue.writeBuffer(coord,0,new Uint32Array([px,py,0,0]));const bind=this.device.createBindGroup({layout:this.readbackPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:l.record.handle.createView()},{binding:1,resource:{buffer:coord}},{binding:2,resource:{buffer:gpuOut}}]}),encoder=this.device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(this.readbackPipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(gpuOut,0,map,0,8);this.queue.submit([encoder.finish()]);await map.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(map.getMappedRange()).slice(0,8),dv=new DataView(raw.buffer,raw.byteOffset,8),range=[dv.getFloat32(0,true),dv.getFloat32(4,true)];map.unmap();coord.destroy();gpuOut.destroy();map.destroy();return range;
    }
    async _debugPipeline(targetFormat){const key=String(targetFormat);if(this.debugPipelines.has(key))return this.debugPipelines.get(key);const module=await this._module(`sm203-debug-${key}`,DEBUG_WGSL),pipeline=await this.pipelines.getRender(`sm203-debug:${key}`,()=>this.device.createRenderPipeline({label:`${this.labelPrefix}:debug:${key}`,layout:'auto',vertex:{module,entryPoint:'vs_main'},fragment:{module,entryPoint:'fs_main',targets:[{format:key}]},primitive:{topology:'triangle-list'}}));this.debugPipelines.set(key,pipeline);return pipeline}
    async renderDebug(targetTexture,level=0,mode='min',targetFormat='rgba8unorm'){
      const index=DEBUG_MODES.indexOf(mode);if(index<0)throw new Error(`unknown depth hierarchy debug mode: ${mode}`);const l=this._requireLevel(level),pipeline=await this._debugPipeline(targetFormat),uniform=this.device.createBuffer({label:`${this.labelPrefix}:debug-uniform`,size:256,usage:bufferUsage(['UNIFORM','COPY_DST'])});this.queue.writeBuffer(uniform,0,new Uint32Array([index,0,0,0]));const bind=this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:l.record.handle.createView()},{binding:1,resource:{buffer:uniform}}]}),encoder=this.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:targetTexture.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();this.queue.submit([encoder.finish()]);if(typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();uniform.destroy();return {level,mode,targetFormat};
    }
    resetDevice(device){if(!device)throw new Error('resetDevice requires GPUDevice');this.registry?.close();this.pipelines.clear();this.device=device;this.queue=device.queue;this.registry=null;this.initPipeline=this.reducePipeline=this.readbackPipeline=null;this.debugPipelines.clear();const w=this.width,h=this.height;this.width=this.height=0;this.configure(w||1,h||1);this.invalidate('device-reset');return this.resourceGeneration}
    diagnostics(){return {schema:SCHEMA,format:FORMAT,semantics:'occupied min/max canonical ownership depth; empty=(1,0)',valid:this.valid,extent:{width:this.width,height:this.height},levelCount:this.levels.length,levels:this.levels.map(l=>({level:l.level,width:l.width,height:l.height,coverage:l.coverage,estimatedBytes:l.record?.estimatedBytes||0})),emptySentinel:[EMPTY_MIN,EMPTY_MAX],buildCount:this.buildCount,resizeCount:this.resizeCount,invalidationCount:this.invalidationCount,resourceGeneration:this.resourceGeneration,lastInvalidationReason:this.lastInvalidationReason,debugModes:[...DEBUG_MODES],sampling:'textureLoad/unfiltered; chooseLevelForFootprint uses floor(log2(pixelSpan))',resourceDiagnostics:this.registry?.diagnostics?.()||null,pipelineDiagnostics:this.pipelines.diagnostics(),compilation:this.compilation};}
    close(){if(this.closed)return;this.registry?.close();this.pipelines.clear();this.debugPipelines.clear();this.valid=false;this.closed=true;}
  }

  return{SCHEMA,FORMAT,EMPTY_MIN,EMPTY_MAX,DEBUG_MODES,INIT_WGSL,REDUCE_WGSL,READBACK_WGSL,DEBUG_WGSL,RANGE_HELPERS_WGSL,levelDimensions,depthIdToRanges,reduceRangeLevelCPU,buildCPUHierarchy,rangeOccupied,chooseLevelForFootprint,WebGPUDepthHierarchy};
});
