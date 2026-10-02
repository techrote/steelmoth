#!/usr/bin/env python3
"""CPU-only regression for the reference runner's bounded startup discovery."""
from __future__ import annotations

import io
import json
import types
import unittest
from unittest.mock import patch

import validate_webgpu_gtao_reference_browser as runner


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


if __name__ == '__main__':
    unittest.main(verbosity=2)
