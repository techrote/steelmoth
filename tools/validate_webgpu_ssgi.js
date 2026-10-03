'use strict';
const S=require('../engine/webgpu_ssgi.js');
const F=require('./sm602_ssgi_fixtures.js');
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const maxDiff=(a,b)=>a.length===b.length?a.reduce((value,x,i)=>Math.max(value,Math.abs(x-b[i])),0):Infinity;
let count=0;const check=(ok,message)=>{assert(ok,message);count++;};

const defaults=S.normalizeOptions({}),medium=S.normalizeOptions({enabled:true,quality:'Medium'}),high=S.normalizeOptions({enabled:true,quality:'High'}),ultra=S.normalizeOptions({enabled:true,quality:'Ultra'}),low=S.normalizeOptions({enabled:true,quality:'Low'});
check(defaults.enabled===false,'SSGI must stay disabled by default before SM-603');
check(low.enabled===false,'Low quality is an explicit SSGI off control');
check(medium.rays>=4&&medium.rays<=8&&high.rays>=medium.rays&&ultra.rays<=8,'quality ray ladder remains in bounded 4..8 range');
check(medium.steps>0&&ultra.steps<=S.LIMITS.steps[1],'quality trace steps remain bounded');
check(medium.historyWeight<1&&medium.energyMax>0&&medium.energyMax<=.1,'prototype history and energy controls remain restrained');
const excessive=S.normalizeOptions({enabled:true,rays:10000,steps:10000,radius:1e6,historyWeight:1,energyMax:1e6});
check(excessive.rays<=8&&excessive.steps<=S.LIMITS.steps[1],'caller cannot request unbounded ray/step work');
check(!('meta' in S.normalizeOptions({enabled:true,meta:{lightRevision:1}}))&&!('timestampWrites' in S.normalizeOptions({enabled:true,timestampWrites:{}})),'metadata and diagnostic timestamp hooks cannot change rendering/history policy');

const fixture=F.createFixture(),input=F.input(fixture);
let result=S.referenceSSGI(input,{enabled:true});
check(result.quarterWidth===17&&result.quarterHeight===13,'67×51 extent ceil-divides to 17×13 quarter output');
check(F.rgbMax(result.raw)>0,'bright nearby direct colour produces diffuse raw bounce');
check(F.finiteRGB(result.indirect)&&F.rgbMax(result.indirect)<=medium.energyMax+1e-6,'bounce remains finite and energy limited');
const cold=S.referenceSSGI(F.input(fixture,fixture,{historyValid:false}),{enabled:true});
check(F.rgbMax(cold.indirect)===0,'uninitialized previous resolved colour is exact neutral');
check(cold.rejection.every((value,i)=>i%4!==0||value===4),'uninitialized history marks global rejection');

const disabled=S.referenceSSGI(input,{enabled:false});
check(F.rgbMax(disabled.indirect)===0&&maxDiff(disabled.composed,fixture.colour)===0,'off preserves direct colour exactly');
const noGI=S.referenceSSGI(input,{enabled:true,quality:'Low'});
check(F.rgbMax(noGI.indirect)===0&&maxDiff(noGI.composed,fixture.colour)===0,'Low preserves direct colour exactly');

const dark=F.copy(fixture);for(let i=0;i<dark.object.length;i++)if(dark.object[i]===8)dark.colour.set([0,0,0,1],i*4);
const darkResult=S.referenceSSGI(F.input(fixture,dark),{enabled:true});
check(F.rgbMax(darkResult.raw)<F.rgbMax(result.raw)*.5,'previous donor radiance causally changes bounce');
const currentDark=S.referenceSSGI(F.input(dark,fixture),{enabled:true});
check(maxDiff(currentDark.raw,result.raw)===0,'current donor colour cannot substitute for the previous resolved colour');

