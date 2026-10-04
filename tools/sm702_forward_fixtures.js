'use strict';
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SteelMothSM702Fixtures=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  const Ownership=root?.SteelMothWebGPUOwnership||(typeof module==='object'&&module.exports?require('../engine/webgpu_ownership.js'):null);
  if(!Ownership?.PSEUDO_DEPTH_WGSL)throw new Error('SM702 fixture requires canonical ownership depth WGSL');
  const BASELINE_COMMIT='cb068323a7a93e6273d879126fe261f951d589f7';
  const BASELINES=Object.freeze({
    water:{path:'tools/experiments/sm702_water_baseline.js',sha256:'542b9a63da85c3e4577286d9beb6590312a95fe6e1bbcd5d1671c3d5e7c3f80d'},
    foliage:{path:'tools/experiments/sm702_foliage_baseline.js',sha256:'32f85778d29f780023572f7da894116a043ccd9f723c82eec9e1e9593c15343a'},
    transparent:{path:'tools/experiments/sm702_transparent_fx_baseline.js',sha256:'c32a7e75a2de7a6997568201cdb21ea16e4bd72bb5232ee97c51e3a65af242e7'}
  });
  const SETTINGS=Object.freeze({
    lighting:Object.freeze({lighting:true,ambient:.20,emissive:1,lightRadius:1,normalStrength:1,heightStrength:1,roughnessScale:1,metalnessScale:1,materialAOStrength:.62,pbrSpecularStrength:.70}),
    visibility:Object.freeze({dso:true,selfShadow:false,contactShadow:false,darkBloom:false,materialAO:true,gtao:true,materialAOStrength:1,gtaoStrength:1,ambientFloor:0}),
    gtao:Object.freeze({directions:6,steps:4,radius:24,intensity:1}),
    ssgi:Object.freeze({enabled:true,quality:'Medium'}),
    water:Object.freeze({waterQuality:3,waterStrength:1.2,waterWaveScale:1.3,waterWaveSpeed:.8,waterNormalStrength:1.45,waterDetailStrength:1.25,waterHighlightStrength:1.55,waterRefractionStrength:1.4,waterDepthReject:.004,indirectWeight:.6}),
    foliage:Object.freeze({lighting:true,ambient:.20,foliageQuality:3,foliageWindStrength:.78,foliageWindSpeed:.82,foliageShadingStrength:.9,foliageBendAmount:1,indirectWeight:.6}),
    caps:Object.freeze({ripples:12,foliage:208,transparent:640,lights:17,opaque:256})
  });
  const META=Object.freeze({roomId:'sm702-room-a',deviceGeneration:1,backendGeneration:1,cameraRevision:0,lightRevision:0});
  const align=(n,m=256)=>Math.ceil(n/m)*m,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const clone=x=>JSON.parse(JSON.stringify(x));
  const mean=a=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
  const percentile=(a,p=.95)=>a.length?[...a].sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)]:null;
  const maxDiff=(a,b)=>{if(a.length!==b.length)return Infinity;let m=0;for(let i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]-b[i]));return m;};
  const finiteBounded=(a,b=Infinity)=>a.every(x=>Number.isFinite(x)&&Math.abs(x)<=b);
  const extrema=(a,channel=null,stride=1)=>{let min=Infinity,max=-Infinity;for(let i=0;i<a.length;i++)if(channel===null||i%stride===channel){min=Math.min(min,a[i]);max=Math.max(max,a[i]);}return{min,max};};
  const surface=Object.freeze({worldZ:0,category:'dynamic',layer:0,bias:0});
  function sceneDescription(width=67,height=51,kind='representative',state={}){
    if(!['representative','stress'].includes(kind))throw new Error('unknown SM702 fixture scene');
    const scale=width/67,sy=height/51,px=n=>n*scale,py=n=>n*sy;
    const sprite=(id,name,x,y,w,h,z,category='dynamic')=>({id,atlas:'hd',spriteId:name,category,transform:{x,y,w,h,rotation:0,flip:false},root:{x,y:y+h*.5},depthLayer:0,depthBias:0,style:{alpha:1,tint:[1,1,1],materialMode:'normal'},fixtureWorldZ:z});
    const sprites=[sprite('sm702:floor','floor',width*.5,height*.5,width,height,0,'static')];
    const deleted=Number(state.deletedColumns||0),donorLeft=px(33+deleted);
    if(state.donor!==false&&donorLeft<px(49))sprites.push(sprite('sm702:donor','donor',(donorLeft+px(49))*.5,height*.5,px(49)-donorLeft,height,32,'static'));
    const ax=px(state.actorX??18),actor=sprite('sm702:actor',state.revealed?'blocker':'actor',ax,py(27),px(8),py(22),48);
    if(state.actor!==false)sprites.push(actor);
    if(kind==='stress')for(let i=0;i<32;i++){const x=(i%8+.5)*width/8,y=(Math.floor(i/8)+.5)*height/4;sprites.push(sprite('sm702:stress:'+i,i%2?'donor':'actor',x,y,width/28,height/10,i%2?32:48));}
    const lights=[],lightCount=kind==='stress'?SETTINGS.caps.lights:2,angle=Number(state.angle??45)*Math.PI/180,intensity=clamp(Number(state.intensity??1),0,8);
    for(let i=0;i<lightCount;i++){const a=angle+i*2*Math.PI/lightCount;lights.push({id:'light:sm702:'+i,type:'point',group:'sm702',x:px(30)+Math.cos(a)*px(22),y:py(24)+Math.sin(a)*py(20),z:40,radius:Math.max(width,height)*1.7,intensity:(i===0?2.4:.45)*intensity,color:i===0?[1,.95,.85]:[.3,.7,1]});}
    const occluders=sprites.filter(s=>s.fixtureWorldZ>0).map(s=>({id:s.id,objectIdBasis:s.id,kind:s.id.includes('actor')?'actor':'machine',source:s.spriteId,majorOccluder:true,rect:[s.transform.x-s.transform.w/2,s.transform.y-s.transform.h/2,s.transform.x+s.transform.w/2,s.transform.y+s.transform.h/2],root:s.root,zRange:[0,s.fixtureWorldZ],sections:[{z:s.fixtureWorldZ}],dynamic:s.category==='dynamic'}));
    const foliage=[],foliageCount=kind==='stress'?SETTINGS.caps.foliage:6;
    const categories=['SHORT_GRASS','FERN','BUSH','BROAD_LEAF','SHORT_GRASS','BUSH'];
    for(let i=0;i<foliageCount;i++){const category=categories[i%categories.length],x=kind==='stress'?(i%26+.5)*width/26:px([28,27,width>=640?32:30,width>=640?32:29,54,57][i]),rootY=kind==='stress'?(Math.floor(i/26)+1)*height/9:py([9,17,25,39,43,43][i]);foliage.push({index:i,id:'sm702:foliage:'+i,x,rootY,w:px(category==='SHORT_GRASS'?2:4),h:py(category==='SHORT_GRASS'?7:category==='FERN'?12:20),category,bendScale:.7,rootCutoff:.3,bendExponent:1.45,interactionScale:1,variation:.4,tintStrength:.07,flags:i%6===5?.9:.1,depthBias:0,frontBlend:i%6===5?.9:.1,fineGrass:category==='SHORT_GRASS'});}
    const transparent=[],count=kind==='stress'?SETTINGS.caps.transparent:5;
    for(let i=0;i<count;i++){const role=i%5===0?'clear':i%5===1?'frosted':null,category=i%5===4?'top':'dynamic',glow=i%5===2,x=kind==='stress'?(i%32+.5)*width/32:px([28,30,47,52,58][i]),y=kind==='stress'?(Math.floor(i/32)+.5)*height/20:py([8,16,20,29,43][i]);transparent.push({id:'sm702:transparent:'+i,atlas:'legacy',spriteId:'white',category,transform:{x,y,w:px(6),h:py(9),rotation:0,flip:false},depth01:clamp((3072-y-8)/5120,0,1),depthLayer:0,depthBias:0,style:{color:role?[.55,.8,.95]:[.4,.8,.5],alpha:role?.45:.6,glow,blend:glow?'additive':'alpha',forwardLighting:role?{material:role==='clear'?'clear-glass':'frosted-glass',colorSpace:'linear',diffuseWeight:role==='clear'?0:.6,worldZ:8,category,layer:0,bias:0}:undefined}});}
    const ripples=Array.from({length:kind==='stress'?SETTINGS.caps.ripples:2},(_,i)=>({x:width*(i+1)/(kind==='stress'?13:3),y:height*.55,normalizedAge:.25+i*.015,radius:Math.max(12,width*.35),amplitude:1.1,foam:.8}));
    return{frame:{roomId:state.roomId||META.roomId,logicalSize:[width,height],timeMs:Number(state.time??.4)*1000},sprites,materials:[],lights,occluders,foliage,transparent,ripples,overlays:{objectiveMarker:{x:px(60),y:py(8),color:[1,.8,.2],time:.4},guide:{x:px(60),y:py(16),color:[.2,.8,1],time:.4,visible:true}},metadata:{kind,width,height,pixelScale:width<640?1:width/640,synthetic:true,boundary:'Explicitly generated Material-v2 lab atlas and synthetic canonical scene. Direct pixels come from production SM204 shading; no uploaded fake resolved colour.'}};
  }
  function atlasData(){
    const width=80,height=64,n=width*height*4,albedo=new Uint8ClampedArray(n),nr=new Uint8ClampedArray(n),hm=new Uint8ClampedArray(n),regions={},names=['floor','donor','actor','blocker','white'];
    const colours=[[105,115,125],[255,75,20],[70,105,125],[5,7,9],[255,255,255]],zs=[0,32,48,48,0];
    for(let r=0;r<5;r++){regions[names[r]]=[r*16,0,16,64];for(let y=0;y<height;y++)for(let x=r*16;x<(r+1)*16;x++){let k=(y*width+x)*4;albedo.set([...colours[r],255],k);nr.set([128,128,255,190],k);hm.set([Math.round(zs[r]/64*255),204,0,0],k);}}
    return{width,height,albedo,nr,hm,meta:{source_size:[width,height],world_scale:1,regions,region_meta:{},fixture:'sm702-synthetic-material-v2'}};
  }
  // HM.A is emissive data, so zero alpha must not erase its unrelated RGB channels.
  // Avoid a premultiplied canvas intermediary and explicitly retain unassociated bytes.
  async function bitmap(bytes,width,height){return createImageBitmap(new ImageData(bytes,width,height),{premultiplyAlpha:'none',colorSpaceConversion:'none'});}
  async function readTexture(device,texture,width,height,format='rgba16float'){
    const bpp={rgba16float:8,rgba32float:16,r32float:4,r32uint:4,rg32float:8,rgba8unorm:4}[format];if(!bpp)throw new Error('unsupported fixture readback format');
    const row=width*bpp,pitch=align(row),buffer=device.createBuffer({size:pitch*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),enc=device.createCommandEncoder();enc.copyTextureToBuffer({texture},{buffer,bytesPerRow:pitch,rowsPerImage:height},[width,height]);device.queue.submit([enc.finish()]);await buffer.mapAsync(GPUMapMode.READ);const map=new Uint8Array(buffer.getMappedRange()),bytes=new Uint8Array(row*height);for(let y=0;y<height;y++)bytes.set(map.subarray(y*pitch,y*pitch+row),y*row);buffer.unmap();buffer.destroy();
    let data;if(format==='rgba16float'){const u=new Uint16Array(bytes.buffer);data=Float32Array.from(u,root.SteelMothWebGPUSSGI.halfToFloat);}else if(format==='r32uint')data=new Uint32Array(bytes.buffer);else if(format==='rgba8unorm')data=bytes;else data=new Float32Array(bytes.buffer);return{width,height,data};
  }
  async function createUpstream(device,{width=67,height=51,scene='representative'}={}){
    const O=root.SteelMothWebGPUOwnership,D=root.SteelMothWebGPUDepthHierarchy,L=root.SteelMothWebGPULighting,C=root.SteelMothWebGPUOccluders,K=root.SteelMothWebGPUClusters,N=root.SteelMothWebGPUDominance,H=root.SteelMothWebGPUDSO,J=root.SteelMothWebGPUDSOHierarchy,G=root.SteelMothWebGPUGTAO,T=root.SteelMothWebGPUGTAOReadback,V=root.SteelMothWebGPUVisibility,S=root.SteelMothWebGPUSSGI;
    const a=atlasData(),bitmaps=await Promise.all([bitmap(a.albedo,a.width,a.height),bitmap(a.nr,a.width,a.height),bitmap(a.hm,a.width,a.height)]);
    const gb=new O.WebGPUOwnershipGBuffer({device,width,height,maxInstances:SETTINGS.caps.opaque,labelPrefix:'SM702:ownership'});await gb.setAtlases({albedo:bitmaps[0],normalRoughness:bitmaps[1],heightMaterial:bitmaps[2],meta:a.meta});
    // These two generated test atlases contain data channels, including emissive A=0.
    // Upload their exact authored bytes into the real production atlas resources; an
    // image/canvas alpha conversion must not erase height or AO when emissive is zero.
    for(const [texture,bytes]of [[gb.atlas.normalRoughness,a.nr],[gb.atlas.heightMaterial,a.hm]])device.queue.writeTexture({texture},bytes,{bytesPerRow:a.width*4,rowsPerImage:a.height},[a.width,a.height]);
    const hierarchy=new D.WebGPUDepthHierarchy({device,width,height}),lighting=new L.WebGPUDeferredLighting({device,width,height,registry:gb.registry,pipelines:gb.pipelines,labelPrefix:'SM702:direct'}),bins=new C.WebGPUOccluderBins({device,width,height,maxOccluders:128,maxTileRefs:4096}),clusters=new K.WebGPUOccluderClusters({device,width,height,maxClusters:128,maxMembers:256}),dominance=new N.WebGPUDominantOccluders({device,maxDominanceRecords:256}),hard=new H.WebGPUDSOHardCore({device,width,height,maxJobs:256,maxMembers:512,maxTileRefs:4096}),dso=new J.WebGPUDSOHierarchy({device,width,height,maxJobs:256,maxMembers:512,maxTileRefs:4096}),gtao=new G.WebGPUGTAO({device,width,height}),temporal=new T.WebGPUGTAOTemporal({device,width,height,counterMode:'aggregated',statsMode:'deferred',statsSlots:3}),visibility=new V.WebGPUVisibilityComposition({device,width,height}),ssgi=new S.WebGPUSSGI({device,width,height});
    const neutral=(name,value)=>{const t=device.createTexture({label:name,size:[width,height],format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});device.queue.writeTexture({texture:t},new Float32Array(width*height).fill(value),{bytesPerRow:width*4},[width,height]);return t;},one=neutral('SM702:neutral-visibility',1),zero=neutral('SM702:neutral-bloom',0);
    let current=null;
    async function update(state={}){
      current=sceneDescription(width,height,scene,state);const instances=O.buildOwnershipSceneInstances(current,a.meta).map(x=>({...x,heightFactor:1}));
      await gb.renderInstances(instances,{wait:false});await hierarchy.buildFromOwnership(gb,{wait:false});await lighting.render(gb,current,SETTINGS.lighting,{wait:false});await bins.update(current,{wait:false});await clusters.update(bins,{wait:false});await dominance.update(clusters,bins,lighting.lastLights,{wait:false});await hard.update(clusters,bins,dominance,{wait:false,lightId:'light:sm702:0'});await dso.update(hard,{wait:false,quality:'Medium'});
      await gtao.update(gtao.sourceFromPaths(hierarchy,gb),{...SETTINGS.gtao,radius:24*(width<640?1:width/640),wait:false});const meta={...META,roomId:current.frame.roomId,...state.meta};await temporal.update(temporal.sourceFromPaths(gtao,hierarchy,gb),{quality:'Medium',wait:false,meta});
      await visibility.update({width,height,materialView:gb._views().g2,selfVisibilityView:one.createView(),contactVisibilityView:one.createView(),dsoMaskView:dso.bindings().mask,darkBloomView:zero.createView(),gtaoVisibilityView:temporal.bindings().visibility},SETTINGS.visibility);
      const source=ssgi.sourceFromPaths(hierarchy,gb,lighting.outputTexture().createView(),visibility);source.pixelScale=width<640?1:width/640;await ssgi.update(source,{...SETTINGS.ssgi,...state.ssgiOptions,wait:false,meta});return current;
    }
    async function support(){const [gi,ao,ds,vis]=await Promise.all([ssgi.readback('indirect'),gtao.readback(),dso.readbackMask(),visibility.readback()]);let indirectMax=0;for(let i=0;i<gi.data.length;i++)if(i%4<3)indirectMax=Math.max(indirectMax,gi.data[i]);return{indirectMax,gtaoMin:extrema(ao).min,dsoMax:extrema(ds).max,ambientMin:extrema(vis,2,4).min,ssgiHistoryValid:ssgi.historyValid,gi,ao,ds,vis};}
    function forwardSource(){return root.SteelMothWebGPUForwardLighting.sourceFromPaths({lighting,gbuffer:gb,hierarchy,visibility,ssgi,opaqueResolvedView:ssgi.bindings().composed});}
    async function close(){await temporal.flushStats?.();for(const p of[ssgi,visibility,temporal,gtao,dso,hard,dominance,clusters,bins,hierarchy,lighting,gb])await p.close?.();one.destroy();zero.destroy();bitmaps.forEach(b=>b.close());}
    return{device,width,height,kind:scene,atlas:a,gb,hierarchy,lighting,bins,clusters,dominance,hard,dso,gtao,temporal,visibility,ssgi,update,support,forwardSource,close,get current(){return current;}};
  }
  // Only submission/timestamp instrumentation changes. The frozen water shader and pipelines are untouched.
  function captureLegacyWaterDevice(device){
    const state={capture:false,buffers:[],timestampWrites:null};
    const queue=new Proxy(device.queue,{get(target,key){if(key==='submit')return buffers=>{if(state.capture)state.buffers.push(...buffers);else target.submit(buffers);};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
    const proxy=new Proxy(device,{get(target,key){if(key==='queue')return queue;if(key==='createCommandEncoder')return descriptor=>{const enc=target.createCommandEncoder(descriptor);return new Proxy(enc,{get(e,k){if(k==='beginRenderPass')return d=>e.beginRenderPass(state.capture&&state.timestampWrites?{...d,timestampWrites:state.timestampWrites}:d);const v=e[k];return typeof v==='function'?v.bind(e):v;}});};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
    return{device:proxy,queue,state,begin(timestampWrites=null){if(state.capture)throw new Error('nested legacy-water capture');state.capture=true;state.buffers=[];state.timestampWrites=timestampWrites;},finish(){state.capture=false;state.timestampWrites=null;const b=state.buffers;state.buffers=[];if(b.length!==1)throw new Error('frozen water must emit exactly one captured command buffer');return b;}};
  }
  function timestampEncoder(encoder,kind,timestampWrites){if(!timestampWrites)return encoder;return new Proxy(encoder,{get(e,k){if(k===kind)return descriptor=>e[k]({...descriptor,timestampWrites});const v=e[k];return typeof v==='function'?v.bind(e):v;}});}
  const COPY_WGSL=`@group(0) @binding(0) var opaque:texture_2d<f32>;@group(0) @binding(1) var water:texture_2d<f32>;@vertex fn vs(@builtin(vertex_index)i:u32)->@builtin(position)vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}@fragment fn fs(@builtin(position)p:vec4f)->@location(0)vec4f{let q=vec2i(p.xy);let a=textureLoad(opaque,q,0);let w=textureLoad(water,q,0);return vec4f(mix(a.rgb,w.rgb,w.a),1);}`;
  const FOLIAGE_COMPOSE_WGSL=`
${Ownership.PSEUDO_DEPTH_WGSL}
struct Instance{rootSize:vec4f,profile:vec4f,aux:vec4f,base:vec4f,ids:vec4u};struct Output{color:vec4f,state:vec4f,ids:vec4u};struct Draw{extentStage:vec4f};
@group(0)@binding(0)var<storage,read>instances:array<Instance>;@group(0)@binding(1)var<storage,read>shaded:array<Output>;@group(0)@binding(2)var<uniform>draw:Draw;@group(0)@binding(3)var depth:texture_depth_2d;
struct V{@builtin(position)p:vec4f,@location(0)uv:vec2f,@location(1)@interpolate(flat)colour:vec4f,@location(2)@interpolate(flat)front:f32,@location(3)@interpolate(flat)surface:vec3f};
@vertex fn vs(@builtin(vertex_index)v:u32,@builtin(instance_index)n:u32)->V{let c=array<vec2f,6>(vec2f(-.5,-1),vec2f(.5,-1),vec2f(-.5,0),vec2f(-.5,0),vec2f(.5,-1),vec2f(.5,0));let i=instances[n];let o=shaded[n];let tiny=(i.ids.x&8u)!=0u;let front=bitcast<f32>(o.ids.w);let stage=select(select(1.0,2.0,front>=.5),0.0,tiny);let uv=vec2f(c[v].x+.5,-c[v].y);let bend=bitcast<f32>(o.ids.z)*pow(uv.y,1.45);var p=i.rootSize.xy+c[v]*i.rootSize.zw;p.x+=bend;var out:V;out.p=vec4f(p.x/draw.extentStage.x*2.0-1.0,1.0-p.y/draw.extentStage.y*2.0,0,1);if(stage!=draw.extentStage.z){out.p=vec4f(-4,-4,0,1);}out.uv=uv;out.colour=o.color;out.front=front;out.surface=vec3f(clamp(i.rootSize.w*.18/SM_MAX_WORLD_Z,0.0,1.0),bitcast<f32>(i.ids.w),i.aux.z);return out;}
@fragment fn fs(in:V)->@location(0)vec4f{let q=clamp(vec2i(in.p.xy),vec2i(0),vec2i(textureDimensions(depth))-vec2i(1));let canonical=smOwnershipDepth(in.p.y,in.surface.x,in.surface.y,in.surface.z);if(in.front<.5&&canonical>textureLoad(depth,q,0)+.0000001){discard;}return in.colour;}`;
  async function createCompositor(device,width,height,compile=async()=>{}){
    const usage=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING;
    const copyModule=device.createShaderModule({code:COPY_WGSL,label:'SM702:fixture-water-composition'}),leafModule=device.createShaderModule({code:FOLIAGE_COMPOSE_WGSL,label:'SM702:fixture-foliage-composition'});await compile(copyModule,'fixture-water-composition');await compile(leafModule,'fixture-foliage-composition');
    const copy=device.createRenderPipeline({layout:'auto',vertex:{module:copyModule,entryPoint:'vs'},fragment:{module:copyModule,entryPoint:'fs',targets:[{format:'rgba16float'}]}}),leaf=device.createRenderPipeline({layout:'auto',vertex:{module:leafModule,entryPoint:'vs'},fragment:{module:leafModule,entryPoint:'fs',targets:[{format:'rgba16float',blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]}});
    const targets=[0,1,2,3].map(i=>device.createTexture({label:'SM702:mixed:'+i,size:[width,height],format:'rgba16float',usage})),views=targets.map(t=>t.createView()),uniforms=[0,1,2].map(i=>{const b=device.createBuffer({label:'SM702:foliage-draw:'+i,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,new Float32Array([width,height,i,0]));return b;}),copyLayout=copy.getBindGroupLayout(0),leafLayout=leaf.getBindGroupLayout(0),copyGroups=[null,null],leafGroups=Array.from({length:2},()=>[null,null,null]);
    function base(encoder,index,opaqueView,waterView){let group=copyGroups[index];if(!group||group.opaque!==opaqueView||group.water!==waterView){group={opaque:opaqueView,water:waterView,bind:device.createBindGroup({layout:copyLayout,entries:[{binding:0,resource:opaqueView},{binding:1,resource:waterView}]})};copyGroups[index]=group;}const p=encoder.beginRenderPass({label:'SM702:fixture-opaque-water',colorAttachments:[{view:views[index],loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});p.setPipeline(copy);p.setBindGroup(0,group.bind);p.draw(3);p.end();}
    function foliage(encoder,index,producer,stage,depthView){let group=leafGroups[index][stage];if(!group||group.depth!==depthView||group.input!==producer.instanceBuffer||group.output!==producer.outputBuffer){group={depth:depthView,input:producer.instanceBuffer,output:producer.outputBuffer,bind:device.createBindGroup({layout:leafLayout,entries:[{binding:0,resource:{buffer:producer.instanceBuffer}},{binding:1,resource:{buffer:producer.outputBuffer}},{binding:2,resource:{buffer:uniforms[stage]}},{binding:3,resource:depthView}]})};leafGroups[index][stage]=group;}const p=encoder.beginRenderPass({label:'SM702:fixture-foliage:'+stage,colorAttachments:[{view:views[index],loadOp:'load',storeOp:'store'}]});p.setPipeline(leaf);p.setBindGroup(0,group.bind);p.draw(6,producer.count);p.end();}
    return{width,height,targets,base,foliage,post(encoder,i){encoder.copyTextureToTexture({texture:targets[i]},{texture:targets[i+2]},[width,height]);},targetView:(i,post=false)=>views[i+(post?2:0)],readback:(i,post=true)=>readTexture(device,targets[i+(post?2:0)],width,height),memory:{resources:[...targets.map((_,i)=>({name:'fixture:mixed:'+i,kind:'texture',format:'rgba16float',width,height,depthOrArrayLayers:1,estimatedBytes:width*height*8,lifetime:'persistent'})),...uniforms.map((_,i)=>({name:'fixture:foliage-draw:'+i,kind:'buffer',size:16,estimatedBytes:16,lifetime:'persistent'}))],boundary:'Equal bounded lab composition resources; no resident VRAM measurement.'},close(){targets.forEach(t=>t.destroy());uniforms.forEach(b=>b.destroy());}};
  }
  return{BASELINE_COMMIT,BASELINES,SETTINGS,META,surface,align,clone,mean,percentile,maxDiff,finiteBounded,extrema,sceneDescription,atlasData,readTexture,createUpstream,captureLegacyWaterDevice,timestampEncoder,COPY_WGSL,FOLIAGE_COMPOSE_WGSL,createCompositor};
});
