# SM-500 WebGPU performance instrumentation

SM-500 adds measurement infrastructure only. It does not optimize the renderer, reduce quality, change `Auto`, or make a GTX 1650 Super frame-time claim. The performance acceptance gate remains SM-501 and final backend promotion remains SM-505.

## Timing authority and units

GPU time is reported only when the acquired `GPUDevice` exposes the optional `timestamp-query` feature. `WebGPUDeviceManager` already requests that feature only when the adapter advertises it. Timestamp values are WebGPU nanosecond timestamps and are converted to milliseconds after readback.

The implementation does **not** label JavaScript wall time, queue submission duration, `queue.onSubmittedWorkDone()`, or buffer mapping latency as GPU time. If timestamp queries are unavailable, every pass keeps `gpuMs: null`, `gpuAvailable: false`, and the diagnostics record an explicit unavailable reason.

`WebGPUPerformanceInstrumentation` brackets a frame-graph pass with two deliberately empty compute passes using the standardized `timestampWrites` descriptor: an end-of-pass timestamp immediately before the measured pass callback submits its work, and a beginning-of-pass timestamp immediately after the callback has submitted its work. WebGPU queue ordering therefore places the measured renderer submissions between the two timestamps even when an existing pass owns its own command encoder. This avoids pretending that host callback time is GPU execution time and avoids invasive rewrites of the already-validated pass implementations.

The cost is explicit and bounded: when GPU timing is enabled, each measured pass adds exactly two timestamp-boundary queue submissions, and each measured frame adds one query resolve/copy submission. The readback path uses a bounded persistent ring of resolve/readback buffers and does not map or wait after each pass. `flush()` is the explicit synchronization point used when a benchmark/export needs all pending timing results. Pass-level timestamp mode is therefore a diagnostic/benchmark mode rather than an invisible zero-cost production feature.

## Frame-graph integration

`attachFrameGraph(graph)` wraps selected existing `FrameGraph` pass callbacks without changing dependency order, reads/writes metadata, validation scopes, or pass-owned resource semantics. `passFilter` can exclude CPU-only stages. The default per-frame capacity is 32 timed passes and is hard bounded; overflow throws rather than silently dropping timing evidence.

The instrumentation records the pass name, frame-graph read/write metadata, host callback wall time as `cpuCallbackMs`, and—only when timestamp queries succeed—the resolved `gpuMs`. `cpuCallbackMs` is diagnostic host time and is never used as a substitute for `gpuMs`.

## CPU preparation and encoding

CPU work has an independent namespace from GPU timing. Callers use `measureCpuPhase('scenePrep', ...)` / `recordCpuPhase('scenePrep', ms)` for scene traversal, culling and data preparation, and the corresponding `encoding` phase for command construction/encoding work that the benchmark controls directly. The JSON schema exposes these as `cpu.scenePrepMs` and `cpu.encodingMs` plus named `cpu.phases`.

A benchmark must not wrap an awaited GPU-completion path and call the resulting wall time `encodingMs`. Existing pass callbacks that may await their own queue completion remain visible as `cpuCallbackMs`, which is intentionally named so it cannot be confused with GPU execution or pure command-encoding cost.

## Workload counters

`setWorkload()` accepts a nested numeric record and normalizes counts to non-negative numbers. The SM-501 benchmark should populate, at minimum:

- visible, static, dynamic and foreground instance counts;
- active and self-shadowed light counts;
- occluder count, cluster count and largest-cluster size;
- self-shadow and contact-shadow sample counts;
- DSO active tile and covered-pixel counts;
- secondary-effect extents, including contact, Dark Bloom and later indirect/volumetric buffers where present.

The schema is deliberately extensible so later passes can add counters without changing the timing authority.

## Renderer-owned memory estimates

Memory reporting is deterministic descriptor accounting, not a claim about driver VRAM residency. `setMemory()` records texture, buffer, temporal/history and explicitly external renderer-owned bytes separately. `recordRegistryMemory()` derives texture/buffer totals from the existing SM-103 `ResourceRegistry.diagnostics()` resource list and can classify named/declared temporal history separately. `totalEstimatedBytes` is the sum of those categories.

This preserves the existing SM-103 evidence boundary: allocation descriptors are measurable and reproducible, while actual driver residency, compression, heaps and allocator overhead are implementation-specific and are not inferred.

## JSON diagnostics and distributions

`diagnostics()` / `exportJSON()` emit `steelmoth-webgpu-performance/v1`. Each retained frame uses `steelmoth-webgpu-performance-frame/v1` and contains:

- distinct CPU phase timings;
- pass records with nullable GPU timing;
- workload counters;
- renderer-owned memory estimates;
- timestamp support/unavailable reason and bounded-overhead metadata.

The session retains a bounded frame history (default 1200) and exports mean, p50, p95, minimum and maximum summaries for CPU scene preparation, CPU encoding and each named GPU pass. Pending timestamp readbacks are explicit in diagnostics.

## Disabled and unavailable paths

`enabled: false` allocates no query/readback resources and `attachFrameGraph()` leaves pass callbacks untouched. `gpuTiming: false` keeps CPU/workload/memory collection available without allocating timestamp resources. An adapter without `timestamp-query` follows the same non-query diagnostics path automatically and never fabricates a GPU duration.

This separation is required so browser/adapter compatibility does not depend on an optional timing feature and so disabled-instrumentation overhead is structurally bounded to construction/branching rather than hidden GPU work.

## Benchmark protocol for SM-501

SM-500 provides the measurement substrate; SM-501 owns the actual quality-tier performance acceptance. A target benchmark using this module must follow `WEBGPU_VALIDATION_PLAN.md` §16: 300 warmup frames, at least 600 measured frames, three runs per configuration, fixed fixture/camera/light scripts, and browser/GPU/driver metadata. The required empty, representative, dense, dynamic, foliage, DSO, worst-overlap and mixed scenes remain unchanged.

Pass-level instrumentation should stay enabled for a pass-breakdown run. A second disabled-instrumentation run should be retained to quantify observer overhead before using whole-frame numbers for release decisions. Any final GTX 1650 Super mean/p95 claim belongs to SM-501, not this document.

## Verification and evidence boundary

The deterministic SM-500 validator exercises both a feature-present fake adapter and a feature-absent adapter. Its real `FrameGraph` fixture uses representative major pass names (`gbuffer`, `lighting`, `dso`, `dark-bloom`, `post`) and checks timestamp ordering against known queued-work durations, separate CPU fields, workload/memory export, explicit null GPU timings when unavailable, and the zero-resource disabled path.

The existing real-browser SM-103 resource smoke now loads SM-500, instruments the same representative major pass chain, and validates whichever timestamp capability the hosted adapter actually exposes. Hosted timing values prove query execution/readback semantics only; they are **not** target-GPU performance measurements.

The accepted SM-405 target-hardware record at `benchmarks/webgpu-gtx1650s/sm405-2026-09-19/cross-browser-functional.json` already proves that the Windows GTX 1650 SUPER Chrome adapter advertises `timestamp-query` and that `WebGPUDeviceManager` requests it. That is capability evidence only. SM-501 must run the new instrumentation on that target before any performance acceptance claim.
