'use strict';
const S=require('../engine/webgpu_gtao_stabilization.js');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;

const names=S.QUALITY_NAMES;
assert(JSON.stringify(names)===JSON.stringify(['Low','Medium','High','Ultra']),'quality names changed');
const low=S.resolveQuality('Low'),medium=S.resolveQuality('Medium'),high=S.resolveQuality('High'),ultra=S.resolveQuality('Ultra');
assert(low.gtao.enabled===false&&low.temporal.enabled===false,'Low must remain an explicit cheap/off GTAO tier');
assert(medium.gtao.directions===6&&medium.gtao.steps===4,'Medium must preserve the SM-600 representative horizon budget');
assert(high.gtao.directions>=medium.gtao.directions&&ultra.gtao.steps>=high.gtao.steps,'quality ladder must be monotonic');
assert(medium.temporal.historyWeight<=.60,'Medium temporal reuse must stay conservative');
assert(ultra.temporal.historyWeight<.75,'Ultra history may not become a trail-hiding long accumulator');

const width=4,height=3,count=width*height;
const current=new Float32Array(count).fill(.75),previous=new Float32Array(count).fill(.55);
const cd=new Float32Array(count*2),pd=new Float32Array(count*2),co=new Uint32Array(count),po=new Uint32Array(count),cn=new Float32Array(count*4),pn=new Float32Array(count*4);
for(let i=0;i<count;i++){cd[i*2]=pd[i*2]=.4;cd[i*2+1]=pd[i*2+1]=.5;co[i]=po[i]=7;cn.set([.5,.5,1,1],i*4);pn.set([.5,.5,1,1],i*4);}
const meta={roomId:'r1',deviceGeneration:3,backendGeneration:2};
let r=S.temporalReference({width,height,current,previous,currentDepth:cd,previousDepth:pd,currentObject:co,previousObject:po,currentNormal:cn,previousNormal:pn,historyValid:true,currentMeta:meta,previousMeta:meta},{quality:'Medium'});
assert(r.diagnostics.reasons.accepted===count,'stable frame should accept all history');
assert(r.full.every(v=>v>=.55&&v<=.750001),'accepted history must remain bounded by current-neighborhood clamp');

co[2]=8;
r=S.temporalReference({width,height,current,previous,currentDepth:cd,previousDepth:pd,currentObject:co,previousObject:po,currentNormal:cn,previousNormal:pn,historyValid:true,currentMeta:meta,previousMeta:meta},{quality:'Medium'});
assert(r.rejectMask[2]===1&&near(r.full[2],.75),'object ownership change must reject history');
co[2]=7;
cd[4]=.46;
r=S.temporalReference({width,height,current,previous,currentDepth:cd,previousDepth:pd,currentObject:co,previousObject:po,currentNormal:cn,previousNormal:pn,historyValid:true,currentMeta:meta,previousMeta:meta},{quality:'Medium'});
assert(r.rejectMask[2]===1&&r.diagnostics.reasons.depth>=1,'depth discontinuity must reject history');
cd[4]=.4;
pn.set([1,.5,.5,1],2*4);
r=S.temporalReference({width,height,current,previous,currentDepth:cd,previousDepth:pd,currentObject:co,previousObject:po,currentNormal:cn,previousNormal:pn,historyValid:true,currentMeta:meta,previousMeta:meta},{quality:'Medium'});
assert(r.rejectMask[2]===1&&r.diagnostics.reasons.normal>=1,'normal discontinuity must reject history');
pn.set([.5,.5,1,1],2*4);

r=S.temporalReference({width,height,current,previous,currentDepth:cd,previousDepth:pd,currentObject:co,previousObject:po,currentNormal:cn,previousNormal:pn,historyValid:true,currentMeta:{...meta,roomId:'r2'},previousMeta:meta},{quality:'Medium'});
assert(r.diagnostics.reasons.global===count&&r.full.every(v=>near(v,.75)),'room transition must reject the entire history');

const spikeCurrent=new Float32Array(count).fill(.8),spikePrev=new Float32Array(count).fill(.1);spikeCurrent[5]=.2;spikePrev[5]=.95;
r=S.temporalReference({width,height,current:spikeCurrent,previous:spikePrev,currentDepth:cd,previousDepth:pd,currentObject:co,previousObject:po,currentNormal:cn,previousNormal:pn,historyValid:true,currentMeta:meta,previousMeta:meta},{quality:'Medium'});
assert(r.full[5]<=.34,'history delta clamp must bound disocclusion trails');

const disabled=S.temporalReference({width,height,current,previous,currentDepth:cd,previousDepth:pd,currentObject:co,previousObject:po,currentNormal:cn,previousNormal:pn,historyValid:true,currentMeta:meta,previousMeta:meta},{quality:'Low'});
assert(disabled.full.every(v=>near(v,.75))&&disabled.diagnostics.reasons.disabled===count,'Low/disabled temporal path must be output-neutral');

console.log(`SM-601 DETERMINISTIC PASS: quality=${names.join('/')} stableAccepted=${count} object/depth/normal/room rejection=pass clamp=pass`);