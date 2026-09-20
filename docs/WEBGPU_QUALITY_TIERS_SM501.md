# SM-501 WebGPU quality tiers and GTX 1650 SUPER acceptance

SM-501 owns the static WebGPU quality ladder and the first target-hardware performance acceptance gate. It does **not** authorize adaptive quality or default-backend promotion. `Auto` remains under SM-505 ownership.

## Fixed correctness boundary

Quality presets may reduce bounded secondary work only. Every preset keeps native/full-resolution albedo, Material-v2 G-buffer ownership, object ID and primary pseudo-depth. Nearest/crisp albedo sampling is invariant. The hard DSO ownership model is not weakened by dropping jobs or members; the tier changes the already-defined distance/silhouette hierarchy instead.

The executable policy is `engine/webgpu_quality.js` (`steelmoth-webgpu-quality/v1`). Unknown preset names resolve to **Medium** rather than silently selecting the cheapest mode.

## Presets

| Setting | Low | Medium | High | Ultra |
| --- | ---: | ---: | ---: | ---: |
| Core render/G-buffer/object/depth scale | 1.0 | 1.0 | 1.0 | 1.0 |
| Height self-shadow samples | 8 | 12 | 16 | 28 |
| Self-shadowed light cap | 1 | 2 | 3 | 4 |
| Self-shadow max distance (logical px) | 112 | 144 | 176 | 176 |
| Contact samples | 4 | 8 | 12 | 12 |
| Contact max distance (logical px) | 16 | 20 | 28 | 36 |
| Hard DSO owner/member caps | 512 / 512 | 512 / 512 | 512 / 512 | 512 / 512 |
| DSO distance hierarchy | Low | Medium | High | Ultra |
| Dark Bloom quality | Low | Medium | High | Ultra |

The local-shadow sample values are the production SM-205 tables, not invented SM-501 approximations. DSO quality delegates to the production SM-304 hierarchy. Dark Bloom quality delegates to the production SM-305 presets. `tools/validate_webgpu_quality.js` mechanically verifies those mappings.

**Medium is the design target**, not an emergency fallback: it retains 12-tap local height self-shadow, two selected self-shadow lights, 8-tap contact, Medium DSO hierarchy and Medium Dark Bloom. It does not reduce any core representation.

GTAO is implemented and owned by SM-600/601, but it is deliberately outside the SM-501 initial WebGPU release scope. Every SM-501 preset therefore reports GTAO as `implemented: true`, `enabled: false`, `quality: off`, owned by `SM-601`, and excluded from the SM-501 acceptance total. SSGI and volumetrics remain unimplemented and disabled reserved slots. Adaptive/p95-driven switching remains exclusively SM-802.

## Benchmark protocol

The acceptance environment is the physical NVIDIA GeForce GTX 1650 SUPER 4 GB, Windows desktop browser, native 1920×1080, DPR 1. Chrome is the primary performance browser; Firefox requires at least a target-machine correctness/performance spot-check. The adapter must expose `timestamp-query`; CPU encoding or requestAnimationFrame duration must never substitute for GPU time. Every acceptance run must set **GTAO OFF** and identify the `sm501-initial-webgpu-release` scope. GTAO work must not be included in the renderer-total samples used to close SM-501.

Each canonical scenario uses:

1. 300 warm-up frames;
2. at least 600 measured frames;
3. three independent runs where practical, with fresh browser processes/profiles;
4. retained per-run and aggregate mean, median, p90, p95, p99 and max;
5. workload metadata: visible/static/dynamic/foreground instances, lights, self/contact samples, occluders/clusters/largest cluster, DSO tiles/pixels, secondary-effect dimensions and renderer-owned texture/buffer/history memory;
6. separate CPU scene-preparation and encoding fields.

Canonical scenarios are `empty`, `representative`, `dense-static`, `dynamic-robot`, `foliage`, `bin-cluster`, `diagnostic-light`, and `mixed`. No outlier may be deleted merely to satisfy the gate.

## Acceptance targets

At **Medium**, the target is:

- mean renderer GPU **≤ 12.0 ms**;
- p95 renderer GPU **≤ 14.5 ms**;
- 60 FPS design target at native 1920×1080.

