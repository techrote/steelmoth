#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def text(path: str) -> str:
    p = ROOT / path
    require(p.is_file(), f"missing {path}")
    return p.read_text(encoding="utf-8") if p.is_file() else ""


soak = text("engine/webgpu_soak.js")
regression = text("tools/validate_webgpu_soak.js")
browser = text("tools/validate_webgpu_soak_browser.py")
page = text("webgpu-soak-smoke.html")
doc = text("docs/WEBGPU_SOAK_SM803.md")
run_checks = text("tools/run_checks.py")
package = text("tools/validate_clean_package.py")

for needle in (
    "steelmoth-webgpu-soak/v1",
    "steadyExtentGrowthRejected:true",
    "exactBrowserVramClaimed:false",
    "uncapturedErrorsBlock:true",
    "boundedTransitionLogs:true",
    "boundedEditorLogs:true",
):
    require(needle in soak, f"soak monitor missing contract marker {needle}")

for needle in (
    "1200",
    "room-change",
    "device-rebuild",
    "place",
    "move",
    "delete",
    "undo",
    "redo",
    "createCount-diag.destroyCount",
    "SM803 deliberate init failure",
):
    require(needle in regression, f"deterministic soak regression missing {needle}")

for needle in (
    "--chrome-cycles",
    "default=1500",
    "--firefox-cycles",
    "default=400",
    "freshTemporaryProfiles",
    "exact browser/driver VRAM",
    "device-loss path did not fall back to WebGL2",
    "backend restart did not recover WebGPU",
):
    require(needle in browser, f"browser soak runner missing {needle}")

for needle in (
    "WebGPUDeviceManager",
    "ResourceRegistry",
    "RenderTransitionInvalidationGraph",
    "EditorRenderInvalidationHub",
    "getContext('webgl2'",
    "_deviceLost",
    "afterRestart",
    "close-releases-owned-resources",
):
    require(needle in page, f"real browser soak page missing {needle}")

for needle in (
    "owned-resource",
    "does **not** claim exact process/GPU-driver VRAM",
    "Chrome: 1,500 cycles",
    "Firefox: 400 cycles",
    "initialization failure",
    "device-loss",
):
    require(needle in doc, f"SM-803 documentation missing {needle}")

require('("js-webgpu-soak", "source", ["node", "--check", "engine/webgpu_soak.js"])' in run_checks, "run_checks missing SM-803 source syntax gate")
require('("webgpu-soak", "regression", ["node", "tools/validate_webgpu_soak.js"])' in run_checks, "run_checks missing SM-803 deterministic regression")
require('("webgpu-soak-contract", "regression", [PY, "tools/validate_webgpu_soak_contract.py"])' in run_checks, "run_checks missing SM-803 contract gate")

for needle in (
    "engine/webgpu_soak.js",
    "webgpu-soak-smoke.html",
    "tools/validate_webgpu_soak.js",
    "tools/validate_webgpu_soak_contract.py",
    "docs/WEBGPU_SOAK_SM803.md",
):
    require(needle in package, f"clean-package gate does not require {needle}")

workflow = ROOT / ".github/workflows/sm803-soak.yml"
if (ROOT / ".github").is_dir():
    require(workflow.is_file(), "repository checkout missing .github/workflows/sm803-soak.yml")
    if workflow.is_file():
        workflow_text = workflow.read_text(encoding="utf-8")
        for needle in ("windows-latest", "validate_webgpu_soak.js", "validate_webgpu_soak_contract.py", "validate_webgpu_soak_browser.py", "artifacts/sm803/"):
            require(needle in workflow_text, f"SM-803 workflow missing {needle}")

if errors:
    print("SM-803 CONTRACT FAIL")
    for error in errors:
        print(" -", error)
    raise SystemExit(1)

print("SM-803 CONTRACT PASS: bounded owned-resource soak + Chrome/Firefox lifecycle coverage")
