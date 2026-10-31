#!/usr/bin/env node
'use strict';
// CPU-only unit conversions and real lighting/shadow reference regressions.
const assert=require('assert');
const crypto=require('crypto');
const P=require('../engine/webgpu_scene_presenter.js');
const L=require('../engine/webgpu_lighting.js');
const S=require('../engine/webgpu_local_shadows.js');
const Ownership=require('../engine/webgpu_ownership.js');
const Pseudo=require('../engine/pseudo_depth.js');
const Transparent=require('../engine/webgpu_transparent_fx.js');
const Occluders=require('../engine/webgpu_occluders.js');
const Clusters=require('../engine/webgpu_clusters.js');
const close=(a,b,message,epsilon=1e-11)=>assert(Math.abs(a-b)<=epsilon,`${message}: ${a} != ${b}`);
const vector=(a,b,message)=>a.forEach((v,i)=>close(v,b[i],`${message}[${i}]`));
const f32=(bytes,offset)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getFloat32(offset,true);
const settings={lighting:true,ambient:.18,heightStrength:1.7,normalStrength:1.2,materialAOStrength:.62,
  selfShadowing:true,selfShadowQuality:3,selfShadowLightCount:1,selfShadowBias:1.15,selfShadowMaxDistance:30,
  contactShadows:true,contactShadowQuality:3,contactShadowDistance:20,contactShadowStrength:.58};
const scene={frame:{logicalSize:[640,360]},settings,sprites:[],lights:[
  {id:'point',type:'point',x:80,y:0,z:42,radius:180,intensity:1.2,color:[.8,.6,.4]},
  {id:'cone',type:'cone',x:0,y:0,z:45,dx:1,dy:0,range:220,intensity:2,color:[.6,.8,1],innerCos:.95,outerCos:.8}
],occluders:[{id:'caster',bounds:[2,3,28,37],rect:[4,5,26,35],root:{x:15,y:37},x:15,contactY:37,
  zRange:[2,21],sections:[{a:[4,34],b:[26,34],z:14,altitude:.7,alpha:.9,extend:1.2}]}]};
const original=JSON.stringify(scene);
const sample={albedo:[.31,.22,.14,1],normalRoughness:[.57,.43,.97,.56],heightMaterial:[.28,.15,.64,.07]};
const xy=[20,0],baseLights=L.buildCanonicalLights(scene,settings);
const baseFinal=L.shadePixelReference(sample,baseLights,settings,xy);
const baseDirect=L.shadeDirectReference(sample,baseLights,settings,xy,.37);
const baseResolved=L.resolveDirectReference(sample,baseDirect,settings,.68);
assert(baseDirect.slice(0,3).some(v=>v>.01),'positive material-height fixture has real direct light');

// The canonical default shader is an independent historical control. Optional
// streamed shader and SM205 uniform consumption may change; SM204 defaults do not.
assert.equal(crypto.createHash('sha256').update(L.DEFERRED_WGSL).digest('hex'),
  '159c7773f9074fa50af5766a046f26437922afae8f412fdc4aaa48de4612a6fa');
assert.equal(L.worldScale({}),1);
for(const value of [undefined,null,0,-2,NaN,Infinity])assert.equal(L.worldScale({worldScale:value}),1,'invalid scale defaults to logical units');
assert.equal(L.worldScale({worldScale:1e-6}),1/16);assert.equal(L.worldScale({worldScale:1e6}),16);

