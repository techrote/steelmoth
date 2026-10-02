# SM-501 physical GTX 1650 SUPER acceptance result

Status: **FAIL — keep #31 and PR #92 open.**

The canonical Medium, 1920x1080, DPR 1, GTAO-off physical WebGPU campaign completed on 2026-09-19. All measurements used a non-fallback NVIDIA GeForce GTX 1650 SUPER adapter with genuine `timestamp-query`. Chrome was run in three fresh processes; every canonical scene received 300 warm-up frames and 600 retained whole-renderer GPU samples per process. Firefox received the required fresh-process representative spot-check with the same 300/600 sampling.

The measured source was `8d1fd080af0e31d36d35d8bec0d914370bbfe7f5`, with a clean tracked state. GTAO was implemented but disabled and explicitly excluded from the SM-501 initial-release renderer total.

## Chrome aggregate result

| Scene | GPU mean (ms) | GPU p95 (ms) | Retained samples | 12.0/14.5 ms gate |
|---|---:|---:|---:|---|
| empty | 7.324 | 8.970 | 1,800 | pass |
| representative | 188.580 | 220.892 | 1,800 | fail |
| dense-static | 652.872 | 738.032 | 1,800 | fail |
| dynamic-robot | 359.462 | 405.217 | 1,800 | fail |
| foliage | 105.248 | 124.437 | 1,800 | fail |
| bin-cluster | 9.946 | 12.284 | 1,800 | pass |
| diagnostic-light | 331.224 | 376.453 | 1,800 | fail |
| mixed | 485.447 | 534.004 | 1,800 | fail |

The canonical validator failed only the measured performance gates; the execution contract, source-state, adapter, timestamp-query, release-scope, GTAO-off, metadata, and sample-count requirements were satisfied.

## Firefox spot-check

Firefox 156.0 completed 600 retained representative GPU samples on the same non-fallback adapter with `timestamp-query`: mean 420.073 ms, median 417.407 ms, p95 454.046 ms, minimum 258.337 ms, maximum 686.579 ms.

## Evidence

- `target-report.json` is the canonical SM-501 report and contains the complete Chrome and Firefox sample arrays, adapter/browser/environment metadata, CPU/workload/memory data, and WebGL2 baseline comparison.
- `raw/` contains one JSON result and one screenshot for every physical browser run.
- `validator.log` records the canonical validator failure without weakening its thresholds.
- `localization/pass-report.json` and `localization/raw/` contain a separate 300-warm-up/600-retained pass breakdown for representative and dense-static at source `e5f854766a36f98cf30d880c492ec145ca3aae17`. Each of 13 production stages has 600 raw samples. These values are localization-only because the per-pass timestamp boundaries add submissions and must not be substituted for release totals.

The localization is decisive: Dark Bloom accounts for 157.650 ms mean / 183.718 ms p95 in representative and 612.779 ms / 678.683 ms in dense-static. The next-largest mean is Dark Bloom Temporal at 10.674 ms in dense-static and 10.647 ms in representative; the other individual stage means are below 8 ms. Bounded tuning should therefore begin in the Dark Bloom production path rather than weakening the SM-501 thresholds.

## Post-campaign pathology finding

Follow-up analysis of the retained raw measurements found that the apparent Dark Bloom explosion was dominated by CPU work inside the timed queue span, not by an unbounded Dark Bloom shader. In Chrome session 01, representative measured 197.154 ms mean renderer queue span alongside 197.056 ms mean CPU encoding; dense-static measured 672.760 ms alongside 672.732 ms. The original SM-305 `buildTierMap()` had an accidental nested scene-density traversal: it iterated each job's swept reduced-pixel region and called `tierAtPoint()`, which searched every job again for each candidate pixel.

The repair keeps the historical report unchanged as evidence and changes the production algorithm instead: Dark Bloom tier generation consumes SM-304's existing active-tile/job buffers on the GPU, followed by the existing bounded residual and depth-aware upsample passes. The CPU reference path remains available for deterministic parity testing. Existing physical acceptance is **not** retroactively converted into a pass; a source-matched target-hardware rerun is still required.

No merge or issue closure is justified by the original result alone.
