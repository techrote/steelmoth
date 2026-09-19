# SM-501 / SM-601 / SM-800 physical-GPU acceptance packet — 2026-09-19

Status: **execution coordination document**.

This packet prepares one coordinated physical GTX 1650 SUPER campaign for GitHub issues
#31 / SM-501, #36 / SM-601, and #42 / SM-800. It is deliberately subordinate to the
issue bodies and canonical subsystem documents. If this packet conflicts with a current
issue or canonical document, the latter wins.

Primary authorities:

- `AGENTS.md`
- `docs/DEPENDENCY_AND_CONCURRENCY.md`
- `docs/WEBGPU_VALIDATION_PLAN.md`
- `docs/WEBGPU_PERFORMANCE_INSTRUMENTATION_SM500.md`
- PR #92 `docs/WEBGPU_QUALITY_TIERS_SM501.md`
- `docs/WEBGPU_GTAO_SM601.md`
- `docs/WEBGPU_PRECISION_BANDWIDTH_SM800.md`
- latest issue bodies/comments for #31, #36 and #42

The purpose of this packet is execution-time deduplication: one hardware session, one
environment capture, minimal repeated launches/warmups, and three independent acceptance
records with their own evidence semantics.

## 1. Preparation snapshot

Prepared against:

- `origin/main`: `e19ebf0086c769748834756fd5ab0d36ee44997a`
  (`SM-601: stabilize GTAO history and define target gate (#100)`);
- #31 / SM-501: OPEN;
- #36 / SM-601: OPEN;
- #42 / SM-800: OPEN;
- PR #92: OPEN, non-draft, branch `sm-501-quality-tiers`, base `main`;
- PR #92 head: `1cd1aca8ab7281d1a9fd3615bda1f11216085e43`;
- PR #92 merge base: `165823a95ec030a647e78a584d26c50583d4d0d0`.

Execution agents must recheck this state before changing or measuring anything.

PR #92 changes exactly:

- `.github/workflows/sm501-quality.yml`
- `docs/WEBGPU_QUALITY_TIERS_SM501.md`
- `engine/webgpu_quality.js`
- `sw.js`
- `tools/validate_sm501_target_report.py`
- `tools/validate_webgpu_quality.js`
- `tools/validate_webgpu_quality_contract.py`
- `webapp.js`

The commits landed on `main` after PR #92's merge base did not modify those eight paths.
The expected reconciliation is therefore mechanically clean but semantically non-trivial.

## 2. PR #92 reconciliation

Prefer rebasing/updating PR #92 onto current `main`; do not reimplement the quality-tier
work from scratch and do not reconstruct it from a hand-selected subset of its commits.

Required semantic reconciliation:

1. SM-600/601 now implement GTAO, so PR #92 must stop making project-wide claims that
   GTAO is unimplemented.
2. GTAO nevertheless remains **outside the SM-501 initial-release acceptance baseline**.
   The #31 physical benchmark must run Medium with GTAO explicitly disabled.
3. Harden `tools/validate_sm501_target_report.py` or its report contract so GTAO-off /
   release-scope state is machine-checkable. A Medium + GTAO measurement must not
   accidentally satisfy #31.
4. Preserve SM-505 ownership of `Auto` / WebGPU-first promotion.

Safest branch shape:

`current main -> reconciled PR #92 -> #31 evidence/merge -> #36 evidence -> isolated SM-800 candidate work`

Do not put provisional SM-800 production formats into PR #92.

## 3. Remaining acceptance requirements

### #31 / SM-501

Hard target-report requirements currently include:

- schema `steelmoth-sm501-gtx1650s/v1`;
- physical GTX 1650 SUPER, Windows, native 1920x1080, DPR 1;
- Medium quality;
- genuine `timestamp-query`;
- exact source commit and clean tracked state;
- browser/driver/adapter metadata;
- all eight canonical scenes:
  `representative`, `empty`, `dense-static`, `dynamic-robot`, `foliage`,
  `bin-cluster`, `diagnostic-light`, `mixed`;
