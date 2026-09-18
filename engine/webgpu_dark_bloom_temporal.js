'use strict';

(function(root,factory){
  let Resources=root?.SteelMothWebGPUResources||null;
  if(!Resources&&typeof module==='object'&&module.exports){try{Resources=require('./webgpu_resources.js');}catch(_e){Resources=null;}}
  const api=factory(Resources,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUDarkBloomTemporal=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,root){
  const SCHEMA='steelmoth-webgpu-dark-bloom-temporal/v1';
  const SNAPSHOT_SCHEMA='steelmoth-webgpu-dark-bloom-temporal-snapshot/v1';
  const DEFAULTS=Object.freeze({historyWeight:.72,depthThreshold:.02,maxLightAngleDeg:6,maxLightMovePixels:12,clusterQuantum:4});
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,COPY_DST:0x02,TEXTURE_BINDING:0x04,STORAGE_BINDING:0x08});
  const MAP_MODE_READ=0x0001;
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const align=(v,m=4)=>Math.ceil(Math.max(0,Number(v)||0)/m)*m;
  const bufferUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const textureUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUTextureUsage?.[n]??FALLBACK_TEXTURE_USAGE[n]??0),0);

  function settings(overrides={}){
    return {
      historyWeight:clamp(finite(overrides.historyWeight,DEFAULTS.historyWeight),0,.95),
      depthThreshold:clamp(finite(overrides.depthThreshold,DEFAULTS.depthThreshold),.0001,.25),
      maxLightAngleDeg:clamp(finite(overrides.maxLightAngleDeg,DEFAULTS.maxLightAngleDeg),.1,45),
      maxLightMovePixels:clamp(finite(overrides.maxLightMovePixels,DEFAULTS.maxLightMovePixels),.5,256),
      clusterQuantum:clamp(Math.round(finite(overrides.clusterQuantum,DEFAULTS.clusterQuantum)),1,64)
    };
  }

  function normalize2(v,fallback=[0,0]){
    const x=finite(v?.[0],fallback[0]),y=finite(v?.[1],fallback[1]),m=Math.hypot(x,y);
    return m>1e-8?[x/m,y/m]:[fallback[0],fallback[1]];
  }
  function lightState(input={},hierarchy=null){
    const first=(hierarchy?.jobs||[])[0]||{};
    return {
      id:String(input.id??first.lightId??hierarchy?.lightId??'player-light'),
      direction:normalize2(input.direction??first.shadowDir??[1,0],[1,0]),
      position:Array.isArray(input.position)?[finite(input.position[0]),finite(input.position[1])]:null
    };
  }
  function lightDiscontinuity(previous,current,opts={}){
    if(!previous)return{reject:true,reason:'history-uninitialized',angleDeg:0,movePixels:0};
    const cfg=settings(opts);
    if(String(previous.id)!==String(current.id))return{reject:true,reason:'light-id-change',angleDeg:180,movePixels:Infinity};
    const a=normalize2(previous.direction,[1,0]),b=normalize2(current.direction,[1,0]),dot=clamp(a[0]*b[0]+a[1]*b[1],-1,1),angleDeg=Math.acos(dot)*180/Math.PI;
    let movePixels=0;
    if(previous.position&&current.position)movePixels=Math.hypot(current.position[0]-previous.position[0],current.position[1]-previous.position[1]);
    if(angleDeg>cfg.maxLightAngleDeg)return{reject:true,reason:'light-angle-discontinuity',angleDeg,movePixels};
    if(movePixels>cfg.maxLightMovePixels)return{reject:true,reason:'light-position-discontinuity',angleDeg,movePixels};
    return{reject:false,reason:'',angleDeg,movePixels};
  }

  function q(v,quantum){return Math.round(finite(v)/quantum);}
  function clusterSignature(input,quantum=DEFAULTS.clusterQuantum){
    if(input==null)return'none';
    if(typeof input==='string')return input;
    if(input.clusterSignature!=null)return String(input.clusterSignature);
    const jobs=Array.from(input.jobs||[]).map(job=>{
      const members=[];
      if(Array.isArray(job.memberIds))members.push(...job.memberIds.map(Number));
      else if(input.members&&Number.isFinite(job.memberOffset)&&Number.isFinite(job.memberCount))for(let i=0;i<job.memberCount;i++){const m=input.members[job.memberOffset+i];if(m)members.push(Number(m.objectId)||0);}
      members.sort((a,b)=>a-b);
      const b=job.clusterBounds||job.nearBounds||job.ownerBounds||[0,0,0,0];
      return [Number(job.clusterId)||0,Number(job.ownerObjectId)||0,members.join('.'),...[0,1,2,3].map(i=>q(b[i],quantum))].join(':');
    }).sort();
    return jobs.join('|')||'empty';
  }

  function pairAt(depth,index,count){
    if(!depth)return[1,0];
    if(depth.length>=count*2)return[finite(depth[index*2],1),finite(depth[index*2+1],0)];
    const d=finite(depth[index],1);return[d,d];
  }
  function localClampBounds(current,width,height,x,y){
    let lo=Infinity,hi=-Infinity;
    for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
      const sx=x+ox,sy=y+oy;if(sx<0||sy<0||sx>=width||sy>=height)continue;
      const v=Math.max(0,finite(current[sy*width+sx]));lo=Math.min(lo,v);hi=Math.max(hi,v);
    }
    if(!Number.isFinite(lo))lo=0;if(!Number.isFinite(hi))hi=0;return[lo,hi];
  }
  function temporalReference(input={},opts={}){
    const width=Math.max(1,Math.round(input.width||1)),height=Math.max(1,Math.round(input.height||1)),count=width*height,cfg=settings(opts);
    const current=input.current||new Float32Array(count),hard=input.hardMask||new Float32Array(count),currentDepth=input.currentDepth||new Float32Array(count*2),currentObject=input.currentObject||new Uint32Array(count);
    const previous=input.previous||new Float32Array(count),previousDepth=input.previousDepth||new Float32Array(count*2),previousObject=input.previousObject||new Uint32Array(count);
    const historyValid=input.historyValid===true,globalReject=input.globalReject===true;
    const out=new Float32Array(count),reasons={accepted:0,rejected:0,hard:0,depth:0,object:0,global:0};
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,cur=Math.max(0,finite(current[i]));let accept=historyValid&&!globalReject&&finite(hard[i])<=.5;
      let why='';
      if(finite(hard[i])>.5){accept=false;why='hard';}
      else if(!historyValid||globalReject){accept=false;why='global';}
      else {
        const a=pairAt(currentDepth,i,count),b=pairAt(previousDepth,i,count);
        if(Math.abs(a[0]-b[0])>cfg.depthThreshold||Math.abs(a[1]-b[1])>cfg.depthThreshold){accept=false;why='depth';}
        else if(Number(currentObject[i]||0)!==Number(previousObject[i]||0)){accept=false;why='object';}
      }
      if(accept){const [lo,hi]=localClampBounds(current,width,height,x,y),prev=clamp(Math.max(0,finite(previous[i])),lo,hi);out[i]=cur*(1-cfg.historyWeight)+prev*cfg.historyWeight;reasons.accepted++;}
      else {out[i]=finite(hard[i])>.5?0:cur;reasons.rejected++;reasons[why]=(reasons[why]||0)+1;}
    }
    const total=Math.max(1,count);return{schema:SNAPSHOT_SCHEMA,width,height,full:out,diagnostics:{accepted:reasons.accepted,rejected:reasons.rejected,acceptedPercent:reasons.accepted*100/total,rejectedPercent:reasons.rejected*100/total,reasons,historyWeight:cfg.historyWeight,depthThreshold:cfg.depthThreshold,hardCoreUnsmooth:true,neighborhoodClamp:true}};
  }

  function rmsDelta(a,b){const n=Math.min(a?.length||0,b?.length||0);if(!n)return 0;let s=0;for(let i=0;i<n;i++){const d=finite(a[i])-finite(b[i]);s+=d*d;}return Math.sqrt(s/n);}

  const TEMPORAL_WGSL=`
struct Params { extent:vec4<u32>, blend:vec4<f32> };
struct Stats { accepted:atomic<u32>, rejected:atomic<u32>, hardRejected:atomic<u32>, depthRejected:atomic<u32>, objectRejected:atomic<u32>, globalRejected:atomic<u32>, _pad0:atomic<u32>, _pad1:atomic<u32> };
@group(0) @binding(0) var currentTex:texture_2d<f32>;
@group(0) @binding(1) var hardTex:texture_2d<f32>;
@group(0) @binding(2) var currentDepthTex:texture_2d<f32>;
@group(0) @binding(3) var currentObjectTex:texture_2d<u32>;
@group(0) @binding(4) var previousTex:texture_2d<f32>;
@group(0) @binding(5) var previousDepthTex:texture_2d<f32>;
@group(0) @binding(6) var previousObjectTex:texture_2d<u32>;
@group(0) @binding(7) var<uniform> params:Params;
@group(0) @binding(8) var nextTex:texture_storage_2d<r32float,write>;
@group(0) @binding(9) var nextDepthTex:texture_storage_2d<rg32float,write>;
@group(0) @binding(10) var nextObjectTex:texture_storage_2d<r32uint,write>;
@group(0) @binding(11) var<storage,read_write> stats:Stats;
fn current_bounds(p:vec2<i32>)->vec2<f32>{
  var lo=1e9;var hi=-1e9;
  for(var oy:i32=-1;oy<=1;oy++){for(var ox:i32=-1;ox<=1;ox++){
    let q=p+vec2<i32>(ox,oy);if(q.x<0||q.y<0||q.x>=i32(params.extent.x)||q.y>=i32(params.extent.y)){continue;}
    let v=max(0.0,textureLoad(currentTex,q,0).x);lo=min(lo,v);hi=max(hi,v);
  }}
  return vec2<f32>(select(0.0,lo,lo<1e8),select(0.0,hi,hi>-1e8));
}
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3<u32>){
  if(gid.x>=params.extent.x||gid.y>=params.extent.y){return;}
  let p=vec2<i32>(gid.xy);let current=max(0.0,textureLoad(currentTex,p,0).x);let hard=textureLoad(hardTex,p,0).x>0.5;
  let currentDepth=textureLoad(currentDepthTex,p,0).rg;let currentObject=textureLoad(currentObjectTex,p,0).x;
  var accept=params.extent.z!=0u&&params.extent.w==0u&&!hard;var reason=0u;
  if(hard){reason=1u;}
  else if(!accept){reason=4u;}
  else {
    let previousDepth=textureLoad(previousDepthTex,p,0).rg;
    if(any(abs(currentDepth-previousDepth)>vec2<f32>(params.blend.y))){accept=false;reason=2u;}
    else if(currentObject!=textureLoad(previousObjectTex,p,0).x){accept=false;reason=3u;}
  }
  var value=current;
  if(hard){value=0.0;}
  else if(accept){let bounds=current_bounds(p);let previous=clamp(max(0.0,textureLoad(previousTex,p,0).x),bounds.x,bounds.y);value=mix(current,previous,params.blend.x);atomicAdd(&stats.accepted,1u);}
  else {atomicAdd(&stats.rejected,1u);if(reason==1u){atomicAdd(&stats.hardRejected,1u);}else if(reason==2u){atomicAdd(&stats.depthRejected,1u);}else if(reason==3u){atomicAdd(&stats.objectRejected,1u);}else{atomicAdd(&stats.globalRejected,1u);}}
  textureStore(nextTex,p,vec4<f32>(value,0.0,0.0,1.0));textureStore(nextDepthTex,p,vec4<f32>(currentDepth,0.0,0.0));textureStore(nextObjectTex,p,vec4<u32>(currentObject,0u,0u,0u));
}`;

  class WebGPUDarkBloomTemporal{
    constructor(options={}){
      if(!Resources)throw new Error('SteelMothWebGPUResources is required before WebGPUDarkBloomTemporal');
      if(!options.device)throw new Error('WebGPUDarkBloomTemporal requires GPUDevice');
      this.device=options.device;this.queue=options.queue||options.device.queue;this.options={...DEFAULTS,...options};this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));
      this.registry=null;this.pipelineCache=null;this.pipeline=null;this.historyIndex=0;this.historyValid=false;this.valid=false;this.closed=false;this.snapshot=null;this.generation=0;this.updateCount=0;this.dispatchCount=0;this.invalidationCount=0;this.lastInvalidationReason='uninitialized';this.lastRoomId=null;this.previousLight=null;this.previousClusterSignature=null;this.lastStats=null;this.configure(this.width,this.height);
    }
    _name(name){return`sm306:${name}`;}
    configure(width,height){
      if(this.closed)throw new Error('WebGPUDarkBloomTemporal is closed');width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));
      if(this.registry&&width===this.width&&height===this.height)return false;if(this.registry)this.registry.close();if(this.pipelineCache)this.pipelineCache.clear();this.width=width;this.height=height;
      this.registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width,height,labelPrefix:'SteelMothDarkBloomTemporal'});this.pipelineCache=this.pipelineCache||new Resources.PipelineCache(this.device,{labelPrefix:'SteelMothDarkBloomTemporal'});
      const historyUsage=textureUsage(['TEXTURE_BINDING','STORAGE_BINDING','COPY_SRC']),stateUsage=textureUsage(['TEXTURE_BINDING','STORAGE_BINDING']);
      for(const i of [0,1]){this.registry.defineTexture(this._name(`history${i}`),{format:'r32float',usage:historyUsage,size:'surface'});this.registry.defineTexture(this._name(`depth${i}`),{format:'rg32float',usage:stateUsage,size:'surface'});this.registry.defineTexture(this._name(`object${i}`),{format:'r32uint',usage:stateUsage,size:'surface'});}
      this.registry.defineBuffer(this._name('params'),{size:32,usage:bufferUsage(['UNIFORM','COPY_DST'])});this.registry.defineBuffer(this._name('stats'),{size:32,usage:bufferUsage(['STORAGE','COPY_SRC','COPY_DST'])});this.registry.defineBuffer(this._name('statsReadback'),{size:32,usage:bufferUsage(['MAP_READ','COPY_DST'])});
      this.pipeline=null;this.historyIndex=0;this.generation++;this.invalidate('configure');return true;
    }
    resize(width,height){return this.configure(width,height);}
    resetDevice(device,queue=device?.queue){if(!device)throw new Error('resetDevice requires GPUDevice');this.device=device;this.queue=queue||device.queue;if(this.registry)this.registry.close();this.registry=null;if(this.pipelineCache)this.pipelineCache.resetDevice(device);this.pipeline=null;this.generation++;this.configure(this.width,this.height);this.invalidate('device-reset');return this.generation;}
    invalidate(reason='explicit'){this.valid=false;this.historyValid=false;this.snapshot=null;this.previousLight=null;this.previousClusterSignature=null;this.lastStats=null;this.invalidationCount++;this.lastInvalidationReason=String(reason||'explicit');return this.invalidationCount;}
    async _pipeline(){if(this.pipeline)return this.pipeline;this.pipeline=await this.pipelineCache.getCompute('dark-bloom-temporal-v1',async(device,label)=>{const module=device.createShaderModule({label:`${label}:wgsl`,code:TEMPORAL_WGSL});if(typeof module.getCompilationInfo==='function'){const info=await module.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error(`SM-306 temporal WGSL compilation failed: ${errors.map(e=>e.message).join('; ')}`);}return device.createComputePipeline({label,layout:'auto',compute:{module,entryPoint:'cs_main'}});});return this.pipeline;}
    _record(name){if(!this.valid)throw new Error(`Dark Bloom temporal history is invalid: ${this.lastInvalidationReason}`);return this.registry.require(this._name(name));}
    sourceFromPaths(darkBloom,depthHierarchy,ownership,dsoHierarchy,light=null){
      if(typeof darkBloom?.bindings!=='function')throw new Error('sourceFromPaths requires SM-305 WebGPUDarkBloom');if(typeof depthHierarchy?.levelView!=='function')throw new Error('sourceFromPaths requires SM-203 WebGPUDepthHierarchy');if(typeof dsoHierarchy?.bindings!=='function'||!dsoHierarchy.snapshot)throw new Error('sourceFromPaths requires SM-304 WebGPUDSOHierarchy');
      const views=typeof ownership?._views==='function'?ownership._views():null;if(!views?.objectId)throw new Error('sourceFromPaths requires SM-202 ownership objectId view');
      return{currentResidualView:darkBloom.bindings().residual,hardMaskView:dsoHierarchy.bindings().mask,depthRangeView:depthHierarchy.levelView(0),objectIdView:views.objectId,hierarchySnapshot:dsoHierarchy.snapshot,width:dsoHierarchy.width,height:dsoHierarchy.height,roomId:dsoHierarchy.snapshot.roomId,lightState:light};
    }
    async _readStats(){const read=this.registry.require(this._name('statsReadback')).handle;await read.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint32Array(read.getMappedRange()).slice(0,8);read.unmap();const total=Math.max(1,this.width*this.height),s={accepted:raw[0],rejected:raw[1],hard:raw[2],depth:raw[3],object:raw[4],global:raw[5]};return{...s,acceptedPercent:s.accepted*100/total,rejectedPercent:s.rejected*100/total};}
    async update(source={},options={}){
      const width=Math.max(1,Math.round(source.width||this.width)),height=Math.max(1,Math.round(source.height||this.height));if(width!==this.width||height!==this.height)this.configure(width,height);
      for(const key of ['currentResidualView','hardMaskView','depthRangeView','objectIdView'])if(!source[key])throw new Error(`SM-306 update requires ${key}`);
      const roomId=String(source.roomId||source.hierarchySnapshot?.roomId||'unknown-room');if(this.lastRoomId!==null&&roomId!==this.lastRoomId)this.invalidate('room-change');
      const cfg=settings({...this.options,...options}),currentLight=lightState(source.lightState||{},source.hierarchySnapshot||null),lightDelta=lightDiscontinuity(this.previousLight,currentLight,cfg),currentClusterSignature=clusterSignature(source.clusterState||source.hierarchySnapshot||null,cfg.clusterQuantum);
      const clusterChanged=this.previousClusterSignature!==null&&currentClusterSignature!==this.previousClusterSignature;let globalReject=!this.historyValid;let resetReason=globalReject?this.lastInvalidationReason||'history-uninitialized':'';
      if(this.historyValid&&clusterChanged){globalReject=true;resetReason='cluster-discontinuity';}
      if(this.historyValid&&lightDelta.reject){globalReject=true;resetReason=lightDelta.reason;}
      const previousIndex=this.historyIndex,nextIndex=1-previousIndex,params=this.registry.require(this._name('params')).handle,stats=this.registry.require(this._name('stats')).handle,statsReadback=this.registry.require(this._name('statsReadback')).handle;
      const pb=new ArrayBuffer(32),u=new Uint32Array(pb),f=new Float32Array(pb);u[0]=width;u[1]=height;u[2]=this.historyValid?1:0;u[3]=globalReject?1:0;f[4]=cfg.historyWeight;f[5]=cfg.depthThreshold;f[6]=0;f[7]=0;this.queue.writeBuffer(params,0,new Uint8Array(pb));this.queue.writeBuffer(stats,0,new Uint32Array(8));
      const pipeline=await this._pipeline(),prevTex=this.registry.require(this._name(`history${previousIndex}`)).handle.createView(),prevDepth=this.registry.require(this._name(`depth${previousIndex}`)).handle.createView(),prevObject=this.registry.require(this._name(`object${previousIndex}`)).handle.createView(),nextTex=this.registry.require(this._name(`history${nextIndex}`)).handle.createView(),nextDepth=this.registry.require(this._name(`depth${nextIndex}`)).handle.createView(),nextObject=this.registry.require(this._name(`object${nextIndex}`)).handle.createView();
      const bind=this.device.createBindGroup({label:'SteelMothDarkBloomTemporal:bind',layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source.currentResidualView},{binding:1,resource:source.hardMaskView},{binding:2,resource:source.depthRangeView},{binding:3,resource:source.objectIdView},{binding:4,resource:prevTex},{binding:5,resource:prevDepth},{binding:6,resource:prevObject},{binding:7,resource:{buffer:params}},{binding:8,resource:nextTex},{binding:9,resource:nextDepth},{binding:10,resource:nextObject},{binding:11,resource:{buffer:stats}}]});
      const encoder=this.device.createCommandEncoder({label:'SteelMothDarkBloomTemporal:encoder'}),pass=encoder.beginComputePass({label:'SteelMothDarkBloomTemporal:stabilize'});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));pass.end();encoder.copyBufferToBuffer(stats,0,statsReadback,0,32);this.queue.submit([encoder.finish()]);if(typeof this.queue.onSubmittedWorkDone==='function'&&options.wait!==false)await this.queue.onSubmittedWorkDone();
      let statValues=null;if(options.wait!==false)statValues=await this._readStats();this.historyIndex=nextIndex;this.historyValid=true;this.valid=true;this.lastRoomId=roomId;this.previousLight=currentLight;this.previousClusterSignature=currentClusterSignature;this.lastInvalidationReason='';this.updateCount++;this.dispatchCount++;
      this.lastStats=statValues;this.snapshot={schema:SNAPSHOT_SCHEMA,roomId,width,height,historyIndex:this.historyIndex,historyWeight:cfg.historyWeight,depthThreshold:cfg.depthThreshold,clusterSignature:currentClusterSignature,lightState:currentLight,lightDelta,globalReject,resetReason,diagnostics:{...(statValues||{}),hardCoreUnsmooth:true,neighborhoodClamp:true,softHistoryOnly:true,historyAcceptedPercent:statValues?.acceptedPercent??null,historyRejectedPercent:statValues?.rejectedPercent??null}};return this.diagnostics();
    }
    bindings(){return{residual:this._record(`history${this.historyIndex}`).handle.createView(),format:'r32float',historyValid:this.historyValid,generation:this.generation};}
    async readback(){const texture=this._record(`history${this.historyIndex}`).handle,w=this.width,h=this.height,rowBytes=w*4,bytesPerRow=align(rowBytes,256),size=bytesPerRow*h,map=this.device.createBuffer({label:'SteelMothDarkBloomTemporal:readback',size,usage:bufferUsage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder({label:'SteelMothDarkBloomTemporal:readback-encoder'});encoder.copyTextureToBuffer({texture},{buffer:map,bytesPerRow,rowsPerImage:h},{width:w,height:h,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);await map.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(map.getMappedRange()),out=new Float32Array(w*h);for(let y=0;y<h;y++){const row=new DataView(raw.buffer,raw.byteOffset+y*bytesPerRow,rowBytes);for(let x=0;x<w;x++)out[y*w+x]=row.getFloat32(x*4,true);}map.unmap();map.destroy?.();return out;}
    debugOverlay(){if(!this.valid)throw new Error(`Dark Bloom temporal history is invalid: ${this.lastInvalidationReason}`);return{schema:SCHEMA,acceptedPercent:this.snapshot.diagnostics.historyAcceptedPercent,rejectedPercent:this.snapshot.diagnostics.historyRejectedPercent,resetReason:this.snapshot.resetReason,lightDelta:this.snapshot.lightDelta,clusterSignature:this.snapshot.clusterSignature,contract:'Temporal accumulation is restricted to the low-frequency Dark Bloom residual. Hard DSO/object ownership is never smoothed; history is rejected on depth, object, cluster, light, room, resize, device or explicit invalidation.'};}
    diagnostics(){return{schema:SCHEMA,valid:this.valid,historyValid:this.historyValid,generation:this.generation,roomId:this.lastRoomId,updateCount:this.updateCount,dispatchCount:this.dispatchCount,invalidationCount:this.invalidationCount,lastInvalidationReason:this.lastInvalidationReason,extent:{width:this.width,height:this.height},snapshot:this.snapshot?JSON.parse(JSON.stringify(this.snapshot)):null,resourceDiagnostics:this.registry?.diagnostics?.()||null,pipelineDiagnostics:this.pipelineCache?.diagnostics?.()||null};}
    close(){if(this.registry)this.registry.close();if(this.pipelineCache)this.pipelineCache.clear();this.registry=null;this.pipelineCache=null;this.pipeline=null;this.snapshot=null;this.valid=false;this.historyValid=false;this.closed=true;}
  }

  return{SCHEMA,SNAPSHOT_SCHEMA,DEFAULTS,TEMPORAL_WGSL,settings,normalize2,lightState,lightDiscontinuity,clusterSignature,temporalReference,rmsDelta,WebGPUDarkBloomTemporal};
});