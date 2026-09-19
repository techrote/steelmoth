#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors = []


def need(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


page = (ROOT / "webgpu-target-benchmark.html").read_text(encoding="utf-8")
runner = (ROOT / "tools/run_webgpu_target_campaign.py").read_text(encoding="utf-8")

for token in (
    "WebGPUOwnershipGBuffer", "WebGPUDepthHierarchy", "WebGPULocalShadows", "WebGPUDSOHardCore",
    "WebGPUDSOHierarchy", "WebGPUDarkBloom", "WebGPUDarkBloomTemporal", "WebGPUVisibilityComposition",
    "WebGPUDeferredLighting", "WebGPUGTAO", "WebGPUGTAOTemporal", "WebGPUPost",
    "WebGPUPerformanceInstrumentation", "rendererTotal", "timestamp-query", "rawSamplesRetained",
):
    need(token in page, f"physical target page missing production/timing token: {token}")
need("gtaoEnabled===false" in page and "gtaoExcludedFromRendererTotal" in page, "SM-501 page must make GTAO-off/excluded state executable")
need("minimumCombinedVisibility" in page and "movingDeltaMax" in page and "historyRejection" in page, "SM-601 page must retain physical temporal/composition evidence")
need("precisionCandidate" in page and "octMaterial8" in page and "normalEncoding" in page, "SM-800 page must expose isolated reference/material8/octMaterial8 full-renderer variants")

for token in (
    "SCENARIOS", "freshChromeProcesses", "firefoxSpotCheck", "cleanTrackedState", "gpuRendererMs",
    "validate_sm501_target_report.py", "validate_sm601_target_report.py", "sm501-initial-webgpu-release",
    "validate_sm800_target_report.py", "sm800_report", "referenceToMaterial8", "material8ToOctMaterial8",
):
    need(token in runner, f"physical campaign runner missing report/validation token: {token}")
need('args.warmup < 300 or args.samples < 600 or args.sessions < 3' in runner, "runner must reject sub-canonical acceptance sampling")
need('"includedInRendererTotal": False' in runner and '"owner": "SM-601"' in runner, "SM-501 report must encode GTAO exclusion and ownership")

if errors:
    print("WEBGPU TARGET BENCHMARK CONTRACT FAIL")
    for error in errors:
        print(" -", error)
    raise SystemExit(1)
print("WEBGPU TARGET BENCHMARK CONTRACT PASS: production chain, SM-501 totals, SM-601 GTAO gate, SM-800 full-renderer A/B, raw samples, canonical matrices and strict report validators are wired")
