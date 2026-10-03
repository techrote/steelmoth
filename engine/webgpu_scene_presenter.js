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

  function scaleScene(scene,width,height,pseudo=null){
    const out=clone(scene),logical=scene?.frame?.logicalSize||[640,360],sx=width/Math.max(1,finite(logical[0],640)),sy=height/Math.max(1,finite(logical[1],360)),ss=Math.min(sx,sy);
    out.frame={...(out.frame||{}),logicalSize:[width,height]};
    for(const s of out.sprites||[]){const t=s.transform||{};t.x*=sx;t.y*=sy;if(t.w!=null)t.w*=sx;if(t.h!=null)t.h*=sy;if(s.root){s.root.x=finite(s.root.x,t.x)*sx/sx;s.root.y=finite(s.root.y,t.y/sy)*sy}if(pseudo?.projectSpriteFragment){const p=pseudo.projectSpriteFragment(s,{u:.5,v:1,localHeight:0,alpha:s.style?.alpha??1});if(Number.isFinite(p?.depth01))s.depth01=p.depth01}}
    for(const l of out.lights||[]){l.x*=sx;l.y*=sy;if(l.z!=null)l.z*=ss;if(l.radius!=null)l.radius*=ss}
    for(const o of out.occluders||[]){if(Array.isArray(o.bounds))o.bounds=[o.bounds[0]*sx,o.bounds[1]*sy,o.bounds[2]*sx,o.bounds[3]*sy];if(Array.isArray(o.rect))o.rect=[o.rect[0]*sx,o.rect[1]*sy,o.rect[2]*sx,o.rect[3]*sy];if(o.root){o.root.x*=sx;o.root.y*=sy}if(o.x!=null)o.x*=sx;if(o.contactY!=null)o.contactY*=sy;if(Array.isArray(o.sections))for(const q of o.sections)if(q.z!=null)q.z*=ss}
    const scaleOverlay=o=>{if(o){if(o.x!=null)o.x*=sx;if(o.y!=null)o.y*=sy}};
    scaleOverlay(out.overlays?.guide);scaleOverlay(out.overlays?.objectiveMarker);if(out.playerCone){out.playerCone.x*=sx;out.playerCone.y*=sy;if(out.playerCone.radius!=null)out.playerCone.radius*=ss}
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

  const COMPOSITE_WGSL=`
@group(0) @binding(0) var samp:sampler;
@group(0) @binding(1) var aTex:texture_2d<f32>;
@group(0) @binding(2) var bTex:texture_2d<f32>;
struct V{@builtin(position) p:vec4f,@location(0) uv:vec2f};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:V;o.p=vec4f(p[i],0,1);o.uv=vec2f((p[i].x+1.0)*.5,(1.0-p[i].y)*.5);return o;}
@fragment fn opaque(in:V)->@location(0) vec4f{let bg=textureSampleLevel(aTex,samp,in.uv,0);let lit=textureSampleLevel(bTex,samp,in.uv,0);return vec4f(lit.rgb+bg.rgb*(1.0-lit.a),1);}
@fragment fn overlay(in:V)->@location(0) vec4f{return textureSampleLevel(aTex,samp,in.uv,0);}
`;

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
 let x=root.x+q.x*size.x+bend*q.y;let y=root.y-q.y*size.y;var o:O;o.p=vec4f(x/params.extentMode.x*2.0-1.0,1.0-y/params.extentMode.y*2.0,0,1);
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
    _assertApi(){for(const [name,value] of Object.entries(this.api))if(!value)throw new Error(`SM-505 missing staged renderer dependency: ${name}`)}
    _extent(){const r=this.game.renderer;return{width:Math.max(2,Math.round(r.nativeW||this.game.canvas?.width||640)),height:Math.max(2,Math.round(r.nativeH||this.game.canvas?.height||360))}}
    _makeCanvas(){
      const doc=this.root?.document,c=doc?.createElement?.('canvas');if(!c)throw new Error('SM-505 presentation canvas unavailable');c.id='webgpuPresentation';c.setAttribute?.('aria-hidden','true');Object.assign(c.style||{},{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',display:'block'});
      const frame=this.game.canvas?.parentNode;if(!frame?.insertBefore)throw new Error('SM-505 game frame unavailable');frame.insertBefore(c,this.game.canvas.nextSibling);return c;
    }
    async initialize(){
      this._assertApi();const e=this._extent();this.width=e.width;this.height=e.height;this.canvas=this._makeCanvas();this.canvas.width=this.width;this.canvas.height=this.height;this.context=this.canvas.getContext?.('webgpu');if(!this.context)throw new Error('SM-505 WebGPU presentation context unavailable');
      this.context.configure({device:this.device,format:this.manager.format,alphaMode:'opaque'});await this._buildResources();this.ready=true;return this;
    }
    async _buildResources(){
      const A=this.api,d=this.device,w=this.width,h=this.height,q=this.queue,manifest=this.game.art?.manifest||{};
      this.gb=new A.Ownership.WebGPUOwnershipGBuffer({device:d,width:w,height:h,maxInstances:4096,labelPrefix:'SM505GBuffer'});await this.gb.setAtlases({albedo:this.game.art.img,normalRoughness:this.game.art.materialNRImg,heightMaterial:this.game.art.materialHMImg,meta:manifest});
      this.depth=new A.Depth.WebGPUDepthHierarchy({device:d,queue:q,width:w,height:h,labelPrefix:'SM505Depth'});
      this.shadows=new A.Shadows.WebGPULocalShadows({device:d,width:w,height:h,registry:this.gb.registry,pipelines:this.gb.pipelines,labelPrefix:'SM505Shadows'});
      this.lighting=new A.Lighting.WebGPUDeferredLighting({device:d,width:w,height:h,registry:this.gb.registry,pipelines:this.gb.pipelines,labelPrefix:'SM505Lighting'});await this.shadows.initialize();await this.lighting.initialize();
      this.occ=new A.Occluders.WebGPUOccluderBins({device:d,width:w,height:h,maxOccluders:512,maxPerTile:32,maxTileRefs:16384});
      this.clusters=new A.Clusters.WebGPUOccluderClusters({device:d,width:w,height:h,maxClusters:512,maxMembers:512,maxCandidatePairs:4096,maxCandidatePerTile:32});
      this.dominance=new A.Dominance.WebGPUDominantOccluders({device:d,maxDominanceRecords:512});
      this.dso=new A.DSO.WebGPUDSOHardCore({device:d,width:w,height:h,maxJobs:512,maxMembers:512,maxTileRefs:16384});
      this.dsoHierarchy=new A.DSOHierarchy.WebGPUDSOHierarchy({device:d,width:w,height:h,maxJobs:512,maxMembers:512,maxTileRefs:16384});
      this.bloom=new A.Bloom.WebGPUDarkBloom({device:d,width:w,height:h,quality:'Medium'});this.bloomTemporal=new A.BloomTemporal.WebGPUDarkBloomTemporal({device:d,width:w,height:h});this.visibility=new A.Visibility.WebGPUVisibilityComposition({device:d,width:w,height:h});
      this.water=new A.Water.WebGPUWaterPass({device:d,queue:q,width:w,height:h});await this.water.initialize();
      this.foliageAuthority=new A.Foliage.FoliageFrameAuthority(manifest);this.foliage=new A.Foliage.WebGPUFoliagePass(d,{width:w,height:h,label:'SM505Foliage'});
      this.post=new A.Post.WebGPUPost({device:d,width:w,height:h,intermediateFormat:WORLD_FORMAT,outputFormat:this.manager.format,labelPrefix:'SM505Post'});await this.post.initialize();
      this.fx={worldLegacy:new A.Transparent.WebGPUTransparentFX({device:d,width:w,height:h,format:WORLD_FORMAT,labelPrefix:'SM505WorldLegacy'}),worldHd:new A.Transparent.WebGPUTransparentFX({device:d,width:w,height:h,format:WORLD_FORMAT,labelPrefix:'SM505WorldHD'}),topLegacy:new A.Transparent.WebGPUTransparentFX({device:d,width:w,height:h,format:this.manager.format,labelPrefix:'SM505TopLegacy'}),topHd:new A.Transparent.WebGPUTransparentFX({device:d,width:w,height:h,format:this.manager.format,labelPrefix:'SM505TopHD'}),overlay:new A.Transparent.WebGPUTransparentFX({device:d,width:w,height:h,format:this.manager.format,labelPrefix:'SM505Overlay'})};await Promise.all(Object.values(this.fx).map(x=>x.initialize()));
      this.world=d.createTexture({label:'SM505:world',size:{width:w,height:h},format:WORLD_FORMAT,usage:usage('GPUTextureUsage','RENDER_ATTACHMENT','TEXTURE_BINDING','COPY_SRC')});this.resources.push(this.world);
      this._buildCompositePipelines();this._buildFoliageRaster();this._uploadLegacyAtlas();this._uploadBackdrop(true);
    }
    _buildCompositePipelines(){
      const d=this.device,m=d.createShaderModule({label:'SM505:composite',code:COMPOSITE_WGSL});this.sampler=d.createSampler({magFilter:'linear',minFilter:'linear'});
      this.basePipeline=d.createRenderPipeline({label:'SM505:opaque-resolve',layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'opaque',targets:[{format:WORLD_FORMAT}]},primitive:{topology:'triangle-list'}});
      this.overlayPipeline=d.createRenderPipeline({label:'SM505:overlay',layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'overlay',targets:[{format:WORLD_FORMAT,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
    }
    _buildFoliageRaster(){
      const d=this.device,m=d.createShaderModule({label:'SM505:foliage-raster',code:FOLIAGE_RASTER_WGSL}),target={format:WORLD_FORMAT,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}};
      this.foliageRaster=d.createBuffer({label:'SM505:foliage-raster-data',size:this.api.Foliage.MAX_INSTANCES*32,usage:usage('GPUBufferUsage','STORAGE','COPY_DST')});this.foliageParams=d.createBuffer({label:'SM505:foliage-raster-params',size:16,usage:usage('GPUBufferUsage','UNIFORM','COPY_DST')});this.foliageSampler=d.createSampler({magFilter:'linear',minFilter:'linear'});
      const desc=depth=>({label:`SM505:foliage:${depth?'depth':'front'}`,layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'fs',targets:[target]},primitive:{topology:'triangle-list'},depthStencil:depth?{format:'depth32float',depthWriteEnabled:false,depthCompare:'less-equal'}:undefined});
      this.foliageDepthPipeline=d.createRenderPipeline(desc(true));this.foliageFrontPipeline=d.createRenderPipeline(desc(false));this.resources.push(this.foliageRaster,this.foliageParams);
    }
    _uploadLegacyAtlas(){
      const src=this.game.atlas?.canvas;if(!src)throw new Error('SM-505 legacy atlas unavailable');this.legacyMeta=atlasMetaFromLegacy(this.game.atlas);this.legacyTexture=this.device.createTexture({label:'SM505:legacy-atlas',size:{width:src.width,height:src.height},format:'rgba8unorm-srgb',usage:usage('GPUTextureUsage','TEXTURE_BINDING','COPY_DST')});this.queue.copyExternalImageToTexture({source:src},{texture:this.legacyTexture},{width:src.width,height:src.height});this.resources.push(this.legacyTexture);
    }
    _uploadBackdrop(force=false){
      const source=this.game.renderer.webgpuPresentationSources?.background,revision=this.game.renderer.webgpuPresentationSources?.backgroundRevision??0;if(!force&&revision===this.lastSourceRevision.background)return;
      try{this.backdrop?.destroy?.()}catch(_e){};const sw=source?.width||1,sh=source?.height||1;this.backdrop=this.device.createTexture({label:'SM505:backdrop',size:{width:sw,height:sh},format:'rgba8unorm-srgb',usage:usage('GPUTextureUsage','TEXTURE_BINDING','COPY_DST')});if(source)this.queue.copyExternalImageToTexture({source},{texture:this.backdrop},{width:sw,height:sh});else this.queue.writeTexture({texture:this.backdrop},new Uint8Array([0,0,0,255]),{bytesPerRow:4},{width:1,height:1});this.lastSourceRevision.background=revision;
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
      if(!count)return;this.queue.writeBuffer(this.foliageParams,0,new Float32Array([this.width,this.height,mode,0]));const pipe=mode===2?this.foliageFrontPipeline:this.foliageDepthPipeline,bind=this.device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.foliageRaster}},{binding:1,resource:{buffer:this.foliage.outputBuffer}},{binding:2,resource:this.gb.atlas.albedo.createView()},{binding:3,resource:this.foliageSampler},{binding:4,resource:{buffer:this.foliageParams}}]}),desc={colorAttachments:[{view:this.world.createView(),loadOp:'load',storeOp:'store'}]};if(mode!==2)desc.depthStencilAttachment={view:depthView,depthLoadOp:'load',depthStoreOp:'store'};const pass=encoder.beginRenderPass(desc);pass.setPipeline(pipe);pass.setBindGroup(0,bind);pass.draw(6,count);pass.end();
    }
    _sourceFrames(scene){
      const T=this.api.Transparent,legacyScene=frameScene(scene,s=>s.atlas==='legacy'),hdScene=frameScene(scene,s=>s.atlas!=='legacy'),overlayScene=frameScene(scene,()=>false,{procedural:true,overlays:true});
      return{legacy:T.buildCompatibilityFrame(legacyScene,this.legacyMeta),hd:T.buildCompatibilityFrame(hdScene,this.game.art.manifest),overlay:T.buildCompatibilityFrame(overlayScene,this.game.art.manifest)};
    }
    _invalidateForRoom(roomId){
      if(this.lastRoomId==null){this.lastRoomId=roomId;return}if(roomId===this.lastRoomId)return;for(const r of [this.water,this.bloom,this.bloomTemporal,this.dsoHierarchy,this.visibility])try{r?.invalidate?.('room-change')}catch(_e){}this.lastRoomId=roomId;this.lastSourceRevision.water=null;
    }
    async _render(scene){
      this.api.Scene.validateRenderScene(scene);const e=this._extent();if(e.width!==this.width||e.height!==this.height){await this._rebuild(e.width,e.height)}
      this._uploadBackdrop();const scaled=scaleScene(scene,this.width,this.height,this.api.Pseudo),s=scaled.scene,quality=this.root?.steelMothWebGPUQualityRuntime?.preset||this.game.graphics?.webgpuQualityPreset||'Medium',Q=this.api.Quality;
      this._invalidateForRoom(String(s.frame?.roomId||'unknown-room'));const shadowSettings=Q.localShadowSettings(quality,s.settings||{});
      await this.gb.renderScene(s,this.game.art.manifest,{wait:false});await this.depth.buildFromOwnership(this.gb,{wait:false});await this.shadows.render(this.gb,s,shadowSettings,{wait:false});await this.occ.update(s,{wait:false});await this.clusters.update(this.occ,{wait:false});await this.dominance.update(this.clusters,this.occ,s.lights,{wait:false});
      const lightId=s.lights?.[0]?.id||'light:0';await this.dso.update(this.clusters,this.occ,this.dominance,{lightId,wait:false});await this.dsoHierarchy.update(this.dso,{quality,wait:false});await this.bloom.update(this.bloom.sourceFromPaths(this.dsoHierarchy,this.depth),{quality,wait:false});await this.bloomTemporal.update(this.bloomTemporal.sourceFromPaths(this.bloom,this.depth,this.gb,this.dsoHierarchy,s.lights?.[0]||{}),{wait:false});await this.visibility.update(this.visibility.sourceFromPaths(this.gb,this.shadows,this.dsoHierarchy,this.bloomTemporal,null),{gtao:false,wait:false});await this.lighting.render(this.gb,s,shadowSettings,{wait:false});
      this._opaqueComposite();this._updateWaterField(String(s.frame.roomId||'unknown-room'));
      const frames=this._sourceFrames(s),depthView=this.gb._views().depth,enc=this.device.createCommandEncoder({label:'SM505:forward-compose'}),worldView=this.world.createView();
      const waterDesc=(s.proceduralLayers||[]).find(p=>p.kind==='water')?.descriptor;if(waterDesc&&this.water.fieldTexture){const source=this.water.sourceFromPaths(this.lighting,this.gb,this.visibility);source.sceneView=worldView;await this.water.render(source,s,{...(s.settings||{}),...waterDesc},{wait:false,time:(s.frame.timeMs||0)/1000,ripples:this.game.renderer.surfaceFX?.water?.sources?.items||[]});this._blendTexture(enc,this.water.outputTexture().createView(),worldView)}
      const foliageDesc=this.game.renderer.webgpuPresentationSources?.foliageDescriptor;if(foliageDesc){this.foliageAuthority.setDescriptor(foliageDesc,s.settings||{});const fa=this.foliageAuthority.update(0,this.game.foliageInteractionSources?.()||[],s.settings||{},(scene.frame?.timeMs||0)/1000),instances=scaleFoliageInstances(fa.instances,scaled.scale);this.foliage.upload(instances);this.queue.writeBuffer(this.foliageRaster,0,this._packFoliageRaster(instances));this.foliage.encode(enc,this.foliage.sourceFromPaths(this.lighting,this.gb,this.visibility),s.settings||{},(s.frame.timeMs||0)/1000,'final');this._renderFoliageStage(enc,0,instances.length,depthView);this._renderFoliageStage(enc,1,instances.length,depthView)}
      this.fx.worldLegacy.uploadFrame(frames.legacy);this.fx.worldHd.uploadFrame(frames.hd);for(const stage of ['world-alpha','world-additive']){this.fx.worldLegacy.renderStage(stage,{encoder:enc,targetView:worldView,frame:frames.legacy,atlasView:this.legacyTexture.createView(),depthView});this.fx.worldHd.renderStage(stage,{encoder:enc,targetView:worldView,frame:frames.hd,atlasView:this.gb.atlas.albedo.createView(),depthView})}
      if(foliageDesc)this._renderFoliageStage(enc,2,this.foliage.count,depthView);
      const output=this.context.getCurrentTexture().createView();this.post.render({encoder:enc,sceneView:worldView,outputView:output,settings:s.settings||{},grade:s.post?.grade||[1,1,1],raw:false});
      this.fx.topLegacy.uploadFrame(frames.legacy);this.fx.topHd.uploadFrame(frames.hd);for(const stage of ['top-additive','top-alpha']){this.fx.topLegacy.renderStage(stage,{encoder:enc,targetView:output,frame:frames.legacy,atlasView:this.legacyTexture.createView()});this.fx.topHd.renderStage(stage,{encoder:enc,targetView:output,frame:frames.hd,atlasView:this.gb.atlas.albedo.createView()})}
      this.fx.overlay.uploadFrame(frames.overlay);for(const stage of ['post-effects','objective','guide'])this.fx.overlay.renderStage(stage,{encoder:enc,targetView:output,frame:frames.overlay});
      this.lastPlan=this.api.Ordering.buildFramePlan({water:!!waterDesc,foliage:{instances:this.foliageAuthority?.instances||[]},transparentFrame:frames.overlay});this.queue.submit([enc.finish()]);this.presentedFrames++;
    }
    async _rebuild(width,height){
      this._closeResources();this.width=width;this.height=height;this.canvas.width=width;this.canvas.height=height;this.context.configure({device:this.device,format:this.manager.format,alphaMode:'opaque'});this.resources=[];this.lastSourceRevision={background:null,water:null};await this._buildResources();
    }
    consume(scene){
      if(!this.ready||this.closed)return false;if(this.rendering){this.pending=scene;this.droppedFrames++;return true}this.rendering=true;this._drain(scene);return true;
    }
    async _drain(scene){
      try{let next=scene;while(next&&!this.closed){this.pending=null;await this._render(next);next=this.pending}}
      catch(error){this.lastError=String(error?.stack||error);this.ready=false;try{this.onFailure(error,this)}catch(_e){}}
      finally{this.rendering=false}
    }
    diagnostics(){return{schema:SCHEMA,ready:this.ready,closed:this.closed,extent:{width:this.width,height:this.height},presentedFrames:this.presentedFrames,droppedFrames:this.droppedFrames,pending:!!this.pending,lastRoomId:this.lastRoomId,lastError:this.lastError,ordering:this.lastPlan?this.api.Ordering.diagnostics(this.lastPlan):null,quality:this.root?.steelMothWebGPUQualityRuntime?.preset||'Medium',gtaoEnabled:false,presentationCanvas:this.canvas?.id||null,sourceOwnership:'backend-neutral RenderScene + renderer-derived presentation resources',resourceDeltaPolicy:'SM-505 adds one rgba16float world target, backdrop/legacy atlas copies and bounded foliage raster buffers; M1-M5 producer resources are reused.'}}
    _closeResources(){
      for(const x of Object.values(this.fx||{}))try{x.close?.()}catch(_e){};for(const x of [this.post,this.water,this.foliage,this.visibility,this.bloomTemporal,this.bloom,this.dsoHierarchy,this.dso,this.dominance,this.clusters,this.occ,this.depth,this.gb])try{x?.close?.()}catch(_e){};for(const x of this.resources||[])try{x?.destroy?.()}catch(_e){};try{this.backdrop?.destroy?.()}catch(_e){};this.fx=null;this.resources=[];
    }
    close(){if(this.closed)return;this.closed=true;this.ready=false;this.pending=null;this._closeResources();try{this.context?.unconfigure?.()}catch(_e){};try{this.canvas?.remove?.()}catch(_e){};this.canvas=null;this.context=null}
  }

  function create(options){return new WebGPUScenePresenter(options)}
  return{SCHEMA,WORLD_FORMAT,COMPOSITE_WGSL,FOLIAGE_RASTER_WGSL,scaleScene,scaleFoliageInstances,atlasMetaFromLegacy,frameScene,WebGPUScenePresenter,create};
});
