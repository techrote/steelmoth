#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path, PurePosixPath

ROOT=Path(__file__).resolve().parents[1]
SKIP_TOP={'.git','.github','artifacts'}
SKIP_NAMES={'__pycache__','.pytest_cache','.mypy_cache','.DS_Store'}

# SHA256SUMS.txt belongs to the imported v1.2.3 distribution. Repository runtime
# code is now intentionally evolving through the migration programme, so the old
# archive checksums remain immutable provenance for content/assets and a small
# set of launcher/static-host files only. Current engine/webapp behaviour is
# verified by the active source/regression/GLSL/package tests instead of being
# incorrectly required to remain byte-identical to the imported renderer forever.
BASELINE_RUNTIME_PREFIXES=('assets/generated/','game_data/','icons/')
BASELINE_RUNTIME_ROOT={'.nojekyll','0Play-Webapp-v1.2.3.bat','_headers'}

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def include(path: Path) -> bool:
    rel=path.relative_to(ROOT)
    if rel.parts and rel.parts[0] in SKIP_TOP: return False
    return not any(p in SKIP_NAMES for p in rel.parts)

def safe_member(name: str) -> None:
    p=PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts: raise RuntimeError(f'unsafe archive member: {name}')

def baseline_runtime_path(name: str) -> bool:
    name=name.replace('\\','/').removeprefix('./')
    return name in BASELINE_RUNTIME_ROOT or any(name.startswith(prefix) for prefix in BASELINE_RUNTIME_PREFIXES)

def run(root: Path, cmd: list[str]) -> dict:
    p=subprocess.run(cmd,cwd=root,text=True,capture_output=True)
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
            'engine/render_transform.js','engine/render_transform_integration.js','engine/render_scene.js',
            'engine/render_transform_scene_adapter.js','engine/webgl2_scene_adapter.js',
            'engine/webgpu_device.js','engine/backend_runtime.js','webgpu-smoke.html','assets/generated/atlas.json',
            'game_data/maps.json','tools/validate_webapp_v123.py','tools/validate_render_scene_contract.py',
            'tools/validate_render_transform_contract.py','tools/validate_webgpu_contract.py',
            'docs/ROOT_FOOT_CONVENTION.md','docs/WEBGPU_DEVICE_LIFECYCLE.md'
        ]
        missing=[p for p in required if not (unpack/p).is_file()]
        if missing:
            report['error']='missing required extracted files';report['missing']=missing
        else:
            sums=unpack/'SHA256SUMS.txt';sum_errors=[];sum_total=0;sum_checked=0;sum_skipped=0
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
                    elif sha256(f).lower()!=digest.lower(): sum_errors.append(f'baseline content hash mismatch: {clean}')
            report['baseline_sha256_entries_total']=sum_total
            report['baseline_content_entries_checked']=sum_checked
            report['baseline_evolving_entries_skipped']=sum_skipped
            report['baseline_sha256_errors']=sum_errors
            checks=[
                [sys.executable,'tools/validate_webapp_v123.py'],
                [sys.executable,'tools/validate_render_scene_contract.py'],
                [sys.executable,'tools/validate_render_transform_contract.py'],
                [sys.executable,'tools/validate_webgpu_contract.py'],
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
