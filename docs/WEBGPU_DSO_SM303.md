# SM-303 Deep Silhouette Occlusion hard core

## Purpose

SM-303 is the first production Deep Silhouette Occlusion (DSO) mask stage. It consumes the bounded SM-300 occluder representation, deterministic SM-301 clusters and the stable per-light dominant owner chosen by SM-302. The pass produces a deterministic **hard macro-occlusion field** for one selected player/diagnostic light without reintroducing independent full-length shadows for every object in a cluster.

This stage is deliberately non-temporal and non-soft. Distance-dependent contour simplification belongs to SM-304, Dark Bloom/far penumbra belongs to SM-305, temporal accumulation belongs to SM-306, and final bounded multi-shadow composition belongs to SM-307.

## Input authority

SM-303 accepts only matching-room snapshots from:

- `steelmoth-webgpu-occluder-snapshot/v1` (SM-300);
- `steelmoth-webgpu-cluster-snapshot/v1` (SM-301);
- `steelmoth-webgpu-dominance-snapshot/v1` (SM-302).

Stable object IDs, canonical roots, pseudo-Z ranges and layer/depth ordering therefore remain inherited upstream authority. The hard-core pass does not infer ownership from draw order and does not reinterpret Material-v2 local height as ownership depth.

The selected dominance record supplies the stable cluster-level direction toward the light. Shadow travel is the inverse of that direction. Owner throw is derived from the canonical pseudo-height range and is bounded by explicit minimum/maximum distances.

## Primary and secondary structure

**One dominant owner emits the full-length hard macro wedge** for each selected cluster/light pair.

Non-owner cluster members may contribute only short structural widening. Their throw is capped by both their own pseudo-height and a fixed fraction of the dominant owner's throw. They cannot independently emit another equal full-strength long wedge.

This preserves upper/side structural mass while directly targeting the failure mode where overlapping bins produced several competing macro wedges.

Default hard-core bounds:

- pseudo-height throw scale: `3.0`;
- owner throw: `12..96` logical pixels;
- secondary maximum throw: `38%` of the owner throw;
- secondary pseudo-height scale: `50%` of the normal owner scale.

These are hard-core representation parameters, not SM-304 distance-tier simplification and not a soft-shadow radius.

## Tile-local GPU work

SM-303 reuses the logical 32-pixel tile convention already established by SM-300. Every DSO job computes a conservative swept bound from its owner and bounded secondary structure. Only tiles touched by that bound receive the job index.

Default caps:

- 512 DSO jobs;
- 512 secondary-member records;
- 32 jobs per tile;
- 8192 tile references.

Overflow is explicit in diagnostics. The pass never falls back to a room-wide unbounded list.

### GPU ABI

Each DSO job is 64 bytes. It stores cluster/owner/light identity, secondary-member offset/count, dominant bounds, the cluster shadow direction, bounded owner throw and owner score. Secondary-member records are 32 bytes and store object identity, bounded throw/strength and projected bounds.

The hard mask is a persistent full-resolution `r32float` texture. `0` means unoccluded and `1` means hard DSO occlusion. The compute shader writes every pixel deterministically, so stale values cannot survive between dispatches.

## Geometry test

The hard wedge is the exact swept rectangle of the projected occluder bounds along a finite shadow segment. The shader uses an analytic interval/slab test rather than per-pixel ray marching. Pixels inside the source rectangle are not labelled as macro shadow.

The same predicate exists in the CPU structural reference used only for deterministic validation. Production rendering does not rasterize a second CPU mask.

## Structural metrics and regression evidence

Mask validation records:

- disconnected shadow island count;
- largest island area;
- total small-island area;
- silhouette edge length;
- occupied tile count;
- total mask area and deterministic mask hash.

The bin regression additionally constructs a deliberately independent-object baseline where each member projects a full-length wedge from its own point-light direction. This is diagnostic evidence only; it is not a second production path.

For the overlapping three-bin fixture, the accepted cluster DSO must show fewer disconnected competing islands, lower minor-island area, and shorter fractured silhouette edge than that independent-object baseline.

## Eight-angle fixtures

The browser gate renders and reads back both a single-box control and the three-bin cluster at **0°, 45°, 90°, 135°, 180°, 225°, 270°, and 315°**.

For every angle it requires exact GPU/reference mask agreement, one full-length dominant wedge per cluster, no full-length secondary wedge, non-empty hard-core coverage and deterministic repeat output for fixed scene/light state. The single-box control must remain one coherent connected silhouette at every angle.

The moving-light sweep additionally proves SM-302 owner hysteresis continues to prevent ±1–2° owner popping; SM-303 itself adds no temporal history. The browser smoke draws all sixteen hard masks to one diagnostic canvas and CI stores the screenshot plus JSON readback/metric evidence.

## Resource lifetime and invalidation

`WebGPUDSOHardCore` owns persistent job/member/tile/parameter buffers and the hard-mask texture through the SM-103 resource registry. Resize recreates surface-dependent resources. Room/editor/device invalidation makes public bindings stale until a complete rebuild succeeds. No gameplay state depends on this pass.

## Scope boundary

SM-303 intentionally does **not** implement SM-304 near/mid/far distance contour simplification, SM-305 Dark Bloom or far penumbra, SM-306 temporal accumulation/history, SM-307 final multi-shadow visibility composition, GTAO or SSGI, or target-GPU performance claims.

Hosted WebGPU success proves shader/resource/data correctness and deterministic structural behaviour. It is not GTX 1650 Super timing evidence and is not a substitute for later human visual acceptance.
