'use strict';

// Relay Moth Engine v1.44dev — reusable raw-WebGL2 surface rendering subsystem.
// This file intentionally knows nothing about Room, StoryState, collision, objectives,
// or save-game progression. It consumes visual descriptors only.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RelaySurfaceFX=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const VERSION='1.2.3';
  const MAX_RIPPLES=12;
  const MAX_PUSH_FIELDS=4;
  const GRASS_HARD_CAP=4600;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function hash32(a,b=0,c=0){let x=(a*374761393+b*668265263+c*2246822519)>>>0;x=(x^(x>>>13))*1274126177>>>0;return (x^(x>>>16))>>>0}
  const h01=(a,b=0,c=0)=>hash32(a,b,c)/4294967295;

  function fieldResolutionForQuality(quality,logicalW=640,logicalH=360){
    const q=clamp(Math.round(Number(quality)||0),0,4);
    if(q<=0)return[0,0];
    const base=q===1?128:q===2?224:q===3?320:416;
    return[base,Math.max(2,Math.round(base*logicalH/logicalW))];
  }

  class RevisionGate{
    constructor(){this.key='';this.rebuilds=0}
    shouldRebuild(signature,quality){const k=`${signature}|q${quality}`;if(k===this.key)return false;this.key=k;this.rebuilds++;return true}
    invalidate(){this.key=''}
  }

  class BoundedSources{
    constructor(cap=MAX_RIPPLES){this.cap=clamp(Math.round(cap)||1,1,MAX_RIPPLES);this.items=[]}
    setCap(cap){this.cap=clamp(Math.round(cap)||1,1,MAX_RIPPLES);if(this.items.length>this.cap)this.items.splice(0,this.items.length-this.cap)}
    add(item){this.items.push(item);if(this.items.length>this.cap)this.items.splice(0,this.items.length-this.cap)}
    update(dt){const live=[];for(const s of this.items){s.age=(s.age||0)+dt;if(s.age<(s.life||1))live.push(s)}this.items=live}
    clear(){this.items.length=0}
  }

  function buildShoreField(mask,w,h,maxDistance=18){
    const n=w*h,dist=new Float32Array(n),inf=1e6,diag=1.41421356;
    for(let i=0;i<n;i++)dist[i]=mask[i]?inf:0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(!mask[i])continue;let d=dist[i];
      if(x>0)d=Math.min(d,dist[i-1]+1);
      if(y>0)d=Math.min(d,dist[i-w]+1);
      if(x>0&&y>0)d=Math.min(d,dist[i-w-1]+diag);
      if(x+1<w&&y>0)d=Math.min(d,dist[i-w+1]+diag);
      dist[i]=d;
    }
    for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
      const i=y*w+x;if(!mask[i])continue;let d=dist[i];
      if(x+1<w)d=Math.min(d,dist[i+1]+1);
      if(y+1<h)d=Math.min(d,dist[i+w]+1);
      if(x+1<w&&y+1<h)d=Math.min(d,dist[i+w+1]+diag);
      if(x>0&&y+1<h)d=Math.min(d,dist[i+w-1]+diag);
      dist[i]=d;
    }
    const rgba=new Uint8Array(n*4),md=Math.max(1,maxDistance);
    for(let i=0;i<n;i++){
      const wet=!!mask[i],d=wet?clamp(dist[i],0,md):0,o=i*4;
      rgba[o]=wet?255:0;
      rgba[o+1]=wet?Math.round(d/md*255):0;
      rgba[o+2]=wet?Math.round(clamp(1-d/md,0,1)*255):0;
      rgba[o+3]=255;
    }
    return{rgba,dist,maxDistance:md};
  }

  function generateGrassInstances(descriptor,quality=1,density=1,logicalW=640,logicalH=360){
    const q=clamp(Math.round(Number(quality)||0),0,4),d=clamp(Number(density)||0,0,4.0);
    if(q<=0||d<=0||!descriptor?.clumps?.length)return{data:new Float32Array(0),count:0,candidates:0,culled:0,cap:0};
    const caps=[0,480,1500,3000,GRASS_HARD_CAP],cap=caps[q],out=[],clumps=descriptor.clumps||[];let candidates=0,culled=0;
    outer: for(let ci=0;ci<clumps.length;ci++){
      const c=clumps[ci],radius=clamp(Number(c.radius)||16,6,36),seed=(Number(c.seed)||hash32(ci,17,995))>>>0;
      const localDensity=clamp(Number(c.density??1),.35,2.4),count=Math.max(16,Math.round((44+radius*3.1)*d*localDensity*(q===1?1.1:q===2?1.6:q===3?2.05:2.45)));
      for(let i=0;i<count;i++){
        candidates++;
        const a=h01(seed,i,1)*Math.PI*2,r=Math.sqrt(h01(seed,i,2))*radius;
        const x=Number(c.x)+Math.cos(a)*r,y=Number(c.y)+Math.sin(a)*r*.78;
        if(x<3||x>logicalW-3||y<3||y>logicalH-3){culled++;continue}
        const height=(9.8+h01(seed,i,3)*(q===1?6.2:q===2?9.6:q===3?13.0:15.5))*1.08,width=(1.05+h01(seed,i,4)*(q===1?.75:q===2?1.05:q===3?1.30:1.55))*1.00;
        const phase=h01(seed,i,5)*Math.PI*2,tint=h01(seed,i,6),sway=.65+h01(seed,i,7)*.72;
        out.push(x,y,height,width,phase,tint,sway,0);
        if(out.length/8>=cap)break outer;
      }
    }
    return{data:new Float32Array(out),count:out.length/8,candidates,culled,cap};
  }

  function compileShader(gl,type,source,label){
    const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const msg=gl.getShaderInfoLog(s)||'unknown shader compile error';gl.deleteShader?.(s);throw new Error(`${label}: ${msg}`)}
    return s;
  }
  function makeProgram(gl,vs,fs,label){
    const p=gl.createProgram(),v=compileShader(gl,gl.VERTEX_SHADER,vs,`${label} vertex`),f=compileShader(gl,gl.FRAGMENT_SHADER,fs,`${label} fragment`);
    gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader?.(v);gl.deleteShader?.(f);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const msg=gl.getProgramInfoLog(p)||'unknown program link error';gl.deleteProgram?.(p);throw new Error(`${label} link: ${msg}`)}
    return p;
  }
  function uniform(gl,p,name){return gl.getUniformLocation(p,name)}

  class WaterField{
    constructor(gl,opts={}){
      this.gl=gl;this.logicalW=opts.logicalWidth||640;this.logicalH=opts.logicalHeight||360;this.ready=false;this.error='';this.sourceCanvas=null;this.signature='';this.quality=2;this.fieldW=0;this.fieldH=0;this.gate=new RevisionGate();this.sources=new BoundedSources(MAX_RIPPLES);this.rebuilds=0;this.uploadBytes=0;
      this.quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,-1,1,0,1,1,-1,1,0,1,1,1,1]),gl.STATIC_DRAW);
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
      const vs=`#version 300 es
        in vec2 aPos;in vec2 aUV;out vec2 vUV;void main(){vUV=aUV;gl_Position=vec4(aPos,0.0,1.0);}`;
      const fs=`#version 300 es
        precision highp float;const int MAX_RIPPLES=${MAX_RIPPLES};uniform sampler2D uField;uniform sampler2D uScene;uniform vec2 uLogicalSize;uniform vec2 uMainLightPos;uniform float uTime;uniform float uStrength;uniform float uWaveScale;uniform float uWaveSpeed;uniform float uFoamStrength;uniform float uRippleStrength;uniform float uNormalStrength;uniform float uDetailStrength;uniform float uHighlightStrength;uniform float uEdgeStrength;uniform float uRefractionStrength;uniform int uQuality;uniform int uRippleCount;uniform vec2 uRipplePos[MAX_RIPPLES];uniform float uRippleAge[MAX_RIPPLES];uniform float uRippleRadius[MAX_RIPPLES];uniform float uRippleAmp[MAX_RIPPLES];uniform float uRippleFoam[MAX_RIPPLES];uniform vec3 uBaseColor;uniform vec3 uFoamColor;uniform vec3 uHighlightColor;in vec2 vUV;out vec4 o;
        const float G=9.81;
        void wave(in vec2 p,in vec2 dir,in float k0,in float amp,in float phase,in float sharp,inout float h,inout vec2 grad,inout float crest){float k=k0*max(.35,uWaveScale);float w=sqrt(G*k);float th=dot(p,dir)*k+uTime*uWaveSpeed*w+phase;float sn=sin(th),cs=cos(th),sn2=sin(th*2.0+phase*.31),cs2=cos(th*2.0+phase*.31);h+=amp*(sn+sharp*.12*sn2);float dh=amp*k*(cs+sharp*.24*cs2);grad+=dir*dh;crest+=amp*pow(max(0.0,.5+.5*sn),10.0);}
        void ripple(in vec2 p,inout float h,inout vec2 grad,inout float foam){for(int i=0;i<MAX_RIPPLES;i++){if(i>=uRippleCount)break;vec2 qv=p-uRipplePos[i];float d=max(length(qv),.001),rr=max(6.0,uRippleRadius[i]),q=d/rr,a=clamp(uRippleAge[i],0.0,1.0),alive=(1.0-a)*(1.0-a),env=exp(-q*2.25)*alive,ph=q*18.0-a*22.0,sa=sin(ph),ca=cos(ph),amp=uRippleAmp[i]*uRippleStrength;h+=sa*env*amp;float dh=(ca*18.0-sa*2.25)*env*amp/rr;grad+=qv/d*dh;float front=rr*(.12+.88*a);foam+=exp(-abs(d-front)/max(2.0,rr*.05))*(1.0-a)*uRippleFoam[i];}}
        void spectrum(in vec2 p,out float h,out vec2 grad,out float crest,out float rfoam){h=0.0;grad=vec2(0);crest=0.0;rfoam=0.0;
          wave(p,normalize(vec2(.96,.28)),.020,.58,.3,.48,h,grad,crest);wave(p,normalize(vec2(.82,.57)),.029,.43,2.1,.42,h,grad,crest);wave(p,normalize(vec2(.99,-.11)),.041,.31,4.4,.38,h,grad,crest);wave(p,normalize(vec2(.63,.78)),.061,.23,1.3,.32,h,grad,crest);
          if(uQuality>=2){wave(p,normalize(vec2(.91,.42)),.086,.17,5.2,.28,h,grad,crest);wave(p,normalize(vec2(-.18,.98)),.118,.13,3.5,.24,h,grad,crest);wave(p,normalize(vec2(.75,-.66)),.162,.09,.8,.20,h,grad,crest);}
          if(uQuality>=3){wave(p,normalize(vec2(.98,.18)),.224,.062,2.8,.15,h,grad,crest);wave(p,normalize(vec2(.31,.95)),.308,.045,4.9,.12,h,grad,crest);wave(p,normalize(vec2(-.52,.85)),.410,.032,1.7,.10,h,grad,crest);}
          if(uQuality>=4){wave(p,normalize(vec2(.87,-.49)),.515,.024,3.3,.09,h,grad,crest);wave(p,normalize(vec2(-.09,.99)),.660,.018,5.4,.08,h,grad,crest);}
          ripple(p,h,grad,rfoam);}
        void main(){vec4 fld=texture(uField,vUV);float mask=fld.r;if(mask<.015){o=vec4(0);return;}vec2 p=vec2(vUV.x*uLogicalSize.x,(1.0-vUV.y)*uLogicalSize.y);float h,crest,rfoam;vec2 grad;spectrum(p,h,grad,crest,rfoam);grad*=uNormalStrength*(1.0+.16*uDetailStrength);vec3 n=normalize(vec3(-grad.x,grad.y,1.34));vec2 lightDelta=uMainLightPos-p;float lightDist=max(length(lightDelta),1.0);vec3 L=normalize(vec3(lightDelta.x,-lightDelta.y,96.0));vec3 V=vec3(0,0,1);float ndl=max(dot(n,L),0.0),diff=.30+.70*ndl,fres=pow(1.0-max(n.z,0.0),3.0),spec=pow(max(dot(reflect(-L,n),V),0.0),42.0);float shore=1.0-smoothstep(.02,.23,fld.g),edgeGlow=pow(shore,1.45)*uEdgeStrength;float slope=clamp(length(grad)*3.0,0.0,1.0),micro=pow(clamp(slope*.76+crest*.16,0.0,1.0),2.2);float foam=clamp((shore*(.30+.24*micro)+rfoam)*uFoamStrength,0.0,1.15);vec2 refractUV=vUV+vec2(grad.x,-grad.y)*(0.0014+0.0011*uStrength)*uRefractionStrength;vec3 under=texture(uScene,clamp(refractUV,vec2(0),vec2(1))).rgb;float underLum=dot(under,vec3(.2126,.7152,.0722)),lightVis=clamp(underLum*2.4+.025,0.0,1.0),distFade=clamp(1.0-lightDist/max(uLogicalSize.x,uLogicalSize.y)*.75,.22,1.0);vec3 water=uBaseColor*(.22+.30*diff);vec3 target=under*(.90+.06*diff)+water*.20;vec3 col=mix(under,target,clamp((.12+.07*uStrength)*lightVis*distFade,0.0,.28));col+=uHighlightColor*(spec*.34*uHighlightStrength+fres*.055*uHighlightStrength+micro*.018*uDetailStrength)*lightVis*distFade;col+=uFoamColor*foam*.22*lightVis+uHighlightColor*edgeGlow*.016*lightVis;col=min(col,under+vec3(.16));float a=mask*(.10+.045*uStrength+.018*fres+.028*foam)*lightVis;o=vec4(max(col,0.0),clamp(a,0.0,.30));}`;
      this.program=makeProgram(gl,vs,fs,'SurfaceFX WaterField');this.ready=true;
    }
    setSource(canvas,signature='water',quality=this.quality){if(this.sourceCanvas&&this.sourceCanvas!==canvas){try{this.sourceCanvas.width=1;this.sourceCanvas.height=1}catch(_e){}}this.sourceCanvas=canvas;this.signature=String(signature);this.setQuality(quality)}
    setQuality(quality){const q=clamp(Math.round(Number(quality)||0),0,4);this.quality=q;if(!this.sourceCanvas||q<=0)return;if(this.gate.shouldRebuild(this.signature,q))this.rebuild()}
    rebuild(){if(!this.sourceCanvas||this.quality<=0)return;const [w,h]=fieldResolutionForQuality(this.quality,this.logicalW,this.logicalH);if(!w||!h)return;let c;if(typeof OffscreenCanvas!=='undefined')c=new OffscreenCanvas(w,h);else{c=document.createElement('canvas');c.width=w;c.height=h}c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:true});x.imageSmoothingEnabled=false;x.clearRect(0,0,w,h);x.drawImage(this.sourceCanvas,0,0,w,h);const data=x.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h);for(let i=0;i<mask.length;i++)mask[i]=(data[i*4+3]>20&&data[i*4]>20)?1:0;const field=buildShoreField(mask,w,h,this.quality===1?10:this.quality===2?16:22),gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,field.rgba);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);this.fieldW=w;this.fieldH=h;this.rebuilds++;this.uploadBytes=field.rgba.byteLength}
    addRipple(x,y,opts={}){this.sources.add({x:Number(x)||0,y:Number(y)||0,age:0,life:clamp(Number(opts.life)||1.15,.2,4),radius:clamp(Number(opts.radius)||72,8,220),amplitude:clamp(Number(opts.amplitude)||.72,0,2.5),foam:clamp(Number(opts.foam??.55),0,2)})}
    update(dt,settings={}){this.sources.setCap(settings.waterRippleBudget??MAX_RIPPLES);this.sources.update(dt);this.setQuality(settings.waterQuality??2)}
    _quadBindings(){const gl=this.gl,p=this.program;gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);const a=gl.getAttribLocation(p,'aPos'),u=gl.getAttribLocation(p,'aUV');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(u);gl.vertexAttribPointer(u,2,gl.FLOAT,false,16,8)}
    render(settings,material,time,sceneTex=null,mainLightPos=null){if(!this.ready||!this.sourceCanvas||this.quality<=0)return false;const gl=this.gl,p=this.program;gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(p);this._quadBindings();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(uniform(gl,p,'uField'),0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,sceneTex);gl.uniform1i(uniform(gl,p,'uScene'),1);gl.uniform2f(uniform(gl,p,'uLogicalSize'),this.logicalW,this.logicalH);gl.uniform2f(uniform(gl,p,'uMainLightPos'),mainLightPos?.[0]??this.logicalW*.5,mainLightPos?.[1]??this.logicalH*.5);gl.uniform1f(uniform(gl,p,'uTime'),Number(time)||0);gl.uniform1f(uniform(gl,p,'uStrength'),settings.waterStrength??1.10);gl.uniform1f(uniform(gl,p,'uWaveScale'),settings.waterWaveScale??1);gl.uniform1f(uniform(gl,p,'uWaveSpeed'),settings.waterWaveSpeed??1);gl.uniform1f(uniform(gl,p,'uFoamStrength'),settings.shoreFoamStrength??1.05);gl.uniform1f(uniform(gl,p,'uRippleStrength'),settings.waterRippleStrength??1.0);gl.uniform1f(uniform(gl,p,'uNormalStrength'),settings.waterNormalStrength??1.52);gl.uniform1f(uniform(gl,p,'uDetailStrength'),settings.waterDetailStrength??1.34);gl.uniform1f(uniform(gl,p,'uHighlightStrength'),settings.waterHighlightStrength??1.60);gl.uniform1f(uniform(gl,p,'uEdgeStrength'),settings.waterEdgeStrength??1.42);gl.uniform1f(uniform(gl,p,'uRefractionStrength'),settings.waterRefractionStrength??1.18);gl.uniform1i(uniform(gl,p,'uQuality'),this.quality);
      const pos=new Float32Array(MAX_RIPPLES*2),age=new Float32Array(MAX_RIPPLES),rad=new Float32Array(MAX_RIPPLES),amp=new Float32Array(MAX_RIPPLES),foam=new Float32Array(MAX_RIPPLES),items=this.sources.items.slice(-MAX_RIPPLES);for(let i=0;i<items.length;i++){const s=items[i];pos[i*2]=s.x;pos[i*2+1]=s.y;age[i]=clamp(s.age/s.life,0,1);rad[i]=s.radius;amp[i]=s.amplitude;foam[i]=s.foam}gl.uniform1i(uniform(gl,p,'uRippleCount'),items.length);gl.uniform2fv(uniform(gl,p,'uRipplePos[0]'),pos);gl.uniform1fv(uniform(gl,p,'uRippleAge[0]'),age);gl.uniform1fv(uniform(gl,p,'uRippleRadius[0]'),rad);gl.uniform1fv(uniform(gl,p,'uRippleAmp[0]'),amp);gl.uniform1fv(uniform(gl,p,'uRippleFoam[0]'),foam);const b=material.base||[.2,.5,.8],f=material.foam||b,h=material.highlight||f;gl.uniform3f(uniform(gl,p,'uBaseColor'),b[0],b[1],b[2]);gl.uniform3f(uniform(gl,p,'uFoamColor'),f[0],f[1],f[2]);gl.uniform3f(uniform(gl,p,'uHighlightColor'),h[0],h[1],h[2]);gl.drawArrays(gl.TRIANGLES,0,6);return true}
    diagnostics(){return{ready:this.ready,error:this.error,quality:this.quality,field:[this.fieldW,this.fieldH],fieldBytes:this.uploadBytes,rebuilds:this.rebuilds,gateRebuilds:this.gate.rebuilds,ripples:this.sources.items.length,rippleCap:this.sources.cap}}
  }

  class GrassField{
    constructor(gl,opts={}){
      this.gl=gl;this.logicalW=opts.logicalWidth||640;this.logicalH=opts.logicalHeight||360;this.ready=false;this.error='';this.descriptor=null;this.signature='';this.lastBuildKey='';this.instanceCount=0;this.candidates=0;this.culled=0;this.capacity=0;this.rebuilds=0;this.uploadBytes=0;
      this.vertex=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.vertex);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-.5,0,0,.5,0,0,-.28,1,1,-.28,1,1,.5,0,0,.28,1,1]),gl.STATIC_DRAW);this.instances=gl.createBuffer();this.fallbackScene=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.fallbackScene);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([96,96,96,255]));
      const vs=`#version 300 es
        precision highp float;const int MAX_PUSH=${MAX_PUSH_FIELDS};in vec3 aBlade;in vec4 aInstance;in vec4 aMeta;uniform vec2 uLogicalSize;uniform float uTime;uniform float uWindStrength;uniform float uWindSpeed;uniform float uPushStrength;uniform int uPushCount;uniform vec2 uPushPos[MAX_PUSH];uniform float uPushRadius[MAX_PUSH];out float vT;out float vTint;out vec2 vWorld;void main(){float t=aBlade.z;vec2 base=aInstance.xy;float height=aInstance.z,width=aInstance.w,phase=aMeta.x,tint=aMeta.y,sway=aMeta.z;float windField=sin(base.x*.013+base.y*.009+uTime*uWindSpeed*.82+phase)+.55*sin(base.x*.006-base.y*.011+uTime*uWindSpeed*.47+1.7+phase*.7);vec2 bend=vec2(windField,windField*.16)*uWindStrength*sway*1.625;vec2 push=vec2(0);for(int i=0;i<MAX_PUSH;i++){if(i>=uPushCount)break;vec2 d=base-uPushPos[i];float dist=max(length(d),.001),q=clamp(1.0-dist/max(1.0,uPushRadius[i]),0.0,1.0);push+=d/dist*q*q*uPushStrength*3.6;}vec2 p=base+vec2(aBlade.x*width,-t*height)+(bend+push)*pow(t,1.35);vec2 clip=vec2(p.x/uLogicalSize.x*2.0-1.0,1.0-p.y/uLogicalSize.y*2.0);gl_Position=vec4(clip,0,1);vT=t;vTint=tint;vWorld=p;}`;
      const fs=`#version 300 es
        precision highp float;uniform sampler2D uScene;uniform int uUseSceneLight;uniform vec2 uLogicalSize;uniform vec2 uMainLightPos;uniform vec3 uBaseColor;uniform vec3 uTipColor;uniform vec3 uHighlightColor;in float vT;in float vTint;in vec2 vWorld;out vec4 o;void main(){vec3 base=mix(uBaseColor,uTipColor,smoothstep(0.0,1.0,vT));vec2 suv=vec2(vWorld.x/uLogicalSize.x,1.0-vWorld.y/uLogicalSize.y);vec3 scene=texture(uScene,clamp(suv,vec2(0),vec2(1))).rgb;float sceneLum=dot(scene,vec3(.2126,.7152,.0722));float visibility=uUseSceneLight!=0?clamp(sceneLum*2.15+.028,.028,1.0):.72;vec2 delta=uMainLightPos-vWorld;vec3 L=normalize(vec3(delta.x,-delta.y,72.0));vec3 N=normalize(vec3((vTint-.5)*.12,-.18,.975));float ndl=max(dot(N,L),0.0),diff=.34+.66*ndl;float tipGlow=pow(vT,1.7)*(.08+.10*vTint)*visibility;vec3 c=base*(.18+.82*visibility)*diff+uHighlightColor*tipGlow;float a=(.22+.16*vTint)*smoothstep(0.0,.16,vT+.12)*mix(.50,1.0,visibility);o=vec4(max(c,vec3(0)),clamp(a,0.0,.42));}`;
      this.program=makeProgram(gl,vs,fs,'SurfaceFX GrassField');this.ready=true;
    }
    setDescriptor(descriptor,settings={}){this.descriptor=descriptor||{signature:'none',clumps:[]};this.signature=String(this.descriptor.signature||'grass');this.rebuild(settings)}
    rebuild(settings={}){if(!this.descriptor)return;const q=clamp(Math.round(Number(settings.grassQuality)||0),0,4),density=clamp(Number(settings.grassDensity??.7),0,4.0),key=`${this.signature}|q${q}|d${density.toFixed(3)}`;if(key===this.lastBuildKey)return;this.lastBuildKey=key;const built=generateGrassInstances(this.descriptor,q,density,this.logicalW,this.logicalH),gl=this.gl;this.instanceCount=built.count;this.candidates=built.candidates;this.culled=built.culled;this.capacity=built.cap;gl.bindBuffer(gl.ARRAY_BUFFER,this.instances);gl.bufferData(gl.ARRAY_BUFFER,built.data,gl.STATIC_DRAW);this.uploadBytes=built.data.byteLength;this.rebuilds++}
    render(settings,material,time,pushFields=[],sceneTex=null,mainLightPos=null){if(!this.ready||!settings.grassFX||!settings.surfaceFX)return false;this.rebuild(settings);if(!this.instanceCount)return false;const gl=this.gl,p=this.program;gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(p);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.vertex);const a=gl.getAttribLocation(p,'aBlade');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,3,gl.FLOAT,false,12,0);gl.vertexAttribDivisor(a,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.instances);const ai=gl.getAttribLocation(p,'aInstance'),am=gl.getAttribLocation(p,'aMeta');gl.enableVertexAttribArray(ai);gl.vertexAttribPointer(ai,4,gl.FLOAT,false,32,0);gl.vertexAttribDivisor(ai,1);gl.enableVertexAttribArray(am);gl.vertexAttribPointer(am,4,gl.FLOAT,false,32,16);gl.vertexAttribDivisor(am,1);
      gl.uniform2f(uniform(gl,p,'uLogicalSize'),this.logicalW,this.logicalH);gl.uniform2f(uniform(gl,p,'uMainLightPos'),mainLightPos?.[0]??this.logicalW*.5,mainLightPos?.[1]??this.logicalH*.5);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,sceneTex||this.fallbackScene);gl.uniform1i(uniform(gl,p,'uScene'),0);gl.uniform1i(uniform(gl,p,'uUseSceneLight'),sceneTex?1:0);gl.uniform1f(uniform(gl,p,'uTime'),Number(time)||0);gl.uniform1f(uniform(gl,p,'uWindStrength'),settings.grassWindStrength??.82);gl.uniform1f(uniform(gl,p,'uWindSpeed'),settings.grassWindSpeed??1);gl.uniform1f(uniform(gl,p,'uPushStrength'),settings.grassPushStrength??.82);const pushes=(pushFields||[]).slice(0,MAX_PUSH_FIELDS),pp=new Float32Array(MAX_PUSH_FIELDS*2),pr=new Float32Array(MAX_PUSH_FIELDS);for(let i=0;i<pushes.length;i++){pp[i*2]=pushes[i].x;pp[i*2+1]=pushes[i].y;pr[i]=pushes[i].radius||34}gl.uniform1i(uniform(gl,p,'uPushCount'),pushes.length);gl.uniform2fv(uniform(gl,p,'uPushPos[0]'),pp);gl.uniform1fv(uniform(gl,p,'uPushRadius[0]'),pr);const b=material.base||[.2,.5,.2],t=material.tip||b,h=material.highlight||t;gl.uniform3f(uniform(gl,p,'uBaseColor'),b[0],b[1],b[2]);gl.uniform3f(uniform(gl,p,'uTipColor'),t[0],t[1],t[2]);gl.uniform3f(uniform(gl,p,'uHighlightColor'),h[0],h[1],h[2]);gl.drawArraysInstanced(gl.TRIANGLES,0,6,this.instanceCount);gl.vertexAttribDivisor(ai,0);gl.vertexAttribDivisor(am,0);return true}
    diagnostics(){return{ready:this.ready,error:this.error,instances:this.instanceCount,instanceCap:this.capacity,candidates:this.candidates,culled:this.culled,instanceBytes:this.uploadBytes,rebuilds:this.rebuilds,signature:this.signature}}
  }

  class SurfaceFX{
    constructor(gl,opts={}){this.gl=gl;this.version=VERSION;this.errors=[];this.water=null;this.grass=null;try{this.water=new WaterField(gl,opts)}catch(e){this.errors.push(String(e?.message||e));console.error('SurfaceFX WaterField disabled',e)}try{this.grass=new GrassField(gl,opts)}catch(e){this.errors.push(String(e?.message||e));console.error('SurfaceFX GrassField disabled',e)}}
    get ready(){return!!(this.water?.ready||this.grass?.ready)}
    setWaterMask(canvas,signature,settings={}){try{this.water?.setSource(canvas,signature,settings.waterQuality??2)}catch(e){this.errors.push(String(e?.message||e));if(this.water){this.water.ready=false;this.water.error=String(e?.message||e)}}}
    setGrassDescriptor(desc,settings={}){try{this.grass?.setDescriptor(desc,settings)}catch(e){this.errors.push(String(e?.message||e));if(this.grass){this.grass.ready=false;this.grass.error=String(e?.message||e)}}}
    addWaterRipple(x,y,opts={}){if(this.water?.ready)this.water.addRipple(x,y,opts)}
    update(dt,settings={}){if(this.water?.ready)try{this.water.update(dt,settings)}catch(e){this.errors.push(String(e?.message||e));this.water.ready=false;this.water.error=String(e?.message||e);console.error('SurfaceFX WaterField update disabled; legacy fallback retained',e)}if(this.grass?.ready&&this.grass?.descriptor)try{this.grass.rebuild(settings)}catch(e){this.errors.push(String(e?.message||e));this.grass.ready=false;this.grass.error=String(e?.message||e);console.error('SurfaceFX GrassField update disabled',e)}}
    renderWater(settings,material,time,sceneTex=null,mainLightPos=null){if(settings.surfaceFX===false)return false;try{return this.water?.render(settings,material,time,sceneTex,mainLightPos)||false}catch(e){this.errors.push(String(e?.message||e));if(this.water){this.water.ready=false;this.water.error=String(e?.message||e)}console.error('SurfaceFX WaterField render disabled; using fallback',e);return false}}
    renderGrass(settings,material,time,pushFields,sceneTex=null,mainLightPos=null){try{return this.grass?.render(settings,material,time,pushFields,sceneTex,mainLightPos)||false}catch(e){this.errors.push(String(e?.message||e));if(this.grass){this.grass.ready=false;this.grass.error=String(e?.message||e)}console.error('SurfaceFX GrassField render disabled',e);return false}}
    diagnostics(){return{version:this.version,ready:this.ready,errors:this.errors.slice(-8),water:this.water?.diagnostics()||null,grass:this.grass?.diagnostics()||null}}
  }

  return{VERSION,MAX_RIPPLES,MAX_PUSH_FIELDS,GRASS_HARD_CAP,RevisionGate,BoundedSources,buildShoreField,generateGrassInstances,fieldResolutionForQuality,SurfaceFX,WaterField,GrassField};
});
