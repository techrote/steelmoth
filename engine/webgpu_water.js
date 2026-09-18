'use strict';

(function(root,factory){
  let Resources=root?.SteelMothWebGPUResources||null;
  let Lighting=root?.SteelMothWebGPULighting||null;
  if(typeof module==='object'&&module.exports){
    if(!Resources){try{Resources=require('./webgpu_resources.js');}catch(_e){Resources=null;}}
    if(!Lighting){try{Lighting=require('./webgpu_lighting.js');}catch(_e){Lighting=null;}}
  }
  const api=factory(Resources,Lighting,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUWater=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,Lighting,root){
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before webgpu_water');
  if(!Lighting)throw new Error('SteelMothWebGPULighting is required before webgpu_water');

  const SCHEMA='steelmoth-webgpu-water/v1';
  const SNAPSHOT_SCHEMA='steelmoth-webgpu-water-snapshot/v1';
  const OUTPUT_FORMAT='rgba16float';
  const FIELD_FORMAT='rgba8unorm';
  const MAX_RIPPLES=12;
  const RIPPLE_STRIDE=32;
  const PARAM_BYTES=128;
  const DEBUG_MODES=Object.freeze(['final','mask','light','visibility','depth','refraction']);
  const DEFAULTS=Object.freeze({
    waterQuality:2,waterStrength:1.10,waterWaveScale:1,waterWaveSpeed:1,
    shoreFoamStrength:1.05,waterRippleStrength:1,waterNormalStrength:1.52,
    waterDetailStrength:1.34,waterHighlightStrength:1.60,waterEdgeStrength:1.42,
    waterRefractionStrength:1.18,waterDepthReject:0.045,
    baseColor:[.20,.50,.80],foamColor:[.72,.88,.98],highlightColor:[.78,.92,1]
  });
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,COPY_DST:0x02,TEXTURE_BINDING:0x04,RENDER_ATTACHMENT:0x10});
  const MAP_MODE_READ=0x0001;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const bufferUsage=(...names)=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const textureUsage=(...names)=>names.reduce((v,n)=>v|Number(root?.GPUTextureUsage?.[n]??FALLBACK_TEXTURE_USAGE[n]??0),0);
  const vdot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const vlen=a=>Math.hypot(a[0],a[1],a[2]);
  const vnorm=a=>{const d=vlen(a)||1;return[a[0]/d,a[1]/d,a[2]/d]};
  const smoothstep=(a,b,x)=>{const d=b-a;if(Math.abs(d)<1e-9)return x>=b?1:0;const t=clamp((x-a)/d,0,1);return t*t*(3-2*t)};
  const luminance=c=>finite(c?.[0],0)*.2126+finite(c?.[1],0)*.7152+finite(c?.[2],0)*.0722;
  const color3=(v,fallback)=>Array.isArray(v)?[finite(v[0],fallback[0]),finite(v[1],fallback[1]),finite(v[2],fallback[2])]:fallback.slice();

  function normalizeSettings(raw={}){
    const o={...DEFAULTS,...raw};
    return {
      waterQuality:clamp(Math.round(finite(o.waterQuality,2)),0,4),
      waterStrength:clamp(finite(o.waterStrength,1.10),0,3),
      waterWaveScale:clamp(finite(o.waterWaveScale,1),.35,5),
      waterWaveSpeed:clamp(finite(o.waterWaveSpeed,1),0,4),
      shoreFoamStrength:clamp(finite(o.shoreFoamStrength,1.05),0,3),
      waterRippleStrength:clamp(finite(o.waterRippleStrength,1),0,3),
      waterNormalStrength:clamp(finite(o.waterNormalStrength,1.52),0,3),
      waterDetailStrength:clamp(finite(o.waterDetailStrength,1.34),0,3),
      waterHighlightStrength:clamp(finite(o.waterHighlightStrength,1.60),0,3),
      waterEdgeStrength:clamp(finite(o.waterEdgeStrength,1.42),0,3),
      waterRefractionStrength:clamp(finite(o.waterRefractionStrength,1.18),0,3),
      waterDepthReject:clamp(finite(o.waterDepthReject,.045),.001,.5),
      baseColor:color3(o.baseColor,DEFAULTS.baseColor),foamColor:color3(o.foamColor,DEFAULTS.foamColor),highlightColor:color3(o.highlightColor,DEFAULTS.highlightColor)
    };
  }

  function normalizeRipple(raw={}){
    const life=Math.max(.001,finite(raw.life,1.15)),ageSeconds=Math.max(0,finite(raw.age,0));
    const age=raw.normalizedAge!=null?clamp(finite(raw.normalizedAge,0),0,1):clamp(ageSeconds/life,0,1);
    return {x:finite(raw.x,0),y:finite(raw.y,0),age,life,radius:clamp(finite(raw.radius,72),8,220),amplitude:clamp(finite(raw.amplitude,.72),0,2.5),foam:clamp(finite(raw.foam,.55),0,2)};
  }
  function normalizeRipples(items,budget=MAX_RIPPLES){const cap=clamp(Math.round(finite(budget,MAX_RIPPLES)),0,MAX_RIPPLES);return Array.from(items||[]).slice(-cap).map(normalizeRipple);}

  function buildShoreField(mask,width,height,maxDistance=18){
    width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));const n=width*height;if(!mask||mask.length<n)throw new RangeError('water mask is smaller than width*height');
    const dist=new Float32Array(n),inf=1e6,diag=Math.SQRT2;for(let i=0;i<n;i++)dist[i]=mask[i]?inf:0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(!mask[i])continue;let d=dist[i];if(x>0)d=Math.min(d,dist[i-1]+1);if(y>0)d=Math.min(d,dist[i-width]+1);if(x>0&&y>0)d=Math.min(d,dist[i-width-1]+diag);if(x+1<width&&y>0)d=Math.min(d,dist[i-width+1]+diag);dist[i]=d;}
    for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){const i=y*width+x;if(!mask[i])continue;let d=dist[i];if(x+1<width)d=Math.min(d,dist[i+1]+1);if(y+1<height)d=Math.min(d,dist[i+width]+1);if(x+1<width&&y+1<height)d=Math.min(d,dist[i+width+1]+diag);if(x>0&&y+1<height)d=Math.min(d,dist[i+width-1]+diag);dist[i]=d;}
    const rgba=new Uint8Array(n*4),md=Math.max(1,finite(maxDistance,18));for(let i=0;i<n;i++){const wet=!!mask[i],d=wet?clamp(dist[i],0,md):0,o=i*4;rgba[o]=wet?255:0;rgba[o+1]=wet?Math.round(d/md*255):0;rgba[o+2]=wet?Math.round(clamp(1-d/md,0,1)*255):0;rgba[o+3]=255;}return{rgba,dist,maxDistance:md,width,height};
  }

  function canonicalLightVector(light,screenXY,waterZ=0){return vnorm([finite(light?.position?.[0],0)-finite(screenXY?.[0],0),-(finite(light?.position?.[1],0)-finite(screenXY?.[1],0)),finite(light?.position?.[2],0)-finite(waterZ,0)]);}

  function spectrumGradient(screenXY,time,settings={},ripples=[]){
    const s=normalizeSettings(settings),p=[finite(screenXY?.[0],0),finite(screenXY?.[1],0)],out={height:0,gx:0,gy:0,crest:0,rippleFoam:0};
    const wave=(dx,dy,k0,amp,phase,sharp)=>{const dl=Math.hypot(dx,dy)||1;dx/=dl;dy/=dl;const k=k0*Math.max(.35,s.waterWaveScale),w=Math.sqrt(9.81*k),th=(p[0]*dx+p[1]*dy)*k+finite(time,0)*s.waterWaveSpeed*w+phase,sn=Math.sin(th),cs=Math.cos(th),sn2=Math.sin(th*2+phase*.31),cs2=Math.cos(th*2+phase*.31);out.height+=amp*(sn+sharp*.12*sn2);const dh=amp*k*(cs+sharp*.24*cs2);out.gx+=dx*dh;out.gy+=dy*dh;out.crest+=amp*Math.pow(Math.max(0,.5+.5*sn),10);};
    wave(.96,.28,.020,.58,.3,.48);wave(.82,.57,.029,.43,2.1,.42);wave(.99,-.11,.041,.31,4.4,.38);wave(.63,.78,.061,.23,1.3,.32);
    if(s.waterQuality>=2){wave(.91,.42,.086,.17,5.2,.28);wave(-.18,.98,.118,.13,3.5,.24);wave(.75,-.66,.162,.09,.8,.20);}
    if(s.waterQuality>=3){wave(.98,.18,.224,.062,2.8,.15);wave(.31,.95,.308,.045,4.9,.12);wave(-.52,.85,.410,.032,1.7,.10);}
    if(s.waterQuality>=4){wave(.87,-.49,.515,.024,3.3,.09);wave(-.09,.99,.660,.018,5.4,.08);}
    for(const r0 of normalizeRipples(ripples,MAX_RIPPLES)){const r=r0,qx=p[0]-r.x,qy=p[1]-r.y,d=Math.max(Math.hypot(qx,qy),.001),rr=Math.max(6,r.radius),q=d/rr,a=r.age,alive=(1-a)*(1-a),env=Math.exp(-q*2.25)*alive,ph=q*18-a*22,sa=Math.sin(ph),ca=Math.cos(ph),amp=r.amplitude*s.waterRippleStrength;out.height+=sa*env*amp;const dh=(ca*18-sa*2.25)*env*amp/rr;out.gx+=qx/d*dh;out.gy+=qy/d*dh;const front=rr*(.12+.88*a);out.rippleFoam+=Math.exp(-Math.abs(d-front)/Math.max(2,rr*.05))*(1-a)*r.foam;}
    out.gx*=s.waterNormalStrength*(1+.16*s.waterDetailStrength);out.gy*=s.waterNormalStrength*(1+.16*s.waterDetailStrength);return out;
  }

  function lightEnergyAt(lights,screenXY,normal,waterZ=0){
    let diffuse=0,specular=0;const V=[0,0,1],p=[finite(screenXY?.[0],0),finite(screenXY?.[1],0)];
    for(const light of lights||[]){let factor=0,L=null;if(String(light?.type)==='cone'){
      const q=[p[0]-finite(light.position?.[0],0),p[1]-finite(light.position?.[1],0)],d=Math.hypot(q[0],q[1]);if(d<=.5||d>=finite(light.radius,0))continue;const co=(q[0]*finite(light.direction?.[0],1)+q[1]*finite(light.direction?.[1],0))/d,edge=smoothstep(finite(light.outerCos,-1),finite(light.innerCos,1),co),fade=Math.pow(Math.max(0,1-d/finite(light.radius,1)),.42);if(edge<=0||fade<=0)continue;factor=finite(light.intensity,0)*edge*fade;L=canonicalLightVector(light,p,waterZ);
    }else{
      const dx=finite(light.position?.[0],0)-p[0],dy=finite(light.position?.[1],0)-p[1],dz=finite(light.position?.[2],0)-waterZ,d=Math.hypot(dx,dy,dz),radius=finite(light.radius,0);if(d<=.5||d>radius)continue;factor=finite(light.intensity,0)*Math.exp(-2.3*(d/radius)*(d/radius));L=vnorm([dx,-dy,dz]);
    }
      const NoL=Math.max(vdot(normal,L),0);if(NoL<=0)continue;const c=luminance(light.color||[1,1,1]);diffuse+=c*factor*(.30+.70*NoL);const ndot=vdot(normal,L),R=[-L[0]+2*ndot*normal[0],-L[1]+2*ndot*normal[1],-L[2]+2*ndot*normal[2]],rv=Math.max(vdot(R,V),0);specular+=c*factor*Math.pow(rv,42);
    }
    return{diffuse,specular};
  }

  function depthAwareRefractionWeight(currentDepth,refractedDepth,threshold=.045){const d=Math.abs(finite(currentDepth,1)-finite(refractedDepth,1)),t=clamp(finite(threshold,.045),.001,.5);return 1-smoothstep(t,t*4,d);}

  function shadeWaterReference(sample={},lights=[],settings={},screenXY=[0,0],time=0,ripples=[]){
    const s=normalizeSettings(settings),mask=clamp(finite(sample.mask,1),0,1);if(s.waterQuality<=0||mask<.015)return[0,0,0,0];const g=spectrumGradient(screenXY,time,s,ripples),normal=vnorm([-g.gx,g.gy,1.34]),energy=lightEnergyAt(lights,screenXY,normal,finite(sample.waterZ,0)),directVisibility=clamp(finite(sample.directVisibility,1),0,1),under=Array.isArray(sample.under)?sample.under:[0,0,0],underLum=luminance(under),sceneVis=clamp(underLum*2.4,0,1),directEnergy=clamp(energy.diffuse*directVisibility,0,3),illum=clamp(Math.max(sceneVis,directEnergy*.55),0,1),shore=1-smoothstep(.02,.23,clamp(finite(sample.shoreDistance,.5),0,1)),edge=Math.pow(shore,1.45)*s.waterEdgeStrength,slope=clamp(Math.hypot(g.gx,g.gy)*3,0,1),micro=Math.pow(clamp(slope*.76+g.crest*.16,0,1),2.2),foam=clamp((shore*(.30+.24*micro)+g.rippleFoam)*s.shoreFoamStrength,0,1.15),refractWeight=depthAwareRefractionWeight(sample.currentDepth??1,sample.refractedDepth??1,s.waterDepthReject),refracted=Array.isArray(sample.refracted)?sample.refracted:under,scene=[0,1,2].map(i=>under[i]+(refracted[i]-under[i])*refractWeight),water=s.baseColor.map(v=>v*(.12+.20*clamp(energy.diffuse,0,2))*directVisibility),highlight=s.highlightColor.map(v=>v*(energy.specular*.34*s.waterHighlightStrength+micro*.018*s.waterDetailStrength)*directVisibility),foamLight=s.foamColor.map(v=>v*foam*.22*illum),target=scene.map((v,i)=>v*.93+water[i]+highlight[i]+foamLight[i]+s.highlightColor[i]*edge*.012*illum),mixWeight=clamp((.12+.07*s.waterStrength)*illum,0,.30),color=scene.map((v,i)=>Math.max(0,v+(target[i]-v)*mixWeight)),alpha=mask*(.10+.045*s.waterStrength+.028*foam)*illum;return[color[0],color[1],color[2],clamp(alpha,0,.30)];
  }

  function packRipples(items,budget=MAX_RIPPLES){const ripples=normalizeRipples(items,budget),buf=new ArrayBuffer(MAX_RIPPLES*RIPPLE_STRIDE),f=new Float32Array(buf);for(let i=0;i<ripples.length;i++){const r=ripples[i],o=i*8;f[o]=r.x;f[o+1]=r.y;f[o+2]=r.age;f[o+3]=r.radius;f[o+4]=r.amplitude;f[o+5]=r.foam;}return{bytes:new Uint8Array(buf),ripples};}

  function packParams(width,height,time,settings,rippleCount,lightCount,debugMode){const s=normalizeSettings(settings),data=new ArrayBuffer(PARAM_BYTES),f=new Float32Array(data),u=new Uint32Array(data);f[0]=width;f[1]=height;f[2]=finite(time,0);f[3]=s.waterStrength;f[4]=s.waterWaveScale;f[5]=s.waterWaveSpeed;f[6]=s.waterNormalStrength;f[7]=s.waterDetailStrength;f[8]=s.waterHighlightStrength;f[9]=s.waterEdgeStrength;f[10]=s.waterRefractionStrength;f[11]=s.shoreFoamStrength;f[12]=s.baseColor[0];f[13]=s.baseColor[1];f[14]=s.baseColor[2];f[15]=s.waterDepthReject;f[16]=s.foamColor[0];f[17]=s.foamColor[1];f[18]=s.foamColor[2];f[19]=s.waterRippleStrength;f[20]=s.highlightColor[0];f[21]=s.highlightColor[1];f[22]=s.highlightColor[2];f[23]=0;u[24]=Math.min(MAX_RIPPLES,rippleCount)>>>0;u[25]=Math.min(Lighting.MAX_LIGHTS||17,lightCount)>>>0;u[26]=Math.max(0,DEBUG_MODES.indexOf(debugMode))>>>0;u[27]=s.waterQuality>>>0;return new Uint8Array(data);}

  const WATER_WGSL=`
const MAX_LIGHTS:u32=${Lighting.MAX_LIGHTS||17}u;
const MAX_RIPPLES:u32=${MAX_RIPPLES}u;
const G:f32=9.81;
struct Light { posRadius:vec4f,colorIntensity:vec4f,directionCone:vec4f,kindFlags:vec4f };
struct Ripple { posAgeRadius:vec4f,ampFoamPad:vec4f };
struct Params { extentTime:vec4f,controls0:vec4f,controls1:vec4f,baseDepth:vec4f,foamRipple:vec4f,highlightQuality:vec4f,counts:vec4u,pad:vec4u };
@group(0) @binding(0) var fieldTex:texture_2d<f32>;
@group(0) @binding(1) var sceneTex:texture_2d<f32>;
@group(0) @binding(2) var depthTex:texture_depth_2d;
@group(0) @binding(3) var visibilityTex:texture_2d<f32>;
@group(0) @binding(4) var<storage,read> lights:array<Light>;
@group(0) @binding(5) var<storage,read> ripples:array<Ripple>;
@group(0) @binding(6) var<uniform> params:Params;
fn waveTerm(p:vec2f,dir0:vec2f,k0:f32,amp:f32,phase:f32,sharp:f32)->vec4f{let dir=normalize(dir0);let k=k0*max(.35,params.controls0.x);let w=sqrt(G*k);let th=dot(p,dir)*k+params.extentTime.z*params.controls0.y*w+phase;let sn=sin(th);let cs=cos(th);let sn2=sin(th*2.0+phase*.31);let cs2=cos(th*2.0+phase*.31);let h=amp*(sn+sharp*.12*sn2);let dh=amp*k*(cs+sharp*.24*cs2);let crest=amp*pow(max(0.0,.5+.5*sn),10.0);return vec4f(h,dir*dh,crest);}
fn spectrum(p:vec2f)->vec4f{var state=vec4f(0);var grad=vec2f(0);var t=waveTerm(p,vec2f(.96,.28),.020,.58,.3,.48);state.x+=t.x;grad+=t.yz;state.y+=t.w;t=waveTerm(p,vec2f(.82,.57),.029,.43,2.1,.42);state.x+=t.x;grad+=t.yz;state.y+=t.w;t=waveTerm(p,vec2f(.99,-.11),.041,.31,4.4,.38);state.x+=t.x;grad+=t.yz;state.y+=t.w;t=waveTerm(p,vec2f(.63,.78),.061,.23,1.3,.32);state.x+=t.x;grad+=t.yz;state.y+=t.w;if(params.counts.w>=2u){t=waveTerm(p,vec2f(.91,.42),.086,.17,5.2,.28);state.x+=t.x;grad+=t.yz;state.y+=t.w;t=waveTerm(p,vec2f(-.18,.98),.118,.13,3.5,.24);state.x+=t.x;grad+=t.yz;state.y+=t.w;t=waveTerm(p,vec2f(.75,-.66),.162,.09,.8,.20);state.x+=t.x;grad+=t.yz;state.y+=t.w;}if(params.counts.w>=3u){t=waveTerm(p,vec2f(.98,.18),.224,.062,2.8,.15);state.x+=t.x;grad+=t.yz;state.y+=t.w;t=waveTerm(p,vec2f(.31,.95),.308,.045,4.9,.12);state.x+=t.x;grad+=t.yz;state.y+=t.w;t=waveTerm(p,vec2f(-.52,.85),.410,.032,1.7,.10);state.x+=t.x;grad+=t.yz;state.y+=t.w;}if(params.counts.w>=4u){t=waveTerm(p,vec2f(.87,-.49),.515,.024,3.3,.09);state.x+=t.x;grad+=t.yz;state.y+=t.w;t=waveTerm(p,vec2f(-.09,.99),.660,.018,5.4,.08);state.x+=t.x;grad+=t.yz;state.y+=t.w;}for(var i:u32=0u;i<MAX_RIPPLES;i++){if(i>=params.counts.x){break;}let r=ripples[i];let qv=p-r.posAgeRadius.xy;let d=max(length(qv),.001);let rr=max(6.0,r.posAgeRadius.w);let q=d/rr;let a=clamp(r.posAgeRadius.z,0.0,1.0);let alive=(1.0-a)*(1.0-a);let env=exp(-q*2.25)*alive;let ph=q*18.0-a*22.0;let sa=sin(ph);let ca=cos(ph);let amp=r.ampFoamPad.x*params.foamRipple.w;state.x+=sa*env*amp;let dh=(ca*18.0-sa*2.25)*env*amp/rr;grad+=qv/d*dh;let front=rr*(.12+.88*a);state.z+=exp(-abs(d-front)/max(2.0,rr*.05))*(1.0-a)*r.ampFoamPad.y;}grad*=params.controls0.z*(1.0+.16*params.controls0.w);return vec4f(grad,state.y,state.z);}
fn lum(c:vec3f)->f32{return dot(c,vec3f(.2126,.7152,.0722));}
fn canonicalL(light:Light,p:vec2f,z:f32)->vec3f{let d=light.posRadius.xyz-vec3f(p,z);return normalize(vec3f(d.x,-d.y,d.z));}
fn lightEnergy(p:vec2f,n:vec3f)->vec2f{var diff=0.0;var spec=0.0;let V=vec3f(0,0,1);for(var i:u32=0u;i<MAX_LIGHTS;i++){if(i>=params.counts.y){break;}let l=lights[i];var factor=0.0;var L=vec3f(0);if(l.kindFlags.x>.5){let q=p-l.posRadius.xy;let d=length(q);if(d<=.5||d>=l.posRadius.w){continue;}let co=dot(q/d,l.directionCone.xy);let edge=smoothstep(l.directionCone.w,l.directionCone.z,co);let fade=pow(max(0.0,1.0-d/l.posRadius.w),.42);if(edge<=0.0||fade<=0.0){continue;}factor=l.colorIntensity.a*edge*fade;L=canonicalL(l,p,0.0);}else{let d3=l.posRadius.xyz-vec3f(p,0.0);let d=length(d3);if(d<=.5||d>l.posRadius.w){continue;}factor=l.colorIntensity.a*exp(-2.3*(d/l.posRadius.w)*(d/l.posRadius.w));L=normalize(vec3f(d3.x,-d3.y,d3.z));}let NoL=max(dot(n,L),0.0);if(NoL<=0.0){continue;}let c=lum(l.colorIntensity.rgb);diff+=c*factor*(.30+.70*NoL);let R=reflect(-L,n);spec+=c*factor*pow(max(dot(R,V),0.0),42.0);}return vec2f(diff,spec);}
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[vi],0,1);}
@fragment fn fs_main(@builtin(position) frag:vec4f)->@location(0) vec4f{
  let size=vec2i(textureDimensions(sceneTex));let q=clamp(vec2i(frag.xy),vec2i(0),size-vec2i(1));let fieldSize=vec2i(textureDimensions(fieldTex));let fq=clamp(vec2i(vec2f(q)/vec2f(size)*vec2f(fieldSize)),vec2i(0),fieldSize-vec2i(1));let fld=textureLoad(fieldTex,fq,0);let mask=fld.r;if(mask<.015||params.counts.w==0u){return vec4f(0);}
  let p=vec2f(q);let sg=spectrum(p);let grad=sg.xy;let n=normalize(vec3f(-grad.x,grad.y,1.34));let energy=lightEnergy(p,n);let directVis=clamp(textureLoad(visibilityTex,q,0).g,0.0,1.0);let currentDepth=textureLoad(depthTex,q,0);let uvShift=vec2f(grad.x,-grad.y)*(0.0014+0.0011*params.extentTime.w)*params.controls1.z;let shiftPx=vec2i(round(uvShift*vec2f(size)));let rq=clamp(q+shiftPx,vec2i(0),size-vec2i(1));let refrDepth=textureLoad(depthTex,rq,0);let depthDiff=abs(currentDepth-refrDepth);let refractWeight=1.0-smoothstep(params.baseDepth.w,params.baseDepth.w*4.0,depthDiff);let under0=textureLoad(sceneTex,q,0).rgb;let under1=textureLoad(sceneTex,rq,0).rgb;let under=mix(under0,under1,refractWeight);let sceneVis=clamp(lum(under)*2.4,0.0,1.0);let directEnergy=clamp(energy.x*directVis,0.0,3.0);let illum=clamp(max(sceneVis,directEnergy*.55),0.0,1.0);
  let shore=1.0-smoothstep(.02,.23,fld.g);let edgeGlow=pow(shore,1.45)*params.controls1.y;let slope=clamp(length(grad)*3.0,0.0,1.0);let micro=pow(clamp(slope*.76+sg.z*.16,0.0,1.0),2.2);let foam=clamp((shore*(.30+.24*micro)+sg.w)*params.controls1.w,0.0,1.15);let water=params.baseDepth.rgb*(.12+.20*clamp(energy.x,0.0,2.0))*directVis;let hi=params.highlightQuality.rgb*(energy.y*.34*params.controls1.x+micro*.018*params.controls0.w)*directVis;let foamLight=params.foamRipple.rgb*foam*.22*illum;let target=under*.93+water+hi+foamLight+params.highlightQuality.rgb*edgeGlow*.012*illum;let mixWeight=clamp((.12+.07*params.extentTime.w)*illum,0.0,.30);let col=max(vec3f(0),mix(under,target,mixWeight));let alpha=clamp(mask*(.10+.045*params.extentTime.w+.028*foam)*illum,0.0,.30);
  if(params.counts.z==1u){return vec4f(vec3f(mask),1);}if(params.counts.z==2u){return vec4f(vec3f(clamp(energy.x*directVis,0.0,1.0)),1);}if(params.counts.z==3u){return vec4f(vec3f(directVis),1);}if(params.counts.z==4u){return vec4f(vec3f(currentDepth),1);}if(params.counts.z==5u){return vec4f(vec3f(refractWeight),1);}return vec4f(col,alpha);
}`;

  function halfToFloat(h){h=Number(h)&0xffff;const s=(h>>15)&1,e=(h>>10)&31,f=h&1023;if(e===0)return(s?-1:1)*Math.pow(2,-14)*(f/1024);if(e===31)return f?NaN:(s?-Infinity:Infinity);return(s?-1:1)*Math.pow(2,e-15)*(1+f/1024);}

  class WebGPUWaterPass{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUWaterPass requires GPUDevice');this.device=options.device;this.queue=options.queue||options.device.queue;this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));this.registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width:this.width,height:this.height,labelPrefix:'SteelMothWater'});this.pipelines=new Resources.PipelineCache(this.device,{labelPrefix:'SteelMothWater'});this.pipeline=null;this.fieldTexture=null;this.fieldWidth=0;this.fieldHeight=0;this.fieldRoomId=null;this.fieldRevision='';this.fieldCpu=null;this.renderCount=0;this.fieldUploadCount=0;this.invalidationCount=0;this.valid=false;this.lastInvalidationReason='uninitialized';this.lastSnapshot=null;this.compilation=[];this._defineResources();
    }
    _name(n){return`sm400:${n}`;}
    _defineResources(){this.registry.defineTexture(this._name('output'),{format:OUTPUT_FORMAT,usage:textureUsage('RENDER_ATTACHMENT','TEXTURE_BINDING','COPY_SRC'),size:'surface'});this.registry.defineBuffer(this._name('params'),{size:PARAM_BYTES,usage:bufferUsage('UNIFORM','COPY_DST')});this.registry.defineBuffer(this._name('ripples'),{size:MAX_RIPPLES*RIPPLE_STRIDE,usage:bufferUsage('STORAGE','COPY_DST')});}
    async initialize(){if(this.pipeline)return this;this.pipeline=await this.pipelines.getRender('sm400-water-v1',async(device,label)=>{const module=device.createShaderModule({label:`${label}:wgsl`,code:WATER_WGSL});if(typeof module.getCompilationInfo==='function'){const info=await module.getCompilationInfo(),messages=Array.from(info.messages||[]).map(m=>({type:m.type,message:m.message,lineNum:m.lineNum,linePos:m.linePos}));this.compilation=messages;const errors=messages.filter(m=>m.type==='error');if(errors.length)throw new Error(`SM-400 water WGSL compilation failed: ${errors.map(e=>e.message).join('; ')}`);}return device.createRenderPipeline({label,layout:'auto',vertex:{module,entryPoint:'vs_main'},fragment:{module,entryPoint:'fs_main',targets:[{format:OUTPUT_FORMAT}]},primitive:{topology:'triangle-list'}});});return this;}
    setField(field={}){const width=Math.max(1,Math.round(field.width||0)),height=Math.max(1,Math.round(field.height||0)),rgba=field.rgba;if(!rgba||rgba.byteLength!==width*height*4)throw new RangeError('SM-400 water field requires RGBA8 data exactly width*height*4 bytes');const roomId=String(field.roomId??'unknown-room'),revision=String(field.revision??'0'),same=this.fieldTexture&&width===this.fieldWidth&&height===this.fieldHeight,signature=`${roomId}|${revision}|${width}x${height}`;if(this.fieldRevision===signature)return false;if(!same){try{this.fieldTexture?.destroy?.();}catch(_e){}this.fieldTexture=this.device.createTexture({label:'SteelMothWater:field',size:{width,height,depthOrArrayLayers:1},format:FIELD_FORMAT,usage:textureUsage('TEXTURE_BINDING','COPY_DST')});}this.queue.writeTexture({texture:this.fieldTexture},rgba,{bytesPerRow:width*4,rowsPerImage:height},{width,height,depthOrArrayLayers:1});this.fieldWidth=width;this.fieldHeight=height;this.fieldRoomId=roomId;this.fieldRevision=signature;this.fieldCpu=new Uint8Array(rgba);this.fieldUploadCount++;this.invalidate('field-update');return true;}
    setMask(mask,width,height,options={}){const field=buildShoreField(mask,width,height,options.maxDistance??18);return this.setField({rgba:field.rgba,width,height,roomId:options.roomId,revision:options.revision});}
    invalidate(reason='explicit'){this.valid=false;this.invalidationCount++;this.lastInvalidationReason=String(reason||'explicit');return this.invalidationCount;}
    resize(width,height){width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));const changed=this.registry.resize(width,height);this.width=width;this.height=height;if(changed)this.invalidate('resize');return changed;}
    resetDevice(device,queue=device?.queue){if(!device)throw new Error('resetDevice requires GPUDevice');this.device=device;this.queue=queue||device.queue;this.registry.resetDevice(device,this.queue);this.pipelines.resetDevice(device);this.pipeline=null;const cpu=this.fieldCpu?new Uint8Array(this.fieldCpu):null,w=this.fieldWidth,h=this.fieldHeight,room=this.fieldRoomId,rev=this.fieldRevision;try{this.fieldTexture?.destroy?.();}catch(_e){}this.fieldTexture=null;this.fieldRevision='';if(cpu)this.setField({rgba:cpu,width:w,height:h,roomId:room,revision:`device:${rev}`});this.invalidate('device-reset');}
    sourceFromPaths(lighting,gbuffer,visibility){if(typeof lighting?.outputTexture!=='function'||!lighting?.registry?.require)throw new Error('SM-400 sourceFromPaths requires SM-204 WebGPUDeferredLighting');if(!gbuffer||typeof gbuffer._views!=='function')throw new Error('SM-400 sourceFromPaths requires SM-202 canonical depth target');if(!visibility||typeof visibility.bindings!=='function')throw new Error('SM-400 sourceFromPaths requires SM-307 visibility composition');const depth=gbuffer._views()?.depth;if(!depth)throw new Error('SM-400 sourceFromPaths could not resolve canonical depth view');const vb=visibility.bindings();return{sceneView:lighting.outputTexture().createView(),depthView:depth,visibilityView:vb.visibility,lightBuffer:lighting.registry.require(Lighting.LIGHT_BUFFER_NAME).handle,lightCount:lighting.activeLightCount||0,canonicalLights:clone(lighting.lastLights||[]),width:lighting.width||this.width,height:lighting.height||this.height};}
    async render(source={},frame={},settings={},options={}){await this.initialize();if(!this.fieldTexture)throw new Error('SM-400 render requires a water field');for(const k of ['sceneView','depthView','visibilityView','lightBuffer'])if(!source[k])throw new Error(`SM-400 render requires ${k}`);const roomId=String(frame.roomId??frame.frame?.roomId??this.fieldRoomId??'unknown-room');if(this.fieldRoomId!=null&&roomId!==this.fieldRoomId)throw new Error(`SM-400 stale water field rejected: field=${this.fieldRoomId} frame=${roomId}`);const width=Math.max(1,Math.round(source.width||this.width)),height=Math.max(1,Math.round(source.height||this.height));if(width!==this.width||height!==this.height)this.resize(width,height);const debug=DEBUG_MODES.includes(String(options.debug))?String(options.debug):'final',time=finite(options.time??frame.time??(frame.frame?.timeMs!=null?frame.frame.timeMs/1000:0),0),packed=packRipples(options.ripples??frame.ripples??[],settings.waterRippleBudget??MAX_RIPPLES),cfg=normalizeSettings(settings);this.queue.writeBuffer(this.registry.require(this._name('params')).handle,0,packParams(width,height,time,cfg,packed.ripples.length,source.lightCount||0,debug));this.queue.writeBuffer(this.registry.require(this._name('ripples')).handle,0,packed.bytes);const output=this.registry.require(this._name('output')).handle,pipeline=this.pipeline,bind=this.device.createBindGroup({label:'SteelMothWater:bind',layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.fieldTexture.createView()},{binding:1,resource:source.sceneView},{binding:2,resource:source.depthView},{binding:3,resource:source.visibilityView},{binding:4,resource:{buffer:source.lightBuffer}},{binding:5,resource:{buffer:this.registry.require(this._name('ripples')).handle}},{binding:6,resource:{buffer:this.registry.require(this._name('params')).handle}}]});const encoder=this.device.createCommandEncoder({label:'SteelMothWater:encoder'}),pass=encoder.beginRenderPass({label:'SteelMothWater:forward',colorAttachments:[{view:output.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();this.queue.submit([encoder.finish()]);if(options.wait!==false&&typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();this.renderCount++;this.valid=true;this.lastInvalidationReason='';this.lastSnapshot={schema:SNAPSHOT_SCHEMA,roomId,extent:{width,height},field:{width:this.fieldWidth,height:this.fieldHeight,revision:this.fieldRevision},lightCount:Math.min(Lighting.MAX_LIGHTS||17,source.lightCount||0),canonicalLightBuffer:Lighting.LIGHT_BUFFER_NAME,rippleCount:packed.ripples.length,quality:cfg.waterQuality,debug,inputs:{resolvedScene:true,canonicalDepth:true,shadowVisibility:true},gameplayAuthority:'unchanged; SM-400 consumes cosmetic/render descriptors only'};return this.diagnostics();}
    outputTexture(){if(!this.valid)throw new Error(`SM-400 water output is invalid: ${this.lastInvalidationReason}`);return this.registry.require(this._name('output')).handle;}
    bindings(){return{water:this.outputTexture().createView(),format:OUTPUT_FORMAT,generation:this.registry.generation};}
    async readPixel(x,y){const record=this.registry.require(this._name('output')),buffer=this.device.createBuffer({label:'SteelMothWater:readback',size:256,usage:bufferUsage('COPY_DST','MAP_READ')}),encoder=this.device.createCommandEncoder(),px=Math.max(0,Math.min(record.width-1,Math.floor(x))),py=Math.max(0,Math.min(record.height-1,Math.floor(y)));encoder.copyTextureToBuffer({texture:record.handle,origin:{x:px,y:py,z:0}},{buffer,bytesPerRow:256,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);await buffer.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(buffer.getMappedRange()).slice(0,8);buffer.unmap();buffer.destroy?.();const dv=new DataView(raw.buffer,raw.byteOffset,8);return[0,2,4,6].map(o=>halfToFloat(dv.getUint16(o,true)));}
    diagnostics(){return{schema:SCHEMA,valid:this.valid,extent:{width:this.width,height:this.height},outputFormat:OUTPUT_FORMAT,fieldFormat:FIELD_FORMAT,canonicalLightBuffer:Lighting.LIGHT_BUFFER_NAME,field:{width:this.fieldWidth,height:this.fieldHeight,roomId:this.fieldRoomId,revision:this.fieldRevision,uploadCount:this.fieldUploadCount},renderCount:this.renderCount,invalidationCount:this.invalidationCount,lastInvalidationReason:this.lastInvalidationReason,debugModes:[...DEBUG_MODES],snapshot:clone(this.lastSnapshot),compilation:clone(this.compilation),resourceDiagnostics:this.registry.diagnostics(),pipelineDiagnostics:this.pipelines.diagnostics(),evidenceBoundary:'Hosted WebGPU validates correctness/readback only; no target-GPU timing claim.'};}
    close(){try{this.fieldTexture?.destroy?.();}catch(_e){}this.fieldTexture=null;this.registry.close();this.pipelines.clear();this.valid=false;}
  }

  return{SCHEMA,SNAPSHOT_SCHEMA,OUTPUT_FORMAT,FIELD_FORMAT,MAX_RIPPLES,RIPPLE_STRIDE,PARAM_BYTES,DEBUG_MODES,DEFAULTS,WATER_WGSL,normalizeSettings,normalizeRipple,normalizeRipples,buildShoreField,canonicalLightVector,spectrumGradient,lightEnergyAt,depthAwareRefractionWeight,shadeWaterReference,packRipples,packParams,halfToFloat,WebGPUWaterPass};
});
