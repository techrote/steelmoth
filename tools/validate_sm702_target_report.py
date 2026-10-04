#!/usr/bin/env python3
"""Fail closed on SM-702 forward correctness and paired target-GPU evidence."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
from unittest.mock import patch

from validate_sm603_target_report import finite, hardware_errors, statistics

SCENES = ('representative', 'stress')
VARIANTS = ('baseline', 'candidate')
PASSES = ('water', 'foliage', 'world-alpha', 'fixture-composition')
PASS_MAPPING = {name: [i * 2, i * 2 + 1] for i, name in enumerate(PASSES)}
NESTED_PASSES = {'world-alpha': 'fixture-composition'}
BASELINE_COMMIT = 'cb068323a7a93e6273d879126fe261f951d589f7'
BASELINE_PINS = {
    'tools/experiments/sm702_water_baseline.js': '542b9a63da85c3e4577286d9beb6590312a95fe6e1bbcd5d1671c3d5e7c3f80d',
    'tools/experiments/sm702_foliage_baseline.js': '32f85778d29f780023572f7da894116a043ccd9f723c82eec9e1e9593c15343a',
    'tools/experiments/sm702_transparent_fx_baseline.js': 'c32a7e75a2de7a6997568201cdb21ea16e4bd72bb5232ee97c51e3a65af242e7'}
BASELINE_SOURCE_FILES = dict(zip(BASELINE_PINS, ('engine/webgpu_water.js', 'engine/webgpu_foliage.js', 'engine/webgpu_transparent_fx.js')))
# All 27 browser imports, the page, and five Python measurement dependencies.
SOURCE_FILES = (
    'webgpu-forward-lighting-smoke.html', 'tools/sm702_forward_fixtures.js',
    *BASELINE_PINS,
    'tools/validate_sm702_forward_browser.py', 'tools/run_sm702_target_campaign.py',
    'tools/validate_sm702_target_report.py', 'tools/validate_webgpu_ssgi_browser.py',
    'tools/validate_sm603_target_report.py',
    'engine/webgpu_resources.js', 'engine/webgpu_performance.js',
    'engine/pseudo_depth.js', 'engine/foliagefx.js',
    'engine/webgpu_gbuffer.js', 'engine/webgpu_ownership.js',
    'engine/webgpu_depth_hierarchy.js', 'engine/webgpu_lighting.js',
    'engine/webgpu_occluders.js', 'engine/webgpu_clusters.js',
    'engine/webgpu_dominance.js', 'engine/webgpu_dso.js',
    'engine/webgpu_dso_hierarchy.js', 'engine/webgpu_gtao.js',
    'engine/webgpu_gtao_stabilization.js', 'engine/webgpu_gtao_readback.js',
    'engine/webgpu_visibility.js', 'engine/webgpu_ssgi.js',
    'engine/webgpu_ordering.js',
    'engine/webgpu_forward_lighting.js', 'engine/webgpu_water.js',
    'engine/webgpu_foliage.js', 'engine/webgpu_transparent_fx.js')
SETTINGS = {
    'lighting': {'lighting': True, 'ambient': .20, 'emissive': 1, 'lightRadius': 1,
        'normalStrength': 1, 'heightStrength': 1, 'roughnessScale': 1, 'metalnessScale': 1,
        'materialAOStrength': .62, 'pbrSpecularStrength': .70},
    'visibility': {'dso': True, 'selfShadow': False, 'contactShadow': False, 'darkBloom': False,
        'materialAO': True, 'gtao': True, 'materialAOStrength': 1, 'gtaoStrength': 1, 'ambientFloor': 0},
    'gtao': {'directions': 6, 'steps': 4, 'radius': 24, 'intensity': 1},
    'ssgi': {'enabled': True, 'quality': 'Medium'},
    'water': {'waterQuality': 3, 'waterStrength': 1.2, 'waterWaveScale': 1.3,
        'waterWaveSpeed': .8, 'waterNormalStrength': 1.45, 'waterDetailStrength': 1.25,
        'waterHighlightStrength': 1.55, 'waterRefractionStrength': 1.4,
        'waterDepthReject': .004, 'indirectWeight': .6},
    'foliage': {'lighting': True, 'ambient': .20, 'foliageQuality': 3,
        'foliageWindStrength': .78, 'foliageWindSpeed': .82,
        'foliageShadingStrength': .9, 'foliageBendAmount': 1, 'indirectWeight': .6},
    'caps': {'ripples': 12, 'foliage': 208, 'transparent': 640, 'lights': 17, 'opaque': 256}}
SCENE_COUNTS = {
    'representative': {'ripples': 2, 'foliage': 6, 'transparent': 5, 'lights': 2},
    'stress': {'ripples': 12, 'foliage': 208, 'transparent': 640, 'lights': 17}}
CAPTURES = ('baseline-mixed', 'candidate-mixed', 'indirect', 'visibility', 'guard', 'actor-before', 'actor-after', 'water-indirect')
ARTIFACTS = ('acceptance.html', 'readbacks.json', 'acceptance.png')
FORMAT_BYTES = {'rgba16float': 8, 'rgba32float': 16, 'rgba32uint': 16,
    'rgba8unorm': 4, 'rg32float': 8, 'r32uint': 4, 'r32float': 4,
    'r16float': 2, 'depth32float': 4}
UPSTREAM_EXCLUDED = ('ownership', 'depth-hierarchy', 'lighting', 'dso', 'gtao', 'visibility', 'ssgi')
FIREFOX_PROFILE_PREFS = {'layout.css.devPixelsPerPx': '1.0', 'browser.cache.disk.enable': False,
    'browser.cache.memory.enable': False, 'network.http.use-cache': False}
FIREFOX_WEBGPU_PREFS = {'dom.webgpu.enabled': True, 'gfx.webrender.all': True, 'webgl.force-enabled': True}


def actual_settings(name):
    water = {'waterQuality': 3, 'waterStrength': 1.2, 'waterWaveScale': 1.3,
        'waterWaveSpeed': .8, 'shoreFoamStrength': 1.05, 'waterRippleStrength': 1,
        'waterNormalStrength': 1.45, 'waterDetailStrength': 1.25, 'waterHighlightStrength': 1.55,
        'waterEdgeStrength': 1.42, 'waterRefractionStrength': 1.4, 'waterDepthReject': .004,
        'baseColor': [.20, .50, .80], 'foamColor': [.72, .88, .98], 'highlightColor': [.78, .92, 1]}
    foliage = {'foliageQuality': 3, 'foliageWindStrength': .78, 'foliageWindSpeed': .82,
        'foliageInteractionStrength': 1, 'foliageShadingStrength': .9, 'foliageBendAmount': 1,
        'ambient': .20, 'lighting': True}
    if name == 'candidate':
        water.update(advancedLighting=True, indirectWeight=.6,
                     surface={'worldZ': 0, 'category': 'dynamic', 'layer': 0, 'bias': 0})
        foliage.update(advancedLighting=True, indirectWeight=.6)
    return {'water': water, 'foliage': foliage,
        'transparent': {'advancedLighting': name == 'candidate', 'indirectWeight': .6,
                        'ambient': .20, 'directClamp': .22, 'colorSpace': 'linear'}}


def memory_descriptors(name, scene):
    """Accepted bounded producer/fixture descriptors, never measured resident VRAM."""
    resources = []
    def buffer(key, owner, size):
        resources.append({'name': key, 'owner': owner, 'kind': 'buffer', 'size': size, 'estimatedBytes': size})
    def texture(key, owner, fmt, width, height):
        resources.append({'name': key, 'owner': owner, 'kind': 'texture', 'format': fmt,
            'width': width, 'height': height, 'depthOrArrayLayers': 1,
            'estimatedBytes': width * height * FORMAT_BYTES[fmt]})
    texture('sm400:output', 'water', 'rgba16float', 1920, 1080)
    buffer('sm400:params', 'water', 128)
    buffer('sm400:ripples', 'water', 384)
    texture('water:field', 'water', 'rgba8unorm', 1920, 1080)
    for key, size in (('instances', 16640), ('output', 9984), ('params', 64)):
        buffer('foliage:' + key, 'foliage', size)
    counts = (3, 1, 1) if scene == 'representative' else (384, 128, 128)
    align = lambda size: max(256, math.ceil(size / 256) * 256)
    for stage, count in zip(('world-alpha', 'world-additive', 'top-alpha'), counts):
        buffer('transparent:' + stage, 'transparent', align(count * 6 * 36))
    for stage in ('post-effects', 'objective', 'guide'):
        buffer('transparent:' + stage + ':params', 'transparent', 1024)
    buffer('transparent:frame', 'transparent', 16)
    if name == 'candidate':
        buffer('transparent:forward-world-alpha', 'transparent', align(counts[0] * 6 * 68))
        buffer('transparent:glass-lighting', 'transparent', 32)
        for owner in ('water', 'foliage', 'transparent'):
            buffer(owner + ':forward-params', owner, 48)
            texture(owner + ':neutral-incident', owner, 'rgba16float', 1, 1)
    index = 0 if name == 'baseline' else 1
    for n in (index, index + 2):
        texture('fixture:mixed:' + str(n), 'fixture-composition', 'rgba16float', 1920, 1080)
    for n in range(3):
        buffer('fixture:foliage-draw:' + str(n), 'fixture-composition', 16)
    return resources


def digest(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def validate_source(source, after, *, clean=False):
    errors = []
    hashes = source.get('fileSha256') or {}
    if not source.get('commit') or source.get('commit') != after.get('commit'):
        errors.append('source commit missing or changed during run')
    if set(hashes) != set(SOURCE_FILES) or hashes != after.get('fileSha256') or not all(map(digest, hashes.values())):
        errors.append('complete executable source closure missing, invalid or changed')
    if source.get('baselineLFNormalizedSha256') != BASELINE_PINS or after.get('baselineLFNormalizedSha256') != BASELINE_PINS:
        errors.append('frozen accepted water/foliage/transparent LF-normalized baseline pins differ')
    if (source.get('baselineCommit') != BASELINE_COMMIT or after.get('baselineCommit') != BASELINE_COMMIT
            or any(s.get('baselineGitBlobLFNormalizedSha256') not in (None, BASELINE_PINS) for s in (source, after))):
        errors.append('baseline pin must be verified against the accepted Git source blobs')
    if clean:
        if any(s.get('baselineGitBlobLFNormalizedSha256') != BASELINE_PINS for s in (source, after)):
            errors.append('clean target evidence requires actual accepted historical Git-blob proof')
        if source.get('cleanTrackedState') is not True or after.get('cleanTrackedState') is not True:
            errors.append('target campaign requires clean tracked source before and after')
        if source.get('closureTracked') is not True or after.get('closureTracked') is not True:
            errors.append('all executable closure paths must be Git-tracked')
    return errors


def validate_memory(variant, name, scene):
    errors = []
    memory = variant.get('memory') or {}
    resources = memory.get('resources') or []
    names = [r.get('name') for r in resources]
    if not resources or len(set(names)) != len(names) or any(not isinstance(n, str) or not n for n in names):
        errors.append(f'{name}: unique complete owned descriptors are required')
    groups = {r.get('owner') for r in resources}
    if not {'water', 'foliage', 'transparent', 'fixture-composition'} <= groups:
        errors.append(f'{name}: water, foliage, transparent and included composition descriptors required')
    expected = {r['name']: r for r in memory_descriptors(name, scene)}
    if set(names) != set(expected):
        errors.append(f'{name}: exact complete bounded producer/fixture resource inventory required')
    for resource in resources:
        wanted = expected.get(resource.get('name'))
        if wanted and any(resource.get(k) != value for k, value in wanted.items()):
            errors.append(f'{name}/{resource.get("name")}: actual bounded descriptor differs from required native fixture')
    total = 0
    for resource in resources:
        size = resource.get('estimatedBytes')
        valid = type(size) is int and size > 0
        if not valid:
            errors.append(f'{name}: invalid descriptor byte estimate')
            continue
        total += size
        if resource.get('kind') == 'texture':
            dims = (resource.get('width'), resource.get('height'), resource.get('depthOrArrayLayers'))
            bpp = FORMAT_BYTES.get(resource.get('format'))
            if not all(type(d) is int and d > 0 for d in dims) or not bpp or size != math.prod(dims) * bpp:
                errors.append(f'{name}/{resource.get("name")}: texture size/format estimate mismatch')
        elif resource.get('kind') != 'buffer' or resource.get('size') != size:
            errors.append(f'{name}/{resource.get("name")}: buffer descriptor mismatch')
    if total != variant.get('descriptorMemoryBytes') or total != memory.get('totalEstimatedBytes'):
        errors.append(f'{name}: owned descriptor sum mismatch')
    if memory.get('residentVramMeasured') is not False or memory.get('historyEstimatedBytes') != 0:
        errors.append(f'{name}: descriptor estimate must not claim resident VRAM or shared histories')
    if set(memory.get('sharedUpstreamExcluded') or []) != set(UPSTREAM_EXCLUDED):
        errors.append(f'{name}: shared upstream memory exclusions must be named')
    return errors


def validate_forward_oracles(smoke):
    errors = []
    def require(ok, message):
        if not ok:
            errors.append(message)
    def vector(value):
        return isinstance(value, list) and len(value) == 3 and all(finite(v) for v in value)
    forward = smoke.get('forward') or {}
    water = forward.get('water') or {}
    oracle = water.get('ambientOnce') or {}
    capture = (smoke.get('captures') or {}).get('water-indirect') or {}
    width, height, data = capture.get('width'), capture.get('height'), capture.get('data') or []
    tolerance = oracle.get('tolerance')
    require(tolerance == .00002 and finite(oracle.get('maxError')) and oracle.get('maxError') < .00002,
            'water native GI/ambient oracle must meet the fixed actual-readback tolerance')
    require(type(oracle.get('tested')) is int and oracle.get('tested') == width * height
            and type(oracle.get('positivePixels')) is int and 0 < oracle.get('positivePixels') <= oracle['tested'],
            'complete native water oracle scan and positive receiver pixels required')
    require(finite(water.get('indirectMaximum'), positive=True) and all(finite(x) for x in data)
            and abs(water['indirectMaximum'] - max((x for i, x in enumerate(data) if i % 4 < 3), default=0)) < 1e-12,
            'water positive maximum must equal actual native indirect texture')
    rows = oracle.get('rows') or []
    require(bool(rows), 'water native B-once receiver witnesses required')
    ambient_witness = False
    for row in rows:
        q = row.get('native') or []
        b, incident, own = row.get('ambientB'), row.get('incident'), row.get('ownDiffuse')
        expected, actual = row.get('expected'), row.get('actual')
        valid = (len(q) == 2 and all(type(x) is int for x in q) and 0 <= q[0] < width and 0 <= q[1] < height
            and finite(b) and b <= 1 and vector(incident) and own == [.2, .5, .8]
            and vector(expected) and vector(actual) and row.get('reason') == 0 and row.get('surfaceVisible') is True)
        require(valid, 'water positive witnesses require native coordinate, own diffuse, support and visible surface')
        if not valid:
            continue
        computed = [min(incident[i], .08) * own[i] * b * .6 for i in range(3)]
        native = data[(q[1] * width + q[0]) * 4:][:3]
        require(expected == computed or max(abs(x - y) for x, y in zip(expected, computed)) < 1e-12,
                'water expected response must use native B exactly once')
        require(actual == native and max(abs(x - y) for x, y in zip(computed, actual)) < .00002,
                'water oracle must match the retained native texture readback')
        ambient_witness |= b < 1 and any(x > 0 for x in computed)
    require(ambient_witness, 'positive water GI with nonneutral native ambient B required')
    foliage = forward.get('ambientOnce') or {}
    require(type(foliage.get('tested')) is int and foliage.get('tested') > 0 and finite(foliage.get('maxError'))
            and foliage.get('maxError') < .00002, 'positive actual large-foliage B-once oracle required')
    glass = (forward.get('glass') or {}).get('direct') or {}
    positive, hard = glass.get('positiveWitnesses') or [], glass.get('hardZero') or {}
    require(glass.get('tolerance') == .0003 and finite(glass.get('maximumError')) and glass.get('maximumError') < .0003
            and glass.get('movingLightChanged') is True, 'actual moving-light glass direct/ambient oracle required')
    require(bool(positive), 'visible glass positive canonical direct G and contribution required')
    require(hard.get('surfaceVisible') is True and hard.get('directG') == 0 and hard.get('directContribution') == 0,
            'visible hard DSO G0 glass oracle required')
    for row in [*positive, hard]:
        valid = vector(row.get('expected')) and vector(row.get('actual'))
        require(valid and row.get('surfaceVisible') is True and finite(row.get('maxError')) and row.get('maxError') < .0003,
                'glass actual RGB oracle incomplete or exceeds fixed tolerance')
        lights = row.get('canonicalLights') or []
        require(0 < len(lights) <= 17 and all(vector(light.get('position')) and vector(light.get('color'))
                and finite(light.get('intensity')) and finite(light.get('radius'), positive=True) for light in lights),
                'glass oracle requires actual bounded canonical linear light records')
        if valid:
            error = max(abs(x - y) for x, y in zip(row['expected'], row['actual']))
            require(error < .0003 and abs(error - row.get('maxError', math.inf)) < 1e-12,
                    'glass reported error must equal actual native expected/readback comparison')
    for row in positive:
        require(finite(row.get('directG'), positive=True) and row['directG'] <= 1
                and finite(row.get('directContribution'), positive=True), 'neutral/shadowed glass cannot prove the direct path')
    require(vector(hard.get('actual')) and any(vector(row.get('actual')) and
            max(abs(x - y) for x, y in zip(row['actual'], hard['actual'])) > .005 for row in positive),
            'moving-light positive/hard shadow glass readbacks must differ causally')
    dim = glass.get('dimmerControls') or []
    require(len(dim) == 2 and [r.get('label') for r in dim] == ['dim-warm', 'dim-blue']
            and glass.get('unsaturatedCanonicalRGBChanged') is True, 'two actual unsaturated canonical RGB controls required')
    for row in dim:
        state = row.get('state') or {}
        require(state.get('angle') == 90 and state.get('actorX') == 22 and state.get('intensity') == .04
                and state.get('lightColour') == ([1, .95, .85] if row.get('label') == 'dim-warm' else [.15, .4, 1]),
                'dimmer oracle controls must record exact canonical input state separately from benchmark settings')
        valid = vector(row.get('directRGB')) and vector(row.get('expected')) and vector(row.get('actual'))
        require(valid and finite(row.get('directG'), positive=True) and row['directG'] <= 1
                and all(v < .21 for v in row['directRGB']) and any(v > 0 for v in row['directRGB'])
                and finite(row.get('maxError')) and row['maxError'] < .0003 and bool(row.get('canonicalLights')),
                'dimmer control must prove positive unsaturated canonical RGB and matching native readback')
        if valid:
            error = max(abs(x - y) for x, y in zip(row['expected'], row['actual']))
            require(error < .0003 and abs(error - row.get('maxError', math.inf)) < 1e-12,
                    'dimmer actual/error values disagree')
    if len(dim) == 2 and all(vector(r.get('directRGB')) and vector(r.get('actual')) for r in dim):
        require(max(abs(x - y) for x, y in zip(dim[0]['directRGB'], dim[1]['directRGB'])) > .001
                and max(abs(x - y) for x, y in zip(dim[0]['actual'], dim[1]['actual'])) > .001,
                'unsaturated native glass must follow actual changed canonical RGB')
    return errors


def _validate_browser(report, *, hardware=False, timing=False, clean=False):
    errors = []
    def require(ok, text):
        if not ok:
            errors.append(text)
    require(report.get('schema') == 'steelmoth-sm702-forward-browser-report/v1', 'browser report schema mismatch')
    require(report.get('ok') is True, 'browser runner did not pass')
    require(report.get('targetAcceptance') is False, 'forward evidence must not claim whole-frame/default acceptance')
    smoke = report.get('smoke') or {}
    require(smoke.get('schema') == 'steelmoth-sm702-forward-browser-smoke/v1' and smoke.get('ok') is True,
            'production forward fixture did not pass')
    require((smoke.get('gpu') or {}).get('realWebGPU') is True, 'real WebGPU execution is required')
    require(all(isinstance(smoke.get(key), list) and not smoke[key] for key in ('validationErrors', 'uncapturedErrors'))
            and isinstance(report.get('javascriptExceptions'), list) and not report['javascriptExceptions']
            and not smoke.get('error') and not smoke.get('cleanupError'),
            'complete empty API/JavaScript/error records required')
    compilation = smoke.get('compilation') or []
    require(len(compilation) >= 10 and all(isinstance(c.get('messages'), list)
            and not any(m.get('type') == 'error' for m in c['messages']) for c in compilation),
            'actual frozen/candidate WGSL compilation diagnostics required')
    checks = smoke.get('checks') or []
    require(len(checks) >= 20 and all(c.get('ok') is True for c in checks), 'missing/failed actual correctness assertions')
    browser = report.get('browser') or {}
    require(browser.get('freshProcess') is True and browser.get('freshProfile') is True,
            'fresh isolated process/profile proof required')
    require(browser.get('kind') in ('chrome', 'firefox') and type(browser.get('processId')) is int
            and browser.get('processId') > 0, 'actual browser kind and owned process PID required')
    require(report.get('browserProcessExited') is True and bool(browser.get('version')) and bool(report.get('runId')),
            'browser version, independent identity and actual process exit required')
    require(browser.get('defaultBrowserCompatibilityClaim') is False, 'configured process cannot claim stock browser compatibility')
    artifacts = report.get('artifactSha256') or {}
    require(set(artifacts) == set(ARTIFACTS) and all(map(digest, artifacts.values())),
            'exact saved acceptance HTML/readbacks/screenshot SHA-256 provenance required')
    if browser.get('kind') == 'firefox':
        require(not timing, 'Firefox spotcheck is correctness only')
        require(browser.get('forcedPreferences') in (FIREFOX_PROFILE_PREFS, {**FIREFOX_PROFILE_PREFS, **FIREFOX_WEBGPU_PREFS}),
                'Firefox preferences must match the documented disposable route')
        require(browser.get('windowMode') in ('windowed', 'headless'), 'Firefox exact window mode must be recorded')
    errors.extend(validate_source(report.get('source') or {}, report.get('sourceAfter') or {}, clean=clean))
    captures = smoke.get('captures') or {}
    require(bool(CAPTURES) and all(n in captures for n in CAPTURES), 'required actual forward capture inventory missing')
    for name, capture in captures.items():
        w, h, data = capture.get('width'), capture.get('height'), capture.get('data')
        require(type(w) is int and w > 0 and type(h) is int and h > 0 and isinstance(data, list)
                and len(data) == w * h * 4 and all(finite(v) for v in data), f'{name}: incomplete/nonfinite actual readback')
        meta = (smoke.get('captureMetadata') or {}).get(name) or {}
        require(bool(meta.get('testCase')) and bool(meta.get('units')) and meta.get('kind') in ('linear', 'debug')
                and finite(meta.get('exposure'), positive=True), f'{name}: exact case/units/display metadata missing')
        if meta.get('kind') == 'debug':
            ranges = meta.get('channelRanges') or []
            require(len(ranges) == 3 and all(isinstance(r, list) and len(r) == 2
                and finite(r[0]) and finite(r[1]) and r[1] > r[0] for r in ranges), f'{name}: debug channel ranges missing')
    cfg, echo = report.get('configuration') or {}, smoke.get('configuration') or {}
    for key in ('scene', 'width', 'height', 'pixelScale', 'rotationOffset', 'warmup', 'samples'):
        require(cfg.get(key) == echo.get(key), f'fixture does not echo requested {key}')
    require(cfg.get('scene') in SCENES, 'unknown scene')
    require((report.get('correctness') or {}).get('fixtureExtents') == {
        n: [c.get('width'), c.get('height')] for n, c in captures.items()}, 'actual correctness extents must be separate from requested timing')
    errors.extend(validate_forward_oracles(smoke))
    if hardware:
        errors.extend(hardware_errors(report))
    if not timing:
        return errors
    require(report.get('timestampQueryRequested') is True, 'timing must be explicitly requested')
    require(cfg.get('width') == 1920 and cfg.get('height') == 1080 and cfg.get('pixelScale') == 3 and echo.get('dpr') == 1,
            'native 1920x1080/DPR1/pixelScale3 timing required')
    measured = smoke.get('timing') or {}
    count, warmup, offset = cfg.get('samples'), cfg.get('warmup'), cfg.get('rotationOffset')
    require(type(count) is int and 600 <= count <= 3000 and type(warmup) is int and 300 <= warmup <= 3000,
            'target window requires 300..3000 warmup and 600..3000 complete samples per variant')
    require(measured.get('requested') is True and measured.get('available') is True,
            'negotiated hardware timestamp-query samples required')
    require(measured.get('extent') == {'width': 1920, 'height': 1080} and measured.get('samples') == count
            and measured.get('warmup') == warmup, 'timing extent/window mismatch')
    require(measured.get('metricSource') == 'SM500.commandGpuMs' and measured.get('compositionIncluded') is True
            and set(measured.get('upstreamExcluded') or []) == set(UPSTREAM_EXCLUDED), 'complete forward timing boundary required')
    require(measured.get('passMapping') == PASS_MAPPING and measured.get('nestedPasses') == NESTED_PASSES,
            'exact raw observer mapping and nested alpha attribution required')
    order = measured.get('sampleOrder') or []
    require(type(offset) is int and offset in (0, 1, 2) and len(order) == count
            and all(v == (i + offset) % 2 for i, v in enumerate(order)), 'paired retained order must rotate/interleave exactly')
    variants = measured.get('variants') or {}
    require(set(variants) == set(VARIANTS), 'both same-scene paired variants required')
    for name in VARIANTS:
        v = variants.get(name) or {}
        samples, queue = v.get('gpuMs') or [], v.get('queueSpanGpuMs') or []
        require(len(samples) == count and all(finite(x, positive=True) for x in samples), f'{name}: incomplete command samples')
        require(len(queue) == count and all(finite(x, positive=True) for x in queue), f'{name}: separately labelled queue samples required')
        require(v.get('commandSubmissionCounts') == [1] * count, f'{name}: exactly one measured complete submission per frame required')
        spans = v.get('commandSpansGpuMs') or []
        require(spans == samples, f'{name}: samples must equal the explicit SM500 measured command span')
        passes, raw = v.get('passMs') or {}, v.get('rawNanoseconds') or []
        require(set(passes) == set(PASSES) and all(len(passes[k]) == count and all(finite(x) for x in passes[k]) for k in passes),
                f'{name}: complete observer pass arrays required')
        raw_ok = len(raw) == count and all(isinstance(row, list) and len(row) == 8
            and all(isinstance(x, str) and x.isdecimal() and int(x) > 0 for x in row)
            and all(int(row[j + 1]) >= int(row[j]) for j in (0, 2, 4, 6)) for row in raw)
        require(raw_ok, f'{name}: eight raw decimal timestamp values per frame required')
        if raw_ok and len(samples) == count and all(len(passes.get(k) or []) == count for k in PASSES):
            for i, row in enumerate(raw):
                d = {k: (int(row[ends[1]]) - int(row[ends[0]])) / 1e6 for k, ends in PASS_MAPPING.items()}
                require(all(finite(passes[k][i]) and abs(passes[k][i] - d[k]) < 1e-9 for k in PASSES),
                        f'{name}: pass duration differs from raw timestamp at frame{i}')
                require(finite(samples[i]) and d['water'] + d['foliage'] + d['fixture-composition'] <= samples[i] + .01,
                        f'{name}: primary command measurement omits work at frame{i}')
                require(int(row[6]) <= int(row[4]) <= int(row[5]) <= int(row[7]),
                        f'{name}: world-alpha observer is not nested in composition at frame{i}')
        require(v.get('settings') == SETTINGS and v.get('sceneCounts') == SCENE_COUNTS.get(cfg.get('scene')),
                f'{name}: exact matched material settings/caps/scene counts required')
        require(v.get('actualSettings') == actual_settings(name), f'{name}: actual normalized material settings/advanced flags differ')
        support = v.get('support') or {}
        require(finite(support.get('indirectMax'), positive=True) and finite(support.get('dsoMax'), positive=True)
                and finite(support.get('gtaoMin')) and support.get('gtaoMin') < 1
                and finite(support.get('ambientMin')) and support.get('ambientMin') < 1
                and support.get('ssgiHistoryValid') is True,
                f'{name}: positive canonical GI/DSO/GTAO and warmed history proof required')
        errors.extend(validate_memory(v, name, cfg.get('scene')))
        if len(samples) == count and samples and all(finite(x, positive=True) for x in samples):
            stats = statistics(samples)
            require(all(finite(v.get(k)) and abs(v[k] - stats[k]) < 1e-8 for k in ('meanMs', 'p95Ms')),
                    f'{name}: mean/p95 must use every sample without filtering')
    return errors


def validate_browser(report, **kwargs):
    try:
        return _validate_browser(report, **kwargs)
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError) as error:
        return [f'malformed browser evidence: {type(error).__name__}: {error}']


def campaign_summary(reports):
    result = {}
    for scene in SCENES:
        selected = [r for r in reports if r['configuration']['scene'] == scene]
        if len(selected) != 3:
            continue
        variants = {name: statistics([x for r in selected for x in r['smoke']['timing']['variants'][name]['gpuMs']]) for name in VARIANTS}
        paired = [c - b for r in selected for b, c in zip(r['smoke']['timing']['variants']['baseline']['gpuMs'],
                                                          r['smoke']['timing']['variants']['candidate']['gpuMs'])]
        result[scene] = {'variants': variants, 'candidateMinusBaseline': {
            'meanMs': sum(paired) / len(paired), 'pairedSamples': len(paired),
            'pooledMeanPercent': 100 * (variants['candidate']['meanMs'] / variants['baseline']['meanMs'] - 1),
            'p95DifferenceMs': variants['candidate']['p95Ms'] - variants['baseline']['p95Ms']},
            'memoryBytes': {n: selected[0]['smoke']['timing']['variants'][n]['descriptorMemoryBytes'] for n in VARIANTS}}
    return result


def resolve_reports(records, base_dir, errors, label):
    reports = []
    for i, record in enumerate(records):
        try:
            if base_dir is None or not isinstance(record.get('reportFile'), str):
                raise ValueError('external raw report reference required')
            relative = Path(record['reportFile'])
            if relative.is_absolute():
                raise ValueError('report reference must be relative')
            base = Path(base_dir).resolve()
            path = (base / relative).resolve()
            path.relative_to(base)
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != record.get('reportSha256'):
                raise ValueError('retained raw SHA-256 mismatch')
            report = json.loads(data)
            if report.get('runId') != record.get('runId') or report.get('configuration') != record.get('configuration'):
                raise ValueError('raw identity differs from manifest')
            for name in ARTIFACTS:
                if hashlib.sha256((path.parent / name).read_bytes()).hexdigest() != (report.get('artifactSha256') or {}).get(name):
                    raise ValueError('retained acceptance artifact bytes changed: ' + name)
            reports.append(report)
        except (OSError, ValueError, KeyError, TypeError) as error:
            errors.append(f'{label}{i + 1}: unresolved/changed raw report: {error}')
    return reports


def validate_campaign(payload, *, base_dir=None):
    errors = []
    if payload.get('schema') != 'steelmoth-sm702-target-campaign/v1' or payload.get('targetAcceptance') is not False:
        errors.append('campaign schema or forward-only acceptance boundary mismatch')
    reports = resolve_reports(payload.get('runs') or [], base_dir, errors, 'Chrome')
    firefox = resolve_reports(payload.get('firefoxSpotChecks') or [], base_dir, errors, 'Firefox')
    if len(reports) != 6 or len(firefox) != 1:
        errors.append('exactly six Chrome runs (three per scene) and one native Firefox correctness spotcheck required')
    identities, run_ids, closures, commits = set(), set(), [], set()
    for i, report in enumerate(reports):
        errors.extend(f'Chrome{i + 1}: {e}' for e in validate_browser(report, hardware=True, timing=True, clean=True))
        cfg = report.get('configuration') or {}
        identity = (cfg.get('scene'), cfg.get('rotationOffset'))
        if identity in identities:
            errors.append(f'duplicate configuration/process rotation {identity}')
        identities.add(identity)
        run_ids.add(report.get('runId'))
        closures.append((report.get('source') or {}).get('fileSha256'))
        commits.add((report.get('source') or {}).get('commit'))
        if (report.get('browser') or {}).get('kind') != 'chrome':
            errors.append('performance evidence requires actual fresh native Chrome')
    for report in firefox:
        errors.extend('Firefox: ' + e for e in validate_browser(report, hardware=True, timing=False, clean=True))
        if ((report.get('browser') or {}).get('kind') != 'firefox' or (report.get('configuration') or {}).get('scene') != 'representative'
                or report.get('timestampQueryRequested') is not False):
            errors.append('required Firefox is representative correctness only, never full-HD timing')
        closures.append((report.get('source') or {}).get('fileSha256'))
        commits.add((report.get('source') or {}).get('commit'))
        run_ids.add(report.get('runId'))
    if identities != {(s, i) for s in SCENES for i in range(3)} or len(run_ids) != 7 or len(commits) != 1:
        errors.append('independent same-commit process/configuration identities incomplete')
    if not closures or any(c != closures[0] for c in closures):
        errors.append('executable source changed between browser processes')
    errors.extend(validate_source(payload.get('source') or {}, payload.get('sourceAfter') or {}, clean=True))
    if closures and closures[0] != (payload.get('source') or {}).get('fileSha256'):
        errors.append('campaign manifest does not match measured source closure')
    if commits != {(payload.get('source') or {}).get('commit')}:
        errors.append('campaign source commit differs from measured reports')
    if not errors and payload.get('summary') != campaign_summary(reports):
        errors.append('pooled statistics/deltas differ from complete unfiltered raw reports')
    return errors


def self_test():
    """CPU-only schema witnesses; no browser, adapter, timing or hardware claim."""
    source = {'commit': 'a' * 40, 'cleanTrackedState': True, 'closureTracked': True,
              'fileSha256': {n: 'a' * 64 for n in SOURCE_FILES},
              'baselineLFNormalizedSha256': copy.deepcopy(BASELINE_PINS),
              'baselineCommit': BASELINE_COMMIT, 'baselineGitBlobLFNormalizedSha256': copy.deepcopy(BASELINE_PINS)}
    config = {'scene': 'representative', 'width': 1920, 'height': 1080, 'pixelScale': 3,
              'warmup': 300, 'samples': 600, 'rotationOffset': 0}
    variants = {}
    for name in VARIANTS:
        resources = memory_descriptors(name, 'representative')
        total = sum(r['estimatedBytes'] for r in resources)
        variants[name] = {'gpuMs': [4.] * 600, 'commandSpansGpuMs': [4.] * 600,
            'queueSpanGpuMs': [5.] * 600,
            'passMs': {'water': [1.] * 600, 'foliage': [1.] * 600,
                       'world-alpha': [.5] * 600, 'fixture-composition': [1.] * 600},
            'rawNanoseconds': [['1', '1000001', '2000001', '3000001', '3500001', '4000001', '3000001', '4000001'] for _ in range(600)],
            'commandSubmissionCounts': [1] * 600, 'settings': copy.deepcopy(SETTINGS),
            'actualSettings': actual_settings(name),
            'sceneCounts': copy.deepcopy(SCENE_COUNTS['representative']),
            'support': {'indirectMax': .01, 'dsoMax': .5, 'gtaoMin': .9, 'ambientMin': .8, 'ssgiHistoryValid': True},
            'memory': {'resources': resources, 'totalEstimatedBytes': total, 'historyEstimatedBytes': 0,
                       'residentVramMeasured': False, 'sharedUpstreamExcluded': list(UPSTREAM_EXCLUDED)},
            'descriptorMemoryBytes': total, 'meanMs': 4., 'p95Ms': 4.}
    captures = {name: {'width': 1, 'height': 1, 'data': [0, 0, 0, 1]} for name in CAPTURES}
    water_expected = [.01 * own * .5 * .6 for own in (.2, .5, .8)]
    captures['water-indirect']['data'] = [*water_expected, 1]
    light = {'position': [1, 1, 40], 'color': [1, .8, .7], 'intensity': .1, 'radius': 100}
    hard_glass = {'native': [0, 0], 'surfaceVisible': True, 'directG': 0, 'directContribution': 0,
        'expected': [.1, .15, .2], 'actual': [.1, .15, .2], 'maxError': 0, 'canonicalLights': [light]}
    positive_glass = {**copy.deepcopy(hard_glass), 'directG': 1, 'directContribution': .01,
        'expected': [.11, .16, .21], 'actual': [.11, .16, .21]}
    forward = {'water': {'indirectMaximum': max(water_expected), 'ambientOnce': {
        'tested': 1, 'positivePixels': 1, 'maxError': 0, 'tolerance': .00002,
        'rows': [{'native': [0, 0], 'ambientB': .5, 'incident': [.01, .01, .01],
                  'ownDiffuse': [.2, .5, .8], 'reason': 0, 'surfaceVisible': True,
                  'expected': water_expected, 'actual': water_expected}]}},
        'ambientOnce': {'tested': 1, 'maxError': 0},
        'glass': {'direct': {'positiveWitnesses': [positive_glass], 'hardZero': hard_glass,
            'movingLightChanged': True, 'maximumError': 0, 'tolerance': .0003,
            'unsaturatedCanonicalRGBChanged': True,
            'dimmerControls': [{'label': label, 'state': {'angle': 90, 'actorX': 22, 'intensity': .04, 'lightColour': colour},
                'directG': 1, 'directRGB': values, 'expected': values, 'actual': values, 'maxError': 0,
                'canonicalLights': [light]} for label, colour, values in (
                    ('dim-warm', [1, .95, .85], [.02, .018, .016]),
                    ('dim-blue', [.15, .4, 1], [.004, .009, .019]))]}}}
    report = {'schema': 'steelmoth-sm702-forward-browser-report/v1', 'ok': True,
        'runId': 'CPU-STRUCTURAL-WITNESS-NOT-MEASURED', 'targetAcceptance': False,
        'hardwareRequested': True, 'softwareRequested': False, 'timestampQueryRequested': True,
        'javascriptExceptions': [],
        'browserProcessExited': True, 'browser': {'kind': 'chrome', 'version': 'CPU schema witness only',
            'processId': 123, 'freshProcess': True, 'freshProfile': True, 'defaultBrowserCompatibilityClaim': False},
        'configuration': config, 'source': source, 'sourceAfter': copy.deepcopy(source),
        'artifactSha256': {name: hashlib.sha256(b'CPU-schema-only artifact bytes').hexdigest() for name in ARTIFACTS},
        'correctness': {'fixtureExtents': {n: [1, 1] for n in CAPTURES}},
        'gpuInventory': {'available': True, 'devices': [{'name': 'GTX 1650 SUPER', 'memoryMiB': 4096,
            'driver': 'CPU-schema-only', 'pciBusId': 'CPU-schema-only'}]},
        'videoControllers': {'available': True, 'devices': [{'Name': 'GTX 1650 SUPER',
            'PNPDeviceID': 'VEN_10DE&DEV_2187', 'DriverVersion': 'CPU-schema-only'}]},
        'smoke': {'schema': 'steelmoth-sm702-forward-browser-smoke/v1', 'ok': True,
            'validationErrors': [], 'uncapturedErrors': [],
            'compilation': [{'label': 'CPU schema only, not a shader measurement', 'messages': []} for _ in range(10)],
            'gpu': {'realWebGPU': True, 'isFallbackAdapter': False, 'adapterInfo': {'vendor': 'nvidia', 'architecture': 'turing'}},
            'checks': [{'name': 'CPU schema only', 'ok': True} for _ in range(20)],
            'configuration': {**config, 'dpr': 1}, 'captures': captures,
            'forward': forward,
            'captureMetadata': {n: {'testCase': 'CPU schema only', 'kind': 'linear', 'units': 'schema-only', 'exposure': 1} for n in CAPTURES},
            'timing': {'requested': True, 'available': True, 'metricSource': 'SM500.commandGpuMs',
                'compositionIncluded': True, 'upstreamExcluded': list(UPSTREAM_EXCLUDED),
                'extent': {'width': 1920, 'height': 1080}, 'samples': 600, 'warmup': 300,
                'sampleOrder': [i % 2 for i in range(600)], 'passMapping': copy.deepcopy(PASS_MAPPING),
                'nestedPasses': copy.deepcopy(NESTED_PASSES), 'variants': variants}}}
    assert not validate_browser(report, hardware=True, timing=True, clean=True)
    mutants = []
    def mutate(label, callback):
        changed = copy.deepcopy(report)
        callback(changed)
        mutants.append((label, changed))
    def candidate(r):
        return r['smoke']['timing']['variants']['candidate']
    mutate('partial primary samples', lambda r: candidate(r)['gpuMs'].pop())
    mutate('partial observer samples', lambda r: candidate(r)['rawNanoseconds'].pop())
    mutate('missing nested span declaration', lambda r: r['smoke']['timing'].update(nestedPasses={}))
    mutate('wrong raw timestamp mapping', lambda r: r['smoke']['timing']['passMapping'].update(water=[2, 3]))
    mutate('raw observer duration mismatch', lambda r: candidate(r)['passMs']['water'].__setitem__(0, 0.))
    mutate('alpha outside composition', lambda r: candidate(r)['rawNanoseconds'][0].__setitem__(4, '1'))
    mutate('primary command omits work', lambda r: candidate(r).update(gpuMs=[2.] * 600, commandSpansGpuMs=[2.] * 600, meanMs=2., p95Ms=2.))
    mutate('queue spans masquerade as primary', lambda r: r['smoke']['timing'].update(metricSource='SM500.queueSpanGpuMs'))
    mutate('primary span provenance mismatch', lambda r: candidate(r)['commandSpansGpuMs'].__setitem__(0, 3.))
    mutate('missed submission', lambda r: candidate(r)['commandSubmissionCounts'].__setitem__(0, 0))
    mutate('two submissions', lambda r: candidate(r)['commandSubmissionCounts'].__setitem__(0, 2))
    mutate('no positive incident diffuse', lambda r: candidate(r)['support'].update(indirectMax=0))
    mutate('neutral DSO masquerade', lambda r: candidate(r)['support'].update(dsoMax=0))
    mutate('neutral GTAO masquerade', lambda r: candidate(r)['support'].update(gtaoMin=1))
    mutate('cold GI history', lambda r: candidate(r)['support'].update(ssgiHistoryValid=False))
    mutate('neutral ambient visibility', lambda r: candidate(r)['support'].update(ambientMin=1))
    mutate('different material settings', lambda r: candidate(r)['settings']['water'].update(waterQuality=2))
    mutate('actual advanced path disabled', lambda r: candidate(r)['actualSettings']['water'].update(advancedLighting=False))
    mutate('stress caps weakened', lambda r: candidate(r)['settings']['caps'].update(transparent=5))
    mutate('scene counts mismatch', lambda r: candidate(r)['sceneCounts'].update(transparent=640))
    mutate('source changed during run', lambda r: r['sourceAfter']['fileSha256'].__setitem__('engine/webgpu_water.js', 'b' * 64))
    mutate('untracked executable closure', lambda r: r['source'].update(closureTracked=False))
    for path in BASELINE_PINS:
        mutate('frozen baseline changed: ' + path, lambda r, p=path: r['source']['baselineLFNormalizedSha256'].__setitem__(p, 'b' * 64))
    mutate('source closure omission', lambda r: r['source']['fileSha256'].pop('engine/webgpu_ownership.js'))
    mutate('baseline origin missing', lambda r: r['source'].pop('baselineGitBlobLFNormalizedSha256'))
    mutate('software/fallback adapter', lambda r: r['smoke']['gpu'].update(isFallbackAdapter=True))
    mutate('unknown redacted adapter', lambda r: r['smoke']['gpu'].update(isFallbackAdapter=None, adapterInfo={}))
    mutate('capture missing', lambda r: r['smoke']['captures'].pop('guard'))
    mutate('water oracle absent', lambda r: r['smoke']['forward'].pop('water'))
    mutate('water double ambient', lambda r: r['smoke']['forward']['water']['ambientOnce']['rows'][0].update(expected=[v * .5 for v in water_expected]))
    mutate('water oracle does not use retained capture', lambda r: r['smoke']['captures']['water-indirect']['data'].__setitem__(0, 0))
    mutate('water no positive pixels', lambda r: r['smoke']['forward']['water']['ambientOnce'].update(positivePixels=0))
    mutate('water oracle loose tolerance', lambda r: r['smoke']['forward']['water']['ambientOnce'].update(tolerance=.01))
    mutate('glass no positive G oracle', lambda r: r['smoke']['forward']['glass']['direct'].update(positiveWitnesses=[]))
    mutate('glass positive path is actually G0', lambda r: r['smoke']['forward']['glass']['direct']['positiveWitnesses'][0].update(directG=0))
    mutate('glass positive contribution zero', lambda r: r['smoke']['forward']['glass']['direct']['positiveWitnesses'][0].update(directContribution=0))
    mutate('glass hard zero omitted', lambda r: r['smoke']['forward']['glass']['direct'].pop('hardZero'))
    mutate('glass moving witness absent', lambda r: r['smoke']['forward']['glass']['direct'].update(movingLightChanged=False))
    mutate('glass canonical lights missing', lambda r: r['smoke']['forward']['glass']['direct']['positiveWitnesses'][0].update(canonicalLights=[]))
    mutate('unsaturated colour controls missing', lambda r: r['smoke']['forward']['glass']['direct'].pop('dimmerControls'))
    mutate('dimmer saturated', lambda r: r['smoke']['forward']['glass']['direct']['dimmerControls'][0].update(directRGB=[.22, .22, .22]))
    mutate('dimmer RGB noncausal', lambda r: r['smoke']['forward']['glass']['direct'].update(unsaturatedCanonicalRGBChanged=False))
    mutate('API validation record missing', lambda r: r['smoke'].pop('validationErrors'))
    mutate('compiler errors hidden', lambda r: r['smoke']['compilation'][0]['messages'].append({'type': 'error'}))
    mutate('debug units missing', lambda r: r['smoke']['captureMetadata']['guard'].pop('units'))
    mutate('owned descriptor missing', lambda r: candidate(r)['memory']['resources'].pop())
    mutate('resident VRAM invented', lambda r: candidate(r)['memory'].update(residentVramMeasured=True))
    mutate('upstream memory included unlabelled', lambda r: candidate(r)['memory'].update(sharedUpstreamExcluded=[]))
    mutate('upstream timed instead of forward', lambda r: r['smoke']['timing'].update(upstreamExcluded=[]))
    mutate('composition work omitted', lambda r: r['smoke']['timing'].update(compositionIncluded=False))
    mutate('nonfinite samples', lambda r: candidate(r)['gpuMs'].__setitem__(0, float('nan')))
    mutate('outlier summary filtering', lambda r: candidate(r).update(meanMs=3.))
    mutate('whole-frame success claim', lambda r: r.update(targetAcceptance=True))
    mutate('wrong paired order', lambda r: r['smoke']['timing']['sampleOrder'].__setitem__(0, 1))
    mutate('cleanup not proven', lambda r: r.update(browserProcessExited=None))
    mutate('owned process PID missing', lambda r: r['browser'].pop('processId'))
    mutate('acceptance bytes hash missing', lambda r: r['artifactSha256'].pop('acceptance.html'))
    mutate('non-native core extent', lambda r: r['configuration'].update(width=640))
    mutate('malformed array', lambda r: candidate(r).update(rawNanoseconds=13))
    for label, changed in mutants:
        assert validate_browser(changed, hardware=True, timing=True, clean=True), 'Mutant escaped: ' + label
    redacted = copy.deepcopy(report)
    redacted['smoke']['gpu']['adapterInfo'] = {}
    assert not hardware_errors(redacted), 'Actual nonfallback flag + single native controller permits redacted adapter names'
    redacted['videoControllers']['devices'].append({'Name': 'other adapter'})
    assert hardware_errors(redacted), 'Multiple native controllers cannot establish redacted adapter identity'
    shallow = copy.deepcopy(report)
    for label in ('source', 'sourceAfter'):
        shallow[label]['baselineGitBlobLFNormalizedSha256'] = None
    assert not validate_browser(shallow, hardware=False, timing=False, clean=False), 'Software correctness may report unavailable historical Git object'
    assert validate_browser(shallow, hardware=True, timing=True, clean=True), 'Native acceptance cannot omit accepted Git-blob proof'
    reference_cases = 0
    virtual_bytes = {}
    # Exercise exact retained byte hashing/path containment without writing
    # synthetic reports into a source tree or an environment-owned temp folder.
    base = Path(__file__).resolve().parent / '.sm702-schema-only'
    with patch.object(Path, 'read_bytes', lambda p: virtual_bytes[p.resolve()]):
        rows, checks, real = [], [], []
        def record(value, filename):
            nonlocal reference_cases
            data = (json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n').encode()
            relative = Path(filename.removesuffix('.json')) / 'report.json'
            virtual_bytes[(base / relative).resolve()] = data
            for name in ARTIFACTS:
                virtual_bytes[(base / relative.parent / name).resolve()] = b'CPU-schema-only artifact bytes'
            return {'reportFile': relative.as_posix(), 'reportSha256': hashlib.sha256(data).hexdigest(),
                    'runId': value['runId'], 'configuration': value['configuration']}
        for scene in SCENES:
            for offset in range(3):
                r = copy.deepcopy(report)
                r['runId'] = f'CPU-schema-only-{scene}-{offset}'
                r['configuration'].update(scene=scene, rotationOffset=offset)
                r['smoke']['configuration'].update(scene=scene, rotationOffset=offset)
                r['smoke']['timing']['sampleOrder'] = [(i + offset) % 2 for i in range(600)]
                for name, value in r['smoke']['timing']['variants'].items():
                    value['sceneCounts'] = copy.deepcopy(SCENE_COUNTS[scene])
                    value['memory']['resources'] = memory_descriptors(name, scene)
                    value['descriptorMemoryBytes'] = value['memory']['totalEstimatedBytes'] = sum(
                        resource['estimatedBytes'] for resource in value['memory']['resources'])
                real.append(r)
                rows.append(record(r, f'{scene}-{offset}.json'))
        ff = copy.deepcopy(report)
        ff.update(runId='CPU-schema-only-Firefox', timestampQueryRequested=False)
        ff['browser'].update(kind='firefox', forcedPreferences=copy.deepcopy(FIREFOX_PROFILE_PREFS), windowMode='headless')
        checks.append(record(ff, 'firefox.json'))
        campaign = {'schema': 'steelmoth-sm702-target-campaign/v1', 'targetAcceptance': False,
            'source': copy.deepcopy(source), 'sourceAfter': copy.deepcopy(source),
            'runs': rows, 'firefoxSpotChecks': checks, 'summary': campaign_summary(real)}
        assert not validate_campaign(campaign, base_dir=base)
        for label, change in (
            ('SHA mismatch', lambda c: c['runs'][0].update(reportSha256='b' * 64)),
            ('path escape', lambda c: c['runs'][0].update(reportFile='../escaped.json')),
            ('partial campaign', lambda c: c['runs'].pop()),
            ('duplicate process', lambda c: c['runs'].__setitem__(1, c['runs'][0])),
            ('missing Firefox', lambda c: c.update(firefoxSpotChecks=[])),
            ('unfiltered summary mismatch', lambda c: c['summary']['stress']['candidateMinusBaseline'].update(meanMs=1.)),
            ('missing campaign source', lambda c: c.update(source={})),
        ):
            broken = copy.deepcopy(campaign)
            change(broken)
            assert validate_campaign(broken, base_dir=base), 'Reference mutant escaped: ' + label
            reference_cases += 1
        changed_html = (base / Path(rows[0]['reportFile']).parent / 'acceptance.html').resolve()
        virtual_bytes[changed_html] = b'CPU-schema-only altered artifact'
        assert validate_campaign(campaign, base_dir=base), 'Changed saved acceptance bytes must fail'
        reference_cases += 1
    print(json.dumps({'ok': True, 'structuralMutantsRejected': len(mutants), 'retainedReferenceMutantsRejected': reference_cases,
        'adapterAttributionCases': 2, 'historicalGitProofCases': 2,
        'boundary': 'CPU schema self-test only. Synthetic values are not measured browser, GPU or hardware evidence.'}))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path, nargs='?')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if args.report is None:
        parser.error('report path or --self-test required')
    try:
        payload = json.loads(args.report.read_text(encoding='utf-8'))
        errors = validate_campaign(payload, base_dir=args.report.parent)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        errors = [f'malformed campaign: {type(error).__name__}: {error}']
    print(json.dumps({'ok': not errors, 'errors': errors,
        'boundary': 'Forward submission delta/descriptors and correctness only; upstream excluded, composition included; no whole-frame budget claim.'}))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
