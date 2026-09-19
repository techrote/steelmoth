'use strict';

(function(root,factory){
  let Resources=root?.SteelMothWebGPUResources||null;
  if(!Resources&&typeof module==='object'&&module.exports){try{Resources=require('./webgpu_resources.js');}catch(_e){Resources=null;}}
  const api=factory(Resources,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUGTAOStabilization=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,root){
  const SCHEMA='steelmoth-webgpu-gtao-stabilization/v1';
  const SNAPSHOT_SCHEMA='steelmoth-webgpu-gtao-stabilization-snapshot/v1';
  const QUALITY_NAMES=Object.freeze(['Low','Medium','High','Ultra']);
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,COPY_DST:0x02,TEXTURE_BINDING:0x04,STORAGE_BINDING:0x08});
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const MAP_MODE_READ=0x0001;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const align=(v,m=256)=>Math.ceil(Math.max(0,Number(v)||0)/m)*m;
  const textureUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUTextureUsage?.[n]??FALLBACK_TEXTURE_USAGE[n]??0),0);
  const bufferUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);

  const QUALITY_PRESETS=Object.freeze({
    Low:Object.freeze({gtao:Object.freeze({enabled:false,directions:4,steps:2,radius:8,intensity:.85}),temporal:Object.freeze({enabled:false,historyWeight:0,depthThreshold:.018,normalThreshold:.78,deltaClamp:.18})}),
    Medium:Object.freeze({gtao:Object.freeze({enabled:true,directions:6,steps:4,radius:12,intensity:1.0}),temporal:Object.freeze({enabled:true,historyWeight:.55,depthThreshold:.012,normalThreshold:.84,deltaClamp:.14})}),
    High:Object.freeze({gtao:Object.freeze({enabled:true,directions:8,steps:5,radius:14,intensity:1.05}),temporal:Object.freeze({enabled:true,historyWeight:.62,depthThreshold:.010,normalThreshold:.88,deltaClamp:.12})}),
    Ultra:Object.freeze({gtao:Object.freeze({enabled:true,directions:8,steps:6,radius:16,intensity:1.08}),temporal:Object.freeze({enabled:true,historyWeight:.68,depthThreshold:.008,normalThreshold:.90,deltaClamp:.10})})
  });

  function normalizeQuality(value){const t=String(value??'Medium').trim().toLowerCase();return QUALITY_NAMES.find(n=>n.toLowerCase()===t)||'Medium';}
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function resolveQuality(value='Medium',overrides={}){
    const name=normalizeQuality(value),base=QUALITY_PRESETS[name];
    return{schema:`${SCHEMA}/quality`,name,gtao:{...clone(base.gtao),...(overrides.gtao||{})},temporal:{...clone(base.temporal),...(overrides.temporal||{})}};
  }
  function decodeNormal(v){const x=finite(v?.[0],.5)*2-1,y=finite(v?.[1],.5)*2-1,z=finite(v?.[2],1)*2-1,d=Math.hypot(x,y,z)||1;return[x/d,y/d,z/d];}
  function pairAt(depth,index,count){if(!depth)return[1,0];if(depth.length>=count*2)return[finite(depth[index*2],1),finite(depth[index*2+1],0)];const d=finite(depth[index],1);return[d,d];}
  function normalAt(normals,index){if(!normals)return[0,0,1];return decodeNormal([normals[index*4],normals[index*4+1],normals[index*4+2]]);}
  function localBounds(current,width,height,x,y){let lo=Infinity,hi=-Infinity;for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const sx=x+ox,sy=y+oy;if(sx<0||sy<0||sx>=width||sy>=height)continue;const v=clamp(finite(current[sy*width+sx],1),0,1);lo=Math.min(lo,v);hi=Math.max(hi,v);}return[Number.isFinite(lo)?lo:1,Number.isFinite(hi)?hi:1];}
  function globalDiscontinuity(previousMeta,currentMeta){
    if(!previousMeta)return{reject:true,reason:'history-uninitialized'};
    for(const key of ['roomId','deviceGeneration','backendGeneration'])if(String(previousMeta?.[key]??'')!==String(currentMeta?.[key]??''))return{reject:true,reason:`${key}-change`};
    return{reject:false,reason:''};
  }
  function temporalReference(input={},options={}){
    const width=Math.max(1,Math.round(input.width||1)),height=Math.max(1,Math.round(input.height||1)),count=width*height;
    const quality=resolveQuality(options.quality||'Medium',options),cfg=quality.temporal;
    const current=input.current||new Float32Array(count).fill(1),previous=input.previous||new Float32Array(count).fill(1);
    const currentDepth=input.currentDepth||new Float32Array(count*2),previousDepth=input.previousDepth||new Float32Array(count*2);
    const currentObject=input.currentObject||new Uint32Array(count),previousObject=input.previousObject||new Uint32Array(count);
    const currentNormal=input.currentNormal||null,previousNormal=input.previousNormal||null;
    const global=globalDiscontinuity(input.previousMeta,input.currentMeta),historyValid=input.historyValid===true&&!global.reject&&cfg.enabled;
    const out=new Float32Array(count),rejectMask=new Uint8Array(count),reasons={accepted:0,rejected:0,global:0,depth:0,object:0,normal:0,disabled:0};
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,cur=clamp(finite(current[i],1),0,1);let accept=historyValid,why='';
      if(!cfg.enabled){accept=false;why='disabled';}
      else if(!historyValid){accept=false;why='global';}
      else if(Number(currentObject[i]||0)!==Number(previousObject[i]||0)){accept=false;why='object';}
      else{
        const a=pairAt(currentDepth,i,count),b=pairAt(previousDepth,i,count);
        if(Math.abs(a[0]-b[0])>cfg.depthThreshold||Math.abs(a[1]-b[1])>cfg.depthThreshold){accept=false;why='depth';}
        else if(currentNormal&&previousNormal){const n=normalAt(currentNormal,i),p=normalAt(previousNormal,i),dot=n[0]*p[0]+n[1]*p[1]+n[2]*p[2];if(dot<cfg.normalThreshold){accept=false;why='normal';}}
      }
      if(accept){const [lo,hi]=localBounds(current,width,height,x,y),bounded=clamp(finite(previous[i],cur),Math.max(lo,cur-cfg.deltaClamp),Math.min(hi,cur+cfg.deltaClamp));out[i]=cur*(1-cfg.historyWeight)+bounded*cfg.historyWeight;reasons.accepted++;}
      else{out[i]=cur;rejectMask[i]=1;reasons.rejected++;reasons[why]=(reasons[why]||0)+1;}
    }
    return{schema:SNAPSHOT_SCHEMA,width,height,quality:quality.name,full:out,rejectMask,diagnostics:{historyValid,globalReject:global,reasons,historyWeight:cfg.historyWeight,depthThreshold:cfg.depthThreshold,normalThreshold:cfg.normalThreshold,deltaClamp:cfg.deltaClamp,neighborhoodClamp:true}};
  }

  const TEMPORAL_WGSL=`
struct Params{extent:vec4u,blend:vec4f};
struct Stats{accepted:atomic<u32>,rejected:atomic<u32>,depthRejected:atomic<u32>,objectRejected:atomic<u32>,normalRejected:atomic<u32>,globalRejected:atomic<u32>,_p0:atomic<u32>,_p1:atomic<u32>};
@group(0) @binding(0) var currentVis:texture_2d<f32>;
@group(0) @binding(1) var currentDepth:texture_2d<f32>;
@group(0) @binding(2) var currentObject:texture_2d<u32>;
@group(0) @binding(3) var currentNormal:texture_2d<f32>;
@group(0) @binding(4) var previousVis:texture_2d<f32>;
@group(0) @binding(5) var previousDepth:texture_2d<f32>;
@group(0) @binding(6) var previousObject:texture_2d<u32>;
@group(0) @binding(7) var previousNormal:texture_2d<f32>;
@group(0) @binding(8) var<uniform> params:Params;
@group(0) @binding(9) var nextVis:texture_storage_2d<r32float,write>;
@group(0) @binding(10) var nextDepth:texture_storage_2d<rg32float,write>;
@group(0) @binding(11) var nextObject:texture_storage_2d<r32uint,write>;
@group(0) @binding(12) var nextNormal:texture_storage_2d<rgba16float,write>;
@group(0) @binding(13) var rejectOut:texture_storage_2d<r32float,write>;
@group(0) @binding(14) var<storage,read_write> stats:Stats;
fn bounds(p:vec2i)->vec2f{var lo=1.0;var hi=0.0;for(var oy:i32=-1;oy<=1;oy++){for(var ox:i32=-1;ox<=1;ox++){let q=p+vec2i(ox,oy);if(q.x<0||q.y<0||q.x>=i32(params.extent.x)||q.y>=i32(params.extent.y)){continue;}let v=clamp(textureLoad(currentVis,q,0).x,0.0,1.0);lo=min(lo,v);hi=max(hi,v);}}return vec2f(lo,hi);}
fn normalAt(t:texture_2d<f32>,p:vec2i)->vec3f{let n=textureLoad(t,p,0).xyz*2.0-1.0;return normalize(select(vec3f(0,0,1),n,length(n)>0.00001));}
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){
  if(gid.x>=params.extent.x||gid.y>=params.extent.y){return;}let p=vec2i(gid.xy);let cur=clamp(textureLoad(currentVis,p,0).x,0.0,1.0);let d=textureLoad(currentDepth,p,0).rg;let o=textureLoad(currentObject,p,0).x;let n=textureLoad(currentNormal,p,0);
  var accept=params.extent.z!=0u&&params.extent.w==0u;var reason=0u;
  if(!accept){reason=4u;}else if(o!=textureLoad(previousObject,p,0).x){accept=false;reason=2u;}else{let pd=textureLoad(previousDepth,p,0).rg;if(any(abs(d-pd)>vec2f(params.blend.y))){accept=false;reason=1u;}else{let a=normalAt(currentNormal,p);let b=normalAt(previousNormal,p);if(dot(a,b)<params.blend.z){accept=false;reason=3u;}}}
  var value=cur;if(accept){let b=bounds(p);let pv=textureLoad(previousVis,p,0).x;let bounded=clamp(pv,max(b.x,cur-params.blend.w),min(b.y,cur+params.blend.w));value=mix(cur,bounded,params.blend.x);atomicAdd(&stats.accepted,1u);}else{atomicAdd(&stats.rejected,1u);if(reason==1u){atomicAdd(&stats.depthRejected,1u);}else if(reason==2u){atomicAdd(&stats.objectRejected,1u);}else if(reason==3u){atomicAdd(&stats.normalRejected,1u);}else{atomicAdd(&stats.globalRejected,1u);}}
  textureStore(nextVis,p,vec4f(value,0,0,1));textureStore(nextDepth,p,vec4f(d,0,0));textureStore(nextObject,p,vec4u(o,0,0,0));textureStore(nextNormal,p,n);textureStore(rejectOut,p,vec4f(select(1.0,0.0,accept),0,0,1));
}`;

  function parameterBytes(width,height,historyValid,globalReject,cfg){const buf=new ArrayBuffer(32),u=new Uint32Array(buf),f=new Float32Array(buf);u[0]=width;u[1]=height;u[2]=historyValid?1:0;u[3]=globalReject?1:0;f[4]=cfg.historyWeight;f[5]=cfg.depthThreshold;f[6]=cfg.normalThreshold;f[7]=cfg.deltaClamp;return new Uint8Array(buf);}

  class WebGPUGTAOTemporal{
    constructor(options={}){if(!Resources)throw new Error('SteelMothWebGPUResources is required before WebGPUGTAOTemporal');if(!options.device)throw new Error('WebGPUGTAOTemporal requires GPUDevice');this.device=options.device;this.queue=options.queue||options.device.queue;this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));this.quality=normalizeQuality(options.quality||'Medium');this.registry=null;this.pipelines=new Resources.PipelineCache(this.device,{labelPrefix:'SteelMothGTAOStabilization'});this.pipeline=null;this.historyIndex=0;this.historyValid=false;this.valid=false;this.closed=false;this.generation=0;this.updateCount=0;this.invalidationCount=0;this.lastInvalidationReason='uninitialized';this.previousMeta=null;this.lastStats=null;this.configure(this.width,this.height);}
    _name(n){return`sm601:${n}`;}
    configure(width,height){if(this.closed)throw new Error('WebGPUGTAOTemporal is closed');width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));if(this.registry&&width===this.width&&height===this.height)return false;if(this.registry)this.registry.close();this.width=width;this.height=height;this.registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width,height,labelPrefix:'SteelMothGTAOStabilization'});const usage=textureUsage(['TEXTURE_BINDING','STORAGE_BINDING','COPY_SRC']);for(const i of [0,1]){this.registry.defineTexture(this._name(`vis${i}`),{format:'r32float',usage,size:'surface'});this.registry.defineTexture(this._name(`depth${i}`),{format:'rg32float',usage,size:'surface'});this.registry.defineTexture(this._name(`object${i}`),{format:'r32uint',usage,size:'surface'});this.registry.defineTexture(this._name(`normal${i}`),{format:'rgba16float',usage,size:'surface'});}this.registry.defineTexture(this._name('reject'),{format:'r32float',usage,size:'surface'});this.registry.defineBuffer(this._name('params'),{size:32,usage:bufferUsage(['UNIFORM','COPY_DST'])});this.registry.defineBuffer(this._name('stats'),{size:32,usage:bufferUsage(['STORAGE','COPY_SRC','COPY_DST'])});this.registry.defineBuffer(this._name('statsReadback'),{size:32,usage:bufferUsage(['MAP_READ','COPY_DST'])});this.pipeline=null;this.historyIndex=0;this.generation++;this.invalidate('configure');return true;}
    resize(width,height){return this.configure(width,height);}
    resetDevice(device,queue=device?.queue){if(!device)throw new Error('resetDevice requires GPUDevice');this.device=device;this.queue=queue||device.queue;this.registry?.close();this.registry=null;this.pipelines.resetDevice(device);this.pipeline=null;this.generation++;this.configure(this.width,this.height);this.invalidate('device-reset');return this.generation;}
    invalidate(reason='explicit'){this.historyValid=false;this.valid=false;this.previousMeta=null;this.invalidationCount++;this.lastInvalidationReason=String(reason||'explicit');return this.invalidationCount;}
    async _pipeline(){if(this.pipeline)return this.pipeline;this.pipeline=await this.pipelines.getCompute('gtao-temporal-v1',async(device,label)=>{const module=device.createShaderModule({label:`${label}:wgsl`,code:TEMPORAL_WGSL});if(typeof module.getCompilationInfo==='function'){const info=await module.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error(`SM-601 WGSL compilation failed: ${errors.map(e=>e.message).join('; ')}`);}return device.createComputePipeline({label,layout:'auto',compute:{module,entryPoint:'cs_main'}});});return this.pipeline;}
    sourceFromPaths(gtao,depthHierarchy,gbuffer){const gb=typeof gbuffer?._views==='function'?gbuffer._views():null;if(typeof gtao?.bindings!=='function')throw new Error('SM-601 sourceFromPaths requires SM-600 GTAO');if(typeof depthHierarchy?.levelView!=='function')throw new Error('SM-601 sourceFromPaths requires SM-203 depth hierarchy');if(!gb?.objectId||!gb?.g1)throw new Error('SM-601 sourceFromPaths requires canonical object-ID and Material-v2 normal views');return{width:this.width,height:this.height,currentVisibilityView:gtao.bindings().visibility,currentDepthView:depthHierarchy.levelView(0),currentObjectView:gb.objectId,currentNormalView:gb.g1};}
    async update(source={},options={}){const width=Math.max(1,Math.round(source.width||this.width)),height=Math.max(1,Math.round(source.height||this.height));if(width!==this.width||height!==this.height)this.configure(width,height);for(const key of ['currentVisibilityView','currentDepthView','currentObjectView','currentNormalView'])if(!source[key])throw new Error(`SM-601 update requires ${key}`);await this._pipeline();const quality=resolveQuality(options.quality||this.quality,options),cfg=quality.temporal,global=globalDiscontinuity(this.previousMeta,options.meta||{}),globalReject=global.reject;const params=this.registry.require(this._name('params')).handle,stats=this.registry.require(this._name('stats')).handle,read=this.registry.require(this._name('statsReadback')).handle;this.queue.writeBuffer(params,0,parameterBytes(width,height,this.historyValid&&cfg.enabled,globalReject,cfg));this.queue.writeBuffer(stats,0,new Uint32Array(8));const prev=this.historyIndex,next=1-prev,pipeline=this.pipeline;const v=n=>this.registry.require(this._name(n)).handle.createView();const bind=this.device.createBindGroup({label:'SteelMothGTAOStabilization:bind',layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source.currentVisibilityView},{binding:1,resource:source.currentDepthView},{binding:2,resource:source.currentObjectView},{binding:3,resource:source.currentNormalView},{binding:4,resource:v(`vis${prev}`)},{binding:5,resource:v(`depth${prev}`)},{binding:6,resource:v(`object${prev}`)},{binding:7,resource:v(`normal${prev}`)},{binding:8,resource:{buffer:params}},{binding:9,resource:v(`vis${next}`)},{binding:10,resource:v(`depth${next}`)},{binding:11,resource:v(`object${next}`)},{binding:12,resource:v(`normal${next}`)},{binding:13,resource:v('reject')},{binding:14,resource:{buffer:stats}}]});const encoder=this.device.createCommandEncoder({label:'SteelMothGTAOStabilization:encoder'}),pass=encoder.beginComputePass({label:'SteelMothGTAOStabilization:temporal'});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));pass.end();encoder.copyBufferToBuffer(stats,0,read,0,32);this.queue.submit([encoder.finish()]);if(options.wait!==false&&typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();await read.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const values=Array.from(new Uint32Array(read.getMappedRange().slice(0,32)));read.unmap();this.lastStats={accepted:values[0],rejected:values[1],depthRejected:values[2],objectRejected:values[3],normalRejected:values[4],globalRejected:values[5]};this.historyIndex=next;this.historyValid=cfg.enabled;this.valid=true;this.previousMeta={...(options.meta||{})};this.quality=quality.name;this.updateCount++;this.lastInvalidationReason='';return this.diagnostics();}
    _record(name){if(!this.valid)throw new Error(`SM-601 GTAO history is invalid: ${this.lastInvalidationReason}`);return this.registry.require(this._name(name));}
    bindings(){return{gtaoVisibility:this._record(`vis${this.historyIndex}`).handle.createView(),visibility:this._record(`vis${this.historyIndex}`).handle.createView(),rejectMask:this._record('reject').handle.createView(),format:'r32float',generation:this.generation,quality:this.quality};}
    async readback(){const record=this._record(`vis${this.historyIndex}`),row=this.width*4,bpr=align(row,256),buf=this.device.createBuffer({label:'SteelMothGTAOStabilization:readback',size:bpr*this.height,usage:bufferUsage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:record.handle},{buffer:buf,bytesPerRow:bpr,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);await buf.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(buf.getMappedRange()),out=new Float32Array(this.width*this.height);for(let y=0;y<this.height;y++){const dv=new DataView(raw.buffer,raw.byteOffset+y*bpr,row);for(let x=0;x<this.width;x++)out[y*this.width+x]=dv.getFloat32(x*4,true);}buf.unmap();buf.destroy?.();return out;}
    diagnostics(){const quality=resolveQuality(this.quality);return{schema:SCHEMA,valid:this.valid,historyValid:this.historyValid,generation:this.generation,updateCount:this.updateCount,invalidationCount:this.invalidationCount,lastInvalidationReason:this.lastInvalidationReason,extent:{width:this.width,height:this.height},quality,previousMeta:this.previousMeta?{...this.previousMeta}:null,lastStats:this.lastStats?{...this.lastStats}:null,consumer:'SM-307 gtaoVisibilityView',historyPolicy:'Depth/object/normal/room/device/backend discontinuities reject history; accepted history is neighborhood and delta clamped.',targetHardwareEvidence:false,resourceDiagnostics:this.registry?.diagnostics?.()||null,pipelineDiagnostics:this.pipelines?.diagnostics?.()||null};}
    close(){this.registry?.close();this.pipelines?.clear();this.registry=null;this.pipeline=null;this.historyValid=false;this.valid=false;this.closed=true;}
  }

  return{SCHEMA,SNAPSHOT_SCHEMA,QUALITY_NAMES,QUALITY_PRESETS,normalizeQuality,resolveQuality,decodeNormal,pairAt,localBounds,globalDiscontinuity,temporalReference,TEMPORAL_WGSL,parameterBytes,WebGPUGTAOTemporal};
});