'use strict';

// Diagnostic observer only: invoked after a frozen normal index.html frame.
// Readbacks and replayed post/debug passes are excluded from performance evidence.
async function sm505CaptureStages() {
  const r=globalThis.steelMothBackendRuntime,p=r.presenter;
  if(r.presentationBackend!=='webgpu'||!p?.ready||p.rendering)throw new Error('capture requires an idle, ready WebGPU presenter');
  const d=p.device,q=d.queue,w=p.width,h=p.height,items=[];
  const base64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s)};
  async function read(name,texture,format,kind){
    const width=texture.width,height=texture.height;
    const bytesPerPixel=format==='rgba16float'?8:4,rowBytes=Math.ceil(width*bytesPerPixel/256)*256;
    const b=d.createBuffer({label:`SM505:capture:${name}`,size:rowBytes*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
      const enc=d.createCommandEncoder();enc.copyTextureToBuffer({texture},{buffer:b,bytesPerRow:rowBytes,rowsPerImage:height},{width,height});q.submit([enc.finish()]);
      await b.mapAsync(GPUMapMode.READ);const data=new Uint8Array(b.getMappedRange()).slice();b.unmap();
      items.push({name,format,kind,width,height,rowBytes,base64:base64(data)});
    }finally{b.destroy()}
  }
  d.pushErrorScope('validation');
  try{
    await read('gbuffer-albedo',p.gb._record('g0').handle,'rgba8unorm','linear-rgb');
    await read('gbuffer-normal-roughness',p.gb._record('g1').handle,'rgba16float','numeric');
    await read('gbuffer-height-material',p.gb._record('g2').handle,'rgba16float','numeric');
    await read('object-id',p.gb._record('object').handle,'r32uint','object-id');
    await read('raw-lighting',p.lighting.outputTexture(),'rgba16float','linear-rgb');
    await read('pre-postprocessing',p.world,'rgba16float','linear-rgb');
    await p.post._ensureOutputPipeline('rgba8unorm');
    for(const raw of [false,true]){
      const target=d.createTexture({label:'SM505:post-diagnostic',size:{width:w,height:h},format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
      try{
        const enc=d.createCommandEncoder();p.post.render({encoder:enc,sceneView:p.world.createView(),outputView:target.createView(),settings:game.renderScene.settings,grade:game.renderScene.post?.grade||[1,1,1],raw,outputFormat:'rgba8unorm'});q.submit([enc.finish()]);
        await read(raw?'raw-display':'final-postprocessed',target,'rgba8unorm','display-rgb');
      }finally{target.destroy()}
    }
    // Preserve the forward-composited pre-post target above before diagnostic replay.
    p._opaqueComposite();await read('opaque-composition',p.world,'rgba16float','linear-rgb');
    const debug=d.createTexture({label:'SM505:depth-diagnostic',size:{width:w,height:h},format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    try{await p.gb.renderDebug(debug,'depth');await read('ownership-depth',debug,'rgba8unorm','numeric-display')}finally{debug.destroy()}
    // Fixed binary16 values isolate canonical grading from scene/light inputs.
    // These are diagnostic witnesses, never replacement artistic settings.
    const inputWords=[0x2e66,0x3000,0x3029,0x31c3,0x3800,0x3c00,0,0];
    const pixels=new Uint16Array(8*4);inputWords.forEach((v,i)=>{pixels.set([v,v,v,0x3c00],i*4)});
    const source=d.createTexture({label:'SM505:post-blackout-input',size:{width:8,height:1},format:'rgba16float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
    const probe=new p.api.Post.WebGPUPost({device:d,width:8,height:1,outputFormat:'rgba8unorm'});
    try{
      q.writeTexture({texture:source},pixels,{bytesPerRow:64},{width:8,height:1});await probe.initialize();
      for(const raw of [false,true]){
        const output=d.createTexture({label:'SM505:post-blackout-output',size:{width:8,height:1},format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
        try{
          const enc=d.createCommandEncoder();probe.render({encoder:enc,sceneView:source.createView(),outputView:output.createView(),settings:{bloom:false,grain:0,vignette:0},grade:[1,1,1],raw});q.submit([enc.finish()]);
          await read(raw?'post-probe-raw':'post-probe-final',output,'rgba8unorm','display-rgb');
        }finally{output.destroy()}
      }
    }finally{probe.close();source.destroy()}
    await q.onSubmittedWorkDone();
  }finally{
    const error=await d.popErrorScope();if(error)throw new Error(`stage capture validation: ${error.message}`);
  }
  return {items,postProbe:{inputHalfWords:[0x2e66,0x3000,0x3029,0x31c3,0x3800,0x3c00,0,0],settings:{bloom:false,grain:0,vignette:0},grade:[1,1,1],productionDefaults:p.api.Post.DEFAULTS,meaning:'Known-failure diagnostic for default grading on linear HDR, not visual acceptance.'},scene:game.renderScene,runtime:r.diagnostics(),lighting:p.lighting.diagnostics(),post:p.post.diagnostics(),visibility:p.visibility.diagnostics(),
    boundary:'Actual production target readbacks, plus source-identical diagnostic post/depth replays. Observer work is not performance evidence; depth PNG is quantized debug, original ownership IDs are retained.'};
}
