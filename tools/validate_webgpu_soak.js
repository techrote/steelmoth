'use strict';

const assert=require('assert');
const Resources=require('../engine/webgpu_resources.js');
const Transition=require('../engine/webgpu_transition_state.js');
const Editor=require('../engine/webgpu_editor_state.js');
const Soak=require('../engine/webgpu_soak.js');
const Device=require('../engine/webgpu_device.js');
const Backend=require('../engine/backend_runtime.js');

let handleId=0;
class FakeHandle{
  constructor(kind,descriptor){this.kind=kind;this.descriptor=descriptor;this.id=++handleId;this.destroyed=false}
  destroy(){assert(!this.destroyed,`double destroy ${this.kind}#${this.id}`);this.destroyed=true}
}
function fakeDevice(){
  return{
    queue:{writeBuffer(){},submit(){}},
    createTexture(descriptor){return new FakeHandle('texture',descriptor)},
    createBuffer(descriptor){return new FakeHandle('buffer',descriptor)},
    pushErrorScope(){},
    async popErrorScope(){return null},
  };
}
const pipelineDiag=count=3=>({schema:'steelmoth-webgpu-pipeline-cache/v1',generation:1,count,hits:0,misses:count,clearCount:0,keys:Array.from({length:count},(_,i)=>`render:p${i}`)});

function invalidator(){return{calls:[],invalidate(reason,clearHistory=false){this.calls.push({reason,clearHistory})}}}

