'use strict';

function sm505NormalStats(values){
  if(!Array.isArray(values)||values.some(v=>!Number.isFinite(v)||v<0))throw new Error('statistics require finite nonnegative samples; missing samples cannot be discarded');
  const a=values.slice().sort((x,y)=>x-y),n=a.length,q=p=>n?a[Math.max(0,Math.ceil(p*n)-1)]:null;
  return{count:n,mean:n?a.reduce((s,v)=>s+v,0)/n:null,median:q(.5),p90:q(.9),p95:q(.95),p99:q(.99),max:n?a[n-1]:null};
}

function sm505NormalOptions(raw={}){
  const o={warmup:300,samples:600,timeoutMs:1200000,...raw},ids=['representative','empty','dense-static','dynamic-robot','foliage','bin-cluster','diagnostic-light','mixed'];
  if(!Number.isSafeInteger(o.warmup)||o.warmup<300||o.warmup>5000||!Number.isSafeInteger(o.samples)||o.samples<600||o.samples>5000)throw new Error('normal target benchmark requires 300..5000 warmup and 600..5000 retained frames');
  if(!Number.isFinite(o.timeoutMs)||o.timeoutMs<1000||o.timeoutMs>1800000)throw new Error('bounded timeoutMs must be 1000..1800000');
  if(!o.scenario||!ids.includes(o.scenario.id)||o.scenario.profile!==o.scenario.id||!o.scenario.fixture||!Number.isInteger(o.scenario.angle))throw new Error('canonical scenario descriptor from benchmark_webgl2.SCENARIOS is required');
  return o;
}

function sm505NormalMemory(p,runtime){
  const seen=new Set(),entries=[],missing=[];let texturesBytes=0,buffersBytes=0,historyBytes=0;
  const add=(name,handle,kind,bytes,history=false,descriptor={})=>{if(!handle||seen.has(handle))return;if(!Number.isFinite(bytes)||bytes<0){missing.push(name);return}seen.add(handle);entries.push({name,kind,bytes,history,...descriptor});if(history)historyBytes+=bytes;else if(kind==='texture')texturesBytes+=bytes;else buffersBytes+=bytes};
  const owners=['gb','depth','shadows','lighting','occ','clusters','dominance','dso','dsoHierarchy','bloom','bloomTemporal','visibility','water'];
  const registries=new Set();for(const name of owners){const registry=p[name]?.registry;if(!registry||registries.has(registry))continue;registries.add(registry);for(const record of registry.resources?.values?.()||[])add(name+'/'+record.name,record.handle,record.kind,record.estimatedBytes,name==='bloomTemporal'&&record.kind==='texture',{format:record.format||null,width:record.width||null,height:record.height||null})}
  const infrastructure=runtime?.infrastructure?.registry;
  if(infrastructure&&!registries.has(infrastructure))for(const record of infrastructure.resources?.values?.()||[])add('platform/'+record.name,record.handle,record.kind,record.estimatedBytes,false);
  const bpp={'rgba8unorm':4,'rgba8unorm-srgb':4,'bgra8unorm':4,'rgba16float':8,'r32float':4,'r32uint':4,'rg32float':8,'depth32float':4};
  const texture=(name,t)=>{if(!t||seen.has(t))return;if(!bpp[t.format]||!t.width||!t.height){missing.push(name);return}let pixels=0;for(let level=0;level<(t.mipLevelCount||1);level++)pixels+=Math.max(1,t.width>>level)*Math.max(1,t.height>>level)*(t.depthOrArrayLayers||1);add(name,t,'texture',pixels*bpp[t.format]*(t.sampleCount||1),false,{format:t.format,width:t.width,height:t.height})};
  const buffer=(name,b)=>{if(b)add(name,b,'buffer',b.size,false)};
  for(const [name,t]of Object.entries(p.gb?.atlas||{}))if(t&&typeof t==='object'&&typeof t.createView==='function')texture('atlas/'+name,t);
  for(const name of ['world','backdrop','legacyTexture'])texture(name,p[name]);texture('water/field',p.water?.fieldTexture);
  for(const name of ['bloomA','bloomB'])texture('post/'+name,p.post?.[name]);for(const name of ['brightBuffer','blurHBuffer','blurVBuffer','postBuffer'])buffer('post/'+name,p.post?.[name]);
  for(const name of ['instanceBuffer','outputBuffer','paramBuffer'])buffer('foliage/'+name,p.foliage?.[name]);buffer('foliageRaster',p.foliageRaster);for(const [i,b]of(p.foliageParams||[]).entries())buffer('foliageParams/'+i,b);
  for(const [name,fx]of Object.entries(p.fx||{})){buffer(name+'/frame',fx.frameBuffer);for(const [stage,b]of fx.procBuffers||[])buffer(name+'/procedural/'+stage,b);for(const [stage,record]of fx.spriteBuffers||[])buffer(name+'/sprite/'+stage,record.buffer);buffer(name+'/glassLighting',fx.glassLightingBuffer)}
  return{estimateOnly:true,texturesBytes,buffersBytes,historyBytes,externalBytes:0,totalEstimatedBytes:texturesBytes+buffersBytes+historyBytes,entries,missingDescriptors:missing,
    boundary:'Deduplicated WebGPU allocation descriptors, including presenter-owned non-registry targets/buffers. Not driver residency. Browser swapchains, shader/pipeline memory, retained WebGL2 fallback allocations and SM500 observer allocations are excluded and reported as limitations.'};
}

