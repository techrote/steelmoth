# SM-501 post-Dark-Bloom-repair physical revalidation

Status: **FAIL — keep issue #31 and PR #92 open and unmerged.**

The 2026-09-20 source-matched revalidation used clean tracked source
`44e7947e0b6e402f7f8c36f081e70420eacd691a` on the physical NVIDIA GeForce
GTX 1650 SUPER 4 GB (driver 616.92), Windows 11, Chrome 153.0.8010.48 and
Firefox 156.0. The browser acquired a non-fallback NVIDIA/Turing WebGPU adapter
and negotiated genuine `timestamp-query`. Measurements used native 1920x1080,
DPR 1, Medium, GTAO disabled, the production reference G-buffer layout, 300
warm-up frames and 600 retained frames.

The fresh output parent is dated 2026-09-20. The campaign runner retains its
historical `sm501-2026-09-19` child name; this summary records the actual run
date to avoid misidentifying the new evidence as the preserved failed campaign.

## Physical correctness

- The SM-305 physical Chrome smoke passed all 50 canonical assertions using a
  fresh Selenium profile and the repository's unchanged `validate()` function.
  It reports `tierSource = gpu-sm304-active-tiles`, exact bounded GPU/CPU
  readback parity within tolerance, hard-core preservation, a subordinate
  residual, and zero depth-barrier leakage.
- The SM-306 physical Chrome temporal smoke passed all 36 canonical assertions,
  including slow-light stabilization, exact hard-core exclusion, discontinuity
  rejection, invalidation/rebuild and zero stale silhouettes.
- All 24 Chrome acceptance pages and the Firefox page reported a non-fallback
  adapter, negotiated `timestamp-query`, DPR 1, GTAO disabled, a presented
  canvas and the required retained sample count.
- Representative and dense-static workload metadata is exactly unchanged from
  the failed campaign: the same visible/static/dynamic instance, light,
  occluder, cluster, DSO tile/pixel and secondary-effect extent counts were
  retained. The measured improvement is not explained by missing content,
  reduced quality or a CPU/software fallback.

The repository's standalone CDP wrapper did not exit on this Windows host after
the SM-305 page had completed successfully. The retained SM-305/306 reports
therefore identify `selenium-fresh-profile` as their execution harness and name
the unchanged canonical validation function that accepted the page payload.

## Bounded two-scene checkpoint

These are pass-localization queue spans, not shader-only execution times or
SM-501 acceptance totals. Per SM-500, they include timestamp-boundary overhead
and host preparation/queue-idle gaps; pass sums must not be substituted for the
whole-renderer acceptance metric.

| Scene / measurement | Failed campaign mean / p95 ms | Repaired mean / p95 ms | Mean speedup |
|---|---:|---:|---:|
| representative Dark Bloom | 157.646 / 183.724 | 1.861 / 2.514 | 84.7x |
| representative Dark Bloom Temporal | 10.646 / 14.971 | 0.460 / 0.657 | 23.2x |
| representative instrumented-pass sum | 202.247 / 215.247 | 11.028 / 12.342 | 18.3x |
| dense-static Dark Bloom | 612.783 / 678.679 | 2.114 / 2.797 | 289.9x |
| dense-static Dark Bloom Temporal | 10.671 / 19.709 | 0.626 / 0.983 | 17.1x |
| dense-static instrumented-pass sum | 658.281 / 718.052 | 14.775 / 15.947 | 44.6x |

The original scene-density pathology is removed and correctness holds, which
justified proceeding to the full campaign.

## Full Chrome acceptance result

The full total-only run used three fresh Chrome processes. Each row pools 1,800
retained timestamp-query samples without deleting outliers.

| Scene | Failed mean / p95 ms | Repaired mean / p95 ms | 12.0 / 14.5 ms gate |
|---|---:|---:|---|
| empty | 7.324 / 8.970 | 3.439 / 4.175 | pass |
| representative | 188.580 / 220.892 | 7.668 / 9.122 | pass |
| dense-static | 652.872 / 738.032 | 11.411 / 13.949 | pass |
| dynamic-robot | 359.462 / 405.217 | 9.399 / 11.347 | pass |
| foliage | 105.248 / 124.437 | 6.589 / 7.818 | pass |
| bin-cluster | 9.946 / 12.284 | 57.983 / 91.130 | **fail** |
| diagnostic-light | 331.224 / 376.453 | 68.680 / 96.229 | **fail** |
| mixed | 485.447 / 534.004 | 10.280 / 12.504 | pass |

The bin-cluster failure repeats in all three fresh sessions (mean/p95
58.362/73.862, 55.930/112.869 and 59.655/82.239 ms). Diagnostic-light also
fails in all three (71.263/116.834, 60.905/77.518 and 73.874/97.561 ms).
The strict validator therefore fails four requirements: mean and p95 for each
of those two scenes. All six other scenes pass both thresholds.

The failing total timestamp queue spans closely track separately retained CPU
encoding means: bin-cluster is 57.983 ms versus 58.151 ms and diagnostic-light
is 68.680 ms versus 68.720 ms. This supports a remaining host-preparation or
queue-idle dominated path for those scene shapes, but the total-only run cannot
identify the responsible production pass. CPU time is not subtracted and no
shader-only GPU number is inferred. The next bounded investigation should
localize only bin-cluster and diagnostic-light with pass instrumentation before
choosing a repair; no threshold, content or quality reduction is justified.

## Firefox spot-check

Firefox 156.0 completed 600 retained representative samples on the same
non-fallback adapter with `timestamp-query`: 7.643 ms mean, 7.519 ms median,
9.205 ms p95, 10.152 ms p99 and 13.902 ms maximum. This is a material repair
from the failed campaign's 420.073 ms mean / 454.046 ms p95, and the physical
correctness/performance spot-check passes. It does not override the two failing
Chrome scenes.

## Evidence and disposition

- `sm501-2026-09-19/target-report.json` contains all Chrome/Firefox raw sample
  arrays, per-run distributions, adapter/browser/environment metadata, CPU
  phases, workload/memory records and SM-003 WebGL2 comparisons.
- `sm501-2026-09-19/raw/` contains JSON and screenshots for all 24 Chrome scene
  runs and the Firefox representative run.
- `sm501-2026-09-19/localization/` contains the separate two-scene pass-level
  report, raw samples and screenshots.
- `correctness/` contains the retained SM-305 and SM-306 physical browser
  reports and screenshots.
- `validator.log`, `localization-run.log` and `full-acceptance-run.log` preserve
  the strict disposition and command transcripts.

This campaign does not satisfy SM-501. PR #92 must not merge and issue #31 must
not close. No SM-601, SM-800, backend-promotion or unrelated cleanup work is
included.
