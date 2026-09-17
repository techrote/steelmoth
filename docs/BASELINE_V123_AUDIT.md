# Steel Moth v1.2.3 baseline renderer audit

Status: **SM-004 source audit complete against the imported v1.2.3 baseline**

Audit base: `main` commit `727f1a0c402ab3812d8af26c9c122232e8a699d6` (after SM-001), with the renderer core checked against the imported baseline commit `089d7a34ceae1b12c72b6426b38be410e087d50e`.

The current `engine/game.js` blob is still `d25a448a753d9477974bfa2eb9118e7e086b485c`, identical to the SM-000 imported baseline. SM-001/SM-002 added regression/capture infrastructure but did not alter the baseline renderer core. This audit therefore treats the imported source itself as implementation evidence and does not infer behaviour from historical conversation summaries.

## Classification vocabulary

- **Present** — the claimed contract exists in the imported source and is supported by source/tests.
- **Present with qualification** — the mechanism exists, but historical wording overstates its scope or semantics.
- **Changed** — v1.2.3 intentionally differs from the older claim.
- **Absent / future** — not implemented in v1.2.3; owned by the WebGPU programme.
- **Uncertain / unmeasured** — source inspection cannot prove the empirical claim.

## Executive findings

1. Material-v2 is real and is the default WebGL2 material path. The two generated material atlases cover all 314 runtime regions, use a global channel contract, and are sampled with nearest filtering.
2. The WebGL2 renderer has a real three-attachment MRT pseudo-G-buffer, bounded height self-shadowing, a half-resolution contact-shadow target, deferred GGX-style direct lighting, legacy projected macro shadows, and material debug views.
3. Static material ghost-clearing semantics are explicit: static descriptor state is reset on rebuild, four static material canvases are cleared, all MRT colour attachments are cleared every frame, and editor mutations force static-background reconstruction.
4. The most important correction is semantic: **G2.R is local Material-v2 pseudo-height, not final fragment visibility/ownership depth.** The v1.2.3 G-buffer has no object-ID attachment and does not implement per-pixel sprite ownership through a hardware depth attachment. Overlap is still principally draw/foot order plus separate shadow systems.
5. `getSpriteFootAnchor()` is shared by static/live/foreground Material-v2 descriptors, but the baseline does **not** have one universal root/foot authority. Static painter inputs use bottom anchoring, live descriptors use centre anchoring, macro shadow casters use independent `bottomY`/footprint conventions, robots have another caster-bottom calculation, and FoliageFX owns a separate `rootY` depth classifier. SM-101 remains necessary and should not assume the baseline is already unified.
6. SurfaceFX grass/water and FoliageFX are no longer self-lit islands. They consume the lit deferred scene and the current main-light direction; FoliageFX also consumes Material-v2 normals. However, they still use forward/heuristic scene-luminance visibility rather than a canonical light buffer + resolved ownership depth. The WebGPU procedural-integration work remains necessary.
7. v1.2.3 service-worker/cache identity is internally consistent and local preview deliberately unregisters old workers/caches.
8. The stronger historical diagnostic-light values are **not** v1.2.3 runtime defaults. They are now a deterministic regression/test preset through SM-001. Runtime defaults remain the compatibility baseline.
9. No baseline runtime correction is justified by this audit. The discrepancies found are architecture/documentation debt already owned by SM-100/101/200/201/202 and procedural integration tasks. Changing placement/depth semantics inside SM-004 would risk silently altering the accepted WebGL2 baseline.

## Audit matrix

