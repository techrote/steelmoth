#!/usr/bin/env python3
"""Execute the SM-602 diffuse prototype on real WebGPU and retain exact evidence."""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request

import websocket

ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILES = ('webgpu-ssgi-smoke.html', 'tools/sm602_ssgi_fixtures.js',
                'tools/validate_webgpu_ssgi_browser.py', 'tools/validate_webgpu_ssgi.js',
                'engine/webgpu_ssgi.js', 'engine/webgpu_performance.js',
                'engine/webgpu_gtao_stabilization.js', 'engine/webgpu_depth_hierarchy.js',
                'engine/webgpu_resources.js', 'engine/pseudo_depth.js')


def browser_path(explicit: str | None = None) -> str | None:
    if explicit:
        candidate = Path(explicit)
        return str(candidate.resolve()) if candidate.is_file() else shutil.which(explicit)
    for name in ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
                 'chrome', 'msedge', 'microsoft-edge', 'microsoft-edge-stable'):
        found = shutil.which(name)
        if found:
            return found
    for relative in ('Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'):
        for variable in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
            base = os.environ.get(variable)
            if base and (Path(base) / relative).is_file():
                return str(Path(base) / relative)
    return None


def source_identity() -> dict:
    def git(*args):
        return subprocess.run(['git', *args], cwd=ROOT, check=True, capture_output=True,
                              text=True).stdout.strip()
    files = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCE_FILES}
    status = git('status', '--porcelain', '--untracked-files=all')
    return {'commit': git('rev-parse', 'HEAD'), 'branch': git('branch', '--show-current'),
            'cleanTrackedState': not bool(git('status', '--porcelain', '--untracked-files=no')),
            'workingTreeStatus': status, 'fileSha256': files,
            'boundary': 'The commit identifies the base; file hashes identify an uncommitted candidate exactly.'}


def gpu_inventory() -> dict:
    try:
        result = subprocess.run(['nvidia-smi', '--query-gpu=name,driver_version,memory.total,pci.bus_id',
                                 '--format=csv,noheader,nounits'], capture_output=True, text=True,
                                check=True, timeout=15)
        rows = []
        for line in result.stdout.splitlines():
            name, driver, memory, bus = [part.strip() for part in line.split(',')]
            rows.append({'name': name, 'driver': driver, 'memoryMiB': int(memory), 'pciBusId': bus})
        return {'available': True, 'devices': rows}
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        return {'available': False, 'error': str(error)}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class CDP:
    def __init__(self, url: str):
        self.ws = websocket.create_connection(url, timeout=30, suppress_origin=True)
        self.serial = 0
        self.exceptions = []

    def call(self, method: str, params: dict | None = None):
        self.serial += 1
        serial = self.serial
        self.ws.send(json.dumps({'id': serial, 'method': method, 'params': params or {}}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get('method') == 'Runtime.exceptionThrown':
                self.exceptions.append(message.get('params', {}))
            if message.get('id') == serial:
                if 'error' in message:
                    raise RuntimeError(f'{method}: {message["error"]}')
                return message.get('result', {})

    def value(self, expression: str):
        result = self.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True})
        if result.get('exceptionDetails'):
            raise RuntimeError(f'Browser evaluation: {result["exceptionDetails"]}')
        return result.get('result', {}).get('value')


def wait_for_page(process, profile: Path, deadline: float) -> dict:
    last_error = 'debug port not yet available'
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Browser exited during startup: {process.returncode}')
        try:
            port = int((profile / 'DevToolsActivePort').read_text().splitlines()[0])
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list', timeout=2) as response:
                targets = json.load(response)
            page = next((item for item in targets if item.get('type') == 'page'
                         and item.get('webSocketDebuggerUrl')), None)
            if page:
                return page
        except (OSError, ValueError, IndexError) as error:
            last_error = str(error)
        time.sleep(.1)
    raise TimeoutError(f'Browser startup deadline: {last_error}')


def stop_browser(process, cdp: CDP | None):
    """Stop only this fresh browser tree; never terminate unrelated browser names."""
    if cdp:
        try:
            cdp.call('Browser.close')
        except Exception:
            pass
        try:
            cdp.ws.close()
        except Exception:
            pass
    try:
        process.wait(timeout=3)
        return
    except subprocess.TimeoutExpired:
        pass
    if os.name == 'nt':
        # Native Windows tree cleanup scoped to the PID this runner created.
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True,
                       timeout=10, check=False, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    else:
        # A fresh session was created by Popen below; its group belongs to this run.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name != 'nt':
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        process.wait(timeout=5)


