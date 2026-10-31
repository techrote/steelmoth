'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),{webcrypto}=require('crypto');
const API=require('./sm505_normal_benchmark.js');
const code=fs.readFileSync(require.resolve('./sm505_normal_benchmark.js'),'utf8');
const scenario={id:'representative',fixture:'dense-mixed',profile:'representative',angle:0};

assert.deepEqual(API.sm505NormalStats([4,1,3,2]),{count:4,mean:2.5,median:2,p90:4,p95:4,p99:4,max:4});
for(const values of [[1,NaN],[Infinity],[1,-1]])assert.throws(()=>API.sm505NormalStats(values),/finite nonnegative/);
for(const options of [{warmup:299},{samples:599},{warmup:300.5},{timeoutMs:Infinity},{scenario:{...scenario,profile:'mixed'}}])assert.throws(()=>API.sm505NormalOptions({scenario,...options}));
assert.equal(API.sm505NormalOptions({scenario}).samples,600);

function environment(options={}){
  const state={drains:0,closed:0,constructed:0,rafCalls:0};
  const scene={frame:{logicalSize:[640,360],sequence:0},sprites:[{category:'static',id:'one'}],lights:[],occluders:[],settings:{ambient:.1},post:{grade:[1,1,1]},proceduralLayers:[],overlays:{}};
  const noop=()=>{},diagnostics=()=>({resources:[]});
  const p={ready:true,closed:false,rendering:false,pending:null,presentedFrames:0,droppedFrames:0,width:1920,height:1080,device:{},queue:{async onSubmittedWorkDone(){}},diagnostics:()=>({gtaoEnabled:false}),gb:{lastInstanceCount:1},shadows:{lastSelfLights:[],diagnostics},lighting:{activeLightCount:1},occ:{snapshot:{records:[]},diagnostics},clusters:{snapshot:{clusters:[],diagnostics:{largestCluster:{memberCount:0}}},diagnostics},dsoHierarchy:{snapshot:{activeTiles:[]},diagnostics},foliage:{count:0,diagnostics},bloom:{width:960,height:540},post:{bloomWidth:960,bloomHeight:540,diagnostics},api:{Ownership:{buildOwnershipSceneInstances:s=>s.sprites},Quality:{workloadMetadata:()=>({selfShadowSamples:12,contactShadowSamples:8})}}};
  const runtime={presenter:p,requestedBackend:'webgpu',activeBackend:'webgpu',presentationBackend:'webgpu',diagnostics:()=>({webgpu:{uncapturedErrors:[]}})};
  p._drain=async function(){state.drains++;await Promise.resolve();this.rendering=false;if(options.failAt===state.drains){this.ready=false;runtime.presentationBackend='webgl2';return}this.presentedFrames++;if(options.dropAt===state.drains)this.droppedFrames++};
  const oldHook={onFrame:noop};const game={render:noop,loop:noop,__smBenchmarkHooks:oldHook,canvas:{width:1920,height:1080},renderScene:scene,art:{manifest:{}}};
  game.__smHarnessRenderOnce=()=>{scene.frame.sequence++;p.rendering=true;p._drain(scene);game.__smBenchmarkHooks?.onFrame({cpuScenePrepMs:1,cpuSubmitMs:2,cpuTotalMs:3})};
  class Perf{
    constructor(){state.constructed++;this.timestampSupported=true;this.frames=[];this.active=null}
    async beginFrame(label,metadata){this.active={label,metadata,gpuTiming:{readbackPending:false},passes:[],cpu:{}}}
    async measureGpuPass(name,callback){const value=await callback();this.active.passes.push({name,queueSpanGpuMs:options.missingTimestamp?null:.5,commandGpuMs:options.commandCoverage?.1:null,commandSpans:options.commandCoverage?[{}]:[],cpuCallbackMs:4});return value}
    recordCpuPhase(name,value){this.active.cpu[name]=value}
    async endFrame(){this.frames.push(this.active);this.active=null}
    async flush(){}
    diagnostics(){return{frames:this.frames,gpuTiming:{metricSemantics:{testOnlyMock:true}}}}
    async close(){state.closed++}
  }
  const context={console:{log(){}},setTimeout,clearTimeout,performance,TextEncoder,crypto:webcrypto,devicePixelRatio:1,game,steelMothBackendRuntime:runtime,steelMothWebGPUQualityRuntime:{preset:options.preset||'Medium'},SteelMothRenderHarness:{enabled:true,config:{benchmarkPrepare:true,benchmark:false,inspection:options.inspection||'none',quality:'medium',fixture:scenario.fixture,benchmarkProfile:scenario.profile,lightAngle:0,width:1920,height:1080,dpr:1}},SteelMothWebGPUPerformance:{WebGPUPerformanceInstrumentation:Perf},requestAnimationFrame(cb){state.rafCalls++;queueMicrotask(()=>cb(performance.now()))}};
  vm.createContext(context);vm.runInContext(code,context);
  return{context,p,runtime,game,state,oldDrain:p._drain,oldRender:game.render,oldLoop:game.loop,oldHook};
}

