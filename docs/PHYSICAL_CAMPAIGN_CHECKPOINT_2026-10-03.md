# GTX 1650 SUPER campaign checkpoint — 2026-10-03

**Status: stopped at the user's request after review and progress recording.**
No campaign benchmark is running; no follow-up automation was created.
Production SM-601 code and physical
evidence are retained on `codex/sm601-measured-adoption`; that branch has not been
merged and its production PR/final-head hosted CI have not yet been started.
Issue #36 remains open and SM-602 remains blocked.

## Accepted work on main

- PR #92 merged at `4da304fd3060ce783f7c58f2a97867cd1d655a25`; #31 closed
  after verified merge and all 23 checks passed. Exact `672c709…` and reconciled
  `2e4d490…` independently passed eight Chrome scenes × three processes plus
  Firefox. Reconciled worst scene mean/p95 were 6.411803/8.190048 ms.
- PR #109 merged at `d642b4b9973ae629e28bf5f15ac3c6659e1eafcb`; all nine checks
  passed. It repairs SM-500's unaligned command-query resolves and retains the
  physical baseline/decomposition. A merge-side premature closure of #36 was
  immediately reversed. Current main is `d642b4b…`.

## Reviewed SM-601 implementation

Worktree: `C:/steelmoth/.campaign-worktrees/sm601-adoption`.
Measured production source: `b1e87b0a8e07ac2ca3e240dbec8f2a708eaa5275`.
Native comparison source: `fa388aa9567dbacd2598221c644c22946834221d`.

The production adapter explicitly selects deferred/bounded statistics delivery
and the measured aggregated counter shader for SM-601. Compatibility defaults
remain blocking/baseline. Raw/reconstruction and original temporal shaders stay
unchanged; Medium remains 6 directions × 4 steps, radius 12, intensity 1.0 and
history weight 0.55. History rejection, four-storage-texture portability,
strongest-occluder AO composition, native core resolution and backend policy are
preserved. No research PR was merged wholesale.

The independent native four-way audit checked 7,200 rows, balanced variant order,
exact four-texture/eight-word snapshots, per-frame counters, source identities and
timestamp arithmetic. Same-source pooled queue/command means (ms):

| Variant | Queue | Command |
| --- | ---: | ---: |
| Baseline blocking | 2.848099 | 1.088615 |
| Counter blocking | 3.233311 | 1.081225 |
| Baseline deferred | 1.273551 | 1.090182 |
| Counter deferred | 1.114569 | 1.078616 |

Counter-only queue performance regressed in this native comparison. The measured
combination was selected because it consistently improved the deferred path;
the large total queue improvement must not be described as shader speedup.
Shared scheduling/observer effects and outside-callback diagnostic drains are
documented. No CPU or host latency was subtracted from GPU timestamps.

## Final-source physical evidence

GTX 1650 SUPER 4 GB, driver 616.92, Windows 11 build 26200, Chrome
154.0.8037.92, nonfallback NVIDIA/Turing, genuine timestamp queries. Render
attachments are unscaled 1920×1080/DPR 1; desktop 2560×1440 is recorded separately.

Unchanged queue-only acceptance: three fresh Chrome processes, each with 300
warm-up + 600 retained frames, all at exact production source `b1e87b0…`:

| Run | Mean ms | p50 ms | p95 ms |
| --- | ---: | ---: | ---: |
| 1 | 1.087873 | 1.056064 | 1.288608 |
| 2 | 1.089021 | 1.056064 | 1.286144 |
| 3 | 1.087123 | 1.056768 | 1.286144 |

Mean of run means **1.088006 ms**; worst p95 **1.288608 ms**. The unchanged
validator reports `withinWorkingMeanGuardrail: true`. Moving-scene numeric
stability, history rejection and no-double-darkening checks pass. Every retained
diagnostic row has original frame/epoch attribution; no lost/skipped/failed
statistics are reported in this lossless acceptance collection. The acceptance
timer remains queue-only with zero explicit command coverage.

A separate three-process/1,800-frame production diagnostic at the same source
measures queue **1.102807/1.298432 ms mean/p95** and explicit command
**1.069927/1.269472 ms**. Direct horizon/reconstruction/temporal means are
**0.207850/0.186537/0.672105 ms**. Keep that observer-instrumented distribution
separate from acceptance.

Production-versus-frozen equivalence passes on the physical target: four native
full-HD snapshots and 63 small/rejection/lifecycle fixtures, with exact four
temporal textures and eight counter words and no GPU/JS errors. Source/regression
gate passes **86/86**, CPU/API suite **37 checks**, clean-package gate **18/18**.
These are verified numeric/API/equivalence results; no new human visual sign-off
is claimed.

Final independent review found no must-fix production defect and passed 5,570
retained-evidence checks. It verified 58 measured file identities against the
immutable `b1e87b0…` Git source, all raw sample arithmetic/command sums, attribution,
quality and error states. Primary `freshProcessForScene: false` is legacy metadata:
the runner creates/quits a fresh Chrome session per run, with exactly one SM-601
scene per session. Primary reports do not export GPU API error lists or command
timestamps; those claims belong to the separate correctness/decomposition reports.

## Independent study dispositions and retained failures

- #105: exact `dad8c46…` hit its 1800-second limit with 329 samples/variant;
  correctness/saturation passed. Fixture-only overlay `d943827…` proved unchanged
  upload bytes and completed three runs: queue 4.037118 → 2.907242 ms. The overlay
  changes inter-iteration preparation and is not labeled exact-head timing.
- #104: exact `ad06d9f…` completed one valid run, then browser startup port-file
  access failed. Startup-only overlay `ae0bd3f…` completed three runs: temporal
  kernel 0.735079 → 0.713118 ms. No source-head distributions are mixed.
- #106: timing is blocked by its unchanged strict neutral assertion. Witness
  `5425c9b…` records a 3×5 plane pixel (0,1) at `0.9999999403953552` /
  `0x3f7fffff`, versus required `1.0` / `0x3f800000`. All four variants' three
  textures are byte-identical and validation is clean. Support weights exceed
  1.18, so the repaired fallback-threshold mismatch is unrelated. Dense/sparse/
  empty timing controls cannot pass the shared correctness gate; no arithmetic
  candidate or tolerance relaxation is adopted.

Historical #102 remains intact as queue-span evidence. Failed zero-query data,
partial startup runs and the original #105 timeout are retained and excluded from
completed acceptance distributions.

## Resume from this checkpoint

1. Review the recorded final-source evidence and remaining visual acceptance
   requirements without treating numeric tests as human sign-off.
2. Open a new production SM-601 adoption PR from this branch; run its required
   final-head hosted CI, repairing real defects without weakening tests.
3. Merge only after real acceptance criteria are satisfied and checks pass;
   verify main before closing #36. SM-602 stays blocked until then.
4. Keep #104/#105/#106 research branches unmerged. Resolve #106's neutral-control
   policy in separate documented work before attempting its physical controls.

If production renderer/harness settings change, rerun invalidated measurements.
Documentation/evidence-only checkpoints do not relabel the measured `b1e87b0…`
source. Raw samples, reports, original failures, audits and commands are in
[`campaign-2026-10-02-sm601`](../benchmarks/webgpu-gtx1650s/campaign-2026-10-02-sm601/).
