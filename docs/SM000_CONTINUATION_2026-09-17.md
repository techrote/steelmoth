# SM-000 continuation record — 2026-09-17

Issue: #1 / SM-000 — import and provenance the v1.2.3 baseline.

This record captures the latest autonomous continuation attempt. It is intentionally evidence-only: no partial runtime import or PR was created because the remaining blocker is the exact binary transfer required by SM-000 acceptance.

## Recovered artifact re-established in this run

The exact source archive was located in the persistent ChatGPT Library and materialized into the execution container:

`the_small_machine_at_the_edge_of_night_webapp_v1_2_3.zip`

SHA-256 recomputed in this run:

`2399a50d08785211470a2af86bf693bff71f5d622d717432a595295a23208727`

This exactly matches the authoritative SHA recorded by issue #1 and `BASELINE_V123_PROVENANCE.md`.

Fresh archive checks:

- ZIP integrity test: PASS (`ZipFile.testzip()` returned no bad member);
- ZIP entries: 104;
- extracted files: 94;
- extracted file bytes: 42,535,160;
- internal `SHA256SUMS.txt`: 93/93 PASS;
- `WEBAPP_VERSION.txt`: `The Small Machine at the Edge of Night Webapp v1.2.3`;
- `game_manifest.json`: version `1.2.3`.

The import source is therefore available and verified. Source recovery is not the blocker.

## Fresh inherited validation

The following checks were rerun directly against a clean extraction in this continuation and all returned exit code 0:

```text
node --check engine/game.js
node --check engine/surfacefx.js
node --check engine/foliagefx.js
node --check engine/editor.js
node --check webapp.js
python3 tools/validate_webapp_v123.py
python3 tools/validate_v123_surface_coherence.py
python3 tools/validate_v122_coherence.py
python3 tools/validate_material_v2.py
python3 tools/validate_renderer_v120.py
python3 tools/validate_visual_material_v120.py
python3 tools/validate_ghost_material_v120.py
python3 tools/validate_webapp_v120.py
python3 tools/validate_glsl_v120.py
```

Observed validator results include:

- v1.2.3 version/cache closure PASS;
- 9 rooms / 27 objectives retained;
- Material-v2 validation PASS for 314 regions;
- v1.2.3 SurfaceFX/FoliageFX coherence PASS;
- visual-material regressions PASS;
- ghost-material/static-buffer clearing regression PASS;
- OpenGL ES 3.2 Mesa/llvmpipe path compiled and linked 26 production GLSL programs;
- preferred float MRT and RGBA8 fallback framebuffer checks PASS.

The extracted tree was also served using `python3 -m http.server` on loopback and `index.html` returned HTTP 200 with the expected 25,067-byte body. This proves the static deployment shape is intact. A hosted Chromium/Xvfb attempt reached Chromium/DevTools but the managed display/GPU automation path was not completed as a trustworthy interactive visual test, so no browser-visual PASS is claimed here.

## Exact remaining blocker: binary-capable Git transport

The largest required baseline files include:

```text
assets/generated/sprite_runtime_atlas.png              11,895,142 bytes
assets/generated/sprite_material_height_material.png    8,123,897 bytes
assets/generated/sprite_specularmap.png                 6,940,833 bytes
assets/generated/sprite_bumpmap.png                     6,386,168 bytes
assets/generated/sprite_material_normal_roughness.png    4,413,303 bytes
```

The critical primary runtime atlas SHA-256 remains:

`8abdecb45e251a181ad0bf080366e64fb5b0d0cfc6571f170463061a32c6d812`

The current GitHub connector now exposes Git data primitives (`create_blob`, `create_tree`, `create_commit`, branch/ref operations), but `create_blob` accepts only an inline UTF-8/base64 string. It does not expose a local-file/connector-file parameter. The contents API write actions are likewise text/inline-content oriented. The execution container cannot resolve `github.com` for normal Git transport and has no authenticated `gh` path available.

Consequently, although the exact archive bytes are locally available, this execution surface cannot transfer the multi-megabyte PNG blobs into GitHub byte-for-byte without routing the full binaries through enormous inline tool arguments. A Git tree cannot reference a blob until that blob already exists in GitHub. No supported file-backed upload action is exposed by the current connector.

This is a transport/tooling blocker, not a source, validation, or architecture blocker.

## Repository-state note

At the start of this continuation:

- `main` was at `af080414e0c040db2409d6104a015c52b1eff9d0` (`Create 1`), and includes an unrelated `1/1` path not present in the planning/import branch;
- `sm-000-import-v123` was at `538bffdb5577285c6c4d563272d32ff62f82ee42` before this record was added;
- there were no open or closed pull requests in this repository;
- issue #1 remained the highest-priority dependency-ready implementation issue.

The eventual import branch should therefore be based on or reconciled with the then-current `main`; it must not silently drop later main history.

## Correct stopping decision

Do **not** open or merge a partial source PR that omits the required runtime atlases. That would fail SM-000's acceptance criteria and undermine baseline provenance.

SM-000 can resume immediately when one of these becomes available:

1. authenticated normal Git transport from the execution container;
2. a GitHub connector action whose schema accepts a local/connector file for blob or contents upload;
3. a supported Git LFS upload path with exact checkout reconstruction; or
4. the exact required binary blobs already staged in GitHub under verifiable hashes.

Once binary transport exists, use the existing verified import workflow, compare the repository tree against the archive/internal checksums, rerun the inherited validators from a clean checkout, perform the supported browser launch smoke, open the PR, repair any CI failures, merge only after required checks pass, verify the merge on `main`, and close #1 only after every acceptance criterion is satisfied.
