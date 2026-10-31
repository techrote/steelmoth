#!/usr/bin/env python3
"""CPU-only Firefox diagnostic safeguards; never starts a driver/browser/GPU."""
from __future__ import annotations

import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import diagnose_sm505_firefox as runner


def hardware_report():
    return {'hardwareRequested': True, 'softwareRequested': False,
        'smoke': {'gpu': {'adapterInfo': {'vendor': 'nvidia', 'architecture': 'turing'}, 'isFallbackAdapter': False}},
        'gpuInventory': {'available': True, 'devices': [{'name': 'NVIDIA GeForce GTX 1650 SUPER',
            'memoryMiB': 4096, 'driver': '616.92', 'pciBusId': '0000:07:00.0'}]},
        'videoControllers': {'available': True, 'devices': [{'Name': 'NVIDIA GeForce GTX 1650 SUPER',
            'PNPDeviceID': 'PCI\\VEN_10DE&DEV_2187', 'DriverVersion': '32.0.16.1692'}]},
        'webgl2': {'renderer': 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 SUPER Direct3D11)'},
        'runtimeAfterSelection': {'requestedBackend': 'webgpu', 'activeBackend': 'webgpu', 'presentationBackend': 'webgpu'}}


class InjectionTests(unittest.TestCase):
    def test_external_preload_precedes_runtime_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'engine').mkdir()
            index = b'<html><head><meta charset="utf-8"></head><body><script src="engine/game.js"></script></body></html>'
            (root / 'index.html').write_bytes(index)
            for name in ('render_fixture_adapter.js', 'render_harness.js'):
                (root / 'engine' / name).write_text('// ' + name + '\r\n', encoding='utf-8')
            payload = runner.observer_payload(root)
            self.assertLess(payload['index'].index(runner.PRELOAD_URL.encode()), payload['index'].index(b'engine/game.js'))
            self.assertEqual((root / 'index.html').read_bytes(), index)
            self.assertEqual(payload['identity']['originalIndexSha256'], hashlib.sha256(index).hexdigest())
            self.assertEqual(payload['identity']['preloadSha256'], hashlib.sha256(payload['preload']).hexdigest())
            self.assertEqual(payload['identity']['servedIndexSha256'], hashlib.sha256(payload['index']).hexdigest())
            for name, digest in payload['identity']['sourceSha256'].items():
                self.assertEqual(digest, hashlib.sha256((root / name).read_bytes()).hexdigest())

    def test_http_handler_serves_exact_transformation_no_store(self):
        handler = object.__new__(runner.ObserverHandler)
        handler.observer = {'preload': b'// exact observer', 'index': b'<html>exact index</html>'}
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        for path, expected in [('/index.html?renderTest=1', handler.observer['index']),
                               (runner.PRELOAD_URL, handler.observer['preload'])]:
            handler.path = path
            handler.wfile = io.BytesIO()
            handler.do_GET()
            self.assertEqual(handler.wfile.getvalue(), expected)
            handler.send_header.assert_any_call('Cache-Control', 'no-store')
            handler.send_header.assert_any_call('Content-Length', str(len(expected)))

    def test_default_preferences_never_force_webgpu_or_software(self):
        prefs = runner.firefox_preferences()
        self.assertNotIn('dom.webgpu.enabled', prefs)
        self.assertNotIn('webgl.force-enabled', prefs)
        self.assertNotIn('gfx.webrender.all', prefs)
        override = runner.firefox_preferences(True)
        self.assertTrue(override.pop('dom.webgpu.enabled'))
        self.assertEqual(override, prefs)


