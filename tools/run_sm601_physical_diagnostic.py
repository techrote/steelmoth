#!/usr/bin/env python3
"""Bounded physical-only GTAO localization; never SM-601 acceptance."""
from __future__ import annotations

import argparse
import datetime as dt
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import urllib.error

import websocket

ROOT = Path(__file__).resolve().parents[1]
FILES = ('webgpu-gtao-physical-diagnostic.html', 'tools/run_sm601_physical_diagnostic.py',
         'tools/validate_webgpu_gtao_reference_browser.py',
         'webgpu-target-benchmark.html', 'engine/webgpu_gtao.js',
         'engine/webgpu_gtao_stabilization.js', 'engine/webgpu_performance.js',
         'engine/webgpu_resources.js', 'engine/webgpu_ownership.js',
         'engine/webgpu_depth_hierarchy.js', 'engine/webgpu_device.js',
         'engine/webgpu_gbuffer.js', 'engine/pseudo_depth.js', 'assets/generated/atlas.json',
         'assets/generated/sprite_runtime_atlas.png',
         'assets/generated/sprite_material_normal_roughness.png',
         'assets/generated/sprite_material_height_material.png')


def source_state() -> dict:
    def git(*args):
        return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    return {'commit': git('rev-parse', 'HEAD'),
            'cleanTrackedState': not bool(git('status', '--porcelain', '--untracked-files=no')),
            'fileSha256': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in FILES},
            'diagnosticOverlay': True,
            'note': 'Commit identifies repository state. Exact added diagnostic source is additionally identified by file SHA-256; no performance acceptance is implied.'}


def gpu_inventory() -> list[dict]:
    output = subprocess.run(['nvidia-smi', '--query-gpu=name,driver_version,memory.total,pci.bus_id',
                             '--format=csv,noheader,nounits'], capture_output=True, text=True, check=True, timeout=20).stdout
    result = []
    for line in output.strip().splitlines():
        name, driver, memory, bus = [part.strip() for part in line.split(',')]
        result.append({'name': name, 'driver': driver, 'memoryMiB': int(memory), 'pciBusId': bus})
    return result


def chrome_path() -> str | None:
    found = shutil.which('chrome') or shutil.which('google-chrome') or shutil.which('chromium')
    if found:
        return found
    for variable in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
        base = os.environ.get(variable)
        if base:
            path = Path(base) / 'Google/Chrome/Application/chrome.exe'
            if path.is_file():
                return str(path)
    return None


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class CDP:
    def __init__(self, url: str):
        self.ws = websocket.create_connection(url, timeout=30, suppress_origin=True)
        self.serial = 0
        self.exceptions: list[dict] = []

    def call(self, method: str, params: dict | None = None):
        self.serial += 1
        self.ws.send(json.dumps({'id': self.serial, 'method': method, 'params': params or {}}))
        while True:
            event = json.loads(self.ws.recv())
            if event.get('method') == 'Runtime.exceptionThrown':
                self.exceptions.append(event.get('params', {}))
            if event.get('id') == self.serial:
                if 'error' in event:
                    raise RuntimeError(f'{method}: {event["error"]}')
                return event.get('result', {})


