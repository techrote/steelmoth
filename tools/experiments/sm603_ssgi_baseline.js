'use strict';

(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const Resources=root?.SteelMothWebGPUResources||(node?require('./webgpu_resources.js'):null);
  const Validity=root?.SteelMothWebGPUGTAOStabilization||(node?require('./webgpu_gtao_stabilization.js'):null);
  const Depth=root?.SteelMothWebGPUDepthHierarchy||(node?require('./webgpu_depth_hierarchy.js'):null);
  const PseudoDepth=root?.SteelMothPseudoDepth||(node?require('./pseudo_depth.js'):null);
  const api=factory(Resources,Validity,Depth,PseudoDepth,root);
  if(node)module.exports=api;
  if(root)root.SteelMothWebGPUSSGI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,Validity,Depth,PseudoDepth,root){
  if(!Resources||!Validity?.pixelDiscontinuity||!Depth||!PseudoDepth)throw new Error('SM-602 requires resources, SM-601 validity, SM-203 hierarchy and canonical pseudo-depth');
  const SCHEMA='steelmoth-webgpu-ssgi/v1';
  const OUTPUT_FORMAT='rgba16float';
  const DEBUG_MODES=Object.freeze(['indirect','raw','history-rejection']);
  const EXTRA_META_KEYS=Object.freeze(['cameraRevision','lightRevision']);
  const DEPTH_SPAN=PseudoDepth.DEPTH_KEY_MAX-PseudoDepth.DEPTH_KEY_MIN;
  const LIMITS=Object.freeze({rays:[4,8],steps:[4,8],radius:[8,48],depthSlope:[0,.001],thickness:[.0001,.006],strength:[0,.2],donorMax:[0,2],energyMax:[0,.12],saturation:[0,.5],historyWeight:[0,.92],deltaClamp:[0,.04]});
  const QUALITY_PRESETS=Object.freeze({
    Low:Object.freeze({enabled:false,rays:4,steps:4,radius:16,historyWeight:0}),
    Medium:Object.freeze({enabled:true,rays:4,steps:6,radius:24,historyWeight:.85}),
    High:Object.freeze({enabled:true,rays:6,steps:8,radius:32,historyWeight:.88}),
    Ultra:Object.freeze({enabled:true,rays:8,steps:8,radius:40,historyWeight:.90})
  });
  const DEFAULTS=Object.freeze({enabled:false,quality:'Medium',rays:4,steps:6,radius:24,pixelScale:1,depthSlope:.0005,thickness:.003,strength:.12,donorMax:1,energyMax:.08,saturation:.35,historyWeight:.85,depthThreshold:.012,normalThreshold:.84,deltaClamp:.025});
  const FALLBACK_TEXTURE_USAGE={COPY_SRC:1,COPY_DST:2,TEXTURE_BINDING:4,STORAGE_BINDING:8};
  const FALLBACK_BUFFER_USAGE={MAP_READ:1,COPY_DST:8,UNIFORM:64};
  const textureUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUTextureUsage?.[n]??FALLBACK_TEXTURE_USAGE[n]),0);
  const bufferUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]),0);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const extent=v=>Math.max(1,Math.round(finite(v,1)));
  const quarter=v=>Math.max(1,Math.ceil(v/4));
  const roundOffset=v=>Math.sign(v)*Math.floor(Math.abs(v)+.5001);
  function resolveQuality(value='Medium'){const name=Validity.normalizeQuality(value);return{name,...QUALITY_PRESETS[name]};}
  function normalizeOptions(overrides={}){
    const q=resolveQuality(overrides.quality),o={...DEFAULTS,...q,...overrides};
    o.quality=q.name;o.enabled=overrides.enabled===true&&q.enabled;
    for(const [key,range]of Object.entries(LIMITS))o[key]=clamp(finite(o[key],DEFAULTS[key]),...range);
    o.rays=Math.round(o.rays);o.steps=Math.round(o.steps);
    o.pixelScale=clamp(finite(o.pixelScale,1),.0625,4);
    // The depth/normal boundaries come from the adopted SM-601 Medium policy.
    const validity=Validity.resolveQuality('Medium').temporal;
    o.depthThreshold=validity.depthThreshold;o.normalThreshold=validity.normalThreshold;
    return Object.fromEntries(Object.keys(DEFAULTS).map(key=>[key,o[key]]));
  }
  function clampIndirect(colour,options={}){
    const o=normalizeOptions(options),v=[0,1,2].map(k=>clamp(finite(colour?.[k]),0,o.energyMax));
    const luma=v[0]*.2126+v[1]*.7152+v[2]*.0722;
    return v.map(c=>clamp(luma+(c-luma)*o.saturation,0,o.energyMax));
  }
  function normalAt(values,i){return Validity.decodeNormal([values?.[i*4]??.5,values?.[i*4+1]??.5,values?.[i*4+2]??1]);}
  function pairAt(values,i,count){return Validity.pairAt(values,i,count);}
  function layerAt(d,y,materialHeight){return Math.round((PseudoDepth.DEPTH_KEY_MAX-d*DEPTH_SPAN-y-clamp(finite(materialHeight),0,1)*PseudoDepth.MAX_WORLD_Z*PseudoDepth.Z_TO_SCREEN_Y)/PseudoDepth.LAYER_STRIDE);}
  function pixelAt(input,i,count,o){return Validity.pixelDiscontinuity(pairAt(input.currentDepth,i,count),pairAt(input.previousDepth,i,count),input.currentObject?.[i],input.previousObject?.[i],normalAt(input.currentNormal,i),normalAt(input.previousNormal,i),o);}
  function rayDepth(d,dy,distance,o){return d-distance*(dy/DEPTH_SPAN+o.depthSlope/o.pixelScale);}
  function intersects(range,lo,hi){return Depth.rangeOccupied(range)&&range[0]<=hi&&range[1]>=lo;}
  function referenceSSGI(input={},options={}){
    const width=extent(input.width),height=extent(input.height),count=width*height,qw=quarter(width),qh=quarter(height),o=normalizeOptions(options);
    const raw=new Float32Array(qw*qh*4),indirect=new Float32Array(raw.length),rejection=new Float32Array(raw.length),composed=new Float32Array(count*4);
    const global=Validity.globalDiscontinuity(input.previousMeta,input.currentMeta,EXTRA_META_KEYS),valid=o.enabled&&input.historyValid===true&&!global.reject;
    const depths=new Float32Array(count);for(let i=0;i<count;i++)depths[i]=pairAt(input.currentDepth,i,count)[0];
    const radius=o.radius*o.pixelScale,levels=Depth.buildCPUHierarchy(depths,input.currentObject,width,height),level=Depth.chooseLevelForFootprint(radius/o.steps,levels.length-1),coarse=levels[level];
    for(let y=0;y<qh;y++)for(let x=0;x<qw;x++){
      const px=Math.min(width-1,x*4+2),py=Math.min(height-1,y*4+2),i=py*width+px,qi=(y*qw+x)*4,c=pairAt(input.currentDepth,i,count),owner=input.currentObject?.[i]||0;
      let donors=0,rejected=0;const sum=[0,0,0],n=normalAt(input.currentNormal,i),centerLayer=layerAt(c[0],py,input.currentMaterial?.[i*4]);
      if(valid&&owner!==0&&Depth.rangeOccupied(c))for(let ray=0;ray<o.rays;ray++){
        const angle=2*Math.PI*(ray+.5)/o.rays,dx=Math.cos(angle),dy=Math.sin(angle),stepDistance=radius/o.steps;let done=false;
        for(let step=0;step<o.steps&&!done;step++){
          const distance=(step+1)*stepDistance;
          for(let refine=0;refine<3;refine++){
            const distance2=distance-stepDistance+stepDistance*(refine+1)/3,qx=px+roundOffset(dx*distance2),qy=py+roundOffset(dy*distance2);
            if(qx<0||qy<0||qx>=width||qy>=height)continue;
            const rd=rayDepth(c[0],dy,distance2,o),ci=(Math.floor(qy/coarse.coverage)*coarse.width+Math.floor(qx/coarse.coverage))*2,cr=[coarse.data[ci],coarse.data[ci+1]];
            if(!intersects(cr,rd-o.thickness,rd+o.thickness))continue;
            const j=qy*width+qx,d=pairAt(input.currentDepth,j,count),id=input.currentObject?.[j]||0;
            if(!id||id===owner||!intersects(d,rd-o.thickness,rd+o.thickness))continue;
            if(layerAt(d[0],qy,input.currentMaterial?.[j*4])!==centerLayer)continue;
            done=true;
            if(pixelAt(input,j,count,o).reject){rejected++;break;}
            const donorNormal=normalAt(input.currentNormal,j),receive=Math.max(0,n[0]*dx-n[1]*dy+n[2]*.5),emit=Math.max(0,-donorNormal[0]*dx+donorNormal[1]*dy+donorNormal[2]*.5),weight=receive*emit/(1+distance2/radius);
            for(let k=0;k<3;k++)sum[k]+=clamp(finite(input.previousColour?.[j*4+k]),0,o.donorMax)*weight;
            donors++;break;
          }
        }
      }
      const colour=sum.map(v=>v/o.rays*o.strength);
      raw.set(clampIndirect(colour,o),qi);raw[qi+3]=donors/o.rays;
      rejection[qi+1]=rejected/o.rays;rejection[qi+2]=donors/o.rays;rejection[qi+3]=1;
    }
    for(let y=0;y<qh;y++)for(let x=0;x<qw;x++){
      const qi=(y*qw+x)*4,px=Math.min(width-1,x*4+2),py=Math.min(height-1,y*4+2),i=py*width+px;
      let reason=!valid?4:pixelAt(input,i,count,o).code;
      if(!reason&&(!input.currentObject?.[i]||rejection[qi+1]>0||raw[qi+3]===0))reason=5;
      rejection[qi]=reason;
      for(let k=0;k<3;k++){
        let value=raw[qi+k];
        if(!reason&&input.previousIndirect){let lo=Infinity,hi=-Infinity;
          for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const xx=x+ox,yy=y+oy;if(xx<0||yy<0||xx>=qw||yy>=qh)continue;const sample=raw[(yy*qw+xx)*4+k];lo=Math.min(lo,sample);hi=Math.max(hi,sample);}
          const pv=clamp(finite(input.previousIndirect[qi+k]),Math.max(lo,value-o.deltaClamp),Math.min(hi,value+o.deltaClamp));value=value*(1-o.historyWeight)+pv*o.historyWeight;
        }
        indirect[qi+k]=clamp(value,0,o.energyMax);
      }
      indirect[qi+3]=raw[qi+3];
    }
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,qi=(Math.floor(y/4)*qw+Math.floor(x/4))*4,px=Math.min(width-1,Math.floor(x/4)*4+2),py=Math.min(height-1,Math.floor(y/4)*4+2),j=py*width+px;
      const compatible=!Validity.pixelDiscontinuity(pairAt(input.currentDepth,i,count),pairAt(input.currentDepth,j,count),input.currentObject?.[i],input.currentObject?.[j],normalAt(input.currentNormal,i),normalAt(input.currentNormal,j),o).reject;
      const diffuse=1-clamp(finite(input.currentMaterial?.[i*4+1]),0,1);
      for(let k=0;k<4;k++){const direct=input.currentColour?.[i*4+k]??(k===3?1:0);composed[i*4+k]=direct+(k<3&&o.enabled&&input.currentObject?.[i]&&compatible?indirect[qi+k]*clamp(finite(input.currentAlbedo?.[i*4+k],1),0,1)*diffuse:0);}
    }
    return{schema:SCHEMA,width,height,quarterWidth:qw,quarterHeight:qh,raw,indirect,rejection,composed,options:o,globalReject:global};
  }

  const COMMON_WGSL=`
struct Params{extent:vec4u,flags:vec4u,trace:vec4f,energy:vec4f,validity:vec4f};
const SM_DEPTH_SPAN:f32=${DEPTH_SPAN.toFixed(1)};
const SM_DEPTH_KEY_MAX:f32=${Number(PseudoDepth.DEPTH_KEY_MAX).toFixed(1)};
const SM_LAYER_STRIDE:f32=${Number(PseudoDepth.LAYER_STRIDE).toFixed(1)};
const SM_MAX_WORLD_Z:f32=${Number(PseudoDepth.MAX_WORLD_Z).toFixed(1)};
const SM_Z_TO_SCREEN_Y:f32=${Number(PseudoDepth.Z_TO_SCREEN_Y).toFixed(1)};
${Depth.RANGE_HELPERS_WGSL}
${Validity.PIXEL_VALIDITY_WGSL}
fn normalAt(t:texture_2d<f32>,p:vec2i)->vec3f{let n=textureLoad(t,p,0).xyz*2.0-1.0;return normalize(select(vec3f(0,0,1),n,length(n)>0.00001));}
fn layerAt(d:f32,y:i32,h:f32)->i32{return i32(round((SM_DEPTH_KEY_MAX-d*SM_DEPTH_SPAN-f32(y)-clamp(h,0.0,1.0)*SM_MAX_WORLD_Z*SM_Z_TO_SCREEN_Y)/SM_LAYER_STRIDE));}
fn rayDepth(d:f32,dy:f32,distance:f32,slope:f32)->f32{return d-distance*(dy/SM_DEPTH_SPAN+slope);}
fn intersects(r:vec2f,lo:f32,hi:f32)->bool{return smDepthRangeOccupied(r)&&r.x<=hi&&r.y>=lo;}
fn roundedOffset(v:vec2f)->vec2i{return vec2i(sign(v)*floor(abs(v)+vec2f(0.5001)));}
fn finitePositive(v0:vec3f,cap:f32)->vec3f{let clean=select(vec3f(0),v0,v0==v0);let v=select(clean,vec3f(0),abs(clean)>vec3f(65504.0));return clamp(v,vec3f(0),vec3f(cap));}
fn indirectClamp(v0:vec3f,cap:f32,saturation:f32)->vec3f{let v=finitePositive(v0,cap);let l=dot(v,vec3f(.2126,.7152,.0722));return clamp(mix(vec3f(l),v,saturation),vec3f(0),vec3f(cap));}
`;

  const TRACE_WGSL=COMMON_WGSL+`
@group(0) @binding(0) var depthRange:texture_2d<f32>;
@group(0) @binding(1) var coarseRange:texture_2d<f32>;
@group(0) @binding(2) var normalTex:texture_2d<f32>;
@group(0) @binding(3) var objectTex:texture_2d<u32>;
@group(0) @binding(4) var materialTex:texture_2d<f32>;
@group(0) @binding(5) var previousColour:texture_2d<f32>;
@group(0) @binding(6) var previousDepth:texture_2d<f32>;
@group(0) @binding(7) var previousNormal:texture_2d<f32>;
@group(0) @binding(8) var previousObject:texture_2d<u32>;
@group(0) @binding(9) var<uniform> params:Params;
@group(0) @binding(10) var rawOut:texture_storage_2d<rgba16float,write>;
@group(0) @binding(11) var donorOut:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){
  if(any(gid.xy>=params.extent.zw)){return;}
  let p=min(vec2i(gid.xy)*4+vec2i(2),vec2i(params.extent.xy)-vec2i(1));
  let c=textureLoad(depthRange,p,0).rg;let owner=textureLoad(objectTex,p,0).x;
  let n=normalAt(normalTex,p);let m=textureLoad(materialTex,p,0);
  let centerLayer=layerAt(c.x,p.y,m.r);var sum=vec3f(0);var donors=0u;var rejected=0u;
  if(params.flags.x!=0u&&params.flags.y!=0u&&owner!=0u&&smDepthRangeOccupied(c)){
    let rays=params.flags.w;let steps=u32(params.validity.w);let stepDistance=params.trace.x/f32(steps);
    for(var ray:u32=0u;ray<8u;ray++){
      if(ray>=rays){break;}let angle=6.28318530718*(f32(ray)+0.5)/f32(rays);let dir=vec2f(cos(angle),sin(angle));var done=false;
      for(var step:u32=0u;step<8u;step++){
        if(step>=steps||done){break;}let distance=(f32(step)+1.0)*stepDistance;
        // Parent extrema only cull. Harvesting always requires an owned L0 hit.
        for(var refine:u32=0u;refine<3u;refine++){
          let distance2=distance-stepDistance+stepDistance*(f32(refine)+1.0)/3.0;let hit=p+roundedOffset(dir*distance2);
          if(any(hit<vec2i(0))||any(hit>=vec2i(params.extent.xy))){continue;}
          let rd=rayDepth(c.x,dir.y,distance2,params.trace.y);
          let cr=textureLoad(coarseRange,hit/i32(params.flags.z),0).rg;
          if(!intersects(cr,rd-params.trace.z,rd+params.trace.z)){continue;}
          let d=textureLoad(depthRange,hit,0).rg;let id=textureLoad(objectTex,hit,0).x;
          if(id==0u||id==owner||!intersects(d,rd-params.trace.z,rd+params.trace.z)){continue;}
          if(layerAt(d.x,hit.y,textureLoad(materialTex,hit,0).r)!=centerLayer){continue;}
          done=true;
          let donorNormal=normalAt(normalTex,hit);
          let reason=smTemporalRejectReason(d,textureLoad(previousDepth,hit,0).rg,id,textureLoad(previousObject,hit,0).x,donorNormal,normalAt(previousNormal,hit),params.validity.x,params.validity.y);
          if(reason!=0u){rejected++;break;}
          let receive=max(0.0,dot(n,vec3f(dir.x,-dir.y,.5)));let emit=max(0.0,dot(donorNormal,vec3f(-dir.x,dir.y,.5)));
          let weight=receive*emit/(1.0+distance2/params.trace.x);
          sum+=finitePositive(textureLoad(previousColour,hit,0).rgb,params.energy.x)*weight;donors++;break;
        }
      }
    }
  }
  // Incident diffuse irradiance is quarter resolution; receiving material is
  // evaluated at native resolution in COMPOSE to preserve sprite subregions.
  let colour=sum/f32(params.flags.w)*params.trace.w;
  let bounded=indirectClamp(colour,params.energy.y,params.energy.z);
  textureStore(rawOut,vec2i(gid.xy),vec4f(bounded,f32(donors)/f32(params.flags.w)));
  textureStore(donorOut,vec2i(gid.xy),vec4f(f32(rejected)/f32(params.flags.w),0,0,1));
}`;

  const RESOLVE_WGSL=COMMON_WGSL+`
@group(0) @binding(0) var rawTex:texture_2d<f32>;
@group(0) @binding(1) var donorTex:texture_2d<f32>;
@group(0) @binding(2) var depthRange:texture_2d<f32>;
@group(0) @binding(3) var normalTex:texture_2d<f32>;
@group(0) @binding(4) var objectTex:texture_2d<u32>;
@group(0) @binding(5) var previousIndirect:texture_2d<f32>;
@group(0) @binding(6) var previousDepth:texture_2d<f32>;
@group(0) @binding(7) var previousNormal:texture_2d<f32>;
@group(0) @binding(8) var previousObject:texture_2d<u32>;
@group(0) @binding(9) var<uniform> params:Params;
@group(0) @binding(10) var indirectOut:texture_storage_2d<rgba16float,write>;
@group(0) @binding(11) var rejectionOut:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){
  if(any(gid.xy>=params.extent.zw)){return;}let q=vec2i(gid.xy);let p=min(q*4+vec2i(2),vec2i(params.extent.xy)-vec2i(1));
  let cur=textureLoad(rawTex,q,0);let donorReject=textureLoad(donorTex,q,0).x;let owner=textureLoad(objectTex,p,0).x;var reason=4u;
  if(params.flags.x!=0u&&params.flags.y!=0u){reason=smTemporalRejectReason(textureLoad(depthRange,p,0).rg,textureLoad(previousDepth,p,0).rg,owner,textureLoad(previousObject,p,0).x,normalAt(normalTex,p),normalAt(previousNormal,p),params.validity.x,params.validity.y);}
  if(reason==0u&&(owner==0u||donorReject>0.0||cur.a==0.0)){reason=5u;}
  var value=cur.rgb;
  if(reason==0u){var lo=vec3f(params.energy.y);var hi=vec3f(0);
    for(var oy:i32=-1;oy<=1;oy++){for(var ox:i32=-1;ox<=1;ox++){let h=q+vec2i(ox,oy);if(any(h<vec2i(0))||any(h>=vec2i(params.extent.zw))){continue;}let v=textureLoad(rawTex,h,0).rgb;lo=min(lo,v);hi=max(hi,v);}}
    let previous=textureLoad(previousIndirect,q,0).rgb;
    let bounded=clamp(previous,max(lo,cur.rgb-vec3f(params.validity.z)),min(hi,cur.rgb+vec3f(params.validity.z)));
    value=mix(cur.rgb,bounded,params.energy.w);
  }
  textureStore(indirectOut,q,vec4f(finitePositive(value,params.energy.y),cur.a));
  textureStore(rejectionOut,q,vec4f(f32(reason),donorReject,cur.a,1));
}`;

  const COMPOSE_WGSL=COMMON_WGSL+`
@group(0) @binding(0) var directTex:texture_2d<f32>;
@group(0) @binding(1) var indirectTex:texture_2d<f32>;
@group(0) @binding(2) var depthRange:texture_2d<f32>;
@group(0) @binding(3) var normalTex:texture_2d<f32>;
@group(0) @binding(4) var objectTex:texture_2d<u32>;
@group(0) @binding(5) var albedoTex:texture_2d<f32>;
@group(0) @binding(6) var materialTex:texture_2d<f32>;
@group(0) @binding(7) var<uniform> params:Params;
@group(0) @binding(8) var composedOut:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){
  if(any(gid.xy>=params.extent.xy)){return;}let p=vec2i(gid.xy);let direct=textureLoad(directTex,p,0);
  // Exact pass-through avoids even an addition of zero when disabled.
  if(params.flags.x==0u){textureStore(composedOut,p,direct);return;}
  let q=p/4;let center=min(q*4+vec2i(2),vec2i(params.extent.xy)-vec2i(1));let owner=textureLoad(objectTex,p,0).x;
  let reason=smTemporalRejectReason(textureLoad(depthRange,p,0).rg,textureLoad(depthRange,center,0).rg,owner,textureLoad(objectTex,center,0).x,normalAt(normalTex,p),normalAt(normalTex,center),params.validity.x,params.validity.y);
  var indirect=vec3f(0);if(owner!=0u&&reason==0u){let albedo=clamp(textureLoad(albedoTex,p,0).rgb,vec3f(0),vec3f(1));let diffuse=1.0-clamp(textureLoad(materialTex,p,0).g,0.0,1.0);indirect=textureLoad(indirectTex,q,0).rgb*albedo*diffuse;}
  textureStore(composedOut,p,vec4f(direct.rgb+indirect,direct.a));
}`;

  const SNAPSHOT_WGSL=COMMON_WGSL+`
@group(0) @binding(0) var directTex:texture_2d<f32>;
@group(0) @binding(1) var depthRange:texture_2d<f32>;
@group(0) @binding(2) var normalTex:texture_2d<f32>;
@group(0) @binding(3) var objectTex:texture_2d<u32>;
@group(0) @binding(4) var<uniform> params:Params;
@group(0) @binding(5) var previousColour:texture_storage_2d<rgba16float,write>;
@group(0) @binding(6) var previousDepth:texture_storage_2d<rg32float,write>;
@group(0) @binding(7) var previousNormal:texture_storage_2d<rgba16float,write>;
@group(0) @binding(8) var previousObject:texture_storage_2d<r32uint,write>;
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){
  if(any(gid.xy>=params.extent.xy)){return;}let p=vec2i(gid.xy);
  // Direct-only resolved input excludes this effect's addition from feedback.
  textureStore(previousColour,p,textureLoad(directTex,p,0));
  textureStore(previousDepth,p,vec4f(textureLoad(depthRange,p,0).rg,0,0));
  textureStore(previousNormal,p,textureLoad(normalTex,p,0));
  textureStore(previousObject,p,textureLoad(objectTex,p,0));
}`;

  function parameterBytes(width,height,options={},historyValid=false,coverage=1){
    const o=normalizeOptions(options),buf=new ArrayBuffer(80),u=new Uint32Array(buf),f=new Float32Array(buf);
    u.set([width,height,quarter(width),quarter(height),o.enabled?1:0,historyValid?1:0,coverage,o.rays]);
    f.set([o.radius*o.pixelScale,o.depthSlope/o.pixelScale,o.thickness,o.strength,o.donorMax,o.energyMax,o.saturation,o.historyWeight,o.depthThreshold,o.normalThreshold,o.deltaClamp,o.steps],8);
    return new Uint8Array(buf);
  }
  function halfToFloat(v){const s=(v&0x8000)?-1:1,e=(v>>10)&31,m=v&1023;return e===0?s*m*2**-24:e===31?(m?NaN:s*Infinity):s*(1+m/1024)*2**(e-15);}

  class WebGPUSSGI{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUSSGI requires GPUDevice');
      this.device=options.device;this.queue=options.queue||this.device.queue;this.options=normalizeOptions(options);
      this.width=extent(options.width||640);this.height=extent(options.height||360);this.registry=null;this.views={};this.bindCache={};
      this.pipelines=new Resources.PipelineCache(this.device,{labelPrefix:'SteelMothSSGI'});this.compute={};this.historyIndex=0;this.historyValid=false;
      this.valid=false;this.closed=false;this.generation=0;this.updateCount=0;this.invalidationCount=0;this.lastInvalidationReason='uninitialized';this.previousMeta=null;this.snapshot=null;this.deviceLost=false;this._deviceEpoch=0;
      this.configure(this.width,this.height);this._watchDevice();
    }
    _name(n){return`sm602:${n}`;}
    configure(width,height){
      if(this.closed)throw new Error('WebGPUSSGI is closed');width=extent(width);height=extent(height);
      if(this.registry&&width===this.width&&height===this.height)return false;
      this.registry?.close();this.width=width;this.height=height;this.quarterWidth=quarter(width);this.quarterHeight=quarter(height);
      this.registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width,height,labelPrefix:'SteelMothSSGI'});
      const usage=textureUsage(['TEXTURE_BINDING','STORAGE_BINDING','COPY_SRC']);
      for(const name of ['raw','donor','indirect0','indirect1','rejection'])this.registry.defineTexture(this._name(name),{format:OUTPUT_FORMAT,usage,size:{width:this.quarterWidth,height:this.quarterHeight,depthOrArrayLayers:1},resizeDependent:false,lifetime:'persistent'});
      for(const [name,format]of [['composed',OUTPUT_FORMAT],['previousColour',OUTPUT_FORMAT],['previousDepth','rg32float'],['previousNormal',OUTPUT_FORMAT],['previousObject','r32uint']])this.registry.defineTexture(this._name(name),{format,usage,size:'surface'});
      this.registry.defineBuffer(this._name('params'),{size:80,usage:bufferUsage(['UNIFORM','COPY_DST'])});
      this.views={};for(const name of ['raw','donor','indirect0','indirect1','rejection','composed','previousColour','previousDepth','previousNormal','previousObject'])this.views[name]=this.registry.require(this._name(name)).handle.createView();
      this.bindCache={};this.historyIndex=0;this.generation++;this.invalidate('configure');return true;
    }
    resize(width,height){return this.configure(width,height);}
    invalidate(reason='explicit'){this.historyValid=false;this.valid=false;this.previousMeta=null;this.snapshot=null;this.invalidationCount++;this.lastInvalidationReason=String(reason);return this.invalidationCount;}
    _watchDevice(){
      const device=this.device,epoch=++this._deviceEpoch;this.deviceLost=false;
      if(typeof device.lost?.then!=='function')return;
      Promise.resolve(device.lost).then(info=>{
        if(this.closed||this.device!==device||this._deviceEpoch!==epoch)return;
        this.deviceLost=true;this.invalidate(`device-lost:${String(info?.reason||'unknown')}`);
      }).catch(()=>{});
    }
    resetDevice(device,queue=device?.queue){
      if(this.closed)throw new Error('WebGPUSSGI is closed');if(!device)throw new Error('resetDevice requires GPUDevice');this.registry?.close();this.registry=null;this.device=device;this.queue=queue||device.queue;
      // A pending creation belongs to its original cache/device. Replacing the
      // cache prevents its late completion from populating the replacement cache.
      this.pipelines.clear();this.pipelines=new Resources.PipelineCache(device,{labelPrefix:'SteelMothSSGI'});this.compute={};this.configure(this.width,this.height);this.invalidate('device-reset');this._watchDevice();return this.generation;
    }
    async _pipelines(){
      for(const [name,code]of [['trace',TRACE_WGSL],['resolve',RESOLVE_WGSL],['compose',COMPOSE_WGSL],['snapshot',SNAPSHOT_WGSL]]){
        if(this.compute[name])continue;
        const generation=this.generation,device=this.device,cache=this.pipelines;
        const pipeline=await cache.getCompute(`ssgi-${name}-v1`,async(device,label)=>{
          const module=device.createShaderModule({label:`${label}:wgsl`,code});
          if(typeof module.getCompilationInfo==='function'){const info=await module.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error(`SM-602 ${name} WGSL compilation failed: ${errors.map(e=>e.message).join('; ')}`);}
          return device.createComputePipeline({label,layout:'auto',compute:{module,entryPoint:'cs_main'}});
        });
        if(this.closed||this.deviceLost||this.generation!==generation||this.device!==device){cache.clear();throw new Error('SM-602 lifecycle changed during pipeline preparation');}
        this.compute[name]=pipeline;
      }
    }
    sourceFromPaths(depthHierarchy,gbuffer,currentResolvedColourView){
      if(typeof depthHierarchy?.levelView!=='function')throw new Error('SM-602 requires the shared SM-203 hierarchy');
      if(gbuffer?.normalEncoding&&gbuffer.normalEncoding!=='xyz')throw new Error('SM-602 prototype requires canonical xyz Material-v2 normals');
      const g=typeof gbuffer?._views==='function'?gbuffer._views():null;
      if(!g?.g0||!g?.g1||!g?.g2||!g?.objectId||!currentResolvedColourView)throw new Error('SM-602 source requires G0/G1/G2/object and pre-indirect resolved linear colour');
      return{width:depthHierarchy.width,height:depthHierarchy.height,pixelScale:depthHierarchy.width/640,depthHierarchy,depthRangeView:depthHierarchy.levelView(0),normalView:g.g1,albedoView:g.g0,materialView:g.g2,objectView:g.objectId,currentResolvedColourView};
    }
    _bind(name,resources){
      const old=this.bindCache[name];if(old&&resources.length===old.resources.length&&resources.every((r,i)=>r===old.resources[i]))return old.bind;
      const bind=this.device.createBindGroup({label:`SteelMothSSGI:${name}-bind`,layout:this.compute[name.split(':')[0]].getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource}))});
      this.bindCache[name]={resources:[...resources],bind};return bind;
    }
    async update(source={},options={}){
      if(this._updating)throw new Error('SM-602 refuses concurrent history updates');
      this._updating=true;
      try{return await this._update(source,options);}
      catch(error){if(!this.closed&&!this.deviceLost&&this.valid)this.invalidate('update-failed');throw error;}
      finally{this._updating=false;}
    }
    async _update(source={},options={}){
      if(this.closed)throw new Error('WebGPUSSGI is closed');if(this.deviceLost)throw new Error('SM-602 refuses update after device loss');const width=extent(source.width||this.width),height=extent(source.height||this.height);this.configure(width,height);
      for(const key of ['normalView','albedoView','materialView','objectView','currentResolvedColourView'])if(!source[key])throw new Error(`SM-602 update requires ${key}`);
      if(!source.depthHierarchy?.levelView||source.depthHierarchy.valid===false)throw new Error('SM-602 refuses missing or stale shared depth hierarchy');
      if(source.depthHierarchy.width!==width||source.depthHierarchy.height!==height)throw new Error('SM-602 hierarchy extent differs from canonical source');
      // The hierarchy is authoritative even if a caller supplies a stale alias.
      source={...source,depthRangeView:source.depthHierarchy.levelView(0)};
      if(source.currentResolvedColourView===this.views.composed||source.currentResolvedColourView===this.views.previousColour)throw new Error('SM-602 resolved colour input must precede this effect, never its composed/history output');
      const generation=this.generation,validityEpoch=this.invalidationCount;await this._pipelines();
      if(this.closed||this.deviceLost||this.generation!==generation||this.invalidationCount!==validityEpoch)throw new Error('SM-602 lifecycle/history invalidated during update');
      if(source.depthHierarchy.valid===false)throw new Error('SM-602 shared hierarchy invalidated during update');
      const requestedQuality=resolveQuality(options.quality??this.options.quality);
      const base=requestedQuality.name===this.options.quality?this.options:{...this.options,...QUALITY_PRESETS[requestedQuality.name],enabled:this.options.enabled};
      const cfg=normalizeOptions({...base,pixelScale:source.pixelScale??base.pixelScale,...options}),global=Validity.globalDiscontinuity(this.previousMeta,options.meta||{},EXTRA_META_KEYS);
      if(this.historyValid&&JSON.stringify(cfg)!==JSON.stringify(this.options)){global.reject=true;global.reason='quality-or-settings-change';}
      const historyValid=this.historyValid&&cfg.enabled&&!global.reject;
      const level=source.depthHierarchy.levelForFootprint(cfg.radius*cfg.pixelScale/cfg.steps),coarse=source.depthHierarchy.levelView(level),coverage=source.depthHierarchy.levelInfo(level).coverage;
      const params=this.registry.require(this._name('params')).handle;this.queue.writeBuffer(params,0,parameterBytes(width,height,cfg,historyValid,coverage));
      const v=this.views,p=this._paramsBinding||(this._paramsBinding={buffer:params});if(p.buffer!==params)this._paramsBinding={buffer:params};const uniform=this._paramsBinding;
      const prev=`indirect${this.historyIndex}`,next=`indirect${1-this.historyIndex}`;
      const trace=this._bind('trace',[source.depthRangeView,coarse,source.normalView,source.objectView,source.materialView,v.previousColour,v.previousDepth,v.previousNormal,v.previousObject,uniform,v.raw,v.donor]);
      const resolve=this._bind(`resolve:${this.historyIndex}`,[v.raw,v.donor,source.depthRangeView,source.normalView,source.objectView,v[prev],v.previousDepth,v.previousNormal,v.previousObject,uniform,v[next],v.rejection]);
      const compose=this._bind(`compose:${this.historyIndex}`,[source.currentResolvedColourView,v[next],source.depthRangeView,source.normalView,source.objectView,source.albedoView,source.materialView,uniform,v.composed]);
      const snapshot=this._bind('snapshot',[source.currentResolvedColourView,source.depthRangeView,source.normalView,source.objectView,uniform,v.previousColour,v.previousDepth,v.previousNormal,v.previousObject]);
      const encoder=this.device.createCommandEncoder({label:'SteelMothSSGI:encoder'});
      for(const [name,bind,w,h]of [['trace',trace,this.quarterWidth,this.quarterHeight],['resolve',resolve,this.quarterWidth,this.quarterHeight],['compose',compose,width,height],['snapshot',snapshot,width,height]]){
        const desc={label:`SteelMothSSGI:${name}`};if(options.timestampWrites?.[name])desc.timestampWrites=options.timestampWrites[name];
        const pass=encoder.beginComputePass(desc);pass.setPipeline(this.compute[name]);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(h/8));pass.end();
      }
      const command=encoder.finish();
      if(options.performanceTimingScope?.submit)options.performanceTimingScope.submit([command],{producer:'SM-602',includes:'trace,resolve,compose,snapshot',commandCoverage:'complete'});else this.queue.submit([command]);
      // No normal-frame diagnostic mapping or onSubmittedWorkDone host wait.
      if(options.wait===true&&typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();
      if(this.closed||this.deviceLost||this.generation!==generation||this.invalidationCount!==validityEpoch)throw new Error('SM-602 lifecycle/history invalidated before update completion');
      this.historyIndex=1-this.historyIndex;this.historyValid=cfg.enabled;this.valid=true;this.previousMeta={...(options.meta||{})};this.options=cfg;this.updateCount++;this.lastInvalidationReason='';
      this.snapshot={options:{...cfg},historyUsed:historyValid,globalReject:global,coarseLevel:level,coarseCoverage:coverage};return this.diagnostics();
    }
    bindings(){
      if(this.deviceLost||!this.valid)throw new Error(`SM-602 SSGI is invalid: ${this.lastInvalidationReason}`);
      return{indirectQuarter:this.views[`indirect${this.historyIndex}`],rawQuarter:this.views.raw,rejectionQuarter:this.views.rejection,composed:this.views.composed,format:OUTPUT_FORMAT,quarterWidth:this.quarterWidth,quarterHeight:this.quarterHeight,generation:this.generation};
    }
    async readback(kind='indirect'){
      this.bindings();const names={indirect:`indirect${this.historyIndex}`,raw:'raw',rejection:'rejection',composed:'composed'},name=names[kind];if(!name)throw new Error(`unknown SM-602 readback: ${kind}`);
      const full=kind==='composed',width=full?this.width:this.quarterWidth,height=full?this.height:this.quarterHeight,row=width*8,bpr=Math.ceil(row/256)*256;
      const buffer=this.device.createBuffer({label:`SteelMothSSGI:${kind}-diagnostic`,size:bpr*height,usage:bufferUsage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder();
      encoder.copyTextureToBuffer({texture:this.registry.require(this._name(name)).handle},{buffer,bytesPerRow:bpr,rowsPerImage:height},{width,height,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);
      try{await buffer.mapAsync(Number(root?.GPUMapMode?.READ??1));const bytes=new Uint8Array(buffer.getMappedRange()),dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),data=new Float32Array(width*height*4);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let k=0;k<4;k++)data[(y*width+x)*4+k]=halfToFloat(dv.getUint16(y*bpr+x*8+k*2,true));buffer.unmap();return{width,height,data};
      }finally{buffer.destroy?.();}
    }
    diagnostics(){return{schema:SCHEMA,valid:this.valid,historyValid:this.historyValid,deviceLost:this.deviceLost,generation:this.generation,updateCount:this.updateCount,invalidationCount:this.invalidationCount,lastInvalidationReason:this.lastInvalidationReason,extent:{width:this.width,height:this.height,quarterWidth:this.quarterWidth,quarterHeight:this.quarterHeight},options:{...this.options},snapshot:this.snapshot,debugModes:[...DEBUG_MODES],rejectionCodes:{accepted:0,depth:1,object:2,normal:3,global:4,donorOrNoHit:5},historyPolicy:'SM-601 pixel/global validity plus explicit camera/light revisions; every colour donor separately validated against previous geometry.',colourPolicy:'Previous direct-only resolved linear HDR; quarter incident diffuse irradiance with bounded energy/saturation; native albedo*(1-metalness) receiving response and separate linear addition before post.',maxTraversal:{rays:8,steps:8,finePerStep:3,coarseQueriesPerRay:24},storageTextureCount:4,normalFrameMapping:false,targetHardwareEvidence:false,resourceDiagnostics:this.registry?.diagnostics?.()||null,pipelineDiagnostics:this.pipelines.diagnostics()};}
    close(){this.registry?.close();this.pipelines.clear();this.registry=null;this.views={};this.bindCache={};this.compute={};this.valid=false;this.historyValid=false;this.closed=true;this._deviceEpoch++;}
  }
  return{SCHEMA,OUTPUT_FORMAT,DEBUG_MODES,EXTRA_META_KEYS,DEFAULTS,LIMITS,QUALITY_PRESETS,resolveQuality,normalizeOptions,clampIndirect,layerAt,rayDepth,referenceSSGI,TRACE_WGSL,RESOLVE_WGSL,COMPOSE_WGSL,SNAPSHOT_WGSL,parameterBytes,halfToFloat,WebGPUSSGI};
});
