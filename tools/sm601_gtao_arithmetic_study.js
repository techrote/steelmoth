'use strict';
/* Test-only source-guarded candidates. No production caller imports this module. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SteelMothGTAOArithmeticStudy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const SCHEMA = 'steelmoth-sm601-arithmetic-study/v1';
  const BASELINE_RAW_SHA256 = 'd6bbbf28517866d9b3ca6e5de3b54847e4147f89a15df1be3ce47200d0cbae78';
  const BASELINE_UP_SHA256 = '7ddda64b8e31f11998ce77abb721c4b1e105e468e1e3785e28374eb0c9ef81cd';
  const VARIANTS = Object.freeze(['baseline', 'raw-shared', 'upsample-shared', 'combined']);
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  function extent(width,height) {
    if (![width,height].every(x=>Number.isSafeInteger(x)&&x>=1&&x<=8192)||width*height>16777216)
      throw new RangeError('Extent must be integer 1..8192 and at most 16,777,216 pixels.');
    return {width,height,halfWidth:Math.ceil(width/2),halfHeight:Math.ceil(height/2)};
  }
  async function sha256(text) {
    if (typeof require === 'function') return require('node:crypto').createHash('sha256').update(text).digest('hex');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function replaceOnce(source,oldText,newText) {
    if (source.split(oldText).length!==2) throw new Error('Source anchor missing or ambiguous; refuse unreviewed shader drift.');
    return source.replace(oldText,newText);
  }
  async function createShaders(raw,up,variant) {
    if (!VARIANTS.includes(variant)) throw new RangeError('Unknown arithmetic-study variant.');
    if (await sha256(raw)!==BASELINE_RAW_SHA256 || await sha256(up)!==BASELINE_UP_SHA256)
      throw new Error('Production shader SHA-256 drift; audit and revalidate before regenerating candidates.');
    if (variant==='raw-shared'||variant==='combined') {
      raw=replaceOnce(raw,'@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){',`
// Uniform sampling geometry, computed by the same WGSL expressions on this adapter.
// Arrays occupy 64 + 24 + 384 = 472 workgroup bytes. No CPU trigonometric table.
var<workgroup> auditDirs:array<vec2f,8>;
var<workgroup> auditDist:array<f32,6>;
var<workgroup> auditOffsets:array<vec2i,48>;
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_index) li:u32){
  let cacheDirs=max(1u,params.quality.y);let cacheSteps=max(1u,params.quality.z);
  if(li<8u&&li<cacheDirs){let angle=6.28318530718*(f32(li)+0.5)/f32(cacheDirs);auditDirs[li]=vec2f(cos(angle),sin(angle));}
  if(li<6u&&li<cacheSteps){auditDist[li]=params.s0.x*(f32(li)+1.0)/f32(cacheSteps);}
  workgroupBarrier();
  if(li<48u){let cd=li/6u;let cs=li%6u;if(cd<cacheDirs&&cs<cacheSteps){auditOffsets[li]=roundedOffset(auditDirs[cd]*auditDist[cs]);}}
  workgroupBarrier();
  // Padded and disabled lanes must reach both barriers before the original guards.
`);
      raw=replaceOnce(raw,'let angle=6.28318530718*(f32(d)+0.5)/f32(dirs);let dir=vec2f(cos(angle),sin(angle));','let dir=auditDirs[d];');
      raw=replaceOnce(raw,'let dist=params.s0.x*(f32(s)+1.0)/f32(steps);','let dist=auditDist[s];');
      raw=replaceOnce(raw,'p+roundedOffset(dir*dist)','p+auditOffsets[d*6u+s]');
    }
    if (variant==='upsample-shared'||variant==='combined') {
      up=replaceOnce(up,'@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){',`
// 8x8 output pixels need one 5x5 half-resolution neighbourhood.
// vec3f array stride is 16: 400 + 400 = 800 workgroup bytes.
var<workgroup> auditRaw:array<vec4f,25>;
var<workgroup> auditNormals:array<vec3f,25>;
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) wid:vec3u){
  let slot=lid.y*8u+lid.x;
  if(slot<25u){
    let h=clamp(vec2i(wid.xy)*4+vec2i(i32(slot%5u),i32(slot/5u)),vec2i(0),vec2i(params.extent.zw)-vec2i(1));
    let cached=textureLoad(rawTex,h,0);auditRaw[slot]=cached;
    if(cached.z>=0.5){let sp=min(h*2+vec2i(1),vec2i(params.extent.xy)-vec2i(1));auditNormals[slot]=normalAt(sp);}
  }
  workgroupBarrier();
  // Do not return padded lanes until after cache initialization and the barrier.
`);
      up=replaceOnce(up,'let raw=textureLoad(rawTex,h,0);','let ci=(lid.y/2u+u32(oy))*5u+lid.x/2u+u32(ox);let raw=auditRaw[ci];');
      up=replaceOnce(up,'let n2=normalAt(sp);','let n2=auditNormals[ci];');
    }
    return {variant,raw,up,rawSha256:await sha256(raw),upSha256:await sha256(up),
      rawWorkgroupBytes:variant==='raw-shared'||variant==='combined'?472:0,
      upWorkgroupBytes:variant==='upsample-shared'||variant==='combined'?800:0};
  }
  // Finite binary16 conversion, round-to-nearest ties-to-even; fixture data only.
  function halfBits(value) {
    if (!Number.isFinite(value)||Math.abs(value)>65504) throw new RangeError('Non-finite/out-of-range fixture value.');
    const a=new Float32Array([value]),u=new Uint32Array(a.buffer)[0],sign=(u>>>16)&0x8000;
    let e=((u>>>23)&255)-127+15,m=u&0x7fffff;
    if(e<=0){if(e< -10)return sign;m|=0x800000;const shift=14-e,base=m>>>shift,rem=m&((1<<shift)-1),tie=1<<(shift-1);return sign|(base+((rem>tie||(rem===tie&&(base&1)))?1:0));}
    let base=m>>>13,rem=m&8191;if(rem>4096||(rem===4096&&(base&1)))base++;
    if(base===1024){e++;base=0;}return sign|(e<<10)|base;
  }
  function fromHalf(v) {const sign=(v&0x8000)?-1:1,e=(v>>>10)&31,m=v&1023;return sign*(e===0?m*2**-24:e===31?(m?NaN:Infinity):(1+m/1024)*2**(e-15));}
  function quantizeHalf(a) {return Float32Array.from(a,x=>fromHalf(halfBits(x)));}
  function normalAt(a,i) {const x=a[i*4]*2-1,y=a[i*4+1]*2-1,z=a[i*4+2]*2-1,d=Math.hypot(x,y,z);if(!d)throw new Error('Zero decoded normal is outside the WGSL normalize domain.');return [x/d,y/d,z/d];}
  function makeFixture(width,height,pattern='dense',seed=1) {
    extent(width,height);
    if(!['plane','dense','sparse','empty','edge','saturated'].includes(pattern))throw new RangeError('Unknown fixture pattern.');
    const depth=new Float32Array(width*height*2),normal=new Float32Array(width*height*4);
    let state=seed>>>0;const rand=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
    const normals=[[.5,.5,1],[.75,.5,1],[.5,.75,1],[.25,.5,1],[.5,.5,0],[1,.5,.5]];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,r=rand();let occupied=true,d=.5;
      if(pattern==='empty')occupied=false;
      else if(pattern==='dense')d=.2+Math.floor(r*16)/32;
      else if(pattern==='sparse'){occupied=r<.08;d=.3+r*.4;}
      else if(pattern==='edge'){occupied=x>=Math.floor(width/2)||y===height-1;d=x%3===0?.25:.7;}
      else if(pattern==='saturated')d=((x+y)%3===0)?.1:.9;
      depth[i*2]=occupied?d:1;depth[i*2+1]=occupied?d:0;
      normal.set([...normals[pattern==='plane'?0:(x+y*3+seed)%normals.length],.75],i*4);
    }
    return {width,height,pattern,seed,depth,normal};
  }
  // Independent cached reconstruction model. Same order and 1e-6 GPU fallback guard.
  // It intentionally does not silently "correct" the production JS reference's 1e-8 guard.
  function upsampleReference(raw,depth,normals,width,height,o,threshold=1e-6,cached=true) {
    extent(width,height);const out=new Float32Array(width*height),confidence=new Float32Array(width*height),debug=new Float32Array(width*height);
    const hw=raw.width,hh=raw.height,cache=new Map();
    function sample(hx,hy) {const j=hy*hw+hx;if(cached&&cache.has(j))return cache.get(j);const data=Array.from(raw.data.subarray(j*4,j*4+4)),sx=Math.min(width-1,hx*2+1),sy=Math.min(height-1,hy*2+1),v={data,sx,sy,n:data[2]>=.5?normalAt(normals,sy*width+sx):null};if(cached)cache.set(j,v);return v;}
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x;let vis=1,conf=1,nearest=1;
      if(o.enabled&&depth[i*2]<=depth[i*2+1]){
        const n=normalAt(normals,i);let ws=0,vs=0;conf=0;
        for(let oy=0;oy<=1;oy++)for(let ox=0;ox<=1;ox++){
          const v=sample(clamp(Math.floor(x/2)+ox,0,hw-1),clamp(Math.floor(y/2)+oy,0,hh-1));
          if(ox===0&&oy===0)nearest=v.data[0];if(v.data[2]<.5)continue;
          const dw=1/(1+Math.abs(depth[i*2]-v.data[1])*o.depthSigma),nd=Math.max(0,n[0]*v.n[0]+n[1]*v.n[1]+n[2]*v.n[2]),nw=Math.pow(nd,o.normalPower),sp=1/(1+Math.hypot(x-v.sx,y-v.sy)),w=dw*nw*sp;
          ws+=w;vs+=v.data[0]*w;
        }
        if(ws>threshold){vis=clamp(vs/ws,0,1);conf=clamp(ws*.5,0,1);}else{vis=nearest;conf=0;}
      }
      out[i]=vis;confidence[i]=conf;debug[i]=o.debugMode==='occlusion'?1-vis:o.debugMode==='raw-half'?nearest:o.debugMode==='upsample-confidence'?conf:vis;
    }
    return {visibility:out,confidence,debug};
  }
  function weakWeightFixture() {
    const f=makeFixture(4,4,'plane'),raw={width:2,height:2,data:new Float32Array([.25,.5,1,.75,.75,.5,1,.25,.75,.5,1,.25,.75,.5,1,.25])};
    for(const i of [5,7,13,15])f.normal.set([1,.5,.5126953125,.75],i*4);
    return {...f,pattern:'weak-weight',raw};
  }
  function tileMapping(width,height,x,y,ox,oy) {
    extent(width,height);if(![x,y,ox,oy].every(Number.isInteger)||x<0||x>=width||y<0||y>=height||ox<0||ox>1||oy<0||oy>1)throw new RangeError('Invalid output/sample coordinate.');
    const bx=Math.floor(x/2),by=Math.floor(y/2),gx=Math.floor(x/8),gy=Math.floor(y/8),ci=(Math.floor(y%8/2)+oy)*5+Math.floor(x%8/2)+ox;
    const direct=[Math.min(Math.ceil(width/2)-1,bx+ox),Math.min(Math.ceil(height/2)-1,by+oy)],viaCache=[Math.min(Math.ceil(width/2)-1,gx*4+ci%5),Math.min(Math.ceil(height/2)-1,gy*4+Math.floor(ci/5))];
    return {ci,direct,viaCache};
  }
  function workModel(width,height,directions=6,steps=4) {
    const e=extent(width,height);if(!Number.isInteger(directions)||directions<4||directions>8||!Number.isInteger(steps)||steps<2||steps>6)throw new RangeError('Invalid bounded sampling quality.');
    const f=width*height,h=e.halfWidth*e.halfHeight,rg=Math.ceil(e.halfWidth/8)*Math.ceil(e.halfHeight/8),ug=Math.ceil(width/8)*Math.ceil(height/8);
    return {schema:SCHEMA+'/source-work-model',...e,directions,steps,assumption:'All output/sample pixels occupied, all temporal histories accepted; source-level requested texel payload, not DRAM traffic or compiled instruction counts.',
      raw:{invocations:h,groups:rg,depthLoads:h*(1+directions*steps),normalLoads:h,trigScalarCalls:2*h*directions,coordinateCalculations:h*directions*steps,readBytes:h*((1+directions*steps)*8+8),writeBytes:h*8},
      rawShared:{trigScalarCalls:2*rg*directions,coordinateCalculations:rg*directions*steps,distanceCalculations:rg*steps,workgroupBytes:472,barriers:2},
      upsample:{invocations:f,groups:ug,depthLoads:f,centreNormalLoads:f,rawLoads:4*f,sampleNormalLoads:4*f,powCalls:4*f,distanceCalls:4*f,normalizeCalls:5*f,readBytes:80*f,writeBytes:8*f},
      upsampleShared:{depthLoads:f,centreNormalLoads:f,rawLoads:25*ug,sampleNormalLoads:25*ug,normalizeCalls:f+25*ug,readBytes:16*f+400*ug,writeBytes:8*f,workgroupBytes:800,barriers:1},
      temporal:{readBytes:92*f,writeBytes:24*f,acceptedGlobalAtomics:f,rejectedGlobalAtomics:2*f,note:'Source-level accepted path counts the repeated current-normal load and 3x3 centre reload. Compiler/cache may eliminate traffic; counter atomics excluded from bytes.'},
      ownPersistentBytes:{raw:h*8,visibility:f*4,debug:f*4,temporalPingPong:48*f,buffers:160,total:h*8+56*f+160},
      sparseCaveat:'Caches initialize even for empty/disabled/padded outputs: baseline can skip sample work. No guaranteed speedup; compare sparse and empty fixtures.'};
  }
  function cases() {
    const out=[],extents=[[1,1],[1,9],[9,1],[3,5],[8,8],[9,9],[17,13],[32,24]];
    for(const [w,h] of extents)for(const pattern of ['plane','dense','sparse','empty','edge','saturated'])out.push({w,h,pattern,options:{}});
    for(let directions=4;directions<=8;directions++)for(let steps=2;steps<=6;steps++)out.push({w:17,h:13,pattern:'dense',options:{directions,steps,radius:4.125+directions*1.03125+steps*.53125}});
    for(const [w,h] of extents)for(const debugMode of ['visibility','occlusion','raw-half','upsample-confidence'])out.push({w,h,pattern:'edge',options:{debugMode}});
    for(const [w,h] of extents)out.push({w,h,pattern:'dense',options:{enabled:false}});
    for(const radius of [4,4.4999,7.4999,11.4999,12,12.0001,23.9999,24])out.push({w:17,h:13,pattern:'saturated',options:{radius,normalPower:12,depthSigma:512}});
    out.push({w:4,h:4,pattern:'weak-weight',options:{debugMode:'upsample-confidence'}});
    return out;
  }
  return {SCHEMA,VARIANTS,BASELINE_RAW_SHA256,BASELINE_UP_SHA256,extent,sha256,replaceOnce,createShaders,halfBits,fromHalf,quantizeHalf,normalAt,makeFixture,weakWeightFixture,upsampleReference,tileMapping,workModel,cases};
});