| Preserved/historical contract | Status | Source evidence / correction | Migration consequence |
| --- | --- | --- | --- |
| Authoritative v1.2.3 source imported byte-faithfully | **Present** | `docs/BASELINE_V123_PROVENANCE.md`; import report records ZIP SHA-256 `2399a50d...08727`, 93/93 internal checksums and 94 copied files. | Baseline provenance no longer blocks migration. |
| Material-v2 Normal XYZ + Roughness atlas | **Present** | `sprite_material_normal_roughness.png`; `tools/generate_material_v2.py`; `tools/validate_material_v2.py`. | Preserve atlas semantics in SM-200. |
| Material-v2 Height + AO + Metalness + Emissive/aux atlas | **Present** | `sprite_material_height_material.png`; global `R=height,G=AO,B=metal,A=emissive` generation contract. | Preserve source-channel semantics; runtime G2 reorders metal/AO. |
| All 314 runtime regions covered | **Present** | `MATERIAL_V2_AUDIT.md`; validator asserts `314 == len(regions) == len(report)`. | Representative readback fixtures remain valid controls. |
| Material-v2 generation deterministic | **Present** | Generator uses deterministic image/morphological operations and sorted atlas regions; no stochastic generator state. Report contains generation parameters. | Regeneration can be used as a reproducible asset gate. |
| Safe transparent material defaults / atlas-edge isolation | **Present** | Validator requires transparent NR `(128,128,255)` and HM `(0,255,0,0)` plus aligned atlas dimensions/region bounds. | Preserve nearest/region-safe sampling in WebGPU. |
| MRT pseudo-G-buffer exists | **Present** | `makeGBuffer()` creates G0 + G1 + G2; G1/G2 prefer RGBA16F with RGBA8 fallback; float and fallback FBO completeness were validated. | Port material semantics before format optimisation. |
| G0 albedo/coverage | **Present** | `gbufferSpriteProg` outputs unlit/tinted base colour + coverage. | Direct port target. |
| G1 normal/roughness | **Present** | Material atlas normal is rotated/flipped then written with roughness. | Direct port target. |
| G2 “pseudo-depth” | **Present with qualification** | G2 stores **local height** in R, metal in G, material AO in B, emissive in A. No root/world-Y term is added to G2.R. | SM-200 should call this local material height; SM-201/202 must derive/implement visibility depth separately. |
| Object-ID G-buffer target | **Absent / future** | v1.2.3 creates only three colour attachments. | SM-200/202 must add stable object ownership data. |
| Hardware/per-fragment ownership depth | **Absent / future** | Renderer globally disables depth testing for the sprite material path and G-buffer descriptors are foot-sorted before drawing. | SM-201/202 remain architecture-critical. |
| Explicit MRT clears | **Present** | `renderGBuffer()` clears G0/G1/G2 with `clearBufferfv()` every frame. | Preserve deterministic clears/readback. |
| Static material deletion/ghost clearing | **Present** | `StaticPainter.build()` resets `staticMaterialSprites`, clears all four material canvases; `setBackground()` replaces static descriptor list; `validate_ghost_material_v120.py` covers removal/rebuild. | No baseline ghost-state fix required. |
| Deferred GGX/Cook-Torrance-style direct lighting | **Present** | Deferred shader implements GGX NDF, Schlick Fresnel, Smith/Schlick geometry term, dielectric F0≈0.04 and metal-aware diffuse/specular. | Preserve restrained response in SM-204. |
| Local material AO on ambient | **Present** | Deferred shader applies Material AO to ambient term rather than multiplying every direct term. | Preserve semantic separation. |
| Height self-shadowing | **Present** | Bounded G2-height ray march; tiers 8/12/16/28 samples; bias/max-distance/light-count controls. | WebGPU parity task should not reinterpret it as final macro ownership. |
| Half-resolution contact shadow | **Present** | Persistent `contactMask` is `w>>1 × h>>1`; 4/8/12 bounded samples; depth-aware 3×3 reconstruction in deferred pass. | Preserve as short-range local visibility evidence. |
| Long projected macro shadows retained | **Present with qualification** | Separate sectioned-silhouette/footprint system remains. In Material-v2 mode the player cone does not use the legacy cone-macro path; local player-light detail is primarily self/contact + hard-light terrain visibility. Other light/caster projected shadows remain. | DSO must replace/augment representation deliberately rather than assuming one monolithic current shadow path. |
| One shared sprite foot/root authority | **Present with qualification / architecture debt** | `getSpriteFootAnchor()` is shared by material descriptors, but caller coordinate conventions differ and macro shadows/FoliageFX retain independent root/bottom logic. | SM-101 must centralise before SM-201/202. No SM-004 placement rewrite. |
| Static/dynamic/foreground Material-v2 coverage | **Present** | Static descriptors, live world descriptors and layer-2 foreground descriptors all enter the G-buffer and are sorted by `footY` + sequence. | SM-100 scene extraction must preserve these categories. |
| Static NR/HM canvases are runtime G-buffer inputs | **Changed / historical overstatement** | Static painter builds NR/HM canvases, but current `setBackground()` only uploads background albedo + legacy bump/spec; the Material-v2 G-buffer re-rasterizes `staticMaterialSprites` from the canonical material atlases. | Treat static descriptors, not discarded per-room NR/HM canvases, as the current material authority. |
| Legacy bump/spec fallback/debug retained | **Present** | Legacy maps are loaded and used by legacy/forward paths; Material-v2 is default (`materialV2:true`, `materialPipelineLegacy:false`). | WebGL2 compatibility can remain at v1.2.x tier. |
| Material/G-buffer debug views | **Present** | Albedo, local pseudo-height, normals, roughness, metalness, AO, emissive, diffuse, specular, self-shadow and contact-shadow modes are exposed. | Rename semantics in docs; runtime option `debugPseudoDepth` is compatibility nomenclature for local height. |
| Fine GrassField no longer self-lit amber | **Present** | v1.2.3 uses Wet Relay-compatible `fx_creature/fx_water` palette, lit-scene sampling, main-light direction and alpha ≤0.42; regression validator enforces these. | Preserve behaviour; later use canonical WebGPU light/depth inputs. |
| Water lighting coherence | **Present with qualification** | Water samples the already-lit scene, uses main-light direction and bounds added highlight/alpha; local visibility is inferred from scene luminance. | It is coherent with the visible scene but not yet a canonical light/depth consumer. |
| Foliage lighting coherence | **Present with qualification** | Foliage samples lit scene, uses Material-v2 normals when available, shares screen/world light-vector convention and has non-emissive alpha blending. | Foliage still owns local root/depth/contact logic; unify through later scene/depth contracts. |
| Procedural systems use one canonical depth/light buffer | **Absent / future** | v1.2.3 uses `mainLightPos`, lit-scene luminance and local classifiers rather than the target WebGPU `LightInstance`/resolved depth contracts. | Preserve SM-100/101 and later procedural-integration dependencies. |
| Service-worker/cache version closure | **Present** | `sw.js`: `small-machine-web-v1.2.3-r1`; scripts query `v=1.2.3`; `webapp.js` registers `sw.js?v=1.2.3`; localhost clears old workers/caches. | Historical v1.2.1 stale-cache concern is resolved in baseline. |
| Runtime graphics defaults equal diagnostic preset | **Changed / false as a baseline claim** | Runtime defaults: emissive 1.0, lightRadius 1.0, omni 60 / 0.16, cone 2.0 with 17°/30°. The stronger 2/2/80/1.6/2/30°/60° values are diagnostic fixtures, not defaults. | Keep diagnostic preset reproducible without silently retuning WebGL2 compatibility. |
| Editor mutations invalidate renderer/static state | **Present** | `WysiwygEditor.rebuildRoom()` reconstructs `Room`, binds art, sets `bgKey=''`, calls `ensureBackground(true)`, and reinitializes relevant dynamic systems. | Later backend-specific caches must hook the same invalidation authority. |
| Renderer diagnostics | **Present** | `game.diagnostics()` reports native/requested size, render scale, material pipeline, G-buffer format/counts/bytes, contact/self-shadow samples, GPU timer availability/times and procedural diagnostics. | Extend rather than replace for WebGPU. |
| GPU timer query support | **Present conditionally** | WebGL2 timer extension is detected and timings are labelled; absence remains absence. | SM-003 must measure on target hardware and never substitute CPU timing. |
| WebGPU backend | **Absent / future** | v1.2.3 is WebGL2. | SM-102 onward. |
| Backend-neutral Render Scene Description | **Absent / future** | Current game submits directly into WebGL2-oriented renderer methods/arrays. | SM-100 remains required. |
| Reusable pseudo-depth hierarchy | **Absent / future** | No authoritative ownership depth exists to reduce yet. | SM-203 remains downstream of SM-202. |
| GPU occluder clustering / dominant ownership / DSO / Dark Bloom | **Absent / future** | Existing macro shadows are independent-caster representations, matching the historical bin failure diagnosis. | M3 remains justified; do not claim old renderer already has these systems. |
| GTX 1650 Super pass timings | **Unmeasured** | No target-hardware pass-level dataset is in the baseline. | SM-003 owns measurement. |

