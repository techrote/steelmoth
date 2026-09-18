#!/usr/bin/env node
'use strict';
const assert=require('assert');
const T=require('../engine/webgpu_transparent_fx.js');
const checks=[];
function check(ok,msg){assert.ok(ok,msg);checks.push(msg)}
function eq(a,b,msg){assert.deepStrictEqual(a,b,msg);checks.push(msg)}
check(T.SCHEMA==='steelmoth-webgpu-transparent-fx/v1','schema pinned');
eq(T.STAGES,['world-alpha','world-additive','post-effects','top-additive','top-alpha','objective','guide'],'compatibility stage order pinned');
check(T.MAX_SHADER_FX===16,'WebGL2 renderFX 16-effect GPU cap retained');
check(T.MAX_TRANSPARENT_SPRITES>=300&&T.MAX_TRANSPARENT_SPRITES<=1024,'transparent sprite cap bounded with ParticleField headroom');
check(T.BLEND.alpha.color.srcFactor==='src-alpha'&&T.BLEND.alpha.color.dstFactor==='one-minus-src-alpha','alpha blend is explicit');
check(T.BLEND.additive.color.srcFactor==='src-alpha'&&T.BLEND.additive.color.dstFactor==='one','additive blend is explicit');
const meta={source_size:[8,4],regions:{left:[0,0,2,4],middle:[2,0,4,4],right:[6,0,2,4]}};
const l=T.atlasRegion(meta,'left'),r=T.atlasRegion(meta,'right');
check(l.u0>0&&l.u1<.25,'left-edge atlas UVs use half-texel inset');
check(r.u0>.75&&r.u1<1&&r.u1>r.u0,'right-edge atlas UVs use half-texel inset without overflow');
const scene={frame:{logicalSize:[640,360]},sprites:[
{id:'world-alpha',atlas:'legacy',spriteId:'left',category:'dynamic',transform:{x:10,y:20,w:8,h:8,rotation:0},style:{color:[1,0,0],alpha:.5,glow:false}},
{id:'world-add',atlas:'legacy',spriteId:'middle',category:'dynamic',transform:{x:30,y:40,w:10,h:12,rotation:.2},style:{color:[0,1,0],alpha:.7,glow:true}},
{id:'top-add',atlas:'legacy',spriteId:'right',category:'top',transform:{x:50,y:60,w:6,h:6,rotation:0},style:{color:[0,0,1],alpha:.8,glow:true}},
{id:'top-alpha',atlas:'legacy',spriteId:'left',category:'top',transform:{x:70,y:80,w:7,h:7,rotation:0},style:{color:[1,1,1],alpha:.4,glow:false}},
{id:'opaque-hd',atlas:'hd',spriteId:'middle',category:'dynamic',transform:{x:1,y:1,w:2,h:2},style:{alpha:1,glow:false}}],
proceduralLayers:[{id:'procedural:effects',kind:'effects',descriptor:Array.from({length:20},(_,i)=>({x:i,y:i*2,color:[1,.5,.2],age:.1,life:1,kind:i%6,params:[1,2,3,4]}))}],overlays:{objectiveMarker:{x:120,y:100,color:[1,.8,.2],time:2},guide:{x:200,y:150,color:[.2,.8,1],time:3,visible:true}}};
const before=JSON.stringify(scene),frame=T.buildCompatibilityFrame(scene,meta);
check(JSON.stringify(scene)===before&&T.frameUnchanged(scene,frame),'frame extraction does not mutate gameplay/render-scene input');
check(frame.stages['world-alpha'].length===1,'world alpha sprite classified once');check(frame.stages['world-additive'].length===1,'world additive sprite classified once');check(frame.stages['top-additive'].length===1&&frame.stages['top-alpha'].length===1,'top additive/alpha lanes remain distinct');
check(frame.effects.length===16,'shader FX clamped to WebGL2 GPU parity cap');check(frame.objective.x===120&&frame.objective.y===100&&frame.guide.x===200&&frame.guide.y===150,'objective/guide positions preserved exactly');check(frame.stats.acceptedSprites===4&&frame.stats.unresolvedCount===0,'only forward/transparent sprites captured');check(frame.stats.dropped===4,'over-cap procedural FX reported as dropped');
for(const stage of ['world-alpha','world-additive','top-additive','top-alpha']){const data=T.flattenStage(frame,stage);check(data.length===6*T.VERTEX_FLOATS,`${stage} emits one bounded six-vertex quad`)}
const world=T.flattenStage(frame,'world-alpha');check(Math.abs(world[0]-6)<1e-6&&Math.abs(world[1]-16)<1e-6,'sprite quad remains centered at compatibility logical position');check(Math.abs(world[7]-.5)<1e-6,'sprite alpha reaches GPU vertex data unchanged');
const cappedScene={frame:{logicalSize:[64,64]},sprites:Array.from({length:T.MAX_TRANSPARENT_SPRITES+17},(_,i)=>({id:`s${i}`,atlas:'legacy',spriteId:'left',category:'dynamic',transform:{x:1,y:1,w:1,h:1},style:{color:[1,1,1],alpha:.5}}))},capped=T.buildCompatibilityFrame(cappedScene,meta);check(capped.stats.acceptedSprites===T.MAX_TRANSPARENT_SPRITES&&capped.stats.dropped===17,'transparent sprite submissions are hard-bounded');
const missing=T.buildCompatibilityFrame({frame:{logicalSize:[1,1]},sprites:[{id:'missing',atlas:'legacy',spriteId:'not-there',category:'top',transform:{x:0,y:0,w:1,h:1},style:{alpha:.5}}]},meta);check(missing.stats.unresolvedCount===1&&missing.stages['top-alpha'].length===0,'missing atlas regions fail isolated instead of emitting corrupt UVs');
const packed=T.packProcedural(frame,0),f=new Float32Array(packed.buffer),u=new Uint32Array(packed.buffer);check(packed.byteLength===864,'procedural uniform layout size stable');check(f[0]===640&&f[1]===360&&f[2]===640&&f[3]===360&&f[4]===0&&f[5]===0&&Math.abs(f[6]-.1)<1e-6&&f[7]===0,'logical/output extent and first FX position/age/kind packed correctly');const colorBase=4+16*4;check(Math.abs(f[colorBase]-1)<1e-6&&Math.abs(f[colorBase+1]-.5)<1e-6,'first FX color packed in separate fx1 array');check(u[u.length-4]===0&&u[u.length-3]===16,'procedural mode/effect count stored as u32 at aligned tail');check(T.SPRITE_WGSL.includes('textureSample')&&T.PROCEDURAL_WGSL.includes('MAX_FX:u32=16u'),'production WGSL covers atlas sampling and bounded procedural FX');
console.log(`SM-206 transparent FX model PASS: ${checks.length} checks`);
