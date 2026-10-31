'use strict';
const assert=require('assert');
const Ownership=require('../engine/webgpu_ownership.js');
const Transparent=require('../engine/webgpu_transparent_fx.js');
const Presenter=require('../engine/webgpu_scene_presenter.js');

const atlas={source_size:[16,16],world_scale:1,region_meta:{face:{world_scale:1}},regions:{face:[0,0,8,8]}};
const sprite=(id,alpha=.92,overrides={})=>({id,category:'static',atlas:'hd',spriteId:'face',materialId:'material:face',root:{x:20,y:30},transform:{x:20,y:22,w:16,h:16,rotation:0,flip:false},style:{alpha,color:[1,1,1],tint:[1,1,1],glow:false},...overrides});
const scene={frame:{logicalSize:[640,360],roomId:'exclusive-ownership'},materials:[{id:'material:face',overrides:{mode:'normal'}}],sprites:[
  sprite('static-.92'),sprite('static-.94',.94),sprite('player-.995',.995,{category:'dynamic'}),sprite('foreground-.92',.92,{category:'foreground'}),sprite('cutoff-.5',.5),sprite('full-opaque',1),
  sprite('low-alpha',.49),sprite('low-alpha-second',.25),sprite('glow',.92,{style:{alpha:.92,glow:true}}),sprite('top-alpha',.995,{category:'top'}),sprite('top-glow',1,{category:'top',style:{alpha:1,glow:true}}),sprite('legacy',1,{atlas:'legacy'})
],proceduralLayers:[{kind:'effects',descriptor:[{x:10,y:20,color:[1,0,0],age:0,life:1}]}],overlays:{guide:{x:40,y:50,color:[1,1,1]},objectiveMarker:{x:60,y:70,color:[1,1,1]}},settings:{}};
const consumer={api:{Transparent},legacyMeta:atlas,game:{art:{manifest:atlas}}};
const extract=(source,ids)=>Presenter.WebGPUScenePresenter.prototype._sourceFrames.call(consumer,source,ids);
const allSprites=frames=>Object.values(frames).flatMap(frame=>Object.values(frame.stages).flat());

function testExclusiveCanonicalParticipation(){
  const before=JSON.stringify(scene),instances=Ownership.buildOwnershipSceneInstances(scene,atlas),ids=new Set(instances.map(s=>s.id));
  assert.deepEqual([...ids],['static-.92','static-.94','cutoff-.5','full-opaque','player-.995','foreground-.92']);
  const frames=extract(scene,ids),records=allSprites(frames),forwardIds=records.map(r=>r.id);
  for(const id of ids)assert(!forwardIds.includes(id),'canonical G-buffer participant must not be replayed as unlit forward alpha: '+id);
  assert.deepEqual(frames.hd.stages['world-alpha'].map(r=>r.id),['low-alpha','low-alpha-second'],'surviving alpha sprites retain source order');
  assert.deepEqual(frames.hd.stages['world-additive'].map(r=>r.id),['glow']);
  assert.deepEqual(frames.hd.stages['top-alpha'].map(r=>r.id),['top-alpha']);
  assert.deepEqual(frames.hd.stages['top-additive'].map(r=>r.id),['top-glow']);
  assert.deepEqual(frames.legacy.stages['world-alpha'].map(r=>r.id),['legacy']);
  assert.equal(frames.overlay.effects.length,1);assert(frames.overlay.objective);assert(frames.overlay.guide);
  assert.equal(frames.hd.effects.length,0);assert.equal(frames.hd.objective,null);assert.equal(frames.hd.guide,null);
  assert.equal(frames.legacy.effects.length,0);assert.equal(frames.legacy.objective,null);assert.equal(frames.legacy.guide,null);
  assert.equal(JSON.stringify(scene),before,'partitioning cannot change authoritative RenderScene or artist settings');
  // Retain the pre-fix witness: the same real SM-206 extraction without the
  // actual-ownership exclusion replays nearly opaque static/player sprites.
  const oldFrames=extract(scene,new Set()),oldIds=allSprites(oldFrames).map(r=>r.id);
  for(const id of ['static-.92','static-.94','player-.995','foreground-.92','cutoff-.5'])assert(oldIds.includes(id)&&ids.has(id),'pre-fix duplicate witness disappeared: '+id);
}

