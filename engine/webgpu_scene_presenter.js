'use strict';

(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUScenePresenter=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  const SCHEMA='steelmoth-webgpu-scene-presenter/v1';
  const WORLD_FORMAT='rgba16float';
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const usage=(kind,...names)=>names.reduce((v,n)=>v|Number(root?.[kind]?.[n]||0),0);
  const required=()=>({
    Scene:root?.SteelMothRenderScene,Pseudo:root?.SteelMothPseudoDepth,Ownership:root?.SteelMothWebGPUOwnership,
    Depth:root?.SteelMothWebGPUDepthHierarchy,Lighting:root?.SteelMothWebGPULighting,Shadows:root?.SteelMothWebGPULocalShadows,
    Transparent:root?.SteelMothWebGPUTransparentFX,Post:root?.SteelMothWebGPUPost,Occluders:root?.SteelMothWebGPUOccluders,
    Clusters:root?.SteelMothWebGPUClusters,Dominance:root?.SteelMothWebGPUDominance,DSO:root?.SteelMothWebGPUDSO,
    DSOHierarchy:root?.SteelMothWebGPUDSOHierarchy,Bloom:root?.SteelMothWebGPUDarkBloom,BloomTemporal:root?.SteelMothWebGPUDarkBloomTemporal,
    Visibility:root?.SteelMothWebGPUVisibility,Water:root?.SteelMothWebGPUWater,Foliage:root?.SteelMothWebGPUFoliage,
    Ordering:root?.SteelMothWebGPUOrdering,Quality:root?.SteelMothWebGPUQuality
  });

  function scaleScene(scene,width,height,pseudo=null,lighting=null){
    const out=clone(scene),logical=scene?.frame?.logicalSize||[640,360],sx=width/Math.max(1,finite(logical[0],640)),sy=height/Math.max(1,finite(logical[1],360)),ss=Math.min(sx,sy);
    out.frame={...(out.frame||{}),logicalSize:[width,height]};
    for(const s of out.sprites||[]){const t=s.transform||{},rx=s.root?finite(s.root.x,finite(t.x)):null,ry=s.root?finite(s.root.y,finite(t.y)):null;t.x=finite(t.x)*sx;t.y=finite(t.y)*sy;if(t.w!=null)t.w=finite(t.w)*sx;if(t.h!=null)t.h=finite(t.h)*sy;if(s.root){s.root.x=rx*sx;s.root.y=ry*sy}if(pseudo?.projectSpriteFragment){const p=pseudo.projectSpriteFragment(s,{u:.5,v:1,localHeight:0,alpha:s.style?.alpha??1});if(Number.isFinite(p?.depth01))s.depth01=p.depth01}}
    // Cone lights carry their reach in `range`, while point lights use `radius`.
    // Both are logical world distances and must follow the derived native extent.
    // Resolve omitted elevations through SM-204 while they are still in logical
    // units. Deferring the default until after scaling leaves e.g. cone Z at 22
    // native pixels while its position/range/material height use scaled units.
    // The optional API preserves existing utility callers without duplicating
    // SM-204's group/cone defaults in this presentation adapter.
    const scaleLight=l=>{const z=typeof lighting?.lightElevation==='function'?lighting.lightElevation(l):l.z;l.x*=sx;l.y*=sy;if(z!=null)l.z=z*ss;if(l.radius!=null)l.radius*=ss;if(l.range!=null)l.range*=ss};
    for(const l of out.lights||[])scaleLight(l);
    for(const o of out.occluders||[]){if(Array.isArray(o.bounds))o.bounds=[o.bounds[0]*sx,o.bounds[1]*sy,o.bounds[2]*sx,o.bounds[3]*sy];if(Array.isArray(o.rect))o.rect=[o.rect[0]*sx,o.rect[1]*sy,o.rect[2]*sx,o.rect[3]*sy];if(o.root){o.root.x*=sx;o.root.y*=sy}if(o.x!=null)o.x*=sx;if(o.contactY!=null)o.contactY*=sy;if(Array.isArray(o.sections))for(const q of o.sections)if(q.z!=null)q.z*=ss}
    const scaleOverlay=o=>{if(o){if(o.x!=null)o.x*=sx;if(o.y!=null)o.y*=sy}};
    scaleOverlay(out.overlays?.guide);scaleOverlay(out.overlays?.objectiveMarker);if(out.playerCone)scaleLight(out.playerCone);
    for(const p of out.proceduralLayers||[])if(p.kind==='effects'&&Array.isArray(p.descriptor))for(const e of p.descriptor){if(e.x!=null)e.x*=sx;if(e.y!=null)e.y*=sy;for(const k of ['radius','size','length'])if(e[k]!=null)e[k]*=ss}
    return{scene:out,scale:{x:sx,y:sy,uniform:ss}};
  }

  function scaleFoliageInstances(instances,scale){
    return (instances||[]).map(q=>({...q,x:finite(q.x)*scale.x,rootY:finite(q.rootY)*scale.y,w:finite(q.w)*scale.x,h:finite(q.h)*scale.y}));
  }

  function atlasMetaFromLegacy(atlas){
    const regions={};for(const [name,r] of Object.entries(atlas?.s||{}))regions[name]=[r.x,r.y,r.w,r.h];
    return{source_size:[atlas?.canvas?.width||512,atlas?.canvas?.height||256],regions};
  }

  function frameScene(scene,predicate,{procedural=false,overlays=false}={}){
    return{...scene,sprites:(scene.sprites||[]).filter(predicate),proceduralLayers:procedural?(scene.proceduralLayers||[]):(scene.proceduralLayers||[]).filter(p=>p.kind!=='effects'),overlays:overlays?scene.overlays:{guide:null,objectiveMarker:null}};
  }

  // A merged SM-307 mask has no per-light identity. Stream only the bounded
  // affected drivers; batch remaining lights with neutral direct visibility.
  function visibilityLightPlan(scene,settings,lighting,shadows,macroLightId=null){
    const lights=lighting.buildCanonicalLights(scene,settings),ids=lights.map(l=>l.id),known=new Set(ids);
    const selfIds=new Set(shadows.selectSelfShadowLights(scene,settings).map(l=>l.id));
    const contactId=settings.lighting!==false&&settings.contactShadows!==false?shadows.selectContactLight(scene,settings,scene.frame?.logicalSize).id:null;
    const macroId=settings.lighting!==false&&settings.shadows!==false&&known.has(macroLightId)?macroLightId:null;
    const batches=[],neutral=[];
    for(const id of ids){const selfShadow=selfIds.has(id),contactShadow=id===contactId,macro=id===macroId;
      if(selfShadow||contactShadow||macro)batches.push({ids:[id],selfShadow,contactShadow,macro});else neutral.push(id);
    }
    if(neutral.length||!batches.length)batches.push({ids:neutral,selfShadow:false,contactShadow:false,macro:false});
    return{canonicalIds:ids,macroLightId:macroId,selfLightIds:[...selfIds],contactLightId:known.has(contactId)?contactId:null,batches};
  }

  function lightSubset(scene,ids){
    const wanted=new Set(ids),cone=scene.playerCone;
    return{...scene,lights:(scene.lights||[]).filter(l=>wanted.has(String(l.id))),playerCone:cone&&wanted.has(String(cone.id||'light:player-cone:0'))?cone:null};
  }

  function macroLightDriver(scene,settings,lighting,shadows,dominance=null){
    const canonical=lighting.buildCanonicalLights(scene,settings);if(!canonical.length)return null;
    const preferred=shadows.selectContactLight(scene,settings,scene.frame?.logicalSize).id;
    const available=dominance?new Set((dominance.records||[]).map(r=>r.lightId)):null;
    const chosen=canonical.find(l=>l.id===preferred&&(!available||available.has(l.id)))||canonical.find(l=>!available||available.has(l.id));
    if(!chosen)return null;
    return (scene.lights||[]).find(l=>String(l.id)===chosen.id)||(scene.playerCone&&String(scene.playerCone.id||'light:player-cone:0')===chosen.id?scene.playerCone:null);
  }

  const COMPOSITE_WGSL=`
@group(0) @binding(0) var samp:sampler;
@group(0) @binding(1) var aTex:texture_2d<f32>;
@group(0) @binding(2) var bTex:texture_2d<f32>;
struct V{@builtin(position) p:vec4f,@location(0) uv:vec2f};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:V;o.p=vec4f(p[i],0,1);o.uv=vec2f((p[i].x+1.0)*.5,(1.0-p[i].y)*.5);return o;}
@fragment fn opaque(in:V)->@location(0) vec4f{let bg=textureSampleLevel(aTex,samp,in.uv,0);let lit=textureSampleLevel(bTex,samp,in.uv,0);return vec4f(lit.rgb+bg.rgb*(1.0-lit.a),1);}
@fragment fn overlay(in:V)->@location(0) vec4f{let a=textureSampleLevel(aTex,samp,in.uv,0);let layoutKeep=textureSampleLevel(bTex,samp,in.uv,0);return a+layoutKeep*0.0;}
`;

  // Compatibility background receives lighting without claiming sprite ownership.
  // ID/depth are read-only; occupied material pixels are never touched.
  const BACKGROUND_RECEIVER_WGSL=`
@group(0) @binding(0) var nearestSampler:sampler;
@group(0) @binding(1) var background:texture_2d<f32>;
@group(0) @binding(2) var owner:texture_2d<u32>;
struct V{@builtin(position) p:vec4f,@location(0) uv:vec2f};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{
 let positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));let p=positions[i];
 var o:V;o.p=vec4f(p,0,1);o.uv=vec2f((p.x+1)*.5,(1-p.y)*.5);return o;
}
struct Material{@location(0) g0:vec4f,@location(1) g1:vec4f,@location(2) g2:vec4f};
@fragment fn fs(in:V)->Material{
 if(textureLoad(owner,vec2i(in.p.xy),0).x!=0u){discard;}
 var m:Material;m.g0=textureSampleLevel(background,nearestSampler,in.uv,0);
 m.g1=vec4f(.5,.5,1,.88);m.g2=vec4f(0,0,1,0);return m;
}`;

  const FOLIAGE_RASTER_WGSL=`
struct Raster{rootSize:vec4f,uv:vec4f};
struct Lit{color:vec4f,state:vec4f,ids:vec4u};
struct Params{extentMode:vec4f};
@group(0) @binding(0) var<storage,read> raster:array<Raster>;
@group(0) @binding(1) var<storage,read> lit:array<Lit>;
@group(0) @binding(2) var atlas:texture_2d<f32>;
@group(0) @binding(3) var samp:sampler;
@group(0) @binding(4) var<uniform> params:Params;
struct O{@builtin(position) p:vec4f,@location(0) uv:vec2f,@location(1) color:vec4f,@location(2) @interpolate(flat) front:f32,@location(3) @interpolate(flat) category:u32};
@vertex fn vs(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->O{
 let corners=array<vec2f,6>(vec2f(-.5,0),vec2f(.5,0),vec2f(-.5,1),vec2f(-.5,1),vec2f(.5,0),vec2f(.5,1));
 let q=corners[vi];let r=raster[ii];let s=lit[ii];let bend=bitcast<f32>(s.ids.z);let root=r.rootSize.xy;let size=r.rootSize.zw;
 let x=root.x+q.x*size.x+bend*q.y;let y=root.y-q.y*size.y;let mode=u32(params.extentMode.z+.5);let layerOffset=select(0.0,-1024.0,mode==0u);let depth=clamp((3072.0-(layerOffset+root.y))/5120.0,0.0,1.0);var o:O;o.p=vec4f(x/params.extentMode.x*2.0-1.0,1.0-y/params.extentMode.y*2.0,depth,1);
 o.uv=mix(r.uv.xy,r.uv.zw,vec2f(q.x+.5,1.0-q.y));o.color=s.color;o.front=bitcast<f32>(s.ids.w);o.category=s.ids.y;return o;
}
@fragment fn fs(in:O)->@location(0) vec4f{
 let mode=u32(params.extentMode.z+.5);let fine=in.category==1u;if((mode==0u&&!fine)||(mode==1u&&(fine||in.front>=.5))||(mode==2u&&(fine||in.front<.5))){discard;}
 let t=textureSample(atlas,samp,in.uv);if(t.a<.02){discard;}return vec4f(t.rgb*in.color.rgb,t.a*in.color.a);
}`;

  class WebGPUScenePresenter{
    constructor(options={}){
      this.root=options.root||root;this.game=options.game;this.manager=options.manager;this.onFailure=options.onFailure||(()=>{});
      if(!this.game?.renderer||!this.manager?.device)throw new Error('SM-505 presenter requires game renderer and initialized WebGPU manager');
      this.api=options.api||required();this.device=this.manager.device;this.queue=this.device.queue;this.canvas=null;this.context=null;this.width=0;this.height=0;this.ready=false;this.closed=false;this.pending=null;this.rendering=false;this.presentedFrames=0;this.droppedFrames=0;this.lastRoomId=null;this.lastError=null;this.lastPlan=null;this.lastSourceRevision={background:null,water:null};this.resources=[];
    }
    _assertOpen(){if(this.closed){const error=new Error('SM-505 presenter is closed');error.name='SM505PresenterClosedError';throw error}}
    _assertApi(){for(const [name,value] of Object.entries(this.api))if(!value)throw new Error(`SM-505 missing staged renderer dependency: ${name}`)}
    _extent(){const r=this.game.renderer;return{width:Math.max(2,Math.round(r.nativeW||this.game.canvas?.width||640)),height:Math.max(2,Math.round(r.nativeH||this.game.canvas?.height||360))}}
    _makeCanvas(){
      const doc=this.root?.document,c=doc?.createElement?.('canvas');if(!c)throw new Error('SM-505 presentation canvas unavailable');c.id='webgpuPresentation';c.setAttribute?.('aria-hidden','true');Object.assign(c.style||{},{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',display:'block'});
      const frame=this.game.canvas?.parentNode;if(!frame?.insertBefore)throw new Error('SM-505 game frame unavailable');frame.insertBefore(c,this.game.canvas.nextSibling);return c;
    }
    async initialize(){
      this._assertOpen();
      try{
        this._assertApi();const e=this._extent();this.width=e.width;this.height=e.height;this.canvas=this._makeCanvas();this.canvas.width=this.width;this.canvas.height=this.height;this.context=this.canvas.getContext?.('webgpu');if(!this.context)throw new Error('SM-505 WebGPU presentation context unavailable');
        await this._buildValidatedResources();this._assertOpen();this.ready=true;return this;
      }catch(error){
        // An awaited producer may finish allocating after close(); clean it again.
        if(this.closed)this._closeResources();else this.close();throw error;
      }
    }
    async _buildValidatedResources(){
      this._assertOpen();const scoped=typeof this.device.pushErrorScope==='function'&&typeof this.device.popErrorScope==='function';let buildError=null,validationError=null;
      if(scoped)this.device.pushErrorScope('validation');
      try{this.context.configure({device:this.device,format:this.manager.format,alphaMode:'opaque',colorSpace:'srgb'});await this._buildResources()}
      catch(error){buildError=error}
      // Pop even when an awaited producer fails or close() cancels construction.
      // A successful JS callback is insufficient: invalid GPU objects can report
      // errors asynchronously through the scope instead of throwing immediately.
      if(scoped)try{validationError=await this.device.popErrorScope()}catch(error){if(!buildError)buildError=error}
      if(buildError)throw buildError;
      if(validationError)throw new Error(`SM-505 presenter resource validation failed: ${validationError.message||validationError}`);
      this._assertOpen();
    }
    async _buildResources(){
      this._assertOpen();const A=this.api,d=this.device,w=this.width,h=this.height,q=this.queue,manifest=this.game.art?.manifest||{};
      this.gb=new A.Ownership.WebGPUOwnershipGBuffer({device:d,width:w,height:h,maxInstances:4096,labelPrefix:'SM505GBuffer'});await this.gb.setAtlases({albedo:this.game.art.img,normalRoughness:this.game.art.materialNRImg,heightMaterial:this.game.art.materialHMImg,meta:manifest});this._assertOpen();
      this.depth=new A.Depth.WebGPUDepthHierarchy({device:d,queue:q,width:w,height:h,labelPrefix:'SM505Depth'});
      this.shadows=new A.Shadows.WebGPULocalShadows({device:d,width:w,height:h,registry:this.gb.registry,pipelines:this.gb.pipelines,labelPrefix:'SM505Shadows'});
      this.lighting=new A.Lighting.WebGPUDeferredLighting({device:d,width:w,height:h,registry:this.gb.registry,pipelines:this.gb.pipelines,labelPrefix:'SM505Lighting'});await this.shadows.initialize();this._assertOpen();await this.lighting.initialize();this._assertOpen();await this.lighting.initializeStreamedDirect();this._assertOpen();
      this.occ=new A.Occluders.WebGPUOccluderBins({device:d,width:w,height:h,maxOccluders:512,maxPerTile:32,maxTileRefs:16384});
      this.clusters=new A.Clusters.WebGPUOccluderClusters({device:d,width:w,height:h,maxClusters:512,maxMembers:512,maxCandidatePairs:4096,maxCandidatePerTile:32});
      this.dominance=new A.Dominance.WebGPUDominantOccluders({device:d,maxDominanceRecords:512});
      this.dso=new A.DSO.WebGPUDSOHardCore({device:d,width:w,height:h,maxJobs:512,maxMembers:512,maxTileRefs:16384});
      this.dsoHierarchy=new A.DSOHierarchy.WebGPUDSOHierarchy({device:d,width:w,height:h,maxJobs:512,maxMembers:512,maxTileRefs:16384});
      this.bloom=new A.Bloom.WebGPUDarkBloom({device:d,width:w,height:h,quality:'Medium'});this.bloomTemporal=new A.BloomTemporal.WebGPUDarkBloomTemporal({device:d,width:w,height:h});this.visibility=new A.Visibility.WebGPUVisibilityComposition({device:d,width:w,height:h});
      this.water=new A.Water.WebGPUWaterPass({device:d,queue:q,width:w,height:h});await this.water.initialize();this._assertOpen();
      this.foliageAuthority=new A.Foliage.FoliageFrameAuthority(manifest);this.foliage=new A.Foliage.WebGPUFoliagePass(d,{width:w,height:h,label:'SM505Foliage'});
      this.post=new A.Post.WebGPUPost({device:d,width:w,height:h,intermediateFormat:WORLD_FORMAT,outputFormat:this.manager.format,labelPrefix:'SM505Post'});await this.post.initialize();this._assertOpen();
      this.fx={worldLegacy:new A.Transparent.WebGPUTransparentFX({device:d,width:w,height:h,format:WORLD_FORMAT,labelPrefix:'SM505WorldLegacy'}),worldHd:new A.Transparent.WebGPUTransparentFX({device:d,width:w,height:h,format:WORLD_FORMAT,labelPrefix:'SM505WorldHD'}),topLegacy:new A.Transparent.WebGPUTransparentFX({device:d,width:w,height:h,format:this.manager.format,labelPrefix:'SM505TopLegacy'}),topHd:new A.Transparent.WebGPUTransparentFX({device:d,width:w,height:h,format:this.manager.format,labelPrefix:'SM505TopHD'}),overlay:new A.Transparent.WebGPUTransparentFX({device:d,width:w,height:h,format:this.manager.format,labelPrefix:'SM505Overlay'})};for(const x of Object.values(this.fx)){try{await x.initialize();this._assertOpen()}catch(error){try{x.close?.()}catch(_e){}throw error}}
      this.world=d.createTexture({label:'SM505:world',size:{width:w,height:h},format:WORLD_FORMAT,usage:usage('GPUTextureUsage','RENDER_ATTACHMENT','TEXTURE_BINDING','COPY_SRC')});this.resources.push(this.world);
      this._buildCompositePipelines();await this._buildBackgroundReceiverPipeline();this._assertOpen();this._buildFoliageRaster();this._uploadLegacyAtlas();this._uploadBackdrop(true);
    }
    _buildCompositePipelines(){
      const d=this.device,m=d.createShaderModule({label:'SM505:composite',code:COMPOSITE_WGSL});this.sampler=d.createSampler({magFilter:'linear',minFilter:'linear'});
      this.basePipeline=d.createRenderPipeline({label:'SM505:opaque-resolve',layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'opaque',targets:[{format:WORLD_FORMAT}]},primitive:{topology:'triangle-list'}});
      this.overlayPipeline=d.createRenderPipeline({label:'SM505:overlay',layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'overlay',targets:[{format:WORLD_FORMAT,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
    }
    async _buildBackgroundReceiverPipeline(){
      const d=this.device,module=d.createShaderModule({label:'SM505:background-receiver',code:BACKGROUND_RECEIVER_WGSL});
      this.receiverCompilation=[];if(typeof module.getCompilationInfo==='function'){const info=await module.getCompilationInfo();this._assertOpen();this.receiverCompilation=Array.from(info.messages||[]).map(m=>({type:m.type,message:m.message,lineNum:m.lineNum,linePos:m.linePos}));const errors=this.receiverCompilation.filter(m=>m.type==='error');if(errors.length)throw new Error(`SM-505 background receiver WGSL: ${errors.map(m=>m.message).join('; ')}`);}
      this.receiverPipeline=d.createRenderPipeline({label:'SM505:background-receiver',layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:this.gb.formats.g0},{format:this.gb.formats.g1},{format:this.gb.formats.g2}]},primitive:{topology:'triangle-list'}});
      this.receiverSampler=d.createSampler({label:'SM505:background-nearest',magFilter:'nearest',minFilter:'nearest',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});this.receiverBindings=null;
    }
    _renderBackgroundReceivers(){
      this._assertOpen();const object=this.gb._record('object').handle;
      if(!this.receiverBindings||this.receiverBindings.background!==this.backdrop||this.receiverBindings.object!==object){
        const group=this.device.createBindGroup({label:'SM505:background-receiver',layout:this.receiverPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.receiverSampler},{binding:1,resource:this.backdrop.createView()},{binding:2,resource:object.createView()}]});
        this.receiverBindings={group,background:this.backdrop,object};
      }
      const views=this.gb._views(),encoder=this.device.createCommandEncoder({label:'SM505:background-receiver'});
      const pass=encoder.beginRenderPass({label:'SM505:background-receiver',colorAttachments:[views.g0,views.g1,views.g2].map(view=>({view,loadOp:'load',storeOp:'store'}))});
      pass.setPipeline(this.receiverPipeline);pass.setBindGroup(0,this.receiverBindings.group);pass.draw(3);pass.end();this.queue.submit([encoder.finish()]);this.receiverRenders=(this.receiverRenders||0)+1;
    }
    _buildFoliageRaster(){
      const d=this.device,m=d.createShaderModule({label:'SM505:foliage-raster',code:FOLIAGE_RASTER_WGSL}),target={format:WORLD_FORMAT,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}};
      this.foliageRaster=d.createBuffer({label:'SM505:foliage-raster-data',size:this.api.Foliage.MAX_INSTANCES*32,usage:usage('GPUBufferUsage','STORAGE','COPY_DST')});this.foliageParams=[0,1,2].map(mode=>{const b=d.createBuffer({label:`SM505:foliage-raster-params:${mode}`,size:16,usage:usage('GPUBufferUsage','UNIFORM','COPY_DST')});this.queue.writeBuffer(b,0,new Float32Array([this.width,this.height,mode,0]));return b});this.foliageSampler=d.createSampler({magFilter:'nearest',minFilter:'nearest'});
      const desc=depth=>({label:`SM505:foliage:${depth?'depth':'front'}`,layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'fs',targets:[target]},primitive:{topology:'triangle-list'},depthStencil:depth?{format:'depth32float',depthWriteEnabled:false,depthCompare:'less-equal'}:undefined});
      this.foliageDepthPipeline=d.createRenderPipeline(desc(true));this.foliageFrontPipeline=d.createRenderPipeline(desc(false));this.resources.push(this.foliageRaster,...this.foliageParams);
    }
    _uploadLegacyAtlas(){
      const src=this.game.atlas?.canvas;if(!src)throw new Error('SM-505 legacy atlas unavailable');this.legacyMeta=atlasMetaFromLegacy(this.game.atlas);this.legacyTexture=this.device.createTexture({label:'SM505:legacy-atlas',size:{width:src.width,height:src.height},format:'rgba8unorm-srgb',usage:usage('GPUTextureUsage','TEXTURE_BINDING','COPY_DST','RENDER_ATTACHMENT')});this.resources.push(this.legacyTexture);this.queue.copyExternalImageToTexture({source:src},{texture:this.legacyTexture,colorSpace:'srgb'},{width:src.width,height:src.height});
    }
    _uploadBackdrop(force=false){
      const source=this.game.renderer.webgpuPresentationSources?.background,revision=this.game.renderer.webgpuPresentationSources?.backgroundRevision??0;if(!force&&revision===this.lastSourceRevision.background)return;
      try{this.backdrop?.destroy?.()}catch(_e){};const sw=source?.width||1,sh=source?.height||1;this.backdrop=this.device.createTexture({label:'SM505:backdrop',size:{width:sw,height:sh},format:'rgba8unorm-srgb',usage:usage('GPUTextureUsage','TEXTURE_BINDING','COPY_DST','RENDER_ATTACHMENT')});if(source)this.queue.copyExternalImageToTexture({source},{texture:this.backdrop,colorSpace:'srgb'},{width:sw,height:sh});else this.queue.writeTexture({texture:this.backdrop},new Uint8Array([0,0,0,255]),{bytesPerRow:4},{width:1,height:1});this.lastSourceRevision.background=revision;
    }
    _updateWaterField(roomId){
      const s=this.game.renderer.webgpuPresentationSources||{},mask=s.waterMask,revision=s.waterRevision??0;if(!mask||revision===this.lastSourceRevision.water)return;
      const ctx=mask.getContext?.('2d'),img=ctx?.getImageData?.(0,0,mask.width,mask.height);if(img)this.water.setMask(img.data,mask.width,mask.height,{roomId,revision:String(revision)});this.lastSourceRevision.water=revision;
    }
    _opaqueComposite(){
      const enc=this.device.createCommandEncoder({label:'SM505:opaque-resolve'}),target=this.world.createView(),bind=this.device.createBindGroup({layout:this.basePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:this.backdrop.createView()},{binding:2,resource:this.lighting.outputTexture().createView()}]}),pass=enc.beginRenderPass({colorAttachments:[{view:target,clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(this.basePipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();this.queue.submit([enc.finish()]);
    }
    _blendTexture(encoder,source,target){
      const bind=this.device.createBindGroup({layout:this.overlayPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:source},{binding:2,resource:source}]}),pass=encoder.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(this.overlayPipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
    }
    _packFoliageRaster(instances){
      const a=new Float32Array(Math.max(8,instances.length*8));for(let i=0;i<instances.length;i++){const p=instances[i],o=i*8,uv=p.uv||[0,0,1,1];a[o]=p.x;a[o+1]=p.rootY;a[o+2]=p.w;a[o+3]=p.h;a.set(uv,o+4)}return a;
    }
    _renderFoliageStage(encoder,mode,count,depthView){
      if(!count)return;const params=this.foliageParams[mode],pipe=mode===2?this.foliageFrontPipeline:this.foliageDepthPipeline,bind=this.device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.foliageRaster}},{binding:1,resource:{buffer:this.foliage.outputBuffer}},{binding:2,resource:this.gb.atlas.albedo.createView()},{binding:3,resource:this.foliageSampler},{binding:4,resource:{buffer:params}}]}),desc={colorAttachments:[{view:this.world.createView(),loadOp:'load',storeOp:'store'}]};if(mode!==2)desc.depthStencilAttachment={view:depthView,depthLoadOp:'load',depthStoreOp:'store'};const pass=encoder.beginRenderPass(desc);pass.setPipeline(pipe);pass.setBindGroup(0,bind);pass.draw(6,count);pass.end();
    }
    _sourceFrames(scene,opaqueIds=new Set()){
      // Ownership and forward sprites are exclusive. Use actual canonical G-buffer
      // instances, rather than duplicating its atlas/category/alpha policy here.
      const forward=s=>!opaqueIds.has(String(s.id));
      const T=this.api.Transparent,legacyScene=frameScene(scene,s=>s.atlas==='legacy'&&forward(s)),hdScene=frameScene(scene,s=>s.atlas!=='legacy'&&forward(s)),overlayScene=frameScene(scene,()=>false,{procedural:true,overlays:true});
      return{legacy:T.buildCompatibilityFrame(legacyScene,this.legacyMeta),hd:T.buildCompatibilityFrame(hdScene,this.game.art.manifest),overlay:T.buildCompatibilityFrame(overlayScene,this.game.art.manifest)};
    }
    _invalidateForRoom(roomId){
      if(this.lastRoomId==null){this.lastRoomId=roomId;return}if(roomId===this.lastRoomId)return;for(const r of [this.water,this.bloom,this.bloomTemporal,this.dsoHierarchy,this.visibility])try{r?.invalidate?.('room-change')}catch(_e){}this.lastRoomId=roomId;this.lastSourceRevision.water=null;
    }
    async _renderOpaqueLighting(scene,settings,macroLightId){
      const plan=visibilityLightPlan(scene,settings,this.api.Lighting,this.api.Shadows,macroLightId);
      const source=()=>this.visibility.sourceFromPaths(this.gb,this.shadows,this.dsoHierarchy,this.bloomTemporal,null);
      const visibilityOptions=(batch=null)=>({gtao:false,wait:false,
        dso:batch?batch.macro:settings.lighting!==false&&settings.shadows!==false,
        darkBloom:batch?batch.macro:settings.lighting!==false&&settings.shadows!==false,
        selfShadow:batch?batch.selfShadow:settings.selfShadowing!==false&&settings.lighting!==false,
        contactShadow:batch?batch.contactShadow:settings.contactShadows!==false&&settings.lighting!==false,
        materialAOStrength:clamp(finite(settings.materialAOStrength,.62),0,1)});
      let first=true;
      for(const batch of plan.batches){
        this._assertOpen();const subset=lightSubset(scene,batch.ids);
        const subsetIds=this.api.Lighting.buildCanonicalLights(subset,settings).map(l=>l.id);
        if(JSON.stringify(subsetIds)!==JSON.stringify(batch.ids))throw new Error('SM-505 per-light subset lost canonical light identity');
        await this.shadows.render(this.gb,subset,{...settings,selfShadowing:batch.selfShadow,contactShadows:batch.contactShadow},{wait:false});this._assertOpen();
        await this.visibility.update(source(),visibilityOptions(batch));this._assertOpen();
        await this.lighting.accumulateDirect(this.gb,subset,settings,{visibilityView:this.visibility.bindings().visibility,clear:first,wait:false});this._assertOpen();first=false;
      }
      // Existing forward consumers retain their accepted aggregate visibility.
      // No DSO/Bloom/temporal producer is advanced a second time here.
      await this.shadows.render(this.gb,scene,settings,{wait:false});this._assertOpen();
      await this.visibility.update(source(),visibilityOptions());this._assertOpen();
      await this.lighting.resolveDirect(this.gb,scene,settings,{ambientVisibilityView:this.visibility.bindings().visibility,wait:false});this._assertOpen();
      this.lastOpaqueVisibilityPlan=plan;
    }
    async _render(scene){
      this._assertOpen();this.api.Scene.validateRenderScene(scene);const e=this._extent();if(e.width!==this.width||e.height!==this.height){await this._rebuild(e.width,e.height);this._assertOpen()}
      this._uploadBackdrop();const scaled=scaleScene(scene,this.width,this.height,this.api.Pseudo,this.api.Lighting),s=scaled.scene,quality=this.root?.steelMothWebGPUQualityRuntime?.preset||this.game.graphics?.webgpuQualityPreset||'Medium',Q=this.api.Quality;
      this._invalidateForRoom(String(s.frame?.roomId||'unknown-room'));const shadowSettings={...Q.localShadowSettings(quality,s.settings||{}),selfShadowing:s.settings?.lighting!==false&&s.settings?.selfShadowing!==false,contactShadows:s.settings?.lighting!==false&&s.settings?.contactShadows!==false};
      const opaqueInstances=this.api.Ownership.buildOwnershipSceneInstances(s,this.game.art.manifest);
      await this.gb.renderInstances(opaqueInstances,{wait:false});this._assertOpen();this._renderBackgroundReceivers();const opaqueIds=new Set(opaqueInstances.map(instance=>String(instance.id)));await this.depth.buildFromOwnership(this.gb,{wait:false});this._assertOpen();await this.occ.update(s,{wait:false});this._assertOpen();await this.clusters.update(this.occ,{wait:false});this._assertOpen();await this.dominance.update(this.clusters,this.occ,this.api.Lighting.buildCanonicalLights(s,shadowSettings),{wait:false});this._assertOpen();
      const macroDriver=macroLightDriver(s,shadowSettings,this.api.Lighting,this.api.Shadows,this.dominance.snapshot),lightId=macroDriver?.id||null;await this.dso.update(this.clusters,this.occ,this.dominance,{lightId,wait:false});this._assertOpen();await this.dsoHierarchy.update(this.dso,{quality,wait:false});this._assertOpen();await this.bloom.update(this.bloom.sourceFromPaths(this.dsoHierarchy,this.depth),{quality,wait:false});this._assertOpen();await this.bloomTemporal.update(this.bloomTemporal.sourceFromPaths(this.bloom,this.depth,this.gb,this.dsoHierarchy,macroDriver||{}),{wait:false});this._assertOpen();await this._renderOpaqueLighting(s,shadowSettings,lightId);this._assertOpen();
      this._opaqueComposite();this._updateWaterField(String(s.frame.roomId||'unknown-room'));
      const frames=this._sourceFrames(s,opaqueIds),depthView=this.gb._views().depth,enc=this.device.createCommandEncoder({label:'SM505:forward-compose'}),worldView=this.world.createView();
      const waterDesc=(s.proceduralLayers||[]).find(p=>p.kind==='water')?.descriptor;if(waterDesc&&this.water.fieldTexture){const source=this.water.sourceFromPaths(this.lighting,this.gb,this.visibility);source.sceneView=worldView;await this.water.render(source,s,{...(s.settings||{}),...waterDesc},{wait:false,time:(s.frame.timeMs||0)/1000,ripples:this.game.renderer.surfaceFX?.water?.sources?.items||[]});this._assertOpen();this._blendTexture(enc,this.water.outputTexture().createView(),worldView)}
      const foliageDesc=this.game.renderer.webgpuPresentationSources?.foliageDescriptor;if(foliageDesc){this.foliageAuthority.setDescriptor(foliageDesc,s.settings||{});const fa=this.foliageAuthority.update(0,this.game.foliageInteractionSources?.()||[],s.settings||{},(scene.frame?.timeMs||0)/1000),instances=scaleFoliageInstances(fa.instances,scaled.scale);this.foliage.upload(instances);this.queue.writeBuffer(this.foliageRaster,0,this._packFoliageRaster(instances));this.foliage.encode(enc,this.foliage.sourceFromPaths(this.lighting,this.gb,this.visibility),s.settings||{},(s.frame.timeMs||0)/1000,'final');this._renderFoliageStage(enc,0,instances.length,depthView);this._renderFoliageStage(enc,1,instances.length,depthView)}
      this.fx.worldLegacy.uploadFrame(frames.legacy);this.fx.worldHd.uploadFrame(frames.hd);for(const stage of ['world-alpha','world-additive']){this.fx.worldLegacy.renderStage(stage,{encoder:enc,targetView:worldView,frame:frames.legacy,atlasView:this.legacyTexture.createView(),depthView});this.fx.worldHd.renderStage(stage,{encoder:enc,targetView:worldView,frame:frames.hd,atlasView:this.gb.atlas.albedo.createView(),depthView})}
      if(foliageDesc)this._renderFoliageStage(enc,2,this.foliage.count,depthView);
      const output=this.context.getCurrentTexture().createView();this.post.render({encoder:enc,sceneView:worldView,outputView:output,settings:s.settings||{},grade:s.post?.grade||[1,1,1],raw:false});
      this.fx.overlay.uploadFrame(frames.overlay);this.fx.overlay.renderStage('post-effects',{encoder:enc,targetView:output,frame:frames.overlay});
      this.fx.topLegacy.uploadFrame(frames.legacy);this.fx.topHd.uploadFrame(frames.hd);for(const stage of ['top-additive','top-alpha']){this.fx.topLegacy.renderStage(stage,{encoder:enc,targetView:output,frame:frames.legacy,atlasView:this.legacyTexture.createView()});this.fx.topHd.renderStage(stage,{encoder:enc,targetView:output,frame:frames.hd,atlasView:this.gb.atlas.albedo.createView()})}
      for(const stage of ['objective','guide'])this.fx.overlay.renderStage(stage,{encoder:enc,targetView:output,frame:frames.overlay});
      this.lastPlan=this.api.Ordering.buildFramePlan({water:!!waterDesc,foliage:{instances:this.foliageAuthority?.instances||[]},transparentFrame:frames.overlay});this.queue.submit([enc.finish()]);this.presentedFrames++;
    }
    async _rebuild(width,height){
      this._assertOpen();
      try{
        this._closeResources();this.width=width;this.height=height;this.canvas.width=width;this.canvas.height=height;this.resources=[];this.lastSourceRevision={background:null,water:null};await this._buildValidatedResources();this._assertOpen();
      }catch(error){this.ready=false;this._closeResources();throw error}
    }
    consume(scene){
      if(!this.ready||this.closed)return false;if(this.rendering){this.pending=scene;this.droppedFrames++;return true}this.rendering=true;this._drain(scene);return true;
    }
    async _drain(scene){
      try{let next=scene;while(next&&!this.closed){this.pending=null;await this._render(next);next=this.pending}}
      catch(error){if(this.closed){this._closeResources();return}this.lastError=String(error?.stack||error);this.ready=false;try{this.onFailure(error,this)}catch(_e){}}
      finally{this.rendering=false}
    }
    diagnostics(){return{schema:SCHEMA,ready:this.ready,closed:this.closed,extent:{width:this.width,height:this.height},presentedFrames:this.presentedFrames,droppedFrames:this.droppedFrames,pending:!!this.pending,lastRoomId:this.lastRoomId,lastError:this.lastError,ordering:this.lastPlan?this.api.Ordering.diagnostics(this.lastPlan):null,quality:this.root?.steelMothWebGPUQualityRuntime?.preset||'Medium',gtaoEnabled:false,opaqueVisibility:{policy:'light-identified streamed direct; one compression; ambient AO once; emissive unmasked',plan:clone(this.lastOpaqueVisibilityPlan||null)},backgroundReceiver:{policy:'unowned material receiver; object ID and depth unchanged',renderCount:this.receiverRenders||0,compilation:clone(this.receiverCompilation||[])},presentationCanvas:this.canvas?.id||null,sourceOwnership:'backend-neutral RenderScene + renderer-derived presentation resources',resourceDeltaPolicy:'SM-505 adds rgba16float world and raw-direct accumulation targets, backdrop/legacy atlas copies and bounded foliage raster buffers; M1-M5 producer resources are reused.'}}
    _closeResources(){
      for(const x of Object.values(this.fx||{}))try{x.close?.()}catch(_e){};for(const x of [this.post,this.water,this.foliage,this.visibility,this.bloomTemporal,this.bloom,this.dsoHierarchy,this.dso,this.dominance,this.clusters,this.occ,this.depth,this.lighting,this.gb])try{x?.close?.()}catch(_e){};for(const x of this.resources||[])try{x?.destroy?.()}catch(_e){};try{this.backdrop?.destroy?.()}catch(_e){};this.fx=null;this.receiverBindings=null;this.resources=[];
    }
    close(){if(this.closed)return;this.closed=true;this.ready=false;this.pending=null;this._closeResources();try{this.context?.unconfigure?.()}catch(_e){};try{this.canvas?.remove?.()}catch(_e){};this.canvas=null;this.context=null}
  }

  function create(options){return new WebGPUScenePresenter(options)}
  return{SCHEMA,WORLD_FORMAT,COMPOSITE_WGSL,BACKGROUND_RECEIVER_WGSL,FOLIAGE_RASTER_WGSL,scaleScene,scaleFoliageInstances,atlasMetaFromLegacy,frameScene,visibilityLightPlan,lightSubset,macroLightDriver,WebGPUScenePresenter,create};
});
