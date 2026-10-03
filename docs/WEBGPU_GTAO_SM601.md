# SM-601 — GTAO stabilization and target-GPU gate

SM-601 converts the SM-600 correctness prototype into a bounded production-quality ladder and adds conservative temporal reuse. Target acceptance requires the complete physical GTX 1650 SUPER campaign, report validation and issue-level visual/history/composition criteria. A validator's schema pass alone does not complete the issue.

## Production quality ladder

`engine/webgpu_gtao_stabilization.js` owns the GTAO-specific Low/Medium/High/Ultra mapping. The mapping is independent of SM-501's whole-renderer gate, completed by PR #92, and uses the same quality names so the eventual renderer selector can pass one tier consistently.

| Tier | GTAO | Directions | Steps | Radius | Temporal history |
| --- | --- | ---: | ---: | ---: | --- |
| Low | disabled | 4 | 2 | 8 | disabled |
| Medium | enabled | 6 | 4 | 12 | 0.55 |
| High | enabled | 8 | 5 | 14 | 0.62 |
| Ultra | enabled | 8 | 6 | 16 | 0.68 |

Medium deliberately preserves the representative SM-600 6×4 horizon budget while reducing intensity from the prototype 1.1 to 1.0. Higher tiers spend bounded additional samples; Low explicitly removes GTAO rather than silently reducing primary scene resolution. These values are production candidates, not a promise that Medium meets the 0.7–1.2 ms GTX1650S planning guardrail.

`resolveQuality(tier)` returns both the settings to pass to `WebGPUGTAO.update(..., quality.gtao)` and the temporal policy consumed by `WebGPUGTAOTemporal`.

## Measured scheduling and counter adoption

`engine/webgpu_gtao_readback.js` supplies a production adapter around the unchanged stabilization class. Its compatibility defaults are blocking diagnostic delivery and baseline per-pixel counters. The canonical SM-601 target harness explicitly selects deferred delivery, three bounded readback slots and workgroup-aggregated counters; SM-501 continues to exclude GTAO. Adding the module to the offline cache does not promote the normal backend.

Deferred delivery submits the same temporal work and diagnostic copy without awaiting mapping inside the measured callback. The adapter exposes completed diagnostic records, pending/skipped/stale/failed/evicted accounting and an explicit `flushStats()` drain. History invalidation and device/reset boundaries reject stale diagnostic completions. Saturation may omit diagnostic delivery but cannot alter temporal output or gameplay-authoritative state. Acceptance/equivalence probes drain outside the callback and require their expected counter records explicitly.

Aggregated counters retain exact integer totals by reducing within each 8×8 workgroup before bounded global updates. Out-of-extent invocations participate in barriers while contributing zero. Visibility, depth, object, normal and rejection calculations retain the measured shader semantics. No production module imports research code from `tools/experiments/`.

The native comparison at `fa388aa9567dbacd2598221c644c22946834221d` measured the combined candidate at **1.114569 ms queue-span mean / 1.078616 ms command-span mean** over three independent processes. All four temporal textures and eight counter words matched exactly at the recorded snapshots. Most of the queue-span improvement reflects diagnostic scheduling; it must not be reported as an equivalent shader speedup. The adapter's production source requires fresh correctness and full acceptance measurements. See [`SM601_MEASURED_ADOPTION.md`](SM601_MEASURED_ADOPTION.md) for source identities, boundaries and the comparison table.

The adoption preserves Medium 6×4, radius 12, intensity 1.0 and temporal weight 0.55; all other tier and rejection settings are unchanged. Reconstruction continues to use the strict binary32 `0.000001` cutoff, nearest raw fallback and zero fallback confidence defined in [`GTAO_REFERENCE_POLICY.md`](GTAO_REFERENCE_POLICY.md).

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

The normal repository gate additionally runs `tools/validate_sm601_gtao_readback.js` and `tools/validate_sm601_gtao_adoption_contract.py`. They retain bounded-readback/lifecycle tests, guard measured shader identity and enforce the offline production dependency closure. `webgpu-gtao-adoption-smoke.html` compares production and frozen measured variants with exact texture/counter readbacks. The bounded adoption browser runner requests software WebGPU by default and collects no performance samples:

```text
python tools/validate_sm601_gtao_adoption_browser.py --timeout 180 --report artifacts/sm601-gtao-adoption-browser.json
```

The optional `--hardware --native` mode executes full-HD canonical production-versus-frozen snapshots. It is a correctness probe and does not replace the three-run physical timing campaign or human visual review. The existing SM-601 workflow runs stabilization and adoption probes sequentially in one job.

## GTX 1650 SUPER performance acceptance

The remaining issue-level gate is physical target evidence at native 1920×1080 / DPR 1, Medium GTAO, using genuine WebGPU timestamp queries. The report must contain at least three runs, each with at least 300 warm-up frames and 600 measured frames, and must record mean/p50/p95 GTAO GPU cost plus moving-scene stability, history-rejection and no-double-darkening sign-off.

Validate a captured report with:

```text
python tools/validate_sm601_target_report.py <report.json>
```

Collect new source-specific acceptance evidence with a unique output root:

```text
python tools/run_webgpu_target_campaign.py --phase sm601 --sessions 3 --warmup 300 --samples 600 --timeout 1200 --out <new-campaign-root>
```

Retain `queueSpanGpuMs` alongside `commandGpuMs` only where the report proves complete explicit-submission coverage. CPU callback/encoding, known host waits and timestamp/diagnostic mapping latency remain separate host diagnostics. Historical `gpuMs` records remain queue spans; never subtract host time to manufacture command execution time. Prior source datasets remain separate from the production adoption campaign.

The roadmap's roughly **0.7–1.2 ms** Medium cost is a planning guardrail, not an assumed result. The validator reports whether the measured run means lie within that guardrail but does not convert an over-budget result into a fake pass. A materially over-budget result requires architecture investigation before reducing scene fidelity indiscriminately.

The final production-source report now exists at `b1e87b0a8e07ac2ca3e240dbec8f2a708eaa5275`: three fresh Chrome runs each retain 600 samples after 300 warm-up frames, with queue means 1.087873/1.089021/1.087123 ms and worst p95 1.288608 ms. Native production/frozen output and counter equality, moving stability, discontinuity rejection and strongest-occluder composition checks pass. The unchanged working mean guardrail is met. The issue-level correctness baseline was already accepted in PR #102; exact output-preserving adoption retains that behavior rather than claiming new human visual sign-off. Broader default-renderer visual release gates remain separate.

PR #110 contains the production adoption and retained evidence. SM-601 remains open and SM-602 blocked until required final-head CI/review passes and the merge is verified on main. See `SM601_MEASURED_ADOPTION.md` for the source-separated acceptance and explicit-command diagnostics; do not pool those distributions.