class ProofTests(unittest.TestCase):
    def test_actual_native_proof(self):
        runner.require_hardware(hardware_report())

    def test_wrong_browser_gl_gpu_cannot_borrow_host_inventory(self):
        for renderer in ('ANGLE (SwiftShader)', 'NVIDIA RTX4090', 'WARP GTX1650SUPER', None):
            report = hardware_report()
            report['webgl2']['renderer'] = renderer
            with self.subTest(renderer=renderer), self.assertRaises(RuntimeError):
                runner.require_hardware(report)

    def test_software_fallback_unknown_adapter_and_wrong_host_refused(self):
        mutations = [lambda r:r['smoke']['gpu'].update(isFallbackAdapter=True),
                     lambda r:r['smoke']['gpu'].update(adapterInfo={'vendor':'swiftshader'}),
                     lambda r:r['smoke']['gpu'].update(adapterInfo={},isFallbackAdapter=None),
                     lambda r:r['gpuInventory']['devices'][0].update(memoryMiB=8192),
                     lambda r:r['runtimeAfterSelection'].update(presentationBackend='webgl2')]
        for mutate in mutations:
            report = hardware_report()
            mutate(report)
            with self.assertRaises(RuntimeError):
                runner.require_hardware(report)

    def test_native_extent_required(self):
        display = {'viewport':[1920,1080], 'dpr':1, 'canvas':[1920,1080], 'presentationCanvas':[1920,1080]}
        runner.require_display(display, gpu=True)
        for key, value in [('viewport',[1280,720]),('canvas',[640,360]),('presentationCanvas',[640,360]),('dpr',2)]:
            bad = {**display,key:value}
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                runner.require_display(bad, gpu=True)

    def test_backend_initialization_is_not_real_frame_proof(self):
        runtime = {'autoWebGPUEnabled':False,'webgpu':{'uncapturedErrors':[]},
            'webgpuPresenter':{'ready':True,'gtaoEnabled':False,'quality':'Medium','extent':{'width':1920,'height':1080},'presentedFrames':1}}
        runner.require_api_frame(runtime)
        for key, value in [('presentedFrames',0),('gtaoEnabled',True),('quality','Low'),('lastError','device lost')]:
            bad = copy.deepcopy(runtime)
            bad['webgpuPresenter'][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                runner.require_api_frame(bad)
        bad = copy.deepcopy(runtime)
        bad['webgpu']['uncapturedErrors'] = [{'message':'validation failure'}]
        with self.assertRaises(RuntimeError):
            runner.require_api_frame(bad)

    def test_fallback_forbidden_until_real_api_proof(self):
        for report in ({}, {'apiProof':{'realPresentedWebGPU':False}}):
            with self.assertRaises(RuntimeError):
                runner.require_fallback_allowed(report)
        runner.require_fallback_allowed({'apiProof':{'realPresentedWebGPU':True}})


class SessionTests(unittest.TestCase):
    def test_invalid_guard_prevents_dispatch(self):
        driver, client = Mock(), SimpleNamespace(timeout=None)
        session = runner.Session(driver, client, 200, Path('guard.json'))
        with patch.object(runner,'validate_guard',side_effect=ValueError('not owned')), self.assertRaises(ValueError):
            session.call(driver.get, 'http://localhost/')
        driver.get.assert_not_called()

    def test_expired_workload_prevents_dispatch(self):
        driver, client = Mock(), SimpleNamespace(timeout=None)
        session = runner.Session(driver, client, 200, Path('guard.json'))
        with patch.object(runner,'validate_guard'), patch.object(runner.time,'monotonic',return_value=201), self.assertRaises(TimeoutError):
            session.call(driver.get, 'http://localhost/')
        driver.get.assert_not_called()

    def test_async_errors_are_not_swallowed_or_retried(self):
        driver = Mock()
        driver.execute_async_script.return_value = {'ok':False,'error':'shader compilation failure'}
        session = runner.Session(driver, SimpleNamespace(timeout=None), 200, Path('guard.json'))
        with patch.object(runner,'validate_guard'), patch.object(runner.time,'monotonic',return_value=190), self.assertRaisesRegex(RuntimeError,'shader'):
            session.evaluate('fixture()')
        driver.execute_async_script.assert_called_once()
        self.assertEqual(session.client_config.timeout,10)


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name) / 'attempt'
        self.args = ['--hardware','--guard-report','guard.json','--out',str(self.out)]

    def test_cli_requires_hardware_and_active_guard_path(self):
        for args in (self.args[1:], ['--hardware','--out',str(self.out)], self.args+['--timeout','nan'],self.args+['--fixture','../unsafe']):
            with patch('sys.stderr'), self.assertRaises(SystemExit):
                runner.parse_args(args)

    def test_defaults_are_canonical_and_modes_explicit(self):
        args = runner.parse_args(self.args)
        self.assertEqual(args.window_mode,'headless')
        self.assertFalse(args.webgpu_preference_override)
        self.assertEqual(args.inspection,'none')
        self.assertEqual(runner.query_configuration(args)['width'],1920)
        self.assertEqual(runner.query_configuration(args)['height'],1080)
        self.assertEqual(runner.query_configuration(args)['dpr'],1)
        self.assertEqual(runner.query_configuration(args)['webgpuQuality'],'Medium')
        args = runner.parse_args(self.args+['--window-mode','windowed','--inspection','development','--webgpu-preference-override'])
        self.assertEqual(args.window_mode,'windowed')
        self.assertTrue(args.webgpu_preference_override)
        self.assertEqual(args.inspection,'development')

    def injected_main(self, execute):
        source = {'commit':'source','tree':'tree','fileSha256':{'runner':'hash'}}
        with patch.object(runner,'wait_guard',return_value={'childPid':123}), \
             patch.object(runner,'source_identity',return_value=source), \
             patch.object(runner,'validate_source'), \
             patch.object(runner,'gpu_inventory',return_value={}), \
             patch.object(runner,'video_controller_inventory',return_value={}), \
             patch.object(runner,'execute',execute),patch('builtins.print'):
            result = runner.main(self.args)
        return result,json.loads((self.out/'report.json').read_text())

    def test_unsupported_api_is_fail_and_no_retry(self):
        execute = Mock(side_effect=runner.UnsupportedCapability('navigator.gpu unavailable'))
        result, report = self.injected_main(execute)
        self.assertEqual(result,1)
        self.assertEqual(report['status'],'UNSUPPORTED_FAIL')
        self.assertFalse(report['ok'])
        self.assertFalse(report['physicalAcceptance'])
        execute.assert_called_once()
        self.assertTrue((self.out/'SHA256SUMS.txt').is_file())

    def test_guard_failure_never_starts_execution(self):
        with patch.object(runner,'wait_guard',side_effect=RuntimeError('guard inactive')), \
             patch.object(runner,'execute') as execute,patch('builtins.print'):
            self.assertEqual(runner.main(self.args),1)
        execute.assert_not_called()
        report = json.loads((self.out/'report.json').read_text())
        self.assertIn('guard inactive',report['errors'][0])

    def test_execution_success_cannot_claim_visual_performance_release(self):
        def success(args,out,report,deadline):
            report.update(executionChecksPassed=True,browserProcessExited=True,geckodriverProcessExited=True)
        result,report = self.injected_main(Mock(side_effect=success))
        self.assertEqual(result,0)
        self.assertEqual(report['status'],'EXECUTION_CHECKS_PASS')
        for key in ('physicalAcceptance','visualAcceptance','performanceAcceptance','releaseAcceptance'):
            self.assertIs(report[key],False)

    def test_owned_cleanup_failure_prevents_success(self):
        def failed_cleanup(args,out,report,deadline):
            report.update(executionChecksPassed=True,browserProcessExited=False,geckodriverProcessExited=True)
        result,report = self.injected_main(Mock(side_effect=failed_cleanup))
        self.assertEqual(result,1)
        self.assertFalse(report['ok'])

    def test_existing_evidence_refused(self):
        self.out.mkdir()
        marker=self.out/'original.txt'
        marker.write_text('original failure')
        with patch('sys.stderr'),self.assertRaises(SystemExit):
            runner.parse_args(self.args)
        self.assertEqual(marker.read_text(),'original failure')


if __name__ == '__main__':
    unittest.main(verbosity=2)
