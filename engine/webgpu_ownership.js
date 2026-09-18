'use strict';

(function(root,factory){
  const G=root?.SteelMothWebGPUGBuffer||((typeof module==='object'&&module.exports)?require('./webgpu_gbuffer.js'):null);
  const PseudoDepth=root?.SteelMothPseudoDepth||((typeof module==='object'&&module.exports)?require('./pseudo_depth.js'):null);
  const api=factory(G,PseudoDepth,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUOwnership=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(G,PseudoDepth,root){
  if(!G)throw new Error('SteelMothWebGPUGBuffer is required before webgpu_ownership');
  if(!PseudoDepth)throw new Error('SteelMothPseudoDepth is required before webgpu_ownership');

  const SCHEMA='steelmoth-webgpu-ownership/v1';
  const DEBUG_MODES=Object.freeze([...G.DEBUG_MODES,'depth']);
  const MAP_MODE_READ=0x0001;
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const bufferUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);

  function prepareOwnershipInstance(instance={}){
    return {
      ...instance,
      depthLayer:PseudoDepth.layerFor(instance.category,instance.depthLayer),
      depthBias:finite(instance.depthBias,0)
    };
  }

  function buildOwnershipSceneInstances(scene,atlas,options={}){
    const sprites=new Map((scene?.sprites||[]).map(s=>[String(s.id),s]));
    return G.buildSceneInstances(scene,atlas,options).map(instance=>{
      const sprite=sprites.get(String(instance.id))||{};
      return prepareOwnershipInstance({...instance,depthLayer:sprite.depthLayer,depthBias:sprite.depthBias});
    });
  }

  function packOwnershipInstances(instances){
    const prepared=Array.from(instances||[]).map(prepareOwnershipInstance);
    const packed=G.packInstances(prepared),dv=new DataView(packed.buffer,packed.byteOffset,packed.byteLength);
    for(let i=0;i<prepared.length;i++){
      const o=i*G.INSTANCE_STRIDE;
      // SM-200 reserved ids.z/ids.w. Store the canonical SM-201 layer and fine
      // bias as f32 bit patterns; WGSL bitcasts them back without changing the
      // inherited 80-byte instance ABI.
      dv.setFloat32(o+72,prepared[i].depthLayer,true);
      dv.setFloat32(o+76,prepared[i].depthBias,true);
    }
    return packed;
  }

  const PSEUDO_DEPTH_WGSL=`
const SM_MAX_WORLD_Z:f32=${Number(PseudoDepth.MAX_WORLD_Z).toFixed(1)};
const SM_Z_TO_SCREEN_Y:f32=${Number(PseudoDepth.Z_TO_SCREEN_Y).toFixed(1)};
const SM_LAYER_STRIDE:f32=${Number(PseudoDepth.LAYER_STRIDE).toFixed(1)};
const SM_DEPTH_KEY_MIN:f32=${Number(PseudoDepth.DEPTH_KEY_MIN).toFixed(1)};
const SM_DEPTH_KEY_MAX:f32=${Number(PseudoDepth.DEPTH_KEY_MAX).toFixed(1)};
fn smOwnershipDepth(fragmentScreenY:f32,localHeight:f32,layer:f32,bias:f32)->f32{
  let worldZ=clamp(localHeight,0.0,1.0)*SM_MAX_WORLD_Z;
  let projectedGroundY=fragmentScreenY+worldZ*SM_Z_TO_SCREEN_Y;
  let visibilityKey=layer*SM_LAYER_STRIDE+projectedGroundY+bias;
  return clamp((SM_DEPTH_KEY_MAX-visibilityKey)/(SM_DEPTH_KEY_MAX-SM_DEPTH_KEY_MIN),0.0,1.0);
}`;

  const MATERIAL_WGSL=`
struct Instance { rect:vec4f, uv:vec4f, tintAlpha:vec4f, material:vec4f, ids:vec4u };
struct Frame { logicalAtlas:vec4f, alphaCutoff:f32, _pad0:vec3f };
@group(0) @binding(0) var nearestSampler:sampler;
@group(0) @binding(1) var albedoTex:texture_2d<f32>;
@group(0) @binding(2) var nrTex:texture_2d<f32>;
@group(0) @binding(3) var hmTex:texture_2d<f32>;
@group(0) @binding(4) var<storage,read> instances:array<Instance>;
@group(0) @binding(5) var<uniform> frame:Frame;
${PSEUDO_DEPTH_WGSL}
struct VSOut {
  @builtin(position) position:vec4f,
  @location(0) uv:vec2f,
  @location(1) tintAlpha:vec4f,
  @location(2) @interpolate(flat) material:vec4f,
  @location(3) @interpolate(flat) objectId:u32,
  @location(4) @interpolate(flat) flags:u32,
  @location(5) @interpolate(flat) depthMeta:vec2f,
};
@vertex fn vs_main(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->VSOut{
  let corners=array<vec2f,6>(vec2f(-.5,-.5),vec2f(.5,-.5),vec2f(-.5,.5),vec2f(-.5,.5),vec2f(.5,-.5),vec2f(.5,.5));
  let uvs=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  let inst=instances[ii];let c=corners[vi];let co=cos(inst.material.x);let si=sin(inst.material.x);var p=vec2f(c.x*inst.rect.z,c.y*inst.rect.w);p=vec2f(p.x*co-p.y*si,p.x*si+p.y*co)+inst.rect.xy;
  var q=uvs[vi];if((inst.ids.y&1u)!=0u){q.x=1.0-q.x;}
  var out:VSOut;out.position=vec4f(p.x/frame.logicalAtlas.x*2.0-1.0,1.0-p.y/frame.logicalAtlas.y*2.0,0.0,1.0);out.uv=mix(inst.uv.xy,inst.uv.zw,q);out.tintAlpha=inst.tintAlpha;out.material=inst.material;out.objectId=inst.ids.x;out.flags=inst.ids.y;out.depthMeta=vec2f(bitcast<f32>(inst.ids.z),bitcast<f32>(inst.ids.w));return out;
}
struct FSOut { @location(0) g0:vec4f,@location(1) g1:vec4f,@location(2) g2:vec4f,@location(3) objectId:u32,@builtin(frag_depth) depth:f32 };
@fragment fn fs_main(in:VSOut)->FSOut{
  let t=textureSample(albedoTex,nearestSampler,in.uv);if(t.a<frame.alphaCutoff){discard;}
  let nr=textureSample(nrTex,nearestSampler,in.uv);let hm=textureSample(hmTex,nearestSampler,in.uv);var n=normalize(nr.xyz*2.0-1.0);if((in.flags&1u)!=0u){n.x=-n.x;}let co=cos(in.material.x);let si=sin(in.material.x);n=normalize(vec3f(n.x*co-n.y*si,n.x*si+n.y*co,n.z));
  let mode=in.material.w;var base:vec3f;if(mode<.5){base=mix(t.rgb,t.rgb*in.tintAlpha.rgb,.07);}else if(mode<1.5){base=mix(t.rgb,in.tintAlpha.rgb,clamp(in.material.z,0.0,1.0));}else{let lum=dot(t.rgb,vec3f(.26,.62,.12));base=in.tintAlpha.rgb*(.28+lum*.98)+pow(max(t.rgb,vec3f(0)),vec3f(2.4))*.12;}
  let localHeight=clamp(hm.r*in.material.y,0.0,1.0);
  var out:FSOut;out.g0=vec4f(base,1.0);out.g1=vec4f(n*.5+.5,nr.a);out.g2=vec4f(localHeight,hm.b,hm.g,hm.a);out.objectId=in.objectId;out.depth=smOwnershipDepth(in.position.y,localHeight,in.depthMeta.x,in.depthMeta.y);return out;
}`;

  const DEBUG_WGSL=`
struct Debug { mode:u32,_pad0:vec3u };
@group(0) @binding(0) var g0:texture_2d<f32>;@group(0) @binding(1) var g1:texture_2d<f32>;@group(0) @binding(2) var g2:texture_2d<f32>;@group(0) @binding(3) var oid:texture_2d<u32>;@group(0) @binding(4) var depthTex:texture_depth_2d;@group(0) @binding(5) var<uniform> debug:Debug;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[vi],0,1);}
@fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) vec4f{let q=vec2i(p.xy);let a=textureLoad(g0,q,0);let n=textureLoad(g1,q,0);let m=textureLoad(g2,q,0);let id=textureLoad(oid,q,0).x;if(debug.mode==0u){return vec4f(a.rgb,1);}if(debug.mode==1u){return vec4f(n.xyz,1);}if(debug.mode==2u){return vec4f(vec3f(n.a),1);}if(debug.mode==3u){return vec4f(vec3f(m.r),1);}if(debug.mode==4u){return vec4f(vec3f(m.g),1);}if(debug.mode==5u){return vec4f(vec3f(m.b),1);}if(debug.mode==6u){return vec4f(vec3f(m.a),1);}if(debug.mode==7u){let h=f32((id^(id>>8u)^(id>>16u))&255u)/255.0;return vec4f(h,fract(h*5.17),fract(h*11.31),1);}let d=textureLoad(depthTex,q,0);return vec4f(vec3f(d),1);}`;

  // Depth-stencil copies are deliberately avoided for diagnostic readback. Chrome/
  // Dawn can expose implementation-specific depth-copy behaviour even for
  // depth32float. Reading the production depth texture through WGSL textureLoad()
  // validates the same shader-visible value downstream passes will actually consume.
  const DEPTH_READBACK_WGSL=`
struct Coord { xy:vec2u, _pad:vec2u };
struct Out { value:f32, _pad0:vec3f };
@group(0) @binding(0) var depthTex:texture_depth_2d;
@group(0) @binding(1) var<uniform> coord:Coord;
@group(0) @binding(2) var<storage,read_write> out:Out;
@compute @workgroup_size(1) fn cs_main(){out.value=textureLoad(depthTex,vec2i(coord.xy),0);}`;

  class WebGPUOwnershipGBuffer extends G.WebGPUMaterialGBuffer{
    constructor(options={}){super(options);this.ownershipRenderCount=0;this._ownershipInitialized=false;this.depthReadbackModule=null;this.depthReadbackPipeline=null;}
    async initialize(){
      if(this._ownershipInitialized&&this.materialPipeline)return this;
      this.materialModule=await this._module('sm202-material-ownership',MATERIAL_WGSL);this.debugModule=await this._module('sm202-debug-ownership',DEBUG_WGSL);
      this.materialPipeline=await this.pipelines.getRender('sm202-material-ownership',()=>this.device.createRenderPipeline({label:`${this.labelPrefix}:sm202-material`,layout:'auto',vertex:{module:this.materialModule,entryPoint:'vs_main'},fragment:{module:this.materialModule,entryPoint:'fs_main',targets:[{format:G.FORMATS.g0},{format:G.FORMATS.g1},{format:G.FORMATS.g2},{format:G.FORMATS.objectId}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:G.FORMATS.depth,depthWriteEnabled:true,depthCompare:'less'}}));
      this._ownershipInitialized=true;if(this.atlas)this._refreshBindGroup();return this;
    }
    async renderInstances(instances,options={}){
      await this.initialize();if(!this.atlas)throw new Error('Material-v2 atlases are not configured');instances=Array.from(instances||[]).map(prepareOwnershipInstance);if(instances.length>this.maxInstances)throw new RangeError(`G-buffer instance count ${instances.length} exceeds ${this.maxInstances}`);
      const packed=packOwnershipInstances(instances),frame=new Float32Array(8);frame[0]=this.width;frame[1]=this.height;frame[2]=this.atlas.width;frame[3]=this.atlas.height;frame[4]=this.alphaCutoff;this.queue.writeBuffer(this._record('instances').handle,0,packed);this.queue.writeBuffer(this._record('frame').handle,0,frame);
      const v=this._views(),encoder=this.device.createCommandEncoder({label:`${this.labelPrefix}:sm202-frame`}),pass=encoder.beginRenderPass({label:`${this.labelPrefix}:sm202-ownership-pass`,colorAttachments:[{view:v.g0,clearValue:G.CLEAR.g0,loadOp:'clear',storeOp:'store'},{view:v.g1,clearValue:G.CLEAR.g1,loadOp:'clear',storeOp:'store'},{view:v.g2,clearValue:G.CLEAR.g2,loadOp:'clear',storeOp:'store'},{view:v.objectId,clearValue:G.CLEAR.objectId,loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:v.depth,depthClearValue:G.CLEAR.depth,depthLoadOp:'clear',depthStoreOp:'store'}});pass.setPipeline(this.materialPipeline);pass.setBindGroup(0,this.bindGroup);
      if(instances.length){let start=0;while(start<instances.length){const order=G.CATEGORY_ORDER[instances[start].category]??2;let end=start+1;while(end<instances.length&&(G.CATEGORY_ORDER[instances[end].category]??2)===order)end++;pass.draw(6,end-start,0,start);start=end;}}
      pass.end();this.queue.submit([encoder.finish()]);if(options.wait!==false&&typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();this.renderCount++;this.ownershipRenderCount++;this.lastInstanceCount=instances.length;return{schema:SCHEMA,instanceCount:instances.length,drawBatches:new Set(instances.map(s=>G.CATEGORY_ORDER[s.category]??2)).size,depthWriteEnabled:true,depthCompare:'less'};
    }
    async renderScene(scene,atlasMeta=this.atlasMeta,options={}){return this.renderInstances(buildOwnershipSceneInstances(scene,atlasMeta,options),options)}
    async _debugPipeline(targetFormat){const key=String(targetFormat);if(this.debugPipelines.has(`sm202:${key}`))return this.debugPipelines.get(`sm202:${key}`);const p=await this.pipelines.getRender(`sm202-debug:${key}`,()=>this.device.createRenderPipeline({label:`${this.labelPrefix}:sm202-debug:${key}`,layout:'auto',vertex:{module:this.debugModule,entryPoint:'vs_main'},fragment:{module:this.debugModule,entryPoint:'fs_main',targets:[{format:key}]},primitive:{topology:'triangle-list'}}));this.debugPipelines.set(`sm202:${key}`,p);return p}
    async renderDebug(targetTexture,mode='albedo',targetFormat='rgba8unorm'){const index=DEBUG_MODES.indexOf(mode);if(index<0)throw new Error(`unknown ownership debug mode: ${mode}`);const pipeline=await this._debugPipeline(targetFormat),data=new Uint32Array(4);data[0]=index;this.queue.writeBuffer(this._record('debug').handle,0,data);const v=this._views(),bind=this.device.createBindGroup({label:`${this.labelPrefix}:sm202-debug-bind`,layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:v.g0},{binding:1,resource:v.g1},{binding:2,resource:v.g2},{binding:3,resource:v.objectId},{binding:4,resource:v.depth},{binding:5,resource:{buffer:this._record('debug').handle}}]}),encoder=this.device.createCommandEncoder({label:`${this.labelPrefix}:sm202-debug-encoder`}),pass=encoder.beginRenderPass({colorAttachments:[{view:targetTexture.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();this.queue.submit([encoder.finish()]);if(typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();return{mode,targetFormat};}
    async _depthReadbackPipeline(){if(this.depthReadbackPipeline)return this.depthReadbackPipeline;this.depthReadbackModule=await this._module('sm202-depth-readback',DEPTH_READBACK_WGSL);this.depthReadbackPipeline=await this.pipelines.getCompute('sm202-depth-readback',()=>this.device.createComputePipeline({label:`${this.labelPrefix}:sm202-depth-readback`,layout:'auto',compute:{module:this.depthReadbackModule,entryPoint:'cs_main'}}));return this.depthReadbackPipeline;}
    async _readDepthPixel(x,y){
      const record=this._record('depth'),pipeline=await this._depthReadbackPipeline(),px=Math.max(0,Math.min(record.width-1,Math.floor(x))),py=Math.max(0,Math.min(record.height-1,Math.floor(y)));
      const coord=this.device.createBuffer({label:`${this.labelPrefix}:sm202-depth-coord`,size:256,usage:bufferUsage(['UNIFORM','COPY_DST'])}),gpuOut=this.device.createBuffer({label:`${this.labelPrefix}:sm202-depth-probe`,size:256,usage:bufferUsage(['STORAGE','COPY_SRC'])}),map=this.device.createBuffer({label:`${this.labelPrefix}:sm202-depth-map`,size:256,usage:bufferUsage(['COPY_DST','MAP_READ'])});
      this.queue.writeBuffer(coord,0,new Uint32Array([px,py,0,0]));
      const bind=this.device.createBindGroup({label:`${this.labelPrefix}:sm202-depth-readback-bind`,layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:record.handle.createView()},{binding:1,resource:{buffer:coord}},{binding:2,resource:{buffer:gpuOut}}]}),encoder=this.device.createCommandEncoder({label:`${this.labelPrefix}:sm202-depth-readback-encoder`}),pass=encoder.beginComputePass({label:`${this.labelPrefix}:sm202-depth-readback-pass`});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(gpuOut,0,map,0,4);this.queue.submit([encoder.finish()]);
      await map.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(map.getMappedRange()).slice(0,4),value=new DataView(raw.buffer,raw.byteOffset,4).getFloat32(0,true);map.unmap();coord.destroy();gpuOut.destroy();map.destroy();return value;
    }
    async readPixel(x,y){const base=await super.readPixel(x,y);return{...base,depth:await this._readDepthPixel(x,y)};}
    diagnostics(){const base=super.diagnostics();return{...base,schema:SCHEMA,debugModes:[...DEBUG_MODES],ownershipDepth:'sm202-canonical-per-pixel',depthAttachmentPolicy:'depth32float; fragment depth writes enabled; compare less; transparent fragments discard before ownership',depthReadback:'compute-textureLoad-to-buffer',pseudoDepth:{schema:PseudoDepth.SCHEMA,maxWorldZ:PseudoDepth.MAX_WORLD_Z,zToScreenY:PseudoDepth.Z_TO_SCREEN_Y,layerStride:PseudoDepth.LAYER_STRIDE,depthKeyRange:[PseudoDepth.DEPTH_KEY_MIN,PseudoDepth.DEPTH_KEY_MAX],alphaCutoff:PseudoDepth.DEFAULT_ALPHA_CUTOFF},ownershipRenderCount:this.ownershipRenderCount};}
  }

  function referenceDepthForPixel(fragmentScreenY,localHeight,category='dynamic',depthLayer=null,depthBias=0){return PseudoDepth.projectFragment({fragmentScreenY,rootY:fragmentScreenY,localHeight,alpha:1,category,layer:depthLayer,bias:depthBias});}

  return{SCHEMA,DEBUG_MODES,PSEUDO_DEPTH_WGSL,MATERIAL_WGSL,DEBUG_WGSL,DEPTH_READBACK_WGSL,prepareOwnershipInstance,buildOwnershipSceneInstances,packOwnershipInstances,referenceDepthForPixel,WebGPUOwnershipGBuffer};
});
