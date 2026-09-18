#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
water=(ROOT/'engine/webgpu_water.js').read_text(encoding='utf-8')
webapp=(ROOT/'webapp.js').read_text(encoding='utf-8')
sw=(ROOT/'sw.js').read_text(encoding='utf-8')
doc=(ROOT/'docs/WEBGPU_WATER_SM400.md').read_text(encoding='utf-8')
workflow=(ROOT/'.github/workflows/sm400-water.yml').read_text(encoding='utf-8')
checks=(ROOT/'tools/run_checks.py').read_text(encoding='utf-8')
required={
  'canonical light buffer ABI':("Lighting.LIGHT_BUFFER_NAME" in water and "struct Light { posRadius:vec4f,colorIntensity:vec4f,directionCone:vec4f,kindFlags:vec4f }" in water),
  'resolved scene input':("sceneTex:texture_2d<f32>" in water and "lighting.outputTexture().createView()" in water),
  'canonical depth input':("depthTex:texture_depth_2d" in water and "gbuffer._views()?.depth" in water),
  'SM-307 visibility input':("visibilityTex:texture_2d<f32>" in water and "visibility.bindings()" in water),
  'dark-region response bound':("let illum=clamp(max(sceneVis,directEnergy*.55),0.0,1.0)" in water and "*illum" in water),
  'depth-aware refraction':("depthAwareRefractionWeight" in water and "refractWeight=1.0-smoothstep" in water),
  'room stale-state rejection':("stale water field rejected" in water and "fieldRoomId" in water),
  'bounded ripple identity':("MAX_RIPPLES=12" in water and "waterRippleStrength" in water),
  'staged module import':("webgpu_water.js?v=sm400-1" in webapp),
  'offline cache membership':("webgpu_water.js?v=sm400-1" in sw),
  'dedicated browser gate':("validate_webgpu_water_browser.py --require-webgpu" in workflow),
  'normal verification membership':("js-webgpu-water" in checks and "webgpu-water-contract" in checks),
  'scope boundary docs':("does not move gameplay authority" in doc.lower() and "SM-402" in doc),
}
failed=[name for name,ok in required.items() if not ok]
if failed:raise SystemExit('SM-400 contract validation failed: '+', '.join(failed))
print('SM-400 water contract validation: PASS ('+str(len(required))+' assertions)')
