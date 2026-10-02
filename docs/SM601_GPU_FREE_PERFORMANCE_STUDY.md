# SM-601 GPU-free performance study — 2026-10-02

**Disposition: test-only candidate prepared; no production change, performance acceptance, merge recommendation, or downstream unblock.** References issue #36 and the physical evidence in PR #102. SM-501 / PR #92 is untouched.

## Source and evidence boundary

The study is based on main `73b6f1222b47219966130a3b135067ef74d65e39`. The temporal module has Git blob `8df297355612a7955baa2ce945e54fac12d8ee0d`, identical to that module at measured source `5d1258032b27af270a925e29379e01bc84acf1d7`. The local source copy was verified against that blob before testing.

The existing [physical report](https://github.com/techrote/steelmoth/blob/39bb68ec652640fa83fa04c76c332df0abbbd781/benchmarks/webgpu-gtx1650s/sm601-2026-09-19/SUMMARY.md) records means 2.8203 / 2.9034 / 2.9148 ms and p95 values 3.5512 / 3.8157 / 3.6567 ms. These are retained prior measurements, **not new results or an independent recomputation of the 1,800 raw samples**. The 0.7–1.2 ms working guardrail remains unchanged.

The [measured benchmark source](https://github.com/techrote/steelmoth/blob/5d1258032b27af270a925e29379e01bc84acf1d7/webgpu-target-benchmark.html) puts raw GTAO, reconstruction, and temporal update inside one `gtao` frame-graph callback. Consequently the reported number does not identify one shader as the bottleneck. `WebGPUGTAOTemporal.update()` also maps the stats readback every frame even when `wait:false`: that option suppresses `onSubmittedWorkDone()`, not the unconditional `mapAsync()`. Localization must distinguish compute-pass execution, host preparation, readback synchronization, and the retained acceptance queue span. Never subtract CPU time to manufacture a GPU result.

## Findings and structural cost inventory

| Component | Verified source behavior | Implication, not a measured attribution |
| --- | --- | --- |
| Raw GTAO | Half-resolution `rgba16float`, Medium six directions × four depth steps; early-out on disabled/empty source. | At 1080p there are 518,400 raw invocations and at most 12,441,600 inner depth samples. Actual occupied work and GPU cost remain unmeasured here. |
| Reconstruction | Full-resolution `r32float`; four half-resolution candidates with depth, normal and spatial weighting. | Do not describe this as a nine-tap upscale. The nine-value neighborhood belongs to temporal clamping. |
| Temporal diagnostics | Every accepted pixel increments one storage atomic; every rejected pixel increments two. | At 1080p, 2,073,600–4,147,200 updates contend on six global counter locations. This is a concrete optimization candidate, not proof of the dominant cost. |
| Temporal history | Two sets of `r32float`, `rg32float`, `r32uint`, `rgba16float`. | Descriptor payload is 48 bytes/pixel: 99,532,800 bytes (94.921875 MiB) at 1080p, excluding allocator overhead and other renderer resources. Not a browser VRAM measurement. |
| Readback | A 32-byte stats copy and awaited map on every update. | Tiny byte volume can still impose synchronization. A readback-ring redesign changes diagnostic freshness/API semantics and is deliberately not bundled with the counter candidate. |

Raw plus reconstructed GTAO texture payload is another 12,441,600 bytes at 1080p. Texture-cache reuse, compressed/internal allocations, memory bandwidth, driver scheduling and actual pass times cannot be deduced from these descriptor/operation counts.

## Prepared candidate: exact diagnostic aggregation

`tools/sm601_gtao_counter_study.js` creates a **test-only** WGSL variant from the production export. It fails closed unless the complete input WGSL SHA-256 is:

`7241992d96d014e996eb826779f2f9f6b4c3360979120d7fee780502b07f00cc`

Candidate WGSL SHA-256:

`11024a2f13f20abda1dee7cdc1a6d6703ecfc1982929ed51ccaa7b071579acf7`

Each 8×8 workgroup accumulates the same six integer counters in 24 bytes of workgroup memory, then flushes each nonzero counter once. All 64 lanes initialize/participate in the barriers, including padded edge lanes; only active pixels access textures. WGSL requires barriers in uniform control flow: see the [WGSL memory/uniformity specification](https://www.w3.org/TR/WGSL/).

All texture bindings, formats, visibility equations, rejection precedence, neighborhood/delta clamps, history weight, object IDs, normal RGB and rejection-mask alpha are preserved. The stats buffer remains eight u32 words including the two untouched padding words. The candidate still writes exactly four storage textures; it does not repeat the prior five-storage-texture portability failure.

For homogeneous 1920×1080 inputs, global storage updates change from 2,073,600 to 32,400 (all accepted), or 4,147,200 to 64,800 (all globally rejected). **64× fewer global updates is not a 64× shader/frame speedup.** Workgroup atomics, initialization, two barriers, and flushing add work. Mixed groups flush more counter categories. Only measurements can determine the net effect.

The candidate is not imported by `engine/`, the game, normal render entrypoints, or the existing acceptance harness. Nothing selects it automatically. Production and SM-501 stay unchanged.

## Tests and reproducible commands

```text
node tools/validate_sm601_gtao_counter_study.js --report artifacts/sm601-counter-cpu.json
python tools/run_sm601_gtao_counter_study.py --report artifacts/sm601-counter-browser.json
```

The Node suite passed locally: 56 analytic/reference fixture cases, 512 deterministic randomized counter cases, full-HD count checks, source/ABI/pixel-body preservation, modified-source refusal, and invalid extent/reason/budget rejection. Python admission checks rejected five invalid command configurations. JS syntax and Python compilation passed.

The standalone `sm601-gtao-counter-study.html` probe compiles both real WGSL pipelines and compares **all four output textures byte-for-byte and all eight diagnostic words exactly**, twice on reused resources. Cases cover 1×1, 1×9, 7×9, 8×8, 9×17, 65×33 and 101×63; accepted, depth, object, normal, global, mixed, precedence and disabled cases. Output visibility is also checked against the existing independent CPU reference within 2e-6; this tolerance does **not** relax the strict A/B byte comparison. Canonical depth/object payload, normal RGB and rejection alpha have independent checks.

The Python runner defaults to a requested software/fallback adapter, uses a fresh temporary browser profile, records source hashes and adapter/browser identity, fails on unavailable WebGPU/compilation/errors, and rejects software timing. It uses the existing `websocket-client` CI dependency. No physical GPU is accessed in the default mode.

**Local execution limit:** Chromium navigation was refused with `net::ERR_BLOCKED_BY_ADMINISTRATOR` before the test page executed. No policy bypass was attempted. Thus local browser/WGSL validation is **unavailable, not passed**. A bounded GitHub Actions software-WebGPU job is provided; its actual final-head result is reported by the PR checks, not assumed by this document. No full repository, visual, target-GPU or performance success is claimed from the Node tests.

## Physical handoff and stop conditions

After shader correctness is actually green, the optional isolated hardware probe is ready:

```text
python tools/run_sm601_gtao_counter_study.py --hardware --benchmark --runs 3 --width 1920 --height 1080 --warmup 300 --samples 600 --timeout 900 --report artifacts/sm601-counter-hardware.json
```

On Windows, add `--browser` with the installed Chrome executable path. Verify the recorded adapter and local driver identify the physical GTX 1650 SUPER; non-fallback alone is not target identity. This runner does not claim to certify the target model.

The probe alternates baseline/candidate order, retains every positive timestamp sample, and fails on invalid samples. Its timestamp writes enclose the isolated temporal compute passes, not the raw/reconstruction stages or host/readback gaps. It deliberately does **not** produce an SM-601 acceptance report. The static nontrivial mixed fixture also does not substitute for moving gameplay, disocclusion or visual sign-off.

If the isolated candidate is correct and faster, prepare one separately reviewed production adoption patch, then rerun the unchanged complete SM-601 moving-scene acceptance methodology on the exact candidate source. Measure raw/reconstruction/temporal execution and host/readback costs separately for localization, while retaining the original total acceptance boundary. If it is not faster, retain the negative result and do not adopt it.

Do not change quality/sample counts, history validity, visibility composition, formats, acceptance thresholds, or default enablement to obtain a pass. Do not close #36, unblock SM-602, merge PR #102 as accepted, or change PR #92 on the strength of this study. Further candidates (asynchronous diagnostic readback, pass fusion, packing) require their own measured justification and contract review rather than an unmeasured bundle.
