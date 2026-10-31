#!/usr/bin/env python3
"""Guarded native Firefox normal-index correctness diagnostic, never acceptance.

No software adapter, driver installation, automatic retry, or visual/timing PASS
is supplied by this runner. Stable Firefox preferences are used by default.
"""
from __future__ import annotations

import argparse
import base64
import functools
import hashlib
import http.server
import json
import math
import os
from pathlib import Path
import platform
import re
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid

from benchmark_sm505_normal import (manifest, same_source, source_identity,
                                    utc_now, validate_guard, validate_source,
                                    wait_guard, write_json)
from validate_sm603_ssgi_browser import (FIREFOX_PATH, GECKODRIVER_PATH,
                                        process_running, video_controller_inventory)
from validate_sm603_target_report import hardware_errors
from validate_webgpu_ssgi_browser import gpu_inventory

ROOT = Path(__file__).resolve().parents[1]
PRELOAD_URL = '/__sm505_firefox_observer__/preload.js'
PRELOAD_ERRORS = r"""'use strict';
globalThis.__sm505FirefoxObserver={phase:'bootstrap',errors:[],unhandledRejections:[],consoleErrors:[],dropped:{errors:0,unhandledRejections:0,consoleErrors:0}};
(() => {
 const state=globalThis.__sm505FirefoxObserver;
 const text=value=>{try{return String(value?.stack||value?.message||value)}catch(_){return '<unprintable>'}};
 const retain=(key,value)=>{state[key].push({phase:state.phase,message:text(value)});if(state[key].length>128){state[key].shift();state.dropped[key]++}};
 addEventListener('error',event=>retain('errors',event.error||event.message||event.target?.src||'resource error'),true);
 addEventListener('unhandledrejection',event=>retain('unhandledRejections',event.reason));
 const original=console.error;
 console.error=function(...values){retain('consoleErrors',values.map(text).join(' '));return original.apply(this,values)};
})();
"""
GAMEPLAY_SNAPSHOT = """JSON.stringify({room:game.room?.index,position:[game.x,game.y],
completed:[...game.state.completed].sort(),collectibles:[...game.state.moths].sort(),
companions:[...game.state.robots].sort(),released:[...game.state.released].sort()})"""


class UnsupportedCapability(RuntimeError):
    """Requested stock-browser capability is unavailable; never a passing skip."""


def sha_bytes(payload):
    return hashlib.sha256(payload).hexdigest()


def observer_payload(root=ROOT):
    """Return exact immutable response bytes and their original-source hashes."""
    paths = ['engine/render_fixture_adapter.js', 'engine/render_harness.js']
    sources = {name: (root / name).read_bytes() for name in paths}
    preload = PRELOAD_ERRORS.encode('utf-8') + b'\n' + b'\n'.join(sources.values())
    index = (root / 'index.html').read_bytes()
    marker = re.search(br'<head\b[^>]*>', index, re.IGNORECASE)
    if not marker:
        raise ValueError('normal index.html has no head insertion point')
    tag = ('\n<script src="' + PRELOAD_URL + '"></script>\n').encode('ascii')
    transformed = index[:marker.end()] + tag + index[marker.end():]
    return {'preload': preload, 'index': transformed, 'identity': {
        'originalIndexSha256': sha_bytes(index), 'servedIndexSha256': sha_bytes(transformed),
        'preloadSha256': sha_bytes(preload), 'errorObserverSha256': sha_bytes(PRELOAD_ERRORS.encode('utf-8')),
        'sourceSha256': {name: sha_bytes(value) for name, value in sources.items()},
        'preloadUrl': PRELOAD_URL,
        'boundary': 'Observer-only HTTP response insertion before ordinary index scripts; repository index/runtime bytes are unchanged. Canonical fixture adapter and harness run before game construction.'}}


class ObserverHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, observer, **kwargs):
        self.observer = observer
        super().__init__(*args, **kwargs)

    def log_message(self, *_):
        pass

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path in ('/', '/index.html', PRELOAD_URL):
            body = self.observer['preload'] if path == PRELOAD_URL else self.observer['index']
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript; charset=utf-8' if path == PRELOAD_URL else 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()