async function testNormalPathAndFailures(){
  const good=environment(),result=await good.context.sm505NormalBenchmark({scenario});
  assert(result.ok,JSON.stringify(result.errors));assert.equal(good.state.drains,900);assert.equal(good.state.rafCalls,900);assert.equal(result.queueSpanGpuMs.length,600);assert(result.commandGpuMs.every(v=>v===null));assert.equal(result.commandCoverage.explicitCommandSpans,0);
  assert.equal(result.cpu.scenePrep.mean,1);assert.equal(result.cpu.normalSceneSubmit.mean,2);assert.equal(result.cpu.presentationCallback.mean,4);assert.equal(result.cpu.pureEncoding,null);assert.equal(result.statistics.mean,.5);
  assert.strictEqual(good.p._drain,good.oldDrain);assert.strictEqual(good.game.render,good.oldRender);assert.strictEqual(good.game.loop,good.oldLoop);assert.strictEqual(good.game.__smBenchmarkHooks,good.oldHook);assert.equal(good.state.closed,1);
  for(const bad of [{inspection:'development'},{preset:'High'}]){const e=environment(bad),r=await e.context.sm505NormalBenchmark({scenario});assert(!r.ok);assert.equal(e.state.drains,0);assert.equal(e.state.constructed,0);assert.strictEqual(e.game.__smBenchmarkHooks,e.oldHook,'refused preflight must not alter original hooks')}
  for(const fault of [{failAt:17},{dropAt:17}]){const e=environment(fault),r=await e.context.sm505NormalBenchmark({scenario});assert(!r.ok);assert.equal(e.state.drains,17,'a failed/dropped normal frame cannot be retried automatically');assert.equal(e.state.closed,1);assert.strictEqual(e.p._drain,e.oldDrain)}
  for(const fault of [{missingTimestamp:true},{commandCoverage:true}]){const e=environment(fault),r=await e.context.sm505NormalBenchmark({scenario});assert(!r.ok,'missing timestamps/uncovered invented command times cannot pass');assert.equal(e.state.closed,1)}
}

function testDescriptorMemoryDeduplication(){
  const handle={},registry={resources:new Map([['shared',{name:'shared',handle,kind:'texture',estimatedBytes:64,format:'rgba16float',width:2,height:4}]])},world={width:4,height:4,format:'rgba16float',mipLevelCount:1,sampleCount:1,createView(){}};
  const p={gb:{registry},lighting:{registry},world,resources:[world],post:{brightBuffer:{size:16}},fx:{},foliageParams:[]};
  const result=API.sm505NormalMemory(p,{});assert.equal(result.texturesBytes,64+128);assert.equal(result.buffersBytes,16);assert.equal(result.entries.length,3,'shared G-buffer/lighting registry and texture aliases count once');assert.equal(result.estimateOnly,true);
}

async function testBenchmarkPreparationGuard(){
  const source=fs.readFileSync(require.resolve('../engine/render_harness.js'),'utf8');
  const start=source.indexOf('  function applyBenchmarkProfile(game) {'),end=source.indexOf('  function webglEnvironment(',start),fn=source.slice(start,end);
  for(const enabled of [false,true]){const calls=[],ctx={config:{benchmark:false,benchmarkPrepare:enabled,benchmarkProfile:'representative'},addBenchmarkFollowers:(_g,n)=>calls.push(n),expandDenseStatic(){}};vm.createContext(ctx);vm.runInContext(fn+'\napplyBenchmarkProfile({})',ctx);assert.deepEqual(calls,enabled?[4]:[],'prepare-only executes the actual canonical profile without enabling WebGL2 timing')}
  const nodes={renderTestResult:{textContent:''}},document={readyState:'loading',body:{dataset:{}},getElementById:n=>nodes[n],addEventListener(_n,callback){this.start=callback}};
  class Storage{getItem(){return null}setItem(){}removeItem(){}}
  const ctx={URLSearchParams,location:{search:'?renderTest=1&backend=webgl2&benchmarkPrepare=1&inspection=development'},document,Storage,setTimeout,clearTimeout};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);await document.start();const result=await ctx.SteelMothRenderHarness.ready;
  assert.equal(result.ok,false);assert.match(result.error,/development inspection is forbidden/);assert.equal(document.body.dataset.renderTestError,'1');
}

(async()=>{testDescriptorMemoryDeduplication();await testBenchmarkPreparationGuard();await testNormalPathAndFailures();console.log('SM-505 NORMAL BENCHMARK CPU CONTRACT PASS: mocked 300+600 real-path scheduling, no retry, null uncovered command time, failure cleanup, descriptor dedup, canonical profile preparation and inspection refusal; NO browser/GPU measurements')})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
