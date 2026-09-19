#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path, PurePosixPath

ROOT=Path(__file__).resolve().parents[1]
SKIP_TOP={'.git','.github','artifacts'}
SKIP_NAMES={'__pycache__','.pytest_cache','.mypy_cache','.DS_Store'}

# SHA256SUMS.txt belongs to the imported v1.2.3 distribution. Repository runtime
# code is now intentionally evolving through the migration programme, so the old
# archive checksums remain immutable provenance for content/assets and a small
# set of launcher/static-host files only. Current engine/webapp/backend modules,
# including WebGPU representation passes, are verified by active gates.
BASELINE_RUNTIME_PREFIXES=('assets/generated/','game_data/','icons/')
BASELINE_RUNTIME_ROOT={'.nojekyll','0Play-Webapp-v1.2.3.bat','_headers'}
# SM-503 deliberately regenerates the canonical Material-v2 representation and its
# metadata from the unchanged imported albedo. These paths are no longer frozen
# imported bytes; their determinism/content hashes are owned by the SM-503 generator,
# report and dedicated real-WebGPU gate. Other generated assets remain provenance-
# checked against SHA256SUMS.txt.
BASELINE_EVOLVING_PATHS={
    'assets/generated/atlas.json',
    'assets/generated/material_v2_report.json',
    'assets/generated/sprite_material_height_material.png',
    'assets/generated/sprite_material_normal_roughness.png',
}

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def baseline_sha256_matches(path: Path, expected: str) -> tuple[bool,bool]:
    payload=path.read_bytes()
    raw=hashlib.sha256(payload).hexdigest()
    if raw.lower()==expected.lower(): return True,False
    normalized=payload.replace(b'\r\n',b'\n')
    return hashlib.sha256(normalized).hexdigest().lower()==expected.lower(),normalized != payload

def include(path: Path) -> bool:
    rel=path.relative_to(ROOT)
    if rel.parts and rel.parts[0] in SKIP_TOP: return False
    return not any(p in SKIP_NAMES for p in rel.parts)

def safe_member(name: str) -> None:
    p=PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts: raise RuntimeError(f'unsafe archive member: {name}')

def baseline_runtime_path(name: str) -> bool:
    name=name.replace('\\','/').removeprefix('./')
    if name in BASELINE_EVOLVING_PATHS: return False
    return name in BASELINE_RUNTIME_ROOT or any(name.startswith(prefix) for prefix in BASELINE_RUNTIME_PREFIXES)

def run(root: Path, cmd: list[str]) -> dict:
    env=dict(os.environ);env.setdefault('PYTHONUTF8','1')
    p=subprocess.run(cmd,cwd=root,text=True,capture_output=True,env=env)
    return {'command':cmd,'returncode':p.returncode,'stdout':p.stdout,'stderr':p.stderr}

