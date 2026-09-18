#!/usr/bin/env node
'use strict';
const assert=require('assert');
const Lighting=require('../engine/webgpu_lighting.js');

const settings={lighting:true,ambient:.1,emissive:2,lightRadius:2,normalStrength:1,heightStrength:1,roughnessScale:1,metalnessScale:1,materialAOStrength:.62,pbrSpecularStrength:.70};
const scene={lights:[
  {id:'light:playerOmni:0',type:'playerOmni',independent:true,x:10,y:20,z:22,radius:60,intensity:.16,color:[1,.9,.8]},
  {id:'light:pulse:0',type:'pulse',x:20,y:20,z:19,radius:100,intensity:.5,color:[.8,.9,1]},
  {id:'light:player-cone:0',type:'cone',x:30,y:30,z:22,range:248,intensity:2,color:[.82,.90,.96],dx:0,dy:-1,innerCos:Math.cos(Math.PI/6),outerCos:Math.cos(Math.PI/3),enabled:true}
]};
const lights=Lighting.buildCanonicalLights(scene,settings);
assert.equal(lights.length,3);
assert.equal(lights[0].type,'omni');assert.equal(lights[0].radius,120);assert.equal(lights[0].intensity,.16,'independent omni must not inherit emissive strength');
assert.equal(lights[1].type,'point');assert.equal(lights[1].radius,200);assert.equal(lights[1].intensity,1,'ordinary point lights inherit compatibility emissive strength');
assert.equal(lights[2].type,'cone');assert.equal(lights[2].radius,248);assert.equal(lights[2].intensity,2);assert.deepEqual(lights[2].direction,[0,-1]);
assert.deepEqual(Lighting.buildCanonicalLights(scene,{...settings,lighting:false}),[],'lighting-off must submit zero direct lights');

const packed=Lighting.packLights(lights);assert.equal(packed.byteLength,Lighting.MAX_LIGHTS*Lighting.LIGHT_STRIDE);const dv=new DataView(packed.buffer,packed.byteOffset,packed.byteLength);
assert.equal(dv.getUint32(48,true),Lighting.LIGHT_TYPES.omni);assert.equal(dv.getUint32(48+Lighting.LIGHT_STRIDE,true),Lighting.LIGHT_TYPES.point);assert.equal(dv.getUint32(48+Lighting.LIGHT_STRIDE*2,true),Lighting.LIGHT_TYPES.cone);
assert(Math.abs(dv.getFloat32(12,true)-120)<1e-6);assert(Math.abs(dv.getFloat32(28+Lighting.LIGHT_STRIDE,true)-1)<1e-6);

assert.deepEqual(Lighting.DEBUG_MODES,['final','diffuse','specular','light-count']);
assert.deepEqual(Lighting.DIAGNOSTIC_PRESET,{emissive:2,lightRadius:2,playerOmniRadius:80,playerOmniIntensity:1.6,playerConeIntensity:2,playerConeInnerAngle:30,playerConeOuterAngle:60});

const material={albedo:[.45,.45,.45],normal:[0,0,1],roughness:.55,metalness:0,ao:1,emissive:0,height:.1},pixel={x:32,y:32};
const angleSamples=[];
for(let i=0;i<8;i++){
  const a=i*Math.PI/4,l=Lighting.canonicalLight({id:`a${i}`,type:'point',x:32+Math.cos(a)*30,y:32+Math.sin(a)*30,z:24,radius:90,intensity:.8,color:[1,1,1]},i,{...settings,emissive:1,lightRadius:1});
  const s=Lighting.shadeReferencePixel(material,pixel,[l],{...settings,emissive:1,lightRadius:1,ambient:0});
  assert(s.final.every(Number.isFinite));assert(s.diffuse.every(Number.isFinite));assert(s.specular.every(Number.isFinite));assert.equal(s.activeLightCount,1);angleSamples.push(s.final);
  assert(Math.max(...s.final)-Math.min(...s.final)<1e-7,'neutral material under white light must not gain yellow channel contamination');
}
const right=Lighting.shadeReferencePixel({...material,normal:[.8,0,.6]},pixel,[Lighting.canonicalLight({type:'point',x:62,y:32,z:8,radius:90,intensity:1,color:[1,1,1]},0,{lightRadius:1,emissive:1})],{...settings,ambient:0});
const left=Lighting.shadeReferencePixel({...material,normal:[.8,0,.6]},pixel,[Lighting.canonicalLight({type:'point',x:2,y:32,z:8,radius:90,intensity:1,color:[1,1,1]},0,{lightRadius:1,emissive:1})],{...settings,ambient:0});
assert(right.final[0]>left.final[0]+.02,'+X normal must respond more strongly to a +X light than a -X light');
const up=Lighting.shadeReferencePixel({...material,normal:[0,.8,.6]},pixel,[Lighting.canonicalLight({type:'point',x:32,y:2,z:8,radius:90,intensity:1,color:[1,1,1]},0,{lightRadius:1,emissive:1})],{...settings,ambient:0});
const down=Lighting.shadeReferencePixel({...material,normal:[0,.8,.6]},pixel,[Lighting.canonicalLight({type:'point',x:32,y:62,z:8,radius:90,intensity:1,color:[1,1,1]},0,{lightRadius:1,emissive:1})],{...settings,ambient:0});
assert(up.final[0]>down.final[0]+.02,'+Y pseudo-world normal must respond to a light above on screen after the canonical Y inversion');

const metal=Lighting.shadeReferencePixel({...material,metalness:1,roughness:.28},pixel,[Lighting.canonicalLight({type:'point',x:42,y:26,z:24,radius:90,intensity:1,color:[1,1,1]},0,{lightRadius:1,emissive:1})],{...settings,ambient:.05});
assert(metal.specular.some(v=>v>0));assert(metal.diffuse.reduce((a,b)=>a+b,0)<angleSamples[0].reduce((a,b)=>a+b,0),'metallic material must suppress diffuse response');

console.log(`SM-204 LIGHTING CONTRACT PASS: lights=${lights.length} angles=${angleSamples.length} stride=${Lighting.LIGHT_STRIDE} debug=${Lighting.DEBUG_MODES.join(',')}`);
