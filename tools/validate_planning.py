#!/usr/bin/env python3
"""Validate Steel Moth planning documents without requiring implementation source.

Run from repository root:
    python tools/validate_planning.py

This checks the durable repository-side task-code map. GitHub issue existence/body
structure is checked separately during planning reviews and by the programme tracker.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "docs" / "MASTER_WEBGPU_PROGRAMME.md"
ISSUE_MAP = ROOT / "docs" / "ISSUE_MAP.md"
DEPS = ROOT / "docs" / "DEPENDENCY_AND_CONCURRENCY.md"
INDEX = ROOT / "docs" / "INDEX.md"
README = ROOT / "README.md"

TASK_RE = re.compile(r"\bSM-\d{3}\b")
MASTER_HEADING_RE = re.compile(r"^###\s+(SM-\d{3})\s+—\s+", re.MULTILINE)
MAP_ROW_RE = re.compile(
    r"^\|\s*(M\d+)\s*\|\s*(SM-\d{3})\s*\|\s*#(\d+)\s*\|",
    re.MULTILINE,
)


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def read(path: Path) -> str:
    if not path.is_file():
        fail(f"missing required planning file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def duplicates(values: list[str]) -> list[str]:
    seen: set[str] = set()
    dup: set[str] = set()
    for value in values:
        if value in seen:
            dup.add(value)
        seen.add(value)
    return sorted(dup)


def main() -> int:
    master_text = read(MASTER)
    map_text = read(ISSUE_MAP)
    deps_text = read(DEPS)
    index_text = read(INDEX)
    readme_text = read(README)

    master_codes = MASTER_HEADING_RE.findall(master_text)
    if duplicates(master_codes):
        fail(f"duplicate master task codes: {duplicates(master_codes)}")

    map_rows = MAP_ROW_RE.findall(map_text)
    map_codes = [code for _milestone, code, _issue in map_rows]
    issue_numbers = [issue for _milestone, _code, issue in map_rows]

    if duplicates(map_codes):
        fail(f"duplicate task codes in ISSUE_MAP: {duplicates(map_codes)}")
    if duplicates(issue_numbers):
        fail(f"duplicate GitHub issue numbers in ISSUE_MAP: {duplicates(issue_numbers)}")

    if set(master_codes) != set(map_codes):
        missing_in_map = sorted(set(master_codes) - set(map_codes))
        missing_in_master = sorted(set(map_codes) - set(master_codes))
        fail(
            "MASTER/ISSUE_MAP mismatch: "
            f"missing in map={missing_in_map}, missing in master={missing_in_master}"
        )

    expected = 50
    if len(master_codes) != expected:
        fail(f"expected {expected} canonical task codes, found {len(master_codes)}")

    dependency_codes = set(TASK_RE.findall(deps_text))
    unknown_dependency_codes = sorted(dependency_codes - set(master_codes))
    if unknown_dependency_codes:
        fail(f"dependency document references unknown task codes: {unknown_dependency_codes}")

    required_index_names = [
        "MASTER_WEBGPU_PROGRAMME.md",
        "WEBGPU_ARCHITECTURE.md",
        "WEBGPU_VALIDATION_PLAN.md",
        "LIGHTING_FIDELITY_ROADMAP.md",
        "DEPENDENCY_AND_CONCURRENCY.md",
        "RESEARCH_AND_DECISIONS.md",
        "ISSUE_MAP.md",
        "ISSUE_SET_REVIEW_2026-09-16.md",
        "EXECUTION_LEDGER.md",
    ]
    for name in required_index_names:
        if name not in index_text:
            fail(f"docs/INDEX.md does not reference {name}")

    if "50 task issues" not in readme_text or "#51" not in readme_text:
        fail("README does not describe the current 50-task + #51 tracker workflow")

    milestone_counts: dict[str, int] = {}
    for milestone, _code, _issue in map_rows:
        milestone_counts[milestone] = milestone_counts.get(milestone, 0) + 1

    expected_counts = {
        "M0": 6,
        "M1": 5,
        "M2": 8,
        "M3": 8,
        "M4": 6,
        "M5": 6,
        "M6": 4,
        "M7": 3,
        "M8": 4,
    }
    if milestone_counts != expected_counts:
        fail(f"milestone task counts differ: expected={expected_counts}, actual={milestone_counts}")

    print("PASS: Steel Moth planning documents are internally consistent")
    print(f"  canonical tasks: {len(master_codes)}")
    print(f"  mapped GitHub task issues: {len(map_rows)}")
    print(f"  dependency task references: {len(dependency_codes)} unique codes")
    print(f"  milestone counts: {milestone_counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
