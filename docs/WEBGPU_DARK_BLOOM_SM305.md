# SM-305 — Dark Bloom soft residual occlusion

## Contract

SM-305 adds a separate, low-frequency residual visibility field derived only from the accepted SM-303/304 Deep Silhouette Occlusion hard core. It is not a generic full-scene blur and it does not change dominant ownership, hard-core geometry, or transparent/deferred ordering. The production path consumes the SM-304 projected-throw near/mid/far hierarchy and the canonical SM-203 pseudo-depth range level 0.

The residual is generated at half resolution, then reconstructed into a full-resolution `r32float` texture. Hard-core pixels always receive a Dark Bloom value of zero, so composition can keep the hard DSO mask authoritative and add only a subordinate feather around it.

## Bounded quality and distance policy

The compute shader has a hard maximum search radius of eight half-resolution texels. Quality controls stay inside that fixed bound and bias both radius and strength by SM-304 distance tier:

| Quality | near radius | mid radius | far radius | near strength | mid strength | far strength |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Low | 1 | 2 | 3 | 0.08 | 0.18 | 0.28 |
| Medium | 1 | 3 | 4 | 0.10 | 0.22 | 0.34 |
| High | 2 | 4 | 6 | 0.12 | 0.26 | 0.40 |
| Ultra | 2 | 5 | 8 | 0.14 | 0.30 | 0.45 |

Radii are half-resolution texels, so the maximum nominal Ultra reach is 16 full-resolution pixels before the one-cell reconstruction footprint. Strength is clamped below one and the shipped table peaks at 0.45, guaranteeing that the residual field cannot replace unit-strength hard-core occlusion. Near-caster contribution is intentionally small; longer projected throw receives the larger residual role requested by the programme architecture.

No temporal history is present in SM-305. History, reprojection, disocclusion rejection and temporal stability belong to SM-306.

## Depth-aware reconstruction and lifecycle

The reduced pass reads the SM-203 level-0 `rg32float` nearest/farthest pseudo-depth texture. A potential residual receiver is accepted only when its nearest occupied depth is within the quality tier's configured discontinuity threshold of the contributing hard-core sample. The full-resolution reconstruction repeats this depth compatibility test for each bilinear sample. This deliberately rejects soft-shadow leakage onto unrelated foreground ownership while retaining smooth reconstruction on one surface.

`WebGPUDarkBloom` owns persistent reduced and full-resolution `r32float` textures, a compact `u32` tier map, and one uniform parameter buffer through the SM-103 resource registry. Resize, room transition, editor invalidation and device reset invalidate stale bindings. The staged web app imports the module after SM-304; Auto presentation remains WebGL2 until the later backend cutover.

## SM-501 target-hardware pathology repair

The 2026-09-19 GTX 1650 SUPER campaign exposed a host-side scaling defect in the original production tier-map preparation. The old `buildTierMap()` walked each job's swept rectangle and then called `tierAtPoint()` for every candidate reduced pixel; `tierAtPoint()` searched every job again. Scene density therefore introduced an accidental nested all-jobs traversal before the bounded Dark Bloom shader was submitted.

The production path now generates the reduced near/mid/far tier map on the GPU. It consumes the existing SM-304 packed job/member buffers and active-tile/job-reference spatial index, dispatching one bounded tier-map workgroup per active SM-304 tile before the residual and upsample passes. No radius, strength, ownership, pseudo-depth, or Medium-quality acceptance rule is weakened. The CPU `buildTierMap()` remains as a deterministic reference/fallback path for small fixtures and legacy snapshots, and its optimized form also reuses the SM-304 active-tile index rather than rescanning all jobs.

The original SM-501 pass-localization timestamps must be read as **queue-span localization**, not shader-only time. SM-500's current timestamp wrapper submits a start marker, executes the JavaScript pass callback, then submits an end marker. The old CPU tier-map construction happened between those marker submissions, so GPU queue idle time while the CPU encoded work was included in the interval. This is corroborated by the physical session data: representative recorded 197.154 ms mean queue span versus 197.056 ms mean CPU encoding, while dense-static recorded 672.760 ms versus 672.732 ms. The evidence still correctly localizes the frame-time pathology to SM-305, but it does not imply that the bounded half-resolution residual shader itself consumed hundreds of milliseconds.

## Validation evidence

`tools/validate_webgpu_dark_bloom.js` provides deterministic CPU-reference checks for bounded radius, quality monotonicity, near/mid/far strength bias, exact no-core zero behaviour, hard-core preservation, a controlled depth discontinuity, and the named `binsup` residual contract.

`webgpu-dark-bloom-smoke.html` and `tools/validate_webgpu_dark_bloom_browser.py` execute the two real WebGPU compute passes in headless Chrome/Chromium. The gate reads the full `r32float` result back and compares it numerically with the CPU reference for Low, Medium, High and Ultra. It also reruns with an empty core and with a depth barrier, checks stale-binding invalidation/rebuild, and retains a debug screenshot. The browser report records submit/readback wall time for diagnostic context only and records whether the adapter exposes `timestamp-query`; it does not label hosted software-adapter timing as target-GPU performance.

The `binsup` fixture remains the qualitative visual target: a coherent lower-bin primary shadow with a softer residual around it, without several equally strong segmented wedges. Hosted CI proves that a subordinate residual is produced and that hard ownership is preserved; it does not claim that a human has approved the screenshot.

## Scope boundary

SM-305 intentionally stops before temporal accumulation and before final DSO/Dark-Bloom visibility composition. It neither repairs ownership nor masks segmentation defects with a large blur. If the correct appearance required a huge or full-resolution blur, that would violate the issue stop condition rather than justify widening this pass. Target GTX 1650 Super pass-time claims also remain unavailable until validation runs on that hardware; the bounded half-resolution workload and fixed-radius loop are the implementation-side performance controls available in hosted CI.