def main() -> int:
    ap=argparse.ArgumentParser()
    ap.add_argument('--report',type=Path)
    ap.add_argument('--archive',type=Path,help='optional destination for the generated ZIP')
    args=ap.parse_args()
    report={'schema':'steelmoth-clean-package-report/v1','ok':False,'checks':[]}
    with tempfile.TemporaryDirectory(prefix='steelmoth-package-') as td:
        td=Path(td); archive=td/'steelmoth-source.zip'; extract=td/'extract'
        files=[p for p in sorted(ROOT.rglob('*')) if p.is_file() and include(p)]
        with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for p in files: z.write(p,Path('steelmoth')/p.relative_to(ROOT))
        with zipfile.ZipFile(archive) as z:
            for i in z.infolist(): safe_member(i.filename)
            z.extractall(extract)
        unpack=extract/'steelmoth'
        required=[
            'index.html','engine/game.js','engine/editor.js','engine/surfacefx.js','engine/foliagefx.js',
            'engine/render_transform.js','engine/render_transform_integration.js','engine/render_scene.js','engine/pseudo_depth.js',
            'engine/render_transform_scene_adapter.js','engine/webgl2_scene_adapter.js',
            'engine/webgpu_device.js','engine/webgpu_resources.js','engine/webgpu_validation.js','engine/webgpu_gbuffer.js','engine/webgpu_ownership.js','engine/webgpu_depth_hierarchy.js','engine/webgpu_lighting.js','engine/webgpu_local_shadows.js','engine/webgpu_transparent_fx.js','engine/webgpu_occluders.js','engine/webgpu_clusters.js','engine/webgpu_dominance.js','engine/backend_runtime.js',
            'webgpu-smoke.html','webgpu-resources-smoke.html','webgpu-validation-smoke.html','webgpu-gbuffer-smoke.html','webgpu-ownership-smoke.html','webgpu-depth-hierarchy-smoke.html','webgpu-lighting-smoke.html','webgpu-local-shadows-smoke.html','webgpu-transparent-fx-smoke.html','webgpu-occluders-smoke.html','webgpu-clusters-smoke.html','webgpu-dominance-smoke.html',
            'assets/generated/atlas.json','game_data/maps.json','tools/validate_webapp_v123.py',
            'tools/validate_render_scene_contract.py','tools/validate_render_transform_contract.py','tools/validate_pseudo_depth_contract.py',
            'tools/validate_webgpu_contract.py','tools/validate_webgpu_resources_contract.py','tools/validate_webgpu_validation_contract.py','tools/validate_webgpu_gbuffer_contract.py','tools/validate_webgpu_ownership_contract.py','tools/validate_webgpu_depth_hierarchy_contract.py','tools/validate_webgpu_lighting_contract.py','tools/validate_webgpu_local_shadows_contract.py','tools/validate_webgpu_transparent_fx_contract.py','tools/validate_webgpu_occluders_contract.py','tools/validate_webgpu_clusters_contract.py','tools/validate_webgpu_dominance_contract.py',
            'render-tests/webgpu-validation-report.sample.json',
            'docs/ROOT_FOOT_CONVENTION.md','docs/PSEUDO_DEPTH_MODEL.md','docs/WEBGPU_DEVICE_LIFECYCLE.md','docs/WEBGPU_RESOURCE_INFRASTRUCTURE.md','docs/WEBGPU_API_VALIDATION.md','docs/WEBGPU_GBUFFER_SM200.md','docs/WEBGPU_OWNERSHIP_SM202.md','docs/WEBGPU_DEPTH_HIERARCHY_SM203.md','docs/WEBGPU_LIGHTING_SM204.md','docs/WEBGPU_LOCAL_SHADOWS_SM205.md','docs/WEBGPU_TRANSPARENT_FX_SM206.md','docs/WEBGPU_OCCLUDERS_SM300.md','docs/WEBGPU_CLUSTERS_SM301.md','docs/WEBGPU_DOMINANCE_SM302.md'
        ]
        missing=[p for p in required if not (unpack/p).is_file()]
        if missing:
            report['error']='missing required extracted files';report['missing']=missing
        else:
            sums=unpack/'SHA256SUMS.txt';sum_errors=[];sum_total=0;sum_checked=0;sum_skipped=0;sum_normalized=0
            if sums.is_file():
                for raw in sums.read_text(encoding='utf-8').splitlines():
                    raw=raw.strip()
                    if not raw: continue
                    digest,name=raw.split(None,1);name=name.lstrip('* ').strip();sum_total+=1
                    if not baseline_runtime_path(name):
                        sum_skipped+=1
                        continue
                    clean=name.replace('\\','/').removeprefix('./');f=unpack/clean;sum_checked+=1
                    if not f.is_file(): sum_errors.append(f'missing baseline content file: {clean}')
                    else:
                        matches,normalized=baseline_sha256_matches(f,digest)
                        if normalized: sum_normalized+=1
                        if not matches: sum_errors.append(f'baseline content hash mismatch: {clean}')
            report['baseline_sha256_entries_total']=sum_total
            report['baseline_content_entries_checked']=sum_checked
            report['baseline_evolving_entries_skipped']=sum_skipped
            report['baseline_sm503_evolving_paths']=sorted(BASELINE_EVOLVING_PATHS)
            report['baseline_crlf_entries_normalized']=sum_normalized
            report['baseline_sha256_errors']=sum_errors
            checks=[
                [sys.executable,'tools/validate_webapp_v123.py'],
                [sys.executable,'tools/validate_render_scene_contract.py'],
                [sys.executable,'tools/validate_render_transform_contract.py'],
                [sys.executable,'tools/validate_pseudo_depth_contract.py'],
                [sys.executable,'tools/validate_webgpu_contract.py'],
                [sys.executable,'tools/validate_webgpu_resources_contract.py'],
                [sys.executable,'tools/validate_webgpu_validation_contract.py'],
                [sys.executable,'tools/validate_webgpu_gbuffer_contract.py'],
                [sys.executable,'tools/validate_webgpu_ownership_contract.py'],
                [sys.executable,'tools/validate_webgpu_depth_hierarchy_contract.py'],
                [sys.executable,'tools/validate_webgpu_lighting_contract.py'],
                [sys.executable,'tools/validate_webgpu_local_shadows_contract.py'],
                [sys.executable,'tools/validate_webgpu_transparent_fx_contract.py'],
                [sys.executable,'tools/validate_webgpu_occluders_contract.py'],
                [sys.executable,'tools/validate_webgpu_clusters_contract.py'],
                [sys.executable,'tools/validate_webgpu_dominance_contract.py'],
                [sys.executable,'tools/validate_render_harness.py'],
                [sys.executable,'tools/validate_render_fixtures.py','--repeat','2'],
            ]
            results=[run(unpack,c) for c in checks];report['checks']=results
            report['ok']=sum_checked>0 and not sum_errors and all(r['returncode']==0 for r in results)
        report.update({'archive_sha256':sha256(archive),'archive_bytes':archive.stat().st_size,'file_count':len(files)})
        if args.archive:
            dst=args.archive if args.archive.is_absolute() else ROOT/args.archive;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(archive,dst)
    if args.report:
        dst=args.report if args.report.is_absolute() else ROOT/args.report;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    for r in report.get('checks',[]):
        print('$',' '.join(r['command']))
        if r['stdout']: print(r['stdout'],end='' if r['stdout'].endswith('\n') else '\n')
        if r['stderr']: print(r['stderr'],file=sys.stderr,end='' if r['stderr'].endswith('\n') else '\n')
    print(
        f"CLEAN PACKAGE {'PASS' if report['ok'] else 'FAIL'}: "
        f"{report.get('file_count',0)} files, {report.get('archive_bytes',0)} bytes ZIP; "
        f"baseline content hashes {report.get('baseline_content_entries_checked',0)}/"
        f"{report.get('baseline_sha256_entries_total',0)} checked"
    )
    if report.get('baseline_sha256_errors'):
        for e in report['baseline_sha256_errors']: print(' -',e,file=sys.stderr)
    return 0 if report['ok'] else 1

if __name__=='__main__': raise SystemExit(main())
