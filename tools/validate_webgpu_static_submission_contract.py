#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def req(x,m):
    if not x: errors.append(m)
probe=(ROOT/'tools/sm801_static_submission_probe.js').read_text(encoding='utf-8')
page=(ROOT/'webgpu-static-submission-smoke.html').read_text(encoding='utf-8')
runner=(ROOT/'tools/validate_webgpu_static_submission_browser.py').read_text(encoding='utf-8')
gbuffer=(ROOT/'engine/webgpu_gbuffer.js').read_text(encoding='utf-8')
req('createRenderBundleEncoder' in page and 'executeBundles' in page,'real render-bundle A/B path missing')
req("['static','ground']" in probe or "category==='static'||category==='ground'" in probe,'stable static/ground classification missing')
req('editor-static-change' in page and 'room-change' in page,'editor/room rebuild validation missing')
req('timestamp-query' in page,'optional GPU timestamp measurement missing')
req('performance.now()' in page,'CPU encode/rebuild timing missing')
req('runs":3' in runner or '"runs":3' in runner,'three-run browser methodology missing')
req('chrome' in runner and 'firefox' in runner,'cross-browser matrix missing')
req('No GTX1650S performance claim' in runner,'hosted evidence boundary missing')
req('executeBundles' not in gbuffer and 'createRenderBundleEncoder' not in gbuffer,'SM-801 study must not silently adopt render bundles in production G-buffer')
if errors:
    print('SM-801 CONTRACT FAIL');[print(' -',e) for e in errors];raise SystemExit(1)
print('SM-801 CONTRACT PASS: production path unchanged; A/B browser study and rebuild checks present')
