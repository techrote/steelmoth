'use strict';

(function(root,factory){
  const Resources=root?.SteelMothWebGPUResources||((typeof module==='object'&&module.exports)?require('./webgpu_resources.js'):null);
  const api=factory(Resources,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUGTAO=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,root){
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before webgpu_gtao');

  const SCHEMA='steelmoth-webgpu-gtao/v1';
  const SNAPSHOT_SCHEMA='steelmoth-webgpu-gtao-snapshot/v1';
  const RAW_FORMAT='rgba16float';
  const OUTPUT_FORMAT='r32float';
  const DEBUG_FORMAT='r32float';
  const DEBUG_MODES=Object.freeze(['visibility','occlusion','raw-half','upsample-confidence']);
  const DEFAULTS=Object.freeze({enabled:true,directions:6,steps:4,radius:12,bias:.0015,depthScale:34,intensity:1.1,depthSigma:180,normalPower:4,debugMode:'visibility'});
  const LIMITS=Object.freeze({directions:[4,8],steps:[2,6],radius:[4,24],intensity:[0,2],depthSigma:[16,512],normalPower:[1,12]});
  const MATERIAL_AO_POLICY=Object.freeze({semantic:'Material AO remains intra-object; GTAO is inter-surface/world occlusion.',composition:'SM-307 combines material AO and GTAO with strongest-occluder/min semantics rather than multiplication.',recommendedMaterialAOStrength:.50,gtaoStrength:1.0});
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,TEXTURE_BINDING:0x04,STORAGE_BINDING:0x08});
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040});
  const MAP_MODE_READ=0x0001;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const align=(v,m=256)=>Math.ceil(Math.max(0,Number(v)||0)/m)*m;
  const textureUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUTextureUsage?.[n]??FALLBACK_TEXTURE_USAGE[n]??0),0);
  const bufferUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const roundOffset=v=>Math.sign(v)*Math.floor(Math.abs(v)+.5001);

  function normalizeOptions(overrides={}){
    const o={...DEFAULTS,...overrides},debugMode=DEBUG_MODES.includes(String(o.debugMode))?String(o.debugMode):DEFAULTS.debugMode;
    return{enabled:o.enabled!==false,directions:Math.round(clamp(finite(o.directions,DEFAULTS.directions),...LIMITS.directions)),steps:Math.round(clamp(finite(o.steps,DEFAULTS.steps),...LIMITS.steps)),radius:clamp(finite(o.radius,DEFAULTS.radius),...LIMITS.radius),bias:clamp(finite(o.bias,DEFAULTS.bias),0,.03),depthScale:clamp(finite(o.depthScale,DEFAULTS.depthScale),1,256),intensity:clamp(finite(o.intensity,DEFAULTS.intensity),...LIMITS.intensity),depthSigma:clamp(finite(o.depthSigma,DEFAULTS.depthSigma),...LIMITS.depthSigma),normalPower:clamp(finite(o.normalPower,DEFAULTS.normalPower),...LIMITS.normalPower),debugMode};
  }
  function recommendedVisibilityOptions(overrides={}){return{gtao:true,gtaoStrength:MATERIAL_AO_POLICY.gtaoStrength,materialAOStrength:MATERIAL_AO_POLICY.recommendedMaterialAOStrength,...overrides};}
  function occupied(range){return Number(range?.[0])<=Number(range?.[1]);}
  function decodeNormal(v){const x=finite(v?.[0],.5)*2-1,y=finite(v?.[1],.5)*2-1,z=finite(v?.[2],1)*2-1,d=Math.hypot(x,y,z)||1;return[x/d,y/d,z/d];}
  function normalAt(normals,index){return decodeNormal([normals[index*4],normals[index*4+1],normals[index*4+2]]);}
  function referenceHalf(depthRanges,normals,width,height,options={}){
    const o=normalizeOptions(options),halfWidth=Math.max(1,Math.ceil(width/2)),halfHeight=Math.max(1,Math.ceil(height/2)),out=new Float32Array(halfWidth*halfHeight*4);
    for(let hy=0;hy<halfHeight;hy++)for(let hx=0;hx<halfWidth;hx++){
      const px=Math.min(width-1,hx*2+1),py=Math.min(height-1,hy*2+1),pi=py*width+px,ri=pi*2,oo=(hy*halfWidth+hx)*4,range=[depthRanges[ri],depthRanges[ri+1]];
      if(!o.enabled||!occupied(range)){out[oo]=1;out[oo+1]=occupied(range)?range[0]:1;out[oo+2]=occupied(range)?1:0;continue;}
      const n=normalAt(normals,pi),cd=range[0];let sum=0;
      for(let d=0;d<o.directions;d++){
        const a=Math.PI*2*(d+.5)/o.directions,dx=Math.cos(a),dy=Math.sin(a);let horizon=0;
        for(let s=0;s<o.steps;s++){
          const dist=o.radius*(s+1)/o.steps,sx=clamp(px+roundOffset(dx*dist),0,width-1),sy=clamp(py+roundOffset(dy*dist),0,height-1),si=(sy*width+sx)*2,sr=[depthRanges[si],depthRanges[si+1]];if(!occupied(sr))continue;
          const near=Math.max(0,cd-sr[0]-o.bias),slope=near*o.depthScale/Math.max(1,dist),directionWeight=clamp(1-Math.abs(n[0]*dx+n[1]*dy)*.35,.65,1);horizon=Math.max(horizon,clamp(slope*directionWeight,0,1));
        }
        sum+=horizon;
      }
      const occlusion=clamp(sum/o.directions*o.intensity,0,.85);out[oo]=1-occlusion;out[oo+1]=cd;out[oo+2]=1;out[oo+3]=occlusion;
    }
    return{width:halfWidth,height:halfHeight,data:out};
  }
  function referenceUpsample(raw,depthRanges,normals,width,height,options={}){
    const o=normalizeOptions(options),out=new Float32Array(width*height),confidence=new Float32Array(width*height),hw=raw.width,hh=raw.height;
    if(!o.enabled){out.fill(1);confidence.fill(1);return{visibility:out,confidence};}
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,ri=i*2,cr=[depthRanges[ri],depthRanges[ri+1]];if(!occupied(cr)){out[i]=1;confidence[i]=1;continue;}const n=normalAt(normals,i),bx=Math.floor(x/2),by=Math.floor(y/2);let ws=0,vs=0;
      for(let oy=0;oy<=1;oy++)for(let ox=0;ox<=1;ox++){const hx=clamp(bx+ox,0,hw-1),hy=clamp(by+oy,0,hh-1),hidx=(hy*hw+hx)*4;if(raw.data[hidx+2]<.5)continue;const sx=Math.min(width-1,hx*2+1),sy=Math.min(height-1,hy*2+1),si=sy*width+sx,n2=normalAt(normals,si),depthWeight=1/(1+Math.abs(cr[0]-raw.data[hidx+1])*o.depthSigma),nd=Math.max(0,n[0]*n2[0]+n[1]*n2[1]+n[2]*n2[2]),normalWeight=Math.pow(nd,o.normalPower),spatial=1/(1+Math.hypot(x-sx,y-sy)),w=depthWeight*normalWeight*spatial;ws+=w;vs+=raw.data[hidx]*w;}
      if(ws<=1e-8){const hx=clamp(bx,0,hw-1),hy=clamp(by,0,hh-1);out[i]=raw.data[(hy*hw+hx)*4];confidence[i]=0;}else{out[i]=clamp(vs/ws,0,1);confidence[i]=clamp(ws/2,0,1);}
    }
    return{visibility:out,confidence};
  }
  function referenceGTAO(depthRanges,normals,width,height,options={}){const raw=referenceHalf(depthRanges,normals,width,height,options),full=referenceUpsample(raw,depthRanges,normals,width,height,options);return{raw,...full,options:normalizeOptions(options)};}
  function fieldMetrics(values){const a=Array.from(values||[]);if(!a.length)return{min:1,max:1,mean:1,occludedPixels:0};let min=1,max=0,sum=0,occ=0;for(const v0 of a){const v=clamp(finite(v0,1),0,1);min=Math.min(min,v);max=Math.max(max,v);sum+=v;if(v<.985)occ++;}return{min,max,mean:sum/a.length,occludedPixels:occ};}

  const RAW_WGSL=`
struct Params{extent:vec4u,quality:vec4u,s0:vec4f,s1:vec4f};
@group(0) @binding(0) var depthRange:texture_2d<f32>;
@group(0) @binding(1) var normalTex:texture_2d<f32>;
@group(0) @binding(2) var<uniform> params:Params;
@group(0) @binding(3) var rawOut:texture_storage_2d<rgba16float,write>;
fn occupied(r:vec2f)->bool{return r.x<=r.y;}
fn normalAt(p:vec2i)->vec3f{return normalize(textureLoad(normalTex,p,0).xyz*2.0-1.0);}
fn roundedOffset(v:vec2f)->vec2i{return vec2i(sign(v)*floor(abs(v)+vec2f(0.5001)));}
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){
  if(gid.x>=params.extent.z||gid.y>=params.extent.w){return;}let fullSize=vec2i(params.extent.xy);let p=min(vec2i(gid.xy)*2+vec2i(1),fullSize-vec2i(1));let c=textureLoad(depthRange,p,0).rg;
  if(params.quality.x==0u||!occupied(c)){textureStore(rawOut,vec2i(gid.xy),vec4f(1.0,select(1.0,c.x,occupied(c)),select(0.0,1.0,occupied(c)),0.0));return;}
  let n=normalAt(p);var sum=0.0;let dirs=max(1u,params.quality.y);let steps=max(1u,params.quality.z);
  for(var d:u32=0u;d<8u;d++){if(d>=dirs){continue;}let angle=6.28318530718*(f32(d)+0.5)/f32(dirs);let dir=vec2f(cos(angle),sin(angle));var horizon=0.0;
    for(var s:u32=0u;s<6u;s++){if(s>=steps){continue;}let dist=params.s0.x*(f32(s)+1.0)/f32(steps);let q=clamp(p+roundedOffset(dir*dist),vec2i(0),fullSize-vec2i(1));let r=textureLoad(depthRange,q,0).rg;if(!occupied(r)){continue;}let near=max(0.0,c.x-r.x-params.s0.y);let slope=near*params.s0.z/max(1.0,dist);let dw=clamp(1.0-abs(dot(n.xy,dir))*0.35,0.65,1.0);horizon=max(horizon,clamp(slope*dw,0.0,1.0));}
    sum+=horizon;
  }
  let occ=clamp(sum/f32(dirs)*params.s0.w,0.0,0.85);textureStore(rawOut,vec2i(gid.xy),vec4f(1.0-occ,c.x,1.0,occ));
}`;

  const UPSAMPLE_WGSL=`
struct Params{extent:vec4u,quality:vec4u,s0:vec4f,s1:vec4f};
@group(0) @binding(0) var rawTex:texture_2d<f32>;
@group(0) @binding(1) var depthRange:texture_2d<f32>;
@group(0) @binding(2) var normalTex:texture_2d<f32>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var visibilityOut:texture_storage_2d<r32float,write>;
@group(0) @binding(5) var debugOut:texture_storage_2d<r32float,write>;
fn occupied(r:vec2f)->bool{return r.x<=r.y;}
fn normalAt(p:vec2i)->vec3f{return normalize(textureLoad(normalTex,p,0).xyz*2.0-1.0);}
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){
  if(gid.x>=params.extent.x||gid.y>=params.extent.y){return;}let p=vec2i(gid.xy);let c=textureLoad(depthRange,p,0).rg;var vis=1.0;var conf=1.0;var nearestRaw=1.0;
  if(params.quality.x!=0u&&occupied(c)){let n=normalAt(p);let base=vec2i(gid.xy/2u);var ws=0.0;var vs=0.0;conf=0.0;
    for(var oy:i32=0;oy<=1;oy++){for(var ox:i32=0;ox<=1;ox++){let h=clamp(base+vec2i(ox,oy),vec2i(0),vec2i(params.extent.zw)-vec2i(1));let raw=textureLoad(rawTex,h,0);if(ox==0&&oy==0){nearestRaw=raw.x;}if(raw.z<0.5){continue;}let sp=min(h*2+vec2i(1),vec2i(params.extent.xy)-vec2i(1));let n2=normalAt(sp);let depthWeight=1.0/(1.0+abs(c.x-raw.y)*params.s1.x);let nd=max(0.0,dot(n,n2));let normalWeight=pow(nd,params.s1.y);let spatial=1.0/(1.0+distance(vec2f(p),vec2f(sp)));let w=depthWeight*normalWeight*spatial;ws+=w;vs+=raw.x*w;}}
    if(ws>0.000001){vis=clamp(vs/ws,0.0,1.0);conf=clamp(ws*0.5,0.0,1.0);}else{vis=nearestRaw;conf=0.0;}
  }
  var dbg=vis;if(params.quality.w==1u){dbg=1.0-vis;}else if(params.quality.w==2u){dbg=nearestRaw;}else if(params.quality.w==3u){dbg=conf;}textureStore(visibilityOut,p,vec4f(vis,0,0,1));textureStore(debugOut,p,vec4f(dbg,0,0,1));
}`;

  function parameterBytes(width,height,options={}){const o=normalizeOptions(options),hw=Math.max(1,Math.ceil(width/2)),hh=Math.max(1,Math.ceil(height/2)),buf=new ArrayBuffer(64),u=new Uint32Array(buf),f=new Float32Array(buf);u[0]=width;u[1]=height;u[2]=hw;u[3]=hh;u[4]=o.enabled?1:0;u[5]=o.directions;u[6]=o.steps;u[7]=Math.max(0,DEBUG_MODES.indexOf(o.debugMode));f[8]=o.radius;f[9]=o.bias;f[10]=o.depthScale;f[11]=o.intensity;f[12]=o.depthSigma;f[13]=o.normalPower;return new Uint8Array(buf);}

  class WebGPUGTAO{
    constructor(options={}){if(!options.device)throw new Error('WebGPUGTAO requires GPUDevice');this.device=options.device;this.queue=options.queue||options.device.queue;this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));this.options={...DEFAULTS,...options};this.registry=null;this.pipelines=new Resources.PipelineCache(this.device,{labelPrefix:'SteelMothGTAO'});this.rawPipeline=null;this.upPipeline=null;this.valid=false;this.closed=false;this.generation=0;this.updateCount=0;this.invalidationCount=0;this.lastInvalidationReason='uninitialized';this.snapshot=null;this.configure(this.width,this.height);}
    _name(n){return`sm600:${n}`;}
    configure(width,height){if(this.closed)throw new Error('WebGPUGTAO is closed');width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));if(this.registry&&width===this.width&&height===this.height)return false;if(this.registry)this.registry.close();this.width=width;this.height=height;const hw=Math.max(1,Math.ceil(width/2)),hh=Math.max(1,Math.ceil(height/2)),usage=textureUsage(['TEXTURE_BINDING','STORAGE_BINDING','COPY_SRC']);this.registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width,height,labelPrefix:'SteelMothGTAO'});this.registry.defineTexture(this._name('raw'),{format:RAW_FORMAT,usage,size:{width:hw,height:hh,depthOrArrayLayers:1},resizeDependent:false,lifetime:'persistent'});this.registry.defineTexture(this._name('visibility'),{format:OUTPUT_FORMAT,usage,size:'surface'});this.registry.defineTexture(this._name('debug'),{format:DEBUG_FORMAT,usage,size:'surface'});this.registry.defineBuffer(this._name('params'),{size:64,usage:bufferUsage(['UNIFORM','COPY_DST'])});this.generation++;this.invalidate('configure');return true;}
    resize(width,height){return this.configure(width,height);}
    resetDevice(device,queue=device?.queue){if(!device)throw new Error('resetDevice requires GPUDevice');this.device=device;this.queue=queue||device.queue;this.registry?.close();this.registry=null;this.pipelines.resetDevice(device);this.rawPipeline=null;this.upPipeline=null;this.generation++;this.configure(this.width,this.height);this.invalidate('device-reset');return this.generation;}
    invalidate(reason='explicit'){this.valid=false;this.snapshot=null;this.invalidationCount++;this.lastInvalidationReason=String(reason||'explicit');return this.invalidationCount;}
    async _pipelines(){if(this.rawPipeline&&this.upPipeline)return;const make=async(key,code)=>this.pipelines.getCompute(key,async(device,label)=>{const module=device.createShaderModule({label:`${label}:wgsl`,code});if(typeof module.getCompilationInfo==='function'){const info=await module.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error(`SM-600 ${key} WGSL compilation failed: ${errors.map(e=>e.message).join('; ')}`);}return device.createComputePipeline({label,layout:'auto',compute:{module,entryPoint:'cs_main'}});});this.rawPipeline=await make('gtao-raw-v1',RAW_WGSL);this.upPipeline=await make('gtao-upsample-v1',UPSAMPLE_WGSL);}
    sourceFromPaths(depthHierarchy,gbuffer){if(typeof depthHierarchy?.levelView!=='function')throw new Error('SM-600 sourceFromPaths requires SM-203 WebGPUDepthHierarchy');const views=typeof gbuffer?._views==='function'?gbuffer._views():null;if(!views?.g1)throw new Error('SM-600 sourceFromPaths requires SM-200/202 G-buffer normal/roughness view');return{width:this.width,height:this.height,depthRangeView:depthHierarchy.levelView(0),normalView:views.g1,depthHierarchy};}
    async update(source={},options={}){const width=Math.max(1,Math.round(source.width||this.width)),height=Math.max(1,Math.round(source.height||this.height));if(width!==this.width||height!==this.height)this.configure(width,height);if(!source.depthRangeView||!source.normalView)throw new Error('SM-600 update requires canonical SM-203 depthRangeView and Material-v2 normalView');if(source.depthHierarchy&&source.depthHierarchy.valid===false)throw new Error('SM-600 refuses invalid/stale SM-203 depth hierarchy');await this._pipelines();const cfg=normalizeOptions({...this.options,...options}),params=this.registry.require(this._name('params')).handle;this.queue.writeBuffer(params,0,parameterBytes(width,height,cfg));const raw=this.registry.require(this._name('raw')).handle.createView(),visibility=this.registry.require(this._name('visibility')).handle.createView(),debug=this.registry.require(this._name('debug')).handle.createView();const rawBind=this.device.createBindGroup({label:'SteelMothGTAO:raw-bind',layout:this.rawPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source.depthRangeView},{binding:1,resource:source.normalView},{binding:2,resource:{buffer:params}},{binding:3,resource:raw}]});const upBind=this.device.createBindGroup({label:'SteelMothGTAO:upsample-bind',layout:this.upPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:raw},{binding:1,resource:source.depthRangeView},{binding:2,resource:source.normalView},{binding:3,resource:{buffer:params}},{binding:4,resource:visibility},{binding:5,resource:debug}]});const encoder=this.device.createCommandEncoder({label:'SteelMothGTAO:encoder'}),p0=encoder.beginComputePass({label:'SteelMothGTAO:half-horizon'});p0.setPipeline(this.rawPipeline);p0.setBindGroup(0,rawBind);p0.dispatchWorkgroups(Math.ceil(Math.ceil(width/2)/8),Math.ceil(Math.ceil(height/2)/8));p0.end();const p1=encoder.beginComputePass({label:'SteelMothGTAO:depth-aware-upsample'});p1.setPipeline(this.upPipeline);p1.setBindGroup(0,upBind);p1.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));p1.end();this.queue.submit([encoder.finish()]);if(options.wait!==false&&typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();this.valid=true;this.lastInvalidationReason='';this.updateCount++;this.snapshot={schema:SNAPSHOT_SCHEMA,width,height,halfWidth:Math.ceil(width/2),halfHeight:Math.ceil(height/2),options:cfg,producer:'half-resolution pseudo-depth + Material-v2 normal horizon search',upscale:'full-resolution bilateral depth/normal-aware reconstruction',temporalHistory:false,materialAO:{...MATERIAL_AO_POLICY},consumer:'SM-307 gtaoVisibilityView'};return this.diagnostics();}
    _record(name){if(!this.valid)throw new Error(`SM-600 GTAO is invalid: ${this.lastInvalidationReason}`);return this.registry.require(this._name(name));}
    bindings(){return{gtaoVisibility:this._record('visibility').handle.createView(),visibility:this._record('visibility').handle.createView(),debug:this._record('debug').handle.createView(),rawHalf:this._record('raw').handle.createView(),format:OUTPUT_FORMAT,debugFormat:DEBUG_FORMAT,rawFormat:RAW_FORMAT,materialAORecommendation:recommendedVisibilityOptions(),generation:this.generation};}
    async _readR32(name){const record=this._record(name),w=this.width,h=this.height,row=w*4,bpr=align(row,256),map=this.device.createBuffer({label:`SteelMothGTAO:${name}-readback`,size:bpr*h,usage:bufferUsage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:record.handle},{buffer:map,bytesPerRow:bpr,rowsPerImage:h},{width:w,height:h,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);await map.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(map.getMappedRange()),out=new Float32Array(w*h);for(let y=0;y<h;y++){const dv=new DataView(raw.buffer,raw.byteOffset+y*bpr,row);for(let x=0;x<w;x++)out[y*w+x]=dv.getFloat32(x*4,true);}map.unmap();map.destroy?.();return out;}
    readback(){return this._readR32('visibility');}
    readbackDebug(){return this._readR32('debug');}
    diagnostics(){return{schema:SCHEMA,valid:this.valid,generation:this.generation,updateCount:this.updateCount,invalidationCount:this.invalidationCount,lastInvalidationReason:this.lastInvalidationReason,extent:{width:this.width,height:this.height,halfWidth:Math.ceil(this.width/2),halfHeight:Math.ceil(this.height/2)},snapshot:this.snapshot?JSON.parse(JSON.stringify(this.snapshot)):null,debugModes:[...DEBUG_MODES],limits:JSON.parse(JSON.stringify(LIMITS)),materialAOPolicy:{...MATERIAL_AO_POLICY},resourceDiagnostics:this.registry?.diagnostics?.()||null,pipelineDiagnostics:this.pipelines?.diagnostics?.()||null};}
    close(){this.registry?.close();this.pipelines?.clear();this.registry=null;this.rawPipeline=null;this.upPipeline=null;this.valid=false;this.snapshot=null;this.closed=true;}
  }

  return{SCHEMA,SNAPSHOT_SCHEMA,RAW_FORMAT,OUTPUT_FORMAT,DEBUG_FORMAT,DEBUG_MODES,DEFAULTS,LIMITS,MATERIAL_AO_POLICY,RAW_WGSL,UPSAMPLE_WGSL,normalizeOptions,recommendedVisibilityOptions,occupied,decodeNormal,referenceHalf,referenceUpsample,referenceGTAO,fieldMetrics,parameterBytes,WebGPUGTAO};
});
