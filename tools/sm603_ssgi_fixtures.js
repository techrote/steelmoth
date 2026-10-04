'use strict';
(function(root,factory){const F=root?.SteelMothSM602Fixtures||(typeof module==='object'&&module.exports?require('./sm602_ssgi_fixtures.js'):null),api=factory(F,root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SteelMothSM603Fixtures=api;})(typeof globalThis!=='undefined'?globalThis:this,(F,root)=>{
  const BASELINE_COMMIT='34b63f0255c53a40485bab66f5b341c150ef2c42';
  const BASELINE_SHA256='5108e3de85daab4a3fcd4e248c8254bb3913a2ecbc5d2999c2068c56fb4ddf48';
  function partialDeletion(revealBlocker=false){
    const f=F.createFixture();for(let y=0;y<f.height;y++)for(let x=33;x<37;x++){
      const i=y*f.width+x,z=revealBlocker?48:0;f.object[i]=revealBlocker?9:7;f.depth[i*2]=f.depth[i*2+1]=(3072-y-z)/5120;f.material[i*4]=z/64;f.colour.set(revealBlocker?[0,0,0,1]:[.09,.11,.12,1],i*4);
    }
    f.metadata={...f.metadata,kind:revealBlocker?'reveal-nearer-dark-blocker':'partial-donor-deletion',changedColumns:[33,36],remainingDonorColumns:[37,48],witnessQuarter:{x:7,y:1,index:24},witnessNative:{x:30,y:6},receiverGeometryUnchanged:true};return f;
  }
  function benchmarkFixture(scene='representative',width=1920,height=1080){
    const f=F.createFixture(width,height,'empty');let occupied=0,donors=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,donor=scene==='dense'?((Math.floor(x/48)+Math.floor(y/48))%3===0):(x%288>=120&&x%288<168&&y%240>=48&&y%240<192),z=donor?32:0;
      f.object[i]=donor?8:7;f.depth[i*2]=f.depth[i*2+1]=(3072-y-z)/5120;f.material.set([z/64,0,1,0],i*4);f.albedo.set([.32,.34,.36,1],i*4);f.colour.set(donor?[3,.4,.1,1]:[.09,.11,.12,1],i*4);occupied++;if(donor)donors++;
    }
    f.metadata={...f.metadata,kind:scene,extent:{width,height},occupiedPixels:occupied,donorPixels:donors,pixelScale:width/640,boundary:'Fixed synthetic canonical attachment workload; scene names describe occupancy/material layout, not gameplay throughput.'};return f;
  }
  function input(current,previous=current,prior={},meta=F.META,previousMeta=meta){return{...F.input(current,previous,{previousIndirect:prior.indirect,historyValid:prior.historyValid??true,currentMeta:meta,previousMeta}),previousDonorCoordinates:prior.donorCoordinates};}
  function halfBits(value){if(!Number.isFinite(value)||Math.abs(value)>65504)throw new RangeError('Fixture value must be finite binary16');const u=new Uint32Array(new Float32Array([value]).buffer)[0],sign=(u>>>16)&0x8000;let e=((u>>>23)&255)-127+15,m=u&0x7fffff;if(e<=0){if(e< -10)return sign;m|=0x800000;const shift=14-e,base=m>>>shift,rem=m&((1<<shift)-1),tie=1<<(shift-1);return sign|(base+((rem>tie||(rem===tie&&(base&1)))?1:0));}let base=m>>>13,rem=m&8191;if(rem>4096||(rem===4096&&(base&1)))base++;if(base===1024){e++;base=0;}return sign|(e<<10)|base;}
  const fromHalf=v=>{const sign=v&0x8000?-1:1,e=(v>>>10)&31,m=v&1023;return sign*(e===0?m*2**-24:e===31?(m?NaN:Infinity):(1+m/1024)*2**(e-15));};
  function quantize(f){for(const key of ['normal','albedo','material','colour'])for(let i=0;i<f[key].length;i++)f[key][i]=fromHalf(halfBits(f[key][i]));return f;}
  const maxDiff=(a,b)=>a.length===b.length?a.reduce((v,x,i)=>Math.max(v,Math.abs(x-b[i])),0):Infinity;
  const arrayHash=async values=>Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',values.buffer.slice(values.byteOffset,values.byteOffset+values.byteLength))),v=>v.toString(16).padStart(2,'0')).join('');
  function write(device,texture,array,width,height,bpp){const bpr=Math.ceil(width*bpp/256)*256,raw=new Uint8Array(bpr*height),src=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);for(let y=0;y<height;y++)raw.set(src.subarray(y*width*bpp,(y+1)*width*bpp),y*bpr);device.queue.writeTexture({texture},raw,{bytesPerRow:bpr,rowsPerImage:height},{width,height,depthOrArrayLayers:1});}
  async function createGPUFixture(device,f,options={}){
    const owned=options.owned||[],width=f.width,height=f.height,usage=root.GPUTextureUsage.COPY_DST|root.GPUTextureUsage.COPY_SRC|root.GPUTextureUsage.TEXTURE_BINDING;
    const texture=(name,format)=>{const t=device.createTexture({label:'SM603 fixture '+name,size:[width,height],format,usage});owned.push(t);return t;};
    const depthSource=texture('depth upload','r32float'),object=texture('ownership','r32uint'),normal=texture('G1','rgba16float'),albedo=texture('G0','rgba16float'),material=texture('G2','rgba16float'),colour=texture('direct-only HDR','rgba16float');
    const depth=device.createTexture({label:'SM603 canonical ownership depth',size:[width,height],format:'depth32float',usage:root.GPUTextureUsage.RENDER_ATTACHMENT|root.GPUTextureUsage.TEXTURE_BINDING|root.GPUTextureUsage.COPY_SRC});owned.push(depth);
    const code=`@group(0) @binding(0) var src:texture_2d<f32>;@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}@fragment fn fs(@builtin(position) p:vec4f)->@builtin(frag_depth) f32{return textureLoad(src,vec2i(p.xy),0).x;}`;
    const shader=options.compile?await options.compile('fixture-depth',code):device.createShaderModule({code}),pipeline=device.createRenderPipeline({layout:'auto',vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[]},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'always'},primitive:{topology:'triangle-list'}}),bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:depthSource.createView()}]});
    const hierarchy=new root.SteelMothWebGPUDepthHierarchy.WebGPUDepthHierarchy({device,width,height});owned.push({destroy:()=>hierarchy.close()});
    async function upload(frame){write(device,depthSource,Float32Array.from({length:width*height},(_,i)=>frame.depth[i*2]),width,height,4);write(device,object,frame.object,width,height,4);for(const [t,key]of [[normal,'normal'],[albedo,'albedo'],[material,'material'],[colour,'colour']])write(device,t,Uint16Array.from(frame[key],halfBits),width,height,8);const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();device.queue.submit([encoder.finish()]);await hierarchy.build({width,height,depthTexture:depth,objectIdTexture:object});}
    await upload(f);const source={width,height,pixelScale:options.pixelScale??1,depthHierarchy:hierarchy,normalView:normal.createView(),albedoView:albedo.createView(),materialView:material.createView(),objectView:object.createView(),currentResolvedColourView:colour.createView()};
    return{width,height,hierarchy,source,upload,colour,object,normal,material,albedo,depth};
  }
  return{...F,BASELINE_COMMIT,BASELINE_SHA256,partialDeletion,benchmarkFixture,input,halfBits,fromHalf,quantize,maxDiff,arrayHash,write,createGPUFixture};
});