If measured target-hardware data cannot meet those limits after bounded secondary-quality tuning, SM-501 must record the measured contradiction and open/update a decision record. It must not weaken the limits silently or reduce core albedo/object/depth resolution.

## WebGL2 comparison baseline

SM-003 measured the same GTX 1650 SUPER class target on WebGL2/ANGLE D3D11 using Chrome 153.0.8010.48, Windows 11 and NVIDIA driver 616.92. Its pooled GPU mean / p95 values were:

| Scenario | WebGL2 mean ms | WebGL2 p95 ms |
| --- | ---: | ---: |
| representative | 5.07 | 12.08 |
| empty | 4.63 | 10.84 |
| dense-static | 5.47 | 12.02 |
| dynamic-robot | 5.05 | 11.21 |
| foliage | 5.65 | 10.81 |
| bin-cluster | 5.99 | 10.42 |
| diagnostic-light | 6.35 | 10.57 |
| mixed | 5.93 | 10.67 |

The WebGPU report must compare against those values without implying that different pass architectures should have identical per-pass timings.

## Existing target-hardware evidence

SM-405 already proves the GTX 1650 SUPER target can execute the feature-complete M0–M4 functional matrix in Chrome and Firefox with real, non-fallback adapters. Its Chrome target record also exposes `timestamp-query`. That is capability/correctness evidence only; it is **not** an SM-501 timing result.

SM-500 proves that the instrumentation records real pass-level GPU timestamps when the feature is exposed, keeps CPU timings separate, exports workload/memory metadata and emits null GPU time when the feature is unavailable. Hosted SM-500 timings are instrumentation evidence only.

## Current acceptance state

The 2026-09-20 post-repair physical campaign at clean source `44e7947e0b6e402f7f8c36f081e70420eacd691a` confirms that the SM-305 scene-density pathology is removed. The bounded representative/dense-static localization records Dark Bloom means of 1.861/2.114 ms, down from 157.646/612.783 ms, with the repaired production path reporting `tierSource = gpu-sm304-active-tiles`. The physical SM-305 and SM-306 browser gates pass without weakening quality, ownership, depth or temporal contracts.

Full acceptance still **fails**. Six Chrome scenes satisfy both limits, but bin-cluster measures 57.983 ms mean / 91.130 ms p95 and diagnostic-light measures 68.680 ms / 96.229 ms across three fresh processes. Their timestamp queue spans closely track separate CPU encoding means, so the retained evidence supports a host-preparation/queue-idle-dominated remainder but does not justify subtracting CPU or calling the residual shader time. Firefox representative passes at 7.643 ms mean / 9.205 ms p95. The complete report, raw samples, screenshots, correctness reports, logs and interpretation are under `benchmarks/webgpu-gtx1650s/post-sm501-dark-bloom-fix-2026-09-20/`.

**SM-501, issue #31 and PR #92 remain open and unmerged.** SM-501 must remain open until a physical GTX 1650 SUPER Medium benchmark dataset satisfying the protocol above is committed/reviewed, together with the Firefox target-machine spot-check, and every canonical scenario meets the acceptance limits. The current dataset completes the required protocol but fails two scenes. The next bounded measurement should localize bin-cluster and diagnostic-light before selecting another repair. A hosted software/fallback adapter result, a two-scene diagnostic pass, or a large improvement in other scenes cannot close this gate.

## Physical execution entrypoint

`webgpu-target-benchmark.html` drives the actual staged production WebGPU G-buffer, ownership depth, depth hierarchy, local shadows, occluder/cluster/dominance, DSO hierarchy, Dark Bloom/temporal, bounded visibility, deferred lighting and post path. Its SM-501 mode brackets that whole submitted chain with one SM-500 timestamp pair and keeps GTAO off. Pass-level timing is deliberately separate.

`python tools/run_webgpu_target_campaign.py --phase sm501` launches three fresh Chrome processes/profiles, iterates all eight canonical scenes in each process, runs the required 300-frame warm-up and 600 retained timestamp frames, then performs the physical Firefox spot-check. It retains raw samples under `benchmarks/webgpu-gtx1650s/sm501-2026-09-19/`, emits the canonical report, and runs `tools/validate_sm501_target_report.py` without weakening the target.
