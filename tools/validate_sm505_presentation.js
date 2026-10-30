'use strict';

const assert=require('assert');
const Device=require('../engine/webgpu_device.js');
const Runtime=require('../engine/backend_runtime.js');
const Adapter=require('../engine/webgl2_scene_adapter.js');
const Scene=require('../engine/render_scene.js');
const Pseudo=require('../engine/pseudo_depth.js');
const Presenter=require('../engine/webgpu_scene_presenter.js');

function fakeManagerFactory(options={}){
  const manager={
    status:'idle',device:{queue:{}},configuration:null,closed:false,
    async initialize(){if(options.managerFailure)throw new Error('synthetic WebGPU platform failure');this.status='ready';this.configuration={width:2,height:2,dpr:1,format:'bgra8unorm'};return this.diagnostics()},
    async resize(width,height,dpr=1){this.configuration={width,height,dpr,format:'bgra8unorm'};return this.configuration},
    diagnostics(){return{status:this.status,configuration:this.configuration}},
    close(){this.closed=true;this.status='closed'}
  };
  return manager;
}

function fakeInfrastructure(){return{closed:false,resize(){return false},diagnostics(){return{fake:true}},close(){this.closed=true}}}

function makePresenterFactory(options={}){
  const made=[];
  const factory=({onFailure})=>{
    const p={
      ready:false,closed:false,consumeCount:0,lastScene:null,onFailure,
      async initialize(){if(options.initializeFailure)throw new Error('synthetic presenter initialization failure');this.ready=true;return this},
      consume(scene){if(options.rejectConsume)return false;this.consumeCount++;this.lastScene=JSON.parse(JSON.stringify(scene));return true},
      fail(message='synthetic presenter runtime failure'){onFailure(new Error(message),this)},
      diagnostics(){return{ready:this.ready,closed:this.closed,consumeCount:this.consumeCount}},
      close(){this.closed=true;this.ready=false}
    };
    made.push(p);return p;
  };
  factory.made=made;return factory;
}

function makeRenderer(){
  const calls={begin:0,end:0,sprites:0};
  const renderer={staticMaterialSprites:[],hdArt:{manifest:{regions:{},source_size:[1,1],world_scale:1,region_meta:{}}},atlas:{s:{}},
    begin(){calls.begin++;return 'begin-webgl2'},
    end(){calls.end++;return 'end-webgl2'}
  };
  for(const name of Adapter.CAPTURE_METHODS)renderer[name]=function(){calls.sprites++};
  return{renderer,calls};
}

function makeGame(){
  const {renderer,calls}=makeRenderer();return{renderer,calls,room:{key:'room-sm505'},fireflies:null,creatures:null,followers:null,flock:null,particles:null};
}

function makeRuntime(presenterFactory,extra={}){
  return new Runtime.BackendRuntime({
    navigatorRef:{gpu:{}},locationRef:{search:'',hostname:'example.test'},documentRef:null,storage:null,
    canvasFactory:()=>({width:2,height:2,style:{}}),
    managerFactory:()=>fakeManagerFactory(extra),
    infrastructureFactory:fakeInfrastructure,
    presenterFactory
  });
}

async function testExplicitCandidateConsumesNormalRenderScene(){
  const presenterFactory=makePresenterFactory(),runtime=makeRuntime(presenterFactory),game=makeGame();runtime.attachGame(game);
  await runtime.select('webgpu',{persist:false});
  assert.equal(runtime.activeBackend,'webgpu');assert.equal(runtime.presentationBackend,'webgpu');assert.equal(runtime.status,'ready');
  const bridge=new Adapter.RenderSceneBridge(game);
  bridge.begin();const result=bridge.end([1,1,1],[],[],{},[],null,null,null,null,null,null);
  assert.equal(game.calls.begin,1,'compatibility begin still resets the WebGL2 queue');
  assert.equal(game.calls.end,0,'WebGL2 must not present while WebGPU owns presentation');
  assert.equal(presenterFactory.made[0].consumeCount,1,'normal-game bridge must call the WebGPU consumer');
  assert.equal(result.schema,Scene.SCHEMA);Scene.validateRenderScene(presenterFactory.made[0].lastScene);
  assert.equal(runtime.diagnostics().presentationBackend,'webgpu');assert.equal(runtime.diagnostics().webgpuPresenter.consumeCount,1);
}

