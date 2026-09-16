# Steel Moth WebGPU programme

This is the canonical implementation decomposition for the WebGPU migration and lighting-quality programme.

## Programme objective

Migrate Steel Moth from an increasingly complex WebGL2 renderer to a WebGPU-primary renderer without redesigning gameplay, while preserving WebGL2 as a compatibility fallback. The new renderer must establish stable per-pixel pseudo-depth ownership, GPU occluder clustering, DSO and Dark Bloom, then provide shared infrastructure for GTAO, SSGI, volumetric flashlight scattering and future performance optimization.

## Release philosophy

A milestone is complete only when:

- implementation is merged;
- automated verification passes;
- any required browser/hardware validation is recorded;
- canonical docs are reconciled;
- no known blocker is hidden behind a “done” label.

## M0 — Baseline acquisition and evidence harness

### SM-000 — Import and provenance v1.2.3 baseline
Import the latest verified Steel Moth v1.2.3 source and its tests/assets into this repository. Establish the first implementation baseline commit and run inherited validation. This blocks all code work.

### SM-001 — Recover/create authoritative visual fixtures
Recover original box/bin screenshots if available and create deterministic renderer fixtures for boxes, binsright, binsleft, binsupleft, binsup, crate, barrel, cabinet, pipes, lamp, robot, foliage, water and dense mixed terrain.

### SM-002 — Build deterministic capture/diagnostics harness
Add deterministic render-test mode producing screenshot PNGs, diagnostics JSON and optional debug-buffer/performance dumps for named fixtures/light angles/backends.

### SM-003 — Establish WebGL2 GTX 1650 Super performance baseline
Using the harness, record real pass-level/browser/hardware measurements. Do not use Task Manager percentage as the benchmark.

### SM-004 — Baseline anchor/material/procedural audit
Verify the actual imported source contains the expected Material-v2 maps, root/foot authority, cache/version fixes, grass/water/foliage coherence, editor state, and current shadow paths. Repair documentation if historical claims differ from source.

### SM-005 — Repository CI and autonomous verification entrypoints
Create stable local check commands and GitHub Actions for all honestly automatable source/regression/package/API tests. Keep real-GPU visual/performance acceptance separate where hosted CI cannot execute it meaningfully.

## M1 — Backend abstraction and WebGPU infrastructure

### SM-100 — Backend-neutral Render Scene Description
Create shared `RenderScene`, `SpriteInstance`, `MaterialInstance`, `LightInstance`, `OccluderInstance`, and procedural-layer contracts. Extract renderer-facing state from gameplay without changing gameplay authority.

### SM-101 — Shared root/foot/depth authority
Centralize the root/foot transform and all static/dynamic/foreground/editor consumers. No duplicate anchor interpretation between backends.

### SM-102 — WebGPU device lifecycle and fallback
Implement `navigator.gpu` feature detection, adapter/device creation, limits/features reporting, context configuration, resize/reconfigure, device-loss/error handling, and safe WebGL2 fallback.

### SM-103 — WebGPU resource/frame-graph/pipeline infrastructure
Persistent resource registry, explicit pass scheduler/frame graph, pipeline cache, buffer upload strategy and lifecycle diagnostics.

### SM-104 — WGSL/resource/API validation suite
Compilation-info tests, error-scope tests, pipeline-creation tests, real production texture/buffer descriptor tests, resize/recreation tests and deliberate WebGPU failure/fallback tests.

## M2 — Material-v2 parity and per-pixel ownership

### SM-200 — Material-v2 WebGPU G-buffer parity
Port current material representation using explicit/debuggable targets; implement deterministic clears and fallback capabilities. Add readback fixtures for flat/box/barrel/bare-metal materials and atlas-boundary safety.

### SM-201 — Derive pseudo-depth projection model
Research/derive the exact light-independent fragment-depth formula from root, local pixel, Material-v2 height, fixed camera projection and explicit layer bias. Produce mathematical/spec document and synthetic tests before implementation.

### SM-202 — Per-pixel depth/object ownership
Implement the accepted projection with alpha-cutout depth writes and object-ID target. Validate bins/static/dynamic/foreground parity and light-independence.

