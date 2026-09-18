'use strict';

(function(root,factory){
  const Resources=root?.SteelMothWebGPUResources||((typeof module==='object'&&module.exports)?require('./webgpu_resources.js'):null);
  const Lighting=root?.SteelMothWebGPULighting||((typeof module==='object'&&module.exports)?require('./webgpu_lighting.js'):null);
  const api=factory(Resources,Lighting,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPULocalShadows=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,Lighting,root){
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before webgpu_local_shadows');
  if(!Lighting)throw new Error('SteelMothWebGPULighting is required before webgpu_local_shadows');

  const SCHEMA='steelmoth-webgpu-local-shadows/v1';
  const SELF_QUALITY_SAMPLES=Object.freeze([0,8,12,16,28]);
  const CONTACT_QUALITY_SAMPLES=Object.freeze([0,4,8,12]);
  const MAX_SELF_LIGHTS=8;
  const SELF_FORMAT='r16float';
  const CONTACT_FORMAT='r16float';
  const DEBUG_MODES=Object.freeze(['self-shadow','contact-shadow']);
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,COPY_DST:0x02,TEXTURE_BINDING:0x04,RENDER_ATTACHMENT:0x10});
  const MAP_MODE_READ=0x0001;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const fract=v=>v-Math.floor(v);
  const bufferUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const textureUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUTextureUsage?.[n]??FALLBACK_TEXTURE_USAGE[n]??0),0);
  const nowMs=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();

  function selfShadowSamples(q){q=clamp(Math.round(finite(q,0)),0,4);return SELF_QUALITY_SAMPLES[q]}
  function contactShadowSamples(q){q=clamp(Math.round(finite(q,0)),0,3);return CONTACT_QUALITY_SAMPLES[q]}
  function lightScore(light){return Math.max(0,finite(light?.intensity,0))*Math.max(1,finite(light?.radius,0))}
  function selectSelfShadowLights(scene={},settings={}){
    if(settings.lighting===false||settings.selfShadowing===false)return[];
    const limit=clamp(Math.round(finite(settings.selfShadowLightCount,2)),0,MAX_SELF_LIGHTS);if(!limit)return[];
    const lights=Lighting.buildCanonicalLights(scene,settings).map((light,index)=>({light,index,cone:light.type==='cone',player:String(light.id||'').includes('player'),score:lightScore(light)}));
    lights.sort((a,b)=>Number(b.cone)-Number(a.cone)||Number(b.player)-Number(a.player)||b.score-a.score||a.index-b.index||String(a.light.id).localeCompare(String(b.light.id)));
    return lights.slice(0,limit).map(q=>q.light);
  }
  function selectContactLight(scene={},settings={},logicalSize=[640,360]){
    const lights=Lighting.buildCanonicalLights(scene,settings).map((light,index)=>({light,index,cone:light.type==='cone',score:lightScore(light)}));
    lights.sort((a,b)=>Number(b.cone)-Number(a.cone)||b.score-a.score||a.index-b.index||String(a.light.id).localeCompare(String(b.light.id)));
    if(lights.length)return lights[0].light;
    return{id:'light:sm205-fallback',type:'point',typeValue:Lighting.LIGHT_TYPE.point,flags:0,group:'fallback',position:[finite(logicalSize[0],640)*.5,finite(logicalSize[1],360)*.5,24],radius:Math.max(finite(logicalSize[0],640),finite(logicalSize[1],360)),color:[1,1,1],intensity:1,direction:[1,0],innerCos:1,outerCos:-1};
  }
  function heightWorld(localHeight,settings={}){return clamp(finite(localHeight,0),0,1)*64*clamp(finite(settings.heightStrength,1),0,3)}
  function coverageHeight(sample){return{coverage:finite(sample?.coverage??sample?.alpha??sample?.g0?.[3],0),height:finite(sample?.height??sample?.g2?.[0],0)}}
  function selfShadowReference(point,lights,settings={},sampleAt=()=>({coverage:0,height:0}),logicalSize=[640,360]){
    if(settings.selfShadowing===false)return 1;const samples=selfShadowSamples(settings.selfShadowQuality??3);if(!samples)return 1;
    const bias=clamp(finite(settings.selfShadowBias,1.15),.05,5),maxDistance=clamp(finite(settings.selfShadowMaxDistance,176),8,176),z=heightWorld(point.height,settings),selected=(lights||[]).slice(0,clamp(Math.round(finite(settings.selfShadowLightCount,2)),0,MAX_SELF_LIGHTS));let visibility=1;
    for(let li=0;li<selected.length;li++){
      const light=selected[li],lx=finite(light?.position?.[0],0),ly=finite(light?.position?.[1],0),lz=finite(light?.position?.[2],12),dx=lx-point.x,dy=ly-point.y,ld=Math.hypot(dx,dy);if(ld<2)continue;const ux=dx/ld,uy=dy/ld,span=Math.min(ld,maxDistance),jit=fract(Math.sin((point.x+li*19.7)*12.9898+point.y*78.233)*43758.5453);let vis=1;
      for(let i=1;i<=samples;i++){const tt=(i-.3+jit*.3)/samples,d=span*tt,rayT=d/ld,qx=point.x+ux*d,qy=point.y+uy*d;if(qx<0||qy<0||qx>=logicalSize[0]||qy>=logicalSize[1])break;const q=coverageHeight(sampleAt(Math.floor(qx),Math.floor(qy)));if(q.coverage<.02)continue;const rz=z+(lz-z)*rayT,sz=heightWorld(q.height,settings);if(sz>rz+bias){vis=.24+.16*tt;break}}
      visibility=Math.min(visibility,vis);
    }
    return clamp(visibility,0,1);
  }
  function contactOcclusionReference(point,light,settings={},sampleAt=()=>({coverage:0,height:0}),logicalSize=[640,360]){
    if(settings.contactShadows===false)return 0;const samples=contactShadowSamples(settings.contactShadowQuality??2);if(!samples)return 0;
    const bias=clamp(clamp(finite(settings.selfShadowBias,1.15),.05,5)*.70,.15,4),distance=clamp(finite(settings.contactShadowDistance,20),4,36),z=heightWorld(point.height,settings),lx=finite(light?.position?.[0],logicalSize[0]*.5),ly=finite(light?.position?.[1],logicalSize[1]*.5),lz=finite(light?.position?.[2],24),dx=lx-point.x,dy=ly-point.y,ld=Math.hypot(dx,dy);if(ld<1)return 0;const ux=dx/ld,uy=dy/ld,span=Math.min(distance,ld),jit=fract(Math.sin(point.x*12.9898+point.y*78.233)*43758.5453);let occ=0;
    for(let i=1;i<=samples;i++){const tt=(i-.35+jit*.35)/samples,d=span*tt,rayT=d/ld,qx=point.x+ux*d,qy=point.y+uy*d;if(qx<0||qy<0||qx>=logicalSize[0]||qy>=logicalSize[1])break;const q=coverageHeight(sampleAt(Math.floor(qx),Math.floor(qy)));if(q.coverage<.02)continue;const rz=z+(lz-z)*rayT,sz=heightWorld(q.height,settings);if(sz>rz+bias){const delta=sz-rz-bias,t=clamp(delta/3,0,1),smooth=t*t*(3-2*t);occ=Math.max(occ,(1-tt)*smooth);if(occ>.88)break}}
    return clamp(occ,0,1);
  }
  function reconstructContactReference(centerHeight,taps=[],strength=.58){
    let occ=0,ws=0;for(const tap of taps){const dz=Math.abs(finite(tap.height,centerHeight)-centerHeight),w=Math.exp(-dz*90)*(tap.center?2:1);occ+=clamp(finite(tap.occlusion,0),0,1)*w;ws+=w}const raw=ws>0?occ/ws:0;return clamp(1-raw*clamp(finite(strength,.58),0,1),0,1);
  }

  const SELF_WGSL=`
const MAX_STEPS:u32=28u;
const MAX_LIGHTS:u32=${Lighting.MAX_LIGHTS}u;
struct Light { posRadius:vec4f,colorIntensity:vec4f,directionCone:vec4f,kindFlags:vec4f };
struct Frame { p0:vec4f,p1:vec4f,counts:vec4u };
@group(0) @binding(0) var g0:texture_2d<f32>;
@group(0) @binding(1) var g2:texture_2d<f32>;
@group(0) @binding(2) var<storage,read> lights:array<Light>;
@group(0) @binding(3) var<uniform> frame:Frame;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[vi],0,1);}
fn hAt(q:vec2i)->f32{return textureLoad(g2,q,0).r*64.0*frame.p0.z;}
@fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) f32{
  let size=textureDimensions(g0);let q=vec2i(p.xy);if(q.x<0||q.y<0||q.x>=i32(size.x)||q.y>=i32(size.y)){return 1.0;}let al=textureLoad(g0,q,0);if(al.a<.02||frame.counts.x==0u||frame.counts.y==0u){return 1.0;}let P=p.xy;let z=hAt(q);var visibility=1.0;
  for(var li:u32=0u;li<MAX_LIGHTS;li++){
    if(li>=frame.counts.y){break;}let light=lights[li];let dv=light.posRadius.xy-P;let ld=length(dv);if(ld<2.0){continue;}let dir=dv/ld;let span=min(ld,frame.p1.x);let jit=fract(sin(dot(P+vec2f(f32(li)*19.7,0.0),vec2f(12.9898,78.233)))*43758.5453);var vis=1.0;
    for(var i:u32=1u;i<=MAX_STEPS;i++){
      if(i>frame.counts.x){break;}let tt=(f32(i)-.3+jit*.3)/f32(frame.counts.x);let d=span*tt;let rayT=d/ld;let Q=P+dir*d;if(Q.x<0.0||Q.y<0.0||Q.x>=frame.p0.x||Q.y>=frame.p0.y){break;}let qi=vec2i(Q);let qa=textureLoad(g0,qi,0);if(qa.a<.02){continue;}let rz=mix(z,light.posRadius.z,rayT);let sz=hAt(qi);if(sz>rz+frame.p0.w){vis=.24+.16*tt;break;}
    }
    visibility=min(visibility,vis);
  }
  return clamp(visibility,0.0,1.0);
}`;

  const CONTACT_WGSL=`
const MAX_STEPS:u32=12u;
struct Light { posRadius:vec4f,colorIntensity:vec4f,directionCone:vec4f,kindFlags:vec4f };
struct Frame { p0:vec4f,p1:vec4f,counts:vec4u };
@group(0) @binding(0) var g0:texture_2d<f32>;
@group(0) @binding(1) var g2:texture_2d<f32>;
@group(0) @binding(2) var<storage,read> lights:array<Light>;
@group(0) @binding(3) var<uniform> frame:Frame;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[vi],0,1);}
fn hAt(q:vec2i)->f32{return textureLoad(g2,q,0).r*64.0*frame.p0.z;}
@fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) f32{
  if(frame.counts.x==0u||frame.counts.y==0u){return 0.0;}let full=vec2f(frame.p0.xy);let half=vec2f(frame.p1.yz);let P=p.xy*full/half;let size=textureDimensions(g0);let q=clamp(vec2i(P),vec2i(0),vec2i(size)-vec2i(1));let al=textureLoad(g0,q,0);if(al.a<.02){return 0.0;}let light=lights[0];let z=hAt(q);let dv=light.posRadius.xy-P;let ld=length(dv);if(ld<1.0){return 0.0;}let dir=dv/ld;let span=min(frame.p1.x,ld);let jit=fract(sin(dot(P,vec2f(12.9898,78.233)))*43758.5453);var occ=0.0;
  for(var i:u32=1u;i<=MAX_STEPS;i++){
    if(i>frame.counts.x){break;}let tt=(f32(i)-.35+jit*.35)/f32(frame.counts.x);let d=span*tt;let rayT=d/ld;let Q=P+dir*d;if(Q.x<0.0||Q.y<0.0||Q.x>=full.x||Q.y>=full.y){break;}let qi=vec2i(Q);let qa=textureLoad(g0,qi,0);if(qa.a<.02){continue;}let rz=mix(z,light.posRadius.z,rayT);let sz=hAt(qi);if(sz>rz+frame.p0.w){occ=max(occ,(1.0-tt)*smoothstep(0.0,3.0,sz-rz-frame.p0.w));if(occ>.88){break;}}
  }
  return clamp(occ,0.0,1.0);
}`;

  const RECONSTRUCT_WGSL=`
struct Frame { p0:vec4f,p1:vec4f,counts:vec4u };
@group(0) @binding(0) var contact:texture_2d<f32>;
@group(0) @binding(1) var g0:texture_2d<f32>;
@group(0) @binding(2) var g2:texture_2d<f32>;
@group(0) @binding(3) var<uniform> frame:Frame;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[vi],0,1);}
@fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) f32{
  let full=vec2i(frame.p0.xy);let half=vec2i(frame.p1.yz);let q=clamp(vec2i(p.xy),vec2i(0),full-vec2i(1));if(textureLoad(g0,q,0).a<.002||frame.counts.z==0u){return 1.0;}let zc=textureLoad(g2,q,0).r;let base=clamp(vec2i(vec2f(q)*vec2f(half)/vec2f(full)),vec2i(0),half-vec2i(1));var sum=0.0;var ws=0.0;
  for(var oy:i32=-1;oy<=1;oy++){for(var ox:i32=-1;ox<=1;ox++){let t=clamp(base+vec2i(ox,oy),vec2i(0),half-vec2i(1));let fq=clamp(vec2i((vec2f(t)+vec2f(.5))*vec2f(full)/vec2f(half)),vec2i(0),full-vec2i(1));let dz=abs(textureLoad(g2,fq,0).r-zc);let center=select(1.0,2.0,ox==0&&oy==0);let w=exp(-dz*90.0)*center;sum+=textureLoad(contact,t,0).r*w;ws+=w;}}
  let occ=select(0.0,sum/ws,ws>0.0);return clamp(1.0-occ*frame.p1.w,0.0,1.0);
}`;

  function selfFrameBytes(width,height,settings,lightCount){const data=new ArrayBuffer(48),dv=new DataView(data),f=(o,v)=>dv.setFloat32(o,finite(v,0),true),u=(o,v)=>dv.setUint32(o,Number(v)>>>0,true);f(0,width);f(4,height);f(8,clamp(finite(settings.heightStrength,1),0,3));f(12,clamp(finite(settings.selfShadowBias,1.15),.05,5));f(16,clamp(finite(settings.selfShadowMaxDistance,176),8,176));u(32,selfShadowSamples(settings.selfShadowQuality??3));u(36,lightCount);u(40,settings.selfShadowing===false?0:1);return new Uint8Array(data)}
  function contactFrameBytes(width,height,halfW,halfH,settings,enabled){const data=new ArrayBuffer(48),dv=new DataView(data),f=(o,v)=>dv.setFloat32(o,finite(v,0),true),u=(o,v)=>dv.setUint32(o,Number(v)>>>0,true);f(0,width);f(4,height);f(8,clamp(finite(settings.heightStrength,1),0,3));f(12,clamp(clamp(finite(settings.selfShadowBias,1.15),.05,5)*.70,.15,4));f(16,clamp(finite(settings.contactShadowDistance,20),4,36));f(20,halfW);f(24,halfH);f(28,clamp(finite(settings.contactShadowStrength,.58),0,1));u(32,contactShadowSamples(settings.contactShadowQuality??2));u(36,enabled?1:0);u(40,enabled?1:0);return new Uint8Array(data)}

  class WebGPULocalShadows{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPULocalShadows requires GPUDevice');if(!options.registry)throw new Error('WebGPULocalShadows requires the shared SM-200/204 ResourceRegistry');
      this.device=options.device;this.queue=options.queue||options.device.queue;this.registry=options.registry;this.pipelines=options.pipelines||new Resources.PipelineCache(this.device,{labelPrefix:'SteelMothSM205Pipeline'});this.width=Math.max(1,Math.round(options.width||this.registry.width||640));this.height=Math.max(1,Math.round(options.height||this.registry.height||360));this.labelPrefix=String(options.labelPrefix||'SteelMothLocalShadows');this.selfPipeline=null;this.contactPipeline=null;this.reconstructPipeline=null;this.compilation=[];this.renderCount=0;this.lastSelfLights=[];this.lastContactLight=null;this.lastCpuSubmitWaitMs=null;this._defineResources();
    }
    _name(n){return `sm205:${n}`}
    _defineResources(){
      const ensureBuffer=(name,size,usage)=>{if(!this.registry.get(name))this.registry.defineBuffer(name,{size,usage})};const ensureTexture=(name,format,scale=1)=>{if(!this.registry.get(name))this.registry.defineTexture(name,{format,usage:textureUsage(['RENDER_ATTACHMENT','TEXTURE_BINDING','COPY_SRC']),size:'surface',scale})};
      ensureBuffer(Lighting.LIGHT_BUFFER_NAME,Lighting.MAX_LIGHTS*Lighting.LIGHT_STRIDE,bufferUsage(['STORAGE','COPY_DST']));ensureBuffer(this._name('self-frame'),48,bufferUsage(['UNIFORM','COPY_DST']));ensureBuffer(this._name('contact-frame'),48,bufferUsage(['UNIFORM','COPY_DST']));ensureTexture(this._name('self'),SELF_FORMAT,1);ensureTexture(this._name('contact'),CONTACT_FORMAT,.5);ensureTexture(this._name('contact-visibility'),CONTACT_FORMAT,1);
    }
    async _module(label,code){const module=this.device.createShaderModule({label:`${this.labelPrefix}:${label}`,code});let messages=[];if(typeof module.getCompilationInfo==='function')messages=Array.from((await module.getCompilationInfo()).messages||[]).map(m=>({type:m.type,message:m.message,lineNum:m.lineNum,linePos:m.linePos}));const errors=messages.filter(m=>m.type==='error');this.compilation.push({label,messages});if(errors.length)throw new Error(`${label} WGSL compilation failed: ${errors.map(e=>e.message).join(' | ')}`);return module}
    async initialize(){
      if(this.selfPipeline)return this;const sm=await this._module('sm205-self',SELF_WGSL),cm=await this._module('sm205-contact',CONTACT_WGSL),rm=await this._module('sm205-contact-reconstruct',RECONSTRUCT_WGSL);
      this.selfPipeline=await this.pipelines.getRender('sm205-self',()=>this.device.createRenderPipeline({label:`${this.labelPrefix}:self`,layout:'auto',vertex:{module:sm,entryPoint:'vs_main'},fragment:{module:sm,entryPoint:'fs_main',targets:[{format:SELF_FORMAT}]},primitive:{topology:'triangle-list'}}));
      this.contactPipeline=await this.pipelines.getRender('sm205-contact',()=>this.device.createRenderPipeline({label:`${this.labelPrefix}:contact`,layout:'auto',vertex:{module:cm,entryPoint:'vs_main'},fragment:{module:cm,entryPoint:'fs_main',targets:[{format:CONTACT_FORMAT}]},primitive:{topology:'triangle-list'}}));
      this.reconstructPipeline=await this.pipelines.getRender('sm205-contact-reconstruct',()=>this.device.createRenderPipeline({label:`${this.labelPrefix}:reconstruct`,layout:'auto',vertex:{module:rm,entryPoint:'vs_main'},fragment:{module:rm,entryPoint:'fs_main',targets:[{format:CONTACT_FORMAT}]},primitive:{topology:'triangle-list'}}));return this;
    }
    _gRecord(gbuffer,name){return gbuffer?.registry?.require?.(`sm200:${name}`)||this.registry.require(`sm200:${name}`)}
    _renderPass(encoder,label,pipeline,target,entries,clearValue){const bind=this.device.createBindGroup({label:`${this.labelPrefix}:${label}-bind`,layout:pipeline.getBindGroupLayout(0),entries});const pass=encoder.beginRenderPass({label:`${this.labelPrefix}:${label}-pass`,colorAttachments:[{view:target.handle.createView(),clearValue:{r:clearValue,g:clearValue,b:clearValue,a:clearValue},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end()}
    async render(gbuffer,scene={},settings={},options={}){
      await this.initialize();if(!gbuffer?.registry)throw new Error('SM-205 local shadows require the SM-200/202 G-buffer registry');if(gbuffer.registry!==this.registry)throw new Error('SM-205 local shadows must share the G-buffer ResourceRegistry');
      this.width=this.registry.width;this.height=this.registry.height;const selfLights=selectSelfShadowLights(scene,settings),contactLight=selectContactLight(scene,settings,[this.width,this.height]),selfSamples=settings.selfShadowing===false?0:selfShadowSamples(settings.selfShadowQuality??3),contactSamples=settings.contactShadows===false?0:contactShadowSamples(settings.contactShadowQuality??2);const selfTarget=this.registry.require(this._name('self')),contactTarget=this.registry.require(this._name('contact')),visibilityTarget=this.registry.require(this._name('contact-visibility')),lightBuffer=this.registry.require(Lighting.LIGHT_BUFFER_NAME),selfFrame=this.registry.require(this._name('self-frame')),contactFrame=this.registry.require(this._name('contact-frame'));
      const start=nowMs(),encoder=this.device.createCommandEncoder({label:`${this.labelPrefix}:frame`});
      if(selfSamples&&selfLights.length){this.queue.writeBuffer(lightBuffer.handle,0,Lighting.packLights(selfLights));this.queue.writeBuffer(selfFrame.handle,0,selfFrameBytes(this.width,this.height,settings,selfLights.length));this._renderPass(encoder,'self',this.selfPipeline,selfTarget,[{binding:0,resource:this._gRecord(gbuffer,'g0').handle.createView()},{binding:1,resource:this._gRecord(gbuffer,'g2').handle.createView()},{binding:2,resource:{buffer:lightBuffer.handle}},{binding:3,resource:{buffer:selfFrame.handle}}],1)}else{const pass=encoder.beginRenderPass({colorAttachments:[{view:selfTarget.handle.createView(),clearValue:{r:1,g:1,b:1,a:1},loadOp:'clear',storeOp:'store'}]});pass.end()}
      if(contactSamples){this.queue.writeBuffer(lightBuffer.handle,0,Lighting.packLights([contactLight]));this.queue.writeBuffer(contactFrame.handle,0,contactFrameBytes(this.width,this.height,contactTarget.width,contactTarget.height,settings,true));this._renderPass(encoder,'contact',this.contactPipeline,contactTarget,[{binding:0,resource:this._gRecord(gbuffer,'g0').handle.createView()},{binding:1,resource:this._gRecord(gbuffer,'g2').handle.createView()},{binding:2,resource:{buffer:lightBuffer.handle}},{binding:3,resource:{buffer:contactFrame.handle}}],0);this._renderPass(encoder,'contact-reconstruct',this.reconstructPipeline,visibilityTarget,[{binding:0,resource:contactTarget.handle.createView()},{binding:1,resource:this._gRecord(gbuffer,'g0').handle.createView()},{binding:2,resource:this._gRecord(gbuffer,'g2').handle.createView()},{binding:3,resource:{buffer:contactFrame.handle}}],1)}else{for(const [target,value] of [[contactTarget,0],[visibilityTarget,1]]){const pass=encoder.beginRenderPass({colorAttachments:[{view:target.handle.createView(),clearValue:{r:value,g:value,b:value,a:value},loadOp:'clear',storeOp:'store'}]});pass.end()}}
      this.queue.submit([encoder.finish()]);if(options.wait!==false&&typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();this.lastCpuSubmitWaitMs=nowMs()-start;this.renderCount++;this.lastSelfLights=selfLights.map(clone);this.lastContactLight=clone(contactLight);return{schema:SCHEMA,selfSamples,contactSamples,selfLights:selfLights.length,selfTexture:this._name('self'),contactTexture:this._name('contact'),contactVisibilityTexture:this._name('contact-visibility')};
    }
    resize(width,height){const changed=this.registry.resize(width,height);this.width=this.registry.width;this.height=this.registry.height;return changed}
    selfTexture(){return this.registry.require(this._name('self')).handle}
    contactTexture(){return this.registry.require(this._name('contact')).handle}
    contactVisibilityTexture(){return this.registry.require(this._name('contact-visibility')).handle}
    async _read(name,x,y){const record=this.registry.require(this._name(name)),buffer=this.device.createBuffer({label:`${this.labelPrefix}:${name}-readback`,size:256,usage:bufferUsage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:record.handle,origin:{x:Math.max(0,Math.min(record.width-1,Math.floor(x))),y:Math.max(0,Math.min(record.height-1,Math.floor(y))),z:0}},{buffer,bytesPerRow:256,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);await buffer.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(buffer.getMappedRange()).slice(0,2);buffer.unmap();buffer.destroy();return Lighting.halfToFloat(new DataView(raw.buffer,raw.byteOffset,2).getUint16(0,true))}
    readSelfPixel(x,y){return this._read('self',x,y)}
    readContactPixel(x,y){const r=this.registry.require(this._name('contact'));return this._read('contact',x*this.width/r.width,y*this.height/r.height)}
    readContactVisibilityPixel(x,y){return this._read('contact-visibility',x,y)}
    diagnostics(){return{schema:SCHEMA,extent:{width:this.width,height:this.height},quality:{selfSamples:[...SELF_QUALITY_SAMPLES],contactSamples:[...CONTACT_QUALITY_SAMPLES],maxSelfLights:MAX_SELF_LIGHTS},formats:{self:SELF_FORMAT,contact:CONTACT_FORMAT},debugModes:[...DEBUG_MODES],selfLights:this.lastSelfLights.map(clone),contactLight:clone(this.lastContactLight),renderCount:this.renderCount,timing:{cpuSubmitWaitMs:this.lastCpuSubmitWaitMs,gpuMs:null,note:'CPU submit/wait wall time only; no GPU timing claim'},depthHierarchyReuse:{used:false,reason:'SM-203 hierarchy stores canonical ownership depth; v1.2.3 self/contact parity traces local Material-v2 height, so substituting hierarchy depth would change semantics'},composition:'visibility masks staged for bounded SM-307 composition; no DSO/Dark Bloom/AO state is owned here',compilation:clone(this.compilation),resourceDiagnostics:this.registry.diagnostics(),pipelineDiagnostics:this.pipelines.diagnostics()}}
  }

  return{SCHEMA,SELF_QUALITY_SAMPLES,CONTACT_QUALITY_SAMPLES,MAX_SELF_LIGHTS,SELF_FORMAT,CONTACT_FORMAT,DEBUG_MODES,SELF_WGSL,CONTACT_WGSL,RECONSTRUCT_WGSL,selfShadowSamples,contactShadowSamples,selectSelfShadowLights,selectContactLight,heightWorld,selfShadowReference,contactOcclusionReference,reconstructContactReference,WebGPULocalShadows};
});
