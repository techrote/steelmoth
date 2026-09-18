'use strict';

(function(root,factory){
  let Resources=root?.SteelMothWebGPUResources||null;
  if(!Resources&&typeof module==='object'&&module.exports){try{Resources=require('./webgpu_resources.js');}catch(_e){Resources=null;}}
  const api=factory(Resources,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUVisibility=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,root){
  const SCHEMA='steelmoth-webgpu-visibility/v1';
  const SNAPSHOT_SCHEMA='steelmoth-webgpu-visibility-snapshot/v1';
  const OUTPUT_FORMAT='rgba16float';
  const DEBUG_FORMAT='r32float';
  const DEBUG_MODES=Object.freeze(['combined','direct','ambient','dso','self-shadow','contact-shadow','dark-bloom','material-ao','gtao','macro','local']);
  const FLAGS=Object.freeze({dso:1,selfShadow:2,contactShadow:4,darkBloom:8,materialAO:16,gtao:32});
  const DEFAULTS=Object.freeze({
    dso:true,selfShadow:true,contactShadow:true,darkBloom:true,materialAO:true,gtao:false,
    materialAOStrength:.62,gtaoStrength:1,bloomMax:.5,
    directWeight:.8,ambientWeight:.2,ambientFloor:.35,combinedFloor:.18,hardCoreFloor:.12,
    debugMode:'combined'
  });
  const GTAO_INTERFACE=Object.freeze({
    version:1,
    semantic:'visibility',
    range:'0=occluded, 1=visible',
    resolution:'full-resolution at SM-307 boundary; future producer may reconstruct from reduced resolution before binding',
    format:'single-channel float texture sampled as texture_2d<f32>',
    ownership:'reserved input only; SM-307 does not generate GTAO'
  });
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040});
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,TEXTURE_BINDING:0x04,STORAGE_BINDING:0x08});
  const MAP_MODE_READ=0x0001;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const align=(v,m=4)=>Math.ceil(Math.max(0,Number(v)||0)/m)*m;
  const bufferUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const textureUsage=names=>names.reduce((v,n)=>v|Number(root?.GPUTextureUsage?.[n]??FALLBACK_TEXTURE_USAGE[n]??0),0);

  function normalizeOptions(overrides={}){
    const o={...DEFAULTS,...overrides};
    let directWeight=clamp(finite(o.directWeight,DEFAULTS.directWeight),0,1),ambientWeight=clamp(finite(o.ambientWeight,DEFAULTS.ambientWeight),0,1),sum=directWeight+ambientWeight;
    if(sum<=1e-8){directWeight=DEFAULTS.directWeight;ambientWeight=DEFAULTS.ambientWeight;sum=directWeight+ambientWeight;}
    directWeight/=sum;ambientWeight/=sum;
    const debugMode=DEBUG_MODES.includes(String(o.debugMode))?String(o.debugMode):DEFAULTS.debugMode;
    return {
      dso:o.dso!==false,selfShadow:o.selfShadow!==false,contactShadow:o.contactShadow!==false,darkBloom:o.darkBloom!==false,materialAO:o.materialAO!==false,gtao:o.gtao===true,
      materialAOStrength:clamp(finite(o.materialAOStrength,DEFAULTS.materialAOStrength),0,1),gtaoStrength:clamp(finite(o.gtaoStrength,DEFAULTS.gtaoStrength),0,1),bloomMax:clamp(finite(o.bloomMax,DEFAULTS.bloomMax),0,.75),
      directWeight,ambientWeight,ambientFloor:clamp(finite(o.ambientFloor,DEFAULTS.ambientFloor),0,1),combinedFloor:clamp(finite(o.combinedFloor,DEFAULTS.combinedFloor),0,1),hardCoreFloor:clamp(finite(o.hardCoreFloor,DEFAULTS.hardCoreFloor),0,1),debugMode
    };
  }

  function enabledFlags(options={}){
    const o=normalizeOptions(options);let flags=0;
    if(o.dso)flags|=FLAGS.dso;if(o.selfShadow)flags|=FLAGS.selfShadow;if(o.contactShadow)flags|=FLAGS.contactShadow;if(o.darkBloom)flags|=FLAGS.darkBloom;if(o.materialAO)flags|=FLAGS.materialAO;if(o.gtao)flags|=FLAGS.gtao;
    return flags>>>0;
  }

  function composeSample(input={},options={}){
    const o=normalizeOptions(options);
    const dsoOcclusion=o.dso?clamp(finite(input.dsoOcclusion??input.dso,0),0,1):0;
    const dsoVisibility=1-dsoOcclusion;
    const selfVisibility=o.selfShadow?clamp(finite(input.selfVisibility,1),0,1):1;
    const contactVisibility=o.contactShadow?clamp(finite(input.contactVisibility,1),0,1):1;
    const darkBloomOcclusion=o.darkBloom?clamp(finite(input.darkBloomOcclusion??input.darkBloom,0),0,o.bloomMax):0;
    const darkBloomVisibility=1-darkBloomOcclusion;
    const materialRaw=clamp(finite(input.materialAO,1),0,1);
    const materialAOVisibility=o.materialAO?1-(1-materialRaw)*o.materialAOStrength:1;
    const gtaoRaw=clamp(finite(input.gtaoVisibility,1),0,1);
    const gtaoVisibility=o.gtao?1-(1-gtaoRaw)*o.gtaoStrength:1;
    const macroVisibility=Math.min(dsoVisibility,darkBloomVisibility);
    const localVisibility=Math.min(selfVisibility,contactVisibility);
    const directVisibility=Math.min(macroVisibility,localVisibility);
    const ambientVisibility=Math.max(o.ambientFloor,Math.min(materialAOVisibility,gtaoVisibility));
    const weighted=directVisibility*o.directWeight+ambientVisibility*o.ambientWeight;
    const combinedVisibility=Math.max(dsoOcclusion>.5?o.hardCoreFloor:o.combinedFloor,clamp(weighted,0,1));
    return {combinedVisibility,directVisibility,ambientVisibility,dsoVisibility,selfVisibility,contactVisibility,darkBloomVisibility,materialAOVisibility,gtaoVisibility,macroVisibility,localVisibility,dsoOcclusion,darkBloomOcclusion};
  }

  function debugValue(result,mode='combined'){
    switch(mode){
      case'direct':return result.directVisibility;case'ambient':return result.ambientVisibility;case'dso':return result.dsoVisibility;case'self-shadow':return result.selfVisibility;case'contact-shadow':return result.contactVisibility;case'dark-bloom':return result.darkBloomVisibility;case'material-ao':return result.materialAOVisibility;case'gtao':return result.gtaoVisibility;case'macro':return result.macroVisibility;case'local':return result.localVisibility;default:return result.combinedVisibility;
    }
  }

  function composeFields(input={},options={}){
    const arrays=[input.dsoOcclusion,input.selfVisibility,input.contactVisibility,input.darkBloomOcclusion,input.materialAO,input.gtaoVisibility].filter(Boolean),count=Math.max(0,...arrays.map(a=>a.length||0));
    const names=['combined','direct','ambient','dso','selfShadow','contactShadow','darkBloom','materialAO','gtao','macro','local'];
    const out=Object.fromEntries(names.map(n=>[n,new Float32Array(count)]));
    for(let i=0;i<count;i++){
      const r=composeSample({dsoOcclusion:input.dsoOcclusion?.[i]??0,selfVisibility:input.selfVisibility?.[i]??1,contactVisibility:input.contactVisibility?.[i]??1,darkBloomOcclusion:input.darkBloomOcclusion?.[i]??0,materialAO:input.materialAO?.[i]??1,gtaoVisibility:input.gtaoVisibility?.[i]??1},options);
      out.combined[i]=r.combinedVisibility;out.direct[i]=r.directVisibility;out.ambient[i]=r.ambientVisibility;out.dso[i]=r.dsoVisibility;out.selfShadow[i]=r.selfVisibility;out.contactShadow[i]=r.contactVisibility;out.darkBloom[i]=r.darkBloomVisibility;out.materialAO[i]=r.materialAOVisibility;out.gtao[i]=r.gtaoVisibility;out.macro[i]=r.macroVisibility;out.local[i]=r.localVisibility;
    }
    return out;
  }

  function visibilityMetrics(values){
    const a=Array.from(values||[]);if(!a.length)return{min:1,max:1,mean:1,belowTenPercent:0,belowTwentyPercent:0};let min=Infinity,max=-Infinity,sum=0,b10=0,b20=0;
    for(const raw of a){const v=clamp(finite(raw,1),0,1);min=Math.min(min,v);max=Math.max(max,v);sum+=v;if(v<.1)b10++;if(v<.2)b20++;}
    return{min,max,mean:sum/a.length,belowTenPercent:b10,belowTwentyPercent:b20};
  }

  const COMPOSE_WGSL=`
struct Params { extent:vec4<u32>, floors:vec4<f32>, weights:vec4<f32>, strengths:vec4<f32> };
@group(0) @binding(0) var dsoTex:texture_2d<f32>;
@group(0) @binding(1) var selfTex:texture_2d<f32>;
@group(0) @binding(2) var contactTex:texture_2d<f32>;
@group(0) @binding(3) var bloomTex:texture_2d<f32>;
@group(0) @binding(4) var materialTex:texture_2d<f32>;
@group(0) @binding(5) var gtaoTex:texture_2d<f32>;
@group(0) @binding(6) var<uniform> params:Params;
@group(0) @binding(7) var visibilityOut:texture_storage_2d<rgba16float,write>;
@group(0) @binding(8) var debugOut:texture_storage_2d<r32float,write>;
fn on(bit:u32)->bool{return (params.extent.w&bit)!=0u;}
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3<u32>){
  if(gid.x>=params.extent.x||gid.y>=params.extent.y){return;}let p=vec2<i32>(gid.xy);
  let dsoOcc=select(0.0,clamp(textureLoad(dsoTex,p,0).x,0.0,1.0),on(1u));let dsoVis=1.0-dsoOcc;
  let selfVis=select(1.0,clamp(textureLoad(selfTex,p,0).x,0.0,1.0),on(2u));
  let contactVis=select(1.0,clamp(textureLoad(contactTex,p,0).x,0.0,1.0),on(4u));
  let bloomOcc=select(0.0,clamp(textureLoad(bloomTex,p,0).x,0.0,params.weights.z),on(8u));let bloomVis=1.0-bloomOcc;
  let materialRaw=clamp(textureLoad(materialTex,p,0).z,0.0,1.0);let materialVis=select(1.0,1.0-(1.0-materialRaw)*params.strengths.x,on(16u));
  let gtaoRaw=clamp(textureLoad(gtaoTex,p,0).x,0.0,1.0);let gtaoVis=select(1.0,1.0-(1.0-gtaoRaw)*params.strengths.y,on(32u));
  let macroVis=min(dsoVis,bloomVis);let localVis=min(selfVis,contactVis);let directVis=min(macroVis,localVis);let ambientVis=max(params.floors.y,min(materialVis,gtaoVis));
  let weighted=clamp(directVis*params.weights.x+ambientVis*params.weights.y,0.0,1.0);let floorValue=select(params.floors.z,params.floors.w,dsoOcc>0.5);let combined=max(floorValue,weighted);
  var debugValue=combined;let mode=params.extent.z;
  if(mode==1u){debugValue=directVis;}else if(mode==2u){debugValue=ambientVis;}else if(mode==3u){debugValue=dsoVis;}else if(mode==4u){debugValue=selfVis;}else if(mode==5u){debugValue=contactVis;}else if(mode==6u){debugValue=bloomVis;}else if(mode==7u){debugValue=materialVis;}else if(mode==8u){debugValue=gtaoVis;}else if(mode==9u){debugValue=macroVis;}else if(mode==10u){debugValue=localVis;}
  textureStore(visibilityOut,p,vec4<f32>(combined,directVis,ambientVis,dsoVis));textureStore(debugOut,p,vec4<f32>(debugValue,0.0,0.0,1.0));
}`;

  function parameterBytes(width,height,options={}){
    const o=normalizeOptions(options),data=new ArrayBuffer(64),u=new Uint32Array(data),f=new Float32Array(data);u[0]=Math.max(1,Math.round(width));u[1]=Math.max(1,Math.round(height));u[2]=Math.max(0,DEBUG_MODES.indexOf(o.debugMode));u[3]=enabledFlags(o);
    f[4]=0;f[5]=o.ambientFloor;f[6]=o.combinedFloor;f[7]=o.hardCoreFloor;f[8]=o.directWeight;f[9]=o.ambientWeight;f[10]=o.bloomMax;f[11]=0;f[12]=o.materialAOStrength;f[13]=o.gtaoStrength;return new Uint8Array(data);
  }

  function halfToFloat(h){h=Number(h)&0xffff;const s=(h>>15)&1,e=(h>>10)&31,f=h&1023;if(e===0)return(s?-1:1)*Math.pow(2,-14)*(f/1024);if(e===31)return f?NaN:(s?-Infinity:Infinity);return(s?-1:1)*Math.pow(2,e-15)*(1+f/1024);}

  class WebGPUVisibilityComposition{
    constructor(options={}){
      if(!Resources)throw new Error('SteelMothWebGPUResources is required before WebGPUVisibilityComposition');if(!options.device)throw new Error('WebGPUVisibilityComposition requires GPUDevice');
      this.device=options.device;this.queue=options.queue||options.device.queue;this.options={...DEFAULTS,...options};this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));this.registry=null;this.pipelineCache=null;this.pipeline=null;this.snapshot=null;this.valid=false;this.closed=false;this.generation=0;this.updateCount=0;this.dispatchCount=0;this.invalidationCount=0;this.lastInvalidationReason='uninitialized';this.configure(this.width,this.height);
    }
    _name(name){return`sm307:${name}`;}
    configure(width,height){
      if(this.closed)throw new Error('WebGPUVisibilityComposition is closed');width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));if(this.registry&&width===this.width&&height===this.height)return false;if(this.registry)this.registry.close();if(this.pipelineCache)this.pipelineCache.clear();this.width=width;this.height=height;
      this.registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width,height,labelPrefix:'SteelMothVisibility'});this.pipelineCache=this.pipelineCache||new Resources.PipelineCache(this.device,{labelPrefix:'SteelMothVisibility'});const usage=textureUsage(['TEXTURE_BINDING','STORAGE_BINDING','COPY_SRC']);this.registry.defineTexture(this._name('visibility'),{format:OUTPUT_FORMAT,usage,size:'surface'});this.registry.defineTexture(this._name('debug'),{format:DEBUG_FORMAT,usage,size:'surface'});this.registry.defineBuffer(this._name('params'),{size:64,usage:bufferUsage(['UNIFORM','COPY_DST'])});this.pipeline=null;this.generation++;this.invalidate('configure');return true;
    }
    resize(width,height){return this.configure(width,height);}
    resetDevice(device,queue=device?.queue){if(!device)throw new Error('resetDevice requires GPUDevice');this.device=device;this.queue=queue||device.queue;if(this.registry)this.registry.close();this.registry=null;if(this.pipelineCache)this.pipelineCache.resetDevice(device);this.pipeline=null;this.generation++;this.configure(this.width,this.height);this.invalidate('device-reset');return this.generation;}
    invalidate(reason='explicit'){this.valid=false;this.snapshot=null;this.invalidationCount++;this.lastInvalidationReason=String(reason||'explicit');return this.invalidationCount;}
    async _pipeline(){if(this.pipeline)return this.pipeline;this.pipeline=await this.pipelineCache.getCompute('visibility-compose-v1',async(device,label)=>{const module=device.createShaderModule({label:`${label}:wgsl`,code:COMPOSE_WGSL});if(typeof module.getCompilationInfo==='function'){const info=await module.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error(`SM-307 visibility WGSL compilation failed: ${errors.map(e=>e.message).join('; ')}`);}return device.createComputePipeline({label,layout:'auto',compute:{module,entryPoint:'cs_main'}});});return this.pipeline;}
    sourceFromPaths(gbuffer,localShadows,dsoHierarchy,darkBloomTemporal,gtao=null){
      const g=typeof gbuffer?._views==='function'?gbuffer._views():null;if(!g?.g2)throw new Error('sourceFromPaths requires SM-200/202 G-buffer g2 view');if(typeof localShadows?.selfTexture!=='function'||typeof localShadows?.contactVisibilityTexture!=='function')throw new Error('sourceFromPaths requires SM-205 WebGPULocalShadows');if(typeof dsoHierarchy?.bindings!=='function')throw new Error('sourceFromPaths requires SM-304 WebGPUDSOHierarchy');if(typeof darkBloomTemporal?.bindings!=='function')throw new Error('sourceFromPaths requires SM-306 WebGPUDarkBloomTemporal');
      let gtaoVisibilityView=null;if(gtao){if(typeof gtao?.bindings==='function'){const b=gtao.bindings();gtaoVisibilityView=b.visibility||b.gtaoVisibility||null;}else gtaoVisibilityView=gtao;}
      return{materialView:g.g2,selfVisibilityView:localShadows.selfTexture().createView(),contactVisibilityView:localShadows.contactVisibilityTexture().createView(),dsoMaskView:dsoHierarchy.bindings().mask,darkBloomView:darkBloomTemporal.bindings().residual,gtaoVisibilityView,width:dsoHierarchy.width||this.width,height:dsoHierarchy.height||this.height};
    }
    async update(source={},options={}){
      const width=Math.max(1,Math.round(source.width||this.width)),height=Math.max(1,Math.round(source.height||this.height));if(width!==this.width||height!==this.height)this.configure(width,height);for(const key of ['dsoMaskView','selfVisibilityView','contactVisibilityView','darkBloomView','materialView'])if(!source[key])throw new Error(`SM-307 update requires ${key}`);
      const cfg=normalizeOptions({...this.options,...options});if(cfg.gtao&&!source.gtaoVisibilityView)throw new Error('SM-307 GTAO is enabled but reserved gtaoVisibilityView was not supplied');const gtaoView=source.gtaoVisibilityView||source.selfVisibilityView;
      this.queue.writeBuffer(this.registry.require(this._name('params')).handle,0,parameterBytes(width,height,cfg));const pipeline=await this._pipeline(),visibility=this.registry.require(this._name('visibility')).handle.createView(),debug=this.registry.require(this._name('debug')).handle.createView();
      const bind=this.device.createBindGroup({label:'SteelMothVisibility:bind',layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source.dsoMaskView},{binding:1,resource:source.selfVisibilityView},{binding:2,resource:source.contactVisibilityView},{binding:3,resource:source.darkBloomView},{binding:4,resource:source.materialView},{binding:5,resource:gtaoView},{binding:6,resource:{buffer:this.registry.require(this._name('params')).handle}},{binding:7,resource:visibility},{binding:8,resource:debug}]});
      const encoder=this.device.createCommandEncoder({label:'SteelMothVisibility:encoder'}),pass=encoder.beginComputePass({label:'SteelMothVisibility:compose'});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));pass.end();this.queue.submit([encoder.finish()]);if(typeof this.queue.onSubmittedWorkDone==='function'&&options.wait!==false)await this.queue.onSubmittedWorkDone();
      this.valid=true;this.lastInvalidationReason='';this.updateCount++;this.dispatchCount++;this.snapshot={schema:SNAPSHOT_SCHEMA,width,height,options:cfg,flags:enabledFlags(cfg),debugMode:cfg.debugMode,channels:{r:'combined visibility envelope',g:'direct shadow visibility',b:'ambient/AO visibility',a:'DSO macro visibility'},composition:'overlapping evidence uses min/strongest-occluder semantics, then direct/ambient weighted envelope; no independent term multiplication',gtaoInterface:{...GTAO_INTERFACE}};return this.diagnostics();
    }
    _record(name){if(!this.valid)throw new Error(`SM-307 visibility is invalid: ${this.lastInvalidationReason}`);return this.registry.require(this._name(name));}
    bindings(){return{visibility:this._record('visibility').handle.createView(),debug:this._record('debug').handle.createView(),format:OUTPUT_FORMAT,debugFormat:DEBUG_FORMAT,channels:{r:'combined',g:'direct',b:'ambient',a:'dso'},gtaoInterface:{...GTAO_INTERFACE},generation:this.generation};}
    async readback(){const record=this._record('visibility'),w=this.width,h=this.height,rowBytes=w*8,bytesPerRow=align(rowBytes,256),map=this.device.createBuffer({label:'SteelMothVisibility:readback',size:bytesPerRow*h,usage:bufferUsage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder({label:'SteelMothVisibility:readback-encoder'});encoder.copyTextureToBuffer({texture:record.handle},{buffer:map,bytesPerRow,rowsPerImage:h},{width:w,height:h,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);await map.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(map.getMappedRange()),out=new Float32Array(w*h*4);for(let y=0;y<h;y++){const row=new DataView(raw.buffer,raw.byteOffset+y*bytesPerRow,rowBytes);for(let x=0;x<w;x++)for(let c=0;c<4;c++)out[(y*w+x)*4+c]=halfToFloat(row.getUint16(x*8+c*2,true));}map.unmap();map.destroy?.();return out;}
    async readbackDebug(){const record=this._record('debug'),w=this.width,h=this.height,rowBytes=w*4,bytesPerRow=align(rowBytes,256),map=this.device.createBuffer({label:'SteelMothVisibility:debug-readback',size:bytesPerRow*h,usage:bufferUsage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:record.handle},{buffer:map,bytesPerRow,rowsPerImage:h},{width:w,height:h,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);await map.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(map.getMappedRange()),out=new Float32Array(w*h);for(let y=0;y<h;y++){const row=new DataView(raw.buffer,raw.byteOffset+y*bytesPerRow,rowBytes);for(let x=0;x<w;x++)out[y*w+x]=row.getFloat32(x*4,true);}map.unmap();map.destroy?.();return out;}
    debugOverlay(){if(!this.valid)throw new Error(`SM-307 visibility is invalid: ${this.lastInvalidationReason}`);return{schema:SCHEMA,debugModes:[...DEBUG_MODES],active:this.snapshot.debugMode,formula:'direct=min(DSO, Dark Bloom, self, contact); ambient=max(ambient floor, min(material AO, reserved GTAO)); combined=max(dense-scene floor, directWeight*direct + ambientWeight*ambient). Hard DSO zeroes direct but does not erase ambient readability.',gtaoInterface:{...GTAO_INTERFACE},scopeBoundary:'SM-307 consumes existing masks only. It does not generate GTAO or any new occlusion field and does not mutate upstream mask semantics.'};}
    diagnostics(){return{schema:SCHEMA,valid:this.valid,generation:this.generation,updateCount:this.updateCount,dispatchCount:this.dispatchCount,invalidationCount:this.invalidationCount,lastInvalidationReason:this.lastInvalidationReason,extent:{width:this.width,height:this.height},snapshot:this.snapshot?JSON.parse(JSON.stringify(this.snapshot)):null,debugModes:[...DEBUG_MODES],gtaoInterface:{...GTAO_INTERFACE},resourceDiagnostics:this.registry?.diagnostics?.()||null,pipelineDiagnostics:this.pipelineCache?.diagnostics?.()||null};}
    close(){if(this.registry)this.registry.close();if(this.pipelineCache)this.pipelineCache.clear();this.registry=null;this.pipelineCache=null;this.pipeline=null;this.snapshot=null;this.valid=false;this.closed=true;}
  }

  return{SCHEMA,SNAPSHOT_SCHEMA,OUTPUT_FORMAT,DEBUG_FORMAT,DEBUG_MODES,FLAGS,DEFAULTS,GTAO_INTERFACE,COMPOSE_WGSL,normalizeOptions,enabledFlags,composeSample,composeFields,debugValue,visibilityMetrics,parameterBytes,halfToFloat,WebGPUVisibilityComposition};
});