async function testInitializationFailureCannotClaimWebGPUPresentation(){
  const presenterFactory=makePresenterFactory({initializeFailure:true}),runtime=makeRuntime(presenterFactory),game=makeGame();runtime.attachGame(game);
  const result=await runtime.select('webgpu',{persist:false});
  assert.equal(result.activeBackend,'webgl2');assert.equal(result.presentationBackend,'webgl2');assert.equal(runtime.status,'fallback');
  assert.match(runtime.fallbackReason,/presenter initialization failure/);assert.equal(presenterFactory.made[0].closed,true);
}

async function testRuntimeFailureFallsBackWithoutMixedState(){
  const presenterFactory=makePresenterFactory(),runtime=makeRuntime(presenterFactory),game=makeGame();runtime.attachGame(game);await runtime.select('webgpu',{persist:false});
  const first=presenterFactory.made[0];first.fail();
  assert.equal(runtime.activeBackend,'webgl2');assert.equal(runtime.presentationBackend,'webgl2');assert.equal(runtime.status,'fallback-runtime');assert.equal(first.closed,true);
  assert.equal(runtime.consumeScene({schema:'not-used'}),false,'demoted runtime must never keep consuming WebGPU frames');
}

async function testSwitchClosesStalePresenterAndAutoStaysCompatibility(){
  const presenterFactory=makePresenterFactory(),runtime=makeRuntime(presenterFactory),game=makeGame();runtime.attachGame(game);await runtime.select('webgpu',{persist:false});
  const first=presenterFactory.made[0];await runtime.select('webgl2',{persist:false});assert.equal(first.closed,true);assert.equal(runtime.presentationBackend,'webgl2');
  await runtime.select('webgpu',{persist:false});const second=presenterFactory.made[1];assert.notEqual(first,second);assert.equal(second.closed,false);assert.equal(runtime.presentationBackend,'webgpu');
  await runtime.select('auto',{persist:false});assert.equal(second.closed,true);assert.equal(runtime.activeBackend,'webgl2');assert.equal(runtime.presentationBackend,'webgl2');assert.equal(Device.AUTO_WEBGPU_ENABLED,false);
}

function testRenderSceneScalingIsDerivedAndNonMutating(){
  const scene=new Scene.RenderSceneBuilder({sequence:7,roomId:'scale-room'}).finalize({logicalSize:[640,360],settings:{lighting:true}});
  scene.sprites.push({schema:Scene.SPRITE_SCHEMA,id:'synthetic:0',stableIdBasis:'test',category:'dynamic',primitive:'quad',atlas:'legacy',spriteId:'orb',materialId:null,transform:{x:100,y:120,w:20,h:30,rotation:0,flip:false},root:{x:100,y:135,authority:'test'},style:{alpha:1,color:[1,1,1]}});
  const before=JSON.stringify(scene),scaled=Presenter.scaleScene(scene,1280,720,Pseudo);
  assert.equal(JSON.stringify(scene),before,'SM-505 scaling must not mutate the backend-neutral RenderScene');
  assert.equal(scaled.scene.sprites[0].transform.x,200);assert.equal(scaled.scene.sprites[0].root.y,270);assert(Number.isFinite(scaled.scene.sprites[0].depth01));
}

(async()=>{
  await testExplicitCandidateConsumesNormalRenderScene();
  await testInitializationFailureCannotClaimWebGPUPresentation();
  await testRuntimeFailureFallsBackWithoutMixedState();
  await testSwitchClosesStalePresenterAndAutoStaysCompatibility();
  testRenderSceneScalingIsDerivedAndNonMutating();
  console.log('SM-505 PRESENTATION ROUTING PASS: normal RenderScene consumption, truthful presentation diagnostics, deterministic fallback, lifecycle reset, Auto gate, and non-mutating scene derivation verified');
})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
