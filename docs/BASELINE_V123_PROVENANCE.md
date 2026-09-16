# Steel Moth v1.2.3 baseline provenance

Status: **authoritative v1.2.3 source distribution recovered and locally validated; repository source-tree import remains open pending binary-asset transfer**.

## Recovered artifact

Uploaded artifact name:

`the_small_machine_at_the_edge_of_night_webapp_v1_2_3.zip`

SHA-256:

`2399a50d08785211470a2af86bf693bff71f5d622d717432a595295a23208727`

This exactly matches the SHA-256 previously recorded for the delivered v1.2.3 webapp in the Steel Moth development history.

Steel Moth v1.2.3 is a raw HTML/JavaScript/WebGL2/Python/JSON project. The webapp ZIP is therefore the **editable source distribution**, not an opaque compiled build. There is no separate source edition that must be recovered before SM-000 can proceed.

Archive structure:

- one top-level directory: `the_small_machine_at_the_edge_of_night_webapp_v1_2_3/`;
- 104 ZIP entries total;
- 94 files after extraction;
- extracted file bytes approximately 42.5 MB;
- `WEBAPP_VERSION.txt`: `The Small Machine at the Edge of Night Webapp v1.2.3`;
- `game_manifest.json` version: `1.2.3`;
- 9 rooms / 27 objectives retained according to release validators.

The exact per-file byte count and SHA-256 list captured from the recovered artifact is committed as `docs/BASELINE_V123_FILE_MANIFEST.tsv` on the import branch.

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

## Generated-material reproducibility check

A copied clean extraction was used to rerun both deterministic material generators without modifying the authoritative archive copy:

```text
python3 tools/generate_material_v2.py
python3 tools/regenerate_terrain_lighting_maps.py
```

All four large derived material maps regenerated to the **exact same SHA-256 bytes** as the release files:

```text
sprite_bumpmap.png
b2a34765341bbebb1e074b67eac90dcd3c494a40ba3029bc68439cf321ce968f

sprite_specularmap.png
a1d54a6c29fee63a9d7d1e5ddb54bdbc7870de526ecf2f24065c9e70f6cef66c

sprite_material_normal_roughness.png
3ee5027ed11d63d324fa7deb11450a883aa0649625120044e347ce8c855610cb

sprite_material_height_material.png
24edcee5a937bb756ebe03ef07aa886d84d2ca3250c4af518539b4f83cf3c274
```

This proves those four PNGs are deterministic derivatives of the imported runtime atlas + textual metadata/tools. The irreducible primary runtime-art binary is `assets/generated/sprite_runtime_atlas.png` (11,895,142 bytes; SHA-256 `8abdecb45e251a181ad0bf080366e64fb5b0d0cfc6571f170463061a32c6d812`). For baseline fidelity the repository should still contain/reconstruct the release files exactly rather than silently changing asset formats.

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

The source-recovery uncertainty is resolved. The import branch now contains:

- this provenance document;
- the exact 94-file path/size/SHA manifest;
- `tools/import_v123_archive.py`, which verifies the authoritative ZIP and internal checksums and imports it byte-for-byte into a repository checkout while preserving the programme-planning scaffold.

SM-000 is not yet complete until the full runnable source/assets are present in Git, a clean repository checkout is revalidated, the PR passes required checks, and the branch is merged.

### Current-session transport limitation

The connected GitHub API surface can create UTF-8 repository files and Git blobs from inline payloads but does not expose a local-file upload parameter. The current execution container also has no outbound GitHub network path. Consequently this chat execution path cannot transfer the multi-megabyte local PNG blobs byte-for-byte to GitHub without impractical inline encoding. This is a **session/tool transport limitation**, not missing source and not a Steel Moth architecture blocker.

No partial source-tree PR should be merged merely to conceal this limitation. The import helper and exact manifest make a later binary-capable Git transport deterministic and auditable.
