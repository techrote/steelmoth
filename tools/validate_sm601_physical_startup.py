#!/usr/bin/env python3
"""CPU-only main-diagnostic startup and browser-identity fault witnesses."""
from __future__ import annotations

import argparse
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
HEAD = '0618a5ef5d97a3087361f04153ba436762add437'
spec = importlib.util.spec_from_file_location('physical_diagnostic_runner', ROOT / 'tools/run_sm601_physical_diagnostic.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
PAGE = {'type': 'page', 'webSocketDebuggerUrl': 'ws://127.0.0.1:9222/devtools/page/test'}
VERSION = {'product': 'Chrome/154.0.8037.92', 'protocolVersion': '1.3',
           'jsVersion': '14.4.141', 'userAgent': 'Chrome/154.0.0.0'}


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class StartupTests(unittest.TestCase):
    def helper(self, reads, inventories, *, status=None, deadline=1):
        clock = Clock()
        port = Mock(read_text=Mock(side_effect=reads))
        endpoint = Mock(side_effect=lambda *_args, **_kwargs: io.StringIO(json.dumps(inventories.pop(0))))
        process = Mock(poll=Mock(return_value=status))
        startup = runner.BrowserStartup(process, port, deadline,
                                        clock=clock, sleep=clock.sleep, opener=endpoint)
        return startup, clock, port, endpoint

    def test_port_writer_busy_incomplete_then_endpoint_without_page(self):
        startup, clock, port, endpoint = self.helper(
            [PermissionError('sharing violation'), '', '9222', '9222'], [[], [PAGE]])
        self.assertEqual(startup.wait_for_page(), PAGE)
        self.assertEqual(port.read_text.call_count, 4)
        self.assertEqual(endpoint.call_count, 2)
        self.assertAlmostEqual(clock.now, .3)
        self.assertLessEqual(endpoint.call_args.kwargs['timeout'], .7 + 1e-12)

    def test_immediate_page_and_exited_process(self):
        startup, clock, _port, _endpoint = self.helper(['9222'], [[PAGE]])
        self.assertEqual(startup.wait_for_page(), PAGE)
        self.assertEqual(clock.now, 0)
        startup, _clock, port, endpoint = self.helper(['9222'], [[PAGE]], status=3)
        with self.assertRaisesRegex(RuntimeError, 'exited.*3'):
            startup.wait_for_page()
        port.read_text.assert_not_called()
        endpoint.assert_not_called()

    def test_busy_file_cannot_extend_deadline(self):
        startup, clock, port, endpoint = self.helper([], [], deadline=.25)
        port.read_text.side_effect = PermissionError('sharing violation')
        with self.assertRaisesRegex(TimeoutError, 'PermissionError: sharing violation'):
            startup.wait_for_page()
        self.assertAlmostEqual(clock.now, .25)
        endpoint.assert_not_called()

    def test_startup_failure_missing_metadata_preserves_original_error(self):
        error = 'PermissionError: Chrome startup writer busy'
        runs = [{'ok': True, 'browser': {'version': dict(VERSION)}},
                {'ok': True, 'browser': {'version': dict(VERSION)}},
                {'ok': False, 'partialEvidence': True, 'error': error, 'browser': {'version': None}}]
        runner.validate_browser_identity(runs)
        self.assertEqual(runs[-1]['error'], error)
        self.assertTrue(runs[-1]['partialEvidence'])
        self.assertIsNone(runs[-1]['browser']['version'])

    def test_only_successful_established_identity_fields_are_compared(self):
        runner.validate_browser_identity([{'ok': False, 'browser': None}])
        runner.validate_browser_identity([
            {'ok': True, 'browser': {'version': {**VERSION, 'revision': 'one'}}},
            {'ok': True, 'browser': {'version': {**VERSION, 'revision': 'two'}}},
            {'ok': False, 'browser': {'version': {**VERSION, 'product': 'Other browser'}}}])
        for field in runner.BROWSER_IDENTITY_FIELDS:
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, 'Browser version changed'):
                runner.validate_browser_identity([
                    {'ok': True, 'browser': {'version': dict(VERSION)}},
                    {'ok': True, 'browser': {'version': {**VERSION, field: VERSION[field] + '-changed'}}}])

    def test_success_without_complete_identity_is_distinct_failure(self):
        with self.assertRaisesRegex(RuntimeError, 'incomplete browser identity'):
            runner.validate_browser_identity([{'ok': True, 'browser': {'version': None}}])
        with self.assertRaisesRegex(RuntimeError, 'incomplete browser identity'):
            runner.validate_browser_identity([{'ok': True, 'browser': {'version': {'product': VERSION['product']}}}])

    def test_measurement_source_and_budgets_preserved(self):
        def frozen(name):
            return subprocess.run(['git', 'show', f'{HEAD}:{name}'], cwd=ROOT, check=True,
                                  capture_output=True, text=True).stdout
        name = 'webgpu-gtao-physical-diagnostic.html'
        self.assertEqual((ROOT / name).read_text(), frozen(name))
        name = 'tools/run_sm601_physical_diagnostic.py'
        actual, original = (ROOT / name).read_text(), frozen(name)
        start, end = "                version = cdp.call('Browser.getVersion')", '\ndef main()'
        self.assertEqual(actual[actual.index(start):actual.index(end)],
                         original[original.index(start):original.index(end)])
        start, end = "    parser = argparse.ArgumentParser", "    result = {'schema'"
        self.assertEqual(actual[actual.index(start):actual.index(end)],
                         original[original.index(start):original.index(end)])
        self.assertIn("result['error'] = payload.get('error')", actual)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(StartupTests))
    payload = {'schema': 'steelmoth-sm601-physical-startup-validation/v1', 'ok': result.wasSuccessful(),
               'testsRun': result.testsRun, 'previousDiagnosticSource': HEAD,
               'failures': [str(error) for _test, error in result.failures + result.errors],
               'evidenceBoundary': 'CPU startup/metadata fault injection and source preservation; no physical GPU evidence.',
               'targetAcceptance': False}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(payload, indent=2) + '\n')
    print(json.dumps({key: payload[key] for key in ('ok', 'testsRun', 'targetAcceptance')}))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
