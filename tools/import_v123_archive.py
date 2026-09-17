#!/usr/bin/env python3
"""Import the authoritative Steel Moth v1.2.3 source ZIP into a repository checkout.

This helper exists because the original v1.2.3 distribution is itself the editable
HTML/JS/WebGL2/Python/JSON source tree plus binary art/material assets.

Usage from repository root:
    python tools/import_v123_archive.py /path/to/the_small_machine_at_the_edge_of_night_webapp_v1_2_3.zip

The command:
  * verifies the authoritative ZIP SHA-256;
  * rejects unsafe archive paths;
  * verifies the archive's internal SHA256SUMS.txt in a temporary directory;
  * refuses to overwrite the repository planning/control files listed below;
  * copies the release tree byte-for-byte into the repository root;
  * verifies every imported release file against SHA256SUMS.txt;
  * writes docs/BASELINE_V123_IMPORT_REPORT.txt.

It does not commit or push anything and does not modify gameplay/rendering content.
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tempfile
import zipfile

AUTHORITATIVE_ZIP_SHA256 = "2399a50d08785211470a2af86bf693bff71f5d622d717432a595295a23208727"
EXPECTED_ROOT = "the_small_machine_at_the_edge_of_night_webapp_v1_2_3"

# Planning/workflow files created in techrote/steelmoth before the baseline import.
# The v1.2.3 archive does not intentionally own these paths.
PROTECTED_TOP_LEVEL = {"README.md", "AGENTS.md", ".github"}
PROTECTED_DOCS = {
    "INDEX.md",
    "RAG_REFERENCE_STEELMOTH.md",
    "MASTER_WEBGPU_PROGRAMME.md",
    "WEBGPU_ARCHITECTURE.md",
    "WEBGPU_VALIDATION_PLAN.md",
    "LIGHTING_FIDELITY_ROADMAP.md",
    "DEPENDENCY_AND_CONCURRENCY.md",
    "RESEARCH_AND_DECISIONS.md",
    "EXECUTION_LEDGER.md",
    "ISSUE_MAP.md",
    "ISSUE_SET_REVIEW_2026-09-16.md",
    "BASELINE_V123_PROVENANCE.md",
    "BASELINE_V123_FILE_MANIFEST.tsv",
}
PROTECTED_TOOLS = {"validate_planning.py", "import_v123_archive.py"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_member_name(name: str) -> PurePosixPath:
    p = PurePosixPath(name)
    if p.is_absolute() or ".." in p.parts:
        raise ValueError(f"unsafe archive path: {name!r}")
    if not p.parts or p.parts[0] != EXPECTED_ROOT:
        raise ValueError(f"unexpected archive root for {name!r}; expected {EXPECTED_ROOT}/")
    return p


def parse_sha256sums(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        try:
            digest, rel = line.split(None, 1)
        except ValueError as exc:
            raise ValueError(f"bad SHA256SUMS line {lineno}: {raw!r}") from exc
        rel = rel.lstrip("*")
        if rel.startswith("./"):
            rel = rel[2:]
        if len(digest) != 64 or any(c not in "0123456789abcdefABCDEF" for c in digest):
            raise ValueError(f"bad digest on SHA256SUMS line {lineno}")
        out[rel] = digest.lower()
    return out


def is_protected(rel: Path) -> bool:
    parts = rel.parts
    if not parts:
        return True
    if parts[0] in PROTECTED_TOP_LEVEL:
        return True
    if parts[0] == "docs" and len(parts) == 2 and parts[1] in PROTECTED_DOCS:
        return True
    if parts[0] == "tools" and len(parts) == 2 and parts[1] in PROTECTED_TOOLS:
        return True
    return False


def verify_release(root: Path, sums: dict[str, str]) -> list[str]:
    errors: list[str] = []
    for rel, expected in sorted(sums.items()):
        p = root / rel
        if not p.is_file():
            errors.append(f"missing: {rel}")
            continue
        actual = sha256_file(p)
        if actual != expected:
            errors.append(f"sha mismatch: {rel}: expected {expected}, got {actual}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("zip", type=Path, help="authoritative v1.2.3 source ZIP")
    parser.add_argument("--repo", type=Path, default=Path.cwd(), help="repository root (default: cwd)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    zip_path = args.zip.resolve()
    repo = args.repo.resolve()
    if not zip_path.is_file():
        print(f"ERROR: ZIP not found: {zip_path}", file=sys.stderr)
        return 2
    if not (repo / ".git").exists() and not (repo / "README.md").exists():
        print(f"ERROR: {repo} does not look like the Steel Moth repository root", file=sys.stderr)
        return 2

    zip_sha = sha256_file(zip_path)
    if zip_sha != AUTHORITATIVE_ZIP_SHA256:
        print(f"ERROR: ZIP SHA-256 mismatch\n expected {AUTHORITATIVE_ZIP_SHA256}\n actual   {zip_sha}", file=sys.stderr)
        return 3

    with tempfile.TemporaryDirectory(prefix="steelmoth-v123-import-") as td:
        temp = Path(td)
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                safe_member_name(info.filename)
            zf.extractall(temp)

        src = temp / EXPECTED_ROOT
        sums_path = src / "SHA256SUMS.txt"
        if not sums_path.is_file():
            print("ERROR: archive has no SHA256SUMS.txt", file=sys.stderr)
            return 4
        sums = parse_sha256sums(sums_path)
        errors = verify_release(src, sums)
        if errors:
            print("ERROR: archive internal integrity failed:", file=sys.stderr)
            for e in errors:
                print(f"  {e}", file=sys.stderr)
            return 5

        source_files = [p for p in sorted(src.rglob("*")) if p.is_file()]
        conflicts: list[str] = []
        for p in source_files:
            rel = p.relative_to(src)
            dst = repo / rel
            if is_protected(rel):
                conflicts.append(rel.as_posix())
                continue
            if dst.exists() and dst.is_dir():
                print(f"ERROR: destination is a directory, expected file: {rel}", file=sys.stderr)
                return 6

        # None of the authoritative archive's normal release paths should collide with
        # the protected planning files. Treat a future collision as an explicit stop.
        archive_protected = [r for r in conflicts if (src / r).is_file()]
        if archive_protected:
            print("ERROR: archive collides with repository planning/control paths:", file=sys.stderr)
            for r in archive_protected:
                print(f"  {r}", file=sys.stderr)
            return 7

        if args.dry_run:
            print(f"DRY RUN PASS: {len(source_files)} release files, ZIP/internal hashes verified")
            return 0

        copied = 0
        for p in source_files:
            rel = p.relative_to(src)
            if is_protected(rel):
                continue
            dst = repo / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(p, dst)
            copied += 1

        errors = verify_release(repo, sums)
        if errors:
            print("ERROR: repository copy verification failed:", file=sys.stderr)
            for e in errors:
                print(f"  {e}", file=sys.stderr)
            return 8

        report = repo / "docs" / "BASELINE_V123_IMPORT_REPORT.txt"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(
            "Steel Moth v1.2.3 baseline import\n"
            f"ZIP: {zip_path.name}\n"
            f"ZIP SHA-256: {zip_sha}\n"
            f"Internal SHA256SUMS entries verified: {len(sums)}\n"
            f"Release files copied: {copied}\n"
            "Repository copy verification: PASS\n",
            encoding="utf-8",
        )

    print(f"IMPORT PASS: copied {copied} v1.2.3 source files into {repo}")
    print(f"ZIP SHA-256: {zip_sha}")
    print(f"Verified internal release hashes: {len(sums)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
