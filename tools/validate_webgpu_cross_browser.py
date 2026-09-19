#!/usr/bin/env python3
from __future__ import annotations

import argparse
import functools
import http.server
import json
import platform
import socketserver
import subprocess
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any

from selenium import webdriver
from selenium.common.exceptions import JavascriptException, WebDriverException
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from validate_webgpu_gbuffer_browser import raw_fixture_expectations

ROOT = Path(__file__).resolve().parents[1]

MATRIX = [
    ("api-probe", "webgpu-cross-browser-smoke.html", "A"),
    ("lifecycle-fallback", "webgpu-smoke.html", "A"),
    ("wgsl-resource-validation", "webgpu-validation-smoke.html", "A"),
    ("gbuffer-material-controls", "webgpu-gbuffer-smoke.html", "B,C"),
    ("depth-object-ownership", "webgpu-ownership-smoke.html", "B"),
    ("depth-hierarchy", "webgpu-depth-hierarchy-smoke.html", "B"),
    ("deferred-lighting", "webgpu-lighting-smoke.html", "C"),
    ("local-self-contact-shadows", "webgpu-local-shadows-smoke.html", "C"),
    ("occluder-representation", "webgpu-occluders-smoke.html", "D"),
    ("stable-clusters", "webgpu-clusters-smoke.html", "D"),
    ("dominant-owner-moving-light", "webgpu-dominance-smoke.html", "D"),
    ("dso-hard-core", "webgpu-dso-smoke.html", "D"),
    ("dso-distance-hierarchy", "webgpu-dso-hierarchy-smoke.html", "D"),
    ("dark-bloom", "webgpu-dark-bloom-smoke.html", "D"),
    ("dark-bloom-temporal", "webgpu-dark-bloom-temporal-smoke.html", "D,E"),
    ("visibility-composition", "webgpu-visibility-smoke.html", "C,D"),
    ("water-procedural", "webgpu-water-smoke.html", "C"),
    ("foliage-fine-grass", "webgpu-foliage-smoke.html", "C"),
    ("transparent-effects", "webgpu-transparent-fx-smoke.html", "C"),
    ("post-output", "webgpu-post-smoke.html", "C"),
    ("procedural-ordering", "webgpu-ordering-smoke.html", "C,E"),
    ("editor-ghost-state", "webgpu-editor-smoke.html", "E"),
    ("room-transition-history", "webgpu-transition-smoke.html", "E"),
]

# These pages already exercise the production WebGPUDeviceManager (or, for the
# direct API probe, intentionally own adapter acquisition themselves). The
# remaining historical smoke pages predate the manager and call requestAdapter
# directly. Hosted Firefox on windows-latest exposes only its fallback adapter,
# so the test server injects the same preferred->fallback acquisition policy as
# the production manager into those legacy pages. This is recorded per page and
# is functional/API evidence only; it is never physical adapter certification.
FIREFOX_NATIVE_ADAPTER_PAGES = frozenset({
    "webgpu-cross-browser-smoke.html",
    "webgpu-smoke.html",
    "webgpu-validation-smoke.html",
    "webgpu-gbuffer-smoke.html",
    "webgpu-ownership-smoke.html",
    "webgpu-depth-hierarchy-smoke.html",
})

FIREFOX_FALLBACK_BOOTSTRAP = r"""
<script id="sm405HostedFirefoxAdapterBootstrap">
(() => {
  const gpu = navigator.gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return;
  const original = gpu.requestAdapter.bind(gpu);
  const patched = async options => {
    const first = await original(options || {});
    if (first || (options && options.forceFallbackAdapter)) return first;
    const fallback = await original({forceFallbackAdapter:true});
    if (fallback) window.__sm405HostedFallbackAdapterUses = (window.__sm405HostedFallbackAdapterUses || 0) + 1;
    return fallback;
  };
  let installed = false;
  try { gpu.requestAdapter = patched; installed = gpu.requestAdapter === patched; } catch (_) {}
  if (!installed) {
    try {
      Object.defineProperty(gpu, 'requestAdapter', {value:patched, configurable:true});
      installed = gpu.requestAdapter === patched;
    } catch (_) {}
  }
  window.__sm405HostedFallbackAdapterShimInstalled = installed;
})();
</script>
"""

