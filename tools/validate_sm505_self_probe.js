#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'sm505_self_reconstruction_probe.js'),'utf8');
function fixture(){
  let gpuCalls=0;
  const device=new Proxy({queue:{}},{get(target,key){if(key in target)return target[key];return()=>{gpuCalls++;throw new Error('preflight must never reach GPU')}}});
  const scene={frame:{logicalSize:[640,360]},settings:{},lights:[]};
  const presenter={ready:true,closed:false,rendering:false,pending:null,width:1920,height:1080,device,api:{Shadows:{selectSelfShadowLights:()=>[]},Lighting:{buildCanonicalLights:()=>[]},Quality:{localShadowSettings:()=>({})}}};
  const context=vm.createContext({console,game:{paused:true,renderScene:scene},steelMothBackendRuntime:{presentationBackend:'webgpu',presenter},SteelMothWebGPUScenePresenter:{scaleScene:()=>({scene}),lightSubset:()=>scene}});
  vm.runInContext(source,context,{filename:'sm505_self_reconstruction_probe.js'});
  return{context,presenter,get gpuCalls(){return gpuCalls}};
}
(async()=>{
  for(const mutation of [f=>{f.context.steelMothBackendRuntime.presentationBackend='webgl2'},f=>{f.presenter.closed=true},f=>{f.presenter.ready=false},f=>{f.presenter.rendering=true},f=>{f.presenter.pending={}},f=>{f.context.game.paused=false},f=>{f.context.game.renderScene=null}]){
    const f=fixture();mutation(f);await assert.rejects(()=>f.context.sm505SelfReconstructionProbe(),/requires frozen idle/);assert.equal(f.gpuCalls,0);
  }
  const huge=fixture();huge.presenter.width=3841;huge.presenter.height=2160;await assert.rejects(()=>huge.context.sm505SelfReconstructionProbe(),/bounded limit/);assert.equal(huge.gpuCalls,0);
  const absent=fixture();await assert.rejects(()=>absent.context.sm505SelfReconstructionProbe(),/actual canonical game light/);assert.equal(absent.gpuCalls,0);
  const inconsistent=fixture();inconsistent.presenter.api.Lighting.buildCanonicalLights=()=>[{id:'actual-cone',type:'cone'}];await assert.rejects(()=>inconsistent.context.sm505SelfReconstructionProbe(),/canonical identity mismatch/);assert.equal(inconsistent.gpuCalls,0);
  console.log('SM-505 SELF PROBE CPU PASS: real injected observer rejects inactive/busy/lost/oversized/missing-light/inconsistent-light states before GPU work; no GPU execution');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