## Root/foot and pseudo-depth reconciliation

This is the principal SM-004 architecture finding.

### What v1.2.3 actually shares

Material descriptors use `getSpriteFootAnchor()` to calculate a `footX/footY` used for ordering. The function reads Material-v2 `root_anchor` metadata (currently `[0.5,1.0]`) and handles whole regions and subrects.

Static painter descriptors call it with bottom-anchor coordinates. Live renderer descriptors call it with centre coordinates. Those can produce the same visual foot when each caller obeys its own input convention, but the convention itself is still distributed among callers.

### What is not shared

- `G2.R` contains local encoded material height only; it does not add root Y, render layer or a global visibility projection.
- Material descriptors are painter/foot ordered; no object-ID/depth test resolves overlapping sprite pixels.
- Macro shadows construct footprints/sections from `shadow_profile` plus a supplied `bottomY`.
- Wall, editor-decor and robot caster bottoms are derived through different caller paths.
- FoliageFX keeps a separate `rootY`, `depthBias` and foreground classifier.

Therefore the repository must not describe v1.2.3 as already having one authoritative visibility-depth formula. The target architecture is still correct, but SM-101 must centralise input/root transforms before SM-201 derives fragment ownership depth.

## Static material clear semantics

The earlier ghost-state concern is resolved in the imported baseline:

