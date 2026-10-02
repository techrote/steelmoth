'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const outcomes=[];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){await tick();await tick();}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
class Buffer{
  constructor(device,descriptor){this.device=device;this.bytes=new Uint8Array(descriptor.size);this.mapState='unmapped';this.destroyed=false;this.map=null;this.label=descriptor.label||'';}
  mapAsync(){
    if(this.destroyed||this.mapState!=='unmapped')throw new Error('invalid mapping');
    if(this.device.throwMap)throw new Error('synchronous map failure');
    this.mapState='pending';const d=deferred();this.map=d;this.device.maps.push(this);
    if(this.device.autoMap)queueMicrotask(()=>this.resolveMap());return d.promise;
  }
  resolveMap(){if(!this.map)return;const d=this.map;this.map=null;this.mapState='mapped';d.resolve();}
  rejectMap(){if(!this.map)return;const d=this.map;this.map=null;this.mapState='unmapped';d.reject(new Error('mapping failed'));}
  getMappedRange(offset=0,size=this.bytes.length){assert.equal(this.mapState,'mapped');if(this.device.throwRange)throw new Error('range failure');return this.bytes.slice(offset,offset+size).buffer;}
  unmap(){
    if(this.device.throwUnmap)throw new Error('unmap failed');
    if(this.map&&!this.device.ignoreCancel){const d=this.map;this.map=null;d.reject(new Error('cancelled'));}
    if(!this.device.ignoreCancel||!this.map)this.mapState='unmapped';
  }
  destroy(){this.unmap();this.destroyed=true;}
}
class Device{
  constructor(){this.maps=[];this.buffers=[];this.submissions=0;this.waitCalls=0;this.copies=0;this.autoMap=false;this.loss=deferred();this.lost=this.loss.promise;
    this.queue={writeBuffer:(buffer,offset,data)=>{
      assert.equal(buffer.mapState,'unmapped');assert.equal(buffer.destroyed,false);
      const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
      buffer.bytes.set(bytes,offset);
    },submit:commands=>{if(this.throwSubmit)throw new Error('submit failure');this.submissions++;for(const c of commands)for(const run of c)run();},
    onSubmittedWorkDone:()=>{this.waitCalls++;return Promise.resolve();}};
  }
  createBuffer(descriptor){const b=new Buffer(this,descriptor);this.buffers.push(b);return b;}
  createShaderModule(){const device=this;return{getCompilationInfo:()=>device.compilationGate?.promise||Promise.resolve({messages:[]})};}
  createComputePipeline(){return{getBindGroupLayout:()=>({})};}
  createBindGroup(d){return d;}
  createCommandEncoder(){const ops=[],device=this;return{
    beginComputePass:()=>{let bind;return{setPipeline:()=>{},setBindGroup:(_i,b)=>{bind=b;},dispatchWorkgroups:()=>ops.push(()=>{
      const entries=bind.entries,p=new Uint32Array(entries.find(e=>e.binding===8).resource.buffer.bytes.buffer);
      const n=p[0]*p[1],words=device.nextWords||((p[2]!==0&&p[3]===0)?[n,0,0,0,0,0,0,0]:[0,n,0,0,0,n,0,0]);
      const target=entries.find(e=>e.binding===13).resource.buffer;target.bytes.set(new Uint8Array(Uint32Array.from(words).buffer));
    }),end:()=>{}};},
    copyBufferToBuffer:(src,so,dst,offset,size)=>{assert.equal(dst.mapState,'unmapped','copy encoded against mapped/pending buffer');ops.push(()=>{
      assert.equal(dst.mapState,'unmapped','copy submitted against mapped/pending buffer');assert.equal(dst.destroyed,false);device.copies++;dst.bytes.set(src.bytes.slice(so,so+size),offset);
    });},finish:()=>ops};
  }
  resolveAll(){for(const b of this.maps)b.resolveMap();}
}
class Registry{
  constructor({device,width,height}){this.device=device;this.width=width;this.height=height;this.records=new Map();}
  defineBuffer(name,d){assert(!this.records.has(name));this.records.set(name,{kind:'buffer',name,handle:this.device.createBuffer({...d,label:name}),estimatedBytes:d.size});}
  defineTexture(name,d){this.records.set(name,{kind:'texture',name,format:d.format,handle:{createView:()=>({name,registry:this}),destroy:()=>{}},estimatedBytes:0});}
  require(name){const r=this.records.get(name);assert(r,`missing resource ${name}`);return r;}
  diagnostics(){return{resources:[...this.records.values()].map(({handle,...r})=>r)};}
  close(){for(const r of this.records.values())r.handle.destroy();this.records.clear();}
}
class Pipelines{
  constructor(device){this.device=device;}
  getCompute(key,factory){return factory(this.device,key);}
  diagnostics(){return{};}clear(){}resetDevice(device){this.device=device;}
}
global.SteelMothWebGPUResources={ResourceRegistry:Registry,PipelineCache:Pipelines};
const Base=require('../engine/webgpu_gtao_stabilization.js');
const R=require('../engine/webgpu_gtao_readback.js');
function source(width=9,height=7){return{width,height,currentVisibilityView:{},currentDepthView:{},currentObjectView:{},currentNormalView:{}};}
const meta={roomId:'room',deviceGeneration:1,backendGeneration:1};
function subject(o={}){const device=new Device();const temporal=new R.WebGPUGTAOTemporal({device,width:9,height:7,...o});return{device,temporal};}
async function submit(t,extra={}){return t.update(source(),{wait:false,statsMode:'deferred',meta,...extra});}
async function test(name,run){try{await run();outcomes.push({name,ok:true});}catch(error){outcomes.push({name,ok:false,error:error.stack});}}
(async()=>{
await test('reject invalid capacity and mode before resource allocation',async()=>{
  for(const value of [0,9,-1,1.5,NaN,Infinity,'3',null])assert.throws(()=>subject({statsSlots:value===null?0:value}),/statsSlots/);
  for(const value of ['off','auto',false,3])assert.throws(()=>subject({statsMode:value}),/statsMode/);
});
await test('deferred submission resolves while diagnostic map remains pending',async()=>{
  const {device,temporal}=subject();let done=false;
  const p=submit(temporal).then(()=>{done=true;});await settle();assert(done);await p;
  assert.equal(device.maps.filter(b=>b.map).length,1);assert.equal(device.waitCalls,0);
  assert.equal(temporal.historyIndex,1);assert.equal(temporal.historyValid,true);assert.equal(temporal.valid,true);
  assert.equal(temporal.diagnostics().lastStats,null);assert.equal(temporal.diagnostics().readback.statsForCurrentFrame,false);temporal.close();await settle();
});
await test('bounded overflow skips telemetry only, with no mapped-buffer reuse',async()=>{
  const {device,temporal}=subject({statsSlots:2});
  for(let i=0;i<8;i++)await submit(temporal);
  assert.equal(device.copies,2);assert.equal(device.waitCalls,0);assert.equal(temporal.updateCount,8);
  let d=temporal.diagnostics().readback;assert.equal(d.ring.pending,2);assert.equal(d.ring.skipped,6);assert.equal(d.ring.allocatedBytes,64);
  assert.equal(d.ring.lastSkippedFrame.frameId,8);device.resolveAll();await temporal.flushStats();
  assert.equal(temporal.diagnostics().readback.lastStatsFrame.frameId,2);assert.equal(temporal.diagnostics().readback.statsForCurrentFrame,false);
  await submit(temporal);assert.equal(device.copies,3);device.resolveAll();await temporal.flushStats();
  assert.equal(temporal.diagnostics().readback.lastStatsFrame.frameId,9);temporal.close();
});
await test('out-of-order maps publish monotonically and retain exact frame metadata',async()=>{
  const {device,temporal}=subject();
  await submit(temporal);device.nextWords=[60,3,1,1,1,0,0,0];await submit(temporal);
  device.maps[1].resolveMap();await settle();let d=temporal.diagnostics();
  assert.equal(d.lastStats.accepted,60);assert.equal(d.readback.lastStatsFrame.frameId,2);
  device.maps[0].resolveMap();await temporal.flushStats();d=temporal.diagnostics();assert.equal(d.readback.lastStatsFrame.frameId,2);
  const rows=temporal.takeCompletedStats();assert.deepEqual(rows.map(r=>r.frame.frameId),[2,1]);
  assert.deepEqual(rows[0].words,[60,3,1,1,1,0,0,0]);assert.equal(rows[0].frame.roomId,'room');assert.equal(rows[0].frame.width,9);
  rows[0].stats.accepted=0;assert.equal(temporal.diagnostics().lastStats.accepted,60);temporal.close();
});
await test('blocking remains default and returns own current-frame counters',async()=>{
  const {device,temporal}=subject();let done=false;
  const p=temporal.update(source(),{wait:false,meta}).then(d=>{done=true;return d;});await settle();assert(!done);device.resolveAll();
  const d=await p;assert.equal(d.lastStats.globalRejected,63);assert(d.readback.statsForCurrentFrame);assert.equal(d.readback.mode,'blocking');assert.equal(device.waitCalls,0);temporal.close();
});
await test('blocking overflow waits for a bounded slot then its own map',async()=>{
  const {device,temporal}=subject({statsSlots:1});await submit(temporal);let done=false;
  const p=temporal.update(source(),{wait:false,meta}).then(d=>{done=true;return d;});await settle();assert(!done);assert.equal(device.copies,1);
  device.resolveAll();await settle();assert(!done);assert.equal(device.copies,2);device.resolveAll();const d=await p;
  assert.equal(d.readback.lastStatsFrame.frameId,2);assert.equal(d.readback.ring.skipped,0);temporal.close();
});
await test('explicit queue wait remains separate from stats policy',async()=>{
  const {device,temporal}=subject();await temporal.update(source(),{statsMode:'deferred',meta});assert.equal(device.waitCalls,1);assert.equal(temporal.lastStats,null);temporal.close();await settle();
});
await test('resize rejects pending diagnostics and recreates only a bounded pool',async()=>{
  const {device,temporal}=subject();await submit(temporal);const old=temporal._ring;temporal.resize(5,3);await settle();
  assert(old.closed);assert.equal(old.diagnostics().stale,1);assert.equal(temporal.diagnostics().lastStats,null);
  await temporal.update(source(5,3),{statsMode:'deferred',wait:false,meta});device.resolveAll();await temporal.flushStats();
  assert.equal(temporal.diagnostics().lastStats.globalRejected,15);assert.equal(temporal.diagnostics().readback.lastStatsFrame.frameId,2);temporal.close();
});
await test('explicit invalidation clears completed data and pending data',async()=>{
  const {device,temporal}=subject();await submit(temporal);device.resolveAll();await temporal.flushStats();await submit(temporal);
  temporal.invalidate('manual');await settle();assert.equal(temporal.diagnostics().lastStats,null);assert.deepEqual(temporal.takeCompletedStats(),[]);assert(!temporal.valid);temporal.close();
});
await test('old successful callbacks after invalidation cannot publish stale counters',async()=>{
  const {device,temporal}=subject();device.ignoreCancel=true;await submit(temporal);const epoch=temporal._epoch;
  temporal.invalidate('race');device.resolveAll();await temporal.flushStats();assert(temporal._epoch>epoch);assert.equal(temporal.lastStats,null);assert.equal(temporal._ring.totals.stale,1);temporal.close();
});
for(const key of ['roomId','deviceGeneration','backendGeneration'])await test(`${key} transition cancels old stats but preserves new frame attribution`,async()=>{
  const {device,temporal}=subject();await submit(temporal);await submit(temporal,{meta:{...meta,[key]:key==='roomId'?'new-room':2}});
  device.resolveAll();await temporal.flushStats();const d=temporal.diagnostics();assert.equal(d.readback.lastStatsFrame.frameId,2);
  assert.equal(d.readback.lastStatsFrame[key],key==='roomId'?'new-room':'2');assert.equal(d.lastStats.globalRejected,63);temporal.close();
});
await test('device loss cancels telemetry, invalidates history, and blocks submission',async()=>{
  const {device,temporal}=subject();await submit(temporal);device.loss.resolve({reason:'unknown'});await settle();
  assert.equal(temporal.lastStats,null);assert.equal(temporal.valid,false);await assert.rejects(submit(temporal),/device-lost/);temporal.close();
});
await test('device reset cannot publish old maps or react to old device loss',async()=>{
  const {device,temporal}=subject();await submit(temporal);const next=new Device();temporal.resetDevice(next);device.loss.resolve({});await settle();
  await submit(temporal,{meta:{...meta,deviceGeneration:2}});next.resolveAll();await temporal.flushStats();
  assert.equal(temporal.diagnostics().readback.lastStatsFrame.deviceGeneration,'2');assert(temporal.valid);temporal.close();
});
await test('close is idempotent and cancels pending maps without unhandled rejection',async()=>{
  const {device,temporal}=subject();await submit(temporal);temporal.close();temporal.close();await settle();
  assert.equal(temporal.lastStats,null);assert.equal(temporal.valid,false);assert.equal(temporal._ring.diagnostics().pending,0);
  assert(device.buffers.every(b=>b.destroyed));await assert.rejects(submit(temporal),/closed/);
});
await test('map rejection remains diagnostic in deferred mode and subsequent frames recover',async()=>{
  const {device,temporal}=subject();await submit(temporal);device.maps[0].rejectMap();await temporal.flushStats();assert(temporal.valid);
  assert.equal(temporal._ring.totals.failed,1);assert.equal(temporal.diagnostics().lastStats,null);
  await submit(temporal);device.resolveAll();await temporal.flushStats();assert.equal(temporal.diagnostics().readback.lastStatsFrame.frameId,2);temporal.close();
});
await test('map failure propagates to explicit blocking caller',async()=>{
  const {device,temporal}=subject();const p=temporal.update(source(),{wait:false,meta});const check=assert.rejects(p,/diagnostic readback failed/);
  await settle();device.maps[0].rejectMap();await check;assert(temporal.valid);temporal.close();
});
for(const option of ['throwMap','throwRange'])await test(`${option} is caught, unmapped and reported without GPU-output invalidation`,async()=>{
  const {device,temporal}=subject();device[option]=true;await submit(temporal);device.resolveAll();await temporal.flushStats();
  assert.equal(temporal._ring.totals.failed,1);assert(temporal.valid);assert.equal(temporal._ring.diagnostics().pending,0);temporal.close();
});
await test('invalid count totals cannot masquerade as current-frame statistics',async()=>{
  const {device,temporal}=subject();device.nextWords=[1,0,0,0,0,0,0,0];await submit(temporal);device.resolveAll();await temporal.flushStats();
  assert.equal(temporal.lastStats,null);assert.equal(temporal._ring.totals.failed,1);assert.match(temporal._ring.lastError.message,/extent/);temporal.close();
});
await test('unmap failure retires the slot instead of reusing a mapped buffer',async()=>{
  const {device,temporal}=subject({statsSlots:1});await submit(temporal);device.throwUnmap=true;device.resolveAll();await temporal.flushStats();
  assert.equal(temporal._ring.diagnostics().retired,1);await submit(temporal);assert.equal(temporal._ring.totals.skipped,1);
  await assert.rejects(temporal.update(source(),{wait:false,meta}),/no usable slots/);device.throwUnmap=false;temporal.close();
});
await test('concurrent updates are explicitly rejected instead of corrupting history',async()=>{
  const {device,temporal}=subject();const p=temporal.update(source(),{wait:false,meta});await settle();
  await assert.rejects(submit(temporal),/concurrent/);device.resolveAll();await p;assert.equal(temporal.updateCount,1);temporal.close();
});
await test('pending compilation cannot install a stale pipeline after resize',async()=>{
  const {device,temporal}=subject();device.compilationGate=deferred();const p=submit(temporal);const check=assert.rejects(p,/invalidated/);
  await settle();temporal.resize(3,3);device.compilationGate.resolve({messages:[]});await check;assert.equal(temporal.pipeline,null);assert.equal(device.submissions,0);temporal.close();
});
await test('submission failure releases reservation and does not advance history',async()=>{
  const {device,temporal}=subject();device.throwSubmit=true;await assert.rejects(submit(temporal),/submit failure/);
  assert.equal(temporal.historyIndex,0);assert.equal(temporal.updateCount,0);assert.equal(temporal._ring.diagnostics().reserved,0);temporal.close();
});
await test('invalid input does not reserve a slot or submit GPU commands',async()=>{
  const {device,temporal}=subject();await assert.rejects(temporal.update({},{}),/requires current/);await assert.rejects(submit(temporal,{statsMode:'bad'}),/statsMode/);
  assert.equal(device.submissions,0);assert.equal(temporal._ring,null);temporal.close();
});
await test('bounded completion retention explicitly counts evicted records',async()=>{
  const {device,temporal}=subject({statsSlots:2});device.autoMap=true;
  for(let i=0;i<12;i++){await submit(temporal);await temporal.flushStats();}
  assert.equal(temporal._ring.diagnostics().retainedResults,2);assert.equal(temporal._ring.totals.evicted,10);
  assert.deepEqual(temporal.takeCompletedStats().map(r=>r.frame.frameId),[11,12]);temporal.close();
});
await test('quality transitions and disabled temporal mode retain exact rejection counts',async()=>{
  const {device,temporal}=subject();await submit(temporal);await submit(temporal,{quality:'Low'});device.resolveAll();await temporal.flushStats();
  assert.equal(temporal.historyValid,false);assert.equal(temporal.diagnostics().readback.lastStatsFrame.quality,'Low');assert.equal(temporal.lastStats.globalRejected,63);temporal.close();
});
await test('baseline and candidate blocking submission statistics agree',async()=>{
  const d1=new Device(),d2=new Device();d1.autoMap=true;d2.autoMap=true;
  const a=new Base.WebGPUGTAOTemporal({device:d1,width:9,height:7}),b=new R.WebGPUGTAOTemporal({device:d2,width:9,height:7});
  for(let i=0;i<10;i++){
    const m={...meta,roomId:i===5?'reset':'room'},o={wait:false,quality:i===8?'Low':'Medium',meta:m};
    const x=await a.update(source(),o),y=await b.update(source(),o);
    assert.deepEqual(x.lastStats,y.lastStats);assert.equal(a.historyIndex,b.historyIndex);assert.equal(a.historyValid,b.historyValid);
  }
  a.close();b.close();
});
await test('seeded slow-map stress keeps memory bounded and never rewinds frame attribution',async()=>{
  const {device,temporal}=subject({statsSlots:3});let seed=601,previous=0;
  for(let i=0;i<512;i++){
    await submit(temporal);seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const pending=device.maps.filter(b=>b.map);if(pending.length&&(seed&3)!==0)pending[seed%pending.length].resolveMap();await settle();
    const d=temporal.diagnostics().readback;assert(d.ring.pending<=3);assert(d.ring.retainedResults<=3);assert.equal(d.ring.allocatedBytes,96);
    const f=d.lastStatsFrame?.frameId||0;assert(f>=previous);previous=f;
  }
  device.resolveAll();await temporal.flushStats();assert.equal(temporal.updateCount,512);assert(temporal._ring.totals.skipped>0);temporal.close();
});
await test('close before the map microtask makes no late GPUBuffer API call',async()=>{
  const d=new Device(),buffer=d.createBuffer({size:32}),ring=new R.StatsReadbackRing([buffer],1);
  const slot=ring.acquire({frameId:1,epoch:1,width:1,height:1}),job=ring.start(slot);ring.close();
  assert.equal((await job).status,'stale');assert.equal(d.maps.length,0);
});
await test('blocking update cannot publish after close',async()=>{
  const {device,temporal}=subject();const p=temporal.update(source(),{wait:false,meta});
  const check=assert.rejects(p,/stale/);await settle();temporal.close();await check;
  assert.equal(temporal.lastStats,null);assert.equal(temporal.valid,false);
});
await test('slot capacity cannot be mutated into an unbounded allocation',async()=>{
  const {temporal}=subject();assert.throws(()=>{temporal.statsSlots=1000000;},TypeError);assert.equal(temporal.statsSlots,3);temporal.close();
});
const result={schema:'steelmoth-sm601-readback-cpu/v1',ok:outcomes.every(r=>r.ok),
  evidenceBoundary:'Mocked API ordering/lifecycle and CPU references only; no GPU execution or performance claim.',cases:outcomes.length,checks:outcomes};
const report=process.argv.indexOf('--report');if(report>=0){const target=path.resolve(process.argv[report+1]);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
