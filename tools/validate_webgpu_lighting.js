'use strict';
const assert=require('assert');
const L=require('../engine/webgpu_lighting.js');

const close=(a,b,e=1e-6,msg='')=>assert.ok(Math.abs(a-b)<=e,`${msg} expected ${b}, got ${a}`);
const finiteRgb=v=>v.slice(0,3).every(Number.isFinite);

const baseScene={
  lights:[
    {id:'light:playerOmni:0',group:'playerOmni',x:100,y:120,z:22,radius:60,intensity:.16,color:[1,.9,.8],independent:true},
    {id:'light:objective:0',group:'objective',x:200,y:140,z:18,radius:72,intensity:.075,color:[.8,.9,1]},
    {id:'light:player-cone:0',type:'cone',x:100,y:106,z:null,dx:1,dy:0,range:248,intensity:2,color:[.82,.9,.96],innerCos:Math.cos(17*Math.PI/180),outerCos:Math.cos(30*Math.PI/180)}
  ],
  playerCone:{id:'light:player-cone:0',type:'cone',x:100,y:106,dx:1,dy:0,range:248,intensity:2,color:[.82,.9,.96],innerCos:Math.cos(17*Math.PI/180),outerCos:Math.cos(30*Math.PI/180)}
};
const settings={lighting:true,ambient:.3,emissive:2,lightRadius:2,normalStrength:1,heightStrength:1,roughnessScale:1,metalnessScale:1,materialAOStrength:.62,pbrSpecularStrength:.70};
const lights=L.buildCanonicalLights(baseScene,settings);
assert.strictEqual(lights.length,3,'player cone must be de-duplicated into the one canonical light buffer');
assert.strictEqual(lights.filter(q=>q.type==='cone').length,1);
assert.strictEqual(lights[0].radius,120,'independent omni radius still uses global radius scale');
close(lights[0].intensity,.16,1e-8,'independent omni intensity');
close(lights[1].intensity,.15,1e-8,'ordinary light emissive scale');
const cone=lights.find(q=>q.type==='cone');close(cone.position[2],22,1e-8,'player cone canonical pseudo-world elevation');
close(cone.intensity,2,1e-8,'cone intensity is not multiplied by emissive');
assert.ok((cone.flags&L.LIGHT_FLAGS.cone)!==0);
assert.strictEqual(L.packLights(lights).byteLength,L.MAX_LIGHTS*L.LIGHT_STRIDE);
assert.deepStrictEqual(L.buildCanonicalLights(baseScene,{...settings,lighting:false}),[],'lighting off means zero active direct lights');
assert.strictEqual(L.MAX_LIGHTS,17,'v1.2.3 compatibility needs sixteen point lights plus player cone');
assert.deepStrictEqual(L.DEBUG_MODES,['final','diffuse','specular','light-count']);
assert.strictEqual(L.DIAGNOSTIC_PRESET.playerOmniRadius,80);
assert.strictEqual(L.DIAGNOSTIC_PRESET.playerOmniIntensity,1.6);
assert.strictEqual(L.DIAGNOSTIC_PRESET.playerConeInnerAngle,30);
assert.strictEqual(L.DIAGNOSTIC_PRESET.playerConeOuterAngle,60);

