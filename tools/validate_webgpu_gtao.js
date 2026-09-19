'use strict';
const assert=require('assert');
const G=require('../engine/webgpu_gtao.js');

const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;
function scene(width,height,rects=[]){
  const depth=new Float32Array(width*height*2),normals=new Float32Array(width*height*4);
  for(let i=0;i<width*height;i++){depth[i*2]=.62;depth[i*2+1]=.62;normals[i*4]=.5;normals[i*4+1]=.5;normals[i*4+2]=1;normals[i*4+3]=.55;}
  for(const r of rects){for(let y=r.y0;y<r.y1;y++)for(let x=r.x0;x<r.x1;x++){if(x<0||y<0||x>=width||y>=height)continue;const i=y*width+x;depth[i*2]=r.depth??.36;depth[i*2+1]=r.depth??.36;if(r.normal){normals[i*4]=r.normal[0];normals[i*4+1]=r.normal[1];normals[i*4+2]=r.normal[2];}}}
  return{depth,normals,width,height};
}
function mean(values,indices=null){if(indices){let s=0;for(const i of indices)s+=values[i];return indices.length?s/indices.length:1;}let s=0;for(const v of values)s+=v;return values.length?s/values.length:1;}
function outsideBand(width,height,rect,band=3){const out=[];for(let y=Math.max(0,rect.y0-band);y<Math.min(height,rect.y1+band);y++)for(let x=Math.max(0,rect.x0-band);x<Math.min(width,rect.x1+band);x++){const inside=x>=rect.x0&&x<rect.x1&&y>=rect.y0&&y<rect.y1;if(!inside)out.push(y*width+x);}return out;}
function insideCore(width,rect,pad=3){const out=[];for(let y=rect.y0+pad;y<rect.y1-pad;y++)for(let x=rect.x0+pad;x<rect.x1-pad;x++)out.push(y*width+x);return out;}

assert.strictEqual(G.SCHEMA,'steelmoth-webgpu-gtao/v1');
assert.deepStrictEqual(G.DEBUG_MODES,['visibility','occlusion','raw-half','upsample-confidence']);
const bounded=G.normalizeOptions({directions:99,steps:0,radius:99,intensity:99,debugMode:'bad'});
assert.strictEqual(bounded.directions,8);assert.strictEqual(bounded.steps,2);assert.strictEqual(bounded.radius,24);assert.strictEqual(bounded.intensity,2);assert.strictEqual(bounded.debugMode,'visibility');
const rec=G.recommendedVisibilityOptions();assert.strictEqual(rec.gtao,true);assert(rec.materialAOStrength<=.5);assert.strictEqual(rec.gtaoStrength,1);

const plane=scene(64,40),planeResult=G.referenceGTAO(plane.depth,plane.normals,plane.width,plane.height),planeMetrics=G.fieldMetrics(planeResult.visibility);
assert(planeMetrics.min>.9999,'flat uniform plane must remain fully visible');
assert.strictEqual(planeMetrics.occludedPixels,0,'flat plane must not invent AO');

const box={x0:24,y0:10,x1:40,y1:31,depth:.34},boxScene=scene(64,40,[box]),boxResult=G.referenceGTAO(boxScene.depth,boxScene.normals,64,40),boxBand=outsideBand(64,40,box,4),boxCore=insideCore(64,box,4);
assert(mean(boxResult.visibility,boxBand)<.985,'adjacent floor must receive inter-surface grounding');
assert(mean(boxResult.visibility,boxCore)>.97,'depth-aware reconstruction must not smear floor AO through the nearer box core');
assert(G.fieldMetrics(boxResult.visibility).occludedPixels>20,'box fixture must produce bounded AO evidence');

const fixtures={
  box:[{x0:23,y0:9,x1:41,y1:31,depth:.35}],
  bin:[{x0:18,y0:12,x1:31,y1:32,depth:.37},{x0:30,y0:9,x1:45,y1:32,depth:.33}],
  cabinet:[{x0:20,y0:7,x1:44,y1:34,depth:.36},{x0:26,y0:12,x1:38,y1:29,depth:.31}],
  dense:[{x0:8,y0:11,x1:21,y1:32,depth:.39},{x0:19,y0:7,x1:34,y1:31,depth:.34},{x0:33,y0:10,x1:47,y1:34,depth:.30},{x0:46,y0:6,x1:58,y1:29,depth:.36}],
};
const evidence={};
for(const [name,rects] of Object.entries(fixtures)){const s=scene(64,40,rects),r=G.referenceGTAO(s.depth,s.normals,64,40),m=G.fieldMetrics(r.visibility);assert(m.min>=.149&&m.min<.995,`${name} GTAO must be bounded but active`);assert(m.occludedPixels>12,`${name} must contain grounded/crease pixels`);evidence[name]=m;}
assert(evidence.dense.mean<evidence.box.mean,'dense intersections should create more world AO than the single box control');

const disabled=G.referenceGTAO(boxScene.depth,boxScene.normals,64,40,{enabled:false});assert(Array.from(disabled.visibility).every(v=>near(v,1)),'disabling GTAO must restore neutral visibility exactly');
const alteredNormals=scene(64,40,[{...box,normal:[.8,.5,.9]}]),altered=G.referenceGTAO(alteredNormals.depth,alteredNormals.normals,64,40);assert(mean(altered.visibility,boxBand)>.1,'normal-aware sampling remains bounded');

const bytes=G.parameterBytes(65,41,{directions:7,steps:5,debugMode:'occlusion'}),u=new Uint32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);assert.deepStrictEqual(Array.from(u.slice(0,8)),[65,41,33,21,1,7,5,1]);
console.log(JSON.stringify({schema:'steelmoth-sm600-deterministic-report/v1',ok:true,plane:planeMetrics,box:{metrics:G.fieldMetrics(boxResult.visibility),bandMean:mean(boxResult.visibility,boxBand),coreMean:mean(boxResult.visibility,boxCore)},fixtures:evidence,materialAOPolicy:G.MATERIAL_AO_POLICY,halfResolution:[boxResult.raw.width,boxResult.raw.height]},null,2));
