#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ordering=(ROOT/'engine/webgpu_ordering.js').read_text(encoding='utf-8')
transparent=(ROOT/'engine/webgpu_transparent_fx.js').read_text(encoding='utf-8')
water=(ROOT/'docs/WEBGPU_WATER_SM400.md').read_text(encoding='utf-8')
foliage=(ROOT/'docs/WEBGPU_FOLIAGE_SM401.md').read_text(encoding='utf-8')
doc=(ROOT/'docs/WEBGPU_ORDERING_SM402.md').read_text(encoding='utf-8')
webapp=(ROOT/'webapp.js').read_text(encoding='utf-8')
sw=(ROOT/'sw.js').read_text(encoding='utf-8')
workflow=(ROOT/'.github/workflows/sm402-ordering.yml').read_text(encoding='utf-8')
expected=['opaque-resolved','water','fine-grass','foliage-background','world-alpha','world-additive','foliage-foreground','post','post-effects','top-additive','top-alpha','objective','guide','debug-ui-present']
pos=[doc.find(f'`{name}`') for name in expected]
required={
  'canonical fourteen-stage order documented': all(p>=0 for p in pos) and pos==sorted(pos),
  'same order executable': all(f"id:'{name}'" in ordering for name in expected),
  'water stable source breaks cycle': "waterSceneSource:'opaque-resolved'" in ordering and 'stable opaque-resolved scene' in doc,
  'canonical world depth': "canonical-less-equal-no-write" in ordering and "canonical-test+sample" in ordering,
  'foliage classifier is explicit': "frontBlend" in ordering and "foliage-background" in ordering and "foliage-foreground" in ordering,
  'post bypass keeps boundary': "raw-copy" in ordering and "debug-copy" in ordering and 'relative order before and after that slot is identical' in doc,
  'readability tail explicit': "post-effects" in ordering and "top-additive" in ordering and "objective" in ordering and "guide" in ordering,
  'SM-206 stage contract reconciled': all(name in transparent for name in ['world-alpha','world-additive','post-effects','top-additive','top-alpha','objective','guide']),
  'SM-400 delegated ordering reconciled': 'SM-402 owns reconciliation' in water,
  'SM-401 delegated ordering reconciled': 'SM-402 owns transparent/procedural ordering' in foliage,
  'no OIT decision documented': 'No OIT in SM-402' in doc,
  'hidden order rejected': 'hidden backend ordering is forbidden' in ordering,
  'staged module import': 'webgpu_ordering.js?v=sm402-1' in webapp,
  'offline cache membership': 'webgpu_ordering.js?v=sm402-1' in sw,
  'dedicated real WebGPU gate': 'validate_webgpu_ordering_browser.py --require-webgpu' in workflow,
}
failed=[name for name,ok in required.items() if not ok]
if failed:raise SystemExit('SM-402 contract validation failed: '+', '.join(failed))
print('SM-402 ordering contract validation: PASS ('+str(len(required))+' assertions)')
