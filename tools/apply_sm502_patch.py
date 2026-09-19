#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def read(path): return (ROOT/path).read_text(encoding='utf-8')
def write(path,text):
    p=ROOT/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8')
def repl(text,old,new,label):
    if old not in text: raise SystemExit(f'SM-502 patch anchor missing: {label}')
    if text.count(old)!=1: raise SystemExit(f'SM-502 patch anchor not unique ({text.count(old)}): {label}')
    return text.replace(old,new)

# --- SM-200 G-buffer: sRGB source decode exactly once, data channels stay linear. ---
p='engine/webgpu_gbuffer.js';s=read(p)
s=repl(s,"  const align=(v,m=256)=>Math.ceil(Math.max(0,Number(v)||0)/m)*m;\n",
"  const align=(v,m=256)=>Math.ceil(Math.max(0,Number(v)||0)/m)*m;\n  const srgbChannelToLinear=v=>{v=clamp(finite(v,0),0,1);return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)};\n  const srgbToLinear=value=>{const v=Array.isArray(value)?value:[value,value,value];return [srgbChannelToLinear(v[0]),srgbChannelToLinear(v[1]),srgbChannelToLinear(v[2])]};\n",'gbuffer transfer helpers')
s=repl(s,"tint:Array.isArray(style.tint)?style.tint.slice(0,3).map(v=>finite(v,1)):[1,1,1]",
"tint:srgbToLinear(Array.isArray(style.tint)?style.tint.slice(0,3).map(v=>finite(v,1)):[1,1,1])",'gbuffer authored tint decode')
s=repl(s,"base=in.tintAlpha.rgb*(.28+lum*.98)+pow(max(t.rgb,vec3f(0)),vec3f(2.4))*.12;",
"base=in.tintAlpha.rgb*(.28+lum*.98)+max(t.rgb,vec3f(0))*.12;",'remove tint gamma-space shaping')
old="const usage=textureUsage(['COPY_DST','TEXTURE_BINDING','RENDER_ATTACHMENT']),make=(name,src)=>{const tex=this.device.createTexture({label:`${this.labelPrefix}:${name}`,size:{width,height,depthOrArrayLayers:1},format:'rgba8unorm',usage});this.queue.copyExternalImageToTexture({source:src},{texture:tex},{width,height,depthOrArrayLayers:1});return tex};this.atlas={albedo:make('albedo',albedo),normalRoughness:make('normal-roughness',normalRoughness),heightMaterial:make('height-material',heightMaterial),width,height};"
new="const usage=textureUsage(['COPY_DST','TEXTURE_BINDING']),make=(name,src,format)=>{const tex=this.device.createTexture({label:`${this.labelPrefix}:${name}`,size:{width,height,depthOrArrayLayers:1},format,usage});this.queue.copyExternalImageToTexture({source:src},{texture:tex,colorSpace:'srgb'},{width,height,depthOrArrayLayers:1});return tex};this.atlas={albedo:make('albedo',albedo,'rgba8unorm-srgb'),normalRoughness:make('normal-roughness',normalRoughness,'rgba8unorm'),heightMaterial:make('height-material',heightMaterial,'rgba8unorm'),width,height,formats:{albedo:'rgba8unorm-srgb',normalRoughness:'rgba8unorm',heightMaterial:'rgba8unorm'}};"
s=repl(s,old,new,'gbuffer atlas formats')
s=repl(s,"atlas:this.atlas?{width:this.atlas.width,height:this.atlas.height}:null,compilation:",
"atlas:this.atlas?{width:this.atlas.width,height:this.atlas.height,formats:{...this.atlas.formats}}:null,colourSpace:{albedoSource:'srgb-external-image -> rgba8unorm-srgb -> sampled-linear',tints:'authored-srgb -> cpu-linear',g0:'linear-albedo-rgba8unorm',g1:'linear-normal-roughness',g2:'linear-height-metalness-ao-emissive',debug:'raw-linear/data values; presentation must display-transform'},compilation:",'gbuffer diagnostics colour contract')
s=repl(s,"objectIdForStableId,regionRect,compatibilityHeightFactor,buildSceneInstances,packInstances,halfToFloat,WebGPUMaterialGBuffer",
"objectIdForStableId,regionRect,compatibilityHeightFactor,srgbChannelToLinear,srgbToLinear,buildSceneInstances,packInstances,halfToFloat,WebGPUMaterialGBuffer",'gbuffer export transfer helpers')
write(p,s)