def query_configuration(args):
    return {'rendererBackend': 'webgl2', 'renderTest': 1, 'backend': 'webgl2',
            'fixture': args.fixture, 'quality': 'medium', 'webgpuQuality': 'Medium',
            'width': 1920, 'height': 1080, 'dpr': 1, 'lightAngle': args.angle,
            'seed': 1397572098, 'fixedTimeMs': 12000, 'settleFrames': 4,
            'inspection': args.inspection}


def firefox_preferences(override=False):
    preferences = {'layout.css.devPixelsPerPx': '1.0', 'browser.cache.disk.enable': False,
                   'browser.cache.memory.enable': False, 'network.http.use-cache': False}
    if override:
        preferences['dom.webgpu.enabled'] = True
    return preferences


def require_display(display, *, gpu=False):
    if not isinstance(display, dict) or display.get('viewport') != [1920, 1080] or display.get('dpr') != 1:
        raise RuntimeError('actual Firefox viewport must be 1920x1080 at DPR1; no resolution substitution')
    if display.get('canvas') != [1920, 1080]:
        raise RuntimeError('actual game canvas is not native1920x1080')
    if gpu and display.get('presentationCanvas') != [1920, 1080]:
        raise RuntimeError('actual WebGPU presentation canvas is not native1920x1080')


def require_hardware(report):
    errors = hardware_errors(report)
    renderer = str((report.get('webgl2') or {}).get('renderer') or '')
    if not re.search(r'GTX\s*1650\s*SUPER', renderer, re.IGNORECASE):
        errors.append('matched WebGL2 unmasked renderer does not identify GTX1650SUPER')
    if any(token in renderer.casefold() for token in ('swiftshader', 'warp', 'llvmpipe', 'software', 'basic render')):
        errors.append('matched browser renderer identifies software/non-target rendering')
    runtime = report.get('runtimeAfterSelection') or {}
    if any(runtime.get(key) != 'webgpu' for key in ('requestedBackend', 'activeBackend', 'presentationBackend')):
        errors.append('requested/active/presentation ownership is not WebGPU')
    if errors:
        raise RuntimeError('actual browser adapter identity not established: ' + '; '.join(errors))


def require_api_frame(runtime):
    presenter = runtime.get('webgpuPresenter') or {}
    device = runtime.get('webgpu') or {}
    if runtime.get('autoWebGPUEnabled') is not False or presenter.get('gtaoEnabled') is not False:
        raise RuntimeError('Auto or GTAO changed from the gated candidate configuration')
    if presenter.get('quality') != 'Medium' or presenter.get('extent') != {'width': 1920, 'height': 1080}:
        raise RuntimeError('native Medium presentation was not retained')
    if presenter.get('presentedFrames', 0) < 1 or presenter.get('ready') is not True:
        raise RuntimeError('no real normal-game WebGPU frame has completed')
    if presenter.get('lastError') or device.get('uncapturedErrors') or device.get('deviceLost'):
        raise RuntimeError('normal WebGPU frame has GPU/presentation errors')


def require_fallback_allowed(report):
    if report.get('apiProof', {}).get('realPresentedWebGPU') is not True:
        raise RuntimeError('deliberate fallback is forbidden before actual WebGPU API/frame proof')


def save_data_url(path, data):
    prefix = 'data:image/png;base64,'
    if not isinstance(data, str) or not data.startswith(prefix):
        raise RuntimeError('canvas did not return a PNG data URL')
    payload = base64.b64decode(data[len(prefix):], validate=True)
    if not payload.startswith(b'\x89PNG\r\n\x1a\n'):
        raise RuntimeError('canvas PNG signature invalid')
    path.write_bytes(payload)


