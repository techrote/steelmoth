from __future__ import annotations
from PIL import Image
import numpy as np, json, math
from pathlib import Path
from scipy.ndimage import distance_transform_edt, gaussian_filter

ROOT = Path(__file__).resolve().parents[1]
ATLAS_JSON = ROOT / 'assets/generated/atlas.json'
ATLAS_IMG = ROOT / 'assets/generated/sprite_runtime_atlas.png'
BUMP_IMG = ROOT / 'assets/generated/sprite_bumpmap.png'
SPEC_IMG = ROOT / 'assets/generated/sprite_specularmap.png'
REPORT_MD = ROOT / 'TERRAIN_LIGHTING_AUDIT_v1.1.2.md'
REPORT_JSON = ROOT / 'assets/generated/terrain_shadow_profiles_v1.1.2.json'

EXCLUDE_PREFIXES = ('floor_', 'item_', 'wall_', 'window_', 'door_')
EXCLUDE_EXACT = {
    'catwalk', 'fence_panel', 'manhole', 'platform_low', 'pipe_wall', 'shutter', 'stairs',
    'utility_drone'
}
INCLUDE_EXACT = {'power_box_wall', 'street_terminal', 'warning_light', 'signal_pole', 'checkpoint_post'}


def contiguous_segments(mask: np.ndarray):
    xs = np.where(mask)[0]
    if xs.size == 0:
        return []
    segs = []
    start = prev = int(xs[0])
    for x in map(int, xs[1:]):
        if x == prev + 1:
            prev = x
            continue
        segs.append((start, prev))
        start = prev = x
    segs.append((start, prev))
    return segs


def classify(name: str, bbox_w: int, bbox_h: int, base_width: int, lower_components: int, base_cov: float) -> str:
    n = name.lower()
    if n.startswith('floor_') or n in {'manhole'}:
        return 'flat'
    if n.startswith(('wall_', 'window_', 'door_')) or n in {'shutter', 'fence_panel', 'pipe_wall', 'power_box_wall'}:
        return 'vertical_plane'
    if any(k in n for k in ('lamp', 'pole', 'bollard', 'post', 'warning_light', 'signal_')):
        return 'pole'
    if any(k in n for k in ('frame', 'scaffold', 'catwalk', 'stairs')):
        return 'frame'
    if 'pipe' in n:
        return 'pipe'
    if 'barrel' in n:
        return 'barrel'
    if any(k in n for k in ('crate', 'cabinet', 'terminal', 'vending', 'dumpster', 'hvac', 'fan', 'barrier', 'bench', 'hut', 'platform')):
        return 'box'
    width_ratio = base_width / max(1, bbox_w)
    if width_ratio < 0.22:
        return 'pole'
    if lower_components >= 2 and base_cov < 0.55:
        return 'frame'
    if bbox_h / max(1, bbox_w) > 1.5 and width_ratio < 0.42:
        return 'pole'
    return 'box'


