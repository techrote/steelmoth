'use strict';

(function(root,factory){
  let Forward=root?.SteelMothWebGPUForwardLighting||null;
  if(!Forward&&typeof module==='object'&&module.exports){try{Forward=require('./webgpu_forward_lighting.js');}catch(_e){Forward=null;}}
  const api=factory(root,Forward);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUTransparentFX=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root,Forward){
  const SCHEMA='steelmoth-webgpu-transparent-fx/v1';
  const MAX_SHADER_FX=16;
  const MAX_TRANSPARENT_SPRITES=640;
  const VERTEX_FLOATS=9;
  const VERTEX_STRIDE=VERTEX_FLOATS*4;
  const ADVANCED_VERTEX_FLOATS=17;
  const ADVANCED_VERTEX_STRIDE=ADVANCED_VERTEX_FLOATS*4;
  const FORWARD_DEBUG_MODES=Object.freeze(['final','indirect','support']);
  const FORWARD_MATERIALS=Object.freeze({'clear-glass':1,'frosted-glass':2,'diffuse-surface':3});
  const GLASS_DIRECT_CAP=.22;
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
  function normalizeForwardMaterial(sprite,stage=spriteStage(sprite)){
    const raw=sprite?.style?.forwardLighting;
    if(stage!=='world-alpha'||!raw)return{material:'compatibility',role:0,diffuseWeight:0,surface:null,deferredReason:null};
    const material=String(raw.material||''),role=FORWARD_MATERIALS[material]||0;
    if(!role)return{material,role:0,diffuseWeight:0,surface:null,deferredReason:'unsupported forward material; separate transmission decision required'};
    if(!Forward?.normalizeSurface)throw new Error('SM-702 forward-lighting module is required for explicit material participation');
    const surface=Forward.normalizeSurface({...raw,category:raw.category??sprite.category??'dynamic'});
    const colorSpace=String(raw.colorSpace||'srgb');if(!['srgb','linear'].includes(colorSpace))throw new Error('SM-702 material colorSpace must be srgb or linear');
    return{material,role,diffuseWeight:material==='clear-glass'?0:clamp(finite(raw.diffuseWeight,.25),0,1),surface,colorSpace,deferredReason:null};
  }
  function buildCompatibilityFrame(scene={},atlasMeta={},options={}){
    const maxSprites=clamp(Math.round(finite(options.maxSprites,MAX_TRANSPARENT_SPRITES)),1,MAX_TRANSPARENT_SPRITES),maxFx=clamp(Math.round(finite(options.maxFx,MAX_SHADER_FX)),1,MAX_SHADER_FX),stages=Object.fromEntries(STAGES.map(s=>[s,[]])),unresolved=[],sourceSprites=Array.isArray(scene.sprites)?scene.sprites:[],copyGuard=clone(scene);let accepted=0,dropped=0;
    for(let i=0;i<sourceSprites.length;i++){const s=sourceSprites[i];if(!spriteEligible(s))continue;if(accepted>=maxSprites){dropped++;continue}const uv=atlasRegion(atlasMeta,s.spriteId);if(!uv){unresolved.push({index:i,id:s.id||null,spriteId:s.spriteId});continue}const stage=spriteStage(s),vertices=quadVertices(s,uv);if(!vertices.length)continue;stages[stage].push({id:String(s.id||`transparent:${i}`),spriteId:String(s.spriteId),blend:stage.includes('additive')?'additive':'alpha',depthPolicy:stage.startsWith('world-')?'canonical-if-supplied':'always-top',vertices,forwardMaterial:normalizeForwardMaterial(s,stage)});accepted++}
    const rawEffects=effectDescriptorLayer(scene),effects=rawEffects.slice(0,maxFx).map(normalizeEffect);if(rawEffects.length>maxFx)dropped+=rawEffects.length-maxFx;const overlays=scene.overlays||{};
    return{schema:SCHEMA,logicalSize:Array.isArray(scene.frame?.logicalSize)?scene.frame.logicalSize.slice(0,2):[640,360],stages,effects,objective:normalizeOverlay(overlays.objectiveMarker||scene.objectiveMarker),guide:normalizeOverlay(overlays.guide||scene.guide),stats:{sourceSpriteCount:sourceSprites.length,acceptedSprites:accepted,dropped,unresolvedCount:unresolved.length,effectCount:effects.length,maxSprites,maxFx},unresolved,sourceDigest:JSON.stringify(copyGuard)};
  }
  function frameUnchanged(scene,frame){return JSON.stringify(scene)===frame.sourceDigest}
  function flattenStage(frame,stage){const records=frame?.stages?.[stage]||[],floats=[];for(const r of records)floats.push(...r.vertices);return new Float32Array(floats)}
  function flattenAdvancedStage(frame,stage='world-alpha'){
    if(stage!=='world-alpha')throw new Error('SM-702 material participation is limited to world-alpha');
    const floats=[];
    for(const r of frame?.stages?.[stage]||[]){const m=r.forwardMaterial||{},s=m.surface||{};
      for(let i=0;i<r.vertices.length;i+=VERTEX_FLOATS)floats.push(...r.vertices.slice(i,i+VERTEX_FLOATS),finite(s.localHeight),finite(s.layer),finite(s.bias),s&&m.role?1:0,finite(m.diffuseWeight),finite(m.role),m.colorSpace==='srgb'?1:0,0);
    }
    return new Float32Array(floats);
  }
  // Inputs are canonical linear SM-204 light records, not authored sRGB records.
  function glassDirectReference(lights,screenXY,worldZ=0,directClamp=GLASS_DIRECT_CAP){
    const sum=[0,0,0],p=screenXY||[0,0],smooth=(a,b,x)=>{const t=clamp((x-a)/Math.max(1e-8,b-a),0,1);return t*t*(3-2*t)};
    for(const l of Array.from(lights||[]).slice(0,17)){const delta=[finite(l.position?.[0])-finite(p[0]),finite(l.position?.[1])-finite(p[1]),finite(l.position?.[2])-worldZ],d=Math.hypot(...delta),r=Math.max(.001,finite(l.radius));if(l.type!=='cone'&&(d<.5||d>r))continue;let attenuation=Math.exp(-2.3*(d/r)**2);if(l.type==='cone'){const q=[-delta[0],-delta[1]],planar=Math.hypot(...q);if(planar<=.5||planar>=r)continue;attenuation=smooth(l.outerCos,l.innerCos,(q[0]*l.direction[0]+q[1]*l.direction[1])/planar)*Math.max(0,1-planar/r)**.42;}const response=Math.max(0,delta[2]/d)*Math.max(0,finite(l.intensity))*attenuation;for(let c=0;c<3;c++)sum[c]+=Math.max(0,finite(l.color?.[c]))*response;}
    return sum.map(v=>clamp(v,0,clamp(finite(directClamp,GLASS_DIRECT_CAP),0,GLASS_DIRECT_CAP)));
  }
  function glassDiffuseReference({ownDiffuse,lights=[],screenXY=[0,0],worldZ=0,diffuseWeight=.25,ambient=.2,directVisibility=1,ambientVisibility=1,incident=[0,0,0],supportReason=0,indirectWeight=1,directClamp=GLASS_DIRECT_CAP}={}){
    const weight=clamp(finite(diffuseWeight,.25),0,1),base=[0,1,2].map(i=>clamp(finite(ownDiffuse?.[i]),0,1)),b=clamp(finite(ambientVisibility,1),0,1),g=clamp(finite(directVisibility,1),0,1),direct=glassDirectReference(lights,screenXY,worldZ,directClamp),gi=Forward.diffuseReference(incident,base.map(v=>v*weight),b,{advancedLighting:true,indirectWeight},supportReason);
    return base.map((v,i)=>v*(1-weight)+v*weight*(clamp(finite(ambient,.2),0,2)*b+direct[i]*g)+gi[i]);
  }
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

  function advancedSpriteWGSL(){
    if(!Forward?.HELPER_WGSL)throw new Error('SM-702 forward WGSL helpers are required');
    return `${Forward.HELPER_WGSL}
struct Frame { logical:vec4f };
struct ForwardParams { extent:vec4u,policy:vec4f,surface:vec4f };
struct CanonicalLight { posRadius:vec4f,colorIntensity:vec4f,directionCone:vec4f,kindFlags:vec4f };
struct GlassLighting { counts:vec4u,response:vec4f };
@group(0) @binding(0) var samp:sampler;
@group(0) @binding(1) var atlas:texture_2d<f32>;
@group(0) @binding(2) var<uniform> frame:Frame;
@group(0) @binding(3) var crisp:sampler;
@group(1) @binding(0) var forwardDepth:texture_depth_2d;
@group(1) @binding(1) var forwardObject:texture_2d<u32>;
@group(1) @binding(2) var forwardNormal:texture_2d<f32>;
@group(1) @binding(3) var forwardIncident:texture_2d<f32>;
@group(1) @binding(4) var forwardVisibility:texture_2d<f32>;
@group(1) @binding(5) var<uniform> fp:ForwardParams;
@group(2) @binding(0) var<storage,read> canonicalLights:array<CanonicalLight>;
@group(2) @binding(1) var<uniform> glassLighting:GlassLighting;
struct Vin { @location(0) pos:vec2f,@location(1) uv:vec2f,@location(2) color:vec4f,@location(3) depth:f32,@location(4) surface:vec4f,@location(5) material:vec4f };
struct Vout { @builtin(position) pos:vec4f,@location(0) uv:vec2f,@location(1) color:vec4f,@location(2) @interpolate(flat) surface:vec4f,@location(3) @interpolate(flat) material:vec4f };
struct Fragment { @location(0) color:vec4f,@builtin(frag_depth) depth:f32 };
fn smGlassLinear(c:vec3f)->vec3f{let v=clamp(c,vec3f(0),vec3f(1));return select(pow((v+vec3f(.055))/1.055,vec3f(2.4)),v/12.92,v<=vec3f(.04045));}
fn smGlassDirect(p:vec2f,z:f32)->vec3f{
  var sum=vec3f(0);for(var i=0u;i<min(glassLighting.counts.x,17u);i++){
    let l=canonicalLights[i];let delta=l.posRadius.xyz-vec3f(p,z);let d=length(delta);let r=max(l.posRadius.w,.001);if(l.kindFlags.x<=.5&&(d<.5||d>r)){continue;}
    var attenuation=exp(-2.3*(d/r)*(d/r));
    if(l.kindFlags.x>.5){let q=p-l.posRadius.xy;let planar=length(q);if(planar<=.5||planar>=r){continue;}let cone=smoothstep(l.directionCone.w,l.directionCone.z,dot(q/planar,l.directionCone.xy));attenuation=cone*pow(max(0.0,1.0-planar/r),.42);}
    let normal=vec3f(0,0,1);let lightDirection=normalize(vec3f(delta.x,-delta.y,delta.z));
    sum+=max(vec3f(0),l.colorIntensity.rgb)*max(0.0,l.colorIntensity.a)*attenuation*max(0.0,dot(normal,lightDirection));
  }return clamp(sum,vec3f(0),vec3f(glassLighting.response.y));
}
@vertex fn vs_main(v:Vin)->Vout{var o:Vout;let ndc=vec2f(v.pos.x/frame.logical.x*2.0-1.0,1.0-v.pos.y/frame.logical.y*2.0);o.pos=vec4f(ndc,v.depth,1.0);o.uv=v.uv;o.color=v.color;o.surface=v.surface;o.material=v.material;return o;}
@fragment fn fs_main(v:Vout)->Fragment{
  let p=vec2i(v.pos.xy);var texel=textureSampleLevel(atlas,samp,v.uv,0.0);
  if(v.material.y>0.0){texel=textureSampleLevel(atlas,crisp,v.uv,0.0);}
  var ownDiffuse=texel.rgb*v.color.rgb;var indirect=vec3f(0);var colour=ownDiffuse;
  if(v.material.x>0.0){
    if(v.material.z>0.5){ownDiffuse=smGlassLinear(texel.rgb)*smGlassLinear(v.color.rgb);}
    let visibility=clamp(textureLoad(forwardVisibility,p,0),vec4f(0),vec4f(1));let direct=smGlassDirect(v.pos.xy,v.surface.x*SM_MAX_WORLD_Z);
    colour=ownDiffuse*(1.0-v.material.x)+ownDiffuse*v.material.x*(glassLighting.response.x*visibility.b+direct*visibility.g);
    indirect=smForwardDiffuse(p,ownDiffuse*v.material.x,forwardIncident,forwardDepth,forwardObject,forwardNormal,forwardVisibility,fp.extent.xy,fp.policy);
  }
  var o:Fragment;o.depth=v.pos.z;
  if(v.surface.w>0.0){o.depth=smOwnershipDepth(v.pos.y,v.surface.x,v.surface.y,v.surface.z);}
  o.color=vec4f(colour+indirect,texel.a*v.color.a);
  if(frame.logical.z==1.0&&v.material.y>0.0){o.color=vec4f(indirect,texel.a*v.color.a);}
  if(frame.logical.z==2.0&&v.material.y>0.0){let reason=smForwardSupportReason(p,forwardDepth,forwardObject,forwardNormal,fp.extent.xy,fp.policy.zw);o.color=vec4f(f32(reason)/6.0,0,0,texel.a*v.color.a);}
  return o;
}`;
  }

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
    constructor(options={}){if(!options.device)throw new Error('WebGPUTransparentFX requires GPUDevice');this.device=options.device;this.queue=options.queue||options.device.queue;this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));this.format=String(options.format||'rgba8unorm');this.depthFormat=String(options.depthFormat||'depth32float');this.maxSprites=clamp(Math.round(finite(options.maxSprites,MAX_TRANSPARENT_SPRITES)),1,MAX_TRANSPARENT_SPRITES);this.labelPrefix=String(options.labelPrefix||'SteelMothTransparentFX');this.pipelines=new Map();this.spriteBuffers=new Map();this.procBuffers=new Map();this.frameBuffer=null;this.sampler=null;this.initialized=false;this.closed=false;this.compilation=[];this.renderCounts=Object.fromEntries(STAGES.map(s=>[s,0]));this.lastFrameStats=null;this.lastError=null;this.vertexCounts=new Map();this.spriteGroups=new WeakMap();this.procGroups=new Map();this.layouts=new Map();this.groupCreationCount=0;this.advancedPrepared=false;this.forwardOwner=null;this.glassLightingBuffer=null;this.lightGroups=[];this.logicalSize=[this.width,this.height]}
    async _module(code,label){const m=this.device.createShaderModule({label:`${this.labelPrefix}:${label}`,code}),info=await m.getCompilationInfo(),messages=Array.from(info.messages||[]).map(x=>({type:x.type,message:x.message,lineNum:x.lineNum,linePos:x.linePos}));if(this.closed)throw new Error('transparent FX closed during shader preparation');this.compilation.push({label,messages});const errors=messages.filter(x=>x.type==='error');if(errors.length)throw new Error(`${label} WGSL: ${errors.map(x=>x.message).join('; ')}`);return m}
    async _pipeline(descriptor){const pipeline=await this.device.createRenderPipelineAsync(descriptor);if(this.closed)throw new Error('transparent FX closed during pipeline preparation');return pipeline;}
    async _initializeLegacy(){if(this.closed)throw new Error('transparent FX is closed');if(this.initialized)return this;try{this.spriteModule=await this._module(SPRITE_WGSL,'sprite');this.procModule=await this._module(PROCEDURAL_WGSL,'procedural');this.sampler=this.device.createSampler({label:`${this.labelPrefix}:sampler`,magFilter:'linear',minFilter:'linear',mipmapFilter:'nearest',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});this.frameBuffer=this.device.createBuffer({label:`${this.labelPrefix}:frame`,size:16,usage:gpuBufferUsage('UNIFORM','COPY_DST')});for(const stage of ['post-effects','objective','guide'])this.procBuffers.set(stage,this.device.createBuffer({label:`${this.labelPrefix}:${stage}:uniform`,size:1024,usage:gpuBufferUsage('UNIFORM','COPY_DST')}));const vertexLayout={arrayStride:VERTEX_STRIDE,attributes:[{shaderLocation:0,offset:0,format:'float32x2'},{shaderLocation:1,offset:8,format:'float32x2'},{shaderLocation:2,offset:16,format:'float32x4'},{shaderLocation:3,offset:32,format:'float32'}]},targets=mode=>[{format:this.format,blend:BLEND[mode]}],mk=async(mode,depth)=>this._pipeline({label:`${this.labelPrefix}:sprite:${mode}:${depth?'depth':'top'}`,layout:'auto',vertex:{module:this.spriteModule,entryPoint:'vs_main',buffers:[vertexLayout]},fragment:{module:this.spriteModule,entryPoint:'fs_main',targets:targets(mode)},primitive:{topology:'triangle-list'},depthStencil:depth?{format:this.depthFormat,depthWriteEnabled:false,depthCompare:'less-equal'}:undefined});for(const mode of ['alpha','additive']){this.pipelines.set(`sprite:${mode}:top`,await mk(mode,false));this.pipelines.set(`sprite:${mode}:depth`,await mk(mode,true))}this.pipelines.set('procedural',await this._pipeline({label:`${this.labelPrefix}:procedural`,layout:'auto',vertex:{module:this.procModule,entryPoint:'vs_main'},fragment:{module:this.procModule,entryPoint:'fs_main',targets:targets('additive')},primitive:{topology:'triangle-list'}}));this.initialized=true;return this}catch(e){this.lastError=String(e?.message||e);throw e}}
    async initialize(options={}){if(this.closed)throw new Error('transparent FX is closed');if(!this.initialized){if(!this.initializing)this.initializing=this._initializeLegacy();try{await this.initializing;}finally{this.initializing=null;}}if(options.advanced===true)await this.prepareAdvanced();return this;}
    async prepareAdvanced(){
      if(!this.initialized)throw new Error('initialize() must complete before prepareAdvanced');
      if(this.closed)throw new Error('transparent FX is closed');
      if(this.advancedPrepared)return this;
      if(this.advancedPromise)return this.advancedPromise;
      this.advancedPromise=(async()=>{try{
        const module=await this._module(advancedSpriteWGSL(),'forward-world-alpha');
        const pipe=await this._pipeline({label:`${this.labelPrefix}:forward-world-alpha`,layout:'auto',vertex:{module,entryPoint:'vs_main',buffers:[{arrayStride:ADVANCED_VERTEX_STRIDE,attributes:[{shaderLocation:0,offset:0,format:'float32x2'},{shaderLocation:1,offset:8,format:'float32x2'},{shaderLocation:2,offset:16,format:'float32x4'},{shaderLocation:3,offset:32,format:'float32'},{shaderLocation:4,offset:36,format:'float32x4'},{shaderLocation:5,offset:52,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs_main',targets:[{format:this.format,blend:BLEND.alpha}]},primitive:{topology:'triangle-list'},depthStencil:{format:this.depthFormat,depthWriteEnabled:false,depthCompare:'less-equal'}});
        this.crispSampler=this.device.createSampler({label:`${this.labelPrefix}:crisp`,magFilter:'nearest',minFilter:'nearest',mipmapFilter:'nearest',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
        this.forwardOwner=new Forward.BindingOwner(this.device);this.glassLightingBuffer=this.device.createBuffer({label:`${this.labelPrefix}:glass-lighting`,size:32,usage:gpuBufferUsage('UNIFORM','COPY_DST')});this.pipelines.set('forward-world-alpha',pipe);this.advancedPrepared=true;return this;
      }catch(e){this.lastError=String(e?.message||e);throw e}finally{this.advancedPromise=null}})();
      return this.advancedPromise;
    }
    _layout(pipe,index){let layouts=this.layouts.get(pipe);if(!layouts){layouts=new Map();this.layouts.set(pipe,layouts)}if(!layouts.has(index))layouts.set(index,pipe.getBindGroupLayout(index));return layouts.get(index)}
    _spriteGroup(pipe,atlasView,advanced){let groups=this.spriteGroups.get(atlasView);if(!groups){groups=new Map();this.spriteGroups.set(atlasView,groups)}if(!groups.has(pipe)){const entries=[{binding:0,resource:this.sampler},{binding:1,resource:atlasView},{binding:2,resource:{buffer:this.frameBuffer}}];if(advanced)entries.push({binding:3,resource:this.crispSampler});groups.set(pipe,this.device.createBindGroup({layout:this._layout(pipe,0),entries}));this.groupCreationCount++}return groups.get(pipe)}
    _ensureSpriteBuffer(stage,bytes){const limit=this.maxSprites*6*(stage==='forward-world-alpha'?ADVANCED_VERTEX_STRIDE:VERTEX_STRIDE);if(bytes>limit)throw new RangeError('transparent stage exceeds bounded sprite capacity');let rec=this.spriteBuffers.get(stage);const want=Math.max(256,(bytes+255)&~255);if(!rec||rec.size<want){try{rec?.buffer?.destroy()}catch(_e){};rec={size:want,buffer:this.device.createBuffer({label:`${this.labelPrefix}:${stage}:vertices`,size:want,usage:gpuBufferUsage('VERTEX','COPY_DST')})};this.spriteBuffers.set(stage,rec)}return rec.buffer}
    uploadFrame(frame){
      if(!this.initialized||this.closed)throw new Error('initialize() must complete before uploadFrame');
      const logical=frame.logicalSize||[this.width,this.height];this.logicalSize=[finite(logical[0],this.width),finite(logical[1],this.height)];this.queue.writeBuffer(this.frameBuffer,0,new Float32Array([...this.logicalSize,0,0]));
      for(const stage of ['world-alpha','world-additive','top-additive','top-alpha']){const data=flattenStage(frame,stage);this.vertexCounts.set(stage,data.length/VERTEX_FLOATS);if(data.byteLength)this.queue.writeBuffer(this._ensureSpriteBuffer(stage,data.byteLength),0,data)}
      if(this.advancedPrepared){const data=flattenAdvancedStage(frame);this.vertexCounts.set('forward-world-alpha',data.length/ADVANCED_VERTEX_FLOATS);if(data.byteLength)this.queue.writeBuffer(this._ensureSpriteBuffer('forward-world-alpha',data.byteLength),0,data)}
      for(const [stage,mode] of [['post-effects',0],['objective',1],['guide',2]])this.queue.writeBuffer(this.procBuffers.get(stage),0,packProcedural(frame,mode,[this.width,this.height]));this.lastFrameStats=clone(frame.stats);return frame;
    }
    renderStage(stage,{encoder,targetView,frame,atlasView=null,depthView=null,loadOp='load',clearValue={r:0,g:0,b:0,a:1},forwardSource=null,advancedEnabled=false,forwardOptions={},forwardDebug='final',timestampWrites=null}={}){
      if(!this.initialized||this.closed)throw new Error('initialize() must complete before renderStage');
      if(!Object.prototype.hasOwnProperty.call(STAGE_ORDER,stage))throw new Error(`unknown transparent stage: ${stage}`);
      if(!encoder||!targetView)throw new Error('encoder and targetView are required');let pass=null;
      try{
        const advanced=stage==='world-alpha'&&advancedEnabled===true;
        let capture=null,forwardGroup=null;
        if(advanced){
          if(!this.advancedPrepared)throw new Error('prepareAdvanced() must complete before advanced world-alpha');
          if(!depthView)throw new Error('advanced world-alpha requires canonical native depth attachment');
          capture=Forward.refreshSource(forwardSource,{device:this.device,width:this.width,height:this.height});
          if(depthView!==capture.depthView)throw new Error('advanced world-alpha depth attachment must match the captured canonical view');
          if(!FORWARD_DEBUG_MODES.includes(forwardDebug))throw new Error('unsupported forward debug mode');
          forwardGroup=this.forwardOwner.bind(this._layout(this.pipelines.get('forward-world-alpha'),1),capture,{...forwardOptions,advancedLighting:true});
          const bytes=new ArrayBuffer(32),u=new Uint32Array(bytes),f=new Float32Array(bytes);u[0]=capture.lightCount;f[4]=clamp(finite(forwardOptions.ambient,.2),0,2);f[5]=clamp(finite(forwardOptions.directClamp,.22),0,.22);this.queue.writeBuffer(this.glassLightingBuffer,0,bytes);
          this.queue.writeBuffer(this.frameBuffer,0,new Float32Array([...this.logicalSize,FORWARD_DEBUG_MODES.indexOf(forwardDebug),0]));
        }
        const descriptor={label:`${this.labelPrefix}:${stage}:pass`,colorAttachments:[{view:targetView,loadOp,storeOp:'store',clearValue}]};
        if(timestampWrites)descriptor.timestampWrites=timestampWrites;
        // Sampled canonical depth and an attached read-only depth resource may alias.
        if(stage.startsWith('world-')&&depthView)descriptor.depthStencilAttachment={view:depthView,depthReadOnly:true};
        pass=encoder.beginRenderPass(descriptor);
        if(stage==='post-effects'||stage==='objective'||stage==='guide'){
          if((stage==='post-effects'&&!(frame.effects?.length))||(stage==='objective'&&!frame.objective)||(stage==='guide'&&!frame.guide)){pass.end();pass=null;return 0}
          const pipe=this.pipelines.get('procedural');let group=this.procGroups.get(stage);
          if(!group){group=this.device.createBindGroup({layout:this._layout(pipe,0),entries:[{binding:0,resource:{buffer:this.procBuffers.get(stage)}}]});this.procGroups.set(stage,group);this.groupCreationCount++}
          pass.setPipeline(pipe);pass.setBindGroup(0,group);pass.draw(3);pass.end();pass=null;this.renderCounts[stage]++;return 1;
        }
        const bufferStage=advanced?'forward-world-alpha':stage,count=this.vertexCounts.get(bufferStage)||0;
        if(!count){pass.end();pass=null;return 0}
        if(!atlasView)throw new Error(`atlasView required for ${stage}`);
        const mode=stage.includes('additive')?'additive':'alpha',depth=stage.startsWith('world-')&&!!depthView,pipe=this.pipelines.get(advanced?'forward-world-alpha':`sprite:${mode}:${depth?'depth':'top'}`);
        pass.setPipeline(pipe);pass.setBindGroup(0,this._spriteGroup(pipe,atlasView,advanced));if(advanced){pass.setBindGroup(1,forwardGroup);let cached=this.lightGroups.find(g=>g.buffer===capture.lightBuffer);if(!cached){cached={buffer:capture.lightBuffer,group:this.device.createBindGroup({layout:this._layout(pipe,2),entries:[{binding:0,resource:{buffer:capture.lightBuffer}},{binding:1,resource:{buffer:this.glassLightingBuffer}}]})};this.lightGroups.push(cached);if(this.lightGroups.length>2)this.lightGroups.shift();this.groupCreationCount++;}pass.setBindGroup(2,cached.group);}
        pass.setVertexBuffer(0,this.spriteBuffers.get(bufferStage).buffer);pass.draw(count);if(capture)Forward.assertFresh(capture);pass.end();pass=null;this.renderCounts[stage]++;return count/6;
      }catch(e){try{pass?.end()}catch(_e){}this.lastError=String(e?.message||e);throw e}
    }
    diagnostics(){const spriteBufferBytes=Array.from(this.spriteBuffers.values()).reduce((n,r)=>n+r.size,0),forward=this.forwardOwner?.diagnostics()||null;return{schema:SCHEMA,extent:{width:this.width,height:this.height},format:this.format,depthFormat:this.depthFormat,maxTransparentSprites:this.maxSprites,maxShaderFx:MAX_SHADER_FX,stages:[...STAGES],stageOrder:{...STAGE_ORDER},blend:{alpha:clone(BLEND.alpha),additive:clone(BLEND.additive)},depthPolicy:{world:'canonical-if-supplied/less-equal/no-depth-write',top:'always-top/no-depth'},renderCounts:{...this.renderCounts},frameStats:clone(this.lastFrameStats),compilation:clone(this.compilation),advancedLighting:{prepared:this.advancedPrepared,defaultEnabled:false,vertexStride:ADVANCED_VERTEX_STRIDE,materials:{...FORWARD_MATERIALS},debugModes:[...FORWARD_DEBUG_MODES],bindings:forward,glassLightingBytes:this.glassLightingBuffer?32:0},spriteBufferBytes,estimatedResourceBytes:spriteBufferBytes+(this.frameBuffer?16:0)+this.procBuffers.size*1024+(forward?.estimatedBytes||0)+(this.glassLightingBuffer?32:0),groupCreationCount:this.groupCreationCount,resourcePolicy:'persistent-per-stage-buffers; bounded growth; no gameplay ownership',fallback:'WebGL2 compatibility renderer remains authoritative until promotion',lastError:this.lastError}}
    close(){if(this.closed)return;this.closed=true;for(const r of this.spriteBuffers.values())try{r.buffer.destroy()}catch(_e){};for(const b of this.procBuffers.values())try{b.destroy()}catch(_e){};try{this.frameBuffer?.destroy()}catch(_e){};this.forwardOwner?.close();this.glassLightingBuffer?.destroy();this.lightGroups=[];this.spriteBuffers.clear();this.procBuffers.clear();this.vertexCounts.clear();this.spriteGroups=new WeakMap();this.procGroups.clear();this.layouts.clear()}
  }
  return{SCHEMA,MAX_SHADER_FX,MAX_TRANSPARENT_SPRITES,VERTEX_FLOATS,VERTEX_STRIDE,ADVANCED_VERTEX_FLOATS,ADVANCED_VERTEX_STRIDE,FORWARD_MATERIALS,FORWARD_DEBUG_MODES,GLASS_DIRECT_CAP,glassDirectReference,glassDiffuseReference,STAGES,STAGE_ORDER,BLEND,SPRITE_WGSL,PROCEDURAL_WGSL,advancedSpriteWGSL,normalizeForwardMaterial,normalizeAtlasSize,atlasRegion,spriteStage,spriteEligible,quadVertices,normalizeEffect,buildCompatibilityFrame,frameUnchanged,flattenStage,flattenAdvancedStage,packProcedural,WebGPUTransparentFX};
});