class Session:
    def __init__(self, driver, client_config, deadline, guard_report):
        self.driver, self.client_config = driver, client_config
        self.deadline, self.guard_report = deadline, guard_report

    def remaining(self):
        seconds = self.deadline - time.monotonic()
        if seconds <= 0:
            raise TimeoutError('Firefox workload deadline expired')
        return seconds

    def call(self, method, *args):
        validate_guard(self.guard_report)
        self.client_config.timeout = min(30, self.remaining())
        return method(*args)

    def evaluate(self, expression):
        self.call(self.driver.set_script_timeout, min(25, self.remaining()))
        result = self.call(self.driver.execute_async_script, """
const done=arguments[arguments.length-1],source=arguments[0];
Promise.resolve().then(()=>eval(source)).then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error?.stack||error)}));
""", expression)
        if not isinstance(result, dict) or result.get('ok') is not True:
            raise RuntimeError('Firefox evaluation failed: ' + str(result))
        return result.get('value')

    def wait(self, expression, label):
        while self.remaining() > 0:
            result = self.evaluate(expression)
            if result:
                return result
            time.sleep(min(.15, self.remaining()))
        raise TimeoutError(label)


def prepare_viewport(session):
    session.call(session.driver.set_window_size, 1920, 1080)
    for _ in range(3):
        size = session.evaluate('({inner:[innerWidth,innerHeight],outer:[outerWidth,outerHeight],dpr:devicePixelRatio})')
        if size.get('inner') == [1920, 1080] and size.get('dpr') == 1:
            return size
        inner, outer = size['inner'], size['outer']
        session.call(session.driver.set_window_size, 1920 + outer[0] - inner[0], 1080 + outer[1] - inner[1])
    raise RuntimeError('Firefox could not establish native1920x1080/DPR1 viewport before navigation')


