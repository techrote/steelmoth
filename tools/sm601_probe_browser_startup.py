#!/usr/bin/env python3
"""Validated bounded browser-page discovery copied for the frozen arithmetic probe."""
from __future__ import annotations

import json
from pathlib import Path
import time
import urllib.error
import urllib.request


def wait_for_page_target(port: int, proc, deadline: float) -> dict:
    """DevTools can start before about:blank has registered its page target.

    Wait only for browser startup within the existing campaign deadline. This
    does not retry a failed shader test or restart Chrome until a test passes.
    """
    observed_types: list[str] = []
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f'Browser page target unavailable before deadline; target types={observed_types}')
        status = proc.poll()
        if status is not None:
            raise RuntimeError(f'Browser exited before its page target was ready: exit={status}')
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list', timeout=min(10, remaining)) as response:
            targets = json.load(response)
        if not isinstance(targets, list):
            raise RuntimeError('Browser target inventory was not a JSON list.')
        observed_types = [str(x.get('type', '')) for x in targets if isinstance(x, dict)]
        for target in targets:
            if (isinstance(target, dict) and target.get('type') == 'page'
                    and isinstance(target.get('webSocketDebuggerUrl'), str)
                    and target['webSocketDebuggerUrl']):
                return target
        time.sleep(min(.1, max(0, deadline - time.monotonic())))


class BrowserStartup:
    """Poll one existing process's startup endpoint within its original deadline."""

    def __init__(self, process, port_file: Path, deadline: float, *,
                 clock=time.monotonic, sleep=time.sleep, opener=urllib.request.urlopen):
        self.process, self.port_file, self.deadline = process, port_file, deadline
        self.clock, self.sleep, self.opener = clock, sleep, opener
        self.last_state = 'debugging port file not ready'

    def _remaining(self) -> float:
        status = self.process.poll()
        if status is not None:
            raise RuntimeError(f'Browser exited during startup with status {status}.')
        remaining = self.deadline - self.clock()
        if remaining <= 0:
            raise TimeoutError(f'Bounded browser startup timed out: {self.last_state}.')
        return remaining

    def wait_for_page(self) -> dict:
        while True:
            remaining = self._remaining()
            target = None
            try:
                lines = self.port_file.read_text().splitlines()
                port = int(lines[0])
                if not 1 <= port <= 65535:
                    raise ValueError('Incomplete or invalid debugging port')
                with self.opener(f'http://127.0.0.1:{port}/json/list',
                                 timeout=min(10, remaining)) as response:
                    targets = json.load(response)
                if not isinstance(targets, list):
                    raise ValueError('Debugging page inventory is not ready')
                target = next((item for item in targets if isinstance(item, dict)
                               and item.get('type') == 'page'
                               and isinstance(item.get('webSocketDebuggerUrl'), str)
                               and item['webSocketDebuggerUrl'].startswith(('ws://', 'wss://'))), None)
                self.last_state = 'debugging page websocket not ready'
            except (FileNotFoundError, PermissionError, IndexError, ValueError,
                    urllib.error.URLError, ConnectionError, TimeoutError) as exc:
                self.last_state = f'{type(exc).__name__}: {exc}'
            if target is not None:
                self._remaining()
                return target
            self.sleep(min(.1, max(0, self.deadline - self.clock())))