async function testOneCanonicalArrayFeedsRenderAndPartition(){
  const stop=new Error('test stops before GPU encoding'),p=Object.create(Presenter.WebGPUScenePresenter.prototype);
  let builds=0,built=null,submitted=null,partitionIds=null;
  p.closed=false;p.width=640;p.height=360;p.root={};p.game={renderer:{},art:{manifest:atlas}};
  p.api={Scene:{validateRenderScene(){}},Ownership:{buildOwnershipSceneInstances(s,a){builds++;built=Ownership.buildOwnershipSceneInstances(s,a);return built}},Quality:{localShadowSettings:()=>({})},Pseudo:{},Lighting:{}};
  p._extent=()=>({width:640,height:360});p._uploadBackdrop=()=>{};p._invalidateForRoom=()=>{};p._opaqueComposite=()=>{};p._updateWaterField=()=>{};
  p.gb={async renderInstances(instances){submitted=instances},async renderScene(){throw new Error('scene must not be scanned a second time')}};
  p.depth={async buildFromOwnership(){}};p.shadows={async render(){}};
  for(const name of ['occ','clusters','dominance','dso','dsoHierarchy','bloom','bloomTemporal','visibility'])p[name]={async update(){},sourceFromPaths:()=>({})};
  p.lighting={async render(){}};
  p._sourceFrames=(s,ids)=>{partitionIds=ids;const frames=extract(s,ids);assert(!allSprites(frames).some(r=>ids.has(r.id)));throw stop};
  await assert.rejects(p._render(scene),error=>error===stop);
  assert.equal(builds,1,'one canonical instance build per captured scene');assert.strictEqual(submitted,built,'submit the exact canonical array used to classify ownership');
  assert.deepEqual([...partitionIds],built.map(s=>s.id),'forward exclusion must use actual instance IDs without copying eligibility thresholds');
}

async function testExistingBoundsRemainEnforced(){
  const many={...scene,sprites:[...Array.from({length:4096},(_,i)=>sprite('opaque:'+i)),...Array.from({length:641},(_,i)=>sprite('alpha:'+i,.25))]},before=JSON.stringify(many);
  const instances=Ownership.buildOwnershipSceneInstances(many,atlas),ids=new Set(instances.map(s=>s.id)),frames=extract(many,ids);
  assert.equal(ids.size,4096);assert.equal(frames.hd.stats.maxSprites,Transparent.MAX_TRANSPARENT_SPRITES);
  assert.equal(frames.hd.stats.acceptedSprites,640);assert.equal(frames.hd.stats.dropped,1);assert(frames.hd.stages['world-alpha'].every(r=>r.id.startsWith('alpha:')),'opaque classification must not consume bounded forward capacity');
  assert.equal(JSON.stringify(many),before);
  const noGPU={async initialize(){},atlas:{},maxInstances:4096};
  await assert.rejects(Ownership.WebGPUOwnershipGBuffer.prototype.renderInstances.call(noGPU,[...instances,instances[0]],{wait:false}),/instance count 4097 exceeds 4096/,'canonical instance submission retains its hard capacity rather than truncating ownership IDs');
}

(async()=>{
  testExclusiveCanonicalParticipation();await testOneCanonicalArrayFeedsRenderAndPartition();await testExistingBoundsRemainEnforced();
  console.log('SM-505 EXCLUSIVE OWNERSHIP PASS: canonical .5/.92/.94/.995 ownership, pre-fix duplicates, low-alpha/glow/top/legacy/overlay controls, order/non-mutation, one canonical array and unchanged 4096/640 bounds');
})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
