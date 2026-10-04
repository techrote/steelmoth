'use strict';
const fs=require('fs'),crypto=require('crypto');
global.SteelMothWebGPUResources=require('../engine/webgpu_resources.js');
global.SteelMothWebGPUDepthHierarchy=require('../engine/webgpu_depth_hierarchy.js');
global.SteelMothPseudoDepth=require('../engine/pseudo_depth.js');
global.SteelMothWebGPUGTAOStabilization=require('../engine/webgpu_gtao_stabilization.js');
const B=require('./experiments/sm603_ssgi_baseline.js'),S=require('../engine/webgpu_ssgi.js'),F=require('./sm603_ssgi_fixtures.js'),V=require('../engine/webgpu_visibility.js');
const assert=(ok,message)=>{if(!ok)throw new Error(message);};let assertions=0;const check=(ok,message)=>{assert(ok,message);assertions++;};
const frozen=fs.readFileSync(require.resolve('./experiments/sm603_ssgi_baseline.js'),'utf8').replace(/\r\n/g,'\n');
check(crypto.createHash('sha256').update(frozen).digest('hex')===F.BASELINE_SHA256,'frozen SM-602 producer identity changed');
check(S.normalizeOptions({}).enabled===false,'SSGI remains optional and disabled by default');
for(const quality of ['Low','Medium','High','Ultra']){const o=S.normalizeOptions({enabled:true,quality});check(o.rays>=4&&o.rays<=8&&o.steps>=4&&o.steps<=8,'quality trace is bounded');check(o.historyWeight<1&&o.energyMax<=.12,'quality temporal/energy controls bounded');check(quality!=='Low'||o.enabled===false,'Low stays off');}
const scene=F.createFixture(),deleted=F.partialDeletion(),blocker=F.partialDeletion(true),q=scene.metadata?.witnessQuarter?.index??24,qi=q*4;
function warm(api,f,frames=30,options={enabled:true}){let prior={historyValid:false},r;for(let i=0;i<frames;i++){r=api.referenceSSGI(F.input(f,f,prior),options);prior={indirect:r.indirect,donorCoordinates:r.donorCoordinates,historyValid:true};}return r;}
const beforeB=warm(B,scene),beforeS=warm(S,scene);
check(F.maxDiff(beforeB.raw,beforeS.raw)<1e-6&&F.maxDiff(beforeB.indirect,beforeS.indirect)<1e-6,'stable scene preserves frozen baseline diffuse arithmetic');
const afterB=B.referenceSSGI(F.input(deleted,scene,beforeB),{enabled:true}),afterS=S.referenceSSGI(F.input(deleted,scene,beforeS),{enabled:true});
check(afterB.rejection[qi]===0&&afterB.raw[qi+3]>0&&afterB.indirect[qi]-afterB.raw[qi]>.003,'frozen baseline reproduces partial-donor stale bounce witness');
check(afterS.rejection[qi]===6,'changed donor coordinates reject eligible receiver history');
check([0,1,2].every(k=>afterS.indirect[qi+k]===afterS.raw[qi+k]),'partial deletion uses current irradiance exactly');
check(afterS.donorCoordinates instanceof Uint32Array&&afterS.donorCoordinates.length===afterS.quarterWidth*afterS.quarterHeight*8,'bounded eight-coordinate history contract explicit');
check(F.maxDiff(afterB.raw,afterS.raw)<1e-6,'stabilization changes history eligibility, preserving current rays');
let prior=afterS;for(let i=0;i<12;i++){const r=S.referenceSSGI(F.input(deleted,deleted,prior),{enabled:true});check(F.finiteRGB(r.indirect)&&r.indirect[qi]<=r.raw[qi]+1e-6,'deleted donor cannot reappear through stale history');prior=r;}
const revealed=S.referenceSSGI(F.input(blocker,scene,beforeS),{enabled:true});check(revealed.rejection.some((v,i)=>i%4===1&&v>0),'revealed darker blocker rejects old resolved donor colour');check(F.finiteRGB(revealed.indirect),'revealed blocker remains finite');
let previous=scene,translationPrior=beforeS,vacated=0;
for(const offset of [4,8,12]){const f=F.translatedDonorFixture(offset),r=S.referenceSSGI(F.input(f,previous,translationPrior),{enabled:true});for(let y=0;y<r.quarterHeight;y++)for(let x=0;x<r.quarterWidth;x++){const p=Math.min(f.height-1,y*4+2)*f.width+Math.min(f.width-1,x*4+2),i=(y*r.quarterWidth+x)*4;if(previous.object[p]===8&&f.object[p]===7){vacated++;assert(r.rejection[i]!==0,'vacated ownership must reject old history');for(let k=0;k<3;k++)assert(r.indirect[i+k]===r.raw[i+k],'vacated pixel has exact current irradiance');}}check(F.finiteRGB(r.indirect),'translated frame remains finite');previous=f;translationPrior=r;}
check(vacated>0,'translation exercises real ownership/depth/material disocclusion');
for(const key of ['roomId','deviceGeneration','backendGeneration','cameraRevision','lightRevision']){const meta={...F.META,[key]:key==='roomId'?'new-room':2},r=S.referenceSSGI(F.input(scene,scene,beforeS,meta,F.META),{enabled:true});check(F.rgbMax(r.indirect)===0&&r.rejection.every((v,i)=>i%4!==0||v===4),key+' reset discards colour/history');}
const extreme=F.copy(scene);for(let i=0;i<extreme.object.length;i++)if(extreme.object[i]===8)extreme.colour.set([10000,0,0,1],i*4);prior={historyValid:false};for(let i=0;i<32;i++){const r=S.referenceSSGI(F.input(extreme,extreme,prior),{enabled:true});check(F.finiteRGB(r.indirect)&&F.rgbMax(r.indirect)<=.080001,'repeated pathological HDR cannot grow past energy cap');prior=r;}
check(scene.colour.some((v,i)=>v!==extreme.colour[i]),'pathological source alters donor input rather than fabricating post-filter evidence');
const noVisibility=warm(S,scene),neutralFrame=S.referenceSSGI(F.input(scene,scene,noVisibility),{enabled:true}),aoOptions={dso:false,selfShadow:false,contactShadow:false,darkBloom:false,materialAO:true,gtao:true,materialAOStrength:1,gtaoStrength:1,ambientFloor:0};
const ambient=V.composeSample({materialAO:.6,gtaoVisibility:.5},aoOptions).ambientVisibility;
const withVisibility=S.referenceSSGI({...F.input(scene,scene,noVisibility),currentAmbientVisibility:new Float32Array(scene.width*scene.height).fill(ambient)},{enabled:true});
let tested=0;for(let i=0;i<scene.width*scene.height;i++)for(let k=0;k<3;k++){const full=neutralFrame.composed[i*4+k]-scene.colour[i*4+k];if(full<1e-5)continue;const attenuated=withVisibility.composed[i*4+k]-scene.colour[i*4+k];assert(Math.abs(attenuated-full*ambient)<1e-6,'native indirect addition consumes actual SM-307 ambient once');tested++;}
check(tested>0&&ambient===.5,'actual SM-307 strongest-occluder contract is exercised without invented AO composition');
console.log(`SM-603 DETERMINISTIC PASS: ${assertions} assertions; baseline stale=${(afterB.indirect[qi]-afterB.raw[qi]).toFixed(8)} candidate=${(afterS.indirect[qi]-afterS.raw[qi]).toFixed(8)} donor-coordinates, disocclusion, reset, firefly and ambient-once gates`);
