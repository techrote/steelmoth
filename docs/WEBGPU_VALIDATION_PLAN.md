# WebGPU validation plan

This document defines evidence required before WebGPU can become Steel Moth's default renderer.

## 1. Test matrix

Primary target:

- GTX 1650 Super 4 GB
- Windows desktop browser
- 1920×1080
- 60 Hz target

Minimum browser/backend matrix:

| Hardware | Browser/backend | Purpose |
| --- | --- | --- |
| GTX 1650 Super | Chrome stable / WebGPU | primary correctness/performance |
| GTX 1650 Super | Firefox stable / WebGPU | cross-browser correctness |
| GTX 1650 Super | WebGL2 fallback | baseline/reference |
| high-end discrete GPU | Chrome/Firefox | High/Ultra scalability |
| software implementation where available | Chromium | API validation only, never performance |

Every run records version/commit, backend, browser/version, adapter info where exposed, driver where available, resolution, DPR, quality preset, fixture, light parameters and sample count.

## 2. Adapter/device/API validation

Automate:

- `navigator.gpu` availability;
- adapter acquisition;
- device creation;
- adapter features/limits inventory;
- preferred canvas format;
- optional feature negotiation, especially `timestamp-query`;
- canvas configure/reconfigure/resize;
- `device.lost` handling;
- `uncapturederror` collection;
- deliberate validation failure under `pushErrorScope("validation")` / `popErrorScope()`;
- safe fallback to WebGL2 when WebGPU initialization fails.

Expected failure behaviour: diagnostic recorded → WebGL2 fallback attempted → no gameplay/save corruption → no unexplained black canvas.

## 3. WGSL/pipeline validation

For every production shader/entry point:

- create `GPUShaderModule`;
- collect `getCompilationInfo()` when available;
- fail on error messages; record warnings;
- create actual render/compute pipeline with production layouts/formats;
- wrap representative creation in validation error scope;
- use async pipeline creation where useful.

Inventory at minimum:

- G-buffer;
- depth hierarchy;
- occluder/tile prep;
- cluster passes;
- dominant ownership;
- DSO;
- Dark Bloom;
- contact shadow;
- deferred lighting/self-shadow;
- water;
- foliage/grass;
- transparent/effects;
- post/debug.

## 4. Resource/format validation

Create and exercise the exact production descriptors for:

- G0/G1/G2;
- object-ID target;
- depth attachment;
- depth hierarchy levels;
- DSO/Dark Bloom/contact textures;
- history buffers;
- light/instance/occluder/cluster buffers;
- atlas uploads.

Validate clear state, dimensions, usage flags, resize recreation and fallback layouts where required.

## 5. Deterministic clear/ghost regression

Procedure:

1. place/render test object;
2. read relevant buffers;
3. remove object and rebuild;
4. render/read same region.

Require empty/default values for albedo, normal/roughness, height/material, object ID, depth, cluster/DSO/contact/Dark-Bloom state. Repeat through editor delete/undo/redo and room transitions.

## 6. G-buffer readback fixtures

### Flat plate

Expect near-flat normal, near-zero height, high-ish roughness and material values consistent with source metadata.

### Box/crate

Expect coherent front/top differentiation, higher pseudo-height on top/surface regions and stable normals.

### Barrel/cylinder

Expect left/centre/right normal progression rather than one planar normal.

### Mixed material

Bare-metal scratch should differ from painted/rusted neighbours in metalness/roughness according to source material semantics.

### Atlas boundary

Extreme scale/flip/rotation/subrect/DPR must not leak albedo or material channels from adjacent atlas regions.

## 7. Deterministic visual fixture harness

The renderer test harness must accept a deterministic fixture, backend, quality tier, resolution and light angle and produce:

- screenshot PNG;
- diagnostics JSON;
- performance JSON when available;
- optional G-buffer/object/depth/DSO/Dark-Bloom debug dumps.

Minimum fixtures:

- empty floor;
- single box;
- box pair;
- binsright;
- binsleft;
- binsupleft;
- binsup;
- crate;
- barrel;
- cabinet;
- pipe bundle;
- lamp/pole;
- robot;
- foliage dense;
- water/material scene;
- dense mixed terrain.

Capture relevant fixtures at 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315° using the diagnostic light preset.

## 8. Visibility ownership tests

For static overlap fixtures, object-ID and fragment-depth buffers must be identical across light-angle changes. Lighting may change; ownership must not.

Two-bin tests:

- front visible pixels own front object ID;
- exposed rear pixels own rear ID;
- transparent holes expose the correct underlying object/floor;
- ±0.25/0.5/1 px moves remain stable;
- static/dynamic/foreground instances use identical material/depth semantics except documented layer bias.

## 9. Occluder-cluster tests

Fixtures:

