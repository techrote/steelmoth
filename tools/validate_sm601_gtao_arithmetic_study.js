'use strict';
// GPU-free tests. A VM supplies only a non-null Resources namespace to load the
// exact production module's pure functions; no GPU/API execution is claimed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const S=require('./sm601_gtao_arithmetic_study.js');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'engine/webgpu_gtao.js'),'utf8');
const context={SteelMothWebGPUResources:{},module:{exports:{}}};vm.runInNewContext(source,context);
const G=context.module.exports;
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const same=(a,b)=>assert.deepEqual(Buffer.from(a.buffer,a.byteOffset,a.byteLength),Buffer.from(b.buffer,b.byteOffset,b.byteLength));
const f=Math.fround;
function nextFloat(x,delta){const a=new Float32Array([x]),u=new Uint32Array(a.buffer);u[0]+=delta;return a[0];}
function lutWitness(){
  let attempts=0;
  for(let dirs=4;dirs<=8;dirs++)for(let d=0;d<dirs;d++)for(let steps=2;steps<=6;steps++)for(let s=0;s<steps;s++)for(const axis of ['cos','sin']){
    const jsdir=f(Math[axis](2*Math.PI*(d+.5)/dirs)),angle=f(f(f(6.28318530718)*f(f(d)+.5))/f(dirs)),modelDir=f(Math[axis](angle));
    if(Math.abs(jsdir)<1e-5)continue;
    for(let k=0;k<24;k++){
      const target=(k+.4999)/Math.abs(jsdir)*steps/(s+1);
      for(let ulp=-4;ulp<=4;ulp++){
        const radius=nextFloat(target,ulp);if(radius<4||radius>24)continue;attempts++;
        const dist=f(f(f(radius)*f(f(s)+1))/f(steps));
        const rounded=dir=>Math.sign(f(dir*dist))*Math.floor(f(Math.abs(f(dir*dist))+f(.5001)));
        if(rounded(jsdir)!==rounded(modelDir))return {attempts,dirs,d,steps,s,axis,radius,jsdir,modelDir,jsOffset:rounded(jsdir),f32EvaluationOffset:rounded(modelDir),
          boundary:'CPU f32-evaluation witness, not a prediction of one GPU intrinsic; WGSL allows implementation-dependent intrinsic accuracy.'};
      }
    }
  }
  throw new Error('Expected one direction-LUT rounding-boundary witness.');
}
(async()=>{
  const report={schema:S.SCHEMA+'/cpu-report',ok:false,gpuExecuted:false,sourceSha256:digest(source),cases:0,randomCases:0,coordinateChecks:0,checks:[]};
  function checked(name,callback){callback();report.checks.push(name);}
  checked('exact production source Git blob',()=>{const b=Buffer.from(source);assert.equal(crypto.createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex'),'7960a3e12e8ffaa9922f81899e42d326b9a43606');});
  report.shaderHashes={raw:digest(G.RAW_WGSL),upsample:digest(G.UPSAMPLE_WGSL)};
  for(const variant of S.VARIANTS){const c=await S.createShaders(G.RAW_WGSL,G.UPSAMPLE_WGSL,variant);assert.equal(c.raw.includes('texture_storage_2d<rgba16float,write>'),true);assert.equal(c.up.includes('if(ws>0.000001)'),true);assert.equal(c.up.includes('let normalWeight=pow(nd,params.s1.y)'),true);
    if(variant==='baseline'){assert.equal(c.raw,G.RAW_WGSL);assert.equal(c.up,G.UPSAMPLE_WGSL);}
    if(c.rawWorkgroupBytes)assert(c.raw.indexOf('workgroupBarrier();')<c.raw.indexOf('if(gid.x>='));
    if(c.upWorkgroupBytes)assert(c.up.indexOf('workgroupBarrier();')<c.up.indexOf('if(gid.x>='));
  }
  await assert.rejects(S.createShaders(G.RAW_WGSL+' ',G.UPSAMPLE_WGSL,'raw-shared'),/drift/);
  await assert.rejects(S.createShaders(G.RAW_WGSL,G.UPSAMPLE_WGSL+' ','combined'),/drift/);
  await assert.rejects(S.createShaders(G.RAW_WGSL,G.UPSAMPLE_WGSL,'unknown'),/Unknown/);
  checked('source/variant drift refused; bindings, formats, fallback and pow preserved',()=>{});
  checked('finite binary16 roundtrip and ties-to-even',()=>{
    for(let bits=0;bits<65536;bits++){if((bits&0x7c00)===0x7c00)continue;assert.equal(S.halfBits(S.fromHalf(bits)),bits);}
    assert.equal(S.halfBits(1+2**-11),0x3c00);assert.equal(S.halfBits(1+3*2**-11),0x3c02);
    assert.throws(()=>S.halfBits(NaN));assert.throws(()=>S.halfBits(Infinity));assert.throws(()=>S.halfBits(65505));
  });
  checked('extents, coordinates, pattern, quality and zero-normal guards',()=>{
    for(const [w,h] of [[0,1],[1,-1],[1.5,2],[NaN,1],[Infinity,1],[8193,1],[8192,8192]])assert.throws(()=>S.extent(w,h));
    assert.throws(()=>S.tileMapping(3,3,3,0,0,0));assert.throws(()=>S.makeFixture(1,1,'bad'));assert.throws(()=>S.workModel(2,2,3,4));assert.throws(()=>S.workModel(2,2,6,6.1));
    assert.throws(()=>S.normalAt(new Float32Array([.5,.5,.5,1]),0),/Zero/);
  });
  for(const c of S.cases()){
    const a=c.pattern==='weak-weight'?S.weakWeightFixture():S.makeFixture(c.w,c.h,c.pattern,report.cases+1),o=G.normalizeOptions(c.options);
    const raw=a.raw||G.referenceHalf(a.depth,a.normal,c.w,c.h,o);raw.data=S.quantizeHalf(raw.data);
    const direct=S.upsampleReference(raw,a.depth,a.normal,c.w,c.h,o,1e-6,false),cached=S.upsampleReference(raw,a.depth,a.normal,c.w,c.h,o,1e-6,true);
    for(const key of ['visibility','confidence','debug'])same(direct[key],cached[key]);
    for(let y=0;y<c.h;y++)for(let x=0;x<c.w;x++)for(let oy=0;oy<=1;oy++)for(let ox=0;ox<=1;ox++){
      const m=S.tileMapping(c.w,c.h,x,y,ox,oy);assert(m.ci>=0&&m.ci<25);assert.deepEqual(m.direct,m.viaCache);report.coordinateChecks++;
    }
    if(!o.enabled||c.pattern==='plane'||c.pattern==='empty')assert(cached.visibility.every(x=>x===1));
    assert(cached.visibility.every(x=>Number.isFinite(x)&&x>=.149&&x<=1));
    report.cases++;
  }
  let seed=0xc0ffee;const rand=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  for(let k=0;k<512;k++){
    const w=1+Math.floor(rand()*25),h=1+Math.floor(rand()*23),a=S.makeFixture(w,h,k%2?'dense':'sparse',k),o=G.normalizeOptions({directions:4+Math.floor(rand()*5),steps:2+Math.floor(rand()*5),radius:4+rand()*20,normalPower:1+rand()*11,depthSigma:16+rand()*496});
    const raw=G.referenceHalf(a.depth,a.normal,w,h,o);raw.data=S.quantizeHalf(raw.data);
    const d=S.upsampleReference(raw,a.depth,a.normal,w,h,o,1e-6,false),c=S.upsampleReference(raw,a.depth,a.normal,w,h,o,1e-6,true);
    same(d.visibility,c.visibility);same(d.confidence,c.confidence);report.randomCases++;
  }
  checked('512 deterministic randomized cached/direct reference comparisons',()=>{});
  const weak=S.weakWeightFixture(),o=G.normalizeOptions({debugMode:'upsample-confidence'}),legacy=G.referenceUpsample(weak.raw,weak.depth,weak.normal,4,4,o),gpuEquation=S.upsampleReference(weak.raw,weak.depth,weak.normal,4,4,o);
  report.weakWeightWitness={pixel:[0,0],legacyJSVisibility:legacy.visibility[0],gpuEquationVisibility:gpuEquation.visibility[0],weightSum:legacy.confidence[0]*2,legacyGuard:1e-8,gpuGuard:1e-6};
  checked('existing CPU/GPU fallback threshold mismatch reproduced, not masked',()=>{assert(report.weakWeightWitness.weightSum>1e-8&&report.weakWeightWitness.weightSum<1e-6);assert(Math.abs(legacy.visibility[0]-gpuEquation.visibility[0])>.1);assert.equal(gpuEquation.visibility[0],.25);});
  report.lutWitness=lutWitness();
  checked('CPU precomputed directions are not assumed coordinate-equivalent',()=>assert.notEqual(report.lutWitness.jsOffset,report.lutWitness.f32EvaluationOffset));
  report.hierarchyWitness={centre:.7,pointSample:.8,adjacentMin:.2,bias:.0015,pointNear:0,coarseNear:.49849999999999994};
  checked('coarse minimum is not a point-sample substitute',()=>{const a=report.hierarchyWitness;assert.equal(Math.max(0,a.centre-a.pointSample-a.bias),0);assert(Math.max(0,a.centre-a.adjacentMin-a.bias)>.49);});
  report.fullHD=S.workModel(1920,1080);
  checked('1920x1080 source-work accounting',()=>{const m=report.fullHD;assert.equal(m.raw.depthLoads,12960000);assert.equal(m.upsample.rawLoads,8294400);assert.equal(m.upsampleShared.rawLoads,810000);assert.equal(m.upsampleShared.readBytes,46137600);assert.equal(m.ownPersistentBytes.total,120268960);});
  report.ok=true;const i=process.argv.indexOf('--report');if(i>=0){if(!process.argv[i+1])throw new Error('--report requires a path');const p=path.resolve(process.argv[i+1]);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
