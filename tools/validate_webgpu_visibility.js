'use strict';
const assert=require('assert');
const V=require('../engine/webgpu_visibility.js');

assert.strictEqual(V.SCHEMA,'steelmoth-webgpu-visibility/v1');
assert.strictEqual(V.SNAPSHOT_SCHEMA,'steelmoth-webgpu-visibility-snapshot/v1');
assert(V.DEBUG_MODES.includes('combined')&&V.DEBUG_MODES.includes('gtao'));
assert.strictEqual(V.GTAO_INTERFACE.ownership,'reserved input only; SM-307 does not generate GTAO');

const lit=V.composeSample({dsoOcclusion:0,selfVisibility:1,contactVisibility:1,darkBloomOcclusion:0,materialAO:1,gtaoVisibility:1});
assert(Math.abs(lit.combinedVisibility-1)<1e-9);assert.strictEqual(lit.directVisibility,1);assert.strictEqual(lit.ambientVisibility,1);

const denseInput={dsoOcclusion:0,selfVisibility:.24,contactVisibility:.42,darkBloomOcclusion:.4,materialAO:.1,gtaoVisibility:.2};
const dense=V.composeSample(denseInput,{gtao:true});
const naive=(1-denseInput.dsoOcclusion)*denseInput.selfVisibility*denseInput.contactVisibility*(1-denseInput.darkBloomOcclusion)*denseInput.materialAO*denseInput.gtaoVisibility;
assert(dense.combinedVisibility>=.18,'dense visibility floor missing');
assert(dense.combinedVisibility>naive*20,'bounded model should avoid blind multiplier collapse');
assert.strictEqual(dense.directVisibility,.24);assert.strictEqual(dense.ambientVisibility,.35);
const hard=V.composeSample({...denseInput,dsoOcclusion:1},{gtao:true});
assert.strictEqual(hard.directVisibility,0);assert(hard.combinedVisibility>=.12,'hard core must retain bounded ambient readability envelope');

const base=V.composeSample(denseInput,{gtao:true});
const toggleMatrix=[
  ['selfShadow',V.composeSample(denseInput,{gtao:true,selfShadow:false}),'directVisibility','ambientVisibility'],
  ['contactShadow',V.composeSample(denseInput,{gtao:true,contactShadow:false}),'directVisibility','ambientVisibility'],
  ['darkBloom',V.composeSample(denseInput,{gtao:true,darkBloom:false}),'directVisibility','ambientVisibility'],
  ['materialAO',V.composeSample(denseInput,{gtao:true,materialAO:false}),'ambientVisibility','directVisibility'],
  ['gtao',V.composeSample(denseInput,{gtao:false}),'ambientVisibility','directVisibility']
];
for(const [name,result,changed,stable] of toggleMatrix){assert(result[changed]>=base[changed],`${name} disable did not remove its own occlusion`);assert.strictEqual(result[stable],base[stable],`${name} disable changed unrelated ${stable}`);}
const noDSO=V.composeSample({...denseInput,dsoOcclusion:.9},{gtao:true,dso:false});assert(noDSO.directVisibility>0);assert.strictEqual(noDSO.ambientVisibility,base.ambientVisibility);

for(const mode of V.DEBUG_MODES){const x=V.debugValue(base,mode);assert(Number.isFinite(x)&&x>=0&&x<=1,`bad debug ${mode}`);}
const n=64,dso=new Float32Array(n),self=new Float32Array(n).fill(.24),contact=new Float32Array(n).fill(.42),bloom=new Float32Array(n).fill(.4),mao=new Float32Array(n).fill(.1);for(let i=0;i<8;i++)dso[i]=1;
const fields=V.composeFields({dsoOcclusion:dso,selfVisibility:self,contactVisibility:contact,darkBloomOcclusion:bloom,materialAO:mao});
const metrics=V.visibilityMetrics(fields.combined);assert(metrics.min>=.119&&metrics.mean>.18);assert.strictEqual(metrics.belowTenPercent,0);
const p=V.parameterBytes(64,32,{gtao:true,debugMode:'material-ao'});assert.strictEqual(p.byteLength,64);const u=new Uint32Array(p.buffer,p.byteOffset,4);assert.strictEqual(u[0],64);assert.strictEqual(u[1],32);assert.strictEqual(u[2],7);assert(u[3]&V.FLAGS.gtao);

console.log('SM-307 visibility deterministic tests: PASS',JSON.stringify({dense,naive,hardCombined:hard.combinedVisibility,metrics,toggleCount:toggleMatrix.length,debugModes:V.DEBUG_MODES.length,gtaoReserved:V.GTAO_INTERFACE}));
