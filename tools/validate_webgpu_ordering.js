'use strict';
const assert=require('assert');
const O=require('../engine/webgpu_ordering.js');
let n=0;const ok=(cond,msg)=>{assert.ok(cond,msg);n++},eq=(a,b,msg)=>{assert.deepStrictEqual(a,b,msg);n++};

const expected=['opaque-resolved','water','fine-grass','foliage-background','world-alpha','world-additive','foliage-foreground','post','post-effects','top-additive','top-alpha','objective','guide','debug-ui-present'];
eq(O.STAGES,expected,'canonical order');
ok(O.stageDefinition('post').ordinal===7,'post ordinal is stable');
ok(O.stageDefinition('water').depth==='canonical-test+sample','water consumes canonical depth');
ok(O.stageDefinition('world-alpha').depth==='canonical-less-equal-no-write','world alpha cannot own depth');
ok(O.stageDefinition('top-alpha').depth==='always-top','top layer bypasses world depth');
ok(O.stageDefinition('post-effects').post==='after','compat FX remains after post');

const tf={stages:{'world-alpha':[{}],'world-additive':[{}],'top-additive':[{}],'top-alpha':[{}]},effects:[{kind:1}],objective:{visible:true},guide:{visible:true}};
const foliage={instances:[{id:'grass',fineGrass:true,frontBlend:.8},{id:'fern-back',frontBlend:.2},{id:'fern-front',frontBlend:.8}]};
const post=O.buildFramePlan({transparentFrame:tf,foliage,water:{enabled:true}});
ok(O.validatePlan(post),'post plan validates');
ok(post.mode==='post','default mode post');
ok(post.stages.find(q=>q.id==='water').enabled,'water enabled');
ok(post.stages.find(q=>q.id==='fine-grass').count===1,'Fine Grass counted');
ok(post.stages.find(q=>q.id==='foliage-background').count===1,'background foliage counted');
ok(post.stages.find(q=>q.id==='foliage-foreground').count===1,'foreground foliage counted');
ok(post.stages.find(q=>q.id==='post-effects').count===1,'procedural FX maps after post');
ok(post.stages.find(q=>q.id==='objective').count===1,'objective present');
ok(post.stages.find(q=>q.id==='guide').count===1,'guide present');

const raw=O.buildFramePlan({transparentFrame:tf,foliage,water:true,raw:true});
const debug=O.buildFramePlan({transparentFrame:tf,foliage,water:true,debug:true});
eq(raw.order,post.order,'raw preserves ordering');
eq(debug.order,post.order,'debug preserves ordering');
ok(raw.stages[7].operation==='raw-copy'&&raw.stages[7].bypassed,'raw has explicit copy at same boundary');
ok(debug.stages[7].operation==='debug-copy'&&debug.stages[7].bypassed,'debug has explicit copy at same boundary');

ok(O.classifyFoliage({fineGrass:true,frontBlend:1})==='fine-grass','fine grass never promoted to foreground overlay');
ok(O.classifyFoliage({frontBlend:.49})==='foliage-background','foliage background threshold');
ok(O.classifyFoliage({frontBlend:.5})==='foliage-foreground','foliage foreground threshold');
ok(O.stageForContribution({kind:'water'})==='water','water contribution mapped');
ok(O.stageForContribution({kind:'fx'})==='post-effects','gameplay FX mapped after post');
ok(O.stageForContribution({kind:'top',additive:true})==='top-additive','top additive mapped');
ok(O.stageForContribution({kind:'objective'})==='objective','objective mapped');
ok(O.stageForContribution({kind:'guide'})==='guide','guide mapped');

ok(O.canonicalDepthAccept(.3,.4),'nearer world fragment accepted');
ok(!O.canonicalDepthAccept(.5,.4),'farther world fragment rejected');
ok(O.contributionVisible({kind:'foliage',frontBlend:.8,depth01:.8},.4),'explicit foreground foliage may cross actor surface');
ok(!O.contributionVisible({kind:'foliage',frontBlend:.2,depth01:.8},.4),'background foliage cannot cross nearer actor');
ok(!O.contributionVisible({kind:'water',depth01:.8},.4),'water cannot cover nearer actor');
ok(!O.contributionVisible({kind:'world-alpha',depth01:.8},.4),'world alpha cannot cover nearer actor');
ok(O.contributionVisible({kind:'objective',depth01:1},.1),'objective readability bypasses world depth');

const stack=[{id:'guide',kind:'guide'},{id:'actor',kind:'actor'},{id:'water-behind',kind:'water',depth01:.8},{id:'grass-behind',kind:'fine-grass',depth01:.7},{id:'foliage-behind',kind:'foliage',frontBlend:.2,depth01:.7},{id:'alpha-behind',kind:'world-alpha',depth01:.75},{id:'glow-near',kind:'world-additive',depth01:.2},{id:'foliage-front',kind:'foliage',frontBlend:.9,depth01:.9},{id:'fx',kind:'fx'},{id:'objective',kind:'objective'}];
const sim=O.simulateLayerStack(stack,{opaqueDepth:.4});
eq(sim.order,['opaque-resolved','water','fine-grass','foliage-background','world-alpha','world-additive','foliage-foreground','post-effects','objective','guide'],'representative layer stack canonicalized');
eq(sim.accepted.map(q=>q.id),['actor','glow-near','foliage-front','fx','objective','guide'],'actor/foliage/water/effect visibility semantics');
eq(sim.rejected.map(q=>q.id),['water-behind','grass-behind','foliage-behind','alpha-behind'],'behind-actor world layers rejected');

const rows=O.debugRows(post);eq(rows.map(q=>q.code),Array.from({length:14},(_,i)=>i+1),'debug row IDs stable');
ok(rows.every(q=>q.reason&&q.depth&&q.post),'every stage is documented in diagnostics');
const d=O.diagnostics(post);ok(d.hiddenBackendOrdering===false,'hidden backend order prohibited');
ok(d.rawDebugSameOrdering===true,'diagnostics declare bypass semantics');
ok(d.waterSceneSource==='opaque-resolved','water source avoids transparent feedback cycle');
ok(d.readabilityLayers.join(',')==='post-effects,top-additive,top-alpha,objective,guide','readability tail explicit');

assert.throws(()=>O.stageForContribution({kind:'mystery'}),/no documented stage/);n++;
const bad=JSON.parse(JSON.stringify(post));bad.stages[1].backendOrder='surprise';assert.throws(()=>O.validatePlan(bad),/hidden backend ordering/);n++;
const swapped=JSON.parse(JSON.stringify(post));[swapped.stages[7],swapped.stages[8]]=[swapped.stages[8],swapped.stages[7]];assert.throws(()=>O.validatePlan(swapped),/order differs/);n++;

console.log(`SM-402 ordering validation: PASS (${n} assertions)`);
