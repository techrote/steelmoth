#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import functools
import json
import math
import platform
import subprocess
import sys
import threading
import time
import urllib.parse
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import JavascriptException
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions

from validate_webgpu_cross_browser import Quiet, Server

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = ("representative", "empty", "dense-static", "dynamic-robot", "foliage", "bin-cluster", "diagnostic-light", "mixed")
BASELINE = {
    "representative": (5.07, 12.08), "empty": (4.63, 10.84), "dense-static": (5.47, 12.02),
    "dynamic-robot": (5.05, 11.21), "foliage": (5.65, 10.81), "bin-cluster": (5.99, 10.42),
    "diagnostic-light": (6.35, 10.57), "mixed": (5.93, 10.67),
}


def percentile(values: list[float], fraction: float) -> float | None:
    ordered = sorted(float(x) for x in values if isinstance(x, (int, float)) and math.isfinite(x))
    if not ordered:
        return None
    return ordered[max(0, min(len(ordered) - 1, math.ceil(fraction * len(ordered)) - 1))]


def stats(values: list[float]) -> dict:
    kept = [float(x) for x in values if isinstance(x, (int, float)) and math.isfinite(x)]
    return {
        "count": len(kept), "mean": sum(kept) / len(kept) if kept else None,
        "median": percentile(kept, .5), "p50": percentile(kept, .5), "p90": percentile(kept, .9),
        "p95": percentile(kept, .95), "p99": percentile(kept, .99), "max": max(kept) if kept else None,
    }


def source_state() -> dict:
    def git(*args: str) -> str:
        return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    return {"commit": git("rev-parse", "HEAD"), "cleanTrackedState": not bool(git("status", "--porcelain", "--untracked-files=no"))}


def gpu_inventory() -> dict:
    try:
        row = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version,memory.total,pci.bus_id", "--format=csv,noheader,nounits"],
            check=True, capture_output=True, text=True, timeout=30,
        ).stdout.strip().splitlines()[0].split(",")
        return {"name": row[0].strip(), "driver": row[1].strip(), "memoryMiB": int(row[2].strip()), "pciBusId": row[3].strip()}
    except Exception as exc:
        return {"name": "unavailable", "driver": "unavailable", "error": str(exc)}


def make_driver(browser: str):
    if browser == "chrome":
        options = ChromeOptions()
        for arg in (
            "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-component-update",
            "--disable-default-apps", "--disable-sync", "--metrics-recording-only", "--no-first-run", "--enable-webgl",
            "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--remote-allow-origins=*", "--force-device-scale-factor=1",
            "--high-dpi-support=1", "--window-size=1920,1080",
        ):
            options.add_argument(arg)
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        return webdriver.Chrome(options=options)
    options = FirefoxOptions()
    options.set_preference("dom.webgpu.enabled", True)
    options.set_preference("gfx.webrender.all", True)
    options.set_preference("webgl.force-enabled", True)
    options.set_preference("browser.cache.disk.enable", False)
    options.set_preference("browser.cache.memory.enable", False)
    options.set_preference("network.http.use-cache", False)
    driver = webdriver.Firefox(options=options)
    driver.set_window_size(1920, 1080)
    return driver


