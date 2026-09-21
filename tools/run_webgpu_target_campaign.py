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


def close_page(driver) -> dict:
    return driver.execute_async_script("""
        const done=arguments[arguments.length-1],close=window.steelmothTargetBenchmarkClose;
        if(typeof close!=='function'){done({ok:false,error:'target benchmark teardown API is unavailable'});return}
        Promise.resolve().then(()=>close()).then(value=>done({ok:true,...value})).catch(error=>done({ok:false,error:String(error?.stack||error)}));
    """)


def run_page(driver, base_url: str, *, browser: str, mode: str, scene: str, warmup: int, samples: int, timeout: float, out: Path, candidate: str | None = None, fresh_process_for_scene: bool = False) -> dict:
    params = {"mode": mode, "scene": scene, "quality": "Medium", "gtao": 1 if mode == "sm601" else 0, "width": 1920, "height": 1080, "warmup": warmup, "samples": samples, "seed": 1397572098}
    if candidate:
        params["candidate"] = candidate
    query = urllib.parse.urlencode(params)
    started = time.monotonic()
    driver.get(f"{base_url}/webgpu-target-benchmark.html?{query}")
    payload = wait_payload(driver, timeout)
    payload["run"] = {"browser": browser, "browserVersion": driver.capabilities.get("browserVersion"), "freshProfile": True, "freshProcessForScene": fresh_process_for_scene, "durationSeconds": round(time.monotonic() - started, 3)}
    out.parent.mkdir(parents=True, exist_ok=True)
    driver.save_screenshot(str(out.with_suffix(".png")))
    payload["run"]["teardown"] = close_page(driver)
    out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if not payload["run"]["teardown"].get("ok"):
        raise RuntimeError(payload["run"]["teardown"].get("error") or f"{mode}/{scene} teardown failed")
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error") or f"{mode}/{scene} page reported ok=false")
    if len(payload.get("gpuRendererMs") or []) < samples:
        raise RuntimeError(f"{mode}/{scene} retained fewer than {samples} GPU samples")
    return payload


def chrome_sessions(base_url: str, mode: str, scenes: tuple[str, ...], sessions: int, warmup: int, samples: int, timeout: float, raw_root: Path, candidate: str | None = None, fresh_process_per_scene: bool = False) -> list[dict]:
    rows = []
    for session in range(1, sessions + 1):
        print(f"[{mode}{'/' + candidate if candidate else ''}] Chrome session {session}/{sessions}", flush=True)
        if fresh_process_per_scene:
            for scene in scenes:
                print(f"  {scene}: {warmup} warm-up + {samples} retained (fresh process)", flush=True)
                driver = make_driver("chrome")
                try:
                    driver.set_page_load_timeout(max(60, timeout))
                    driver.set_script_timeout(max(60, timeout))
                    rows.append(run_page(driver, base_url, browser="chrome", mode=mode, scene=scene, warmup=warmup, samples=samples, timeout=timeout, out=raw_root / f"session-{session:02d}" / f"{scene}.json", candidate=candidate, fresh_process_for_scene=True))
                finally:
                    driver.quit()
            continue
        driver = make_driver("chrome")
        try:
            driver.set_page_load_timeout(max(60, timeout))
            driver.set_script_timeout(max(60, timeout))
            for scene in scenes:
                print(f"  {scene}: {warmup} warm-up + {samples} retained", flush=True)
                rows.append(run_page(driver, base_url, browser="chrome", mode=mode, scene=scene, warmup=warmup, samples=samples, timeout=timeout, out=raw_root / f"session-{session:02d}" / f"{scene}.json", candidate=candidate))
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
            "passGpuMs": row["passGpuMs"], "passCpuCallbackMs": row["passCpuCallbackMs"],
            "passStats": row["passStats"], "passCpuCallbackStats": row["passCpuCallbackStats"],
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


def sm501_diagnostic_report(rows: list[dict], source: dict, gpu: dict, warmup: int, samples: int) -> dict:
    scenes = {}
    for row in rows:
        name = row["configuration"]["scene"]
        scenes[name] = {
            "browser": row["run"], "adapter": row["adapter"], "workload": row["workload"], "memory": row["memory"],
            "gpuRendererMs": row["gpuRendererMs"], "stats": stats(row["gpuRendererMs"]),
            "cpu": {"scenePrepMs": row["cpu"]["scenePrepMs"], "encodingMs": row["cpu"]["encodingMs"], "scenePrepStats": stats(row["cpu"]["scenePrepMs"]), "encodingStats": stats(row["cpu"]["encodingMs"])},
        }
    return {
        "schema": "steelmoth-sm501-isolated-diagnostic/v1", "source": source,
        "environment": {"gpuName": gpu["name"], "driver": gpu["driver"], "os": platform.platform(), "resolution": [1920, 1080], "dpr": 1},
        "qualityPreset": "Medium", "gtaoEnabled": False,
        "methodology": {"warmupFrames": warmup, "measuredFrames": samples, "timestampQuery": True, "totalOnly": True, "freshChromeProcessPerScene": all(row["run"].get("freshProcessForScene") is True for row in rows), "acceptanceTiming": False},
        "warning": "Isolated one-run scene diagnostics are comparison evidence only and do not replace the three-session SM-501 acceptance campaign.",
        "scenes": scenes,
    }


