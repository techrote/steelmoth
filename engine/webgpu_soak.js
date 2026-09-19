'use strict';

(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUSoak=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  const SCHEMA='steelmoth-webgpu-soak/v1';
  const SAMPLE_SCHEMA='steelmoth-webgpu-soak-sample/v1';
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const finite=value=>Number.isFinite(Number(value))?Number(value):0;
  const extentKey=extent=>extent?`${finite(extent.width)}x${finite(extent.height)}@${finite(extent.dpr)||1}`:'none';

  function resourceDiagnostics(input){
    if(!input)return null;
    if(input.schema==='steelmoth-webgpu-resources/v1')return input;
    if(input.resources?.schema==='steelmoth-webgpu-resources/v1')return input.resources;
    if(input.webgpuInfrastructure?.resources?.schema==='steelmoth-webgpu-resources/v1')return input.webgpuInfrastructure.resources;
    if(input.webgpu?.resources?.schema==='steelmoth-webgpu-resources/v1')return input.webgpu.resources;
    return null;
  }

  function pipelineDiagnostics(input){
    if(!input)return null;
    if(input.schema==='steelmoth-webgpu-pipeline-cache/v1')return input;
    if(input.pipelines?.schema==='steelmoth-webgpu-pipeline-cache/v1')return input.pipelines;
    if(input.webgpuInfrastructure?.pipelines?.schema==='steelmoth-webgpu-pipeline-cache/v1')return input.webgpuInfrastructure.pipelines;
    return null;
  }

  class SoakMonitor{
    constructor(options={}){
      this.schema=SCHEMA;
      this.warmupSamples=Math.max(0,Math.floor(finite(options.warmupSamples)||8));
      this.maxSamples=Math.max(16,Math.floor(finite(options.maxSamples)||512));
      this.maxErrors=Math.max(8,Math.floor(finite(options.maxErrors)||64));
      this.resourceCountSlack=Math.max(0,Math.floor(finite(options.resourceCountSlack)));
      this.byteSlack=Math.max(0,finite(options.byteSlack));
      this.samples=[];this.errors=[];this.extentBaselines=new Map();this.sampleCount=0;this.lastSample=null;
    }
    recordError(error,meta={}){
      const entry={message:String(error?.message||error),name:String(error?.name||'Error'),meta:clone(meta)};
      this.errors.push(entry);if(this.errors.length>this.maxErrors)this.errors.splice(0,this.errors.length-this.maxErrors);return clone(entry);
    }
    sample(label,diagnostics,extra={}){
      const resources=resourceDiagnostics(diagnostics),pipelines=pipelineDiagnostics(diagnostics),transition=extra.transition||null,editor=extra.editor||null;
      const extent=resources?.extent?{...resources.extent,dpr:finite(extra.dpr)||1}:null;
      const sample={schema:SAMPLE_SCHEMA,index:this.sampleCount++,label:String(label||''),extent,extentKey:extentKey(extent),resourceCount:finite(resources?.resourceCount),definitionCount:finite(resources?.definitionCount),estimatedBytes:finite(resources?.estimatedBytes),createCount:finite(resources?.createCount),destroyCount:finite(resources?.destroyCount),rebuildCount:finite(resources?.rebuildCount),resizeCount:finite(resources?.resizeCount),generation:finite(resources?.generation),pipelineCount:finite(pipelines?.count),pipelineGeneration:finite(pipelines?.generation),transitionRevision:finite(transition?.revision),transitionEvents:Array.isArray(transition?.events)?transition.events.length:0,transitionMaxEvents:finite(extra.transitionMaxEvents),editorRevision:finite(editor?.revision),editorEvents:Array.isArray(editor?.events)?editor.events.length:0,editorMaxEvents:finite(extra.editorMaxEvents),uncapturedErrors:finite(extra.uncapturedErrors),backendStatus:extra.backendStatus==null?null:String(extra.backendStatus)};
      if(sample.index>=this.warmupSamples&&resources){
        const key=sample.extentKey;
        const baseline=this.extentBaselines.get(key);
        if(!baseline)this.extentBaselines.set(key,{resourceCount:sample.resourceCount,definitionCount:sample.definitionCount,estimatedBytes:sample.estimatedBytes,pipelineCount:sample.pipelineCount});
        else{
          if(sample.resourceCount>baseline.resourceCount+this.resourceCountSlack)this.recordError(new Error(`resource count grew for ${key}: ${sample.resourceCount} > ${baseline.resourceCount}+${this.resourceCountSlack}`),{kind:'resource-count',sample});
          if(sample.definitionCount>baseline.definitionCount+this.resourceCountSlack)this.recordError(new Error(`resource definitions grew for ${key}: ${sample.definitionCount} > ${baseline.definitionCount}+${this.resourceCountSlack}`),{kind:'definition-count',sample});
          if(sample.estimatedBytes>baseline.estimatedBytes+this.byteSlack)this.recordError(new Error(`estimated renderer bytes grew for ${key}: ${sample.estimatedBytes} > ${baseline.estimatedBytes}+${this.byteSlack}`),{kind:'estimated-bytes',sample});
          if(sample.pipelineCount>baseline.pipelineCount+this.resourceCountSlack)this.recordError(new Error(`pipeline cache grew for ${key}: ${sample.pipelineCount} > ${baseline.pipelineCount}+${this.resourceCountSlack}`),{kind:'pipeline-count',sample});
        }
      }
      if(sample.transitionMaxEvents&&sample.transitionEvents>sample.transitionMaxEvents)this.recordError(new Error(`transition event log exceeded bound ${sample.transitionMaxEvents}`),{kind:'transition-events',sample});
      if(sample.editorMaxEvents&&sample.editorEvents>sample.editorMaxEvents)this.recordError(new Error(`editor event log exceeded bound ${sample.editorMaxEvents}`),{kind:'editor-events',sample});
      if(sample.uncapturedErrors>0)this.recordError(new Error(`uncaptured WebGPU errors observed: ${sample.uncapturedErrors}`),{kind:'uncaptured-errors',sample});
      this.samples.push(sample);if(this.samples.length>this.maxSamples)this.samples.splice(0,this.samples.length-this.maxSamples);this.lastSample=sample;return clone(sample);
    }
    summary(){
      const byExtent={};for(const sample of this.samples){const key=sample.extentKey;if(!byExtent[key])byExtent[key]={samples:0,minResourceCount:Infinity,maxResourceCount:-Infinity,minEstimatedBytes:Infinity,maxEstimatedBytes:-Infinity,minPipelineCount:Infinity,maxPipelineCount:-Infinity};const x=byExtent[key];x.samples++;x.minResourceCount=Math.min(x.minResourceCount,sample.resourceCount);x.maxResourceCount=Math.max(x.maxResourceCount,sample.resourceCount);x.minEstimatedBytes=Math.min(x.minEstimatedBytes,sample.estimatedBytes);x.maxEstimatedBytes=Math.max(x.maxEstimatedBytes,sample.estimatedBytes);x.minPipelineCount=Math.min(x.minPipelineCount,sample.pipelineCount);x.maxPipelineCount=Math.max(x.maxPipelineCount,sample.pipelineCount)}
      for(const x of Object.values(byExtent))for(const key of Object.keys(x))if(x[key]===Infinity||x[key]===-Infinity)x[key]=0;
      return{schema:SCHEMA,ok:this.errors.length===0,warmupSamples:this.warmupSamples,totalSamples:this.sampleCount,retainedSamples:this.samples.length,errors:this.errors.map(clone),extentBaselines:Object.fromEntries([...this.extentBaselines.entries()].map(([k,v])=>[k,clone(v)])),byExtent,lastSample:clone(this.lastSample),contract:{ownedResourceAccounting:true,exactBrowserVramClaimed:false,uncapturedErrorsBlock:true,boundedTransitionLogs:true,boundedEditorLogs:true,steadyExtentGrowthRejected:true}};
    }
  }

  return{SCHEMA,SAMPLE_SCHEMA,resourceDiagnostics,pipelineDiagnostics,SoakMonitor};
});
