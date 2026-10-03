"""Independent retained-evidence audit. No browser, GPU, or repository mutation."""
from __future__ import annotations
import collections
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess

ROOT = Path(r'C:\steelmoth')
HERE = Path(__file__).resolve().parent
INPUT = HERE / 'comparison.json'
OUTPUT = HERE / 'independent-audit.json'
TABLE = HERE / 'independent-evidence-table.md'
EXPECTED_SOURCE = 'fa388aa9567dbacd2598221c644c22946834221d'
VARIANTS = ['baseline-blocking', 'counter-blocking', 'baseline-deferred', 'counter-deferred']
SHADERS = {
    'baselineTemporalSha256': '7241992d96d014e996eb826779f2f9f6b4c3360979120d7fee780502b07f00cc',
    'counterTemporalSha256': '11024a2f13f20abda1dee7cdc1a6d6703ecfc1982929ed51ccaa7b071579acf7',
    'rawHorizonSha256': 'd6bbbf28517866d9b3ca6e5de3b54847e4147f89a15df1be3ce47200d0cbae78',
    'reconstructionSha256': '7ddda64b8e31f11998ce77abb721c4b1e105e468e1e3785e28374eb0c9ef81cd',
}
FROZEN = {
    'tools/experiments/frozen_sm601_readback.js': ('dad8c46d371522c699ecbeeb1770cfc2e6a29443', 'engine/webgpu_gtao_readback.js', 'f4f82852d3bf04b5c9c665f5370f1a7f915325ff'),
    'tools/experiments/frozen_sm601_counter.js': ('ad06d9f128f7d2494e467da8d6b47de7151e606a', 'tools/sm601_gtao_counter_study.js', 'af765d115a0b8f02684c4d7a68d5549ba100a2e4'),
}
failures = []
checks = collections.Counter()

def check(condition, category, detail):
    checks[category] += 1
    if not condition:
        failures.append({'category': category, 'detail': detail})

def close(a, b):
    return math.isclose(a, b, rel_tol=1e-10, abs_tol=1e-12)

def finite(value, positive=False):
    return isinstance(value, (int, float)) and math.isfinite(value) and (value > 0 if positive else value >= 0)

def summary(values):
    ordered = sorted(values)
    def percentile(p): return ordered[max(0, math.ceil(len(ordered) * p / 100) - 1)]
    return {'count': len(values), 'meanMs': statistics.fmean(values), 'p50Ms': percentile(50),
            'p95Ms': percentile(95), 'p99Ms': percentile(99), 'minMs': ordered[0], 'maxMs': ordered[-1]}

def git_blob(commit, file):
    return subprocess.run(['git', 'show', f'{commit}:{file}'], cwd=ROOT, capture_output=True, check=True).stdout

def words_valid(words):
    return isinstance(words, list) and len(words) == 8 and all(type(v) is int and 0 <= v <= 0xffffffff for v in words) and words[6:] == [0, 0] and words[0] + words[1] == 1920 * 1080 and sum(words[2:6]) == words[1]

data = json.loads(INPUT.read_text(encoding='utf-8'))
input_hash = hashlib.sha256(INPUT.read_bytes()).hexdigest()
check(data.get('ok') is True and data.get('targetAcceptance') is False, 'report-admission', 'Diagnostic-only successful report')
check(len(data.get('runs', [])) == 3, 'report-admission', 'Exactly three sessions')
check(data['source']['commit'] == EXPECTED_SOURCE and data['source']['cleanTrackedState'] is True, 'source', 'Exact clean source identity')
source_files = {}
for file, claimed in data['source']['fileSha256'].items():
    blob = git_blob(EXPECTED_SOURCE, file)
    normalized = blob.replace(b'\r\n', b'\n')
    representations = {'git-bytes': blob, 'lf': normalized, 'crlf': normalized.replace(b'\n', b'\r\n')}
    matches = [label for label, value in representations.items() if hashlib.sha256(value).hexdigest() == claimed]
    check(bool(matches), 'source', f'File SHA-256 agrees with immutable commit content: {file}')
    source_files[file] = {'reportedSha256': claimed, 'matchedGitRepresentation': matches}