# --- SM-204 lighting: canonical authored light colours are decoded before GGX. ---
p='engine/webgpu_lighting.js';s=read(p)
s=repl(s,"  function normalizedColor(value){return Array.isArray(value)?[finite(value[0],1),finite(value[1],1),finite(value[2],1)]:[1,1,1]}\n",
"  function normalizedColor(value){const c=Array.isArray(value)?[finite(value[0],1),finite(value[1],1),finite(value[2],1)]:[1,1,1];return GBuffer.srgbToLinear(c)}\n",'lighting authored colour decode')
s=repl(s,"outputFormat:OUTPUT_FORMAT,renderCount:this.renderCount,lights:this.lastLights.map(clone),compilation:",
"outputFormat:OUTPUT_FORMAT,renderCount:this.renderCount,lights:this.lastLights.map(clone),colourSpace:{g0:'linear-albedo',materialChannels:'linear-data',authoredLightColors:'srgb-decoded-during-canonicalization',ggx:'linear-hdr',output:'linear-hdr-rgba16float',debug:{final:'linear-hdr',diffuse:'linear-hdr',specular:'linear-hdr','light-count':'unitless-linear'}},compilation:",'lighting diagnostics colour contract')
write(p,s)

# --- SM-207 post: all bloom/grading stays linear; encode sRGB only at display output. ---
p='engine/webgpu_post.js';s=read(p)
s=repl(s,"  const lum=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;\n",
"  const lum=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;\n  const linearChannelToSrgb=v=>{v=Math.max(0,finite(v,0));return v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055};\n  const linearToSrgb=value=>{const v=Array.isArray(value)?value:[value,value,value];return [linearChannelToSrgb(v[0]),linearChannelToSrgb(v[1]),linearChannelToSrgb(v[2])]};\n",'post transfer helpers')
s=repl(s,"      c[i]=Math.pow(Math.max(c[i],0),.96);\n",
"      c[i]=linearChannelToSrgb(Math.max(c[i],0));\n",'post reference display encode')
s=repl(s,"fn luminance(c:vec3f)->f32{return dot(c,vec3f(.2126,.7152,.0722));}\n",
"fn luminance(c:vec3f)->f32{return dot(c,vec3f(.2126,.7152,.0722));}\nfn linear_to_srgb(c:vec3f)->vec3f{let x=max(c,vec3f(0));let lo=x*12.92;let hi=1.055*pow(x,vec3f(1.0/2.4))-.055;return select(hi,lo,x<=vec3f(.0031308));}\n",'post WGSL display helper')
s=repl(s,"  return vec4f(pow(max(c,vec3f(0)),vec3f(.96)),1);\n",
"  return vec4f(linear_to_srgb(c),1);\n",'post WGSL display encode')
s=repl(s,"  let p=vec2i(floor(frag.xy));return textureLoad(scene,p,0);\n",
"  let p=vec2i(floor(frag.xy));let c=textureLoad(scene,p,0);let x=max(c.rgb,vec3f(0));let lo=x*12.92;let hi=1.055*pow(x,vec3f(1.0/2.4))-.055;return vec4f(select(hi,lo,x<=vec3f(.0031308)),c.a);\n",'raw display encode')
s=repl(s,"colorSpaceBoundary:'compatibility transfer retained; colour-space redesign deferred to SM-502'",
"colorSpaceBoundary:'scene+bloom+grading are linear/HDR; final and raw presentation apply IEC sRGB transfer exactly once into an sRGB canvas'",'post diagnostics boundary')
s=repl(s,"SCHEMA,DEFAULTS,normalizeSettings,bloomPassesForQuality,applyPostReference,packPostSettings",
"SCHEMA,DEFAULTS,normalizeSettings,bloomPassesForQuality,linearChannelToSrgb,linearToSrgb,applyPostReference,packPostSettings",'post export transfer helpers')
write(p,s)

