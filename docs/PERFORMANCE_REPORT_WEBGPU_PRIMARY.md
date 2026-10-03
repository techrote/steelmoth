# WebGPU primary performance report — SM-505 reconciliation

Date: 2026-10-03  
Release gate: #50 / SM-505  
Performance authority: #31 / SM-501, PR #92

## Accepted target

Primary reference target: NVIDIA GeForce GTX 1650 SUPER 4 GB, Windows 11, native 1920x1080 render attachments, DPR 1, Medium WebGPU quality, GTAO off/excluded.

Acceptance thresholds remain:

- mean renderer GPU queue span: <= 12.0 ms for every canonical scene;
- p95 renderer GPU queue span: <= 14.5 ms for every canonical scene.

## Accepted physical campaign

The final reconciled campaign measured clean source `2e4d490f7af21a4b21a1e8e3e8c392e03968dfc4` using three fresh Chrome processes across all eight canonical scenes, 300 warm-up plus 600 retained timestamp frames per run, and a Firefox representative spot-check.

| Scene | Mean ms | p95 ms | Result |
| --- | ---: | ---: | --- |
| representative | 4.817853 | 6.078240 | PASS |
| empty | 3.631112 | 4.999904 | PASS |
| dense-static | 6.411803 | 7.945472 | PASS |
| dynamic-robot | 5.723463 | 7.317504 | PASS |
| foliage | 4.360754 | 5.323648 | PASS |
| bin-cluster | 3.650846 | 4.705888 | PASS |
| diagnostic-light | 6.095339 | 8.190048 | PASS |
| mixed | 5.902273 | 7.063552 | PASS |

Firefox representative: **5.674183 ms mean / 7.119040 ms p95**, PASS.

The worst reconciled mean is dense-static at 6.411803 ms. The worst reconciled p95 is diagnostic-light at 8.190048 ms. No CPU time was subtracted. The values are genuine timestamp-query queue spans and may include host-induced GPU idle.

## Evidence provenance

Raw samples, per-run distributions, browser/adapter metadata, workload/memory records, screenshots, teardown records, strict validator output and checksums are retained under:

`benchmarks/webgpu-gtx1650s/campaign-2026-10-02-sm501/`

The exact-head `672c709...` and reconciled `2e4d490...` distributions remain separate. The reconciled distribution is the release-performance authority.

## Current-main applicability

Current `main` at the SM-505 review is `19cca285fe7a3ae902626aa2e54c534dff5603ce`.

Post-measurement changes affect SM-500 timing diagnostics and SM-601 GTAO telemetry/harness behavior; the initial SM-501 release configuration keeps GTAO disabled. The accepted Medium core rendering modules/settings used by the initial-release performance path were not replaced by SM-601.

Accordingly, the retained SM-501 performance gate remains **PASS** for the accepted staged core. No fresh timing run is required merely because PR #110/111 landed.

This does **not** authorize default promotion by itself. The normal application currently presents through WebGL2 even after successful WebGPU device selection. A future SM-505 presentation-integration candidate must undergo a source/configuration identity audit. If it changes the accepted GPU command stream or timing semantics, the full physical timing campaign must be repeated on that exact candidate.

## Release disposition

Performance is not the current SM-505 blocker. Normal-game WebGPU presentation ownership and exact-candidate physical presentation evidence are missing, and deployment/cache identity is stale. `Auto` therefore remains unchanged.
