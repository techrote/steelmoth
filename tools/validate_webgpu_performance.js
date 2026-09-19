'use strict';
const assert=require('assert');
const Infra=require('../engine/webgpu_resources.js');
const Perf=require('../engine/webgpu_performance.js');

function makeDevice(options={}){
  let serial=0,clock=1_000_000n;
  const calls={querySets:0,buffers:0,submits:0,timestampPasses:0,push:0,pop:0};
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
      resolveQuerySet(query,first,count,destination,offset){ops.push({type:'resolve',query,first,count,buffer:destination,offset})},
      copyBufferToBuffer(src,srcOffset,dst,dstOffset,size){ops.push({type:'copy',src,srcOffset,dst,dstOffset,size})},
      finish(){return {ops}}
    }},
    pushErrorScope(){calls.push++},async popErrorScope(){calls.pop++;return null}
  };
  return {device,queue,calls,submitGpuWork(ns){queue.submit([{ops:[{type:'work',ns}]}])}};
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

(async()=>{await supportedTimestampPath();await unavailableTimestampPath();await disabledInstrumentationPath();await registryMemoryAccounting();console.log('SM-500 WEBGPU PERFORMANCE INSTRUMENTATION PASS: timestamp-query frame-graph timings, separate CPU phases, workload/memory export, unavailable-feature path and disabled-instrumentation path verified')})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
