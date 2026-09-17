'use strict';
const assert=require('assert');
const Device=require('../engine/webgpu_device.js');
const Runtime=require('../engine/backend_runtime.js');

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject}}
function makeEnvironment(options={}){
  const calls={requestAdapter:[],requestDevice:[],configure:[],unconfigure:0,push:[],pop:0,destroy:0};
  const loss=deferred();let uncaptured=null;
  const device={
    lost:loss.promise,
    pushErrorScope(kind){calls.push.push(kind)},
    async popErrorScope(){calls.pop++;return options.scopeError||null},
    addEventListener(name,fn){if(name==='uncapturederror')uncaptured=fn},
    destroy(){calls.destroy++}
  };
  const adapter={
    features:new Set(options.features||['timestamp-query','texture-compression-bc']),
    limits:{maxTextureDimension2D:8192,maxBindGroups:4,maxBufferSize:268435456},
    info:{vendor:'test-vendor',architecture:'test-arch',device:'test-device',description:'deterministic fake adapter'},
    async requestDevice(desc){calls.requestDevice.push(desc);if(options.deviceFailure)throw new Error('fake device failure');return device}
  };
  const gpu={
    async requestAdapter(desc){calls.requestAdapter.push(desc);return options.noAdapter?null:adapter},
    getPreferredCanvasFormat(){return 'bgra8unorm'}
  };
  const context={configure(desc){calls.configure.push(desc);if(options.configureThrow)throw new Error('fake configure throw')},unconfigure(){calls.unconfigure++}};
  const canvas={width:4,height:3,style:{},getContext(kind){return options.noContext?null:(kind==='webgpu'?context:null)}};
  return{navigatorRef:{gpu},gpu,adapter,device,context,canvas,calls,loss,emitUncaptured(error=new Error('fake uncaptured')){uncaptured?.({error})}};
}

