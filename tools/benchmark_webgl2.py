#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import http.server
import json
import math
import os
import pathlib
import platform
import shutil
import signal
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request

import websocket

ROOT = pathlib.Path(__file__).resolve().parents[1]
BROWSER_NAMES = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge")
WINDOWS_BROWSERS = (
    pathlib.Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    pathlib.Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    pathlib.Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    pathlib.Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
)
SCENARIOS = (
    {"id": "representative", "fixture": "dense-mixed", "profile": "representative", "angle": 0, "purpose": "Representative gameplay mix"},
    {"id": "empty", "fixture": "empty-floor", "profile": "empty", "angle": 0, "purpose": "Empty fixed renderer overhead"},
    {"id": "dense-static", "fixture": "dense-mixed", "profile": "dense-static", "angle": 0, "purpose": "Dense static Material-v2 terrain and props"},
    {"id": "dynamic-robot", "fixture": "robot", "profile": "dynamic-robot", "angle": 45, "purpose": "Dynamic robot-heavy sprite and caster load"},
    {"id": "foliage", "fixture": "foliage-dense", "profile": "foliage", "angle": 90, "purpose": "Foliage-heavy procedural load"},
    {"id": "bin-cluster", "fixture": "binsright", "profile": "bin-cluster", "angle": 0, "purpose": "Overlapping bin cluster compatibility case"},
    {"id": "diagnostic-light", "fixture": "dense-mixed", "profile": "diagnostic-light", "angle": 315, "purpose": "Diagnostic multi-light and shadow worst case"},
    {"id": "mixed", "fixture": "dense-mixed", "profile": "mixed", "angle": 135, "purpose": "Mixed water, foliage, props, and actors"},
)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


class CDP:
    def __init__(self, url: str, timeout: float):
        self.ws = websocket.create_connection(url, timeout=timeout, origin="http://127.0.0.1")
        self.seq = 0

    def call(self, method: str, params: dict | None = None) -> dict:
        self.seq += 1
        ident = self.seq
        self.ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") != ident:
                continue
            if "error" in message:
                raise RuntimeError(f"CDP {method}: {message['error']}")
            return message.get("result", {})

    def eval(self, expression: str):
        result = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        if result.get("exceptionDetails"):
            raise RuntimeError(f"browser evaluation failed: {result['exceptionDetails']}")
        return result.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def find_browser(explicit: str | None) -> str | None:
    if explicit:
        path = pathlib.Path(explicit)
        return str(path.resolve()) if path.exists() else shutil.which(explicit)
    for name in BROWSER_NAMES:
        path = shutil.which(name)
        if path:
            return path
    for path in WINDOWS_BROWSERS:
        if path.exists():
            return str(path)
    return None


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def json_get(url: str, timeout: float = 2) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def terminate_process_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, check=False)
    else:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def gpu_metadata() -> dict:
    command = [
        "nvidia-smi",
        "--query-gpu=name,driver_version,memory.total,pci.bus_id",
        "--format=csv,noheader,nounits",
    ]
    try:
        result = subprocess.run(command, text=True, capture_output=True, timeout=15, check=True)
        rows = []
        for line in result.stdout.splitlines():
            parts = [part.strip() for part in line.split(",")]
            if len(parts) >= 4:
                rows.append({"name": parts[0], "driverVersion": parts[1], "memoryMiB": int(parts[2]), "pciBusId": parts[3]})
        return {"source": "nvidia-smi", "adapters": rows}
    except Exception as exc:
        return {"source": "unavailable", "adapters": [], "error": str(exc)}


def git_metadata() -> dict:
    def run(*args: str) -> str:
        return subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, check=True).stdout.strip()

    return {"commit": run("rev-parse", "HEAD"), "dirty": bool(run("status", "--porcelain"))}


