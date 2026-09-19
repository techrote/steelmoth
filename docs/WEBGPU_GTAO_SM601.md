# SM-601 — GTAO stabilization and target-GPU gate

SM-601 converts the SM-600 correctness prototype into a bounded production-quality ladder and adds conservative temporal reuse. It does **not** claim target performance until a physical GTX 1650 SUPER report passes `tools/validate_sm601_target_report.py`.

## Production quality ladder

`engine/webgpu_gtao_stabilization.js` owns the GTAO-specific Low/Medium/High/Ultra mapping. The mapping is intentionally independent of SM-501's still-open whole-renderer target-performance gate, but uses the same quality names so the eventual renderer selector can pass one tier consistently.

| Tier | GTAO | Directions | Steps | Radius | Temporal history |
| --- | --- | ---: | ---: | ---: | --- |
| Low | disabled | 4 | 2 | 8 | disabled |
| Medium | enabled | 6 | 4 | 12 | 0.55 |
| High | enabled | 8 | 5 | 14 | 0.62 |
| Ultra | enabled | 8 | 6 | 16 | 0.68 |

Medium deliberately preserves the representative SM-600 6×4 horizon budget while reducing intensity from the prototype 1.1 to 1.0. Higher tiers spend bounded additional samples; Low explicitly removes GTAO rather than silently reducing primary scene resolution. These values are production candidates, not a promise that Medium meets the 0.7–1.2 ms GTX1650S planning guardrail.

`resolveQuality(tier)` returns both the settings to pass to `WebGPUGTAO.update(..., quality.gtao)` and the temporal policy consumed by `WebGPUGTAOTemporal`.

## Temporal reuse

Temporal reuse is enabled only on Medium and above. The history weight is deliberately modest and is never allowed to become a long accumulator that hides trails. A history sample is accepted only when all of the following remain compatible:

- room ID, device generation and backend generation are unchanged;
- object ownership is unchanged;
- both canonical SM-203 pseudo-depth endpoints remain within the tier threshold;
- Material-v2 normal agreement remains above the tier threshold.

Accepted history is then constrained twice: first to the current 3×3 visibility neighborhood and then to a bounded delta around the current sample. Rejected pixels use the current GTAO value exactly. Resize, explicit invalidation and device reset invalidate the whole history.

This policy is intentionally stricter than simply blending successive AO frames. GTAO exists for subtle world/inter-surface grounding, so a little residual noise is preferable to dark trails behind moving actors or stale room geometry.

## AO semantic separation

SM-600 remains authoritative for AO composition semantics: Material-v2 AO is intra-object evidence, GTAO is inter-surface/world evidence, and SM-307 uses strongest-occluder/min semantics rather than multiplying the two terms. SM-601 does not introduce another AO multiplication stage. The existing reduced Material-v2 AO recommendation remains in force whenever GTAO is active.

## Validation

`tools/validate_webgpu_gtao_stabilization.js` checks the quality ladder, stable-history reuse, object/depth/normal/room rejection, disocclusion delta clamping and Low-tier neutrality against a deterministic CPU reference.

`webgpu-gtao-stabilization-smoke.html` and `tools/validate_webgpu_gtao_stabilization_browser.py` execute the production temporal WGSL on real WebGPU. The smoke verifies an uninitialized frame, a stable frame, an ownership discontinuity, a room transition and explicit lifecycle invalidation. Hosted WebGPU evidence proves API/WGSL correctness and rejection behavior only; it is not target-GPU timing.

## GTX 1650 SUPER performance acceptance

The remaining issue-level gate is physical target evidence at native 1920×1080 / DPR 1, Medium GTAO, using genuine WebGPU timestamp queries. The report must contain at least three runs, each with at least 300 warm-up frames and 600 measured frames, and must record mean/p50/p95 GTAO GPU cost plus moving-scene stability, history-rejection and no-double-darkening sign-off.

Validate a captured report with:

```text
python tools/validate_sm601_target_report.py <report.json>
```

The roadmap's roughly **0.7–1.2 ms** Medium cost is a planning guardrail, not an assumed result. The validator reports whether the measured run means lie within that guardrail but does not convert an over-budget result into a fake pass. A materially over-budget result requires architecture investigation before reducing scene fidelity indiscriminately.

Until that physical GTX1650S report exists, SM-601 must remain open and SM-602 must not assume the stabilization/performance gate is complete.