for(const scale of [1,2,3]){
  const derived=P.scaleScene(scene,640*scale,360*scale,null,L).scene;
  assert.equal(derived.settings.worldScale,scale,'derived material/trace unit scale accompanies native lights');
  const lights=L.buildCanonicalLights(derived,derived.settings),nativeXY=xy.map(v=>v*scale);
  vector(L.shadePixelReference(sample,lights,derived.settings,nativeXY),baseFinal,`SM204 final ${scale}x`);
  vector(L.shadeDirectReference(sample,lights,derived.settings,nativeXY,.37),baseDirect,`SM204 raw direct ${scale}x`);
  vector(L.resolveDirectReference(sample,baseDirect,derived.settings,.68),baseResolved,`SM204 resolve ${scale}x`);
  for(let i=0;i<lights.length;i++){
    vector(L.shadePixelReference(sample,[lights[i]],derived.settings,nativeXY),L.shadePixelReference(sample,[baseLights[i]],settings,xy),`individual ${lights[i].type} ${scale}x`);
  }
  if(scale>1){
    const mixed=L.shadePixelReference(sample,lights,{...derived.settings,worldScale:1},nativeXY);
    assert(mixed.slice(0,3).some((v,i)=>Math.abs(v-baseFinal[i])>.001),'retained old unscaled nonzero material-height witness must alter actual shading');
  }
  const o=derived.occluders[0],source=scene.occluders[0];
  for(const key of ['bounds','rect','zRange'])assert.deepEqual(o[key],source[key].map(v=>v*scale),`${key} native units`);
  assert.deepEqual(o.root,{x:source.root.x*scale,y:source.root.y*scale});
  for(const key of ['a','b'])assert.deepEqual(o.sections[0][key],source.sections[0][key].map(v=>v*scale),`section ${key} native XY`);
  assert.equal(o.sections[0].z,source.sections[0].z*scale);
  for(const key of ['altitude','alpha','extend'])assert.equal(o.sections[0][key],source.sections[0][key],'dimensionless section policy unchanged');
  assert.equal(JSON.stringify(scene),original,'derivation does not mutate original gameplay scene/settings/materials');
}

// Anisotropic geometry uses separate XY ratios; heights use the existing minimum
// distance ratio. This is representation testing, not an isotropic shading claim.
const anisotropic=P.scaleScene(scene,1280,1080,null,L).scene;
assert.deepEqual(anisotropic.occluders[0].bounds,[4,9,56,111]);
assert.deepEqual(anisotropic.occluders[0].sections[0].a,[8,102]);
assert.deepEqual(anisotropic.occluders[0].sections[0].b,[52,102]);
assert.deepEqual(anisotropic.occluders[0].zRange,[4,42]);
assert.equal(anisotropic.settings.worldScale,2);
const prior={...scene,settings:{...settings,worldScale:1.5}};
assert.equal(P.scaleScene(prior,1280,720,null,L).scene.settings.worldScale,3,'preexisting unit conversion composes rather than silently resets');

// Exercise the actual producer, including its compatibility clamp BEFORE
// material texture height is clamped. Constant synthetic G2 samples alone miss
// this path: native sprite height otherwise scales the material factor twice.
const atlas={source_size:[16,16],world_scale:1,region_meta:{face:{world_scale:1}},regions:{face:[0,0,8,8]}};
const makeSprite=(id,h,extra={})=>({id,category:'static',atlas:'hd',spriteId:'face',root:{x:30,y:80},
  transform:{x:30,y:80-h/2,w:16,h},style:{alpha:.92,tint:[1,1,1]},depthBias:.7,...extra});
const materialScene={frame:{logicalSize:[640,360]},settings:{},sprites:[makeSprite('floor-clamped',1),makeSprite('low',2),makeSprite('normal',12),
  makeSprite('high',48,{category:'foreground'}),makeSprite('subrect',8,{category:'dynamic',subrect:{sx:1,sy:2,sw:4,sh:4}}),
  makeSprite('subrect-high',24,{subrect:{sx:1,sy:2,sw:4,sh:4}}),
  makeSprite('transparent',12,{category:'dynamic',style:{alpha:.25,tint:[1,1,1]}}),
  makeSprite('top',12,{category:'top',style:{alpha:.995,tint:[1,1,1]}})],materials:[]};
