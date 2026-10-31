#!/usr/bin/env python3
"""Reproduce SM-505 post diagnosis from immutable capture files; never runs a GPU."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 'steelmoth-sm505-offline-capture-analysis/v1'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def manifest_check(capture: Path) -> dict:
    manifest = capture / 'SHA256SUMS.txt'
    raw = manifest.read_bytes()
    verified = {}
    for line in raw.decode('utf-8').splitlines():
        match = re.fullmatch(r'([0-9a-fA-F]{64})  (.+)', line)
        if not match:
            raise ValueError('malformed original SHA256SUMS entry')
        expected, name = match.groups()
        target = (capture / name).resolve()
        if not target.is_relative_to(capture) or target == manifest or name in verified:
            raise ValueError(f'invalid or duplicate manifest path: {name}')
        actual = sha(target.read_bytes())
        if actual != expected.lower():
            raise ValueError(f'original manifest mismatch: {name}')
        verified[name] = actual
    for required in ['report.json', 'object-id.bin', 'pre-postprocessing.bin', 'final-postprocessed.bin', 'raw-display.bin']:
        if required not in verified:
            raise ValueError(f'original manifest omits required input: {required}')
    return {'manifestSha256': sha(raw), 'verifiedFileCount': len(verified), 'allOriginalHashesMatch': True, 'files': verified}


def lf(data: bytes) -> bytes:
    return data.replace(b'\r\n', b'\n')


def verify_post_source(source_root: Path, report: dict, allow_lf: bool) -> dict:
    commit = report['source']['commit']
    if not re.fullmatch(r'[0-9a-fA-F]{40}', commit or ''):
        raise ValueError('capture must record a full Git commit SHA')
    relative = 'engine/webgpu_post.js'
    module = source_root / relative
    worktree = module.read_bytes()
    result = subprocess.run(['git', '-C', str(source_root), 'show', f'{commit}:{relative}'], check=True, capture_output=True, timeout=30)
    blob = result.stdout
    expected = report['source']['fileSha256'][relative]
    raw_capture_match = sha(worktree) == expected
    raw_git_match = worktree == blob
    normalized = lf(worktree) == lf(blob)
    captured_variants = {sha(blob), sha(lf(blob)), sha(lf(blob).replace(b'\n', b'\r\n'))}
    if not (raw_capture_match and raw_git_match):
        if not allow_lf or not normalized or expected not in captured_variants:
            raise ValueError('post source differs from captured source/Git bytes; source-only LF normalization requires --allow-source-lf-normalization and an exact LF-normalized match')
    return {'modulePath': str(module), 'capturedCommit': commit, 'capturedSourceSha256': expected, 'worktreeBytesSha256': sha(worktree), 'gitBlobBytesSha256': sha(blob), 'exactCapturedSourceMatch': raw_capture_match, 'exactGitBlobMatch': raw_git_match, 'lfNormalizationExplicitlyAllowed': allow_lf, 'lfNormalizedGitMatch': normalized, 'sourceOnlyNormalizationUsed': not (raw_capture_match and raw_git_match), 'boundary': 'LF normalization applies only to source verification. Native .bin/report hashes remain original byte hashes.'}


def read_capture(capture: Path, metadata: dict, dtype: str, channels: int) -> np.ndarray:
    width, height, row_bytes = (metadata[k] for k in ['width', 'height', 'rowBytes'])
    if any(type(v) is not int or v <= 0 for v in [width, height, row_bytes]) or width * height > 100_000_000:
        raise ValueError('invalid or excessive capture extent/stride')
    item_size = np.dtype(dtype).itemsize
    if row_bytes < width * channels * item_size:
        raise ValueError('capture row stride is smaller than pixel data')
    raw = (capture / (metadata['name'] + '.bin')).read_bytes()
    if len(raw) != row_bytes * height:
        raise ValueError(f'capture byte length differs from recorded stride: {metadata["name"]}')
    rows = np.frombuffer(raw, dtype=np.uint8).reshape(height, row_bytes)
    return rows[:, :width * channels * item_size].copy().view(dtype).reshape(height, width, channels)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture-dir', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True, help='New analysis JSON; existing outputs are never replaced')
    parser.add_argument('--source-root', type=Path, default=ROOT)
    parser.add_argument('--allow-source-lf-normalization', action='store_true')
    args = parser.parse_args()
    capture, destination, source_root = args.capture_dir.resolve(), args.out.resolve(), args.source_root.resolve()
    try:
        if destination.exists():
            raise ValueError('analysis output already exists; refusing overwrite')
        if destination.is_relative_to(capture):
            raise ValueError('analysis output must be outside the original capture directory')
        original = manifest_check(capture)
        report_bytes = (capture / 'report.json').read_bytes()
        report = json.loads(report_bytes)
        source = verify_post_source(source_root, report, args.allow_source_lf_normalization)
        metadata = report['stages']['captures']
        entries = {m['name']: m for m in metadata}
        if len(entries) != len(metadata):
            raise ValueError('duplicate capture metadata names')
        required = {'object-id': ('r32uint', '<u4', 1), 'pre-postprocessing': ('rgba16float', '<f2', 4), 'final-postprocessed': ('rgba8unorm', 'u1', 4), 'raw-display': ('rgba8unorm', 'u1', 4)}
        arrays = {}
        extent = None
        for name, (format_name, dtype, channels) in required.items():
            meta = entries[name]
            if meta['format'] != format_name:
                raise ValueError(f'unsupported capture format for {name}')
            current = [meta['width'], meta['height']]
            if extent is not None and extent != current:
                raise ValueError('required capture extents differ')
            extent = current
            arrays[name] = read_capture(capture, meta, dtype, channels)
        pre = arrays['pre-postprocessing'][:, :, :3].astype(np.float64)
        if not np.isfinite(pre).all() or np.any(pre < 0):
            raise ValueError('zero-bloom replay requires finite nonnegative pre-post RGB')
        maximum = float(np.max(pre @ np.array([.2126, .7152, .0722])))
        mask = arrays['object-id'][:, :, 0] != 0
        indices = np.flatnonzero(mask.ravel())
        scene = report['stages']['scene']
        helper = Path(__file__).with_name('sm505_replay_post.js')
        helper_hash = sha(helper.read_bytes())
        payload = {'schema': 'steelmoth-sm505-post-replay-input/v1', 'modulePath': source['modulePath'], 'extent': extent, 'settings': scene['settings'], 'grade': scene['post']['grade'], 'maximumPrePostLuminance': maximum, 'pixelIndices': indices.tolist(), 'linearRGB': pre.reshape(-1, 3)[indices].ravel().tolist(), 'finalBytes': arrays['final-postprocessed'][:, :, :3].reshape(-1, 3)[indices].ravel().tolist(), 'rawBytes': arrays['raw-display'][:, :, :3].reshape(-1, 3)[indices].ravel().tolist()}
        replay = subprocess.run(['node', str(helper)], input=json.dumps(payload, allow_nan=False), capture_output=True, text=True, timeout=120, check=True)
        result = json.loads(replay.stdout)
        if sha(Path(source['modulePath']).read_bytes()) != source['worktreeBytesSha256'] or sha(helper.read_bytes()) != helper_hash:
            raise ValueError('CPU replay source/helper changed during analysis')
        # Verify originals again before delivering an analysis tied to their hashes.
        if manifest_check(capture) != original:
            raise ValueError('original evidence changed during CPU replay')
        analysis = {'schema': SCHEMA, 'status': result['status'], 'physicalAcceptance': False, 'visualAcceptance': False, 'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'captureDirectory': str(capture), 'inputReportSha256': sha(report_bytes), 'sourceCommit': report['source']['commit'], 'originalManifestVerification': original, 'postSourceVerification': source, 'observer': {'pythonSha256': sha(Path(__file__).read_bytes()), 'nodeHelperSha256': helper_hash, 'nodeCommand': ['node', str(helper)], 'pythonVersion': sys.version, 'numpyVersion': np.__version__}, 'postReplay': result, 'boundary': 'CPU-only replay of one source-separated captured frame. No browser/GPU execution, sample pooling, temporal/performance claim or visual acceptance. Equation agreement can reproduce a known visual failure.'}
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('x', encoding='utf-8') as stream:
            json.dump(analysis, stream, indent=2, allow_nan=False)
            stream.write('\n')
        print(json.dumps({'status': result['status'], 'analysis': str(destination), 'analysisSha256': sha(destination.read_bytes()), 'physicalAcceptance': False, 'visualAcceptance': False, 'count': result.get('count'), 'actualBlack': result.get('actualBlack'), 'withinOneOutputCodePixelFraction': result.get('withinOneOutputCodePixelFraction')}))
        return 0 if result['status'] == 'ANALYZED' else 2
    except (ValueError, KeyError, OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        detail = error.stderr if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(f'SM-505 CPU ANALYSIS FAILED: {detail}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
