'use strict';

// Diagnostic injection after the caller has frozen normal index.html gameplay.
// Full readbacks, CPU reference work and diagnostic replays are not GPU timings.
async function sm505ReceiverProbe(options={}) {
  const result={schema:'steelmoth-sm505-receiver-probe/v1',ok:false,physicalAcceptance:false,visualAcceptance:false,checks:[],errors:[],items:[],snapshots:{},samples:[],restored:false,
    boundary:'Source-matched diagnostic of normal-game background receiving and canonical SM-204 cone response. No visual, performance or release acceptance; caller must freeze gameplay and serialize GPU work.'};
  const runtime=globalThis.steelMothBackendRuntime,p=runtime?.presenter,game=globalThis.game;
  if(runtime?.presentationBackend!=='webgpu'||!p?.ready||p.closed||p.rendering||p.pending||!game?.renderScene)throw new Error('receiver probe requires a frozen, idle, ready normal-game WebGPU presenter');
  if(typeof p._renderBackgroundReceivers!=='function')throw new Error('source candidate has no background receiver pass');
  const sampleLimit=options.sampleLimit??64;
  if(!Number.isSafeInteger(sampleLimit)||sampleLimit<1||sampleLimit>256)throw new RangeError('sampleLimit must be an integer from 1 to 256');
  const originalScene=game.renderScene,originalJSON=JSON.stringify(originalScene),originalPending=p.pending;
  const d=p.device,q=d.queue,w=p.width,h=p.height,count=w*h,L=p.api.Lighting,O=p.api.Ownership,Presenter=globalThis.SteelMothWebGPUScenePresenter;
  if(!Number.isSafeInteger(count)||count<1||count>3840*2160)throw new RangeError('receiver probe extent exceeds bounded diagnostic limit');
  result.extent=[w,h];result.configuration={sampleLimit,settings:JSON.parse(JSON.stringify(originalScene.settings||{})),conePolicy:'Original scene cone only; same authored cone in all controls, rotated 180 degrees or absent. Original scene/settings are never mutated.'};
  if(p.gb.formats?.g0!=='rgba8unorm'||p.gb.formats?.g1!=='rgba16float'||p.gb.formats?.g2!=='rgba16float')throw new Error('probe requires the canonical rgba8/rgba16float G-buffer formats');
  const resources=[],rawSnapshots={},unique=new Map();let scopeOpen=false,started=false;
  const check=(ok,label,details={})=>{result.checks.push({ok:!!ok,label,...details});return!!ok};
  const progress=phase=>console.log('SM-505 receiver probe: '+phase);
  const base64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s)};
  const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const half=word=>L.halfToFloat(word);
  const rowByte=(record,index,channel=0)=>Math.floor(index/w)*record.rowBytes+(index%w)*record.bytesPerPixel+channel;
  const uint=(record,index)=>record.view.getUint32(rowByte(record,index),true);
  const float=(record,index)=>record.view.getFloat32(rowByte(record,index),true);
  const rgba=(record,index)=>Array.from({length:4},(_,c)=>record.format==='rgba16float'?half(record.view.getUint16(rowByte(record,index,c*2),true)):record.data[rowByte(record,index,c)]/255);
  const equalPixel=(a,b,index)=>{const ao=rowByte(a,index),bo=rowByte(b,index);for(let j=0;j<a.bytesPerPixel;j++)if(a.data[ao+j]!==b.data[bo+j])return false;return true};
  const maxDifference=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
  let staging,depthStorage,depthPipeline,depthBind;
  async function retain(name,data,format,rowBytes,bytesPerPixel,kind){
    const hash=await sha256(data),key=[format,w,h,rowBytes,hash].join('/');let item=unique.get(key);
    if(!item){item={name,format,kind,width:w,height:h,rowBytes,sha256:hash,byteLength:data.byteLength,base64:base64(data)};unique.set(key,item);result.items.push(item)}
    return{name,item:item.name,sha256:hash,format,width:w,height:h,rowBytes,bytesPerPixel,data,view:new DataView(data.buffer,data.byteOffset,data.byteLength)};
  }
  async function mapStaging(size){
    await staging.mapAsync(GPUMapMode.READ);try{return new Uint8Array(staging.getMappedRange()).slice(0,size)}finally{staging.unmap()}
  }
  async function readTexture(name,texture,format,kind){
    const bytesPerPixel=format==='rgba16float'?8:4,rowBytes=Math.ceil(w*bytesPerPixel/256)*256;
    if(texture.width!==w||texture.height!==h)throw new Error(name+' does not match frozen native extent');
    const encoder=d.createCommandEncoder({label:'SM505:receiver-read:'+name});encoder.clearBuffer(staging);encoder.copyTextureToBuffer({texture},{buffer:staging,bytesPerRow:rowBytes,rowsPerImage:h},{width:w,height:h});q.submit([encoder.finish()]);
    return retain(name,await mapStaging(rowBytes*h),format,rowBytes,bytesPerPixel,kind);
  }
  async function readDepth(name){
    const encoder=d.createCommandEncoder({label:'SM505:receiver-depth-read'});encoder.clearBuffer(staging);
    const pass=encoder.beginComputePass();pass.setPipeline(depthPipeline);pass.setBindGroup(0,depthBind);pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(h/8));pass.end();encoder.copyBufferToBuffer(depthStorage,0,staging,0,count*4);q.submit([encoder.finish()]);
    return retain(name,await mapStaging(count*4),'r32float',w*4,4,'shader-visible-ownership-depth');
  }
  async function snapshot(name){
    progress('read '+name);const rec={};
    rec.g0=await readTexture(name+'-gbuffer-albedo',p.gb._record('g0').handle,'rgba8unorm','linear-rgb');
    rec.g1=await readTexture(name+'-gbuffer-normal-roughness',p.gb._record('g1').handle,'rgba16float','numeric');
    rec.g2=await readTexture(name+'-gbuffer-height-material',p.gb._record('g2').handle,'rgba16float','numeric');
    rec.objectId=await readTexture(name+'-object-id',p.gb._record('object').handle,'r32uint','object-id');
    rec.depth=await readDepth(name+'-ownership-depth');
    rec.light=await readTexture(name+'-raw-lighting',p.lighting.outputTexture(),'rgba16float','linear-rgb');
    rawSnapshots[name]=rec;result.snapshots[name]=Object.fromEntries(Object.entries(rec).map(([key,r])=>[key,{item:r.item,sha256:r.sha256,format:r.format,rowBytes:r.rowBytes,width:w,height:h}]));return rec;
  }
  try{
    progress('prepare');d.pushErrorScope('validation');scopeOpen=true;
    staging=d.createBuffer({label:'SM505:receiver-staging',size:Math.ceil(w*8/256)*256*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});resources.push(staging);
    depthStorage=d.createBuffer({label:'SM505:receiver-depth-storage',size:Math.ceil(count*4/256)*256,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});resources.push(depthStorage);
    const depthModule=d.createShaderModule({label:'SM505:receiver-full-depth-readback',code:`
@group(0) @binding(0) var source:texture_depth_2d;
@group(0) @binding(1) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){
  let size=textureDimensions(source);if(any(gid.xy>=size)){return;}
  output[gid.y*size.x+gid.x]=textureLoad(source,vec2i(gid.xy),0);
}`});
    const info=await depthModule.getCompilationInfo();result.depthReadbackCompilation=Array.from(info.messages||[]).map(m=>({type:m.type,message:m.message,lineNum:m.lineNum,linePos:m.linePos}));
    if(result.depthReadbackCompilation.some(m=>m.type==='error'))throw new Error('diagnostic depth-readback WGSL compilation failed');
    const descriptor={label:'SM505:receiver-full-depth-readback',layout:'auto',compute:{module:depthModule,entryPoint:'main'}};
    depthPipeline=typeof d.createComputePipelineAsync==='function'?await d.createComputePipelineAsync(descriptor):d.createComputePipeline(descriptor);
    depthBind=d.createBindGroup({layout:depthPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:p.gb._views().depth},{binding:1,resource:{buffer:depthStorage}}]});
    const derived=Presenter.scaleScene(originalScene,w,h,p.api.Pseudo,L).scene;
    const sourceCone=derived.playerCone||(derived.lights||[]).find(l=>l.type==='cone'||l.id==='light:player-cone:0');
    if(!sourceCone||sourceCone.enabled===false||!(sourceCone.intensity>0))throw new Error('fixture must supply an enabled nonzero authored player cone');
    if(derived.settings?.lighting===false)throw new Error('fixture lighting is disabled; do not alter artistic controls for this probe');
    const cone=JSON.parse(JSON.stringify(sourceCone)),coneScene={...derived,lights:[cone],playerCone:cone};
    const awayCone={...cone,dx:-(cone.dx??1),dy:-(cone.dy??0)},awayScene={...derived,lights:[awayCone],playerCone:awayCone},offScene={...derived,lights:[],playerCone:null};
    const settings=derived.settings||{},instances=O.buildOwnershipSceneInstances(derived,game.art.manifest);
    result.configuration.originalAuthoredCone=cone;result.configuration.instanceCount=instances.length;
    p._uploadBackdrop();started=true;await p.gb.renderInstances(instances,{wait:false});
    await p.lighting.render(p.gb,coneScene,settings,{wait:false});result.lights={negative:JSON.parse(JSON.stringify(p.lighting.lastLights))};
    const negative=await snapshot('negative-no-receiver');
    progress('seed production receiver');await p._renderBackgroundReceivers();
    await p.lighting.render(p.gb,coneScene,settings,{wait:false});result.lights.positive=JSON.parse(JSON.stringify(p.lighting.lastLights));
    const positive=await snapshot('positive-receiver');
    await p.lighting.render(p.gb,awayScene,settings,{wait:false});result.lights.rotated=JSON.parse(JSON.stringify(p.lighting.lastLights));
    const rotated=await snapshot('rotated-cone');
    await p.lighting.render(p.gb,offScene,settings,{wait:false});result.lights.off=JSON.parse(JSON.stringify(p.lighting.lastLights));
    const off=await snapshot('cone-off');
    progress('verify full ownership/material readbacks');
    let occupied=0,unowned=0,idChanges=0,depthChanges=0,occupiedMaterialChanges=0,badReceiverAlpha=0,badNeutralG1=0,badNeutralG2=0,badUnownedDepth=0,negativeLitUnowned=0,negativeFilledUnowned=0,nonfiniteLight=0;
    const candidates=[],examples=[];const expectedG1=[0x3800,0x3800,0x3c00,0x3b0a],expectedG2=[0,0,0x3c00,0];
    for(let i=0;i<count;i++){
      const id=uint(negative.objectId,i),owned=id!==0;
      for(const state of [positive,rotated,off]){if(uint(state.objectId,i)!==id)idChanges++;if(!equalPixel(negative.depth,state.depth,i))depthChanges++}
      if(owned){occupied++;for(const key of ['g0','g1','g2'])if(!equalPixel(negative[key],positive[key],i))occupiedMaterialChanges++;continue}
      unowned++;
      if(float(negative.depth,i)!==1||float(positive.depth,i)!==1)badUnownedDepth++;
      if(negative.g0.data[rowByte(negative.g0,i,3)]!==0)negativeFilledUnowned++;
      if(positive.g0.data[rowByte(positive.g0,i,3)]!==255)badReceiverAlpha++;
      for(let c=0;c<4;c++){
        if(positive.g1.view.getUint16(rowByte(positive.g1,i,c*2),true)!==expectedG1[c])badNeutralG1++;
        if(positive.g2.view.getUint16(rowByte(positive.g2,i,c*2),true)!==expectedG2[c])badNeutralG2++;
      }
      const old=rgba(negative.light,i),lit=rgba(positive.light,i),noCone=rgba(off.light,i);
      if(old.some(v=>v!==0))negativeLitUnowned++;
      if(![...old,...lit,...noCone].every(Number.isFinite))nonfiniteLight++;
      if(Math.max(...lit.slice(0,3).map((v,c)=>v-noCone[c]))>1e-4)candidates.push(i);
      if(examples.length<8&&Math.max(...lit.slice(0,3))>0)examples.push({x:i%w,y:Math.floor(i/w),g0:rgba(positive.g0,i),negative:old,positive:lit,off:noCone});
    }
    result.fullReadback={occupiedPixels:occupied,unownedPixels:unowned,idChanges,depthChanges,occupiedMaterialChanges,badReceiverAlpha,badNeutralG1,badNeutralG2,badUnownedDepth,negativeLitUnowned,negativeFilledUnowned,nonfiniteLight,coneAffectedFloorPixels:candidates.length,examples};
    check(unowned>0,'fixture contains non-sprite floor receivers',{pixels:unowned});
    check(idChanges===0&&depthChanges===0,'global canonical object IDs and shader-visible depth remain byte-identical across seed/cone controls',{idChanges,depthChanges});
    check(['g0','g1','g2'].every(key=>positive[key].sha256===rotated[key].sha256&&positive[key].sha256===off[key].sha256),'all seeded material bytes remain unchanged across rotated/off cone controls');
    check(occupiedMaterialChanges===0,'every occupied sprite material byte survives receiver insertion',{occupiedPixels:occupied,changedFields:occupiedMaterialChanges});
    check(badReceiverAlpha===0&&badNeutralG1===0&&badNeutralG2===0&&badUnownedDepth===0,'all unowned pixels receive opaque background albedo and exact legacy neutral material without depth ownership',{badReceiverAlpha,badNeutralG1,badNeutralG2,badUnownedDepth});
    check(negativeFilledUnowned===0&&negativeLitUnowned===0,'retained old-path negative witness has empty material and zero raw lighting on unowned pixels',{negativeFilledUnowned,negativeLitUnowned});
    check(nonfiniteLight===0,'floor raw-lighting readbacks remain finite',{nonfiniteLight});
    check(candidates.length>0,'authored cone contributes nonzero raw direct lighting on non-sprite floor',{pixels:candidates.length});
    const n=Math.min(sampleLimit,candidates.length);let maximumReferenceError=0,maximumAwayOffDifference=0;
    for(let j=0;j<n;j++){
      const i=candidates[n===1?0:Math.floor(j*(candidates.length-1)/(n-1))],x=i%w,y=Math.floor(i/w),sample={g0:rgba(positive.g0,i),g1:rgba(positive.g1,i),g2:rgba(positive.g2,i)};
      const outputs={},references={},errors={};
      for(const [key,state,lights] of [['positive',positive,result.lights.positive],['rotated',rotated,result.lights.rotated],['off',off,result.lights.off]]){
        outputs[key]=rgba(state.light,i);references[key]=L.shadePixelReference(sample,lights,settings,[x+.5,y+.5]);errors[key]=maxDifference(outputs[key],references[key]);maximumReferenceError=Math.max(maximumReferenceError,errors[key]);
      }
      maximumAwayOffDifference=Math.max(maximumAwayOffDifference,maxDifference(outputs.rotated,outputs.off));
      result.samples.push({x,y,material:sample,outputs,references,maximumAbsoluteErrors:errors});
    }
    result.cpuReference={producer:'SteelMothWebGPULighting.shadePixelReference',samples:n,maximumAbsoluteError:maximumReferenceError,tolerance:.003,maximumRotatedOffDifference:maximumAwayOffDifference,pixelCoordinates:'native fragment centres x+.5,y+.5; actual quantized G0/G1/G2 and recorded canonical light records'};
    check(n>0&&maximumReferenceError<=.003,'floor cone/rotated/off raw GPU outputs agree with production CPU reference',{samples:n,maximumReferenceError,tolerance:.003});
    check(n>0&&maximumAwayOffDifference<=.001,'rotated-away cone removes the measured forward floor contribution',{maximumAwayOffDifference,tolerance:.001});
    result.ok=result.checks.every(c=>c.ok);
  }catch(error){result.errors.push(String(error?.stack||error));result.ok=false}
  finally{
    progress('restore frozen normal frame');
    if(started){try{await p._render(originalScene);await q.onSubmittedWorkDone();result.restored=true}catch(error){result.errors.push('restore failed: '+String(error?.stack||error));result.ok=false}}
    else result.restored=true;
    check(JSON.stringify(originalScene)===originalJSON&&game.renderScene===originalScene&&p.pending===originalPending,'authoritative original scene/settings and pending state remain unchanged');
    if(scopeOpen){try{const error=await d.popErrorScope();result.validationError=error?String(error.message||error):null;check(!error,'diagnostic and restored production passes emit no scoped WebGPU validation error',{message:result.validationError});if(error)result.ok=false}catch(error){result.errors.push('validation scope failed: '+String(error));result.ok=false}}
    for(const resource of resources)try{resource.destroy()}catch(error){result.errors.push('diagnostic resource cleanup: '+String(error));result.ok=false}
    result.ok=result.ok&&result.restored&&result.errors.length===0&&result.checks.every(c=>c.ok);
    result.rawPayloadPolicy='Unique byte-identical strided buffers are retained once as base64 items, keyed by SHA-256/format/extent/stride; snapshot item references preserve every phase without redundant payloads. Depth is r32float shader-visible textureLoad data, not a competing depth hierarchy.';
  }
  progress(result.ok?'PASS engineering receiver checks':'FAIL engineering receiver checks');return result;
}
