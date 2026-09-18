#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, os, shlex, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable

CHECKS = [
    ("python-compile", "source", [PY, "-m", "compileall", "-q", "tools"]),
    ("js-game", "source", ["node", "--check", "engine/game.js"]),
    ("js-editor", "source", ["node", "--check", "engine/editor.js"]),
    ("js-surfacefx", "source", ["node", "--check", "engine/surfacefx.js"]),
    ("js-foliagefx", "source", ["node", "--check", "engine/foliagefx.js"]),
    ("js-render-transform", "source", ["node", "--check", "engine/render_transform.js"]),
    ("js-render-transform-integration", "source", ["node", "--check", "engine/render_transform_integration.js"]),
    ("js-render-scene", "source", ["node", "--check", "engine/render_scene.js"]),
    ("js-render-transform-scene-adapter", "source", ["node", "--check", "engine/render_transform_scene_adapter.js"]),
    ("js-webgl2-scene-adapter", "source", ["node", "--check", "engine/webgl2_scene_adapter.js"]),
    ("js-webgpu-device", "source", ["node", "--check", "engine/webgpu_device.js"]),
    ("js-webgpu-resources", "source", ["node", "--check", "engine/webgpu_resources.js"]),
    ("js-webgpu-validation", "source", ["node", "--check", "engine/webgpu_validation.js"]),
    ("js-webgpu-gbuffer", "source", ["node", "--check", "engine/webgpu_gbuffer.js"]),
    ("js-backend-runtime", "source", ["node", "--check", "engine/backend_runtime.js"]),
    ("js-render-harness", "source", ["node", "--check", "engine/render_harness.js"]),
    ("js-render-fixture-adapter", "source", ["node", "--check", "engine/render_fixture_adapter.js"]),
    ("js-webapp", "source", ["node", "--check", "webapp.js"]),
    ("js-service-worker", "source", ["node", "--check", "sw.js"]),
    ("planning", "regression", [PY, "tools/validate_planning.py"]),
    ("render-transform", "regression", ["node", "tools/validate_render_transform.js"]),
    ("render-transform-contract", "regression", [PY, "tools/validate_render_transform_contract.py"]),
    ("render-scene", "regression", ["node", "tools/validate_render_scene.js"]),
    ("render-scene-contract", "regression", [PY, "tools/validate_render_scene_contract.py"]),
    ("webgpu-lifecycle", "regression", ["node", "tools/validate_webgpu_lifecycle.js"]),
    ("webgpu-contract", "regression", [PY, "tools/validate_webgpu_contract.py"]),
    ("webgpu-resources", "regression", ["node", "tools/validate_webgpu_resources.js"]),
    ("webgpu-resources-contract", "regression", [PY, "tools/validate_webgpu_resources_contract.py"]),
    ("webgpu-validation", "regression", ["node", "tools/validate_webgpu_validation.js"]),
    ("webgpu-validation-contract", "regression", [PY, "tools/validate_webgpu_validation_contract.py"]),
    ("webgpu-gbuffer", "regression", ["node", "tools/validate_webgpu_gbuffer.js"]),
    ("webgpu-gbuffer-contract", "regression", [PY, "tools/validate_webgpu_gbuffer_contract.py"]),
    ("render-harness", "regression", [PY, "tools/validate_render_harness.py"]),
    ("render-fixtures", "regression", [PY, "tools/validate_render_fixtures.py", "--repeat", "3"]),
    ("webapp-v123", "regression", [PY, "tools/validate_webapp_v123.py"]),
    ("surface-coherence-v123", "regression", [PY, "tools/validate_v123_surface_coherence.py"]),
    ("renderer-v120", "regression", [PY, "tools/validate_renderer_v120.py"]),
    ("material-v2", "regression", [PY, "tools/validate_material_v2.py"]),
    ("ghost-material", "regression", [PY, "tools/validate_ghost_material_v120.py"]),
    ("visual-material", "regression", [PY, "tools/validate_visual_material_v120.py"]),
    ("v122-coherence", "regression", [PY, "tools/validate_v122_coherence.py"]),
    ("v112-regression", "regression", [PY, "tools/validate_v1_1_2.py"]),
    ("glsl-software", "glsl", [PY, "tools/validate_glsl_v120.py"]),
]

def run_one(name: str, group: str, cmd: list[str]) -> dict:
    started = time.time()
    exe = cmd[0]
    if os.path.sep not in exe and shutil.which(exe) is None:
        return {"name":name,"group":group,"command":cmd,"returncode":127,"duration_s":0,"stdout":"","stderr":f"required executable not found: {exe}"}
    p = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True)
    return {"name":name,"group":group,"command":cmd,"returncode":p.returncode,"duration_s":round(time.time()-started,3),"stdout":p.stdout,"stderr":p.stderr}

def write_report(path: Path|None, payload: dict) -> None:
    if not path: return
    path = path if path.is_absolute() else ROOT/path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2)+"\n", encoding="utf-8")

def main() -> int:
    ap=argparse.ArgumentParser(description="Steel Moth stable local/CI verification entrypoint")
    ap.add_argument("--group", action="append", choices=["source","regression","glsl"], help="group(s) to run; default: source+regression")
    ap.add_argument("--report", type=Path)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--self-test-failure", action="store_true", help="exercise structured failure capture without mutating repository files")
    args=ap.parse_args()
    if args.list:
        for n,g,c in CHECKS: print(f"{g:10} {n:28} {shlex.join(c)}")
        return 0
    if args.self_test_failure:
        r=run_one("deliberate-failure-probe","self-test",[PY,"-c","import sys; print('probe stdout'); print('probe stderr', file=sys.stderr); sys.exit(17)"])
        ok=(r["returncode"]==17 and "probe stdout" in r["stdout"] and "probe stderr" in r["stderr"])
        payload={"schema":"steelmoth-ci-report/v1","mode":"failure-probe","ok":ok,"checks":[r]}
        write_report(args.report,payload)
        print("CI failure-contract self-test:","PASS" if ok else "FAIL")
        if not ok: print(json.dumps(r,indent=2))
        return 0 if ok else 1
    groups=set(args.group or ["source","regression"])
    results=[]
    for name,group,cmd in CHECKS:
        if group not in groups: continue
        print(f"\n== {name} [{group}] ==")
        r=run_one(name,group,cmd);results.append(r)
        if r["stdout"]: print(r["stdout"],end="" if r["stdout"].endswith("\n") else "\n")
        if r["stderr"]: print(r["stderr"],file=sys.stderr,end="" if r["stderr"].endswith("\n") else "\n")
        print(f"exit={r['returncode']} duration={r['duration_s']}s")
    failed=[r for r in results if r["returncode"]!=0]
    payload={"schema":"steelmoth-ci-report/v1","groups":sorted(groups),"ok":not failed,"failed":[r["name"] for r in failed],"checks":results}
    write_report(args.report,payload)
    print(f"\nSteel Moth verification: {'PASS' if not failed else 'FAIL'} ({len(results)-len(failed)}/{len(results)} checks passed)")
    return 1 if failed else 0

if __name__=="__main__":
    raise SystemExit(main())