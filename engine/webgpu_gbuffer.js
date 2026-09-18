'use strict';

(function(root,factory){
  const Resources=root?.SteelMothWebGPUResources||((typeof module==='object'&&module.exports)?require('./webgpu_resources.js'):null);
  const api=factory(Resources,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUGBuffer=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,root){
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before webgpu_gbuffer');

  const SCHEMA='steelmoth-webgpu-gbuffer/v1';
  const INSTANCE_STRIDE=80;
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,COPY_DST:0x02,TEXTURE_BINDING:0x04,RENDER_ATTACHMENT:0x10});
  const MAP_MODE_READ=0x0001;
  const FORMATS=Object.freeze({g0:'rgba8unorm',g1:'rgba16float',g2:'rgba16float',objectId:'r32uint',depth:'depth32float'});
  const CLEAR=Object.freeze({g0:[0,0,0,0],g1:[.5,.5,1,.88],g2:[0,0,1,0],objectId:[0,0,0,0],depth:1});
  const CATEGORY_ORDER=Object.freeze({static:0,ground:1,dynamic:2,foreground:3,top:4});
  const MATERIAL_MODE=Object.freeze({normal:0,flat:1,tint:2});
  const DEBUG_MODES=Object.freeze(['albedo','normals','roughness','height','metalness','ao','emissive','object-id']);
  const usageValue=(group,name,fallback)=>Number(root?.[group]?.[name]??fallback);
  const textureUsage=names=>names.reduce((v,n)=>v|usageValue('GPUTextureUsage',n,FALLBACK_TEXTURE_USAGE[n]||0),0);
  const bufferUsage=names=>names.reduce((v,n)=>v|usageValue('GPUBufferUsage',n,FALLBACK_BUFFER_USAGE[n]||0),0);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const align=(v,m=256)=>Math.ceil(Math.max(0,Number(v)||0)/m)*m;

  function objectIdForStableId(value){
    const s=String(value??'');let h=2166136261>>>0;
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0}
    return h===0?1:h;
  }
  function regionRect(atlas,regionId,subrect=null){
    const r=atlas?.regions?.[regionId];if(!Array.isArray(r)||r.length<4)throw new Error(`atlas region missing: ${regionId}`);
    let [x,y,w,h]=r.map(Number);
    if(subrect){x+=finite(subrect.sx,0);y+=finite(subrect.sy,0);w=Math.max(1,finite(subrect.sw,w));h=Math.max(1,finite(subrect.sh,h))}
    const aw=Math.max(1,finite(atlas.source_size?.[0],4096)),ah=Math.max(1,finite(atlas.source_size?.[1],4096));
    const u0=(x+.5)/aw,v0=(y+.5)/ah,u1=(x+w-.5)/aw,v1=(y+h-.5)/ah;
    return {x,y,w,h,u0,v0,u1,v1,atlasWidth:aw,atlasHeight:ah};
  }
  function compatibilityHeightFactor(atlas,spriteId,renderedHeight,subrect=null){
    const r=atlas?.regions?.[spriteId];if(!Array.isArray(r)||r.length<4)return 1;
    const meta=atlas?.region_meta?.[spriteId]||{},srcH=Math.max(1,finite(subrect?.sh,r[3])),scaleY=finite(renderedHeight,r[3])/srcH,fullH=r[3]*scaleY,worldScale=Math.max(.0001,finite(atlas?.world_scale,.18)*finite(meta.world_scale,1)),base=Math.max(.001,r[3]*worldScale);
    return clamp(fullH/base,.18,4.5);
  }
  function materialModeValue(mode){return MATERIAL_MODE[mode]??MATERIAL_MODE.normal}
  function defaultTintStrength(mode){return mode==='flat'?.18:mode==='tint'?1:.07}
  function buildSceneInstances(scene,atlas,options={}){
    const materials=new Map((scene?.materials||[]).map(m=>[m.id,m]));const allowed=new Set(options.categories||['static','dynamic','foreground']);const out=[];
    let seq=0;
    for(const sprite of scene?.sprites||[]){
      const style=sprite?.style||{};
      if(sprite?.atlas!=='hd'||style.glow||finite(style.alpha,1)<.5||!allowed.has(sprite?.category))continue;
      const region=regionRect(atlas,sprite.spriteId,sprite.subrect),material=materials.get(sprite.materialId)||{},t=sprite.transform||{},w=t.w==null?region.w:finite(t.w,region.w),h=t.h==null?region.h:finite(t.h,region.h),mode=String(style.materialMode||material.overrides?.mode||'normal'),rootY=finite(sprite.root?.y,t.y==null?0:t.y);
      out.push({id:String(sprite.id),objectId:objectIdForStableId(sprite.id),category:String(sprite.category),sequence:seq++,rootY,spriteId:String(sprite.spriteId),x:finite(t.x,0),y:finite(t.y,0),w,h,rotation:finite(t.rotation,0),flip:!!t.flip,uv:[region.u0,region.v0,region.u1,region.v1],tint:Array.isArray(style.tint)?style.tint.slice(0,3).map(v=>finite(v,1)):[1,1,1],alpha:finite(style.alpha,1),heightFactor:compatibilityHeightFactor(atlas,sprite.spriteId,h,sprite.subrect),tintStrength:style.tintStrength==null?defaultTintStrength(mode):finite(style.tintStrength,defaultTintStrength(mode)),materialMode:mode,materialModeValue:materialModeValue(mode)});
    }
    out.sort((a,b)=>{const ca=CATEGORY_ORDER[a.category]??2,cb=CATEGORY_ORDER[b.category]??2;if(ca!==cb)return ca-cb;if(a.category==='dynamic'||a.category==='foreground')return a.rootY-b.rootY||a.sequence-b.sequence;return a.sequence-b.sequence});return out;
  }
  function packInstances(instances){
    const buffer=new ArrayBuffer(Math.max(INSTANCE_STRIDE,instances.length*INSTANCE_STRIDE)),dv=new DataView(buffer);
    for(let i=0;i<instances.length;i++){
      const s=instances[i],o=i*INSTANCE_STRIDE,t=s.tint||[1,1,1],uv=s.uv||[0,0,1,1];
      const f=(offset,value)=>dv.setFloat32(o+offset,finite(value,0),true),u=(offset,value)=>dv.setUint32(o+offset,Number(value)>>>0,true);
      [s.x,s.y,s.w,s.h].forEach((v,j)=>f(j*4,v));uv.forEach((v,j)=>f(16+j*4,v));[t[0]??1,t[1]??1,t[2]??1,s.alpha??1].forEach((v,j)=>f(32+j*4,v));
      f(48,s.rotation);f(52,s.heightFactor??1);f(56,s.tintStrength??defaultTintStrength(s.materialMode));f(60,s.materialModeValue??materialModeValue(s.materialMode));u(64,s.objectId||objectIdForStableId(s.id));u(68,s.flip?1:0);u(72,CATEGORY_ORDER[s.category]??2);u(76,0);
    }
    return new Uint8Array(buffer,0,Math.max(INSTANCE_STRIDE,instances.length*INSTANCE_STRIDE));
  }
  function halfToFloat(h){
    h=Number(h)&0xffff;const s=(h>>15)&1,e=(h>>10)&31,f=h&1023;if(e===0)return (s?-1:1)*Math.pow(2,-14)*(f/1024);if(e===31)return f?NaN:(s?-Infinity:Infinity);return (s?-1:1)*Math.pow(2,e-15)*(1+f/1024);
  }

  const MATERIAL_WGSL=`
struct Instance { rect:vec4f, uv:vec4f, tintAlpha:vec4f, material:vec4f, ids:vec4u };
struct Frame { logicalAtlas:vec4f, alphaCutoff:f32, _pad0:vec3f };
@group(0) @binding(0) var nearestSampler:sampler;
@group(0) @binding(1) var albedoTex:texture_2d<f32>;
@group(0) @binding(2) var nrTex:texture_2d<f32>;
@group(0) @binding(3) var hmTex:texture_2d<f32>;
@group(0) @binding(4) var<storage,read> instances:array<Instance>;
@group(0) @binding(5) var<uniform> frame:Frame;
struct VSOut {
  @builtin(position) position:vec4f,
  @location(0) uv:vec2f,
  @location(1) tintAlpha:vec4f,
  @location(2) @interpolate(flat) material:vec4f,
  @location(3) @interpolate(flat) objectId:u32,
  @location(4) @interpolate(flat) flags:u32,
};
@vertex fn vs_main(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->VSOut{
  let corners=array<vec2f,6>(vec2f(-.5,-.5),vec2f(.5,-.5),vec2f(-.5,.5),vec2f(-.5,.5),vec2f(.5,-.5),vec2f(.5,.5));
  let uvs=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  let inst=instances[ii];let c=corners[vi];let co=cos(inst.material.x);let si=sin(inst.material.x);var p=vec2f(c.x*inst.rect.z,c.y*inst.rect.w);p=vec2f(p.x*co-p.y*si,p.x*si+p.y*co)+inst.rect.xy;
  var q=uvs[vi];if((inst.ids.y&1u)!=0u){q.x=1.0-q.x;}var out:VSOut;out.position=vec4f(p.x/frame.logicalAtlas.x*2.0-1.0,1.0-p.y/frame.logicalAtlas.y*2.0,0.0,1.0);out.uv=mix(inst.uv.xy,inst.uv.zw,q);out.tintAlpha=inst.tintAlpha;out.material=inst.material;out.objectId=inst.ids.x;out.flags=inst.ids.y;return out;
}
struct FSOut { @location(0) g0:vec4f,@location(1) g1:vec4f,@location(2) g2:vec4f,@location(3) objectId:u32 };
@fragment fn fs_main(in:VSOut)->FSOut{
  let t=textureSample(albedoTex,nearestSampler,in.uv);if(t.a<frame.alphaCutoff){discard;}
  let nr=textureSample(nrTex,nearestSampler,in.uv);let hm=textureSample(hmTex,nearestSampler,in.uv);var n=normalize(nr.xyz*2.0-1.0);if((in.flags&1u)!=0u){n.x=-n.x;}let co=cos(in.material.x);let si=sin(in.material.x);n=normalize(vec3f(n.x*co-n.y*si,n.x*si+n.y*co,n.z));
  let mode=in.material.w;var base:vec3f;if(mode<.5){base=mix(t.rgb,t.rgb*in.tintAlpha.rgb,.07);}else if(mode<1.5){base=mix(t.rgb,in.tintAlpha.rgb,clamp(in.material.z,0.0,1.0));}else{let lum=dot(t.rgb,vec3f(.26,.62,.12));base=in.tintAlpha.rgb*(.28+lum*.98)+pow(max(t.rgb,vec3f(0)),vec3f(2.4))*.12;}
  var out:FSOut;out.g0=vec4f(base,1.0);out.g1=vec4f(n*.5+.5,nr.a);out.g2=vec4f(clamp(hm.r*in.material.y,0.0,1.0),hm.b,hm.g,hm.a);out.objectId=in.objectId;return out;
}`;

  const DEBUG_WGSL=`
struct Debug { mode:u32,_pad0:vec3u };
@group(0) @binding(0) var g0:texture_2d<f32>;@group(0) @binding(1) var g1:texture_2d<f32>;@group(0) @binding(2) var g2:texture_2d<f32>;@group(0) @binding(3) var oid:texture_2d<u32>;@group(0) @binding(4) var<uniform> debug:Debug;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[vi],0,1);}
@fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) vec4f{let q=vec2i(p.xy);let a=textureLoad(g0,q,0);let n=textureLoad(g1,q,0);let m=textureLoad(g2,q,0);let id=textureLoad(oid,q,0).x;if(debug.mode==0u){return vec4f(a.rgb,1);}if(debug.mode==1u){return vec4f(n.xyz,1);}if(debug.mode==2u){return vec4f(vec3f(n.a),1);}if(debug.mode==3u){return vec4f(vec3f(m.r),1);}if(debug.mode==4u){return vec4f(vec3f(m.g),1);}if(debug.mode==5u){return vec4f(vec3f(m.b),1);}if(debug.mode==6u){return vec4f(vec3f(m.a),1);}let h=f32((id^(id>>8u)^(id>>16u))&255u)/255.0;return vec4f(h,fract(h*5.17),fract(h*11.31),1);}`;

  class WebGPUMaterialGBuffer{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUMaterialGBuffer requires GPUDevice');this.device=options.device;this.queue=options.queue||options.device.queue;this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));this.alphaCutoff=clamp(finite(options.alphaCutoff,.12),0,1);this.maxInstances=Math.max(1,Math.round(options.maxInstances||4096));this.labelPrefix=String(options.labelPrefix||'SteelMothGBuffer');this.ownsRegistry=!options.registry;this.registry=options.registry||new Resources.ResourceRegistry({device:this.device,queue:this.queue,width:this.width,height:this.height,labelPrefix:this.labelPrefix});this.pipelines=options.pipelines||new Resources.PipelineCache(this.device,{labelPrefix:`${this.labelPrefix}:pipeline`});this.atlas=null;this.atlasMeta=null;this.sampler=null;this.materialModule=null;this.debugModule=null;this.materialPipeline=null;this.debugPipelines=new Map();this.bindGroup=null;this.compilation=[];this.renderCount=0;this.lastInstanceCount=0;this._defineResources();
    }
    _name(n){return `sm200:${n}`}
    _defineResources(){const rt=textureUsage(['RENDER_ATTACHMENT','TEXTURE_BINDING','COPY_SRC']);this.registry.defineTexture(this._name('g0'),{format:FORMATS.g0,usage:rt,size:'surface'});this.registry.defineTexture(this._name('g1'),{format:FORMATS.g1,usage:rt,size:'surface'});this.registry.defineTexture(this._name('g2'),{format:FORMATS.g2,usage:rt,size:'surface'});this.registry.defineTexture(this._name('object'),{format:FORMATS.objectId,usage:rt,size:'surface'});this.registry.defineTexture(this._name('depth'),{format:FORMATS.depth,usage:textureUsage(['RENDER_ATTACHMENT','TEXTURE_BINDING','COPY_SRC']),size:'surface'});this.registry.defineBuffer(this._name('instances'),{size:align(this.maxInstances*INSTANCE_STRIDE,256),usage:bufferUsage(['STORAGE','COPY_DST'])});this.registry.defineBuffer(this._name('frame'),{size:256,usage:bufferUsage(['UNIFORM','COPY_DST'])});this.registry.defineBuffer(this._name('debug'),{size:256,usage:bufferUsage(['UNIFORM','COPY_DST'])});}
    _record(n){return this.registry.require(this._name(n))}
    _views(){return {g0:this._record('g0').handle.createView(),g1:this._record('g1').handle.createView(),g2:this._record('g2').handle.createView(),objectId:this._record('object').handle.createView(),depth:this._record('depth').handle.createView()}}
    async _module(label,code){const module=this.device.createShaderModule({label:`${this.labelPrefix}:${label}`,code});let messages=[];if(typeof module.getCompilationInfo==='function')messages=Array.from((await module.getCompilationInfo()).messages||[]).map(m=>({type:m.type,message:m.message,lineNum:m.lineNum,linePos:m.linePos}));const errors=messages.filter(m=>m.type==='error');this.compilation.push({label,messages});if(errors.length)throw new Error(`${label} WGSL compilation failed: ${errors.map(e=>e.message).join(' | ')}`);return module}
    async initialize(){if(this.materialPipeline)return this;this.materialModule=await this._module('material-gbuffer',MATERIAL_WGSL);this.debugModule=await this._module('debug-gbuffer',DEBUG_WGSL);this.materialPipeline=await this.pipelines.getRender('sm200-material',()=>this.device.createRenderPipeline({label:`${this.labelPrefix}:material`,layout:'auto',vertex:{module:this.materialModule,entryPoint:'vs_main'},fragment:{module:this.materialModule,entryPoint:'fs_main',targets:[{format:FORMATS.g0},{format:FORMATS.g1},{format:FORMATS.g2},{format:FORMATS.objectId}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:FORMATS.depth,depthWriteEnabled:false,depthCompare:'always'}}));return this}
    _destroyAtlases(){for(const v of Object.values(this.atlas||{})){try{v?.destroy?.()}catch(_e){}}this.atlas=null;this.bindGroup=null}
    async setAtlases({albedo,normalRoughness,heightMaterial,meta}){await this.initialize();if(!albedo||!normalRoughness||!heightMaterial)throw new Error('setAtlases requires albedo, normalRoughness and heightMaterial image sources');this._destroyAtlases();const width=Number(albedo.width||albedo.videoWidth),height=Number(albedo.height||albedo.videoHeight);if(!width||!height)throw new Error('invalid albedo atlas dimensions');for(const src of [normalRoughness,heightMaterial])if(Number(src.width||src.videoWidth)!==width||Number(src.height||src.videoHeight)!==height)throw new Error('Material-v2 atlases must be coordinate-identical');const usage=textureUsage(['COPY_DST','TEXTURE_BINDING','RENDER_ATTACHMENT']),make=(name,src)=>{const tex=this.device.createTexture({label:`${this.labelPrefix}:${name}`,size:{width,height,depthOrArrayLayers:1},format:'rgba8unorm',usage});this.queue.copyExternalImageToTexture({source:src},{texture:tex},{width,height,depthOrArrayLayers:1});return tex};this.atlas={albedo:make('albedo',albedo),normalRoughness:make('normal-roughness',normalRoughness),heightMaterial:make('height-material',heightMaterial),width,height};this.atlasMeta=meta||{source_size:[width,height],regions:{}};this.sampler=this.device.createSampler({label:`${this.labelPrefix}:nearest`,magFilter:'nearest',minFilter:'nearest',mipmapFilter:'nearest',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});this._refreshBindGroup();if(typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();return this}
    _refreshBindGroup(){if(!this.materialPipeline||!this.atlas)return;this.bindGroup=this.device.createBindGroup({label:`${this.labelPrefix}:material-bind`,layout:this.materialPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:this.atlas.albedo.createView()},{binding:2,resource:this.atlas.normalRoughness.createView()},{binding:3,resource:this.atlas.heightMaterial.createView()},{binding:4,resource:{buffer:this._record('instances').handle}},{binding:5,resource:{buffer:this._record('frame').handle}}]})}
    resize(width,height){width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));const changed=this.registry.resize(width,height);this.width=width;this.height=height;return changed}
    async renderInstances(instances,options={}){await this.initialize();if(!this.atlas)throw new Error('Material-v2 atlases are not configured');instances=Array.from(instances||[]);if(instances.length>this.maxInstances)throw new RangeError(`G-buffer instance count ${instances.length} exceeds ${this.maxInstances}`);const packed=packInstances(instances),frame=new Float32Array(8);frame[0]=this.width;frame[1]=this.height;frame[2]=this.atlas.width;frame[3]=this.atlas.height;frame[4]=this.alphaCutoff;this.queue.writeBuffer(this._record('instances').handle,0,packed);this.queue.writeBuffer(this._record('frame').handle,0,frame);const v=this._views(),encoder=this.device.createCommandEncoder({label:`${this.labelPrefix}:frame`}),pass=encoder.beginRenderPass({label:`${this.labelPrefix}:gbuffer-pass`,colorAttachments:[{view:v.g0,clearValue:CLEAR.g0,loadOp:'clear',storeOp:'store'},{view:v.g1,clearValue:CLEAR.g1,loadOp:'clear',storeOp:'store'},{view:v.g2,clearValue:CLEAR.g2,loadOp:'clear',storeOp:'store'},{view:v.objectId,clearValue:CLEAR.objectId,loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:v.depth,depthClearValue:CLEAR.depth,depthLoadOp:'clear',depthStoreOp:'store'}});pass.setPipeline(this.materialPipeline);pass.setBindGroup(0,this.bindGroup);
      if(instances.length){let start=0;while(start<instances.length){const order=CATEGORY_ORDER[instances[start].category]??2;let end=start+1;while(end<instances.length&&(CATEGORY_ORDER[instances[end].category]??2)===order)end++;pass.draw(6,end-start,0,start);start=end;}}
      pass.end();this.queue.submit([encoder.finish()]);if(options.wait!==false&&typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();this.renderCount++;this.lastInstanceCount=instances.length;return {schema:SCHEMA,instanceCount:instances.length,drawBatches:new Set(instances.map(s=>CATEGORY_ORDER[s.category]??2)).size};}
    async renderScene(scene,atlasMeta=this.atlasMeta,options={}){return this.renderInstances(buildSceneInstances(scene,atlasMeta,options),options)}
    async _debugPipeline(targetFormat){const key=String(targetFormat);if(this.debugPipelines.has(key))return this.debugPipelines.get(key);const p=await this.pipelines.getRender(`sm200-debug:${key}`,()=>this.device.createRenderPipeline({label:`${this.labelPrefix}:debug:${key}`,layout:'auto',vertex:{module:this.debugModule,entryPoint:'vs_main'},fragment:{module:this.debugModule,entryPoint:'fs_main',targets:[{format:key}]},primitive:{topology:'triangle-list'}}));this.debugPipelines.set(key,p);return p}
    async renderDebug(targetTexture,mode='albedo',targetFormat='rgba8unorm'){const index=DEBUG_MODES.indexOf(mode);if(index<0)throw new Error(`unknown G-buffer debug mode: ${mode}`);const pipeline=await this._debugPipeline(targetFormat),data=new Uint32Array(4);data[0]=index;this.queue.writeBuffer(this._record('debug').handle,0,data);const v=this._views(),bind=this.device.createBindGroup({label:`${this.labelPrefix}:debug-bind`,layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:v.g0},{binding:1,resource:v.g1},{binding:2,resource:v.g2},{binding:3,resource:v.objectId},{binding:4,resource:{buffer:this._record('debug').handle}}]}),encoder=this.device.createCommandEncoder({label:`${this.labelPrefix}:debug-encoder`}),pass=encoder.beginRenderPass({colorAttachments:[{view:targetTexture.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();this.queue.submit([encoder.finish()]);if(typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();return {mode,targetFormat};}
    async _readTexturePixel(record,x,y,kind){const bytesPerPixel=kind==='rgba16float'?8:4,buffer=this.device.createBuffer({label:`${this.labelPrefix}:readback:${kind}`,size:256,usage:bufferUsage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:record.handle,origin:{x:Math.max(0,Math.min(record.width-1,Math.floor(x))),y:Math.max(0,Math.min(record.height-1,Math.floor(y))),z:0}},{buffer,bytesPerRow:256,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);await buffer.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(buffer.getMappedRange()).slice(0,bytesPerPixel);buffer.unmap();buffer.destroy();if(kind==='rgba8')return Array.from(raw);if(kind==='r32uint')return new DataView(raw.buffer,raw.byteOffset,4).getUint32(0,true);const dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);return [0,2,4,6].map(o=>halfToFloat(dv.getUint16(o,true)))}
    async readPixel(x,y){return {g0:await this._readTexturePixel(this._record('g0'),x,y,'rgba8'),g1:await this._readTexturePixel(this._record('g1'),x,y,'rgba16float'),g2:await this._readTexturePixel(this._record('g2'),x,y,'rgba16float'),objectId:await this._readTexturePixel(this._record('object'),x,y,'r32uint')};}
    diagnostics(){return {schema:SCHEMA,formats:{...FORMATS},clear:clone(CLEAR),extent:{width:this.width,height:this.height},alphaCutoff:this.alphaCutoff,maxInstances:this.maxInstances,renderCount:this.renderCount,lastInstanceCount:this.lastInstanceCount,atlas:this.atlas?{width:this.atlas.width,height:this.atlas.height}:null,compilation:clone(this.compilation),debugModes:[...DEBUG_MODES],resourceDiagnostics:this.registry.diagnostics(),pipelineDiagnostics:this.pipelines.diagnostics(),materialCompatibility:{alphaCutoff:.12,normalTintStrength:.07,flatDefaultTintStrength:.18,tintMode:'compatibility-luminance'},ownershipDepth:'not-implemented-sm201-sm202',depthAttachmentPolicy:'clear-only; depth compare always and writes disabled'};}
    close(){this._destroyAtlases();if(this.ownsRegistry)this.registry.close();this.debugPipelines.clear();}
  }

  return {SCHEMA,INSTANCE_STRIDE,FORMATS,CLEAR,CATEGORY_ORDER,MATERIAL_MODE,DEBUG_MODES,MATERIAL_WGSL,DEBUG_WGSL,objectIdForStableId,regionRect,compatibilityHeightFactor,buildSceneInstances,packInstances,halfToFloat,WebGPUMaterialGBuffer};
});