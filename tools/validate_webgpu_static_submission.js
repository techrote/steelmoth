'use strict';
const assert=require('assert');
const SM=require('./sm801_static_submission_probe.js');

const rep=SM.buildBatchPlan(SM.DEFAULT_WORKLOADS.representative);
assert.equal(rep.totalInstances,576);
assert.equal(rep.drawCount,5);
assert.equal(rep.stableDrawCount,2);
assert.equal(rep.dynamicDrawCount,3);
assert.deepEqual(rep.stable.map(x=>x.category),['static','ground']);
assert.deepEqual(rep.dynamic.map(x=>x.category),['dynamic','foreground','top']);
assert.deepEqual(rep.batches.map(x=>x.firstInstance),[0,320,384,480,544]);

const cache=new SM.StaticBundlePrototype();let serial=0;
let r=cache.ensure(rep,()=>({id:++serial}));
assert.equal(r.reused,false);assert.equal(serial,1);
r=cache.ensure(rep,()=>({id:++serial}));assert.equal(r.reused,true);assert.equal(serial,1);
cache.invalidate('dynamic-only-change');
r=cache.ensure(rep,()=>({id:++serial}));assert.equal(r.reused,false);assert.equal(serial,2);
cache.invalidate('editor-static-change');
r=cache.ensure(rep,()=>({id:++serial}));assert.equal(r.reused,false);assert.equal(serial,3);assert.equal(cache.diagnostics().editorRevision,1);
cache.invalidate('room-change');
r=cache.ensure(rep,()=>({id:++serial}));assert.equal(r.reused,false);assert.equal(serial,4);assert.equal(cache.diagnostics().roomEpoch,1);

const summary=SM.summarize([1,2,3,4,5]);
assert.equal(summary.count,5);assert.equal(summary.meanMs,3);assert.equal(summary.p50Ms,3);assert.equal(summary.p95Ms,5);
const rejection=SM.decide([
  {browser:'chrome',workload:'representative',cpu:{baseline:{p50Ms:1},bundle:{p50Ms:.95}},gpu:{baseline:{p50Ms:1},bundle:{p50Ms:1}}},
  {browser:'chrome',workload:'dense',cpu:{baseline:{p50Ms:1},bundle:{p50Ms:.95}},gpu:{}},
  {browser:'firefox',workload:'representative',cpu:{baseline:{p50Ms:1},bundle:{p50Ms:.95}},gpu:{}},
  {browser:'firefox',workload:'dense',cpu:{baseline:{p50Ms:1},bundle:{p50Ms:.95}},gpu:{}},
]);
assert.equal(rejection.decision,'reject');
const adoption=SM.decide([
  ...['chrome','firefox'].flatMap(browser=>['representative','dense'].map(workload=>({browser,workload,cpu:{baseline:{p50Ms:1},bundle:{p50Ms:.8}},gpu:{baseline:{p50Ms:1},bundle:{p50Ms:1.01}}})))
]);
assert.equal(adoption.decision,'adopt');
console.log(`SM-801 deterministic PASS: representative=${rep.totalInstances} instances/${rep.drawCount} batches; cache builds=${cache.diagnostics().buildCount}`);