const atlasBefore=JSON.stringify(atlas),materialBefore=JSON.stringify(materialScene);
const authored=Ownership.buildOwnershipSceneInstances(materialScene,atlas);
assert.deepEqual(Object.fromEntries(authored.map(i=>[i.id,i.heightFactor])),{'floor-clamped':.18,low:.25,normal:1.5,high:4.5,subrect:2,'subrect-high':4.5});
for(const [width,height] of [[640,360],[1280,720],[1920,1080],[1280,1080]]){
  const native=P.scaleScene(materialScene,width,height,Pseudo,L).scene;
  const meta=P.nativeOwnershipAtlas(atlas,native.settings.materialHeightScaleY);
  const instances=Ownership.buildOwnershipSceneInstances(native,meta);
  assert.deepEqual(instances.map(i=>[i.id,i.heightFactor]),authored.map(i=>[i.id,i.heightFactor]),'real canonical producer preserves full/subrect and already-clamped height factors');
  for(let i=0;i<instances.length;i++){
    const a=authored[i],n=instances[i];assert.equal(n.objectId,a.objectId);assert.equal(n.depthLayer,a.depthLayer);assert.equal(n.depthBias,a.depthBias);
    assert.deepEqual(n.uv,a.uv,'derived atlas world units do not alter albedo/material UV sampling');
    for(const rawHeight of [.1,.3,.8])close(Math.min(1,rawHeight*n.heightFactor),Math.min(1,rawHeight*a.heightFactor),'post-factor material height clamp unchanged');
  }
  for(let i=0;i<native.sprites.length;i++){
    const expected=Pseudo.projectSpriteFragment(materialScene.sprites[i],{u:.5,v:1,localHeight:0,alpha:materialScene.sprites[i].style.alpha}).depth01;
    close(native.sprites[i].depth01,expected,'actual sprite depth key stays in canonical authored units');
    const vertices=Transparent.quadVertices(native.sprites[i],{u0:0,v0:0,u1:.5,v1:.5});
    for(let v=8;v<vertices.length;v+=Transparent.VERTEX_FLOATS)close(vertices[v],expected,'actual transparent vertex depth uses canonical sprite key');
  }
  if(height===1080&&width===1920){
    const mixed=Ownership.buildOwnershipSceneInstances(native,atlas),old=mixed.find(i=>i.id==='normal');
    assert.equal(old.heightFactor,4.5,'retained old native-height factor reaches accepted upper clamp');
    assert.equal(Math.min(1,.3*old.heightFactor),1,'pre-fix producer clips nonzero material height before any later unit correction');
    close(Math.min(1,.3*instances.find(i=>i.id==='normal').heightFactor),.45,'correct derived material preserves authored height before lighting conversion');
  }
}
const firstNative=P.scaleScene(materialScene,1280,720,Pseudo,L).scene;
const secondNative=P.scaleScene(firstNative,1920,1080,Pseudo,L).scene;
for(let i=0;i<secondNative.sprites.length;i++)close(secondNative.sprites[i].depth01,firstNative.sprites[i].depth01,'rederived sprite depth does not compound native units');
assert.equal(JSON.stringify(atlas),atlasBefore,'derived atlas must not modify asset authority');
assert.equal(JSON.stringify(materialScene),materialBefore,'actual instance/depth derivation does not mutate source');

// Real bounded occluder+cluster producers must preserve an authored 1.5px gap.
// Pixel/tile/kernel capacities remain unchanged; only world-distance thresholds
// and the area threshold acquire their respective length/area unit conversion.
const clusterScene={frame:{roomId:'native-topology',logicalSize:[128,80]},settings:{},sprites:[],occluders:[
  {id:'near:a',rect:[10,10,30,40],root:{x:20,y:40},kind:'machine',source:'bin',majorOccluder:true,zRange:[0,18]},
  {id:'near:b',rect:[31.5,12,51.5,40],root:{x:41.5,y:40},kind:'machine',source:'bin',majorOccluder:true,zRange:[0,20]},
  {id:'far',rect:[90,10,110,40],root:{x:100,y:40},kind:'machine',source:'bin',majorOccluder:true,zRange:[0,19]}]};