RESULT_SCRIPT = r"""
return (() => {
  const body = document.body;
  const dataset = body ? Object.fromEntries(Object.entries(body.dataset)) : {};
  const done = Object.entries(dataset).some(([key,value]) => /done$/i.test(key) && value === '1');
  const candidates = [
    ...document.querySelectorAll('script[type="application/json"]'),
    ...document.querySelectorAll('[id$="Result"], [id$="result"]'),
    ...document.querySelectorAll('pre')
  ];
  let parsed = null, source = null;
  for (const node of candidates) {
    const text = String(node.textContent || '').trim();
    if (!text.startsWith('{')) continue;
    try {
      const value = JSON.parse(text);
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'ok')) {
        parsed = value;
        source = node.id || node.tagName;
        if (done) break;
      }
    } catch (_) {}
  }
  return {done, parsed, source, dataset, title: document.title, href: location.href};
})();
"""


def find_key(value: Any, key: str):
    if isinstance(value, dict):
        if key in value:
            yield value[key]
        for child in value.values():
            yield from find_key(child, key)
    elif isinstance(value, list):
        for child in value:
            yield from find_key(child, key)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, inject_hosted_firefox_fallback: bool = True, **kwargs):
        self.inject_hosted_firefox_fallback = inject_hosted_firefox_fallback
        super().__init__(*args, **kwargs)

    def log_message(self, *_args):
        pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        page = Path(urllib.parse.unquote(parsed.path)).name
        if (
            self.inject_hosted_firefox_fallback
            and
            query.get("browser") == ["firefox"]
            and page.endswith(".html")
            and page not in FIREFOX_NATIVE_ADAPTER_PAGES
        ):
            local = Path(self.translate_path(parsed.path))
            try:
                text = local.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                return super().do_GET()
            marker = '<meta charset="utf-8">'
            if marker in text:
                text = text.replace(marker, marker + "\n" + FIREFOX_FALLBACK_BOOTSTRAP, 1)
            else:
                text = FIREFOX_FALLBACK_BOOTSTRAP + "\n" + text
            payload = text.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        return super().do_GET()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def make_driver(name: str, execution_profile: str):
    hosted_ci = execution_profile == "hosted-ci"
    if name == "chrome":
        options = ChromeOptions()
        for arg in [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-sync",
            "--metrics-recording-only",
            "--no-first-run",
            "--enable-webgl",
            "--enable-unsafe-webgpu",
            "--remote-allow-origins=*",
            "--window-size=1280,900",
        ]:
            options.add_argument(arg)
        if hosted_ci:
            options.add_argument("--headless=new")
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        return webdriver.Chrome(options=options)
    if name == "firefox":
        options = FirefoxOptions()
        if hosted_ci:
            options.add_argument("-headless")
        options.set_preference("dom.webgpu.enabled", True)
        options.set_preference("gfx.webrender.all", True)
        if hosted_ci:
            options.set_preference("dom.webgpu.allow-in-parent", True)
            options.set_preference("gfx.webgpu.ignore-blocklist", True)
            options.set_preference("gfx.webrender.software", True)
        options.set_preference("webgl.force-enabled", True)
        options.set_preference("webgl.disabled", False)
        options.set_preference("browser.cache.disk.enable", False)
        options.set_preference("browser.cache.memory.enable", False)
        options.set_preference("network.http.use-cache", False)
        return webdriver.Firefox(options=options)
    raise ValueError(name)


def browser_metadata(driver, name: str, execution_profile: str):
    caps = dict(driver.capabilities or {})
    hosted_ci = execution_profile == "hosted-ci"
    return {
        "browser": name,
        "browserName": caps.get("browserName"),
        "browserVersion": caps.get("browserVersion") or caps.get("version"),
        "platformName": caps.get("platformName"),
        "userAgent": driver.execute_script("return navigator.userAgent"),
        "navigatorPlatform": driver.execute_script("return navigator.platform"),
        "navigatorGpuPresentAtAboutBlank": bool(driver.execute_script("return !!navigator.gpu")),
        "navigatorGpuSecureContextEvidenceComesFromProbe": True,
        "executionProfile": execution_profile,
        "headless": hosted_ci,
        "freshTemporaryProfile": True,
        "firefoxWebGPUPreferenceForcedOn": name == "firefox",
        "firefoxBlocklistIgnoredForHostedFunctionalCI": name == "firefox" and hosted_ci,
        "firefoxWebGPUAllowedInParentForHostedHeadlessCI": name == "firefox" and hosted_ci,
    }