def analyze_region(name: str, rgba: np.ndarray, material: str):
    alpha = rgba[:, :, 3]
    h, w = alpha.shape
    ys, xs = np.where(alpha > 0)
    if xs.size == 0:
        return None
    left, right = int(xs.min()), int(xs.max())
    top, bottom = int(ys.min()), int(ys.max())
    bbox_h = max(1, bottom - top + 1)
    bbox_w = max(1, right - left + 1)

    band_h = max(3, int(round(h * 0.18)))
    rows = np.arange(max(0, bottom - band_h + 1), bottom + 1)
    rowmask = np.any(alpha[rows, :] > 0, axis=0)
    if rowmask.sum() < max(2, int(w * 0.08)):
        band_h = max(4, int(round(h * 0.28)))
        rows = np.arange(max(0, bottom - band_h + 1), bottom + 1)
        rowmask = np.any(alpha[rows, :] > 0, axis=0)
    lower_components = contiguous_segments(rowmask)
    if not lower_components:
        lower_components = [(left, right)]
    base_seg = max(lower_components, key=lambda s: s[1] - s[0])
    base_left, base_right = base_seg
    base_width = base_right - base_left + 1
    base_cov = float(rowmask.mean())

    kind = classify(name, bbox_w, bbox_h, base_width, len(lower_components), base_cov)
    levels = [0.10, 0.28, 0.46, 0.64, 0.82]
    segments = []
    for idx, lev in enumerate(levels):
        cy = int(round(bottom - lev * bbox_h))
        win = max(1, int(round(h * (0.05 if kind == 'pole' else 0.04))))
        y0, y1 = max(0, cy - win), min(h, cy + win + 1)
        band = np.any(alpha[y0:y1, :] > 0, axis=0)
        segs = sorted(contiguous_segments(band), key=lambda s: (s[1] - s[0] + 1), reverse=True)
        if not segs:
            continue
        keep = segs[:2] if kind in ('frame', 'pipe') else segs[:1]
        keep = sorted(keep, key=lambda s: s[0])
        for j, (sl, sr) in enumerate(keep):
            width = sr - sl + 1
            if width < 2:
                continue
            x0 = (sl - w * 0.5) / w
            x1 = ((sr + 1) - w * 0.5) / w
            y = ((cy + 0.5) - h) / h
            altitude = lev
            alpha_scale = (1.0 - 0.08 * idx) * (0.88 if j else 1.0)
            extend = 1.0 + altitude * 0.55
            segments.append({
                'left': round(float(x0), 4),
                'right': round(float(x1), 4),
                'y': round(float(y), 4),
                'altitude': round(float(altitude), 4),
                'alpha': round(float(alpha_scale), 4),
                'extend': round(float(extend), 4),
            })
    segments.sort(key=lambda s: (s['altitude'], s['left']))
    foot_h = max(2, band_h)
    foot_top = (bottom - foot_h + 1 - h) / h
    foot = {
        'left': round(float((base_left - w * 0.5) / w), 4),
        'right': round(float(((base_right + 1) - w * 0.5) / w), 4),
        'top': round(float(foot_top), 4),
        'bottom': 0.0,
    }
    shiny = 0.76 if material == 'metal' else 0.34
    rough = 0.36 if kind in ('box', 'barrel') else 0.24
    shadow_w = base_width / max(1, w)
    shadow_h = foot_h / max(1, h)
    if kind == 'pole':
        collision_w = min(0.46, max(0.18, shadow_w * 0.58))
    elif kind == 'frame':
        collision_w = min(0.58, max(0.20, shadow_w * 0.74))
    else:
        collision_w = min(0.82, max(0.32, shadow_w * 0.86))
    collision_h = min(0.22, max(0.08, shadow_h))
    return {
        'kind': kind,
        'bbox': {'left': left, 'top': top, 'right': right, 'bottom': bottom},
        'bbox_h': bbox_h,
        'bbox_w': bbox_w,
        'foot': foot,
        'segments': segments,
        'collision_width_factor': round(collision_w, 4),
        'collision_height_factor': round(collision_h, 4),
        'shadow_foot_width_factor': round(min(0.98, max(0.2, shadow_w)), 4),
        'shadow_foot_height_factor': round(min(0.26, max(0.08, shadow_h)), 4),
        'shiny': shiny,
        'rough': rough,
    }


