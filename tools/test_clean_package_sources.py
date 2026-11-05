#!/usr/bin/env python3
"""Regression checks for release archive source and member safety."""
from __future__ import annotations

import json
import os
import socket
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


    def test_excluded_special_node_is_ignored(self) -> None:
        if not hasattr(os,'mkfifo'):
            self.skipTest('filesystem does not support named pipes')
        excluded=self.root/'artifacts'
        excluded.mkdir()
        try:
            os.mkfifo(excluded/'ignored.pipe')
        except (OSError,NotImplementedError) as error:
            self.skipTest(f'filesystem does not permit named pipes: {error}')
        self.assertEqual(
            [p.relative_to(self.root).as_posix() for p in collect_source_files(self.root)],
            ['main.js'],
        )

    def test_included_fifo_source_rejected(self) -> None:
        if not hasattr(os,'mkfifo'):
            self.skipTest('filesystem does not support named pipes')
        pipe=self.root/'unsafe.pipe'
        try:
            os.mkfifo(pipe)
        except (OSError,NotImplementedError) as error:
            self.skipTest(f'filesystem does not permit named pipes: {error}')
        with self.assertRaisesRegex(RuntimeError,'non-regular entry.*unsafe.pipe'):
            collect_source_files(self.root)

    def test_included_unix_socket_source_rejected(self) -> None:
        if not hasattr(socket,'AF_UNIX'):
            self.skipTest('platform does not support UNIX sockets')
        try:
            sock=socket.socket(socket.AF_UNIX)
        except (OSError,NotImplementedError) as error:
            self.skipTest(f'platform cannot create UNIX sockets: {error}')
        self.addCleanup(sock.close)
        try:
            sock.bind(str(self.root/'unsafe.sock'))
        except (OSError,NotImplementedError) as error:
            self.skipTest(f'filesystem does not permit UNIX sockets: {error}')
        with self.assertRaisesRegex(RuntimeError,'non-regular entry.*unsafe.sock'):
            collect_source_files(self.root)

    def test_unreadable_source_directory_fails_closed(self) -> None:
        restricted=self.root/'restricted'
        restricted.mkdir()

        def denied_walk(root, *, topdown, followlinks, onerror):
            self.assertTrue(topdown)
            self.assertFalse(followlinks)
            yield str(root), ['restricted'], ['main.js']
            onerror(PermissionError(13, 'Permission denied', str(restricted)))

        # Deterministic on all platforms; no root privileges or chmod needed.
        with patch('validate_clean_package.os.walk', side_effect=denied_walk):
            with self.assertRaisesRegex(RuntimeError,'cannot inspect.*restricted'):
                collect_source_files(self.root)

    def test_unreadable_directory_refuses_archive_and_reports_error(self) -> None:
        restricted=self.root/'restricted'
        restricted.mkdir()
        archive=Path(self.temp.name)/'release.zip'
        report=Path(self.temp.name)/'failure.json'

        def denied_walk(root, *, topdown, followlinks, onerror):
            yield str(root), ['restricted'], ['main.js']
            onerror(PermissionError(13, 'Permission denied', str(restricted)))

        with patch('validate_clean_package.os.walk', side_effect=denied_walk), \
             patch('validate_clean_package.ROOT',self.root), \
             patch('sys.argv',['validate_clean_package.py','--archive',str(archive),'--report',str(report)]), \
             redirect_stdout(StringIO()):
            self.assertEqual(main(),1)
        self.assertFalse(archive.exists())
        outcome=json.loads(report.read_text(encoding='utf-8'))
        self.assertFalse(outcome['ok'])
        self.assertIn('cannot inspect clean package source directory',outcome['error'])
        self.assertIn('restricted',outcome['error'])

    def test_special_source_refuses_archive_with_structured_report(self) -> None:
        if not hasattr(os,'mkfifo'):
            self.skipTest('filesystem does not support named pipes')
        try:
            os.mkfifo(self.root/'unsafe.pipe')
        except (OSError,NotImplementedError) as error:
            self.skipTest(f'filesystem does not permit named pipes: {error}')
        archive=Path(self.temp.name)/'release.zip'
        report=Path(self.temp.name)/'failure.json'
        with patch('validate_clean_package.ROOT',self.root), \
             patch('sys.argv',['validate_clean_package.py','--archive',str(archive),'--report',str(report)]), \
             redirect_stdout(StringIO()):
            self.assertEqual(main(),1)
        self.assertFalse(archive.exists())
        outcome=json.loads(report.read_text(encoding='utf-8'))
        self.assertFalse(outcome['ok'])
        self.assertIn('non-regular entry',outcome['error'])
        self.assertIn('unsafe.pipe',outcome['error'])

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

    def test_external_hardlinked_source_rejected(self) -> None:
        private=Path(self.temp.name)/'private.txt'
        private.write_text('outside repository',encoding='utf-8')
        self.hardlink(self.root/'leak.txt',private)
        with self.assertRaisesRegex(RuntimeError,'unsafe hardlink.*leak.txt'):
            collect_source_files(self.root)

    def test_internal_hardlink_alias_also_rejected(self) -> None:
        self.hardlink(self.root/'alias.js',self.root/'main.js')
        with self.assertRaisesRegex(RuntimeError,'unsafe hardlink.*alias.js'):
            collect_source_files(self.root)

    def test_external_hardlink_fails_without_publishing_archive(self) -> None:
        private=Path(self.temp.name)/'private.txt'
        private.write_text('outside repository',encoding='utf-8')
        self.hardlink(self.root/'leak.txt',private)
        archive=Path(self.temp.name)/'leaked-release.zip'
        report=Path(self.temp.name)/'hardlink-failure.json'
        with patch('validate_clean_package.ROOT',self.root), \
             patch('sys.argv',['validate_clean_package.py','--archive',str(archive),'--report',str(report)]), \
             redirect_stdout(StringIO()):
            self.assertEqual(main(),1)
        self.assertFalse(archive.exists())
        outcome=json.loads(report.read_text(encoding='utf-8'))
        self.assertFalse(outcome['ok'])
        self.assertIn('unsafe hardlink',outcome['error'])

    def test_archive_members_are_cross_platform_safe(self) -> None:
        safe_member('steelmoth/tools/run_checks.py')
        for name in (
            '/etc/passwd','../escape','steelmoth/../outside',
            'steelmoth\\..\\escape','C:\\escape','steelmoth/C:evil','',
        ):
            with self.subTest(name=name),self.assertRaises(RuntimeError):
                safe_member(name)

    def test_windows_reserved_archive_components_rejected(self) -> None:
        # Fixed fixtures work on Linux and on Python versions without
        # ntpath.isreserved(), which is newer than the CI minimum.
        for name in (
            'CON.txt','aux','NUL.json','PRN','COM1.log','com¹.log',
            'LPT9.txt','CONIN$','CONOUT$','name.','name ',
            'CON .txt','COM1 .log','LPT¹  .dat',
            'bad?.txt','a*b','a<b','a|b','a"b','a\x1ftxt',
        ):
            with self.subTest(name=name),self.assertRaisesRegex(RuntimeError,'unsafe archive member'):
                safe_member('steelmoth/assets/'+name)
        for name in ('Console.txt','a-b.png','COM0.txt','LPT0.txt','normal_asset.png'):
            safe_member('steelmoth/assets/'+name)

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

    def test_existing_directory_output_destination_rejected(self) -> None:
        output=self.root/'artifacts'
        output.mkdir()
        with self.assertRaisesRegex(RuntimeError,'--archive output is not a regular file'):
            validate_output_destinations(self.root,None,output)

    def test_existing_fifo_report_destination_rejected(self) -> None:
        if not hasattr(os,'mkfifo'):
            self.skipTest('filesystem does not support named pipes')
        output=self.root/'artifacts'
        output.mkdir()
        pipe=output/'report.pipe'
        try:
            os.mkfifo(pipe)
        except (OSError,NotImplementedError) as error:
            self.skipTest(f'filesystem does not permit named pipes: {error}')
        with self.assertRaisesRegex(RuntimeError,'--report output is not a regular file'):
            validate_output_destinations(self.root,pipe,None)

    def test_existing_device_archive_destination_rejected(self) -> None:
        if os.name!='posix':
            self.skipTest('POSIX device-path regression')
        device=Path(os.devnull)
        self.assertTrue(device.exists())
        with self.assertRaisesRegex(RuntimeError,'--archive output is not a regular file'):
            validate_output_destinations(self.root,None,device)

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
        # The source-input hardlink guard can reject this alias before the
        # output-specific guard, but either path must refuse before writing.
        with self.assertRaisesRegex(RuntimeError,'hardlink.*main.js'):
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