# --- SM-102 canvas boundary: make the browser output colour space explicit. ---
p='engine/webgpu_device.js';s=read(p)
s=repl(s,"const descriptor={device:this.device,format:this.format,alphaMode:'premultiplied'};",
"const descriptor={device:this.device,format:this.format,alphaMode:'premultiplied',colorSpace:'srgb'};",'canvas explicit sRGB')
s=repl(s,"this.configuration={format:this.format,alphaMode:'premultiplied',width:this.canvas.width,height:this.canvas.height,dpr:scale};",
"this.configuration={format:this.format,alphaMode:'premultiplied',colorSpace:'srgb',width:this.canvas.width,height:this.canvas.height,dpr:scale};",'canvas diagnostics sRGB')
write(p,s)

# --- Deterministic inherited tests updated to the corrected contract. ---
p='tools/validate_webgpu_gbuffer.js';s=read(p)
s=repl(s,"assert.equal(instances[0].heightFactor,1);assert.equal(instances[0].tintStrength,.07);assert.equal(instances[0].materialModeValue,G.MATERIAL_MODE.normal);assert.deepEqual(instances[0].tint,[1,.5,.25]);",
"assert.equal(instances[0].heightFactor,1);assert.equal(instances[0].tintStrength,.07);assert.equal(instances[0].materialModeValue,G.MATERIAL_MODE.normal);assert.deepEqual(instances[0].tint,G.srgbToLinear([1,.5,.25]));",'gbuffer deterministic tint expectation')
write(p,s)

p='tools/validate_webgpu_post.js';s=read(p)
s=repl(s,"check(P.BRIGHT_WGSL.includes('knee=.12')&&P.BLUR_WGSL.includes('.227027')&&P.POST_WGSL.includes('smoothstep(.12,.56')&&P.RAW_WGSL.includes('textureLoad'),'WGSL pins bright/blur/post/raw compatibility equations');",
"check(P.BRIGHT_WGSL.includes('knee=.12')&&P.BLUR_WGSL.includes('.227027')&&P.POST_WGSL.includes('linear_to_srgb')&&P.RAW_WGSL.includes('1.0/2.4'),'WGSL pins linear bloom/grade and explicit sRGB presentation transfer');",'post deterministic source assertion')
write(p,s)

