# SM-601 measured readback/counter adoption

**Final disposition — accepted, 2026-10-03:** PR #110 merged to `main` as `826a378581eb678c3f704c4e827c461563d938bc` after a criterion-by-criterion review of #36. Existing retained GTX 1650 SUPER evidence satisfies the moving-scene stability, target-cost, explicit-tier and temporal-rejection criteria; no fresh GPU run was required. #36 is ready for closure and SM-602 is dependency-ready. Earlier checkpoint/recovery instructions are historical and their temporary "leave unmerged" wording no longer controls this completed review.

The retained production measurement is **1.088006 ms queue-span mean / 1.288608 ms worst run p95**, at `b1e87b0a8e07ac2ca3e240dbec8f2a708eaa5275` (approximately 1088/1289 microseconds, not milliseconds). It meets the unchanged working mean guardrail. The separate arithmetic/cache controls do **not** justify adopting any arithmetic candidate; this conclusion does not invalidate or pool the separate production readback/counter measurements. The readback/counter proposal is now adopted by PR #110. CI and the mean guardrail alone did not establish acceptance: the final review also verified measured-source equivalence plus the issue's stability, tier and rejection criteria.

## Requirement and adopted production path

The authoritative target is the local NVIDIA GeForce GTX 1650 SUPER, 4 GB, at native 1920×1080 attachments, DPR 1 and Medium GTAO with genuine timestamp queries. The approximately 0.7–1.2 ms Medium value remains a **working planning guardrail**. It has not been weakened or reinterpreted as a measured result.

**Adopted by PR #110:** integrate the measured deferred diagnostic scheduling plus workgroup counter aggregation as an explicit production adapter. Its compatibility defaults remain blocking/baseline and the SM-601 acceptance harness selects deferred/aggregated explicitly. The adopted combination has retained production-source equivalence and the unchanged acceptance campaign detailed below. Research PRs #104/#105/#106 remain unmerged.

Medium remains 6 directions × 4 steps, radius 12, intensity 1.0 and temporal weight 0.55. Higher/Low tiers, object/depth/normal/room/device/backend history rejection, delta/neighborhood constraints, minimum-resource portability and strongest-occluder Material-AO/GTAO composition remain unchanged. The raw/reconstruction shaders retain the authoritative strict binary32 `0.000001` support cutoff, nearest raw fallback and zero fallback confidence; see [`GTAO_REFERENCE_POLICY.md`](GTAO_REFERENCE_POLICY.md).

## Historical and hardened baseline boundaries

PR #102's retained physical source `5d1258032b27af270a925e29379e01bc84acf1d7` measured run queue-span means approximately 2.820/2.903/2.915 ms and worst p95 3.816 ms. Those historical records remain intact. They enclose awaited temporal diagnostic delivery and cannot be relabeled as shader execution time.

The repaired SM-500 native diagnostic at `0c1c707de426fce89ac5f21386ca99edbe8281be` retained 1,800 frames across three fresh Chrome processes after 300 warm-up frames per process. Its pooled queue-span mean/p95 was **3.067721/3.958624 ms**, while complete two-submission command coverage measured **1.100543/1.398208 ms**. Direct raw/reconstruction/temporal compute means were **0.214253/0.185178/0.698088 ms**. Known diagnostic-map host wait averaged **3.592167 ms**, callback wall time **3.802611 ms**, and SM-500 timestamp-map latency **0.607111 ms**. These host latencies overlap work and are never subtracted from GPU timestamps.

This localizes the historical cost to a mixture: temporal GPU work is the largest actual compute component, and awaited diagnostic delivery adds substantial queue idle/latency. The raw horizon and reconstruction are smaller on this canonical scene. The diagnostic includes additional marker/copy observation work, so it is a separate distribution from both historical acceptance and the four-way comparison. [`SM500_TIMING_BOUNDARY.md`](SM500_TIMING_BOUNDARY.md) records alignment repair and exact boundaries.

## Independent study dispositions

