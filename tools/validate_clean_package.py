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

def include(path: Path, root: Path = ROOT) -> bool:
    rel=path.relative_to(root)
    if rel.parts and rel.parts[0] in SKIP_TOP: return False
    return not any(p in SKIP_NAMES for p in rel.parts)

def collect_source_files(root: Path = ROOT) -> list[Path]:
    """Collect a complete source tree, refusing aliases and unreadable subtrees.

    pathlib.rglob can silently skip an unreadable directory. Use os.walk with
    an explicit error handler so a partial release ZIP can never pass as
    a complete source archive. Exclusions are pruned before descent.
    """
    files = []

    def walk_error(error: OSError) -> None:
        raise RuntimeError(
            f'cannot inspect clean package source directory: '
            f'{error.filename or root}: {error.strerror or error}'
        ) from error

    for directory, subdirs, names in os.walk(
        root, topdown=True, followlinks=False, onerror=walk_error
    ):
        folder = Path(directory)
        subdirs[:] = [name for name in sorted(subdirs) if include(folder/name, root)]
        for name in (*subdirs, *sorted(names)):
            path = folder/name
            if not include(path, root): continue
            if path.is_symlink():
                raise RuntimeError(
                    f'unsafe symlink in clean package source: {path.relative_to(root).as_posix()}'
                )
            if path.is_file():
                if path.stat().st_nlink > 1:
                    raise RuntimeError(
                        f'unsafe hardlink in clean package source: {path.relative_to(root).as_posix()}'
                    )
                # Refuse Windows-unsafe extracted names during source preflight,
                # so main() retains the structured error and never builds a ZIP.
                safe_member((Path('steelmoth')/path.relative_to(root)).as_posix())
                files.append(path)
            elif not path.is_dir():
                raise RuntimeError(
                    f'non-regular entry in clean package source: {path.relative_to(root).as_posix()}'
                )
    files = sorted(files)
    validate_member_collisions(
        (Path('steelmoth')/source.relative_to(root)).as_posix() for source in files
    )
    return files

def safe_member(name: str) -> None:
    # Recognize both separator conventions and Windows drive components, even
    # when validating an archive on a POSIX CI runner.
    p=PurePosixPath(name.replace('\\','/'))
    if not p.parts or p.is_absolute() or '..' in p.parts or any(':' in part for part in p.parts):
        raise RuntimeError(f'unsafe archive member: {name}')
    for part in p.parts:
        # Win32 extraction may reject, normalize, or alias names accepted by
        # POSIX, including DOS device names with extensions and trailing dots.
        if part.endswith(('.', ' ')) or any(ord(char)<32 or char in '<>"|?*' for char in part):
            raise RuntimeError(f'unsafe archive member: {name}')
        stem=part.split('.',1)[0].rstrip(' ').upper()
        if (stem in {'CON','PRN','AUX','NUL','CONIN$','CONOUT$'} or
            (len(stem)==4 and stem[:3] in {'COM','LPT'} and stem[3] in '123456789¹²³')):
            raise RuntimeError(f'unsafe archive member: {name}')

def validate_member_collisions(names) -> None:
    """Reject case-insensitive file and directory-prefix archive aliases."""
    seen: dict[str, str] = {}
    for name in names:
        safe_member(name)
        parts = PurePosixPath(name.replace(chr(92), '/')).parts
        for length in range(1, len(parts) + 1):
            candidate = '/'.join(parts[:length])
            key = candidate.casefold()
            previous = seen.setdefault(key, candidate)
            if previous != candidate:
                raise RuntimeError(
                    f'case-insensitive archive member collision: {previous} vs {candidate}'
                )


