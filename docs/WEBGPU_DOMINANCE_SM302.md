# SM-302 dominant occluder scoring and hysteresis

## Purpose

SM-302 consumes stable geometry-only SM-301 clusters and selects one coherent primary macro-shadow owner for each relevant light/cluster pair. It does not generate the final DSO contour and it does not allow every cluster member to emit an equal full-strength long shadow.

The representation exists to make the later SM-303 DSO pass stable under moving lights while preserving secondary cluster members for contour widening, upper structure, local self/contact shadow and Dark Bloom.

## Inputs and authority

SM-302 consumes:

- the canonical `steelmoth-webgpu-cluster-snapshot/v1` produced by SM-301;
- the matching `steelmoth-webgpu-occluder-snapshot/v1` produced by SM-300;
- canonical SM-204 light records, either directly or through `buildCanonicalLights()`.

Cluster topology remains geometry-only. SM-302 never changes SM-301 membership or cluster IDs. A room mismatch between cluster and occluder snapshots is rejected rather than guessed through.

## Dominance score

Each candidate member receives a bounded score composed from four required physical/structural signals plus the pre-existing occluder strength:

1. **Exposed silhouette** — projected member span perpendicular to the light, modulated by how close its light-facing edge is to the cluster's light-facing edge.
2. **Light exposure/direction** — the member's directional support toward the current light.
3. **Pseudo-height** — member maximum pseudo-Z normalized across the cluster Z range.
4. **Front depth** — canonical layer/root depth anchor normalized across the cluster depth range; larger SM-201 visibility keys are nearer.
5. **Occluder strength** — a deliberately small tie-break contribution.

Default weights are 0.52 / 0.18 / 0.18 / 0.10 / 0.02. They sum to 1 and intentionally make directional exposed silhouette the primary signal without ignoring height and front-depth structure.

For point/cone records with a position, the scoring direction is the normalized vector from cluster centre toward the light. For a direction-only record, SM-302 uses the inverse light-ray direction. Score ties are resolved deterministically by higher pseudo-Z, then nearer front depth, then lower stable object ID.

## Relevant-light bound

SM-302 does not build work for lights that cannot reach the cluster. For positioned lights with a finite positive radius, point-to-cluster-AABB distance must be within radius plus a small four-pixel relevance pad. Disabled/zero-intensity lights are ignored.

The implementation is bounded to 8,704 dominance records by default: 512 SM-301 clusters times the canonical maximum 17 SM-204 lights. Overflow is explicit in diagnostics and never expands the buffer dynamically during a frame.

## Temporal hysteresis

History is keyed by stable `{clusterId, lightIdHash}`. If the previous owner is still a valid cluster member, a challenger may replace it only when:

```text
challengerScore - previousOwnerScore
  > max(0.055, abs(previousOwnerScore) * 0.10)
```

Otherwise the previous owner is retained and the record is marked `HYSTERESIS_HELD`. A successful replacement is marked `SWITCHED`. The first valid owner is marked `FIRST_OWNER`.

History is cosmetic renderer state only. It is cleared on explicit invalidation, room changes and device replacement. It never feeds gameplay state or cluster construction.

## GPU data layout

The persistent SM-103 resource-registry buffer `sm302:records` stores 48 bytes per relevant light/cluster pair:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `u32` | cluster ID |
| 4 | `u32` | stable light-ID hash |
| 8 | `u32` | current dominant object ID |
| 12 | `u32` | previous dominant object ID |
| 16 | `f32` | current owner score |
| 20 | `f32` | previous-owner score in the current frame |
| 24 | `u32` | challenger object ID |
| 28 | `u32` | flags (`SWITCHED`, `HYSTERESIS_HELD`, `FIRST_OWNER`) |
| 32 | `f32` | hysteresis threshold |
| 36 | `f32` | challenger score delta |
| 40 | `u32` | scored member count |
| 44 | `u32` | reserved |

Normal updates reuse the persistent buffer. Readback exists for validation/debug evidence, not as a production dependency.

## Diagnostics and debug view

`debugDominanceOverlay()` and live diagnostics expose, per relevant light/cluster pair:

- current and previous owner IDs;
- current owner score and margin;
- challenger ID and delta;
- hysteresis threshold and whether it held;
- whether an actual owner switch occurred;
- normalized light direction toward the source;
- every member's total score plus exposed-silhouette, light-exposure, silhouette-span, pseudo-height, front-depth and strength components.

This is sufficient to inspect why an owner won without inferring ownership from draw order.

## Validation fixtures

The deterministic suite uses a three-bin overlap cluster whose four cardinal light positions have explicit expected owners:

- light from the left → left exposed bin;
- light from the right → right exposed bin;
- light from above → upper exposed bin;
- light from below → lower/front bin.

A moving-light sweep verifies that ±1–2° perturbations around a stable cardinal direction do not pop owners. A symmetric two-bin fixture deliberately creates a tiny challenger advantage: raw scoring changes winner, but history retains the previous owner until the challenger exceeds the explicit threshold. A larger light move then proves that ownership can change when the score advantage is genuinely decisive.

Hosted WebGPU additionally validates persistent buffer upload/readback, invalidation, room-history reset and the owner timeline. The browser smoke draws the owner/score debug view and the CI runner captures it as evidence.

## Scope boundary

SM-302 chooses ownership only. It does **not**:

- generate DSO hard contours;
- generate Dark Bloom or far penumbra;
- let non-owner members emit equal full macro wedges;
- change geometry-only SM-301 cluster membership;
- alter gameplay state.

SM-303 consumes this owner data to build the actual hard macro-occlusion field.
