#!/usr/bin/env python3
from __future__ import annotations

import argparse
import functools
import json
import platform
import threading
import time
import urllib.parse
from pathlib import Path

from selenium.common.exceptions import WebDriverException
from validate_webgpu_cross_browser import Quiet, Server, browser_metadata, make_driver, wait_result

ROOT = Path(__file__).resolve().parents[1]


def run_browser(name: str, base_url: str, cycles: int, timeout: float, out_dir: Path):
    report = {"browser": name, "cyclesRequested": cycles, "ok": False, "environment": None, "failure": None}
    driver = None
    started = time.monotonic()
    try:
        driver = make_driver(name, "hosted-ci")
        driver.set_page_load_timeout(max(30, timeout))
        driver.set_script_timeout(max(30, timeout))
        report["environment"] = browser_metadata(driver, name, "hosted-ci")
        query = urllib.parse.urlencode({"sm803": "1", "browser": name, "cycles": str(cycles)})
        driver.get(f"{base_url}/webgpu-soak-smoke.html?{query}")
        structured = wait_result(driver, timeout)
        payload = structured["parsed"]
        report["result"] = payload
        report["durationSeconds"] = round(time.monotonic() - started, 3)
        if not payload.get("ok"):
            raise RuntimeError(str(payload.get("error") or "SM-803 page reported ok=false"))
        if int(payload.get("cycles") or 0) != cycles:
            raise RuntimeError(f"cycle mismatch: {payload.get('cycles')} != {cycles}")
        summary = payload.get("resourceSummary") or {}
        if summary.get("ok") is not True or summary.get("totalSamples") != cycles:
            raise RuntimeError(f"resource soak summary invalid: {summary}")
        manager = payload.get("manager") or {}
        if manager.get("status") != "ready" or manager.get("uncapturedErrors"):
            raise RuntimeError(f"WebGPU manager ended unhealthy: {manager}")
        close = payload.get("close") or {}
        after = close.get("after") or {}
        if after.get("resourceCount") != 0 or (after.get("createCount", 0) - after.get("destroyCount", 0)) != 0:
            raise RuntimeError(f"owned resources not released: {after}")
        recovery = payload.get("recovery") or {}
        if (recovery.get("afterLoss") or {}).get("activeBackend") != "webgl2":
            raise RuntimeError("device-loss path did not fall back to WebGL2")
        if (recovery.get("afterRestart") or {}).get("activeBackend") != "webgpu":
            raise RuntimeError("backend restart did not recover WebGPU")
        shot = out_dir / f"{name}-soak.png"
        shot.parent.mkdir(parents=True, exist_ok=True)
        driver.save_screenshot(str(shot))
        report["screenshot"] = str(shot.relative_to(ROOT))
        if name == "chrome":
            try:
                logs = driver.get_log("browser")
                severe = [entry for entry in logs if str(entry.get("level", "")).upper() == "SEVERE" and "favicon.ico" not in str(entry.get("message", ""))]
                report["console"] = logs[-200:]
                if severe:
                    raise RuntimeError(f"{len(severe)} significant Chrome console errors")
            except WebDriverException as exc:
                report["consoleLogUnavailable"] = str(exc)
        report["ok"] = True
    except Exception as exc:
        report["durationSeconds"] = round(time.monotonic() - started, 3)
        report["failure"] = str(exc)
        if driver is not None:
            try:
                shot = out_dir / f"{name}-soak-FAIL.png"
                shot.parent.mkdir(parents=True, exist_ok=True)
                driver.save_screenshot(str(shot))
                report["failureScreenshot"] = str(shot.relative_to(ROOT))
            except Exception:
                pass
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description="SM-803 long-run WebGPU resource/transition soak")
    ap.add_argument("--chrome-cycles", type=int, default=1500)
    ap.add_argument("--firefox-cycles", type=int, default=400)
    ap.add_argument("--timeout", type=float, default=240.0)
    ap.add_argument("--report", type=Path, default=Path("artifacts/sm803/soak-report.json"))
    args = ap.parse_args()
    report_path = args.report if args.report.is_absolute() else ROOT / args.report
    report_path.parent.mkdir(parents=True, exist_ok=True)
    out_dir = report_path.parent / "screenshots"

    handler = functools.partial(Quiet, directory=str(ROOT), inject_hosted_firefox_fallback=False)
    server = Server(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"
    payload = {
        "schema": "steelmoth-sm803-soak-report/v1",
        "ok": False,
        "host": {"system": platform.system(), "release": platform.release(), "python": platform.python_version()},
        "evidenceBoundary": "Renderer-owned resource counts and estimated bytes only; this report does not claim exact browser/driver VRAM usage or target-GPU performance.",
        "policy": {"chromeCycles": args.chrome_cycles, "firefoxCycles": args.firefox_cycles, "freshTemporaryProfiles": True},
        "browsers": [],
    }
    try:
        payload["browsers"].append(run_browser("chrome", base_url, args.chrome_cycles, args.timeout, out_dir))
        payload["browsers"].append(run_browser("firefox", base_url, args.firefox_cycles, args.timeout, out_dir))
        payload["ok"] = all(row.get("ok") for row in payload["browsers"])
    finally:
        server.shutdown(); server.server_close()
    report_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    for row in payload["browsers"]:
        print(f"SM-803 {row['browser']} {'PASS' if row.get('ok') else 'FAIL'}: cycles={row['cyclesRequested']} duration={row.get('durationSeconds')}s")
        if row.get("failure"):
            print(f"  {row['failure']}")
    print(f"SM-803 SOAK {'PASS' if payload['ok'] else 'FAIL'}: {report_path}")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