def build_maps(rgba: np.ndarray, profile: dict, material: str):
    arr = rgba.astype(np.float32) / 255.0
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]
    h, w = alpha.shape
    mask = alpha > 0.03
    if not mask.any():
        return None, None
    lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    edt = distance_transform_edt(mask)
    if edt.max() > 0:
        edt = edt / edt.max()
    gx = np.zeros_like(lum)
    gy = np.zeros_like(lum)
    gx[:, 1:-1] = (lum[:, 2:] - lum[:, :-2]) * 0.5
    gy[1:-1, :] = (lum[2:, :] - lum[:-2, :]) * 0.5
    edge = np.sqrt(gx * gx + gy * gy)
    if edge.max() > 1e-6:
        edge /= edge.max()
    yy = np.linspace(0, 1, h, endpoint=False)[:, None]
    xx = np.linspace(0, 1, w, endpoint=False)[None, :]
    top_bias = 1.0 - yy
    center_bias = 1.0 - np.clip(np.abs(xx - 0.5) * 2.0, 0, 1)
    kind = profile['kind']
    if kind == 'flat':
        # Ground tiles should not look like vertical pillows. Relief is local engraving/crack/grate detail only.
        geom = 0.12 * edt + 0.46 * lum + 0.42 * edge
    elif kind == 'vertical_plane':
        # Doors/panels/windows are mostly planar; reserve height variation for frames, seams and hardware.
        geom = 0.18 * edt + 0.42 * lum + 0.34 * edge + 0.06 * center_bias
    elif kind == 'pole':
        geom = 0.42 * edt + 0.28 * top_bias + 0.16 * center_bias + 0.14 * lum
    elif kind == 'frame':
        geom = 0.35 * edt + 0.18 * top_bias + 0.12 * center_bias + 0.17 * lum + 0.18 * edge
    elif kind == 'barrel':
        radial = 1.0 - np.clip(np.abs(xx - 0.5) * 2.0, 0, 1)
        geom = 0.30 * edt + 0.20 * top_bias + 0.22 * radial + 0.16 * lum + 0.12 * edge
    else:
        geom = 0.38 * edt + 0.24 * top_bias + 0.10 * center_bias + 0.18 * lum + 0.10 * edge
    geom = gaussian_filter(geom, sigma=0.6)
    values = geom[mask]
    if values.size and values.max() > values.min():
        geom = (geom - values.min()) / (values.max() - values.min())
    else:
        geom = np.zeros_like(geom)
    cavity = np.clip((1.0 - edt) * 0.55 + edge * 0.25, 0, 1)
    height = np.clip(0.18 + 0.72 * geom - 0.14 * cavity, 0, 1) * mask
    bump = np.zeros((h, w, 4), dtype=np.uint8)
    bump[:, :, :3] = (height[:, :, None] * 255).astype(np.uint8)
    bump[:, :, 3] = (alpha * 255).astype(np.uint8)

    shiny = profile['shiny']
    rough = profile['rough']
    spec_val = np.clip((0.24 + 0.42 * lum + 0.18 * top_bias + 0.12 * edge) * shiny + edt * 0.10 - rough * 0.06, 0, 1)
    if material == 'stone':
        spec_val = np.clip(spec_val * 0.52 + edge * 0.06, 0, 1)
    spec = np.zeros((h, w, 4), dtype=np.uint8)
    spec[:, :, :3] = (spec_val[:, :, None] * 255).astype(np.uint8)
    spec[:, :, 3] = (alpha * 255).astype(np.uint8)
    return bump, spec


def lighting_names(meta: dict):
    # Every static terrain/environment/objective sprite gets regenerated material maps.
    out = []
    for name, m in sorted(meta.items()):
        if name.startswith(('player_', 'hex_', 'fx_', 'foliage_', 'fragment_', 'item_')) or name == 'utility_drone':
            continue
        if m.get('material') in ('metal', 'stone'):
            out.append(name)
    return sorted(set(out))


def shadow_names(meta: dict):
    # Only volumes/standing objects cast projected ground shadows. Flat ground textures remain receivers.
    out = []
    for name in lighting_names(meta):
        m = meta[name]
        if name.startswith('floor_') or name in {'manhole', 'wall_panel', 'wall_vent'}:
            continue
        if m.get('solid') or m.get('casts_shadow') or name.startswith('objective_') or name in INCLUDE_EXACT:
            out.append(name)
    return sorted(set(out))



def height_ratio_for_kind(kind: str) -> float:
    return {
        'flat': 0.05,
        'vertical_plane': 0.82,
        'box': 0.68,
        'barrel': 0.76,
        'pole': 0.96,
        'frame': 0.86,
        'pipe': 0.82,
    }.get(kind, 0.68)


def slices_from_segments(segments: list[dict]) -> list[dict]:
    groups: dict[float, list[dict]] = {}
    for seg in segments:
        a = round(float(seg.get('altitude', 0.0)), 4)
        groups.setdefault(a, []).append({
            'left': float(seg['left']),
            'right': float(seg['right']),
            'alpha': float(seg.get('alpha', 1.0)),
        })
    return [
        {'altitude': a, 'spans': sorted(spans, key=lambda q: q['left'])}
        for a, spans in sorted(groups.items())
    ]


def is_hard_light_occluder(name: str, kind: str) -> bool:
    n = name.lower()
    return kind == 'vertical_plane' and (
        n.startswith(('door_', 'wall_', 'window_')) or
        n in {'shutter', 'fence_panel', 'pipe_wall'}
    )

