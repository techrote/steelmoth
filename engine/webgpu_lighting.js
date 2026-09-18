'use strict';

(function(root,factory){
  const Resources=root?.SteelMothWebGPUResources||((typeof module==='object'&&module.exports)?require('./webgpu_resources.js'):null);
  const GBuffer=root?.SteelMothWebGPUGBuffer||((typeof module==='object'&&module.exports)?require('./webgpu_gbuffer.js'):null);
  const api=factory(Resources,GBuffer,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPULighting=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,GBuffer,root){
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before webgpu_lighting');
  if(!GBuffer)throw new Error('SteelMothWebGPUGBuffer is required before webgpu_lighting');

  const SCHEMA='steelmoth-webgpu-lighting/v1';
  const MAX_LIGHTS=17; // v1.2.3 allows 16 point lights plus the player cone.
  const LIGHT_STRIDE=64;
  const OUTPUT_FORMAT='rgba16float';
  const DEBUG_MODES=Object.freeze(['final','diffuse','specular','light-count']);
  const LIGHT_TYPE=Object.freeze({point:0,cone:1});
  const LIGHT_FLAGS=Object.freeze({independent:1,player:2,cone:4});
  const DEFAULT_Z=Object.freeze({playerOmni:22,pulse:19,objective:18,companion:13,fragment:9,orbiter:8,ambientLife:8,firefly:6});
  const DIAGNOSTIC_PRESET=Object.freeze({
    emissive:2.0,lightRadius:2.0,playerOmniRadius:80,playerOmniIntensity:1.6,
    playerConeIntensity:2.0,playerConeInnerAngle:30,playerConeOuterAngle:60,
    ambient:.10,normalStrength:1,heightStrength:1,roughnessScale:1,metalnessScale:1,
    materialAOStrength:.62,pbrSpecularStrength:.70
  });
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,TEXTURE_BINDING:0x04,RENDER_ATTACHMENT:0x10});
  const MAP_MODE_READ=0x0001;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const bufferUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const textureUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUTextureUsage?.[n]??FALLBACK_TEXTURE_USAGE[n]??0),0);
  const vadd=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const vsub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const vmul=(a,b)=>Array.isArray(b)?[a[0]*b[0],a[1]*b[1],a[2]*b[2]]:[a[0]*b,a[1]*b,a[2]*b];
  const vdiv=(a,b)=>[a[0]/b[0],a[1]/b[1],a[2]/b[2]];
  const vdot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const vlen=a=>Math.hypot(a[0],a[1],a[2]);
  const vnorm=a=>{const d=vlen(a)||1;return[a[0]/d,a[1]/d,a[2]/d]};
  const vmix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
  const vmax=(a,x=0)=>[Math.max(x,a[0]),Math.max(x,a[1]),Math.max(x,a[2])];
  const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};

  function lightElevation(light){
    if(Number.isFinite(Number(light?.z)))return Number(light.z);
    return DEFAULT_Z[String(light?.group||'')]??12;
  }
  function isCone(light){return String(light?.type||'').toLowerCase()==='cone'||String(light?.id||'')==='light:player-cone:0'||('innerCos'in(light||{})&&'outerCos'in(light||{}));}
  function normalizedColor(value){return Array.isArray(value)?[finite(value[0],1),finite(value[1],1),finite(value[2],1)]:[1,1,1]}
  function buildCanonicalLights(scene={},settings={}){
    if(settings.lighting===false)return[];
    const source=[],seen=new Set();
    for(const light of scene.lights||[]){const id=String(light?.id||`light:${source.length}`);if(seen.has(id))continue;seen.add(id);source.push(light)}
    if(scene.playerCone){const id=String(scene.playerCone.id||'light:player-cone:0');if(!seen.has(id)){seen.add(id);source.push(scene.playerCone)}}
    const out=[];
    for(const raw of source){
      if(out.length>=MAX_LIGHTS)break;
      const cone=isCone(raw),group=String(raw.group||raw.type||'point'),independent=!!raw.independent;
      const radius=Math.max(0,finite(cone?(raw.range??raw.radius):raw.radius,0))*(cone?1:clamp(finite(settings.lightRadius,1),.5,4));
      if(radius<=0)continue;
      const intensity=Math.max(0,finite(raw.intensity,0))*(cone||independent?1:clamp(finite(settings.emissive,1),0,2.5));
      if(intensity<=0)continue;
      const flags=(independent?LIGHT_FLAGS.independent:0)|(String(raw.id||'').includes('player')||group==='playerOmni'?LIGHT_FLAGS.player:0)|(cone?LIGHT_FLAGS.cone:0);
      let dx=finite(raw.dx,1),dy=finite(raw.dy,0),dl=Math.hypot(dx,dy);if(dl<1e-6){dx=1;dy=0;dl=1}dx/=dl;dy/=dl;
      out.push({
        id:String(raw.id||`light:${out.length}`),type:cone?'cone':'point',typeValue:cone?LIGHT_TYPE.cone:LIGHT_TYPE.point,flags,group,
        position:[finite(raw.x,0),finite(raw.y,0),lightElevation(raw)],radius,
        color:normalizedColor(raw.color),intensity,
        direction:[dx,dy],innerCos:cone?clamp(finite(raw.innerCos,Math.cos(17*Math.PI/180)),-1,1):1,
        outerCos:cone?clamp(finite(raw.outerCos,Math.cos(30*Math.PI/180)),-1,1):-1
      });
    }
    return out;
  }
  function packLights(lights){
    const data=new ArrayBuffer(MAX_LIGHTS*LIGHT_STRIDE),dv=new DataView(data);
    for(let i=0;i<Math.min(MAX_LIGHTS,lights.length);i++){
      const l=lights[i],o=i*LIGHT_STRIDE,f=(off,v)=>dv.setFloat32(o+off,finite(v,0),true);
      [l.position?.[0],l.position?.[1],l.position?.[2],l.radius].forEach((v,j)=>f(j*4,v));
      [l.color?.[0],l.color?.[1],l.color?.[2],l.intensity].forEach((v,j)=>f(16+j*4,v));
      [l.direction?.[0],l.direction?.[1],l.innerCos,l.outerCos].forEach((v,j)=>f(32+j*4,v));
      [l.typeValue,l.flags,0,0].forEach((v,j)=>f(48+j*4,v));
    }
    return new Uint8Array(data);
  }
  function frameBytes(width,height,settings,lightCount,debugMode){
    const data=new ArrayBuffer(64),dv=new DataView(data),f=(o,v)=>dv.setFloat32(o,finite(v,0),true),u=(o,v)=>dv.setUint32(o,Number(v)>>>0,true);
    f(0,width);f(4,height);f(8,settings.lighting===false?1:clamp(finite(settings.ambient,.3),0,2));f(12,clamp(finite(settings.normalStrength,1),0,3));
    f(16,clamp(finite(settings.heightStrength,1),0,3));f(20,clamp(finite(settings.roughnessScale,1),.2,2));f(24,clamp(finite(settings.metalnessScale,1),0,2));f(28,clamp(finite(settings.materialAOStrength,.62),0,1));
    f(32,clamp(finite(settings.pbrSpecularStrength,.70),0,2));u(48,lightCount);u(52,debugMode);return new Uint8Array(data);
  }

  function fresnel(F0,VoH){const p=Math.pow(1-clamp(VoH,0,1),5);return F0.map(v=>v+(1-v)*p)}
  function dGGX(NoH,a){const a2=a*a,d=NoH*NoH*(a2-1)+1;return a2/Math.max(Math.PI*d*d,1e-5)}
  function g1(NoV,k){return NoV/Math.max(NoV*(1-k)+k,1e-4)}
  function shadePixelReference(sample,lights,settings={},screenXY=[0,0],debug='final'){
    const al=(sample.albedo||sample.g0||[0,0,0,0]).slice(0,4);if((al[3]??1)<.002)return[0,0,0,0];
    const nr=sample.normalRoughness||sample.g1||[.5,.5,1,.88],hm=sample.heightMaterial||sample.g2||[0,0,1,0];
    const ns=clamp(finite(settings.normalStrength,1),0,3),n=vnorm([(nr[0]*2-1)*ns,(nr[1]*2-1)*ns,nr[2]*2-1]);
    const rough=clamp(nr[3]*clamp(finite(settings.roughnessScale,1),.2,2),.06,1),metal=clamp(hm[1]*clamp(finite(settings.metalnessScale,1),0,2),0,1),mao=1+(hm[2]-1)*clamp(finite(settings.materialAOStrength,.62),0,1),em=hm[3],z=hm[0]*64*clamp(finite(settings.heightStrength,1),0,3);
    const V=vnorm([0,-.12,1]),F0=vmix([.04,.04,.04],al,metal);let diff=[0,0,0],spec=[0,0,0];
    for(const light of lights||[]){
      let radiance,NoL,L;
      if(light.type==='cone'){
        const q=[screenXY[0]-light.position[0],screenXY[1]-light.position[1]],dxy=Math.hypot(q[0],q[1]);if(dxy>=light.radius||dxy<=.5)continue;const co=(q[0]*light.direction[0]+q[1]*light.direction[1])/dxy,edge=smoothstep(light.outerCos,light.innerCos,co),fade=Math.pow(Math.max(0,1-dxy/light.radius),.42);if(edge<=0||fade<=0)continue;
        const Ld=[light.position[0]-screenXY[0],light.position[1]-screenXY[1],light.position[2]-z];L=vnorm([Ld[0],-Ld[1],Ld[2]]);NoL=Math.max(vdot(n,L),0);radiance=vmul(light.color,light.intensity*edge*fade);
      }else{
        const Ld=[light.position[0]-screenXY[0],light.position[1]-screenXY[1],light.position[2]-z],d=vlen(Ld);if(d>light.radius||d<.5)continue;L=vnorm([Ld[0],-Ld[1],Ld[2]]);NoL=Math.max(vdot(n,L),0);const att=Math.exp(-2.3*(d/light.radius)*(d/light.radius))*light.intensity;radiance=vmul(light.color,att);
      }
      const NoV=Math.max(vdot(n,V),.02);if(NoL<=0)continue;const H=vnorm(vadd(V,L)),NoH=Math.max(vdot(n,H),0),VoH=Math.max(vdot(V,H),0),a=Math.max(.045,rough*rough),D=dGGX(NoH,a),k=(rough+1)*(rough+1)/8,G=g1(NoV,k)*g1(NoL,k),F=fresnel(F0,VoH),sp=F.map(v=>D*G*v/Math.max(4*NoV*NoL,.04)),kd=F.map(v=>(1-v)*(1-metal));
      diff=vadd(diff,vmul(vmul(vmul(kd,al),(NoL*.86+.14)),radiance));spec=vadd(spec,vmul(vmul(sp,radiance),clamp(finite(settings.pbrSpecularStrength,.70),0,2)));
    }
    if(debug==='diffuse')return[...diff,1];if(debug==='specular')return[...spec,1];if(debug==='light-count')return[clamp((lights?.length||0)/MAX_LIGHTS,0,1),clamp((lights?.length||0)/MAX_LIGHTS,0,1),clamp((lights?.length||0)/MAX_LIGHTS,0,1),1];
    const ambient=vmul(vmul(al,(settings.lighting===false?1:clamp(finite(settings.ambient,.3),0,2))*(.72+.28*mao)),vmix([1,1,1],[.96,1,1.03],metal*.15)),direct=vadd(diff,spec),bounded=vdiv(direct,direct.map(v=>1+v*.22)),final=vadd(vadd(ambient,bounded),vmul(al,em*.8));return[...vmax(final,0),al[3]??1];
  }

  const DEFERRED_WGSL=`
const PI:f32=3.141592653589793;
const MAX_LIGHTS:u32=${MAX_LIGHTS}u;
struct Light { posRadius:vec4f,colorIntensity:vec4f,directionCone:vec4f,meta:vec4f };
struct Frame { p0:vec4f,p1:vec4f,p2:vec4f,counts:vec4u };
@group(0) @binding(0) var g0:texture_2d<f32>;
@group(0) @binding(1) var g1:texture_2d<f32>;
@group(0) @binding(2) var g2:texture_2d<f32>;
@group(0) @binding(3) var<storage,read> lights:array<Light>;
@group(0) @binding(4) var<uniform> frame:Frame;
fn D_GGX(NoH:f32,a:f32)->f32{let a2=a*a;let d=NoH*NoH*(a2-1.0)+1.0;return a2/max(PI*d*d,1e-5);}
fn G1(NoV:f32,k:f32)->f32{return NoV/max(NoV*(1.0-k)+k,1e-4);}
fn fres(F0:vec3f,VoH:f32)->vec3f{return F0+(vec3f(1)-F0)*pow(1.0-VoH,5.0);}
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[vi],0,1);}
@fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) vec4f{
  let q=vec2i(p.xy);let al=textureLoad(g0,q,0);if(al.a<.002){return vec4f(0);}
  let nr=textureLoad(g1,q,0);let hm=textureLoad(g2,q,0);let normalStrength=frame.p0.w;let heightStrength=frame.p1.x;let roughnessScale=frame.p1.y;let metalnessScale=frame.p1.z;let materialAO=frame.p1.w;let pbrSpecular=frame.p2.x;
  let n=normalize(vec3f((nr.rg*2.0-1.0)*normalStrength,nr.b*2.0-1.0));let rough=clamp(nr.a*roughnessScale,.06,1.0);let metal=clamp(hm.g*metalnessScale,0.0,1.0);let mao=mix(1.0,hm.b,materialAO);let em=hm.a;let z=hm.r*64.0*heightStrength;let Pxy=p.xy;
  let V=normalize(vec3f(0.0,-.12,1.0));let F0=mix(vec3f(.04),al.rgb,metal);var diffSum=vec3f(0);var specSum=vec3f(0);
  for(var i:u32=0u;i<MAX_LIGHTS;i++){
    if(i>=frame.counts.x){break;}let light=lights[i];let cone=light.meta.x>.5;var L:vec3f;var radiance=vec3f(0);var NoL:f32;
    if(cone){let xy=Pxy-light.posRadius.xy;let d=length(xy);if(d>=light.posRadius.w||d<=.5){continue;}let dn=xy/d;let co=dot(dn,light.directionCone.xy);let edge=smoothstep(light.directionCone.w,light.directionCone.z,co);let fade=pow(max(0.0,1.0-d/light.posRadius.w),.42);if(edge<=0.0||fade<=0.0){continue;}let Ld=light.posRadius.xyz-vec3f(Pxy,z);L=normalize(vec3f(Ld.x,-Ld.y,Ld.z));NoL=max(dot(n,L),0.0);radiance=light.colorIntensity.rgb*light.colorIntensity.a*edge*fade;
    }else{let Ld=light.posRadius.xyz-vec3f(Pxy,z);let d=length(Ld);if(d>light.posRadius.w||d<.5){continue;}L=normalize(vec3f(Ld.x,-Ld.y,Ld.z));NoL=max(dot(n,L),0.0);let att=exp(-2.3*(d/light.posRadius.w)*(d/light.posRadius.w))*light.colorIntensity.a;radiance=light.colorIntensity.rgb*att;}
    let NoV=max(dot(n,V),.02);if(NoL<=0.0){continue;}let H=normalize(V+L);let NoH=max(dot(n,H),0.0);let VoH=max(dot(V,H),0.0);let a=max(.045,rough*rough);let D=D_GGX(NoH,a);let k=(rough+1.0)*(rough+1.0)/8.0;let G=G1(NoV,k)*G1(NoL,k);let F=fres(F0,VoH);let spec=(D*G*F)/max(4.0*NoV*NoL,.04);let kd=(vec3f(1)-F)*(1.0-metal);diffSum+=kd*al.rgb*(NoL*.86+.14)*radiance;specSum+=spec*radiance*pbrSpecular;
  }
  if(frame.counts.y==1u){return vec4f(diffSum,1);}if(frame.counts.y==2u){return vec4f(specSum,1);}if(frame.counts.y==3u){let c=f32(frame.counts.x)/f32(MAX_LIGHTS);return vec4f(vec3f(c),1);}
  let ambient=al.rgb*(frame.p0.z*(.72+.28*mao))*mix(vec3f(1),vec3f(.96,1.0,1.03),metal*.15);let direct=max(vec3f(0),diffSum+specSum);direct=direct/(vec3f(1)+direct*.22);let final=max(vec3f(0),ambient+direct+al.rgb*em*.8);return vec4f(final,al.a);
}`;

  function halfToFloat(h){h=Number(h)&0xffff;const s=(h>>15)&1,e=(h>>10)&31,f=h&1023;if(e===0)return(s?-1:1)*Math.pow(2,-14)*(f/1024);if(e===31)return f?NaN:(s?-Infinity:Infinity);return(s?-1:1)*Math.pow(2,e-15)*(1+f/1024)}

  class WebGPUDeferredLighting{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUDeferredLighting requires GPUDevice');this.device=options.device;this.queue=options.queue||options.device.queue;this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));this.labelPrefix=String(options.labelPrefix||'SteelMothLighting');this.ownsRegistry=!options.registry;this.registry=options.registry||new Resources.ResourceRegistry({device:this.device,queue:this.queue,width:this.width,height:this.height,labelPrefix:this.labelPrefix});this.pipelines=options.pipelines||new Resources.PipelineCache(this.device,{labelPrefix:`${this.labelPrefix}:pipeline`});this.pipeline=null;this.module=null;this.compilation=[];this.renderCount=0;this.activeLightCount=0;this.lastLights=[];this.lastDebugMode='final';this._defineResources();
    }
    _name(n){return `sm204:${n}`}
    _defineResources(){
      const ensureBuffer=(name,size,usage)=>{if(!this.registry.get(this._name(name)))this.registry.defineBuffer(this._name(name),{size,usage})};const ensureTexture=(name,format,usage)=>{if(!this.registry.get(this._name(name)))this.registry.defineTexture(this._name(name),{format,usage,size:'surface'})};
      ensureBuffer('lights',MAX_LIGHTS*LIGHT_STRIDE,bufferUsage(['STORAGE','COPY_DST']));ensureBuffer('frame',64,bufferUsage(['UNIFORM','COPY_DST']));ensureTexture('lit',OUTPUT_FORMAT,textureUsage(['RENDER_ATTACHMENT','TEXTURE_BINDING','COPY_SRC']));
    }
    async _module(label,code){const module=this.device.createShaderModule({label:`${this.labelPrefix}:${label}`,code});let messages=[];if(typeof module.getCompilationInfo==='function')messages=Array.from((await module.getCompilationInfo()).messages||[]).map(m=>({type:m.type,message:m.message,lineNum:m.lineNum,linePos:m.linePos}));const errors=messages.filter(m=>m.type==='error');this.compilation.push({label,messages});if(errors.length)throw new Error(`${label} WGSL compilation failed: ${errors.map(e=>e.message).join(' | ')}`);return module}
    async initialize(){if(this.pipeline)return this;this.module=await this._module('sm204-deferred-lighting',DEFERRED_WGSL);this.pipeline=await this.pipelines.getRender('sm204-deferred-lighting',()=>this.device.createRenderPipeline({label:`${this.labelPrefix}:sm204-deferred`,layout:'auto',vertex:{module:this.module,entryPoint:'vs_main'},fragment:{module:this.module,entryPoint:'fs_main',targets:[{format:OUTPUT_FORMAT}]},primitive:{topology:'triangle-list'}}));return this}
    _gRecord(gbuffer,name){return gbuffer?.registry?.require?.(`sm200:${name}`)||this.registry.require(`sm200:${name}`)}
    async render(gbuffer,scene={},settings={},options={}){
      await this.initialize();if(!gbuffer?.registry)throw new Error('SM-204 lighting requires the SM-200/202 G-buffer registry');const lights=buildCanonicalLights(scene,settings),debug=String(options.debug||'final'),debugMode=DEBUG_MODES.indexOf(debug);if(debugMode<0)throw new Error(`unknown SM-204 debug mode: ${debug}`);
      this.queue.writeBuffer(this.registry.require(this._name('lights')).handle,0,packLights(lights));this.queue.writeBuffer(this.registry.require(this._name('frame')).handle,0,frameBytes(this.width,this.height,settings,lights.length,debugMode));
      const output=this.registry.require(this._name('lit')),bind=this.device.createBindGroup({label:`${this.labelPrefix}:sm204-bind`,layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this._gRecord(gbuffer,'g0').handle.createView()},{binding:1,resource:this._gRecord(gbuffer,'g1').handle.createView()},{binding:2,resource:this._gRecord(gbuffer,'g2').handle.createView()},{binding:3,resource:{buffer:this.registry.require(this._name('lights')).handle}},{binding:4,resource:{buffer:this.registry.require(this._name('frame')).handle}}]}),encoder=this.device.createCommandEncoder({label:`${this.labelPrefix}:sm204-frame`}),pass=encoder.beginRenderPass({label:`${this.labelPrefix}:sm204-deferred-pass`,colorAttachments:[{view:output.handle.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();this.queue.submit([encoder.finish()]);if(options.wait!==false&&typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();this.renderCount++;this.activeLightCount=lights.length;this.lastLights=lights.map(clone);this.lastDebugMode=debug;return{schema:SCHEMA,activeLightCount:lights.length,debugMode:debug,outputFormat:OUTPUT_FORMAT,lightBuffer:this._name('lights')};
    }
    resize(width,height){width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));const changed=this.registry.resize(width,height);this.width=width;this.height=height;return changed}
    outputTexture(){return this.registry.require(this._name('lit')).handle}
    async readPixel(x,y){const record=this.registry.require(this._name('lit')),buffer=this.device.createBuffer({label:`${this.labelPrefix}:sm204-readback`,size:256,usage:bufferUsage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:record.handle,origin:{x:Math.max(0,Math.min(record.width-1,Math.floor(x))),y:Math.max(0,Math.min(record.height-1,Math.floor(y))),z:0}},{buffer,bytesPerRow:256,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);await buffer.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(buffer.getMappedRange()).slice(0,8);buffer.unmap();buffer.destroy();const dv=new DataView(raw.buffer,raw.byteOffset,8);return[0,2,4,6].map(o=>halfToFloat(dv.getUint16(o,true)))}
    diagnostics(){return{schema:SCHEMA,extent:{width:this.width,height:this.height},maxLights:MAX_LIGHTS,lightStride:LIGHT_STRIDE,oneCanonicalLightBuffer:this._name('lights'),activeLightCount:this.activeLightCount,lastDebugMode:this.lastDebugMode,debugModes:[...DEBUG_MODES],outputFormat:OUTPUT_FORMAT,renderCount:this.renderCount,lights:this.lastLights.map(clone),compilation:clone(this.compilation),pbr:{model:'restrained-ggx-schlick-smith-v123-parity',dielectricF0:.04,directClamp:.22,viewVector:[0,-.12,1],selfShadow:'deferred-sm205',contactShadow:'deferred-sm205'},resourceDiagnostics:this.registry.diagnostics(),pipelineDiagnostics:this.pipelines.diagnostics()}}
    close(){if(this.ownsRegistry)this.registry.close()}
  }

  return{SCHEMA,MAX_LIGHTS,LIGHT_STRIDE,OUTPUT_FORMAT,DEBUG_MODES,LIGHT_TYPE,LIGHT_FLAGS,DEFAULT_Z,DIAGNOSTIC_PRESET,DEFERRED_WGSL,lightElevation,buildCanonicalLights,packLights,shadePixelReference,halfToFloat,WebGPUDeferredLighting};
});
