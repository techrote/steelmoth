# SM-601 physical GTX 1650 SUPER GTAO result

Status: **VALID CORRECTNESS EVIDENCE, OVER BUDGET — keep #36 open.**

The Medium GTAO physical gate completed on 2026-09-19 at native 1920x1080, DPR 1, using a non-fallback NVIDIA GeForce GTX 1650 SUPER with genuine `timestamp-query`. The measured product source was clean commit `5d1258032b27af270a925e29379e01bc84acf1d7`.

Each target run used a fresh Chrome process and GTAO state, a deliberate moving actor/light scene, 300 warm-up frames, and 600 retained GTAO GPU samples.

| Run | Mean (ms) | p50 (ms) | p95 (ms) | Stability | History rejection | No double-darkening |
|---|---:|---:|---:|---|---|---|
| 1 | 2.8203 | 2.6972 | 3.5512 | pass | pass | pass |
| 2 | 2.9034 | 2.8490 | 3.8157 | pass | pass | pass |
| 3 | 2.9148 | 2.8426 | 3.6567 | pass | pass | pass |

The mean of run means is 2.8795 ms and the worst-run p95 is 3.8157 ms. This is materially above the 0.7–1.2 ms working guardrail, so structural report validity is not sufficient to declare acceptance.

Temporal readback remained finite and bounded in every run (`0.9995115..1.0`, moving-frame delta maximum `0.00048846`). The deliberate room discontinuity produced history rejection in every run. The production visibility composition check passed with minimum combined visibility `0.1199951` and mean `0.8550296`, preserving the SM-307 strongest-occluder/min policy without multiplying Material AO and GTAO.

Inherited correctness gates also passed on hosted real WebGPU after the Windows-safe validator cleanup included in independent branch commit `0dd0204e9ed42a6ff76bd2570e6b7af8d9c1901c`:

- SM-600 GTAO browser: 17 assertions passed.
- SM-601 temporal stabilization browser: passed.
- SM-307 visibility browser with required WebGPU: 31 assertions passed, with screenshot evidence.
- SM-600 static GTAO contract: passed.

## Evidence

- `target-report.json` contains source/environment/method metadata, all 1,800 raw GPU samples, per-run statistics, and validation detail.
- `raw/` contains one JSON result and screenshot for each physical target run.
- `correctness/` contains the inherited hosted-browser reports and visibility screenshot.
- `repository-checks/` contains the independent main-based branch's 80/80 verification report and supporting generated fixtures.
- `validator.log` records a structurally valid report while explicitly reporting `withinWorkingMeanGuardrail: false`.

The evidence supports bounded GTAO performance tuning or disposition. It does not justify closing #36, weakening the budget, reducing visual correctness, or retroactively adding GTAO to the SM-501 initial-release total.
