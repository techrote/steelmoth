# SM-203 reusable pseudo-depth hierarchy

Status: **implemented by SM-203**

This document defines the single reusable pseudo-depth hierarchy derived from the canonical SM-202 ownership depth. It is renderer data only; gameplay never reads it.

## Representation

Each hierarchy texel is `rg32float`:

- **R = nearest occupied canonical depth** (`minDepth`);
- **G = farthest occupied canonical depth** (`maxDepth`).

Canonical ownership uses conventional `less` depth, so a numerically smaller depth is nearer. The hierarchy preserves both extrema because different downstream traversals need conservative near and far bounds.

Empty cells use the invalid range `(1.0, 0.0)`. Occupancy is therefore exactly `minDepth <= maxDepth`. The sentinel is unambiguous even though the base depth attachment clears to `1.0`, because level 0 also consumes the canonical `r32uint` object-ID attachment: object ID zero means no owned fragment.

`rg32float` is used as an unfiltered, `textureLoad`-sampled storage/sampled texture. The implementation does not request `float32-filterable`, blending, texture-format tiers, or another optional WebGPU feature.

## Level dimensions and coverage

Level 0 has the exact native ownership-depth dimensions. Every subsequent level uses ceiling division:

```text
width[n+1]  = max(1, ceil(width[n] / 2))
height[n+1] = max(1, ceil(height[n] / 2))
```

Reduction continues through `1x1`. A level-N texel covers up to `2^N x 2^N` source pixels. For example, a `5x3` source produces:

```text
L0  5x3  coverage 1
L1  3x2  coverage 2
L2  2x1  coverage 4
L3  1x1  coverage 8
```

Odd edges are not duplicated. The compute pass bounds-checks each of the four possible children and reduces only children that exist.

## Reduction semantics

Level 0 converts the production depth/object ownership attachments:

```text
objectId == 0 -> (1, 0)
objectId != 0 -> (depth, depth)
```

Higher levels inspect up to four children. Invalid `(min > max)` children are ignored. For valid children:

```text
parent.minDepth = min(child.minDepth)
parent.maxDepth = max(child.maxDepth)
```

If every child is empty the parent remains `(1, 0)`. Thus the root level encloses every occupied canonical ownership depth without treating clear pixels as geometry.

## Lifetime and invalidation

`WebGPUDepthHierarchy` owns persistent level textures and compute pipelines. A normal frame rebuild overwrites every texel but does not recreate resources. Resources are recreated only when the source extent changes or the GPU device is reset.

The hierarchy is explicitly invalidated on configure/resize, room/history invalidation, or device reset. While invalid, `levelView()` and readback reject access; consumers cannot accidentally use stale hierarchy data. A successful full rebuild marks it valid again.

Diagnostics expose extent, per-level dimensions/coverage/estimated bytes, build count, resize count, invalidation count, resource generation, last invalidation reason and pipeline/resource diagnostics.

## Consumer API

The shared implementation is `engine/webgpu_depth_hierarchy.js`.

Consumers use:

- `levelInfo(level)` for dimensions, coverage and format;
- `levelView(level)` for a validated texture view;
- `levelForFootprint(pixelSpan)` for bounded logarithmic level selection;
- `RANGE_HELPERS_WGSL` for the shared occupancy/range-span semantics;
- `buildFromOwnership(gbuffer)` to consume the canonical SM-202 depth and object-ID resources.

No effect should construct an independent pseudo-depth pyramid. SM-205 self/contact shadow acceleration, M3 DSO, M6 GTAO/SSGI and M7 volumetrics must consume this hierarchy or explicitly justify a different representation in a later architecture decision.

## Debug and validation

Debug views are `min`, `max`, `span` and `occupancy`. Readback uses an unfiltered `textureLoad` compute probe so tests observe the same representation future compute consumers use.

Verification includes:

- CPU reference min/max vectors;
- all-empty and mixed-occupancy patterns;
- odd `5x3` dimensions and edge reduction;
- real WebGPU generation/readback for every hierarchy texel;
- direct comparison with the source canonical depth/object pattern;
- room invalidation rejection and deterministic rebuild;
- resize round-trip rebuild;
- compilation/execution of all debug modes under WebGPU validation scopes.

Hosted WebGPU success is representation/API correctness evidence only. It is not a GTX 1650 Super performance measurement or a visual-quality claim.
