Independent retained-evidence audit: PASS. Exact diagnostic source `fa388aa9567dbacd2598221c644c22946834221d`; report SHA-256 `a5c56eff6b8bd786b7405352d6344975560bcdd7d3f3610b25a517bad6809edd`.

GTX 1650 SUPER 4 GiB; NVIDIA driver 616.92; Chrome 154.0.8037.92; nonfallback timestamp-query. Three fresh processes, each 300 warm-up and 600 retained samples per variant. Each run contains 2,400 rows and 2,400 SM-500 frames.

| Variant | Queue mean / pooled p95 ms | Worst run queue p95 ms | Command mean ms | Raw mean ms | Reconstruction mean ms | Temporal mean ms | Callback mean ms | Diagnostic map mean ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline-blocking | 2.848099 / 3.935168 | 4.180928 | 1.088615 | 0.208475 | 0.191617 | 0.685369 | 4.569056 | 4.395556 |
| counter-blocking | 3.233311 / 4.166720 | 4.409344 | 1.081225 | 0.205216 | 0.187017 | 0.685938 | 3.625889 | 3.409056 |
| baseline-deferred | 1.273551 / 1.520416 | 1.567008 | 1.090182 | 0.204308 | 0.187453 | 0.694905 | 0.201056 | 2.495111 |
| counter-deferred | 1.114569 / 1.404800 | 1.425408 | 1.078616 | 0.210674 | 0.186099 | 0.678360 | 0.161444 | 4.431222 |

All retained rows have exact eight-word equality across four variants at each logical frame. All four snapshot texture hashes and counter words match across variants and processes. Every variant occupies each order position exactly 150 times per process. Direct nanosecond intervals, command sums, and queue aliases recompute without error.

Counter aggregation alone regresses native queue span. Deferred scheduling produces the main queue-span reduction. Combining counters with deferred scheduling reduces this diagnostic queue mean further, while the measured GPU command/temporal changes are small. Attribute the substantial queue effect to scheduling evidence rather than claiming an equivalent shader speedup. Production adoption remains contingent on fresh full acceptance.

Evidence limits:

- This audit reads only retained JSON and immutable Git objects. It does not rerun GPU/browser measurements or certify human visual acceptance.
- Full texture bytes are not retained in comparison.json; this audit independently checks all four retained SHA-256 identities and eight raw counter words at each snapshot. Exact byte comparison was performed by the recorded harness at capture time.
- Direct compute uint64 nanosecond samples are retained and independently recomputed. SM-500 raw query nanoseconds are not exported in this JSON; its explicit command sums and queue/gpuMs aliases are recomputed from retained span values.
- Each canvas is unscaled 1920x1080 at DPR1; desktop screen metadata is 2560x1440. The screen resolution was not changed.
- The four-way comparison uses shared queue/scene preparation and rotating serial variants. Deferred map initiation occurs inside the frozen scheduler; all remaining drains occur outside measured callbacks. Timestamp transport and adjacent variants can affect scheduling.
- This is a distinct fa388aa diagnostic source and instrumentation boundary. No earlier physical source or campaign distribution is pooled here. Same-source pooled summaries are descriptive, not acceptance distributions.
- A small change in explicit GPU command/temporal cost does not explain the larger callback-bound queue reduction. No command execution time is manufactured by subtracting host/CPU/readback time from queue spans.
- Diagnostic-only success does not complete SM-601. Selected production integration requires fresh full acceptance evidence on its own exact source and any explicitly required human visual review.
