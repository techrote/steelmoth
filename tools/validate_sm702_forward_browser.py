#!/usr/bin/env python3
"""Run SM-702 forward production correctness or paired timing in an isolated browser."""
from __future__ import annotations

import argparse
import base64
import ctypes
import datetime as dt
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid

from validate_webgpu_ssgi_browser import (CDP, QuietHandler, browser_path,
                                         gpu_inventory, stop_browser, wait_for_page)
from validate_sm702_target_report import (BASELINE_COMMIT, BASELINE_PINS, BASELINE_SOURCE_FILES, SCENES, SOURCE_FILES,
                                        hardware_errors, validate_browser)

ROOT = Path(__file__).resolve().parents[1]
PAGE = 'webgpu-forward-lighting-smoke.html'
FIREFOX_PATH = r'C:\Program Files\Mozilla Firefox\firefox.exe'
GECKODRIVER_PATH = r'C:\Users\-\.cache\selenium\geckodriver\win64\0.37.1\geckodriver.exe'


def video_controller_inventory():
    if os.name != 'nt':
        return {'available': False, 'error': 'Windows VideoController inventory unavailable on this host'}
    try:
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
            'Get-CimInstance Win32_VideoController | Select-Object Name,PNPDeviceID,DriverVersion,AdapterRAM | ConvertTo-Json -Compress'],
            check=True, capture_output=True, text=True, timeout=20,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        devices = json.loads(result.stdout)
        if isinstance(devices, dict):
            devices = [devices]
        if not isinstance(devices, list):
            raise ValueError('VideoController inventory did not return a device collection')
        return {'available': True, 'devices': devices, 'boundary': 'All Windows VideoController instances; no filtering to the preferred NVIDIA adapter.'}
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        return {'available': False, 'error': str(error)}