def main():
    atlas_data = json.loads(ATLAS_JSON.read_text())
    atlas = Image.open(ATLAS_IMG).convert('RGBA')
    bump = Image.open(BUMP_IMG).convert('RGBA')
    spec = Image.open(SPEC_IMG).convert('RGBA')
    bump_arr = np.array(bump)
    spec_arr = np.array(spec)
    atlas_arr = np.array(atlas)
    meta = atlas_data['region_meta']
    regions = atlas_data['regions']
    map_names = lighting_names(meta)
    profile_names = set(shadow_names(meta))
    report = {}
    for name in map_names:
        x, y, w, h = regions[name]
        crop = atlas_arr[y:y+h, x:x+w, :]
        material = meta[name].get('material', 'metal')
        profile = analyze_region(name, crop, material)
        if not profile:
            continue
        meta[name]['lighting_surface_class'] = profile['kind']
        if name in profile_names:
            meta[name]['collision_width_factor'] = profile['collision_width_factor']
            meta[name]['collision_height_factor'] = profile['collision_height_factor']
            meta[name]['shadow_foot_width_factor'] = profile['shadow_foot_width_factor']
            meta[name]['shadow_foot_height_factor'] = profile['shadow_foot_height_factor']
            meta[name]['shadow_profile'] = {
                'version': '1.1.2',
                'space': 'bottom_center_world',
                'kind': profile['kind'],
                'height_ratio': height_ratio_for_kind(profile['kind']),
                'footprint': profile['foot'],
                'slices': slices_from_segments(profile['segments']),
                'segments': profile['segments'],
                'hard_light_occluder': is_hard_light_occluder(name, profile['kind']),
                'projection_model': 'grounded-sectioned-silhouette',
                'notes': 'Altitudes are unitless fractions of rendered sprite height. Runtime converts them to logical/world pixels before ground projection.'
            }
        bump_crop, spec_crop = build_maps(crop, profile, material)
        if bump_crop is not None:
            bump_arr[y:y+h, x:x+w, :] = bump_crop
        if spec_crop is not None:
            spec_arr[y:y+h, x:x+w, :] = spec_crop
        report[name] = {
            'material': material,
            'kind': profile['kind'],
            'footprint': profile['foot'],
            'segment_count': len(profile['segments']),
            'collision_width_factor': profile['collision_width_factor'],
            'collision_height_factor': profile['collision_height_factor'],
            'projected_shadow_profile': name in profile_names,
        }
    notes = atlas_data.get('notes')
    if isinstance(notes, list):
        notes = [n for n in notes if '1.1.1 terrain lighting mapping' not in str(n) and '1.1.2 terrain lighting mapping' not in str(n)]
        notes.append('1.1.2 terrain lighting mapping: sectioned silhouette heights are unitless rendered-height ratios; free-standing props cast projected slice shadows while structural vertical planes may hard-clip the flashlight; bump/specular maps regenerated.')
        atlas_data['notes'] = notes
    Image.fromarray(bump_arr, 'RGBA').save(BUMP_IMG)
    Image.fromarray(spec_arr, 'RGBA').save(SPEC_IMG)
    ATLAS_JSON.write_text(json.dumps(atlas_data, indent=2))
    REPORT_JSON.write_text(json.dumps(report, indent=2))
    lines = [
        '# Terrain Lighting Audit v1.1.2',
        '',
        'This pass fixes the v1.1.1 atlas-pixel/world-pixel shadow-height mismatch, regenerates material maps, and stores sectioned silhouettes in rendered-height-normalized form.',
        '',
        '## Process',
        '',
        '1. Inspect each eligible terrain/objective sprite in the runtime atlas.',
        '2. Derive a grounded footprint from the lower opaque band.',
        '3. Sample multiple horizontal silhouette sections to create a 2.5D shadow profile.',
        '4. Regenerate bump height and specular masks from luminance, silhouette distance, edge detail, and vertical bias.',
        '',
        '## 2.5D interpretation',
        '',
        '- `flat`: floor plates, grates and manholes; local relief only, never vertical bulging.',
        '- `vertical_plane`: doors, windows, wall panels and fences; shallow planar relief.',
        '- `box`: crates, cabinets, barriers, terminals and machinery; volumetric top/side relief.',
        '- `barrel`: cylindrical radial relief.',
        '- `pole`: narrow vertical occluders with tall height projection.',
        '- `frame` / `pipe`: open/multipart silhouettes retain multiple cross-section spans.',
        '',
        '## Updated sprites',
        ''
    ]
    for name in sorted(report):
        info = report[name]
        shadow = f", {info['segment_count']} projected sections" if info['projected_shadow_profile'] else ', receiver/material only'
        lines.append(f"- **{name}** — class `{info['kind']}`{shadow}, collision `{info['collision_width_factor']:.3f} × {info['collision_height_factor']:.3f}`")
    REPORT_MD.write_text('\n'.join(lines) + '\n')
    print(f'Updated {len(report)} terrain/objective sprite profiles.')


if __name__ == '__main__':
    main()
