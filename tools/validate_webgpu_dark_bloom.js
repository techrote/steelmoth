'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const H=require('../engine/webgpu_dso.js');
const S=require('../engine/webgpu_dso_hierarchy.js');
const B=require('../engine/webgpu_dark_bloom.js');

function syntheticHardPlan(){
  const width=128,height=96,tileSize=32,columns=Math.ceil(width/tileSize),rows=Math.ceil(height/tileSize),count=columns*rows;
  const ownerBounds=[16,36,40,60],shadowDir=[1,0],ownerThrow=70;
  const members=[
    {objectId:2,flags:0,throwLength:18,strength:1,bounds:[16,8,22,14]},
    {objectId:3,flags:0,throwLength:22,strength:1,bounds:[16,18,22,24]},
    {objectId:4,flags:0,throwLength:44,strength:1,bounds:[16,68,26,78]}
  ];
  const tileHeaders=new Uint32Array(count*2);for(let i=0;i<count;i++){tileHeaders[i*2]=0;tileHeaders[i*2+1]=1;}
  return{schema:H.SNAPSHOT_SCHEMA,roomId:'sm305-controlled',lightId:'player-light',grid:{width,height,tileSize,columns,rows,count},jobs:[{clusterId:1,ownerObjectId:1,lightId:'player-light',lightIdHash:123,memberOffset:0,memberCount:members.length,flags:1,ownerBounds,shadowDir,ownerThrow,ownerScore:1,sweptBounds:[16,8,110,78],clusterBounds:[16,8,40,78]}],members,tileHeaders,tileRefs:Uint32Array.of(0),diagnostics:{distanceSimplification:false,darkBloom:false,temporalAccumulation:false}};
}

function maxOf(values){let m=0;for(const v of values)m=Math.max(m,Number(v)||0);return m;}
function nonzero(values,eps=1e-8){let n=0;for(const v of values)if(Math.abs(Number(v)||0)>eps)n++;return n;}
function assertCoreUntouched(hard,residual){for(let i=0;i<hard.length;i++)if(hard[i]>.5)assert.strictEqual(residual[i],0,`residual must be zero on hard-core pixel ${i}`);}


function legacyTierMap(plan){
  const low=B.lowDimensions(plan.grid.width,plan.grid.height),map=new Uint32Array(low.width*low.height),counts=[0,0,0,0];let candidateVisits=0;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  for(const job of plan.jobs||[]){
    const bounds=job.sweptBounds||H.sweptBounds(job.farBounds,job.shadowDir,job.ownerThrow);
    if(bounds[2]<=0||bounds[3]<=0||bounds[0]>=plan.grid.width||bounds[1]>=plan.grid.height)continue;
    const x0=clamp(Math.floor(bounds[0]/B.SCALE),0,low.width-1),y0=clamp(Math.floor(bounds[1]/B.SCALE),0,low.height-1);
    const x1=clamp(Math.floor((bounds[2]-1e-6)/B.SCALE),0,low.width-1),y1=clamp(Math.floor((bounds[3]-1e-6)/B.SCALE),0,low.height-1);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const p=[Math.min(plan.grid.width-.5,x*B.SCALE+B.SCALE*.5),Math.min(plan.grid.height-.5,y*B.SCALE+B.SCALE*.5)];
      const index=y*low.width+x,tier=B.tierAtPoint(plan,p);candidateVisits++;
      if(tier>map[index])map[index]=tier;
    }
  }
  for(const value of map)counts[value]++;
  return{width:low.width,height:low.height,data:map,counts,candidateVisits};
}

const hardPlan=syntheticHardPlan();
const plan=S.buildHierarchyPlan(hardPlan,{quality:'Medium'});
const hard=S.rasterizeHierarchyReference(plan);
const depth=new Float32Array(plan.grid.width*plan.grid.height).fill(.8);
const tier=B.buildTierMap(plan);
assert.strictEqual(tier.width,64);assert.strictEqual(tier.height,48);
assert(tier.counts[1]>0&&tier.counts[2]>0&&tier.counts[3]>0,'SM-304 distance semantics must expose near/mid/far bloom source tiers');
assert.strictEqual(tier.diagnostics.spatialIndex,'sm304-active-tiles','production tier raster must reuse SM-304 active-tile bins');
assert.strictEqual(tier.diagnostics.jobTests,tier.diagnostics.candidatePixels,'single-job fixture should perform one binned job test per active low-resolution pixel');
assert.strictEqual(tier.diagnostics.eliminatedAllJobsRescan,true,'tier raster must never re-enter the all-jobs search');
const reusedBacking=new Uint32Array(tier.data.length).fill(99);
const rebuilt=B.buildTierMap(plan,reusedBacking);
assert.strictEqual(rebuilt.data,reusedBacking,'tier raster may reuse its backing store to avoid frame-by-frame allocation');
assert.deepStrictEqual(Array.from(rebuilt.data),Array.from(tier.data),'backing-store reuse must preserve tier-map semantics');