for(const [kind,reason]of [['object',2],['depth',1],['normal',3]]){
  const previous=F.copy(fixture),x=18,y=22,index=y*fixture.width+x;
  if(kind==='object')previous.object[index]=77;
  if(kind==='depth'){previous.depth[index*2]-=.05;previous.depth[index*2+1]-=.05;}
  if(kind==='normal')previous.normal.set([1,.5,.5,.6],index*4);
  const rejected=S.referenceSSGI(F.input(fixture,previous),{enabled:true});
  const qi=(Math.floor(y/4)*rejected.quarterWidth+Math.floor(x/4))*4;
  check(rejected.rejection[qi]===reason,kind+' receiver mismatch rejects temporal history');
  const previousDonor=F.copy(fixture);
  for(let i=0;i<previousDonor.object.length;i++)if(previousDonor.object[i]===8){
    if(kind==='object')previousDonor.object[i]=9;
    if(kind==='depth'){previousDonor.depth[i*2]-=.05;previousDonor.depth[i*2+1]-=.05;}
    if(kind==='normal')previousDonor.normal.set([1,.5,.5,.6],i*4);
  }
  const donorRejected=S.referenceSSGI(F.input(fixture,previousDonor),{enabled:true});
  check(donorRejected.rejection.some((value,i)=>i%4===1&&value>0),kind+' previous donor mismatch rejects prior colour');
  check(F.rgbMax(donorRejected.raw)<F.rgbMax(result.raw),kind+' donor rejection reduces raw bounce');
}
for(const key of ['roomId','deviceGeneration','backendGeneration','cameraRevision','lightRevision']){
  const changed={...F.META,[key]:key==='roomId'?'new-room':2};
  const rejected=S.referenceSSGI(F.input(fixture,fixture,{currentMeta:changed}),{enabled:true});
  check(F.rgbMax(rejected.indirect)===0,key+' change globally rejects stale colour/history');
}

