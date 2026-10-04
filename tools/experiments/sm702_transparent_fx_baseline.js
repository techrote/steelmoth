'use strict';

(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUTransparentFX=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  const SCHEMA='steelmoth-webgpu-transparent-fx/v1';
  const MAX_SHADER_FX=16;
  const MAX_TRANSPARENT_SPRITES=640;
  const VERTEX_FLOATS=9;
  const VERTEX_STRIDE=VERTEX_FLOATS*4;
  const STAGES=Object.freeze(['world-alpha','world-additive','post-effects','top-additive','top-alpha','objective','guide']);
  const STAGE_ORDER=Object.freeze(Object.fromEntries(STAGES.map((s,i)=>[s,i])));
  const BLEND=Object.freeze({
    alpha:Object.freeze({color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}),
    additive:Object.freeze({color:{srcFactor:'src-alpha',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}})
  });
  const FALLBACK_BUFFER_USAGE=Object.freeze({COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,VERTEX:0x0020});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const gpuBufferUsage=(...names)=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const color4=(v,a=1)=>Array.isArray(v)?[finite(v[0],1),finite(v[1],1),finite(v[2],1),finite(a,1)]:[1,1,1,finite(a,1)];

  function normalizeAtlasSize(meta={}){
    const s=meta.source_size||meta.sourceSize||meta.size||[meta.width,meta.height];
    return [Math.max(1,Math.round(finite(s?.[0],1))),Math.max(1,Math.round(finite(s?.[1],1)))];
  }
  function atlasRegion(meta={},name){
    const r=meta.regions?.[name]??meta.s?.[name];if(!r)return null;
    const [aw,ah]=normalizeAtlasSize(meta);
    if(Array.isArray(r)){
      const x=finite(r[0]),y=finite(r[1]),w=Math.max(1,finite(r[2],1)),h=Math.max(1,finite(r[3],1));
      // Half-texel inset prevents sampling a neighboring packed sprite at the atlas edge.
      return{x,y,w,h,u0:clamp((x+.5)/aw,0,1),v0:clamp((y+.5)/ah,0,1),u1:clamp((x+w-.5)/aw,0,1),v1:clamp((y+h-.5)/ah,0,1)};
    }
    const x=finite(r.x),y=finite(r.y),w=Math.max(1,finite(r.w,1)),h=Math.max(1,finite(r.h,1));
    if(Number.isFinite(r.u0)&&Number.isFinite(r.v0)&&Number.isFinite(r.u1)&&Number.isFinite(r.v1))return{x,y,w,h,u0:r.u0,v0:r.v0,u1:r.u1,v1:r.v1};
    return{x,y,w,h,u0:clamp((x+.5)/aw,0,1),v0:clamp((y+.5)/ah,0,1),u1:clamp((x+w-.5)/aw,0,1),v1:clamp((y+h-.5)/ah,0,1)};
  }
  function effectDescriptorLayer(scene={}){const p=(scene.proceduralLayers||[]).find(q=>q?.kind==='effects'||q?.id==='procedural:effects');return Array.isArray(p?.descriptor)?p.descriptor:(Array.isArray(scene.effects)?scene.effects:[])}
  function spriteStage(sprite){const style=sprite?.style||{},category=String(sprite?.category||'dynamic'),blend=String(style.blend||'').toLowerCase(),additive=blend==='additive'||style.glow===true;if(category==='top')return additive?'top-additive':'top-alpha';return additive?'world-additive':'world-alpha'}
  function spriteEligible(sprite){if(!sprite||!sprite.spriteId)return false;const style=sprite.style||{},category=String(sprite.category||'dynamic');return sprite.atlas==='legacy'||style.glow===true||finite(style.alpha,1)<.999||category==='top'}
  function quadVertices(sprite,uv){
    const t=sprite.transform||{},x=finite(t.x),y=finite(t.y),w=Math.max(0,finite(t.w,0)),h=Math.max(0,finite(t.h,0));if(w<=0||h<=0)return[];
    const rot=finite(t.rotation,0),co=Math.cos(rot),si=Math.sin(rot),hw=w*.5,hh=h*.5,style=sprite.style||{},c=color4(style.color||style.tint,style.alpha??1),depth=clamp(finite(sprite.depth01??sprite.depth?.depth01??.5,.5),0,1),flip=!!t.flip;
    let u0=uv.u0,u1=uv.u1;if(flip){const z=u0;u0=u1;u1=z}const pts=[[-hw,-hh,u0,uv.v0],[hw,-hh,u1,uv.v0],[-hw,hh,u0,uv.v1],[-hw,hh,u0,uv.v1],[hw,-hh,u1,uv.v0],[hw,hh,u1,uv.v1]],out=[];
    for(const [px,py,u,v] of pts)out.push(x+px*co-py*si,y+px*si+py*co,u,v,c[0],c[1],c[2],c[3],depth);return out;
  }
  function normalizeEffect(raw={}){const life=Math.max(1e-6,finite(raw.life,1));return{x:finite(raw.x),y:finite(raw.y),color:color4(raw.color,1).slice(0,3),age:clamp(finite(raw.age)/life,0,1),kind:finite(raw.kind,1),params:Array.from({length:4},(_,i)=>finite(raw.params?.[i],0))}}
  function normalizeOverlay(raw){if(!raw||raw.visible===false)return null;return{x:finite(raw.x),y:finite(raw.y),color:color4(raw.color,1).slice(0,3),time:finite(raw.time,0),visible:true}}
  function buildCompatibilityFrame(scene={},atlasMeta={},options={}){
    const maxSprites=clamp(Math.round(finite(options.maxSprites,MAX_TRANSPARENT_SPRITES)),1,MAX_TRANSPARENT_SPRITES),maxFx=clamp(Math.round(finite(options.maxFx,MAX_SHADER_FX)),1,MAX_SHADER_FX),stages=Object.fromEntries(STAGES.map(s=>[s,[]])),unresolved=[],sourceSprites=Array.isArray(scene.sprites)?scene.sprites:[],copyGuard=clone(scene);let accepted=0,dropped=0;
    for(let i=0;i<sourceSprites.length;i++){const s=sourceSprites[i];if(!spriteEligible(s))continue;if(accepted>=maxSprites){dropped++;continue}const uv=atlasRegion(atlasMeta,s.spriteId);if(!uv){unresolved.push({index:i,id:s.id||null,spriteId:s.spriteId});continue}const stage=spriteStage(s),vertices=quadVertices(s,uv);if(!vertices.length)continue;stages[stage].push({id:String(s.id||`transparent:${i}`),spriteId:String(s.spriteId),blend:stage.includes('additive')?'additive':'alpha',depthPolicy:stage.startsWith('world-')?'canonical-if-supplied':'always-top',vertices});accepted++}
    const rawEffects=effectDescriptorLayer(scene),effects=rawEffects.slice(0,maxFx).map(normalizeEffect);if(rawEffects.length>maxFx)dropped+=rawEffects.length-maxFx;const overlays=scene.overlays||{};
    return{schema:SCHEMA,logicalSize:Array.isArray(scene.frame?.logicalSize)?scene.frame.logicalSize.slice(0,2):[640,360],stages,effects,objective:normalizeOverlay(overlays.objectiveMarker||scene.objectiveMarker),guide:normalizeOverlay(overlays.guide||scene.guide),stats:{sourceSpriteCount:sourceSprites.length,acceptedSprites:accepted,dropped,unresolvedCount:unresolved.length,effectCount:effects.length,maxSprites,maxFx},unresolved,sourceDigest:JSON.stringify(copyGuard)};
  }
  function frameUnchanged(scene,frame){return JSON.stringify(scene)===frame.sourceDigest}
  function flattenStage(frame,stage){const records=frame?.stages?.[stage]||[],floats=[];for(const r of records)floats.push(...r.vertices);return new Float32Array(floats)}
  function packProcedural(frame,mode,extent=null){
    const floats=4+MAX_SHADER_FX*12+20,buf=new ArrayBuffer(floats*4),f=new Float32Array(buf),u=new Uint32Array(buf),[w,h]=frame.logicalSize||[640,360],out=extent||[w,h];f[0]=w;f[1]=h;f[2]=Math.max(1,finite(out[0],w));f[3]=Math.max(1,finite(out[1],h));
    const fx0=4,fx1=fx0+MAX_SHADER_FX*4,fx2=fx1+MAX_SHADER_FX*4;let o=fx2+MAX_SHADER_FX*4;
    for(let i=0;i<MAX_SHADER_FX;i++){const e=frame.effects?.[i],a=fx0+i*4,b=fx1+i*4,c=fx2+i*4;f[a]=e?.x||0;f[a+1]=e?.y||0;f[a+2]=e?.age||0;f[a+3]=e?.kind||0;f[b]=e?.color?.[0]||0;f[b+1]=e?.color?.[1]||0;f[b+2]=e?.color?.[2]||0;f[b+3]=1;for(let j=0;j<4;j++)f[c+j]=e?.params?.[j]||0}
    const objective=frame.objective,guide=frame.guide;f[o]=objective?.x||0;f[o+1]=objective?.y||0;f[o+2]=objective?.time||0;f[o+3]=objective?1:0;o+=4;f[o]=objective?.color?.[0]||0;f[o+1]=objective?.color?.[1]||0;f[o+2]=objective?.color?.[2]||0;f[o+3]=1;o+=4;f[o]=guide?.x||0;f[o+1]=guide?.y||0;f[o+2]=guide?.time||0;f[o+3]=guide?1:0;o+=4;f[o]=guide?.color?.[0]||0;f[o+1]=guide?.color?.[1]||0;f[o+2]=guide?.color?.[2]||0;f[o+3]=1;o+=4;u[o]=mode>>>0;u[o+1]=(frame.effects?.length||0)>>>0;u[o+2]=0;u[o+3]=0;return new Uint8Array(buf);
  }

  const SPRITE_WGSL=`
struct Frame { logical:vec4f };
@group(0) @binding(0) var samp:sampler;
@group(0) @binding(1) var atlas:texture_2d<f32>;
@group(0) @binding(2) var<uniform> frame:Frame;
struct Vin { @location(0) pos:vec2f,@location(1) uv:vec2f,@location(2) color:vec4f,@location(3) depth:f32 };
struct Vout { @builtin(position) pos:vec4f,@location(0) uv:vec2f,@location(1) color:vec4f };
@vertex fn vs_main(v:Vin)->Vout{var o:Vout;let ndc=vec2f(v.pos.x/frame.logical.x*2.0-1.0,1.0-v.pos.y/frame.logical.y*2.0);o.pos=vec4f(ndc,v.depth,1.0);o.uv=v.uv;o.color=v.color;return o;}
@fragment fn fs_main(v:Vout)->@location(0) vec4f{let texel=textureSample(atlas,samp,v.uv);return vec4f(texel.rgb*v.color.rgb,texel.a*v.color.a);}`;

  const PROCEDURAL_WGSL=`
const MAX_FX:u32=${MAX_SHADER_FX}u;
struct Proc { header:vec4f,fx0:array<vec4f,${MAX_SHADER_FX}>,fx1:array<vec4f,${MAX_SHADER_FX}>,fx2:array<vec4f,${MAX_SHADER_FX}>,objective0:vec4f,objective1:vec4f,guide0:vec4f,guide1:vec4f,mode:vec4u };
@group(0) @binding(0) var<uniform> p:Proc;
fn gauss(x:f32,s:f32)->f32{return exp(-(x*x)/(2.0*s*s));}
fn spoke(a:f32,n:f32,sharp:f32)->f32{return pow(max(0.0,.5+.5*cos(a*n)),sharp);}
fn ray(along:f32,across:f32,len:f32,width:f32)->f32{return exp(-abs(across)/width)*exp(-abs(along)/len);}
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f{let q=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(q[vi],0,1);}
@fragment fn fs_main(@builtin(position) frag:vec4f)->@location(0) vec4f{
  let qmode=p.mode.x;let xy=vec2f(frag.x/p.header.z*p.header.x,frag.y/p.header.w*p.header.y);var sum=vec3f(0);var aa=0.0;
  if(qmode==0u){let n=min(p.mode.y,MAX_FX);for(var i:u32=0u;i<n;i=i+1u){let a=p.fx0[i];let c=p.fx1[i].rgb;let dxy=xy-a.xy;let d=length(dxy);let ang=atan2(dxy.y,dxy.x);let t=clamp(a.z,0.0,1.0);let k=a.w;var v=0.0;
    if(k<.5){let r=mix(4.0,110.0,t);v=gauss(d-r,3.4)*(1.0-t)+gauss(d,23.0)*(1.0-t)*.22+spoke(ang+t*.7,10.0,18.0)*exp(-d/72.0)*(1.0-t)*.34;}
    else if(k<1.5){let r=mix(10.0,132.0,t);v=gauss(d-r,4.6)*(1.0-t)*1.25+spoke(ang+t*.5,12.0,28.0)*exp(-d/86.0)*(1.0-t)*.7+gauss(d,31.0)*(1.0-t)*.25;}
    else if(k<2.5){let spiral=sin(ang*5.0-d*.12+t*18.0);v=gauss(spiral,.24)*exp(-d/72.0)*(1.0-t)*.55+gauss(d-mix(6.0,90.0,t),4.5)*(1.0-t);}
    else if(k<3.5){let r=18.0+t*72.0;v=gauss(d-r,4.0)*(1.0-t)+spoke(ang-t,8.0,20.0)*exp(-d/58.0)*(1.0-t)*.75+gauss(d,18.0)*(1.0-t)*.5;}
    else if(k<4.5){let r=mix(8.0,150.0,t);v=gauss(d-r,6.0)*(1.0-t)*.8+spoke(ang+t*.65,16.0,34.0)*exp(-d/110.0)*(1.0-t)*.55;}
    else{let r=mix(6.0,96.0,t);v=gauss(d-r,5.0)*(1.0-t)+spoke(ang-t*.4,9.0,22.0)*exp(-d/76.0)*(1.0-t)*.45;}sum=sum+c*v;aa=max(aa,clamp(v,0.0,.94));}}
  else if(qmode==1u&&p.objective0.w>.5){let q=xy-p.objective0.xy;let d=length(q);let a=atan2(q.y,q.x);let spin=p.objective0.z*.42;let core=gauss(d,5.0)*.58;let ring=gauss(d-17.0,2.6)*(.42+.16*sin(p.objective0.z*2.1));let spokes=spoke(a-spin,8.0,28.0)*gauss(d-25.0,11.0)*.52;let v=core+ring+spokes;sum=p.objective1.rgb*v;aa=clamp(v,0.0,.92);}
  else if(qmode==2u&&p.guide0.w>.5){let q=xy-p.guide0.xy;let d=length(q);let c=.70710678;let da=(q.x+q.y)*c;let db=(q.x-q.y)*c;let cardinal=ray(q.x,q.y,11.0,.62)+ray(q.y,q.x,11.0,.62);let diagonal=ray(da,db,10.0,.52)+ray(db,da,10.0,.52);let twinkle=.76+.24*sin(p.guide0.z*4.2);let star=(cardinal*.56+diagonal*.44)*twinkle;let core=gauss(d,3.2)*.9;let halo=gauss(d,12.0)*.14;let v=clamp(core+halo+star,0.0,1.35);sum=p.guide1.rgb*v;aa=clamp(v,0.0,1.0);}return vec4f(sum,aa);}`;

  class WebGPUTransparentFX{
    constructor(options={}){if(!options.device)throw new Error('WebGPUTransparentFX requires GPUDevice');this.device=options.device;this.queue=options.queue||options.device.queue;this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));this.format=String(options.format||'rgba8unorm');this.depthFormat=String(options.depthFormat||'depth32float');this.maxSprites=clamp(Math.round(finite(options.maxSprites,MAX_TRANSPARENT_SPRITES)),1,MAX_TRANSPARENT_SPRITES);this.labelPrefix=String(options.labelPrefix||'SteelMothTransparentFX');this.pipelines=new Map();this.spriteBuffers=new Map();this.procBuffers=new Map();this.frameBuffer=null;this.sampler=null;this.initialized=false;this.compilation=[];this.renderCounts=Object.fromEntries(STAGES.map(s=>[s,0]));this.lastFrameStats=null;this.lastError=null}
    async _module(code,label){const m=this.device.createShaderModule({label:`${this.labelPrefix}:${label}`,code}),info=await m.getCompilationInfo(),messages=Array.from(info.messages||[]).map(x=>({type:x.type,message:x.message,lineNum:x.lineNum,linePos:x.linePos}));this.compilation.push({label,messages});const errors=messages.filter(x=>x.type==='error');if(errors.length)throw new Error(`${label} WGSL: ${errors.map(x=>x.message).join('; ')}`);return m}
    async initialize(){if(this.initialized)return this;try{this.spriteModule=await this._module(SPRITE_WGSL,'sprite');this.procModule=await this._module(PROCEDURAL_WGSL,'procedural');this.sampler=this.device.createSampler({label:`${this.labelPrefix}:sampler`,magFilter:'linear',minFilter:'linear',mipmapFilter:'nearest',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});this.frameBuffer=this.device.createBuffer({label:`${this.labelPrefix}:frame`,size:16,usage:gpuBufferUsage('UNIFORM','COPY_DST')});for(const stage of ['post-effects','objective','guide'])this.procBuffers.set(stage,this.device.createBuffer({label:`${this.labelPrefix}:${stage}:uniform`,size:1024,usage:gpuBufferUsage('UNIFORM','COPY_DST')}));const vertexLayout={arrayStride:VERTEX_STRIDE,attributes:[{shaderLocation:0,offset:0,format:'float32x2'},{shaderLocation:1,offset:8,format:'float32x2'},{shaderLocation:2,offset:16,format:'float32x4'},{shaderLocation:3,offset:32,format:'float32'}]},targets=mode=>[{format:this.format,blend:BLEND[mode]}],mk=async(mode,depth)=>this.device.createRenderPipelineAsync({label:`${this.labelPrefix}:sprite:${mode}:${depth?'depth':'top'}`,layout:'auto',vertex:{module:this.spriteModule,entryPoint:'vs_main',buffers:[vertexLayout]},fragment:{module:this.spriteModule,entryPoint:'fs_main',targets:targets(mode)},primitive:{topology:'triangle-list'},depthStencil:depth?{format:this.depthFormat,depthWriteEnabled:false,depthCompare:'less-equal'}:undefined});for(const mode of ['alpha','additive']){this.pipelines.set(`sprite:${mode}:top`,await mk(mode,false));this.pipelines.set(`sprite:${mode}:depth`,await mk(mode,true))}this.pipelines.set('procedural',await this.device.createRenderPipelineAsync({label:`${this.labelPrefix}:procedural`,layout:'auto',vertex:{module:this.procModule,entryPoint:'vs_main'},fragment:{module:this.procModule,entryPoint:'fs_main',targets:targets('additive')},primitive:{topology:'triangle-list'}}));this.initialized=true;return this}catch(e){this.lastError=String(e?.message||e);throw e}}
    _ensureSpriteBuffer(stage,bytes){let rec=this.spriteBuffers.get(stage);const want=Math.max(256,(bytes+255)&~255);if(!rec||rec.size<want){try{rec?.buffer?.destroy()}catch(_e){};rec={size:want,buffer:this.device.createBuffer({label:`${this.labelPrefix}:${stage}:vertices`,size:want,usage:gpuBufferUsage('VERTEX','COPY_DST')})};this.spriteBuffers.set(stage,rec)}return rec.buffer}
    uploadFrame(frame){if(!this.initialized)throw new Error('initialize() must complete before uploadFrame');const logical=frame.logicalSize||[this.width,this.height];this.queue.writeBuffer(this.frameBuffer,0,new Float32Array([finite(logical[0],this.width),finite(logical[1],this.height),0,0]));for(const stage of ['world-alpha','world-additive','top-additive','top-alpha']){const data=flattenStage(frame,stage);if(data.byteLength)this.queue.writeBuffer(this._ensureSpriteBuffer(stage,data.byteLength),0,data)}for(const [stage,mode] of [['post-effects',0],['objective',1],['guide',2]])this.queue.writeBuffer(this.procBuffers.get(stage),0,packProcedural(frame,mode,[this.width,this.height]));this.lastFrameStats=clone(frame.stats);return frame}
    renderStage(stage,{encoder,targetView,frame,atlasView=null,depthView=null,loadOp='load',clearValue={r:0,g:0,b:0,a:1}}={}){if(!this.initialized)throw new Error('initialize() must complete before renderStage');if(!Object.prototype.hasOwnProperty.call(STAGE_ORDER,stage))throw new Error(`unknown transparent stage: ${stage}`);if(!encoder||!targetView)throw new Error('encoder and targetView are required');let pass=null;try{const descriptor={label:`${this.labelPrefix}:${stage}:pass`,colorAttachments:[{view:targetView,loadOp,storeOp:'store',clearValue}]};if(stage.startsWith('world-')&&depthView)descriptor.depthStencilAttachment={view:depthView,depthLoadOp:'load',depthStoreOp:'store'};pass=encoder.beginRenderPass(descriptor);if(stage==='post-effects'||stage==='objective'||stage==='guide'){if((stage==='post-effects'&&!(frame.effects?.length))||(stage==='objective'&&!frame.objective)||(stage==='guide'&&!frame.guide)){pass.end();return 0}const pipe=this.pipelines.get('procedural');pass.setPipeline(pipe);pass.setBindGroup(0,this.device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.procBuffers.get(stage)}}]}));pass.draw(3);pass.end();this.renderCounts[stage]++;return 1}const data=flattenStage(frame,stage);if(!data.length){pass.end();return 0}if(!atlasView)throw new Error(`atlasView required for ${stage}`);const mode=stage.includes('additive')?'additive':'alpha',depth=stage.startsWith('world-')&&!!depthView,pipe=this.pipelines.get(`sprite:${mode}:${depth?'depth':'top'}`);pass.setPipeline(pipe);pass.setBindGroup(0,this.device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:atlasView},{binding:2,resource:{buffer:this.frameBuffer}}]}));pass.setVertexBuffer(0,this.spriteBuffers.get(stage).buffer);pass.draw(data.length/VERTEX_FLOATS);pass.end();this.renderCounts[stage]++;return data.length/(VERTEX_FLOATS*6)}catch(e){try{pass?.end()}catch(_e){}this.lastError=String(e?.message||e);throw e}}
    diagnostics(){return{schema:SCHEMA,extent:{width:this.width,height:this.height},format:this.format,depthFormat:this.depthFormat,maxTransparentSprites:this.maxSprites,maxShaderFx:MAX_SHADER_FX,stages:[...STAGES],stageOrder:{...STAGE_ORDER},blend:{alpha:clone(BLEND.alpha),additive:clone(BLEND.additive)},depthPolicy:{world:'canonical-if-supplied/less-equal/no-depth-write',top:'always-top/no-depth'},renderCounts:{...this.renderCounts},frameStats:clone(this.lastFrameStats),compilation:clone(this.compilation),resourcePolicy:'persistent-per-stage-buffers; bounded growth; no gameplay ownership',fallback:'WebGL2 compatibility renderer remains authoritative until promotion',lastError:this.lastError}}
    close(){for(const r of this.spriteBuffers.values())try{r.buffer.destroy()}catch(_e){};for(const b of this.procBuffers.values())try{b.destroy()}catch(_e){};try{this.frameBuffer?.destroy()}catch(_e){};this.spriteBuffers.clear();this.procBuffers.clear()}
  }
  return{SCHEMA,MAX_SHADER_FX,MAX_TRANSPARENT_SPRITES,VERTEX_FLOATS,VERTEX_STRIDE,STAGES,STAGE_ORDER,BLEND,SPRITE_WGSL,PROCEDURAL_WGSL,normalizeAtlasSize,atlasRegion,spriteStage,spriteEligible,quadVertices,normalizeEffect,buildCompatibilityFrame,frameUnchanged,flattenStage,packProcedural,WebGPUTransparentFX};
});