- exactly three Chrome runs per scene;
- >=300 warm-up frames and >=600 retained renderer-GPU samples per run;
- run mean/median/p90/p95/p99/max;
- separate CPU scene-preparation and encoding means;
- workload and renderer-memory metadata;
- aggregate scene mean and p95;
- every scene mean <=12.0 ms and p95 <=14.5 ms;
- physical Firefox Medium spot-check on a non-fallback adapter with >=300 warm-up and
  >=600 genuine GPU samples;
- direct comparison against `docs/WEBGL2_BASELINE_PERFORMANCE.md`.

Reconciliation must additionally make **GTAO disabled** explicit and machine-checkable.

Pass-level SM-500 budgets and diagnostic breakdowns are useful supporting evidence; they
are not substitutes for the whole-renderer #31 acceptance distribution.

### #36 / SM-601

Hard report semantics from `tools/validate_sm601_target_report.py` include:

- schema `steelmoth-sm601-target-report/v1`;
- physical GTX 1650 SUPER, non-fallback adapter, 1920x1080, DPR 1;
- Medium GTAO;
- timestamp-query;
- >=300 warm-up and >=600 measured frames;
- >=3 runs;
- finite GTAO mean/p50/p95 for the first three runs;
- moving-scene stability;
- correct history rejection;
- no Material-AO/GTAO double-darkening.

The roughly 0.7-1.2 ms Medium GTAO figure is a **working guardrail**, not a fabricated hard
validator threshold. A valid but materially over-budget measurement should remain open for
tuning/disposition rather than being declared complete merely because the JSON validates.

### #42 / SM-800

Already complete on `main`:

- non-hardware precision/bandwidth study infrastructure;
- numeric/readback and real-WebGPU format checks;
- `hdr11` rejected by existing study evidence;
- `combined` retained only as a mixed-variable sensitivity result;
- production formats unchanged.

Still required:

- physical GTX 1650 SUPER full-renderer A/B;
- fixed canonical scenes using SM-500-quality GPU timing methodology;
- demonstrated renderer GPU and/or relevant memory/bandwidth benefit;
- numeric/readback parity;
- visual/downstream parity;
- required Chrome/Firefox correctness before any production adoption.

Target-hardware effort should concentrate on `material8` and `octMaterial8` unless a
new explicit decision reopens another candidate.

Attribute variables separately:

- `reference -> material8`: reduced G2 material precision;
- `material8 -> octMaterial8`: incremental normal-packing change;
- `reference -> octMaterial8`: combined candidate outcome.

Descriptor-byte savings alone are not evidence of target bandwidth or frame-time benefit.

## 4. Reuse rules

Capture once per hardware campaign where practical:

- Windows edition/build;
- physical GPU inventory;
- GTX 1650 SUPER identity/VRAM;
- NVIDIA driver;
- native display resolution;
- installed Chrome/Firefox versions;
- campaign timestamp and deterministic seed/fixed-time convention.

Each issue report should still embed the metadata it needs rather than depend only on an
external manifest.

Capture/check per source/browser session:

- Git commit and tracked-clean state;
- adapter and fallback status;
- adapter features/limits and `timestamp-query`;
- browser version/UA;
- framebuffer/DPR;
- selected quality/effect/candidate state.

The #31 Chrome dataset may serve as SM-800's broad **reference** dataset when source,
scene, quality, GTAO-off state, resolution and timing method match.

Do not use it as the sole adoption comparison for a candidate on a changed source tree.
For any candidate that looks useful, retain nearby paired/interleaved reference runs,
preferably `reference -> candidate -> reference`, to control session drift.

Measurements that remain separate:

- #31 GTAO-off release baseline versus #36 GTAO-on timing;
- #31 dynamic-robot versus #36 deliberate temporal motion/history tests;
- GTAO pass cost versus whole-renderer total;
- SM-800 synthetic format/write microbenchmark versus full-renderer A/B;
- SM-800 numeric parity versus performance;
- pass-level diagnostics versus total-only acceptance samples.

## 5. Minimum physical execution matrix

Priority order is #31, then #36, then #42.

### Phase A — #31

