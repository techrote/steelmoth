#!/usr/bin/env python3
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]

def read(rel): return (ROOT/rel).read_text(encoding='utf-8')
def require(ok,msg):
    if not ok: raise SystemExit(f'SM-307 CONTRACT FAIL: {msg}')

src=read('engine/webgpu_visibility.js')
web=read('webapp.js')
sw=read('sw.js')
doc=read('docs/WEBGPU_VISIBILITY_SM307.md')
doc_plain=doc.replace('**','').replace('`','')
arch=read('docs/WEBGPU_ARCHITECTURE.md')
smoke=read('webgpu-visibility-smoke.html')
workflow=read('.github/workflows/sm307-visibility.yml') if (ROOT/'.github/workflows/sm307-visibility.yml').exists() else ''

require('steelmoth-webgpu-visibility/v1' in src and 'steelmoth-webgpu-visibility-snapshot/v1' in src,'stable visibility schemas missing')
require("OUTPUT_FORMAT='rgba16float'" in src and "DEBUG_FORMAT='r32float'" in src,'visibility/debug output formats missing')
for mode in ('combined','direct','ambient','dso','self-shadow','contact-shadow','dark-bloom','material-ao','gtao','macro','local'):
    require(mode in src,f'debug mode missing: {mode}')
require('GTAO_INTERFACE' in src and 'reserved input only' in src and 'does not generate GTAO' in src,'reserved GTAO consumer contract missing')
require('gtaoVisibilityView was not supplied' in src,'enabling reserved GTAO without an input must reject')
require('Math.min(dsoVisibility,darkBloomVisibility)' in src and 'Math.min(selfVisibility,contactVisibility)' in src and 'Math.min(macroVisibility,localVisibility)' in src,'strongest-overlapping visibility composition missing')
require('ambientFloor' in src and 'combinedFloor' in src and 'hardCoreFloor' in src,'dense-scene visibility floors missing')
require('no independent term multiplication' in src,'composition rationale missing from runtime diagnostics')
require('sourceFromPaths' in src and 'SM-205 WebGPULocalShadows' in src and 'SM-304 WebGPUDSOHierarchy' in src and 'SM-306 WebGPUDarkBloomTemporal' in src,'upstream path integration contract incomplete')
require("textureLoad(materialTex,p,0).z" in src,'Material-v2 G2 material AO channel not consumed')
require('textureStore(visibilityOut' in src and 'textureStore(debugOut' in src,'visibility/debug GPU outputs missing')
for phrase in ('0 = occluded','1 = visible','not multiplied independently','term toggles','hardCoreFloor','reserved GTAO interface','does not generate GTAO','Hosted CI'):
    require(phrase.lower() in doc_plain.lower(),f'documentation missing contract phrase: {phrase}')
require('bounded visibility/occlusion' in arch.lower() and 'blindly multiplying' in arch.lower(),'canonical architecture no longer states bounded-composition rule')
require('webgpuVisibilityDone' in smoke and 'toggle-matrix' in smoke and 'debug-matrix' in smoke and 'moving-light-a' in smoke and 'moving-light-b' in smoke and 'gtao-reserved' in smoke,'real-browser evidence matrix incomplete')
require("webgpu_visibility.js?v=sm307-1" in web,'webapp does not stage SM-307 visibility module')
require(web.index("webgpu_dark_bloom_temporal.js?v=sm306-1") < web.index("webgpu_visibility.js?v=sm307-1") < web.index("backend_runtime.js?v=sm102-1"),'SM-307 staging order is not temporal Dark Bloom -> visibility -> runtime')
require(re.search(r"small-machine-web-v1\.2\.3-r[1-9][0-9]*",sw) is not None and "webgpu_visibility.js?v=sm307-1" in sw,'service-worker revision/cache entry missing')
require('sm307-visibility' in workflow and 'validate_webgpu_visibility_browser.py --require-webgpu' in workflow,'dedicated required-WebGPU workflow missing')
print('SM-307 bounded visibility source/staging contract: PASS')
