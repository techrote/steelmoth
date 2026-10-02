'use strict';
const assert=require('assert');
const Infra=require('../engine/webgpu_resources.js');
const Perf=require('../engine/webgpu_performance.js');

function makeDevice(options={}){
  let serial=0,clock=1_000_000n;
  const calls={querySets:0,buffers:0,submits:0,timestampPasses:0,push:0,pop:0,resolves:[],copies:[]};
  const features=new Set(options.features||[]);
  const buffer=desc=>({id:++serial,desc,bytes:new ArrayBuffer(desc.size),async mapAsync(){},getMappedRange(offset=0,size=desc.size){return this.bytes.slice(offset,offset+size)},unmap(){},destroy(){}});
  const queue={
    submit(commandBuffers){calls.submits++;for(const commandBuffer of commandBuffers||[])for(const op of commandBuffer.ops||[]){
      if(op.type==='timestamp'){op.query.values[op.index]=clock;clock+=1_000n}
      else if(op.type==='resolve'){const view=new DataView(op.buffer.bytes);for(let i=0;i<op.count;i++)view.setBigUint64(op.offset+i*8,op.query.values[op.first+i]||0n,true)}
      else if(op.type==='copy'){new Uint8Array(op.dst.bytes,op.dstOffset,op.size).set(new Uint8Array(op.src.bytes,op.srcOffset,op.size))}
      else if(op.type==='work')clock+=BigInt(op.ns);
    }},
    writeBuffer(){}
  };
  const device={features,queue,
    createQuerySet(desc){calls.querySets++;return {desc,values:Array(desc.count).fill(0n),destroy(){}}},
    createBuffer(desc){calls.buffers++;return buffer(desc)},
    createCommandEncoder(){const ops=[];return {
      beginComputePass(desc={}){calls.timestampPasses++;const t=desc.timestampWrites||{};return {end(){if(t.beginningOfPassWriteIndex!=null)ops.push({type:'timestamp',query:t.querySet,index:t.beginningOfPassWriteIndex});if(t.endOfPassWriteIndex!=null)ops.push({type:'timestamp',query:t.querySet,index:t.endOfPassWriteIndex})}}},
      resolveQuerySet(query,first,count,destination,offset){assert(Number.isSafeInteger(offset)&&offset>=0&&offset%256===0,'resolveQuerySet destinationOffset must be a multiple of 256');assert(Number.isSafeInteger(first)&&first>=0&&first<query.desc.count&&Number.isSafeInteger(count)&&count>=0&&first+count<=query.desc.count,'resolveQuerySet query range exceeds query set');assert(destination.desc.usage&0x0200,'resolveQuerySet destination requires QUERY_RESOLVE usage');assert(offset+count*8<=destination.desc.size,'resolveQuerySet range exceeds destination buffer');calls.resolves.push({first,count,offset,size:destination.desc.size,bufferId:destination.id});ops.push({type:'resolve',query,first,count,buffer:destination,offset})},
      copyBufferToBuffer(src,srcOffset,dst,dstOffset,size){assert([srcOffset,dstOffset,size].every(v=>Number.isSafeInteger(v)&&v>=0&&v%4===0),'copyBufferToBuffer offsets/size must be aligned');assert(srcOffset+size<=src.desc.size&&dstOffset+size<=dst.desc.size,'copyBufferToBuffer range exceeds buffer');calls.copies.push({size,srcId:src.id,dstId:dst.id});ops.push({type:'copy',src,srcOffset,dst,dstOffset,size})},
      finish(){return {ops}}
    }},
    pushErrorScope(){calls.push++},async popErrorScope(){calls.pop++;return null}
  };
  return {device,queue,calls,submitGpuWork(ns){queue.submit([{ops:[{type:'work',ns}]}])},gpuWork(ns){return {ops:[{type:'work',ns}]}},advanceGpuClock(ns){clock+=BigInt(ns)}};
}

