#!/usr/bin/env node
'use strict';
const assert=require('assert');
const Scene=require('../engine/render_scene.js');
const Presenter=require('../engine/webgpu_scene_presenter.js');
const Lighting=require('../engine/webgpu_lighting.js');

const cone={enabled:true,x:120,y:150,z:22,dx:1,dy:0,range:200,innerCos:.94,outerCos:.85,intensity:2,color:[.82,.90,.96]};
const scene=new Scene.RenderSceneBuilder({sequence:1,roomId:'cone-scale'}).finalize({
  logicalSize:[640,360],lights:[{group:'playerOmni',x:120,y:150,z:22,radius:80,intensity:1,color:[1,1,1]}],playerCone:cone,
  settings:{lighting:true,ambient:.1}
});
const original=JSON.stringify(scene);
let cases=0;
for(const [width,height,scale] of [[640,360,1],[1280,720,2],[1920,1080,3],[960,720,1.5]]){
  const derived=Presenter.scaleScene(scene,width,height).scene;
  const lights=Lighting.buildCanonicalLights(derived,derived.settings);
  const c=lights.find(x=>x.type==='cone'),p=lights.find(x=>x.type==='point');
  assert(c&&p,'both canonical light types survive native extent derivation');
  assert.equal(c.radius,cone.range*scale,'canonical cone range scales with logical world distances');
  assert.equal(p.radius,80*scale,'point radius follows the same world-distance scale');
  assert.equal(derived.playerCone.range,cone.range*scale,'standalone playerCone agrees with lights entry');
  assert.equal(c.position[0],cone.x*width/640);
  assert.equal(c.position[1],cone.y*height/360);
  assert.equal(c.position[2],cone.z*scale,'explicit elevation retains existing distance conversion');
  assert.equal(c.intensity,cone.intensity,'distance conversion never compensates with light brightness');
  assert.deepEqual(c.color,Lighting.buildCanonicalLights(scene,scene.settings).find(x=>x.type==='cone').color);
  assert.deepEqual(c.direction,[1,0]);
  assert.equal(c.innerCos,cone.innerCos);assert.equal(c.outerCos,cone.outerCos);
  assert.equal(JSON.stringify(scene),original,'native presentation cannot mutate gameplay lighting');
  if(scale!==1){
    // Retain the old missing-range behavior as a negative witness. At a point
    // 75% down the logical beam, the old native beam prematurely rejects it.
    const logicalDistance=cone.range*.75,nativeDistance=logicalDistance*scale;
    assert(nativeDistance<c.radius,'corrected native beam retains its logical coverage');
    assert(nativeDistance>=cone.range,'unscaled pre-fix range loses this covered point');
  }
  cases++;
}

// A serialized scene may omit the duplicate cone in `lights`. Canonical light
// construction must still get the correct distance from the standalone field.
const standalone=JSON.parse(original);standalone.lights=standalone.lights.filter(x=>x.type!=='cone');
const scaledStandalone=Presenter.scaleScene(standalone,1920,1080).scene;
assert.equal(Lighting.buildCanonicalLights(scaledStandalone,scaledStandalone.settings).find(x=>x.type==='cone').radius,600);
assert.equal(JSON.stringify(standalone.playerCone),JSON.stringify(scene.playerCone));

// Never scale a radius-only cone twice by manufacturing or aliasing range.
const radiusOnly=JSON.parse(original);
for(const c of [...radiusOnly.lights.filter(x=>x.type==='cone'),radiusOnly.playerCone]){delete c.range;c.radius=200;}
const derivedRadius=Presenter.scaleScene(radiusOnly,1920,1080).scene;
assert.equal(Lighting.buildCanonicalLights(derivedRadius,derivedRadius.settings).find(x=>x.type==='cone').radius,600);
assert(!('range' in derivedRadius.playerCone));

// Actual gameplay playerLightCone() omits elevation. NormalizeScene serializes
// that as null, and SM-204 owns the logical default. Resolve it before scaling.
const omitted=JSON.parse(original);
for(const light of omitted.lights)light.z=null;
delete omitted.playerCone.z;
const omittedBefore=JSON.stringify(omitted);
const canonicalLogical=Lighting.buildCanonicalLights(omitted,omitted.settings);
for(const scale of [1,2,3]){
  const derived=Presenter.scaleScene(omitted,640*scale,360*scale,null,Lighting).scene;
  const canonicalNative=Lighting.buildCanonicalLights(derived,derived.settings);
  for(let i=0;i<canonicalLogical.length;i++)assert.equal(canonicalNative[i].position[2],canonicalLogical[i].position[2]*scale,'SM-204 logical default elevation follows the same native distance conversion');
  assert.equal(derived.playerCone.z,canonicalLogical.find(x=>x.type==='cone').position[2]*scale);
  const sample={albedo:[.2,.3,.4,1],normalRoughness:[.5,.5,1,.85],heightMaterial:[0,0,1,0]};
  const logical=Lighting.shadePixelReference(sample,canonicalLogical,{ambient:0},[150,150]);
  const native=Lighting.shadePixelReference(sample,canonicalNative,{ambient:0},[150*scale,150*scale]);
  for(let k=0;k<4;k++)assert(Math.abs(logical[k]-native[k])<1e-12,'uniform native scaling preserves the actual lighting equation');
  if(scale>1){
    // Old behavior let SM-204 supply unscaled logical defaults after conversion.
    const wrong=canonicalNative.map((light,i)=>({...light,position:[...light.position.slice(0,2),canonicalLogical[i].position[2]]}));
    const old=Lighting.shadePixelReference(sample,wrong,{ambient:0},[150*scale,150*scale]);
    assert(old.slice(0,3).some((v,k)=>Math.abs(v-native[k])>1e-4),'pre-fix default-elevation witness changes real light response');
  }
}
assert.equal(JSON.stringify(omitted),omittedBefore);
const omittedStandalone=JSON.parse(omittedBefore);omittedStandalone.lights=omittedStandalone.lights.filter(light=>light.type!=='cone');
const nativeStandalone=Presenter.scaleScene(omittedStandalone,1920,1080,null,Lighting).scene;
assert.equal(Lighting.buildCanonicalLights(nativeStandalone,nativeStandalone.settings).find(light=>light.type==='cone').position[2],66,'standalone omitted cone elevation resolves before scaling');
const zero=JSON.parse(original);for(const light of [...zero.lights,zero.playerCone])light.z=0;
const zeroDerived=Presenter.scaleScene(zero,1920,1080,null,Lighting).scene;
assert(zeroDerived.lights.every(light=>light.z===0)&&zeroDerived.playerCone.z===0,'explicit zero is an elevation, never a request for defaults');
const oldUtilityCall=Presenter.scaleScene(omitted,1920,1080).scene;
assert.equal(oldUtilityCall.lights[0].z,null,'optional API retains omitted-elevation behavior for existing utility callers');
assert(!('z' in oldUtilityCall.playerCone));
console.log(`SM-505 SCENE SCALE PASS: ${cases} extents, duplicate/standalone/radius-only cones, canonical default/zero elevation, lighting invariance, non-mutation and pre-fix negative witnesses`);
