'use strict';

// Test-only numeric controls on the actual frozen normal-game materials/lights.
// Constant visibility is an injected diagnostic input, never a presented frame.
async function sm505VisibilityProbe(){
  const runtime=globalThis.steelMothBackendRuntime,p=runtime?.presenter,game=globalThis.game;
  if(runtime?.presentationBackend!=='webgpu'||!p?.ready||p.closed||p.rendering||p.pending)throw new Error('visibility probe requires frozen idle normal WebGPU presentation');
  const result={schema:'steelmoth-sm505-opaque-visibility-probe/v1',ok:false,physicalAcceptance:false,visualAcceptance:false,checks:[],errors:[],items:[],samples:[],restored:false};
  const P=globalThis.SteelMothWebGPUScenePresenter,L=p.api.Lighting,d=p.device,q=d.queue,w=p.width,h=p.height,scene=game.renderScene;
  const native=P.scaleScene(scene,w,h,p.api.Pseudo,L).scene,settings=p.api.Quality.localShadowSettings('Medium',native.settings||{}),lights=L.buildCanonicalLights(native,settings);
  if(!lights.length)throw new Error('visibility controls require actual canonical game lights');
  const count=w*h;if(count>3840*2160)throw new Error('visibility probe extent exceeds bounded limit');
  const check=(ok,label,details={})=>result.checks.push({ok:!!ok,label,...details});
  const encode=bytes=>{let value='';for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(value)};
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const resources=[];let opened=false;
  async function read(texture,format,name,retain=false){
    const bpp=format==='rgba16float'?8:4,row=Math.ceil(w*bpp/256)*256;
    const buffer=d.createBuffer({label:'SM505:visibility-control-read',size:row*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
      const e=d.createCommandEncoder();e.copyTextureToBuffer({texture},{buffer,bytesPerRow:row,rowsPerImage:h},{width:w,height:h});q.submit([e.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(buffer.getMappedRange()).slice();buffer.unmap();
      const hash=await digest(bytes);if(retain)result.items.push({name,format,kind:'linear-rgb',width:w,height:h,rowBytes:row,sha256:hash,base64:encode(bytes)});
      const view=new DataView(bytes.buffer),pixel=index=>{const offset=Math.floor(index/w)*row+(index%w)*bpp;return Array.from({length:4},(_,c)=>format==='rgba16float'?L.halfToFloat(view.getUint16(offset+c*2,true)):view.getUint8(offset+c)/255)};
      return{pixel,sha256:hash};
    }finally{buffer.destroy()}
  }
  try{
    d.pushErrorScope('validation');opened=true;
    const g0=await read(p.gb._record('g0').handle,'rgba8unorm','g0'),g1=await read(p.gb._record('g1').handle,'rgba16float','g1'),g2=await read(p.gb._record('g2').handle,'rgba16float','g2');
    const visibility=await read(p.visibility._record('visibility').handle,'rgba16float','visibility');
    result.inputHashes={g0:g0.sha256,g1:g1.sha256,g2:g2.sha256,composedVisibility:visibility.sha256};
    const points=new Set(),point=(x,y)=>{x=Math.max(0,Math.min(w-1,Math.round(x)));y=Math.max(0,Math.min(h-1,Math.round(y)));const i=y*w+x;if(g0.pixel(i)[3]>.002)points.add(i)};
    for(const light of lights.slice(0,3))for(const [dx,dy]of [[12,0],[32,0],[64,0],[128,0],[256,0],[480,0],[0,24],[0,-24]])point(light.position[0]+dx,light.position[1]+dy);
    let emissivePixels=0,aoPixels=0,firstEmissive=null,firstAO=null;
    for(let i=0;i<count;i++){const material=g2.pixel(i);if(material[3]>0){emissivePixels++;if(firstEmissive===null)firstEmissive=i}if(material[2]<.99){aoPixels++;if(firstAO===null)firstAO=i}}
    for(const i of [firstEmissive,firstAO])if(i!==null&&g0.pixel(i)[3]>.002)points.add(i);
    result.materialCoverage={emissivePixels,aoPixels,emissiveNumericControl:emissivePixels?'actual material samples':'NOT RUN: this scene has no emissive material; deterministic CPU test only'};
    for(let y=1;y<=6;y++)for(let x=1;x<=8;x++)point(w*x/9,h*y/7);
    const samplePoints=[...points].slice(0,64);if(samplePoints.length<32)throw new Error('insufficient covered sample controls');
    result.samples=samplePoints.map(i=>({index:i,xy:[i%w,Math.floor(i/w)],sample:{g0:g0.pixel(i),g1:g1.pixel(i),g2:g2.pixel(i)},ambientVisibility:visibility.pixel(i)[2],states:{}}));
    result.sourceLights=JSON.parse(JSON.stringify(lights));result.settings=JSON.parse(JSON.stringify(settings));
    const mask=d.createTexture({label:'SM505:diagnostic-constant-visibility',size:{width:1,height:1},format:'rgba16float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});resources.push(mask);
    const setMask=value=>{const half=value===1?0x3c00:value===.5?0x3800:0;q.writeTexture({texture:mask},new Uint16Array([0x3c00,half,0x3c00,0x3c00]),{bytesPerRow:8},{width:1,height:1})};
    const targetId=(lights.find(l=>l.type==='cone')||lights[0]).id,otherIds=lights.filter(l=>l.id!==targetId).map(l=>l.id);
    const configs=[{name:'neutral',batches:[{ids:lights.map(l=>l.id),visibility:1}]},{name:'half',batches:[{ids:lights.map(l=>l.id),visibility:.5}]},{name:'zero-direct',batches:[{ids:lights.map(l=>l.id),visibility:0}]},{name:'target-masked',batches:[{ids:[targetId],visibility:0},{ids:otherIds,visibility:1}]}];
    result.controls={targetId,states:configs,boundary:'Constant1x1visibility inputs isolate genuine derived WGSL on actual game material/light state. These controls never replace release settings or presented screenshots.'};
    const outputs={};let maxError=0;
    for(const config of configs){
      console.log('SM-505 visibility control: '+config.name);let first=true;
      for(const batch of config.batches){setMask(batch.visibility);await p.lighting.accumulateDirect(p.gb,P.lightSubset(native,batch.ids),settings,{visibilityView:mask.createView(),clear:first,wait:false});first=false}
      await p.lighting.resolveDirect(p.gb,native,settings,{ambientVisibilityView:p.visibility.bindings().visibility,wait:false});
      outputs[config.name]=await read(p.lighting.outputTexture(),'rgba16float','visibility-'+config.name,true);
      for(const entry of result.samples){
        const raw=[0,0,0],pixelCenter=[entry.xy[0]+.5,entry.xy[1]+.5];for(const batch of config.batches){const ids=new Set(batch.ids),direct=L.shadeDirectReference(entry.sample,lights.filter(l=>ids.has(l.id)),settings,pixelCenter,batch.visibility);for(let c=0;c<3;c++)raw[c]+=direct[c]}
        const expected=L.resolveDirectReference(entry.sample,raw,settings,entry.ambientVisibility),actual=outputs[config.name].pixel(entry.index),error=Math.max(...actual.map((v,c)=>Math.abs(v-expected[c])));maxError=Math.max(maxError,error);
        entry.states[config.name]={rawDirect:raw,expected,actual,maxAbsError:error};
      }
    }
    check(maxError<=.003,'actual derived raw-direct and final-resolve WGSL agrees with source CPU equations',{samples:result.samples.length,states:configs.length,maxAbsError:maxError,tolerance:.003});
    const retained=result.samples.filter(s=>s.states['target-masked'].actual.slice(0,3).some((v,c)=>v>s.states['zero-direct'].actual[c]+.0001));
    check(otherIds.length===0||retained.length>0,'masking only the driver preserves unrelated actual light contributions',{otherIds,nonzeroUnaffectedSamples:retained.length});
    check(result.samples.every(s=>s.states.neutral.actual.slice(0,3).every((v,c)=>v+.003>=s.states.half.actual[c]&&s.states.half.actual[c]+.003>=s.states['zero-direct'].actual[c])),'direct-mask controls are monotonic; ambient/emissive survive zero direct');
    check(JSON.stringify(p.lighting.lastLights.map(l=>l.id))===JSON.stringify(lights.map(l=>l.id)),'final resolve restores complete canonical light identity');
    const error=await d.popErrorScope();opened=false;if(error)throw new Error('visibility probe validation: '+error.message);
    await p._render(scene);await q.onSubmittedWorkDone();result.restored=true;
    result.ok=result.checks.every(c=>c.ok);
  }catch(error){result.errors.push(String(error?.stack||error))}
  finally{
    if(opened){try{const error=await d.popErrorScope();if(error)result.errors.push('validation: '+error.message)}catch(error){result.errors.push(String(error))}}
    for(const resource of resources)resource.destroy();
  }
  result.ok=result.ok&&result.errors.length===0;result.boundary='Numeric diagnostic controls and source-matched actual materials/lights; no visual acceptance or GPU timings. Failed controls are retained without retry.';return result;
}
