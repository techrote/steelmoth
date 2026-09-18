'use strict';

const assert=require('assert');
const Validation=require('../engine/webgpu_validation.js');

class FakeHandle{
  constructor(desc={}){this.descriptor=desc;this.destroyed=false}
  destroy(){this.destroyed=true}
  createView(){return {texture:this}}
}

class FakeQueue{
  constructor(){this.submissions=0;this.externalCopies=0;this.bufferWrites=0}
  writeBuffer(){this.bufferWrites++}
  copyExternalImageToTexture(){this.externalCopies++}
  submit(cmds){assert.ok(Array.isArray(cmds)&&cmds.length);this.submissions+=cmds.length}
  async onSubmittedWorkDone(){}
}

class FakeDevice{
  constructor(options={}){this.options=options;this.queue=new FakeQueue();this.scopes=[];this.pendingValidation=null;this.renderPipelines=0;this.computePipelines=0}
  pushErrorScope(type){assert.strictEqual(type,'validation');this.scopes.push(type)}
  async popErrorScope(){assert.ok(this.scopes.length,'unbalanced popErrorScope');this.scopes.pop();const e=this.pendingValidation;this.pendingValidation=null;return e}
  createShaderModule(desc){
    const isRender=desc.label.includes('infrastructure-render-probe'),messages=[];
    if(this.options.shaderError&&isRender)messages.push({type:'error',message:'synthetic WGSL error',lineNum:3,linePos:2,offset:8,length:4});
    if(this.options.shaderWarning&&isRender)messages.push({type:'warning',message:'synthetic WGSL warning',lineNum:1,linePos:1,offset:0,length:1});
    return {label:desc.label,code:desc.code,getCompilationInfo:async()=>({messages})};
  }
  async createRenderPipelineAsync(desc){if(this.options.pipelineError){this.pendingValidation=new Error(`synthetic pipeline validation for ${desc.label}`)}this.renderPipelines++;return {kind:'render',desc}}
  async createComputePipelineAsync(desc){this.computePipelines++;return {kind:'compute',desc}}
  createTexture(desc){return new FakeHandle(desc)}
  createBuffer(desc){if(Number(desc.usage)===0)this.pendingValidation=new Error(`invalid buffer usage in ${desc.label}`);return new FakeHandle(desc)}
  createCommandEncoder(desc){
    const render={setPipeline(){},draw(){},end(){}};const compute={setPipeline(){},dispatchWorkgroups(){},end(){}};
    return {label:desc?.label,beginRenderPass(){return render},beginComputePass(){return compute},clearBuffer(){},finish(){return {kind:'command-buffer'}}};
  }
}

async function expectFailure(options,needle){
  const device=new FakeDevice(options),suite=new Validation.WebGPUValidationSuite({device,queue:device.queue,preferredCanvasFormat:'bgra8unorm',labelPrefix:'Unit'});let caught=null;
  try{await suite.run({atlasSource:{constructor:{name:'FakeCanvas'}}})}catch(error){caught=error}finally{suite.close()}
  assert.ok(caught,`expected failure containing ${needle}`);assert.ok(String(caught.message).includes(needle),`missing actionable context: ${caught.message}`);assert.strictEqual(caught.validationReport?.schema,Validation.REPORT_SCHEMA);assert.strictEqual(caught.validationReport?.ok,false);
}

(async()=>{
  const inventory={shaders:Validation.SHADERS,pipelines:Validation.PIPELINES,resources:Validation.RESOURCE_LAYOUTS};
  assert.strictEqual(inventory.shaders.length,2);assert.deepStrictEqual(inventory.shaders.flatMap(s=>s.entries.map(e=>e.stage)).sort(),['compute','fragment','vertex']);assert.deepStrictEqual(inventory.pipelines.map(p=>p.kind).sort(),['compute','render']);assert.deepStrictEqual(new Set(inventory.resources.map(r=>r.profile)),new Set(['core','fallback']));

  const device=new FakeDevice({shaderWarning:true}),suite=new Validation.WebGPUValidationSuite({device,queue:device.queue,preferredCanvasFormat:'bgra8unorm',labelPrefix:'Unit'});const report=await suite.run({atlasSource:{constructor:{name:'FakeCanvas'}}});
  assert.strictEqual(report.ok,true);assert.strictEqual(report.schema,Validation.REPORT_SCHEMA);assert.strictEqual(report.shaders.length,2);assert.strictEqual(report.shaders.find(s=>s.id==='infrastructure-render-probe').warnings,1);assert.strictEqual(report.pipelines.length,2);assert.strictEqual(report.resources.layouts.length,5);assert.ok(report.resources.layouts.some(r=>r.profile==='core'));assert.ok(report.resources.layouts.some(r=>r.profile==='fallback'));assert.strictEqual(report.atlasUpload.ok,true);assert.strictEqual(device.queue.externalCopies,1);assert.strictEqual(report.pipelineExercise.ok,true);assert.ok(device.queue.submissions>=1);assert.strictEqual(report.deliberateValidation.ok,true);assert.strictEqual(report.deliberateValidation.capturedByErrorScope,true);assert.ok(report.deliberateValidation.label.includes('deliberate-invalid-buffer'));assert.strictEqual(device.scopes.length,0);suite.close();

  await expectFailure({shaderError:true},'shader infrastructure-render-probe');
  await expectFailure({pipelineError:true},'render pipeline infrastructure-render-probe');
  console.log('SM-104 WebGPU validation unit checks: PASS');
})().catch(error=>{console.error(error?.stack||error);process.exit(1)});
