'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothSM801=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SCHEMA='steelmoth-sm801-static-submission/v1';
  const CATEGORY_ORDER=Object.freeze(['static','ground','dynamic','foreground','top']);
  const DEFAULT_WORKLOADS=Object.freeze({
    representative:Object.freeze({static:320,ground:64,dynamic:96,foreground:64,top:32}),
    dense:Object.freeze({static:768,ground:128,dynamic:256,foreground:128,top:64}),
  });

  function normalizeCounts(value={}){
    const out={};
    for(const name of CATEGORY_ORDER)out[name]=Math.max(0,Math.floor(Number(value[name])||0));
    return out;
  }

  function buildBatchPlan(value={}){
    const counts=normalizeCounts(value),batches=[];let firstInstance=0;
    for(const category of CATEGORY_ORDER){
      const instanceCount=counts[category];
      if(instanceCount)batches.push({category,instanceCount,firstInstance,stable:category==='static'||category==='ground'});
      firstInstance+=instanceCount;
    }
    const stable=batches.filter(x=>x.stable),dynamic=batches.filter(x=>!x.stable);
    return {schema:SCHEMA,counts,totalInstances:firstInstance,batches,stable,dynamic,drawCount:batches.length,stableDrawCount:stable.length,dynamicDrawCount:dynamic.length,fingerprint:CATEGORY_ORDER.map(k=>`${k}:${counts[k]}`).join('|')};
  }

  class StaticBundlePrototype{
    constructor(){this.bundle=null;this.fingerprint=null;this.roomEpoch=0;this.editorRevision=0;this.buildCount=0;this.invalidateCount=0;this.lastInvalidation='initial';}
    invalidate(reason='unknown'){
      this.bundle=null;this.fingerprint=null;this.invalidateCount++;this.lastInvalidation=String(reason);
      if(reason==='room-change')this.roomEpoch++;
      if(reason==='editor-static-change')this.editorRevision++;
    }
    ensure(plan,builder){
      if(!plan||plan.schema!==SCHEMA)throw new Error('SM-801 bundle prototype requires a valid batch plan');
      if(typeof builder!=='function')throw new TypeError('SM-801 bundle prototype requires a builder');
      const fingerprint=`${this.roomEpoch}:${this.editorRevision}:${plan.fingerprint}`;
      if(this.bundle&&this.fingerprint===fingerprint)return {bundle:this.bundle,reused:true};
      this.bundle=builder(plan.stable);this.fingerprint=fingerprint;this.buildCount++;return {bundle:this.bundle,reused:false};
    }
    diagnostics(){return {schema:SCHEMA,roomEpoch:this.roomEpoch,editorRevision:this.editorRevision,buildCount:this.buildCount,invalidateCount:this.invalidateCount,lastInvalidation:this.lastInvalidation,hasBundle:!!this.bundle,fingerprint:this.fingerprint};}
  }

  function summarize(values){
    const a=Array.from(values||[]).map(Number).filter(Number.isFinite).sort((x,y)=>x-y);
    if(!a.length)return {count:0,meanMs:null,p50Ms:null,p95Ms:null,minMs:null,maxMs:null};
    const q=p=>a[Math.min(a.length-1,Math.max(0,Math.ceil(a.length*p)-1))];
    return {count:a.length,meanMs:a.reduce((s,v)=>s+v,0)/a.length,p50Ms:q(.5),p95Ms:q(.95),minMs:a[0],maxMs:a[a.length-1]};
  }

  function decide(results){
    const rows=Array.from(results||[]);const reasons=[];let adopt=true;
    for(const row of rows){
      const base=Number(row?.cpu?.baseline?.p50Ms),bundle=Number(row?.cpu?.bundle?.p50Ms);
      if(!(base>0)||!(bundle>=0)){adopt=false;reasons.push(`${row?.browser||'browser'}/${row?.workload||'workload'} missing CPU encode data`);continue;}
      const gain=(base-bundle)/base;
      if(gain<.10){adopt=false;reasons.push(`${row.browser}/${row.workload} CPU encode gain ${(gain*100).toFixed(1)}% < 10% adoption threshold`);}
      const gb=Number(row?.gpu?.baseline?.p50Ms),gg=Number(row?.gpu?.bundle?.p50Ms);
      if(Number.isFinite(gb)&&gb>0&&Number.isFinite(gg)&&gg>gb*1.03){adopt=false;reasons.push(`${row.browser}/${row.workload} GPU p50 regressed ${(((gg-gb)/gb)*100).toFixed(1)}%`);}
    }
    if(rows.length<4){adopt=false;reasons.push('cross-browser representative+dense matrix incomplete');}
    return {decision:adopt?'adopt':'reject',adopt,thresholds:{minimumCpuEncodeP50Gain:0.10,maximumGpuP50Regression:0.03},reasons};
  }

  return {SCHEMA,CATEGORY_ORDER,DEFAULT_WORKLOADS,normalizeCounts,buildBatchPlan,StaticBundlePrototype,summarize,decide};
});
