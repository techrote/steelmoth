"""Read-only evidence recomputation; writes only new audit artifacts beside this file."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
OUTPUT = ROOT / 'complete-candidate-evidence-audit.json'
TABLE = ROOT / 'candidate-evidence-table-draft.txt'
assert not OUTPUT.exists() and not TABLE.exists(), 'Preserve existing evidence; choose new audit output paths'


def read(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stats(values, *, signed=False):
    values = [float(value) for value in values]
    assert values and all(math.isfinite(value) and (signed or value >= 0) for value in values)
    ordered = sorted(values)
    return {'count': len(values), 'mean': sum(values) / len(values), 'median': ordered[math.ceil(.5 * len(values)) - 1],
            'p90': ordered[math.ceil(.9 * len(values)) - 1], 'p95': ordered[math.ceil(.95 * len(values)) - 1],
            'p99': ordered[math.ceil(.99 * len(values)) - 1], 'min': ordered[0], 'max': ordered[-1]}


def source_audit(payload, commit, directory):
    recorded = payload.get('sourceSha256') or payload['source']['fileSha256']
    checkout = REPO / '.campaign-worktrees' / directory
    results = {}
    for name, expected in recorded.items():
        actual = (checkout / name).read_bytes()
        canonical = subprocess.run(['git', 'show', f'{commit}:{name}'], cwd=REPO,
                                   check=True, capture_output=True).stdout
        assert digest(actual) == expected, f'{directory}/{name}: retained byte hash differs from source checkout'
        assert actual.replace(b'\r\n', b'\n') == canonical.replace(b'\r\n', b'\n'), f'{name}: code differs from source commit'
        results[name] = {'sha256': expected, 'recordedBytesMatchCheckout': True,
                         'checkoutContentMatchesGitCommitIgnoringWindowsLineEndings': True}
    return {'commit': commit, 'currentCheckoutHead': subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=checkout,
                check=True, capture_output=True, text=True).stdout.strip(), 'allRecordedFileHashesVerified': True,
            'lineEndingBoundary': 'Raw retained SHA-256 is verified against exact Windows checkout bytes; canonical content is also verified against Git, allowing LF/CRLF conversion only.',
            'files': results}


def browser_adapter_checks(run, *, main=False):
    assert run['ok'] is True and not run.get('javascriptExceptions') and not run.get('uncapturedErrors')
    assert run['adapter']['isFallbackAdapter'] is False
    assert run['adapter']['vendor'] == 'nvidia' and run['adapter']['architecture'] == 'turing'
    features = run['adapter']['deviceFeatures'] if main else run['adapter']['features']
    assert 'timestamp-query' in features
    version = run['browser']['version'] if main else run['browserVersion']
    assert version['product'] == 'Chrome/154.0.8037.92'
    return tuple(version[key] for key in ('product', 'protocolVersion', 'jsVersion', 'userAgent'))


readback = read('pr105-fixture-cache-d943827/readback-study.json')
counter = read('pr104-startup-ae0bd3f/counter-study.json')
main = read('main-final-decomposition/diagnostic.json')
assert all(p['ok'] and p['targetAcceptance'] is False and len(p['runs']) == 3 for p in (readback, counter, main))
summary = {'schema': 'steelmoth-physical-candidate-evidence-audit/v1', 'ok': True,
           'createdAtUtc': dt.datetime.now(dt.timezone.utc).isoformat(), 'targetAcceptance': False,
           'aggregationPolicy': 'Each complete source is aggregated separately. No failed/partial or other-head samples are pooled.',
           'quantiles': 'Nearest rank: sorted sample at ceil(fraction * n) - 1; no filtering or outlier deletion.',
           'environment': read('environment.json'), 'datasets': {}, 'excludedEvidence': []}

variants = {name: [] for name in ('blocking', 'deferred')}
rb_runs = []
rb_versions = []
for number, run in enumerate(readback['runs'], 1):
    rb_versions.append(browser_adapter_checks(run))
    assert len(run['cases']) == 56 and all(c['allFourOutputsByteIdentical'] and c['allEightCounterWordsExact'] for c in run['cases'])
    assert max(c['maxReferenceError'] for c in run['cases']) <= 2e-6
    assert run['saturation'] == {'submittedFrames': 6, 'retainedCopies': 2, 'skippedCopies': 4,
        'allFourOutputsByteIdentical': True, 'delayedDeliveryFaultInjection': True, 'resizeClearsStats': True}
    timing = run['timing']
    assert (timing['width'], timing['height'], timing['warmup'], timing['samples']) == (1920, 1080, 300, 600)
    assert len(timing['rows']) == 1200 and timing['progress']['completedVariantIterations'] == 1800
    assert timing['progress']['warmupFramePairsCompleted'] == 300 and timing['progress']['measuredFramePairsCompleted'] == 600
    assert timing['fixtureCache']['stateCount'] == 5 and timing['fixtureCache']['typedArrayBytes'] == 414720000
    fields = ('rawGpuMs', 'upscaleGpuMs', 'temporalGpuMs', 'instrumentedQueueSpanMs', 'callbackCpuMs', 'mapLatencyCpuMs')
    for index, row in enumerate(timing['rows']):
        assert row['frame'] == index // 2
        order = ('deferred', 'blocking') if row['frame'] % 2 else ('blocking', 'deferred')
        assert row['variant'] == order[index % 2]
        assert all(math.isfinite(row[field]) and row[field] > 0 for field in fields[:4])
        assert all(math.isfinite(row[field]) and row[field] >= 0 for field in fields[4:])
        variants[row['variant']].append(row)
    rb_runs.append({'run': number, 'cases': 56, 'allFourOutputsByteIdentical': True, 'allEightCounterWordsExact': True,
        'saturationPassed': True, 'variants': {variant: {field: stats([row[field] for row in timing['rows'] if row['variant'] == variant])
            for field in fields} for variant in variants}})
assert len(set(rb_versions)) == 1
rb_pooled = {variant: {field: stats([row[field] for row in rows]) for field in fields} for variant, rows in variants.items()}
queue_delta = rb_pooled['blocking']['instrumentedQueueSpanMs']['mean'] - rb_pooled['deferred']['instrumentedQueueSpanMs']['mean']
rb_commit = 'd943827f87598ef4990437b333d3d3e62db1b4ad'
summary['datasets']['deferredReadbackStudy'] = {'report': 'pr105-fixture-cache-d943827/readback-study.json',
    'source': source_audit(readback, rb_commit, 'pr105-fixture-cache'),
    'frozenStudyHead': 'dad8c46d371522c699ecbeeb1770cfc2e6a29443',
    'overlay': 'Five cached byte-identical fixture states; timing/shader core and four GPU uploads preserved. CPU scheduling differs from frozen study.',
    'browserIdentity': dict(zip(('product', 'protocolVersion', 'jsVersion', 'userAgent'), rb_versions[0])),
    'commandGpuMs': None, 'commandCoverage': 'Unavailable: three compute-pass times are not complete explicit submission command coverage.',
    'runs': rb_runs, 'pooledWithinThisSource': rb_pooled, 'queueSpanMeanGainMs': queue_delta,
    'timingBoundary': 'Headless isolated synthetic dense-format workload; GPU queue span, separate compute-pass intervals and CPU/map wall times.',
    'metadataLimitations': ['Actual DPR, process IDs and wall start times are not recorded in individual study reports; fresh processes follow pinned runner code.',
        'GPU exact name/driver/OS are supplied by shared environment sidecar and sole-adapter inventory; opaque WebGPU info identifies NVIDIA/Turing/nonfallback.'],
    'disposition': 'Independent queue-latency benefit demonstrated. Requires native workload and combination measurements before production adoption.'}

counter_fields = ('baselineKernelMs', 'candidateKernelMs')
co_pooled = {field: [] for field in counter_fields}
co_runs = []
co_versions = []
for number, run in enumerate(counter['runs'], 1):
    co_versions.append(browser_adapter_checks(run))
    assert len(run['cases']) == 56 and all(c['allFourOutputsByteIdentical'] and c['allEightCounterWordsExact'] for c in run['cases'])
    assert all(c['repeats'] == 2 and c['maxReferenceError'] <= 2e-6 for c in run['cases'])
    assert all(not c['messages'] for c in run['compilation'])
    timing = run['microbenchmark']
    assert (timing['width'], timing['height'], timing['warmup'], timing['samples']) == (1920, 1080, 300, 600)
    assert timing['alternatingOrder'] is True and timing['pattern'] == 'mixed'
    for field in counter_fields:
        assert len(timing[field]) == 600 and all(math.isfinite(v) and v > 0 for v in timing[field])
        co_pooled[field].extend(timing[field])
    co_runs.append({'run': number, 'cases': 56, 'repeatsPerCase': 2, 'exactFourOutputEightWordCounterEquivalence': True,
                    'metrics': {field: stats(timing[field]) for field in counter_fields},
                    'pairedBaselineMinusCandidateMs': stats([a-b for a, b in zip(timing[counter_fields[0]], timing[counter_fields[1]])], signed=True)})
assert len(set(co_versions)) == 1
co_metrics = {field: stats(values) for field, values in co_pooled.items()}
co_delta = co_metrics[counter_fields[0]]['mean'] - co_metrics[counter_fields[1]]['mean']
summary['datasets']['counterAggregationStudy'] = {'report': 'pr104-startup-ae0bd3f/counter-study.json',
    'source': source_audit(counter, 'ae0bd3fd07ebee1b469395c9822823c76d202b2f', 'pr104-startup'),
    'frozenStudyHead': 'ad06d9f128f7d2494e467da8d6b47de7151e606a',
    'overlay': 'Startup-only Windows port-file/endpoint readiness repair; shaders/probe/benchmark loop unchanged.',
    'browserIdentity': dict(zip(('product', 'protocolVersion', 'jsVersion', 'userAgent'), co_versions[0])),
    'baselineWgslSha256': counter['runs'][0]['baselineSha256'], 'candidateWgslSha256': counter['runs'][0]['candidateSha256'],
    'queueSpanGpuMs': None, 'commandGpuMs': None,
    'timingBoundary': 'Headless isolated temporal compute-pass start/end only; raw/reconstruction/readback gaps excluded.',
    'runs': co_runs, 'pooledWithinThisSource': co_metrics, 'kernelMeanGainMs': co_delta,
    'kernelMeanGainPercent': co_delta / co_metrics[counter_fields[0]]['mean'] * 100,
    'metadataLimitations': ['Runner report lacks explicit Git SHA, clean-state, wall start and DPR fields. Audit verifies pinned file hashes against the ae0bd3f checkout/commit; environment is shared sidecar.'],
    'disposition': 'Small independent temporal-kernel gain. Atomic count reduction is not the speedup claim; native/combined measurements still required.'}

main_fields = ('queueSpanGpuMs', 'commandGpuMs', 'cpuCallbackMs', 'hostWaitMs')
direct_fields = ('rawHorizonGpuMs', 'reconstructionGpuMs', 'temporalComputeGpuMs', 'diagnosticCopyInstrumentedGpuMs',
                 'directTimestampReadbackMapLatencyCpuMs')
ma_pooled = {field: [] for field in main_fields + direct_fields + ('timestampReadbackMapLatencyMs', 'diagnosticMapLatencyCpuMs',
                   'rawEncodingCpuMs', 'temporalEncodingCpuMs', 'rawSubmitApiCpuMs', 'temporalSubmitApiCpuMs', 'scenePrepCpuMs')}
ma_runs = []
ma_versions = []
pids = []
for number, run in enumerate(main['runs'], 1):
    ma_versions.append(browser_adapter_checks(run, main=True))
    assert not run['error'] and not run['validationErrors'] and not run['cleanupErrors']
    assert run['coverage']['completeGtaoCommandBufferSubmissions'] is True
    assert run['coverage']['explicitSubmissionsPerFrame'] == 2 and run['coverage']['directComputePassesPerFrame'] == 3
    assert run['coverage']['diagnosticCopyBytes'] == 32 and run['coverage']['diagnosticMapCallsPerFrame'] == 1
    assert run['configuration']['warmupFrames'] == 300 and run['configuration']['measuredFrames'] == 600
    assert run['configuration']['quality'] == 'Medium'
    assert (run['display']['canvasWidth'], run['display']['canvasHeight'], run['display']['devicePixelRatio']) == (1920, 1080, 1)
    assert run['browser']['freshProcess'] and run['browser']['freshProfile']
    assert run['validation']['historyRejectionObserved'] and run['validation']['humanVisualAcceptance'] is False
    pids.append(run['browser']['processId'])
    rows, frames = run['rows'], run['sm500']['frames']
    assert len(rows) == len(frames) == 600
    local = {field: [] for field in ma_pooled}
    for index, (row, frame) in enumerate(zip(rows, frames)):
        assert row['frame'] == index and frame['metadata']['frame'] == 300 + index
        assert row['submissions'] == ['rawAndUpscale', 'temporal'] and row['statsCopySeen']
        assert len(row['diagnosticMapLatencyCpuMs']) == 1
        words = row['stats']
        assert words['accepted'] + words['rejected'] == 1920 * 1080
        assert sum(words[name] for name in ('depthRejected', 'objectRejected', 'normalRejected', 'globalRejected')) == words['rejected']
        timestamps = list(map(int, row['directTimestampNanoseconds']))
        for pair, field in enumerate(direct_fields[:4]):
            assert timestamps[pair*2+1] >= timestamps[pair*2]
            assert abs((timestamps[pair*2+1]-timestamps[pair*2])/1e6 - row[field]) < 1e-12
        passage = frame['passes'][0]
        assert passage['gpuMs'] == passage['queueSpanGpuMs']
        assert passage['commandSubmissionCount'] == len(passage['commandSpans']) == 2
        assert abs(sum(span['gpuMs'] for span in passage['commandSpans']) - passage['commandGpuMs']) < 1e-12
        assert all(span['gpuAvailable'] and span['gpuMs'] > 0 for span in passage['commandSpans'])
        assert frame['gpuTiming']['readbackPending'] is False
        assert frame['workload']['gtaoDirections'] == 6 and frame['workload']['gtaoSteps'] == 4
        assert passage['hostWaits'][0]['name'] == 'temporalStatsMapAsync'
        assert passage['hostWaitMs'] == row['diagnosticMapLatencyCpuMs'][0]
        for field in main_fields: local[field].append(passage[field])
        for field in direct_fields: local[field].append(row[field])
        local['timestampReadbackMapLatencyMs'].append(frame['gpuTiming']['readbackMapLatencyMs'])
        local['diagnosticMapLatencyCpuMs'].append(row['diagnosticMapLatencyCpuMs'][0])
        local['scenePrepCpuMs'].append(frame['cpu']['scenePrepMs'])
        for producer, field in (('rawAndUpscale', 'rawEncodingCpuMs'), ('temporal', 'temporalEncodingCpuMs')):
            local[field].append(row['encodingCpuMs'][producer])
        for producer, field in (('rawAndUpscale', 'rawSubmitApiCpuMs'), ('temporal', 'temporalSubmitApiCpuMs')):
            local[field].append(row['submitApiCpuMs'][producer])
    metrics = {field: stats(values) for field, values in local.items()}
    for field, group in (('queueSpanGpuMs', 'gpuPassQueueSpans'), ('commandGpuMs', 'gpuPassCommandSpans'), ('hostWaitMs', 'passHostWaits')):
        exported = run['sm500']['summary'][group]['gtao']
        assert exported['count'] == 600 and abs(exported['meanMs'] - metrics[field]['mean']) < 1e-10
        assert exported['p95Ms'] == metrics[field]['p95']
    for field, values in local.items(): ma_pooled[field].extend(values)
    ma_runs.append({'run': number, 'processId': pids[-1], 'metrics': metrics, 'directNanosecondsRecomputed': True,
                    'twoExplicitCommandSpansVerifiedPerFrame': True, 'errorListsEmpty': True})
assert len(set(ma_versions)) == 1 and len(set(pids)) == 3
summary['datasets']['hardenedNativeBaselineDecomposition'] = {'report': 'main-final-decomposition/diagnostic.json',
    'source': source_audit(main, main['source']['commit'], 'main-6cb332e'), 'cleanTrackedStateAtRun': main['source']['cleanTrackedState'],
    'browserIdentity': dict(zip(('product', 'protocolVersion', 'jsVersion', 'userAgent'), ma_versions[0])),
    'gpuInventory': main['gpuInventory'], 'runs': ma_runs, 'pooledWithinThisSource': {field: stats(values) for field, values in ma_pooled.items()},
    'commandCoverage': 'Complete for two explicit GTAO update command-buffer submissions per frame, with marker/copy observer overhead; queue writes are not inferred as command execution.',
    'queueBoundary': 'Historical-compatible callback span with added diagnostic observer work.',
    'hostBoundary': 'CPU callback/encoding/submit and known map wait are measured wall times. None is subtracted from queue timestamps.',
    'limitation': 'Diagnostics-only native moving-scene localization, not full visual acceptance. Renderer memory fields are zero because owners are not registered with this diagnostic instrumentation; do not interpret them as zero VRAM.'}

old105 = read('pr105-dad8c46/timeout-progress.json')['progress']['result']['value']
old104 = read('pr104-ad06d9f/counter-study.json')
oldmain = read('main-0618a5e-decomposition/diagnostic.json')
badmain = read('main-d69faf9-decomposition/diagnostic.json')
assert len(old105['timing']['rows']) == 658 and len(old104['runs']) == 1
assert [r['ok'] for r in oldmain['runs']] == [True, True, False]
assert all(frame['passes'][0]['queueSpanGpuMs'] == frame['passes'][0]['commandGpuMs'] == 0
           for frame in badmain['runs'][0]['sm500']['frames'])
summary['excludedEvidence'] = [
    {'source': 'dad8c46d371522c699ecbeeb1770cfc2e6a29443', 'report': 'pr105-dad8c46/timeout-progress.json',
     'reason': '1800-second deadline; 329 paired samples per variant, not 600; no complete fresh run. Exact 56-case output/counter correctness and saturation passed. Different CPU preparation/power context; not pooled with cache overlay.'},
    {'source': 'ad06d9f128f7d2494e467da8d6b47de7151e606a', 'report': 'pr104-ad06d9f/counter-study.json',
     'reason': 'One complete 600-sample run, then Windows startup PermissionError; not a complete three-process campaign. Original run retained separately.'},
    {'source': '0618a5ef5d97a3087361f04153ba436762add437', 'report': 'main-0618a5e-decomposition/diagnostic.json',
     'reason': 'Two complete 600-frame runs; third startup PermissionError. Old top-level browser-version-change error misclassified absent startup metadata; no actual browser change demonstrated. Not pooled with final source.'},
    {'source': 'd69faf9bad7b70ec6d0ecadcc086dfc06412d140', 'report': 'main-d69faf9-decomposition/diagnostic.json',
     'reason': 'All 600 instrumented queue/command spans zero and report fails invalid/unresolved SM500 frame. Invalid API/query readback attempt excluded from performance evidence.'}]

arithmetic = read('pr106-1813085/dense-study.json')
witness = read('pr106-neutral-witness/neutral-witness.json')['runs'][0]
assert arithmetic['ok'] is False and 'microbenchmark' not in arithmetic['runs'][0]
assert witness['exactOutputEqualityPassed'] and witness['failureValidationScope']['error'] is None
planes = witness['failureWitness']['variants']
for field in ('raw', 'visibility', 'debug'):
    values = [bytes(item[field]['bytes']) for item in planes]
    assert all(value == values[0] for value in values)
    assert all(digest(value) == item[field]['sha256'] for value, item in zip(values, planes))
summary['datasets']['arithmeticStudyBlocked'] = {'source': '1813085f158a24d52365b0ee5011dc32c0251c90',
    'witnessSource': '5425c9b939791451fb4a6cb6f45db52cafc6473f',
    'sourceHashAudit': source_audit(arithmetic, '1813085f158a24d52365b0ee5011dc32c0251c90', 'pr106-1813085'),
    'report': 'pr106-1813085/dense-study.json', 'witnessReport': 'pr106-neutral-witness/neutral-witness.json',
    'performanceSamples': 0, 'completedCorrectnessCasesBeforeFailure': 18, 'candidateDivergence': False,
    'error': 'Exact neutral fixture assertion fails at 3x5 plane: baseline and all three candidates produce identical visibility/debug 0x3f7fffff at pixel (0,1), one float32 ULP below required 1 (0x3f800000).',
    'neutralWitnessAllThreePlanesByteEqualityIndependentlyVerified': True,
    'disposition': 'Blocked before timing; dense/sparse/empty physical controls unavailable. This is not the obsolete CPU/WGSL fallback cutoff mismatch repaired by #107; no tolerance weakening or adoption is justified.'}
summary['clockContext'] = {'source': 'Campaign operator observations reported in task instructions; no retained continuous telemetry file supplied to this audit.',
    'readbackCacheOverlay': {'powerState': 'P3', 'observedGraphicsClockMHz': 945, 'observedMemoryClockMHz': 5000},
    'frozenReadbackAttempt': {'powerState': 'P8', 'longCpuFixturePreparation': True},
    'evidenceBoundary': 'Context only. No power/clock normalization, extrapolated GPU performance or correction factors applied.'}

OUTPUT.write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
ma = summary['datasets']['hardenedNativeBaselineDecomposition']['pooledWithinThisSource']
text = f'''Physical performance candidate evidence draft (independent source-aware audit)

Environment: sole Windows NVIDIA GeForce GTX 1650 SUPER 4096 MiB, driver 616.92,
PCI device 0x218710DE / bus 00000000:07:00.0; Chrome 154.0.8037.92.
All completed reports use NVIDIA/Turing, nonfallback, timestamp-query and
1920x1080 GPU textures. Main diagnostic records DPR1 and native canvas extent;
desktop is separately recorded as2560x1440. Headless studies are localization.

Dataset/source                  Boundary                  Mean ms   p95 ms
Native baseline0c1c707           queue span                {ma['queueSpanGpuMs']['mean']:.6f}  {ma['queueSpanGpuMs']['p95']:.6f}
Native baseline0c1c707           complete command span     {ma['commandGpuMs']['mean']:.6f}  {ma['commandGpuMs']['p95']:.6f}
Native baseline0c1c707           raw horizon compute       {ma['rawHorizonGpuMs']['mean']:.6f}  {ma['rawHorizonGpuMs']['p95']:.6f}
Native baseline0c1c707           reconstruction compute    {ma['reconstructionGpuMs']['mean']:.6f}  {ma['reconstructionGpuMs']['p95']:.6f}
Native baseline0c1c707           temporal compute          {ma['temporalComputeGpuMs']['mean']:.6f}  {ma['temporalComputeGpuMs']['p95']:.6f}
105cached943827blocking          isolated queue span       {rb_pooled['blocking']['instrumentedQueueSpanMs']['mean']:.6f}  {rb_pooled['blocking']['instrumentedQueueSpanMs']['p95']:.6f}
105cached943827deferred          isolated queue span       {rb_pooled['deferred']['instrumentedQueueSpanMs']['mean']:.6f}  {rb_pooled['deferred']['instrumentedQueueSpanMs']['p95']:.6f}
104startupae0bd3fbaseline         temporal kernel only      {co_metrics['baselineKernelMs']['mean']:.6f}  {co_metrics['baselineKernelMs']['p95']:.6f}
104startupae0bd3fcandidate        temporal kernel only      {co_metrics['candidateKernelMs']['mean']:.6f}  {co_metrics['candidateKernelMs']['p95']:.6f}
106frozen1813085allvariants       BLOCKED: no timing        unavailable

Each complete dataset has3fresh processes,300warm-up+600retained samples/run.
Table distributions pool only those3runs of that exact source (1800samples).
105and104commandGpuMs are unavailable, not inferred by summing kernel timings.
105GPU raw/reconstruction/temporal means are separately retained in auditJSON.

Independent results:105queue gain{queue_delta:.6f}ms;104kernel gain{co_delta:.6f}ms
({co_delta/co_metrics['baselineKernelMs']['mean']*100:.3f}%). These synthetic studies
do not establish native-game adoption or additive gains. Native four-way testing
and exact output/counter checks are required before choosing a production patch.

Native host diagnostics (CPU wall ms): callback{ma['cpuCallbackMs']['mean']:.6f},
known stats-map wait{ma['hostWaitMs']['mean']:.6f}, timestamp-map transport
{ma['timestampReadbackMapLatencyMs']['mean']:.6f}. GPU raw/reconstruction/temporal
costs are directly timestamped; complete command span is explicitly measured.
No CPU/wait/map value is subtracted from a queue timestamp. The1.100543ms
command result does not erase the real3.067721ms queue-latency result.

All105reports pass56cases of four-texture/eight-counter-word exact parity plus
bounded-slot saturation. All104reports pass56cases×2repeats exact parity.
Main has1800valid direct readback/two-command-span frames,3distinct processIDs,
empty API/error lists and observed history rejection; human visual acceptance
remains false. Raw byte SHA-256 and canonical Git content checks pass for every
recorded source file. Study metadata gaps and full per-run statistics are inJSON.

106neutral witness: baseline and candidates all match byte-for-byte, including
0x3f7fffff rather than required exact1at a3x5plane pixel. No candidate divergence
was found. Preserve strict control failure; dense/sparse/empty timings blocked.
This failure is separate from the historical reconstruction-cutoff mismatch.

Preserved but excluded from complete distributions: original105dad8c46timeout
(329samples/variant), original104ad06d9fone complete run then startupfailure,
main0618a5etwo complete runs then startupfailure, maind69faf9zero/invalid query
readbacks. Never pool them with repaired-source runs. Full source SHAs are inJSON.

Clock context: operator observed105cache runP3graphics945MHz/memory5000MHz,
versus original105P8with long CPU fixture preparation. This is context only;
no clock normalization, GPU performance fudge or cross-source speedup is claimed.

Evidence status: localization and independent A/B complete for105/104;
106blocked; no production adoption/full SM601 acceptance established by this draft.
'''
TABLE.write_text(text, encoding='utf-8')
print(json.dumps({'ok': True, 'json': str(OUTPUT), 'tableDraft': str(TABLE), 'mainFrames': 1800,
                  'readbackSamplesPerVariant': 1800, 'counterSamplesPerVariant': 1800,
                  'readbackQueueGainMs': queue_delta, 'counterKernelGainMs': co_delta}))
