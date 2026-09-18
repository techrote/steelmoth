'use strict';

(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUOrdering=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  const SCHEMA='steelmoth-webgpu-ordering/v1';
  const EPSILON=1e-6;
  const STAGE_DEFINITIONS=Object.freeze([
    Object.freeze({id:'opaque-resolved',code:1,domain:'world',source:'SM-204/SM-307 resolved opaque scene',depth:'canonical-owner',blend:'replace',post:'pre',reason:'Canonical opaque/material ownership is the stable scene input for every later forward pass.'}),
    Object.freeze({id:'water',code:2,domain:'world',source:'SM-400 water',depth:'canonical-test+sample',blend:'alpha',post:'pre',reason:'Water refracts the resolved opaque scene and must reject fragments hidden by nearer canonical ownership.'}),
    Object.freeze({id:'fine-grass',code:3,domain:'world',source:'SM-401 Fine Grass',depth:'canonical-test+sample',blend:'alpha',post:'pre',reason:'Receiver-only Fine Grass stays in the lit world and cannot become a post/UI overlay.'}),
    Object.freeze({id:'foliage-background',code:4,domain:'world',source:'SM-401 foliage',depth:'canonical-test+actor-relative',blend:'alpha',post:'pre',reason:'Background-classified rooted foliage stays behind representative actors/props using canonical depth plus the SM-401 classifier.'}),
    Object.freeze({id:'world-alpha',code:5,domain:'world',source:'SM-206 transparent sprites',depth:'canonical-less-equal-no-write',blend:'alpha',post:'pre',reason:'Ordinary transparent world sprites are rejected behind opaque ownership without stealing depth.'}),
    Object.freeze({id:'world-additive',code:6,domain:'world',source:'SM-206 transparent sprites',depth:'canonical-less-equal-no-write',blend:'additive',post:'pre',reason:'World glow sprites share canonical depth policy but retain additive compatibility blending.'}),
    Object.freeze({id:'foliage-foreground',code:7,domain:'world',source:'SM-401 foliage',depth:'actor-relative-front',blend:'alpha',post:'pre',reason:'Only foliage explicitly classified in front may cross the actor/prop surface; the ordering decision is data, not submission order.'}),
    Object.freeze({id:'post',code:8,domain:'output',source:'SM-207 post/raw/debug',depth:'none',blend:'replace',post:'transform',reason:'Bloom/grade or raw/debug copy transforms the complete lit world once; bypass changes the operation, not layer semantics.'}),
    Object.freeze({id:'post-effects',code:9,domain:'readability',source:'SM-206 procedural gameplay FX',depth:'none',blend:'additive',post:'after',reason:'Compatibility shader FX intentionally remain after final world post so feedback intensity/readability is not regraded.'}),
    Object.freeze({id:'top-additive',code:10,domain:'readability',source:'SM-206 top sprites',depth:'always-top',blend:'additive',post:'after',reason:'Top glow feedback bypasses world depth and remains above post-effects.'}),
    Object.freeze({id:'top-alpha',code:11,domain:'readability',source:'SM-206 top sprites',depth:'always-top',blend:'alpha',post:'after',reason:'Top alpha sprites preserve the compatibility ordering after top glows.'}),
    Object.freeze({id:'objective',code:12,domain:'readability',source:'SM-206 objective marker',depth:'always-top',blend:'additive',post:'after',reason:'The active objective marker remains readable above top sprites.'}),
    Object.freeze({id:'guide',code:13,domain:'readability',source:'SM-206 guide',depth:'always-top',blend:'additive',post:'after',reason:'Guide feedback is the final gameplay readability layer, matching the accepted compatibility path.'}),
    Object.freeze({id:'debug-ui-present',code:14,domain:'present',source:'diagnostics/UI/present',depth:'none',blend:'explicit',post:'after',reason:'Debug ordering visualization and external UI/present happen after gameplay layers and are never implicit renderer ordering.'})
  ]);
  const STAGES=Object.freeze(STAGE_DEFINITIONS.map(q=>q.id));
  const BY_ID=Object.freeze(Object.fromEntries(STAGE_DEFINITIONS.map((q,i)=>[q.id,Object.freeze({...q,ordinal:i})])));
  const PRE_POST_WORLD=new Set(['opaque-resolved','water','fine-grass','foliage-background','world-alpha','world-additive','foliage-foreground']);
  const AFTER_POST=new Set(['post-effects','top-additive','top-alpha','objective','guide','debug-ui-present']);
  const READABILITY=new Set(['post-effects','top-additive','top-alpha','objective','guide']);
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const present=v=>Array.isArray(v)?v.length>0:!!v;
  const count=v=>Array.isArray(v)?v.length:Number.isFinite(Number(v))?Math.max(0,Math.floor(Number(v))):(v?1:0);

  function assertKnownStage(id){if(!BY_ID[id])throw new Error(`SM-402 unknown render stage: ${String(id)}`);return id}
  function stageDefinition(id){return BY_ID[assertKnownStage(id)]}
  function canonicalStageOrder(){return STAGES.slice()}

  function classifyFoliage(instance={}){
    if(instance.fineGrass===true||instance.category==='SHORT_GRASS'||instance.role==='fine-grass')return 'fine-grass';
    const blend=clamp(finite(instance.frontBlend??instance.front_blend??instance.depthBlend,0),0,1);
    return blend>=.5?'foliage-foreground':'foliage-background';
  }

  function stageForContribution(record={}){
    if(record.stage)return assertKnownStage(String(record.stage));
    const kind=String(record.kind||record.type||record.role||'').toLowerCase();
    if(kind==='opaque'||kind==='actor'||kind==='prop'||kind==='opaque-resolved')return 'opaque-resolved';
    if(kind==='water')return 'water';
    if(kind==='fine-grass'||kind==='grass')return 'fine-grass';
    if(kind==='foliage'||kind==='plant')return classifyFoliage(record);
    if(kind==='world-alpha'||kind==='transparent'||kind==='alpha')return 'world-alpha';
    if(kind==='world-additive'||kind==='glow'||kind==='additive')return 'world-additive';
    if(kind==='fx'||kind==='post-effect'||kind==='post-effects')return 'post-effects';
    if(kind==='top-additive')return 'top-additive';
    if(kind==='top'||kind==='top-alpha')return record.additive?'top-additive':'top-alpha';
    if(kind==='objective'||kind==='objective-marker')return 'objective';
    if(kind==='guide')return 'guide';
    if(kind==='debug'||kind==='ui'||kind==='present')return 'debug-ui-present';
    throw new Error(`SM-402 contribution has no documented stage: ${kind||'<empty>'}`);
  }

  function transparentCounts(frame={}){
    const s=frame.stages||{};
    return{
      'world-alpha':count(s['world-alpha']),
      'world-additive':count(s['world-additive']),
      'post-effects':Math.max(count(s['post-effects']),count(frame.effects)),
      'top-additive':count(s['top-additive']),
      'top-alpha':count(s['top-alpha']),
      objective:frame.objective?1:0,
      guide:frame.guide?1:0
    };
  }

  function foliageCounts(input={}){
    let fine=0,back=0,front=0;
    if(Array.isArray(input.instances))for(const q of input.instances){const stage=classifyFoliage(q);if(stage==='fine-grass')fine++;else if(stage==='foliage-foreground')front++;else back++;}
    fine=Math.max(fine,count(input.fineGrass??input.fineGrassCount));
    back=Math.max(back,count(input.background??input.backgroundCount));
    front=Math.max(front,count(input.foreground??input.foregroundCount));
    return{'fine-grass':fine,'foliage-background':back,'foliage-foreground':front};
  }

  function buildFramePlan(options={}){
    const tf=transparentCounts(options.transparentFrame||{}),ff=foliageCounts(options.foliage||{}),raw=!!options.raw,debug=!!options.debug;
    const counts={
      'opaque-resolved':1,
      water:options.water===false?0:(present(options.water)||options.waterEnabled?1:0),
      'fine-grass':ff['fine-grass'],
      'foliage-background':ff['foliage-background'],
      'world-alpha':tf['world-alpha'],
      'world-additive':tf['world-additive'],
      'foliage-foreground':ff['foliage-foreground'],
      post:1,
      'post-effects':tf['post-effects'],
      'top-additive':tf['top-additive'],
      'top-alpha':tf['top-alpha'],
      objective:tf.objective,
      guide:tf.guide,
      'debug-ui-present':1
    };
    const stages=STAGE_DEFINITIONS.map(d=>({
      ...d,
      ordinal:BY_ID[d.id].ordinal,
      enabled:counts[d.id]>0,
      count:counts[d.id],
      operation:d.id==='post'?(debug?'debug-copy':raw?'raw-copy':'post'):d.id,
      bypassed:d.id==='post'&&(raw||debug)
    }));
    const plan={schema:SCHEMA,mode:debug?'debug':raw?'raw':'post',stages,order:STAGES.slice(),postIndex:BY_ID.post.ordinal,diagnostics:{waterSceneSource:'opaque-resolved',worldDepthAuthority:'SM-201/SM-202 canonical depth',foliageAuthority:'SM-401 frontBlend/depth classifier',postAuthority:'SM-207',transparentAuthority:'SM-206',hiddenBackendOrdering:false}};
    validatePlan(plan);
    return plan;
  }

  function validatePlan(plan){
    if(!plan||plan.schema!==SCHEMA)throw new Error('SM-402 frame plan schema mismatch');
    const ids=(plan.stages||[]).map(q=>q.id);if(ids.length!==STAGES.length||ids.some((id,i)=>id!==STAGES[i]))throw new Error('SM-402 frame plan order differs from canonical contract');
    const post=ids.indexOf('post');if(post<0)throw new Error('SM-402 post boundary missing');
    for(let i=0;i<ids.length;i++){
      const id=ids[i],d=BY_ID[id];if(!d)throw new Error(`SM-402 undocumented stage ${id}`);
      if(PRE_POST_WORLD.has(id)&&i>=post)throw new Error(`SM-402 world stage crossed post boundary: ${id}`);
      if(AFTER_POST.has(id)&&i<=post)throw new Error(`SM-402 after-post stage crossed world boundary: ${id}`);
      const q=plan.stages[i];if(q.ordinal!==i)throw new Error(`SM-402 non-canonical ordinal for ${id}`);
      if(q.hiddenOrder||q.backendOrder)throw new Error(`SM-402 hidden backend ordering is forbidden: ${id}`);
    }
    if(plan.diagnostics?.waterSceneSource!=='opaque-resolved')throw new Error('SM-402 water must refract the stable opaque-resolved scene, not a later transparent target');
    return true;
  }

  function compareContributions(a,b){const sa=stageForContribution(a),sb=stageForContribution(b),d=BY_ID[sa].ordinal-BY_ID[sb].ordinal;if(d)return d;const za=finite(a.order??a.seq,0),zb=finite(b.order??b.seq,0);if(za!==zb)return za-zb;return String(a.id||'').localeCompare(String(b.id||''));}
  function sortContributions(records=[]){return records.slice().sort(compareContributions)}

  function canonicalDepthAccept(fragmentDepth,opaqueDepth){
    const f=finite(fragmentDepth,1),o=finite(opaqueDepth,1);return f<=o+EPSILON;
  }

  function contributionVisible(record={},opaqueDepth=1){
    const stage=stageForContribution(record),policy=BY_ID[stage].depth;
    if(policy==='canonical-less-equal-no-write'||policy==='canonical-test+sample')return canonicalDepthAccept(record.depth01,opaqueDepth);
    if(stage==='foliage-background')return canonicalDepthAccept(record.depth01,opaqueDepth)&&clamp(finite(record.frontBlend,0),0,1)<.5;
    if(stage==='foliage-foreground')return clamp(finite(record.frontBlend,1),0,1)>=.5;
    return true;
  }

  function simulateLayerStack(records=[],options={}){
    const sorted=sortContributions(records),opaqueDepth=finite(options.opaqueDepth,1),accepted=[],rejected=[];
    for(const r of sorted){const stage=stageForContribution(r),ok=contributionVisible(r,opaqueDepth);(ok?accepted:rejected).push({id:String(r.id||stage),stage,reason:ok?'visible':`depth/classification rejected by ${BY_ID[stage].depth}`});}
    return{schema:`${SCHEMA}/layer-stack`,mode:options.mode||'post',order:sorted.map(r=>stageForContribution(r)),accepted,rejected,opaqueDepth};
  }

  function debugRows(plan){validatePlan(plan);return plan.stages.map(q=>({id:q.id,ordinal:q.ordinal,code:q.code,enabled:q.enabled,count:q.count,depth:q.depth,post:q.post,operation:q.operation,reason:q.reason}));}

  const DEBUG_COPY_WGSL=`
struct Codes { values:array<u32,16> };
@group(0) @binding(0) var<storage,read> src:Codes;
@group(0) @binding(1) var<storage,read_write> dst:Codes;
@compute @workgroup_size(16)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  if(i<16u){dst.values[i]=src.values[i];}
}`;

  async function encodeDebugStageIds(device,plan){
    validatePlan(plan);if(!device?.createBuffer||!device?.createComputePipelineAsync)throw new Error('SM-402 WebGPU device is required for debug stage readback');
    const U=root?.GPUBufferUsage;if(!U)throw new Error('SM-402 GPUBufferUsage unavailable');
    const values=new Uint32Array(16);values[0]=plan.stages.length;for(let i=0;i<Math.min(15,plan.stages.length);i++)values[i+1]=plan.stages[i].code;
    const src=device.createBuffer({label:'sm402:debug-stage-src',size:values.byteLength,usage:U.STORAGE|U.COPY_DST});
    const dst=device.createBuffer({label:'sm402:debug-stage-dst',size:values.byteLength,usage:U.STORAGE|U.COPY_SRC});
    device.queue.writeBuffer(src,0,values);
    const module=device.createShaderModule({label:'sm402:debug-ordering',code:DEBUG_COPY_WGSL});
    const pipeline=await device.createComputePipelineAsync({label:'sm402:debug-ordering',layout:'auto',compute:{module,entryPoint:'main'}});
    const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:src}},{binding:1,resource:{buffer:dst}}]});
    const encoder=device.createCommandEncoder({label:'sm402:debug-ordering'}),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(1);pass.end();device.queue.submit([encoder.finish()]);
    return{buffer:dst,source:src,values,bytes:values.byteLength};
  }

  function diagnostics(plan=buildFramePlan({})){
    validatePlan(plan);return{schema:SCHEMA,canonicalOrder:STAGES.slice(),postIndex:BY_ID.post.ordinal,rawDebugSameOrdering:true,waterSceneSource:'opaque-resolved',depthAuthority:'SM-201/SM-202',foliageAuthority:'SM-401 frontBlend/depth classifier',transparentAuthority:'SM-206',postAuthority:'SM-207',readabilityLayers:[...READABILITY],hiddenBackendOrdering:false,stages:debugRows(plan)};
  }

  return{SCHEMA,STAGES,STAGE_DEFINITIONS,stageDefinition,canonicalStageOrder,classifyFoliage,stageForContribution,buildFramePlan,validatePlan,sortContributions,canonicalDepthAccept,contributionVisible,simulateLayerStack,debugRows,encodeDebugStageIds,diagnostics,DEBUG_COPY_WGSL};
});