async function supportedTimestampPath(){
  const env=makeDevice({features:['timestamp-query']});
  const graph=new Infra.FrameGraph({device:env.device,labelPrefix:'SM500TestGraph'});
  graph.addPass({name:'gbuffer',writes:['g0'],execute(){env.submitGpuWork(2_000_000)}});
  graph.addPass({name:'lighting',after:['gbuffer'],reads:['g0'],writes:['lit'],execute(){env.submitGpuWork(3_000_000)}});
  graph.addPass({name:'dso',after:['lighting'],reads:['lit'],writes:['visibility'],execute(){env.submitGpuWork(1_500_000)}});
  graph.addPass({name:'dark-bloom',after:['dso'],reads:['visibility'],writes:['bloom'],execute(){env.submitGpuWork(750_000)}});
  graph.addPass({name:'post',after:['dark-bloom'],reads:['bloom'],execute(){env.submitGpuWork(500_000)}});
  const perf=new Perf.WebGPUPerformanceInstrumentation({device:env.device,maxPasses:8,readbackRingSize:2,maxFrames:16,labelPrefix:'SM500Test'});
  perf.attachFrameGraph(graph);
  await perf.beginFrame('dense-bin-overlap',{scene:'binsup'});
  perf.recordCpuPhase('scenePrep',1.25);perf.recordCpuPhase('encoding',.75);
  perf.setWorkload({instances:84,visibleInstances:79,staticInstances:38,dynamicInstances:31,foregroundInstances:10,activeLights:4,selfShadowedLights:3,occluders:18,clusters:6,largestCluster:7,selfShadowSamples:16,contactShadowSamples:8,dsoTiles:42,dsoPixels:3100,secondaryEffects:{darkBloom:{width:640,height:360},contact:{width:640,height:360}}});
  perf.setMemory({texturesBytes:24*1024*1024,buffersBytes:3*1024*1024,historyBytes:4*1024*1024,externalBytes:512*1024});
  await graph.execute({});await perf.endFrame();await perf.flush();
  const d=perf.diagnostics(),frame=d.latestFrame;
  assert.equal(d.schema,'steelmoth-webgpu-performance/v1');assert.equal(d.gpuTiming.supported,true);assert.equal(d.gpuTiming.boundarySubmissionsPerGpuPass,2);assert.equal(frame.passes.length,5);assert.deepEqual(frame.passes.map(p=>p.name),['gbuffer','lighting','dso','dark-bloom','post']);
  const timings=Object.fromEntries(frame.passes.map(p=>[p.name,p.gpuMs]));assert(timings.gbuffer>=2&&timings.lighting>=3&&timings.dso>=1.5&&timings['dark-bloom']>=.75&&timings.post>=.5,'timestamp ordering must bracket queued pass work');
  assert.equal(frame.cpu.scenePrepMs,1.25);assert.equal(frame.cpu.encodingMs,.75);assert.equal(frame.workload.dsoTiles,42);assert.equal(frame.workload.secondaryEffects.darkBloom.width,640);assert.equal(frame.memory.historyBytes,4*1024*1024);assert.equal(frame.memory.totalEstimatedBytes,31.5*1024*1024);
  assert.equal(d.summary.gpuPasses.gbuffer.count,1);assert.equal(JSON.parse(perf.exportJSON()).latestFrame.workload.instances,84);assert.equal(env.calls.querySets,1);assert.equal(env.calls.timestampPasses,10);
  await perf.close();
}

async function unavailableTimestampPath(){
  const env=makeDevice();const graph=new Infra.FrameGraph({device:env.device});graph.addPass({name:'gbuffer',execute(){env.submitGpuWork(1_000_000)}});
  const perf=new Perf.WebGPUPerformanceInstrumentation({device:env.device,maxPasses:4});perf.attachFrameGraph(graph);await perf.beginFrame('no-timestamp');perf.recordCpuPhase('scenePrep',.5);perf.recordCpuPhase('encoding',.25);perf.setWorkload({instances:2,activeLights:1});perf.setMemory({texturesBytes:1024,buffersBytes:256,historyBytes:128});await graph.execute({});await perf.endFrame();await perf.flush();const d=perf.diagnostics();
  assert.equal(d.gpuTiming.supported,false);assert.equal(d.gpuTiming.unavailableReason,'timestamp-query-feature-unavailable');assert.equal(d.latestFrame.passes[0].gpuMs,null,'unavailable timestamp-query must never fabricate a GPU time');assert.equal(d.latestFrame.passes[0].gpuAvailable,false);assert.equal(d.latestFrame.cpu.scenePrepMs,.5);assert.equal(d.latestFrame.memory.totalEstimatedBytes,1408);assert.equal(env.calls.querySets,0);await perf.close();
}

