# SM-304 DSO near/mid/far silhouette hierarchy and tile culling

## Purpose

SM-304 refines the stable SM-303 Deep Silhouette Occlusion hard core without changing ownership. It keeps the dominant-owner macro shadow crisp near the caster, progressively removes secondary contour detail with projected throw, and avoids expensive DSO traversal in screen tiles that cannot contain the shadow.

This stage remains deterministic and non-temporal. It does **not** add Dark Bloom, a far penumbra, temporal accumulation, GTAO, or final multi-shadow composition; those remain SM-305–307 and later work.

## Input and ownership authority

The only accepted input is `steelmoth-webgpu-dso-snapshot/v1` from SM-303. Cluster identity, dominant object ownership, light direction, canonical pseudo-height-derived throw, and bounded secondary structure therefore remain upstream authority.

SM-304 never chooses a new owner and never rebuilds an independent per-object macro-shadow path. The dominant SM-303 owner is represented at every hierarchy level. Simplification may remove secondary contour features but may not remove the primary owner mass.

## Projected-throw hierarchy

Each DSO job stores three contour levels:

- **near** — exact SM-303 owner bounds and all bounded secondary members;
- **mid** — outward-snapped owner/member bounds with small secondary features removed;
- **far** — coarser outward-snapped owner/member bounds with a higher secondary-detail threshold.

The production shader chooses the level per pixel from distance projected along the stable SM-303 shadow direction. It does not select one level for an entire object merely from camera distance. Near therefore preserves useful local silhouette structure while long throws can become progressively simpler.

Outward snapping is deliberate: the coarse owner contour may broaden by a bounded amount, but it cannot carve away the dominant owner's hard-shadow mass. Secondary members remain bounded by their original SM-303 throw lengths even when their contour survives into a coarser level.

### Quality controls

The hierarchy has explicit `Low`, `Medium`, `High`, and `Ultra` presets. They only change secondary fidelity:

| preset | near fraction | mid fraction | mid snap | far snap | mid secondary min area | far secondary min area |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Low | 0.22 | 0.52 | 4 px | 8 px | 96 px² | 384 px² |
| Medium | 0.35 | 0.70 | 2 px | 4 px | 64 px² | 256 px² |
| High | 0.45 | 0.78 | 1 px | 2 px | 32 px² | 128 px² |
| Ultra | 0.55 | 0.86 | 1 px | 1 px | 16 px² | 64 px² |

Higher tiers retain exact near detail farther down the throw and use finer quantization. Core ownership, object ID, primary depth and the existence of the dominant DSO wedge are never quality-scaled.

The values above are bounded implementation defaults, not target-hardware performance claims. Later SM-501 target-hardware work may tune preset policy using measured evidence without weakening the ownership contract.

## Compact expensive-tile traversal

SM-304 builds a 16-pixel DSO traversal grid from each hierarchy job's conservative swept bounds. Only tiles intersected by at least one job enter the active-tile list. The compute shader dispatches one workgroup per active or stale tile instead of a full-screen expensive DSO traversal.

Each workgroup covers its tile in bounded 8×8 thread strides. Pixels in active tiles traverse only that tile's bounded job-reference list. Empty/unaffected tiles do not traverse jobs.

A previously active tile that becomes inactive is still dispatched once with zero job references so its old mask pixels are explicitly cleared. On initial configuration, resize, room change, editor invalidation, or device reset, the first rebuild covers the full grid once to establish a known zero state. Subsequent settled updates dispatch only the union of current and previously active tiles.

This distinction is important: the implementation claims reduced **expensive DSO traversal work**, not that every frame has zero bookkeeping or zero clearing cost.

Default bounds remain explicit:

- 512 hierarchy jobs;
- 512 hierarchy members;
- 32 jobs per traversal tile;
- 16,384 tile references.

Overflow is surfaced in diagnostics and never falls back to an unbounded room-wide traversal.

## GPU representation

The hierarchy uses persistent SM-103 resources:

- 112-byte per-job records containing near/mid/far owner contours, projected-throw bands, direction and SM-303 identity;
- 80-byte per-member records containing near/mid/far contours, original bounded throw and maximum retained hierarchy tier;
- 16-byte compact active-tile records;
- bounded tile-reference storage;
- a persistent full-resolution `r32float` hard-mask texture.

The output meaning remains compatible with SM-303: `0` is unoccluded and `1` is hard DSO occlusion. SM-304 changes contour detail selection and traversal cost, not hard-core visibility semantics.

## Deterministic structural validation

The controlled throw-distance fixture deliberately contains one dominant owner plus several detached small secondary contour features. Validation requires:

- the forced near contour to match the SM-303 hard-core reference exactly;
- near → mid → far disconnected-island count to decrease;
- near → mid → far total small-island area to decrease;
- near → mid → far silhouette edge length to decrease;
- every SM-303 dominant-owner hard-shadow pixel to remain present in the forced far contour;
- projected-distance samples to select near, then mid, then far in order;
- fixed inputs to produce deterministic hierarchy signatures and masks.

The real-browser gate runs Low/Medium/High/Ultra through the production WGSL path and requires exact GPU/CPU mask agreement. It also removes all jobs for one frame and verifies that previously active tiles are cleared, then rebuilds the scene and re-verifies exact output.

## Diagnostics and evidence boundary

Diagnostics expose hierarchy quality, member counts retained at each tier, active/total/empty tile counts, expensive-tile skip ratio, overflow counts, dispatch-tile count, stale-clear-tile count, and the deterministic snapshot signature. The debug overlay exposes projected-throw boundaries, near/mid/far owner contours and per-level member counts.

CI retains a screenshot showing near, mid, far and distance-banded masks plus machine-readable structural/readback evidence. That artifact is suitable for later human review, but automated CI does not claim that a human has reviewed it.

Hosted CI also does not claim GTX 1650 Super GPU timing. Adapter `timestamp-query` availability is recorded, but no CPU wall-clock surrogate is labelled as GPU time. Target-hardware pass timing remains owned by the later performance/instrumentation lane. The SM-304 correctness gate instead reports exact structural metrics and the number/fraction of tiles avoiding expensive traversal.

## Invalidation

Resize, room change, editor invalidation and device reset invalidate public bindings. The next complete rebuild re-establishes the full mask before bindings become valid again. Stale tiles from ordinary within-room changes are explicitly cleared through the compact dispatch list.

## Scope boundary

SM-304 implements only projected-throw contour hierarchy, quality controls and bounded DSO tile traversal. It does not implement SM-305 Dark Bloom, SM-306 temporal stabilization/history, SM-307 final visibility composition, GTAO, SSGI, volumetrics, target-hardware acceptance, or WebGPU-default promotion.