def execute(args, out, report, deadline):
    # Imports and explicit executable paths avoid Selenium Manager/download paths.
    from selenium import webdriver
    from selenium.webdriver.firefox.options import Options
    from selenium.webdriver.firefox.remote_connection import FirefoxRemoteConnection
    from selenium.webdriver.firefox.service import Service
    from selenium.webdriver.remote.client_config import ClientConfig
    import selenium

    binary, gecko = Path(args.browser), Path(args.geckodriver)
    if not binary.is_file() or not gecko.is_file():
        raise RuntimeError('installed Firefox and explicit geckodriver are required; no installation attempted')
    report['browserExecutableSha256'] = sha_bytes(binary.read_bytes())
    report['geckodriverSha256'] = sha_bytes(gecko.read_bytes())
    preferences = firefox_preferences(args.webgpu_preference_override)
    observer = observer_payload()
    report['injection'] = observer['identity']
    # Preserve exactly what was injected, independently of later source changes.
    (out / 'observer-preload.js').write_bytes(observer['preload'])
    (out / 'observer-index.html').write_bytes(observer['index'])
    handler = functools.partial(ObserverHandler, directory=str(ROOT), observer=observer)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    driver = service = session = profile = None
    try:
        profile = tempfile.TemporaryDirectory(prefix='sm505-firefox-', ignore_cleanup_errors=True)
        options = Options()
        options.binary_location = str(binary)
        if args.window_mode == 'headless':
            options.add_argument('-headless')
        options.add_argument('-profile')
        options.add_argument(profile.name)
        for key, value in preferences.items():
            options.set_preference(key, value)
        service = Service(executable_path=str(gecko), log_output=str(out / 'geckodriver.log'),
                          popen_kw={'creation_flags': getattr(subprocess, 'CREATE_NO_WINDOW', 0)} if os.name == 'nt' else {})
        if Path(service.path).resolve() != gecko.resolve():
            raise RuntimeError('Selenium environment replaced the explicit geckodriver path')
        validate_guard(args.guard_report)
        service.start()
        report['geckodriverProcessId'] = service.process.pid
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Firefox service startup exhausted workload deadline')
        client = ClientConfig(remote_server_addr=service.service_url, timeout=min(30, remaining),
                              init_args_for_pool_manager={'init_args_for_pool_manager': {'retries': False}})
        connection = FirefoxRemoteConnection(service.service_url, client_config=client)
        driver = webdriver.Remote(command_executor=connection, options=options)
        session = Session(driver, client, deadline, args.guard_report)
        caps = driver.capabilities
        report['browser'] = {'kind': 'firefox', 'version': caps.get('browserVersion'),
            'buildId': caps.get('moz:buildID'), 'processId': caps.get('moz:processID'),
            'freshProcess': True, 'freshProfile': True, 'profileIdentity': Path(profile.name).name,
            'windowMode': args.window_mode, 'preferences': preferences,
            'webgpuPreferenceOverride': args.webgpu_preference_override,
            'webdriverHttpRetries': False,
            'seleniumVersion': selenium.__version__, 'binary': str(binary), 'geckodriver': str(gecko),
            'defaultBrowserCompatibilityClaim': False,
            'boundary': 'Fresh native process/profile; DPR/cache observer preferences are explicit. Headless/windowed and optional WebGPU preference override are distinct configurations.'}
        if caps.get('browserName', '').lower() != 'firefox' or not re.fullmatch(r'[0-9]+(?:\.[0-9]+)*', str(caps.get('browserVersion', ''))):
            raise RuntimeError('installed stable Firefox browser/version proof unavailable')
        if type(caps.get('moz:processID')) is not int:
            raise RuntimeError('owned Firefox process identity unavailable')
        report['viewportSetup'] = prepare_viewport(session)
        session.call(driver.set_page_load_timeout, min(30, session.remaining()))
        query = urllib.parse.urlencode(query_configuration(args))
        report['localUrl'] = f'http://127.0.0.1:{server.server_port}/index.html?{query}'
        session.call(driver.get, report['localUrl'])
        state = session.wait("(()=>{const e=document.body?.dataset.renderTestError;if(e)throw new Error('fixture bootstrap failed:'+e);return document.body?.dataset.renderTestReady==='1'?SteelMothRenderHarness.result:null})()", 'fixture bootstrap')
        report['fixtureMetadata'] = state.get('metadata')
        report['webgl2'] = session.evaluate("""(()=>{game.loop=()=>{};game.__smHarnessRenderOnce();const g=game.renderer.gl,e=g.getExtension('WEBGL_debug_renderer_info');return {renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):null,vendor:e?g.getParameter(e.UNMASKED_VENDOR_WEBGL):null,display:{viewport:[innerWidth,innerHeight],screen:[screen.width,screen.height],dpr:devicePixelRatio,canvas:[game.canvas.width,game.canvas.height]},runtime:steelMothBackendRuntime.diagnostics(),scene:game.renderScene}})()""")
        require_display(report['webgl2']['display'])
        save_data_url(out / 'webgl2-canvas.png', session.evaluate("game.canvas.toDataURL('image/png')"))
        session.call(driver.save_screenshot, str(out / 'webgl2-presented.png'))
        session.evaluate("__sm505FirefoxObserver.phase='webgpu-selection'")
        if not session.evaluate('!!navigator.gpu'):
            raise UnsupportedCapability('stable-profile navigator.gpu is unavailable; WebGL2 fallback is not a WebGPU PASS')
        report['runtimeAfterSelection'] = session.evaluate("steelMothBackendRuntime.select('webgpu',{persist:false})")
        if report['runtimeAfterSelection'].get('presentationBackend') != 'webgpu':
            raise UnsupportedCapability('explicit WebGPU selection did not acquire normal presentation; fallback/unsupported remains FAIL')
        report['smoke'] = {'gpu': session.evaluate("({adapterInfo:steelMothBackendRuntime.manager.diagnostics().adapterInfo,isFallbackAdapter:steelMothBackendRuntime.manager.adapter.isFallbackAdapter??steelMothBackendRuntime.manager.adapter.info?.isFallbackAdapter??null})")}
        require_hardware(report)
        session.evaluate('game.__smHarnessRenderOnce()')
        report['runtimeAfterFrame'] = session.wait("(()=>{const r=steelMothBackendRuntime;if(r.presentationBackend!=='webgpu')throw new Error('WebGPU frame failed:'+JSON.stringify(r.diagnostics()));return !r.presenter.rendering&&r.presenter.presentedFrames>=1?r.diagnostics():null})()", 'actual WebGPU frame')
        require_api_frame(report['runtimeAfterFrame'])
        report['webgpuDisplay'] = session.evaluate("({viewport:[innerWidth,innerHeight],screen:[screen.width,screen.height],dpr:devicePixelRatio,canvas:[game.canvas.width,game.canvas.height],presentationCanvas:[steelMothBackendRuntime.presenter.canvas.width,steelMothBackendRuntime.presenter.canvas.height]})")
        require_display(report['webgpuDisplay'], gpu=True)
        save_data_url(out / 'webgpu-canvas.png', session.evaluate("steelMothBackendRuntime.presenter.canvas.toDataURL('image/png')"))
        session.call(driver.save_screenshot, str(out / 'webgpu-presented.png'))
        report['apiProof'] = {'realPresentedWebGPU': True, 'actualAdapterEstablished': True,
            'source': 'normal index bootstrap + explicit production presenter + completed frame + native adapter/GL/inventory checks'}
        errors = session.evaluate('JSON.parse(JSON.stringify(__sm505FirefoxObserver))')
        report['observerBeforeFallback'] = errors
        if any(errors.get(key) for key in ('errors', 'unhandledRejections', 'consoleErrors')):
            raise RuntimeError('unexpected page/resource/rejection/console errors; inspect retained observer state')
        if args.exercise_runtime_fallback:
            require_fallback_allowed(report)
            before = session.evaluate(GAMEPLAY_SNAPSHOT)
            session.evaluate("__sm505FirefoxObserver.phase='deliberate-runtime-fallback';steelMothBackendRuntime._presenterFailed(steelMothBackendRuntime.presenter,new Error('sm505-firefox-deliberate-runtime-fallback'));game.__smHarnessRenderOnce()")
            fallback = session.evaluate('steelMothBackendRuntime.diagnostics()')
            after = session.evaluate(GAMEPLAY_SNAPSHOT)
            remaining_canvas = session.evaluate("document.querySelectorAll('#webgpuPresentation').length")
            if fallback.get('activeBackend') != 'webgl2' or fallback.get('presentationBackend') != 'webgl2' or fallback.get('status') != 'fallback-runtime' or remaining_canvas != 0 or before != after:
                raise RuntimeError('deliberate runtime fallback failed ownership/surface/gameplay integrity')
            report['deliberateFallback'] = {'ok': True, 'runtime': fallback, 'gameplayBefore': before, 'gameplayAfter': after, 'remainingWebGPUCanvases': remaining_canvas}
            session.call(driver.save_screenshot, str(out / 'fallback-presented.png'))
        report['observerFinal'] = session.evaluate('JSON.parse(JSON.stringify(__sm505FirefoxObserver))')
        if any(report['observerFinal'].get(key) for key in ('errors', 'unhandledRejections', 'consoleErrors')):
            raise RuntimeError('unexpected page/resource/rejection/console errors after presentation/fallback')
        report['guardAfter'] = validate_guard(args.guard_report)
        report['executionChecksPassed'] = True
    except Exception:
        if session is not None:
            try:
                report['failureState'] = session.evaluate("({observer:globalThis.__sm505FirefoxObserver,runtime:globalThis.steelMothBackendRuntime?.diagnostics?.(),ready:document.body?.dataset.renderTestReady})")
                session.call(driver.save_screenshot, str(out / 'failure-presented.png'))
            except Exception as error:
                report['failureCaptureError'] = str(error)
        raise
    finally:
        if driver is not None:
            try:
                if session is not None:
                    session.client_config.timeout = 5
                driver.quit()
            except Exception as error:
                report['driverQuitError'] = str(error)
        if service is not None:
            try:
                service.stop()
            except Exception as error:
                report['serviceStopError'] = str(error)
            process = getattr(service, 'process', None)
            report['geckodriverProcessExited'] = process is None or process.poll() is not None
        browser_pid = (report.get('browser') or {}).get('processId')
        if browser_pid:
            cleanup_deadline = time.monotonic() + 3
            while process_running(browser_pid) is True and time.monotonic() < cleanup_deadline:
                time.sleep(.1)
            report['browserProcessExited'] = process_running(browser_pid) is False
            if not report['browserProcessExited']:
                report['cleanupError'] = 'owned Firefox exit could not be proved; outer physical guard retains descendant ownership'
        try:
            if profile is not None:
                profile.cleanup()
        except Exception as error:
            report['profileCleanupError'] = str(error)
        finally:
            server.shutdown()
            server.server_close()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hardware', action='store_true', required=True)
    parser.add_argument('--guard-report', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--browser', default=FIREFOX_PATH)
    parser.add_argument('--geckodriver', default=GECKODRIVER_PATH)
    parser.add_argument('--window-mode', choices=('headless', 'windowed'), default='headless')
    parser.add_argument('--webgpu-preference-override', action='store_true', help='Separate diagnostic only: enable dom.webgpu.enabled in disposable profile; no automatic retry')
    parser.add_argument('--inspection', choices=('none', 'development'), default='none')
    parser.add_argument('--fixture', default='single-box')
    parser.add_argument('--angle', type=int, choices=range(0, 360, 45), default=0)
    parser.add_argument('--timeout', type=float, default=180)
    parser.add_argument('--exercise-runtime-fallback', action='store_true')
    args = parser.parse_args(argv)
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 600:
        parser.error('--timeout must be finite1..600seconds')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}', args.fixture) or not (ROOT / 'render-tests/fixtures' / (args.fixture + '.json')).is_file():
        parser.error('fixture must name an existing canonical fixture')
    if args.out.exists():
        parser.error('output directory must be new; original evidence cannot be overwritten')
    return args