# --- Real WebGPU G-buffer readback now expects decoded linear albedo. ---
p='webgpu-gbuffer-smoke.html';s=read(p)
s=repl(s,"  const expectedNormal=p=>{let x=p[0]/255*2-1,y=p[1]/255*2-1,z=p[2]/255*2-1;const d=Math.hypot(x,y,z)||1;x/=d;y/=d;z/=d;return[x*.5+.5,y*.5+.5,z*.5+.5,p[3]/255]};\n",
"  const expectedNormal=p=>{let x=p[0]/255*2-1,y=p[1]/255*2-1,z=p[2]/255*2-1;const d=Math.hypot(x,y,z)||1;x/=d;y/=d;z/=d;return[x*.5+.5,y*.5+.5,z*.5+.5,p[3]/255]};\n  const linearByte=v=>Math.round(G.srgbChannelToLinear(v/255)*255);\n  const linearRgb=p=>p.slice(0,3).map(linearByte);\n",'gbuffer smoke linear helpers')
s=repl(s,"check(got.g0.slice(0,3).every((v,i)=>Math.abs(v-ap[i])<=1)&&got.g0[3]===255,`${label} albedo/binary coverage readback matches raw PNG semantics`,{got:got.g0,source:ap});",
"check(got.g0.slice(0,3).every((v,i)=>Math.abs(v-linearRgb(ap)[i])<=1)&&got.g0[3]===255,`${label} albedo is sRGB-decoded exactly once into linear G0`,{got:got.g0,sourceSrgb:ap,expectedLinear:linearRgb(ap)});",'production albedo readback expectation')
s=repl(s,"check(syntheticFlat.g0.slice(0,3).every((v,i)=>Math.abs(v-[96,112,128][i])<=1)&&syntheticFlat.g0[3]===255,'synthetic flat control reaches the production pass with binary coverage',syntheticFlat.g0);",
"check(syntheticFlat.g0.slice(0,3).every((v,i)=>Math.abs(v-linearRgb([96,112,128])[i])<=1)&&syntheticFlat.g0[3]===255,'synthetic flat control reaches linear G0 with binary coverage',syntheticFlat.g0);",'synthetic albedo linear expectation')
s=repl(s,"for(const p of edge){check(Math.abs(p.g0[0]-96)<=1&&Math.abs(p.g0[1]-112)<=1&&Math.abs(p.g0[2]-128)<=1,'nearest region-safe sampling does not leak adjacent atlas texels',p.g0)}",
"for(const p of edge){const e=linearRgb([96,112,128]);check(Math.abs(p.g0[0]-e[0])<=1&&Math.abs(p.g0[1]-e[1])<=1&&Math.abs(p.g0[2]-e[2])<=1,'nearest region-safe sampling does not leak adjacent atlas texels',p.g0)}",'atlas edge linear expectation')
s=repl(s,"result.diagnostics=gb.diagnostics();check(result.diagnostics.depthAttachmentPolicy.includes('writes disabled')",
"result.diagnostics=gb.diagnostics();check(result.diagnostics.atlas.formats.albedo==='rgba8unorm-srgb'&&result.diagnostics.colourSpace.g0.includes('linear'),'albedo source is sampled through the sRGB view and G0 is explicitly linear');check(result.diagnostics.depthAttachmentPolicy.includes('writes disabled')",'gbuffer smoke diagnostics')
write(p,s)

# --- Real WebGPU post smoke now treats raw as raw-linear scene + display transfer. ---
p='webgpu-post-smoke.html';s=read(p)
s=repl(s,"await render(base,[1,1,1],true);let raw=await read(10,10);result.samples.raw=raw;check(Math.abs(raw[0]-48)<=1&&Math.abs(raw[1]-76)<=1&&Math.abs(raw[2]-108)<=1,'raw bypass copies scene without post transform',{raw});",
"await render(base,[1,1,1],true);let raw=await read(10,10);result.samples.raw=raw;const rawExpected=[48,76,108].map(v=>Math.round(P.linearChannelToSrgb(v/255)*255));check(raw.slice(0,3).every((v,i)=>Math.abs(v-rawExpected[i])<=1),'raw bypass skips grading/bloom but applies the required linear-to-sRGB display transfer',{raw,rawExpected});",'post smoke raw display expectation')
s=repl(s,"ctx.configure({device,format:preferred,alphaMode:'opaque'});",
"ctx.configure({device,format:preferred,alphaMode:'opaque',colorSpace:'srgb'});",'post smoke canvas sRGB')
s=repl(s,"check(result.diagnostics.colorSpaceBoundary.includes('SM-502'),'colour-space redesign explicitly deferred');",
"check(result.diagnostics.colorSpaceBoundary.includes('linear/HDR')&&result.diagnostics.colorSpaceBoundary.includes('sRGB'),'diagnostics expose the corrected linear/HDR to sRGB display boundary');",'post smoke diagnostics')
write(p,s)