def validate_output_destinations(root: Path, report: Path | None, archive: Path | None) -> None:
    """Reject output/input overlap and report/archive aliases before any writes.

    Existing output files inside a source-included path would be packed on the
    next invocation; report/archive aliases would replace the ZIP with JSON.
    Check both lexical paths and resolved targets (including symlink aliases).
    """
    root=root.resolve()
    resolved={}
    for option,destination in (('report',report),('archive',archive)):
        if destination is None: continue
        requested=destination if destination.is_absolute() else root/destination
        lexical=Path(os.path.abspath(requested))
        target=lexical.resolve()
        # Only existing regular files can safely receive a ZIP/JSON report.
        # A FIFO may hang the validator, while devices such as /dev/null can
        # discard a successful release archive without reporting an error.
        if target.exists() and not target.is_file():
            raise RuntimeError(f'--{option} output is not a regular file: {lexical}')
        resolved[option]=target
        for candidate in (lexical,target):
            if candidate.is_relative_to(root) and include(candidate,root):
                rel=candidate.relative_to(root).as_posix()
                raise RuntimeError(
                    f'--{option} output is included in source package: {rel}; '
                    'use artifacts/ or a destination outside the repository'
                )
    if 'report' in resolved and 'archive' in resolved and (
        resolved['report']==resolved['archive'] or
        (resolved['report'].is_file() and resolved['archive'].is_file() and
         resolved['report'].samefile(resolved['archive']))
    ):
        raise RuntimeError('--report and --archive must have distinct destinations')
    # Paths in artifacts/ or outside the root can still be hardlinks to
    # source files. Writing a report/ZIP would mutate the shared inode.
    # Avoid scanning the source tree for outputs with only one hardlink.
    linked_outputs={
        option:target for option,target in resolved.items()
        if target.is_file() and target.stat().st_nlink>1
    }
    if linked_outputs:
        for source in collect_source_files(root):
            for option,target in linked_outputs.items():
                if source.samefile(target):
                    raise RuntimeError(
                        f'--{option} output is a hardlink to included source: '
                        f'{source.relative_to(root).as_posix()}'
                    )

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
    # Invalid destinations are rejected without touching the report or archive:
    # either may alias an existing source file or each other.
    try:
        validate_output_destinations(ROOT,args.report,args.archive)
    except RuntimeError as error:
        print(f"CLEAN PACKAGE FAIL: {error}",file=sys.stderr)
        return 1
    try:
        files=collect_source_files(ROOT)
    except RuntimeError as error:
        report['error']=str(error)
        if args.report:
            dst=args.report if args.report.is_absolute() else ROOT/args.report
            dst.parent.mkdir(parents=True,exist_ok=True)
            dst.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(f"CLEAN PACKAGE FAIL: {error}",file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory(prefix='steelmoth-package-') as td:
        td=Path(td); archive=td/'steelmoth-source.zip'; extract=td/'extract'
        with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for p in files: z.write(p,Path('steelmoth')/p.relative_to(ROOT))
        with zipfile.ZipFile(archive) as z:
            for i in z.infolist(): safe_member(i.filename)
            z.extractall(extract)
        unpack=extract/'steelmoth'
        required=[
            'engine/webgpu_forward_lighting.js','webgpu-forward-lighting-smoke.html','tools/sm702_forward_fixtures.js','tools/validate_sm702_forward_fixtures.js','tools/validate_sm702_forward_lighting.js','tools/validate_sm702_transparent_materials.js','tools/validate_sm702_forward_browser.py','tools/run_sm702_target_campaign.py','tools/validate_sm702_target_report.py','tools/experiments/sm702_water_baseline.js','tools/experiments/sm702_foliage_baseline.js','tools/experiments/sm702_transparent_fx_baseline.js','docs/WEBGPU_FORWARD_LIGHTING_SM702.md',
            'webgpu-ssgi-stabilization-smoke.html','tools/sm603_ssgi_fixtures.js','tools/validate_webgpu_ssgi_stabilization.js','tools/experiments/sm603_ssgi_baseline.js','tools/validate_sm603_ssgi_browser.py','tools/run_sm603_target_campaign.py','tools/validate_sm603_target_report.py','docs/WEBGPU_SSGI_SM603.md',
            'engine/webgpu_ssgi.js','webgpu-ssgi-smoke.html','tools/validate_webgpu_ssgi.js','tools/validate_sm602_ssgi_lifecycle.js','tools/validate_webgpu_ssgi_browser.py','docs/WEBGPU_SSGI_SM602.md',
            'index.html','engine/game.js','engine/editor.js','engine/surfacefx.js','engine/foliagefx.js',
            'engine/render_transform.js','engine/render_transform_integration.js','engine/render_scene.js','engine/pseudo_depth.js',
            'engine/render_transform_scene_adapter.js','engine/webgl2_scene_adapter.js',
            'engine/webgpu_device.js','engine/webgpu_resources.js','engine/webgpu_validation.js','engine/webgpu_gbuffer.js','engine/webgpu_ownership.js','engine/webgpu_depth_hierarchy.js','engine/webgpu_lighting.js','engine/webgpu_local_shadows.js','engine/webgpu_transparent_fx.js','engine/webgpu_occluders.js','engine/webgpu_clusters.js','engine/webgpu_dominance.js','engine/backend_runtime.js',
            'webgpu-smoke.html','webgpu-resources-smoke.html','webgpu-validation-smoke.html','webgpu-gbuffer-smoke.html','webgpu-ownership-smoke.html','webgpu-depth-hierarchy-smoke.html','webgpu-lighting-smoke.html','webgpu-local-shadows-smoke.html','webgpu-transparent-fx-smoke.html','webgpu-occluders-smoke.html','webgpu-clusters-smoke.html','webgpu-dominance-smoke.html',
            'assets/generated/atlas.json','game_data/maps.json','tools/test_clean_package_sources.py','tools/validate_webapp_v123.py',
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
                [sys.executable,'tools/test_clean_package_sources.py'],
                ['node','tools/validate_webgpu_ssgi_stabilization.js'],
                [sys.executable,'tools/validate_sm603_target_report.py','--self-test'],
                ['node','tools/validate_sm702_forward_lighting.js'],
                ['node','tools/validate_sm702_transparent_materials.js'],
                ['node','tools/validate_sm702_forward_fixtures.js'],
                [sys.executable,'tools/validate_sm702_target_report.py','--self-test'],
                ['node','tools/validate_webgpu_ssgi.js'],
                ['node','tools/validate_sm602_ssgi_lifecycle.js'],
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
        # Never publish a source ZIP that failed extraction, provenance or
        # regression validation. Otherwise --archive exposes an invalid deliverable
        # even while the command exits nonzero.
        if args.archive and report['ok']:
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
