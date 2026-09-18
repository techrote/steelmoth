#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
foliage=(ROOT/'engine/webgpu_foliage.js').read_text(encoding='utf-8')
legacy=(ROOT/'engine/foliagefx.js').read_text(encoding='utf-8')
webapp=(ROOT/'webapp.js').read_text(encoding='utf-8')
sw=(ROOT/'sw.js').read_text(encoding='utf-8')
doc=(ROOT/'docs/WEBGPU_FOLIAGE_SM401.md').read_text(encoding='utf-8')
workflow=(ROOT/'.github/workflows/sm401-foliage.yml').read_text(encoding='utf-8')
checks=(ROOT/'tools/run_checks.py').read_text(encoding='utf-8')
required={
  'canonical light buffer ABI':("Lighting.LIGHT_BUFFER_NAME" in foliage and "struct Light { posRadius:vec4f,colorIntensity:vec4f,directionCone:vec4f,kindFlags:vec4f }" in foliage),
  'canonical depth input':("depthTex:texture_depth_2d" in foliage and "gbuffer?._views?.()" in foliage),
  'SM-307 visibility input':("visibilityTex:texture_2d<f32>" in foliage and "visibility?.bindings?.()" in foliage),
  'legacy data authority reused':("Foliage.generateFoliageInstances" in foliage and "Foliage.InteractionField" in foliage and "Foliage.DepthClassifier" in foliage),
  'legacy gameplay authority already isolated':("Gameplay/collision authority deliberately remains outside this module" in legacy),
  'Fine Grass dark teal palette':("SHORT_GRASS:Object.freeze([.065,.255,.225])" in foliage and "dark-teal/non-emissive" in foliage),
  'no foliage emissive path':("emissive:0" in foliage and "return{color:base.map" in foliage),
  'bounded role classification':("receiver-only" in foliage and "contact-receiver" in foliage and "macro-eligible" in foliage and "CLASS_FLAGS" in foliage),
  'root lock preserved':("Foliage.RootedDeformation.weight" in foliage),
  'SM-402 boundary documented':("SM-402" in doc and "ordering" in doc.lower()),
  'staged module import':("webgpu_foliage.js?v=sm401-1" in webapp),
  'offline cache membership':("webgpu_foliage.js?v=sm401-1" in sw),
  'dedicated browser gate':("validate_webgpu_foliage_browser.py --require-webgpu" in workflow),
  'normal verification membership':("js-webgpu-foliage" in checks and "webgpu-foliage-contract" in checks and "webgpu-foliage" in checks),
}
failed=[name for name,ok in required.items() if not ok]
if failed:raise SystemExit('SM-401 contract validation failed: '+', '.join(failed))
print('SM-401 foliage contract validation: PASS ('+str(len(required))+' assertions)')
