'use strict';

(function(root,factory){
  const Base=root?.SteelMothWebGPUGTAOStabilization||
    ((typeof module==='object'&&module.exports)?require('./webgpu_gtao_stabilization.js'):null);
  const api=factory(Base,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUGTAOReadback=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Base,root){
  if(!Base)throw new Error('SM-601 stabilization must be loaded before its readback adapter');
  const SCHEMA='steelmoth-sm601-deferred-readback/v1';
  const COUNTER_MODES=Object.freeze(['baseline','aggregated']);
  const BASELINE_TEMPORAL_WGSL_SHA256='7241992d96d014e996eb826779f2f9f6b4c3360979120d7fee780502b07f00cc';
  const AGGREGATED_TEMPORAL_WGSL_SHA256='11024a2f13f20abda1dee7cdc1a6d6703ecfc1982929ed51ccaa7b071579acf7';
  // Exact measured counter variant. Only diagnostic atomics/barriers differ; pixel math is unchanged.
  const AGGREGATED_TEMPORAL_WGSL=`
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
@group(0) @binding(13) var<storage,read_write> stats:Stats;
fn bounds(p:vec2i)->vec2f{var lo=1.0;var hi=0.0;for(var oy:i32=-1;oy<=1;oy++){for(var ox:i32=-1;ox<=1;ox++){let q=p+vec2i(ox,oy);if(q.x<0||q.y<0||q.x>=i32(params.extent.x)||q.y>=i32(params.extent.y)){continue;}let v=clamp(textureLoad(currentVis,q,0).x,0.0,1.0);lo=min(lo,v);hi=max(hi,v);}}return vec2f(lo,hi);}
fn normalAt(t:texture_2d<f32>,p:vec2i)->vec3f{let n=textureLoad(t,p,0).xyz*2.0-1.0;return normalize(select(vec3f(0,0,1),n,length(n)>0.00001));}
var<workgroup> localStats:array<atomic<u32>,6>;
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u, @builtin(local_invocation_index) lane:u32){
  if(lane<6u){atomicStore(&localStats[lane],0u);}
  workgroupBarrier();
  if(gid.x<params.extent.x&&gid.y<params.extent.y){let p=vec2i(gid.xy);let cur=clamp(textureLoad(currentVis,p,0).x,0.0,1.0);let d=textureLoad(currentDepth,p,0).rg;let o=textureLoad(currentObject,p,0).x;let n=textureLoad(currentNormal,p,0);
  var accept=params.extent.z!=0u&&params.extent.w==0u;var reason=0u;
  if(!accept){reason=4u;}else if(o!=textureLoad(previousObject,p,0).x){accept=false;reason=2u;}else{let pd=textureLoad(previousDepth,p,0).rg;if(any(abs(d-pd)>vec2f(params.blend.y))){accept=false;reason=1u;}else{let a=normalAt(currentNormal,p);let b=normalAt(previousNormal,p);if(dot(a,b)<params.blend.z){accept=false;reason=3u;}}}
  var value=cur;if(accept){let b=bounds(p);let pv=textureLoad(previousVis,p,0).x;let bounded=clamp(pv,max(b.x,cur-params.blend.w),min(b.y,cur+params.blend.w));value=mix(cur,bounded,params.blend.x);atomicAdd(&localStats[0],1u);}else{atomicAdd(&localStats[1],1u);if(reason==1u){atomicAdd(&localStats[2],1u);}else if(reason==2u){atomicAdd(&localStats[3],1u);}else if(reason==3u){atomicAdd(&localStats[4],1u);}else{atomicAdd(&localStats[5],1u);}}
  textureStore(nextVis,p,vec4f(value,0,0,1));textureStore(nextDepth,p,vec4f(d,0,0));textureStore(nextObject,p,vec4u(o,0,0,0));textureStore(nextNormal,p,vec4f(n.xyz,select(1.0,0.0,accept)));
  }
  workgroupBarrier();
  if(lane==0u){let n=atomicLoad(&localStats[0]);if(n!=0u){atomicAdd(&stats.accepted,n);}}
  if(lane==1u){let n=atomicLoad(&localStats[1]);if(n!=0u){atomicAdd(&stats.rejected,n);}}
  if(lane==2u){let n=atomicLoad(&localStats[2]);if(n!=0u){atomicAdd(&stats.depthRejected,n);}}
  if(lane==3u){let n=atomicLoad(&localStats[3]);if(n!=0u){atomicAdd(&stats.objectRejected,n);}}
  if(lane==4u){let n=atomicLoad(&localStats[4]);if(n!=0u){atomicAdd(&stats.normalRejected,n);}}
  if(lane==5u){let n=atomicLoad(&localStats[5]);if(n!=0u){atomicAdd(&stats.globalRejected,n);}}
}`;
  function counterMode(value='baseline'){if(!COUNTER_MODES.includes(value))throw new RangeError('counterMode must be baseline or aggregated');return value;}
  const STATS_BYTES=32;
  const MODES=Object.freeze(['blocking','deferred']);
  const now=()=>root?.performance?.now?.()??Date.now();
  function mode(value='blocking'){
    if(!MODES.includes(value))throw new RangeError('statsMode must be blocking or deferred');
    return value;
  }
  function capacity(value=3){
    if(!Number.isInteger(value)||value<1||value>8)throw new RangeError('statsSlots must be an integer in 1..8');
    return value;
  }
  function counts(words,frame){
    if(words.length!==8||words[6]!==0||words[7]!==0||
       words[0]+words[1]!==frame.width*frame.height||
       words[2]+words[3]+words[4]+words[5]!==words[1])
      throw new Error('SM-601 diagnostic counters do not match the submitted frame extent');
    return{accepted:words[0],rejected:words[1],depthRejected:words[2],
      objectRejected:words[3],normalRejected:words[4],globalRejected:words[5]};
  }

  // Buffers are owned by the production ResourceRegistry, not this scheduler.
  // Never reuse a slot until its map AND unmap have completed. Promise ordering
  // across different GPUBuffer objects is deliberately not assumed.
  class StatsReadbackRing{
    constructor(buffers,epoch=0){
      capacity(buffers.length);
      this.slots=buffers.map(buffer=>({buffer,state:'idle',task:null,frame:null}));
      this.epoch=epoch;this.closed=false;this.latest=null;this.completed=[];
      this.totals={requested:0,submitted:0,completed:0,skipped:0,failed:0,stale:0,evicted:0};
      this.lastError=null;this.lastSkippedFrame=null;
    }
    acquire(frame){
      if(this.closed)throw new Error('SM-601 readback ring is closed');
      const slot=this.slots.find(s=>s.state==='idle');
      if(slot){slot.state='reserved';slot.frame=Object.freeze({...frame});}
      return slot||null;
    }
    skip(frame){this.totals.requested++;this.totals.skipped++;this.lastSkippedFrame={...frame};}
    release(slot){if(slot?.state==='reserved'){slot.state='idle';slot.frame=null;}}
    pending(){return this.slots.filter(s=>s.task).map(s=>s.task);}
    async available(){
      while(!this.closed&&!this.slots.some(s=>s.state==='idle')){
        const pending=this.pending();
        if(!pending.length)throw new Error('SM-601 readback ring has no usable slots');
        await Promise.race(pending);
      }
      if(this.closed)throw new Error('SM-601 readback ring was closed while waiting');
    }
    start(slot){
      if(this.closed||slot?.state!=='reserved')throw new Error('SM-601 readback requires a reserved slot');
      const frame=slot.frame,buffer=slot.buffer,started=now();
      slot.state='pending';this.totals.requested++;this.totals.submitted++;
      // Deferral also makes synchronous mapAsync throws enter the same handler.
      const task=Promise.resolve().then(()=>{
        if(this.closed||frame.epoch!==this.epoch)throw new Error('readback cancelled before mapping');
        return buffer.mapAsync(Number(root?.GPUMapMode?.READ??1),0,STATS_BYTES);
      })
        .then(()=>{
          if(this.closed||frame.epoch!==this.epoch){this.totals.stale++;return{status:'stale',frame};}
          const words=Array.from(new Uint32Array(buffer.getMappedRange(0,STATS_BYTES).slice(0)));
          const result={status:'complete',frame,stats:counts(words,frame),words,
            mapLatencyCpuMs:Math.max(0,now()-started)};
          this.totals.completed++;
          if(!this.latest||frame.frameId>this.latest.frame.frameId)this.latest=result;
          if(this.completed.length===this.slots.length){this.completed.shift();this.totals.evicted++;}
          this.completed.push(result);
          return result;
        }).catch(error=>{
          if(this.closed||frame.epoch!==this.epoch){this.totals.stale++;return{status:'stale',frame};}
          this.totals.failed++;this.lastError={frame,message:String(error?.message||error).slice(0,512)};
          return{status:'failed',frame,error:this.lastError.message};
        }).finally(()=>{
          // The mapping may have been cancelled by invalidate/close/device loss.
          // Failure to unmap retires the slot instead of risking mapped reuse.
          let reusable=!this.closed;
          try{buffer.unmap();}catch(_error){reusable=false;}
          slot.state=reusable?'idle':'retired';slot.frame=null;slot.task=null;
        });
      slot.task=task;return task;
    }
    invalidate(epoch){
      this.epoch=epoch;this.latest=null;this.completed=[];this.lastError=null;this.lastSkippedFrame=null;
      for(const slot of this.slots){
        if(slot.state==='reserved')this.release(slot);
        else if(slot.state==='pending'){try{slot.buffer.unmap();}catch(_error){/* finalizer retires if needed */}}
      }
    }
    close(){if(this.closed)return;this.closed=true;this.invalidate(this.epoch+1);}
    takeCompleted(){return this.completed.splice(0).map(r=>({...r,frame:{...r.frame},stats:{...r.stats},words:[...r.words]}));}
    async flush(){await Promise.all(this.pending());return this.diagnostics();}
    diagnostics(){return{schema:SCHEMA,capacity:this.slots.length,allocatedBytes:this.slots.length*STATS_BYTES,
      pending:this.slots.filter(s=>s.state==='pending').length,
      reserved:this.slots.filter(s=>s.state==='reserved').length,
      retired:this.slots.filter(s=>s.state==='retired').length,
      retainedResults:this.completed.length,epoch:this.epoch,closed:this.closed,
      ...this.totals,lastError:this.lastError?{...this.lastError,frame:{...this.lastError.frame}}:null,
      lastSkippedFrame:this.lastSkippedFrame?{...this.lastSkippedFrame}:null};}
  }

  // Bounded production producer. Original stabilization class remains unchanged.
  // Defaults preserve blocking delivery and baseline counters; adoption callers opt in explicitly.
  class WebGPUGTAOTemporal extends Base.WebGPUGTAOTemporal{
    constructor(options={}){
      const selected=mode(options.statsMode??'blocking'),slots=capacity(options.statsSlots??3),counters=counterMode(options.counterMode??'baseline');
      super(options);
      Object.defineProperty(this,'counterMode',{value:counters,enumerable:true});
      this.statsMode=selected;Object.defineProperty(this,'statsSlots',{value:slots,enumerable:true});this._busy=false;this._sequence=0;
      this._lastStatsFrame=null;this._ring=null;this._ringRegistry=null;this._lost=false;
      this._watchDevice();
    }
    _watchDevice(){
      const device=this.device,watch=(this._watchId||0)+1;this._watchId=watch;
      if(device.lost&&typeof device.lost.then==='function'){
        const lost=()=>{if(!this.closed&&this.device===device&&this._watchId===watch){this._lost=true;this.invalidate('device-lost');}};
        Promise.resolve(device.lost).then(lost,lost);
      }
    }
    _resetStats(){
      this._epoch=(this._epoch||0)+1;this.lastStats=null;this._lastStatsFrame=null;
      if(this._ring){
        if(this._ringRegistry!==this.registry){this._ring.close();this._ring=null;this._ringRegistry=null;}
        else this._ring.invalidate(this._epoch);
      }
    }
    invalidate(reason='explicit'){const result=super.invalidate(reason);this._resetStats();return result;}
    resetDevice(device,queue=device?.queue){
      const result=super.resetDevice(device,queue);this._lost=false;this._watchDevice();return result;
    }
    _statsRing(){
      if(!this._ring){
        const buffers=[this.registry.require(this._name('statsReadback')).handle];
        for(let i=1;i<this.statsSlots;i++){
          const name=this._name(`statsReadback${i}`);
          this.registry.defineBuffer(name,{size:STATS_BYTES,usage:9}); // MAP_READ | COPY_DST
          buffers.push(this.registry.require(name).handle);
        }
        this._ring=new StatsReadbackRing(buffers,this._epoch);this._ringRegistry=this.registry;
      }
      return this._ring;
    }
    _refreshStats(){
      const result=this._ring?.latest;
      if(result&&result.frame.epoch===this._epoch&&
         (!this._lastStatsFrame||result.frame.frameId>this._lastStatsFrame.frameId)){
        this.lastStats={...result.stats};this._lastStatsFrame={...result.frame,mapLatencyCpuMs:result.mapLatencyCpuMs};
      }
    }
    _assertCurrent(registry,epoch){
      if(this.closed||this._lost||this.registry!==registry||this._epoch!==epoch)
        throw new Error('SM-601 update invalidated by lifecycle change');
    }
    async _pipeline(){
      if(this.pipeline)return this.pipeline;
      const device=this.device,generation=this.generation;
      const pipeline=await this.pipelines.getCompute(`gtao-temporal-v2:${this.counterMode}`,async(d,label)=>{
        const module=d.createShaderModule({label:`${label}:wgsl`,code:this.counterMode==='aggregated'?AGGREGATED_TEMPORAL_WGSL:Base.TEMPORAL_WGSL});
        if(typeof module.getCompilationInfo==='function'){
          const info=await module.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
          if(errors.length)throw new Error(`SM-601 WGSL compilation failed: ${errors.map(e=>e.message).join('; ')}`);
        }
        return d.createComputePipeline({label,layout:'auto',compute:{module,entryPoint:'cs_main'}});
      });
      if(this.closed||this._lost||this.device!==device||this.generation!==generation)
        throw new Error('SM-601 pipeline invalidated by lifecycle change');
      this.pipeline=pipeline;return pipeline;
    }
    async update(source={},options={}){
      const selected=mode(options.statsMode??this.statsMode);
      if(this.closed||this._lost)throw new Error('SM-601 temporal producer is closed or device-lost');
      if(this._busy)throw new Error('SM-601 concurrent updates are not supported; await submission before the next frame');
      this._busy=true;let slot=null,ring=null,submitted=false;
      try{
        const width=Math.max(1,Math.round(source.width||this.width)),height=Math.max(1,Math.round(source.height||this.height));
        if(width!==this.width||height!==this.height)this.configure(width,height);
        for(const key of ['currentVisibilityView','currentDepthView','currentObjectView','currentNormalView'])
          if(!source[key])throw new Error(`SM-601 update requires ${key}`);
        const registry=this.registry,initialEpoch=this._epoch;
        await this._pipeline();this._assertCurrent(registry,initialEpoch);
        const quality=Base.resolveQuality(options.quality||this.quality,options),cfg=quality.temporal;
        const meta={...(options.meta||{})},global=Base.globalDiscontinuity(this.previousMeta,meta);
        if(global.reject||quality.name!==this.quality)this._resetStats();
        const epoch=this._epoch;
        if(this._sequence>=Number.MAX_SAFE_INTEGER)throw new RangeError('SM-601 frame sequence exhausted');
        const frame=Object.freeze({frameId:this._sequence+1,epoch,generation:this.generation,width,height,
          quality:quality.name,roomId:String(meta.roomId??''),deviceGeneration:String(meta.deviceGeneration??''),
          backendGeneration:String(meta.backendGeneration??'')});
        ring=this._statsRing();slot=ring.acquire(frame);
        if(!slot&&selected==='blocking'){
          await ring.available();this._assertCurrent(registry,epoch);slot=ring.acquire(frame);
        }
        const params=registry.require(this._name('params')).handle,stats=registry.require(this._name('stats')).handle;
        this.queue.writeBuffer(params,0,Base.parameterBytes(width,height,this.historyValid&&cfg.enabled,global.reject,cfg));
        this.queue.writeBuffer(stats,0,new Uint32Array(8));
        const prev=this.historyIndex,next=1-prev,pipeline=this.pipeline;
        const view=name=>registry.require(this._name(name)).handle.createView();
        const bind=this.device.createBindGroup({label:'SteelMothGTAOReadback:bind',layout:pipeline.getBindGroupLayout(0),entries:[
          {binding:0,resource:source.currentVisibilityView},{binding:1,resource:source.currentDepthView},
          {binding:2,resource:source.currentObjectView},{binding:3,resource:source.currentNormalView},
          {binding:4,resource:view(`vis${prev}`)},{binding:5,resource:view(`depth${prev}`)},
          {binding:6,resource:view(`object${prev}`)},{binding:7,resource:view(`normal${prev}`)},
          {binding:8,resource:{buffer:params}},{binding:9,resource:view(`vis${next}`)},
          {binding:10,resource:view(`depth${next}`)},{binding:11,resource:view(`object${next}`)},
          {binding:12,resource:view(`normal${next}`)},{binding:13,resource:{buffer:stats}}]});
        const encoder=this.device.createCommandEncoder({label:'SteelMothGTAOReadback:encoder'});
        const pass=encoder.beginComputePass({label:'SteelMothGTAOReadback:temporal'});
        pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));pass.end();
        if(slot)encoder.copyBufferToBuffer(stats,0,slot.buffer,0,STATS_BYTES);
        this.queue.submit([encoder.finish()]);submitted=true;
        const completion=slot?ring.start(slot):null;
        if(!slot)ring.skip(frame);
        // GPU queue order, not diagnostic-map completion, owns history progress.
        this._sequence=frame.frameId;this.historyIndex=next;this.historyValid=cfg.enabled;
        this.valid=true;this.previousMeta=meta;this.quality=quality.name;this.updateCount++;
        this.lastInvalidationReason='';this._lastMode=selected;
        if(options.wait!==false&&typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();
        if(selected==='blocking'){
          const result=await completion;
          if(result?.status!=='complete')throw new Error(`SM-601 diagnostic readback ${result?.status}: ${result?.error||'lifecycle changed'}`);
        }
        this._assertCurrent(registry,epoch);return this.diagnostics();
      }finally{
        if(slot&&!submitted)ring.release(slot);
        this._busy=false;
      }
    }
    async flushStats(){const ring=this._ring;if(ring)await ring.flush();return this.diagnostics();}
    takeCompletedStats(){return this._ring?.takeCompleted()||[];}
    diagnostics(){
      this._refreshStats();const result=super.diagnostics();
      return{...result,counterMode:this.counterMode||'baseline',counterShaderSha256:this.counterMode==='aggregated'?AGGREGATED_TEMPORAL_WGSL_SHA256:BASELINE_TEMPORAL_WGSL_SHA256,readback:{schema:SCHEMA,mode:this._lastMode||this.statsMode||'blocking',
        frameId:this._sequence||0,epoch:this._epoch||0,lastStatsFrame:this._lastStatsFrame?{...this._lastStatsFrame}:null,
        statsForCurrentFrame:!!this._lastStatsFrame&&this._lastStatsFrame.frameId===this._sequence,
        overflowPolicy:'skip-new-diagnostic-copy-with-counter; never stall deferred rendering',
        completionPolicy:'bounded latest results; count evictions; monotonically publish latest frame',
        ring:this._ring?.diagnostics()||null}};
    }
    close(){
      this._watchId=(this._watchId||0)+1;this._epoch=(this._epoch||0)+1;
      this._ring?.close();this.lastStats=null;this._lastStatsFrame=null;super.close();
    }
  }
  return{SCHEMA,STATS_BYTES,MODES,COUNTER_MODES,BASELINE_TEMPORAL_WGSL_SHA256,AGGREGATED_TEMPORAL_WGSL_SHA256,AGGREGATED_TEMPORAL_WGSL,counterMode,StatsReadbackRing,WebGPUGTAOTemporal};
});
