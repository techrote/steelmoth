#!/usr/bin/env python3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def require(condition,message):
    if not condition: errors.append(message)

gbuffer=(ROOT/'engine/webgpu_gbuffer.js').read_text(encoding='utf-8')
probe=(ROOT/'tools/sm800_precision_probe.js').read_text(encoding='utf-8')
page=(ROOT/'webgpu-precision-smoke.html').read_text(encoding='utf-8')
doc=(ROOT/'docs/WEBGPU_PRECISION_BANDWIDTH_SM800.md').read_text(encoding='utf-8')
workflow=(ROOT/'.github/workflows/sm800-precision-bandwidth.yml').read_text(encoding='utf-8')
research=(ROOT/'docs/RESEARCH_AND_DECISIONS.md').read_text(encoding='utf-8')

require("g1:'rgba16float'" in gbuffer and "g2:'rgba16float'" in gbuffer,'SM-800 study must not prematurely change production G1/G2 precision')
require("objectId:'r32uint'" in gbuffer and "depth:'depth32float'" in gbuffer,'core object/depth formats must remain unchanged')
for name in ('baseline','material8','octMaterial8','hdr11','combined'):
    require(name in probe,f'missing SM-800 candidate {name}')
for term in ('octahedral','rgba8unorm','rg11b10ufloat','target hardware','GTX 1650 SUPER','no production format change'):
    require(term.lower() in doc.lower(),f'SM-800 report missing evidence/policy term: {term}')
require('targetHardwareAcceptance' in (ROOT/'tools/validate_webgpu_precision_browser.py').read_text(encoding='utf-8'),'browser report must explicitly separate target-hardware acceptance')
require('timestamp-query' in page,'browser probe must use timestamp-query when exposed')
require('pushErrorScope' in page and 'popErrorScope' in page,'candidate pipeline creation must use validation scopes')
require('SM-800' in workflow and 'windows-latest' in workflow,'dedicated cross-browser workflow missing')
require('SM-800 precision study' in research,'Q-004 must record SM-800 provisional result boundary')
if errors:
    print('SM-800 CONTRACT FAIL')
    for error in errors: print(' -',error)
    raise SystemExit(1)
print('SM-800 CONTRACT PASS: production formats preserved; study candidates/browser/target-hardware boundary present')