def validate(payload: dict):
    if not payload.get('ok'):
        raise RuntimeError(payload.get('error', 'SM-602 fixture failed'))
    checks = payload.get('checks') or []
    if len(checks) < 20 or any(not check.get('ok') for check in checks):
        raise RuntimeError('SM-602 fixture must retain at least 20 passing assertions')
    if not (payload.get('gpu') or {}).get('realWebGPU'):
        raise RuntimeError('The fixture did not execute real WebGPU')
    if payload.get('validationErrors') or payload.get('uncapturedErrors'):
        raise RuntimeError('WebGPU emitted validation or uncaptured errors')
    captures = payload.get('captures') or {}
    if not all(name in captures for name in ('off', 'on', 'indirect', 'rejection', 'moving-light', 'moving-object')):
        raise RuntimeError('Missing actual GPU static/moving-light/moving-object acceptance captures')
    motion = payload.get('motionValidation') or {}
    if len((motion.get('radiance') or {}).get('rows', [])) != 9 or len((motion.get('object') or {}).get('rows', [])) != 3:
        raise RuntimeError('Missing complete moving radiance and translated-object sequence metrics')
    timing = payload.get('timing') or {}
    if timing.get('available') and not timing.get('gpuMs'):
        raise RuntimeError('Timestamp-query marked available without raw GPU samples')