### SM-203 — Shared pseudo-depth hierarchy
Build a reusable depth min/max hierarchy for self-shadow, DSO, later GTAO/SSGI/volumetrics. Validate dimensions, mip semantics and edge cases.

### SM-204 — Canonical light buffers and deferred PBR parity
Port restrained GGX direct lighting, canonical light XYZ representation, material AO/emissive and current artistic clamps. Ensure all later subsystems consume this light state.

### SM-205 — Height self-shadow and contact-shadow parity
Port bounded Material-v2 height self-shadowing and short-range contact shadows, reusing canonical depth/light state and the shared hierarchy where profitable.

### SM-206 — Transparent sprite/effect parity
Port transparent sprite batches, particles, objective markers, guide/effect layers and their blending/depth hooks without moving gameplay authority into the renderer.

### SM-207 — Bloom/post/final-output parity
Port bloom, exposure/brightness/gamma/contrast/saturation/vignette/grade controls and final WebGPU output, retaining a raw/un-postprocessed debug path. Colour-space redesign remains SM-502.

## M3 — Overlap/occlusion architecture

### SM-300 — GPU occluder representation and spatial binning
Create bounded `OccluderInstance` buffers and screen/world tile classification. Avoid room-wide pairwise work.

### SM-301 — Stable occluder clustering
Build deterministic overlap/adjacency clustering with diagnostics, cluster IDs/bounds/member sets and perturbation stability tests.

### SM-302 — Dominant-occluder scoring and hysteresis
Use exposed silhouette/light direction/height/front-depth and previous state to select a stable dominant member. Prevent owner popping.

### SM-303 — Deep Silhouette Occlusion core
Generate coherent cluster-level macro occlusion from resolved pseudo-depth/silhouette information. Preserve near detail; avoid duplicated full-strength member shadows.

### SM-304 — DSO near/mid/far silhouette hierarchy
Introduce distance-dependent simplification and tile culling so long throws become smoother/coherent rather than preserving pixel-scale source notches.

### SM-305 — Dark Bloom soft residual occlusion
Separate low-frequency depth-aware shadow expansion/feathering from hard DSO. Add bounded radius/strength and distance bias.

### SM-306 — Temporal Dark Bloom / far-penumbra history
Add only after non-temporal DSO/Dark Bloom are correct. Use depth/object/cluster/light-movement rejection and expose history acceptance/rejection diagnostics.

### SM-307 — Consolidate shadow visibility composition
Combine DSO, self-shadow, contact shadow, Dark Bloom and material AO through a bounded visibility model that avoids triple-darkening/black sludge.

## M4 — Procedural/editor integration and functional parity gate

### SM-400 — Water WebGPU coherence
Forward/transparent water consumes canonical light, depth/scene state and shadow visibility; no independent light-direction world.

### SM-401 — Foliage and Fine Grass WebGPU coherence
Preserve rooted/deformation behaviour where present; canonical light/depth/shadow inputs; tiny grass remains cheap and non-emissive; classify which foliage can cast macro occlusion.

### SM-402 — Transparent/effect ordering contract
Document and implement opaque/deferred → shadow/lighting → water → background foliage → transparent effects → foreground foliage → post ordering with depth visibility where required.

### SM-403 — Editor WebGPU integration and ghost-state regressions
Place/move/delete/undo/redo/save/reload overlapping props and verify no stale instance, depth, object ID, cluster, DSO, Dark Bloom, contact or material state.

### SM-404 — Room transition/invalidation contract
Invalidate/rebuild static buffers, occluders, clusters, depth hierarchy, temporal histories and procedural descriptors on room transitions without carrying stale state.

### SM-405 — Cross-browser WebGPU functional parity gate
Prove Gates A–E in Chrome and Firefox on supported Windows hardware: API/resource correctness, visual parity, overlap improvement, procedural coherence, editor/runtime integrity and safe fallback. This gate does **not** change `Auto` to WebGPU-first; final promotion is SM-505.

## M5 — Performance architecture, lighting foundation, and first WebGPU-primary release