1. `StaticPainter.build()` resets `staticMaterialSprites`.
2. The bump/spec/NR/HM static canvases are newly allocated and explicitly cleared before drawing.
3. `Renderer.setBackground()` replaces the persistent `staticMaterialSprites` array from the new build.
4. `renderGBuffer()` explicitly clears all three MRT attachments every frame before background/static/live/foreground material submission.
5. Editor mutations rebuild `Room` and force `ensureBackground(true)`.

`tools/validate_ghost_material_v120.py` directly asserts these contracts and includes a pixel-model deletion/rebuild test. No baseline patch is required.

## Service-worker/cache identity

The v1.2.1 historical cache-identity failure is not present in v1.2.3:

- offline cache key: `small-machine-web-v1.2.3-r1`;
- engine/editor/SurfaceFX/FoliageFX URLs use `?v=1.2.3`;
- service worker is registered as `sw.js?v=1.2.3` with `updateViaCache:'none'`;
- localhost/127.0.0.1 unregister existing service workers and delete `small-machine-web-*` caches.

This is **present and validated**, not an unresolved migration assumption.

## Procedural lighting reconciliation

The v1.2.3 grass/foliage repair is real but should be described accurately.

- Fine GrassField is alpha blended, non-emissive in material intent, uses the corrected Wet Relay-derived palette, samples the lit deferred scene, and derives a restrained directional term from `uMainLightPos`.
- FoliageFX samples the lit scene, can sample the Material-v2 normal/roughness atlas, handles flipped normals, and uses the same `+X / -screenY / +Z` light-vector convention as deferred lighting.
- Water samples the lit scene and current main-light direction and bounds highlights/alpha relative to underlying scene luminance.

These are **coherent forward adapters**, not canonical light/depth consumers in the future-architecture sense. They do not consume the proposed WebGPU light buffer, object ownership depth, DSO visibility or shared depth hierarchy because those do not exist yet.

## Graphics-default reconciliation

The historical stronger diagnostic values are now captured by SM-001 fixtures and should remain a test preset. They are not the v1.2.3 compatibility defaults.

