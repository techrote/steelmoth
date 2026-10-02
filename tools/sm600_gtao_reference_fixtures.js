'use strict';
/* Independent finite-input fixtures for the reconstruction-policy repair.
 * No runtime imports this file. Adapted from the isolated #106 witness, not
 * dependent on that unmerged branch or either optimization candidate. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SteelMothGTAOReferenceFixtures=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const BASELINE_RAW_SHA256='d6bbbf28517866d9b3ca6e5de3b54847e4147f89a15df1be3ce47200d0cbae78';
  const BASELINE_UP_SHA256='7ddda64b8e31f11998ce77abb721c4b1e105e468e1e3785e28374eb0c9ef81cd';
  const POLICY_BITS=0x358637bd; // f32 conversion of the deployed 0.000001 literal.
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function f32FromBits(bits){return new Float32Array(new Uint32Array([bits]).buffer)[0];}
  function halfBits(value){
    if(!Number.isFinite(value)||Math.abs(value)>65504)throw new RangeError('Fixture value must be finite and fit binary16.');
    const u=new Uint32Array(new Float32Array([value]).buffer)[0],sign=(u>>>16)&0x8000;
    let e=((u>>>23)&255)-127+15,m=u&0x7fffff;
    if(e<=0){if(e< -10)return sign;m|=0x800000;const shift=14-e,base=m>>>shift,rem=m&((1<<shift)-1),tie=1<<(shift-1);return sign|(base+((rem>tie||(rem===tie&&(base&1)))?1:0));}
    let base=m>>>13,rem=m&8191;if(rem>4096||(rem===4096&&(base&1)))base++;if(base===1024){e++;base=0;}return sign|(e<<10)|base;
  }
  function fromHalf(v){const sign=v&0x8000?-1:1,e=(v>>>10)&31,m=v&1023;return sign*(e===0?m*2**-24:e===31?(m?NaN:Infinity):(1+m/1024)*2**(e-15));}
  function halfArray(a){return Float32Array.from(a,x=>fromHalf(halfBits(x)));}
  function decodedNormal(a,i){const n=[a[4*i]*2-1,a[4*i+1]*2-1,a[4*i+2]*2-1],len=Math.hypot(...n);if(!(len>0))throw new RangeError('Zero decoded normal is excluded from finite WGSL fixtures.');return n.map(x=>x/len);}
  function base(width,height){
    if(![width,height].every(v=>Number.isInteger(v)&&v>=1&&v<=65))throw new RangeError('Bounded fixture extent required.');
    const depth=new Float32Array(width*height*2),normal=new Float32Array(width*height*4),hw=Math.ceil(width/2),hh=Math.ceil(height/2),data=new Float32Array(hw*hh*4);
    for(let i=0;i<width*height;i++){depth.set([.5,.5],2*i);normal.set([.5,.5,1,.75],4*i);}
    for(let i=0;i<hw*hh;i++)data.set([.25+(i%4)/8,.5,1,.75-(i%4)/8],4*i);
    return {width,height,depth,normal,raw:{width:hw,height:hh,data},options:{enabled:true,depthSigma:180,normalPower:4,debugMode:'visibility'}};
  }
  function weakFixture(){const f=base(4,4);f.raw.data.set([.25,.5,1,.75,.75,.5,1,.25,.75,.5,1,.25,.75,.5,1,.25]);for(const i of [5,7,13,15])f.normal.set([1,.5,.5126953125,.75],4*i);return f;}
  // Deliberately independent of the engine cutoff/predicate. This calculates
  // the four ordered taps in JS double precision on actual uploaded values.
  function oracleAt(f,x,y,threshold= f32FromBits(POLICY_BITS)){
    const {width:w,height:h,depth,normal,raw,options:o}=f,i=y*w+x;
    if(!o.enabled||depth[2*i]>depth[2*i+1])return {visibility:1,confidence:1,nearest:1,weightSum:0,neutral:true,supported:false};
    const n=decodedNormal(normal,i),hw=raw.width,hh=raw.height;let ws=0,vs=0,nearest=1;
    for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++){
      const hx=Math.min(hw-1,Math.floor(x/2)+ox),hy=Math.min(hh-1,Math.floor(y/2)+oy),j=(hy*hw+hx)*4;
      if(ox===0&&oy===0)nearest=raw.data[j];if(raw.data[j+2]<.5)continue;
      const sx=Math.min(w-1,hx*2+1),sy=Math.min(h-1,hy*2+1),m=decodedNormal(normal,sy*w+sx);
      const dw=1/(1+Math.abs(depth[2*i]-raw.data[j+1])*o.depthSigma),dot=Math.max(0,n[0]*m[0]+n[1]*m[1]+n[2]*m[2]),sp=1/(1+Math.hypot(x-sx,y-sy));
      const weight=dw*Math.pow(dot,o.normalPower)*sp;ws+=weight;vs+=raw.data[j]*weight;
    }
    const supported=ws>threshold;
    return {visibility:supported?clamp(vs/ws,0,1):nearest,confidence:supported?clamp(ws/2,0,1):0,nearest,weightSum:ws,neutral:false,supported};
  }
  function optionsBytes(o){return {...o,depthSigma:Math.fround(o.depthSigma),normalPower:Math.fround(o.normalPower)};}
  function cases(){
    const list=[],add=(name,f)=>{f.options=optionsBytes(f.options);f.normal=halfArray(f.normal);f.raw.data=halfArray(f.raw.data);list.push({name,...f});};
    add('original-4x4-witness',weakFixture());
    // Inputs stay binary16-exact; adjust only the existing continuous f32
    // exponent control. Targets straddle both proposed policies, with >=1%
    // margin. Exact adjacent-f32 comparison is tested separately.
    const weak=weakFixture(),at=oracleAt(weak,0,0),n=decodedNormal(weak.normal,5)[2],factor=at.weightSum/Math.pow(n,4);
    for(const target of [5e-9,9.9e-9,1.01e-8,2e-8,1e-7,5e-7,9.9e-7,1.01e-6,2e-6,1e-5]){
      const f=weakFixture();f.options.normalPower=Math.fround(Math.log(target/factor)/Math.log(n));add(`weight-${target}`,f);
    }
    for(const sigma of [16,180,512])for(const power of [1,4,12]){
      const f=weakFixture();for(let i=0;i<16;i++)f.depth.set([.99,.99],2*i);for(let j=0;j<4;j++)f.raw.data[j*4+1]=.01;
      f.options.depthSigma=sigma;f.options.normalPower=power;add(`depth-${sigma}-normal-${power}`,f);
    }
    for(const [w,h] of [[1,1],[1,9],[9,1],[3,5],[8,8],[9,9],[17,13]]){
      for(const kind of ['occupied','empty','raw-empty','opposed','disabled','mixed']){
        const f=base(w,h);
        for(let i=0;i<w*h;i++){
          if(kind==='empty'||(kind==='mixed'&&i%5===0))f.depth.set([1,0],i*2);
          if(kind==='mixed'&&i%3===0)f.normal.set([1,.5,.5126953125,.75],i*4);
          if(kind==='opposed')f.normal.set([.5,.5,0,.75],i*4);
        }
        if(kind==='opposed')for(let hy=0;hy<f.raw.height;hy++)for(let hx=0;hx<f.raw.width;hx++){const x=Math.min(w-1,2*hx+1),y=Math.min(h-1,2*hy+1);f.normal.set([.5,.5,1,.75],4*(y*w+x));}
        if(kind==='raw-empty')for(let j=0;j<f.raw.data.length;j+=4)f.raw.data[j+2]=0;
        if(kind==='disabled')f.options.enabled=false;
        add(`${w}x${h}-${kind}`,f);
      }
    }
    // The nearest raw tap is invalid but the others are valid: retain the
    // existing nearest-raw fallback, not a new valid-tap search.
    {const f=weakFixture();f.raw.data[2]=0;add('nearest-invalid-retained',f);}
    // Explicit binary16 rounding ties and minimum-normal-depth metadata.
    {const f=weakFixture();f.raw.data[1]=.500244140625;f.raw.data[5]=.500732421875;f.options.depthSigma=512;add('half-depth-ties',f);}
    return list;
  }
  function stockScenes(){
    const rects={
      plane:[],
      box:[{x0:23,y0:9,x1:41,y1:31,depth:.35}],
      bin:[{x0:18,y0:12,x1:31,y1:32,depth:.37},{x0:30,y0:9,x1:45,y1:32,depth:.33}],
      cabinet:[{x0:20,y0:7,x1:44,y1:34,depth:.36},{x0:26,y0:12,x1:38,y1:29,depth:.31}],
      dense:[{x0:8,y0:11,x1:21,y1:32,depth:.39},{x0:19,y0:7,x1:34,y1:31,depth:.34},{x0:33,y0:10,x1:47,y1:34,depth:.30},{x0:46,y0:6,x1:58,y1:29,depth:.36}],
      tilted:[{x0:24,y0:10,x1:40,y1:31,depth:.34,normal:[.8,.5,.9]}],
      disabled:[{x0:24,y0:10,x1:40,y1:31,depth:.34}]
    };
    return Object.entries(rects).map(([name,rs])=>{
      const f=base(64,40);for(let i=0;i<64*40;i++){f.depth.set([.62,.62],2*i);f.normal[4*i+3]=.55;}
      for(const r of rs)for(let y=r.y0;y<r.y1;y++)for(let x=r.x0;x<r.x1;x++){const i=y*64+x;f.depth.set([r.depth,r.depth],2*i);if(r.normal)f.normal.set(r.normal,4*i);}
      f.name=name;f.options=name==='disabled'?{enabled:false}:{};return f;
    });
  }
  function boundaryWeights(){const values=[0,1e-9,5e-9,5e-7,2e-6,1];for(const bits of [0x322bcc77,POLICY_BITS])for(let offset=-2;offset<=2;offset++)values.push(f32FromBits(bits+offset));return Float32Array.from(values);}
  function lowerThresholdShader(source){const anchor='if(ws>0.000001)';if(source.split(anchor).length!==2)throw new Error('Expected deployed reconstruction guard exactly once.');return source.replace(anchor,'if(ws>0.00000001)');}
  return {BASELINE_RAW_SHA256,BASELINE_UP_SHA256,POLICY_BITS,f32FromBits,halfBits,fromHalf,halfArray,base,weakFixture,oracleAt,cases,stockScenes,boundaryWeights,lowerThresholdShader};
});
