#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const {webcrypto}=require('crypto');
const Post=require('../engine/webgpu_post.js');
const source=fs.readFileSync(require.resolve('../engine/render_harness.js'),'utf8');
const originalDefaults=JSON.stringify(Post.DEFAULTS);
const expected={ambientInitial:.55,ambientComplete:.55,playerConeRange:520,playerConeInnerAngle:50,playerConeOuterAngle:75,playerConeIntensity:3,shadowLift:0,contrast:1,saturation:1,gradeMix:0,bloom:false,vignette:0,grain:0};
const plain=value=>JSON.parse(JSON.stringify(value));

function environment(query){
  const counters={fetch:0,layout:0,writes:0,removes:0,background:0,ui:0,renders:[]},listeners={},nodes={};
  class Storage{getItem(){return 'untouched-player-data'}setItem(){counters.writes++}removeItem(){counters.removes++}}
  const canvas={style:{},width:640,height:360,toBlob(callback){callback(new Blob(['CPU VM canvas placeholder']))},toDataURL(){return'data:image/png;base64,'}};
  const frame={style:{}};
  const document={readyState:'loading',documentElement:{style:{}},head:{appendChild(){counters.layout++}},body:{style:{},dataset:{ready:'1'},classList:{add(){}},appendChild(node){nodes[node.id]=node}},getElementById(id){return id==='game'?canvas:id==='frame'?frame:nodes[id]||null},createElement(){return{style:{}}},querySelectorAll(){return[]},addEventListener(name,callback){listeners[name]=callback}};
  const fixture={schema:'steelmoth-render-fixture/v1',id:'inspection-test',room:{index:0},state:{},player:{x:120,y:178},render:{hideDynamicActors:false},graphics:{...Post.DEFAULTS,ambientInitial:.12,ambientComplete:.18,playerConeRange:100,playerConeInnerAngle:10,playerConeOuterAngle:20,playerConeIntensity:.2,shadowLift:-.25},diagnostic:{ambient:.23,coneIntensity:.4,coneRange:135}};
  const game={graphics:{...Post.DEFAULTS,ambientInitial:.1,ambientComplete:.3},ambientLevel:.1,state:{},storyData:{rooms:[{key:'inspection-room'}]},rooms:[{key:'inspection-room',index:0}],keys:new Set(),renderSceneBridge:{},renderTransform:{},playerLightOrigin(){return{x:120,y:163.5}},enterRoom(index){this.room=this.rooms[index]},ensureBackground(){counters.background++},updateUI(){counters.ui++},render(){counters.renders.push({graphics:plain(this.graphics),ambient:this.ambientLevel})},diagnostics(){return{version:'test',renderer:{native:[640,360],gpuTimerQueries:false}}},playerLightCone(){return{range:this.graphics.playerConeRange,inner:this.graphics.playerConeInnerAngle,outer:this.graphics.playerConeOuterAngle,intensity:this.graphics.playerConeIntensity}}};
  const isolatedMath=Object.create(Math),originalRandom=isolatedMath.random;
  const context={URLSearchParams,location:{search:query},document,navigator:{userAgent:'CPU VM test',platform:'node'},Storage,Math:isolatedMath,Blob,crypto:webcrypto,performance:{now:()=>0},devicePixelRatio:1,game,console,fetch:async()=>{counters.fetch++;return{ok:true,json:async()=>plain(fixture)}},requestAnimationFrame(callback){Promise.resolve().then(()=>callback(0))},setTimeout};
  context.window=context;vm.createContext(context);vm.runInContext(source,context,{filename:'engine/render_harness.js'});
  return{context,game,fixture,counters,harness:context.SteelMothRenderHarness,originalRandom,async start(){await listeners.DOMContentLoaded();return context.SteelMothRenderHarness.ready}};
}

function testPurePatch(){
  const e=environment('?renderTest=1&fixture=inspection-test&inspection=development');
  assert.deepEqual(plain(e.harness.inspectionPatch('development')),expected);
  const first=e.harness.inspectionPatch('development'),second=e.harness.inspectionPatch('development');
  first.ambientInitial=-1;assert.equal(second.ambientInitial,.55,'preset returns fresh independent settings');
  assert.deepEqual(plain(e.harness.inspectionPatch('none')),{});assert.notStrictEqual(e.harness.inspectionPatch('none'),e.harness.inspectionPatch('none'));
  assert.throws(()=>e.harness.inspectionPatch('brighten-unbounded'),/unknown inspection preset/);
  for(const field of ['exposure','gamma','brightness'])assert(!(field in second),'inspection preserves existing '+field+' instead of retuning it');

  // Execute the actual game's light-control clamp, without constructing the
  // game/renderer or providing a browser/GPU. The chosen preset fits all caps.
  const gameSource=fs.readFileSync(require.resolve('../engine/game.js'),'utf8');
  const method=gameSource.match(/  playerLightCone\(\)\{([^\n]+)\}\r?\n/);assert(method,'actual playerLightCone control implementation found');
  const cone=vm.runInNewContext('({playerLightCone(){'+method[1]+'}}).playerLightCone',{clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),Math,PLAYER_CONE_RANGE:248,PLAYER_CONE_OUTER_DEG:30,PLAYER_CONE_INNER_DEG:17});
  const light=cone.call({graphics:expected,x:120,playerFacing:1,mouseAimActive:true,mouseAimX:400,mouseAimY:160,playerLightOrigin:()=>({x:120,y:160})});
  assert.equal(light.range,520);assert.equal(light.intensity,3);
  assert(Math.abs(Math.acos(light.innerCos)*180/Math.PI-50)<1e-10);assert(Math.abs(Math.acos(light.outerCos)*180/Math.PI-75)<1e-10);
}

