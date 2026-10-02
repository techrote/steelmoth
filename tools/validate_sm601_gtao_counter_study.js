'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const G = require('../engine/webgpu_gtao_stabilization.js');
const S = require('./sm601_gtao_counter_study.js');

(async () => {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--report')) throw new Error('Usage: node tools/validate_sm601_gtao_counter_study.js [--report file.json]');
  const candidate = await S.createCandidate(G.TEMPORAL_WGSL);
  const source = fs.readFileSync(path.join(__dirname, '../engine/webgpu_gtao_stabilization.js'));
  const sourceBlob = crypto.createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
  assert.equal(sourceBlob, '8df297355612a7955baa2ce945e54fac12d8ee0d', 'Reconcile a changed production source before reusing this study.');
  assert.equal((candidate.code.match(/workgroupBarrier\(\)/g) || []).length, 2);
  assert.equal((candidate.code.match(/texture_storage_2d/g) || []).length, 4);
  assert.equal((candidate.code.match(/@binding\(/g) || []).length, 14);
  assert.ok(!candidate.code.split('fn cs_main')[1].includes('return;'), 'Padded lanes must reach barriers.');
  // Verify the entire baseline entry body survives byte-for-byte except diagnostic addresses.
  const before = G.TEMPORAL_WGSL.split('if(gid.x>=params.extent.x||gid.y>=params.extent.y){return;}')[1].slice(0, -2);
  let after = candidate.code.split('if(gid.x<params.extent.x&&gid.y<params.extent.y){')[1].split('\n  }\n  workgroupBarrier();')[0];
  for (let i = 0; i < S.FIELDS.length; i++) after = after.replace(`atomicAdd(&localStats[${i}],1u);`, `atomicAdd(&stats.${S.FIELDS[i]},1u);`);
  assert.equal(after, before, 'Pixel/rejection logic changed.');
  const prefix = G.TEMPORAL_WGSL.split('@compute @workgroup_size')[0];
  assert.ok(candidate.code.startsWith(prefix), 'Bindings/helpers changed.');
  for (const mutation of [G.TEMPORAL_WGSL + ' ', G.TEMPORAL_WGSL.replace('mix(cur,bounded', 'mix(bounded,cur'), '', null]) {
    await assert.rejects(S.createCandidate(mutation), /Unsupported/);
  }
  const dimensions = [[1,1],[1,9],[7,9],[8,8],[9,17],[65,33],[101,63]];
  const fixtures = [];
  for (const [width,height] of dimensions) for (const pattern of ['accepted','depth','object','normal','global','mixed','priority','disabled']) {
    const f = S.makeFixture(width, height, pattern, 3), model = S.aggregateModel(width, height, f.reasons);
    const ref = G.temporalReference(f.input, f.options), r = ref.diagnostics.reasons;
    const expected = [r.accepted,r.rejected,r.depth,r.object,r.normal,r.global+r.disabled,0,0];
    assert.deepEqual(model.direct, expected);
    assert.deepEqual(model.grouped, expected);
    assert.equal(expected[0] + expected[1], width * height);
    assert.equal(expected.slice(2,6).reduce((a,b)=>a+b,0), expected[1]);
    for (let i=0;i<f.reasons.length;i++) if (f.reasons[i]) assert.equal(ref.full[i], f.input.current[i]);
    fixtures.push({width,height,pattern,counters:expected});
  }
  let seed = 0x601c0de;
  const random = () => {seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0;};
  for (let k=0;k<512;k++) {
    const w=1+random()%67,h=1+random()%53,reasons=Uint8Array.from({length:w*h},()=>random()%5);
    const m=S.aggregateModel(w,h,reasons); assert.deepEqual(m.grouped,m.direct);
    assert.ok(m.candidateStorageAtomics<=6*m.groupsX*m.groupsY);
    assert.ok(m.candidateStorageAtomics<=m.baselineStorageAtomics);
  }
  for (const [w,h] of [[0,1],[-1,1],[1.5,2],[NaN,1],[Infinity,1],[8193,1],[8192,8192]]) assert.throws(()=>S.extent(w,h),RangeError);
  assert.throws(()=>S.aggregateModel(2,2,new Uint8Array(3)),TypeError);
  assert.throws(()=>S.aggregateModel(1,1,new Uint8Array([5])),RangeError);
  assert.throws(()=>S.makeFixture(1,1,'unknown'),RangeError);
  const fullHd={};
  for(const pattern of ['accepted','global']){
    const m=S.aggregateModel(1920,1080,new Uint8Array(1920*1080).fill(pattern==='accepted'?0:4));
    assert.deepEqual(m.direct,m.grouped);fullHd[pattern]=m;
  }
  assert.equal(fullHd.accepted.baselineStorageAtomics,2073600);
  assert.equal(fullHd.accepted.candidateStorageAtomics,32400);
  assert.equal(fullHd.global.baselineStorageAtomics,4147200);
  assert.equal(fullHd.global.candidateStorageAtomics,64800);
  const report={schema:S.SCHEMA,ok:true,sourceBlob,baselineSha256:S.BASELINE_SHA256,candidateSha256:candidate.candidateSha256,
    fixtureCases:fixtures.length,randomizedCounterCases:512,fixtures,fullHd,
    evidenceBoundary:'CPU/reference and source-preservation checks only. No shader execution or target-GPU performance is implied.'};
  if(args.length){fs.mkdirSync(path.dirname(args[1]),{recursive:true});fs.writeFileSync(args[1],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({ok:true,fixtureCases:fixtures.length,randomizedCounterCases:512,candidateSha256:candidate.candidateSha256}));
})().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
