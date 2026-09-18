# WebGPU resource and frame infrastructure

Status: **SM-103 implementation contract**

This document defines the persistent resource, upload, pass-order and pipeline-cache substrate introduced by SM-103. It sits below later WebGPU rendering work and above the SM-102 device lifecycle. It does not implement Material-v2 parity, a G-buffer, lighting, shadow visuals, or final WebGPU presentation.

## Resource ownership and lifetime

`engine/webgpu_resources.js` owns four backend-neutral infrastructure objects:

- `ResourceRegistry` — named persistent GPU textures/buffers plus lifetime and memory-accounting metadata;
- `PipelineCache` — keyed render/compute pipeline creation with validation scopes and generation invalidation;
- `FrameGraph` — explicit named pass dependencies and deterministic topological execution;
- `WebGPUInfrastructure` — one lifecycle owner that binds the registry, pipeline cache and frame graph to a `GPUDevice`.

The registry stores **definitions** separately from live GPU handles. Definitions are the authority needed to recreate resources after a surface resize or backend/device reset. Ordinary frame execution reuses existing handles; it does not rebuild textures or buffers merely because another frame began.

Every created resource receives a debug label. All registry records expose their lifetime, usage, current generation, creation/rebuild counters, dimensions or size, format where applicable, and an estimated byte count.

The byte count is deterministic accounting derived from descriptor dimensions, format, mip count and sample count. It is **not** a measured driver allocation or VRAM residency figure.

## Resize and backend reset

Surface-dependent texture definitions use `size: 'surface'`, optionally with a scale. `ResourceRegistry.resize(width,height)` rebuilds only definitions marked resize-dependent. Fixed-size textures, static buffers and bounded dynamic upload arenas survive a pure surface resize.

`resetDevice(device)` advances the registry generation and rebuilds all live definitions on the new device. `PipelineCache.resetDevice()` clears cached pipeline handles, and the frame graph is rebound to the replacement device. This is the explicit invalidation path for future backend/device recovery; stale handles are never intentionally retained across a device replacement.

`BackendRuntime` creates an empty `WebGPUInfrastructure` once explicit WebGPU platform initialization succeeds. SM-103 still leaves presentation ownership with WebGL2. A device-loss fallback closes the infrastructure before returning to the compatibility backend.

## Static and dynamic uploads

Static and dynamic uploads are deliberately different paths.

`uploadStatic(name,data,{maxBytes,usage})` owns a persistent named buffer. It may grow geometrically when the caller explicitly permits a larger `maxBytes`, but it is not recreated every frame. This path is intended for room/static instance data, occluder tables and similar data that changes only on invalidation.

`ensureDynamicArena(name,{capacity,usage,alignment})` allocates one bounded persistent upload buffer. `uploadDynamic()` suballocates aligned ranges from that arena. `beginFrame()` resets only arena cursors; the buffer handle persists. Exceeding the declared arena capacity throws rather than silently allocating another per-frame buffer.

The default infrastructure dynamic arena budget is 1 MiB when a caller does not specify another bound. Future passes should choose explicit bounds appropriate to their data rather than relying on unbounded growth.

Both upload paths require `GPUQueue.writeBuffer` at the point data is uploaded. Constructing the infrastructure itself does not require queue work, which keeps device/platform lifecycle initialization isolated from later render submissions.

## Frame graph

`FrameGraph` uses explicit named dependencies. Each pass declares:

- `name`;
- `after` / `dependsOn` pass names;
- diagnostic `reads` and `writes` resource names;
- an `execute(context)` function;
- optional enabled state.

Compilation performs a stable topological sort. Missing dependencies and dependency cycles are hard errors. Resource `reads`/`writes` are inspectable metadata in SM-103; they do **not** implicitly infer ordering. Later tasks must continue declaring the actual dependency edges so pass order remains reviewable.

Every executing pass is wrapped in a WebGPU validation error scope when the device exposes `pushErrorScope()` / `popErrorScope()`. A scoped validation error fails the pass and records the pass name in frame-graph diagnostics.

This structure is intentionally general enough for future raster, compute, temporal-history, transparent and post passes without deciding their algorithms in SM-103.

## Pipeline cache

`PipelineCache` stores render and compute pipeline objects under explicit caller keys. Cache misses create the requested pipeline within a validation scope; cache hits reuse the same object. Device reset clears the cache and advances its generation.

SM-103 provides creation helpers but no production WGSL module or production renderer pipeline. Shader compilation information, concrete bind-group/pipeline descriptors, real production entry points and comprehensive resource/API validation remain SM-104 responsibilities.

Compute is not preferred by default. Q-005 remains authoritative: compute conversions must be justified by dataflow or measurement; conventional render passes remain valid.

## Diagnostics

`WebGPUInfrastructure.diagnostics()` nests three versioned diagnostic surfaces:

- `steelmoth-webgpu-resources/v1` — extent, generation, definitions/resources, formats, dimensions/sizes, usage, estimated bytes, create/destroy/rebuild/resize counters, static/dynamic upload totals and dynamic-arena peaks;
- `steelmoth-webgpu-pipeline-cache/v1` — generation, cache size, hit/miss/clear counts and keys;
- `steelmoth-webgpu-frame-graph/v1` — compiled order, explicit dependency/read/write metadata, compile/execution counts and last pass error.

`BackendRuntime.diagnostics()` exposes this aggregate as `webgpuInfrastructure` when explicit WebGPU initialization is active. Gameplay state does not depend on these diagnostics or on successful resource creation.

## Non-goals and future ownership

SM-103 deliberately does not:

- create the Material-v2 WebGPU G-buffer;
- decide fragment ownership/pseudo-depth;
- implement lighting, DSO, Dark Bloom, GTAO, SSGI, volumetrics or transparent effects;
- promote WebGPU to the normal `Auto` presentation backend;
- require optional WebGPU features;
- introduce render bundles or `executeBundles` before profiling justifies them;
- claim hardware memory usage or GPU performance from accounting estimates.

SM-104 owns production WGSL/API/resource validation. SM-200 and later rendering issues populate this infrastructure with real frame resources and passes. SM-505 remains the only issue allowed to promote the normal `Auto` path to WebGPU-first.

## Verification and evidence boundary

Deterministic fake-device tests cover persistence, resize-selective rebuilding, full device reset, bounded static/dynamic uploads, dynamic-cursor reset, explicit frame-graph ordering, missing/cyclic dependency rejection, validation-scope failures, pipeline cache reuse and diagnostic accounting.

A separate hosted-browser smoke creates real WebGPU buffers/textures when the CI browser exposes a usable WebGPU adapter, runs repeated scoped frame-graph passes, submits command buffers, and resizes the surface-dependent registry resources repeatedly. If hosted WebGPU is unavailable, the deterministic unit tests remain the resource-lifecycle evidence while the existing SM-102 browser smoke verifies safe platform fallback.

Hosted software/browser success is API and lifecycle correctness evidence only. It is not GTX 1650 Super compatibility, VRAM residency, visual parity or GPU-performance evidence.