def wait_payload(driver, timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            last = driver.execute_script("""
                const done=document.body?.dataset?.webgpuTargetBenchmarkDone==='1';
                const text=document.getElementById('webgpuTargetBenchmarkResult')?.textContent||'';
                if(!done||!text)return null;try{return JSON.parse(text)}catch(_e){return null}
            """)
        except JavascriptException:
            last = None
        if isinstance(last, dict):
            return last
        time.sleep(.25)
    raise TimeoutError(f"target benchmark did not finish within {timeout:.0f}s; last={last!r}")


def run_page(driver, base_url: str, *, browser: str, mode: str, scene: str, warmup: int, samples: int, timeout: float, out: Path) -> dict:
    query = urllib.parse.urlencode({"mode": mode, "scene": scene, "quality": "Medium", "gtao": 1 if mode == "sm601" else 0, "width": 1920, "height": 1080, "warmup": warmup, "samples": samples, "seed": 1397572098})
    started = time.monotonic()
    driver.get(f"{base_url}/webgpu-target-benchmark.html?{query}")
    payload = wait_payload(driver, timeout)
    payload["run"] = {"browser": browser, "browserVersion": driver.capabilities.get("browserVersion"), "freshProfile": True, "durationSeconds": round(time.monotonic() - started, 3)}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    driver.save_screenshot(str(out.with_suffix(".png")))
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error") or f"{mode}/{scene} page reported ok=false")
    if len(payload.get("gpuRendererMs") or []) < samples:
        raise RuntimeError(f"{mode}/{scene} retained fewer than {samples} GPU samples")
    return payload


def chrome_sessions(base_url: str, mode: str, scenes: tuple[str, ...], sessions: int, warmup: int, samples: int, timeout: float, raw_root: Path) -> list[dict]:
    rows = []
    for session in range(1, sessions + 1):
        print(f"[{mode}] Chrome session {session}/{sessions}", flush=True)
        driver = make_driver("chrome")
        try:
            driver.set_page_load_timeout(max(60, timeout))
            driver.set_script_timeout(max(60, timeout))
            for scene in scenes:
                print(f"  {scene}: {warmup} warm-up + {samples} retained", flush=True)
                rows.append(run_page(driver, base_url, browser="chrome", mode=mode, scene=scene, warmup=warmup, samples=samples, timeout=timeout, out=raw_root / f"session-{session:02d}" / f"{scene}.json"))
        finally:
            driver.quit()
    return rows


def firefox_spot(base_url: str, warmup: int, samples: int, timeout: float, raw_root: Path) -> dict:
    print(f"[sm501] Firefox representative spot-check: {warmup} warm-up + {samples} retained", flush=True)
    driver = make_driver("firefox")
    try:
        driver.set_page_load_timeout(max(60, timeout)); driver.set_script_timeout(max(60, timeout))
        return run_page(driver, base_url, browser="firefox", mode="sm501", scene="representative", warmup=warmup, samples=samples, timeout=timeout, out=raw_root / "representative.json")
    finally:
        driver.quit()


def sm501_report(rows: list[dict], firefox: dict, source: dict, gpu: dict, warmup: int, samples: int) -> dict:
    scenarios = {}
    for name in SCENARIOS:
        selected = [r for r in rows if r["configuration"]["scene"] == name]
        runs = []
        for row in selected:
            runs.append({
                "warmupFrames": warmup, "gpuRendererMs": row["gpuRendererMs"], "stats": stats(row["gpuRendererMs"]),
                "cpu": {"scenePrepMeanMs": stats(row["cpu"]["scenePrepMs"])["mean"], "encodingMeanMs": stats(row["cpu"]["encodingMs"])["mean"]},
                "workload": row["workload"], "memory": row["memory"], "browser": row["run"], "adapter": row["adapter"],
            })
        pooled = [x for run in runs for x in run["gpuRendererMs"]]
        scenarios[name] = {"runs": runs, "aggregate": {"mean": stats(pooled)["mean"], "p95": stats(pooled)["p95"]}}
    chrome_version = rows[0]["run"]["browserVersion"]
    return {
        "schema": "steelmoth-sm501-gtx1650s/v1", "releaseScope": "sm501-initial-webgpu-release", "qualityPreset": "Medium",
        "effects": {"gtao": {"implemented": True, "enabled": False, "includedInRendererTotal": False, "owner": "SM-601"}},
        "resolution": [1920, 1080], "dpr": 1, "timestampQuery": True, "source": source,
        "environment": {"gpuName": gpu["name"], "driver": gpu["driver"], "os": platform.platform(), "chromeVersion": chrome_version, "firefoxVersion": firefox["run"]["browserVersion"]},
        "methodology": {"warmupFrames": warmup, "measuredFrames": samples, "runsPerScene": 3, "freshChromeProcesses": 3, "totalOnly": True, "passLevelTimingExcluded": True},
        "scenarios": scenarios,
        "firefoxSpotCheck": {"ok": firefox["ok"], "qualityPreset": "Medium", "isFallbackAdapter": firefox["adapter"]["isFallbackAdapter"], "warmupFrames": warmup, "gpuRendererMs": firefox["gpuRendererMs"], "adapter": firefox["adapter"], "browser": firefox["run"]},
        "webgl2BaselineComparison": {"source": "docs/WEBGL2_BASELINE_PERFORMANCE.md", "scenarios": {name: {"webgl2MeanMs": BASELINE[name][0], "webgl2P95Ms": BASELINE[name][1], "webgpuMeanMs": scenarios[name]["aggregate"]["mean"], "webgpuP95Ms": scenarios[name]["aggregate"]["p95"]} for name in SCENARIOS}},
    }


def sm601_report(rows: list[dict], source: dict, gpu: dict, warmup: int, samples: int) -> dict:
    first = rows[0]
    validations = [r.get("validation") or {} for r in rows]
    return {
        "schema": "steelmoth-sm601-target-report/v1", "source": source, "environment": {"adapter": {**first["adapter"], "name": gpu["name"], "fallback": first["adapter"]["isFallbackAdapter"]}, "display": {"width": 1920, "height": 1080, "devicePixelRatio": 1}, "os": platform.platform(), "driver": gpu["driver"]},
        "quality": "Medium", "methodology": {"warmupFrames": warmup, "measuredFrames": samples, "timestampQuery": True, "movingActor": True, "freshRuns": True},
        "runs": [{"measuredFrames": samples, "gtaoGpuMs": {"mean": stats(r["gpuRendererMs"])["mean"], "p50": stats(r["gpuRendererMs"])["p50"], "p95": stats(r["gpuRendererMs"])["p95"]}, "rawGpuMs": r["gpuRendererMs"], "validation": r["validation"], "browser": r["run"], "adapter": r["adapter"]} for r in rows],
        "validation": {"movingSceneStable": all(v.get("movingSceneStable") is True for v in validations), "historyRejection": all(v.get("historyRejection") is True for v in validations), "noDoubleDarkening": all(v.get("noDoubleDarkening") is True for v in validations)},
    }


def sm501_localization_report(rows: list[dict], source: dict, gpu: dict, warmup: int, samples: int) -> dict:
    scenes = {}
    for row in rows:
        name = row["configuration"]["scene"]
        scenes[name] = {
            "browser": row["run"], "adapter": row["adapter"], "workload": row["workload"], "memory": row["memory"],
            "passGpuMs": row["passGpuMs"], "passStats": row["passStats"],
            "sumOfInstrumentedPassesMs": row["gpuRendererMs"], "sumStats": stats(row["gpuRendererMs"]),
        }
    return {
        "schema": "steelmoth-sm501-pass-localization/v1", "source": source,
        "environment": {"gpuName": gpu["name"], "driver": gpu["driver"], "os": platform.platform(), "resolution": [1920, 1080], "dpr": 1},
        "qualityPreset": "Medium", "gtaoEnabled": False,
        "methodology": {"warmupFrames": warmup, "measuredFrames": samples, "timestampQuery": True, "passLevel": True, "acceptanceTiming": False, "separateFromTotalOnlyRun": True, "boundarySubmissionsPerPass": 2},
        "warning": "Pass-level timings and their sums include SM-500 instrumentation boundaries and are localization evidence only; they are not SM-501 release totals.",
        "scenes": scenes,
    }


def write_validator_log(command: list[str], path: Path) -> int:
    run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    path.write_text(run.stdout + run.stderr, encoding="utf-8")
    print(run.stdout.strip() or run.stderr.strip())
    return run.returncode


def main() -> int:
    ap = argparse.ArgumentParser(description="Physical GTX 1650 SUPER SM-501/SM-601 acceptance runner")
    ap.add_argument("--phase", choices=("sm501", "sm501-localization", "sm601", "all"), default="all")
    ap.add_argument("--warmup", type=int, default=300); ap.add_argument("--samples", type=int, default=600); ap.add_argument("--sessions", type=int, default=3)
    ap.add_argument("--timeout", type=float, default=1200); ap.add_argument("--out", type=Path, default=Path("benchmarks/webgpu-gtx1650s"))
    args = ap.parse_args()
    if args.warmup < 300 or args.samples < 600 or args.sessions < 3:
        ap.error("physical acceptance requires >=300 warm-up, >=600 retained samples, and >=3 runs")
    gpu, source = gpu_inventory(), source_state()
    if "GTX 1650 SUPER" not in gpu.get("name", "").upper():
        print(f"physical target not found: {gpu}", file=sys.stderr); return 2
    if not source["cleanTrackedState"]:
        print("tracked source is dirty; refusing to create acceptance evidence", file=sys.stderr); return 2
    out = args.out if args.out.is_absolute() else ROOT / args.out
    server = Server(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT), inject_hosted_firefox_fallback=False))
    threading.Thread(target=server.serve_forever, daemon=True).start(); base = f"http://127.0.0.1:{server.server_address[1]}"
    rc = 0
    try:
        if args.phase in ("sm501", "all"):
            root = out / "sm501-2026-09-19"; rows = chrome_sessions(base, "sm501", SCENARIOS, args.sessions, args.warmup, args.samples, args.timeout, root / "raw" / "chrome"); firefox = firefox_spot(base, args.warmup, args.samples, args.timeout, root / "raw" / "firefox"); report = sm501_report(rows, firefox, source, gpu, args.warmup, args.samples); (root / "target-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"); rc |= write_validator_log([sys.executable, "tools/validate_sm501_target_report.py", str(root / "target-report.json")], root / "validator.log")
        if args.phase in ("sm501-localization", "all"):
            root = out / "sm501-2026-09-19" / "localization"; rows = chrome_sessions(base, "sm501-breakdown", ("representative", "dense-static"), 1, args.warmup, args.samples, args.timeout, root / "raw" / "chrome"); report = sm501_localization_report(rows, source, gpu, args.warmup, args.samples); (root / "pass-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if args.phase in ("sm601", "all"):
            root = out / "sm601-2026-09-19"; rows = chrome_sessions(base, "sm601", ("dynamic-robot",), args.sessions, args.warmup, args.samples, args.timeout, root / "raw" / "chrome"); report = sm601_report(rows, source, gpu, args.warmup, args.samples); (root / "target-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"); rc |= write_validator_log([sys.executable, "tools/validate_sm601_target_report.py", str(root / "target-report.json")], root / "validator.log")
    finally:
        server.shutdown(); server.server_close()
    return 1 if rc else 0


if __name__ == "__main__":
    raise SystemExit(main())
