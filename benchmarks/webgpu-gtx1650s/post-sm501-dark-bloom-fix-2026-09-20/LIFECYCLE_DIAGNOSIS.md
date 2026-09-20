# SM-501 positions-6/7 lifecycle diagnosis

This evidence isolates the two remaining physical GTX 1650 SUPER failures without changing production renderer semantics, Medium quality, native core representations, or the 12.0 ms mean / 14.5 ms p95 targets.

## Retained sequential-session failure

The source-matched campaign at renderer source `44e7947e0b6e402f7f8c36f081e70420eacd691a` reused one Chrome process across all eight canonical scenes and did not explicitly release each page's WebGPU renderer/device stack before the next navigation.

| Scene / position | Aggregate mean ms | Aggregate p95 ms |
| --- | ---: | ---: |
| bin-cluster / 6 | 57.983 | 91.130 |
| diagnostic-light / 7 | 68.680 | 96.229 |
| mixed / 8 | 10.280 | 12.504 |

The timestamp queue spans tracked the separately recorded `encodingMs`, which brackets the awaited `graph.execute()` call and includes `runFull()`'s internal `prepareBase()`, subsystem host work, submission, and possible queue/driver back-pressure. No CPU subtraction or shader-only inference is made.

## Fresh-process isolation

Harness source `eb4c37599b188a21f52602d4071ed4c7ac699027` ran each scene in a separate new Chrome process with 300 warm-up + 600 retained total-only timestamp frames.

| Scene | Mean ms | p95 ms | Result |
| --- | ---: | ---: | --- |
| bin-cluster | 3.920 | 5.034 | pass |
| diagnostic-light | 9.508 | 11.728 | pass |
| dense-static control | 11.221 | 13.100 | pass |

All three scenes pass in isolation. This rejects an intrinsic bin-cluster or diagnostic-light renderer regression as the cause of the retained positions-6/7 failure.

## Deterministic teardown confirmation

The benchmark now drains pending instrumentation/queue work, closes 13 renderer resource owners, releases atlas image bitmaps, unconfigures the canvas, and destroys the WebGPU device before the runner navigates to the next scene. It does not alter any production rendering pass.

Repair source `50a1cb540c39f311890567ef913306fe6c7a061e` then ran the original first seven canonical positions in one Chrome process, again at 300 warm-up + 600 retained total-only timestamp frames per scene.

| Scene / position | Mean ms | p95 ms | Teardown |
| --- | ---: | ---: | --- |
| bin-cluster / 6 | 3.944 | 4.806 | 13 owners closed; device `closed` |
| diagnostic-light / 7 | 9.984 | 12.863 | 13 owners closed; device `closed` |

Every preceding page also reported successful deterministic teardown. The positions-6/7 stall is eliminated while preserving the sequential campaign shape. These one-run diagnostics demonstrate cause and repair but are not final SM-501 acceptance; the required three-session/eight-scene Chrome campaign and Firefox spot-check remain the release gate.

Raw samples, workload/memory metadata, screenshots, CPU distributions, and teardown records are retained under:

- `isolated-scene-diagnosis-2026-09-20/`
- `sequential-teardown-confirmation-2026-09-20/`
