#!/usr/bin/env node
'use strict';
// Real render-harness source under a fake DOM; no browser/GPU or screenshot claim.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../engine/render_harness.js'),'utf8');
async function boot(query,response){
  const nodes={};
  const body={dataset:{},style:{},classList:{add(){}},appendChild(n){nodes[n.id]=n;return n;}};
  const document={
    readyState:'complete',body,head:{appendChild(){}},documentElement:{style:{}},
    getElementById(id){return id==='game'?{style:{}}:(nodes[id]||null);},
    createElement(){return {id:'',textContent:'',style:{}};}
  };
  const window={};
  function Storage(){}
  Storage.prototype.getItem=function(){return null;};
  Storage.prototype.setItem=function(){};
  Storage.prototype.removeItem=function(){};
  const ctx={location:{search:query},document,window,Storage,URLSearchParams,
    performance:{now:()=>123.4},fetch:async()=>response,setTimeout,clearTimeout};
  vm.runInNewContext(source,ctx,{filename:'render_harness.js'});
  return {result:await window.SteelMothRenderHarness.ready,window,body,nodes};
}
async function main(){
  const disabled=await boot('',{ok:true});
  assert.equal(disabled.result.disabled,true);
  assert.equal(disabled.window.SteelMothRenderHarness.stage,'disabled');
  assert.equal(disabled.body.dataset.renderTestError,undefined);
  const fail=await boot('?renderTest=1',{ok:false,status:503});
  const h=fail.window.SteelMothRenderHarness;
  assert.equal(h.stage,'error');
  assert.deepEqual(Array.from(h.stageHistory,x=>x.stage),['script-loaded','layout','fixture-fetch','error']);
  assert.equal(fail.body.dataset.renderTestError,'1');
  assert.equal(fail.result.ok,false);
  assert.match(fail.result.error,/HTTP 503/);
  assert.equal(JSON.parse(fail.nodes.renderTestResult.textContent).ok,false);
  const copy=h.stageHistory;copy.length=0;
  assert.equal(h.stageHistory.length,4);
  assert(h.stageHistory.every(x=>Number.isFinite(x.elapsedMs)));
  console.log('Render harness stage diagnostics: disabled + failed fixture PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
