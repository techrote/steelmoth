'use strict';

const assert=require('assert');
const Quality=require('../engine/webgpu_quality.js');
const Local=require('../engine/webgpu_local_shadows.js');
const Hierarchy=require('../engine/webgpu_dso_hierarchy.js');
const DarkBloom=require('../engine/webgpu_dark_bloom.js');

assert.equal(Quality.SCHEMA,'steelmoth-webgpu-quality/v1');
assert.deepEqual(Quality.NAMES,['Low','Medium','High','Ultra']);
assert.equal(Quality.normalizeName('medium'),'Medium');
assert.equal(Quality.normalizeName('nonsense'),'Medium');

const expected={
  Low:{self:8,contact:4,hierarchy:'Low',bloom:'Low'},
  Medium:{self:12,contact:8,hierarchy:'Medium',bloom:'Medium'},
  High:{self:16,contact:12,hierarchy:'High',bloom:'High'},
  Ultra:{self:28,contact:12,hierarchy:'Ultra',bloom:'Ultra'}
};

let prevSelf=0,prevContact=0;
for(const name of Quality.NAMES){
  const p=Quality.resolvePreset(name),want=expected[name];
  assert.equal(p.name,name);
  assert.equal(p.core.renderScale,1);
  assert.equal(p.core.gbufferScale,1);
  assert.equal(p.core.ownershipDepthScale,1);
  assert.equal(p.core.objectIdScale,1);
  assert.equal(p.core.albedoSampling,'nearest');
  assert.equal(p.core.invariant,true);
  assert.equal(p.dso.hardCore,'full');
  assert.equal(p.localShadows.selfShadowSamples,want.self);
  assert.equal(p.localShadows.contactShadowSamples,want.contact);
  assert.equal(Local.selfShadowSamples(p.localShadows.selfShadowQuality),want.self);
  assert.equal(Local.contactShadowSamples(p.localShadows.contactShadowQuality),want.contact);
  assert.equal(Hierarchy.qualityName(p.dso.hierarchyQuality),want.hierarchy);
  assert.equal(DarkBloom.qualityName(p.darkBloom.quality),want.bloom);
  assert(p.localShadows.selfShadowSamples>=prevSelf,'self-shadow work must be monotonic by tier');
  assert(p.localShadows.contactShadowSamples>=prevContact,'contact work must be monotonic by tier');
  prevSelf=p.localShadows.selfShadowSamples;prevContact=p.localShadows.contactShadowSamples;
  assert.equal(p.reserved.gtao.implemented,false);
  assert.equal(p.reserved.ssgi.implemented,false);
  assert.equal(p.reserved.volumetrics.implemented,false);
  assert.equal(p.reserved.gtao.enabled,false);
  assert.equal(p.reserved.ssgi.enabled,false);
  assert.equal(p.reserved.volumetrics.enabled,false);
}

const medium=Quality.resolvePreset('Medium');
assert.equal(medium.localShadows.selfShadowSamples,12,'Medium must retain representative local height detail');
assert.equal(medium.localShadows.contactShadowSamples,8,'Medium contact quality must remain representative');
assert.equal(medium.localShadows.selfShadowLightCount,2);
assert.equal(medium.dso.hierarchyQuality,'Medium');
assert.equal(medium.darkBloom.enabled,true);
assert.equal(medium.darkBloom.quality,'Medium');

const applied=Quality.localShadowSettings('Low',{selfShadowBias:1.15,materialV2:true});
assert.equal(applied.selfShadowQuality,1);assert.equal(applied.contactShadowQuality,1);assert.equal(applied.materialV2,true);assert.equal(applied.selfShadowBias,1.15);
const hard=Quality.dsoOptions('Ultra',{tileSize:32});assert.equal(hard.tileSize,32);assert.equal(hard.maxJobs,512);assert.equal(hard.maxMembers,512);
const hierarchy=Quality.dsoHierarchyOptions('High',{tileSize:16});assert.equal(hierarchy.quality,'High');assert.equal(hierarchy.tileSize,16);
const bloom=Quality.darkBloomOptions('Low',{qualityOverrides:{nearStrength:.05}});assert.equal(bloom.quality,'Low');assert.equal(bloom.enabled,true);assert.equal(bloom.qualityOverrides.nearStrength,.05);
const workload=Quality.workloadMetadata('Medium');assert.equal(workload.qualityPreset,'Medium');assert.equal(workload.coreScale,1);assert.equal(workload.selfShadowSamples,12);assert.equal(workload.contactShadowSamples,8);

const diag=Quality.diagnostics('Ultra');assert.equal(diag.preset,'Ultra');assert(/albedo, object-ID and primary ownership depth stay native\/full resolution/.test(diag.policy));

const stored=new Map([[Quality.STORAGE_KEY,'High']]);
const storage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)};
const persisted=Quality.createRuntime({storage,location:{search:''}});assert.equal(persisted.preset,'High');assert.equal(persisted.source,'storage');persisted.setPreset('Low',{persist:true,source:'test'});assert.equal(stored.get(Quality.STORAGE_KEY),'Low');assert.equal(persisted.diagnostics().selectionSource,'test');
const query=Quality.createRuntime({storage,location:{search:'?webgpuQuality=Ultra'}});assert.equal(query.preset,'Ultra');assert.equal(query.source,'query');assert.equal(query.workloadMetadata().selfShadowSamples,28);
const badQuery=Quality.createRuntime({storage:{getItem:()=>null,setItem(){}},location:{search:'?webgpuQuality=bogus'}});assert.equal(badQuery.preset,'Medium');

console.log('SM-501 QUALITY PRESETS PASS: Low/Medium/High/Ultra are bounded, core representation is invariant, Medium is representative, production subsystem mappings agree, and static selection is query/storage/UI-ready');