Use three fresh Chrome processes/profiles total. In each process iterate all eight canonical
scenes, fully resetting deterministic scene state between scenes:

- 300 warm-up frames per scene;
- >=600 retained whole-renderer GPU samples per scene;
- flush timestamp readback before moving to the next scene.

This yields the required three independent runs per scene without 24 Chrome startups.

Then run one fresh headed Firefox target session:

- Medium;
- GTAO off;
- representative canonical scene for the current spot-check contract;
- >=300 warm-up;
- >=600 genuine renderer GPU samples;
- non-fallback physical adapter.

Run pass-level diagnostic timing separately if needed. Do not contaminate the release
distribution by nesting per-pass timestamp-boundary submissions inside a total-only sample.

### Phase B — #36

Where the shared runner can switch mode cleanly, reuse the three Chrome processes after
#31:

- enable Medium GTAO;
- switch to the deterministic moving light/actor case;
- invalidate/rebuild temporal state;
- fresh >=300-frame warm-up;
- >=600 retained frames;
- collect GTAO-pass timing;
- retain explicit evidence for motion stability, a history-rejection event, and
  Material-AO + GTAO composition without double-darkening.

### Phase C — #42

Initial screen:

- one full eight-scene `material8` physical sweep;
- one full eight-scene `octMaterial8` physical sweep;
- #31 dataset as the broad reference distribution where compatible.

If a candidate is flat/regressive or within ordinary reference variance, record the
negative result and stop measuring it.

If a candidate appears beneficial, perform paired/interleaved confirmation. For a
renderer-wide adoption claim, confirm across all canonical scenes rather than cherry-picking
only a favorable case.

## 6. Existing tooling and missing glue

Existing timing/instrumentation authority:

- `engine/webgpu_performance.js`
- `docs/WEBGPU_PERFORMANCE_INSTRUMENTATION_SM500.md`
- `tools/validate_webgpu_performance.js`
- `webgpu-resources-smoke.html`

For acceptance totals, measure the entire frame/graph as one measured unit. Use
`attachFrameGraph()` / pass-level breakdown separately; the per-pass instrumentation adds
timestamp-boundary queue submissions and must not contaminate the outer release total.

Existing deterministic/capture infrastructure:

- `render-test.html`
- `engine/render_harness.js`
- `engine/render_fixture_adapter.js`
- `tools/capture_render_fixture.py`
- `tools/benchmark_webgl2.py`

Important boundary: this existing deterministic presentation benchmark remains WebGL2.
Do not time that presentation and label it a WebGPU full-renderer result.

Existing Firefox/physical functional check:

```text
python tools/validate_webgpu_cross_browser.py --execution-profile target-hardware --browsers chrome firefox --timeout 90 --report artifacts/sm405/cross-browser-functional.json
```

Existing GTAO checks:

```text
node tools/validate_webgpu_gtao.js
node tools/validate_webgpu_gtao_stabilization.js
python tools/validate_webgpu_gtao_browser.py
python tools/validate_webgpu_gtao_stabilization_browser.py --report artifacts/sm601-gtao-stabilization-browser.json
python tools/validate_sm601_target_report.py <target-report.json>
```

Existing SM-800 study checks:

```text
node tools/validate_webgpu_precision.js
python tools/validate_webgpu_precision_contract.py
python tools/validate_webgpu_precision_browser.py --timeout 180 --report artifacts/sm800/precision-bandwidth-report.json
```

with:

- `tools/sm800_precision_probe.js`
- `webgpu-precision-smoke.html`
- `docs/WEBGPU_PRECISION_BANDWIDTH_SM800.md`

The existing SM-800 browser runner is a synthetic format/write probe, not the required
full-renderer A/B.

Smallest missing execution glue:

1. one bounded target-WebGPU benchmark path that drives the actual staged production
   WebGPU pass chain offscreen without changing `Auto` ownership;
2. one Python runner derived from the orchestration patterns in
   `tools/benchmark_webgl2.py` that launches fresh browser profiles, selects
   scene/quality/GTAO/candidate state, verifies adapter/native target state, performs
   >=300+600 measurement windows, retains raw timestamp samples, computes all required
   percentiles, and emits the independent #31/#36 reports;