async function testDevelopmentApplication(){
  const e=environment('?renderTest=1&fixture=inspection-test&inspection=development');
  const result=await e.start();assert.equal(result.ok,true);
  for(const [key,value]of Object.entries(expected))assert.equal(e.game.graphics[key],value,'inspection wins over fixture/diagnostic setting '+key);
  assert.equal(e.game.ambientLevel,.55);assert.equal(e.game.graphics.exposure,1.6);assert.equal(e.game.graphics.gamma,1);assert.equal(e.game.graphics.brightness,0);
  assert(e.counters.renders.length>0);assert(e.counters.renders.every(frame=>frame.ambient===.55&&frame.graphics.playerConeRange===520));
  assert.equal(result.metadata.inspectionPreset,'development');assert.deepEqual(plain(result.metadata.inspectionSettings),expected);
  assert.equal(result.metadata.physicalAcceptance,false);assert.equal(result.metadata.visualAcceptance,false);assert(result.metadata.limitations.some(v=>v.includes('never visual, performance or release acceptance')));
  assert.equal(e.counters.writes,0);assert.equal(e.counters.removes,0,'development view never changes player storage');
  assert.equal(JSON.stringify(Post.DEFAULTS),originalDefaults,'production artistic defaults remain byte-for-byte unchanged');
}

async function testNoneAndDisabled(){
  const none=environment('?renderTest=1&fixture=inspection-test&inspection=none'),result=await none.start();
  assert.equal(result.ok,true);assert.equal(none.game.ambientLevel,.23);assert.equal(none.game.graphics.playerConeRange,135);assert.equal(none.game.graphics.playerConeIntensity,.4);assert.equal(none.game.graphics.shadowLift,-.25);
  assert.equal(result.metadata.inspectionPreset,'none');assert.deepEqual(plain(result.metadata.inspectionSettings),{});
  const disabled=environment('?fixture=inspection-test&inspection=development'),before=JSON.stringify(disabled.game.graphics),level=disabled.game.ambientLevel;
  const noCapture=await disabled.start();assert.equal(noCapture.disabled,true);assert.equal(disabled.harness.enabled,false);
  assert.equal(JSON.stringify(disabled.game.graphics),before);assert.equal(disabled.game.ambientLevel,level);assert.equal(disabled.context.Math.random,disabled.originalRandom);
  assert.equal(disabled.counters.fetch,0);assert.equal(disabled.counters.layout,0);assert.equal(disabled.counters.background,0);assert.equal(disabled.counters.writes,0);assert.equal(disabled.counters.removes,0);
}

async function testInvalidAndBenchmarkRefusal(){
  for(const query of ['?renderTest=1&fixture=inspection-test&inspection=development&benchmark=1','?renderTest=1&fixture=inspection-test&inspection=unbounded']){
    const e=environment(query),before=JSON.stringify(e.game.graphics),result=await e.start();assert.equal(result.ok,false);
    assert(/forbidden for benchmark|unknown inspection preset/.test(result.error));assert.equal(e.counters.fetch,0,'invalid inspection cannot enter fixture/benchmark setup');assert.equal(e.counters.layout,0);assert.equal(e.counters.renders.length,0);assert.equal(JSON.stringify(e.game.graphics),before);assert.equal(e.counters.writes,0);
  }
}

(async()=>{testPurePatch();await testDevelopmentApplication();await testNoneAndDisabled();await testInvalidAndBenchmarkRefusal();assert.equal(JSON.stringify(Post.DEFAULTS),originalDefaults);console.log('SM-505 INSPECTION PRESET CPU PASS: real VM harness, bounded long/wide/strong flashlight, fixture precedence, neutral diagnostic grading through normal post controls, isolated development metadata, disabled/none controls and benchmark refusal; no GPU/visual acceptance')})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
