# WebGL2 GTX 1650 Super baseline performance

This document owns the SM-003 empirical compatibility-renderer baseline. The machine-readable source is **benchmarks/webgl2-gtx1650s/baseline.json**; individual run files retain every sample and are not trimmed for outliers.

## Evidence boundary

These measurements apply only to the recorded Chrome build, NVIDIA driver, Windows host, GTX 1650 Super 4 GB, WebGL2/ANGLE D3D11 path, high quality, native 1920×1080, and DPR 1. They are not WebGPU results and are not a claim about another adapter or browser. CPU scene-preparation and submit timings remain separate from GPU timestamps. Task Manager utilization is not used.

## Method

Each scenario uses the deterministic SM-002 fixture harness and fixed renderer time. Every fresh-browser run performs 300 warm-up frames, then alternates 600 whole-renderer GPU timestamp frames with 600 pass-timestamp frames. Alternation is required because WebGL2 elapsed queries cannot nest. Each scenario has three independent runs with a new browser process and profile; pooled and per-run mean, median, p90, p95, p99, and maximum use the nearest-rank percentile method.

The pass series are G-buffer, contact shadow, and direct lighting. **rendererTotal** covers the complete production game.render() GPU command stream. CPU scene preparation includes deterministic scene assembly and light/caster collection; CPU submit covers the renderer submission call. Frame intervals are requestAnimationFrame intervals and are reported separately.

## Canonical scenes

| Scenario | Deterministic source | Purpose |
| --- | --- | --- |
| representative | dense-mixed + 4 deterministic robots | representative gameplay mix |
| empty | empty-floor | fixed renderer overhead |
| dense-static | dense-mixed + 45 deterministic static props | dense static Material-v2 load |
| dynamic-robot | robot + 32 deterministic robots | dynamic/robot-heavy load |
| foliage | foliage-dense | foliage-heavy load |
| bin-cluster | binsright | overlapping bin cluster |
| diagnostic-light | dense-mixed + bounded diagnostic lights | lighting/shadow worst case |
| mixed | dense-mixed + 12 deterministic robots | water, foliage, props, and actors |

WebGL2 has no DSO cluster/tile/pixel representation. Those counts are recorded as null with an explicit unsupported note rather than inferred or reported as zero.

## Measured environment and results

The measured environment and result tables are populated from the committed machine-readable report after the target-hardware run. No target values are substituted for measurements.
