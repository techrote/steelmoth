'use strict';

(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUPerformance=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  const SCHEMA='steelmoth-webgpu-performance/v1';
  const FRAME_SCHEMA='steelmoth-webgpu-performance-frame/v1';
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,QUERY_RESOLVE:0x0200});
  const MAP_MODE_READ=0x0001;
  const now=()=>typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now();
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const nonNegative=v=>Math.max(0,finite(v,0));
  const align=(v,m=256)=>Math.ceil(Math.max(0,Number(v)||0)/m)*m;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const usage=(name,fallback)=>Number(root?.GPUBufferUsage?.[name]??fallback);
  const percentile=(values,p)=>{
    const a=values.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!a.length)return null;
    const i=Math.min(a.length-1,Math.max(0,Math.ceil((p/100)*a.length)-1));return a[i];
  };
  const summary=values=>{
    const a=values.filter(Number.isFinite);if(!a.length)return {count:0,meanMs:null,p50Ms:null,p95Ms:null,minMs:null,maxMs:null};
    const total=a.reduce((n,v)=>n+v,0);return {count:a.length,meanMs:total/a.length,p50Ms:percentile(a,50),p95Ms:percentile(a,95),minMs:Math.min(...a),maxMs:Math.max(...a)};
  };
  const normalizeCountMap=value=>{
    const out={};for(const [k,v] of Object.entries(value||{})){if(typeof v==='number'||typeof v==='string')out[k]=nonNegative(v);else if(v&&typeof v==='object')out[k]=normalizeCountMap(v)}return out;
  };

  class WebGPUPerformanceInstrumentation{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUPerformanceInstrumentation requires GPUDevice');
      this.device=options.device;this.queue=options.queue||options.device.queue;
      if(!this.queue)throw new Error('WebGPUPerformanceInstrumentation requires GPUQueue');
      this.enabled=options.enabled!==false;this.gpuTimingEnabled=options.gpuTiming!==false;
      this.labelPrefix=String(options.labelPrefix||'SteelMothPerf');
      this.maxPasses=Math.max(1,Math.min(128,Math.round(options.maxPasses||32)));
      this.maxFrames=Math.max(1,Math.round(options.maxFrames||1200));
      this.readbackRingSize=Math.max(2,Math.min(16,Math.round(options.readbackRingSize||4)));
      this.frameSequence=0;this.frames=[];this.activeFrame=null;this.pending=new Set();this._attachments=new Set();this._closed=false;
      this._querySet=null;this._slots=[];this._slotCursor=0;
      this._timestampFeature=!!this.device.features?.has?.('timestamp-query');
      this._timestampApi=typeof this.device.createQuerySet==='function'&&typeof this.device.createBuffer==='function'&&typeof this.device.createCommandEncoder==='function';
      this.timestampSupported=!!(this.enabled&&this.gpuTimingEnabled&&this._timestampFeature&&this._timestampApi);
      this.timestampUnavailableReason=this.timestampSupported?null:(!this.enabled?'instrumentation-disabled':!this.gpuTimingEnabled?'gpu-timing-disabled':!this._timestampFeature?'timestamp-query-feature-unavailable':'timestamp-query-api-unavailable');
      if(this.timestampSupported)this._createTimestampResources();
    }
    _createTimestampResources(){
      const queryCount=this.maxPasses*2,bytes=align(queryCount*8,256);
      this._querySet=this.device.createQuerySet({label:`${this.labelPrefix}:timestamps`,type:'timestamp',count:queryCount});
      const resolveUsage=usage('QUERY_RESOLVE',FALLBACK_BUFFER_USAGE.QUERY_RESOLVE)|usage('COPY_SRC',FALLBACK_BUFFER_USAGE.COPY_SRC),readUsage=usage('COPY_DST',FALLBACK_BUFFER_USAGE.COPY_DST)|usage('MAP_READ',FALLBACK_BUFFER_USAGE.MAP_READ);
      for(let i=0;i<this.readbackRingSize;i++)this._slots.push({index:i,resolve:this.device.createBuffer({label:`${this.labelPrefix}:resolve:${i}`,size:bytes,usage:resolveUsage}),readback:this.device.createBuffer({label:`${this.labelPrefix}:readback:${i}`,size:bytes,usage:readUsage}),pending:null});
    }
    _assertOpen(){if(this._closed)throw new Error('WebGPUPerformanceInstrumentation is closed')}
    _assertFrame(){this._assertOpen();if(!this.activeFrame)throw new Error('performance frame is not active');return this.activeFrame}
    _frameRecord(label,metadata){return {schema:FRAME_SCHEMA,index:++this.frameSequence,label:String(label||`frame-${this.frameSequence}`),metadata:clone(metadata||{}),cpu:{scenePrepMs:null,encodingMs:null,phases:{}},passes:[],workload:{},memory:{texturesBytes:0,buffersBytes:0,historyBytes:0,externalBytes:0,totalEstimatedBytes:0},gpuTiming:{supported:this.timestampSupported,unavailableReason:this.timestampUnavailableReason,boundarySubmissionsPerPass:this.timestampSupported?2:0,queryCount:0,readbackPending:false},startedAtMs:now(),endedAtMs:null};}
    async beginFrame(label='',metadata={}){
      this._assertOpen();if(this.activeFrame)throw new Error('cannot begin a performance frame while another is active');
      if(!this.enabled)return null;
      const frame=this._frameRecord(label,metadata);this.activeFrame=frame;return frame;
    }
    async measureCpuPhase(name,callback){
      if(typeof callback!=='function')throw new TypeError('measureCpuPhase requires callback');
      if(!this.enabled||!this.activeFrame)return callback();
      const frame=this._assertFrame(),key=String(name||'phase'),started=now();let result;
      try{result=await callback()}finally{const ms=Math.max(0,now()-started);frame.cpu.phases[key]=(frame.cpu.phases[key]||0)+ms;if(key==='scenePrep')frame.cpu.scenePrepMs=(frame.cpu.scenePrepMs||0)+ms;if(key==='encoding')frame.cpu.encodingMs=(frame.cpu.encodingMs||0)+ms}
      return result;
    }
    recordCpuPhase(name,ms){
      if(!this.enabled||!this.activeFrame)return;const frame=this._assertFrame(),key=String(name||'phase'),value=nonNegative(ms);frame.cpu.phases[key]=(frame.cpu.phases[key]||0)+value;if(key==='scenePrep')frame.cpu.scenePrepMs=(frame.cpu.scenePrepMs||0)+value;if(key==='encoding')frame.cpu.encodingMs=(frame.cpu.encodingMs||0)+value;
    }
    _timestampBoundary(queryIndex,edge){
      const encoder=this.device.createCommandEncoder({label:`${this.labelPrefix}:${edge}:${queryIndex}`});
      const timestampWrites={querySet:this._querySet};
      if(edge==='start')timestampWrites.endOfPassWriteIndex=queryIndex;else timestampWrites.beginningOfPassWriteIndex=queryIndex;
      const pass=encoder.beginComputePass({label:`${this.labelPrefix}:timestamp-${edge}`,timestampWrites});pass.end();this.queue.submit([encoder.finish()]);
    }
    async measureGpuPass(name,callback,metadata={}){
      if(typeof callback!=='function')throw new TypeError('measureGpuPass requires callback');
      if(!this.enabled||!this.activeFrame)return callback();
      const frame=this._assertFrame();if(frame.passes.length>=this.maxPasses)throw new RangeError(`performance pass count exceeds maxPasses ${this.maxPasses}`);
      const passIndex=frame.passes.length,queryStart=passIndex*2,queryEnd=queryStart+1,record={name:String(name||`pass-${passIndex}`),metadata:clone(metadata||{}),cpuCallbackMs:null,gpuMs:null,gpuAvailable:this.timestampSupported,queryStart:this.timestampSupported?queryStart:null,queryEnd:this.timestampSupported?queryEnd:null};frame.passes.push(record);
      if(this.timestampSupported)this._timestampBoundary(queryStart,'start');
      const started=now();let result;
      try{result=await callback()}finally{record.cpuCallbackMs=Math.max(0,now()-started);if(this.timestampSupported)this._timestampBoundary(queryEnd,'end')}
      return result;
    }
    setWorkload(counts={}){if(!this.enabled||!this.activeFrame)return;this._assertFrame().workload=normalizeCountMap(counts)}
    setMemory(memory={}){
      if(!this.enabled||!this.activeFrame)return;const frame=this._assertFrame(),m={texturesBytes:nonNegative(memory.texturesBytes),buffersBytes:nonNegative(memory.buffersBytes),historyBytes:nonNegative(memory.historyBytes),externalBytes:nonNegative(memory.externalBytes)};m.totalEstimatedBytes=m.texturesBytes+m.buffersBytes+m.historyBytes+m.externalBytes;frame.memory=m;
    }
    recordRegistryMemory(registryDiagnostics,options={}){
      if(!this.enabled||!this.activeFrame)return null;const resources=Array.from(registryDiagnostics?.resources||[]),historyNames=new Set((options.historyNames||[]).map(String));let textures=0,buffers=0,history=0;
      for(const r of resources){const bytes=nonNegative(r?.estimatedBytes),isHistory=historyNames.has(String(r?.name))||/history|temporal/i.test(String(r?.lifetime||''));if(isHistory)history+=bytes;else if(r?.kind==='texture')textures+=bytes;else if(r?.kind==='buffer')buffers+=bytes}
      this.setMemory({texturesBytes:textures,buffersBytes:buffers,historyBytes:history,externalBytes:options.externalBytes||0});return clone(this.activeFrame.memory);
    }
    attachFrameGraph(graph,options={}){
      this._assertOpen();if(!graph?.passes||typeof graph.passes.values!=='function')throw new Error('attachFrameGraph requires Steel Moth FrameGraph');
      if(!this.enabled)return ()=>{};
      const filter=typeof options.passFilter==='function'?options.passFilter:()=>true,wrapped=[];
      for(const pass of graph.passes.values()){
        if(!filter(pass)||pass.__smPerformanceWrapped)continue;const original=pass.execute,perf=this;pass.execute=async function(context){return perf.measureGpuPass(pass.name,()=>original.call(this,context),{reads:[...(pass.reads||[])],writes:[...(pass.writes||[])]})};pass.__smPerformanceWrapped=true;pass.__smPerformanceOriginal=original;wrapped.push(pass);
      }
      const detach=()=>{for(const pass of wrapped){if(pass.__smPerformanceOriginal){pass.execute=pass.__smPerformanceOriginal;delete pass.__smPerformanceOriginal;delete pass.__smPerformanceWrapped}}this._attachments.delete(detach)};this._attachments.add(detach);return detach;
    }
    async _acquireSlot(){
      const slot=this._slots[this._slotCursor++%this._slots.length];if(slot.pending)await slot.pending;return slot;
    }
    async endFrame(){
      if(!this.enabled)return null;const frame=this._assertFrame();this.activeFrame=null;frame.endedAtMs=now();
      if(!this.timestampSupported||!frame.passes.length){frame.gpuTiming.queryCount=0;this._commitFrame(frame);return frame}
      const used=frame.passes.length*2,slot=await this._acquireSlot(),encoder=this.device.createCommandEncoder({label:`${this.labelPrefix}:resolve:${frame.index}`});encoder.resolveQuerySet(this._querySet,0,used,slot.resolve,0);encoder.copyBufferToBuffer(slot.resolve,0,slot.readback,0,align(used*8,8));this.queue.submit([encoder.finish()]);frame.gpuTiming.queryCount=used;frame.gpuTiming.readbackPending=true;this._commitFrame(frame);
      const pending=this._readbackFrame(slot,frame,used);slot.pending=pending;this.pending.add(pending);pending.finally(()=>{this.pending.delete(pending);if(slot.pending===pending)slot.pending=null});return frame;
    }
    async _readbackFrame(slot,frame,used){
      await slot.readback.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ),0,align(used*8,8));
      const bytes=slot.readback.getMappedRange(0,align(used*8,8));const copy=bytes.slice?bytes.slice(0):new Uint8Array(bytes).slice().buffer;const values=new BigUint64Array(copy);slot.readback.unmap();
      for(let i=0;i<frame.passes.length;i++){const start=values[i*2],end=values[i*2+1];frame.passes[i].gpuMs=end>=start?Number(end-start)/1e6:null}
      frame.gpuTiming.readbackPending=false;return frame;
    }
    _commitFrame(frame){this.frames.push(frame);if(this.frames.length>this.maxFrames)this.frames.splice(0,this.frames.length-this.maxFrames)}
    async flush(){await Promise.allSettled(Array.from(this.pending));return this.diagnostics()}
    diagnostics(){
      const frames=clone(this.frames),passNames=Array.from(new Set(frames.flatMap(f=>f.passes.map(p=>p.name)))).sort(),gpuPasses={};for(const name of passNames)gpuPasses[name]=summary(frames.map(f=>f.passes.find(p=>p.name===name)?.gpuMs));
      return {schema:SCHEMA,enabled:this.enabled,gpuTiming:{requested:this.gpuTimingEnabled,featureAvailable:this._timestampFeature,apiAvailable:this._timestampApi,supported:this.timestampSupported,unavailableReason:this.timestampUnavailableReason,boundaryMethod:'empty-compute-pass timestampWrites around queued pass submissions',boundarySubmissionsPerGpuPass:this.timestampSupported?2:0,maxPasses:this.maxPasses,readbackRingSize:this.timestampSupported?this.readbackRingSize:0,pendingFrames:this.pending.size},frameCount:frames.length,latestFrame:frames.length?frames[frames.length-1]:null,summary:{cpuScenePrep:summary(frames.map(f=>f.cpu.scenePrepMs)),cpuEncoding:summary(frames.map(f=>f.cpu.encodingMs)),gpuPasses},frames};
    }
    exportJSON(space=2){return JSON.stringify(this.diagnostics(),null,space)}
    async close(){if(this._closed)return;await this.flush();for(const detach of Array.from(this._attachments))detach();try{this._querySet?.destroy?.()}catch(_e){}for(const slot of this._slots){try{slot.resolve?.destroy?.()}catch(_e){}try{slot.readback?.destroy?.()}catch(_e){}}this._slots=[];this._querySet=null;this._closed=true}
  }

  return {SCHEMA,FRAME_SCHEMA,WebGPUPerformanceInstrumentation,summary,percentile};
});
