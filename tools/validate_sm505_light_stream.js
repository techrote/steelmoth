'use strict';
const assert=require('assert');
const P=require('../engine/webgpu_scene_presenter.js');
const L=require('../engine/webgpu_lighting.js');
const S=require('../engine/webgpu_local_shadows.js');
const source={frame:{logicalSize:[640,360]},lights:[
  {id:'macro',type:'point',x:10,y:20,z:22,radius:100,intensity:1,color:[.4,.6,.8]},
  {id:'lamp',type:'point',x:200,y:90,z:30,radius:50,intensity:.5,color:[.8,.5,.3]},
  {id:'cone',type:'cone',x:10,y:20,z:22,range:900,intensity:6,color:[.82,.9,.96],dx:1,dy:0}
],playerCone:null};
source.playerCone=source.lights[2];
const settings={selfShadowing:true,selfShadowLightCount:1,contactShadows:true,shadows:true,materialAOStrength:.4};

function testPlan(){
  const before=JSON.stringify(source),plan=P.visibilityLightPlan(source,settings,L,S,'macro');
  assert.deepEqual(plan.canonicalIds,['macro','lamp','cone']);
  assert.deepEqual(plan.selfLightIds,['cone']);assert.equal(plan.contactLightId,'cone');
  assert.deepEqual(plan.batches,[{ids:['macro'],selfShadow:false,contactShadow:false,macro:true},{ids:['cone'],selfShadow:true,contactShadow:true,macro:false},{ids:['lamp'],selfShadow:false,contactShadow:false,macro:false}]);
  for(const b of plan.batches)assert.deepEqual(L.buildCanonicalLights(P.lightSubset(source,b.ids),settings).map(l=>l.id),b.ids,'no unrelated cone is silently reappended');
  assert.equal(JSON.stringify(source),before,'no mutation of renderer/game light authority');
  assert.strictEqual(P.macroLightDriver(source,settings,L,S),source.playerCone,'one macro driver follows existing canonical cone/contact priority');
  assert.strictEqual(P.macroLightDriver(source,settings,L,S,{records:[{lightId:'lamp'}]}),source.lights[1],'relevance-filtered dominance selects only an available canonical light');
  assert.equal(P.macroLightDriver(source,settings,L,S,{records:[]}),null);
  assert.equal(P.macroLightDriver(source,{...settings,lighting:false},L,S),null);
  const disabled=P.visibilityLightPlan(source,{...settings,selfShadowing:false,contactShadows:false,shadows:false},L,S,'macro');
  assert.deepEqual(disabled.batches,[{ids:['macro','lamp','cone'],selfShadow:false,contactShadow:false,macro:false}]);
  const off=P.visibilityLightPlan(source,{...settings,lighting:false},L,S,'macro');
  assert.deepEqual(off.canonicalIds,[]);assert.deepEqual(off.batches,[{ids:[],selfShadow:false,contactShadow:false,macro:false}]);
  assert.equal(P.visibilityLightPlan(source,settings,L,S,'absent').macroLightId,null);
  const many={...source,lights:Array.from({length:40},(_,i)=>({id:'light:'+i,type:'point',radius:100,intensity:1,color:[1,1,1]})),playerCone:null};
  const bounded=P.visibilityLightPlan(many,{...settings,selfShadowLightCount:8},L,S,'light:0');
  assert.equal(bounded.canonicalIds.length,17);assert(bounded.batches.length<=10);
  assert.equal(new Set(bounded.batches.flatMap(b=>b.ids)).size,17);
}

function environment(failPhase=null){
  const events=[],p=Object.create(P.WebGPUScenePresenter.prototype);let revision=0;
  p.closed=false;p.api={Lighting:L,Shadows:S};p.gb={};p.dsoHierarchy={};p.bloomTemporal={};
  p.shadows={async render(g,s,cfg){events.push({phase:'shadows',ids:L.buildCanonicalLights(s,cfg).map(l=>l.id),settings:cfg});if(failPhase==='shadows')p.closed=true}};
  p.visibility={sourceFromPaths(){return{}},async update(s,cfg){events.push({phase:'visibility',settings:cfg});revision++;if(failPhase==='visibility')p.closed=true},bindings(){return{visibility:{revision}}}};
  p.lighting={async accumulateDirect(g,s,cfg,o){events.push({phase:'direct',ids:L.buildCanonicalLights(s,cfg).map(l=>l.id),options:o});if(failPhase==='direct')p.closed=true},async resolveDirect(g,s,cfg,o){events.push({phase:'resolve',ids:L.buildCanonicalLights(s,cfg).map(l=>l.id),options:o});if(failPhase==='resolve')p.closed=true}};
  return{p,events};
}

async function testStream(){
  const {p,events}=environment();await p._renderOpaqueLighting(source,settings,'macro');
  assert.deepEqual(events.map(e=>e.phase),['shadows','visibility','direct','shadows','visibility','direct','shadows','visibility','direct','shadows','visibility','resolve']);
  const direct=events.filter(e=>e.phase==='direct');assert.deepEqual(direct.map(e=>e.ids),[['macro'],['cone'],['lamp']]);
  assert.deepEqual(direct.map(e=>e.options.clear),[true,false,false]);assert.deepEqual(direct.map(e=>e.options.visibilityView.revision),[1,2,3]);
  const vis=events.filter(e=>e.phase==='visibility');
  assert.deepEqual(vis.slice(0,3).map(e=>[e.settings.dso,e.settings.darkBloom,e.settings.selfShadow,e.settings.contactShadow]),[[true,true,false,false],[false,false,true,true],[false,false,false,false]]);
  assert(vis.every(e=>e.settings.gtao===false&&e.settings.materialAOStrength===.4));
  assert.deepEqual(events.at(-1).ids,['macro','lamp','cone'],'full canonical state restored before forward consumers');
  assert.equal(events.at(-1).options.ambientVisibilityView.revision,4);
  assert.deepEqual(p.lastOpaqueVisibilityPlan,P.visibilityLightPlan(source,settings,L,S,'macro'));
  // The old proposed shortcut would apply the omni macro mask to the cone and
  // lamp too. Require mutually disjoint ownership in actual pass descriptors.
  assert(!vis[1].settings.dso&&!vis[2].settings.dso);
  for(const phase of ['shadows','visibility','direct','resolve']){
    const failed=environment(phase);await assert.rejects(failed.p._renderOpaqueLighting(source,settings,'macro'),/presenter is closed/);
    assert.equal(failed.events.at(-1).phase,phase,'no work can escape a cancelled awaited producer');
    assert.equal(failed.p.lastOpaqueVisibilityPlan,undefined);
  }
}

(async()=>{testPlan();await testStream();console.log('SM-505 LIGHT STREAM CPU PASS: canonical identity, per-driver term isolation, neutral batching, unchanged caps/toggles, one clear, final canonical restore and cancellation; no GPU/visual acceptance')})().catch(e=>{console.error(e);process.exit(1)});