class BrowserStartup:
    """Poll one existing process's startup endpoint within its original deadline."""

    def __init__(self, process, port_file: Path, deadline: float, *,
                 clock=time.monotonic, sleep=time.sleep, opener=urllib.request.urlopen):
        self.process, self.port_file, self.deadline = process, port_file, deadline
        self.clock, self.sleep, self.opener = clock, sleep, opener
        self.last_state = 'debugging port file not ready'

    def _remaining(self) -> float:
        status = self.process.poll()
        if status is not None:
            raise RuntimeError(f'Browser exited during startup with status {status}.')
        remaining = self.deadline - self.clock()
        if remaining <= 0:
            raise TimeoutError(f'Bounded browser startup timed out: {self.last_state}.')
        return remaining

    def wait_for_page(self) -> dict:
        while True:
            remaining = self._remaining()
            target = None
            try:
                lines = self.port_file.read_text().splitlines()
                port = int(lines[0])
                if not 1 <= port <= 65535:
                    raise ValueError('Incomplete or invalid debugging port')
                with self.opener(f'http://127.0.0.1:{port}/json/list',
                                 timeout=min(10, remaining)) as response:
                    targets = json.load(response)
                if not isinstance(targets, list):
                    raise ValueError('Debugging page inventory is not ready')
                target = next((item for item in targets if isinstance(item, dict)
                               and item.get('type') == 'page'
                               and isinstance(item.get('webSocketDebuggerUrl'), str)
                               and item['webSocketDebuggerUrl'].startswith(('ws://', 'wss://'))), None)
                self.last_state = 'debugging page websocket not ready'
            except (FileNotFoundError, PermissionError, IndexError, ValueError,
                    urllib.error.URLError, ConnectionError, TimeoutError) as exc:
                self.last_state = f'{type(exc).__name__}: {exc}'
            if target is not None:
                self._remaining()
                return target
            self.sleep(min(.1, max(0, self.deadline - self.clock())))


BROWSER_IDENTITY_FIELDS = ('product', 'protocolVersion', 'jsVersion', 'userAgent')


def validate_browser_identity(runs: list[dict]) -> None:
    identities = []
    for run in runs:
        if not run.get('ok'):
            continue  # Failed startup/measurement evidence retains its own error.
        version = (run.get('browser') or {}).get('version')
        if not isinstance(version, dict) or not all(isinstance(version.get(key), str) and version[key]
                                                    for key in BROWSER_IDENTITY_FIELDS):
            raise RuntimeError('Successful diagnostic run has incomplete browser identity metadata')
        identities.append(tuple(version[key] for key in BROWSER_IDENTITY_FIELDS))
    if identities and any(identity != identities[0] for identity in identities[1:]):
        raise RuntimeError('Browser version changed between fresh processes')