def stats(values: list[float]) -> dict:
    samples = [float(value) for value in values if isinstance(value, (int, float)) and math.isfinite(value)]
    ordered = sorted(samples)

    def percentile(fraction: float):
        if not ordered:
            return None
        return ordered[max(0, min(len(ordered) - 1, math.ceil(fraction * len(ordered)) - 1))]

    return {
        "count": len(samples),
        "mean": sum(samples) / len(samples) if samples else None,
        "median": percentile(0.5),
        "p90": percentile(0.9),
        "p95": percentile(0.95),
        "p99": percentile(0.99),
        "max": ordered[-1] if ordered else None,
    }


def series_at(run: dict, *path: str) -> list[float]:
    value = run
    for key in path:
        value = value.get(key, {}) if isinstance(value, dict) else {}
    return value if isinstance(value, list) else []


def launch_run(
    executable: str,
    server_port: int,
    scenario: dict,
    run_number: int,
    args: argparse.Namespace,
    log_path: pathlib.Path,
) -> dict:
    query = urllib.parse.urlencode(
        {
            "renderTest": 1,
            "benchmark": 1,
            "fixture": scenario["fixture"],
            "benchmarkProfile": scenario["profile"],
            "backend": "webgl2",
            "quality": args.quality,
            "width": args.width,
            "height": args.height,
            "dpr": args.dpr,
            "lightAngle": scenario["angle"],
            "seed": args.seed,
            "fixedTimeMs": args.fixed_time_ms,
            "warmupFrames": args.warmup_frames,
            "sampleFrames": args.sample_frames,
        }
    )
    url = f"http://127.0.0.1:{server_port}/render-test.html?{query}"
    with tempfile.TemporaryDirectory(prefix="steelmoth-benchmark-chrome-") as profile:
        port = free_port()
        command = [
            executable,
            "--headless=new",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-sync",
            "--metrics-recording-only",
            "--no-first-run",
            "--enable-webgl",
            "--ignore-gpu-blocklist",
            "--remote-allow-origins=*",
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            f"--force-device-scale-factor={args.dpr}",
            f"--window-size={max(160, round(args.width / args.dpr))},{max(90, round(args.height / args.dpr))}",
            url,
        ]
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        with log_path.open("w", encoding="utf-8") as log:
            proc = subprocess.Popen(
                command,
                cwd=ROOT,
                stdout=subprocess.DEVNULL,
                stderr=log,
                creationflags=creationflags,
                start_new_session=os.name != "nt",
            )
            cdp = None
            try:
                deadline = time.monotonic() + args.timeout
                target = None
                while time.monotonic() < deadline and proc.poll() is None:
                    try:
                        targets = json_get(f"http://127.0.0.1:{port}/json/list")
                        target = next((item for item in targets if item.get("type") == "page" and "render-test.html" in item.get("url", "")), None)
                        if target:
                            break
                    except Exception:
                        pass
                    time.sleep(0.2)
                if not target:
                    raise RuntimeError("Chrome DevTools page target did not become available")
                cdp = CDP(target["webSocketDebuggerUrl"], timeout=min(60, max(20, args.timeout / 3)))
                cdp.call("Runtime.enable")
                browser_version = cdp.call("Browser.getVersion")
                while time.monotonic() < deadline:
                    ready = cdp.eval("document.body && (document.body.dataset.renderTestReady==='1' || document.body.dataset.renderTestError==='1')")
                    if ready:
                        break
                    time.sleep(0.25)
                else:
                    raise RuntimeError("benchmark did not finish before timeout")
                text = cdp.eval("document.getElementById('renderTestResult')?.textContent || ''")
                if not text:
                    raise RuntimeError("renderTestResult was absent after readiness")
                result = json.loads(text)
                if not result.get("ok"):
                    raise RuntimeError(result.get("error", "benchmark harness failed"))
                result["run"] = {
                    "number": run_number,
                    "freshBrowserProcess": True,
                    "freshBrowserProfile": True,
                    "browserVersion": browser_version,
                    "scenario": scenario,
                }
                native = result.get("metadata", {}).get("viewport", {}).get("actualNative")
                if native != [args.width, args.height]:
                    raise RuntimeError(f"native framebuffer mismatch: requested {[args.width, args.height]}, actual {native}")
                performance = result.get("performance", {})
                if performance.get("schema") != "steelmoth-webgl2-benchmark-run/v1":
                    raise RuntimeError("unexpected benchmark performance schema")
                if args.require_gpu_timing and not performance.get("gpuTimingAvailable"):
                    raise RuntimeError("EXT_disjoint_timer_query_webgl2 unavailable; GPU timing was not substituted")
                if performance.get("gpuTimingAvailable"):
                    for label in ("rendererTotal", "gbuffer", "contactShadow", "directLighting"):
                        count = performance.get("gpu", {}).get("series", {}).get(label, {}).get("statistics", {}).get("count", 0)
                        if count < args.sample_frames:
                            raise RuntimeError(f"{label} produced {count} samples; expected at least {args.sample_frames}")
                return result
            finally:
                if cdp:
                    cdp.close()
                terminate_process_tree(proc)


