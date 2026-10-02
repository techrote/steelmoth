#!/usr/bin/env python3
"""Run the isolated SM-601 probe. Default: software WebGPU correctness, never timing."""
from __future__ import annotations

import argparse
import datetime as dt
import platform
import functools
import hashlib
import http.server
import json
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

import websocket  # Existing tools/requirements-ci.txt dependency.

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class CDP:
    def __init__(self, url: str, timeout: float):
        self.ws = websocket.create_connection(url, timeout=timeout, suppress_origin=True)
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


def run_once(args, url: str) -> dict:
    command = [args.browser, '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
               '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
               '--enable-unsafe-webgpu', '--remote-debugging-port=0']
    if not args.hardware:
        command += ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    with tempfile.TemporaryDirectory(prefix='sm601-arithmetic-', ignore_cleanup_errors=True) as profile:
        command += [f'--user-data-dir={profile}', 'about:blank']
        with tempfile.TemporaryFile(mode='w+b') as log:
            proc = subprocess.Popen(command, stdout=log, stderr=log)
            cdp = None
            try:
                deadline = time.monotonic() + args.timeout
                port_file = Path(profile) / 'DevToolsActivePort'
                while not port_file.exists():
                    if proc.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError('Browser did not expose its debugging endpoint.')
                    time.sleep(.1)
                port = int(port_file.read_text().splitlines()[0])
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list', timeout=10) as response:
                    targets = json.load(response)
                target = next(x for x in targets if x.get('type') == 'page')
                cdp = CDP(target['webSocketDebuggerUrl'], min(args.timeout, 30))
                version = cdp.call('Browser.getVersion')
                cdp.call('Runtime.enable')
                navigation = cdp.call('Page.navigate', {'url': url})
                if navigation.get('errorText'):
                    raise RuntimeError(f'Browser navigation refused: {navigation["errorText"]}')
                while time.monotonic() < deadline:
                    value = cdp.call('Runtime.evaluate', {'expression': "globalThis.SM601ArithmeticResult || (location.protocol === 'chrome-error:' ? {ok:false,error:document.body.innerText} : null)", 'returnByValue': True})
                    payload = value.get('result', {}).get('value')
                    if isinstance(payload, dict):
                        payload['browserVersion'] = version
                        payload['javascriptExceptions'] = cdp.exceptions
                        payload['browserCommand'] = [x for x in command if not x.startswith('--user-data-dir=')]
                        if cdp.exceptions:
                            payload['ok'] = False
                        return payload
                    time.sleep(.1)
                progress = cdp.call('Runtime.evaluate', {'expression': 'globalThis.SM601ArithmeticProgress || null', 'returnByValue': True})
                raise TimeoutError(f'Bounded shader study timed out: {json.dumps(progress)}; exceptions={cdp.exceptions}')
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
    parser.add_argument('--browser', default=shutil.which('chromium') or shutil.which('google-chrome') or shutil.which('google-chrome-stable'))
    parser.add_argument('--report', type=Path, default=ROOT / 'artifacts/sm601-arithmetic-browser.json')
    parser.add_argument('--hardware', action='store_true', help='Explicit opt-in to a physical adapter; not target acceptance.')
    parser.add_argument('--benchmark', action='store_true', help='Isolated horizon/reconstruction A/B timestamps, hardware only.')
    parser.add_argument('--pattern', choices=['plane','dense','sparse','empty','edge','saturated'], default='dense')
    parser.add_argument('--runs', type=int, choices=range(1, 4), default=1)
    parser.add_argument('--width', type=int, default=1920)
    parser.add_argument('--height', type=int, default=1080)
    parser.add_argument('--warmup', type=int, default=300)
    parser.add_argument('--samples', type=int, default=600)
    parser.add_argument('--timeout', type=float, default=180)
    args = parser.parse_args()
    if not args.browser:
        parser.error('Chrome/Chromium not found; pass --browser with its executable path.')
    if args.benchmark and not args.hardware:
        parser.error('--benchmark requires --hardware; software timing is not collected.')
    if not (1 <= args.timeout <= 1800):
        parser.error('--timeout must be between 1 and 1800 seconds.')
    if not (1 <= args.width <= 8192 and 1 <= args.height <= 8192 and args.width * args.height <= 16777216):
        parser.error('Invalid bounded extent.')
    if not (300 <= args.warmup <= 2000 and 600 <= args.samples <= 5000):
        parser.error('Require 300..2000 warm-up and 600..5000 measured samples.')
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    query = urllib.parse.urlencode({'hardware': int(args.hardware), 'benchmark': int(args.benchmark),
                                   'width': args.width, 'height': args.height, 'warmup': args.warmup, 'samples': args.samples, 'pattern': args.pattern})
    url = f'http://127.0.0.1:{server.server_port}/sm601-gtao-arithmetic-study.html?{query}'
    files = ['engine/webgpu_gtao.js', 'tools/sm601_gtao_arithmetic_study.js',
             'tools/run_sm601_gtao_arithmetic_study.py', 'sm601-gtao-arithmetic-study.html']
    result = {'schema': 'steelmoth-sm601-arithmetic-study-runs/v1', 'ok': False, 'runs': [],
              'sourceSha256': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in files},
              'targetAcceptance': False, 'softwareRequested': not args.hardware,
              'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'hostPlatform': platform.platform()}
    if args.hardware:
        try:
            result['gpuInventory'] = subprocess.run(['nvidia-smi', '--query-gpu=name,driver_version,memory.total,pci.bus_id', '--format=csv,noheader,nounits'], capture_output=True, text=True, check=True, timeout=15).stdout.strip()
        except Exception as exc:
            result['gpuInventory'] = {'unavailable': str(exc)}
    try:
        for _ in range(args.runs):
            run = run_once(args, url)
            result['runs'].append(run)
            if not run.get('ok'):
                break  # A failure stops the bounded campaign; never rerun until success.
        result['ok'] = len(result['runs']) == args.runs and all(x.get('ok') for x in result['runs'])
    except Exception as exc:
        result['error'] = f'{type(exc).__name__}: {exc}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': result['ok'], 'runs': len(result['runs']), 'report': str(args.report), 'targetAcceptance': False}))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