def parity(reference: dict, candidate: dict) -> dict:
    a = ((reference.get("validation") or {}).get("precision") or {}).get("samples") or []
    b = ((candidate.get("validation") or {}).get("precision") or {}).get("samples") or []
    if len(a) != len(b) or not a:
        return {"pass": False, "error": "reference/candidate readback sample mismatch"}
    normal_max = material_max = roughness_max = lighting_max = 0.0
    object_ids_match = True
    for left, right in zip(a, b):
        if [left.get("x"), left.get("y")] != [right.get("x"), right.get("y")]:
            return {"pass": False, "error": "readback coordinates differ"}
        object_ids_match = object_ids_match and left.get("objectId") == right.get("objectId")
        ln, rn = left["normal"], right["normal"]
        dot = max(-1.0, min(1.0, sum(float(x) * float(y) for x, y in zip(ln, rn))))
        normal_max = max(normal_max, math.degrees(math.acos(dot)))
        roughness_max = max(roughness_max, abs(float(left["roughness"]) - float(right["roughness"])))
        material_max = max(material_max, *(abs(float(x) - float(y)) for x, y in zip(left["material"], right["material"])))
        lighting_max = max(lighting_max, *(abs(float(x) - float(y)) for x, y in zip(left["lighting"], right["lighting"])))
    return {"pass": object_ids_match and normal_max <= 1.0 and roughness_max <= 1 / 510 + 1e-6 and material_max <= 1 / 510 + 1e-6 and lighting_max <= .02, "sampleCount": len(a), "objectIdsMatch": object_ids_match, "maxNormalAngleDeg": normal_max, "maxRoughnessAbsError": roughness_max, "maxMaterialAbsError": material_max, "maxLightingAbsError": lighting_max, "thresholds": {"normalAngleDeg": 1.0, "normalizedChannelAbsError": 1 / 510 + 1e-6, "lightingAbsError": .02}}


def sm800_report(rows_by_variant: dict[str, list[dict]], source: dict, gpu: dict, warmup: int, samples: int) -> dict:
    variants = {}
    for variant, rows in rows_by_variant.items():
        variants[variant] = {"scenes": {row["configuration"]["scene"]: {"stats": stats(row["gpuRendererMs"]), "workload": row["workload"], "memory": row["memory"], "adapter": row["adapter"], "browser": row["run"], "readback": (row.get("validation") or {}).get("precision")} for row in rows}}
    comparisons = {}
    reference = variants["reference"]["scenes"]
    reference_rows = {r["configuration"]["scene"]: r for r in rows_by_variant["reference"]}
    for candidate in ("material8", "octMaterial8"):
        comparison_key = {"material8": "referenceToMaterial8", "octMaterial8": "referenceToOctMaterial8"}[candidate]
        scene_rows = {}; useful = regressive = 0
        candidate_rows = {r["configuration"]["scene"]: r for r in rows_by_variant[candidate]}
        for name in SCENARIOS:
            ref_mean = reference[name]["stats"]["mean"]; cand_mean = variants[candidate]["scenes"][name]["stats"]["mean"]
            gain = (ref_mean - cand_mean) / ref_mean if ref_mean else 0.0
            if gain >= .03: useful += 1
            if gain <= -.03: regressive += 1
            scene_rows[name] = {"referenceMeanMs": ref_mean, "candidateMeanMs": cand_mean, "relativeGain": gain, "deltaMs": cand_mean - ref_mean, "readbackParity": parity(reference_rows[name], candidate_rows[name])}
        all_parity = all(row["readbackParity"].get("pass") is True for row in scene_rows.values())
        potentially_useful = useful >= 2 and regressive == 0 and all_parity
        comparisons[comparison_key] = {"scenes": scene_rows, "usefulSceneCount": useful, "regressiveSceneCount": regressive, "allReadbackParity": all_parity, "potentiallyUseful": potentially_useful, "disposition": "paired-confirmation-required" if potentially_useful else "completed-negative-stop"}
    direct = {}
    for name in SCENARIOS:
        a = variants["material8"]["scenes"][name]["stats"]["mean"]; b = variants["octMaterial8"]["scenes"][name]["stats"]["mean"]
        direct[name] = {"material8MeanMs": a, "octMaterial8MeanMs": b, "relativeGain": (a - b) / a if a else 0.0, "deltaMs": b - a}
    comparisons["material8ToOctMaterial8"] = {"scenes": direct}
    return {"schema": "steelmoth-sm800-target-report/v1", "source": source, "environment": {"gpuName": gpu["name"], "driver": gpu["driver"], "os": platform.platform(), "resolution": [1920, 1080], "dpr": 1}, "qualityPreset": "Medium", "gtaoEnabled": False, "methodology": {"warmupFrames": warmup, "measuredFrames": samples, "freshChromeProcessPerVariant": True, "resourceRecreationPerScene": True, "timestampQuery": True, "fullRenderer": True, "initialCanonicalSweep": True}, "variants": variants, "comparisons": comparisons, "referenceContext": {"sameRunReference": True, "compatibleBroadReference": "../sm501-2026-09-19/target-report.json"}}


