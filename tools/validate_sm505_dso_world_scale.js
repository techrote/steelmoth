'use strict';
// CPU representation regressions only; never creates a device or a GPU workload.
const assert=require('assert');
const fs=require('fs');
const Module=require('module');
const path=require('path');
const H=require('../engine/webgpu_dso.js');
const O=require('../engine/webgpu_occluders.js');
const C=require('../engine/webgpu_clusters.js');
const D=require('../engine/webgpu_dominance.js');

// Frozen pre-native-scale equations. Keep the old mixed-unit failure observable.
const oldPrimary="function throwFor(record,options={}){const d={...DEFAULTS,...options},height=Math.max(0,finite(record?.zRange?.[1])-finite(record?.zRange?.[0]));return clamp(Math.max(d.minThrow,height*d.throwPerZ),d.minThrow,d.maxThrow)}";
const oldSecondary="function secondaryThrowFor(record,ownerThrow,options={}){const d={...DEFAULTS,...options},height=Math.max(0,finite(record?.zRange?.[1])-finite(record?.zRange?.[0]));return clamp(Math.min(ownerThrow*d.secondaryThrowFraction,Math.max(4,height*d.throwPerZ*d.secondaryHeightScale)),0,ownerThrow*d.secondaryThrowFraction)}";
const filename=path.resolve(__dirname,'../engine/webgpu_dso.js');
let oldSource=fs.readFileSync(filename,'utf8');
for(const [name,frozen] of [['throwFor',oldPrimary],['secondaryThrowFor',oldSecondary]]){
  const pattern=new RegExp(`^  function ${name}\\([^\\n]+$`,'m');
  assert(pattern.test(oldSource),`frozen witness could not locate ${name}`);
  oldSource=oldSource.replace(pattern,'  '+frozen);
}
const oldModule=new Module(filename,module);oldModule.filename=filename;oldModule.paths=module.paths;oldModule._compile(oldSource,filename);
const old=oldModule.exports;
const record=(height,scale=1)=>({zRange:[2*scale,(height+2)*scale]});
const close=(actual,expected,label)=>assert(Math.abs(actual-expected)<=1e-6*Math.max(1,Math.abs(expected)),`${label}: ${actual} != ${expected}`);

let primaryCases=0,secondaryCases=0;
for(const scale of [1,2,3]){
  for(const [height,expected] of [[0,12],[1,12],[4,12],[20,60],[32,96],[100,96]]){
    close(H.throwFor(record(height,scale),{worldScale:scale}),expected*scale,`primary h${height} scale${scale}`);primaryCases++;
  }
  close(H.throwFor(record(20,scale),{worldScale:scale,throwPerZ:2}),40*scale,'dimensionless custom height factor');
  for(const [height,owner,expected] of [[0,72,4],[1,72,4],[4,72,6],[100,72,72*.38],[0,10,10*.38]]){
    close(H.secondaryThrowFor(record(height,scale),owner*scale,{worldScale:scale}),expected*scale,`secondary h${height} scale${scale}`);secondaryCases++;
  }
}
assert.strictEqual(H.throwFor(record(20),{worldScale:undefined}),H.throwFor(record(20)));
close(H.throwFor(record(0),{worldScale:1/16}),12/16,'minimum accepted scale');
close(H.throwFor(record(1000),{worldScale:16}),96*16,'maximum accepted scale');
for(const value of [0,-1,NaN,Infinity,-Infinity,1/32,17,null,'3',true]){
  assert.throws(()=>H.throwFor(record(1),{worldScale:value}),/worldScale/);
  assert.throws(()=>H.secondaryThrowFor(record(1),72,{worldScale:value}),/worldScale/);
}

