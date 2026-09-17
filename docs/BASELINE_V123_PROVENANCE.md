# Steel Moth v1.2.3 baseline provenance

Status: **authoritative v1.2.3 source distribution recovered, imported to Git, and locally validated; pending PR/check/merge completion of SM-000**.

## Recovered artifact

Uploaded artifact name:

`the_small_machine_at_the_edge_of_night_webapp_v1_2_3.zip`

SHA-256:

`2399a50d08785211470a2af86bf693bff71f5d622d717432a595295a23208727`

This exactly matches the SHA-256 previously recorded for the delivered v1.2.3 webapp in the Steel Moth development history.

Steel Moth v1.2.3 is a raw HTML/JavaScript/WebGL2/Python/JSON project. The webapp ZIP is therefore the **editable source distribution**, not an opaque compiled build. There is no separate source edition required by SM-000.

Archive structure:

- one top-level directory: `the_small_machine_at_the_edge_of_night_webapp_v1_2_3/`;
- 104 ZIP entries total;
- 94 files after extraction;
- extracted file bytes approximately 42.5 MB;
- `WEBAPP_VERSION.txt`: `The Small Machine at the Edge of Night Webapp v1.2.3`;
- `game_manifest.json` version: `1.2.3`;
- 9 rooms / 27 objectives retained according to release validators.

The exact per-file byte count and SHA-256 list captured from the recovered artifact is committed as `docs/BASELINE_V123_FILE_MANIFEST.tsv`.

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

## Repository import verification

The repository-native import helper copied the source distribution into the Steel Moth checkout and produced `docs/BASELINE_V123_IMPORT_REPORT.txt`:

```text
Steel Moth v1.2.3 baseline import
ZIP: the_small_machine_at_the_edge_of_night_webapp_v1_2_3.zip
ZIP SHA-256: 2399a50d08785211470a2af86bf693bff71f5d622d717432a595295a23208727
Internal SHA256SUMS entries verified: 93
Release files copied: 94
Repository copy verification: PASS
```

The import was then committed and pushed to `sm-000-import-v123`.

Critical Git-blob verification was repeated from GitHub after the push. The remote blob SHAs match locally computed Git blob SHAs from the authoritative ZIP for the main runtime/material assets, including:

```text
assets/generated/sprite_runtime_atlas.png
8a48fd0354169cab2bb6ade51f29f6ef93e28f31

assets/generated/sprite_bumpmap.png
e3d3100935d6a1e77f9fa50f5aed5e188791a3e2

assets/generated/sprite_material_height_material.png
f922b93aad38aefbf482660b1d4e9b86f616e366

assets/generated/sprite_material_normal_roughness.png
a2593efb2d983bed7f6139bc16cde71031c1ccdf

assets/generated/sprite_specularmap.png
693ec817b61a4d280fa46fc4ad6bb957b2a5ca9a

engine/game.js
d25a448a753d9477974bfa2eb9118e7e086b485c
```

The Windows launcher was initially normalized from CRLF to LF by the local Git checkout. That was corrected on the import branch using the exact archive text/CRLF bytes; its remote Git blob SHA is now the authoritative raw-file SHA `c8178edb9875262a6aa536fcd76d24b91406adaa`.

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

This proves those four PNGs are deterministic derivatives of the imported runtime atlas + textual metadata/tools. The primary runtime-art binary is `assets/generated/sprite_runtime_atlas.png` (11,895,142 bytes; SHA-256 `8abdecb45e251a181ad0bf080366e64fb5b0d0cfc6571f170463061a32c6d812`).

## v1.2.3 release identity supported by the artifact

`CHANGELOG_v1.2.3.md` records the fixes expected from the last accepted visual baseline:

- Fine GrassField yellow/amber root cause identified and corrected;
- Fine GrassField switched to dark teal vegetation presentation;
- Fine GrassField consumes the lit Material-v2 scene/main-light direction;
- FoliageFX consumes Material-v2 normals/lit-scene visibility;
- hard-light visibility sampling raised to 193 cone / 257 omni rays at quality 3;
- local preview clears/unregisters stale Steel Moth service-worker caches.

It explicitly preserves Material-v2 MRT/deferred lighting, height self-shadow/contact shadows, macro secondary-light shadows, gameplay/editor data, and legacy material fallback.

## Validation rerun

The following checks were rerun successfully against the authoritative ZIP/import workflow before the pushed commit:

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
- `python3 tools/validate_planning.py` — PASS before commit/push in the repository workflow.

The GLSL validator reported OpenGL ES 3.2 Mesa/llvmpipe and successfully compiled/linked **26 production GLSL programs**, including float MRT and RGBA8 fallback framebuffer checks.

## Important validation limitation

The inherited `VALIDATION_v1.2.3.txt` correctly states that the managed validation environment did not provide a trustworthy interactive browser screenshot path. The current recovery/import evidence therefore proves archive integrity, repository-copy integrity, source/static contracts, Material-v2 generation/layout contracts, GLSL compilation/framebuffer creation under the available native validation path, and v1.2.3 cache/version closure; it does **not** by itself reproduce the user's original interactive box/bin screenshots or GTX 1650 Super performance.

Those remain separate work in SM-001/002/003 and later WebGPU gates.

## SM-000 remaining gate

Source recovery, binary transfer, and repository import are complete. SM-000 remains open only until the import PR is reviewed, required checks are inspected, the branch is merged to `main`, the merge is verified, and issue #1 is closed. No partial or reconstructed baseline is being substituted.