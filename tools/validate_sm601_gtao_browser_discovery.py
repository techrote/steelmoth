#!/usr/bin/env python3
"""CPU-only browser discovery regression; no browser or GPU execution."""
from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

import validate_sm601_gtao_adoption_browser as runner


class BrowserDiscoveryTests(unittest.TestCase):
    def setUp(self):
        # A discovery regression must never start a browser or invoke inventory.
        for name in ('Popen', 'run'):
            guard = patch.object(runner.subprocess, name,
                                 side_effect=AssertionError('Discovery must not launch a process'))
            guard.start()
            self.addCleanup(guard.stop)

    def test_each_inherited_path_alias_resolves_when_it_is_the_only_browser(self):
        for alias in ('chrome', 'google-chrome', 'google-chrome-stable',
                      'chromium', 'chromium-browser'):
            with self.subTest(alias=alias):
                expected = f'/browser/{alias}'
                with patch.object(runner.shutil, 'which',
                                  side_effect=lambda name: expected if name == alias else None), \
                     patch.dict(runner.os.environ, {}, clear=True), \
                     patch.object(Path, 'is_file') as is_file:
                    self.assertEqual(runner.chrome_path(), expected)
                    is_file.assert_not_called()

    def test_existing_path_precedence_is_preserved(self):
        available = {'chrome': '/browser/chrome', 'google-chrome': '/browser/google-chrome',
                     'chromium': '/browser/chromium'}
        with patch.object(runner.shutil, 'which', side_effect=available.get), \
             patch.dict(runner.os.environ, {}, clear=True):
            self.assertEqual(runner.chrome_path(), available['chrome'])

    def test_path_browser_precedes_a_windows_installation(self):
        with patch.object(runner.shutil, 'which',
                          side_effect=lambda name: '/browser/stable' if name == 'google-chrome-stable' else None), \
             patch.dict(runner.os.environ, {'PROGRAMFILES': '/windows/program-files'}, clear=True), \
             patch.object(Path, 'is_file', return_value=True) as is_file:
            self.assertEqual(runner.chrome_path(), '/browser/stable')
            is_file.assert_not_called()

    def test_each_windows_installation_location_is_a_fallback(self):
        for variable in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
            with self.subTest(variable=variable):
                base = f'/windows/{variable.lower()}'
                expected = Path(base) / 'Google/Chrome/Application/chrome.exe'
                with patch.object(runner.shutil, 'which', return_value=None), \
                     patch.dict(runner.os.environ, {variable: base}, clear=True), \
                     patch.object(Path, 'is_file', autospec=True,
                                  side_effect=lambda path: path == expected):
                    self.assertEqual(runner.chrome_path(), str(expected))

    def test_windows_fallback_skips_missing_installations(self):
        environment = {'PROGRAMFILES': '/windows/program-files',
                       'PROGRAMFILES(X86)': '/windows/program-files-x86',
                       'LOCALAPPDATA': '/windows/local'}
        expected = Path(environment['LOCALAPPDATA']) / 'Google/Chrome/Application/chrome.exe'
        with patch.object(runner.shutil, 'which', return_value=None), \
             patch.dict(runner.os.environ, environment, clear=True), \
             patch.object(Path, 'is_file', autospec=True,
                          side_effect=lambda path: path == expected):
            self.assertEqual(runner.chrome_path(), str(expected))

    def test_missing_path_and_windows_browsers_return_none(self):
        with patch.object(runner.shutil, 'which', return_value=None), \
             patch.dict(runner.os.environ, {'PROGRAMFILES': '/windows/missing'}, clear=True), \
             patch.object(Path, 'is_file', return_value=False):
            self.assertIsNone(runner.chrome_path())

    def test_empty_environment_needs_no_filesystem_lookup(self):
        with patch.object(runner.shutil, 'which', return_value=None), \
             patch.dict(runner.os.environ, {}, clear=True), \
             patch.object(Path, 'is_file') as is_file:
            self.assertIsNone(runner.chrome_path())
            is_file.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
