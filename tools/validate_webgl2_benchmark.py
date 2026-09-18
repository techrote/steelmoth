#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASELINE = ROOT / "benchmarks" / "webgl2-gtx1650s" / "baseline.json"
REQUIRED_SCENARIOS = {
    "representative",
    "empty",
    "dense-static",
    "dynamic-robot",
    "foliage",
    "bin-cluster",
    "diagnostic-light",
    "mixed",
}
REQUIRED_SERIES = {
    "rendererTotal",
    "gbuffer",
    "contactShadow",
    "directLighting",
}
errors: list[str] = []


def need(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


harness = (ROOT / "engine" / "render_harness.js").read_text(encoding="utf-8")
game = (ROOT / "engine" / "game.js").read_text(encoding="utf-8")
runner = (ROOT / "tools" / "benchmark_webgl2.py").read_text(encoding="utf-8")
doc = (ROOT / "docs" / "WEBGL2_BASELINE_PERFORMANCE.md").read_text(encoding="utf-8")

for token in [
    "steelmoth-webgl2-benchmark-run/v1",
    "warmupFrames",
    "sampleFrames",
    "rendererTotal",
    "cpuScenePrepMs",
    "cpuSubmitMs",
    "rawGpuQueryResults",
    "WEBGL_debug_renderer_info",
]:
    need(token in harness or token in game, f"missing benchmark instrumentation token {token}")
for scenario in REQUIRED_SCENARIOS:
    need(re.search(rf'"id":\s*"{re.escape(scenario)}"', runner) is not None, f"runner missing scenario {scenario}")
need("EXT_disjoint_timer_query_webgl2" in harness, "WebGL2 timer query extension not recorded")
need("gpuTimerFrameSerial" in game and "drainGpuTimerResults" in game, "frame-associated asynchronous GPU query retention missing")
need("nvidia-smi" in runner and "driver_version" in runner, "GPU/driver metadata collection missing")
need("freshBrowserAndProfilePerRun" in runner, "browser restart verification metadata missing")
need("300 warm-up" in doc and "600" in doc and "1920×1080" in doc, "canonical methodology missing from baseline document")

if BASELINE.exists():
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    need(baseline.get("schema") == "steelmoth-webgl2-gtx1650s-baseline/v1", "baseline schema")
    need(baseline.get("ok") is True, "baseline report is not successful")
    need(baseline.get("target", {}).get("resolution") == [1920, 1080], "baseline native resolution")
    need(baseline.get("methodology", {}).get("warmupFrames", 0) >= 300, "baseline warm-up count")
    need(baseline.get("methodology", {}).get("samplesPerGpuQueryMode", 0) >= 600, "baseline GPU sample count")
    scenarios = {entry.get("definition", {}).get("id"): entry for entry in baseline.get("scenarios", [])}
    need(set(scenarios) == REQUIRED_SCENARIOS, "baseline scenario set")
    for scenario_id, entry in scenarios.items():
        aggregate = entry.get("aggregate", {})
        need(aggregate.get("runs", 0) >= 3, f"{scenario_id}: independent run count")
        restart = aggregate.get("browserRestartVerification", {})
        need(restart.get("performed") and restart.get("freshBrowserPerRun"), f"{scenario_id}: browser restart verification")
        need(restart.get("outliersRetained") is True, f"{scenario_id}: outlier retention")
        for relative in entry.get("runFiles", []):
            run_path = BASELINE.parent / relative
            need(run_path.exists(), f"{scenario_id}: missing run file {relative}")
            if not run_path.exists():
                continue
            run = json.loads(run_path.read_text(encoding="utf-8"))
            performance = run.get("performance", {})
            need(performance.get("schema") == "steelmoth-webgl2-benchmark-run/v1", f"{relative}: run schema")
            need(run.get("metadata", {}).get("viewport", {}).get("actualNative") == [1920, 1080], f"{relative}: actual native size")
            need(performance.get("gpuTimingAvailable") is True, f"{relative}: GPU timing unavailable")
            renderer = performance.get("environment", {}).get("webgl", {}).get("unmaskedRenderer", "")
            need("GTX 1650 SUPER" in renderer.upper(), f"{relative}: target renderer identity")
            adapter = (run.get("host", {}).get("gpu", {}).get("adapters") or [{}])[0]
            need(bool(adapter.get("driverVersion")), f"{relative}: driver metadata")
            for label in REQUIRED_SERIES:
                count = performance.get("gpu", {}).get("series", {}).get(label, {}).get("statistics", {}).get("count", 0)
                need(count >= 600, f"{relative}: {label} samples")
            need(performance.get("cpu", {}).get("scenePrep", {}).get("statistics", {}).get("count", 0) >= 1200, f"{relative}: CPU prep samples")
            need(performance.get("cpu", {}).get("submit", {}).get("statistics", {}).get("count", 0) >= 1200, f"{relative}: CPU submit samples")
            need(performance.get("counts", {}).get("clusters") is None, f"{relative}: unsupported WebGL2 clusters must be null")
            need(performance.get("counts", {}).get("dso") is None, f"{relative}: unsupported WebGL2 DSO must be null")
            need(performance.get("memory", {}).get("targetBytes", 0) > 0, f"{relative}: target memory estimate")

if errors:
    print("WebGL2 benchmark validation: FAIL")
    for error in errors:
        print(" -", error)
    sys.exit(1)
print("WebGL2 benchmark validation: PASS")
print("baseline:", "measured artifact validated" if BASELINE.exists() else "contract only; target-hardware artifact not present in this checkout")