// Regression for the SM-501 target-hardware pathology: the former raster rescanned every
// job inside every job-bounds candidate pixel. A dense overlapping plan must remain
// bit-identical to that legacy algorithm while doing one owning-job test per visit.
{
  const jobs=[],members=[],copies=16,baseJob=plan.jobs[0];
  for(let i=0;i<copies;i++){
    const memberOffset=members.length;
    for(let m=0;m<baseJob.memberCount;m++){
      const src=plan.members[baseJob.memberOffset+m];
      members.push({...src,nearBounds:[...src.nearBounds],midBounds:[...src.midBounds],farBounds:[...src.farBounds]});
    }
    jobs.push({...baseJob,clusterId:i+1,ownerObjectId:100+i,memberOffset,nearBounds:[...baseJob.nearBounds],midBounds:[...baseJob.midBounds],farBounds:[...baseJob.farBounds],shadowDir:[...baseJob.shadowDir],sweptBounds:[...baseJob.sweptBounds]});
  }
  const tileRefs=[],activeTiles=plan.activeTiles.map(tile=>{const offset=tileRefs.length;for(let i=0;i<copies;i++)tileRefs.push(i);return{...tile,offset,count:copies};});
  const densePlan={...plan,jobs,members,activeTiles,tileRefs:Uint32Array.from(tileRefs),signature:'sm501-dense-overlap-regression'};
  const legacy=legacyTierMap(densePlan),optimized=B.buildTierMap(densePlan);
  assert.deepStrictEqual(Array.from(optimized.data),Array.from(legacy.data),'optimized dense tier raster must be bit-identical to the pre-SM-501 algorithm');
  assert.deepStrictEqual(optimized.counts,legacy.counts,'optimized dense tier counts must match the pre-SM-501 algorithm');
  assert.strictEqual(optimized.diagnostics.spatialIndex,'sm304-active-tiles','dense raster must stay on the SM-304 spatial index');
  assert(optimized.diagnostics.jobTests<legacy.candidateVisits*copies,'binned dense raster must perform fewer job tests than the legacy nested all-jobs traversal');
  assert.strictEqual(optimized.diagnostics.eliminatedAllJobsRescan,true,'dense raster must not re-enter tierAtPoint for every candidate pixel');
}

const medium=B.buildReference(hard,depth,plan,{quality:'Medium'});
const medium2=B.buildReference(hard,depth,plan,{quality:'Medium'});
assert.strictEqual(medium.schema,B.SNAPSHOT_SCHEMA);assert.strictEqual(medium.quality,'Medium');
assert.deepStrictEqual(Array.from(medium.full),Array.from(medium2.full),'Dark Bloom CPU reference must be deterministic');
assert(medium.diagnostics.bloomPixels>0,'DSO core must generate a feathered residual');
assert(medium.diagnostics.peakContribution>0&&medium.diagnostics.peakContribution<1,'residual must be visible but weaker than unit hard-core occlusion');
assert(medium.diagnostics.peakContribution<=medium.settings.farStrength+1e-7,'peak contribution must stay beneath the configured residual strength bound');
assert.strictEqual(medium.diagnostics.maxRadiusPixels,medium.settings.farRadius*B.SCALE,'reported radius must be bounded by reduced radius and scale');
assert.strictEqual(medium.diagnostics.noTemporal,true,'SM-305 baseline must remain non-temporal');
assertCoreUntouched(hard,medium.full);

const empty=B.buildReference(new Float32Array(hard.length),depth,plan,{quality:'Ultra'});
assert.strictEqual(nonzero(empty.full),0,'Dark Bloom must be exactly zero when the DSO hard core is absent');