def wait_result(driver, timeout: float):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            last = driver.execute_script(RESULT_SCRIPT)
        except JavascriptException:
            last = None
        if last and last.get("done") and isinstance(last.get("parsed"), dict):
            return last
        time.sleep(0.2)
    raise TimeoutError(f"page did not publish a completed structured result in {timeout:.0f}s; last={last!r}")


def run_browser(name: str, base_url: str, out_dir: Path, timeout: float, execution_profile: str):
    report = {"browser": name, "ok": False, "environment": None, "pages": [], "failures": []}
    driver = None
    try:
        driver = make_driver(name, execution_profile)
        driver.set_page_load_timeout(max(30, timeout))
        driver.set_script_timeout(max(30, timeout))
        report["environment"] = browser_metadata(driver, name, execution_profile)
        gbuffer_expected = json.dumps(raw_fixture_expectations(), separators=(",", ":"))
        for index, (label, page, gates) in enumerate(MATRIX, start=1):
            record = {"label": label, "page": page, "gates": gates, "ok": False}
            started = time.monotonic()
            try:
                query = {"sm405": "1", "browser": name, "run": str(index), "executionProfile": execution_profile}
                if label == "gbuffer-material-controls":
                    query["expected"] = gbuffer_expected
                driver.get(f"{base_url}/{page}?{urllib.parse.urlencode(query)}")
                result = wait_result(driver, timeout)
                payload = result["parsed"]
                record["durationSeconds"] = round(time.monotonic() - started, 3)
                record["schema"] = payload.get("schema")
                record["source"] = result.get("source")
                record["result"] = payload
                record["ok"] = bool(payload.get("ok"))
                real_flags = list(find_key(payload, "realWebGPU"))
                record["realWebGPUFlags"] = real_flags
                if execution_profile == "hosted-ci" and name == "firefox" and page not in FIREFOX_NATIVE_ADAPTER_PAGES:
                    shim = driver.execute_script("return {installed:!!window.__sm405HostedFallbackAdapterShimInstalled, uses:Number(window.__sm405HostedFallbackAdapterUses||0)}")
                    record["hostedFirefoxAdapterShim"] = shim
                    if not shim.get("installed"):
                        raise RuntimeError("hosted Firefox fallback-adapter bootstrap did not install")
                if label == "api-probe":
                    if not payload.get("ok") or (payload.get("webgpu") or {}).get("realWebGPU") is not True:
                        raise RuntimeError("direct cross-browser probe did not prove real WebGPU execution")
                    if (payload.get("webgpu") or {}).get("computeReadback") != [41, 42, 43, 44]:
                        raise RuntimeError("direct cross-browser compute readback mismatch")
                    if execution_profile == "target-hardware":
                        webgpu = payload.get("webgpu") or {}
                        adapter = webgpu.get("adapter") or {}
                        if webgpu.get("highPerformanceAdapterUnavailable") or webgpu.get("fallbackAdapterRequested"):
                            raise RuntimeError("target-hardware run did not acquire the preferred high-performance adapter")
                        if adapter.get("isFallbackAdapter") is not False:
                            raise RuntimeError("target-hardware run exposed a fallback adapter")
                if real_flags and not all(flag is True for flag in real_flags):
                    raise RuntimeError(f"page exposed non-real WebGPU evidence flags: {real_flags}")
                if not payload.get("ok"):
                    raise RuntimeError(str(payload.get("error") or "page reported ok=false"))
                screenshot = out_dir / name / f"{index:02d}-{label}.png"
                screenshot.parent.mkdir(parents=True, exist_ok=True)
                driver.save_screenshot(str(screenshot))
                record["screenshot"] = str(screenshot.relative_to(ROOT))
            except Exception as exc:
                record["durationSeconds"] = round(time.monotonic() - started, 3)
                record["error"] = str(exc)
                report["failures"].append({"label": label, "page": page, "error": str(exc)})
                try:
                    failshot = out_dir / name / f"{index:02d}-{label}-FAIL.png"
                    failshot.parent.mkdir(parents=True, exist_ok=True)
                    driver.save_screenshot(str(failshot))
                    record["failureScreenshot"] = str(failshot.relative_to(ROOT))
                except Exception:
                    pass
            report["pages"].append(record)
        if name == "chrome":
            try:
                logs = driver.get_log("browser")
                report["console"] = logs[-200:]
                severe = [entry for entry in logs if str(entry.get("level", "")).upper() == "SEVERE"]
                significant = [entry for entry in severe if "favicon.ico" not in str(entry.get("message", ""))]
                report["ignoredConsoleNoise"] = [entry for entry in severe if entry not in significant]
                if significant:
                    report["failures"].append({"label": "browser-console", "error": f"{len(significant)} significant SEVERE console entries", "entries": significant[-20:]})
            except WebDriverException as exc:
                report["consoleLogUnavailable"] = str(exc)
        report["gateCoverage"] = {
            gate: [p["label"] for p in report["pages"] if gate in p["gates"].split(",") and p.get("ok")]
            for gate in ("A", "B", "C", "D", "E")
        }
        report["ok"] = not report["failures"] and len(report["pages"]) == len(MATRIX) and all(p.get("ok") for p in report["pages"])
    except Exception as exc:
        report["failures"].append({"label": "browser-startup", "error": str(exc)})
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass
    return report


