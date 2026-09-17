#!/usr/bin/env python3
"""Validate Steel Moth deterministic render fixtures and recovered references.

SM-001 deliberately owns fixture data and provenance, not browser capture automation.
SM-002 consumes this corpus in the renderer harness.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "render-tests" / "fixtures"
REFERENCE_ROOT = ROOT / "render-tests" / "references"
ATLAS = ROOT / "assets" / "generated" / "atlas.json"
INDEX = FIXTURE_DIR / "index.json"
PROVENANCE = REFERENCE_ROOT / "provenance.json"

REQUIRED_SCENE_KEYS = {
    "walls", "water", "path_cells", "objects", "blocker_styles",
    "tall_scenery", "collectibles", "companions", "decor_lamps",
    "editor_decor", "pattern_decor", "ambient_groups", "foliage_clumps",
    "decor_exclusions", "pattern_exclusions", "object_fx_hidden",
    "outer_border_depth", "foliage_density", "floor_microtile",
}
CANONICAL_ANGLES = {0, 45, 90, 135, 180, 225, 270, 315}


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def canonical_state(fixture: dict) -> bytes:
    state = {key: fixture[key] for key in ("deterministic", "camera", "light", "scene")}
    return json.dumps(
        state, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def state_sha256(fixture: dict) -> str:
    return hashlib.sha256(canonical_state(fixture)).hexdigest()


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def assert_xy(label: str, value):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f"{label}: expected [x, y]")
    if not all(isinstance(v, (int, float)) for v in value):
        raise ValueError(f"{label}: coordinates must be numeric")


def iter_asset_references(scene: dict):
    for key, style in scene.get("blocker_styles", {}).items():
        if isinstance(style, dict) and style.get("sprite"):
            yield f"blocker_styles[{key}].sprite", style["sprite"]
    for item in scene.get("editor_decor", []):
        if item.get("sprite"):
            yield f"editor_decor[{item.get('editor_id', '?')}].sprite", item["sprite"]
    for idx, item in enumerate(scene.get("decor_lamps", [])):
        if item.get("lamp"):
            yield f"decor_lamps[{idx}].lamp", item["lamp"]
    for idx, item in enumerate(scene.get("pattern_decor", [])):
        if item.get("sprite"):
            yield f"pattern_decor[{idx}].sprite", item["sprite"]


def validate_scene(name: str, scene: dict, atlas_regions: set[str]):
    missing_keys = sorted(REQUIRED_SCENE_KEYS - set(scene))
    if missing_keys:
        raise ValueError(f"{name}: scene missing keys: {', '.join(missing_keys)}")

    for list_key in (
        "walls", "water", "path_cells", "tall_scenery", "collectibles",
        "companions", "decor_lamps", "editor_decor", "pattern_decor",
        "ambient_groups", "foliage_clumps", "decor_exclusions",
        "pattern_exclusions", "object_fx_hidden",
    ):
        if not isinstance(scene[list_key], list):
            raise ValueError(f"{name}: scene.{list_key} must be a list")
    if not isinstance(scene["objects"], dict) or not isinstance(scene["blocker_styles"], dict):
        raise ValueError(f"{name}: scene objects/blocker_styles must be objects")

    for list_key in ("walls", "water", "path_cells"):
        for i, xy in enumerate(scene[list_key]):
            assert_xy(f"{name}: scene.{list_key}[{i}]", xy)
            x, y = xy
            if not (0 <= x < 40 and 0 <= y < 19):
                raise ValueError(f"{name}: scene.{list_key}[{i}] outside 40x19 grid: {xy}")

    ids = set()
    for i, item in enumerate(scene["editor_decor"]):
        editor_id = item.get("editor_id")
        if not editor_id or editor_id in ids:
            raise ValueError(f"{name}: editor_decor[{i}] has missing/duplicate editor_id")
        ids.add(editor_id)
        for field in ("x", "y", "scale"):
            if not isinstance(item.get(field), (int, float)):
                raise ValueError(f"{name}: editor_decor[{i}].{field} must be numeric")

    for i, clump in enumerate(scene["foliage_clumps"]):
        if not isinstance(clump.get("seed"), int):
            raise ValueError(f"{name}: foliage_clumps[{i}] requires an explicit integer seed")
        for field in ("x", "y", "radius", "density"):
            if not isinstance(clump.get(field), (int, float)):
                raise ValueError(f"{name}: foliage_clumps[{i}].{field} must be numeric")

    for label, asset in iter_asset_references(scene):
        if asset not in atlas_regions:
            raise ValueError(f"{name}: {label} references missing atlas region {asset!r}")


def validate_fixture(path: Path, expected_sha: str, atlas_regions: set[str], repeat: int):
    snapshots = []
    fixture = None
    for _ in range(repeat):
        fixture = read_json(path)
        snapshots.append(canonical_state(fixture))
    if any(snapshot != snapshots[0] for snapshot in snapshots[1:]):
        raise ValueError(f"{path.name}: repeated loads produced different deterministic state")

    name = path.stem
    if fixture.get("schema") != "steelmoth-render-fixture/v1":
        raise ValueError(f"{name}: unsupported schema {fixture.get('schema')!r}")
    if fixture.get("name") != name:
        raise ValueError(f"{name}: internal name differs from filename")
    det = fixture.get("deterministic", {})
    if det.get("requires_gameplay_save_state") is not False:
        raise ValueError(f"{name}: fixture must explicitly require no gameplay save state")
    if not isinstance(det.get("seed"), int):
        raise ValueError(f"{name}: deterministic.seed must be an integer")
    if det.get("recommended_frozen_time_ms") != 0:
        raise ValueError(f"{name}: recommended_frozen_time_ms must be 0 in v1 fixtures")

    camera = fixture.get("camera", {})
    assert_xy(f"{name}: camera.player", camera.get("player"))
    assert_xy(f"{name}: camera.aim", camera.get("aim"))
    if camera.get("logical_resolution") != [640, 360]:
        raise ValueError(f"{name}: logical_resolution must preserve the v1.2.3 640x360 contract")

    light = fixture.get("light", {})
    angle = light.get("angle_deg")
    if angle not in CANONICAL_ANGLES:
        raise ValueError(f"{name}: light angle {angle!r} is not one of the eight canonical angles")
    required_light = {
        "preset": "diagnostic-v1",
        "emissive": 2.0,
        "light_radius": 2.0,
        "player_omni_radius": 80,
        "player_omni_intensity": 1.6,
        "player_cone_intensity": 2.0,
        "player_cone_inner_angle_deg": 30,
        "player_cone_outer_angle_deg": 60,
    }
    for key, expected in required_light.items():
        if light.get(key) != expected:
            raise ValueError(f"{name}: diagnostic light field {key}={light.get(key)!r}, expected {expected!r}")

    if not fixture.get("expected_observations"):
        raise ValueError(f"{name}: expected_observations must not be empty")
    validate_scene(name, fixture.get("scene", {}), atlas_regions)

    actual_sha = state_sha256(fixture)
    if actual_sha != expected_sha:
        raise ValueError(f"{name}: deterministic state hash {actual_sha} != manifest {expected_sha}")
    return fixture, actual_sha


def validate_references(provenance: dict):
    recovered = provenance.get("recovered", {})
    if not recovered:
        raise ValueError("reference provenance has no recovered files")
    for filename, meta in recovered.items():
        path = ROOT / meta["path"]
        if not path.is_file():
            raise ValueError(f"reference {filename}: file missing at {meta['path']}")
        if path.name != filename:
            raise ValueError(f"reference {filename}: path filename changed")
        size = path.stat().st_size
        if size != meta["bytes"]:
            raise ValueError(f"reference {filename}: byte count {size} != {meta['bytes']}")
        digest = file_sha256(path)
        if digest != meta["sha256"]:
            raise ValueError(f"reference {filename}: sha256 {digest} != {meta['sha256']}")

    resolution = provenance.get("historical_reference_resolution", {})
    missing = resolution.get("binsupleft", {})
    if missing.get("status") != "missing":
        raise ValueError("binsupleft provenance must explicitly remain 'missing' until authoritative recovery")
    if resolution.get("binsupright", {}).get("status") != "recovered-supplementary":
        raise ValueError("binsupright must remain supplementary and must not substitute for binsupleft")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", help="validate/load one named fixture instead of the full corpus")
    parser.add_argument("--repeat", type=int, default=3, help="repeat JSON loads to check deterministic state")
    parser.add_argument("--print-state", action="store_true", help="print canonical deterministic state for the selected fixture")
    args = parser.parse_args()
    if args.repeat < 2:
        parser.error("--repeat must be >= 2")

    atlas = read_json(ATLAS)
    atlas_regions = set(atlas.get("regions", {}))
    if not atlas_regions:
        raise ValueError("atlas has no regions")

    index = read_json(INDEX)
    entries = {entry["name"]: entry for entry in index.get("fixtures", [])}
    if not entries:
        raise ValueError("fixture index is empty")

    selected = [args.fixture] if args.fixture else sorted(entries)
    unknown = [name for name in selected if name not in entries]
    if unknown:
        raise ValueError(f"unknown fixture(s): {', '.join(unknown)}")

    seen_files = set()
    results = []
    for name in selected:
        entry = entries[name]
        file_name = entry["file"]
        if file_name in seen_files:
            raise ValueError(f"duplicate fixture file in index: {file_name}")
        seen_files.add(file_name)
        path = FIXTURE_DIR / file_name
        if not path.is_file():
            raise ValueError(f"{name}: fixture file missing: {file_name}")
        fixture, digest = validate_fixture(path, entry["state_sha256"], atlas_regions, args.repeat)
        results.append((name, digest))
        if args.print_state:
            print(canonical_state(fixture).decode("utf-8"))

    if not args.fixture:
        fixture_files = {p.name for p in FIXTURE_DIR.glob("*.json") if p.name != "index.json"}
        indexed_files = {entry["file"] for entry in entries.values()}
        extra = sorted(fixture_files - indexed_files)
        missing = sorted(indexed_files - fixture_files)
        if extra or missing:
            raise ValueError(f"fixture index mismatch: extra={extra}, missing={missing}")
        validate_references(read_json(PROVENANCE))

    for name, digest in results:
        print(f"PASS {name} {digest}")
    if not args.fixture:
        print(f"PASS references {len(read_json(PROVENANCE)['recovered'])} exact PNGs")
        print(f"PASS corpus {len(results)} fixtures; repeated loads={args.repeat}; gameplay save state=not required")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