async function disabledInstrumentationPath(){
  const env=makeDevice({features:['timestamp-query']});const graph=new Infra.FrameGraph({device:env.device});let executions=0;graph.addPass({name:'pass',execute(){executions++}});const original=graph.passes.get('pass').execute;
  const perf=new Perf.WebGPUPerformanceInstrumentation({device:env.device,enabled:false});const detach=perf.attachFrameGraph(graph);assert.strictEqual(graph.passes.get('pass').execute,original,'disabled instrumentation must not wrap pass callbacks');await graph.execute({});assert.equal(executions,1);assert.equal(env.calls.querySets,0);assert.equal(env.calls.buffers,0);detach();await perf.close();
}

async function registryMemoryAccounting(){
  const env=makeDevice();const perf=new Perf.WebGPUPerformanceInstrumentation({device:env.device,gpuTiming:false});await perf.beginFrame('memory');const memory=perf.recordRegistryMemory({resources:[{name:'g0',kind:'texture',estimatedBytes:4096},{name:'instance-buffer',kind:'buffer',estimatedBytes:1024},{name:'dark-bloom-history',kind:'texture',lifetime:'temporal-history',estimatedBytes:2048}]},{externalBytes:512});assert.deepEqual(memory,{texturesBytes:4096,buffersBytes:1024,historyBytes:2048,externalBytes:512,totalEstimatedBytes:7680});await perf.endFrame();await perf.close();
}

async function commandSpanExcludesHostGap(){
  const env=makeDevice({features:['timestamp-query']});
  const perf=new Perf.WebGPUPerformanceInstrumentation({device:env.device,maxPasses:4,maxCommandSpansPerPass:4,readbackRingSize:2,maxFrames:8});
  await perf.beginFrame('host-gap');
  await perf.measureGpuPass('mixed',async scope=>{
    scope.submit([env.gpuWork(2_000_000)],{label:'first'});
    env.advanceGpuClock(9_000_000);scope.recordHostWait('synthetic-map',9);
    scope.submit([env.gpuWork(3_000_000)],{label:'second'});
  });
  await perf.endFrame();await perf.flush();
  const d=perf.diagnostics(),frame=d.latestFrame,p=frame.passes[0];
  assert.equal(d.gpuTiming.metricSemantics.schema,'steelmoth-webgpu-performance-timing/v2');
  assert.strictEqual(p.gpuMs,p.queueSpanGpuMs,'legacy gpuMs must remain an exact queue-span alias');
  assert.equal(p.commandSpans.length,2);assert.equal(p.commandSubmissionCount,2);
  assert(Number.isFinite(p.commandGpuMs)&&p.commandGpuMs>=5&&p.commandGpuMs<5.01,`expected about 5 ms explicit command work, got ${p.commandGpuMs}`);
  assert(p.queueSpanGpuMs>p.commandGpuMs+8.9,`queue span must expose synthetic host gap: ${p.queueSpanGpuMs} vs ${p.commandGpuMs}`);
  assert.equal(p.hostWaitMs,9);assert.equal(p.hostWaits[0].name,'synthetic-map');
  assert.equal(frame.gpuTiming.commandSpanCount,2);assert.equal(frame.gpuTiming.commandSpanQueryCount,4);assert.equal(frame.gpuTiming.queueSpanQueryCount,2);
  assert(Number.isFinite(frame.gpuTiming.readbackMapLatencyMs)&&frame.gpuTiming.readbackMapLatencyMs>=0);
  assert.equal(d.summary.gpuPassCommandSpans.mixed.count,1);assert.equal(d.summary.passHostWaits.mixed.meanMs,9);
  await perf.close();
}