for file, (head, original, expected_blob) in FROZEN.items():
    copied = git_blob(EXPECTED_SOURCE, file).replace(b'\r\n', b'\n')
    original_bytes = git_blob(head, original).replace(b'\r\n', b'\n')
    actual_blob = hashlib.sha1(b'blob ' + str(len(copied)).encode() + b'\0' + copied).hexdigest()
    check(copied == original_bytes and actual_blob == expected_blob and data['source']['frozenGitBlobs'][file] == expected_blob,
          'source', f'Complete frozen source byte equality and blob identity: {file}')
inventory = data.get('gpuInventory', [])
check(len(inventory) == 1 and inventory[0]['name'] == 'NVIDIA GeForce GTX 1650 SUPER' and inventory[0]['memoryMiB'] == 4096 and inventory[0]['driver'] == '616.92', 'environment', 'Target inventory')

session_summaries = []
pooled = {variant: collections.defaultdict(list) for variant in VARIANTS}
version_identities = []
process_ids = []
snapshot_hashes = collections.defaultdict(list)
frame_words_across_sessions = collections.defaultdict(list)
max_direct_error = 0.0
max_command_error = 0.0
for ri, run in enumerate(data['runs']):
    tag = f'run {ri + 1}'
    cfg = run['configuration']
    check(run['ok'] is True and run['targetAcceptance'] is False, 'run-admission', tag)
    check(run.get('error') is None and all(run.get(field) == [] for field in ('uncapturedErrors', 'validationErrors', 'cleanupErrors', 'javascriptExceptions')), 'errors', tag)
    check(cfg['width'] == 1920 and cfg['height'] == 1080 and cfg['quality'] == 'Medium' and cfg['scene'] == 'dynamic-robot' and cfg['warmupFrames'] == 300 and cfg['measuredFramesPerVariant'] == 600 and cfg['runOffset'] == ri, 'run-admission', tag + ' configuration')
    adapter = run['adapter']
    check(adapter['vendor'] == 'nvidia' and adapter['architecture'] == 'turing' and adapter['isFallbackAdapter'] is False and 'timestamp-query' in adapter['deviceFeatures'] and 'timestamp-query' in adapter['adapterFeatures'], 'environment', tag + ' adapter')
    display = run['display']
    check(display['devicePixelRatio'] == 1 and display['canvasWidth'] == 1920 and display['canvasHeight'] == 1080, 'environment', tag + ' attachment extent and DPR')
    browser = run['browser']
    check(browser['freshProcess'] is True and browser['freshProfile'] is True and browser['durationSeconds'] > 0, 'environment', tag + ' fresh process/profile')
    version = browser['version']
    version_identities.append({field: version[field] for field in ('product', 'protocolVersion', 'jsVersion', 'userAgent', 'revision')})
    process_ids.append(browser['processId'])
    check(version['product'] == 'Chrome/154.0.8037.92', 'environment', tag + ' Chrome identity')
    check(not any('swiftshader' in arg.lower() or '--headless' in arg.lower() for arg in browser['command']), 'environment', tag + ' native Chrome command')
    check(run['shaderIdentity'] == SHADERS, 'source', tag + ' shader identities')
    check(run['methodology']['acceptanceTiming'] is False and run['methodology']['processRotationOffset'] == ri, 'run-admission', tag + ' diagnostic methodology')
    snapshots = run['snapshots']
    check([s['label'] for s in snapshots] == ['uninitialized', 'moving', 'room-discontinuity', 'explicit-history-reset'], 'snapshot-parity', tag + ' snapshot labels')
    for snapshot in snapshots:
        variants = snapshot['variants']
        baseline = variants[0]
        check(snapshot['allFourTexturesByteIdentical'] is True and snapshot['allEightCounterWordsExact'] is True and [v['id'] for v in variants] == VARIANTS, 'snapshot-parity', tag + ' ' + snapshot['label'])
        check(len(baseline['textureSha256']) == 4 and all(len(h) == 64 and all(c in '0123456789abcdef' for c in h) for h in baseline['textureSha256']), 'snapshot-parity', tag + ' four valid texture hashes')
        check(all(v['textureSha256'] == baseline['textureSha256'] and v['words'] == baseline['words'] and words_valid(v['words']) for v in variants), 'snapshot-parity', tag + ' matching all four texture hashes and eight words')
        if snapshot['label'] == 'moving':
            check(baseline['words'][0] > 0 and baseline['words'][1] > 0 and baseline['words'][2] + baseline['words'][3] > 0, 'snapshot-rejection', tag + ' moving reuse/disocclusion')
        else:
            check(baseline['words'][0] == 0 and baseline['words'][5] == 1920 * 1080, 'snapshot-rejection', tag + ' ' + snapshot['label'])
        snapshot_hashes[snapshot['label']].append(baseline['textureSha256'])
    rows, frames = run['rows'], run['sm500']['frames']
    check(len(rows) == 2400 and len(frames) == 2400 and run['sm500']['frameCount'] == 2400, 'sample-counts', tag)
    order_counts = {variant: [0, 0, 0, 0] for variant in VARIANTS}
    metrics = {variant: collections.defaultdict(list) for variant in VARIANTS}
    grouped = collections.defaultdict(list)
    for index, (row, frame) in enumerate(zip(rows, frames)):
        detail = f'{tag} row {index}'
        variant, logical_frame = row['variant'], row['frame']
        check(variant in VARIANTS and logical_frame == index // 4 and row['orderIndex'] == index % 4 and variant == VARIANTS[(300 + logical_frame + ri + index % 4) % 4], 'rotation', detail)
        order_counts[variant][row['orderIndex']] += 1
        grouped[logical_frame].append(row)
        check(words_valid(row['statsWords']) and row['rawStatsWords'] == row['statsWords'], 'frame-counter-parity', detail)
        check(row['submissions'] == ['rawAndUpscale', 'temporal'] and row['statsCopySeen'] is True and row['inCallback'] is False, 'command-coverage', detail)
        check(len(row['diagnosticMapLatencyCpuMs']) == 1 and finite(row['diagnosticMapLatencyCpuMs'][0]) and finite(row['directTimestampReadbackMapLatencyCpuMs']), 'host-transport', detail)
        check(all(finite(value) for value in row['encodingCpuMs'].values()) and all(finite(value) for value in row['submitApiCpuMs'].values()), 'host-transport', detail + ' CPU intervals')
        ns = row['directTimestampNanoseconds']
        check(len(ns) == 6 and all(isinstance(v, str) and v.isdecimal() and 0 <= int(v) < 2**64 for v in ns), 'direct-timestamps', detail + ' raw uint64 strings')
        ns = list(map(int, ns))
        for start, name in ((0, 'rawHorizonGpuMs'), (2, 'reconstructionGpuMs'), (4, 'temporalComputeGpuMs')):
            actual = (ns[start + 1] - ns[start]) / 1_000_000
            max_direct_error = max(max_direct_error, abs(actual - row[name]))
            check(actual > 0 and close(actual, row[name]), 'direct-timestamps', detail + ' ' + name)
            metrics[variant][name].append(actual)
        check(frame['index'] == index + 1 and frame['label'] == f'{variant}-{logical_frame}' and frame['metadata']['variant'] == variant and frame['metadata']['frame'] == 300 + logical_frame and frame['metadata']['roomId'] == row['roomId'] and frame['metadata']['orderIndex'] == row['orderIndex'], 'frame-association', detail)
        check(frame['gpuTiming']['supported'] is True and frame['gpuTiming']['readbackPending'] is False and frame['gpuTiming']['queryCount'] == 6 and frame['gpuTiming']['commandSpanCount'] == 2 and finite(frame['gpuTiming']['readbackMapLatencyMs']), 'sm500-resolved', detail)
        check(len(frame['passes']) == 1, 'command-coverage', detail + ' one pass')
        p = frame['passes'][0]
        spans = p['commandSpans']
        check(p['commandSubmissionCount'] == 2 and len(spans) == 2 and [s['metadata']['producer'] for s in spans] == ['rawAndUpscale', 'temporal'] and spans[0]['metadata']['diagnosticCopyBytes'] == 0 and spans[1]['metadata']['diagnosticCopyBytes'] == 32 and all(s['metadata']['variant'] == variant for s in spans), 'command-coverage', detail + ' explicit spans')
        command_sum = sum(s['gpuMs'] for s in spans)
        max_command_error = max(max_command_error, abs(command_sum - p['commandGpuMs']))
        check(all(finite(s['gpuMs'], positive=True) for s in spans) and close(command_sum, p['commandGpuMs']) and finite(p['queueSpanGpuMs'], positive=True) and p['gpuMs'] == p['queueSpanGpuMs'], 'sm500-accounting', detail)
        check(close(sum(w['ms'] for w in p['hostWaits']), p['hostWaitMs']) and finite(p['cpuCallbackMs']), 'host-waits', detail)
        if row['deferred']:
            check(p['hostWaitMs'] == 0 and p['hostWaits'] == [], 'host-waits', detail + ' deferred has no callback map wait')
            ring = row['readback']['ring']
            check(ring['capacity'] == 3 and ring['allocatedBytes'] == 96 and all(ring[k] == 0 for k in ('pending', 'reserved', 'retired', 'retainedResults', 'skipped', 'failed', 'stale', 'evicted')) and ring['requested'] == ring['submitted'] == ring['completed'] == 305 + logical_frame, 'bounded-readback', detail)
            check(row['statsFrame']['frameId'] == 305 + logical_frame and row['statsFrame']['roomId'] == row['roomId'] and row['readback']['statsForCurrentFrame'] is True, 'frame-association', detail + ' deferred counter attribution')
            check(finite(row['statsFlushOutsideCallbackCpuMs']) and finite(row['schedulerMapLatencyCpuMs']), 'host-transport', detail + ' deferred outside-callback drain')
        else:
            check(len(p['hostWaits']) == 1 and p['hostWaits'][0]['name'] == 'temporalStatsMapAsync' and close(p['hostWaitMs'], row['diagnosticMapLatencyCpuMs'][0]), 'host-waits', detail + ' blocking map wait')
        for name, value in {'queueSpanGpuMs': p['queueSpanGpuMs'], 'commandGpuMs': p['commandGpuMs'], 'callbackCpuMs': p['cpuCallbackMs'], 'mapLatencyCpuMs': row['diagnosticMapLatencyCpuMs'][0], 'sm500TimestampMapLatencyCpuMs': frame['gpuTiming']['readbackMapLatencyMs'], 'directTimestampMapLatencyCpuMs': row['directTimestampReadbackMapLatencyCpuMs'], 'rawAndUpscaleCommandGpuMs': spans[0]['gpuMs'], 'temporalAndCopyCommandGpuMs': spans[1]['gpuMs'], 'hostWaitCpuMs': p['hostWaitMs']}.items():
            metrics[variant][name].append(value)
    check(len(grouped) == 600 and all(len(batch) == 4 and len({r['variant'] for r in batch}) == 4 and all(r['statsWords'] == batch[0]['statsWords'] for r in batch) for batch in grouped.values()), 'frame-counter-parity', tag + ' all 600 four-way frames')
    for logical_frame, batch in grouped.items():
        frame_words_across_sessions[logical_frame].append(batch[0]['statsWords'])
        if logical_frame in (300, 301):
            check(batch[0]['statsWords'][0] == 0 and batch[0]['statsWords'][5] == 1920 * 1080, 'measured-room-rejection', tag + f' frame {logical_frame}')
    check(all(counts == [150, 150, 150, 150] for counts in order_counts.values()), 'rotation', tag + ' exact position balance')
    by_variant = {}
    for variant, variant_metrics in metrics.items():
        check(all(len(values) == 600 for values in variant_metrics.values()), 'sample-counts', tag + ' ' + variant)
        by_variant[variant] = {name: summary(values) for name, values in variant_metrics.items()}
        for name, values in variant_metrics.items(): pooled[variant][name].extend(values)
        for name, reported in run['perVariant'][variant].items():
            ours = by_variant[variant][name]
            check(reported['count'] == ours['count'] and all(close(reported[old], ours[new]) for old, new in (('mean', 'meanMs'), ('p50', 'p50Ms'), ('p95', 'p95Ms'), ('p99', 'p99Ms'), ('max', 'maxMs'))), 'reported-summary', tag + ' ' + variant + ' ' + name)
    session_summaries.append({'run': ri + 1, 'processId': browser['processId'], 'orderCounts': order_counts, 'rowCount': len(rows), 'sm500FrameCount': len(frames), 'variants': by_variant, 'display': display})
check(all(version == version_identities[0] for version in version_identities), 'environment', 'Browser identity stable across processes')
check(len(set(process_ids)) == 3, 'environment', 'Three distinct process IDs')
check(all(hashes == hashes_by_session[0] for hashes_by_session in snapshot_hashes.values() for hashes in hashes_by_session), 'snapshot-parity', 'Snapshot hashes deterministic across all sessions')
check(all(all(words == session_words[0] for words in session_words) for session_words in frame_words_across_sessions.values()), 'frame-counter-parity', 'Every logical frame counter words deterministic across sessions')
pooled_summary = {variant: {name: summary(values) for name, values in metrics.items()} for variant, metrics in pooled.items()}
def delta(a, b, metric):
    base, candidate = pooled_summary[a][metric]['meanMs'], pooled_summary[b][metric]['meanMs']
    return {'baselineMeanMs': base, 'candidateMeanMs': candidate, 'candidateMinusBaselineMs': candidate - base, 'reductionPercent': (base - candidate) / base * 100}
comparisons = {f'{a} -> {b}': {metric: delta(a, b, metric) for metric in ('queueSpanGpuMs', 'commandGpuMs', 'temporalComputeGpuMs', 'callbackCpuMs')} for a, b in [('baseline-blocking', 'counter-blocking'), ('baseline-blocking', 'baseline-deferred'), ('baseline-deferred', 'counter-deferred'), ('baseline-blocking', 'counter-deferred')]}
limitations = [
    'This audit reads only retained JSON and immutable Git objects. It does not rerun GPU/browser measurements or certify human visual acceptance.',
    'Full texture bytes are not retained in comparison.json; this audit independently checks all four retained SHA-256 identities and eight raw counter words at each snapshot. Exact byte comparison was performed by the recorded harness at capture time.',
    'Direct compute uint64 nanosecond samples are retained and independently recomputed. SM-500 raw query nanoseconds are not exported in this JSON; its explicit command sums and queue/gpuMs aliases are recomputed from retained span values.',
    'Each canvas is unscaled 1920x1080 at DPR1; desktop screen metadata is 2560x1440. The screen resolution was not changed.',
    'The four-way comparison uses shared queue/scene preparation and rotating serial variants. Deferred map initiation occurs inside the frozen scheduler; all remaining drains occur outside measured callbacks. Timestamp transport and adjacent variants can affect scheduling.',
    'This is a distinct fa388aa diagnostic source and instrumentation boundary. No earlier physical source or campaign distribution is pooled here. Same-source pooled summaries are descriptive, not acceptance distributions.',
    'A small change in explicit GPU command/temporal cost does not explain the larger callback-bound queue reduction. No command execution time is manufactured by subtracting host/CPU/readback time from queue spans.',
    'Diagnostic-only success does not complete SM-601. Selected production integration requires fresh full acceptance evidence on its own exact source and any explicitly required human visual review.',
]
audit = {'schema': 'steelmoth-sm601-native-comparison-independent-audit/v1', 'ok': not failures, 'targetAcceptance': False,
         'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'input': str(INPUT), 'inputSha256': input_hash,
         'sourceCommit': EXPECTED_SOURCE, 'sourceFileChecks': source_files, 'gpuInventory': inventory,
         'browserIdentities': version_identities, 'checkCounts': dict(checks), 'failures': failures,
         'timingRecomputation': {'maxDirectNsToMsError': max_direct_error, 'maxCommandSumError': max_command_error},
         'sessions': session_summaries, 'sameSourcePooledDescriptive': pooled_summary, 'comparisons': comparisons,
         'limitations': limitations}
if OUTPUT.exists() or TABLE.exists(): raise SystemExit('Audit output already exists; preserve prior evidence.')
OUTPUT.write_text(json.dumps(audit, indent=2) + '\n', encoding='utf-8')
lines = [f'Independent retained-evidence audit: {"PASS" if audit["ok"] else "FAIL"}. Exact diagnostic source `{EXPECTED_SOURCE}`; report SHA-256 `{input_hash}`.', '',
         'GTX 1650 SUPER 4 GiB; NVIDIA driver 616.92; Chrome 154.0.8037.92; nonfallback timestamp-query. Three fresh processes, each 300 warm-up and 600 retained samples per variant. Each run contains 2,400 rows and 2,400 SM-500 frames.', '',
         '| Variant | Queue mean / pooled p95 ms | Worst run queue p95 ms | Command mean ms | Raw mean ms | Reconstruction mean ms | Temporal mean ms | Callback mean ms | Diagnostic map mean ms |',
         '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
for variant in VARIANTS:
    p = pooled_summary[variant]
    worst = max(s['variants'][variant]['queueSpanGpuMs']['p95Ms'] for s in session_summaries)
    lines.append(f'| {variant} | {p["queueSpanGpuMs"]["meanMs"]:.6f} / {p["queueSpanGpuMs"]["p95Ms"]:.6f} | {worst:.6f} | {p["commandGpuMs"]["meanMs"]:.6f} | {p["rawHorizonGpuMs"]["meanMs"]:.6f} | {p["reconstructionGpuMs"]["meanMs"]:.6f} | {p["temporalComputeGpuMs"]["meanMs"]:.6f} | {p["callbackCpuMs"]["meanMs"]:.6f} | {p["mapLatencyCpuMs"]["meanMs"]:.6f} |')
lines += ['', 'All retained rows have exact eight-word equality across four variants at each logical frame. All four snapshot texture hashes and counter words match across variants and processes. Every variant occupies each order position exactly 150 times per process. Direct nanosecond intervals, command sums, and queue aliases recompute without error.', '',
          'Counter aggregation alone regresses native queue span. Deferred scheduling produces the main queue-span reduction. Combining counters with deferred scheduling reduces this diagnostic queue mean further, while the measured GPU command/temporal changes are small. Attribute the substantial queue effect to scheduling evidence rather than claiming an equivalent shader speedup. Production adoption remains contingent on fresh full acceptance.', '',
          'Evidence limits:', ''] + [f'- {item}' for item in limitations]
TABLE.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps({'ok': audit['ok'], 'checks': sum(checks.values()), 'failureCount': len(failures), 'audit': str(OUTPUT), 'table': str(TABLE), 'pooled': {v: {m: pooled_summary[v][m]['meanMs'] for m in ('queueSpanGpuMs', 'commandGpuMs', 'temporalComputeGpuMs')} for v in VARIANTS}, 'firstFailures': failures[:10]}, indent=2))
raise SystemExit(0 if audit['ok'] else 1)
