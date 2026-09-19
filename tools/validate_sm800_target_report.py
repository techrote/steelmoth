#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

SCENES = ("representative", "empty", "dense-static", "dynamic-robot", "foliage", "bin-cluster", "diagnostic-light", "mixed")
VARIANTS = ("reference", "material8", "octMaterial8")


def need(condition, message):
    if not condition:
        raise ValueError(message)


def finite(value):
    try:
        return math.isfinite(float(value))
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate the physical GTX 1650 SUPER SM-800 full-renderer A/B report.")
    ap.add_argument("report", type=Path)
    args = ap.parse_args()
    data = json.loads(args.report.read_text(encoding="utf-8"))
    try:
        need(data.get("schema") == "steelmoth-sm800-target-report/v1", "wrong schema")
        source = data.get("source") or {}; commit = str(source.get("commit", ""))
        need(len(commit) == 40 and all(c in "0123456789abcdef" for c in commit.lower()), "measured source commit required")
        need(source.get("cleanTrackedState") is True, "measured source must have clean tracked state")
        env = data.get("environment") or {}
        need("1650" in str(env.get("gpuName", "")).lower() and "super" in str(env.get("gpuName", "")).lower(), "physical GTX 1650 SUPER required")
        need(env.get("resolution") == [1920, 1080] and float(env.get("dpr", 0)) == 1.0, "native 1920x1080 DPR 1 required")
        need(str(data.get("qualityPreset", "")).lower() == "medium" and data.get("gtaoEnabled") is False, "Medium GTAO-off configuration required")
        method = data.get("methodology") or {}; warmup = int(method.get("warmupFrames", 0)); samples = int(method.get("measuredFrames", 0))
        need(warmup >= 100 and samples >= 200, "initial sweep requires >=100 warm-up and >=200 retained frames")
        need(method.get("timestampQuery") is True and method.get("fullRenderer") is True and method.get("resourceRecreationPerScene") is True, "full-renderer timestamp-query/resource recreation evidence required")
        variants = data.get("variants") or {}
        need(set(VARIANTS).issubset(variants), "reference/material8/octMaterial8 variants required")
        for variant in VARIANTS:
            scenes = (variants[variant] or {}).get("scenes") or {}
            need(set(SCENES).issubset(scenes), f"{variant}: all canonical scenes required")
            for name in SCENES:
                row = scenes[name] or {}; stats = row.get("stats") or {}; adapter = row.get("adapter") or {}
                need(int(stats.get("count", 0)) >= samples and all(finite(stats.get(k)) for k in ("mean", "p50", "p95")), f"{variant}/{name}: raw distribution summary incomplete")
                need(adapter.get("isFallbackAdapter") is False and "timestamp-query" in (adapter.get("deviceFeatures") or []), f"{variant}/{name}: genuine non-fallback timestamp-query required")
        comparisons = data.get("comparisons") or {}
        for key in ("referenceToMaterial8", "referenceToOctMaterial8"):
            block = comparisons.get(key) or {}; scenes = block.get("scenes") or {}
            need(set(SCENES).issubset(scenes), f"{key}: scene attribution missing")
            for name in SCENES:
                row = scenes[name] or {}; parity = row.get("readbackParity") or {}
                need(all(finite(row.get(k)) for k in ("referenceMeanMs", "candidateMeanMs", "relativeGain", "deltaMs")), f"{key}/{name}: timing attribution incomplete")
                need(int(parity.get("sampleCount", 0)) >= 1 and all(finite(parity.get(k)) for k in ("maxNormalAngleDeg", "maxRoughnessAbsError", "maxMaterialAbsError", "maxLightingAbsError")), f"{key}/{name}: downstream readback parity incomplete")
            if block.get("potentiallyUseful") is True:
                need(block.get("allReadbackParity") is True and block.get("disposition") == "paired-confirmation-required", f"{key}: useful candidate requires parity and paired confirmation")
        need(set(SCENES).issubset((comparisons.get("material8ToOctMaterial8") or {}).get("scenes") or {}), "material8 -> octMaterial8 attribution missing")
        pending = [key for key in ("referenceToMaterial8", "referenceToOctMaterial8") if (comparisons[key] or {}).get("potentiallyUseful") is True]
        result = {"schema": "steelmoth-sm800-target-validation/v1", "ok": True, "pendingPairedConfirmation": pending, "completedNegativeStudy": not pending, "note": "Descriptor savings alone are not acceptance; only measured full-renderer benefit with parity may advance a candidate."}
        print(json.dumps(result, indent=2, sort_keys=True)); return 0
    except Exception as exc:
        print(f"SM-800 TARGET REPORT FAIL: {exc}", file=sys.stderr); return 1


if __name__ == "__main__":
    raise SystemExit(main())