async function attachedFrameGraphScope(){
  const env=makeDevice({features:['timestamp-query']});
  const graph=new Infra.FrameGraph({device:env.device,labelPrefix:'SM500CommandScope'});let seen=false;
  graph.addPass({name:'probe',execute({performanceTimingScope}){assert(performanceTimingScope,'frame-graph pass must receive performanceTimingScope');seen=true;performanceTimingScope.submit([env.gpuWork(1_250_000)])}});
  const original=graph.passes.get('probe').execute,perf=new Perf.WebGPUPerformanceInstrumentation({device:env.device,maxPasses:2}),detach=perf.attachFrameGraph(graph);
  await perf.beginFrame('attached');await graph.execute({});await perf.endFrame();await perf.flush();
  const p=perf.diagnostics().latestFrame.passes[0];assert(seen);assert(p.commandGpuMs>=1.25);assert(p.queueSpanGpuMs>=p.commandGpuMs);
  detach();assert.strictEqual(graph.passes.get('probe').execute,original);await perf.close();
}

async function explicitHostWaitMeasurement(){
  const env=makeDevice({features:['timestamp-query']});const perf=new Perf.WebGPUPerformanceInstrumentation({device:env.device,maxPasses:2});
  await perf.beginFrame('wait');
  await perf.measureGpuPass('wait',async scope=>{await scope.measureHostWait('promise',async()=>new Promise(resolve=>setTimeout(resolve,2)));scope.submit([env.gpuWork(100_000)])});
  await perf.endFrame();await perf.flush();const p=perf.diagnostics().latestFrame.passes[0];
  assert(p.hostWaitMs>=0,'explicit host wait must be separately recorded');assert(p.cpuCallbackMs>=p.hostWaitMs);await perf.close();
}

async function unsupportedTimestampStillSubmits(){
  const env=makeDevice(),perf=new Perf.WebGPUPerformanceInstrumentation({device:env.device,maxPasses:2});
  await perf.beginFrame('unsupported-command');
  await perf.measureGpuPass('pass',async scope=>{const span=scope.submit([env.gpuWork(2_000_000)]);assert.equal(span.gpuAvailable,false)});
  await perf.endFrame();await perf.flush();const d=perf.diagnostics(),p=d.latestFrame.passes[0];
  assert.equal(d.gpuTiming.supported,false);assert.equal(p.gpuMs,null);assert.equal(p.queueSpanGpuMs,null);assert.equal(p.commandGpuMs,null);assert.equal(p.commandSubmissionCount,1);assert.equal(env.calls.querySets,0);await perf.close();
}

async function boundedAndClosedScopes(){
  const env=makeDevice({features:['timestamp-query']}),perf=new Perf.WebGPUPerformanceInstrumentation({device:env.device,maxPasses:2,maxCommandSpansPerPass:2});let escaped;
  await perf.beginFrame('bounds');
  await perf.measureGpuPass('bounded',async scope=>{escaped=scope;scope.submit([env.gpuWork(1)]);scope.submit([env.gpuWork(1)]);assert.throws(()=>scope.submit([env.gpuWork(1)]),/maxCommandSpansPerPass/)});
  assert.throws(()=>escaped.submit([env.gpuWork(1)]),/scope.*closed/);await perf.endFrame();await perf.flush();await perf.close();
}

function resolveValidationWitnesses(){
  const env=makeDevice({features:['timestamp-query']}),query=env.device.createQuerySet({type:'timestamp',count:40}),destination=env.device.createBuffer({size:512,usage:0x0200}),encoder=env.device.createCommandEncoder();
  assert.throws(()=>encoder.resolveQuerySet(query,0,4,destination,16),/multiple of 256/,'old one-pass packed command offset must be rejected');
  assert.throws(()=>encoder.resolveQuerySet(query,0,4,destination,80),/multiple of 256/,'old five-pass smoke offset must be rejected');
  assert.throws(()=>encoder.resolveQuerySet(query,39,2,destination,0),/query range/);
  assert.throws(()=>encoder.resolveQuerySet(query,0,33,destination,256),/destination buffer/);
  assert.throws(()=>encoder.resolveQuerySet(query,0,1,env.device.createBuffer({size:256,usage:0x0008}),0),/QUERY_RESOLVE/);
}

