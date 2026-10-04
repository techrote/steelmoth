#!/usr/bin/env python3
"""Serialize three fresh paired Chrome processes per SM-603 quality/scene."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from validate_sm603_ssgi_browser import ROOT, source_identity
from validate_sm603_target_report import (QUALITIES, SCENES, campaign_summary,
                                        validate_browser, validate_campaign)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=Path('artifacts/sm603-target'))
    parser.add_argument('--browser', help='Explicit installed Chrome executable')
    parser.add_argument('--firefox', action='store_true', help='Also execute the required native Medium/representative Firefox correctness spotcheck')
    parser.add_argument('--firefox-browser')
    parser.add_argument('--geckodriver')
    parser.add_argument('--firefox-webgpu-override', action='store_true')
    parser.add_argument('--firefox-windowed', action='store_true')
    parser.add_argument('--warmup', type=int, default=300)
    parser.add_argument('--samples', type=int, default=600)
    parser.add_argument('--timeout', type=float, default=600)
    parser.add_argument('--resume', action='store_true', help='Reuse only complete passing same-commit/source/config reports; never discard failed or partial samples')
    parser.add_argument('--plan', action='store_true', help='Print exact commands without launching browsers or writing evidence')
    args = parser.parse_args()
    if args.warmup < 300 or args.samples < 600 or args.warmup > 3000 or args.samples > 3000 or not 1 <= args.timeout <= 1800:
        parser.error('target windows require warmup300..3000, samples600..3000 and timeout1..1800')
    out = args.out if args.out.is_absolute() else ROOT / args.out
    plan = []
    for quality in QUALITIES:
        for scene in SCENES:
            for index in range(3):
                plan.append({'kind': 'chrome', 'quality': quality, 'scene': scene,
                             'rotationOffset': index, 'relativeOut': f'{quality}/{scene}/run-{index + 1}'})
    if args.firefox:
        for quality, scene in (('Medium', 'representative'),):
            plan.append({'kind': 'firefox', 'quality': quality, 'scene': scene,
                         'rotationOffset': 0, 'relativeOut': f'firefox/{quality}/{scene}'})
    def command(item):
        cmd = [sys.executable, str(ROOT / 'tools/validate_sm603_ssgi_browser.py'), '--hardware', '--require-clean',
               '--browser-kind', item['kind'], '--quality', item['quality'], '--scene', item['scene'],
               '--rotation-offset', str(item['rotationOffset']), '--warmup', str(args.warmup),
               '--samples', str(args.samples), '--timeout', str(args.timeout), '--out', str(out / item['relativeOut'])]
        if item['kind'] == 'chrome':
            cmd.append('--timing')
            if args.browser:
                cmd += ['--browser', args.browser]
        else:
            if args.firefox_browser:
                cmd += ['--browser', args.firefox_browser]
            if args.geckodriver:
                cmd += ['--geckodriver', args.geckodriver]
            if args.firefox_webgpu_override:
                cmd.append('--firefox-webgpu-override')
            if args.firefox_windowed:
                cmd.append('--firefox-windowed')
        return cmd
    if args.plan:
        print(json.dumps({'chromeProcesses': 18, 'firefoxSpotchecks': 1 if args.firefox else 0,
                          'commands': [command(item) for item in plan],
                          'boundary': 'Plan only; no browser/GPU execution or measured success.'}, indent=2))
        return 0
    out.mkdir(parents=True, exist_ok=True)
    path = out / 'campaign.json'
    payload = {'schema': 'steelmoth-sm603-target-campaign/v1', 'ok': False, 'targetAcceptance': False,
               'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'source': None, 'sourceAfter': None,
               'plan': plan, 'runs': [], 'firefoxSpotChecks': [], 'summary': {}, 'errors': [],
               'boundary': 'Each quality/scene has three independent native full-HD Chrome processes; both variants interleave within each run. Complete SSGI submission only, not full renderer or default enablement. Every raw report is retained and SHA-256 referenced; no outliers are removed.'}
    reports = []
    def checkpoint():
        path.write_text(json.dumps(payload, separators=(',', ':'), allow_nan=False) + '\n', encoding='utf-8')
    try:
        payload['source'] = source_identity()
        if not payload['source']['cleanTrackedState'] or not payload['source']['closureTracked']:
            raise RuntimeError('Commit every executable source-closure path and leave tracked source clean before measurement')
        checkpoint()
        for item in plan:
            report_path = out / item['relativeOut'] / 'report.json'
            config = {'quality': item['quality'], 'scene': item['scene'], 'width': 1920, 'height': 1080,
                      'pixelScale': 3, 'warmup': args.warmup, 'samples': args.samples, 'rotationOffset': item['rotationOffset']}
            resumed = False
            if report_path.exists():
                if not args.resume:
                    raise RuntimeError(f'Existing evidence must not be overwritten: {report_path}; choose a fresh output folder or --resume')
                report = json.loads(report_path.read_text(encoding='utf-8'))
                errors = validate_browser(report, hardware=True, timing=item['kind'] == 'chrome', clean=True)
                if (errors or report.get('configuration') != config
                    or report.get('source', {}).get('commit') != payload['source']['commit']
                    or report.get('source', {}).get('fileSha256') != payload['source']['fileSha256']):
                    raise RuntimeError(f'Cannot resume failed/partial/changed-source report: {report_path}; retain it and use a fresh output folder')
                resumed = True
            else:
                payload['active'] = {**item, 'command': command(item)}
                checkpoint()
                print(f'SM-603 campaign: {item["kind"]} {item["quality"]}/{item["scene"]} rotation{item["rotationOffset"]}', flush=True)
                completed = subprocess.run(command(item), cwd=ROOT, timeout=args.timeout + 120, check=False)
                if not report_path.is_file():
                    raise RuntimeError(f'Browser runner exit{completed.returncode} produced no durable report: {report_path}')
                report = json.loads(report_path.read_text(encoding='utf-8'))
            record = {'reportFile': report_path.relative_to(out).as_posix(),
                      'reportSha256': hashlib.sha256(report_path.read_bytes()).hexdigest(),
                      'runId': report.get('runId'), 'configuration': report.get('configuration'), 'resumed': resumed}
            key = 'runs' if item['kind'] == 'chrome' else 'firefoxSpotChecks'
            payload[key].append(record)
            payload.pop('active', None)
            checkpoint()
            errors = validate_browser(report, hardware=True, timing=item['kind'] == 'chrome', clean=True)
            if errors:
                raise RuntimeError(f'{item["kind"]} {item["quality"]}/{item["scene"]}: ' + '; '.join(errors))
            if item['kind'] == 'chrome':
                reports.append(report)
        payload['sourceAfter'] = source_identity()
        if (payload['sourceAfter']['fileSha256'] != payload['source']['fileSha256']
            or payload['sourceAfter']['commit'] != payload['source']['commit']
            or not payload['sourceAfter']['cleanTrackedState']):
            raise RuntimeError('Source changed during the serialized target campaign')
        payload['summary'] = campaign_summary(reports)
        payload['errors'] = validate_campaign(payload, base_dir=out)
        payload['ok'] = not payload['errors']
    except Exception as error:
        payload['errors'].append(f'{type(error).__name__}: {error}')
        payload['ok'] = False
    finally:
        payload['completedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        checkpoint()
    print(json.dumps({'ok': payload['ok'], 'report': str(path), 'errors': payload['errors']}))
    return 0 if payload['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
