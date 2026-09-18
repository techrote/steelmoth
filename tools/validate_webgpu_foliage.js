'use strict';
const assert=require('assert');
const F=require('../engine/foliagefx.js');
const L=require('../engine/webgpu_lighting.js');
const W=require('../engine/webgpu_foliage.js');

assert.strictEqual(W.SCHEMA,'steelmoth-webgpu-foliage/v1');
assert.strictEqual(W.MAX_INSTANCES,F.FOLIAGE_HARD_CAP);
assert.strictEqual(W.INSTANCE_STRIDE,80);
assert.strictEqual(W.OUTPUT_STRIDE,48);
assert(W.DEBUG_MODES.includes('classification')&&W.DEBUG_MODES.includes('front-blend'));
assert(W.PALETTE.SHORT_GRASS[0]<.1&&W.PALETTE.SHORT_GRASS[1]<.3&&W.PALETTE.SHORT_GRASS[2]<.3,'Fine Grass palette must remain restrained dark teal');

const tiny={category:'SHORT_GRASS',h:12};
const medium={category:'FERN',h:24};
const macro={category:'BUSH',h:36};
assert.deepStrictEqual(W.classificationFor(tiny),{role:'receiver-only',flags:W.CLASS_FLAGS.receiver|W.CLASS_FLAGS.tiny,macroEligible:false,contactEligible:false});
assert.strictEqual(W.classificationFor(medium).role,'contact-receiver');
assert.strictEqual(W.classificationFor(macro).role,'macro-eligible');

const manifest={source_size:[64,64],world_scale:.18,regions:{grass_short:[0,0,16,32],fern:[16,0,16,32],bush:[32,0,32,48]},roles:{foliage_pool:['grass_short','fern','bush']},region_meta:{grass_short:{foliage_fx:{category:'SHORT_GRASS'}},fern:{foliage_fx:{category:'FERN'}},bush:{foliage_fx:{category:'BUSH'}}}};
const descriptor={signature:'sm401-fixture',seed:401,clumps:[{x:120,y:120,radius:20,density:1.4,seed:4001},{x:170,y:142,radius:24,density:1.2,seed:4002}]};
const authority=new W.FoliageFrameAuthority(manifest);assert(authority.setDescriptor(descriptor,{foliageQuality:3}));
const actors=[{id:'player',type:'player',x:126,y:121,vx:14,vy:0,radius:36,halfW:9,halfH:10,priority:100}];const before=JSON.stringify(actors);
for(let i=0;i<12;i++)authority.update(1/60,actors,{foliageQuality:3},i/60);
assert.strictEqual(JSON.stringify(actors),before,'renderer preparation must not mutate gameplay/actor authority');
const snap=authority.snapshot();assert(snap.instanceCount>0&&snap.instanceCount<=W.MAX_INSTANCES);assert(snap.classes.receiverOnly+snap.classes.contact+snap.classes.macro>0);
const packed=W.packInstances(authority.instances);assert.strictEqual(packed.byteLength,authority.instances.length*W.INSTANCE_STRIDE);

const grass={...authority.instances.find(p=>p.category==='SHORT_GRASS')||authority.instances[0],category:'SHORT_GRASS',x:100,rootY:100,h:14,w:8,bendScale:.7,rootCutoff:.3,bendExponent:1.45,interactionScale:1,variation:.5,tintStrength:.07};
const rawLight={id:'test',type:'point',group:'test',x:148,y:72,z:22,radius:180,intensity:1.1,color:[1,.9,.8]};
const lights=L.buildCanonicalLights({lights:[rawLight]},{lighting:true,emissive:1,lightRadius:1});
const v=W.canonicalLightVector(lights[0],[100,100],0),e=[48,28,22],d=Math.hypot(...e);for(let i=0;i<3;i++)assert(Math.abs(v[i]-e[i]/d)<1e-12,'SM-401 light vector must use the SM-204 +X/-screenY/+Z convention');
const dark=W.shadeFoliageReference(grass,[],{directVisibility:1,ambientVisibility:0},{ambient:0,lighting:true},0,[]);assert.deepStrictEqual(dark.color,[0,0,0],'Fine Grass must not self-light');assert.strictEqual(dark.emissive,0);
const lit=W.shadeFoliageReference(grass,lights,{directVisibility:1,ambientVisibility:1},{ambient:.2,lighting:true},0,[]);assert(lit.color.some((v,i)=>v>dark.color[i]));assert(lit.color[1]>lit.color[0]&&lit.color[2]>lit.color[0],'lit Fine Grass remains teal rather than amber');
const shadow=W.shadeFoliageReference(grass,lights,{directVisibility:0,ambientVisibility:.25},{ambient:.2,lighting:true},0,[]);assert(shadow.illumination<lit.illumination,'SM-307 direct visibility must suppress foliage direct light');

let spread=0,last=null;for(let deg=0;deg<360;deg+=45){const a=deg*Math.PI/180,one=L.buildCanonicalLights({lights:[{...rawLight,x:100+Math.cos(a)*80,y:100+Math.sin(a)*80}]},{lighting:true,emissive:1,lightRadius:1}),q=W.shadeFoliageReference({...grass,bendScale:1.1},one,{directVisibility:1,ambientVisibility:1},{ambient:.08,lighting:true},.4,[]);if(last!=null)spread=Math.max(spread,Math.abs(q.illumination-last));last=q.illumination;assert(Number.isFinite(q.illumination));}assert(spread>.001,'foliage must respond to canonical light direction');

const staticRoot=W.rootedWeight(.1,grass,3),tip=W.rootedWeight(1,grass,3);assert.strictEqual(staticRoot,0,'foliage root must remain locked');assert(tip>.9,'foliage tip must remain deformable');
const p=W.packParams(640,360,.25,{foliageQuality:3,ambient:.2,lighting:true},authority.instances.length,lights.length,'classification');assert.strictEqual(p.byteLength,W.PARAM_BYTES);const u=new Uint32Array(p.buffer,p.byteOffset);assert.strictEqual(u[0],640);assert.strictEqual(u[1],360);assert.strictEqual(u[2],authority.instances.length);assert.strictEqual(u[3],lights.length);assert.strictEqual(u[10],W.DEBUG_MODES.indexOf('classification'));assert.strictEqual(u[11],3);assert.strictEqual(u[12],1);

const proto=Object.create(W.WebGPUFoliagePass.prototype),sceneView={tag:'vis'},depthView={tag:'depth'},lightBuffer={tag:'lights'};const fakeLighting={registry:{require(name){assert.strictEqual(name,L.LIGHT_BUFFER_NAME);return{handle:lightBuffer}}},activeLightCount:1};const fakeGBuffer={_views(){return{depth:depthView}}};const fakeVisibility={bindings(){return{visibility:sceneView}}};const source=proto.sourceFromPaths(fakeLighting,fakeGBuffer,fakeVisibility);assert.strictEqual(source.lightBuffer,lightBuffer);assert.strictEqual(source.visibilityView,sceneView);assert.strictEqual(source.depthView,depthView);assert.strictEqual(source.lightCount,1);

console.log('SM-401 foliage deterministic tests: PASS',JSON.stringify({instances:snap.instanceCount,classes:snap.classes,dark:dark.color,lit:lit.color,shadow:shadow.color,angleSpread:spread,canonicalLightBuffer:L.LIGHT_BUFFER_NAME}));
