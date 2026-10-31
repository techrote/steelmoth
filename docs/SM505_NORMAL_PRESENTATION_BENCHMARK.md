# SM-505 normal-presentation timing contract

Status: **implemented tooling; CPU contracts verified; physical timing NOT RUN**.
This contract describes `tools/sm505_normal_benchmark.js` and
`tools/benchmark_sm505_normal.py`. It does not qualify the current candidate or
change the [release gates](WEBGPU_RELEASE_VALIDATION.md). `Auto` remains WebGL2.

## Actual application and fixed scenes

The runner loads normal `index.html`, injecting the existing deterministic
fixture adapter and harness before game startup. Test-only `benchmarkPrepare=1`
applies the existing benchmark profile without running the WebGL2 timing loop.
It rejects development inspection. Both the normal graphics tier and explicit
WebGPU quality are Medium; native attachments are 1920×1080 at DPR 1, with GTAO,
SSGI and advanced forward lighting excluded from this initial-release workload.

The authoritative eight scene/profile/angle mappings are `SCENARIOS` in
`tools/benchmark_webgl2.py`, documented in
[the SM-003 baseline](WEBGL2_BASELINE_PERFORMANCE.md#canonical-scenes). They use
the actual room painter, actor producers, water, foliage and normal presenter.
The inherited empty fixture still contains procedural background/border decor;
it means no authored props, rather than zero draws. Actual counts are retained.
No synthetic sprite grid from `webgpu-target-benchmark.html` is substituted.
Those historical staged-core datasets remain separate.

Each Chrome scene has three independent browser processes/profiles. Each process
executes 300 warm-up frames and at least 600 retained frames. The campaign plan
contains 24 serialized processes, with no failed-run retry or evidence overwrite.
The fixed seed, time, light angle, fixture, full settings and before/after scene
fingerprint identify the workload. The original profile is used, never the
brighter development inspection preset.

## Timing boundary and limits

An observer wraps the original presenter's `_drain` completion, then invokes
`game.__smHarnessRenderOnce()`. Submission still follows the normal RenderScene
bridge, runtime consumer, original `_drain`, `_render` and presentation surface.
There is no replacement renderer, queue monkey-patch or CPU-time subtraction.
Animation-frame pacing occurs outside the measured interval.

SM-500 brackets that complete callback as `rendererTotal`. Its
`queueSpanGpuMs` is a genuine GPU timestamp queue span, including possible GPU
idle gaps caused by host work/waits. It is not pure shader execution time. See
[the SM-500 timing boundary](SM500_TIMING_BOUNDARY.md).

Production submissions do not yet adopt `performanceTimingScope.submit`, so
`commandGpuMs` stays **null**, with zero explicit command spans. Per-producer GPU
breakdown remains **NOT RUN** by this total-only observer; separate source-matched
localization is required. CPU scene preparation and synchronous scene-submit
hooks remain separate from async presenter callback wall time. Pure CPU encoding
is unavailable rather than relabelled from awaited callbacks.

Every raw timestamp and per-run/pooled mean, median, p90, p95, p99 and maximum is
retained; nearest-rank percentiles do not trim outliers. The unchanged targets
are **≤12 ms mean / ≤14.5 ms p95** for each scene's pooled queue-span samples.
Execution success and target comparison are separate report fields. A single
run, or a passing Chrome matrix, does not establish visual/release acceptance.

Resource lists deduplicate shared registries and include presenter-owned targets,
atlases and buffers. They are allocation-descriptor estimates, not driver VRAM
residency. Missing descriptors, browser swapchains/pipelines, retained WebGL2
fallback allocations and observer allocations are explicit limitations. Actual
object/light/cluster/tile/effect counts come from production producers. DSO
covered pixels remain unavailable without a separate diagnostic readback.
Firefox correctness/fallback and runtime/editor/soak acceptance remain separate.

## Qualification and watchdog gate

Planning is CPU-only and needs no GPU or qualification:

```text
python tools/benchmark_sm505_normal.py --plan --campaign
```

Physical execution requires Windows Chrome, `--hardware`, a new output directory,
an active `--guard-report` from `tools/sm505_physical_guard.py`, and a
`--qualification-report`. The guard must own this exact runner PID, have fresh
target telemetry and a live UTC deadline. Browser adapter identity is proved
independently; software/adapter overrides are rejected. The guard's original
temperature, process-containment and deadline policies still apply.

The qualification schema is `steelmoth-sm505-qualification/v1`. Its `source`
contains the exact current `commit` and complete `runtimeFileSha256` map from
the runner's `source_identity()`. `configuration` is exactly:

```json
{"width":1920,"height":1080,"dpr":1,"quality":"Medium","gtaoEnabled":false,"inspection":"none"}
```

Both `gates.normalPresentation` and `gates.visualCorrectness` must explicitly be
`"PASS"`. Evidence entries contain `kind` (`presentation` or `visual`), local
`path` and `sha256`; both roles and at least one captured JSON report are required.
Referenced files must exist and hash-match. Diagnostic `ok:true`, black fractions
or timing support do not manufacture these gates. There is no bypass or
source-equivalence exception. Every executable source-closure path must be tracked
and tracked source must be clean and unchanged throughout the run/campaign.

Reports, partial/failure records, screenshots, browser logs, qualification/source
fingerprints and SHA-256 manifests remain in the unique run directory. The guard
retains telemetry and original stdout/stderr separately. No measured dataset may
combine candidates or inspection profiles.

## Automated verification

The normal source gate and clean extraction run JavaScript syntax plus Node and
Python CPU contracts. The tests execute mocked 300+600 frame scheduling, original
drain completion, no-retry failure paths, null uncovered command timings,
resource deduplication, profile/inspection guards, and source/qualification/
watchdog/report mutations. Malformed raw records return validation errors.
These are tooling tests; they do not execute a browser or establish GPU timing.