### SM-500 — Timestamp-query/per-pass performance instrumentation
Record CPU prep/encoding separately from GPU timestamps; pass-level measurements, instance/light/cluster/sample counts and renderer-owned memory.

### SM-501 — Quality tiers and GTX 1650 Super acceptance
Implement Low/Medium/High/Ultra policy with Medium as primary 1650S visual target. Validate ≤12 ms mean and ≤14.5 ms p95 targets or open a decision issue with evidence before changing them.

### SM-502 — Linear/sRGB/HDR pipeline audit
Verify colour-space conversions, linear lighting/bloom and final display transform. Add numeric colour test pattern/regression.

### SM-503 — Material-v2 normal/height/material semantic calibration
Create explicit material vocabulary and geometry priors; improve macro/meso normals, world-meaningful height scales, roughness/metalness/AO semantics and calibration fixtures.

### SM-504 — Tile/light culling and pass skipping
Reuse tile occupancy/light relevance to avoid expensive work over empty/unaffected regions. Measure each optimization.

### SM-505 — Final WebGPU default-backend promotion and release acceptance
Reconcile SM-405 functional parity with SM-500/501 target-hardware evidence and clean deployment/package validation. Only this task may promote `Auto` to WebGPU-first for the initial WebGPU-primary release.

## M6 — GTAO and indirect diffuse

### SM-600 — GTAO prototype and validation
Half-resolution, pseudo-depth/normal horizon AO with bounded directions/samples, bilateral upsample and optional temporal reuse. Keep material AO distinct.

### SM-601 — GTAO performance/polish
Target roughly 0.7–1.2 ms on Medium/1650S as a working budget; validate grounding without blackening dense scenes.

### SM-602 — Low-resolution diffuse SSGI prototype
Quarter-resolution, depth-hierarchy traversal, 4–8 rays, previous-frame colour, aggressive temporal/firefly control. Diffuse only initially.

### SM-603 — SSGI stabilization/performance gate
Depth/normal/object rejection, energy clamps, quality tiers, pathological-scene tests and real GTX 1650 Super timings before enabling by default.

## M7 — Volumetric/transparent lighting

### SM-700 — Volumetric flashlight prototype
Quarter-resolution depth-aware cone scattering with low-frequency atmospheric density. Non-temporal correctness comes before history stabilization; it must remain faint atmospheric scattering, not a thick fog cone.

### SM-701 — Volumetric occlusion/stability/performance
Reuse scene depth/DSO, add/reject temporal history correctly, and characterize the GPU budget.

### SM-702 — Advanced transparent lighting integration
Water/glass/large foliage consume depth, DSO, GTAO and indirect diffuse where appropriate without forcing all transparent content into the opaque G-buffer.

## M8 — Long-term optimization/quality scaling

### SM-800 — Precision/bandwidth study
Profile before packing. Evaluate normal packing, material-buffer precision and alternate formats only with visual/readback parity and bandwidth evidence.

### SM-801 — Render bundles/static submission study
Measure whether stable static-world render bundles/batching reduce CPU/GPU overhead on target browsers; adopt only if beneficial.

### SM-802 — Adaptive quality controller
Optional slow p95-based controller that reduces only secondary effects (volumetrics/SSGI/GTAO/Dark Bloom/far DSO/self-shadow), never core albedo/depth/ownership.

### SM-803 — Long-run soak and memory/resource-leak suite
Room cycling, resize, backend fallback, editor edits and long-duration play while monitoring GPU resource counts/memory proxies and browser errors.

## Required end-state artifacts

At appropriate milestones maintain:

- implementation architecture notes;
- frame graph and G-buffer layout;
- visual fixture captures;
- machine-readable validation/performance reports;
- memory/resource report;
- clean deployable build with WebGL2 fallback;
- changelog and migration notes.

## Deferred/not-in-current-scope unless a later issue promotes them

- glossy/reflection SSGI;
- SSR;
- full area-light rewrite;
- transmission/subsurface scattering;
- physically exhaustive volumetrics;
- mesh conversion;
- gameplay redesign.
