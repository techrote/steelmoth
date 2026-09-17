'use strict';

/*
 * Relay Moth Engine FoliageFX v1.44dev
 * Reusable WebGL2 foliage renderer: static instancing, rooted deformation,
 * coherent wind, bounded actor interaction, depth classification and contact AO.
 * Gameplay/collision authority deliberately remains outside this module.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RelayFoliageFX=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const VERSION='1.2.3';
  const TAU=Math.PI*2;
  const MAX_INTERACTION_SOURCES=8;
  const FOLIAGE_HARD_CAP=208;
  const INSTANCE_FLOATS=28;
  const INSTANCE_BYTES=INSTANCE_FLOATS*4;
  const GRID_CELL=40;
  const MATERIAL_CONTRACT=Object.freeze({blend:'alpha',additive:false,emissive:0,opaqueSourceAlpha:true,specular:'very-low'});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const smoothstep=(a,b,x)=>{const t=clamp((x-a)/Math.max(1e-8,b-a),0,1);return t*t*(3-2*t)};
  function hash32(a,b=0,c=0){let x=(Number(a)*374761393+Number(b)*668265263+Number(c)*2246822519)>>>0;x=(x^(x>>>13))*1274126177>>>0;return (x^(x>>>16))>>>0}
  function h01(a,b=0,c=0){return hash32(a,b,c)/4294967295}

  const CATEGORY_NAMES=Object.freeze(['GROUND_MOSS','SHORT_GRASS','FERN','BROAD_LEAF','FLOWER_CLUSTER','BUSH']);
  const CATEGORY_IDS=Object.freeze(Object.fromEntries(CATEGORY_NAMES.map((n,i)=>[n,i])));
  const CATEGORY_PROFILES=Object.freeze({
    GROUND_MOSS:Object.freeze({root_cutoff:.45,bend_scale:.34,flutter_scale:.00,stiffness:9.0,damping:.84,interaction_scale:.42,shadow_scale:.48,bend_exponent:1.85,width_scale:1.06,height_scale:1.08}),
    SHORT_GRASS:Object.freeze({root_cutoff:.30,bend_scale:.78,flutter_scale:.28,stiffness:8.8,damping:.84,interaction_scale:1.10,shadow_scale:.54,bend_exponent:1.45,width_scale:1.14,height_scale:1.34}),
    FERN:Object.freeze({root_cutoff:.30,bend_scale:1.15,flutter_scale:.32,stiffness:6.6,damping:.89,interaction_scale:1.15,shadow_scale:.72,bend_exponent:1.20,width_scale:1.10,height_scale:1.26}),
    BROAD_LEAF:Object.freeze({root_cutoff:.35,bend_scale:.82,flutter_scale:.12,stiffness:5.8,damping:.91,interaction_scale:.76,shadow_scale:.76,bend_exponent:1.70,width_scale:1.08,height_scale:1.18}),
    FLOWER_CLUSTER:Object.freeze({root_cutoff:.40,bend_scale:.24,flutter_scale:.03,stiffness:7.4,damping:.90,interaction_scale:.14,shadow_scale:.60,bend_exponent:1.85,width_scale:1.00,height_scale:1.00}),
    BUSH:Object.freeze({root_cutoff:.45,bend_scale:.46,flutter_scale:.06,stiffness:5.2,damping:.93,interaction_scale:.45,shadow_scale:.88,bend_exponent:2.10,width_scale:1.07,height_scale:1.12})
  });
  const QUALITY_CAPS=Object.freeze([72,72,128,FOLIAGE_HARD_CAP]);
  const QUALITY_SOURCE_CAPS=Object.freeze([0,4,6,8]);

  function categoryProfile(name,override={}){
    const key=CATEGORY_PROFILES[name]?name:'BROAD_LEAF';
    const base=CATEGORY_PROFILES[key];
    return {category:key,...base,...override};
  }
  function inferCategory(name=''){
    const n=String(name).toLowerCase();
    if(n.includes('moss'))return 'GROUND_MOSS';
    if(n.includes('grass'))return 'SHORT_GRASS';
    if(n.includes('fern')||n.includes('spiral'))return 'FERN';
    if(n.includes('flower')||n.includes('bell'))return 'FLOWER_CLUSTER';
    if(n.includes('bush'))return 'BUSH';
    return 'BROAD_LEAF';
  }

  class FoliageRegistry{
    constructor(manifest={}){
      this.manifest=manifest||{};
      this.regions=this.manifest.regions||{};
      this.roles=this.manifest.roles||{};
      this.meta=this.manifest.region_meta||{};
      this.sourceSize=this.manifest.source_size||[1,1];
      this.worldScale=Number(this.manifest.world_scale)||.18;
      this.cache=new Map();
    }
    has(name){return !!this.regions[name]}
    get(name){
      if(this.cache.has(name))return this.cache.get(name);
      const r=this.regions[name];if(!r)return null;
      const meta=this.meta[name]||{},fx=meta.foliage_fx||{},profile=categoryProfile(String(fx.category||inferCategory(name)).toUpperCase(),fx);
      const [iw,ih]=this.sourceSize,[x,y,w,h]=r,scale=this.worldScale*(Number(meta.world_scale)||1);
      const out={name,region:r,uv:[(x+.5)/iw,(y+.5)/ih,(x+w-.5)/iw,(y+h-.5)/ih],worldSize:[w*scale,h*scale],tintStrength:Number(meta.tint_strength??.07),...profile};
      this.cache.set(name,out);return out;
    }
    pool(excluded=[]){
      const ex=new Set(excluded||[]),raw=[...(this.roles.foliage_pool||this.roles.foliage||this.roles.foliage_v391||[])];
      return [...new Set(raw)].filter(n=>this.has(n)&&!ex.has(n));
    }
  }

  class RootedDeformation{
    static weight(verticalUV,profile,quality=3){
      const t=clamp(Number(verticalUV)||0,0,1),cut=clamp(Number(profile?.root_cutoff??.35),0,.8);
      if(t<=cut)return 0; // exact root lock
      let w=Math.pow(smoothstep(cut,1,t),Number(profile?.bend_exponent??1.6));
      const q=clamp(Math.round(Number(quality)||0),0,3);
      if(q===0)return 0;
      if(q===1)w=w<.32?.16:w<.72?.52:1;
      else if(q===2)w=w<.20?.12:w<.52?.48:w<.82?.76:1;
      return w;
    }
    static bandWeights(profile,quality=3,rows=[0,.25,.40,.60,.80,1]){return rows.map(t=>this.weight(t,profile,quality))}
  }

  class WindField{
    constructor(){this.primaryWavelength=216;this.secondaryWavelength=94}
    sample(x,y,time=0,settings={},variation=0){
      const strength=clamp(Number(settings.foliageWindStrength??.78),0,4),speed=clamp(Number(settings.foliageWindSpeed??.82),0,4.5);
      if(!strength)return {x:0,y:0,primary:0,secondary:0};
      const p=Math.sin((x*.88+y*.26)/this.primaryWavelength*TAU+time*(.34+.34*speed));
      const g=Math.sin((x*.34-y*.72)/this.secondaryWavelength*TAU-time*(.25+.48*speed)+.8);
      const env=.62+.38*Math.pow(.5+.5*Math.sin(time*.17+x*.0031+y*.0017),3);
      const local=(variation-.5)*.12;
      const v=(p*.76+g*.24*env+local)*strength;
      return {x:v,y:-Math.abs(v)*.055,primary:p,secondary:g};
    }
    neighborDelta(a,b,time=0,settings={foliageWindStrength:1,foliageWindSpeed:1}){const x=this.sample(a[0],a[1],time,settings,.5).x,y=this.sample(b[0],b[1],time,settings,.5).x;return Math.abs(x-y)}
  }

  function interactionDecay(age,stiffness=7,damping=.89){
    const rate=clamp(stiffness*(1-clamp(damping,0,.999))*1.75,.45,5.5);
    return Math.exp(-Math.max(0,age)*rate);
  }

  class InteractionField{
    constructor(max=MAX_INTERACTION_SOURCES){this.max=clamp(max|0,0,MAX_INTERACTION_SOURCES);this.tracks=new Map();this.sources=[];this.time=0}
    reset(){this.tracks.clear();this.sources=[];this.time=0}
    update(dt,actors=[],quality=3){
      dt=clamp(Number(dt)||0,0,.1);this.time+=dt;const cap=Math.min(this.max,QUALITY_SOURCE_CAPS[clamp(Math.round(quality)||0,0,3)]),seen=new Set(),ranked=[];
      for(let i=0;i<(actors||[]).length;i++){
        const a=actors[i]||{},id=String(a.id??`${a.type||'actor'}:${i}`),x=Number(a.x)||0,y=Number(a.y)||0,vx=Number(a.vx)||0,vy=Number(a.vy)||0;
        const priority=Number(a.priority??(a.type==='player'?100:a.type==='follower'?70:a.type==='mini'?35:20));ranked.push({...a,id,x,y,vx,vy,priority});
      }
      ranked.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
      const next=[];
      for(const a of ranked.slice(0,cap)){
        seen.add(a.id);let t=this.tracks.get(a.id);if(!t)t={id:a.id,x:a.x,y:a.y,vx:a.vx,vy:a.vy,motionAge:0,verticalHold:0,strength:1,lastSeen:this.time,recoveryTravel:0,recoveryIndex:0,recoveryEvents:[{x:a.x,y:a.y,age:99,strength:0},{x:a.x,y:a.y,age:99,strength:0}]};
        const avx=a.vx,avy=a.vy,speed=Math.hypot(avx,avy),prevX=t.x,prevY=t.y,stepDist=Math.hypot(a.x-prevX,a.y-prevY);for(const e of t.recoveryEvents)e.age+=dt;t.recoveryTravel+=stepDist;
        if(speed>5&&(t.recoveryTravel>=7||t.motionAge>.11)){t.recoveryIndex=(t.recoveryIndex+1)&1;const e=t.recoveryEvents[t.recoveryIndex];const inv=speed>1?1/speed:0;e.x=a.x-avx*inv*Math.min(6,stepDist+3);e.y=a.y-avy*inv*Math.min(6,stepDist+3);e.age=0;e.strength=clamp(speed/52,.18,1.15);t.recoveryTravel=0;}
        t.x=a.x;t.y=a.y;t.vx=lerp(t.vx,avx,1-Math.exp(-dt*18));t.vy=lerp(t.vy,avy,1-Math.exp(-dt*18));t.motionAge=speed>2?0:t.motionAge+dt;
        const vertical=speed>5&&Math.abs(avy)>Math.abs(avx)*.65;if(vertical)t.verticalHold=.30;else t.verticalHold=Math.max(0,t.verticalHold-dt);
        t.radius=clamp(Number(a.radius??34),8,80);t.strength=clamp(Number(a.strength??1),0,4);t.halfW=clamp(Number(a.halfW??9),2,50);t.halfH=clamp(Number(a.halfH??10),2,60);t.type=a.type||'actor';t.priority=a.priority;t.lastSeen=this.time;
        this.tracks.set(a.id,t);next.push({...t,recoveryA:{...t.recoveryEvents[0]},recoveryB:{...t.recoveryEvents[1]},frontBias:t.verticalHold>0?1:0,wake:clamp(Math.hypot(t.vx,t.vy)*.24,0,30)});
      }
      for(const [id,t] of [...this.tracks])if(!seen.has(id)&&this.time-t.lastSeen>.65)this.tracks.delete(id);
      this.sources=next;return next;
    }
    bounded(){return this.sources.slice(0,this.max)}
  }

  function aabbOverlap(instance,source){
    const l=instance.x-instance.w*.55,r=instance.x+instance.w*.55,t=instance.rootY-instance.h,b=instance.rootY;
    const al=source.x-source.halfW,ar=source.x+source.halfW,at=source.y-source.halfH,ab=source.y+2.0;
    return !(r<al||l>ar||b<at||t>ab);
  }
  function interactionInfluence(root,source){
    const dx=Number(root.x)-Number(source.x),dy=Number(root.y)-Number(source.y),d=Math.hypot(dx,dy),radius=Math.max(1,Number(source.radius)||1),radial=1-smoothstep(0,radius,d),speed=Math.hypot(Number(source.vx)||0,Number(source.vy)||0),wake=clamp(speed*.24,0,30);return clamp(Math.max(radial,1-smoothstep(0,radius*1.1,Math.max(0,d-wake))),0,1);
  }

  class DepthClassifier{
    constructor(cell=GRID_CELL){this.cell=cell;this.instances=[];this.bins=new Map();this.foreground=new Set();this.states=new Map()}
    setInstances(instances=[]){this.instances=instances;this.bins.clear();this.foreground.clear();this.states.clear();for(const p of instances){p.flags=0;const gx=Math.floor(p.x/this.cell),gy=Math.floor((p.rootY-p.h*.5)/this.cell),k=`${gx},${gy}`;if(!this.bins.has(k))this.bins.set(k,[]);this.bins.get(k).push(p);this.states.set(p.index,{stable:0,pending:0,pendingAge:0,blend:0})}}
    candidates(source){const out=[],seen=new Set(),gx=Math.floor(source.x/this.cell),gy=Math.floor((source.y-source.halfH*.5)/this.cell),rx=Math.ceil((source.halfW+42)/this.cell),ry=Math.ceil((source.halfH+52)/this.cell);for(let yy=-ry;yy<=ry;yy++)for(let xx=-rx;xx<=rx;xx++){for(const p of this.bins.get(`${gx+xx},${gy+yy}`)||[])if(!seen.has(p.index)){seen.add(p.index);out.push(p)}}return out}
    classify(instance,source){if(!aabbOverlap(instance,source))return false;const directional=clamp((Number(source.vy)||0)*.055,-3.0,3.0),threshold=source.y+5.0-directional;return instance.rootY+(instance.depthBias||0)>=threshold}
    update(dt,sources=[]){
      dt=Math.max(0,Number(dt)||0);const overlap=new Map();
      for(const s of sources){for(const p of this.candidates(s)){if(!aabbOverlap(p,s))continue;let q=overlap.get(p.index);if(!q){q={count:0,allFront:true};overlap.set(p.index,q)}q.count++;if(!this.classify(p,s))q.allFront=false}}
      let dirty=false;const next=new Set();
      for(const p of this.instances){const q=overlap.get(p.index),desired=q&&q.count>0&&q.allFront?1:0,s=this.states.get(p.index)||{stable:0,pending:0,pendingAge:0,blend:0};
        if(desired!==s.stable){if(desired!==s.pending){s.pending=desired;s.pendingAge=0}else s.pendingAge+=dt;const dwell=desired?.10:.18;if(s.pendingAge>=dwell){s.stable=desired;s.pending=desired;s.pendingAge=0}}
        else{s.pending=desired;s.pendingAge=0}
        const rate=s.stable?12.0:9.0;s.blend+=(s.stable-s.blend)*(1-Math.exp(-dt*rate));if(Math.abs(s.blend-s.stable)<.002)s.blend=s.stable;
        this.states.set(p.index,s);const blend=clamp(s.blend,0,1);if(Math.abs((p.flags||0)-blend)>.001){p.flags=blend;dirty=true}if(blend>.015)next.add(p.index)
      }
      this.foreground=next;return{foregroundCount:next.size,backgroundCount:this.instances.length,dirty};
    }
  }

  function generateFoliageInstances(descriptor={},registry,quality=3){
    if(!registry)return[];const q=clamp(Math.round(Number(quality)||0),0,3),cap=QUALITY_CAPS[q],pool=registry.pool(descriptor.excludedSprites||[]);if(!pool.length||!descriptor.clumps?.length)return[];
    const out=[],seedBase=Number(descriptor.seed)||4000;
    for(let ci=0;ci<descriptor.clumps.length&&out.length<cap;ci++){
      const c=descriptor.clumps[ci]||{},cx=Number(c.x)||0,cy=Number(c.y)||0,radius=clamp(Number(c.radius)||22,8,40),seed=(Number(c.seed)||hash32(seedBase,ci,4000))>>>0,density=clamp(Number(c.density??1),.35,2.4);
      const qualityMul=[.50,.60,.88,1.15][q],n=Math.max(2,Math.round((2.7+radius*.095)*density*qualityMul));
      for(let i=0;i<n&&out.length<cap;i++){
        const a=h01(seed,i,401)*TAU,r=Math.sqrt(h01(seed,i,402))*radius,x=cx+Math.cos(a)*r,rootY=cy+Math.sin(a)*r*.76,name=pool[hash32(seed,i,403)%pool.length],reg=registry.get(name);if(!reg)continue;
        const scale=.54+h01(seed,i,404)*.34,w=reg.worldSize[0]*scale*clamp(Number(reg.width_scale??1),.8,1.6),h=reg.worldSize[1]*scale*clamp(Number(reg.height_scale??1),.8,1.7),variation=h01(seed,i,405),flip=!!(hash32(seed,i,406)&1),phase=h01(seed,i,407)*TAU;
        out.push({index:out.length,name,x,rootY,w,h,uv:reg.uv.slice(),phase,category:reg.category,categoryId:CATEGORY_IDS[reg.category]??CATEGORY_IDS.BROAD_LEAF,rootCutoff:clamp(Number(reg.root_cutoff),.2,.60),bendScale:clamp(Number(reg.bend_scale),0,2.4),flutterScale:clamp(Number(reg.flutter_scale),0,1),stiffness:clamp(Number(reg.stiffness),1,16),damping:clamp(Number(reg.damping),.5,.99),interactionScale:clamp(Number(reg.interaction_scale),0,2.5),shadowScale:clamp(Number(reg.shadow_scale),0,1.5),bendExponent:clamp(Number(reg.bend_exponent),.7,3),tintStrength:clamp(Number(reg.tintStrength),0,.5),flip,variation,depthBias:(h01(seed,i,408)-.5)*1.2,lowerWidth:w*(.70+h01(seed,i,409)*.16),flags:0});
      }
    }
    out.sort((a,b)=>a.rootY-b.rootY||a.x-b.x||a.name.localeCompare(b.name));for(let i=0;i<out.length;i++)out[i].index=i;
    return out;
  }

  function packInstances(instances=[]){
    const f=new Float32Array(instances.length*INSTANCE_FLOATS);let o=0;
    for(const p of instances){
      f.set([p.x,p.rootY,p.w,p.h, p.uv[0],p.uv[1],p.uv[2],p.uv[3], p.phase,p.categoryId,p.rootCutoff,p.bendScale, p.flutterScale,p.stiffness,p.damping,p.interactionScale, p.shadowScale,p.bendExponent,p.tintStrength,p.flip?1:0, p.variation,p.depthBias,p.lowerWidth,p.flags, 0,0,0,0],o);o+=INSTANCE_FLOATS;
    }
    return f;
  }

  class FoliageInstanceBuffer{
    constructor(gl){this.gl=gl;this.buffer=null;this.instances=[];this.packed=new Float32Array(0);this.rebuilds=0;if(gl)this.buffer=gl.createBuffer()}
    upload(instances=[]){this.instances=instances.slice();this.packed=packInstances(this.instances);this.rebuilds++;if(this.gl&&this.buffer){const g=this.gl;g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferData(g.ARRAY_BUFFER,this.packed,g.STATIC_DRAW)}return this.packed.byteLength}
    syncDynamic(instances=this.instances){this.instances=instances.slice();this.packed=packInstances(this.instances);if(this.gl&&this.buffer){const g=this.gl;g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferData(g.ARRAY_BUFFER,this.packed,g.DYNAMIC_DRAW)}return this.packed.byteLength}
    get count(){return this.instances.length}
    get bytes(){return this.packed.byteLength}
  }

  function makeMesh(){const rows=[0,.25,.40,.60,.80,1],v=[];for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];v.push(-.5,a,.5,a,-.5,b,-.5,b,.5,a,.5,b)}return new Float32Array(v)}
  function makeContactMesh(segments=16){const v=[];for(let i=0;i<segments;i++){const a=i/segments*TAU,b=(i+1)/segments*TAU;v.push(0,0,1, Math.cos(a),Math.sin(a),0, Math.cos(b),Math.sin(b),0)}return new Float32Array(v)}

  class FoliageMaterial{
    constructor(gl,programFactory){this.gl=gl;this.program=null;if(gl)this.program=programFactory(this.vertexSource(),this.fragmentSource())}
    vertexSource(){return `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aLocal;
layout(location=1) in vec4 aRootSize;
layout(location=2) in vec4 aUVRect;
layout(location=3) in vec4 aMotionA;
layout(location=4) in vec4 aMotionB;
layout(location=5) in vec4 aMaterial;
layout(location=6) in vec4 aExtra;
uniform float uTime;uniform int uQuality;uniform int uPass;uniform int uSourceCount;
uniform vec2 uSourcePos[8];uniform vec2 uSourceVel[8];uniform vec4 uSourceData[8];uniform float uSourceBias[8];uniform vec4 uRecoveryA[8];uniform vec4 uRecoveryB[8];
uniform float uWindStrength;uniform float uWindSpeed;uniform float uInteractionStrength;uniform float uBendAmount;
out vec2 vUV;out vec2 vWorld;out float vBend;flat out float vCategory;out float vVariation;flat out float vFrontBlend;flat out float vFlip;
float sat(float x){return clamp(x,0.0,1.0);}float ss(float a,float b,float x){float t=sat((x-a)/max(.0001,b-a));return t*t*(3.0-2.0*t);} 
float weight(float t,float cut,float exponent){if(t<=cut)return 0.0;float w=pow(ss(cut,1.0,t),exponent);if(uQuality==0)return 0.0;if(uQuality==1){if(w<.32)return .16;if(w<.72)return .52;return 1.0;}if(uQuality==2){if(w<.20)return .12;if(w<.52)return .48;if(w<.82)return .76;return 1.0;}return w;}
bool overlapActor(vec2 root,vec2 size,int i){vec2 hp=uSourceData[i].zw;float l=root.x-size.x*.55,r=root.x+size.x*.55,t=root.y-size.y,b=root.y;vec2 p=uSourcePos[i];return !(r<p.x-hp.x||l>p.x+hp.x||b<p.y-hp.y||t>p.y+hp.y);}
void main(){
  vec2 root=aRootSize.xy,size=aRootSize.zw;float t=aLocal.y,phase=aMotionA.x,cut=aMotionA.z,bendScale=aMotionA.w,flutter=aMotionB.x,stiffness=aMotionB.y,damping=aMotionB.z,interactionScale=aMotionB.w,shadowScale=aMaterial.x,exponent=aMaterial.y,flip=aMaterial.w,variation=aExtra.x,depthBias=aExtra.y,frontBlend=aExtra.w;
  vFrontBlend=frontBlend;
  if(uPass==1&&frontBlend<.01){gl_Position=vec4(2.0,2.0,0.0,1.0);vUV=vec2(0);vWorld=root;vBend=0.;vCategory=aMotionA.y;vVariation=variation;vFlip=flip;return;}
  float w=weight(t,cut,exponent);float primary=sin((root.x*.88+root.y*.26)/216.0*6.2831853+uTime*(.34+.34*uWindSpeed));float secondary=uQuality>=2?sin((root.x*.34-root.y*.72)/94.0*6.2831853-uTime*(.25+.48*uWindSpeed)+.8):0.0;float gust=uQuality>=3?(.62+.38*pow(.5+.5*sin(uTime*.17+root.x*.0031+root.y*.0017),3.0)):1.0;float wind=((uQuality==1?primary:(primary*.76+secondary*.24*gust))+(variation-.5)*.12)*uWindStrength;
  float tip=wind*bendScale*uBendAmount*2.1;float flutterTerm=0.0;if(uQuality>=3)flutterTerm=sin(uTime*(1.8+uWindSpeed*.45)+phase+t*3.1)*flutter*.55*w;
  vec2 interact=vec2(0);for(int i=0;i<8;i++){if(i>=uSourceCount)break;vec2 sp=uSourcePos[i],vel=uSourceVel[i];float radius=max(1.0,uSourceData[i].x),str=uSourceData[i].y;vec2 d=root-sp;float dl=max(length(d),.001);float radial=1.0-ss(0.0,radius,dl);float wake=clamp(length(vel)*.24,0.0,30.0);vec2 dir=length(vel)>.5?normalize(vel):vec2(0);vec2 tail=sp-dir*wake;vec2 seg=sp-tail;float q=dot(root-tail,seg)/max(dot(seg,seg),.001);vec2 nearp=tail+seg*clamp(q,0.0,1.0);float wd=length(root-nearp);float wi=1.0-ss(0.0,radius*1.10,wd);vec2 away=d/dl;interact+=(away*radial+dir*.72*wi)*str;vec4 ea=uRecoveryA[i],eb=uRecoveryB[i];float rate=clamp(stiffness*(1.0-clamp(damping,0.0,.999))*1.75,.45,5.5);for(int k=0;k<2;k++){vec4 ev=k==0?ea:eb;if(ev.w<=0.0)continue;vec2 rd=root-ev.xy;float rl=max(length(rd),.001),ri=1.0-ss(0.0,radius*.92,rl),decay=exp(-ev.z*rate);interact+=(rd/rl+dir*.24)*ri*decay*ev.w*str*.62;}}
  float bend=(tip+interact.x*2.6*uInteractionStrength*interactionScale)*w+flutterTerm;float compress=-abs(tip)*.0125*w;
  vec2 world=vec2(root.x+aLocal.x*size.x+bend,root.y-t*size.y+compress);float sx=flip>.5?(.5-aLocal.x):(.5+aLocal.x);float sy=1.0-t;vUV=mix(aUVRect.xy,aUVRect.zw,vec2(sx,sy));vWorld=world;vBend=bend;vCategory=aMotionA.y;vVariation=variation;vFlip=flip;
  gl_Position=vec4(world.x/640.0*2.0-1.0,1.0-world.y/360.0*2.0,0.0,1.0);
}`}
    fragmentSource(){return `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uTex;uniform sampler2D uBumpTex;uniform sampler2D uNormalRoughnessTex;uniform sampler2D uScene;uniform vec2 uLogicalSize;uniform vec2 uAtlasSize;uniform vec2 uMainLightPos;uniform vec3 uTintColor;uniform float uShadingStrength;uniform float uBumpStrength;uniform int uUseMaterialV2Normals;uniform int uUseSceneLight;uniform int uCategoryView;uniform int uQuality;uniform int uPass;uniform int uSourceCount;uniform vec2 uSourcePos[8];uniform vec2 uSourceVel[8];uniform vec4 uSourceData[8];
in vec2 vUV;in vec2 vWorld;in float vBend;flat in float vCategory;in float vVariation;flat in float vFrontBlend;flat in float vFlip;out vec4 o;
vec3 categoryColour(int c){if(c==0)return vec3(.30,.56,.36);if(c==1)return vec3(.52,.75,.28);if(c==2)return vec3(.22,.74,.60);if(c==3)return vec3(.20,.48,.72);if(c==4)return vec3(.86,.36,.64);return vec3(.67,.50,.26);}
void main(){vec4 t=texture(uTex,vUV);if(t.a<.015)discard;float frontAlpha=uPass==1?clamp(vFrontBlend,0.0,1.0):1.0;if(uPass==1&&frontAlpha<.01)discard;if(uCategoryView!=0){o=vec4(categoryColour(int(vCategory+.5)),t.a*frontAlpha);return;}vec3 n=vec3(0,0,1);if(uQuality>=2)n=normalize(vec3(-vBend*.055,0.0,1.0));if(uQuality>=3){vec3 bendN=normalize(vec3(-vBend*.055,0.0,1.0));if(uUseMaterialV2Normals!=0){vec3 matN=normalize(texture(uNormalRoughnessTex,vUV).rgb*2.0-1.0);if(vFlip>.5)matN.x=-matN.x;n=normalize(mix(matN,bendN,.30));}else{vec2 px=3.0/max(uAtlasSize,vec2(1));float hC=texture(uBumpTex,vUV).r,hL=texture(uBumpTex,vUV-vec2(px.x,0)).r,hR=texture(uBumpTex,vUV+vec2(px.x,0)).r,hU=texture(uBumpTex,vUV-vec2(0,px.y)).r,hD=texture(uBumpTex,vUV+vec2(0,px.y)).r;float aL=texture(uTex,vUV-vec2(px.x,0)).a,aR=texture(uTex,vUV+vec2(px.x,0)).a,aU=texture(uTex,vUV-vec2(0,px.y)).a,aD=texture(uTex,vUV+vec2(0,px.y)).a;hL=mix(hC,hL,step(.02,aL));hR=mix(hC,hR,step(.02,aR));hU=mix(hC,hU,step(.02,aU));hD=mix(hC,hD,step(.02,aD));vec3 bumpN=normalize(vec3(-(hR-hL)*(1.5+uBumpStrength*1.7),(hD-hU)*(1.5+uBumpStrength*1.7),1.0));n=normalize(mix(bumpN,bendN,.34));}}vec2 delta=uMainLightPos-vWorld;vec3 L=normalize(vec3(delta.x,-delta.y,88.0));float ndl=max(dot(n,L),0.0);float diffuse=.34+ndl*.66;vec2 suv=vec2(vWorld.x/uLogicalSize.x,1.0-vWorld.y/uLogicalSize.y);vec3 scene=texture(uScene,clamp(suv,vec2(0),vec2(1))).rgb;float sceneLum=dot(scene,vec3(.2126,.7152,.0722));float visibility=uUseSceneLight!=0?clamp(sceneLum*2.2+.025,.025,1.0):.72;float rim=pow(1.0-max(n.z,0.0),2.0)*.014*visibility;float spec=pow(max(dot(reflect(-L,n),vec3(0,0,1)),0.0),14.0)*.012*visibility;vec3 base=mix(t.rgb,t.rgb*uTintColor,.045);vec3 shaded=base*(.16+.84*visibility)*diffuse+rim*uTintColor+spec;vec3 rgb=mix(base*(.16+.84*visibility),shaded,clamp(uShadingStrength,0.0,1.5));o=vec4(max(rgb,vec3(0)),t.a*frontAlpha*mix(.74,1.0,visibility));}`}
  }

  class DebugView{
    constructor(owner){this.owner=owner}
    render(settings){if(!settings?.foliageShowRoots&&!settings?.foliageShowInteractionRadii)return;this.owner._renderDebug(settings)}
  }

  class FoliageFX{
    constructor(gl,opts={}){
      this.gl=gl;this.logicalWidth=opts.logicalWidth||640;this.logicalHeight=opts.logicalHeight||360;this.registry=new FoliageRegistry(opts.manifest||{});this.instanceBuffer={buffer:null,instances:[],packed:new Float32Array(0),rebuilds:0,count:0,bytes:0};this.windField=new WindField();this.interactionField=new InteractionField();this.rootedDeformation=new RootedDeformation();this.depthClassifier=new DepthClassifier();this.debugView=new DebugView(this);this.material=null;this.ready=false;this.error=null;this.descriptor=null;this.descriptorKey='';this.quality=3;this.time=0;this.drawCalls=0;this.lastDepth={backgroundCount:0,foregroundCount:0};this.categoryCounts={};this._lastSettings={};
      try{if(!gl)throw new Error('WebGL2 context required');this.instanceBuffer=new FoliageInstanceBuffer(gl);this._initGL();this.ready=true}catch(e){this.error=String(e?.message||e);this.ready=false;try{console.error('FoliageFX disabled cleanly:',e)}catch(_){}}
    }
    _shader(type,src){const g=this.gl,s=g.createShader(type);g.shaderSource(s,src);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw new Error(`FoliageFX shader: ${g.getShaderInfoLog(s)}`);return s}
    _program(vs,fs){const g=this.gl,p=g.createProgram();g.attachShader(p,this._shader(g.VERTEX_SHADER,vs));g.attachShader(p,this._shader(g.FRAGMENT_SHADER,fs));g.linkProgram(p);if(!g.getProgramParameter(p,g.LINK_STATUS))throw new Error(`FoliageFX link: ${g.getProgramInfoLog(p)}`);return p}
    _initGL(){
      const g=this.gl;this.material=new FoliageMaterial(g,(v,f)=>this._program(v,f));this.mesh=makeMesh();this.meshVerts=this.mesh.length/2;this.meshBuf=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,this.meshBuf);g.bufferData(g.ARRAY_BUFFER,this.mesh,g.STATIC_DRAW);this.vao=g.createVertexArray();g.bindVertexArray(this.vao);g.bindBuffer(g.ARRAY_BUFFER,this.meshBuf);g.enableVertexAttribArray(0);g.vertexAttribPointer(0,2,g.FLOAT,false,8,0);g.vertexAttribDivisor(0,0);this._bindInstanceAttributes();g.bindVertexArray(null);
      this.contactProg=this._program(`#version 300 es
precision mediump float;layout(location=0) in vec3 aContact;layout(location=1) in vec4 aRootSize;layout(location=5) in vec4 aMaterial;layout(location=6) in vec4 aExtra;out float vAlpha;out vec2 vWorld;void main(){float rx=max(1.2,aExtra.z*.42*aMaterial.x),ry=max(1.1,aRootSize.w*.065);vec2 w=aRootSize.xy+vec2(aContact.x*rx,aContact.y*ry);vAlpha=aContact.z;vWorld=w;gl_Position=vec4(w.x/640.0*2.0-1.0,1.0-w.y/360.0*2.0,0,1);}`,
      `#version 300 es
precision mediump float;uniform sampler2D uWaterMask;uniform vec2 uLogicalSize;uniform float uStrength;in float vAlpha;in vec2 vWorld;out vec4 o;void main(){vec2 uv=vec2(vWorld.x/uLogicalSize.x,1.0-vWorld.y/uLogicalSize.y);if(texture(uWaterMask,clamp(uv,vec2(0),vec2(1))).r>.02)discard;float a=clamp(vAlpha*uStrength,0.0,.42);o=vec4(a,a,a,a);}`);
      this.contactMesh=makeContactMesh();this.contactVerts=this.contactMesh.length/3;this.contactBuf=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,this.contactBuf);g.bufferData(g.ARRAY_BUFFER,this.contactMesh,g.STATIC_DRAW);this.contactVAO=g.createVertexArray();g.bindVertexArray(this.contactVAO);g.bindBuffer(g.ARRAY_BUFFER,this.contactBuf);g.enableVertexAttribArray(0);g.vertexAttribPointer(0,3,g.FLOAT,false,12,0);g.vertexAttribDivisor(0,0);this._bindInstanceAttributes(true);g.bindVertexArray(null);
      this.debugProg=this._program(`#version 300 es
precision mediump float;layout(location=0) in vec2 aPos;void main(){gl_Position=vec4(aPos.x/640.0*2.0-1.0,1.0-aPos.y/360.0*2.0,0,1);}`,
      `#version 300 es
precision mediump float;uniform vec4 uColor;out vec4 o;void main(){o=uColor;}`);this.debugBuf=g.createBuffer();this.debugVAO=g.createVertexArray();
    }
    _bindInstanceAttributes(contact=false){const g=this.gl,stride=INSTANCE_BYTES;g.bindBuffer(g.ARRAY_BUFFER,this.instanceBuffer.buffer);const specs=[[1,4,0],[2,4,16],[3,4,32],[4,4,48],[5,4,64],[6,4,80]];for(const [loc,size,off] of specs){g.enableVertexAttribArray(loc);g.vertexAttribPointer(loc,size,g.FLOAT,false,stride,off);g.vertexAttribDivisor(loc,1)}}
    setDescriptor(desc,settings={}){if(!this.ready)return false;try{this.descriptor=desc||{signature:'empty',clumps:[]};const q=clamp(Math.round(Number(settings.foliageQuality??3)||0),0,3),key=`${this.descriptor.signature||''}|q:${q}`;if(key===this.descriptorKey)return false;this.quality=q;const instances=generateFoliageInstances(this.descriptor,this.registry,q);this.instanceBuffer.upload(instances);this.depthClassifier.setInstances(instances);this.categoryCounts={};for(const p of instances)this.categoryCounts[p.category]=(this.categoryCounts[p.category]||0)+1;this.lastDepth={backgroundCount:instances.length,foregroundCount:0};this.descriptorKey=key;return true}catch(e){this._fail(e);return false}}
    rebuild(settings={}){if(this.descriptor){this.descriptorKey='';return this.setDescriptor(this.descriptor,settings)}return false}
    update(dt,actors=[],settings={},time=null){if(!this.ready)return;this._lastSettings=settings;const q=clamp(Math.round(Number(settings.foliageQuality??this.quality)||0),0,3);if(q!==this.quality)this.rebuild(settings);this.quality=q;this.time=settings.foliageFreezeWind?this.time:(Number.isFinite(time)?time:this.time+Math.max(0,Number(dt)||0));let sources=[];if(settings.foliageFX===false){if(this.interactionField.tracks.size||this.interactionField.sources.length)this.interactionField.reset()}else sources=this.interactionField.update(dt,actors,q);this.lastDepth=this.depthClassifier.update(Math.max(0,Number(dt)||0),sources);if(this.lastDepth?.dirty)this.instanceBuffer.syncDynamic(this.depthClassifier.instances)}
    beginFrame(){this.drawCalls=0}
    _enabled(settings){return this.ready&&this.instanceBuffer.count>0}
    _setUniforms(program,pass,settings,material,mainLightPos,tex,bumpTex,normalTex=null,sceneTex=null){
      const g=this.gl,s=this.interactionField.bounded(),pos=new Float32Array(MAX_INTERACTION_SOURCES*2),vel=new Float32Array(MAX_INTERACTION_SOURCES*2),data=new Float32Array(MAX_INTERACTION_SOURCES*4),bias=new Float32Array(MAX_INTERACTION_SOURCES),recoveryA=new Float32Array(MAX_INTERACTION_SOURCES*4),recoveryB=new Float32Array(MAX_INTERACTION_SOURCES*4);for(let i=0;i<s.length&&i<MAX_INTERACTION_SOURCES;i++){const a=s[i];pos[i*2]=a.x;pos[i*2+1]=a.y;vel[i*2]=a.vx;vel[i*2+1]=a.vy;data[i*4]=a.radius;data[i*4+1]=a.strength;data[i*4+2]=a.halfW;data[i*4+3]=a.halfH;bias[i]=a.frontBias||0;const ra=a.recoveryA||{x:a.x,y:a.y,age:99,strength:0},rb=a.recoveryB||{x:a.x,y:a.y,age:99,strength:0};recoveryA.set([ra.x,ra.y,ra.age,ra.strength],i*4);recoveryB.set([rb.x,rb.y,rb.age,rb.strength],i*4)}
      g.useProgram(program);const ui=(n,v)=>{const l=g.getUniformLocation(program,n);if(l!==null)g.uniform1i(l,v)},uf=(n,v)=>{const l=g.getUniformLocation(program,n);if(l!==null)g.uniform1f(l,v)},u2=(n,x,y)=>{const l=g.getUniformLocation(program,n);if(l!==null)g.uniform2f(l,x,y)};
      const animate=settings.foliageFX!==false;uf('uTime',this.time);ui('uQuality',animate?this.quality:0);ui('uPass',pass);ui('uSourceCount',animate?Math.min(s.length,MAX_INTERACTION_SOURCES):0);const lp=g.getUniformLocation(program,'uSourcePos[0]');if(lp!==null)g.uniform2fv(lp,pos);const lv=g.getUniformLocation(program,'uSourceVel[0]');if(lv!==null)g.uniform2fv(lv,vel);const ld=g.getUniformLocation(program,'uSourceData[0]');if(ld!==null)g.uniform4fv(ld,data);const lb=g.getUniformLocation(program,'uSourceBias[0]');if(lb!==null)g.uniform1fv(lb,bias);const lra=g.getUniformLocation(program,'uRecoveryA[0]');if(lra!==null)g.uniform4fv(lra,recoveryA);const lrb=g.getUniformLocation(program,'uRecoveryB[0]');if(lrb!==null)g.uniform4fv(lrb,recoveryB);
      uf('uWindStrength',animate?clamp(Number(settings.foliageWindStrength??.78),0,4):0);uf('uWindSpeed',clamp(Number(settings.foliageWindSpeed??.82),0,4.5));uf('uInteractionStrength',animate?clamp(Number(settings.foliageInteractionStrength??1),0,4):0);uf('uBendAmount',animate?clamp(Number(settings.foliageBendAmount??1),0,3):0);uf('uShadingStrength',settings.lighting===false?0:clamp(Number(settings.foliageShadingStrength??.9),0,2));uf('uBumpStrength',(settings.lighting===false||settings.bump===false)?0:clamp(Number(settings.bumpStrength??1.15),0,3));ui('uCategoryView',settings.foliageCategoryView?1:0);u2('uMainLightPos',mainLightPos?.[0]??320,mainLightPos?.[1]??180);u2('uLogicalSize',this.logicalWidth,this.logicalHeight);ui('uUseMaterialV2Normals',normalTex?1:0);ui('uUseSceneLight',sceneTex?1:0);const as=this.registry.sourceSize;u2('uAtlasSize',as[0],as[1]);const tint=material?.baseColor||material?.color||[.55,.72,.50],lt=g.getUniformLocation(program,'uTintColor');if(lt!==null)g.uniform3f(lt,tint[0],tint[1],tint[2]);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,tex);ui('uTex',0);g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,bumpTex);ui('uBumpTex',1);g.activeTexture(g.TEXTURE2);g.bindTexture(g.TEXTURE_2D,normalTex||bumpTex);ui('uNormalRoughnessTex',2);g.activeTexture(g.TEXTURE3);g.bindTexture(g.TEXTURE_2D,sceneTex||tex);ui('uScene',3)
    }
    render(pass,settings,material,mainLightPos,tex,bumpTex,normalTex=null,sceneTex=null){if(!this._enabled(settings))return false;const g=this.gl,p=pass==='foreground'?1:0;try{g.enable(g.BLEND);g.blendEquation(g.FUNC_ADD);g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);this._setUniforms(this.material.program,p,settings,material,mainLightPos,tex,bumpTex,normalTex,sceneTex);g.bindVertexArray(this.vao);g.drawArraysInstanced(g.TRIANGLES,0,this.meshVerts,this.instanceBuffer.count);g.bindVertexArray(null);this.drawCalls++;return true}catch(e){this._fail(e);return false}}
    renderContactMask(settings,waterMaskTex){if(!this._enabled(settings)||settings.ao===false)return false;const g=this.gl;try{g.useProgram(this.contactProg);g.bindVertexArray(this.contactVAO);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,waterMaskTex);g.uniform1i(g.getUniformLocation(this.contactProg,'uWaterMask'),0);g.uniform2f(g.getUniformLocation(this.contactProg,'uLogicalSize'),this.logicalWidth,this.logicalHeight);g.uniform1f(g.getUniformLocation(this.contactProg,'uStrength'),clamp((Number(settings.aoStrength??.16)*1.15)*(Number(settings.foliageShadingStrength??.9)*.55+.45),0,.5));g.drawArraysInstanced(g.TRIANGLES,0,this.contactVerts,this.instanceBuffer.count);g.bindVertexArray(null);this.drawCalls++;return true}catch(e){this._fail(e);return false}}
    _renderDebug(settings){if(!this.ready)return;const g=this.gl,verts=[];if(settings.foliageShowRoots){const s=2;for(const p of this.instanceBuffer.instances){verts.push(p.x-s,p.rootY,p.x+s,p.rootY,p.x,p.rootY-s,p.x,p.rootY+s)}}if(settings.foliageShowInteractionRadii){for(const a of this.interactionField.bounded()){const seg=24;for(let i=0;i<seg;i++){const q=i/seg*TAU,r=(i+1)/seg*TAU;verts.push(a.x+Math.cos(q)*a.radius,a.y+Math.sin(q)*a.radius,a.x+Math.cos(r)*a.radius,a.y+Math.sin(r)*a.radius)}}}if(!verts.length)return;try{g.useProgram(this.debugProg);g.bindBuffer(g.ARRAY_BUFFER,this.debugBuf);g.bufferData(g.ARRAY_BUFFER,new Float32Array(verts),g.DYNAMIC_DRAW);const loc=0;g.enableVertexAttribArray(loc);g.vertexAttribPointer(loc,2,g.FLOAT,false,8,0);g.vertexAttribDivisor(loc,0);g.uniform4f(g.getUniformLocation(this.debugProg,'uColor'),1,.35,.82,.72);g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);g.drawArrays(g.LINES,0,verts.length/2);this.drawCalls++}catch(e){this._fail(e)}}
    renderDebug(settings){if(this._enabled(settings))this.debugView.render(settings)}
    _fail(e){this.error=String(e?.message||e);this.ready=false;try{console.error('FoliageFX runtime failure; subsystem disabled without gameplay mutation:',e)}catch(_){}}
    diagnostics(){return{enabled:this.ready&&this._lastSettings.foliageFX!==false,quality:this.quality,instances:this.instanceBuffer.count,backgroundCount:this.lastDepth.backgroundCount,foregroundCount:this.lastDepth.foregroundCount,interactionSourceCount:this.interactionField.bounded().length,categoryCounts:{...this.categoryCounts},instanceBytes:this.instanceBuffer.bytes,rebuilds:this.instanceBuffer.rebuilds,drawCalls:this.drawCalls,error:this.error}}
  }

  return {VERSION,MAX_INTERACTION_SOURCES,FOLIAGE_HARD_CAP,INSTANCE_FLOATS,INSTANCE_BYTES,MATERIAL_CONTRACT,CATEGORY_NAMES,CATEGORY_IDS,CATEGORY_PROFILES,QUALITY_CAPS,QUALITY_SOURCE_CAPS,FoliageRegistry,FoliageInstanceBuffer,WindField,InteractionField,RootedDeformation,FoliageMaterial,DepthClassifier,DebugView,FoliageFX,categoryProfile,inferCategory,generateFoliageInstances,packInstances,interactionDecay,interactionInfluence,aabbOverlap,hash32,h01};
});