3. explicit SM-800 reference/candidate selectors that leave production defaults unchanged;
4. a small machine-readable SM-800 target report/validator for the physical A/B decision.

If honest full-WebGPU target timing would require a renderer redesign rather than bounded
benchmark glue, stop and record the blocker instead of substituting WebGL2 presentation or
CPU timing.

## 7. Artifact layout

Use the existing `benchmarks/webgpu-gtx1650s/` convention.

Suggested paths:

```text
benchmarks/webgpu-gtx1650s/campaign-2026-09-19/
  session.json
  README.md

benchmarks/webgpu-gtx1650s/sm501-2026-09-19/
  target-report.json
  SUMMARY.md
  raw/chrome/session-01/
  raw/chrome/session-02/
  raw/chrome/session-03/
  raw/firefox/
  diagnostics/
  captures/
  logs/

benchmarks/webgpu-gtx1650s/sm601-2026-09-19/
  target-report.json
  SUMMARY.md
  raw/chrome/
  captures/moving-scene/
  captures/history-rejection/
  captures/double-darkening/
  logs/

benchmarks/webgpu-gtx1650s/sm800-2026-09-19/
  target-report.json
  decisions.json
  SUMMARY.md
  raw/reference/
  raw/material8/
  raw/octMaterial8/
  parity/numeric/
  parity/captures/
  logs/
```

Retain raw samples; do not preserve only aggregate percentiles.

## 8. Decision and closure rules

### #31

Merge/close only when:

- PR #92 is rebased/reconciled;
- GTAO-off release state is explicit;
- post-reconciliation CI is green;
- the physical report passes the strict #31 validator and target limits;
- evidence is committed/reviewed.

Do not promote `Auto`; SM-505 owns that decision.

### #36

Software is already merged. Close only after valid physical three-run evidence plus motion,
history-rejection and no-double-darkening evidence. A materially over-budget GTAO result
stays open pending tuning/disposition even if the report is structurally valid.

### #42

A negative physical study is a valid result. A candidate may be rejected and #42 may still
close when the target study is complete and durable.

Adopt a production format only after measured relevant-hardware benefit plus
numeric/visual/downstream/cross-browser correctness. Keep candidate implementation separate
from PR #92.

## 9. Failure and interruption handling

If #31 misses the target:

- preserve raw samples and exact failing scenes/statistics;
- preserve environment/source metadata and validator output;
- add a separate pass breakdown if useful;
- keep #31 open;
- do not weaken thresholds, alter the baseline scope, or substitute CPU timing.

If GTAO exceeds its working budget:

- preserve the valid report and pass distribution;
- record quality/workload/stability;
- keep #36 open for tuning/disposition rather than manufacturing a pass.

If an SM-800 candidate shows no benefit:

- stop measuring that candidate;
- preserve the A/B and parity evidence;
- record rejection;
- leave production formats unchanged.

If Firefox lacks usable `timestamp-query`:

- record Firefox version, adapter/non-fallback identity and feature inventory;
- retain functional correctness evidence;
- never substitute CPU timing for GPU timing;
- with the current #31 contract, leave #31 open unless the contract is explicitly revised.

If interrupted after #31 or #36:

- commit/retain every complete raw run, campaign metadata, reports, validator output,
  logs/captures and a precise remaining-work note;
- mark incomplete sweeps non-closing;
- do not synthesize aggregates from an incomplete matrix;
- leave unfinished later issues open.

## 10. Execution handoff

The physical execution run should not repeat broad repository archaeology. It should:

1. recheck current `main`, PR #92 and issues #31/#36/#42;
2. reconcile PR #92 as described above;
3. implement only the missing bounded benchmark/report glue;
4. execute #31, then #36, then #42;
5. store independent durable evidence under `benchmarks/webgpu-gtx1650s/`;
6. merge/close only when the issue's own acceptance semantics are genuinely satisfied.

Do not broaden into a renderer architecture review, revisit M0-M4 decisions, redesign the
renderer, or change SM-505 ownership of `Auto`.
