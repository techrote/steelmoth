'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const F=require('./sm600_gtao_reference_fixtures.js');
const ROOT=path.resolve(__dirname,'..');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
// Git checkouts may use CRLF on Windows. Canonicalize only those line endings
// before VM evaluation and source hashes; every other source byte remains pinned.
const canonicalSource=source=>source.replace(/\r\n/g,'\n');

// Load the exact production source in a CPU-only realm. No GPU/resource
// method is called; the browser suite separately uses the real registry.
function loadCPU(source){
  const context={SteelMothWebGPUResources:Object.freeze({}),Float32Array,Uint32Array,Uint8Array,ArrayBuffer,DataView,Math,Number};
  vm.runInNewContext(source,context,{filename:'engine/webgpu_gtao.js'});
  return context.SteelMothWebGPUGTAO;
}
function validate(source=fs.readFileSync(path.join(ROOT,'engine/webgpu_gtao.js'),'utf8')){
  source=canonicalSource(source);
  const G=loadCPU(source),gold=JSON.parse(fs.readFileSync(path.join(ROOT,'render-tests/gtao-reference-baseline.json'),'utf8'));
  assert.equal(G.UPSAMPLE_WEIGHT_EPSILON,F.f32FromBits(F.POLICY_BITS),'The cutoff is the deployed f32 literal, not a validation tolerance.');
  assert.equal(hash(G.RAW_WGSL),F.BASELINE_RAW_SHA256,'Raw WGSL must remain byte-identical in this reference-only repair.');
  assert.equal(hash(G.UPSAMPLE_WGSL),F.BASELINE_UP_SHA256,'Reconstruction WGSL must remain byte-identical.');
  for(const [key,value] of Object.entries(gold.unchanged))assert.equal(hash(G[key].toString()),value,`${key} changed outside reference-repair scope.`);
  assert.equal(hash(JSON.stringify({defaults:G.DEFAULTS,limits:G.LIMITS,debugModes:G.DEBUG_MODES,materialAO:G.MATERIAL_AO_POLICY,formats:[G.RAW_FORMAT,G.OUTPUT_FORMAT,G.DEBUG_FORMAT]})),gold.settingsSha256);
  const anchor='if(!upsampleHasSupport(ws))';
  assert.equal(source.split(anchor).length,2,'Reference must use the shared policy.');
  // This is a frozen legacy control, not the independent oracle. Its function
  // SHA proves it really reconstructs the old reference without bundling it.
  const legacy=loadCPU(source.replace(anchor,'if(ws<=1e-8)'));
  assert.equal(hash(legacy.referenceUpsample.toString()),gold.legacyReferenceSha256);
  const boundary=Array.from(F.boundaryWeights(),weight=>{
    const expected=weight>F.f32FromBits(F.POLICY_BITS);
    assert.equal(G.upsampleHasSupport(weight),expected,`Strict f32 guard at ${weight}`);
    return {weight,supported:expected};
  });
  assert.equal(G.upsampleHasSupport(F.f32FromBits(F.POLICY_BITS)),false,'Equality must fall back.');
  assert.equal(G.upsampleHasSupport(F.f32FromBits(F.POLICY_BITS+1)),true,'First greater f32 value must reconstruct.');
  const f=F.weakFixture(),r=G.referenceUpsample(f.raw,f.depth,f.normal,4,4,f.options),old=legacy.referenceUpsample(f.raw,f.depth,f.normal,4,4,f.options);
  assert.equal(r.visibility[0],.25);assert.equal(r.confidence[0],0);assert.equal(old.visibility[0],0.5591996312141418);
  const witness={weightSum:F.oracleAt(f,0,0).weightSum,legacyVisibility:old.visibility[0],repairedVisibility:r.visibility[0],repairedConfidence:r.confidence[0]};
  let testedPixels=0,changedPolicyPixels=0;
  const checkFixture=f=>{
    const r=G.referenceUpsample(f.raw,f.depth,f.normal,f.width,f.height,f.options);
    const l=legacy.referenceUpsample(f.raw,f.depth,f.normal,f.width,f.height,f.options);
    for(let i=0;i<f.width*f.height;i++){
      const expected=F.oracleAt(f,i%f.width,Math.floor(i/f.width));
      assert.equal(r.visibility[i],Math.fround(expected.visibility),`${f.name||'random'} visibility ${i}`);
      assert.equal(r.confidence[i],Math.fround(expected.confidence),`${f.name||'random'} confidence ${i}`);
      if(r.visibility[i]!==l.visibility[i]||r.confidence[i]!==l.confidence[i]){
        assert(!expected.neutral&&expected.weightSum>1e-8&&expected.weightSum<=G.UPSAMPLE_WEIGHT_EPSILON,'A change escaped the intended policy interval.');
        changedPolicyPixels++;
      }
      testedPixels++;
    }
  };
  for(const f of F.cases())for(const debugMode of G.DEBUG_MODES)checkFixture({...f,options:{...f.options,debugMode}});
  let state=0x601600;const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const normalChoices=[[.5,.5,1],[1,.5,.5126953125],[.5,.5,0],[.75,.5,1],[.5,1,.5]];
  for(let run=0;run<512;run++){
    const f=F.base(1+Math.floor(rand()*17),1+Math.floor(rand()*13));
    for(let i=0;i<f.width*f.height;i++){
      const occupied=rand()>.1,d=Math.fround(rand());f.depth.set(occupied?[d,d]:[1,0],i*2);f.normal.set([...normalChoices[Math.floor(rand()*normalChoices.length)],.75],i*4);
    }
    for(let j=0;j<f.raw.data.length;j+=4){const v=.25+Math.floor(rand()*8)/16;f.raw.data.set([v,F.fromHalf(F.halfBits(rand())),rand()>.2?1:0,1-v],j);}
    f.options.normalPower=Math.fround(1+rand()*11);f.options.depthSigma=Math.fround(16+rand()*496);checkFixture(f);
  }
  const stock=[];
  for(const f of F.stockScenes()){
    const a=G.referenceGTAO(f.depth,f.normal,f.width,f.height,f.options),b=legacy.referenceGTAO(f.depth,f.normal,f.width,f.height,f.options);
    for(const [key,av,bv] of [['raw',a.raw.data,b.raw.data],['visibility',a.visibility,b.visibility],['confidence',a.confidence,b.confidence]])assert(bytes(av).equals(bytes(bv)),`${f.name} ${key}: normal fixture changed.`);
    // Retained baseline hashes are provenance, not a claim that JS transcendental
    // arithmetic is bit-identical on every runtime. Same-runtime A/B is the gate.
    stock.push({name:f.name,allThreeFieldsByteIdentical:true,retainedBaselineHashMatch:['visibility','confidence'].every(k=>hash(bytes(a[k]))===gold.stock[f.name][k])});
  }
  assert.equal(F.fromHalf(F.halfBits(.500244140625)),.5,'binary16 even tie rounds down');
  assert.equal(F.fromHalf(F.halfBits(.500732421875)),.5009765625,'binary16 odd tie rounds up');
  assert.throws(()=>F.halfBits(NaN),RangeError);assert.throws(()=>F.base(0,1),RangeError);
  assert(changedPolicyPixels>0,'Legacy-policy mutant was not exercised.');
  return {schema:'steelmoth-gtao-reference-policy-cpu/v1',ok:true,node:process.version,sourceSha256:hash(source),rawWGSL:hash(G.RAW_WGSL),upsampleWGSL:hash(G.UPSAMPLE_WGSL),cutoff:G.UPSAMPLE_WEIGHT_EPSILON,cutoffBits:F.POLICY_BITS,boundary,witness,fixtureConfigurations:F.cases().length*G.DEBUG_MODES.length,randomCases:512,testedPixels,changedPolicyPixels,stock,cpuOnly:true};
}
if(require.main===module){
  const source=fs.readFileSync(path.join(ROOT,'engine/webgpu_gtao.js'),'utf8');
  const report=validate(source),lfSource=canonicalSource(source),crlfSource=lfSource.replace(/\n/g,'\r\n');
  assert.notEqual(lfSource,crlfSource,'Line-ending regression must exercise distinct source bytes.');
  for(const variant of [lfSource,crlfSource]){
    assert.deepEqual(validate(variant),report,'LF and CRLF checkouts must produce the same canonical hashes and oracle results.');
    assert.throws(()=>validate(variant.replace("UPSAMPLE_WEIGHT_EPSILON_WGSL='0.000001'","UPSAMPLE_WEIGHT_EPSILON_WGSL='0.00000001'")),/cutoff/);
    assert.throws(()=>validate(variant.replace('return weightSum>UPSAMPLE_WEIGHT_EPSILON','return weightSum>=UPSAMPLE_WEIGHT_EPSILON')),/Strict f32 guard/);
  }
  report.policyMutantsRejected=2;
  report.lineEndingRegression={variants:['LF','CRLF'],identicalCanonicalReport:true,policyMutantExecutions:4};
  console.log(JSON.stringify(report,null,2));
}
module.exports={validate};
