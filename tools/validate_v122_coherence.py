#!/usr/bin/env python3
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[1]
js=(ROOT/'engine/game.js').read_text(); sf=(ROOT/'engine/surfacefx.js').read_text(); idx=(ROOT/'index.html').read_text(); sw=(ROOT/'sw.js').read_text(); web=(ROOT/'webapp.js').read_text()
# Deployment/cache must make this visibly different from 1.2.0/1.2.1 even under a registered PWA service worker.
assert "const BUILD_VERSION='1.2.3'" in js
# The release remains v1.2.3 while migration runtime modules may legitimately
# advance the service-worker revision. Pin the current revision so a runtime
# module change cannot ship without a corresponding offline-cache identity bump.
assert 'small-machine-web-v1.2.3-r3' in sw
assert "sw.js?v=1.2.3" in web and "updateViaCache:'none'" in web
for token in ['engine/game.js?v=1.2.3','engine/surfacefx.js?v=1.2.3','engine/foliagefx.js?v=1.2.3','webapp.js?v=1.2.3']:
    assert token in idx,token
# Direction convention: generator stores +screen-down height derivative as +world normal Y;
# deferred lights convert screen-down delta to world-up with -Ld.y. Do not invert G1 normal Y again.
gbuf=js[js.index('this.gbufferSpriteProg'):js.index('this.contactShadowProg')]
assert 'n.y=-n.y' not in gbuf
assert 'vec3 L=normalize(vec3(Ld.x,-Ld.y,Ld.z))' in js
# SurfaceFX water follows the same convention and real main-light position.
assert 'uniform vec2 uMainLightPos' in sf
assert 'vec3 n=normalize(vec3(-grad.x,grad.y,1.34))' in sf
assert 'vec3 L=normalize(vec3(lightDelta.x,-lightDelta.y,96.0))' in sf
assert 'col=min(col,under+vec3(.16))' in sf
# Material-v2 flashlight does not use old macro wedge projection; it is pseudo-depth traced.
assert "legacyConeShadow=!!(cone?.enabled&&(settings.materialV2===false||settings.materialPipelineLegacy===true))" in js
assert 'selfShadowMaxDistance:176' in js
# Warm Dusk-Rust companion light was a major source of isolated gold pools.
assert "companionLightRadius:56,companionLightIntensity:.07" in js
assert "group:'companion'" in js and "color:this.luts.rgb('fx_creature',214)" in js
# Direct response is compressed before RGBA8 scene storage.
assert 'direct=direct/(vec3(1.0)+direct*.22)' in js
# Macro shadow mask still gets supersampling for secondary-light shadows.
assert 'const shadowScale=2.0' in js
# Material report floor response should be rough/non-metallic relative to boxes.
r=json.load(open(ROOT/'assets/generated/material_v2_report.json'))['regions']
for n in ['floor_cracked','floor_plate','floor_hazard']:
    assert r[n]['roughness_mean']>.68,(n,r[n])
    assert r[n]['metalness_mean']<.32,(n,r[n])
assert r['cargo_crate']['metalness_mean']>.45
# Active manifests identify the current release while preserving the v1.2.2 coherence fixes.
gm=json.load(open(ROOT/'game_manifest.json')); dm=json.load(open(ROOT/'DEPLOYMENT_MANIFEST.json'))
assert gm['version']=='1.2.3' and dm['game_version']=='1.2.3'
assert gm['graphics_namespace']=='signalOrchardGraphicsV123'
print('V1.2.2 COHERENCE FIXES RETAINED: world-normal convention, bounded water, cool companion light, pseudo-depth flashlight shadows, rough floor response')