const clusterBefore=JSON.stringify(clusterScene),binOptions={tileSize:32,maxOccluders:32,maxPerTile:16,maxTileRefs:128};
const baseBins=Occluders.buildOccluderSnapshot(clusterScene,binOptions),baseClusters=Clusters.buildClusterSnapshot(baseBins);
assert.equal(baseClusters.clusters.length,2);assert(baseClusters.clusters.some(c=>c.memberCount===2));
const defaultOptions=P.nativeClusterOptions(1,Clusters);
assert.deepEqual(Clusters.canonicalMembership(Clusters.buildClusterSnapshot(baseBins,defaultOptions)),Clusters.canonicalMembership(baseClusters),'scale1 cluster topology retains accepted defaults');
for(const scale of [1,2,3]){
  const derived=P.scaleScene(clusterScene,128*scale,80*scale).scene,options=P.nativeClusterOptions(scale,Clusters);
  for(const key of ['adjacencyPx','crossClassAdjacencyPx','groundYThreshold','depthProximity','zProximity'])assert.equal(options[key],Clusters.DEFAULTS[key]*scale);
  assert.equal(options.tinyConnectorArea,Clusters.DEFAULTS.tinyConnectorArea*scale*scale);
  for(const key of ['maxCandidatePerTile','maxCandidatePairs','maxClusters','maxMembers','layerEpsilon','tinyConnectorOverlapRatio'])assert.equal(options[key]??Clusters.DEFAULTS[key],Clusters.DEFAULTS[key],'dimensionless/capacity policy unchanged');
  const bins=Occluders.buildOccluderSnapshot(derived,binOptions),clustered=Clusters.buildClusterSnapshot(bins,options);
  assert.deepEqual(Clusters.canonicalMembership(clustered),Clusters.canonicalMembership(baseClusters),'actual cluster IDs and membership invariant at native extent');
  if(scale>1)assert.equal(Clusters.buildClusterSnapshot(bins).clusters.length,3,'retained old unscaled adjacency splits a logically connected pair');
}
assert.equal(JSON.stringify(clusterScene),clusterBefore,'cluster unit adaptation never mutates gameplay occluders');

// Origin fixes the production hash jitter at zero for each scale; broad material
// fields avoid texture-grid aliases. Nonzero material height, Z, bias and finite
// trace spans are preserved. Both local-shadow roles remain independently tested.
const point={x:0,y:0,height:.2},shadowLight={position:[80,0,42]},logical=[640,360];
function shadowCase(scale,wall,enabled=true){
  const light={...shadowLight,position:shadowLight.position.map(v=>v*scale)};
  const sampleAt=(x,y)=>({coverage:enabled?1:0,height:x/scale>=wall?.85:.2});
  const nativeSettings={...settings,worldScale:scale},extent=logical.map(v=>v*scale);
  return{self:S.selfShadowReference(point,[light],nativeSettings,sampleAt,extent),contact:S.contactOcclusionReference(point,light,nativeSettings,sampleAt,extent),light,sampleAt,extent,nativeSettings};
}
for(const wall of [4,26]){
  const base=shadowCase(1,wall);
  assert(base.self<.8,'positive step produces local self-shadow');
  if(wall===4)assert(base.contact>.05,'near step produces short-range contact');
  else assert.equal(base.contact,0,'far step is beyond canonical contact distance');
  for(const scale of [1,2,3]){
    const native=shadowCase(scale,wall);
    close(native.self,base.self,`self ${wall}px wall ${scale}x`);
    close(native.contact,base.contact,`contact ${wall}px wall ${scale}x`);
    if(wall===26&&scale>1){
      const old=S.selfShadowReference(point,[native.light],{...settings,worldScale:1},native.sampleAt,native.extent);
      assert.equal(old,1,'retained old native trace misses a logically in-range blocker');
    }
    const empty=shadowCase(scale,wall,false);assert.equal(empty.self,1);assert.equal(empty.contact,0,'coverage omission never manufactures a blocker');
    assert.equal(S.selfShadowReference(point,[native.light],{...native.nativeSettings,selfShadowing:false},native.sampleAt,native.extent),1);
    assert.equal(S.contactOcclusionReference(point,native.light,{...native.nativeSettings,contactShadows:false},native.sampleAt,native.extent),0);
  }
}

