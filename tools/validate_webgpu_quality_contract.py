#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
errors=[]

def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)

quality=(ROOT/'engine/webgpu_quality.js').read_text(encoding='utf-8')
local=(ROOT/'engine/webgpu_local_shadows.js').read_text(encoding='utf-8')
hierarchy=(ROOT/'engine/webgpu_dso_hierarchy.js').read_text(encoding='utf-8')
bloom=(ROOT/'engine/webgpu_dark_bloom.js').read_text(encoding='utf-8')
doc=(ROOT/'docs/WEBGPU_QUALITY_TIERS_SM501.md').read_text(encoding='utf-8')

for name in ('Low','Medium','High','Ultra'):
    require(f'{name}:Object.freeze' in quality, f'quality policy is missing explicit {name} preset')

for token in ('renderScale:1','gbufferScale:1','ownershipDepthScale:1','objectIdScale:1',"albedoSampling:'nearest'"):
    require(token in quality, f'core quality invariant missing: {token}')

require('SELF_QUALITY_SAMPLES=Object.freeze([0,8,12,16,28])' in local, 'SM-205 self-shadow sample authority changed; reconcile SM-501 mappings')
require('CONTACT_QUALITY_SAMPLES=Object.freeze([0,4,8,12])' in local, 'SM-205 contact sample authority changed; reconcile SM-501 mappings')
for name in ('Low','Medium','High','Ultra'):
    require(f'{name}:Object.freeze' in hierarchy, f'SM-304 hierarchy no longer exposes {name}')
    require(f'{name}: Object.freeze' in bloom or f'{name}:Object.freeze' in bloom, f'SM-305 Dark Bloom no longer exposes {name}')

require('selfShadowSamples:12' in quality and 'contactShadowSamples:8' in quality, 'Medium must retain representative 12/8 local-shadow sampling')
require("hierarchyQuality:'Medium'" in quality and "quality:'Medium'" in quality, 'Medium must consume Medium DSO/Dark-Bloom policy')
require("hardCore:'full'" in quality, 'quality policy must preserve full hard DSO ownership')
require(quality.count('implemented:false') >= 12, 'reserved future effects must not be reported implemented by SM-501')
require(quality.count('enabled:false') >= 12, 'reserved future effects must remain disabled until owning issues land')

for phrase in (
    '300 warm-up frames',
    'at least 600 measured frames',
    'three independent runs',
    'mean renderer GPU **≤ 12.0 ms**',
    'p95 renderer GPU **≤ 14.5 ms**',
    'NVIDIA GeForce GTX 1650 SUPER',
    '1920×1080',
    'SM-003',
    'Firefox',
    'must remain open until a physical GTX 1650 SUPER Medium benchmark dataset',
):
    require(phrase in doc, f'SM-501 documentation is missing acceptance statement: {phrase}')

require('Auto' in doc and 'SM-505' in doc, 'SM-501 must preserve SM-505 default-backend ownership')
require('SM-802' in doc, 'SM-501 must not absorb adaptive quality ownership')

if errors:
    print('SM-501 QUALITY CONTRACT FAIL')
    for error in errors:
        print(' -',error)
    raise SystemExit(1)
print('SM-501 QUALITY CONTRACT PASS: bounded static presets, core invariants, production subsystem mappings, benchmark protocol and evidence boundary verified')
