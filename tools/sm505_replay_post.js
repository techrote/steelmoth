#!/usr/bin/env node
'use strict';

// CPU-only companion to analyze_sm505_capture.py. Input/output are JSON on
// stdin/stdout; requiring the verified production post module creates no GPU.
const fs=require('fs');
function main(input){
  if(input.schema!=='steelmoth-sm505-post-replay-input/v1')throw new Error('unsupported replay input schema');
  const P=require(input.modulePath),settings=input.settings||{},normalized=P.normalizeSettings(settings);
  const base={schema:'steelmoth-sm505-post-replay/v1',physicalAcceptance:false,visualAcceptance:false,normalizedSettings:normalized};
  const maximum=input.maximumPrePostLuminance;
  if(!Number.isFinite(maximum)||maximum<0)throw new Error('finite nonnegative maximum pre-post luminance required');
  // Sampling/blur cannot exceed the maximum of finite nonnegative source
  // luminances. Otherwise bloom must actually be replayed, which is not part of
  // this observer; never substitute zero for a potentially nonzero bloom image.
  if(normalized.bloom&&maximum>normalized.bloomThreshold)return{...base,status:'UNSUPPORTED_NONZERO_BLOOM',reason:'Pre-post luminance exceeds the effective production bloom threshold; zero-bloom replay is unsupported.',maximumPrePostLuminance:maximum,bloomThreshold:normalized.bloomThreshold};
  const [width,height]=input.extent||[];
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw new Error('positive integer extent required');
  const indices=input.pixelIndices,linear=input.linearRGB,final=input.finalBytes,raw=input.rawBytes;
  if(!Array.isArray(indices)||!Array.isArray(linear)||!Array.isArray(final)||!Array.isArray(raw)||linear.length!==indices.length*3||final.length!==linear.length||raw.length!==linear.length)throw new Error('owned pixel array lengths differ');
  const grade=input.grade||[1,1,1];if(!Array.isArray(grade)||grade.length!==3||!grade.every(Number.isFinite))throw new Error('finite RGB grade required');
  const byte=v=>Math.round(Math.max(0,Math.min(1,v))*255);
  const histogram=Array(256).fill(0),examples=[];
  let expectedBlack=0,actualBlack=0,expectedExactZero=0,actualExactZero=0,blackAgreement=0,rawMaximumError=0,sumAbsoluteError=0,maximumError=0;
  for(let i=0;i<indices.length;i++){
    const index=indices[i];if(!Number.isSafeInteger(index)||index<0||index>=width*height||(i&&index<=indices[i-1]))throw new Error('pixel indices must be sorted, unique and in bounds');
    const x=index%width,y=Math.floor(index/width),c=linear.slice(i*3,i*3+3),actual=final.slice(i*3,i*3+3),actualRaw=raw.slice(i*3,i*3+3);
    if(!c.every(v=>Number.isFinite(v)&&v>=0)||![...actual,...actualRaw].every(v=>Number.isInteger(v)&&v>=0&&v<=255))throw new Error('invalid linear source or unorm output byte');
    const expected=P.applyPostReference(c,[0,0,0],settings,grade,[(x+.5)/width,(y+.5)/height],[x+.5,y+.5]).map(byte);
    const expectedRaw=P.linearToSrgb(c).map(byte),error=expected.map((v,k)=>Math.abs(v-actual[k])),worst=Math.max(...error);
    if(!expected.every(Number.isFinite))throw new Error('production reference produced nonfinite output');
    histogram[worst]++;maximumError=Math.max(maximumError,worst);sumAbsoluteError+=error.reduce((a,b)=>a+b,0);
    rawMaximumError=Math.max(rawMaximumError,...expectedRaw.map((v,k)=>Math.abs(v-actualRaw[k])));
    const eMax=Math.max(...expected),aMax=Math.max(...actual),eb=eMax<=1,ab=aMax<=1;
    expectedBlack+=eb;actualBlack+=ab;expectedExactZero+=eMax===0;actualExactZero+=aMax===0;blackAgreement+=eb===ab;
    if(worst>1&&examples.length<12)examples.push({x,y,inputLinear:c,expectedByte:expected,actualByte:actual,absoluteByteError:error});
  }
  const count=indices.length,ratio=v=>count?v/count:null;
  return{...base,status:'ANALYZED',extent:[width,height],bloom:{zeroEstablished:true,enabled:normalized.bloom,threshold:normalized.bloomThreshold,maximumPrePostLuminance:maximum,reason:normalized.bloom?'Maximum source luminance does not exceed the effective extraction threshold.':'Original captured settings disable bloom.'},mask:'canonical SM-202 objectID !=0',blackDefinition:'maximum RGB <=1 output code of255',count,expectedBlack,actualBlack,expectedBlackFraction:ratio(expectedBlack),actualBlackFraction:ratio(actualBlack),expectedExactZero,actualExactZero,blackClassificationAgreement:ratio(blackAgreement),exactBytePixelFraction:ratio(histogram[0]),withinOneOutputCodePixelFraction:ratio(histogram[0]+histogram[1]),maximumAbsoluteByteError:maximumError,meanAbsoluteByteError:count?sumAbsoluteError/(count*3):null,maximumRawAbsoluteByteError:rawMaximumError,pixelMaximumAbsoluteByteErrorHistogram:histogram,examplesOverOneCode:examples,boundary:'Equation agreement and known-failure diagnosis only. Agreement with the shipped grading equation never establishes visual acceptance.'};
}
try{const result=main(JSON.parse(fs.readFileSync(0,'utf8')));process.stdout.write(JSON.stringify(result)+'\n')}catch(error){process.stderr.write(String(error?.stack||error)+'\n');process.exitCode=1}