def source_identity():
    def git(*args):
        return subprocess.run(['git', *args], cwd=ROOT, check=True, capture_output=True,
                              text=True).stdout.strip()
    page_source = (ROOT / PAGE).read_text(encoding='utf-8')
    page_scripts = re.findall(r'<script\b[^>]*\bsrc=[\"\']([^\"\']+)[\"\']', page_source, re.IGNORECASE)
    # The fixture loads UMD production modules through literal ES-module imports
    # and one declared dependencies array. Close both execution mechanisms.
    dependency_array = re.search(r'\bconst\s+dependencies\s*=\s*\[([^\]]+)\]', page_source)
    if dependency_array:
        page_scripts += re.findall(r'[\"\']([^\"\']+)[\"\']', dependency_array.group(1))
    for expression in re.findall(r'\bimport\(([^)]+)\)', page_source):
        literal = re.fullmatch(r'\s*([\"\'])([^\"\']+)\1\s*', expression)
        declared = dependency_array is not None and re.sub(r'\s+', '', expression) in ("'./'+path", '"./"+path')
        if not literal and not declared:
            raise RuntimeError(f'Unclosed dynamic import expression: {expression}')
    page_scripts += [match[1] for match in re.findall(r'\bimport\(\s*([\"\'])([^\"\']+)\1\s*\)', page_source)]
    page_scripts = list(dict.fromkeys(s.removeprefix('./') for s in page_scripts))
    for script in page_scripts:
        url = urllib.parse.urlparse(script)
        relative = urllib.parse.unquote(url.path)
        if url.scheme or url.netloc or url.query or url.fragment or relative.startswith('/'):
            raise RuntimeError(f'Unclosed/external page script: {script}')
        path = (ROOT / relative).resolve()
        path.relative_to(ROOT.resolve())
        if path.relative_to(ROOT).as_posix() not in SOURCE_FILES:
            raise RuntimeError(f'Actual executable page script omitted from closure: {script}')
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCE_FILES}
    baseline = {name: hashlib.sha256((ROOT / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
                for name in BASELINE_PINS}
    accepted, baseline_error = None, None
    try:
        accepted = {name: hashlib.sha256(subprocess.run(
            ['git', 'show', f'{BASELINE_COMMIT}:{BASELINE_SOURCE_FILES[name]}'], cwd=ROOT,
            check=True, capture_output=True).stdout.replace(b'\r\n', b'\n')).hexdigest() for name in BASELINE_PINS}
    except subprocess.CalledProcessError as error:
        # A shallow hosted checkout may omit this historic accepted commit.
        # Retain the absence; clean native acceptance requires actual Git proof.
        baseline_error = error.stderr.decode('utf-8', errors='replace').strip()
    if baseline != BASELINE_PINS or (accepted is not None and accepted != BASELINE_PINS):
        raise RuntimeError('A frozen SM-702 baseline differs from accepted LF-normalized source')
    tracked = set(git('ls-files', '--', *SOURCE_FILES).splitlines())
    return {'commit': git('rev-parse', 'HEAD'), 'branch': git('branch', '--show-current'),
            'cleanTrackedState': not bool(git('status', '--porcelain', '--untracked-files=no')),
            'closureTracked': set(SOURCE_FILES) <= tracked,
            'untrackedClosurePaths': [name for name in SOURCE_FILES if name not in tracked],
            'workingTreeStatus': git('status', '--porcelain', '--untracked-files=all'),
            'fileSha256': hashes, 'baselineLFNormalizedSha256': baseline,
            'baselineCommit': BASELINE_COMMIT, 'baselineGitBlobLFNormalizedSha256': accepted,
            'baselineGitBlobVerification': {'available': accepted is not None, 'error': baseline_error},
            'pageScripts': page_scripts,
            'boundary': 'Complete fixture/production/baseline/Python measurement closure; raw bytes before/after plus LF-normalized frozen accepted baselines.'}


def save_acceptance(out, payload, report_source=None):
    captures = payload.get('captures') or {}
    (out / 'readbacks.json').write_text(json.dumps(captures, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    source = report_source or {}
    forward = payload.get('forward') or {}
    water, foliage = forward.get('water') or {}, forward.get('ambientOnce') or {}
    glass = (forward.get('glass') or {}).get('direct') or {}
    positive = glass.get('positiveWitnesses') or []
    def pick(value, keys):
        return {key: value.get(key) for key in keys}
    summary = {'water': {'indirectMaximum': water.get('indirectMaximum'),
                   'ambientOnce': pick(water.get('ambientOnce') or {}, ('tested', 'positivePixels', 'maxError', 'tolerance'))},
               'foliage': {'macroIndirectMax': forward.get('macroIndirectMax'),
                   'tinyMediumByteUnchanged': forward.get('tinyMediumByteUnchanged'),
                   'ambientOnce': pick(foliage, ('tested', 'maxError'))},
               'glass': {'positiveWitnesses': len(positive),
                   'positiveDirectGRange': [min((r.get('directG', 0) for r in positive), default=0),
                                           max((r.get('directG', 0) for r in positive), default=0)],
                   'maximumPositiveContribution': max((r.get('directContribution', 0) for r in positive), default=0),
                   'hardZero': pick(glass.get('hardZero') or {}, ('angle', 'directG', 'directContribution', 'maxError', 'expected', 'actual')),
                   'dimmerControls': [pick(r, ('label', 'directG', 'ambientB', 'directRGB', 'expected', 'actual', 'maxError'))
                                       for r in glass.get('dimmerControls') or []],
                   **pick(glass, ('movingLightChanged', 'unsaturatedCanonicalRGBChanged', 'maximumError', 'tolerance'))}}
    provenance = {'commit': source.get('commit'), 'branch': source.get('branch'),
                  'closureFileCount': len(source.get('fileSha256') or {}),
                  'baselineCommit': source.get('baselineCommit'),
                  'baselineLFNormalizedSha256': source.get('baselineLFNormalizedSha256'),
                  'localReport': source.get('localReport', 'report.json')}
    recorded = json.dumps({'captures': captures, 'captureMetadata': payload.get('captureMetadata', {}),
                           'configuration': payload.get('configuration', {}),
                           'forwardValidation': summary, 'provenance': provenance,
                           'ok': payload.get('ok'), 'error': payload.get('error'),
                           'gpu': payload.get('gpu', {})}, separators=(',', ':')).replace('</', r'<\/')
    template = '''<!doctype html><meta charset="utf-8"><title>SM-702 retained GPU readbacks</title>
<style>body{background:#171c23;color:#eee;font:15px system-ui;padding:22px}main{display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:16px}canvas{width:100%;image-rendering:pixelated}figure{margin:0}pre{white-space:pre-wrap}</style>
<h1>SM-702 recorded GPU evidence</h1><p>These figures replay retained production GPU readbacks. Linear HDR and incident irradiance RGB use Reinhard plus IEC sRGB display transfer at the recorded inspection exposure. Diagnostic RGB uses each recorded channel range directly; the metadata below records physical units and channel meanings. Synthetic forward timings do not establish whole-game performance or human art-direction approval.</p><p><a id="raw-report">Full raw report and source closure</a></p><main></main><pre></pre>
<script>const r=DATA;const transfer=x=>x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055;
for(const[name,v]of Object.entries(r.captures)){const f=document.createElement('figure'),c=document.createElement('canvas'),l=document.createElement('figcaption');c.width=v.width;c.height=v.height;const ctx=c.getContext('2d'),im=ctx.createImageData(v.width,v.height),meta=r.captureMetadata[name]||{},debug=meta.kind==='debug',exposure=Number(meta.exposure??1);for(let i=0;i<v.width*v.height;i++){for(let j=0;j<3;j++){let x=Math.max(0,v.data[i*4+j]);const range=meta.channelRanges?.[j]||[0,1];x=debug?(x-range[0])/(range[1]-range[0]):transfer(x*exposure/(1+x*exposure));im.data[i*4+j]=Math.round(Math.max(0,Math.min(1,x))*255)}im.data[i*4+3]=255}ctx.putImageData(im,0,0);l.textContent=name+' — '+v.width+'×'+v.height+' actual GPU readback — '+meta.units+' — '+meta.testCase;f.append(c,l);document.querySelector('main').append(f)}document.querySelector('#raw-report').href='./'+r.provenance.localReport;document.querySelector('pre').textContent=JSON.stringify({ok:r.ok,error:r.error,provenance:r.provenance,configuration:r.configuration,forwardValidation:r.forwardValidation,captureMetadata:r.captureMetadata,gpu:r.gpu},null,2)</script>'''
    (out / 'acceptance.html').write_text(template.replace('DATA', recorded), encoding='utf-8', newline='\n')


def execute_chrome(args, url, out, report):
    exe = browser_path(args.browser)
    report['browserExecutable'] = exe
    if not exe:
        raise RuntimeError('Native Chrome/Chromium executable unavailable; provide --browser')
    command = [exe, '--headless=new', '--no-first-run', '--no-default-browser-check',
               '--disable-background-networking', '--disable-component-update', '--disable-sync',
               '--enable-unsafe-webgpu', '--remote-debugging-port=0', '--force-device-scale-factor=1',
               '--window-size=1400,1100', '--remote-allow-origins=*']
    if not args.hardware:
        command += ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    with tempfile.TemporaryDirectory(prefix='sm702-chrome-', ignore_cleanup_errors=True) as profile:
        with tempfile.TemporaryFile(mode='w+b') as log:
            command += [f'--user-data-dir={profile}', 'about:blank']
            process = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log,
                                       start_new_session=os.name != 'nt',
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) if os.name == 'nt' else 0)
            cdp = None
            try:
                deadline = time.monotonic() + args.timeout
                page = wait_for_page(process, Path(profile), deadline)
                cdp = CDP(page['webSocketDebuggerUrl'])
                report['browser'] = {'kind': 'chrome', 'version': cdp.call('Browser.getVersion'),
                                     'processId': process.pid, 'freshProcess': True, 'freshProfile': True,
                                     'command': [v for v in command if not v.startswith('--user-data-dir=')],
                                     'forcedPreferences': {}, 'defaultBrowserCompatibilityClaim': False}
                cdp.call('Runtime.enable')
                navigation = cdp.call('Page.navigate', {'url': url})
                if navigation.get('errorText'):
                    raise RuntimeError(navigation['errorText'])
                payload, phase = None, None
                while time.monotonic() < deadline:
                    state = cdp.value('({result:globalThis.SM702Result||null,progress:globalThis.SM702Progress||null})') or {}
                    current = (state.get('progress') or {}).get('phase')
                    if current and current != phase:
                        phase = current
                        print(f'SM-702: {phase}', flush=True)
                    payload = state.get('result')
                    if isinstance(payload, dict):
                        break
                    time.sleep(.15)
                if not isinstance(payload, dict):
                    raise TimeoutError(f'SM-702 Chrome fixture timed out; phase={phase}')
                report['smoke'] = payload
                report['javascriptExceptions'] = cdp.exceptions
                screenshot = cdp.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': True})
                (out / 'acceptance.png').write_bytes(base64.b64decode(screenshot['data']))
            finally:
                stop_browser(process, cdp)
                report['browserProcessExited'] = process.poll() is not None
                log.seek(0)
                report['browserStderrTail'] = log.read().decode('utf-8', errors='replace')[-4000:]


def process_running(pid):
    if type(pid) is not int or pid <= 0:
        return None
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return False if ctypes.get_last_error() == 87 else None
    try:
        code = ctypes.c_uint32()
        return code.value == 259 if kernel.GetExitCodeProcess(handle, ctypes.byref(code)) else None
    finally:
        kernel.CloseHandle(handle)


def execute_firefox(args, url, out, report):
    """Use only the supplied native driver, temporary profile and owned process."""
    if not args.hardware:
        raise RuntimeError('Firefox spotcheck requires --hardware; no software/fallback bootstrap is implemented')
    if args.timing:
        raise RuntimeError('Firefox mode is a native correctness spotcheck; Chrome owns the timing campaign')
    from selenium import webdriver
    from selenium.webdriver.firefox.options import Options
    from selenium.webdriver.firefox.service import Service
    import selenium
    binary = Path(args.browser or FIREFOX_PATH)
    gecko = Path(args.geckodriver or GECKODRIVER_PATH)
    if not binary.is_file() or not gecko.is_file():
        raise RuntimeError('Installed Firefox or explicit geckodriver is unavailable; no driver installation attempted')
    report['browserExecutable'] = str(binary)
    preferences = {'layout.css.devPixelsPerPx': '1.0', 'browser.cache.disk.enable': False,
                   'browser.cache.memory.enable': False, 'network.http.use-cache': False}
    if args.firefox_webgpu_override:
        preferences['dom.webgpu.enabled'] = True
        preferences['gfx.webrender.all'] = True
        preferences['webgl.force-enabled'] = True
    with tempfile.TemporaryDirectory(prefix='sm702-firefox-', ignore_cleanup_errors=True) as profile:
        options = Options()
        options.binary_location = str(binary)
        if not args.firefox_windowed:
            options.add_argument('-headless')
        options.add_argument('-profile')
        options.add_argument(profile)
        for key, value in preferences.items():
            options.set_preference(key, value)
        service = Service(executable_path=str(gecko), log_output=str(out / 'geckodriver.log'),
                          popen_kw={'creation_flags': getattr(subprocess, 'CREATE_NO_WINDOW', 0)} if os.name == 'nt' else {})
        driver = None
        try:
            driver = webdriver.Firefox(service=service, options=options)
            driver.set_page_load_timeout(args.timeout)
            driver.set_window_size(1400, 1100)
            if args.firefox_windowed:
                driver.minimize_window()
            caps = driver.capabilities
            report['browser'] = {'kind': 'firefox', 'version': {'product': caps.get('browserVersion'),
                                'userAgent': driver.execute_script('return navigator.userAgent')},
                                'processId': caps.get('moz:processID'), 'freshProcess': True, 'freshProfile': True,
                                'forcedPreferences': preferences, 'defaultBrowserCompatibilityClaim': False,
                                'windowMode': 'windowed' if args.firefox_windowed else 'headless',
                                'geckodriver': str(gecko), 'seleniumVersion': selenium.__version__,
                                'profileBoundary': 'A disposable profile only; no persistent browser preferences are changed.'}
            driver.get(url)
            deadline, phase = time.monotonic() + args.timeout, None
            payload = None
            while time.monotonic() < deadline:
                state = driver.execute_script('return {result:globalThis.SM702Result||null,progress:globalThis.SM702Progress||null}') or {}
                current = (state.get('progress') or {}).get('phase')
                if current and current != phase:
                    phase = current
                    print(f'SM-702 Firefox: {phase}', flush=True)
                payload = state.get('result')
                if isinstance(payload, dict):
                    break
                time.sleep(.2)
            if not isinstance(payload, dict):
                raise TimeoutError(f'SM-702 Firefox fixture timed out; phase={phase}')
            report['smoke'] = payload
            # Production shader/API/readback assertions are cross-browser evidence;
            # this does not invent Chrome-CDP exception monitoring for Firefox.
            report['javascriptExceptions'] = []
            report['javascriptExceptionMonitoring'] = 'Page completion and explicit fixture catches/assertions; Firefox exposes no Chrome-CDP exception stream.'
            driver.save_screenshot(str(out / 'acceptance.png'))
        finally:
            browser_pid = (report.get('browser') or {}).get('processId')
            if driver:
                try:
                    driver.quit()
                except Exception:
                    pass
            service_process = getattr(service, 'process', None)
            if service_process is not None:
                if driver is None and service_process.poll() is None:
                    stop_browser(service_process, None)
                else:
                    service.stop()
            elif hasattr(getattr(service, 'log_output', None), 'close'):
                service.log_output.close()
            deadline = time.monotonic() + 3
            while process_running(browser_pid) is True and time.monotonic() < deadline:
                time.sleep(.1)
            if process_running(browser_pid) is True:
                # Only the PID returned by this fresh session is eligible.
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(browser_pid), '/T', '/F'], capture_output=True,
                                   timeout=10, check=False, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                else:
                    os.kill(browser_pid, signal.SIGTERM)
            report['browserProcessExited'] = process_running(browser_pid) is False
            if driver and not report['browserProcessExited']:
                raise RuntimeError('Cannot prove the owned Firefox process exited')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser')
    parser.add_argument('--browser-kind', choices=('chrome', 'firefox'), default='chrome')
    parser.add_argument('--geckodriver')
    parser.add_argument('--firefox-webgpu-override', action='store_true', help='Set the accepted native WebGPU/WebRender/WebGL preferences only in a disposable Firefox profile and label the override; never ignore the blocklist')
    parser.add_argument('--firefox-windowed', action='store_true', help='Use the existing windowed native Firefox verification route; the headless route remains distinct')
    parser.add_argument('--scene', choices=SCENES, default='representative')
    parser.add_argument('--hardware', action='store_true')
    parser.add_argument('--timing', action='store_true')
    parser.add_argument('--require-clean', action='store_true')
    parser.add_argument('--warmup', type=int, default=300)
    parser.add_argument('--samples', type=int, default=600)
    parser.add_argument('--rotation-offset', type=int, choices=(0, 1, 2), default=0)
    parser.add_argument('--timeout', type=float, default=600)
    parser.add_argument('--out', type=Path, default=Path('artifacts/sm702-browser'))
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if not 1 <= args.timeout <= 1800 or not 0 <= args.warmup <= 3000 or not 1 <= args.samples <= 3000:
        parser.error('timeout1..1800, warmup0..3000 and samples1..3000 are required')
    if args.timing and (args.warmup < 300 or args.samples < 600):
        parser.error('paired forward timing requires at least300 warmup and600 retained samples')
    out = args.out if args.out.is_absolute() else ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    path = args.report or out / 'report.json'
    path = path if path.is_absolute() else ROOT / path
    config = {'scene': args.scene, 'width': 1920, 'height': 1080,
              'pixelScale': 3, 'warmup': args.warmup, 'samples': args.samples, 'rotationOffset': args.rotation_offset}
    report = {'schema': 'steelmoth-sm702-forward-browser-report/v1', 'ok': False, 'runId': str(uuid.uuid4()),
              'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'hostPlatform': platform.platform(),
              'pythonVersion': platform.python_version(),
              'configuration': config, 'hardwareRequested': args.hardware,
              'softwareRequested': not args.hardware, 'timestampQueryRequested': args.timing,
              'targetAcceptance': False, 'source': None, 'sourceAfter': None,
              'gpuInventory': gpu_inventory() if args.hardware else None,
              'videoControllers': video_controller_inventory() if args.hardware else None,
              'evidenceBoundary': 'Synthetic Forward correctness and paired complete forward-submission GPU cost/memory only. Shared canonical upstream ownership/light/DSO/GTAO/visibility/SSGI generation, uploads/hierarchy, diagnostic query/readback and full renderer are excluded; shared fixture GPU composition is included in both variants. No default enablement or human art-direction approval.'}
    server = None
    try:
        report['source'] = source_identity()
        if args.require_clean and (not report['source']['cleanTrackedState'] or not report['source']['closureTracked']
                                  or report['source']['baselineGitBlobLFNormalizedSha256'] != BASELINE_PINS):
            raise RuntimeError('Clean Git-tracked complete source is required before this target campaign')
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        query = urllib.parse.urlencode({'scene': args.scene, 'hardware': int(args.hardware),
                    'timing': int(args.timing), 'warmup': args.warmup, 'samples': args.samples, 'rotationOffset': args.rotation_offset})
        url = f'http://127.0.0.1:{server.server_port}/{PAGE}?{query}'
        if args.browser_kind == 'firefox':
            execute_firefox(args, url, out, report)
        else:
            execute_chrome(args, url, out, report)
        save_acceptance(out, report.get('smoke') or {}, {**report['source'],
                        'localReport': Path(os.path.relpath(path, out)).as_posix()})
        report['artifactSha256'] = {name: hashlib.sha256((out / name).read_bytes()).hexdigest()
                                   for name in ('acceptance.html', 'readbacks.json', 'acceptance.png')}
        smoke = report.get('smoke') or {}
        report['correctness'] = {'measurement': 'small deterministic correctness fixtures',
            'fixtureExtents': {name: [capture.get('width'), capture.get('height')] for name, capture in (smoke.get('captures') or {}).items()},
            'boundary': 'Actual small correctness fixture extents are listed here. Full-HD configuration applies to requested timing only, never to Firefox correctness timings.'}
        report['sourceAfter'] = source_identity()
        # validate_browser checks all result fields even though its success marker
        # has not yet been published by the runner itself.
        report['ok'] = True
        errors = validate_browser(report, hardware=args.hardware, timing=args.timing, clean=args.require_clean)
        info = (report.get('smoke') or {}).get('gpu', {}).get('adapterInfo') or {}
        adapter_identified = str(info.get('vendor', '')).lower() == 'nvidia' and str(info.get('architecture', '')).lower() == 'turing'
        report['hardwareAttribution'] = {'established': args.hardware and not hardware_errors(report),
                                       'fallbackFlag': (report.get('smoke') or {}).get('gpu', {}).get('isFallbackAdapter'),
                                       'basis': ('Exposed NVIDIA/Turing adapter identity correlated with native target inventory; missing fallback flag remains unknown.'
                                                 if adapter_identified else 'Actual explicit nonfallback boolean false plus full single Windows VEN_10DE/DEV_2187 controller inventory and NVIDIA GTX1650SUPER4096MiB/driver inventory; exposed adapter names may be privacy-redacted.')}
        if errors:
            raise RuntimeError('; '.join(errors))
    except Exception as error:
        report['ok'] = False
        report['error'] = f'{type(error).__name__}: {error}'
    finally:
        if report.get('sourceAfter') is None:
            try:
                report['sourceAfter'] = source_identity()
            except Exception as error:
                report['sourceAfterError'] = f'{type(error).__name__}: {error}'
        if server:
            server.shutdown()
            server.server_close()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, separators=(',', ':'), allow_nan=False) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'ok': report['ok'], 'report': str(path), 'acceptance': str(out / 'acceptance.html'), 'error': report.get('error')}))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