const qualities=['Low','Medium','High','Ultra'].map(q=>B.buildReference(hard,depth,plan,{quality:q}));
for(let i=1;i<qualities.length;i++){
  assert(qualities[i-1].settings.farRadius<=qualities[i].settings.farRadius,'quality must not shrink the allowed far radius');
  assert(qualities[i-1].settings.farStrength<=qualities[i].settings.farStrength,'quality must not reduce the far residual strength');
  assert(qualities[i].diagnostics.peakContribution<1,'all quality tiers remain weaker than the hard core');
}
const clamped=B.qualitySettings('Ultra',{farRadius:99,farStrength:99,nearRadius:-9});
assert.strictEqual(clamped.farRadius,8,'shader loop bound is the hard radius cap');assert.strictEqual(clamped.farStrength,.95);assert.strictEqual(clamped.nearRadius,0);

// Isolated near/mid/far sources prove distance bias rather than a generic scene blur.
{
  const width=56,height=20,low=B.lowDimensions(width,height),hardMask=new Float32Array(width*height),depthMap=new Float32Array(width*height).fill(.7),tiers=new Uint32Array(low.width*low.height);
  const sources=[{lx:2,tier:1},{lx:13,tier:2},{lx:25,tier:3}],ly=5;
  for(const s of sources){for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++)hardMask[(ly*2+oy)*width+s.lx*2+ox]=1;tiers[ly*low.width+s.lx]=s.tier;}
  const result=B.referenceFromTierMap(hardMask,depthMap,width,height,tiers,'Medium');
  const peaks=sources.map(s=>{let peak=0,maxDistance=0;for(let y=0;y<low.height;y++)for(let x=0;x<low.width;x++){const v=result.lowBloom[y*low.width+x];if(v>0&&Math.abs(x-s.lx)<=5){peak=Math.max(peak,v);maxDistance=Math.max(maxDistance,Math.hypot(x-s.lx,y-ly));}}return{peak,maxDistance};});
  assert(peaks[0].peak>0&&peaks[0].peak<peaks[1].peak&&peaks[1].peak<peaks[2].peak,'near contribution must be smaller than mid, and far larger than mid');
  assert(peaks[0].maxDistance<=result.settings.nearRadius+1e-6);assert(peaks[1].maxDistance<=result.settings.midRadius+1e-6);assert(peaks[2].maxDistance<=result.settings.farRadius+1e-6);
}

// A pseudo-depth discontinuity immediately next to a far-tier source must block the residual.
{
  const width=32,height=20,low=B.lowDimensions(width,height),hardMask=new Float32Array(width*height),depthMap=new Float32Array(width*height),tiers=new Uint32Array(low.width*low.height),lx=7,ly=5;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)depthMap[y*width+x]=x<16?.8:.3;
  for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++)hardMask[(ly*2+oy)*width+lx*2+ox]=1;
  tiers[ly*low.width+lx]=3;
  const result=B.referenceFromTierMap(hardMask,depthMap,width,height,tiers,'Ultra');
  let leaked=0,leftResidual=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const v=result.full[y*width+x];if(x>=16)leaked=Math.max(leaked,v);else if(!hardMask[y*width+x])leftResidual=Math.max(leftResidual,v);}
  assert(leftResidual>0,'depth-barrier fixture must contain a valid residual on the source side');
  assert.strictEqual(leaked,0,'depth-aware reconstruction must reject residual across unrelated foreground depth');
}

// Keep the named binsup visual contract in the automated evidence chain.
const binsup=JSON.parse(fs.readFileSync(path.join(__dirname,'..','render-tests','fixtures','binsup.json'),'utf8'));
assert.strictEqual(binsup.name,'binsup');
assert(binsup.expected_observations.some(s=>/soft feathered residual occlusion/i.test(s)),'binsup fixture must retain the Dark Bloom target observation');
const combinedPeak=1+medium.diagnostics.peakContribution;
assert(combinedPeak>1&&medium.diagnostics.peakContribution<1,'binsup-style composition adds a subordinate feather without replacing hard ownership');

console.log('SM-305 Dark Bloom deterministic + bounded tests: PASS',JSON.stringify({tierCounts:tier.counts,medium:B.bloomMetrics(medium),quality:qualities.map(q=>({quality:q.quality,radius:q.settings.farRadius,strength:q.settings.farStrength,peak:q.diagnostics.peakContribution,bloomPixels:q.diagnostics.bloomPixels})),binsupContract:true,combinedPeak}));