def run_once(args, url: str, run_number: int) -> dict:
    command = [args.browser, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
               '--disable-component-update', '--disable-sync', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
               '--remote-debugging-port=0', '--force-device-scale-factor=1', '--high-dpi-support=1',
               '--window-size=1920,1080']
    with tempfile.TemporaryDirectory(prefix='sm601-physical-diagnostic-', ignore_cleanup_errors=True) as profile:
        command += [f'--user-data-dir={profile}', 'about:blank']
        with tempfile.TemporaryFile(mode='w+b') as log:
            proc = subprocess.Popen(command, stdout=log, stderr=log,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            cdp = None
            version = None
            started = time.monotonic()
            try:
                deadline = started + args.timeout
                port_file = Path(profile) / 'DevToolsActivePort'
                page = BrowserStartup(proc, port_file, deadline).wait_for_page()
                cdp = CDP(page['webSocketDebuggerUrl'])
                version = cdp.call('Browser.getVersion')
                if 'Chrome/' not in version.get('product', ''):
                    raise RuntimeError('Physical diagnostic requires Chrome')
                cdp.call('Runtime.enable')
                navigation = cdp.call('Page.navigate', {'url': url})
                if navigation.get('errorText'):
                    raise RuntimeError(f'Navigation refused: {navigation["errorText"]}')
                previous_phase = None
                while time.monotonic() < deadline:
                    response = cdp.call('Runtime.evaluate', {
                        'expression': '({result:globalThis.SM601PhysicalDiagnosticResult||null,progress:globalThis.SM601PhysicalDiagnosticProgress||null})',
                        'returnByValue': True})
                    value = response.get('result', {}).get('value') or {}
                    progress = value.get('progress') or {}
                    phase = progress.get('phase')
                    if phase != previous_phase and (phase in ('warmup', 'flush', 'complete', 'failed') or str(phase).endswith('00')):
                        print(f'run {run_number}: {phase}', flush=True)
                    previous_phase = phase
                    payload = value.get('result')
                    if isinstance(payload, dict):
                        payload['browser'] = {'version': version, 'command': [a for a in command if not a.startswith('--user-data-dir=')],
                                              'freshProcess': True, 'freshProfile': True, 'processId': proc.pid, 'durationSeconds': time.monotonic() - started}
                        payload['javascriptExceptions'] = cdp.exceptions
                        if cdp.exceptions:
                            payload['ok'] = False
                        return payload
                    time.sleep(.25)
                raise TimeoutError(f'Bounded diagnostic timeout after {args.timeout}s')
            except Exception as exc:
                partial = None
                if cdp:
                    try:
                        partial = cdp.call('Runtime.evaluate', {
                            'expression': 'globalThis.SM601PhysicalDiagnosticLive||null',
                            'returnByValue': True}).get('result', {}).get('value')
                    except Exception:
                        pass
                payload = partial if isinstance(partial, dict) else {}
                payload.update({'ok': False, 'partialEvidence': True, 'error': f'{type(exc).__name__}: {exc}',
                                'browser': {'version': version, 'freshProcess': True, 'freshProfile': True, 'processId': proc.pid,
                                            'command': [a for a in command if not a.startswith('--user-data-dir=')],
                                            'durationSeconds': time.monotonic() - started},
                                'javascriptExceptions': cdp.exceptions if cdp else []})
                return payload
            finally:
                if cdp:
                    cdp.ws.close()
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=10)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', default=chrome_path())
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--warmup', type=int, default=300)
    parser.add_argument('--samples', type=int, default=600)
    parser.add_argument('--timeout', type=float, default=1200)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if not args.browser or not Path(args.browser).is_file():
        parser.error('Pass the installed Chrome executable with --browser')
    if args.runs != 3 or not (300 <= args.warmup <= 2000 and 600 <= args.samples <= 5000 and 1 <= args.timeout <= 1800):
        parser.error('Require exactly three fresh processes, 300..2000 warm-up, 600..5000 samples, and timeout <=1800s')
    if args.report.exists():
        parser.error('Report already exists; choose a new path to preserve evidence')
    result = {'schema': 'steelmoth-sm601-physical-diagnostic-runs/v1', 'ok': False, 'targetAcceptance': False,
              'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'hostPlatform': platform.platform(), 'runs': []}
    server = None
    thread = None
    try:
        result['source'] = source_state()
        if not result['source']['cleanTrackedState']:
            raise RuntimeError('Tracked source is dirty; refusing physical measurement')
        result['gpuInventory'] = gpu_inventory()
        targets = [gpu for gpu in result['gpuInventory'] if gpu['name'].upper() == 'NVIDIA GEFORCE GTX 1650 SUPER']
        if len(result['gpuInventory']) != 1 or len(targets) != 1:
            raise RuntimeError('Require the GTX 1650 SUPER as the sole NVIDIA device so opaque adapter ID is unambiguous')
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        query = urllib.parse.urlencode({'warmup': args.warmup, 'samples': args.samples})
        url = f'http://127.0.0.1:{server.server_port}/webgpu-gtao-physical-diagnostic.html?{query}'
        for run_number in range(1, args.runs + 1):
            print(f'SM-601 main diagnostic process {run_number}/{args.runs}', flush=True)
            payload = run_once(args, url, run_number)
            result['runs'].append(payload)
            validate_browser_identity(result['runs'])
            if not payload.get('ok'):
                result['error'] = payload.get('error') or f'Physical diagnostic process {run_number} failed'
                break
        final_source = source_state()
        if final_source != result['source']:
            raise RuntimeError('Source changed during campaign; samples cannot be treated as one source')
        if gpu_inventory() != result['gpuInventory']:
            raise RuntimeError('GPU/driver inventory changed during campaign')
        result['ok'] = len(result['runs']) == args.runs and all(run.get('ok') for run in result['runs'])
    except Exception as exc:
        result['error'] = f'{type(exc).__name__}: {exc}'
    finally:
        if server:
            server.shutdown()
            server.server_close()
        if thread:
            thread.join(timeout=5)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': result['ok'], 'runs': len(result['runs']), 'report': str(args.report), 'targetAcceptance': False}))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