def main(argv=None):
    args = parse_args(argv)
    out = args.out.resolve()
    out.mkdir(parents=True)
    deadline = time.monotonic() + args.timeout
    report = {'schema': 'steelmoth-sm505-firefox-normal-diagnostic/v1', 'runId': str(uuid.uuid4()),
        'ok': False, 'executionChecksPassed': False, 'status': 'FAIL', 'startedAt': utc_now().isoformat(),
        'hardwareRequested': True, 'softwareRequested': False, 'physicalAcceptance': False,
        'visualAcceptance': False, 'performanceAcceptance': False, 'releaseAcceptance': False,
        'configuration': {**query_configuration(args), 'windowMode': args.window_mode,
            'webgpuPreferenceOverride': args.webgpu_preference_override},
        'source': None, 'sourceAfter': None, 'errors': [], 'hostPlatform': platform.platform(),
        'boundary': 'Source-matched native Firefox normal-index execution/captures only. Visual parity, performance targets and release acceptance require independent gates. Unsupported API/proof is failure; no retries.'}
    try:
        report['guardBefore'] = wait_guard(args.guard_report)
        report['source'] = source_identity()
        validate_source(report['source'])
        report['gpuInventory'] = gpu_inventory()
        report['videoControllers'] = video_controller_inventory()
        execute(args, out, report, deadline)
        report['sourceAfter'] = source_identity()
        if not same_source(report['source'], report['sourceAfter']):
            raise RuntimeError('candidate source changed during Firefox diagnostic')
        if not report.get('browserProcessExited') or not report.get('geckodriverProcessExited') or report.get('cleanupError') or report.get('driverQuitError') or report.get('serviceStopError'):
            raise RuntimeError('owned Firefox/geckodriver cleanup is not verified')
        report['ok'] = True
        report['status'] = 'EXECUTION_CHECKS_PASS'
    except Exception as error:
        report['errors'].append(f'{type(error).__name__}: {error}')
        report['status'] = 'UNSUPPORTED_FAIL' if isinstance(error, UnsupportedCapability) else 'FAIL'
    finally:
        if report['source'] is not None and report['sourceAfter'] is None:
            try:
                report['sourceAfter'] = source_identity()
                report['sourceStable'] = same_source(report['source'], report['sourceAfter'])
            except Exception as error:
                report['sourceAfterError'] = str(error)
        report['completedAt'] = utc_now().isoformat()
        write_json(out / 'report.json', report)
        manifest(out)
    print(json.dumps({'ok': report['ok'], 'status': report['status'], 'errors': report['errors'], 'report': str(out / 'report.json')}))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