- touching bins;
- overlapping bins;
- separated bins;
- three-bin cluster;
- crate beside bin;
- tiny prop beside large bin.

Verify cluster count, member IDs, bounds, dominant ID, largest-cluster size and perturbation stability. Tiny decor must not merge an entire room.

## 10. Dominant ownership tests

Move the light around a cluster. Dominance may change only when geometry/light relationship warrants it, with hysteresis preventing frame-to-frame popping.

Capture both current/previous dominant scores in diagnostics when debug mode is enabled.

## 11. DSO structural tests

Measure masks as data, not only screenshots:

- disconnected shadow island count;
- largest island area;
- total small-island area;
- silhouette edge length;
- occupied tile count.

For overlapping bins, DSO should reduce fragmented minor islands versus independent-object macro shadows.

Near/mid/far tests verify contour simplification increases with throw distance without losing the primary mass.

## 12. Dark Bloom tests

Require:

- bounded radius;
- peak contribution weaker than hard DSO core;
- no Dark Bloom when the source core is absent;
- low near-caster contribution;
- greater role at long throw;
- depth-aware upsample does not leak across unrelated foreground silhouettes.

## 13. Temporal history tests

Track history accepted/rejected percentages. Force:

- light teleport;
- occluder deletion;
- large object movement;
- room transition;
- backend resize/reconfigure.

History must reject/reset promptly. No stale bin/beam trails.

## 14. Procedural subsystem tests

### Fine grass

- non-emissive;
- no independent warm/glow palette;
- darkens coherently outside light;
- canonical main-light direction.

### Foliage

- canonical light/normal/root/depth conventions;
- stable rooted/foreground behaviour;
- no moving specular shimmer;
- appropriate DSO/GTAO classification by size.

### Water

- canonical light vector/elevation;
- lit-scene/depth awareness;
- no self-lit dark-region response;
- consistent shadow/occlusion behaviour.

## 15. Editor tests

Scriptable sequence:

```text
load test room
place bin A
place overlapping bin B
capture IDs/depth/clusters
move B
capture
delete B
capture
undo
capture
redo
capture
save/reload
capture
```

No stale instance/object/depth/material/cluster/DSO/Dark-Bloom/contact state may remain.

## 16. Performance methodology

Primary benchmark uses pass-level GPU timestamps when adapter supports them. Never substitute CPU command-encoding duration and call it GPU time.

Per benchmark:

- warm-up: 300 frames;
- measurement: at least 600 frames;
- repeat: 3 independent runs;
- retain each run plus aggregate mean/median/p90/p95/p99/max.

Benchmark scenes:

- empty/fixed overhead;
- representative gameplay;
- dense static terrain;
- dynamic/robot heavy;
- foliage heavy;
- DSO bin cluster;
- diagnostic-light worst case;
- mixed water/foliage/actors.

Record GPU total and individual passes, CPU scene prep/encoding, visible/static/dynamic/foreground counts, occluders/clusters/largest cluster, active/self-shadowed lights, samples, DSO tiles/pixels, secondary-effect resolutions and renderer-owned target/history memory.

## 17. Performance acceptance targets

GTX 1650 Super / 1080p:

- 60 FPS design target;
- mean renderer GPU ≤12 ms;
- p95 renderer GPU ≤14.5 ms.

These are target gates, not current measurements. If evidence demonstrates they must change, open a decision issue; do not quietly weaken them.

Suggested pass guardrails for Medium are provisional planning budgets, not acceptance facts:

- G-buffer ~1.5–2.0 ms;
- depth hierarchy ~0.2–0.5 ms;
- clustering ~0.2–0.6 ms;
- DSO ~0.8–1.5 ms;
- Dark Bloom ~0.3–0.7 ms;
- contact ~0.3–0.7 ms;
- deferred/self-shadow ~2–3 ms;
- transparent/procedural ~1–1.8 ms;
- post ~0.6–1.0 ms.

## 18. Release gates

### Gate A — API correctness
Zero unresolved validation errors; shaders/pipelines/resources/fallback/device-loss tests pass.

### Gate B — representation correctness
Material readbacks, deterministic clears, object-ID/depth ownership, static/dynamic/foreground parity and light-independent visibility pass.

### Gate C — visual parity
WebGPU matches/exceeds WebGL2 on non-overlap controls (box/crate/barrel/cabinet/robot/pipes/water/foliage).

### Gate D — architectural improvement
Original/reconstructed bin fixtures show coherent overlap ownership, stable dominant clusters, corrected DSO and feathered residual occlusion without competing full-strength wedges.

### Gate E — editor/runtime integrity
No ghost material/depth/cluster/history state; room transitions and saves remain correct.

### Gate F — target performance/cross-browser
Chrome and Firefox target-hardware runs documented; 1650S target timing gate passes or a documented decision explicitly revises it.

Only after A–F may `Auto` prefer WebGPU by default.
