# SM-501 physical GTX 1650 SUPER acceptance — 2026-10-02

**Physical target PASS on both the requested exact head and the current-main reconciliation.** The final reconciled source passes all eight unchanged Chrome scene limits and the Firefox representative spot-check. PR #92 / issue #31 remain pending required final-head CI, evidence review and merge verification.

## Sources and method

| Dataset | Clean measured source | Sampling | Strict validator |
| --- | --- | --- | --- |
| First two scenes | `672c7097c5ee6f436cca5acf40f8d221ece3cc70` | fresh Chrome process per scene; 300 warm-up + 600 retained | diagnostic only |
| Exact-head full | `672c7097c5ee6f436cca5acf40f8d221ece3cc70` | 3 fresh Chrome processes × 8 scenes; 300 + 600 each; Firefox representative 300 + 600 | PASS |
| Reconciled full | `2e4d490f7af21a4b21a1e8e3e8c392e03968dfc4` | same full protocol | PASS |

Both full datasets retain 1,800 samples per Chrome scene, per-run distributions, CPU/workload/memory metadata, screenshots, teardown records and the canonical SM-003 WebGL2 comparison. They are separate distributions: no samples were pooled across source changes or removed as outliers.

Environment: physical NVIDIA GeForce GTX 1650 SUPER 4 GB, driver 616.92, Windows 11 Pro 10.0.26200, Chrome 154.0.8037.92, Firefox 157.0. Chrome reports NVIDIA/Turing, non-fallback, with negotiated `timestamp-query`; Firefox reports non-fallback and negotiated queries while redacting adapter identity. `environment.json` records the sole Windows video controller and PCI identity `0x218710DE`.

All runs use native 1920×1080 render attachments, DPR 1, Medium, production reference G-buffer formats and GTAO OFF/excluded. The desktop remains 2560×1440; “native 1080p” describes the unscaled benchmark attachments, not a desktop-mode change.

## Measured renderer timestamp queue spans

Values are aggregate mean / p95 milliseconds. Thresholds remain **≤12.0 / ≤14.5 ms** for every scene.

| Chrome scene | Exact `672c709` | Reconciled `2e4d490` | Gate |
| --- | ---: | ---: | --- |
| representative | 5.323655 / 7.188896 | 4.817853 / 6.078240 | pass / pass |
| empty | 3.380890 / 4.107008 | 3.631112 / 4.999904 | pass / pass |
| dense-static | 6.283481 / 8.274624 | 6.411803 / 7.945472 | pass / pass |
| dynamic-robot | 5.652176 / 7.120896 | 5.723463 / 7.317504 | pass / pass |
| foliage | 4.414714 / 5.510720 | 4.360754 / 5.323648 | pass / pass |
| bin-cluster | 3.456887 / 4.075520 | 3.650846 / 4.705888 | pass / pass |
| diagnostic-light | 5.917278 / 7.271424 | 6.095339 / 8.190048 | pass / pass |
| mixed | 6.656943 / 9.061888 | 5.902273 / 7.063552 | pass / pass |

Firefox representative (600 retained): exact head **6.500989 / 8.984736 ms**; reconciled head **5.674183 / 7.119040 ms**. The first two exact-head diagnostics passed at dense-static **6.688122 / 11.928128 ms** and mixed **6.343594 / 8.002720 ms**, authorizing the full campaign.

These are genuine GPU timestamp **queue spans**, including possible host-induced GPU idle. They are not shader-only command execution durations. The reconciled raw records explicitly label `queueSpanGpuMs`, retain the historical `gpuRendererMs` field, and report zero explicit command spans. CPU callback/encoding time is separate and was never subtracted. The subsequently discovered SM-500 command-span resolve-alignment defect affects a separate explicit-command diagnostic path; this queue-only SM-501 campaign does not use that additional resolve path. Its repair and SM-601 measurements are separate work.

## Current-main integration and verification

PR #92's accepted renderer/preset changes were reconciled with `main` `6cb332e4181b2cf5508cdcdafdbf81f7dac48744`, preserving merged #107 GTAO reference policy and #108 timing semantics. Only two benchmark conflict regions required unions: retain #92 CPU callback distributions/teardown and #108 queue-span labels/coverage. Dark Bloom, DSO planner, Medium quality and gameplay were preserved. The resulting source was measured afresh; the old-head result was not relabeled.

The first reconciled core gate at `d15fe928148f8c02744922b46b7a7d39b84c9b60` passed 82/83 checks. An inherited #107 lexical function-hash check treated Windows CRLF as a source change. A validator-only repair canonicalizes CRLF before CPU VM evaluation/source hashes and verifies identical LF/CRLF reports, with both original semantic mutants rejected under both forms. Frozen hashes/tolerances, production code and generated WGSL are unchanged. The failed report is retained. Clean source `2e4d490` passes **83/83** core checks and **18/18** clean-package checks; the full physical rerun then passes.

Prior failed physical evidence remains untouched under `../sm501-2026-09-19/` and `../post-sm501-dark-bloom-fix-2026-09-20/`. Those source/browser-era results are historical evidence, not samples in this acceptance distribution. No research PR or GTAO optimization is adopted by SM-501; Auto remains WebGL2-first under SM-505.

## Commands and retained files

Executed from each clean source checkout, with separate output directories:

```text
python tools/run_webgpu_target_campaign.py --phase sm501-diagnostic --scenes dense-static mixed --warmup 300 --samples 600 --sessions 1 --out C:/steelmoth/artifacts/physical-campaign-2026-10-02/pr92-672c709-first-two
python tools/run_webgpu_target_campaign.py --phase sm501 --warmup 300 --samples 600 --sessions 3 --out C:/steelmoth/artifacts/physical-campaign-2026-10-02/pr92-672c709-full
python tools/run_webgpu_target_campaign.py --phase sm501 --warmup 300 --samples 600 --sessions 3 --out C:/steelmoth/artifacts/physical-campaign-2026-10-02/pr92-reconciled-2e4d490-full
python tools/run_checks.py --report C:/steelmoth/artifacts/physical-campaign-2026-10-02/pr92-reconciled-2e4d490-core-checks.json
python tools/validate_clean_package.py --report C:/steelmoth/artifacts/physical-campaign-2026-10-02/pr92-reconciled-2e4d490-clean-package.json
```

The campaign runner executes `tools/validate_sm501_target_report.py` automatically. Its retained `validator.log` and `target-report.json` are in each full dataset's historical-named `sm501-2026-09-19/` subdirectory; the new parent directory identifies this campaign's date. Raw copies and check reports are retained here. `SHA256SUMS.txt` hashes every other file's retained Windows bytes, including CRLF text; JSON parsing and file checksums have been verified.