const sample={albedo:[.42,.37,.31,1],normalRoughness:[.5,.5,1,.58],heightMaterial:[.28,.35,.72,.04]};
const center=[320,180],angles=[];
for(const angle of [0,45,90,135,180,225,270,315]){
  const a=angle*Math.PI/180,r=110,raw={id:'light:test:0',group:'test',x:center[0]+Math.cos(a)*r,y:center[1]+Math.sin(a)*r,z:24,radius:220,intensity:1,color:[1,1,1]};
  const one=L.buildCanonicalLights({lights:[raw]},settings);
  const final=L.shadePixelReference(sample,one,settings,center,'final'),diff=L.shadePixelReference(sample,one,settings,center,'diffuse'),spec=L.shadePixelReference(sample,one,settings,center,'specular');
  assert.ok(finiteRgb(final)&&finiteRgb(diff)&&finiteRgb(spec),`finite PBR response at ${angle}`);
  assert.ok(final.slice(0,3).every(v=>v>=0),`non-negative final at ${angle}`);
  angles.push({angle,final,diffuse:diff,specular:spec});
}
// With the compatibility view vector V=(0,-.12,1), X-opposite diffuse terms remain
// symmetric but Y-opposite terms are intentionally slightly asymmetric via Fresnel/kd.
// Pin the valid X symmetry and separately prove the +X/-screenY/+Z normal convention.
for(const [a,b] of [[0,180]]){
  const A=angles.find(q=>q.angle===a).diffuse,B=angles.find(q=>q.angle===b).diffuse;
  for(let c=0;c<3;c++)close(A[c],B[c],2e-6,`diffuse X symmetry ${a}/${b} channel ${c}`);
}
const axisSample={...sample,normalRoughness:[.5,.90,.80,.58]};
const above=L.buildCanonicalLights({lights:[{id:'light:axis:above',group:'test',x:center[0],y:center[1]-110,z:24,radius:220,intensity:1,color:[1,1,1]}]},settings);
const below=L.buildCanonicalLights({lights:[{id:'light:axis:below',group:'test',x:center[0],y:center[1]+110,z:24,radius:220,intensity:1,color:[1,1,1]}]},settings);
const aboveDiffuse=L.shadePixelReference(axisSample,above,settings,center,'diffuse'),belowDiffuse=L.shadePixelReference(axisSample,below,settings,center,'diffuse');
assert.ok(aboveDiffuse[0]>belowDiffuse[0]+1e-3,'positive pseudo-world Y normal must face a light above it on screen; screen Y is inverted exactly once');

const d=L.shadePixelReference(sample,lights,settings,center,'diffuse'),s=L.shadePixelReference(sample,lights,settings,center,'specular'),f=L.shadePixelReference(sample,lights,settings,center,'final'),lc=L.shadePixelReference(sample,lights,settings,center,'light-count');
assert.ok(d.some(v=>v>0)&&s.some(v=>v>0)&&f.some(v=>v>0),'diffuse/specular/final debug references must be populated');
close(lc[0],lights.length/L.MAX_LIGHTS,1e-8,'active light count debug value');

// Material AO is ambient-only. Disabling material AO makes different source AO values
// identical, while the direct debug terms are invariant to source AO even when AO is enabled.
const aoDisabledSettings={...settings,materialAOStrength:0};
const aoDisabledA=L.shadePixelReference(sample,[],aoDisabledSettings,center,'final');
const aoDisabledB=L.shadePixelReference({...sample,heightMaterial:[.28,.35,0,.04]},[],aoDisabledSettings,center,'final');
for(let c=0;c<3;c++)close(aoDisabledA[c],aoDisabledB[c],2e-6,`AO-disabled ambient parity channel ${c}`);
const aoDirectA=L.shadePixelReference(sample,lights,settings,center,'diffuse');
const aoDirectB=L.shadePixelReference({...sample,heightMaterial:[.28,.35,0,.04]},lights,settings,center,'diffuse');
const aoSpecA=L.shadePixelReference(sample,lights,settings,center,'specular');
const aoSpecB=L.shadePixelReference({...sample,heightMaterial:[.28,.35,0,.04]},lights,settings,center,'specular');
for(let c=0;c<3;c++){close(aoDirectA[c],aoDirectB[c],2e-6,`AO-independent diffuse channel ${c}`);close(aoSpecA[c],aoSpecB[c],2e-6,`AO-independent specular channel ${c}`);}

// The canonical light buffer is representation-only and never owns gameplay state.
const gameplay={room:3,objective:'relay',player:[12,34]},before=JSON.stringify(gameplay);L.buildCanonicalLights(baseScene,settings);assert.strictEqual(JSON.stringify(gameplay),before);

console.log(`SM-204 lighting semantics PASS: ${lights.length} canonical lights, 8-angle reference matrix, normal-axis convention, debug/PBR/material roles validated.`);