# --- Dedicated numeric colour-space regression. ---
write('tools/validate_webgpu_colour.js',r'''#!/usr/bin/env node
'use strict';
const assert=require('assert');
const G=require('../engine/webgpu_gbuffer.js');
const L=require('../engine/webgpu_lighting.js');
const P=require('../engine/webgpu_post.js');
const near=(a,b,e=1e-6,m='')=>assert.ok(Math.abs(a-b)<=e,`${m}: ${a} vs ${b}`);
const round=(v,n=7)=>Number(v.toFixed(n));
const checks=[];const check=(v,m)=>{assert.ok(v,m);checks.push(m)};
near(G.srgbChannelToLinear(.5),.2140411405,1e-9,'sRGB 0.5 decode');
near(P.linearChannelToSrgb(.18),.4613561295,1e-9,'18% linear grey display encode');
near(G.srgbChannelToLinear(P.linearChannelToSrgb(.18)),.18,1e-9,'18% grey round trip');
for(const v of [0,.0031308,.018,.18,.5,1])near(G.srgbChannelToLinear(P.linearChannelToSrgb(v)),v,2e-7,`round trip ${v}`);
for(const p of [[1,0,0],[0,1,0],[0,0,1],[1,1,1]])assert.deepStrictEqual(G.srgbToLinear(p),p,'primaries/white invariant at endpoints');
const tint=G.buildSceneInstances({materials:[{id:'m',overrides:{mode:'normal'}}],sprites:[{id:'s',category:'dynamic',atlas:'hd',spriteId:'x',materialId:'m',root:{y:0},transform:{x:0,y:0,w:1,h:1},style:{tint:[.5,.25,1],alpha:1,glow:false}}]},{source_size:[1,1],world_scale:1,regions:{x:[0,0,1,1]}})[0].tint;
near(tint[0],.2140411405,1e-9,'authored tint red decoded');near(tint[1],.0508760882,1e-9,'authored tint green decoded');
const lights=L.buildCanonicalLights({lights:[{id:'l',x:0,y:0,z:1,radius:10,intensity:1,color:[.5,.25,1]}]},{lighting:true,lightRadius:1,emissive:1});
near(lights[0].color[0],.2140411405,1e-9,'canonical light red decoded');near(lights[0].color[1],.0508760882,1e-9,'canonical light green decoded');
const dielectric={albedo:G.srgbToLinear([.5,.5,.5]),normalRoughness:[.5,.5,1,.5],heightMaterial:[0,0,1,0]};
const metal={...dielectric,heightMaterial:[0,1,1,0]};
const white=L.buildCanonicalLights({lights:[{id:'w',x:0,y:-20,z:10,radius:100,intensity:1,color:[1,1,1]}]},{lighting:true,lightRadius:1,emissive:1});
const settings={lighting:true,ambient:.18,normalStrength:1,heightStrength:1,roughnessScale:1,metalnessScale:1,materialAOStrength:1,pbrSpecularStrength:1};
const d=L.shadePixelReference(dielectric,white,settings,[0,0],'final'),m=L.shadePixelReference(metal,white,settings,[0,0],'final');
check(d.every(Number.isFinite)&&m.every(Number.isFinite),'dielectric/metal GGX references finite in linear HDR');
check(d.some(v=>v>0)&&m.some(v=>v>0),'dielectric/metal fixtures produce nonzero linear response');
const greyDisplay=P.linearToSrgb([.18,.18,.18]);near(greyDisplay[0],.4613561295,1e-9,'18% grey expected display value');
const post=P.applyPostReference([.18,.18,.18],[0,0,0],{bloom:false,saturation:1,gradeMix:0,vignette:0,grain:0,exposure:1,brightness:0,contrast:1,gamma:1,gradeTemperature:0,gradeTint:0,shadowLift:0,highlightGain:0});
check(post.every(Number.isFinite),'post reference returns finite display-encoded values');
check(G.MATERIAL_WGSL.includes('textureSample(albedoTex')&&!G.MATERIAL_WGSL.includes('pow(max(t.rgb,vec3f(0)),vec3f(2.4))'),'material WGSL consumes already-decoded linear albedo without hidden gamma math');
check(L.DEFERRED_WGSL.includes('D_GGX')&&L.DEFERRED_WGSL.includes('al.rgb')&&!L.DEFERRED_WGSL.includes('pow(al.rgb'),'GGX/direct-light WGSL consumes linear G0 without gamma-space conversion');
check(P.POST_WGSL.includes('linear_to_srgb')&&P.RAW_WGSL.includes('1.0/2.4'),'final/raw display paths explicitly encode sRGB');
console.log(JSON.stringify({ok:true,checks:checks.length,srgbHalf:round(G.srgbChannelToLinear(.5)),linear18Display:round(P.linearChannelToSrgb(.18)),dielectric:d.map(x=>round(x)),metal:m.map(x=>round(x))},null,2));
''')

