'use strict';

(function(root,factory){
  let Foliage=root?.RelayFoliageFX||null;
  let Lighting=root?.SteelMothWebGPULighting||null;
  if(typeof module==='object'&&module.exports){
    if(!Foliage){try{Foliage=require('./foliagefx.js');}catch(_e){Foliage=null;}}
    if(!Lighting){try{Lighting=require('./webgpu_lighting.js');}catch(_e){Lighting=null;}}
  }
  const api=factory(Foliage,Lighting,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUFoliage=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Foliage,Lighting,root){
  if(!Foliage)throw new Error('RelayFoliageFX is required before webgpu_foliage');
  if(!Lighting)throw new Error('SteelMothWebGPULighting is required before webgpu_foliage');

  const SCHEMA='steelmoth-webgpu-foliage/v1';
  const SNAPSHOT_SCHEMA='steelmoth-webgpu-foliage-snapshot/v1';
  const MAX_INSTANCES=Foliage.FOLIAGE_HARD_CAP||208;
  const INSTANCE_STRIDE=80;
  const OUTPUT_STRIDE=48;
  const PARAM_BYTES=64;
  const CLASS_FLAGS=Object.freeze({receiver:1,contact:2,macro:4,tiny:8});
  const DEBUG_MODES=Object.freeze(['final','lighting','direct-visibility','ambient-visibility','depth','front-blend','classification','bend']);
  const PALETTE=Object.freeze({
    GROUND_MOSS:Object.freeze([.055,.19,.17]),
    SHORT_GRASS:Object.freeze([.065,.255,.225]),
    FERN:Object.freeze([.09,.31,.255]),
    BROAD_LEAF:Object.freeze([.105,.34,.275]),
    FLOWER_CLUSTER:Object.freeze([.12,.32,.255]),
    BUSH:Object.freeze([.075,.285,.235])
  });
  const DEFAULTS=Object.freeze({foliageQuality:3,foliageWindStrength:.78,foliageWindSpeed:.82,foliageInteractionStrength:1,foliageShadingStrength:.9,foliageBendAmount:1,ambient:.3,lighting:true});
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const MAP_MODE_READ=0x0001;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const usage=(...names)=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const colorFor=i=>(PALETTE[i?.category]||PALETTE.BROAD_LEAF).slice();

  function normalizeSettings(raw={}){
    const o={...DEFAULTS,...raw};
    return{foliageQuality:clamp(Math.round(finite(o.foliageQuality,3)),0,3),foliageWindStrength:clamp(finite(o.foliageWindStrength,.78),0,4),foliageWindSpeed:clamp(finite(o.foliageWindSpeed,.82),0,4.5),foliageInteractionStrength:clamp(finite(o.foliageInteractionStrength,1),0,4),foliageShadingStrength:clamp(finite(o.foliageShadingStrength,.9),0,2),foliageBendAmount:clamp(finite(o.foliageBendAmount,1),0,3),ambient:clamp(finite(o.ambient,.3),0,2),lighting:o.lighting!==false};
  }
  function classificationFor(instance={}){
    const h=Math.max(0,finite(instance.h,0)),category=String(instance.category||'BROAD_LEAF');
    if(category==='GROUND_MOSS'||category==='SHORT_GRASS'||h<5)return{role:'receiver-only',flags:CLASS_FLAGS.receiver|CLASS_FLAGS.tiny,macroEligible:false,contactEligible:false};
    if(category==='FERN'||category==='FLOWER_CLUSTER')return{role:'contact-receiver',flags:CLASS_FLAGS.receiver|CLASS_FLAGS.contact,macroEligible:false,contactEligible:true};
    const macro=(category==='BUSH'&&h>=8)||(category==='BROAD_LEAF'&&h>=10);
    return{role:macro?'macro-eligible':'contact-receiver',flags:CLASS_FLAGS.receiver|CLASS_FLAGS.contact|(macro?CLASS_FLAGS.macro:0),macroEligible:macro,contactEligible:true};
  }
  function canonicalLightVector(light,screenXY,z=0){const dx=finite(light?.position?.[0],0)-finite(screenXY?.[0],0),dy=-(finite(light?.position?.[1],0)-finite(screenXY?.[1],0)),dz=finite(light?.position?.[2],0)-finite(z,0),d=Math.hypot(dx,dy,dz)||1;return[dx/d,dy/d,dz/d];}
  function rootedWeight(verticalUV,instance,quality=3){return Foliage.RootedDeformation.weight(verticalUV,{root_cutoff:instance?.rootCutoff??.35,bend_exponent:instance?.bendExponent??1.6},quality);}
  function aggregateInteraction(root,sources=[],strength=1){let x=0,y=0;for(const s of sources||[]){const q=Foliage.interactionInfluence(root,s)*finite(s.strength,1)*strength;if(q<=0)continue;const dx=finite(root.x)-finite(s.x),dy=finite(root.y)-finite(s.y),d=Math.hypot(dx,dy)||1;x+=dx/d*q;y+=dy/d*q;}return{x,y};}
  function referenceBend(instance,time,settings={},sources=[]){const s=normalizeSettings(settings),wind=new Foliage.WindField().sample(instance.x,instance.rootY,time,s,instance.variation),inter=aggregateInteraction({x:instance.x,y:instance.rootY},sources,s.foliageInteractionStrength*finite(instance.interactionScale,1));return(wind.x*finite(instance.bendScale,1)*s.foliageBendAmount*2.1+inter.x*2.6)*rootedWeight(1,instance,s.foliageQuality);}
  function shadeFoliageReference(instance,lights=[],visibility={directVisibility:1,ambientVisibility:1},settings={},time=0,sources=[]){
    const s=normalizeSettings(settings),base=colorFor(instance),directVis=clamp(finite(visibility.directVisibility,1),0,1),ambientVis=clamp(finite(visibility.ambientVisibility,1),0,1),bend=referenceBend(instance,time,s,sources),nx=clamp(-bend*.055,-.65,.65),nz=Math.sqrt(Math.max(.001,1-nx*nx));let direct=0;
    if(s.lighting)for(const light of lights||[]){const L=canonicalLightVector(light,[instance.x,instance.rootY],finite(instance.h,0)*.18),NoL=Math.max(0,nx*L[0]+nz*L[2]),dx=finite(light?.position?.[0],0)-instance.x,dy=finite(light?.position?.[1],0)-instance.rootY,d=Math.hypot(dx,dy),radius=Math.max(1,finite(light?.radius,1));if(d>radius)continue;const atten=Math.exp(-2.3*(d/radius)*(d/radius)),lum=finite(light?.color?.[0],1)*.2126+finite(light?.color?.[1],1)*.7152+finite(light?.color?.[2],1)*.0722;direct+=lum*finite(light?.intensity,0)*atten*(.26+.74*NoL);}
    const illum=s.lighting?clamp(s.ambient*ambientVis+direct*directVis*s.foliageShadingStrength,0,2):1;
    return{color:base.map(v=>v*illum),alpha:clamp(.82+finite(instance.tintStrength,.07)*.18,0,1),illumination:illum,directVisibility:directVis,ambientVisibility:ambientVis,bend,emissive:0};
  }
  function copyActorSources(actors=[]){return Array.from(actors||[]).map((a,i)=>({id:String(a?.id??`actor:${i}`),type:a?.type||'actor',x:finite(a?.x),y:finite(a?.y),vx:finite(a?.vx),vy:finite(a?.vy),radius:finite(a?.radius,34),strength:finite(a?.strength,1),halfW:finite(a?.halfW,9),halfH:finite(a?.halfH,10),priority:finite(a?.priority,a?.type==='player'?100:20)}));}
  function packInstances(instances=[]){const n=Math.min(MAX_INSTANCES,instances.length),buf=new ArrayBuffer(n*INSTANCE_STRIDE),f=new Float32Array(buf),u=new Uint32Array(buf);for(let i=0;i<n;i++){const p=instances[i],c=classificationFor(p),base=colorFor(p),o=i*20;f[o]=p.x;f[o+1]=p.rootY;f[o+2]=p.w;f[o+3]=p.h;f[o+4]=finite(p.bendScale,1);f[o+5]=finite(p.rootCutoff,.35);f[o+6]=finite(p.bendExponent,1.6);f[o+7]=finite(p.interactionScale,1);f[o+8]=finite(p.variation,.5);f[o+9]=finite(p.flags,0);f[o+10]=finite(p.depthBias,0);f[o+11]=finite(p.tintStrength,.07);f[o+12]=base[0];f[o+13]=base[1];f[o+14]=base[2];f[o+15]=.92;u[o+16]=c.flags>>>0;u[o+17]=(Foliage.CATEGORY_IDS?.[p.category]??3)>>>0;u[o+18]=i>>>0;u[o+19]=0;}return new Uint8Array(buf);}
  function packParams(width,height,time,settings={},count=0,lightCount=0,debugMode='final'){const s=normalizeSettings(settings),b=new ArrayBuffer(PARAM_BYTES),f=new Float32Array(b),u=new Uint32Array(b);u[0]=Math.max(1,Math.round(width));u[1]=Math.max(1,Math.round(height));u[2]=Math.min(MAX_INSTANCES,Math.max(0,count|0));u[3]=Math.max(0,lightCount|0);f[4]=finite(time,0);f[5]=s.foliageWindStrength;f[6]=s.foliageWindSpeed;f[7]=s.foliageShadingStrength;f[8]=s.foliageBendAmount;f[9]=s.ambient;u[10]=DEBUG_MODES.indexOf(debugMode)>=0?DEBUG_MODES.indexOf(debugMode):0;u[11]=s.foliageQuality;u[12]=s.lighting?1:0;return new Uint8Array(b);}

  class FoliageFrameAuthority{
    constructor(manifest={}){this.registry=new Foliage.FoliageRegistry(manifest);this.interaction=new Foliage.InteractionField();this.depth=new Foliage.DepthClassifier();this.instances=[];this.descriptor=null;this.signature='';this.quality=-1;this.time=0;this.last={foregroundCount:0,backgroundCount:0,dirty:false};}
    setDescriptor(descriptor={},settings={}){const s=normalizeSettings(settings),key=`${descriptor?.signature||''}|q:${s.foliageQuality}`;this.descriptor=descriptor;if(key===this.signature)return false;this.instances=Foliage.generateFoliageInstances(descriptor,this.registry,s.foliageQuality);this.depth.setInstances(this.instances);this.signature=key;this.quality=s.foliageQuality;this.last={foregroundCount:0,backgroundCount:this.instances.length,dirty:false};return true;}
    update(dt,actors=[],settings={},time=null){const s=normalizeSettings(settings);if(s.foliageQuality!==this.quality&&this.descriptor)this.setDescriptor(this.descriptor,s);this.time=Number.isFinite(time)?Number(time):this.time+Math.max(0,finite(dt));const safeActors=copyActorSources(actors),sources=this.interaction.update(Math.max(0,finite(dt)),safeActors,s.foliageQuality);this.last=this.depth.update(Math.max(0,finite(dt)),sources);return{instances:this.instances,sources:this.interaction.bounded(),time:this.time,depth:{...this.last}};}
    snapshot(){const classes={receiverOnly:0,contact:0,macro:0};for(const p of this.instances){const c=classificationFor(p);if(c.role==='receiver-only')classes.receiverOnly++;if(c.contactEligible)classes.contact++;if(c.macroEligible)classes.macro++;}return{schema:SNAPSHOT_SCHEMA,signature:this.signature,instanceCount:this.instances.length,foregroundCount:this.last.foregroundCount||0,classes};}
  }

  const WGSL=`
struct Instance { rootSize:vec4f, profile:vec4f, aux:vec4f, base:vec4f, ids:vec4u };
struct Output { color:vec4f, state:vec4f, ids:vec4u };
struct Light { posRadius:vec4f,colorIntensity:vec4f,directionCone:vec4f,kindFlags:vec4f };
struct Params { sizeCount:vec4u, timeWind:vec4f, shadeAmbient:vec4f, debugQuality:vec4u };
@group(0) @binding(0) var<storage,read> instances:array<Instance>;
@group(0) @binding(1) var<storage,read> lights:array<Light>;
@group(0) @binding(2) var visibilityTex:texture_2d<f32>;
@group(0) @binding(3) var depthTex:texture_depth_2d;
@group(0) @binding(4) var<uniform> params:Params;
@group(0) @binding(5) var<storage,read_write> output:array<Output>;
fn sat(x:f32)->f32{return clamp(x,0.0,1.0);}
fn lightEnergy(i:Instance,p:vec2f,z:f32)->f32{var e=0.0;if(params.debugQuality.x==0u){return 0.0;}for(var k=0u;k<params.sizeCount.w;k++){let lp=lights[k].posRadius.xyz;let Ld=vec3f(lp.x-p.x,-(lp.y-p.y),lp.z-z);let d=length(vec2f(Ld.x,Ld.y));let r=max(lights[k].posRadius.w,1.0);if(d>r){continue;}let L=normalize(Ld);let wind=sin((i.rootSize.x*.88+i.rootSize.y*.26)/216.0*6.2831853+params.timeWind.x*(.34+.34*params.timeWind.z))*params.timeWind.y;let bend=wind*i.profile.x*params.shadeAmbient.x*2.1;let nx=clamp(-bend*.055,-.65,.65);let nz=sqrt(max(.001,1.0-nx*nx));let ndl=max(0.0,nx*L.x+nz*L.z);let lum=dot(lights[k].colorIntensity.rgb,vec3f(.2126,.7152,.0722));let a=exp(-2.3*(d/r)*(d/r));e+=lum*lights[k].colorIntensity.w*a*(.26+.74*ndl);}return e;}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3u){let idx=gid.x;if(idx>=params.sizeCount.z){return;}let i=instances[idx];let px=clamp(i32(round(i.rootSize.x)),0,i32(params.sizeCount.x)-1);let py=clamp(i32(round(i.rootSize.y)),0,i32(params.sizeCount.y)-1);let v=textureLoad(visibilityTex,vec2i(px,py),0);let dep=textureLoad(depthTex,vec2i(px,py),0);let directVis=sat(v.y);let ambientVis=sat(v.z);let direct=lightEnergy(i,i.rootSize.xy,i.rootSize.w*.18);let illum=select(1.0,clamp(params.shadeAmbient.y*ambientVis+direct*directVis*params.timeWind.w,0.0,2.0),params.debugQuality.x!=0u);let wind=sin((i.rootSize.x*.88+i.rootSize.y*.26)/216.0*6.2831853+params.timeWind.x*(.34+.34*params.timeWind.z))*params.timeWind.y;let bend=wind*i.profile.x*params.shadeAmbient.x*2.1;output[idx].color=vec4f(i.base.rgb*illum,i.base.a);output[idx].state=vec4f(illum,directVis,ambientVis,dep);output[idx].ids=vec4u(i.ids.x,i.ids.y,bitcast<u32>(bend),bitcast<u32>(i.aux.y));}
`;

  class WebGPUFoliagePass{
    constructor(device,{width=640,height=360,label='SM-401 foliage'}={}){if(!device)throw new TypeError('WebGPUFoliagePass requires GPUDevice');this.device=device;this.width=Math.max(1,width|0);this.height=Math.max(1,height|0);this.label=label;this.capacity=MAX_INSTANCES;this.count=0;this.lastSnapshot=null;this._init();}
    _init(){const d=this.device;this.instanceBuffer=d.createBuffer({label:`${this.label} instances`,size:MAX_INSTANCES*INSTANCE_STRIDE,usage:usage('STORAGE','COPY_DST')});this.outputBuffer=d.createBuffer({label:`${this.label} output`,size:MAX_INSTANCES*OUTPUT_STRIDE,usage:usage('STORAGE','COPY_SRC')});this.paramBuffer=d.createBuffer({label:`${this.label} params`,size:PARAM_BYTES,usage:usage('UNIFORM','COPY_DST')});const mod=d.createShaderModule({label:`${this.label} shader`,code:WGSL});this.pipeline=d.createComputePipeline({label:`${this.label} pipeline`,layout:'auto',compute:{module:mod,entryPoint:'main'}});}
    sourceFromPaths(lighting,gbuffer,visibility){const views=gbuffer?._views?.()||{},vb=visibility?.bindings?.()||{};const lightBuffer=lighting?.registry?.require?.(Lighting.LIGHT_BUFFER_NAME)?.handle||lighting?.lightBuffer||null;return{lightBuffer,lightCount:lighting?.activeLightCount??lighting?.lastLights?.length??0,visibilityView:vb.visibility||vb.combined||null,depthView:views.depth||null};}
    upload(instances=[]){const packed=packInstances(instances);this.count=Math.min(MAX_INSTANCES,instances.length);if(packed.byteLength)this.device.queue.writeBuffer(this.instanceBuffer,0,packed);return packed.byteLength;}
    encode(encoder,source,settings={},time=0,debugMode='final'){if(!encoder)throw new TypeError('encoder required');if(!source?.lightBuffer||!source?.visibilityView||!source?.depthView)throw new Error('SM-401 requires canonical SM-204 light buffer, SM-203 depth, and SM-307 visibility');const p=packParams(this.width,this.height,time,settings,this.count,source.lightCount||0,debugMode);this.device.queue.writeBuffer(this.paramBuffer,0,p);const bg=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.instanceBuffer}},{binding:1,resource:{buffer:source.lightBuffer}},{binding:2,resource:source.visibilityView},{binding:3,resource:source.depthView},{binding:4,resource:{buffer:this.paramBuffer}},{binding:5,resource:{buffer:this.outputBuffer}}]});const pass=encoder.beginComputePass({label:this.label});pass.setPipeline(this.pipeline);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.max(1,Math.ceil(this.count/64)));pass.end();this.lastSnapshot={schema:SNAPSHOT_SCHEMA,count:this.count,canonicalLightBuffer:Lighting.LIGHT_BUFFER_NAME,inputs:{canonicalDepth:true,shadowVisibility:true},debugMode};return this.lastSnapshot;}
    async readback(){const n=Math.max(1,this.count)*OUTPUT_STRIDE,b=this.device.createBuffer({label:`${this.label} readback`,size:n,usage:usage('MAP_READ','COPY_DST')}),enc=this.device.createCommandEncoder();enc.copyBufferToBuffer(this.outputBuffer,0,b,0,n);this.device.queue.submit([enc.finish()]);await b.mapAsync(root?.GPUMapMode?.READ??MAP_MODE_READ);const copy=new Uint8Array(b.getMappedRange()).slice();b.unmap();b.destroy?.();return copy;}
    diagnostics(){return{schema:SCHEMA,count:this.count,capacity:this.capacity,instanceStride:INSTANCE_STRIDE,outputStride:OUTPUT_STRIDE,canonicalLightBuffer:Lighting.LIGHT_BUFFER_NAME,palette:'dark-teal/non-emissive',lastSnapshot:clone(this.lastSnapshot)};}
  }

  return{SCHEMA,SNAPSHOT_SCHEMA,MAX_INSTANCES,INSTANCE_STRIDE,OUTPUT_STRIDE,PARAM_BYTES,CLASS_FLAGS,DEBUG_MODES,PALETTE,DEFAULTS,WGSL,normalizeSettings,classificationFor,canonicalLightVector,rootedWeight,aggregateInteraction,referenceBend,shadeFoliageReference,copyActorSources,packInstances,packParams,FoliageFrameAuthority,WebGPUFoliagePass};
});