def windows_video_controllers():
    if platform.system() != "Windows":
        return []
    command = (
        "Get-CimInstance Win32_VideoController | "
        "Select-Object Name,DriverVersion,AdapterRAM,VideoProcessor | "
        "ConvertTo-Json -Compress"
    )
    try:
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", command],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        value = json.loads(completed.stdout)
        return value if isinstance(value, list) else [value]
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
        return [{"inventoryError": str(exc)}]


def git_source_state():
    def run(*args):
        return subprocess.run(
            ["git", *args],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout.strip()

    try:
        return {
            "commit": run("rev-parse", "--verify", "HEAD"),
            "trackedChanges": bool(run("status", "--porcelain", "--untracked-files=no")),
        }
    except (OSError, subprocess.SubprocessError) as exc:
        return {"inventoryError": str(exc)}


def main():
    parser = argparse.ArgumentParser(description="SM-405 Windows Chrome/Firefox functional WebGPU matrix")
    parser.add_argument("--browsers", nargs="+", choices=["chrome", "firefox"], default=["chrome", "firefox"])
    parser.add_argument("--timeout", type=float, default=90.0)
    parser.add_argument("--report", type=Path, default=Path("artifacts/sm405/cross-browser-functional.json"))
    parser.add_argument("--execution-profile", choices=["hosted-ci", "target-hardware"], default="hosted-ci")
    args = parser.parse_args()
    report_path = args.report if args.report.is_absolute() else ROOT / args.report
    out_dir = report_path.parent / "screenshots"
    report_path.parent.mkdir(parents=True, exist_ok=True)

    handler = functools.partial(
        Quiet,
        directory=str(ROOT),
        inject_hosted_firefox_fallback=args.execution_profile == "hosted-ci",
    )
    server = Server(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"
    aggregate = {
        "schema": "steelmoth-sm405-cross-browser-functional/v1",
        "ok": False,
        "matrixVersion": 1,
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "python": platform.python_version(),
            "videoControllers": windows_video_controllers(),
        },
        "executionProfile": args.execution_profile,
        "source": git_source_state(),
        "evidenceBoundary": (
            "Functional/API correctness on the recorded physical Windows GPU and fresh headed browser profiles. "
            "This report is not GPU timing or automated human visual sign-off."
            if args.execution_profile == "target-hardware"
            else "Functional/API correctness on the executing Windows browser environment only. "
            "This report is not GTX 1650 Super timing, physical-target support certification, or human visual sign-off."
        ),
        "browsers": [],
        "requiredGates": ["A", "B", "C", "D", "E"],
        "autoPromotionAllowed": False,
    }
    try:
        for name in args.browsers:
            browser_report = run_browser(name, base_url, out_dir, args.timeout, args.execution_profile)
            aggregate["browsers"].append(browser_report)
        aggregate["ok"] = (
            set(args.browsers) == {"chrome", "firefox"}
            and all(item.get("ok") for item in aggregate["browsers"])
            and all(all(item.get("gateCoverage", {}).get(g) for g in aggregate["requiredGates"]) for item in aggregate["browsers"])
        )
    finally:
        server.shutdown()
        server.server_close()

    report_path.write_text(json.dumps(aggregate, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    for browser_report in aggregate["browsers"]:
        status = "PASS" if browser_report.get("ok") else "FAIL"
        print(f"SM-405 {browser_report.get('browser')} {status}: {len(browser_report.get('pages') or [])}/{len(MATRIX)} pages, failures={len(browser_report.get('failures') or [])}")
        for failure in browser_report.get("failures") or []:
            print(f"  - {failure.get('label')}: {failure.get('error')}")
    print(f"SM-405 CROSS-BROWSER {'PASS' if aggregate['ok'] else 'FAIL'}: {report_path}")
    return 0 if aggregate["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