| Candidate | Source and measured boundary | Disposition |
| --- | --- | --- |
| #105 deferred readback | Frozen `dad8c46d371522c699ecbeeb1770cfc2e6a29443`; complete cache-only overlay `d943827f87598ef4990437b333d3d3e62db1b4ad` preserved GPU uploads/shaders, with 1.129876 ms mean queue-span reduction on isolated synthetic workload | Independent scheduling value; native/combined comparison required. Frozen run timed out below 600 retained samples and remains excluded from complete timing distributions. |
| #104 counter aggregation | Frozen `ad06d9f128f7d2494e467da8d6b47de7151e606a`; startup-only overlay `ae0bd3fd07ebee1b469395c9822823c76d202b2f` retained isolated temporal compute-pass timings | 0.021961 ms / 2.987577% mean kernel improvement. This is measured value, not inferred from the atomic-update count. |
| #106 shared raw/reconstruction candidates | Frozen `1813085f158a24d52365b0ee5011dc32c0251c90` | Blocked before timing by a neutral fixture assertion: all variants and baseline match at one ULP below exact 1. No dense/sparse/empty performance distribution exists at this frozen source; no arithmetic/cache candidate adopted. This is distinct from the repaired #107 reference cutoff mismatch. |

The later, separately identified arithmetic diagnostic source `2b8d01582fa6ccd954b4437f175658f1d337709b` completed dense/sparse/empty/plane controls: three fresh processes per control, 300 warm-up + 600 retained samples per variant, 28,800 variant timing samples and 1,464 correctness configurations. Checkpoint [`94278db`](https://github.com/techrote/steelmoth/blob/94278db13087ae75d43c104d76dc33e6e8b63929/docs/PHYSICAL_CAMPAIGN_PAUSE_2026-10-03.md) retains the table, raw reports and exact candidate comparisons. **Final measured conclusion: adopt no arithmetic/cache candidate.** Dense/plane reconstruction gains regress sparse/empty workloads; raw shared is slower on dense/sparse. Frozen #106's exact-neutral failure remains preserved; completed controls belong to the new diagnostic source, not to frozen #106 or production acceptance.

These source-separated study reports have their own synthetic-workload and metadata limits. Their samples are not pooled with native evidence or production acceptance. Failed startup/query-readback attempts and incomplete original runs remain retained and excluded from performance claims.

## Native combination measurement

Measured source: `fa388aa9567dbacd2598221c644c22946834221d`, clean tracked state. Raw report retained locally as `artifacts/physical-campaign-2026-10-02/native-fa388aa-comparison/comparison.json`; its source/file hashes and raw timestamps remain part of the campaign evidence. Full method: [`SM601_NATIVE_ADOPTION_COMPARISON.md`](SM601_NATIVE_ADOPTION_COMPARISON.md).

Environment: Windows 11 build 26200, sole NVIDIA GeForce GTX 1650 SUPER, driver 616.92, Chrome 154.0.8037.92, nonfallback NVIDIA/Turing adapter with negotiated `timestamp-query`. Fresh process IDs were 13404/10300/22020. Attachments were 1920×1080, DPR 1; desktop size 2560×1440 is metadata and is not the render resolution.

Three independent fresh Chrome processes each warmed 300 frames per variant and retained 600 per variant. The canonical moving `dynamic-robot` actor/light scene and unmodified Medium settings were used. Four variants were rotated every frame, with process offsets 0/1/2. Each row below pools 1,800 samples of one variant at this one source, without discarding outliers.

| Variant | Queue-span mean (ms) | Command-span mean (ms) | Temporal compute mean (ms) | Callback wall mean (ms) | Diagnostic map latency mean (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline counters + blocking | 2.848099 | 1.088615 | 0.685369 | 4.569056 | 4.395556 |
| Aggregated counters + blocking | 3.233311 | 1.081225 | 0.685938 | 3.625889 | 3.409056 |
| Baseline counters + deferred | 1.273551 | 1.090182 | 0.694905 | 0.201056 | 2.495111 |
| Aggregated counters + deferred | 1.114569 | 1.078616 | 0.678360 | 0.161444 | 4.431222 |

Combined queue-span run means were **1.130003/1.117348/1.096358 ms**. Blocking aggregation alone did not improve queue span. The combination was measured explicitly and improved the deferred queue span while preserving exact recorded output/counter equality; most of the total baseline-to-combination gain reflects scheduling of diagnostic delivery. The near-unchanged command spans do not support a multi-millisecond shader speedup claim. The asynchronous diagnostic map latency can remain long while ceasing to be a callback host wait.

Queue spans enclose callback marker intervals. Command spans sum two complete explicit marker/command/marker submissions and include the 32-byte temporal diagnostic copy. Direct timestamps enclose raw, reconstruction and temporal compute separately. CPU encoding stops at producer submission entry and excludes awaited maps. No host latency is subtracted from any GPU timestamp.

All four full-HD temporal textures and eight GPU counter words were byte/exact equal at uninitialized, moving, room-discontinuity and explicit-history-reset snapshots in every process. API/error lists were empty. Lossless comparison drains run after all variants, outside each measured callback; bounded-slot saturation is separate #105 fault-injection evidence. Shared queue scheduling and observer queries/maps can affect later variants despite rotated order. This is diagnostic decision evidence, not freely pipelined game throughput or human visual acceptance.

Reproduce using a new output path:

```text
python tools/run_sm601_adoption_comparison.py --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --runs 3 --warmup 300 --samples 600 --timeout 1800 --report <new-native-comparison.json>
```

## Production verification and final acceptance

`engine/webgpu_gtao_readback.js` contains the production implementation. Frozen research generators/adapters remain unchanged under `tools/experiments/` for comparison only, and production code does not import them. Three 32-byte diagnostic slots are bounded; pending, skipped, stale, failed and evicted delivery is explicit. Diagnostic delivery cannot determine visible output or gameplay-authoritative state. Offline cache revision includes the production base/stabilization/readback dependency closure without changing `Auto` backend policy.

Normal verification includes readback CPU/lifecycle/counter tests and the adoption contract:

```text
python tools/run_checks.py --report artifacts/core-checks.json
python tools/validate_clean_package.py --report artifacts/clean-package.json
python tools/validate_sm601_gtao_adoption_browser.py --timeout 180 --report artifacts/sm601-gtao-adoption-browser.json
```

The browser correctness runner uses software WebGPU by default and records no performance samples. `--hardware --native` supplies canonical full-HD production-versus-frozen output/counter snapshots on physical WebGPU. Neither mode substitutes for the final production timing or visual campaign.

The unchanged three-process GTX campaign completed at clean source `b1e87b0a8e07ac2ca3e240dbec8f2a708eaa5275`. Reproduce it with a new output root and validate its report:

```text
python tools/run_webgpu_target_campaign.py --phase sm601 --sessions 3 --warmup 300 --samples 600 --timeout 1200 --out <new-production-campaign-root>
python tools/validate_sm601_target_report.py <new-production-report.json>
```

Final evidence must retain exact production SHA, browser/driver/GPU identity, fresh processes, raw samples, unscaled Medium attachments and honest queue/command coverage. Moving actor/light stability, disocclusion/history rejection, room/backend/device discontinuities and no Material-AO/GTAO double-darkening remain the actual issue-level correctness requirements. The final review confirmed these conditions from retained evidence; #36 does not specify a separate human approver, and exact output equivalence preserves the accepted PR #102 visual/correctness baseline. SM-602 is dependency-ready once #36 is closed.

## Completed production-source verification

At `b1e87b0…`, the primary queue-only run means were 1.087873/1.089021/1.087123 ms, with mean-of-means **1.088006 ms** and worst p95 **1.288608 ms**. All three used 300 warm-up plus 600 retained frames, unchanged Medium and the authoritative physical adapter. The working guardrail is unchanged and met. A separate command-coverage diagnostic measures **1.069927 ms mean /1.269472 ms p95**, with two submissions per frame; its queue result is **1.102807/1.298432 ms** and is not pooled with primary acceptance.

Four target full-HD production/frozen snapshots and 63 small target fixtures preserve all four temporal textures and eight counter words exactly. Existing moving numeric stability, rejection and no-double-darkening checks pass. Source/regression and package gates passed 86/86 and18/18 before the Linux-only browser-discovery correction; that correction does not change renderer code, measurement loops or explicitly selected Windows browser settings. Measured runtime identity remains `b1e87b0…`.

Issue #36 and its accepted PR #102 disposition do not introduce an explicit new human approver for this performance-only patch. Exact retained pixel behavior and fresh target checks preserve the accepted visual correctness baseline. The paused checkpoint's conservative wording about additional visual review is historical interpretation, not a new product requirement or a claim that a person viewed the captures. Required CI and verified merge were satisfied by PR #110 at `826a378581eb678c3f704c4e827c461563d938bc`; default-renderer promotion keeps its separate visual gates.