def aggregate_scenario(runs: list[dict], sample_frames: int) -> dict:
    definitions = {
        "gpu.rendererTotal": ("performance", "gpu", "series", "rendererTotal", "samples"),
        "gpu.gbuffer": ("performance", "gpu", "series", "gbuffer", "samples"),
        "gpu.contactShadow": ("performance", "gpu", "series", "contactShadow", "samples"),
        "gpu.directLighting": ("performance", "gpu", "series", "directLighting", "samples"),
        "cpu.scenePrep": ("performance", "cpu", "scenePrep", "samples"),
        "cpu.submit": ("performance", "cpu", "submit", "samples"),
        "cpu.total": ("performance", "cpu", "total", "samples"),
        "frame.interval": ("performance", "frame", "interval", "samples"),
        "frame.fps": ("performance", "frame", "fps", "samples"),
    }
    aggregate = {}
    for name, path in definitions.items():
        per_run = [series_at(run, *path) for run in runs]
        aggregate[name] = {"pooled": stats([value for values in per_run for value in values]), "runStatistics": [stats(values) for values in per_run]}
    total_means = [item["mean"] for item in aggregate["gpu.rendererTotal"]["runStatistics"] if item["mean"] is not None]
    restart_ratio = max(total_means) / min(total_means) if total_means and min(total_means) > 0 else None
    restart_ok = restart_ratio is not None and restart_ratio <= 1.5
    return {
        "runs": len(runs),
        "series": aggregate,
        "browserRestartVerification": {
            "performed": len(runs) >= 2,
            "freshBrowserPerRun": all(run.get("run", {}).get("freshBrowserProcess") for run in runs),
            "rendererTotalMeanMaxMinRatio": restart_ratio,
            "broadRangeThresholdRatio": 1.5,
            "ok": restart_ok,
            "outliersRetained": True,
        },
        "ok": len(runs) >= 3
        and aggregate["gpu.rendererTotal"]["pooled"]["count"] >= sample_frames * len(runs)
        and restart_ok,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure the deterministic Steel Moth WebGL2 baseline on GTX 1650 Super hardware.")
    parser.add_argument("--browser")
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("benchmarks/webgl2-gtx1650s"))
    parser.add_argument("--scenario", action="append", choices=[item["id"] for item in SCENARIOS])
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--warmup-frames", type=int, default=300)
    parser.add_argument("--sample-frames", type=int, default=600)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--dpr", type=float, default=1)
    parser.add_argument("--quality", choices=["low", "medium", "high", "ultra", "runtime-default"], default="high")
    parser.add_argument("--seed", type=int, default=1397572098)
    parser.add_argument("--fixed-time-ms", type=float, default=12000)
    parser.add_argument("--timeout", type=float, default=240)
    parser.add_argument("--require-gpu-timing", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--allow-non-target-gpu", action="store_true")
    args = parser.parse_args()
    if args.runs < 3 or args.warmup_frames < 300 or args.sample_frames < 600:
        parser.error("the canonical baseline requires at least 3 runs, 300 warm-up frames, and 600 samples per GPU query mode")
    if (args.width, args.height, args.dpr) != (1920, 1080, 1):
        parser.error("the committed GTX 1650 Super baseline must run at 1920x1080 native with DPR 1")
    executable = find_browser(args.browser)
    if not executable:
        print("Chrome/Chromium/Edge executable not found; no baseline was fabricated.", file=sys.stderr)
        return 2
    gpu = gpu_metadata()
    target_found = any("GTX 1650 SUPER" in adapter.get("name", "").upper() for adapter in gpu.get("adapters", []))
    if not target_found and not args.allow_non_target_gpu:
        print("GTX 1650 Super not found; target-hardware baseline remains blocked and no result was fabricated.", file=sys.stderr)
        return 2
    selected = [item for item in SCENARIOS if not args.scenario or item["id"] in args.scenario]
    source = git_metadata()
    output = args.out if args.out.is_absolute() else ROOT / args.out
    output.mkdir(parents=True, exist_ok=True)
    handler = lambda *a, **k: Quiet(*a, directory=str(ROOT), **k)
    server = Server(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    server_port = int(server.server_address[1])
    started = dt.datetime.now(dt.timezone.utc)
    all_runs: dict[str, list[dict]] = {}
    try:
        for scenario in selected:
            scenario_dir = output / scenario["id"]
            scenario_dir.mkdir(parents=True, exist_ok=True)
            all_runs[scenario["id"]] = []
            for run_number in range(1, args.runs + 1):
                print(f"[{scenario['id']}] run {run_number}/{args.runs}: fresh browser, {args.warmup_frames} warm-up + {args.sample_frames * 2} measured frames", flush=True)
                result = launch_run(executable, server_port, scenario, run_number, args, scenario_dir / f"run-{run_number:02d}.chrome.log")
                result["host"] = {"os": platform.platform(), "python": platform.python_version(), "gpu": gpu}
                path = scenario_dir / f"run-{run_number:02d}.json"
                path.write_text(json.dumps(result, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
                all_runs[scenario["id"]].append(result)
    except Exception as exc:
        print(f"WebGL2 benchmark failed: {exc}", file=sys.stderr)
        return 2
    finally:
        server.shutdown()
        server.server_close()
    aggregates = {scenario["id"]: aggregate_scenario(all_runs[scenario["id"]], args.sample_frames) for scenario in selected}
    report = {
        "schema": "steelmoth-webgl2-gtx1650s-baseline/v1",
        "ok": len(selected) == len(SCENARIOS) and all(item["ok"] for item in aggregates.values()),
        "generatedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "durationSeconds": (dt.datetime.now(dt.timezone.utc) - started).total_seconds(),
        "source": source,
        "target": {"gpu": "NVIDIA GeForce GTX 1650 SUPER", "memoryMiB": 4096, "resolution": [1920, 1080], "dpr": 1, "designFps": 60},
        "environment": {"os": platform.platform(), "browserExecutable": executable, "gpu": gpu},
        "methodology": {"warmupFrames": args.warmup_frames, "samplesPerGpuQueryMode": args.sample_frames, "measuredFramesPerRun": args.sample_frames * 2, "runsPerScenario": args.runs, "quality": args.quality, "freshBrowserAndProfilePerRun": True, "gpuAndPassQueriesAlternateBecauseWebGL2ElapsedQueriesCannotNest": True},
        "scenarios": [{"definition": scenario, "aggregate": aggregates[scenario["id"]], "runFiles": [f"{scenario['id']}/run-{number:02d}.json" for number in range(1, args.runs + 1)]} for scenario in selected],
        "evidenceBoundary": "Measured WebGL2 renderer evidence for the reported browser, driver, and GTX 1650 Super only. CPU timings are never labeled as GPU timings. Task Manager utilization is not used.",
    }
    (output / "baseline.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"ok": report["ok"], "report": str(output / "baseline.json"), "scenarios": len(selected), "runs": sum(len(value) for value in all_runs.values())}, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
