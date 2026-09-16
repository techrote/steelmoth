# Steel Moth v1.2.3 baseline provenance

Status: **authoritative candidate recovered and locally validated; repository source-tree import not yet complete**.

## Recovered artifact

Uploaded artifact name:

`the_small_machine_at_the_edge_of_night_webapp_v1_2_3.zip`

SHA-256:

`2399a50d08785211470a2af86bf693bff71f5d622d717432a595295a23208727`

This exactly matches the SHA-256 previously recorded for the delivered v1.2.3 webapp in the Steel Moth development history.

Archive structure:

- one top-level directory: `the_small_machine_at_the_edge_of_night_webapp_v1_2_3/`;
- 104 ZIP entries total;
- 94 files after extraction;
- extracted file bytes approximately 42.5 MB;
- `WEBAPP_VERSION.txt`: `The Small Machine at the Edge of Night Webapp v1.2.3`;
- `game_manifest.json` version: `1.2.3`;
- 9 rooms / 27 objectives retained according to release validators.

## Integrity check

The archive contains `SHA256SUMS.txt` covering 93 release files. A clean extraction on 2026-09-17 verified every listed checksum successfully (`93/93 OK`).

Important generated runtime/material assets are present, including:

- `assets/generated/sprite_runtime_atlas.png`;
- `assets/generated/sprite_material_normal_roughness.png`;
- `assets/generated/sprite_material_height_material.png`;
- legacy `sprite_bumpmap.png` / `sprite_specularmap.png`;
- `assets/generated/atlas.json`;
- `assets/generated/material_v2_report.json`;
- terrain shadow-profile JSON files.

## v1.2.3 release identity supported by the artifact

`CHANGELOG_v1.2.3.md` records the fixes expected from the last accepted visual baseline:

- Fine GrassField yellow/amber root cause identified and corrected;
- Fine GrassField switched to dark teal vegetation presentation;
- Fine GrassField consumes the lit Material-v2 scene/main-light direction;
- FoliageFX consumes Material-v2 normals/lit-scene visibility;
- hard-light visibility sampling raised to 193 cone / 257 omni rays at quality 3;
- local preview clears/unregisters stale Steel Moth service-worker caches.

It explicitly preserves Material-v2 MRT/deferred lighting, height self-shadow/contact shadows, macro secondary-light shadows, gameplay/editor data, and legacy material fallback.

## Local validation rerun

The following checks were rerun successfully against a clean extraction of the uploaded ZIP:

### JavaScript syntax

- `node --check engine/game.js`
- `node --check engine/surfacefx.js`
- `node --check engine/foliagefx.js`
- `node --check engine/editor.js`
- `node --check webapp.js`

### Release/coherence validators

- `python3 tools/validate_webapp_v123.py` — PASS
- `python3 tools/validate_v123_surface_coherence.py` — PASS
- `python3 tools/validate_v122_coherence.py` — PASS
- `python3 tools/validate_material_v2.py` — PASS, 314 regions
- `python3 tools/validate_renderer_v120.py` — PASS
- `python3 tools/validate_visual_material_v120.py` — PASS
- `python3 tools/validate_ghost_material_v120.py` — PASS
- `python3 tools/validate_webapp_v120.py` — PASS
- `python3 tools/validate_glsl_v120.py` — PASS

The GLSL validator reported OpenGL ES 3.2 Mesa/llvmpipe and successfully compiled/linked **26 production GLSL programs**, including float MRT and RGBA8 fallback framebuffer checks.

## Important validation limitation

The inherited `VALIDATION_v1.2.3.txt` correctly states that the managed validation environment did not provide a trustworthy interactive browser screenshot path. The current recovery rerun therefore proves archive integrity, source/static contracts, Material-v2 generation/layout contracts, GLSL compilation/framebuffer creation under the available native validation path, and the v1.2.3 cache/version closure; it does **not** by itself reproduce the user's original interactive box/bin screenshots or GTX 1650 Super performance.

Those remain separate work in SM-001/002/003 and later WebGPU gates.

## Repository-import status

The uploaded archive resolves the earlier uncertainty about whether the v1.2.3 artifact could be recovered: **the authoritative candidate is available and its identity/inherited validation are strong**.

SM-000 is not yet complete until the complete runnable source/assets are imported into `techrote/steelmoth`, the imported tree is revalidated from a clean repository checkout, and the branch is merged. In particular, several generated PNG atlases are multi-megabyte binary files and must be transferred without altering the baseline.

Do not substitute regenerated/re-encoded images for those baseline files without recording a deliberate import transformation and proving byte/visual/runtime equivalence.
