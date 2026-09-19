'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothSM800=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SCHEMA='steelmoth-sm800-precision-study/v1';
  const WIDTH=1920,HEIGHT=1080,PIXELS=WIDTH*HEIGHT;
  const FORMAT_BYTES=Object.freeze({rgba8unorm:4,rgba16float:8,r32uint:4,depth32float:4,rg11b10ufloat:4});
  const CORE=Object.freeze({g0:'rgba8unorm',objectId:'r32uint',depth:'depth32float'});
  const LAYOUTS=Object.freeze({
    baseline:Object.freeze({g1:'rgba16float',g2:'rgba16float',hdr:'rgba16float'}),
    material8:Object.freeze({g1:'rgba16float',g2:'rgba8unorm',hdr:'rgba16float'}),
    octMaterial8:Object.freeze({g1:'rgba8unorm',g2:'rgba8unorm',hdr:'rgba16float'}),
    hdr11:Object.freeze({g1:'rgba16float',g2:'rgba16float',hdr:'rg11b10ufloat'}),
    combined:Object.freeze({g1:'rgba8unorm',g2:'rgba8unorm',hdr:'rg11b10ufloat'}),
  });
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const q8=v=>Math.round(clamp(Number(v)||0,0,1)*255)/255;
  const normalize=v=>{const d=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/d,v[1]/d,v[2]/d]};
  const signNotZero=v=>v<0?-1:1;
  function octEncode(v){let [x,y,z]=normalize(v),s=Math.abs(x)+Math.abs(y)+Math.abs(z)||1;x/=s;y/=s;z/=s;if(z<0){const ox=(1-Math.abs(y))*signNotZero(x),oy=(1-Math.abs(x))*signNotZero(y);x=ox;y=oy}return [x*.5+.5,y*.5+.5]}
  function octDecode(e){let x=Number(e[0])*2-1,y=Number(e[1])*2-1,z=1-Math.abs(x)-Math.abs(y);if(z<0){const ox=(1-Math.abs(y))*signNotZero(x),oy=(1-Math.abs(x))*signNotZero(y);x=ox;y=oy}return normalize([x,y,z])}
  function angularErrorDeg(a,b){const d=clamp(a[0]*b[0]+a[1]*b[1]+a[2]*b[2],-1,1);return Math.acos(d)*180/Math.PI}
  function normalSamples(){const out=[];for(let iy=0;iy<64;iy++){const phi=((iy+.5)/64)*Math.PI*2;for(let iz=0;iz<64;iz++){const z=((iz+.5)/64)*2-1,r=Math.sqrt(Math.max(0,1-z*z));out.push([r*Math.cos(phi),r*Math.sin(phi),z])}}return out}
  function analyzeOct8(){let maxAngle=0,sum=0,count=0;for(const n of normalSamples()){const e=octEncode(n),d=octDecode([q8(e[0]),q8(e[1])]),a=angularErrorDeg(n,d);maxAngle=Math.max(maxAngle,a);sum+=a;count++}return {samples:count,maxAngleDeg:maxAngle,meanAngleDeg:sum/count,thresholdDeg:1.0,pass:maxAngle<=1.0}}
  function analyzeMaterial8(){let maxError=0,sum=0,count=0;for(let i=0;i<=4096;i++){const v=i/4096,e=Math.abs(q8(v)-v);maxError=Math.max(maxError,e);sum+=e;count++}return {samples:count,maxAbsError:maxError,meanAbsError:sum/count,threshold:1/510+1e-9,pass:maxError<=1/510+1e-9}}
  function layoutBytes(layout){const l=LAYOUTS[layout];if(!l)throw new Error(`unknown SM-800 layout ${layout}`);const formats={...CORE,...l};let bpp=0;for(const f of Object.values(formats)){const n=FORMAT_BYTES[f];if(!n)throw new Error(`unknown format byte size ${f}`);bpp+=n}return {layout,formats,bytesPerPixel:bpp,bytes1080p:bpp*PIXELS,mib1080p:bpp*PIXELS/(1024*1024)}}
  function memoryTable(){const base=layoutBytes('baseline');return Object.keys(LAYOUTS).map(name=>{const x=layoutBytes(name),saved=base.bytes1080p-x.bytes1080p;return {...x,bytesSaved1080p:saved,mibSaved1080p:saved/(1024*1024),fractionSaved:saved/base.bytes1080p}})}
  function summarize(values){const a=Array.from(values||[]).map(Number).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return {count:0,meanMs:null,p50Ms:null,p95Ms:null,minMs:null,maxMs:null};const pick=p=>a[Math.min(a.length-1,Math.max(0,Math.ceil(a.length*p)-1))];return {count:a.length,meanMs:a.reduce((n,v)=>n+v,0)/a.length,p50Ms:pick(.5),p95Ms:pick(.95),minMs:a[0],maxMs:a[a.length-1]}}
  function deterministicReport(){return {schema:SCHEMA,extent:{width:WIDTH,height:HEIGHT,pixels:PIXELS},reference:'explicit XYZ/material float G-buffer + rgba16float HDR',coreInvariant:{...CORE},layouts:memoryTable(),oct8:analyzeOct8(),material8:analyzeMaterial8(),evidenceBoundary:'Descriptor memory and CPU quantization analysis only. GPU timing and browser format support require the real-WebGPU browser probe; GTX 1650 SUPER adoption requires the physical target run.'}}
  return {SCHEMA,WIDTH,HEIGHT,PIXELS,FORMAT_BYTES,CORE,LAYOUTS,q8,normalize,octEncode,octDecode,angularErrorDeg,analyzeOct8,analyzeMaterial8,layoutBytes,memoryTable,summarize,deterministicReport};
});