// Offset coordinates exercise author-world jitter normalization. Origin-only
// vectors above cannot detect a missing P/worldScale in the production hash.
const offsetPoint={x:12,y:8,height:.2},offsetLight={position:[92,8,42]};
const offsetField=(x,y)=>({coverage:1,height:x>=16?.85:.2});
const offsetSelf=S.selfShadowReference(offsetPoint,[offsetLight],settings,offsetField,logical);
const offsetContact=S.contactOcclusionReference(offsetPoint,offsetLight,settings,offsetField,logical);
assert(offsetSelf<.8&&offsetContact>.05);
for(const scale of [1,2,3]){
  const p={...offsetPoint,x:offsetPoint.x*scale,y:offsetPoint.y*scale},light={position:offsetLight.position.map(v=>v*scale)},s={...settings,worldScale:scale};
  const field=(x,y)=>offsetField(x/scale,y/scale),extent=logical.map(v=>v*scale);
  close(S.selfShadowReference(p,[light],s,field,extent),offsetSelf,'nonzero author-world self jitter');
  close(S.contactOcclusionReference(p,light,s,field,extent),offsetContact,'nonzero author-world contact jitter');
}

// Near thresholds and partial contact smoothing exercise otherwise hidden unit
// constants, separately from the saturated-height step above.
for(const scale of [1,2,3]){
  const short={position:[1.5*scale,0,42*scale]},s={...settings,worldScale:scale};
  assert.equal(S.selfShadowReference(point,[short],s,()=>({coverage:1,height:1}),logical.map(v=>v*scale)),1,'self near cutoff follows logical distance');
  const near={position:[.5*scale,0,42*scale]};
  assert.equal(S.contactOcclusionReference(point,near,s,()=>({coverage:1,height:1}),logical.map(v=>v*scale)),0,'contact near cutoff follows logical distance');
  const light={position:[80*scale,0,S.heightWorld(.2,s)]},level=()=>({coverage:1,height:.2+2/(64*settings.heightStrength)});
  const value=S.contactOcclusionReference(point,light,s,level,logical.map(v=>v*scale));
  const baseLight={position:[80,0,S.heightWorld(.2,settings)]};
  close(value,S.contactOcclusionReference(point,baseLight,settings,level,logical),'partial contact smoothstep scales its native 3px length');
}

// Actual production packers clamp artistic settings BEFORE converting lengths.
for(const scale of [1,2,3])for(const variant of [{heightStrength:9,selfShadowBias:99,selfShadowMaxDistance:999,contactShadowDistance:999,h:3,b:5,c:3.5,sd:176,cd:36},{heightStrength:-9,selfShadowBias:-99,selfShadowMaxDistance:-999,contactShadowDistance:-999,h:0,b:.05,c:.15,sd:8,cd:4}]){
  const s={...settings,...variant,worldScale:scale};
  const lighting=L.frameBytes(640*scale,360*scale,s,2,0),self=S.selfFrameBytes(640*scale,360*scale,s,1),contact=S.contactFrameBytes(640*scale,360*scale,320*scale,180*scale,s,true);
  close(f32(lighting,16),Math.fround(variant.h*scale),'SM204 packed material height',1e-6);
  for(const bytes of [self,contact]){close(f32(bytes,8),Math.fround(variant.h*scale),'SM205 packed material height',1e-6);close(f32(bytes,44),scale,'SM205 unit scalar');}
  close(f32(self,12),Math.fround(variant.b*scale),'self bias',1e-6);close(f32(self,16),variant.sd*scale,'self trace span',1e-6);
  close(f32(contact,12),Math.fround(variant.c*scale),'contact bias',1e-6);close(f32(contact,16),variant.cd*scale,'contact trace span',1e-6);
}
assert.equal(JSON.stringify(scene),original);
console.log('SM-505 NATIVE UNITS CPU PASS: actual SM204/205 at1/2/3x, nonzero material/Z/bias/span/jitter, production packers, real Ownership full/subrect material clamps, sprite/transparent logical depth, cluster topology, occluder geometry, nonmutation and old mixed-unit witnesses; no GPU execution');