const extreme=F.copy(fixture);for(let i=0;i<extreme.object.length;i++)if(extreme.object[i]===8)extreme.colour.set([10000,0,0,1],i*4);
let prior=null;for(let iteration=0;iteration<16;iteration++){
  const bounded=S.referenceSSGI(F.input(extreme,extreme,{previousIndirect:prior}),{enabled:true});
  check(F.finiteRGB(bounded.indirect)&&F.rgbMax(bounded.indirect)<=medium.energyMax+1e-6,'extreme repeated HDR donor remains bounded');
  const redChromaRatio=medium.saturation/(medium.saturation+(1-medium.saturation)*.2126);
  for(let i=0;i<bounded.indirect.length;i+=4){const rgb=Array.from(bounded.indirect.subarray(i,i+3)),hi=Math.max(...rgb),lo=Math.min(...rgb);assert(hi<1e-8||(hi-lo)/hi<=redChromaRatio+1e-5,'documented luma-mix saturation bound fails');}
  prior=bounded.indirect;
}
check(true,'saturation clamps repeated primary-colour fireflies');
const whiteExtreme=F.copy(extreme);for(let i=0;i<whiteExtreme.object.length;i++)if(whiteExtreme.object[i]===8)whiteExtreme.colour.set([10000,10000,10000,1],i*4);
const clipped=S.referenceSSGI(F.input(whiteExtreme),{enabled:true,energyMax:.005});
check(F.rgbMax(clipped.raw)>.0049&&F.rgbMax(clipped.raw)<=.005001,'forced low energy cap clips extreme white donor');
const foreground=F.copy(fixture);for(let i=0;i<foreground.object.length;i++)if(foreground.object[i]===8){foreground.depth[i*2]-=.2;foreground.depth[i*2+1]-=.2;}
check(F.rgbMax(S.referenceSSGI(F.input(foreground),{enabled:true}).raw)===0,'foreground lane cannot leak into world indirect');
const empty=F.createFixture(9,7,'empty');check(F.rgbMax(S.referenceSSGI(F.input(empty),{enabled:true}).indirect)===0,'empty occupied range has exact neutral output');
const dense=F.createFixture(128,96,'dense'),denseResult=S.referenceSSGI(F.input(dense),{enabled:true});
check(F.finiteRGB(denseResult.indirect)&&F.rgbMax(denseResult.indirect)>0&&F.rgbMax(denseResult.indirect)<=medium.energyMax+1e-6,'dense fixture is bounded with diffuse response');
const thin=F.coarseBoundaryFixture(),thinResult=S.referenceSSGI(F.input(thin),{enabled:true});
check(thinResult.raw[(2*thinResult.quarterWidth+2)*4]>0,'early thin donor across coarse-cell boundary survives empty step endpoint');
const materials=F.materialBoundaryFixture(),materialResult=S.referenceSSGI(F.input(materials),{enabled:true}),materialIndex=x=>(22*materials.width+x)*4;
check([0,1,2].every(k=>materialResult.composed[materialIndex(28)+k]===materials.colour[materialIndex(28)+k]),'native zero albedo remains exact direct within a shared quarter cell');
check([1,2].every(k=>materialResult.composed[materialIndex(29)+k]===materials.colour[materialIndex(29)+k]),'native red texel cannot acquire green/blue diffuse through quarter receiver material');
check([0,1,2].every(k=>materialResult.composed[materialIndex(30)+k]===materials.colour[materialIndex(30)+k]),'fully metallic native texel receives exact zero diffuse indirect');
check(materialResult.composed[materialIndex(31)]>materials.colour[materialIndex(31)],'neighbor grey receiver still receives bounce next to metallic center');
const firstLight=F.movingRadianceFixture(0);let previousLight=firstLight,lightIndirect=null,lightControlDifference=0;
for(let frame=0;frame<9;frame++){
  const current=F.movingRadianceFixture(frame),moving=S.referenceSSGI(F.input(current,previousLight,{previousIndirect:lightIndirect}),{enabled:true});
  const held=S.referenceSSGI(F.input(current,firstLight,{previousIndirect:lightIndirect}),{enabled:true});
  check(F.finiteRGB(moving.indirect)&&F.rgbMax(moving.indirect)<=medium.energyMax+1e-6,'smooth moving/ramped radiance remains finite and bounded');
  check(maxDiff(current.depth,firstLight.depth)===0&&maxDiff(current.object,firstLight.object)===0,'moving radiance keeps canonical geometry stable');
  lightControlDifference=Math.max(lightControlDifference,maxDiff(moving.raw,held.raw));
  previousLight=current;lightIndirect=moving.indirect;
}
check(lightControlDifference>1e-4,'translated/ramped prior radiance causally changes bounce versus held-light control');
let previousObject=F.translatedDonorFixture(0),objectIndirect=null,totalVacated=0;
for(const offset of [0,4,8,12]){
  const current=F.translatedDonorFixture(offset),moving=S.referenceSSGI(F.input(current,previousObject,{previousIndirect:objectIndirect}),{enabled:true});
  check(F.finiteRGB(moving.indirect)&&F.rgbMax(moving.indirect)<=medium.energyMax+1e-6,'translated coverage remains finite and bounded');
  for(let y=0;y<moving.quarterHeight;y++)for(let x=0;x<moving.quarterWidth;x++){
    const px=Math.min(current.width-1,x*4+2),py=Math.min(current.height-1,y*4+2),i=py*current.width+px,qi=(y*moving.quarterWidth+x)*4;
    if(previousObject.object[i]!==8||current.object[i]!==7)continue;
    totalVacated++;assert(moving.rejection[qi]===2,'translated donor vacated ownership must reject old history');
    for(let k=0;k<3;k++){assert(moving.indirect[qi+k]===moving.raw[qi+k],'vacated geometry uses current irradiance exactly');assert(moving.composed[i*4+k]<=current.colour[i*4+k]+medium.energyMax*current.albedo[i*4+k]+1e-6,'vacated donor cannot retain stale direct brightness');}
  }
  previousObject=current;objectIndirect=moving.indirect;
}
check(totalVacated>0,'translated object sequence exercises real ownership/depth/material disocclusion');
check(maxDiff(fixture.colour,input.currentColour)===0&&maxDiff(fixture.depth,input.currentDepth)===0,'reference leaves canonical direct/depth inputs unchanged');
console.log(`SM-602 DETERMINISTIC PASS: ${count} assertions; diffuse bounce, prior colour, clamp, rejection, off, odd/empty/dense fixtures`);
