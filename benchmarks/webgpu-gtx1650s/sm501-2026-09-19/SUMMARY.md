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
- Pass-level localization is intentionally captured separately from this total-only acceptance run so SM-500 boundary overhead cannot contaminate the release totals.

No merge or issue closure is justified by this result.