async function sm505NormalBenchmark(rawOptions={}){
  const options=sm505NormalOptions(rawOptions),result={schema:'steelmoth-sm505-normal-benchmark-run/v1',ok:false,releaseAcceptance:false,visualAcceptance:false,errors:[],configuration:{...options,width:1920,height:1080,dpr:1,quality:'Medium',gtaoEnabled:false,inspection:'none'},methodology:{warmupFrames:options.warmup,measuredFrames:options.samples,normalIndexBootstrap:true,productionBridgeAndPresenter:true,rafOutsideTiming:true,percentileMethod:'nearest-rank',rawSamplesRetained:true},targets:{meanMs:12,p95Ms:14.5},rawFrames:[],cpuRows:[],restored:false};
  const root=globalThis,runtime=root.steelMothBackendRuntime,p=runtime?.presenter,game=root.game,harness=root.SteelMothRenderHarness;
  let perf=null,armed=null,originalDrain=null,originalRender=null,originalLoop=null,originalHooks=null,failed=false;
  const started=performance.now(),deadline=started+options.timeoutMs;
  const progress=(phase,index)=>{root.SM505NormalBenchmarkProgress={phase,index,warmup:options.warmup,samples:options.samples,elapsedMs:performance.now()-started};if(index===0||index%100===0)console.log('SM-505 normal benchmark: '+phase+' '+index)};
  const ensure=condition=>{if(!condition)throw new Error('normal benchmark prerequisite or frame-integrity failure')};
  const bounded=promise=>new Promise((resolve,reject)=>{const remaining=deadline-performance.now();if(remaining<=0){reject(new Error('normal benchmark deadline'));return}const timer=setTimeout(()=>reject(new Error('normal benchmark deadline')),remaining);Promise.resolve(promise).then(v=>{clearTimeout(timer);resolve(v)},e=>{clearTimeout(timer);reject(e)})});
  const fingerprint=async scene=>{const bytes=new TextEncoder().encode(JSON.stringify({sprites:scene.sprites,lights:scene.lights,occluders:scene.occluders,settings:scene.settings,post:scene.post,proceduralLayers:scene.proceduralLayers,overlays:scene.overlays}));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')};
  try{
    ensure(runtime?.requestedBackend==='webgpu'&&runtime.activeBackend==='webgpu'&&runtime.presentationBackend==='webgpu'&&p?.ready&&!p.closed&&!p.rendering&&!p.pending);
    const config=harness?.config;ensure(harness?.enabled&&config?.benchmarkPrepare===true&&config.benchmark===false&&config.inspection==='none'&&config.quality==='medium'&&config.fixture===options.scenario.fixture&&config.benchmarkProfile===options.scenario.profile&&config.lightAngle===options.scenario.angle);
    ensure(config.width===1920&&config.height===1080&&config.dpr===1&&root.devicePixelRatio===1&&p.width===1920&&p.height===1080&&game.canvas.width===1920&&game.canvas.height===1080);
    ensure(root.steelMothWebGPUQualityRuntime?.preset==='Medium'&&p.diagnostics().gtaoEnabled===false&&typeof game.__smHarnessRenderOnce==='function');
    ensure(!p.ssgi&&!p.gtao&&game.renderScene?.settings?.advancedLighting!==true&&!runtime.diagnostics().webgpu?.uncapturedErrors?.length);
    const Perf=root.SteelMothWebGPUPerformance;if(!Perf)throw new Error('load production engine/webgpu_performance.js before normal benchmark injection');
    perf=new Perf.WebGPUPerformanceInstrumentation({device:p.device,queue:p.queue,maxPasses:1,maxFrames:options.samples,readbackRingSize:8,labelPrefix:'SM505NormalPerf'});
    if(!perf.timestampSupported)throw new Error('timestamp-query is required; CPU and browser FPS cannot substitute');
    originalDrain=p._drain;originalRender=game.render;originalLoop=game.loop;originalHooks=game.__smBenchmarkHooks;
    game.render=()=>{};game.loop=()=>{};
    p._drain=async function(scene){const ticket=armed;if(!ticket){failed=true;return originalDrain.call(this,scene)}if(ticket.entered){ticket.reject(new Error('more than one drain for a benchmark frame'));return}ticket.entered=true;try{await originalDrain.call(this,scene);ensure(runtime.presenter===p&&p.ready&&!p.closed&&!p.rendering&&!p.pending&&runtime.presentationBackend==='webgpu'&&!p.lastError);ticket.resolve()}catch(error){ticket.reject(error)}};
    game.__smBenchmarkHooks={onFrame(record){if(armed)armed.cpu={...record};originalHooks?.onFrame?.(record)}};
    const initialFrames=p.presentedFrames,initialDrops=p.droppedFrames;
    async function frame(){
      ensure(!armed&&!p.rendering&&!p.pending&&!failed);const before=p.presentedFrames;let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});const ticket={resolve,reject,entered:false,cpu:null};armed=ticket;
      try{game.__smHarnessRenderOnce();await bounded(promise);ensure(ticket.entered&&p.presentedFrames===before+1&&p.droppedFrames===initialDrops);ensure(ticket.cpu&&['cpuScenePrepMs','cpuSubmitMs','cpuTotalMs'].every(k=>Number.isFinite(ticket.cpu[k])&&ticket.cpu[k]>=0));return ticket.cpu}finally{armed=null}
    }
    for(let i=0;i<options.warmup;i++){progress('warmup',i);await bounded(new Promise(resolve=>requestAnimationFrame(resolve)));await frame()}
    await bounded(p.queue.onSubmittedWorkDone());result.sceneFingerprintBefore=await fingerprint(game.renderScene);
    for(let i=0;i<options.samples;i++){
      progress('measure',i);await bounded(new Promise(resolve=>requestAnimationFrame(resolve)));await perf.beginFrame(options.scenario.id+'-'+i,{scene:options.scenario.id,fixture:config.fixture,normalPresenter:true});
      const cpu=await perf.measureGpuPass('rendererTotal',()=>frame(),{coverage:'normal __smHarnessRenderOnce -> RenderSceneBridge.consume -> original presenter._drain/_render -> canvas; all production submissions unchanged'});
      perf.recordCpuPhase('scenePrep',cpu.cpuScenePrepMs);perf.recordCpuPhase('normalSceneSubmit',cpu.cpuSubmitMs);perf.recordCpuPhase('normalSceneTotal',cpu.cpuTotalMs);result.cpuRows.push(cpu);await perf.endFrame();
    }
    progress('flush',options.samples);await bounded(perf.flush());const diagnostics=perf.diagnostics();result.rawFrames=diagnostics.frames;result.timing=diagnostics.gpuTiming;result.metricSemantics=diagnostics.gpuTiming.metricSemantics;
    ensure(result.rawFrames.length===options.samples&&result.rawFrames.every(f=>!f.gpuTiming.readbackPending&&f.passes.length===1&&f.passes[0].name==='rendererTotal'&&Number.isFinite(f.passes[0].queueSpanGpuMs)&&f.passes[0].queueSpanGpuMs>0));
    const explicit=result.rawFrames.reduce((n,f)=>n+f.passes[0].commandSpans.length,0);ensure(explicit===0&&result.rawFrames.every(f=>f.passes[0].commandGpuMs===null));
    result.queueSpanGpuMs=result.rawFrames.map(f=>f.passes[0].queueSpanGpuMs);result.commandGpuMs=result.rawFrames.map(f=>f.passes[0].commandGpuMs);result.hostWaitCoverage={complete:false,hostWaitMs:null,reason:'No subsystem host-wait instrumentation was injected; zero raw explicit-wait counters do not establish absence of host waits.'};result.commandCoverage={explicitCommandSpans:explicit,complete:false,reason:'Production presenter/subsystems submit directly; no performanceTimingScope.submit adoption. Command GPU time is unavailable/null, never CPU-subtracted or fabricated.'};
    result.statistics=sm505NormalStats(result.queueSpanGpuMs);result.runThresholdPass=result.statistics.mean<=12&&result.statistics.p95<=14.5;
    result.cpu={scenePrep:sm505NormalStats(result.cpuRows.map(r=>r.cpuScenePrepMs)),normalSceneSubmit:sm505NormalStats(result.cpuRows.map(r=>r.cpuSubmitMs)),normalSceneTotal:sm505NormalStats(result.cpuRows.map(r=>r.cpuTotalMs)),presentationCallback:sm505NormalStats(result.rawFrames.map(f=>f.passes[0].cpuCallbackMs)),pureEncoding:null,encodingLimitation:'Async producer callbacks may include host waits; they are callback wall time, not pure command encoding or GPU execution.'};
    const scene=game.renderScene,instances=p.api.Ownership.buildOwnershipSceneInstances(scene,game.art.manifest),preset=p.api.Quality.workloadMetadata('Medium'),counts=category=>instances.filter(i=>i.category===category).length;
    result.workload={visibleInstances:p.gb.lastInstanceCount,staticInstances:counts('static'),dynamicInstances:counts('dynamic'),foregroundInstances:counts('foreground'),inputSprites:scene.sprites.length,activeLights:p.lighting.activeLightCount,selfShadowedLights:p.shadows.lastSelfLights?.length??null,selfShadowSamples:preset.selfShadowSamples,contactShadowSamples:preset.contactShadowSamples,occluders:p.occ.snapshot?.records?.length??null,clusters:p.clusters.snapshot?.clusters?.length??null,largestCluster:p.clusters.snapshot?.diagnostics?.largestCluster?.memberCount??null,dsoActiveTiles:p.dsoHierarchy.snapshot?.activeTiles?.length??null,dsoCoveredPixels:null,foliageInstances:p.foliage?.count??0,waterField:p.water?.fieldTexture?{width:p.water.fieldTexture.width,height:p.water.fieldTexture.height}:null,secondaryEffects:{contact:[Math.ceil(p.width/2),Math.ceil(p.height/2)],darkBloom:[p.bloom.width,p.bloom.height],postBloom:[p.post.bloomWidth,p.post.bloomHeight]},dsoPixelLimitation:'No diagnostic coverage readback was inserted into acceptance timing; covered-pixel count is unavailable rather than the target extent masquerading as coverage.'};
    result.memory=sm505NormalMemory(p,runtime);result.producerDiagnostics={presenter:p.diagnostics(),shadows:p.shadows.diagnostics(),occluders:p.occ.diagnostics(),clusters:p.clusters.diagnostics(),dso:p.dsoHierarchy.diagnostics(),foliage:p.foliage.diagnostics(),water:p.water?.diagnostics?.()||null,transparent:Object.fromEntries(Object.entries(p.fx||{}).map(([name,fx])=>[name,fx.diagnostics?.()||null])),post:p.post.diagnostics()};
    result.sceneFingerprintAfter=await fingerprint(scene);ensure(result.sceneFingerprintBefore===result.sceneFingerprintAfter);ensure(p.presentedFrames-initialFrames===options.warmup+options.samples&&p.droppedFrames===initialDrops);
    result.frameAccounting={warmup:options.warmup,retained:options.samples,presentedDelta:p.presentedFrames-initialFrames,droppedDelta:p.droppedFrames-initialDrops};result.configuration.renderSettings=JSON.parse(JSON.stringify(scene.settings));result.configuration.post=JSON.parse(JSON.stringify(scene.post||{}));result.ok=true;
  }catch(error){failed=true;result.errors.push(String(error?.stack||error));if(perf)result.partialTiming=perf.diagnostics()}
  finally{
    if(p&&originalDrain)p._drain=originalDrain;if(game&&originalRender)game.render=originalRender;if(game&&originalLoop)game.loop=originalLoop;if(game&&originalDrain)game.__smBenchmarkHooks=originalHooks;
    if(perf){try{await bounded(perf.close())}catch(error){result.errors.push('instrumentation cleanup: '+String(error));result.ok=false}}
    result.restored=!!originalDrain;result.durationMs=performance.now()-started;result.ok=result.ok&&!failed&&result.errors.length===0;root.SM505NormalBenchmarkProgress={phase:result.ok?'complete':'failed',elapsedMs:result.durationMs};
  }
  result.completeness={rendererTotal:'GPU timestamp queue span on actual normal path',commandGpuMs:'UNAVAILABLE: no explicit submission-scope coverage',passGpuBreakdown:'NOT RUN: acceptance total has one measured pass; separate source-matched localization is required for per-producer GPU times',pureCpuEncoding:'UNAVAILABLE: callback wall time may contain host waits',memory:'Allocation-descriptor estimate; unknown/excluded resources remain listed explicitly',dsoCoveredPixels:'UNAVAILABLE without separate diagnostic coverage readback',firefox:'NOT RUN by this Chrome runner; separate fresh-profile correctness campaign required'};
  result.boundary='Only genuine GPU timestamp queue spans cover the actual normal-game presentation path. Host preparation/callback and timestamp map latency remain separate. Single-run target comparison is descriptive; no release acceptance, visual acceptance or complete three-run/eight-scene acceptance is inferred.';return result;
}

if(typeof module==='object'&&module.exports)module.exports={sm505NormalStats,sm505NormalOptions,sm505NormalMemory,sm505NormalBenchmark};
