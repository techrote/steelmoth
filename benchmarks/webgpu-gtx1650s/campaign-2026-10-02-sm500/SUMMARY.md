# Physical timing-boundary repair and GTAO baseline

Target: NVIDIA GeForce GTX 1650 SUPER 4 GB, driver 616.92, Windows 11,
Chrome 154.0.8037.92, native 1920x1080 attachments/DPR 1/Medium GTAO 6x4.
The desktop is 2560x1440. `environment.json` records independent adapter identity.
All distributions below retain every sample and keep source heads separate.

| Source / evidence | Disposition |
| --- | --- |
| Production main `6cb332e4181b2cf5508cdcdafdbf81f7dac48744`, canonical queue-only baseline | Three fresh processes, 300 warm-up + 600 retained each. Run means 2.860349 / 2.970736 / 2.927501 ms; worst p95 3.785056 ms. Structural validator passes; working guardrail remains exceeded. |
| Diagnostic `d69faf9bad7b70ec6d0ecadcc086dfc06412d140` | Rejected: invalid unaligned command-query resolve yielded zero SM-500 results. Independent direct timestamps are retained, never used as accepted enclosing timings. |
| Aligned diagnostic `0618a5ef5d97a3087361f04153ba436762add437` | Two valid 600-frame processes; third failed reading the browser startup port file. Retained as partial evidence, excluded from the complete distribution. |
| Current-main-reconciled diagnostic `0c1c707de426fce89ac5f21386ca99edbe8281be` | Complete three-process/1,800-frame decomposition; genuine timestamps, two explicit submissions per frame, no validation or uncaptured errors. |

Complete diagnostic pooled values:

| Metric | Mean ms | Boundary |
| --- | ---: | --- |
| Queue span | 3.067721 | Historical callback boundary plus disclosed diagnostic observer work |
| Explicit command span | 1.100543 | Sum of both submitted GTAO command buffers; includes stats copy/markers, excludes host gaps |
| Raw half-resolution horizon | 0.214253 | Direct compute-pass timestamps |
| Full-resolution reconstruction | 0.185178 | Direct compute-pass timestamps |
| Temporal compute | 0.698088 | Direct compute-pass timestamps, including diagnostic atomics |
| 32-byte diagnostic copy | Approximately 0.002989 | Instrumented copy interval includes marker/transition costs |
| CPU callback | 3.802611 | Host wall time; not pure encoding |
| Explicit stats-map host wait | 3.592167 | Host wall latency; not GPU time |
| SM-500 timestamp-map latency | 0.607111 | Host diagnostic transport latency |

Queue p95 is 3.958624 ms; command p95 is 1.398208 ms. Per-producer parameter-write-to-submit CPU intervals, direct timestamp-map latency, counters, raw nanosecond strings and full SM-500 frames are retained in `main-final-decomposition/diagnostic.json`.

The observed cost is a mixture. Temporal compute dominates the measured command work; raw/reconstruction are smaller. The enclosing queue span is materially larger than the independently measured command span, and the baseline callback awaits diagnostic mapping. No CPU, host wait, or map latency was subtracted to manufacture command execution time. Diagnostic atomics require the separate counter A/B for attribution. Historical PR #102 remains historical queue-span evidence and is not rewritten.

The repair changes query-resolve alignment/capacity/decoding and validation only. Queue-only layout, shaders, Medium settings, history policy and acceptance targets are preserved. SM-601 remains open; this is localization and instrumentation evidence, not adoption or visual acceptance.

Commands from the respective committed sources:

```
python tools/run_webgpu_target_campaign.py --phase sm601 --sessions 3 --warmup 300 --samples 600 --out <new-root>/main-6cb332e-baseline
python tools/run_sm601_physical_diagnostic.py --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --runs 3 --warmup 300 --samples 600 --timeout 1200 --report <new-root>/main-final-decomposition/diagnostic.json
python tools/run_checks.py --report <new-root>/sm500-fixed-core-checks.json
```

The complete source/regression gate passes 83/83. Additional startup/accounting/alignment tests passed before hardware collection. Read `docs/SM500_TIMING_BOUNDARY.md` and `docs/SM601_PHYSICAL_DIAGNOSTIC.md` for API, observer and source-preservation limits.
