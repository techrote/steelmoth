# SM-301 WebGPU stable occluder clustering

## Purpose

SM-301 turns the bounded substantial-occluder representation from SM-300 into deterministic geometry-only clusters that later SM-302/303 work can consume. It is a representation layer, not a shadow effect: no light direction, shadow strength, dominant-owner score, DSO visibility, blur or temporal history participates in membership.

## Inputs and authority

The only production input is an SM-300 `steelmoth-webgpu-occluder-snapshot/v1` snapshot (or a live `WebGPUOccluderBins` object exposing that snapshot). SM-301 therefore inherits:

- stable object IDs;
- substantial versus receiver-only classification;
- shared root/contact coordinates;
- projected bounds and pseudo-Z ranges;
- static/dynamic semantics;
- the same bounded logical tile grid.

Receiver-only records never become cluster members. SM-301 does not rebuild a second object/depth authority and does not consume light state.

## Geometry criteria

Candidate edges are generated from tile-local expanded bounds rather than a room-wide all-pairs scan. The default geometry thresholds are intentionally tolerant enough to avoid cluster thrash under subpixel motion while remaining bounded:

- same-class projected adjacency: 2 px;
- cross-class projected adjacency: 1 px;
- root/ground-Y proximity: 8 px;
- coarse projected depth-anchor proximity: 24 units;
- pseudo-Z range proximity: 16 units;
- layer equality tolerance: 0.001.

A pair must be close in canonical layer/depth/Z and then satisfy projected overlap/adjacency or ground-footprint proximity. Occluder profile equality is a signal: same-class pairs receive the 2 px adjacency allowance, while cross-class pairs receive the stricter 1 px allowance. Actual overlap still remains class-independent when the depth/Z criteria are satisfied.

## Tiny-connector safeguard

SM-300 already removes ordinary tiny receiver-only decor from substantial cluster candidates. SM-301 adds a second safeguard for geometrically substantial-but-small records that could otherwise become accidental chain links. A non-explicit record below 96 px² may connect only when at least 20% of its own projected area overlaps the neighbour. An explicit `majorOccluder` remains authoritative and is not subject to this safeguard.

This specifically prevents thin/small slivers from joining two otherwise separated major masses merely because each touches by one or two pixels.

## Determinism and cluster IDs

SM-300 substantial records are sorted by stable object ID and ID text. Candidate pairs are generated in deterministic tile/index order and union-find always attaches the larger component root to the smaller root. Components are then sorted by their lowest stable object ID.

The cluster ID is the lowest stable object ID in the cluster. Therefore:

- the same member set always produces the same cluster ID;
- source submission order cannot change cluster identity;
- subpixel motion that does not change membership cannot change cluster identity;
- merge/split events change identity only where the member set genuinely changes.

SM-301 reserves `dominantObjectId = 0`. Light-dependent owner selection and hysteresis belong exclusively to SM-302.

## GPU data layout

Clusters and membership are uploaded to persistent SM-103 resource-registry buffers. No per-frame GPU resource creation is required during normal updates.

### Cluster record — 64 bytes

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `u32` | cluster ID |
| 4 | `u32` | member-buffer offset |
| 8 | `u32` | member count |
| 12 | `u32` | flags |
| 16..31 | `vec4<f32>` | combined left/top/right/bottom bounds |
| 32..39 | `vec2<f32>` | min/max pseudo-Z |
| 40..47 | `vec2<f32>` | coarse min/max projected depth anchor |
| 48 | `u32` | dominant object ID, always zero in SM-301 |
| 52 | `u32` | distinct profile count |
| 56 | `u32` | minimum member object ID |
| 60 | `u32` | reserved |

The member buffer is a packed `u32` object-ID list. A second 8-byte-per-member mapping buffer stores `{ objectId, clusterId }` pairs for downstream lookup/debugging.

## Bounded work and overflow

Defaults:

- 32 candidate records per expanded tile;
- 8192 unique candidate pairs;
- 512 cluster records;
- 512 total members.

Dense/pathological input never causes unbounded pair construction. Tile-member or global pair overflow is surfaced in diagnostics. Overflow does not silently increase limits or switch to room-wide quadratic work.

## Diagnostics and debug view

Diagnostics expose:

- cluster count and member count;
- candidate pair count and overflow;
- candidate-tile overflow and occupancy;
- accepted/rejected candidate edges;
- isolated-cluster count;
- largest cluster ID, bounds, members and member count;
- full per-cluster bounds/member/Z/depth data;
- upload/invalidation counters;
- explicit `lightIndependent` and `dominantOwnerDeferred` contract flags.

`debugClusterOverlay()` returns inspectable cluster rectangles, member IDs/count, Z/depth ranges and a deterministic colour index.

## Invalidation

The persistent path rejects stale bindings after explicit/editor invalidation, room changes, resize/reconfigure, or device replacement. A rebuild from the current SM-300 snapshot is required before bindings/readback/debug output become valid again. Repeating an identical cluster topology does not re-upload unchanged cluster/member buffers.

## Verification

SM-301 verification includes:

- touching-bin clustering;
- overlapping-bin clustering;
- separated-bin non-clustering;
- source-order determinism;
- ±0.25/0.5/1 px perturbation stability;
- receiver-only tiny-decor exclusion;
- a small-connector chain-prevention fixture;
- dense candidate/member/cluster cap tests;
- persistent real-WebGPU storage-buffer upload/readback;
- stale-binding/editor/room invalidation;
- debug-overlay production.

Hosted WebGPU validates storage/API/data correctness. It is not target-GPU performance evidence and it does not validate SM-302 dominance or SM-303 DSO appearance.
