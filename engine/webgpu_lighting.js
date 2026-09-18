'use strict';

(function(root,factory){
  const Resources=root?.SteelMothWebGPUResources||((typeof module==='object'&&module.exports)?require('./webgpu_resources.js'):null);
  const api=factory(Resources,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPULighting=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,root){
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before webgpu_lighting');

  const SCHEMA='steelmoth-webgpu-lighting/v1';
  const MAX_LIGHTS=16;
  const LIGHT_STRIDE=64;
  const LIGHT_TYPES=Object.freeze({point:0,omni:1,cone:2});
  const DEBUG_MODES=Object.freeze(['final','diffuse','specular','light-count']);
  const DIAGNOSTIC_PRESET=Object.freeze({
    emissive:2,lightRadius:2,playerOmniRadius:80,playerOmniIntensity:1.6,
    playerConeIntensity:2,playerConeInnerAngle:30,playerConeOuterAngle:60
  });
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,COPY_DST:0x02,TEXTURE_BINDING:0x04,RENDER_ATTACHMENT:0x10});
  const MAP_MODE_READ=0x0001;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const usageValue=(group,name,fallback)=>Number(root?.[group]?.[name]??fallback);
  const bufferUsage=names=>names.reduce((v,n)=>v|usageValue('GPUBufferUsage',n,FALLBACK_BUFFER_USAGE[n]||0),0);
  const textureUsage=names=>names.reduce((v,n)=>v|usageValue('GPUTextureUsage',n,FALLBACK_TEXTURE_USAGE[n]||0),0);
  const normalize2=(x,y)=>{const d=Math.hypot(x,y);return d>1e-7?[x/d,y/d]:[1,0]};
  const rgb=v=>Array.isArray(v)?[finite(v[0],1),finite(v[1],1),finite(v[2],1)]:[1,1,1];
  const degCos=d=>Math.cos(finite(d,0)*Math.PI/180);

  function typeName(light){const raw=String(light?.type||light?.group||'point').toLowerCase();if(raw.includes('cone'))return 'cone';if(raw.includes('omni'))return 'omni';return 'point'}
  function coneDirection(light){
    if(Array.isArray(light?.direction))return normalize2(finite(light.direction[0],1),finite(light.direction[1],0));
    if(Number.isFinite(Number(light?.dx))||Number.isFinite(Number(light?.dy)))return normalize2(finite(light.dx,1),finite(light.dy,0));
    if(Number.isFinite(Number(light?.dirX))||Number.isFinite(Number(light?.dirY)))return normalize2(finite(light.dirX,1),finite(light.dirY,0));
    if(Number.isFinite(Number(light?.angle)))return [Math.cos(finite(light.angle,0)),Math.sin(finite(light.angle,0))];
    if(Number.isFinite(Number(light?.angleDeg))){const a=finite(light.angleDeg,0)*Math.PI/180;return [Math.cos(a),Math.sin(a)]}
    return [1,0];
  }
  function coneCos(light,which){
    const direct=light?.[`${which}Cos`];if(Number.isFinite(Number(direct)))return finite(direct);
    const names=which==='inner'?['innerAngle','innerAngleDeg','innerDeg']:['outerAngle','outerAngleDeg','outerDeg'];
    for(const n of names)if(Number.isFinite(Number(light?.[n])))return degCos(light[n]);
    return degCos(which==='inner'?17:30);
  }
  function canonicalLight(light,index,settings={}){
    const name=typeName(light),type=LIGHT_TYPES[name],dir=coneDirection(light),range=finite(light?.range,finite(light?.radius,1)),radius=Math.max(1,range*(name==='cone'?1:Math.max(.01,finite(settings.lightRadius,1))));
    return {
      id:String(light?.id||`light:${index}`),type:name,typeCode:type,flags:Number(light?.flags||0)>>>0,
      x:finite(light?.x,0),y:finite(light?.y,0),z:finite(light?.z,finite(light?.height,22)),radius,
      color:rgb(light?.color),intensity:Math.max(0,finite(light?.intensity,1)*(name==='cone'||light?.independent?1:Math.max(0,finite(settings.emissive,1)))),
      direction:dir,innerCos:coneCos(light,'inner'),outerCos:coneCos(light,'outer'),enabled:light?.enabled===false?false:true
    };
  }
  function buildCanonicalLights(scene,settings={},options={}){
    const max=Math.max(1,Math.min(MAX_LIGHTS,Math.round(options.maxLights||MAX_LIGHTS))),source=settings.lighting===false?[]:Array.from(scene?.lights||[]),lights=[];
    for(let i=0;i<source.length&&lights.length<max;i++){const l=canonicalLight(source[i],i,settings);if(l.enabled&&l.radius>0&&l.intensity>0)lights.push(l)}
    return lights;
  }
  function packLights(lights,maxLights=MAX_LIGHTS){
    maxLights=Math.max(1,Math.min(MAX_LIGHTS,Math.round(maxLights||MAX_LIGHTS)));const buffer=new ArrayBuffer(maxLights*LIGHT_STRIDE),dv=new DataView(buffer);
    for(let i=0;i<Math.min(lights.length,maxLights);i++){
      const l=lights[i],o=i*LIGHT_STRIDE,c=l.color||[1,1,1],d=l.direction||[1,0];
      const f=(off,v)=>dv.setFloat32(o+off,finite(v,0),true),u=(off,v)=>dv.setUint32(o+off,Number(v)>>>0,true);
      f(0,l.x);f(4,l.y);f(8,l.z);f(12,l.radius);f(16,c[0]);f(20,c[1]);f(24,c[2]);f(28,l.intensity);
      f(32,d[0]);f(36,d[1]);f(40,l.innerCos);f(44,l.outerCos);u(48,l.typeCode);u(52,l.flags);u(56,l.enabled===false?0:1);u(60,0);
    }
    return new Uint8Array(buffer);
  }

  const LIGHTING_WGSL=`
const PI:f32=3.141592653589793;
const MAX_LIGHTS:u32=${MAX_LIGHTS}u;
struct Light { positionRadius:vec4f,colorIntensity:vec4f,directionInnerOuter:vec4f,meta:vec4u };
struct Frame { logicalAmbient:vec4f,materialScales:vec4f,lightingScales:vec4f,counts:vec4u };
@group(0) @binding(0) var g0:texture_2d<f32>;
@group(0) @binding(1) var g1:texture_2d<f32>;
@group(0) @binding(2) var g2:texture_2d<f32>;
@group(0) @binding(3) var<storage,read> lights:array<Light>;
@group(0) @binding(4) var<uniform> frame:Frame;
fn D_GGX(NoH:f32,a:f32)->f32{let a2=a*a;let d=NoH*NoH*(a2-1.0)+1.0;return a2/max(PI*d*d,1e-5);}
fn G1(NoV:f32,k:f32)->f32{return NoV/max(NoV*(1.0-k)+k,1e-4);}
fn fres(F0:vec3f,VoH:f32)->vec3f{return F0+(vec3f(1.0)-F0)*pow(1.0-VoH,5.0);}
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[vi],0,1);}
struct Terms { diffuse:vec3f,specular:vec3f,active:u32 };
fn evaluateLight(light:Light,Pxy:vec2f,z:f32,n:vec3f,V:vec3f,F0:vec3f,albedo:vec3f,rough:f32,metal:f32)->Terms{
  var out:Terms;out.diffuse=vec3f(0);out.specular=vec3f(0);out.active=0u;if(light.meta.z==0u){return out;}
  let type=light.meta.x;let q=Pxy-light.positionRadius.xy;let planar=length(q);var shape:f32=1.0;
  if(type==2u){if(planar>=light.positionRadius.w||planar<=.5){return out;}let dn=q/planar;let co=dot(dn,normalize(light.directionInnerOuter.xy));shape=smoothstep(light.directionInnerOuter.w,light.directionInnerOuter.z,co)*pow(max(0.0,1.0-planar/light.positionRadius.w),.42);if(shape<=0.0){return out;}}
  let Ld=light.positionRadius.xyz-vec3f(Pxy,z);let dist=length(Ld);if(type!=2u&&dist>light.positionRadius.w){return out;}if(dist<.5){return out;}
  let L=normalize(vec3f(Ld.x,-Ld.y,Ld.z));let NoL=max(dot(n,L),0.0);let NoV=max(dot(n,V),.02);if(NoL<=0.0){return out;}
  var attenuation:f32;if(type==2u){attenuation=light.colorIntensity.w*shape;}else{let rq=dist/max(1.0,light.positionRadius.w);attenuation=exp(-2.3*rq*rq)*light.colorIntensity.w;}
  let H=normalize(V+L);let NoH=max(dot(n,H),0.0);let VoH=max(dot(V,H),0.0);let a=max(.045,rough*rough);let D=D_GGX(NoH,a);let k=(rough+1.0)*(rough+1.0)/8.0;let G=G1(NoV,k)*G1(NoL,k);let F=fres(F0,VoH);let spec=(D*G*F)/max(4.0*NoV*NoL,.04);let kd=(vec3f(1.0)-F)*(1.0-metal);let radiance=light.colorIntensity.rgb*attenuation;
  out.diffuse=kd*albedo*(NoL*.86+.14)*radiance;out.specular=spec*radiance*frame.lightingScales.y;out.active=1u;return out;
}
@fragment fn fs_main(@builtin(position) pos:vec4f)->@location(0) vec4f{
  let q=vec2i(pos.xy);let al=textureLoad(g0,q,0);if(al.a<.002){return vec4f(0);}
  let nr=textureLoad(g1,q,0);let hm=textureLoad(g2,q,0);let n=normalize(vec3f((nr.rg*2.0-1.0)*frame.materialScales.x,nr.b*2.0-1.0));let rough=clamp(nr.a*frame.materialScales.y,.06,1.0);let metal=clamp(hm.g*frame.materialScales.z,0.0,1.0);let mao=mix(1.0,hm.b,frame.materialScales.w);let emissive=hm.a;let z=hm.r*64.0*frame.lightingScales.x;
  let Pxy=vec2f(pos.x,frame.logicalAmbient.y-pos.y);let V=normalize(vec3f(0.0,-.12,1.0));let F0=mix(vec3f(.04),al.rgb,metal);var diff=vec3f(0);var spec=vec3f(0);var active:u32=0u;
  for(var i:u32=0u;i<MAX_LIGHTS;i++){if(i>=frame.counts.x){break;}let t=evaluateLight(lights[i],Pxy,z,n,V,F0,al.rgb,rough,metal);diff+=t.diffuse;spec+=t.specular;active+=t.active;}
  let ambient=al.rgb*(frame.logicalAmbient.z*(.72+.28*mao))*mix(vec3f(1.0),vec3f(.96,1.0,1.03),metal*.15);var direct=max(vec3f(0),diff+spec);direct=direct/(vec3f(1.0)+direct*.22);let final=max(vec3f(0),ambient+direct+al.rgb*emissive*frame.logicalAmbient.w);
  let mode=frame.counts.y;if(mode==1u){return vec4f(diff,1);}if(mode==2u){return vec4f(spec,1);}if(mode==3u){return vec4f(vec3f(f32(active)/f32(MAX_LIGHTS)),1);}return vec4f(final,al.a);
}`;

  function halfToFloat(h){h=Number(h)&0xffff;const s=(h>>15)&1,e=(h>>10)&31,f=h&1023;if(e===0)return(s?-1:1)*Math.pow(2,-14)*(f/1024);if(e===31)return f?NaN:(s?-Infinity:Infinity);return(s?-1:1)*Math.pow(2,e-15)*(1+f/1024)}
  function v3(x=0,y=0,z=0){return[x,y,z]}
  function add3(a,b){return[a[0]+b[0],a[1]+b[1],a[2]+b[2]]}
  function mul3(a,b){return Array.isArray(b)?[a[0]*b[0],a[1]*b[1],a[2]*b[2]]:[a[0]*b,a[1]*b,a[2]*b]}
  function mix3(a,b,t){return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]}
  function norm3(a){const d=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/d,a[1]/d,a[2]/d]}
  function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
  function fres3(F0,v){const f=Math.pow(1-v,5);return F0.map(x=>x+(1-x)*f)}
  function smoothstep(a,b,x){const t=clamp((x-a)/Math.max(1e-9,b-a),0,1);return t*t*(3-2*t)}
  function shadeReferencePixel(material,pixel,lights,settings={}){
    const al=rgb(material?.albedo||[1,1,1]),rawN=material?.normal||[0,0,1],normalStrength=finite(settings.normalStrength,1),n=norm3([finite(rawN[0])*normalStrength,finite(rawN[1])*normalStrength,finite(rawN[2],1)]),rough=clamp(finite(material?.roughness,1)*finite(settings.roughnessScale,1),.06,1),metal=clamp(finite(material?.metalness,0)*finite(settings.metalnessScale,1),0,1),mao=1+(finite(material?.ao,1)-1)*finite(settings.materialAOStrength,.62),em=finite(material?.emissive,0),z=finite(material?.height,0)*64*finite(settings.heightStrength,1),P=[finite(pixel?.x),finite(pixel?.y)],V=norm3([0,-.12,1]),F0=mix3([.04,.04,.04],al,metal),pbr=finite(settings.pbrSpecularStrength,.70);let diff=v3(),spec=v3(),active=0;
    for(const light of lights||[]){let shape=1,planar=Math.hypot(P[0]-light.x,P[1]-light.y);if(light.typeCode===2){if(planar>=light.radius||planar<=.5)continue;const dn=normalize2(P[0]-light.x,P[1]-light.y),co=dn[0]*light.direction[0]+dn[1]*light.direction[1];shape=smoothstep(light.outerCos,light.innerCos,co)*Math.pow(Math.max(0,1-planar/light.radius),.42);if(shape<=0)continue}const Ld=[light.x-P[0],light.y-P[1],light.z-z],dist=Math.hypot(...Ld);if(light.typeCode!==2&&dist>light.radius||dist<.5)continue;const L=norm3([Ld[0],-Ld[1],Ld[2]]),NoL=Math.max(dot3(n,L),0),NoV=Math.max(dot3(n,V),.02);if(NoL<=0)continue;const att=light.typeCode===2?light.intensity*shape:Math.exp(-2.3*(dist/light.radius)**2)*light.intensity,H=norm3(add3(V,L)),NoH=Math.max(dot3(n,H),0),VoH=Math.max(dot3(V,H),0),a=Math.max(.045,rough*rough),a2=a*a,d=NoH*NoH*(a2-1)+1,D=a2/Math.max(Math.PI*d*d,1e-5),k=(rough+1)*(rough+1)/8,G=(NoV/Math.max(NoV*(1-k)+k,1e-4))*(NoL/Math.max(NoL*(1-k)+k,1e-4)),F=fres3(F0,VoH),sp=F.map(x=>D*G*x/Math.max(4*NoV*NoL,.04)),kd=F.map(x=>(1-x)*(1-metal)),rad=mul3(light.color,att);diff=add3(diff,mul3(mul3(kd,al),mul3(rad,NoL*.86+.14)));spec=add3(spec,mul3(mul3(sp,rad),pbr));active++}
    const ambient=mul3(mul3(al,finite(settings.ambient,.1)*(.72+.28*mao)),mix3([1,1,1],[.96,1,1.03],metal*.15)),direct=add3(diff,spec).map(x=>Math.max(0,x)/(1+Math.max(0,x)*.22)),final=add3(add3(ambient,direct),mul3(al,em*.8)).map(x=>Math.max(0,x));return{diffuse:diff,specular:spec,final,activeLightCount:active};
  }

  class WebGPUDeferredLighting{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUDeferredLighting requires GPUDevice');if(!options.gbuffer)throw new Error('WebGPUDeferredLighting requires a Material-v2 G-buffer source');this.device=options.device;this.queue=options.queue||options.device.queue;this.gbuffer=options.gbuffer;this.width=Math.max(1,Math.round(options.width||options.gbuffer.width||640));this.height=Math.max(1,Math.round(options.height||options.gbuffer.height||360));this.maxLights=Math.max(1,Math.min(MAX_LIGHTS,Math.round(options.maxLights||MAX_LIGHTS)));this.labelPrefix=String(options.labelPrefix||'SteelMothLighting');this.ownsRegistry=!options.registry;this.registry=options.registry||new Resources.ResourceRegistry({device:this.device,queue:this.queue,width:this.width,height:this.height,labelPrefix:this.labelPrefix});this.pipelines=options.pipelines||new Resources.PipelineCache(this.device,{labelPrefix:`${this.labelPrefix}:pipeline`});this.module=null;this.pipeline=null;this.compilation=[];this.renderCount=0;this.lastLights=[];this.lastSettings=null;this._defineResources();
    }
    _name(n){return `sm204:${n}`}
    _defineResources(){this.registry.defineBuffer(this._name('lights'),{size:this.maxLights*LIGHT_STRIDE,usage:bufferUsage(['STORAGE','COPY_DST'])});this.registry.defineBuffer(this._name('frame'),{size:256,usage:bufferUsage(['UNIFORM','COPY_DST'])});this.registry.defineTexture(this._name('lit'),{format:'rgba16float',usage:textureUsage(['RENDER_ATTACHMENT','TEXTURE_BINDING','COPY_SRC']),size:'surface'});}
    _record(n){return this.registry.require(this._name(n))}
    _g(name){if(typeof this.gbuffer._record==='function')return this.gbuffer._record(name);const r=this.gbuffer?.[name];if(!r)throw new Error(`G-buffer source missing ${name}`);return r}
    async _shader(){const module=this.device.createShaderModule({label:`${this.labelPrefix}:deferred`,code:LIGHTING_WGSL});let messages=[];if(typeof module.getCompilationInfo==='function')messages=Array.from((await module.getCompilationInfo()).messages||[]).map(m=>({type:m.type,message:m.message,lineNum:m.lineNum,linePos:m.linePos}));const errors=messages.filter(m=>m.type==='error');this.compilation.push({label:'deferred',messages});if(errors.length)throw new Error(`SM-204 WGSL compilation failed: ${errors.map(e=>e.message).join(' | ')}`);return module}
    async initialize(){if(this.pipeline)return this;this.module=await this._shader();this.pipeline=await this.pipelines.getRender('sm204-deferred',()=>this.device.createRenderPipeline({label:`${this.labelPrefix}:deferred`,layout:'auto',vertex:{module:this.module,entryPoint:'vs_main'},fragment:{module:this.module,entryPoint:'fs_main',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}}));return this}
    resize(width,height){width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));const changed=this.registry.resize(width,height);this.width=width;this.height=height;return changed}
    async render(scene,settings={},options={}){
      await this.initialize();const lights=buildCanonicalLights(scene,settings,{maxLights:this.maxLights}),debugMode=String(options.debugMode||'final'),mode=DEBUG_MODES.indexOf(debugMode);if(mode<0)throw new Error(`unknown lighting debug mode: ${debugMode}`);this.queue.writeBuffer(this._record('lights').handle,0,packLights(lights,this.maxLights));const raw=new ArrayBuffer(64),f=new Float32Array(raw),u=new Uint32Array(raw);f[0]=this.width;f[1]=this.height;f[2]=settings.lighting===false?1:clamp(finite(settings.ambient,.1),0,2);f[3]=.8;f[4]=finite(settings.normalStrength,1);f[5]=finite(settings.roughnessScale,1);f[6]=finite(settings.metalnessScale,1);f[7]=finite(settings.materialAOStrength,.62);f[8]=finite(settings.heightStrength,1);f[9]=finite(settings.pbrSpecularStrength,.70);u[12]=lights.length;u[13]=mode;this.queue.writeBuffer(this._record('frame').handle,0,new Uint8Array(raw));const bind=this.device.createBindGroup({label:`${this.labelPrefix}:bind`,layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this._g('g0').handle.createView()},{binding:1,resource:this._g('g1').handle.createView()},{binding:2,resource:this._g('g2').handle.createView()},{binding:3,resource:{buffer:this._record('lights').handle}},{binding:4,resource:{buffer:this._record('frame').handle}}]}),encoder=this.device.createCommandEncoder({label:`${this.labelPrefix}:encoder`}),pass=encoder.beginRenderPass({label:`${this.labelPrefix}:pass`,colorAttachments:[{view:this._record('lit').handle.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();this.queue.submit([encoder.finish()]);if(options.wait!==false&&typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();this.renderCount++;this.lastLights=lights;this.lastSettings=clone(settings);return{schema:SCHEMA,lightCount:lights.length,debugMode};
    }
    output(){return this._record('lit')}
    async readPixel(x,y){const record=this._record('lit'),buffer=this.device.createBuffer({label:`${this.labelPrefix}:readback`,size:256,usage:bufferUsage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:record.handle,origin:{x:clamp(Math.floor(x),0,record.width-1),y:clamp(Math.floor(y),0,record.height-1),z:0}},{buffer,bytesPerRow:256,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);await buffer.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const dv=new DataView(buffer.getMappedRange(),0,8),out=[0,2,4,6].map(o=>halfToFloat(dv.getUint16(o,true)));buffer.unmap();buffer.destroy();return out}
    diagnostics(){const counts={point:0,omni:0,cone:0};for(const l of this.lastLights)counts[l.type]=(counts[l.type]||0)+1;return{schema:SCHEMA,extent:{width:this.width,height:this.height},maxLights:this.maxLights,lightStride:LIGHT_STRIDE,lightBufferBytes:this.maxLights*LIGHT_STRIDE,lightCount:this.lastLights.length,lightTypes:counts,debugModes:[...DEBUG_MODES],diagnosticPreset:{...DIAGNOSTIC_PRESET},renderCount:this.renderCount,compilation:clone(this.compilation),resourceDiagnostics:this.registry.diagnostics(),pipelineDiagnostics:this.pipelines.diagnostics()}}
    close(){if(this.ownsRegistry)this.registry.close()}
  }

  return{SCHEMA,MAX_LIGHTS,LIGHT_STRIDE,LIGHT_TYPES,DEBUG_MODES,DIAGNOSTIC_PRESET,LIGHTING_WGSL,canonicalLight,buildCanonicalLights,packLights,shadeReferencePixel,WebGPUDeferredLighting};
});
