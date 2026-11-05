#!/usr/bin/env python3
"""Regression checks for release archive source and member safety."""
from __future__ import annotations

import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from validate_clean_package import collect_source_files, main, safe_member


class CleanPackageSourceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix='steelmoth-package-safety-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'root'
        self.root.mkdir()
        (self.root/'main.js').write_text('ok',encoding='utf-8')

    def link(self, path: Path, target: Path, is_directory: bool = False) -> None:
        try:
            path.symlink_to(target,target_is_directory=is_directory)
        except (OSError,NotImplementedError) as error:
            self.skipTest(f'filesystem does not permit symlinks: {error}')

    def test_regular_files_and_ignored_directories(self) -> None:
        (self.root/'.github').mkdir()
        self.link(self.root/'.github'/'ignored',Path(self.temp.name)/'private')
        (self.root/'artifacts').mkdir()
        (self.root/'artifacts'/'result.txt').write_text('generated',encoding='utf-8')
        self.assertEqual(
            [p.relative_to(self.root).as_posix() for p in collect_source_files(self.root)],
            ['main.js'],
        )

    def test_external_file_symlink_rejected(self) -> None:
        private=Path(self.temp.name)/'private.txt'
        private.write_text('outside repository',encoding='utf-8')
        self.link(self.root/'leak.txt',private)
        with self.assertRaisesRegex(RuntimeError,'leak.txt'):
            collect_source_files(self.root)

    def test_directory_symlink_rejected(self) -> None:
        folder=Path(self.temp.name)/'outside'
        folder.mkdir()
        self.link(self.root/'external',folder,True)
        with self.assertRaisesRegex(RuntimeError,'external'):
            collect_source_files(self.root)

    def test_dangling_symlink_rejected(self) -> None:
        self.link(self.root/'broken.txt',self.root/'missing.txt')
        with self.assertRaisesRegex(RuntimeError,'broken.txt'):
            collect_source_files(self.root)

    def test_archive_members_are_cross_platform_safe(self) -> None:
        safe_member('steelmoth/tools/run_checks.py')
        for name in (
            '/etc/passwd','../escape','steelmoth/../outside',
            'steelmoth\\..\\escape','C:\\escape','steelmoth/C:evil','',
        ):
            with self.subTest(name=name),self.assertRaises(RuntimeError):
                safe_member(name)

    def test_failed_extraction_does_not_publish_archive(self) -> None:
        archive=Path(self.temp.name)/'release.zip'
        report=Path(self.temp.name)/'failed-report.json'
        with patch('validate_clean_package.ROOT',self.root), \
             patch('sys.argv',['validate_clean_package.py','--archive',str(archive),'--report',str(report)]), \
             redirect_stdout(StringIO()):
            self.assertEqual(main(),1)
        self.assertFalse(archive.exists(),'failed verification must not publish a ZIP')
        outcome=json.loads(report.read_text(encoding='utf-8'))
        self.assertFalse(outcome['ok'])
        self.assertEqual(outcome['error'],'missing required extracted files')

    def test_failed_extraction_does_not_replace_previous_archive(self) -> None:
        archive=Path(self.temp.name)/'previous-release.zip'
        archive.write_bytes(b'existing validated artifact')
        with patch('validate_clean_package.ROOT',self.root), \
             patch('sys.argv',['validate_clean_package.py','--archive',str(archive)]), \
             redirect_stdout(StringIO()):
            self.assertEqual(main(),1)
        self.assertEqual(archive.read_bytes(),b'existing validated artifact')


if __name__=='__main__':
    unittest.main(verbosity=2)
