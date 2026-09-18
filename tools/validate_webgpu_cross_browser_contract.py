#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors = []

def require(condition, message):
    if not condition:
        errors.append(message)

runner = (ROOT / "tools/validate_webgpu_cross_browser.py").read_text(encoding="utf-8")
probe = (ROOT / "webgpu-cross-browser-smoke.html").read_text(encoding="utf-8")
doc = (ROOT / "docs/WEBGPU_FUNCTIONAL_PARITY_VALIDATION.md").read_text(encoding="utf-8")
device = (ROOT / "engine/webgpu_device.js").read_text(encoding="utf-8")
fixtures = json.loads((ROOT / "render-tests/fixtures/index.json").read_text(encoding="utf-8"))
fixture_names = {entry["name"] for entry in fixtures.get("fixtures", [])}

required_pages = {
    "webgpu-cross-browser-smoke.html",
    "webgpu-smoke.html",
    "webgpu-validation-smoke.html",
    "webgpu-gbuffer-smoke.html",
    "webgpu-ownership-smoke.html",
    "webgpu-depth-hierarchy-smoke.html",
    "webgpu-lighting-smoke.html",
    "webgpu-local-shadows-smoke.html",
    "webgpu-occluders-smoke.html",
    "webgpu-clusters-smoke.html",
    "webgpu-dominance-smoke.html",
    "webgpu-dso-smoke.html",
    "webgpu-dso-hierarchy-smoke.html",
    "webgpu-dark-bloom-smoke.html",
    "webgpu-dark-bloom-temporal-smoke.html",
    "webgpu-visibility-smoke.html",
    "webgpu-water-smoke.html",
    "webgpu-foliage-smoke.html",
    "webgpu-transparent-fx-smoke.html",
    "webgpu-post-smoke.html",
    "webgpu-ordering-smoke.html",
    "webgpu-editor-smoke.html",
    "webgpu-transition-smoke.html",
}
for page in sorted(required_pages):
    require(page in runner, f"SM-405 runner is missing required page {page}")

required_fixtures = {
    "single-box", "crate", "barrel", "cabinet", "robot", "pipe-bundle",
    "water-material", "foliage-dense",
    "binsright", "binsleft", "binsupleft", "binsup",
}
require(required_fixtures.issubset(fixture_names), f"fixture catalog missing {sorted(required_fixtures - fixture_names)}")

for gate in ("Gate A", "Gate B", "Gate C", "Gate D", "Gate E"):
    require(gate in doc, f"validation document does not map {gate}")
for browser in ("Chrome", "Firefox"):
    require(browser in doc, f"validation document does not name {browser}")
for fixture in sorted(required_fixtures):
    require(fixture in doc, f"validation document does not account for fixture {fixture}")

require("GTX 1650 Super" in doc and "not" in doc.lower(), "evidence boundary must exclude hosted GTX 1650 Super performance claims")
require("human visual" in doc.lower(), "evidence boundary must state human visual review status")
require("SM-505" in doc and "Auto" in doc, "document must preserve SM-505 Auto promotion ownership")
require("AUTO_WEBGPU_ENABLED = false" in device or "AUTO_WEBGPU_ENABLED=false" in device, "SM-405 must not promote Auto to WebGPU")
require("computeReadback" in probe and "[41,42,43,44]" in probe.replace(" ", ""), "cross-browser probe must retain deterministic compute readback")
require("validation-error-captured" in probe, "cross-browser probe must capture a deliberate WebGPU validation error")
require("production-init-failure-fails-closed" in probe, "cross-browser probe must exercise production initialization failure")
require("presentationOwner:'SM-505" in probe, "SM-405 probe must not claim ownership of final WebGPU presentation")
require('set(args.browsers) == {"chrome", "firefox"}' in runner, "aggregate pass must require both Chrome and Firefox")
require("firefoxBlocklistIgnoredForHostedFunctionalCI" in runner, "Firefox hosted-CI blocklist override must be explicit in evidence")
require("firefoxWebGPUAllowedInParentForHostedHeadlessCI" in runner, "Firefox hosted-CI parent-process override must be explicit in evidence")
require('"dom.webgpu.allow-in-parent", True' in runner, "Firefox hosted runner must explicitly try parent-process WebGPU when the GPU process is unavailable")

if errors:
    print("SM-405 CONTRACT FAIL")
    for error in errors:
        print(" -", error)
    raise SystemExit(1)
print(f"SM-405 CONTRACT PASS: pages={len(required_pages)} fixtures={len(required_fixtures)} gates=A-E browsers=Chrome+Firefox")
