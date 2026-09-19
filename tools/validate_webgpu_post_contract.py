#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def need(ok,msg):
    if not ok: errors.append(msg)
game=(ROOT/'engine/game.js').read_text(encoding='utf-8')
src=(ROOT/'engine/webgpu_post.js').read_text(encoding='utf-8')
webapp=(ROOT/'webapp.js').read_text(encoding='utf-8')
sw=(ROOT/'sw.js').read_text(encoding='utf-8')
need("bloom:true,bloomIntensity:1.0,bloomThreshold:.70" in game,'baseline bloom defaults changed unexpectedly')
need("saturation:1.20,gradeMix:.25,vignette:.065,grain:.0006,exposure:1.60" in game,'baseline post defaults changed unexpectedly')
need("brightness:0.0,contrast:1.12,gamma:1.0,gradeTemperature:0.0,gradeTint:0.0,shadowLift:-.10,highlightGain:.80" in game,'baseline grade controls changed unexpectedly')
need("localStorage.getItem('signalOrchardGraphicsV123')" in game and "localStorage.setItem('signalOrchardGraphicsV123',JSON.stringify(v))" in game,'graphics persistence contract changed unexpectedly')
need("float knee=.12" in game and "uThreshold" in game,'baseline bright-pass threshold/knee contract missing')
need(".227027" in game and ".316216" in game and ".070270" in game,'baseline Gaussian blur weights missing')
need("uBloomIntensity" in game and "uSaturation" in game and "uGradeMix" in game and "uVignette" in game and "uExposure" in game,'baseline post controls missing')
need("c=vec3(1.0)-exp(-max(c,0.0)*uExposure)" in game and "pow(max(c,0.0),vec3(.96))" in game,'baseline WebGL2 compatibility exposure/output transfer changed unexpectedly')
need("if(materialDebug>0){g.bindFramebuffer(g.FRAMEBUFFER,null)" in game and "this.quadDraw(this.quadProg,this.scene.tex);return" in game,'baseline material-debug raw bypass changed unexpectedly')
need("const SCHEMA='steelmoth-webgpu-post/v1'" in src,'SM-207 schema missing')
need("bloomQuality:1" in src and "function bloomPassesForQuality" in src,'SM-207 compatibility quality tier missing')
need("rgba16float" in src and "outputFormat||'bgra8unorm'" in src,'SM-207 intermediate/final format contract missing')
need("scene -> output; bloom/grade/post skipped" in src,'raw/debug bypass must remain explicit')
need("linear_to_srgb" in src and "scene+bloom+grading are linear/HDR" in src and "IEC sRGB transfer exactly once" in src,'SM-502 must replace the former colour-space deferral with an explicit linear/HDR to sRGB boundary')
need("SM-204 supplies already-lit scene" in src,'SM-207 must not multiply a second light map')
need("webgpu_post.js?v=sm207-1" in webapp,'web app must stage SM-207 module')
need("webgpu_post.js?v=sm207-1" in sw,'service worker must cache SM-207 module')
if errors:
    print('SM-207 post contract FAIL')
    for e in errors: print(' -',e)
    raise SystemExit(1)
print('SM-207 post contract PASS: baseline compatibility, WebGPU bloom/post/raw/output and completed SM-502 colour boundary are coherent')
