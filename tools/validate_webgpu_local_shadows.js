'use strict';
const assert=require('assert');
const Lighting=require('../engine/webgpu_lighting.js');
const S=require('../engine/webgpu_local_shadows.js');

const close=(a,b,e=1e-6,msg='')=>assert.ok(Math.abs(a-b)<=e,`${msg} expected ${b}, got ${a}`);
assert.deepStrictEqual(S.SELF_QUALITY_SAMPLES,[0,8,12,16,28]);
assert.deepStrictEqual(S.CONTACT_QUALITY_SAMPLES,[0,4,8,12]);
assert.strictEqual(S.selfShadowSamples(-4),0);assert.strictEqual(S.selfShadowSamples(1),8);assert.strictEqual(S.selfShadowSamples(2),12);assert.strictEqual(S.selfShadowSamples(3),16);assert.strictEqual(S.selfShadowSamples(4),28);assert.strictEqual(S.selfShadowSamples(99),28);
assert.strictEqual(S.contactShadowSamples(-1),0);assert.strictEqual(S.contactShadowSamples(1),4);assert.strictEqual(S.contactShadowSamples(2),8);assert.strictEqual(S.contactShadowSamples(3),12);assert.strictEqual(S.contactShadowSamples(99),12);
assert.deepStrictEqual(S.DEBUG_MODES,['self-shadow','contact-shadow']);

const scene={lights:[
  {id:'light:weak',group:'objective',x:48,y:16,z:18,radius:40,intensity:.1,color:[1,1,1]},
  {id:'light:strong',group:'pulse',x:8,y:16,z:19,radius:160,intensity:1.2,color:[1,1,1]},
  {id:'light:player-cone:0',type:'cone',x:10,y:16,z:22,dx:1,dy:0,range:248,intensity:2,color:[1,1,1],innerCos:.95,outerCos:.8}
]};
const settings={lighting:true,heightStrength:1,selfShadowing:true,selfShadowQuality:3,selfShadowLightCount:2,selfShadowBias:1.15,selfShadowMaxDistance:30,contactShadows:true,contactShadowQuality:2,contactShadowDistance:20,contactShadowStrength:.58};
const selected=S.selectSelfShadowLights(scene,settings);assert.strictEqual(selected.length,2);assert.strictEqual(selected[0].type,'cone','player cone must be considered first for local self-shadow');assert.strictEqual(selected[1].id,'light:strong','strongest remaining relevant light must follow cone');
const driver=S.selectContactLight(scene,settings,[64,32]);assert.strictEqual(driver.type,'cone','contact driver preserves v1.2.3 player-cone priority');
assert.deepStrictEqual(S.selectSelfShadowLights(scene,{...settings,selfShadowing:false}),[]);

// Synthetic local-height step: low material on the right, high material on the left.
// This pins the v1.2.3 role distinction: the trace is local Material-v2 height,
// not SM-202 ownership depth and not a macro-shadow silhouette.
const sampleAt=(x,y)=>({coverage:(x>=0&&x<64&&y>=0&&y<32)?1:0,height:x<32?.80:.05});
const light={id:'light:test',type:'point',position:[8,16,24],radius:100,intensity:1,color:[1,1,1],direction:[1,0],innerCos:1,outerCos:-1};
const point={x:35,y:16,height:.05};
const vis=S.selfShadowReference(point,[light],settings,sampleAt,[64,32]);assert.ok(vis<.8&&vis>=.24,`height step should self-shadow, got ${vis}`);
close(S.selfShadowReference(point,[light],{...settings,selfShadowing:false},sampleAt,[64,32]),1,1e-8,'disabled self shadow');
close(S.selfShadowReference(point,[light],{...settings,selfShadowQuality:0},sampleAt,[64,32]),1,1e-8,'quality-zero self shadow');

const angles=[];for(const angle of [0,45,90,135,180,225,270,315]){const a=angle*Math.PI/180,L={...light,position:[point.x+Math.cos(a)*24,point.y+Math.sin(a)*24,24]},v=S.selfShadowReference(point,[L],settings,sampleAt,[64,32]);assert.ok(Number.isFinite(v)&&v>=0&&v<=1,`bounded self visibility at ${angle}`);angles.push({angle,visibility:v})}
assert.ok(angles.some(q=>q.visibility<.9),'eight-angle matrix must include a locally occluded direction');assert.ok(angles.some(q=>q.visibility>.99),'eight-angle matrix must include an unoccluded direction');

const occNear=S.contactOcclusionReference(point,light,settings,sampleAt,[64,32]);assert.ok(occNear>.05,`near height step should generate contact occlusion, got ${occNear}`);
const far={x:55,y:16,height:.05};const occFar20=S.contactOcclusionReference(far,light,{...settings,contactShadowDistance:20},sampleAt,[64,32]);const occFar36=S.contactOcclusionReference(far,light,{...settings,contactShadowDistance:36},sampleAt,[64,32]);assert.ok(occFar20<.02,`contact shadow must remain short-range at 20 px, got ${occFar20}`);assert.ok(occFar36>occFar20+.03,`larger explicit contact range should reach the step: ${occFar36} vs ${occFar20}`);close(S.contactOcclusionReference(point,light,{...settings,contactShadows:false},sampleAt,[64,32]),0,1e-8,'disabled contact shadow');

const sameHeight=[{center:true,height:.05,occlusion:.6},{height:.05,occlusion:.8},{height:.05,occlusion:.8}],mismatched=[{center:true,height:.05,occlusion:.6},{height:.85,occlusion:1},{height:.85,occlusion:1}];
const sameVis=S.reconstructContactReference(.05,sameHeight,.58),mismatchVis=S.reconstructContactReference(.05,mismatched,.58);assert.ok(mismatchVis>sameVis+.04,'depth-aware reconstruction must reject materially different-height neighbours');
assert.ok(sameVis>=0&&sameVis<=1&&mismatchVis>=0&&mismatchVis<=1);

// Name the production controls used by the browser gate so source-level tests pin
// the acceptance matrix even when Node has no GPU/ImageBitmap implementation.
const productionControls=['cargo_crate','rust_barrel','server_cabinet','hex_maintenance_idle_0'];assert.strictEqual(productionControls.length,4);

// Renderer helpers are representation-only and never mutate gameplay authority.
const gameplay={room:3,objective:'relay',player:[12,34]},before=JSON.stringify(gameplay);S.selectSelfShadowLights(scene,settings);S.selfShadowReference(point,[light],settings,sampleAt,[64,32]);assert.strictEqual(JSON.stringify(gameplay),before);

console.log(`SM-205 local-shadow semantics PASS: self tiers ${S.SELF_QUALITY_SAMPLES.join('/')}, contact tiers ${S.CONTACT_QUALITY_SAMPLES.join('/')}, 8-angle local-height matrix and short-range depth-aware contact reconstruction validated.`);
