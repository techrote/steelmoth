'use strict';

// Only the guarded native runner invokes this function. This is a synthetic
// production-shader supplement, never normal-game emissive/visual acceptance.
function sm505EmissiveHalf(value){
  if(!Number.isFinite(value)||Math.abs(value)>65504)throw new RangeError('finite half-float input required');
  const sign=value<0||Object.is(value,-0)?0x8000:0,v=Math.abs(value);if(v===0)return sign;
  const even=x=>{const n=Math.floor(x),f=x-n;return f>.5||f===.5&&n%2?n+1:n};
  if(v<2**-14)return sign|even(v/2**-24);
  const e=Math.floor(Math.log2(v));return sign|((e+15)*1024+even((v/2**e-1)*1024));
}

async function sm505EmissiveProbe(){
  const result={schema:'steelmoth-sm505-emissive-probe/v1',ok:false,physicalAcceptance:false,visualAcceptance:false,releaseAcceptance:false,
    normalGameMaterialEmissive:'NOT RUN',gpuTiming:'NOT RUN',checks:[],errors:[],items:[],cases:[],
    boundary:'SYNTHETIC 1x1 production-lighting shader supplement. It does not prove normal-game emissive material coverage, visual correctness, target performance or release acceptance.'};
  const p=globalThis.steelMothBackendRuntime?.presenter,game=globalThis.game;
  const L=globalThis.SteelMothWebGPULighting,R=globalThis.SteelMothWebGPUResources;
  if(!p?.ready||p.closed||p.rendering||p.pending||globalThis.steelMothBackendRuntime.presentationBackend!=='webgpu'||!game?.renderScene)throw new Error('emissive probe requires frozen idle actual-game WebGPU presenter');
  if(!L?.WebGPUDeferredLighting||!R?.ResourceRegistry)throw new Error('production lighting/resources unavailable');
  const original=game.renderScene,originalJSON=JSON.stringify(original),d=p.device,q=d.queue;
  const before={pending:p.pending,presentedFrames:p.presentedFrames,submittedFrames:p.submittedFrames,completedFrames:p.completedFrames};
  const check=(ok,label,details={})=>result.checks.push({ok:!!ok,label,...details});
  const base64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s)};
  const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const padded=(values,half=true)=>{const bytes=new Uint8Array(256),view=new DataView(bytes.buffer);values.forEach((v,i)=>half?view.setUint16(i*2,sm505EmissiveHalf(v),true):bytes[i]=v);return bytes};
  const decode=(bytes,format)=>Array.from({length:4},(_,i)=>format==='rgba8unorm'?bytes[i]/255:L.halfToFloat(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint16(i*2,true)));
  const difference=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
  const quantized=values=>decode(padded(values),'rgba16float');
  let registry,cache,lighting,staging,scopeOpen=false;
  async function retain(name,bytes,format,kind){const item={name,width:1,height:1,rowBytes:256,format,kind,byteLength:bytes.byteLength,sha256:await hash(bytes),base64:base64(bytes)};result.items.push(item);return{item:name,sha256:item.sha256,values:decode(bytes,format)}}
  async function read(name,texture,format='rgba16float',kind='linear-rgb'){
    const encoder=d.createCommandEncoder({label:'SM505:emissive-read:'+name});encoder.clearBuffer(staging);encoder.copyTextureToBuffer({texture},{buffer:staging,bytesPerRow:256,rowsPerImage:1},{width:1,height:1});q.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);let bytes;try{bytes=new Uint8Array(staging.getMappedRange()).slice(0,256)}finally{staging.unmap()}
    return retain(name,bytes,format,kind);
  }
  const settings={lighting:true,ambient:.18,normalStrength:1,heightStrength:1,roughnessScale:1,metalnessScale:1,materialAOStrength:.62,pbrSpecularStrength:.7,worldScale:1};
  const scene={lights:[{id:'synthetic:emissive-point',type:'point',x:.5,y:.5,z:22,radius:80,intensity:1,independent:true,color:[1,1,1]}],playerCone:null};
  const tests=[{name:'emissive-blocked',emissive:.5,g:0,b:1-(1-.25)*.62},{name:'nonemissive-blocked',emissive:0,g:0,b:1-(1-.25)*.62},
    {name:'emissive-visible',emissive:.5,g:1,b:1-(1-.25)*.62},{name:'emissive-ambient-zero',emissive:.5,g:0,b:0}];
  result.configuration={extent:[1,1],settings,scene,material:'synthetic uploaded linear G-buffer; not an authored gameplay asset',tolerance:.003};
  try{
    console.log('SM-505 emissive probe: SYNTHETIC production shader controls');
    d.pushErrorScope('validation');scopeOpen=true;
    registry=new R.ResourceRegistry({device:d,width:1,height:1,labelPrefix:'SM505:emissive-probe'});
    cache=new R.PipelineCache(d,{labelPrefix:'SM505:emissive-probe'});
    const inputUsage=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC;
    for(const [name,format] of [['g0','rgba8unorm'],['g1','rgba16float'],['g2','rgba16float']])registry.defineTexture('sm200:'+name,{format,usage:inputUsage,size:'surface'});
    registry.defineTexture('probe:visibility',{format:'rgba16float',usage:inputUsage,size:'surface'});
    staging=d.createBuffer({label:'SM505:emissive-staging',size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    lighting=new L.WebGPUDeferredLighting({device:d,registry,pipelines:cache,width:1,height:1,labelPrefix:'SM505:emissive-lighting'});
    await lighting.initializeStreamedDirect();const gb={registry};
    const upload=(name,bytes)=>q.writeTexture({texture:registry.require(name).handle},bytes,{bytesPerRow:256,rowsPerImage:1},{width:1,height:1});
    upload('sm200:g0',padded([102,51,26,255],false));upload('sm200:g1',padded([.5,.5,1,.5]));
    const g0=await read('input-g0',registry.require('sm200:g0').handle,'rgba8unorm','linear-rgb');
    const g1=await read('input-g1',registry.require('sm200:g1').handle,'rgba16float','numeric');
    const canonical=L.buildCanonicalLights(scene,settings);result.canonicalLights=canonical;
    for(const test of tests){
      upload('sm200:g2',padded([.25,0,.25,test.emissive]));upload('probe:visibility',padded([1,test.g,test.b,1]));
      const material=await read(test.name+'-input-g2',registry.require('sm200:g2').handle,'rgba16float','numeric');
      const mask=await read(test.name+'-input-mask',registry.require('probe:visibility').handle,'rgba16float','visibility-channels');
      const view=registry.require('probe:visibility').handle.createView();
      await lighting.accumulateDirect(gb,scene,settings,{visibilityView:view,clear:true,wait:false});
      const raw=await read(test.name+'-raw-direct',lighting.directAccumulationTexture());
      await lighting.resolveDirect(gb,scene,settings,{ambientVisibilityView:view,wait:false});
      const output=await read(test.name+'-resolved',lighting.outputTexture());
      const sample={g0:g0.values,g1:g1.values,g2:material.values};
      const expectedRaw=L.shadeDirectReference(sample,canonical,settings,[.5,.5],mask.values[1]);
      const expected=L.resolveDirectReference(sample,quantized(expectedRaw),settings,mask.values[2]);
      const row={name:test.name,material,mask,raw,output,expectedRaw,expected,rawError:difference(raw.values,expectedRaw),resolveError:difference(output.values,expected)};
      result.cases.push(row);
      check([...raw.values,...output.values].every(Number.isFinite),test.name+': finite original GPU readbacks');
      check(row.rawError<=.003&&row.resolveError<=.003,test.name+': production GPU versus quantized-input canonical CPU',{rawError:row.rawError,resolveError:row.resolveError,tolerance:.003});
    }
    const [on,off,visible,ambientZero]=result.cases,emission=g0.values.slice(0,3).map(v=>v*.5*.8);
    const delta=on.output.values.slice(0,3).map((v,i)=>v-off.output.values[i]);
    check(difference(delta,emission)<=.003&&emission.every(v=>v>.01),'emissive survives fully blocked direct visibility',{measuredDelta:delta,expectedDelta:emission});
    check(on.raw.values.slice(0,3).every(v=>v===0)&&visible.raw.values.slice(0,3).some(v=>v>.01),'G0/G1 negative and positive direct API controls',{blocked:on.raw.values,visible:visible.raw.values});
    const expectedAmbientDelta=g0.values.slice(0,3).map(v=>v*settings.ambient*.28*on.mask.values[2]);
    const ambientDelta=on.output.values.slice(0,3).map((v,i)=>v-ambientZero.output.values[i]);
    check(difference(ambientDelta,expectedAmbientDelta)<=.003,'composed ambient B is consumed once',{measuredDelta:ambientDelta,expectedDelta:expectedAmbientDelta});
    result.retainedNegativeWitness={policy:'Incorrect global G multiplication erases emissive and ambient',wrongGlobalG0:visible.output.values.map(v=>v*0),correctBlocked:on.output.values};
    check(on.output.values.slice(0,3).some(v=>v>.05),'old global-mask zero output contradicts the retained emissive-positive GPU control');
    result.compilation=lighting.compilation;result.resourcesBeforeCleanup=registry.diagnostics();
  }catch(error){result.errors.push(String(error?.stack||error))}
  finally{
    for(const [name,cleanup] of [['lighting',()=>lighting?.close()],['pipeline cache',()=>cache?.clear()],['staging',()=>staging?.destroy()],['registry',()=>registry?.close()]])try{cleanup()}catch(error){result.errors.push(name+' cleanup: '+String(error))}
    if(scopeOpen)try{const error=await d.popErrorScope();if(error)result.errors.push('WebGPU validation: '+String(error.message||error))}catch(error){result.errors.push('validation scope: '+String(error))}
    check(game.renderScene===original&&JSON.stringify(original)===originalJSON,'normal gameplay scene remains unchanged');
    check(p.pending===before.pending&&p.presentedFrames===before.presentedFrames&&p.submittedFrames===before.submittedFrames&&p.completedFrames===before.completedFrames,'normal presenter queue/counters remain unchanged');
  }
  result.ok=result.errors.length===0&&result.cases.length===tests.length&&result.checks.every(c=>c.ok);return result;
}
if(typeof module==='object'&&module.exports)module.exports={sm505EmissiveProbe,sm505EmissiveHalf};