Baseline `GRAPHICS_DEFAULTS` include:

- emissive `1.0`;
- light radius multiplier `1.0`;
- player omni radius `60`;
- player omni intensity `0.16`;
- player cone intensity `2.0`;
- cone inner `17°`;
- cone outer `30°`;
- Material-v2 enabled, legacy material pipeline disabled;
- self-shadow quality `3` (16 samples);
- contact-shadow quality `2` (8 samples).

SM-001 diagnostic fixtures intentionally use the stronger `2 / 2 / 80 / 1.6 / 2 / 30° / 60°` preset for reproducible diagnosis. Promotion of those values to product defaults is a separate visual/product decision.

## Validation evidence

The authoritative imported renderer files audited here are unchanged from SM-000. In particular, current `engine/game.js` has the same Git blob as the import commit. The SM-000 validation record therefore remains evidence for these exact bytes:

- 93/93 archive checksums and repository copy verification;
- JavaScript syntax checks;
- Material-v2 validator: 314 aligned regions and semantic spot checks;
- ghost/static material clear validator;
- v1.2.3 SurfaceFX/Foliage coherence validator;
- renderer/material source-contract validators;
- 26 production GLSL programs compiled/linked in the inherited native validation environment;
- float-MRT and RGBA8 fallback framebuffer completeness.

SM-002/SM-001 additionally provide deterministic capture/fixture infrastructure. The current execution environment still does not provide trustworthy interactive GPU screenshot evidence, so this audit does **not** claim a fresh browser visual run. Authoritative recovered box/bin screenshots were manually available for representation review; grass/water visual re-capture remains a later browser/hardware validation concern.

No runtime code was changed by SM-004, so there is no before/after renderer implementation delta requiring a new baseline regression patch. Documentation/provenance corrections are the implementation output of this issue.

## Migration implications / dependency review

No task reordering is required; the existing dependency structure is substantively correct. The audit strengthens the reasons for it:

- **SM-100** must introduce the Render Scene Description because no backend-neutral scene boundary exists.
- **SM-101** must centralise root/foot/transform authority because v1.2.3 only partially shares the material foot helper and retains separate shadow/foliage conventions.
- **SM-200** should port Material-v2 G0/G1/local-height-material semantics faithfully, but must not promote local G2 height into final ownership depth.
- **SM-201** must derive a new light-independent fragment visibility-depth model from shared transforms + local Material-v2 height.
- **SM-202** must add actual object-ID/per-pixel ownership behaviour.
- M3 clustering/DSO remains necessary because the existing macro-shadow representation is independent-caster based.
- Water/grass/foliage later need canonical WebGPU light/depth/visibility integration even though their v1.2.3 forward lighting is coherent enough for the compatibility baseline.

## Source/document corrections made by SM-004

The SM-004 PR should keep runtime bytes unchanged and reconcile documentation/provenance only:

- add this audit as the baseline source of truth;
- correct `GBUFFER_LAYOUT.md` where local material height was described as final pseudo-depth/root ownership;
- add baseline-reconciliation notes to `WEBGPU_ARCHITECTURE.md`;
- update stale pre-import state text in `docs/INDEX.md` and `docs/EXECUTION_LEDGER.md`;
- update `docs/RAG_REFERENCE_STEELMOTH.md` from “partly corroborated” historical claims to audited classifications;
- record the user's clarification that `binsupleft` was a historical screenshot, while its original bytes remain unrecovered/uncommitted and the deterministic fixture remains reconstructed.

## SM-004 completion conclusion

Baseline provenance is certain enough for migration-facing conclusions. v1.2.3 reproduces its own recorded validation gates at the imported-byte level and the renderer source supports the Material-v2, deferred-lighting, self/contact-shadow, cache-identity and procedural-coherence claims listed above.

The audit found **architecture debt, not a baseline execution defect**: local Material-v2 height and several root/bottom conventions were historically described too close to the future per-pixel ownership model. Those semantics are now separated explicitly so downstream work does not build WebGPU on a false premise.
