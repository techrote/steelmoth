# SM-601 measured readback/counter adoption

Status: production adoption candidate selected from physical evidence; full production-source SM-601 acceptance remains pending. Issue #36 stays open and SM-602 remains blocked until its real criteria are satisfied.

## Requirement and decision

The authoritative target is the local NVIDIA GeForce GTX 1650 SUPER, 4 GB, at native 1920×1080 attachments, DPR 1 and Medium GTAO with genuine timestamp queries. The approximately 0.7–1.2 ms Medium value remains a **working planning guardrail**. It has not been weakened or reinterpreted as a measured result.

**Decision:** integrate the measured deferred diagnostic scheduling plus workgroup counter aggregation as an explicit production adapter. Keep its compatibility defaults blocking/baseline and select deferred/aggregated explicitly in the SM-601 acceptance harness. The accepted combination needs fresh production-source equivalence and the unchanged acceptance campaign. Research PRs #104/#105/#106 are not merged wholesale.

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
| #106 shared raw/reconstruction candidates | Frozen `1813085f158a24d52365b0ee5011dc32c0251c90` | Blocked before timing by a neutral fixture assertion: all variants and baseline match at one ULP below exact 1. No dense/sparse/empty performance distribution exists; no arithmetic/cache candidate adopted. This is distinct from the repaired #107 reference cutoff mismatch. |

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

## Production verification and remaining acceptance

`engine/webgpu_gtao_readback.js` contains the production implementation. Frozen research generators/adapters remain unchanged under `tools/experiments/` for comparison only, and production code does not import them. Three 32-byte diagnostic slots are bounded; pending, skipped, stale, failed and evicted delivery is explicit. Diagnostic delivery cannot determine visible output or gameplay-authoritative state. Offline cache revision includes the production base/stabilization/readback dependency closure without changing `Auto` backend policy.

Normal verification includes readback CPU/lifecycle/counter tests and the adoption contract:

```text
python tools/run_checks.py --report artifacts/core-checks.json
python tools/validate_clean_package.py --report artifacts/clean-package.json
python tools/validate_sm601_gtao_adoption_browser.py --timeout 180 --report artifacts/sm601-gtao-adoption-browser.json
```

The browser correctness runner uses software WebGPU by default and records no performance samples. `--hardware --native` supplies canonical full-HD production-versus-frozen output/counter snapshots on physical WebGPU. Neither mode substitutes for the final production timing or visual campaign.

After final production source is committed, run the unchanged three-process GTX campaign with a new output root and validate its report:

```text
python tools/run_webgpu_target_campaign.py --phase sm601 --sessions 3 --warmup 300 --samples 600 --timeout 1200 --out <new-production-campaign-root>
python tools/validate_sm601_target_report.py <new-production-report.json>
```

Final evidence must retain exact production SHA, browser/driver/GPU identity, fresh processes, raw samples, unscaled Medium attachments and honest queue/command coverage. Moving actor/light, disocclusion/history rejection, room/backend/device discontinuities and no Material-AO/GTAO double-darkening require the actual issue criteria, including human review where specified. An over-guardrail result requires architectural attribution; a schema-valid report or automated numeric comparison alone does not close #36. SM-602 remains blocked until legitimate completion.
