'use strict';

// Inject only into frozen, idle normal-game WebGPU presentation. These shadow-
// only paired diagnostics and CPU readbacks are not performance measurements.
async function sm505SelfReconstructionProbe(){
  const runtime=globalThis.steelMothBackendRuntime,p=runtime?.presenter,game=globalThis.game;
  if(runtime?.presentationBackend!=='webgpu'||!p?.ready||p.closed||p.rendering||p.pending||game?.paused!==true||!game?.renderScene)throw new Error('self reconstruction probe requires frozen idle normal-game WebGPU presentation');
  const result={schema:'steelmoth-sm505-self-reconstruction-probe/v1',ok:false,physicalAcceptance:false,visualAcceptance:false,checks:[],errors:[],items:[],snapshots:{},restored:false,boundary:'Actual single-driver material-guided shadow field numeric diagnostic; no GPU timing, visual, performance or release acceptance. Failed attempts retained without retry.'};
  const P=globalThis.SteelMothWebGPUScenePresenter,S=p.api.Shadows,L=p.api.Lighting,d=p.device,q=d.queue,original=game.renderScene,w=p.width,h=p.height,count=w*h;
  if(!Number.isSafeInteger(count)||count<1||count>3840*2160)throw new RangeError('self reconstruction probe extent exceeds bounded limit');
  const native=P.scaleScene(original,w,h,p.api.Pseudo,L,p.api.Transform||globalThis.SteelMothRenderTransform).scene;
  const settings=p.api.Quality.localShadowSettings('Medium',native.settings||{}),all=L.buildCanonicalLights(native,settings),driver=all.find(x=>x.type==='cone')||all[0];
  if(!driver)throw new Error('self reconstruction requires actual canonical game light');
  const subset=P.lightSubset(native,[driver.id]),singleSettings={...settings,selfShadowing:true,selfShadowLightCount:1},selected=S.selectSelfShadowLights(subset,singleSettings);
  if(selected.length!==1||selected[0].id!==driver.id)throw new Error('single-driver canonical identity mismatch');
  const shaderDriver={...driver,position:driver.position.map(Math.fround),direction:driver.direction.map(Math.fround),radius:Math.fround(driver.radius),outerCos:Math.fround(driver.outerCos),innerCos:Math.fround(driver.innerCos)};
  const depthKeySpan=globalThis.SteelMothPseudoDepth.DEPTH_KEY_MAX-globalThis.SteelMothPseudoDepth.DEPTH_KEY_MIN;
  const sourceFingerprint=JSON.stringify(original);result.extent=[w,h];result.sourceLights=JSON.parse(JSON.stringify(all));result.sourceSubset=JSON.parse(JSON.stringify({lights:subset.lights,playerCone:subset.playerCone}));result.driver=JSON.parse(JSON.stringify(driver));result.shaderDriver=shaderDriver;result.settings=JSON.parse(JSON.stringify(singleSettings));
  const resources=[],unique=new Map();let scopeOpen=false,staging,depthStorage,depthPipeline,depthBind;
  const check=(ok,label,details={})=>result.checks.push({ok:!!ok,label,...details});
  const progress=phase=>console.log('SM-505 self reconstruction probe: '+phase);
  const encode=bytes=>{let value='';for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(value)};
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  async function retain(name,bytes,format,width,height,rowBytes,kind){
    const sha256=await digest(bytes),key=[format,width,height,rowBytes,sha256].join('/');let item=unique.get(key);
    if(!item){item={name,format,width,height,rowBytes,kind,sha256,byteLength:bytes.byteLength,base64:encode(bytes)};unique.set(key,item);result.items.push(item)}
    return{name,item:item.name,format,width,height,rowBytes,sha256,bytes,view:new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)};
  }
  async function mapped(size){await staging.mapAsync(GPUMapMode.READ);try{return new Uint8Array(staging.getMappedRange()).slice(0,size)}finally{staging.unmap()}}
  async function read(name,texture,format,kind){
    const width=texture.width,height=texture.height,bpp=format==='rgba16float'?8:format==='r16float'?2:4,rowBytes=Math.ceil(width*bpp/256)*256;
    if(!width||!height||rowBytes*height>staging.size)throw new Error('unexpected bounded texture extent for '+name);
    const e=d.createCommandEncoder({label:'SM505:self-reconstruction-read:'+name});e.clearBuffer(staging);e.copyTextureToBuffer({texture},{buffer:staging,bytesPerRow:rowBytes,rowsPerImage:height},{width,height});q.submit([e.finish()]);
    return retain(name,await mapped(rowBytes*height),format,width,height,rowBytes,kind);
  }
  async function readDepth(name){
    const e=d.createCommandEncoder({label:'SM505:self-reconstruction-depth-read'});e.clearBuffer(staging);const pass=e.beginComputePass();pass.setPipeline(depthPipeline);pass.setBindGroup(0,depthBind);pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(h/8));pass.end();e.copyBufferToBuffer(depthStorage,0,staging,0,count*4);q.submit([e.finish()]);
    return retain(name,await mapped(count*4),'r32float',w,h,w*4,'shader-visible-ownership-depth');
  }
  async function guides(name){return{g0:await read(name+'-g0',p.gb._record('g0').handle,'rgba8unorm','linear-rgb'),g2:await read(name+'-g2',p.gb._record('g2').handle,'rgba16float','numeric'),objectId:await read(name+'-object-id',p.gb._record('object').handle,'r32uint','object-id'),depth:await readDepth(name+'-ownership-depth')}}
  const meta=record=>Object.fromEntries(['name','item','format','width','height','rowBytes','sha256'].map(k=>[k,record[k]]));
  const recordMeta=records=>Object.fromEntries(Object.entries(records).map(([k,v])=>[k,meta(v)]));
  const offset=(record,i,bpp)=>Math.floor(i/record.width)*record.rowBytes+(i%record.width)*bpp;
  function scalar(record){const out=new Float64Array(record.width*record.height);for(let i=0;i<out.length;i++){const o=offset(record,i,record.format==='r16float'?2:4);out[i]=record.format==='r16float'?L.halfToFloat(record.view.getUint16(o,true)):record.view.getFloat32(o,true)}return out}
  try{
    d.pushErrorScope('validation');scopeOpen=true;
    staging=d.createBuffer({label:'SM505:self-reconstruction-staging',size:Math.ceil(w*8/256)*256*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});resources.push(staging);
    depthStorage=d.createBuffer({label:'SM505:self-reconstruction-depth-storage',size:Math.ceil(count*4/256)*256,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});resources.push(depthStorage);
    const module=d.createShaderModule({label:'SM505:self-reconstruction-depth-reader',code:`
@group(0) @binding(0) var depth:texture_depth_2d;
@group(0) @binding(1) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){let size=textureDimensions(depth);if(gid.x>=size.x||gid.y>=size.y){return;}output[gid.y*size.x+gid.x]=textureLoad(depth,vec2i(gid.xy),0);}`});
    if(typeof module.getCompilationInfo==='function'){const info=await module.getCompilationInfo();result.depthReaderCompilation=Array.from(info.messages||[]).map(m=>({type:m.type,message:m.message}));if(result.depthReaderCompilation.some(m=>m.type==='error'))throw new Error('depth reader WGSL compilation failed')}
    depthPipeline=d.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}});depthBind=d.createBindGroup({layout:depthPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:p.gb._views().depth},{binding:1,resource:{buffer:depthStorage}}]});
    progress('original guides');const before=await guides('original');result.snapshots.before=recordMeta(before);
    progress('single-driver raw');await p.shadows.render(p.gb,subset,singleSettings,{reconstructSelf:false,wait:false});
    const rawBefore=await read('raw-before',p.shadows.rawSelfTexture(),'r16float','visibility'),contactBefore=await read('contact-before',p.shadows.contactTexture(),'r16float','occlusion'),contactVisibilityBefore=await read('contact-visibility-before',p.shadows.contactVisibilityTexture(),'r16float','visibility');
    progress('same single-driver reconstructed');await p.shadows.render(p.gb,subset,singleSettings,{reconstructSelf:true,wait:false});
    const rawAfter=await read('raw-after',p.shadows.rawSelfTexture(),'r16float','visibility'),filtered=await read('filtered',p.shadows.reconstructionTexture(),'r16float','visibility'),contactAfter=await read('contact-after',p.shadows.contactTexture(),'r16float','occlusion'),contactVisibilityAfter=await read('contact-visibility-after',p.shadows.contactVisibilityTexture(),'r16float','visibility');
    const after=await guides('after');result.snapshots.after=recordMeta(after);result.snapshots.fields=recordMeta({rawBefore,rawAfter,filtered,contactBefore,contactAfter,contactVisibilityBefore,contactVisibilityAfter});
    check(rawBefore.sha256===rawAfter.sha256,'paired raw self readback hashes identical');check(contactBefore.sha256===contactAfter.sha256&&contactVisibilityBefore.sha256===contactVisibilityAfter.sha256,'paired raw/reconstructed contact bytes identical');
    check(Object.keys(before).every(k=>before[k].sha256===after[k].sha256),'G0 G2 object IDs and shader-visible ownership depth unchanged');check(JSON.stringify(original)===sourceFingerprint,'source scene/material/settings not mutated');
    const visibility=scalar(rawBefore),actual=scalar(filtered),objectIds=new Uint32Array(count),coverage=new Float64Array(count),heights=new Float64Array(count),depth=scalar(before.depth);
    for(let i=0;i<count;i++){objectIds[i]=before.objectId.view.getUint32(offset(before.objectId,i,4),true);coverage[i]=before.g0.bytes[offset(before.g0,i,4)+3]/255;heights[i]=L.halfToFloat(before.g2.view.getUint16(offset(before.g2,i,8),true))}
    progress('full-field CPU reference');const expected=S.selfReconstructionReference({width:w,height:h,visibility,objectIds,coverage,heights,depth},shaderDriver,singleSettings),scale=L.worldScale(singleSettings),stride=Math.max(1,Math.round(scale));
    let maxError=0,rawMass=0,filteredMass=0,min=1,max=0,finite=true,near=0,nearMismatch=0,outside=0,outsideMismatch=0,boundary=0,boundaryMaxError=0;
    let rawHF=0,filteredHF=0,hfSamples=0;
    const supports=i=>S.selfDriverSupports({x:i%w+.5,y:Math.floor(i/w)+.5},shaderDriver),strength=i=>S.selfAliasStrength({x:i%w+.5,y:Math.floor(i/w)+.5},shaderDriver,singleSettings);
    for(let i=0;i<count;i++){
      const a=actual[i],r=visibility[i],error=Math.abs(a-expected[i]);maxError=Math.max(maxError,error);finite=finite&&Number.isFinite(a)&&Number.isFinite(r)&&r>=0&&r<=1;min=Math.min(min,a);max=Math.max(max,a);rawMass+=1-r;filteredMass+=1-a;
      const sameRawBits=rawBefore.view.getUint16(offset(rawBefore,i,2),true)===filtered.view.getUint16(offset(filtered,i,2),true);
      if(coverage[i]>=.02&&supports(i)&&strength(i)===0){near++;if(!sameRawBits)nearMismatch++}if(!supports(i)){outside++;if(!sameRawBits)outsideMismatch++}
      const x=i%w,y=Math.floor(i/w);if(x<stride||y<stride||x>=w-stride||y>=h-stride)continue;
      const neighbors=[i-stride,i+stride,i-stride*w,i+stride*w];if(neighbors.some(j=>objectIds[j]!==objectIds[i])){boundary++;boundaryMaxError=Math.max(boundaryMaxError,error)}
      if(objectIds[i]!==0||coverage[i]<.02||!supports(i)||strength(i)<=.99)continue;
      if(neighbors.some(j=>objectIds[j]!==0||coverage[j]<.02||!supports(j)||strength(j)<=.99||Math.abs(heights[j]-heights[i])*64*Math.min(3,Math.max(0,singleSettings.heightStrength??1))>1||Math.abs(depth[j]-depth[i])*depthKeySpan>1.5))continue;
      const rawResidual=r-neighbors.reduce((n,j)=>n+visibility[j],0)/4,filteredResidual=a-neighbors.reduce((n,j)=>n+actual[j],0)/4;rawHF+=rawResidual*rawResidual;filteredHF+=filteredResidual*filteredResidual;hfSamples++;
    }
    const massDrift=Math.abs(filteredMass-rawMass)/Math.max(rawMass,1e-12),hfReduction=rawHF>0?1-filteredHF/rawHF:null;
    result.numeric={finite,minimum:min,maximum:max,rawOcclusionMass:rawMass,filteredOcclusionMass:filteredMass,relativeMassDrift:massDrift,maxCPUAbsError:maxError,nearPixels:near,nearByteValueMismatches:nearMismatch,outsideDriverPixels:outside,outsideDriverMismatches:outsideMismatch,receiverBoundaryPixels:boundary,receiverBoundaryMaxCPUAbsError:boundaryMaxError,farFloorHFSamples:hfSamples,rawHFPower:rawHF,filteredHFPower:filteredHF,hfReduction};
    check(finite&&min>=0&&max<=1,'actual GPU filtered field finite and bounded to visibility range',{minimum:min,maximum:max});check(massDrift<=.001,'R16 occlusion mass drift bounded',{relativeMassDrift:massDrift,tolerance:.001});
    check(maxError<=.001,'full actual field agrees with production CPU reconstruction',{pixels:count,maxAbsError:maxError,tolerance:.001});check(near>0&&nearMismatch===0,'near alias-strength-zero controls unchanged exactly',{pixels:near,mismatches:nearMismatch});check(outside>0&&outsideMismatch===0,'no leakage outside canonical driver support',{pixels:outside,mismatches:outsideMismatch});check(boundary>0&&boundaryMaxError<=.001,'receiver/object boundary samples obey rejected-pair CPU controls',{pixels:boundary,maxAbsError:boundaryMaxError,tolerance:.001});
    check(hfSamples>0&&rawHF>0&&hfReduction>=.5,'far supported ID0 interior high-frequency power reduced at least50percent',{samples:hfSamples,rawPower:rawHF,filteredPower:filteredHF,reduction:hfReduction,target:.5,classification:'source engineering quality target; not human visual acceptance'});
    const error=await d.popErrorScope();scopeOpen=false;if(error)throw new Error('self reconstruction probe validation: '+error.message);
    progress('restore original normal presentation');await p._render(original);await q.onSubmittedWorkDone();result.restored=true;result.ok=result.checks.every(c=>c.ok);
  }catch(error){result.errors.push(String(error?.stack||error))}
  finally{if(scopeOpen)try{const error=await d.popErrorScope();if(error)result.errors.push('validation: '+error.message)}catch(error){result.errors.push(String(error))}for(const resource of resources)resource.destroy()}
  result.ok=result.ok&&result.errors.length===0;return result;
}