def save_acceptance(out: Path, payload: dict):
    """Replay only recorded GPU readbacks with the same explicit display transform."""
    (out / 'readbacks.json').write_text(json.dumps(payload.get('captures', {}), indent=2) + '\n', encoding='utf-8')
    data = json.dumps({'captures': payload.get('captures', {}), 'scene': payload.get('scene', {}),
                       'captureSettings': payload.get('captureSettings', {}),
                       'captureMetadata': payload.get('captureMetadata', {}),
                       'motionValidation': payload.get('motionValidation', {}),
                       'gpu': payload.get('gpu', {})}).replace('</', '<\\/')
    html = '''<!doctype html><meta charset="utf-8"><title>SM-602 recorded GPU acceptance</title>
<style>body{background:#171c23;color:#eee;font:16px system-ui;padding:22px}main{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:18px}canvas{width:100%;image-rendering:pixelated;background:#000}figure{margin:0}pre{white-space:pre-wrap}figcaption{padding:6px}</style>
<h1>SM-602 recorded GPU readbacks</h1><p>These figures replay actual retained WebGPU output. Off/on RGB is linear HDR, display-encoded with Reinhard + IEC sRGB. The quarter-resolution indirect figure is incident diffuse irradiance before native per-pixel albedo/metalness, with 4× exposure. Rejection shows the moving-object ownership test: red = temporal reason code / 4, green = rejected donor fraction, blue = valid ray-hit fraction. Human visual judgment is pending unless separately recorded.</p><main></main><pre></pre>
<script>const recorded=DATA;const transfer=v=>v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055;
for(const name of ['off','on','indirect','rejection','moving-light','moving-object']){const r=recorded.captures[name];if(!r)continue;const f=document.createElement('figure'),c=document.createElement('canvas'),label=document.createElement('figcaption');c.width=r.width;c.height=r.height;const ctx=c.getContext('2d'),im=ctx.createImageData(r.width,r.height);for(let i=0;i<r.width*r.height;i++){for(let j=0;j<3;j++){let v=Math.max(0,r.data[i*4+j]);if(name==='rejection'&&j===0)v/=4;im.data[i*4+j]=name==='rejection'?Math.round(Math.min(1,v)*255):Math.round(Math.min(1,transfer(v*(name==='indirect'?4:1)/(1+v*(name==='indirect'?4:1))))*255)}im.data[i*4+3]=255}ctx.putImageData(im,0,0);label.textContent=name+' — '+r.width+'×'+r.height+' actual GPU readback — '+(recorded.captureMetadata[name]?.testCase||'capture case unavailable');f.append(c,label);document.querySelector('main').append(f)}document.querySelector('pre').textContent=JSON.stringify({scene:recorded.scene,captureSettings:recorded.captureSettings,captureMetadata:recorded.captureMetadata,motionValidation:recorded.motionValidation,gpu:recorded.gpu},null,2);</script>'''.replace('DATA', data)
    (out / 'acceptance.html').write_text(html, encoding='utf-8')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', help='Chrome/Edge/Chromium executable path; otherwise discover native install')
    parser.add_argument('--out', type=Path, default=Path('artifacts/sm602-ssgi-browser'))
    parser.add_argument('--report', type=Path)
    parser.add_argument('--timeout', type=float, default=240)
    parser.add_argument('--hardware', action='store_true', help='Use the exposed native adapter rather than request SwiftShader')
    parser.add_argument('--timing', action='store_true', help='Negotiate optional timestamp-query and retain initial GPU samples')
    parser.add_argument('--warmup', type=int, default=30)
    parser.add_argument('--samples', type=int, default=60)
    args = parser.parse_args()
    if not 1 <= args.timeout <= 1800 or not 0 <= args.warmup <= 3000 or not 1 <= args.samples <= 3000:
        parser.error('timeout 1..1800; warmup 0..3000; samples 1..3000')
    out = args.out if args.out.is_absolute() else ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    path = args.report if args.report else out / 'report.json'
    path = path if path.is_absolute() else ROOT / path
    exe = browser_path(args.browser)
    report = {'schema': 'steelmoth-sm602-browser-report/v1', 'ok': False,
              'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'hostPlatform': platform.platform(),
              'browserExecutable': exe, 'hardwareRequested': args.hardware,
              'softwareRequested': not args.hardware, 'timestampQueryRequested': args.timing,
              'targetAcceptance': False, 'source': None,
              'gpuInventory': gpu_inventory() if args.hardware else None,
              'evidenceBoundary': 'Synthetic fixture correctness and optional initial compute/composition GPU timings only. This does not promote SSGI, prove full-game performance, or record a human visual judgment.'}
    server = None
    try:
        report['source'] = source_identity()
        if not exe:
            raise RuntimeError('Chrome/Edge/Chromium executable unavailable; pass --browser with an installed executable')
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        query = urllib.parse.urlencode({'timing': int(args.timing), 'hardware': int(args.hardware),
                                       'warmup': args.warmup, 'samples': args.samples})
        url = f'http://127.0.0.1:{server.server_port}/webgpu-ssgi-smoke.html?{query}'
        command = [exe, '--headless=new', '--no-first-run', '--no-default-browser-check',
                   '--disable-background-networking', '--disable-component-update', '--disable-sync',
                   '--enable-unsafe-webgpu', '--remote-debugging-port=0', '--force-device-scale-factor=1',
                   '--window-size=1400,1100', '--remote-allow-origins=*']
        if not args.hardware:
            command += ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        with tempfile.TemporaryDirectory(prefix='sm602-webgpu-', ignore_cleanup_errors=True) as profile:
            with tempfile.TemporaryFile(mode='w+b') as log:
                command += [f'--user-data-dir={profile}', 'about:blank']
                process = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log,
                                           start_new_session=os.name != 'nt',
                                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) if os.name == 'nt' else 0)
                cdp = None
                try:
                    deadline = time.monotonic() + args.timeout
                    target = wait_for_page(process, Path(profile), deadline)
                    cdp = CDP(target['webSocketDebuggerUrl'])
                    report['browser'] = {'version': cdp.call('Browser.getVersion'), 'processId': process.pid,
                                         'freshProcess': True, 'freshProfile': True,
                                         'command': [arg for arg in command if not arg.startswith('--user-data-dir=')]}
                    cdp.call('Runtime.enable')
                    navigation = cdp.call('Page.navigate', {'url': url})
                    if navigation.get('errorText'):
                        raise RuntimeError(navigation['errorText'])
                    payload = None
                    last_phase = None
                    while time.monotonic() < deadline:
                        state = cdp.value('({result:globalThis.SM602Result||null,progress:globalThis.SM602Progress||null})') or {}
                        progress = state.get('progress') or {}
                        if progress.get('phase') != last_phase:
                            last_phase = progress.get('phase')
                            if last_phase:
                                print(f'SM-602: {last_phase}', flush=True)
                        payload = state.get('result')
                        if isinstance(payload, dict):
                            break
                        time.sleep(.15)
                    if not isinstance(payload, dict):
                        raise TimeoutError(f'SM-602 fixture timed out; phase={last_phase}')
                    report['smoke'] = payload
                    report['javascriptExceptions'] = cdp.exceptions
                    save_acceptance(out, payload)
                    screenshot = cdp.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': True})
                    (out / 'acceptance.png').write_bytes(base64.b64decode(screenshot['data']))
                    validate(payload)
                    if args.hardware and ((payload.get('gpu') or {}).get('isFallbackAdapter')
                                          or any(word in json.dumps(payload.get('gpu', {})).lower()
                                                 for word in ('swiftshader', 'llvmpipe', 'software adapter'))):
                        raise RuntimeError('Native hardware requested but exposed adapter is software/fallback')
                    if cdp.exceptions:
                        raise RuntimeError('Browser emitted uncaught JavaScript exceptions')
                    report['sourceAfter'] = source_identity()
                    if report['sourceAfter']['fileSha256'] != report['source']['fileSha256']:
                        raise RuntimeError('Candidate source changed during browser execution; evidence cannot be attributed')
                    report['ok'] = True
                finally:
                    stop_browser(process, cdp)
                    log.seek(0)
                    if not report['ok']:
                        report['browserStderrTail'] = log.read().decode('utf-8', errors='replace')[-6000:]
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
    finally:
        if server:
            server.shutdown()
            server.server_close()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(json.dumps({'ok': report['ok'], 'report': str(path), 'acceptance': str(out / 'acceptance.html'), 'error': report.get('error')}))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