async function main(){
  const device=fakeDevice();
  const registry=new Resources.ResourceRegistry({device,queue:device.queue,width:64,height:64,dynamicUploadBytes:8192,labelPrefix:'SM803'});
  registry.defineTexture('hdr',{format:'rgba16float',usage:Resources.TEXTURE_USAGE.RENDER_ATTACHMENT|Resources.TEXTURE_USAGE.TEXTURE_BINDING,size:'surface',resizeDependent:true});
  registry.defineTexture('objectId',{format:'r32uint',usage:Resources.TEXTURE_USAGE.RENDER_ATTACHMENT|Resources.TEXTURE_USAGE.TEXTURE_BINDING,size:'surface',resizeDependent:true});
  registry.defineBuffer('staticScene',{size:4096,usage:Resources.BUFFER_USAGE.STORAGE|Resources.BUFFER_USAGE.COPY_DST});
  registry.ensureDynamicArena('frame',{capacity:8192,usage:Resources.BUFFER_USAGE.STORAGE});

  const transition=new Transition.RenderTransitionInvalidationGraph({roomId:'room-0',backend:'webgpu',extent:{width:64,height:64,dpr:1},maxEvents:32});
  const depthTarget=invalidator(),historyTarget=invalidator();
  transition.register('depthHierarchy',depthTarget);
  transition.register('darkBloomTemporal',historyTarget,{history:true});
  const editor=new Editor.EditorRenderInvalidationHub({maxEvents:24});
  const editorTarget=invalidator();editor.register('depthHierarchy',editorTarget,{persistent:true});
  const monitor=new Soak.SoakMonitor({warmupSamples:16,maxSamples:256,resourceCountSlack:0,byteSlack:0});
  const extents=[[64,64],[96,64],[64,96],[80,80]];
  let staleRejected=0;

  for(let i=0;i<1200;i++){
    registry.beginFrame();
    registry.uploadDynamic('frame',new Uint32Array([i,i+1,i+2,i+3]),{capacity:8192,usage:Resources.BUFFER_USAGE.STORAGE});
    const [w,h]=extents[i%extents.length];registry.resize(w,h);
    if(i%3===0){transition.recordDerived('objectId',{room:i});const before=transition.readDerived('objectId');assert(before&&before.room===i);transition.invalidate('room-change',{fromRoomId:`room-${i}`,toRoomId:`room-${i+1}`});assert.strictEqual(transition.readDerived('objectId'),null);staleRejected++}
    else if(i%7===0)transition.invalidate('resize',{extent:{width:w,height:h,dpr:1}});
    if(i%97===0){registry.resetDevice(device,device.queue);transition.invalidate('device-rebuild',{fromBackend:'webgpu',toBackend:'webgpu',extent:{width:w,height:h,dpr:1}})}
    if(i%5===0){const reasons=['place','move','delete','undo','redo'];editor.invalidate(reasons[(i/5)%reasons.length|0],{roomId:`room-${i%9}`,room:{editor_decor:[{editor_id:'decor_1',x:i,y:i+1}]}});editor.markRebuilt()}
    const diag=registry.diagnostics();
    assert.strictEqual(diag.resourceCount,diag.definitionCount,'live resources must match definitions during soak');
    assert.strictEqual(diag.createCount-diag.destroyCount,diag.resourceCount,'created-destroyed must equal live resources');
    monitor.sample(`cycle-${i}`,{resources:diag,pipelines:pipelineDiag()}, {transition:transition.diagnostics(),transitionMaxEvents:32,editor:editor.diagnostics(),editorMaxEvents:24,uncapturedErrors:0,backendStatus:'ready-platform'});
  }

  const summary=monitor.summary();
  assert.strictEqual(summary.ok,true,JSON.stringify(summary.errors.slice(0,3)));
  assert(summary.totalSamples===1200);
  assert(Object.keys(summary.byExtent).length===4);
  for(const [key,row] of Object.entries(summary.byExtent)){
    assert.strictEqual(row.minResourceCount,row.maxResourceCount,`resource count drift for ${key}`);
    assert.strictEqual(row.minEstimatedBytes,row.maxEstimatedBytes,`estimated byte drift for ${key}`);
    assert.strictEqual(row.minPipelineCount,row.maxPipelineCount,`pipeline cache drift for ${key}`);
  }
  assert(transition.diagnostics().events.length<=32,'transition log must stay bounded');
  assert(editor.diagnostics().events.length<=24,'editor log must stay bounded');
  assert(staleRejected>=300,'room transition stale-state rejection must be stressed repeatedly');
  assert(historyTarget.calls.some(x=>x.clearHistory===true),'temporal history must be cleared on invalidation');

  const growth=new Soak.SoakMonitor({warmupSamples:0,maxSamples:16});
  const base={schema:'steelmoth-webgpu-resources/v1',extent:{width:10,height:10},resourceCount:4,definitionCount:4,estimatedBytes:1000,createCount:4,destroyCount:0,rebuildCount:0,resizeCount:0,generation:1};
  growth.sample('base',{resources:base,pipelines:pipelineDiag(2)});
  growth.sample('leak',{resources:{...base,resourceCount:5,definitionCount:5,estimatedBytes:1200},pipelines:pipelineDiag(3)});
  assert.strictEqual(growth.summary().ok,false,'monitor must reject sustained resource growth');
  assert(growth.summary().errors.some(e=>/resource count grew/.test(e.message)));

  const fallbackRuntime=new Backend.BackendRuntime({
    root:{},documentRef:null,locationRef:{search:'',hostname:'localhost'},storage:null,navigatorRef:{gpu:{}},canvasFactory:()=>({width:0,height:0,style:{}}),
    managerFactory:()=>({status:'idle',configuration:null,async initialize(){throw new Error('SM803 deliberate init failure')},close(){},diagnostics(){return{status:this.status}}}),
    infrastructureFactory:()=>{throw new Error('infrastructure must not be constructed after init failure')}
  });
  const fallback=await fallbackRuntime.select(Device.BACKENDS.WEBGPU,{persist:false});
  assert.strictEqual(fallback.activeBackend,Device.BACKENDS.WEBGL2);
  assert.strictEqual(fallback.presentationBackend,Device.BACKENDS.WEBGL2);
  assert.strictEqual(fallback.status,'fallback');
  assert(/SM803 deliberate init failure/.test(fallback.fallbackReason));

  const beforeClose=registry.diagnostics();registry.close();const afterClose=registry.diagnostics();
  assert(beforeClose.resourceCount>0);assert.strictEqual(afterClose.resourceCount,0);assert.strictEqual(afterClose.createCount-afterClose.destroyCount,0,'all owned fake GPU resources must be destroyed at close');

  console.log(`SM-803 SOAK REGRESSION PASS: cycles=1200 extents=${Object.keys(summary.byExtent).length} staleRejects=${staleRejected} creates=${beforeClose.createCount} destroys=${afterClose.destroyCount}`);
}

main().catch(error=>{console.error(error?.stack||error);process.exit(1)});