function inputs(scale,ownerHeight=100,secondaryHeight=0,angle=0){
  const mul=values=>values.map(value=>value*scale),roomId='sm505-native-dso',bounds=mul([20,20,40,40]);
  const occluders={schema:O.SNAPSHOT_SCHEMA,roomId,grid:O.tileGrid(256*scale,192*scale,32),records:[
    {objectId:1,bounds,zRange:mul([0,ownerHeight]),strength:1},
    {objectId:2,bounds:mul([36,24,52,44]),zRange:mul([0,secondaryHeight]),strength:1}]};
  const clusters={schema:C.SNAPSHOT_SCHEMA,roomId,clusters:[{clusterId:7,bounds:mul([20,20,52,44]),memberIds:[1,2]}]};
  const dominance={schema:D.SNAPSHOT_SCHEMA,roomId,records:[{clusterId:7,ownerObjectId:1,lightId:'player',lightIdHash:123,ownerScore:1,toLight:[Math.cos(angle),Math.sin(angle)]}]};
  return{occluders,clusters,dominance};
}
function plan(api,input,options={}){return api.buildDSOPlan(input.clusters,input.occluders,input.dominance,{lightId:'player',...options})}
const byteKeys=['packedJobs','packedMembers','tileHeaders','tileRefs','tileOverflow'];
let defaultPlans=0;
for(const height of [0,1,4,20,32,100])for(const secondary of [0,1,4,100])for(const angle of [0,Math.PI/4,Math.PI,Math.PI*1.5]){
  const input=inputs(1,height,secondary,angle),previous=plan(old,input),implicit=plan(H,input),explicit=plan(H,input,{worldScale:1});
  for(const key of byteKeys){assert.deepStrictEqual(implicit[key],previous[key],`default1 legacy packed ${key}`);assert.deepStrictEqual(explicit[key],previous[key],`explicit1 legacy packed ${key}`)}
  assert.deepStrictEqual(implicit.jobs,previous.jobs);assert.deepStrictEqual(implicit.members,previous.members);
  assert.strictEqual(implicit.signature,previous.signature);
  assert.deepStrictEqual(H.rasterizeDSOReference(implicit),old.rasterizeDSOReference(previous),'default1 legacy hard mask');
  defaultPlans++;
}
for(const scale of [1,2,3])for(const ownerHeight of [1,20,100])for(const secondaryHeight of [0,4,100]){
  const input=inputs(scale,ownerHeight,secondaryHeight),logical=plan(H,inputs(1,ownerHeight,secondaryHeight)),native=plan(H,input,{worldScale:scale});
  close(native.jobs[0].ownerThrow,logical.jobs[0].ownerThrow*scale,'native owner plan distance');
  native.jobs[0].ownerBounds.forEach((v,i)=>close(v,logical.jobs[0].ownerBounds[i]*scale,'native owner bounds'));
  native.jobs[0].sweptBounds.forEach((v,i)=>close(v,logical.jobs[0].sweptBounds[i]*scale,'native swept bounds'));
  close(native.members[0].throwLength,logical.members[0].throwLength*scale,'native secondary plan distance');
  assert.strictEqual(native.jobs.length,1);assert.strictEqual(native.members.length,1);
  assert.strictEqual(native.diagnostics.onePrimaryWedgePerCluster,true);
  assert.strictEqual(native.diagnostics.secondaryFullStrengthWedgeCount,0);
}
const nativeInput=inputs(3,100,0),mixed=plan(old,nativeInput),correct=plan(H,nativeInput,{worldScale:3});
assert.strictEqual(mixed.jobs[0].ownerThrow,96,'old native-input/logical-cap primary failure retained');
assert.strictEqual(correct.jobs[0].ownerThrow,288,'scaled primary clamp restored');
assert.strictEqual(mixed.members[0].throwLength,4,'old logical secondary floor failure retained');
assert.strictEqual(correct.members[0].throwLength,12,'scaled secondary floor restored');
assert.notDeepStrictEqual(mixed.packedJobs,correct.packedJobs);
assert.strictEqual(H.DEFAULTS.throwPerZ,3);assert.strictEqual(H.DEFAULTS.minThrow,12);assert.strictEqual(H.DEFAULTS.maxThrow,96);
assert.strictEqual(H.DEFAULTS.secondaryThrowFraction,.38);assert.strictEqual(H.DEFAULTS.secondaryHeightScale,.5);
assert.strictEqual(H.DEFAULTS.maxJobs,512);assert.strictEqual(H.DEFAULTS.maxMembers,512);assert.strictEqual(H.DEFAULTS.maxPerTile,32);assert.strictEqual(H.DEFAULTS.maxTileRefs,8192);
console.log('SM-505 DSO world-distance CPU regression: PASS',JSON.stringify({scales:[1,2,3],primaryCases,secondaryCases,defaultByteIdenticalPlans:defaultPlans,oldMixedUnitWitness:{ownerThrow:96,secondaryThrow:4},correctNative3:{ownerThrow:288,secondaryThrow:12},gpuExecution:false}));