write('tools/validate_webgpu_colour_contract.py',r'''#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def need(path,needle,msg):
    text=(ROOT/path).read_text(encoding='utf-8')
    if needle not in text: errors.append(msg)
need('engine/webgpu_gbuffer.js',"'rgba8unorm-srgb'",'albedo atlas must use sRGB sampling format')
need('engine/webgpu_gbuffer.js',"normalRoughness:make('normal-roughness',normalRoughness,'rgba8unorm')",'normal/roughness atlas must stay linear unorm')
need('engine/webgpu_gbuffer.js',"heightMaterial:make('height-material',heightMaterial,'rgba8unorm')",'height/material atlas must stay linear unorm')
need('engine/webgpu_gbuffer.js',"g0:'rgba8unorm'",'G0 must remain a linear internal target')
need('engine/webgpu_lighting.js',"const OUTPUT_FORMAT='rgba16float'",'lighting output must remain HDR float')
need('engine/webgpu_lighting.js','return GBuffer.srgbToLinear(c)','canonical light colours must decode authored sRGB')
need('engine/webgpu_post.js','linear_to_srgb','post output must encode sRGB')
need('engine/webgpu_post.js',"intermediateFormat||'rgba16float'",'post intermediates must remain HDR float')
need('engine/webgpu_device.js',"colorSpace:'srgb'",'GPU canvas colour space must be explicit')
need('docs/COLOUR_PIPELINE.md','18% linear grey','numeric fixture contract missing')
need('docs/COLOUR_PIPELINE.md','Debug views','debug-space contract missing')
need('webgpu-gbuffer-smoke.html','sRGB-decoded exactly once','GPU albedo decode readback missing')
need('webgpu-post-smoke.html','linear-to-sRGB display transfer','GPU display transfer readback missing')
if errors:
    print('SM-502 COLOUR CONTRACT FAIL')
    for e in errors: print(' -',e)
    raise SystemExit(1)
print('SM-502 COLOUR CONTRACT PASS: source/input -> linear G-buffer -> linear HDR lighting/bloom/post -> explicit sRGB display')
''')

