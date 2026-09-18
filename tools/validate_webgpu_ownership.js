'use strict';
const assert=require('assert');
const P=require('../engine/pseudo_depth.js');
const G=require('../engine/webgpu_gbuffer.js');
const O=require('../engine/webgpu_ownership.js');

assert.equal(O.SCHEMA,'steelmoth-webgpu-ownership/v1');
assert(O.MATERIAL_WGSL.includes('@builtin(frag_depth)'));
assert(O.MATERIAL_WGSL.includes('smOwnershipDepth'));
assert(O.MATERIAL_WGSL.includes(`SM_MAX_WORLD_Z:f32=${P.MAX_WORLD_Z.toFixed(1)}`));
assert(O.MATERIAL_WGSL.includes(`SM_LAYER_STRIDE:f32=${P.LAYER_STRIDE.toFixed(1)}`));
assert(O.DEBUG_MODES.includes('object-id'));
assert(O.DEBUG_MODES.includes('depth'));

const base={id:'bin-front',objectId:G.objectIdForStableId('bin-front'),category:'dynamic',sequence:0,rootY:181,spriteId:'face',x:20,y:20,w:16,h:16,rotation:0,flip:false,uv:[0,0,1,1],tint:[1,1,1],alpha:1,heightFactor:1,tintStrength:.07,materialMode:'normal',materialModeValue:G.MATERIAL_MODE.normal};
const prepared=O.prepareOwnershipInstance(base);
assert.equal(prepared.depthLayer,P.CATEGORY_LAYER.dynamic);
assert.equal(prepared.depthBias,0);
const fg=O.prepareOwnershipInstance({...base,category:'foreground'});
assert.equal(fg.depthLayer,P.CATEGORY_LAYER.foreground);
const explicit=O.prepareOwnershipInstance({...base,depthLayer:7,depthBias:.25});
assert.equal(explicit.depthLayer,7);assert.equal(explicit.depthBias,.25);

const packed=O.packOwnershipInstances([prepared,explicit]);
assert.equal(packed.byteLength,G.INSTANCE_STRIDE*2);
const dv=new DataView(packed.buffer,packed.byteOffset,packed.byteLength);
assert.equal(dv.getFloat32(72,true),P.CATEGORY_LAYER.dynamic);
assert(Math.abs(dv.getFloat32(76,true))<1e-8);
assert.equal(dv.getFloat32(G.INSTANCE_STRIDE+72,true),7);
assert(Math.abs(dv.getFloat32(G.INSTANCE_STRIDE+76,true)-.25)<1e-6);

const atlas={source_size:[4,4],world_scale:1,region_meta:{face:{world_scale:1}},regions:{face:[0,0,2,2]}};
const material={id:'material:face:normal',overrides:{mode:'normal'}};
const sprite=(id,category,depthLayer=null,depthBias=0)=>({id,category,atlas:'hd',spriteId:'face',materialId:material.id,root:{x:20,y:30},transform:{x:20,y:22,w:16,h:16,rotation:0,flip:false},style:{tint:[1,1,1],alpha:1,glow:false,materialMode:'normal'},depthLayer,depthBias});
const scene={materials:[material],sprites:[sprite('static','static'),sprite('dynamic','dynamic'),sprite('foreground','foreground'),sprite('biased','dynamic',null,.5)]};
const instances=O.buildOwnershipSceneInstances(scene,atlas);
const byId=new Map(instances.map(x=>[x.id,x]));
assert.equal(byId.get('static').depthLayer,0);
assert.equal(byId.get('dynamic').depthLayer,0);
assert.equal(byId.get('foreground').depthLayer,1);
assert.equal(byId.get('biased').depthBias,.5);

const root=P.projectFragment({fragmentScreenY:181,rootY:181,localHeight:0,alpha:1,category:'dynamic'});
const upper=P.projectFragment({fragmentScreenY:161,rootY:181,localHeight:20/64,alpha:1,category:'dynamic'});
assert(Math.abs(root.depth01-upper.depth01)<1e-9,'vertical face projection must cancel screen Y against world Z');
const gpuRef=O.referenceDepthForPixel(161,20/64,'dynamic');
assert(Math.abs(gpuRef.depth01-upper.depth01)<1e-9);
const foreground=O.referenceDepthForPixel(40,0,'foreground');
const ordinary=O.referenceDepthForPixel(400,0,'dynamic');
assert(foreground.depth01<ordinary.depth01,'foreground lane must remain nearer despite screen Y');

for(const dy of [-1,-.5,-.25,0,.25,.5,1]){
  const front=O.referenceDepthForPixel(140+dy,20/64,'dynamic');
  const rear=O.referenceDepthForPixel(140,12/64,'dynamic');
  assert(front.depth01<rear.depth01,`front ownership should remain stable under ${dy}px perturbation`);
}

console.log(JSON.stringify({ok:true,schema:O.SCHEMA,instanceStride:G.INSTANCE_STRIDE,debugModes:O.DEBUG_MODES,pseudoDepth:P.diagnostics()},null,2));
