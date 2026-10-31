'use strict';
const assert=require('assert');
const {WebGPUScenePresenter}=require('../engine/webgpu_scene_presenter.js');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
async function until(condition){for(let i=0;i<100;i++){if(condition())return;await Promise.resolve()}throw new Error('expected completion state not reached')}
function environment(){
  const gates=[],encoded=[],failures=[];
  const p=new WebGPUScenePresenter({game:{renderer:{}},manager:{device:{queue:{onSubmittedWorkDone(){const gate=deferred();gates.push(gate);return gate.promise}}}},api:{},onFailure:e=>failures.push(e)});
  p.ready=true;p._render=async scene=>{encoded.push(scene.id);await p._completeFrame()};
  return{p,gates,encoded,failures};
}
async function main(){
  const {p,gates,encoded}=environment();
  assert(p.consume({id:1}));assert(p.consume({id:2}));assert(p.consume({id:3}));
  assert.deepEqual(encoded,[1],'only one GPU frame can be in flight');
  assert.equal(p.submittedFrames,1);assert.equal(p.completedFrames,0);assert.equal(p.presentedFrames,0,'CPU submission cannot count as completed presentation');
  assert(p.waitingForGPU);assert.equal(p.pending.id,3,'pending capacity is one latest scene');
  gates[0].resolve();await until(()=>gates.length===2);
  assert.deepEqual(encoded,[1,3],'obsolete cosmetic scene is replaced without GPU work');
  assert.equal(p.completedFrames,1);assert.equal(p.presentedFrames,1);
  gates[1].resolve();await until(()=>!p.rendering);
  assert.equal(p.completedFrames,2);assert.equal(p.submittedFrames,2);assert.equal(p.presentedFrames,2);assert(!p.waitingForGPU);
  assert(Number.isFinite(p.lastHostCompletionWaitMs),'completion wait is labelled host wall time, never GPU execution');
  const closed=environment();closed.p.consume({id:4});closed.p.consume({id:5});closed.p.close();closed.gates[0].resolve();await until(()=>!closed.p.rendering);
  assert.equal(closed.p.completedFrames,0);assert.equal(closed.p.presentedFrames,0);assert.deepEqual(closed.encoded,[4]);assert.equal(closed.failures.length,0,'retired work cannot fail a replacement');
  const lost=environment();lost.p.consume({id:6});lost.p.consume({id:7});lost.gates[0].reject(new Error('actual completion/device failure'));await until(()=>!lost.p.rendering);
  assert.equal(lost.failures.length,1);assert.equal(lost.p.completedFrames,0);assert.equal(lost.p.presentedFrames,0);assert.deepEqual(lost.encoded,[6]);assert(!lost.p.ready);assert(!lost.p.consume({id:8}),'failed GPU work cannot retry itself');
  const absent=environment();absent.p.queue.onSubmittedWorkDone=null;await assert.rejects(absent.p._completeFrame(),/completion\/backpressure/);assert.equal(absent.p.presentedFrames,0);
  console.log('SM-505 FRAME COMPLETION CPU PASS: one GPU frame plus latest pending scene, completion before frame proof, host wait labelling, cancellation/device failure and no retry; no GPU execution');
}
main().catch(e=>{console.error(e);process.exit(1)});