async function testPolicy(){
  assert.equal(Device.AUTO_WEBGPU_ENABLED,false,'Auto WebGPU gate must remain disabled before SM-505');
  assert.deepEqual(Device.resolveBackendPolicy('auto'),{requested:'auto',selected:'webgl2',reason:'webgl2-until-sm505'});
  assert.equal(Device.resolveBackendPolicy('webgpu').selected,'webgpu');assert.equal(Device.resolveBackendPolicy('webgl2').selected,'webgl2');
}
async function testManagerSuccessResizeErrorsAndLoss(){
  const env=makeEnvironment();let lost=null,uncaptured=null;
  const manager=new Device.WebGPUDeviceManager({navigatorRef:env.navigatorRef,onDeviceLost:x=>lost=x,onUncapturedError:x=>uncaptured=x});
  const initial=await manager.initialize({canvas:env.canvas,width:8,height:6,dpr:2});
  assert.equal(initial.status,'ready');assert.equal(env.canvas.width,16);assert.equal(env.canvas.height,12);assert.deepEqual(initial.requestedFeatures,['timestamp-query']);
  assert(initial.adapterFeatures.includes('texture-compression-bc'));assert.equal(initial.adapterLimits.maxTextureDimension2D,8192);assert.equal(initial.adapterInfo.vendor,'test-vendor');
  assert.deepEqual(env.calls.requestDevice[0].requiredFeatures,['timestamp-query']);assert.deepEqual(env.calls.push,['validation']);assert.equal(env.calls.pop,1);assert.equal(env.calls.configure.length,1);
  const resized=await manager.resize(11,7,1.5);assert.equal(resized.width,17);assert.equal(resized.height,11);assert.equal(manager.diagnostics().resizeCount,1);assert.equal(manager.diagnostics().configureCount,2);
  env.emitUncaptured(new Error('validation escaped scope'));await tick();assert.equal(uncaptured.message,'validation escaped scope');assert.equal(manager.diagnostics().uncapturedErrors.length,1);
  env.loss.resolve({reason:'destroyed',message:'synthetic device loss'});await tick();await tick();assert.equal(manager.status,'lost');assert.equal(lost.reason,'destroyed');assert.equal(manager.diagnostics().deviceLost.message,'synthetic device loss');
  manager.close();assert(env.calls.destroy>=1);assert(env.calls.unconfigure>=1);
}
async function testFailurePaths(){
  const absent=new Device.WebGPUDeviceManager({navigatorRef:{}});await assert.rejects(()=>absent.initialize({canvas:{}}),/navigator\.gpu/);assert.equal(absent.diagnostics().status,'failed');
  const noAdapter=makeEnvironment({noAdapter:true});const a=new Device.WebGPUDeviceManager({navigatorRef:noAdapter.navigatorRef});await assert.rejects(()=>a.initialize({canvas:noAdapter.canvas}),/requestAdapter returned null/);
  const deviceFail=makeEnvironment({deviceFailure:true});const d=new Device.WebGPUDeviceManager({navigatorRef:deviceFail.navigatorRef});await assert.rejects(()=>d.initialize({canvas:deviceFail.canvas}),/fake device failure/);
  const noContext=makeEnvironment({noContext:true});const c=new Device.WebGPUDeviceManager({navigatorRef:noContext.navigatorRef});await assert.rejects(()=>c.initialize({canvas:noContext.canvas}),/context unavailable/);
  const scoped=makeEnvironment({scopeError:{message:'bad canvas descriptor'}});const s=new Device.WebGPUDeviceManager({navigatorRef:scoped.navigatorRef});await assert.rejects(()=>s.initialize({canvas:scoped.canvas}),/validation error during canvas configure/);
  const deliberate=makeEnvironment();const f=new Device.WebGPUDeviceManager({navigatorRef:deliberate.navigatorRef,failureStage:'device'});await assert.rejects(()=>f.initialize({canvas:deliberate.canvas}),/deliberate WebGPU device failure/);
}
async function testRuntimeSelectionAndFallback(){
  const storageValues={};const storage={getItem:k=>storageValues[k]||null,setItem:(k,v)=>{storageValues[k]=String(v)}};
  let env=makeEnvironment();let managers=[];
  const runtime=new Runtime.BackendRuntime({navigatorRef:env.navigatorRef,storage,locationRef:{search:'',hostname:'example.test'},documentRef:null,canvasFactory:()=>env.canvas,managerFactory:opts=>{const m=new Device.WebGPUDeviceManager(opts);managers.push(m);return m}});
  await runtime.select('auto',{persist:false});assert.equal(runtime.activeBackend,'webgl2');assert.equal(runtime.presentationBackend,'webgl2');assert.equal(managers.length,0,'Auto must not even request a WebGPU adapter before SM-505');
  await runtime.select('webgpu',{persist:false});assert.equal(runtime.activeBackend,'webgpu');assert.equal(runtime.presentationBackend,'webgl2');assert.equal(runtime.status,'ready-platform');assert.equal(runtime.diagnostics().webgpu.status,'ready');
  env.loss.resolve({reason:'unknown',message:'runtime loss'});await tick();await tick();assert.equal(runtime.activeBackend,'webgl2');assert.equal(runtime.status,'fallback-device-lost');assert.match(runtime.fallbackReason,/device-lost/);
  await runtime.select('webgl2',{persist:false});assert.equal(runtime.activeBackend,'webgl2');assert.equal(runtime.status,'ready');

  env=makeEnvironment({deviceFailure:true});const failed=new Runtime.BackendRuntime({navigatorRef:env.navigatorRef,locationRef:{search:'',hostname:'example.test'},documentRef:null,canvasFactory:()=>env.canvas,managerFactory:opts=>new Device.WebGPUDeviceManager(opts)});
  await failed.select('webgpu',{persist:false});assert.equal(failed.activeBackend,'webgl2');assert.equal(failed.status,'fallback');assert.match(failed.fallbackReason,/fake device failure/);assert.equal(failed.requestedBackend,'webgpu');
}
async function testQueryFailureInjectionGuard(){
  const env=makeEnvironment();const local=new Runtime.BackendRuntime({navigatorRef:env.navigatorRef,locationRef:{search:'?backend=webgpu&webgpuFail=adapter',hostname:'localhost'},documentRef:null,canvasFactory:()=>env.canvas,managerFactory:opts=>new Device.WebGPUDeviceManager(opts)});
  await local.start();assert.equal(local.requestedBackend,'webgpu');assert.equal(local.activeBackend,'webgl2');assert.match(local.fallbackReason,/deliberate WebGPU adapter failure/);
  const remoteEnv=makeEnvironment();const remote=new Runtime.BackendRuntime({navigatorRef:remoteEnv.navigatorRef,locationRef:{search:'?backend=webgpu&webgpuFail=adapter',hostname:'example.test'},documentRef:null,canvasFactory:()=>remoteEnv.canvas,managerFactory:opts=>new Device.WebGPUDeviceManager(opts)});
  await remote.start();assert.equal(remote.activeBackend,'webgpu','failure injection must not be honored on ordinary remote gameplay URLs');
}

(async()=>{
  await testPolicy();await testManagerSuccessResizeErrorsAndLoss();await testFailurePaths();await testRuntimeSelectionAndFallback();await testQueryFailureInjectionGuard();
  console.log('SM-102 WEBGPU LIFECYCLE PASS: policy, capability inventory, optional negotiation, validation scope, resize/reconfigure, uncaptured errors, device loss, deliberate failure and WebGL2 fallback verified');
})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
