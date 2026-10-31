#!/usr/bin/env python3
"""Run exactly one physical workload under a serial GTX 1650 SUPER watchdog.

This guard establishes host telemetry, not browser adapter identity or acceptance.
The guarded runner must independently reject software adapters and GPU/API errors.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ('name', 'uuid', 'driver_version', 'memory.total', 'temperature.gpu',
          'power.draw', 'clocks.current.graphics', 'clocks.current.memory',
          'memory.used', 'utilization.gpu')


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def utc_deadline(value):
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (TypeError, ValueError) as error:
        raise argparse.ArgumentTypeError('deadline must be an ISO-8601 UTC timestamp') from error
    if parsed.tzinfo is None or parsed.utcoffset() != dt.timedelta(0):
        raise argparse.ArgumentTypeError('deadline must explicitly use UTC (Z or +00:00)')
    return parsed.astimezone(dt.timezone.utc)


def finite_number(value, required=False):
    try:
        number = float(value)
    except ValueError:
        if required:
            raise ValueError(f'required telemetry unavailable: {value!r}') from None
        return None
    if not math.isfinite(number):
        raise ValueError('non-finite telemetry')
    return number


def parse_telemetry(text, expected_uuid=None):
    rows = list(csv.reader(io.StringIO(text.strip())))
    devices = []
    for row in rows:
        if len(row) != len(FIELDS):
            raise ValueError(f'expected {len(FIELDS)} nvidia-smi columns, got {len(row)}')
        raw = dict(zip(FIELDS, (part.strip() for part in row)))
        if raw['name'].casefold() != 'nvidia geforce gtx 1650 super':
            continue
        if not raw['uuid'].startswith('GPU-') or not raw['driver_version']:
            raise ValueError('GPU UUID or driver identity unavailable')
        item = {'name': raw['name'], 'uuid': raw['uuid'], 'driver': raw['driver_version'],
                'memoryTotalMiB': finite_number(raw['memory.total'], required=True),
                'temperatureC': finite_number(raw['temperature.gpu'], required=True),
                'powerW': finite_number(raw['power.draw']),
                'graphicsClockMHz': finite_number(raw['clocks.current.graphics']),
                'memoryClockMHz': finite_number(raw['clocks.current.memory']),
                'memoryUsedMiB': finite_number(raw['memory.used']),
                'gpuUtilizationPct': finite_number(raw['utilization.gpu']), 'raw': raw}
        if not 3800 <= item['memoryTotalMiB'] <= 4200:
            raise ValueError('target is not a 4 GB GTX 1650 SUPER')
        if not 0 <= item['temperatureC'] <= 125:
            raise ValueError('invalid GPU temperature')
        if expected_uuid is None or item['uuid'] == expected_uuid:
            devices.append(item)
    if len(devices) != 1:
        raise ValueError('exactly one matching GTX 1650 SUPER 4 GB is required')
    return devices[0]


def query_telemetry(expected_uuid=None):
    result = subprocess.run(['nvidia-smi', '--query-gpu=' + ','.join(FIELDS),
                             '--format=csv,noheader,nounits'], capture_output=True,
                            text=True, timeout=5, check=False,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    if result.returncode:
        raise RuntimeError(f'nvidia-smi failed ({result.returncode}): {result.stderr.strip()}')
    return parse_telemetry(result.stdout, expected_uuid)


class Watchdog:
    def __init__(self, start_monotonic, timeout, global_deadline):
        self.start = start_monotonic
        self.timeout = timeout
        self.deadline = global_deadline
        self.hot_since = None

    def time_failure(self, now_monotonic, now_utc):
        if now_utc >= self.deadline:
            return 'global-deadline'
        if now_monotonic - self.start >= self.timeout:
            return 'workload-deadline'
        return None

    def observe(self, sample, now_monotonic, now_utc):
        failure = self.time_failure(now_monotonic, now_utc)
        if failure:
            return failure
        temperature = sample['temperatureC']
        if temperature >= 85:
            return 'temperature-immediate-85C'
        if temperature >= 82:
            if self.hot_since is None:
                self.hot_since = now_monotonic
            if now_monotonic - self.hot_since >= 60:
                return 'temperature-sustained-82C-60s'
        else:
            self.hot_since = None
        return None


class SerialLock:
    """OS lock automatically released on exit; stale pathname never blocks a run."""
    def __init__(self):
        self.path = Path(tempfile.gettempdir()) / 'steelmoth-sm505-physical.lock'
        self.file = None

    def __enter__(self):
        self.file = self.path.open('a+b')
        self.file.seek(0, 2)
        if self.file.tell() == 0:
            self.file.write(b' ')
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.file.close()
            self.file = None
            raise RuntimeError('another physical workload guard holds the serial lock') from error
        return self

    def __exit__(self, *_):
        if self.file is not None:
            self.file.close()
            self.file = None


class OwnedProcess:
    """Contain only this child and its descendants, including on abnormal exit."""
    def __init__(self, command, stdout, stderr):
        self.process = None
        self.job = None
        self.kernel = None
        if os.name == 'nt':
            self._start_windows(command, stdout, stderr)
        else:
            self.process = subprocess.Popen(command, cwd=ROOT, stdout=stdout, stderr=stderr,
                                            start_new_session=True)

    def _start_windows(self, command, stdout, stderr):
        import ctypes as c
        from ctypes import wintypes as w

        class Basic(c.Structure):
            _fields_ = [('PerProcessUserTimeLimit', c.c_int64), ('PerJobUserTimeLimit', c.c_int64),
                        ('LimitFlags', w.DWORD), ('MinimumWorkingSetSize', c.c_size_t),
                        ('MaximumWorkingSetSize', c.c_size_t), ('ActiveProcessLimit', w.DWORD),
                        ('Affinity', c.c_size_t), ('PriorityClass', w.DWORD), ('SchedulingClass', w.DWORD)]

        class Counters(c.Structure):
            _fields_ = [(name, c.c_uint64) for name in
                        ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount',
                         'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]

        class Extended(c.Structure):
            _fields_ = [('BasicLimitInformation', Basic), ('IoInfo', Counters),
                        ('ProcessMemoryLimit', c.c_size_t), ('JobMemoryLimit', c.c_size_t),
                        ('PeakProcessMemoryUsed', c.c_size_t), ('PeakJobMemoryUsed', c.c_size_t)]

        class ThreadEntry(c.Structure):
            _fields_ = [('dwSize', w.DWORD), ('cntUsage', w.DWORD), ('th32ThreadID', w.DWORD),
                        ('th32OwnerProcessID', w.DWORD), ('tpBasePri', w.LONG),
                        ('tpDeltaPri', w.LONG), ('dwFlags', w.DWORD)]

        k = c.WinDLL('kernel32', use_last_error=True)
        k.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]
        k.CreateJobObjectW.restype = w.HANDLE
        k.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
        k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        k.TerminateJobObject.argtypes = [w.HANDLE, w.UINT]
        k.CloseHandle.argtypes = [w.HANDLE]
        k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        k.OpenProcess.restype = w.HANDLE
        k.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
        k.CreateToolhelp32Snapshot.restype = w.HANDLE
        k.Thread32First.argtypes = [w.HANDLE, c.POINTER(ThreadEntry)]
        k.Thread32Next.argtypes = [w.HANDLE, c.POINTER(ThreadEntry)]
        k.OpenThread.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        k.OpenThread.restype = w.HANDLE
        k.ResumeThread.argtypes = [w.HANDLE]
        k.ResumeThread.restype = w.DWORD
        self.kernel = k
        self.job = k.CreateJobObjectW(None, None)
        if not self.job:
            raise c.WinError(c.get_last_error())
        limits = Extended()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        try:
            if not k.SetInformationJobObject(self.job, 9, c.byref(limits), c.sizeof(limits)):
                raise c.WinError(c.get_last_error())
            # Suspend before any child code can run; assign the job before resume.
            self.process = subprocess.Popen(command, cwd=ROOT, stdout=stdout, stderr=stderr,
                                            creationflags=0x4 | subprocess.CREATE_NO_WINDOW)
            handle = k.OpenProcess(0x100 | 0x1, False, self.process.pid)  # SET_QUOTA | TERMINATE
            if not handle:
                raise c.WinError(c.get_last_error())
            try:
                if not k.AssignProcessToJobObject(self.job, handle):
                    raise c.WinError(c.get_last_error())
            finally:
                k.CloseHandle(handle)
            snapshot = k.CreateToolhelp32Snapshot(0x4, 0)  # TH32CS_SNAPTHREAD
            if snapshot == c.c_void_p(-1).value:
                raise c.WinError(c.get_last_error())
            resumed = False
            try:
                entry = ThreadEntry()
                entry.dwSize = c.sizeof(entry)
                found = k.Thread32First(snapshot, c.byref(entry))
                while found:
                    if entry.th32OwnerProcessID == self.process.pid:
                        thread = k.OpenThread(0x2, False, entry.th32ThreadID)
                        if not thread:
                            raise c.WinError(c.get_last_error())
                        try:
                            if k.ResumeThread(thread) == 0xFFFFFFFF:
                                raise c.WinError(c.get_last_error())
                            resumed = True
                        finally:
                            k.CloseHandle(thread)
                    found = k.Thread32Next(snapshot, c.byref(entry))
            finally:
                k.CloseHandle(snapshot)
            if not resumed:
                raise RuntimeError('owned child thread could not be resumed')
        except BaseException:
            if self.process is not None and self.process.poll() is None:
                self.process.kill()
                self.process.wait(timeout=10)
            self.close()
            raise

    def close(self):
        if self.job is not None:
            self.kernel.CloseHandle(self.job)
            self.job = None
        elif os.name != 'nt' and self.process is not None:
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if self.process is not None and self.process.poll() is None:
            self.process.wait(timeout=10)


def source_identity(out):
    def git(*args):
        result = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True,
                                timeout=15, check=True)
        return result.stdout
    (out / 'source-status.txt').write_text(git('status', '--porcelain=v1'), encoding='utf-8')
    (out / 'source-diff.patch').write_text(git('diff', 'HEAD', '--binary'), encoding='utf-8')
    return {'commit': git('rev-parse', 'HEAD').strip(), 'tree': git('rev-parse', 'HEAD^{tree}').strip(),
            'branch': git('branch', '--show-current').strip(),
            'statusFile': 'source-status.txt', 'diffFile': 'source-diff.patch'}


def write_json(path, payload):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(payload, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def manifest(out):
    entries = []
    for path in sorted(out.rglob('*')):
        if path.is_file() and path.name != 'SHA256SUMS.txt':
            entries.append(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.relative_to(out).as_posix())
    (out / 'SHA256SUMS.txt').write_text('\n'.join(entries) + '\n', encoding='utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--timeout', required=True, type=float, help='Per-workload wall-clock seconds, 1..28800')
    parser.add_argument('--deadline-utc', required=True, type=utc_deadline)
    parser.add_argument('--poll', type=float, default=1, help='Telemetry interval seconds, 0.2..2')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 28800:
        parser.error('--timeout must be finite and within 1..28800 seconds')
    if not math.isfinite(args.poll) or not .2 <= args.poll <= 2:
        parser.error('--poll must be finite and within 0.2..2 seconds')
    if not command:
        parser.error('one workload command is required after --')
    out = args.out.resolve()
    if out.exists():
        parser.error('output directory must be new; failed/original evidence cannot be overwritten')
    out.mkdir(parents=True)
    started = utc_now()
    start_tick = time.monotonic()
    report = {'schema': 'steelmoth-sm505-physical-guard/v1', 'ok': False, 'startedAt': started.isoformat(),
              'endedAt': None, 'deadlineUtc': args.deadline_utc.isoformat(), 'timeoutSeconds': args.timeout,
              'pollSeconds': args.poll, 'command': command, 'cwd': str(ROOT), 'source': None,
              'gpu': None, 'childPid': None, 'returncode': None, 'failure': None, 'samples': 0,
              'boundary': 'Host safety telemetry only. Runner must prove actual browser adapter and API correctness. No automatic retry.'}
    child = None
    serial_lock = None
    guard = Watchdog(start_tick, args.timeout, args.deadline_utc)
    try:
        report['source'] = source_identity(out)
        write_json(out / 'guard.json', report)
        serial_lock = SerialLock()
        serial_lock.__enter__()
        with (out / 'telemetry.jsonl').open('w', encoding='utf-8') as log:
            def sample():
                item = query_telemetry(report['gpu']['uuid'] if report['gpu'] else None)
                now = utc_now()
                tick = time.monotonic()
                item.update({'at': now.isoformat(), 'elapsedSeconds': tick - start_tick})
                log.write(json.dumps(item, allow_nan=False) + '\n')
                log.flush()
                report['samples'] += 1
                report['gpu'] = report['gpu'] or item
                failure = guard.observe(item, tick, now)
                if failure:
                    raise RuntimeError(failure)
            failure = guard.time_failure(time.monotonic(), utc_now())
            if failure:
                raise RuntimeError(failure)
            sample()  # Mandatory identity and monitoring before child creation.
            with (out / 'stdout.txt').open('wb') as stdout, (out / 'stderr.txt').open('wb') as stderr:
                child = OwnedProcess(command, stdout, stderr)
                report['childPid'] = child.process.pid
                write_json(out / 'guard.json', report)
                while child.process.poll() is None:
                    failure = guard.time_failure(time.monotonic(), utc_now())
                    if failure:
                        raise RuntimeError(failure)
                    time.sleep(min(args.poll, max(0, args.timeout - (time.monotonic() - start_tick)),
                                   max(0, (args.deadline_utc - utc_now()).total_seconds())))
                    sample()
                report['returncode'] = child.process.returncode
                if report['returncode']:
                    raise RuntimeError(f'workload-exit-{report["returncode"]}')
                sample()
                report['ok'] = True
    except BaseException as error:
        report['failure'] = {'type': type(error).__name__, 'message': str(error), 'at': utc_now().isoformat()}
        write_json(out / 'failure.json', report['failure'])
    finally:
        if child is not None:
            try:
                child.close()
                report['returncode'] = child.process.returncode
            except BaseException as error:
                report['ok'] = False
                report['cleanupError'] = str(error)
        if serial_lock is not None:
            serial_lock.__exit__()
        report['endedAt'] = utc_now().isoformat()
        report['elapsedSeconds'] = time.monotonic() - start_tick
        write_json(out / 'guard.json', report)
        manifest(out)
    print(json.dumps({'ok': report['ok'], 'failure': report['failure'], 'report': str(out / 'guard.json')}))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
