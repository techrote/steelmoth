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

from validate_clean_package import collect_source_files, main, safe_member, validate_output_destinations


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


    def test_output_destinations_in_excluded_artifacts_or_outside_root(self) -> None:
        excluded=self.root/'artifacts'
        validate_output_destinations(self.root,excluded/'report.json',excluded/'release.zip')
        validate_output_destinations(
            self.root,Path(self.temp.name)/'report.json',Path(self.temp.name)/'release.zip',
        )

    def test_archive_report_collision_preserves_existing_artifact(self) -> None:
        destination=Path(self.temp.name)/'release.zip'
        destination.write_bytes(b'previous validated zip')
        with patch('validate_clean_package.ROOT',self.root), \
             patch('sys.argv',['validate_clean_package.py','--archive',str(destination),'--report',str(destination)]), \
             redirect_stdout(StringIO()):
            self.assertEqual(main(),1)
        self.assertEqual(destination.read_bytes(),b'previous validated zip')

    def test_archive_report_normalized_alias_collision(self) -> None:
        destination=self.root/'artifacts'/'release.zip'
        with self.assertRaisesRegex(RuntimeError,'distinct destinations'):
            validate_output_destinations(
                self.root, self.root/'artifacts'/'nested'/'..'/'release.zip',destination
            )

    def hardlink(self, path: Path, target: Path) -> None:
        try:
            path.hardlink_to(target)
        except (OSError,NotImplementedError) as error:
            self.skipTest(f'filesystem does not permit hardlinks: {error}')

    def test_distinct_existing_artifacts_are_allowed(self) -> None:
        output=self.root/'artifacts'
        output.mkdir()
        (output/'report.json').write_text('old report',encoding='utf-8')
        (output/'release.zip').write_bytes(b'old ZIP')
        validate_output_destinations(
            self.root,output/'report.json',output/'release.zip',
        )

    def test_hardlinked_report_archive_collision_preserves_artifact(self) -> None:
        output=self.root/'artifacts'
        output.mkdir()
        archive=output/'release.zip'
        report=output/'report.json'
        archive.write_bytes(b'existing validated ZIP')
        self.hardlink(report,archive)
        with patch('validate_clean_package.ROOT',self.root), \
             patch('sys.argv',['validate_clean_package.py','--archive',str(archive),'--report',str(report)]), \
             redirect_stdout(StringIO()):
            self.assertEqual(main(),1)
        self.assertEqual(archive.read_bytes(),b'existing validated ZIP')
        self.assertEqual(report.read_bytes(),b'existing validated ZIP')

    def test_excluded_report_hardlinked_to_included_source_rejected(self) -> None:
        output=self.root/'artifacts'
        output.mkdir()
        report=output/'report.json'
        source=self.root/'main.js'
        self.hardlink(report,source)
        with patch('validate_clean_package.ROOT',self.root), \
             patch('sys.argv',['validate_clean_package.py','--report',str(report)]), \
             redirect_stdout(StringIO()):
            self.assertEqual(main(),1)
        self.assertEqual(source.read_text(encoding='utf-8'),'ok')

    def test_external_archive_hardlinked_to_included_source_rejected(self) -> None:
        source=self.root/'main.js'
        archive=Path(self.temp.name)/'release.zip'
        self.hardlink(archive,source)
        with self.assertRaisesRegex(RuntimeError,'hardlink to included source: main.js'):
            validate_output_destinations(self.root,None,archive)
        self.assertEqual(source.read_text(encoding='utf-8'),'ok')

    def test_archive_at_source_root_rejected_before_creation(self) -> None:
        destination=self.root/'release.zip'
        with patch('validate_clean_package.ROOT',self.root), \
             patch('sys.argv',['validate_clean_package.py','--archive',str(destination)]), \
             redirect_stdout(StringIO()):
            self.assertEqual(main(),1)
        self.assertFalse(destination.exists())

    def test_existing_archive_inside_source_cannot_be_repacked(self) -> None:
        destination=self.root/'release.zip'
        destination.write_bytes(b'existing archive from previous run')
        with self.assertRaisesRegex(RuntimeError,'included in source package'):
            validate_output_destinations(self.root,None,destination)
        self.assertEqual(destination.read_bytes(),b'existing archive from previous run')

    def test_report_cannot_overwrite_included_source(self) -> None:
        source=self.root/'main.js'
        with patch('validate_clean_package.ROOT',self.root), \
             patch('sys.argv',['validate_clean_package.py','--report',str(source)]), \
             redirect_stdout(StringIO()):
            self.assertEqual(main(),1)
        self.assertEqual(source.read_text(encoding='utf-8'),'ok')


if __name__=='__main__':
    unittest.main(verbosity=2)
