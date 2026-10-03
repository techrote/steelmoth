# Physical campaign progress and requested rest — 2026-10-03

The user requested progress recording and rest again before final merge.
No campaign benchmark remains running and no follow-up automation was created.
Historical pre-cleanup status: PR #110 was open/unmerged at `b334e1210eb42d3f5dbb1b0dd065b19c21ae2bc5`,
with all **23 checks at that head successful** and merge state clean. #36 remains
open; SM-602 remains blocked until legitimate verified completion.

## Retained unmerged production proposal

Branch: `codex/sm601-measured-adoption`.
Worktree: `C:/steelmoth/.campaign-worktrees/sm601-adoption`.
Runtime/harness code is unchanged from measured source
`b1e87b0a8e07ac2ca3e240dbec8f2a708eaa5275`.
Three physical Chrome runs each retained 600 samples after 300 warm-up frames:
queue means 1.087873/1.089021/1.087123 ms, mean-of-means **1.088006 ms**,
worst p95 **1.288608 ms**. Separate command diagnostic mean/p95 is
**1.069927/1.269472 ms**. Source distributions remain separate; no CPU subtraction.

The resumed final source/regression gate passes **87/87**, including seven new
browser-discovery tests for Linux aliases and Windows fallback. The narrow
detector-only correction does not alter measured Windows commands, shader code,
sampling, source inputs or timer boundaries. Required hosted CI is now green.

Independent authority review found no mandatory new human approver in #36.
Its correctness baseline was accepted in the historical #102 disposition;
unchanged pixel math plus target full-HD texture/counter equality, 63 target
fixtures and existing moving/rejection/composition checks preserve that behavior.
No human viewing or broad artistic/default-renderer visual acceptance is claimed.
The checkpoint's earlier additional visual-review caveat was conservative
interpretation, not a new product requirement or lowered criterion.

PR #92/#31 is complete; timing repair #109 is merged on current main
`d642b4b9973ae629e28bf5f15ac3c6659e1eafcb`.

## Completed arithmetic controls, separately identified

Diagnostic source: `2b8d01582fa6ccd954b4437f175658f1d337709b` on
`codex/sm601-arithmetic-canonical-probe`, based on the preserved #106 witness.
The frozen #106 head and original exact-neutral failure remain unchanged.

WGSL permits finite error for ordinary f32 division. Current canonical GTAO
reference policy already uses `2e-6` for ordinary non-branch arithmetic while
keeping exact fallback and literal paths. The new diagnostic applies that bound
only to enabled, occupied-plane reconstructed visibility. Raw plane, empty,
disabled and nearest-raw fallback/confidence remain exact. All three candidate
textures still require byte equality to baseline, with strict finite/bounded and
positive timestamp guards. Production WGSL, parameters and timing loop are
unchanged; negative tests reject out-of-bound values and any candidate bit change.

GTX 1650 SUPER / driver 616.92 / Chrome 154.0.8037.92, nonfallback hardware,
1920x1080 tensors. Every dense/sparse/empty/plane control completed three fresh
processes, 300 warm-up + 600 samples per variant per process. All 122 correctness
configurations pass each process. Total: **28,800 variant timing samples**;
1,464 correctness configurations with unchanged exact candidate comparisons.

Pooled two-pass command means (ms), excluding temporal and host gaps:

| Control | Baseline | Raw shared | Reconstruction shared | Both |
| --- | ---: | ---: | ---: | ---: |
| Dense | 0.793629 | 0.801616 | 0.760240 | 0.769424 |
| Sparse | 0.678539 | 0.699561 | 0.701138 | 0.724775 |
| Empty | 0.368908 | 0.368519 | 0.382554 | 0.382113 |
| Plane | 0.718165 | 0.682309 | 0.672167 | 0.640176 |

**Decision: adopt no arithmetic/cache candidate.** Reconstruction helps dense
and plane controls but regresses sparse and empty workloads; raw shared is slower
in dense/sparse. This leaves the previously measured production readback/counter
combination unchanged and does not invalidate its final-source acceptance.

Raw per-pass samples, observed ordinary arithmetic values, reports and checksums
are retained in `benchmarks/webgpu-gtx1650s/campaign-2026-10-03-sm106/`.
The original #106 one-ULP failure is not relabeled passed. This is a new
diagnostic source following existing numerical authority, not a production
quality change, CI bypass, new GPU speedup assumption or research-PR merge.

## Recovery disposition — supersedes earlier resume steps

Recovery/cleanup only: PR #110 remains open/unmerged; #36 remains open and
SM-602 blocked. Its pre-cleanup head `b334e12` passed 23/23 checks. The production
result above is 1.088006 ms mean / 1.288608 ms worst p95 (about 1088/1289
microseconds, not milliseconds), and meets the unchanged working mean guardrail.
The completed arithmetic controls do not justify adopting any arithmetic/cache
candidate. Keep these separate conclusions and source distributions intact.
No merge, closure, new benchmark or SM-602 implementation is authorized here.

Current status authority is [`SM601_MEASURED_ADOPTION.md` on the PR #110 branch](https://github.com/techrote/steelmoth/blob/codex/sm601-measured-adoption/docs/SM601_MEASURED_ADOPTION.md).
This checkpoint retains the measured evidence; its earlier merge/resume guidance
is superseded by the user's cleanup-only instruction. Stop after cleanup.
