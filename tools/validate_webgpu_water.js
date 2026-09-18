'use strict';
const assert=require('assert');
const Lighting=require('../engine/webgpu_lighting.js');
const W=require('../engine/webgpu_water.js');

assert.strictEqual(W.SCHEMA,'steelmoth-webgpu-water/v1');
assert.strictEqual(W.SNAPSHOT_SCHEMA,'steelmoth-webgpu-water-snapshot/v1');
assert.strictEqual(W.MAX_RIPPLES,12);
assert.strictEqual(W.OUTPUT_FORMAT,'rgba16float');
assert(W.DEBUG_MODES.includes('depth')&&W.DEBUG_MODES.includes('refraction'));

const mask=new Uint8Array(25);for(let y=1;y<4;y++)for(let x=1;x<4;x++)mask[y*5+x]=1;
const field=W.buildShoreField(mask,5,5,4);assert.strictEqual(field.rgba.length,100);assert.strictEqual(field.rgba[(2*5+2)*4],255);assert.strictEqual(field.rgba[0],0);assert(field.rgba[(1*5+1)*4+1]<field.rgba[(2*5+2)*4+1],'shore distance must increase toward water interior');

const many=Array.from({length:20},(_,i)=>({x:i,y:i,age:.1,life:1,radius:20+i}));const bounded=W.normalizeRipples(many,12);assert.strictEqual(bounded.length,12);assert.strictEqual(bounded[0].x,8);assert.strictEqual(bounded[11].x,19);
const rp=W.packRipples(many,12);assert.strictEqual(rp.bytes.byteLength,W.MAX_RIPPLES*W.RIPPLE_STRIDE);

const scene={lights:[{id:'light:test:0',type:'point',group:'point',x:100,y:50,z:18,radius:180,intensity:1.25,color:[1,.8,.6]}]};
const lights=Lighting.buildCanonicalLights(scene,{lighting:true,emissive:1,lightRadius:1});assert.strictEqual(lights.length,1);const v=W.canonicalLightVector(lights[0],[80,60],4);const expected=[20,10,14],el=Math.hypot(...expected);for(let i=0;i<3;i++)assert(Math.abs(v[i]-expected[i]/el)<1e-12,'water canonical light vector must match SM-204 screen/pseudo-Z convention');
for(let deg=0;deg<360;deg+=45){const a=deg*Math.PI/180,l={position:[80+Math.cos(a)*40,60+Math.sin(a)*40,18]};const q=W.canonicalLightVector(l,[80,60],0),e=[Math.cos(a)*40,-Math.sin(a)*40,18],d=Math.hypot(...e);for(let i=0;i<3;i++)assert(Math.abs(q[i]-e[i]/d)<1e-12,`canonical direction mismatch at ${deg}`);}

const baseSample={mask:1,shoreDistance:.5,under:[0,0,0],refracted:[0,0,0],currentDepth:.5,refractedDepth:.5,directVisibility:1};
const dark=W.shadeWaterReference(baseSample,[],{waterQuality:2},[80,60],.5,[]);assert.deepStrictEqual(dark,[0,0,0,0],'water must not self-light when both scene and canonical lights are dark');
const lit=W.shadeWaterReference({...baseSample,under:[.04,.04,.04],refracted:[.04,.04,.04]},lights,{waterQuality:2},[80,60],.5,[]);assert(lit[3]>0&&lit.slice(0,3).some(x=>x>.04),'canonical light should produce a bounded lit water response');
const shadow=W.shadeWaterReference({...baseSample,under:[.04,.04,.04],refracted:[.04,.04,.04],directVisibility:0},lights,{waterQuality:2},[80,60],.5,[]);assert(shadow[0]<lit[0]||shadow[1]<lit[1]||shadow[2]<lit[2],'SM-307 direct visibility must suppress water direct/highlight response');
assert.strictEqual(W.depthAwareRefractionWeight(.5,.5,.04),1);assert(W.depthAwareRefractionWeight(.1,.9,.04)<1e-6,'depth discontinuity must reject cross-surface refraction');
const noRipple=W.spectrumGradient([80,60],.7,{waterQuality:3},[]),withRipple=W.spectrumGradient([80,60],.7,{waterQuality:3},[{x:80,y:60,normalizedAge:.35,radius:72,amplitude:1.2,foam:.8}]);assert(Math.abs(noRipple.gx-withRipple.gx)+Math.abs(noRipple.gy-withRipple.gy)>1e-6||Math.abs(noRipple.rippleFoam-withRipple.rippleFoam)>1e-6,'ripple interaction identity must survive the port');

const params=W.packParams(640,360,1.25,{waterQuality:4},3,5,'visibility');assert.strictEqual(params.byteLength,W.PARAM_BYTES);const u=new Uint32Array(params.buffer,params.byteOffset);assert.strictEqual(u[24],3);assert.strictEqual(u[25],5);assert.strictEqual(u[26],W.DEBUG_MODES.indexOf('visibility'));assert.strictEqual(u[27],4);

const proto=Object.create(W.WebGPUWaterPass.prototype);proto.width=64;proto.height=32;const sceneView={tag:'scene'},depthView={tag:'depth'},visibilityView={tag:'visibility'},lightBuffer={tag:'lights'};const fakeLighting={outputTexture(){return{createView(){return sceneView}}},registry:{require(name){assert.strictEqual(name,Lighting.LIGHT_BUFFER_NAME);return{handle:lightBuffer}}},activeLightCount:1,lastLights:lights,width:64,height:32};const fakeGBuffer={_views(){return{depth:depthView}}};const fakeVisibility={bindings(){return{visibility:visibilityView}}};const source=proto.sourceFromPaths(fakeLighting,fakeGBuffer,fakeVisibility);assert.strictEqual(source.sceneView,sceneView);assert.strictEqual(source.depthView,depthView);assert.strictEqual(source.visibilityView,visibilityView);assert.strictEqual(source.lightBuffer,lightBuffer);assert.strictEqual(source.lightCount,1);

console.log('SM-400 water deterministic tests: PASS',JSON.stringify({fieldBytes:field.rgba.length,ripples:bounded.length,dark,lit,shadow,depthReject:W.depthAwareRefractionWeight(.1,.9,.04),canonicalLightBuffer:Lighting.LIGHT_BUFFER_NAME,debugModes:W.DEBUG_MODES.length}));
