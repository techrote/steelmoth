'use strict';

(function(root,factory){
  const resources=root?.SteelMothWebGPUResources||((typeof module==='object'&&module.exports)?require('./webgpu_resources.js'):null);
  const api=factory(resources,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUValidation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,root){
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before webgpu_validation');

  const SCHEMA='steelmoth-webgpu-validation/v1';
  const REPORT_SCHEMA='steelmoth-webgpu-validation-report/v1';
  const FALLBACK_BUFFER_USAGE=Object.freeze({COPY_SRC:0x0004,COPY_DST:0x0008,UNIFORM:0x0040,STORAGE:0x0080});
  const FALLBACK_TEXTURE_USAGE=Object.freeze({COPY_SRC:0x01,COPY_DST:0x02,TEXTURE_BINDING:0x04,STORAGE_BINDING:0x08,RENDER_ATTACHMENT:0x10});
  const usageValue=(group,name,fallback)=>Number(root?.[group]?.[name]??fallback);
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const messageRecord=m=>({type:String(m?.type||'unknown'),message:String(m?.message||''),lineNum:Number(m?.lineNum||0),linePos:Number(m?.linePos||0),offset:Number(m?.offset||0),length:Number(m?.length||0)});
  const errorRecord=e=>({name:String(e?.name||'Error'),message:String(e?.message||e||'unknown error')});

  const SHADERS=Object.freeze([
    Object.freeze({
      id:'infrastructure-render-probe',
      purpose:'Production API/pipeline readiness probe; not a visual renderer pass.',
      entries:Object.freeze([{stage:'vertex',entryPoint:'vs_main'},{stage:'fragment',entryPoint:'fs_main'}]),
      code:`
@vertex
fn vs_main(@builtin(vertex_index) vertex_index : u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  return vec4f(positions[vertex_index], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(0.0, 0.0, 0.0, 1.0);
}`
    }),
    Object.freeze({
      id:'infrastructure-compute-probe',
      purpose:'Production compute-pipeline readiness probe; no renderer algorithm is implied.',
      entries:Object.freeze([{stage:'compute',entryPoint:'cs_main'}]),
      code:`
@compute @workgroup_size(1)
fn cs_main() {
}`
    })
  ]);

  const PIPELINES=Object.freeze([
    Object.freeze({id:'infrastructure-render-probe',kind:'render',shader:'infrastructure-render-probe',vertexEntry:'vs_main',fragmentEntry:'fs_main',targetFormat:'preferred-canvas'}),
    Object.freeze({id:'infrastructure-compute-probe',kind:'compute',shader:'infrastructure-compute-probe',entryPoint:'cs_main'})
  ]);

  const RESOURCE_LAYOUTS=Object.freeze([
    Object.freeze({id:'preferred-render-target',kind:'texture',profile:'core',format:'preferred-canvas',size:[8,8,1],usage:['RENDER_ATTACHMENT','TEXTURE_BINDING','COPY_SRC']}),
    Object.freeze({id:'rgba8-render-target',kind:'texture',profile:'fallback',format:'rgba8unorm',size:[8,8,1],usage:['RENDER_ATTACHMENT','TEXTURE_BINDING','COPY_SRC']}),
    Object.freeze({id:'atlas-upload-target',kind:'texture',profile:'core',format:'rgba8unorm',size:[2,2,1],usage:['COPY_DST','TEXTURE_BINDING']}),
    Object.freeze({id:'frame-uniforms',kind:'buffer',profile:'core',size:256,usage:['UNIFORM','COPY_DST']}),
    Object.freeze({id:'instance-storage',kind:'buffer',profile:'core',size:1024,usage:['STORAGE','COPY_DST','COPY_SRC']})
  ]);

  function textureUsage(names){let value=0;for(const name of names)value|=usageValue('GPUTextureUsage',name,FALLBACK_TEXTURE_USAGE[name]||0);return value}
  function bufferUsage(names){let value=0;for(const name of names)value|=usageValue('GPUBufferUsage',name,FALLBACK_BUFFER_USAGE[name]||0);return value}

  class WebGPUValidationSuite{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUValidationSuite requires GPUDevice');
      this.device=options.device;this.adapter=options.adapter||null;this.queue=options.queue||options.device.queue||null;this.preferredCanvasFormat=String(options.preferredCanvasFormat||'bgra8unorm');this.labelPrefix=String(options.labelPrefix||'SteelMothValidation');
      this.modules=new Map();this.pipelines=new Map();this.created=[];
    }
    _label(value){return `${this.labelPrefix}:${value}`}
    async _scope(label,fn){
      if(typeof this.device.pushErrorScope!=='function'||typeof this.device.popErrorScope!=='function')throw new Error(`${label}: GPUDevice error scopes unavailable`);
      this.device.pushErrorScope('validation');let value,thrown=null,scoped=null;
      try{value=await fn()}catch(error){thrown=error}
      try{scoped=await this.device.popErrorScope()}catch(error){if(!thrown)thrown=error}
      if(thrown){const e=new Error(`${label}: ${thrown?.message||thrown}`);e.cause=thrown;throw e}
      if(scoped){const e=new Error(`${label}: WebGPU validation error: ${scoped.message||scoped}`);e.gpuError=scoped;throw e}
      return value;
    }
    inventory(){return {schema:SCHEMA,shaders:SHADERS.map(s=>({id:s.id,purpose:s.purpose,entries:clone(s.entries)})),pipelines:PIPELINES.map(clone),resourceLayouts:RESOURCE_LAYOUTS.map(clone)}}
    async compileShaders(){
      const results=[];
      for(const spec of SHADERS){
        const module=await this._scope(`shader ${spec.id}`,()=>this.device.createShaderModule({label:this._label(`shader:${spec.id}`),code:spec.code}));this.modules.set(spec.id,module);
        let infoSupported=typeof module?.getCompilationInfo==='function',messages=[];
        if(infoSupported){const info=await module.getCompilationInfo();messages=Array.from(info?.messages||[]).map(messageRecord)}
        const errors=messages.filter(m=>m.type==='error');if(errors.length)throw new Error(`shader ${spec.id}: compilation failed: ${errors.map(e=>e.message).join(' | ')}`);
        results.push({id:spec.id,label:this._label(`shader:${spec.id}`),entries:clone(spec.entries),compilationInfoSupported:infoSupported,messages,warnings:messages.filter(m=>m.type==='warning').length,errors:0});
      }
      return results;
    }
    _shader(id){const module=this.modules.get(id);if(!module)throw new Error(`shader module not compiled: ${id}`);return module}
    async createPipelines(){
      const results=[];
      for(const spec of PIPELINES){
        let pipeline;
        if(spec.kind==='render'){
          const format=spec.targetFormat==='preferred-canvas'?this.preferredCanvasFormat:spec.targetFormat,descriptor={label:this._label(`pipeline:${spec.id}`),layout:'auto',vertex:{module:this._shader(spec.shader),entryPoint:spec.vertexEntry},fragment:{module:this._shader(spec.shader),entryPoint:spec.fragmentEntry,targets:[{format}]},primitive:{topology:'triangle-list'}};
          pipeline=await this._scope(`render pipeline ${spec.id}`,()=>typeof this.device.createRenderPipelineAsync==='function'?this.device.createRenderPipelineAsync(descriptor):this.device.createRenderPipeline(descriptor));
          this.pipelines.set(spec.id,pipeline);results.push({id:spec.id,kind:'render',format,asyncCreation:typeof this.device.createRenderPipelineAsync==='function',label:descriptor.label});
        }else{
          const descriptor={label:this._label(`pipeline:${spec.id}`),layout:'auto',compute:{module:this._shader(spec.shader),entryPoint:spec.entryPoint}};
          pipeline=await this._scope(`compute pipeline ${spec.id}`,()=>typeof this.device.createComputePipelineAsync==='function'?this.device.createComputePipelineAsync(descriptor):this.device.createComputePipeline(descriptor));
          this.pipelines.set(spec.id,pipeline);results.push({id:spec.id,kind:'compute',asyncCreation:typeof this.device.createComputePipelineAsync==='function',label:descriptor.label});
        }
      }
      return results;
    }
    _resolvedLayout(spec){
      if(spec.kind==='texture')return {label:this._label(`resource:${spec.id}`),size:{width:spec.size[0],height:spec.size[1],depthOrArrayLayers:spec.size[2]},format:spec.format==='preferred-canvas'?this.preferredCanvasFormat:spec.format,usage:textureUsage(spec.usage)};
      return {label:this._label(`resource:${spec.id}`),size:spec.size,usage:bufferUsage(spec.usage),mappedAtCreation:false};
    }
    async validateResources(){
      const results=[];
      for(const spec of RESOURCE_LAYOUTS){
        const descriptor=this._resolvedLayout(spec);let handle;
        if(spec.kind==='texture')handle=await this._scope(`texture ${spec.id}`,()=>this.device.createTexture(descriptor));else handle=await this._scope(`buffer ${spec.id}`,()=>this.device.createBuffer(descriptor));
        this.created.push(handle);results.push({id:spec.id,kind:spec.kind,profile:spec.profile,descriptor:{...descriptor,size:clone(descriptor.size)}});
      }
      const registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width:8,height:8,labelPrefix:`${this.labelPrefix}:registry`});
      const surface=registry.defineTexture('resize-surface',{format:'rgba8unorm',usage:textureUsage(['RENDER_ATTACHMENT','TEXTURE_BINDING']),size:'surface'});const fixed=registry.defineTexture('fixed-control',{format:'rgba8unorm',usage:textureUsage(['TEXTURE_BINDING']),size:{width:4,height:4}});const before={surfaceCreate:surface.createCount,fixedCreate:fixed.createCount};
      registry.resize(13,9);const afterSurface=registry.require('resize-surface'),afterFixed=registry.require('fixed-control');const diag=registry.diagnostics();
      if(afterSurface.createCount<=before.surfaceCreate||afterFixed.createCount!==before.fixedCreate)throw new Error('resource resize recreation contract failed');
      registry.close();return {layouts:results,resize:{before,after:{surfaceCreate:afterSurface.createCount,fixedCreate:afterFixed.createCount},diagnostics:diag}};
    }
    async validateAtlasUpload(source){
      if(!source)throw new Error('atlas upload validation requires an external image source');if(!this.queue||typeof this.queue.copyExternalImageToTexture!=='function')throw new Error('GPUQueue.copyExternalImageToTexture unavailable');
      const descriptor={label:this._label('atlas-upload-texture'),size:{width:2,height:2,depthOrArrayLayers:1},format:'rgba8unorm',usage:textureUsage(['COPY_DST','TEXTURE_BINDING'])};const texture=await this._scope('atlas upload texture',()=>this.device.createTexture(descriptor));this.created.push(texture);
      await this._scope('atlas copyExternalImageToTexture',()=>{this.queue.copyExternalImageToTexture({source},{texture,origin:{x:0,y:0,z:0}},{width:2,height:2,depthOrArrayLayers:1})});
      if(typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();return {ok:true,format:descriptor.format,size:[2,2,1],usage:descriptor.usage,sourceType:String(source?.constructor?.name||typeof source)};
    }
    async exercisePipelines(){
      const render=this.pipelines.get('infrastructure-render-probe'),compute=this.pipelines.get('infrastructure-compute-probe');if(!render||!compute)throw new Error('production validation pipelines not created');
      const target=await this._scope('pipeline exercise target',()=>this.device.createTexture({label:this._label('pipeline-exercise-target'),size:{width:4,height:4,depthOrArrayLayers:1},format:this.preferredCanvasFormat,usage:textureUsage(['RENDER_ATTACHMENT'])}));this.created.push(target);
      const encoder=this.device.createCommandEncoder({label:this._label('pipeline-exercise-encoder')});const renderPass=encoder.beginRenderPass({label:this._label('render-probe-pass'),colorAttachments:[{view:target.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});renderPass.setPipeline(render);renderPass.draw(3);renderPass.end();const computePass=encoder.beginComputePass({label:this._label('compute-probe-pass')});computePass.setPipeline(compute);computePass.dispatchWorkgroups(1);computePass.end();
      await this._scope('pipeline command submit',()=>this.queue.submit([encoder.finish()]));if(typeof this.queue.onSubmittedWorkDone==='function')await this.queue.onSubmittedWorkDone();return {ok:true,renderDraws:1,computeDispatches:1,targetFormat:this.preferredCanvasFormat};
    }
    async deliberateValidationError(){
      if(typeof this.device.pushErrorScope!=='function'||typeof this.device.popErrorScope!=='function')throw new Error('deliberate validation probe requires GPUDevice error scopes');
      const label=this._label('deliberate-invalid-buffer');this.device.pushErrorScope('validation');let handle=null,thrown=null;try{handle=this.device.createBuffer({label,size:4,usage:0})}catch(error){thrown=error}let scoped=null;try{scoped=await this.device.popErrorScope()}catch(error){if(!thrown)thrown=error}try{handle?.destroy?.()}catch(_error){}
      if(!scoped&&!thrown)throw new Error(`${label}: deliberate invalid descriptor produced no validation failure`);return {ok:true,label,capturedByErrorScope:!!scoped,thrown:thrown?errorRecord(thrown):null,error:scoped?errorRecord(scoped):null};
    }
    async run(options={}){
      const report={schema:REPORT_SCHEMA,ok:false,inventory:this.inventory(),environment:{preferredCanvasFormat:this.preferredCanvasFormat,errorScopes:typeof this.device.pushErrorScope==='function',compilationInfoExpected:true},shaders:[],pipelines:[],resources:null,atlasUpload:null,pipelineExercise:null,deliberateValidation:null};
      try{report.shaders=await this.compileShaders();report.pipelines=await this.createPipelines();report.resources=await this.validateResources();report.atlasUpload=await this.validateAtlasUpload(options.atlasSource);report.pipelineExercise=await this.exercisePipelines();report.deliberateValidation=await this.deliberateValidationError();report.ok=true;return report}catch(error){report.error=errorRecord(error);throw Object.assign(error,{validationReport:report})}
    }
    close(){for(const handle of this.created.splice(0)){try{handle?.destroy?.()}catch(_error){}}this.modules.clear();this.pipelines.clear()}
  }

  return {SCHEMA,REPORT_SCHEMA,SHADERS,PIPELINES,RESOURCE_LAYOUTS,textureUsage,bufferUsage,WebGPUValidationSuite};
});
