'use strict';
// Source-preservation and real queue-facade accounting tests; no GPU execution.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const page=read('webgpu-gtao-physical-diagnostic.html'),canonical=read('webgpu-target-benchmark.html');
function sceneFunction(text){const start=text.indexOf('    function buildScene('),end=text.indexOf('\n    let scene=',start);assert(start>=0&&end>start);return text.slice(start,end)}
assert.equal(sceneFunction(page),sceneFunction(canonical),'moving canonical fixture must stay byte-identical after newline normalization');
const G=require('../engine/webgpu_gtao.js'),GT=require('../engine/webgpu_gtao_stabilization.js'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
assert.equal(hash(G.RAW_WGSL),'d6bbbf28517866d9b3ca6e5de3b54847e4147f89a15df1be3ce47200d0cbae78');
assert.equal(hash(G.UPSAMPLE_WGSL),'7ddda64b8e31f11998ce77abb721c4b1e105e468e1e3785e28374eb0c9ef81cd');
assert.equal(hash(GT.TEMPORAL_WGSL),'7241992d96d014e996eb826779f2f9f6b4c3360979120d7fee780502b07f00cc');
assert(!/device\.queue\.[\w]+\s*=/.test(page),'native queue must never be patched');
assert(!/new Proxy\(device\.queue/.test(page),'native queue must never be proxied');
const start=page.indexOf('    function producerQueue('),end=page.indexOf('\n    directQueries=',start);assert(start>=0&&end>start);
const helper=page.slice(start,end),calls=[];let clock=10;
const realQueue={writeBuffer(...args){calls.push(['write',...args]);return 'written'},submit(buffers){calls.push(['native-submit',buffers]);return 'native'},onSubmittedWorkDone(){calls.push(['native-wait']);return Promise.resolve('done')}};
Object.freeze(realQueue);
const context={device:{queue:realQueue},active:null,now:()=>++clock};vm.createContext(context);vm.runInContext(helper,context);
(async()=>{
  const raw=context.producerQueue('rawAndUpscale'),temporal=context.producerQueue('temporal');
  assert.equal(raw.submit(['warmup']),'native');assert.equal(raw.writeBuffer('params',0,new Uint8Array(64)),'written');
  const spans=[],hostWaits=[],record={encodingStart:{},encodingCpuMs:{},submitApiCpuMs:{},submissions:[],scope:{submit(buffers,metadata){spans.push({buffers,metadata});return 'scoped'},async measureHostWait(name,callback){hostWaits.push(name);return callback()}}};context.active=record;
  raw.writeBuffer('raw-params',0,new Uint8Array(64));raw.submit(['raw+upscale']);
  temporal.writeBuffer('temporal-params',0,new Uint8Array(64));temporal.writeBuffer('stats',0,new Uint32Array(8));temporal.submit(['temporal+stats-copy']);
  assert.deepEqual(record.submissions,['rawAndUpscale','temporal']);assert.equal(spans.length,2);
  assert.equal(spans[0].metadata.includesDiagnosticCopy,false);assert.equal(spans[0].metadata.diagnosticCopyBytes,0);
  assert.equal(spans[1].metadata.includesDiagnosticCopy,true);assert.equal(spans[1].metadata.diagnosticCopyBytes,32);
  assert.equal(calls.filter(x=>x[0]==='native-submit').length,1,'measured submissions must exclusively use the explicit SM500 scope');
  assert(record.encodingCpuMs.rawAndUpscale>0&&record.encodingCpuMs.temporal>0);
  const beforeWait=record.encodingCpuMs.temporal;assert.equal(await temporal.onSubmittedWorkDone(),'done');assert.equal(record.encodingCpuMs.temporal,beforeWait,'host wait must not enter recorded encoding interval');assert.deepEqual(hostWaits,['temporal:onSubmittedWorkDone']);
  context.active=null;assert.equal(temporal.submit(['outside-frame']),'native');
  assert.equal(context.device.queue,realQueue);assert(Object.isFrozen(realQueue));
  console.log(JSON.stringify({ok:true,gpuExecution:false,checks:['canonical moving fixture preservation','three production WGSL hashes','no native queue patch','complete explicit producer routing','stats-copy metadata','host-wait accounting separated from encoding','unmeasured fallback delegation']}));
})().catch(error=>{console.error(error);process.exitCode=1});
