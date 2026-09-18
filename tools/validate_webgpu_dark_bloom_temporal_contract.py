#!/usr/bin/env python3
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]

def read(rel): return (ROOT/rel).read_text(encoding='utf-8')
def require(ok,msg):
    if not ok: raise SystemExit(f'SM-306 CONTRACT FAIL: {msg}')

src=read('engine/webgpu_dark_bloom_temporal.js')
web=read('webapp.js')
sw=read('sw.js')
doc=read('docs/WEBGPU_DARK_BLOOM_TEMPORAL_SM306.md')
smoke=read('webgpu-dark-bloom-temporal-smoke.html')
workflow=read('.github/workflows/sm306-dark-bloom-temporal.yml') if (ROOT/'.github/workflows/sm306-dark-bloom-temporal.yml').exists() else ''

require('steelmoth-webgpu-dark-bloom-temporal/v1' in src and 'steelmoth-webgpu-dark-bloom-temporal-snapshot/v1' in src,'stable temporal schemas missing')
require('for(const i of [0,1])' in src and 'history${i}' in src and 'depth${i}' in src and 'object${i}' in src,'persistent ping-pong residual/depth/object history missing')
require('r32float' in src and 'rg32float' in src and 'r32uint' in src,'history formats do not preserve residual/depth/object semantics')
require('hardCoreUnsmooth:true' in src and 'softHistoryOnly:true' in src,'hard-core/soft-only scope diagnostics missing')
require('current_bounds' in src and 'neighborhoodClamp:true' in src,'current-neighborhood anti-trail clamp missing')
require('depthRejected' in src and 'objectRejected' in src and 'globalRejected' in src,'history rejection counters missing')
require('clusterSignature' in src and 'lightDiscontinuity' in src and "room-change" in src,'cluster/light/room validity gates missing')
require('resize(width,height)' in src and 'device-reset' in src and 'editor-delete' in smoke,'resize/device/editor invalidation evidence incomplete')
require('historyAcceptedPercent' in src and 'historyRejectedPercent' in src,'accepted/rejected history percentages missing')
require("webgpu_dark_bloom_temporal.js?v=sm306-1" in web,'webapp does not stage SM-306 temporal module')
require(web.index("webgpu_dark_bloom.js?v=sm305-1") < web.index("webgpu_dark_bloom_temporal.js?v=sm306-1") < web.index("backend_runtime.js?v=sm102-1"),'SM-306 staging order is not Dark Bloom -> temporal -> runtime')
require(re.search(r"small-machine-web-v1\.2\.3-r[1-9][0-9]*",sw) is not None and "webgpu_dark_bloom_temporal.js?v=sm306-1" in sw,'service-worker revision/cache entry missing')
for term in ('low-frequency','never temporally smoothed','object ID','cluster','light','3x3','accepted/rejected percentages','Hosted CI'):
    require(term.lower() in doc.lower(),f'documentation missing contract term: {term}')
require('webgpuDarkBloomTemporalDone' in smoke and 'slowLightStabilized' in smoke and 'noStaleAfterInvalidation' in smoke,'real-browser temporal evidence contract incomplete')
require('sm306-dark-bloom-temporal' in workflow and 'validate_webgpu_dark_bloom_temporal_browser.py --require-webgpu' in workflow,'dedicated required-WebGPU workflow missing')
print('SM-306 Dark Bloom temporal source/staging contract: PASS')