write('docs/COLOUR_PIPELINE.md',r'''# Steel Moth WebGPU colour pipeline

Status: canonical SM-502 contract for the staged WebGPU renderer. This document describes numeric representation, not subjective colour grading. `Auto` remains WebGL2-first until SM-505.

## Contract

| Resource / stage | Stored or authored space | Consumer semantics |
| --- | --- | --- |
| Sprite albedo PNG / external image | sRGB | Uploaded to `rgba8unorm-srgb`; texture sampling performs the one sRGB→linear decode. |
| Sprite tint values | authored sRGB | Decoded on CPU before instance packing; material blending is linear. |
| Normal + roughness atlas | numeric linear data | `rgba8unorm`; sampled without transfer. RGB is normal data, A roughness. |
| Height + material atlas | numeric linear data | `rgba8unorm`; sampled without transfer. Channels retain height/metalness/AO/emissive semantics. |
| G0 | linear albedo, `rgba8unorm` | Internal linear value. Quantisation is 8-bit; no display transfer is implied. |
| G1 / G2 | linear numeric material data, `rgba16float` | No colour transfer. |
| Authored light colours | sRGB | Decoded during canonical-light construction before packing. |
| SM-204 deferred lighting | linear HDR, `rgba16float` | GGX, diffuse, specular, ambient and emissive math operate on linear values. |
| Bloom extraction + blur | linear HDR, `rgba16float` | Thresholding, filtering and accumulation are linear. |
| Grade / exposure / tone stage | linear working values | Compatibility controls remain artistic operators, but they execute before the display transfer. |
| Final presentation | sRGB | IEC sRGB OETF is applied exactly once by SM-207 before writing the browser-preferred unorm canvas texture; `GPUCanvasContext` is explicitly configured `colorSpace: 'srgb'`. |

WebGPU textures are treated as numeric storage. The `-srgb` sampling format is used only at the albedo input boundary. Internal G-buffer/HDR targets do not use sRGB formats.

## Numeric fixtures

The deterministic regression pins the IEC transfer curve and round trips. In particular:

- sRGB code value `0.5` decodes to approximately `0.21404114` linear;
- **18% linear grey** (`0.18`) display-encodes to approximately `0.46135613` sRGB;
- black, white and RGB primaries remain exact at the endpoints;
- authored tint and light colours are decoded before material/direct-light work;
- dielectric and metal fixtures execute the same linear GGX path and remain finite/non-negative.

The real-WebGPU G-buffer smoke compares production PNG albedo readback against host-decoded sRGB→linear expectations while continuing exact numeric checks for normal/roughness and height/material channels. The post smoke feeds known linear scene values and verifies the raw presentation path performs only the required display transfer.

## Debug views

Debug values are defined by their producer, not by how bright they happen to look on an sRGB monitor:

- SM-200 `albedo` is **linear albedo**; normal, roughness, height, metalness, AO and emissive views are **linear numeric data**; object-ID is unitless diagnostic colour.
- SM-204 `final`, `diffuse` and `specular` are **linear HDR**. `light-count` is unitless.
- SM-207 `raw` means **no bloom/grade/tone controls**, not “skip the display transform”; when presented to an sRGB output it still receives the final linear→sRGB transfer.

Readback tests of an internal linear target compare linear numbers. Human-facing presentation of those values must apply a display transform; tuning must not infer material response from an untransformed linear debug buffer.

## Browser boundary

The browser canvas is configured explicitly as sRGB. SM-405 already runs the production G-buffer and post pages in both Chrome and Firefox on Windows; those inherited jobs therefore exercise this contract cross-browser. If either browser changes external-image or canvas colour handling enough to break the numeric readbacks, that is a validation failure rather than grounds for eye-tuning a compensating gamma.

## Non-goals

SM-502 does not change the GGX model, material-generator channel semantics, gameplay lighting ownership, quality tiers, HDR-display promotion, or the SM-505 backend-default decision.
''')

# Add canonical docs index entry.
p='docs/INDEX.md';s=read(p)
anchor='- [`LIGHTING_FIDELITY_ROADMAP.md`](LIGHTING_FIDELITY_ROADMAP.md)'
if 'COLOUR_PIPELINE.md' not in s:
    s=repl(s,anchor,anchor+"\n- [`COLOUR_PIPELINE.md`](COLOUR_PIPELINE.md) — canonical WebGPU source/linear-HDR/display colour-space contract and numeric fixtures.",'docs index colour contract')
write(p,s)

# Dedicated CI for deterministic/source contract; inherited SM-405 supplies Windows Chrome+Firefox real-WebGPU coverage.
write('.github/workflows/sm502-colour-pipeline.yml',r'''name: SM-502 WebGPU colour pipeline

on:
  pull_request:
    paths:
      - 'engine/webgpu_device.js'
      - 'engine/webgpu_gbuffer.js'
      - 'engine/webgpu_lighting.js'
      - 'engine/webgpu_post.js'
      - 'webgpu-gbuffer-smoke.html'
      - 'webgpu-post-smoke.html'
      - 'tools/validate_webgpu_colour.js'
      - 'tools/validate_webgpu_colour_contract.py'
      - 'docs/COLOUR_PIPELINE.md'
      - '.github/workflows/sm502-colour-pipeline.yml'
  workflow_dispatch:

jobs:
  colour-contract:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Validate numeric colour contract
        run: |
          node tools/validate_webgpu_colour.js
          python tools/validate_webgpu_colour_contract.py
          node tools/validate_webgpu_gbuffer.js
          node tools/validate_webgpu_lighting.js
          node tools/validate_webgpu_post.js
''')

# Self-remove bootstrap artifacts; only actual implementation remains in the commit.
(ROOT/'tools/apply_sm502_patch.py').unlink(missing_ok=True)
(ROOT/'.github/workflows/sm502-apply.yml').unlink(missing_ok=True)
print('SM-502 patch applied')