async function alignedCommandResolveAndReuse(){
  const cases=[
    {maxPasses:1,frames:[[2],[0],[1],[3],[0]]},
    {maxPasses:3,frames:[[3,0],[0],[1,2,3],[0,0,0],[2]]},
    {maxPasses:8,frames:[[1,2,0,3,1],[0],[3,3,3,3,3,3,3,3],[1,0],[0]]},
    {maxPasses:17,frames:[Array(17).fill(3),[1],Array(16).fill(0),[2,0,1],[0]]},
    {maxPasses:33,frames:[Array(33).fill(1),[0],Array(17).fill(3),[1,2],[0]]},
  ];
  for(const config of cases){
    const env=makeDevice({features:['timestamp-query']}),perf=new Perf.WebGPUPerformanceInstrumentation({device:env.device,maxPasses:config.maxPasses,maxCommandSpansPerPass:3,readbackRingSize:2,maxFrames:8});
    const commandOffset=Math.ceil(config.maxPasses*16/256)*256,capacityBytes=Math.ceil((commandOffset+config.maxPasses*3*16)/256)*256;
    assert(perf._slots.every(slot=>slot.resolve.desc.size===capacityBytes&&slot.readback.desc.size===capacityBytes),'both persistent buffers must include command-section padding and maximum payload');
    for(let frameIndex=0;frameIndex<config.frames.length;frameIndex++){
      const counts=config.frames[frameIndex],resolveStart=env.calls.resolves.length,copyStart=env.calls.copies.length,expected=[];
      await perf.beginFrame(`layout-${config.maxPasses}-${frameIndex}`);
      for(let passIndex=0;passIndex<counts.length;passIndex++){
        const count=counts[passIndex],workNs=(frameIndex+1)*(passIndex+1)*100_000;
        expected.push(count?(count*workNs+count*(count-1)*500+count*1_000)/1e6:null);
        await perf.measureGpuPass(`pass-${passIndex}`,async scope=>{if(!count)env.submitGpuWork(workNs);for(let span=0;span<count;span++)scope.submit([env.gpuWork(workNs+span*1_000)])});
      }
      await perf.endFrame();await perf.flush();const frame=perf.diagnostics().latestFrame,totalCommands=counts.reduce((n,v)=>n+v,0),resolves=env.calls.resolves.slice(resolveStart),copies=env.calls.copies.slice(copyStart);
      assert.equal(resolves.length,totalCommands?2:1);assert.equal(resolves[0].offset,0);assert.equal(resolves[0].count,counts.length*2);
      if(totalCommands){assert.equal(resolves[1].offset,commandOffset);assert.equal(resolves[1].first,config.maxPasses*2);assert.equal(resolves[1].count,totalCommands*2)}
      assert.equal(copies.length,1);assert.equal(copies[0].size,totalCommands?commandOffset+totalCommands*16:counts.length*16,'queue-only readback layout must remain unchanged');
      assert.equal(frame.gpuTiming.readbackPending,false);assert.equal(frame.gpuTiming.commandSpanCount,totalCommands);
      for(let passIndex=0;passIndex<counts.length;passIndex++){const pass=frame.passes[passIndex];assert.equal(pass.commandSpans.length,counts[passIndex]);assert.equal(pass.gpuMs,pass.queueSpanGpuMs);assert(pass.queueSpanGpuMs>0);if(expected[passIndex]===null)assert.equal(pass.commandGpuMs,null);else assert(Math.abs(pass.commandGpuMs-expected[passIndex])<1e-9,`padded command decode failed: maxPasses=${config.maxPasses}, frame=${frameIndex}, pass=${passIndex}, value=${pass.commandGpuMs}`)}
    }
    assert.equal(new Set(env.calls.copies.map(copy=>copy.srcId)).size,2,'bounded resolve ring must reuse the same two buffers across changing layouts');await perf.close();
  }
}

(async()=>{resolveValidationWitnesses();await alignedCommandResolveAndReuse();await supportedTimestampPath();await commandSpanExcludesHostGap();await attachedFrameGraphScope();await explicitHostWaitMeasurement();await unsupportedTimestampStillSubmits();await boundedAndClosedScopes();await unavailableTimestampPath();await disabledInstrumentationPath();await registryMemoryAccounting();console.log('SM-500 TIMING BOUNDARY PASS: aligned and bounded command resolves, changing counts/ring reuse, legacy queue span preserved, explicit command span excludes host gaps, host waits/readback latency separated, scopes bounded, unavailable/disabled paths safe')})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
