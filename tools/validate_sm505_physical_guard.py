#!/usr/bin/env python3
"""Deterministic safety/identity tests; never starts a browser or GPU workload."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch

import sm505_physical_guard as guard


UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 31, 0, 0, tzinfo=UTC)
ROW = 'NVIDIA GeForce GTX 1650 SUPER, GPU-target, 616.92, 4096, 33, 6.4, 360, 405, 128, 0'


class TelemetryTests(unittest.TestCase):
    def test_identity_and_units(self):
        sample = guard.parse_telemetry(ROW)
        self.assertEqual(sample['uuid'], 'GPU-target')
        self.assertEqual(sample['memoryTotalMiB'], 4096)
        self.assertEqual(sample['temperatureC'], 33)
        self.assertEqual(sample['powerW'], 6.4)
        self.assertEqual(sample['graphicsClockMHz'], 360)
        self.assertEqual(sample['memoryClockMHz'], 405)
        self.assertEqual(sample['memoryUsedMiB'], 128)

    def test_foreign_devices_not_substituted(self):
        foreign = ROW.replace('GTX 1650 SUPER', 'RTX 4090')
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            guard.parse_telemetry(foreign)
        self.assertEqual(guard.parse_telemetry(foreign + '\n' + ROW)['uuid'], 'GPU-target')

    def test_uuid_change_stops_monitoring(self):
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            guard.parse_telemetry(ROW, expected_uuid='GPU-missing')

    def test_ambiguous_targets_refused(self):
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            guard.parse_telemetry(ROW + '\n' + ROW.replace('GPU-target', 'GPU-other'))

    def test_missing_optional_power_clocks_retained_as_null(self):
        sample = guard.parse_telemetry(ROW.replace('6.4, 360, 405', '[N/A], [Not Supported], N/A'))
        self.assertIsNone(sample['powerW'])
        self.assertIsNone(sample['graphicsClockMHz'])
        self.assertIsNone(sample['memoryClockMHz'])

    def test_required_telemetry_or_identity_refused(self):
        for bad in ('', ROW.replace(', 33,', ', N/A,'), ROW.replace('4096', '8192'),
                    ROW.replace(', 33,', ', nan,'), ROW.replace(', 33,', ', -1,'),
                    ROW.replace('GPU-target', 'unknown'), ROW + ', extra'):
            with self.subTest(row=bad), self.assertRaises(ValueError):
                guard.parse_telemetry(bad)

    def test_failed_query_and_timeout_are_not_retried(self):
        with patch.object(guard.subprocess, 'run', return_value=Mock(returncode=1, stderr='device lost')) as run:
            with self.assertRaisesRegex(RuntimeError, 'device lost'):
                guard.query_telemetry()
            self.assertEqual(run.call_count, 1)
        with patch.object(guard.subprocess, 'run', side_effect=TimeoutError('timeout')) as run:
            with self.assertRaises(TimeoutError):
                guard.query_telemetry()
            self.assertEqual(run.call_count, 1)


class WatchdogTests(unittest.TestCase):
    def setUp(self):
        self.watch = guard.Watchdog(10, 120, NOW + dt.timedelta(hours=1))

    def check(self, temperature, elapsed):
        return self.watch.observe({'temperatureC': temperature}, 10 + elapsed,
                                  NOW + dt.timedelta(seconds=elapsed))

    def test_immediate_inclusive_85(self):
        self.assertIsNone(self.check(84.99, 0))
        self.assertEqual(self.check(85, .1), 'temperature-immediate-85C')

    def test_sustained_inclusive_82_sixty_seconds(self):
        self.assertIsNone(self.check(82, 0))
        self.assertIsNone(self.check(84, 59.999))
        self.assertEqual(self.check(82, 60), 'temperature-sustained-82C-60s')

    def test_temperature_dip_resets_sustained_window(self):
        self.assertIsNone(self.check(82, 0))
        self.assertIsNone(self.check(81.99, 59))
        self.assertIsNone(self.check(82, 60))
        self.assertIsNone(self.check(84, 119.99))

    def test_deadline_inclusive_even_when_cool(self):
        self.assertEqual(self.check(33, 120), 'workload-deadline')
        self.assertEqual(self.watch.time_failure(10, NOW + dt.timedelta(hours=1)), 'global-deadline')

    def test_global_deadline_precedes_workload_deadline(self):
        self.assertEqual(self.watch.time_failure(5000, NOW + dt.timedelta(hours=1)), 'global-deadline')

    def test_exact_utc_required(self):
        expected = dt.datetime(2026, 10, 31, 7, 47, 7, tzinfo=UTC)
        self.assertEqual(guard.utc_deadline('2026-10-31T07:47:07Z'), expected)
        self.assertEqual(guard.utc_deadline('2026-10-31T07:47:07+00:00'), expected)
        for bad in ('garbage', '2026-10-31T07:47:07', '2026-10-31T07:47:07+01:00'):
            with self.subTest(value=bad), self.assertRaises(argparse.ArgumentTypeError):
                guard.utc_deadline(bad)


class WrapperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name) / 'fresh-attempt'
        self.args = ['--out', str(self.out), '--timeout', '10', '--deadline-utc',
                     '2026-10-31T07:47:07Z', '--', 'fake-workload']

    def run_injected(self, telemetry=None, now=NOW, child=None):
        source = Mock(return_value={'commit': 'test-source', 'tree': 'test-tree'})
        lock = MagicMock()
        owned = child or Mock()
        with patch.object(guard, 'source_identity', source), patch.object(guard, 'utc_now', return_value=now), \
             patch.object(guard, 'query_telemetry', telemetry or Mock(return_value=guard.parse_telemetry(ROW))), \
             patch.object(guard, 'SerialLock', return_value=lock), \
             patch.object(guard, 'OwnedProcess', owned), patch('builtins.print'):
            result = guard.main(self.args)
        return result, owned, lock

    def test_hot_preflight_never_launches_child(self):
        hot = guard.parse_telemetry(ROW.replace(', 33,', ', 85,'))
        result, owned, lock = self.run_injected(Mock(return_value=hot))
        self.assertEqual(result, 1)
        owned.assert_not_called()
        lock.__exit__.assert_called_once()
        report = json.loads((self.out / 'guard.json').read_text())
        self.assertEqual(report['failure']['message'], 'temperature-immediate-85C')
        self.assertIsNone(report['childPid'])
        self.assertTrue((self.out / 'failure.json').is_file())

    def test_expired_deadline_never_queries_or_launches(self):
        telemetry = Mock()
        result, owned, _ = self.run_injected(telemetry, NOW + dt.timedelta(days=1))
        self.assertEqual(result, 1)
        owned.assert_not_called()
        telemetry.assert_not_called()

    def test_monitoring_failure_never_launches_or_retries(self):
        telemetry = Mock(side_effect=RuntimeError('monitor unavailable'))
        result, owned, _ = self.run_injected(telemetry)
        self.assertEqual(result, 1)
        telemetry.assert_called_once()
        owned.assert_not_called()

    def test_child_failure_retained_without_retry_and_cleanup_before_unlock(self):
        events = []
        process = Mock(pid=123, returncode=7)
        process.poll.return_value = 7
        instance = Mock(process=process)
        instance.close.side_effect = lambda: events.append('cleanup')
        lock = MagicMock()
        lock.__exit__.side_effect = lambda *args: events.append('unlock')
        owned = Mock(return_value=instance)
        with patch.object(guard, 'source_identity', return_value={}), \
             patch.object(guard, 'utc_now', return_value=NOW), \
             patch.object(guard, 'query_telemetry', return_value=guard.parse_telemetry(ROW)), \
             patch.object(guard, 'SerialLock', return_value=lock), \
             patch.object(guard, 'OwnedProcess', owned), patch('builtins.print'):
            self.assertEqual(guard.main(self.args), 1)
        owned.assert_called_once()
        self.assertEqual(events, ['cleanup', 'unlock'])
        report = json.loads((self.out / 'guard.json').read_text())
        self.assertEqual(report['returncode'], 7)
        self.assertEqual(report['failure']['message'], 'workload-exit-7')

    def test_success_is_host_guard_success_only(self):
        process = Mock(pid=123, returncode=0)
        process.poll.return_value = 0
        instance = Mock(process=process)
        result, owned, _ = self.run_injected(child=Mock(return_value=instance))
        self.assertEqual(result, 0)
        owned.assert_called_once()
        instance.close.assert_called_once()
        report = json.loads((self.out / 'guard.json').read_text())
        self.assertTrue(report['ok'])
        self.assertIn('Runner must prove', report['boundary'])
        for line in (self.out / 'SHA256SUMS.txt').read_text().splitlines():
            digest, relative = line.split('  ', 1)
            self.assertEqual(digest, hashlib.sha256((self.out / relative).read_bytes()).hexdigest())

    def test_existing_output_refused_without_changes(self):
        self.out.mkdir()
        marker = self.out / 'original.txt'
        marker.write_text('failed evidence')
        with patch('sys.stderr'), self.assertRaises(SystemExit):
            guard.main(self.args)
        self.assertEqual(marker.read_text(), 'failed evidence')

    def test_invalid_cli_refused(self):
        for option, value in (('--timeout', 'nan'), ('--timeout', '0'), ('--timeout', '28801'),
                              ('--poll', '0'), ('--poll', 'inf'), ('--deadline-utc', 'invalid')):
            args = self.args.copy()
            if option in args:
                args[args.index(option) + 1] = value
            else:
                args[0:0] = [option, value]
            with self.subTest(option=option, value=value), patch('sys.stderr'), self.assertRaises(SystemExit):
                guard.main(args)


if __name__ == '__main__':
    unittest.main(verbosity=2)
