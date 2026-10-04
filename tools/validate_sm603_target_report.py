#!/usr/bin/env python3
"""Fail closed on incomplete SM-603 correctness and paired target-GPU evidence."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

QUALITIES = ('Medium', 'High', 'Ultra')
SCENES = ('representative', 'dense')
VARIANTS = ('baseline', 'candidate')
PASSES = ('trace', 'resolve', 'compose', 'snapshot')
PRESETS = {'Medium': {'rays': 4, 'steps': 6, 'radius': 24, 'historyWeight': .85},
           'High': {'rays': 6, 'steps': 8, 'radius': 32, 'historyWeight': .88},
           'Ultra': {'rays': 8, 'steps': 8, 'radius': 40, 'historyWeight': .90}}
BASELINE_FILE = 'tools/experiments/sm603_ssgi_baseline.js'
BASELINE_SHA256 = '5108e3de85daab4a3fcd4e248c8254bb3913a2ecbc5d2999c2068c56fb4ddf48'
SOURCE_FILES = (
    'webgpu-ssgi-stabilization-smoke.html', BASELINE_FILE,
    'tools/sm602_ssgi_fixtures.js', 'tools/sm603_ssgi_fixtures.js',
    'tools/validate_sm603_ssgi_browser.py', 'tools/run_sm603_target_campaign.py',
    'tools/validate_sm603_target_report.py', 'tools/validate_webgpu_ssgi_browser.py',
    'engine/webgpu_ssgi.js', 'engine/webgpu_performance.js',
    'engine/webgpu_gtao_stabilization.js', 'engine/webgpu_depth_hierarchy.js',
    'engine/webgpu_resources.js', 'engine/webgpu_visibility.js', 'engine/pseudo_depth.js')
CAPTURES = ('baseline-before', 'baseline-deleted', 'candidate-deleted',
            'raw-deleted', 'rejection-deleted', 'candidate-translated', 'candidate-pathological')
FORMAT_BYTES = {'rgba16float': 8, 'rgba32uint': 16, 'rg32float': 8, 'r32uint': 4, 'r32float': 4}


def finite(value, *, positive=False):
    return (type(value) in (int, float) and math.isfinite(value)
            and (value > 0 if positive else value >= 0))


def statistics(values):
    """Use every sample; callers must validate first, never filter outliers."""
    if not values or not all(finite(v) for v in values):
        raise ValueError('Statistics require a complete finite nonnegative array')
    ordered = sorted(values)
    return {'count': len(values), 'meanMs': sum(values) / len(values),
            'p95Ms': ordered[math.ceil(len(values) * .95) - 1],
            'minimumMs': ordered[0], 'maximumMs': ordered[-1]}


def hardware_errors(report):
    errors = []
    gpu = (report.get('smoke') or {}).get('gpu') or {}
    inventory = report.get('gpuInventory') or {}
    info = gpu.get('adapterInfo') or {}
    fallback = gpu.get('isFallbackAdapter')
    if fallback is True:
        errors.append('exposed adapter is explicitly fallback')
    elif fallback is not None and fallback is not False:
        errors.append('fallback adapter flag must be an explicit boolean or unknown/null')
    if any(word in json.dumps(info).lower() for word in ('swiftshader', 'llvmpipe', 'software')):
        errors.append('exposed adapter identifies software rendering')
    adapter_identified = (str(info.get('vendor', '')).lower() == 'nvidia'
                          and str(info.get('architecture', '')).lower() == 'turing')
    controllers = report.get('videoControllers') or {}
    all_controllers = controllers.get('devices') or []
    single_target_controller = (controllers.get('available') is True and len(all_controllers) == 1
        and 'GTX 1650 SUPER' in str(all_controllers[0].get('Name', '')).upper()
        and 'VEN_10DE' in str(all_controllers[0].get('PNPDeviceID', '')).upper()
        and 'DEV_2187' in str(all_controllers[0].get('PNPDeviceID', '')).upper()
        and bool(all_controllers[0].get('DriverVersion')))
    if not adapter_identified and not (fallback is False and single_target_controller):
        errors.append('Adapter identity is redacted/unknown and no explicit nonfallback flag plus single native target-controller proof exists')
    devices = inventory.get('devices') or []
    if inventory.get('available') is not True or len(devices) != 1:
        errors.append('exactly one inventoried NVIDIA target is required for unambiguous adapter attribution')
    elif ('GTX 1650 SUPER' not in str(devices[0].get('name', '')).upper()
          or devices[0].get('memoryMiB') != 4096 or not devices[0].get('driver')
          or not devices[0].get('pciBusId')):
        errors.append('GTX 1650 SUPER 4096 MiB, driver and PCI identity are required')
    if report.get('hardwareRequested') is not True or report.get('softwareRequested') is not False:
        errors.append('native hardware must be explicitly requested without software forcing')
    return errors


def validate_browser(report, *, hardware=False, timing=False, clean=False):
    errors = []
    def require(ok, message):
        if not ok:
            errors.append(message)
    require(report.get('schema') == 'steelmoth-sm603-browser-report/v1', 'browser report schema mismatch')
    require(report.get('ok') is True, 'browser runner did not pass')
    require(report.get('targetAcceptance') is False, 'pass evidence must not claim whole-renderer/default acceptance')
    smoke = report.get('smoke') or {}
    require(smoke.get('schema') == 'steelmoth-sm603-browser-smoke/v1' and smoke.get('ok') is True,
            'production fixture did not pass')
    require((smoke.get('gpu') or {}).get('realWebGPU') is True, 'actual WebGPU execution is required')
    require(not smoke.get('validationErrors') and not smoke.get('uncapturedErrors')
            and not report.get('javascriptExceptions'), 'API/JavaScript errors are present')
    checks = smoke.get('checks') or []
    require(len(checks) >= 20 and all(c.get('ok') is True for c in checks), 'missing or failed correctness assertions')
    browser = report.get('browser') or {}
    require(browser.get('freshProcess') is True and browser.get('freshProfile') is True,
            'fresh isolated browser process/profile proof is required')
    require(report.get('browserProcessExited') is True, 'owned browser process cleanup was not verified')
    require(bool(browser.get('version')) and bool(report.get('runId')), 'browser version/run identity is required')
    require(browser.get('defaultBrowserCompatibilityClaim') is False,
            'configured headless/forced-preference evidence must not claim stock browser compatibility')
    source, after = report.get('source') or {}, report.get('sourceAfter') or {}
    hashes = source.get('fileSha256') or {}
    require(bool(source.get('commit')) and source.get('commit') == after.get('commit'), 'source commit missing or changed during run')
    require(set(hashes) == set(SOURCE_FILES) and hashes == after.get('fileSha256'), 'complete source closure missing or changed during run')
    require(all(isinstance(h, str) and len(h) == 64 and all(c in '0123456789abcdef' for c in h)
                for h in hashes.values()), 'invalid source SHA-256 value')
    require(source.get('baselineLFNormalizedSha256') == BASELINE_SHA256
            and after.get('baselineLFNormalizedSha256') == BASELINE_SHA256,
            'frozen SM-602 baseline differs from LF-normalized measured production bytes')
    if clean:
        require(source.get('cleanTrackedState') is True and after.get('cleanTrackedState') is True,
                'target campaign must use clean tracked source')
        require(source.get('closureTracked') is True and after.get('closureTracked') is True,
                'every executable source-closure path must be Git-tracked for target evidence')
    captures = smoke.get('captures') or {}
    require(all(name in captures for name in CAPTURES), 'required baseline/deletion/debug captures missing')
    for name, capture in captures.items():
        w, h, values = capture.get('width'), capture.get('height'), capture.get('data')
        require(type(w) is int and w > 0 and type(h) is int and h > 0
                and isinstance(values, list) and len(values) == w * h * 4
                and all(finite(v) for v in values), f'{name}: incomplete/nonfinite actual readback')
        metadata = (smoke.get('captureMetadata') or {}).get(name) or {}
        require(bool(metadata.get('testCase')) and metadata.get('kind') in ('indirect', 'composed', 'rejection')
                and finite(metadata.get('exposure'), positive=True), f'{name}: exact display/case metadata missing')
    configuration = report.get('configuration') or {}
    echo = smoke.get('configuration') or {}
    for key in ('quality', 'scene', 'width', 'height', 'pixelScale', 'rotationOffset', 'warmup', 'samples'):
        require(echo.get(key) == configuration.get(key), f'fixture configuration does not echo requested {key}')
    require(configuration.get('quality') in QUALITIES and configuration.get('scene') in SCENES,
            'unknown quality or scene')
    correctness = report.get('correctness') or {}
    require(correctness.get('fixtureExtents') == {name: [capture.get('width'), capture.get('height')]
            for name, capture in captures.items()} and correctness.get('quality') == echo.get('correctnessQuality'),
            'actual correctness fixture extents/quality must be stated separately from timing configuration')
    if hardware:
        errors.extend(hardware_errors(report))
    if not timing:
        return errors
    require(configuration.get('width') == 1920 and configuration.get('height') == 1080
            and configuration.get('pixelScale') == 3 and echo.get('dpr') == 1,
            'native full-HD timing attachments, pixelScale3 and DPR1 are required')
    measured = smoke.get('timing') or {}
    count, warmup = configuration.get('samples'), configuration.get('warmup')
    require(type(count) is int and count >= 600 and type(warmup) is int and warmup >= 300,
            'target runs require at least300 warmup and600 retained samples per variant')
    require(measured.get('requested') is True and measured.get('available') is True,
            'negotiated timestamp-query GPU samples are required')
    require(measured.get('extent') == {'width': 1920, 'height': 1080}
            and measured.get('samples') == count and measured.get('warmup') == warmup,
            'timing window or extent differs from declared configuration')
    order = measured.get('sampleOrder') or []
    offset = configuration.get('rotationOffset')
    require(type(offset) is int and offset in (0, 1, 2) and len(order) == count
            and all(v == (i + offset) % 2 for i, v in enumerate(order)),
            'baseline/candidate must rotate and interleave each retained frame')
    require('complete' in str(measured.get('boundary', '')).lower(), 'complete-command timing boundary must be stated')
    variants = measured.get('variants') or {}
    require(set(variants) == set(VARIANTS), 'both paired variants are required')
    for name in VARIANTS:
        variant = variants.get(name) or {}
        samples = variant.get('gpuMs') or []
        require(len(samples) == count and all(finite(v, positive=True) for v in samples), f'{name}: incomplete command GPU samples')
        queue = variant.get('queueSpanGpuMs') or []
        require(len(queue) == count and all(finite(v, positive=True) for v in queue), f'{name}: separately labelled queue spans missing')
        passes = variant.get('passMs') or {}
        require(set(passes) == set(PASSES), f'{name}: four per-pass timestamp arrays are required')
        for key in PASSES:
            values = passes.get(key) or []
            require(len(values) == count and all(finite(v) for v in values), f'{name}/{key}: incomplete compute samples')
        raw = variant.get('rawNanoseconds') or []
        require(len(raw) == count and all(isinstance(row, list) and len(row) == 8
                and all(isinstance(v, str) and v.isdecimal() and int(v) > 0 for v in row)
                and all(int(row[j + 1]) >= int(row[j]) for j in (0, 2, 4, 6)) for row in raw),
                f'{name}: raw eight-query timestamp records missing or invalid')
        if (type(count) is int and len(raw) == count and len(samples) == count
                and all(len(passes.get(key) or []) == count for key in PASSES)
                and all(isinstance(row, list) and len(row) == 8
                        and all(isinstance(v, str) and v.isdecimal() for v in row) for row in raw)):
            for i, row in enumerate(raw):
                durations = [(int(row[j + 1]) - int(row[j])) / 1e6 for j in (0, 2, 4, 6)]
                require(all(finite(passes[key][i]) and abs(passes[key][i] - durations[j]) < 1e-9
                            for j, key in enumerate(PASSES)), f'{name}: compute arrays differ from raw timestamps at sample{i}')
                require(finite(samples[i]) and sum(durations) <= samples[i] + .01,
                        f'{name}: complete command span cannot omit measured compute at sample{i}')
        require(variant.get('commandSubmissionCounts') == [1] * count,
                f'{name}: exactly one complete four-pass producer submission per sample is required')
        require(variant.get('historyValidSamples') == count and finite(variant.get('positiveDonorMax'), positive=True),
                f'{name}: warmed history and positive donor work must be proven')
        settings = variant.get('settings') or {}
        require(settings.get('quality') == configuration.get('quality') and settings.get('enabled') is True
                and settings.get('pixelScale') == 3
                and all(settings.get(key) == value for key, value in PRESETS.get(configuration.get('quality'), {}).items()),
                f'{name}: exact canonical quality rays/steps/radius/history settings required')
        memory = variant.get('memory') or {}
        resources = memory.get('resources') or []
        total = 0
        require(bool(resources) and len({r.get('name') for r in resources}) == len(resources), f'{name}: complete named memory descriptors missing')
        expected_names = {'raw', 'donor', 'indirect0', 'indirect1', 'rejection', 'composed',
                          'previousColour', 'previousDepth', 'previousNormal', 'previousObject', 'params'}
        if name == 'candidate':
            expected_names |= {'donorCoordinates0', 'donorCoordinates1'}
        require({str(r.get('name')).split(':')[-1] for r in resources} == expected_names,
                f'{name}: complete canonical persistent resource set required')
        for resource in resources:
            size = resource.get('estimatedBytes')
            require(type(size) is int and size > 0, f'{name}: invalid descriptor byte estimate')
            if type(size) is int:
                total += size
            if resource.get('kind') == 'texture':
                dims = (resource.get('width'), resource.get('height'), resource.get('depthOrArrayLayers'))
                bpp = FORMAT_BYTES.get(resource.get('format'))
                require(all(type(v) is int and v > 0 for v in dims) and bool(bpp)
                        and size == math.prod(dims) * (bpp or 0), f'{name}: texture estimate does not match format/extent')
                require((resource.get('width'), resource.get('height')) in ((1920, 1080), (480, 270)),
                        f'{name}: secondary quarter resolution must not weaken native core attachments')
            else:
                require(resource.get('kind') == 'buffer' and resource.get('size') == size,
                        f'{name}: buffer estimate does not match declared size')
        require(variant.get('descriptorMemoryBytes') == total == memory.get('totalEstimatedBytes'),
                f'{name}: memory sum does not match declared descriptors')
        require(memory.get('residentVramMeasured') is False and 'historyEstimatedBytes' in memory,
                f'{name}: estimate must distinguish history and actual resident VRAM')
        history_total = sum(r.get('estimatedBytes', 0) for r in resources
                            if 'previous' in str(r.get('name')) or str(r.get('name')).endswith(('indirect0', 'indirect1', 'donorCoordinates0', 'donorCoordinates1')))
        require(memory.get('historyEstimatedBytes') == history_total, f'{name}: history descriptor sum mismatch')
        if len(samples) == count and samples and all(finite(v, positive=True) for v in samples):
            stats = statistics(samples)
            for key in ('meanMs', 'p95Ms'):
                require(finite(variant.get(key)) and abs(variant[key] - stats[key]) < 1e-8,
                        f'{name}: {key} must use every raw sample without outlier removal')
    return errors


def campaign_summary(reports):
    summary = {}
    for quality in QUALITIES:
        for scene in SCENES:
            selected = [r for r in reports if r['configuration']['quality'] == quality and r['configuration']['scene'] == scene]
            if len(selected) != 3:
                continue
            variants = {name: statistics([v for r in selected for v in r['smoke']['timing']['variants'][name]['gpuMs']]) for name in VARIANTS}
            paired = [c - b for r in selected for b, c in zip(r['smoke']['timing']['variants']['baseline']['gpuMs'], r['smoke']['timing']['variants']['candidate']['gpuMs'])]
            delta = {'meanMs': sum(paired) / len(paired), 'pooledMeanPercent': 100 * (variants['candidate']['meanMs'] / variants['baseline']['meanMs'] - 1),
                     'p95DifferenceMs': variants['candidate']['p95Ms'] - variants['baseline']['p95Ms'], 'pairedSamples': len(paired)}
            summary[f'{quality}/{scene}'] = {'variants': variants, 'candidateMinusBaseline': delta,
                'memoryBytes': {name: selected[0]['smoke']['timing']['variants'][name]['descriptorMemoryBytes'] for name in VARIANTS}}
    return summary


def resolve_reports(records, base_dir, errors, label):
    resolved = []
    for index, record in enumerate(records):
        if 'reportFile' not in record:
            resolved.append(record)
            continue
        try:
            if base_dir is None:
                raise ValueError('Report reference cannot be verified without its campaign directory')
            base = Path(base_dir).resolve()
            path = (base / record['reportFile']).resolve()
            path.relative_to(base)
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != record.get('reportSha256'):
                raise ValueError('Raw report SHA-256 changed')
            report = json.loads(data)
            if report.get('runId') != record.get('runId') or report.get('configuration') != record.get('configuration'):
                raise ValueError('Raw report identity differs from campaign manifest')
            resolved.append(report)
        except (OSError, ValueError, TypeError, KeyError) as error:
            errors.append(f'{label}{index + 1}: unresolved/modified raw report: {error}')
    return resolved


def validate_campaign(payload, *, base_dir=None):
    errors = []
    if payload.get('schema') != 'steelmoth-sm603-target-campaign/v1':
        errors.append('campaign schema mismatch')
    if payload.get('targetAcceptance') is not False:
        errors.append('SSGI-only evidence must not claim whole-frame renderer/default acceptance')
    reports = resolve_reports(payload.get('runs') or [], base_dir, errors, 'run')
    if len(reports) != 18:
        errors.append('exactly18 Chrome runs: three per quality/scene are required')
    identities, closures, run_ids = set(), [], set()
    for index, report in enumerate(reports):
        errors.extend(f'run{index + 1}: {e}' for e in validate_browser(report, hardware=True, timing=True, clean=True))
        cfg = report.get('configuration') or {}
        key = (cfg.get('quality'), cfg.get('scene'), cfg.get('rotationOffset'))
        if key in identities:
            errors.append(f'duplicate quality/scene/process rotation {key}')
        identities.add(key)
        run_ids.add(report.get('runId'))
        closures.append((report.get('source') or {}).get('fileSha256'))
        if (report.get('browser') or {}).get('kind') != 'chrome':
            errors.append('timing campaign requires fresh native Chrome processes')
    if identities != {(q, s, i) for q in QUALITIES for s in SCENES for i in range(3)} or len(run_ids) != 18:
        errors.append('independent process/configuration identities incomplete')
    if closures and any(c != closures[0] for c in closures):
        errors.append('candidate source closure changed between campaign runs')
    firefox = resolve_reports(payload.get('firefoxSpotChecks') or [], base_dir, errors, 'Firefox')
    covered = set()
    for report in firefox:
        errors.extend(f'Firefox: {e}' for e in validate_browser(report, hardware=True, timing=False, clean=True))
        if (report.get('browser') or {}).get('kind') != 'firefox':
            errors.append('cross-browser spotcheck is not Firefox')
        cfg = report.get('configuration') or {}
        covered.add((cfg.get('quality'), cfg.get('scene')))
        if closures and (report.get('source') or {}).get('fileSha256') != closures[0]:
            errors.append('Firefox spotcheck differs from measured source closure')
    if ('Medium', 'representative') not in covered:
        errors.append('native Firefox Medium/representative correctness spotcheck is required')
    if not errors:
        computed = campaign_summary(reports)
        if payload.get('summary') != computed:
            errors.append('campaign summary does not equal all raw paired samples')
    return errors


def self_test():
    """Synthetic structural witnesses only; these are never measured evidence."""
    source = {'commit': 'a' * 40, 'cleanTrackedState': True, 'closureTracked': True,
              'fileSha256': {name: 'a' * 64 for name in SOURCE_FILES},
              'baselineLFNormalizedSha256': BASELINE_SHA256}
    config = {'quality': 'Medium', 'scene': 'representative', 'width': 1920, 'height': 1080,
              'pixelScale': 3, 'warmup': 300, 'samples': 600, 'rotationOffset': 0}
    variant_data = {}
    for name in VARIANTS:
        resources = []
        for key in ('raw', 'donor', 'indirect0', 'indirect1', 'rejection'):
            resources.append({'name': 'sm602:' + key, 'kind': 'texture', 'format': 'rgba16float',
                              'width': 480, 'height': 270, 'depthOrArrayLayers': 1, 'estimatedBytes': 480 * 270 * 8})
        for key, fmt in (('composed', 'rgba16float'), ('previousColour', 'rgba16float'),
                         ('previousDepth', 'rg32float'), ('previousNormal', 'rgba16float'), ('previousObject', 'r32uint')):
            resources.append({'name': 'sm602:' + key, 'kind': 'texture', 'format': fmt,
                              'width': 1920, 'height': 1080, 'depthOrArrayLayers': 1, 'estimatedBytes': 1920 * 1080 * FORMAT_BYTES[fmt]})
        if name == 'candidate':
            for index in (0, 1):
                resources.append({'name': f'sm602:donorCoordinates{index}', 'kind': 'texture', 'format': 'rgba32uint',
                                  'width': 480, 'height': 270, 'depthOrArrayLayers': 2, 'estimatedBytes': 480 * 270 * 32})
        size = 80 if name == 'baseline' else 96
        resources.append({'name': 'sm602:params', 'kind': 'buffer', 'size': size, 'estimatedBytes': size})
        total = sum(r['estimatedBytes'] for r in resources)
        history = sum(r['estimatedBytes'] for r in resources if 'previous' in r['name'] or r['name'].endswith(('indirect0', 'indirect1', 'donorCoordinates0', 'donorCoordinates1')))
        variant_data[name] = {'gpuMs': [5.] * 600, 'queueSpanGpuMs': [6.] * 600,
            'passMs': {key: [1.] * 600 for key in PASSES},
            'rawNanoseconds': [['1', '1000001', '2000001', '3000001', '4000001', '5000001', '6000001', '7000001'] for _ in range(600)],
            'commandSubmissionCounts': [1] * 600, 'historyValidSamples': 600, 'positiveDonorMax': .01,
            'settings': {'quality': 'Medium', 'enabled': True, 'pixelScale': 3, **PRESETS['Medium']},
            'descriptorMemoryBytes': total, 'memory': {'resources': resources, 'totalEstimatedBytes': total,
             'historyEstimatedBytes': history, 'residentVramMeasured': False}, 'meanMs': 5., 'p95Ms': 5.}
    captures = {name: {'width': 1, 'height': 1, 'data': [0, 0, 0, 1]} for name in CAPTURES}
    report = {'schema': 'steelmoth-sm603-browser-report/v1', 'ok': True, 'runId': 'CPU-schema-witness',
        'targetAcceptance': False, 'hardwareRequested': True, 'softwareRequested': False,
        'browserProcessExited': True, 'browser': {'kind': 'chrome', 'freshProcess': True, 'freshProfile': True,
          'version': 'CPU schema witness, not a browser measurement', 'defaultBrowserCompatibilityClaim': False},
        'source': source, 'sourceAfter': copy.deepcopy(source), 'configuration': config,
        'correctness': {'fixtureExtents': {name: [1, 1] for name in CAPTURES}, 'quality': 'Medium'},
        'gpuInventory': {'available': True, 'devices': [{'name': 'GTX 1650 SUPER', 'memoryMiB': 4096, 'driver': 'schema-only', 'pciBusId': 'schema-only'}]},
        'videoControllers': {'available': True, 'devices': [{'Name': 'GTX 1650 SUPER', 'PNPDeviceID': 'VEN_10DE&DEV_2187', 'DriverVersion': 'schema-only'}]},
        'smoke': {'schema': 'steelmoth-sm603-browser-smoke/v1', 'ok': True,
          'gpu': {'realWebGPU': True, 'isFallbackAdapter': False, 'adapterInfo': {'vendor': 'nvidia', 'architecture': 'turing'}},
          'checks': [{'name': 'CPU schema witness only', 'ok': True} for _ in range(20)],
          'configuration': {**config, 'dpr': 1, 'correctnessQuality': 'Medium'}, 'captures': captures,
          'captureMetadata': {name: {'testCase': 'CPU schema fixture', 'kind': 'indirect', 'exposure': 8} for name in CAPTURES},
          'timing': {'requested': True, 'available': True, 'extent': {'width': 1920, 'height': 1080},
            'samples': 600, 'warmup': 300, 'sampleOrder': [i % 2 for i in range(600)],
            'boundary': 'Synthetic structural complete command witness; no actual GPU execution', 'variants': variant_data}}}
    assert not validate_browser(report, hardware=True, timing=True, clean=True)
    mutants = []
    def mutate(label, callback):
        changed = copy.deepcopy(report); callback(changed); mutants.append((label, changed))
    mutate('partial samples', lambda r: r['smoke']['timing']['variants']['candidate']['gpuMs'].pop())
    mutate('queue-only timing masquerade', lambda r: r['smoke']['timing'].update(available=False))
    mutate('altered canonical tier', lambda r: r['smoke']['timing']['variants']['candidate']['settings'].update(rays=8))
    mutate('outlier/sample summary filtering', lambda r: r['smoke']['timing']['variants']['candidate'].update(meanMs=4.))
    mutate('compute/raw timestamp disagreement', lambda r: r['smoke']['timing']['variants']['candidate']['passMs']['trace'].__setitem__(0, 0.))
    mutate('incomplete command coverage', lambda r: r['smoke']['timing']['variants']['candidate']['commandSubmissionCounts'].__setitem__(0, 0))
    mutate('cold/no-hit workload', lambda r: r['smoke']['timing']['variants']['candidate'].update(positiveDonorMax=0))
    mutate('source mutated during run', lambda r: r['sourceAfter']['fileSha256'].__setitem__('engine/webgpu_ssgi.js', 'b' * 64))
    mutate('untracked executable closure', lambda r: r['source'].update(closureTracked=False))
    mutate('frozen baseline changed', lambda r: r['source'].update(baselineLFNormalizedSha256='b' * 64))
    mutate('software adapter claim', lambda r: r['smoke']['gpu'].update(isFallbackAdapter=True))
    mutate('unknown redacted adapter', lambda r: r['smoke']['gpu'].update(isFallbackAdapter=None, adapterInfo={}))
    mutate('missing capture', lambda r: r['smoke']['captures'].pop('candidate-deleted'))
    mutate('missing owned memory resource', lambda r: r['smoke']['timing']['variants']['candidate']['memory']['resources'].pop())
    mutate('nonfinite samples', lambda r: r['smoke']['timing']['variants']['candidate']['gpuMs'].__setitem__(0, float('nan')))
    mutate('whole-renderer/default claim', lambda r: r.update(targetAcceptance=True))
    mutate('incorrect process order', lambda r: r['smoke']['timing']['sampleOrder'].__setitem__(0, 1))
    mutate('unverified browser cleanup', lambda r: r.update(browserProcessExited=False))
    for label, changed in mutants:
        assert validate_browser(changed, hardware=True, timing=True, clean=True), f'Mutant escaped: {label}'
    redacted = copy.deepcopy(report); redacted['smoke']['gpu']['adapterInfo'] = {}
    assert not hardware_errors(redacted), 'Explicit nonfallback plus single native controller supports privacy-redacted Firefox'
    redacted['videoControllers']['devices'].append({'Name': 'another controller'})
    assert hardware_errors(redacted), 'Multiple controllers cannot establish the redacted adapter identity'
    assert validate_campaign({'schema': 'steelmoth-sm603-target-campaign/v1', 'targetAcceptance': False,
                              'runs': [report], 'firefoxSpotChecks': [], 'summary': {}}), 'Partial campaign must fail'
    print(json.dumps({'ok': True, 'structuralMutantsRejected': len(mutants),
                      'additionalProvenanceCases': 3, 'boundary': 'CPU schema self-test only; no browser, GPU or measured performance evidence.'}))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path, nargs='?')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if args.report is None:
        parser.error('report path or --self-test is required')
    try:
        payload = json.loads(args.report.read_text(encoding='utf-8'))
        errors = validate_campaign(payload, base_dir=args.report.parent)
    except (OSError, ValueError, TypeError, KeyError) as error:
        errors = [f'{type(error).__name__}: {error}']
    print(json.dumps({'ok': not errors, 'errors': errors, 'boundary': 'SSGI paired-pass cost/memory and correctness only; no whole-frame budget or default enablement claim.'}))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
