'use strict';

(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const Validity=root?.SteelMothWebGPUGTAOStabilization||(node?require('./webgpu_gtao_stabilization.js'):null);
  const Ownership=root?.SteelMothWebGPUOwnership||(node?require('./webgpu_ownership.js'):null);
  const PseudoDepth=root?.SteelMothPseudoDepth||(node?require('./pseudo_depth.js'):null);
  const Lighting=root?.SteelMothWebGPULighting||(node?require('./webgpu_lighting.js'):null);
  const api=factory(Validity,Ownership,PseudoDepth,Lighting,root);
  if(node)module.exports=api;
  if(root)root.SteelMothWebGPUForwardLighting=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Validity,Ownership,PseudoDepth,Lighting,root){
  if(!Validity?.PIXEL_VALIDITY_WGSL||!Ownership?.PSEUDO_DEPTH_WGSL||!PseudoDepth||!Lighting)throw new Error('SM-702 requires canonical SM-601 validity, SM-202 ownership and SM-204 lights');
  const SCHEMA='steelmoth-webgpu-forward-lighting/v1';
  const PARAM_BYTES=48;
  const DEFAULTS=Object.freeze({advancedLighting:false,indirectWeight:1,energyMax:.08,depthThreshold:.012,normalThreshold:.84});
  const REJECTION=Object.freeze({accepted:0,depth:1,object:2,normal:3});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const viewCache=new WeakMap();
  function normalizeOptions(raw={}){return{advancedLighting:raw.advancedLighting===true,indirectWeight:clamp(finite(raw.indirectWeight,DEFAULTS.indirectWeight),0,1),energyMax:clamp(finite(raw.energyMax,DEFAULTS.energyMax),0,.08),depthThreshold:clamp(finite(raw.depthThreshold,DEFAULTS.depthThreshold),0,.012),normalThreshold:clamp(finite(raw.normalThreshold,DEFAULTS.normalThreshold),.84,1)};}
  function normalizeSurface(raw){
    if(!raw)return null;
    if(!Number.isFinite(Number(raw.worldZ)))throw new Error('SM-702 surface requires explicit finite worldZ');
    const category=String(raw.category||'dynamic'),layer=PseudoDepth.layerFor(category,raw.layer);
    if(!Number.isFinite(layer)||layer< -1||layer>2)throw new RangeError('SM-702 surface layer must remain in canonical ground/static/foreground/top lanes');
    if(raw.layer!=null&&!Number.isFinite(Number(raw.layer)))throw new Error('SM-702 explicit surface layer must be finite');if(raw.bias!=null&&!Number.isFinite(Number(raw.bias)))throw new Error('SM-702 explicit surface bias must be finite');const bias=finite(raw.bias,0);if(Math.abs(bias)>=PseudoDepth.LAYER_STRIDE/2)throw new RangeError('SM-702 surface bias must remain a fine bias below half a lane');
    const worldZ=clamp(Number(raw.worldZ),0,PseudoDepth.MAX_WORLD_Z);
    return{worldZ,localHeight:worldZ/PseudoDepth.MAX_WORLD_Z,category,layer,bias};
  }
  function surfaceVisible(fragmentScreenY,opaqueDepth,surface){const s=normalizeSurface(surface);return!s||PseudoDepth.projectFragment({fragmentScreenY,localHeight:s.localHeight,layer:s.layer,bias:s.bias}).depth01<=opaqueDepth+1e-7;}
  function supportReason(native={},representative={},options={}){
    const cfg=normalizeOptions(options);if(!native.object||!representative.object)return REJECTION.object;
    const d=finite(native.depth,1),pd=finite(representative.depth,1);
    return Validity.pixelDiscontinuity([d,d],[pd,pd],native.object,representative.object,Validity.decodeNormal(native.normal||[.5,.5,1]),Validity.decodeNormal(representative.normal||[.5,.5,1]),cfg).code;
  }
  function diffuseReference(incident,ownDiffuse,ambient=1,options={},reason=0){const cfg=normalizeOptions(options);return[0,1,2].map(i=>cfg.advancedLighting&&reason===0?clamp(finite(incident?.[i],0),0,cfg.energyMax)*clamp(finite(ownDiffuse?.[i],0),0,1)*clamp(finite(ambient,1),0,1)*cfg.indirectWeight:0);}
  function generation(p){return p?.generation??p?.resourceGeneration??p?.registry?.generation??0;}
  function resourceStamp(p){const r=p?.registry;return[p,generation(p),p?.device,p?.width,p?.height,r,r?.generation??0,r?.resizeCount??0,r?.createCount??0,r?.destroyCount??0,r?.rebuildCount??0,r?.resources?.size??null];}
  function stamp(p){return[...resourceStamp(p),p?.updateCount??p?.renderCount??p?.buildCount??0,p?.invalidationCount??0];}
  function producers(paths){return[paths.lighting,paths.gbuffer,paths.hierarchy,paths.visibility,...(paths.ssgi?[paths.ssgi]:[])];}
  function cachedViews(producer,create,handles=[]){const key=[...resourceStamp(producer),...handles],old=viewCache.get(producer);if(old&&old.key.length===key.length&&old.key.every((v,i)=>v===key[i]))return old.views;const views=create();viewCache.set(producer,{key,views});return views;}
  function knownDestroyed(handle){return handle?.destroyed===true||(typeof handle?.destroyed==='number'&&handle.destroyed>0);}
  function canonicalRecords(paths){
    const records=[];
    const add=(owner,label,resolve)=>{const record=resolve();if(!record?.handle||knownDestroyed(record.handle))throw new Error(`SM-702 ${label} canonical resource is closed or destroyed`);records.push({owner,label,resolve,handle:record.handle});};
    add(paths.lighting,'light buffer',()=>paths.lighting.registry.require(Lighting.LIGHT_BUFFER_NAME));
    if(typeof paths.lighting.outputTexture==='function')add(paths.lighting,'opaque lighting',()=>({handle:paths.lighting.outputTexture()}));
    if(typeof paths.gbuffer._record==='function')for(const name of ['depth','object','g1'])add(paths.gbuffer,`ownership ${name}`,()=>paths.gbuffer._record(name));
    if(typeof paths.visibility._record==='function')add(paths.visibility,'visibility',()=>paths.visibility._record('visibility'));
    if(typeof paths.hierarchy._requireLevel==='function')add(paths.hierarchy,'shared hierarchy',()=>paths.hierarchy._requireLevel(0).record);
    if(paths.ssgi?.registry?.require&&typeof paths.ssgi._name==='function'){add(paths.ssgi,'incident SSGI',()=>paths.ssgi.registry.require(paths.ssgi._name(`indirect${paths.ssgi.historyIndex}`)));add(paths.ssgi,'composed SSGI',()=>paths.ssgi.registry.require(paths.ssgi._name('composed')));}
    return records;
  }
  function requireProducer(p,name,width,height,device,needsValid=false){
    if(!p||typeof p!=='object')throw new Error(`SM-702 requires canonical ${name} producer`);
    if(needsValid&&p.valid!==true)throw new Error(`SM-702 ${name} producer is stale or invalid`);
    if(p.closed||p.deviceLost)throw new Error(`SM-702 ${name} producer is closed or lost`);
    if(p._updating===true)throw new Error(`SM-702 ${name} producer update is still in flight; await upstream work`);
    if(p.registry?.resources instanceof Map&&p.registry.resources.size===0)throw new Error(`SM-702 ${name} resource registry is closed`);
    if(p.device&&device&&p.device!==device)throw new Error(`SM-702 ${name} device mismatch`);
    if(p.width!==width||p.height!==height)throw new Error(`SM-702 ${name} extent mismatch`);
  }
  function sourceFromPaths(paths={}){
    const {lighting,gbuffer,hierarchy,visibility,ssgi=null}=paths;
    if(!gbuffer||typeof gbuffer._views!=='function'||!lighting?.registry?.require||typeof hierarchy?.levelView!=='function'||typeof visibility?.bindings!=='function')throw new Error('SM-702 sourceFromPaths requires canonical light, ownership, hierarchy and visibility producers');
    const borrowed={lighting,gbuffer,hierarchy,visibility,ssgi,opaqueResolvedView:paths.opaqueResolvedView||null};
    // A raw scene view cannot reveal its owner/device/extent. Keep it scoped to
    // the factory's resource lifetime and require a new factory after rebuilding.
    const source={_forward:{paths:borrowed,rawSceneLifetime:borrowed.opaqueResolvedView?producers(borrowed).map(resourceStamp):null},width:gbuffer.width,height:gbuffer.height};
    const capture=refreshSource(source,{device:gbuffer.device});
    if(borrowed.opaqueResolvedView)source._forward.rawSceneRecords=capture._fresh.records.filter(r=>r.label!=='incident SSGI');
    return capture;
  }
  // Refresh after upstream updates, then hold this capture through encoding/submission.
  // SSGI flips its history view each update, whereas generation only tracks resources.
  function refreshSource(source,{device=null,width=source?.width,height=source?.height}={}){
    const paths=source?._forward?.paths;if(!paths)throw new Error('SM-702 advanced inputs require sourceFromPaths provenance');
    const {lighting,gbuffer,hierarchy,visibility,ssgi,opaqueResolvedView}=paths;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('SM-702 invalid native extent');
    for(const [p,n,valid]of [[lighting,'SM-204 lights',false],[gbuffer,'SM-202 ownership',false],[hierarchy,'SM-203 hierarchy',true],[visibility,'SM-307 visibility',true]])requireProducer(p,n,width,height,device,valid);
    if(ssgi)requireProducer(ssgi,'SM-603 incident SSGI',width,height,device,true);
    for(const before of source._forward.rawSceneLifetime||[]){const now=resourceStamp(before[0]);if(now.some((v,i)=>v!==before[i]))throw new Error('SM-702 raw opaque resolved view resource lifetime changed; rebuild sourceFromPaths with the current view');}
    for(const before of source._forward.rawSceneRecords||[]){const now=before.resolve();if(now?.handle!==before.handle||knownDestroyed(now?.handle))throw new Error('SM-702 raw opaque resolved view canonical resource changed or was destroyed; rebuild sourceFromPaths');}
    const records=canonicalRecords(paths);
    const handles=p=>records.filter(r=>r.owner===p).map(r=>r.handle);
    const g=cachedViews(gbuffer,()=>gbuffer._views(),handles(gbuffer)),v=cachedViews(visibility,()=>visibility.bindings(),handles(visibility));
    if(!g.depth||!g.objectId||!g.g1||!v.visibility)throw new Error('SM-702 canonical depth/object/normal/visibility views missing');
    const b=ssgi?ssgi.bindings():null,qw=Math.ceil(width/4),qh=Math.ceil(height/4);
    if(b&&(!b.indirectQuarter||b.quarterWidth!==qw||b.quarterHeight!==qh))throw new Error('SM-702 SSGI quarter incident extent mismatch');
    const lightBuffer=lighting.registry.require(Lighting.LIGHT_BUFFER_NAME).handle;
    if(!lightBuffer)throw new Error('SM-702 canonical light buffer missing');
    const sceneView=opaqueResolvedView||(typeof lighting.outputTexture==='function'?cachedViews(lighting,()=>({scene:lighting.outputTexture().createView()}),handles(lighting)).scene:null);
    const capture={...source,width,height,quarterWidth:qw,quarterHeight:qh,sceneView,lightBuffer,lightCount:Math.min(Lighting.MAX_LIGHTS||17,Math.max(0,lighting.activeLightCount??lighting.lastLights?.length??0)),depthView:g.depth,normalView:g.g1,objectView:g.objectId,visibilityView:v.visibility,incidentView:b?.indirectQuarter||null};
    capture._fresh={stamps:producers(paths).map(stamp),records,ssgi,incidentView:capture.incidentView,device};
    return capture;
  }
  function assertFresh(source){
    if(!source?._fresh)throw new Error('SM-702 source has no freshness capture');
    for(const before of source._fresh.stamps){const p=before[0],now=stamp(p);if(p.closed||p.deviceLost||p._updating===true||p.valid===false||now.some((v,i)=>v!==before[i]))throw new Error('SM-702 borrowed producer changed or became stale during forward work');}
    for(const before of source._fresh.records){const record=before.resolve();if(record?.handle!==before.handle||knownDestroyed(record?.handle))throw new Error(`SM-702 ${before.label} canonical resource changed or was destroyed`);}
    if(source._fresh.ssgi&&source._fresh.ssgi.bindings().indirectQuarter!==source._fresh.incidentView)throw new Error('SM-702 incident SSGI history view changed during forward work');
    return true;
  }
  const HELPER_WGSL=`
${Validity.PIXEL_VALIDITY_WGSL}
${Ownership.PSEUDO_DEPTH_WGSL}
fn smForwardNormal(e:vec3f)->vec3f{let n=e*2.0-vec3f(1);let l=length(n);return select(vec3f(0,0,1),n/max(l,.000001),l>.000001);}
fn smForwardSupportReason(p0:vec2i,depth:texture_depth_2d,object:texture_2d<u32>,normal:texture_2d<f32>,nativeSize:vec2u,thresholds:vec2f)->u32{
  let p=clamp(p0,vec2i(0),vec2i(nativeSize)-vec2i(1));let c=min((p/vec2i(4))*vec2i(4)+vec2i(2),vec2i(nativeSize)-vec2i(1));
  let o=textureLoad(object,p,0).r;let po=textureLoad(object,c,0).r;if(o==0u||po==0u){return 2u;}
  let d=textureLoad(depth,p,0);let pd=textureLoad(depth,c,0);let n=smForwardNormal(textureLoad(normal,p,0).rgb);let pn=smForwardNormal(textureLoad(normal,c,0).rgb);
  return smTemporalRejectReason(vec2f(d),vec2f(pd),o,po,n,pn,thresholds.x,thresholds.y);
}
fn smForwardIncident(p:vec2i,incident:texture_2d<f32>,depth:texture_depth_2d,object:texture_2d<u32>,normal:texture_2d<f32>,nativeSize:vec2u,policy:vec4f)->vec3f{
  if(smForwardSupportReason(p,depth,object,normal,nativeSize,policy.zw)!=0u){return vec3f(0);}
  let q=clamp(p/vec2i(4),vec2i(0),vec2i(textureDimensions(incident))-vec2i(1));let raw=textureLoad(incident,q,0).rgb;
  // Non-finite/negative input cannot become radiance. Bound each channel before response.
  let positive=select(vec3f(0),raw,raw>=vec3f(0));let clean=select(vec3f(0),positive,positive<=vec3f(65504));return clamp(clean,vec3f(0),vec3f(policy.y));
}
fn smForwardDiffuse(p:vec2i,ownDiffuse:vec3f,incident:texture_2d<f32>,depth:texture_depth_2d,object:texture_2d<u32>,normal:texture_2d<f32>,visibility:texture_2d<f32>,nativeSize:vec2u,policy:vec4f)->vec3f{
  let e=smForwardIncident(p,incident,depth,object,normal,nativeSize,policy);let ambient=clamp(textureLoad(visibility,p,0).b,0.0,1.0);
  return e*clamp(ownDiffuse,vec3f(0),vec3f(1))*ambient*policy.x;
}
fn smForwardSurfaceVisible(fragmentScreenY:f32,localHeight:f32,layer:f32,bias:f32,opaqueDepth:f32)->bool{return smOwnershipDepth(fragmentScreenY,localHeight,layer,bias)<=opaqueDepth+.0000001;}
`;
  function bindingWGSL(group=1){return`${HELPER_WGSL}
struct SMForwardParams { extent:vec4u,policy:vec4f,surface:vec4f };
@group(${group}) @binding(0) var smForwardDepth:texture_depth_2d;
@group(${group}) @binding(1) var smForwardObject:texture_2d<u32>;
@group(${group}) @binding(2) var smForwardNormals:texture_2d<f32>;
@group(${group}) @binding(3) var smForwardIndirect:texture_2d<f32>;
@group(${group}) @binding(4) var smForwardVisibility:texture_2d<f32>;
@group(${group}) @binding(5) var<uniform> smForwardParams:SMForwardParams;
fn smForwardBoundDiffuse(p:vec2i,ownDiffuse:vec3f)->vec3f{return smForwardDiffuse(p,ownDiffuse,smForwardIndirect,smForwardDepth,smForwardObject,smForwardNormals,smForwardVisibility,smForwardParams.extent.xy,smForwardParams.policy);}
fn smForwardBoundReason(p:vec2i)->u32{return smForwardSupportReason(p,smForwardDepth,smForwardObject,smForwardNormals,smForwardParams.extent.xy,smForwardParams.policy.zw);}
`;
  }
  function parameterBytes(source,options={},surface=null){const cfg=normalizeOptions(options),s=normalizeSurface(surface),buffer=new ArrayBuffer(PARAM_BYTES),u=new Uint32Array(buffer),f=new Float32Array(buffer);u.set([source.width,source.height,source.quarterWidth,source.quarterHeight]);f.set([cfg.advancedLighting?cfg.indirectWeight:0,cfg.energyMax,cfg.depthThreshold,cfg.normalThreshold],4);f.set(s?[s.localHeight,s.layer,s.bias,1]:[0,0,0,0],8);return new Uint8Array(buffer);}
  class BindingOwner{
    constructor(device){this.device=device;this.closed=false;this.groups=[];this.groupCreationCount=0;this.uniform=device.createBuffer({label:'SM702 forward params',size:PARAM_BYTES,usage:Number(root?.GPUBufferUsage?.UNIFORM??64)|Number(root?.GPUBufferUsage?.COPY_DST??8)});this.neutral=device.createTexture({label:'SM702 neutral incident',size:[1,1],format:'rgba16float',usage:Number(root?.GPUTextureUsage?.TEXTURE_BINDING??4)|Number(root?.GPUTextureUsage?.COPY_DST??2)});device.queue.writeTexture({texture:this.neutral},new Uint8Array(8),{bytesPerRow:8},[1,1]);this.neutralView=this.neutral.createView();}
    cachedGroup(layout,entries){const resources=entries.map(e=>e.resource?.buffer||e.resource),old=this.groups.find(g=>g.layout===layout&&g.resources.length===resources.length&&g.resources.every((r,i)=>r===resources[i]));if(old)return old.group;const group=this.device.createBindGroup({layout,entries});this.groupCreationCount++;this.groups.push({layout,resources,group});if(this.groups.length>6)this.groups.shift();return group;}
    bind(layout,source,options={},surface=null){if(this.closed)throw new Error('SM-702 bindings are closed');assertFresh(source);this.device.queue.writeBuffer(this.uniform,0,parameterBytes(source,options,surface));return this.cachedGroup(layout,[{binding:0,resource:source.depthView},{binding:1,resource:source.objectView},{binding:2,resource:source.normalView},{binding:3,resource:source.incidentView||this.neutralView},{binding:4,resource:source.visibilityView},{binding:5,resource:{buffer:this.uniform}}]);}
    diagnostics(){return{parameterBytes:PARAM_BYTES,neutralIncidentBytes:8,estimatedBytes:PARAM_BYTES+8,textureCount:1,bufferCount:1,cachedBindGroups:this.groups.length,maxCachedBindGroups:6,groupCreationCount:this.groupCreationCount,resources:[{name:'sm702:forwardParams',kind:'buffer',lifetime:'persistent',size:PARAM_BYTES,estimatedBytes:PARAM_BYTES},{name:'sm702:neutralIncident',kind:'texture',lifetime:'persistent',width:1,height:1,depthOrArrayLayers:1,format:'rgba16float',estimatedBytes:8}]};}
    close(){if(this.closed)return;this.closed=true;this.groups=[];this.uniform.destroy?.();this.neutral.destroy?.();}
  }
  return{SCHEMA,PARAM_BYTES,DEFAULTS,REJECTION,normalizeOptions,normalizeSurface,surfaceVisible,supportReason,diffuseReference,sourceFromPaths,refreshSource,assertFresh,HELPER_WGSL,bindingWGSL,parameterBytes,BindingOwner};
});
