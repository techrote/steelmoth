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

Measured on 18 September 2026 from source commit **beb5181fa129861ef1c016bf0ec0e04d018d9300**:

- NVIDIA GeForce GTX 1650 SUPER, 4096 MiB, driver 616.92;
- Chrome 153.0.8010.48, headless new mode;
- ANGLE Direct3D 11, shader model 5.0;
- Windows 11 10.0.26200;
- WebGL 2.0 / GLSL ES 3.00;
- EXT_disjoint_timer_query_webgl2 available, with zero disjoint samples across 24 runs.

### Whole-renderer GPU and CPU results

All times are milliseconds. GPU columns are pooled from 1,800 whole-renderer timestamp samples per scenario. CPU prep and submit means are pooled from 3,600 measured frames per scenario.

| Scenario | GPU mean | median | p90 | p95 | p99 | max | CPU prep mean | CPU submit mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| representative | 5.07 | 4.44 | 10.51 | 12.08 | 14.68 | 18.29 | 1.57 | 3.21 |
| empty | 4.63 | 3.59 | 8.40 | 10.84 | 12.53 | 13.69 | 1.41 | 2.37 |
| dense-static | 5.47 | 4.83 | 11.51 | 12.02 | 12.45 | 15.11 | 1.74 | 3.28 |
| dynamic-robot | 5.05 | 4.58 | 10.15 | 11.21 | 11.77 | 14.11 | 1.86 | 4.25 |
| foliage | 5.65 | 5.40 | 6.92 | 10.81 | 12.54 | 13.45 | 1.64 | 2.68 |
| bin-cluster | 5.99 | 6.07 | 7.48 | 10.42 | 12.38 | 13.90 | 1.70 | 2.83 |
| diagnostic-light | 6.35 | 6.31 | 7.97 | 10.57 | 11.45 | 11.95 | 1.86 | 3.57 |
| mixed | 5.93 | 5.75 | 7.57 | 10.67 | 14.58 | 18.67 | 1.97 | 3.99 |

The median requestAnimationFrame rate was 59.88 FPS in every scenario. All measured means are below the programme target of 12 ms and all measured p95 values are below 14.5 ms. This establishes the WebGL2 comparison baseline; it does not by itself satisfy a future WebGPU acceptance gate.

### Pass-level GPU means

Each pass value is pooled from 1,800 timestamp samples. Whole-renderer totals were measured on alternating frames and are not constructed by adding pass means.

| Scenario | G-buffer | contact shadow | direct lighting |
| --- | ---: | ---: | ---: |
| representative | 1.08 | 1.89 | 2.68 |
| empty | 0.63 | 1.98 | 2.60 |
| dense-static | 0.75 | 1.82 | 2.86 |
| dynamic-robot | 0.62 | 1.65 | 2.67 |
| foliage | 0.49 | 1.95 | 3.16 |
| bin-cluster | 0.39 | 2.03 | 3.24 |
| diagnostic-light | 0.47 | 2.02 | 3.67 |
| mixed | 0.70 | 1.79 | 3.08 |

### Counts, memory, and restart verification

Every run records static/dynamic/foreground G-buffer counts, authored static objects, dynamic robots, foliage instances, active and self-shadowed lights, self/contact sample counts, WebGL2 caster counts, and terrain/hard occluders. Cluster and DSO counts are explicitly null because the compatibility renderer has no such representation.

At native 1920×1080 the renderer-owned target estimate is 105,753,600 bytes (100.85 MiB): scene, light, 2× shadow mask, half-resolution contact mask, deferred copy, three-attachment G-buffer, and two half-resolution bloom targets. WebGL2 owns no temporal history target in this baseline. Auxiliary field/instance-buffer estimates remain separate in each run.

All three runs of every scenario used a fresh browser process and profile. The maximum-to-minimum run-mean GPU ratio ranged from 1.023 to 1.271, within the documented broad-range threshold of 1.5. Raw maxima and all other outliers remain in the run files.
