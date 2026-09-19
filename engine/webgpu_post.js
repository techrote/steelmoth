'use strict';

(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUPost=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  const SCHEMA='steelmoth-webgpu-post/v1';
  const DEFAULTS=Object.freeze({
    bloom:true,bloomIntensity:1.0,bloomThreshold:.70,bloomQuality:1,
    saturation:1.20,gradeMix:.25,vignette:.065,grain:.0006,exposure:1.60,
    brightness:0.0,contrast:1.12,gamma:1.0,gradeTemperature:0.0,gradeTint:0.0,
    shadowLift:-.10,highlightGain:.80
  });
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
  const lum=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
  const linearChannelToSrgb=v=>{v=Math.max(0,finite(v,0));return v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055};
  const linearToSrgb=value=>{const v=Array.isArray(value)?value:[value,value,value];return [linearChannelToSrgb(v[0]),linearChannelToSrgb(v[1]),linearChannelToSrgb(v[2])]};
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,COPY_DST:0x02,TEXTURE_BINDING:0x04,STORAGE_BINDING:0x08,RENDER_ATTACHMENT:0x10});
  const FALLBACK_BUFFER_USAGE=Object.freeze({COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040});
  const textureUsage=(...n)=>n.reduce((v,k)=>v|Number(root?.GPUTextureUsage?.[k]??FALLBACK_TEXTURE_USAGE[k]??0),0);
  const bufferUsage=(...n)=>n.reduce((v,k)=>v|Number(root?.GPUBufferUsage?.[k]??FALLBACK_BUFFER_USAGE[k]??0),0);

  function normalizeSettings(s={}){
    return {
      bloom:s.bloom!==false,
      bloomIntensity:clamp(finite(s.bloomIntensity,DEFAULTS.bloomIntensity),0,4),
      bloomThreshold:clamp(finite(s.bloomThreshold,DEFAULTS.bloomThreshold),0,4),
      bloomQuality:clamp(Math.round(finite(s.bloomQuality,DEFAULTS.bloomQuality)),0,3),
      saturation:clamp(finite(s.saturation,DEFAULTS.saturation),0,3),
      gradeMix:clamp(finite(s.gradeMix,DEFAULTS.gradeMix),0,1),
      vignette:clamp(finite(s.vignette,DEFAULTS.vignette),0,1),
      grain:clamp(finite(s.grain,DEFAULTS.grain),0,.08),
      exposure:clamp(finite(s.exposure,DEFAULTS.exposure),0,6),
      brightness:clamp(finite(s.brightness,DEFAULTS.brightness),-1,1),
      contrast:clamp(finite(s.contrast,DEFAULTS.contrast),.05,4),
      gamma:clamp(finite(s.gamma,DEFAULTS.gamma),.10,4),
      gradeTemperature:clamp(finite(s.gradeTemperature,DEFAULTS.gradeTemperature),-1,1),
      gradeTint:clamp(finite(s.gradeTint,DEFAULTS.gradeTint),-1,1),
      shadowLift:clamp(finite(s.shadowLift,DEFAULTS.shadowLift),-1,1),
      highlightGain:clamp(finite(s.highlightGain,DEFAULTS.highlightGain),-1,3)
    };
  }
  function bloomPassesForQuality(q){return clamp(Math.round(finite(q,DEFAULTS.bloomQuality)),0,3)}
  function noiseAt(x,y){return ((Math.sin(x*12.9898+y*78.233)*43758.5453)%1+1)%1-.5}
  function applyPostReference(scene,bloom=[0,0,0],settings={},grade=[1,1,1],uv=[.5,.5],frag=[.5,.5]){
    const s=normalizeSettings(settings), c=[scene[0],scene[1],scene[2]];
    if(s.bloom)for(let i=0;i<3;i++)c[i]+=finite(bloom[i])*s.bloomIntensity;
    const l=lum(c);for(let i=0;i<3;i++)c[i]=l+(c[i]-l)*s.saturation;
    for(let i=0;i<3;i++)c[i]=c[i]*(1-s.gradeMix)+(c[i]*finite(grade[i],1)*1.25)*s.gradeMix;
    const temp=s.gradeTemperature,tint=s.gradeTint;
    c[0]*=1+.12*temp;c[1]*=1+.06*tint;c[2]*=1-.12*temp;
    c[0]+=.015*tint;c[1]+=-.010*Math.abs(tint);c[2]+=-.010*tint;
    const pre=clamp(lum(c),0,1), lift=s.shadowLift*(1-smoothstep(.18,.62,pre)), gain=1+s.highlightGain*smoothstep(.38,.92,pre);
    for(let i=0;i<3;i++)c[i]=(c[i]+lift)*gain;
    const qx=uv[0]-.5,qy=uv[1]-.5,edge=smoothstep(.12,.56,qx*qx+qy*qy);
    for(let i=0;i<3;i++){
      c[i]*=1-edge*s.vignette;
      c[i]=1-Math.exp(-Math.max(c[i],0)*s.exposure);
      c[i]=(c[i]-.5)*Math.max(.05,s.contrast)+.5+s.brightness;
      c[i]=Math.pow(Math.max(c[i],0),1/Math.max(.10,s.gamma));
      c[i]+=noiseAt(frag[0],frag[1])*s.grain;
      c[i]=linearChannelToSrgb(Math.max(c[i],0));
    }
    return c;
  }
  function packPostSettings(settings={},grade=[1,1,1],extent=[1,1]){
    const s=normalizeSettings(settings), f=new Float32Array(24);
    f.set([s.bloom?1:0,s.bloomIntensity,s.saturation,s.gradeMix],0);
    f.set([s.vignette,s.grain,s.exposure,s.brightness],4);
    f.set([s.contrast,s.gamma,s.gradeTemperature,s.gradeTint],8);
    f.set([s.shadowLift,s.highlightGain,0,0],12);
    f.set([finite(grade[0],1),finite(grade[1],1),finite(grade[2],1),1],16);
    f.set([Math.max(1,finite(extent[0],1)),Math.max(1,finite(extent[1],1)),0,0],20);
    return f;
  }

  const FULLSCREEN_WGSL=`
struct Vout{@builtin(position) pos:vec4f,@location(0) uv:vec2f};
@vertex fn vs_main(@builtin(vertex_index) i:u32)->Vout{
  let q=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));let v=q[i];
  var o:Vout;o.pos=vec4f(v,0,1);o.uv=vec2f((v.x+1.0)*.5,(1.0-v.y)*.5);return o;
}`;
  const BRIGHT_WGSL=FULLSCREEN_WGSL+`
struct Bright{threshold:vec4f};
@group(0) @binding(0) var samp:sampler;
@group(0) @binding(1) var src:texture_2d<f32>;
@group(0) @binding(2) var<uniform> p:Bright;
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f{
  let c=textureSample(src,samp,uv);
  let b=dot(c.rgb,vec3f(.2126,.7152,.0722));let x=max(b-p.threshold.x,0.0);let knee=.12;
  let k=(x*x)/(x+knee+1e-4);let scale=k/max(b,1e-3);return vec4f(c.rgb*scale,1);
}`;
  const BLUR_WGSL=FULLSCREEN_WGSL+`
struct Blur{dir:vec4f};
@group(0) @binding(0) var samp:sampler;
@group(0) @binding(1) var src:texture_2d<f32>;
@group(0) @binding(2) var<uniform> p:Blur;
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f{
  let d=p.dir.xy;
  var c=textureSample(src,samp,uv).rgb*.227027;
  c+=textureSample(src,samp,uv+d*1.384615).rgb*.316216;
  c+=textureSample(src,samp,uv-d*1.384615).rgb*.316216;
  c+=textureSample(src,samp,uv+d*3.230769).rgb*.070270;
  c+=textureSample(src,samp,uv-d*3.230769).rgb*.070270;
  return vec4f(c,1);
}`;
  const POST_WGSL=FULLSCREEN_WGSL+`
struct Post{p0:vec4f,p1:vec4f,p2:vec4f,p3:vec4f,grade:vec4f,extent:vec4f};
@group(0) @binding(0) var samp:sampler;
@group(0) @binding(1) var scene:texture_2d<f32>;
@group(0) @binding(2) var bloom:texture_2d<f32>;
@group(0) @binding(3) var<uniform> p:Post;
fn luminance(c:vec3f)->f32{return dot(c,vec3f(.2126,.7152,.0722));}
fn linear_to_srgb(c:vec3f)->vec3f{let x=max(c,vec3f(0));let lo=x*12.92;let hi=1.055*pow(x,vec3f(1.0/2.4))-.055;return select(hi,lo,x<=vec3f(.0031308));}
@fragment fn fs_main(@builtin(position) frag:vec4f,@location(0) uv:vec2f)->@location(0) vec4f{
  var c=textureSample(scene,samp,uv).rgb;let b=textureSample(bloom,samp,uv).rgb;
  c+=b*p.p0.y*p.p0.x;let l=luminance(c);c=mix(vec3f(l),c,p.p0.z);c=mix(c,c*p.grade.rgb*1.25,p.p0.w);
  let temp=clamp(p.p2.z,-1.0,1.0);let tint=clamp(p.p2.w,-1.0,1.0);
  c*=vec3f(1.0+.12*temp,1.0+.06*tint,1.0-.12*temp);c+=vec3f(.015*tint,-.010*abs(tint),-.010*tint);
  let preL=clamp(luminance(c),0.0,1.0);c+=vec3f(p.p3.x*(1.0-smoothstep(.18,.62,preL)));c*=1.0+p.p3.y*smoothstep(.38,.92,preL);
  let q=uv-.5;let edge=smoothstep(.12,.56,dot(q,q));c*=1.0-edge*p.p1.x;c=vec3f(1.0)-exp(-max(c,vec3f(0))*p.p1.z);
  c=(c-.5)*max(.05,p.p2.x)+.5+p.p1.w;c=pow(max(c,vec3f(0)),vec3f(1.0/max(.10,p.p2.y)));
  let n=fract(sin(dot(frag.xy,vec2f(12.9898,78.233)))*43758.5453)-.5;c+=n*p.p1.y;
  return vec4f(linear_to_srgb(c),1);
}`;
  const RAW_WGSL=FULLSCREEN_WGSL+`
@group(0) @binding(0) var scene:texture_2d<f32>;
@fragment fn fs_main(@builtin(position) frag:vec4f)->@location(0) vec4f{
  let p=vec2i(floor(frag.xy));let c=textureLoad(scene,p,0);let x=max(c.rgb,vec3f(0));let lo=x*12.92;let hi=1.055*pow(x,vec3f(1.0/2.4))-.055;return vec4f(select(hi,lo,x<=vec3f(.0031308)),c.a);
}`;

  class WebGPUPost{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUPost requires GPUDevice');
      this.device=options.device;this.queue=options.queue||options.device.queue;
      this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));
      this.intermediateFormat=String(options.intermediateFormat||'rgba16float');
      this.outputFormat=String(options.outputFormat||'bgra8unorm');
      this.labelPrefix=String(options.labelPrefix||'SteelMothPost');
      this.initialized=false;this.compilation=[];this.finalPipelines=new Map();this.rawPipelines=new Map();
      this.renderCounts={bright:0,blur:0,final:0,raw:0};this.lastSettings=null;this.lastError=null;
    }
    async _module(code,label){
      const module=this.device.createShaderModule({label:`${this.labelPrefix}:${label}`,code});
      const info=await module.getCompilationInfo(),messages=Array.from(info.messages||[]).map(x=>({type:x.type,message:x.message,lineNum:x.lineNum,linePos:x.linePos}));
      this.compilation.push({label,messages});const errors=messages.filter(x=>x.type==='error');
      if(errors.length)throw new Error(`${label} WGSL: ${errors.map(x=>x.message).join('; ')}`);return module;
    }
    _target(format){return[{format}]}
    async initialize(){
      if(this.initialized)return this;
      try{
        this.brightModule=await this._module(BRIGHT_WGSL,'bright');this.blurModule=await this._module(BLUR_WGSL,'blur');this.postModule=await this._module(POST_WGSL,'post');this.rawModule=await this._module(RAW_WGSL,'raw');
        this.sampler=this.device.createSampler({label:`${this.labelPrefix}:linear`,magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
        this.brightBuffer=this.device.createBuffer({label:`${this.labelPrefix}:bright-params`,size:16,usage:bufferUsage('UNIFORM','COPY_DST')});
        this.blurHBuffer=this.device.createBuffer({label:`${this.labelPrefix}:blur-h-params`,size:16,usage:bufferUsage('UNIFORM','COPY_DST')});
        this.blurVBuffer=this.device.createBuffer({label:`${this.labelPrefix}:blur-v-params`,size:16,usage:bufferUsage('UNIFORM','COPY_DST')});
        this.postBuffer=this.device.createBuffer({label:`${this.labelPrefix}:post-params`,size:96,usage:bufferUsage('UNIFORM','COPY_DST')});
        this.brightPipeline=await this.device.createRenderPipelineAsync({label:`${this.labelPrefix}:bright`,layout:'auto',vertex:{module:this.brightModule,entryPoint:'vs_main'},fragment:{module:this.brightModule,entryPoint:'fs_main',targets:this._target(this.intermediateFormat)},primitive:{topology:'triangle-list'}});
        this.blurPipeline=await this.device.createRenderPipelineAsync({label:`${this.labelPrefix}:blur`,layout:'auto',vertex:{module:this.blurModule,entryPoint:'vs_main'},fragment:{module:this.blurModule,entryPoint:'fs_main',targets:this._target(this.intermediateFormat)},primitive:{topology:'triangle-list'}});
        await this._ensureOutputPipeline(this.outputFormat);this._allocate();this.initialized=true;return this;
      }catch(e){this.lastError=String(e?.message||e);throw e}
    }
    async _ensureOutputPipeline(format){
      format=String(format||this.outputFormat);if(this.finalPipelines.has(format))return;
      this.finalPipelines.set(format,await this.device.createRenderPipelineAsync({label:`${this.labelPrefix}:final:${format}`,layout:'auto',vertex:{module:this.postModule,entryPoint:'vs_main'},fragment:{module:this.postModule,entryPoint:'fs_main',targets:this._target(format)},primitive:{topology:'triangle-list'}}));
      this.rawPipelines.set(format,await this.device.createRenderPipelineAsync({label:`${this.labelPrefix}:raw:${format}`,layout:'auto',vertex:{module:this.rawModule,entryPoint:'vs_main'},fragment:{module:this.rawModule,entryPoint:'fs_main',targets:this._target(format)},primitive:{topology:'triangle-list'}}));
    }
    _allocate(){
      this._destroyTextures();const w=Math.max(2,this.width>>1),h=Math.max(2,this.height>>1),usage=textureUsage('RENDER_ATTACHMENT','TEXTURE_BINDING','COPY_SRC');
      this.bloomA=this.device.createTexture({label:`${this.labelPrefix}:bloom-a`,size:[w,h],format:this.intermediateFormat,usage});
      this.bloomB=this.device.createTexture({label:`${this.labelPrefix}:bloom-b`,size:[w,h],format:this.intermediateFormat,usage});
      this.bloomWidth=w;this.bloomHeight=h;
      this.queue.writeBuffer(this.blurHBuffer,0,new Float32Array([1/w,0,0,0]));
      this.queue.writeBuffer(this.blurVBuffer,0,new Float32Array([0,1/h,0,0]));
    }
    resize(width,height){width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));if(width===this.width&&height===this.height)return false;this.width=width;this.height=height;if(this.initialized)this._allocate();return true}
    _pass(encoder,label,view,pipeline,bindGroup,loadOp='clear'){
      const pass=encoder.beginRenderPass({label,colorAttachments:[{view,loadOp,storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);pass.draw(3);pass.end();
    }
    render({encoder,sceneView,outputView,settings={},grade=[1,1,1],raw=false,debugBypass=false,outputFormat=null}={}){
      if(!this.initialized)throw new Error('initialize() must complete before render');if(!encoder||!sceneView||!outputView)throw new Error('encoder, sceneView and outputView are required');
      const format=String(outputFormat||this.outputFormat);const finalPipeline=this.finalPipelines.get(format),rawPipeline=this.rawPipelines.get(format);if(!finalPipeline||!rawPipeline)throw new Error(`output format ${format} not initialized`);
      const bypass=!!(raw||debugBypass);if(bypass){
        const bg=this.device.createBindGroup({layout:rawPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:sceneView}]});this._pass(encoder,`${this.labelPrefix}:raw-pass`,outputView,rawPipeline,bg);this.renderCounts.raw++;return{raw:true,bloomPasses:0};
      }
      const s=normalizeSettings(settings),passes=bloomPassesForQuality(s.bloomQuality);this.lastSettings=s;
      if(s.bloom){
        this.queue.writeBuffer(this.brightBuffer,0,new Float32Array([s.bloomThreshold,0,0,0]));
        let bg=this.device.createBindGroup({layout:this.brightPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:sceneView},{binding:2,resource:{buffer:this.brightBuffer}}]});
        this._pass(encoder,`${this.labelPrefix}:bright-pass`,this.bloomA.createView(),this.brightPipeline,bg);this.renderCounts.bright++;
        for(let i=0;i<passes;i++){
          bg=this.device.createBindGroup({layout:this.blurPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:this.bloomA.createView()},{binding:2,resource:{buffer:this.blurHBuffer}}]});
          this._pass(encoder,`${this.labelPrefix}:blur-h-${i}`,this.bloomB.createView(),this.blurPipeline,bg);this.renderCounts.blur++;
          bg=this.device.createBindGroup({layout:this.blurPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:this.bloomB.createView()},{binding:2,resource:{buffer:this.blurVBuffer}}]});
          this._pass(encoder,`${this.labelPrefix}:blur-v-${i}`,this.bloomA.createView(),this.blurPipeline,bg);this.renderCounts.blur++;
        }
      }
      this.queue.writeBuffer(this.postBuffer,0,packPostSettings(s,grade,[this.width,this.height]));
      const bg=this.device.createBindGroup({layout:finalPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:sceneView},{binding:2,resource:this.bloomA.createView()},{binding:3,resource:{buffer:this.postBuffer}}]});
      this._pass(encoder,`${this.labelPrefix}:final-pass`,outputView,finalPipeline,bg);this.renderCounts.final++;return{raw:false,bloomPasses:s.bloom?passes:0};
    }
    diagnostics(){return{schema:SCHEMA,extent:{width:this.width,height:this.height},bloomExtent:{width:this.bloomWidth,height:this.bloomHeight},intermediateFormat:this.intermediateFormat,outputFormat:this.outputFormat,compatibilityBloomQuality:DEFAULTS.bloomQuality,qualityPasses:[0,1,2,3],renderCounts:{...this.renderCounts},lastSettings:this.lastSettings?{...this.lastSettings}:null,compilation:JSON.parse(JSON.stringify(this.compilation)),rawBypass:'scene -> output; bloom/grade/post skipped',lightingBoundary:'SM-204 supplies already-lit scene; SM-207 does not multiply a second light map',colorSpaceBoundary:'scene+bloom+grading are linear/HDR; final and raw presentation apply IEC sRGB transfer exactly once into an sRGB canvas',fallback:'WebGL2 compatibility renderer remains authoritative until SM-505 promotion',lastError:this.lastError}}
    _destroyTextures(){for(const t of [this.bloomA,this.bloomB])try{t?.destroy()}catch(_e){}}
    close(){this._destroyTextures();for(const b of [this.brightBuffer,this.blurHBuffer,this.blurVBuffer,this.postBuffer])try{b?.destroy()}catch(_e){}}
  }
  function preferredCanvasFormat(){try{return root?.navigator?.gpu?.getPreferredCanvasFormat?.()||'bgra8unorm'}catch(_e){return'bgra8unorm'}}
  return{SCHEMA,DEFAULTS,BRIGHT_WGSL,BLUR_WGSL,POST_WGSL,RAW_WGSL,normalizeSettings,bloomPassesForQuality,linearChannelToSrgb,linearToSrgb,applyPostReference,packPostSettings,preferredCanvasFormat,WebGPUPost};
});