def write_validator_log(command: list[str], path: Path) -> int:
    run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    path.write_text(run.stdout + run.stderr, encoding="utf-8")
    print(run.stdout.strip() or run.stderr.strip())
    return run.returncode


def main() -> int:
    ap = argparse.ArgumentParser(description="Physical GTX 1650 SUPER SM-501/SM-601 acceptance runner")
    ap.add_argument("--phase", choices=("sm501", "sm501-diagnostic", "sm501-localization", "sm601", "sm800-sweep", "all"), default="all")
    ap.add_argument("--warmup", type=int, default=300); ap.add_argument("--samples", type=int, default=600); ap.add_argument("--sessions", type=int, default=3)
    ap.add_argument("--scenes", nargs="+", choices=SCENARIOS, help="explicit scene selection for SM-501 diagnostic/localization phases")
    ap.add_argument("--reuse-process", action="store_true", help="reuse one Chrome process across selected SM-501 diagnostic scenes")
    ap.add_argument("--timeout", type=float, default=1200); ap.add_argument("--out", type=Path, default=Path("benchmarks/webgpu-gtx1650s"))
    args = ap.parse_args()
    if args.phase in ("sm501", "sm601", "all") and (args.warmup < 300 or args.samples < 600 or args.sessions < 3):
        ap.error("SM-501/601 physical acceptance requires >=300 warm-up, >=600 retained samples, and >=3 runs")
    if args.phase in ("sm501-diagnostic", "sm501-localization") and (args.warmup < 300 or args.samples < 600 or args.sessions < 1):
        ap.error("SM-501 physical diagnostics require >=300 warm-up, >=600 retained samples, and >=1 run")
    if args.phase == "sm800-sweep" and (args.warmup < 100 or args.samples < 200):
        ap.error("SM-800 initial sweep requires >=100 warm-up and >=200 retained samples")
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
        if args.phase == "sm501-diagnostic":
            root = out / "sm501-diagnostic"; scenes = tuple(args.scenes or ("bin-cluster", "diagnostic-light", "dense-static")); rows = chrome_sessions(base, "sm501", scenes, args.sessions, args.warmup, args.samples, args.timeout, root / "raw" / "chrome", fresh_process_per_scene=not args.reuse_process); report = sm501_diagnostic_report(rows, source, gpu, args.warmup, args.samples); (root / "diagnostic-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if args.phase in ("sm501-localization", "all"):
            root = out / "sm501-2026-09-19" / "localization"; scenes = tuple(args.scenes or ("representative", "dense-static")); rows = chrome_sessions(base, "sm501-breakdown", scenes, 1, args.warmup, args.samples, args.timeout, root / "raw" / "chrome", fresh_process_per_scene=bool(args.scenes)); report = sm501_localization_report(rows, source, gpu, args.warmup, args.samples); (root / "pass-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if args.phase in ("sm601", "all"):
            root = out / "sm601-2026-09-19"; rows = chrome_sessions(base, "sm601", ("dynamic-robot",), args.sessions, args.warmup, args.samples, args.timeout, root / "raw" / "chrome"); report = sm601_report(rows, source, gpu, args.warmup, args.samples); (root / "target-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"); rc |= write_validator_log([sys.executable, "tools/validate_sm601_target_report.py", str(root / "target-report.json")], root / "validator.log")
        if args.phase in ("sm800-sweep", "all"):
            root = out / "sm800-2026-09-19"; rows_by_variant = {variant: chrome_sessions(base, "sm800", SCENARIOS, 1, args.warmup, args.samples, args.timeout, root / "raw" / "chrome" / variant, candidate=variant) for variant in ("reference", "material8", "octMaterial8")}; report = sm800_report(rows_by_variant, source, gpu, args.warmup, args.samples); (root / "target-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"); rc |= write_validator_log([sys.executable, "tools/validate_sm800_target_report.py", str(root / "target-report.json")], root / "validator.log")
    finally:
        server.shutdown(); server.server_close()
    return 1 if rc else 0


if __name__ == "__main__":
    raise SystemExit(main())
