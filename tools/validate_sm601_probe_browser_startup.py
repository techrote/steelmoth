#!/usr/bin/env python3
"""CPU-only regression for the probe's inherited bounded startup discovery."""
from __future__ import annotations

import io
import json
import types
import unittest
from unittest.mock import Mock, patch

import sm601_probe_browser_startup as runner


class StartupTests(unittest.TestCase):
    page = {'type': 'page', 'webSocketDebuggerUrl': 'ws://127.0.0.1:123/devtools/page/test'}

    def invoke(self, inventories, *, exit_code=None, deadline=1):
        clock = [0.0]
        requests = []
        values = iter(inventories)

        def fetch(url, timeout):
            requests.append((url, timeout))
            return io.BytesIO(json.dumps(next(values)).encode())

        def sleep(seconds):
            self.assertGreaterEqual(seconds, 0)
            clock[0] += seconds

        proc = types.SimpleNamespace(poll=lambda: exit_code)
        with patch.object(runner.urllib.request, 'urlopen', side_effect=fetch), \
             patch.object(runner.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(runner.time, 'sleep', side_effect=sleep):
            result = runner.wait_for_page_target(123, proc, deadline)
        return result, requests, clock[0]

    def test_immediate_page(self):
        result, requests, elapsed = self.invoke([[self.page]])
        self.assertEqual(result, self.page)
        self.assertEqual(len(requests), 1)
        self.assertEqual(elapsed, 0)

    def test_port_ready_before_page(self):
        result, requests, elapsed = self.invoke([[], [{'type': 'service_worker'}], [self.page]])
        self.assertEqual(result, self.page)
        self.assertEqual(len(requests), 3)
        self.assertAlmostEqual(elapsed, .2)
        self.assertLessEqual(requests[-1][1], .8)

    def test_incomplete_page_endpoint_is_not_ready(self):
        result, requests, _ = self.invoke([[{'type': 'page'}], [{'type': 'page', 'webSocketDebuggerUrl': ''}], [self.page]])
        self.assertEqual(result, self.page)
        self.assertEqual(len(requests), 3)

    def test_browser_exit_fails_before_request(self):
        with self.assertRaisesRegex(RuntimeError, 'exit=7'):
            self.invoke([], exit_code=7)

    def test_missing_target_has_bounded_deadline(self):
        with self.assertRaisesRegex(TimeoutError, 'target types'):
            self.invoke([[], []], deadline=.15)

    def test_malformed_inventory_is_not_retried(self):
        with self.assertRaisesRegex(RuntimeError, 'JSON list'):
            self.invoke([{'error': 'unusable'}])

    def test_nonpage_items_ignored(self):
        result, _, _ = self.invoke([[None, 'bad', {'type': 'worker'}, self.page]])
        self.assertEqual(result, self.page)


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class PortFileStartupTests(unittest.TestCase):
    page = StartupTests.page

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
            [PermissionError('sharing violation'), '', '9222', '9222'], [[], [self.page]])
        self.assertEqual(startup.wait_for_page(), self.page)
        self.assertEqual(port.read_text.call_count, 4)
        self.assertEqual(endpoint.call_count, 2)
        self.assertAlmostEqual(clock.now, .3)
        self.assertLessEqual(endpoint.call_args.kwargs['timeout'], .7 + 1e-12)

    def test_immediate_page_and_exited_process(self):
        startup, clock, _port, _endpoint = self.helper(['9222'], [[self.page]])
        self.assertEqual(startup.wait_for_page(), self.page)
        self.assertEqual(clock.now, 0)
        startup, _clock, port, endpoint = self.helper(['9222'], [[self.page]], status=3)
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

    def test_missing_incomplete_and_invalid_ports_wait_for_valid_writer_output(self):
        startup, clock, port, endpoint = self.helper(
            [FileNotFoundError('not written'), '', 'partial', '-1', '0', '65536', '9222'],
            [[self.page]])
        self.assertEqual(startup.wait_for_page(), self.page)
        self.assertEqual(port.read_text.call_count, 7)
        self.assertEqual(endpoint.call_count, 1)
        self.assertAlmostEqual(clock.now, .6)

    def test_invalid_port_never_requests_endpoint_or_extends_deadline(self):
        for value in ('partial', '-1', '0', '65536'):
            with self.subTest(port=value):
                startup, clock, port, endpoint = self.helper([], [], deadline=.15)
                port.read_text.side_effect = None
                port.read_text.return_value = value
                with self.assertRaisesRegex(TimeoutError, 'ValueError'):
                    startup.wait_for_page()
                self.assertAlmostEqual(clock.now, .15)
                endpoint.assert_not_called()

    def test_transient_endpoint_connection_failure_does_not_restart_process(self):
        startup, clock, port, endpoint = self.helper(['9222', '9222'], [])
        endpoint.side_effect = [ConnectionError('startup socket not ready'),
                                io.StringIO(json.dumps([self.page]))]
        self.assertEqual(startup.wait_for_page(), self.page)
        self.assertEqual(port.read_text.call_count, 2)
        self.assertEqual(endpoint.call_count, 2)
        self.assertAlmostEqual(clock.now, .1)

    def test_nonwebsocket_page_is_not_accepted(self):
        startup, clock, _port, endpoint = self.helper(['9222', '9222'],
            [[{'type': 'page', 'webSocketDebuggerUrl': 'http://not-a-websocket'}], [self.page]])
        self.assertEqual(startup.wait_for_page(), self.page)
        self.assertEqual(endpoint.call_count, 2)
        self.assertAlmostEqual(clock.now, .1)

    def test_response_after_deadline_is_not_accepted(self):
        startup, clock, _port, endpoint = self.helper(['9222'], [], deadline=.15)

        def response(*_args, **_kwargs):
            clock.now = .2
            return io.StringIO(json.dumps([self.page]))

        endpoint.side_effect = response
        with self.assertRaisesRegex(TimeoutError, 'startup timed out'):
            startup.wait_for_page()
        self.assertEqual(endpoint.call_count, 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
