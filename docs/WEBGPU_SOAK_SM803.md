# SM-803 — long-run WebGPU soak and owned-resource stability

SM-803 is the late-programme stability gate for repeated renderer lifecycle changes. It does not add a visual feature or claim browser-private VRAM measurements. The gate exercises the production SM-103 resource registry, SM-403 editor invalidation boundary, SM-404 transition graph, SM-102 backend fallback/restart path, and browser-observable WebGPU error state for long repeated sequences.

## Evidence boundary

The renderer can count resources it owns and estimate their bytes from their WebGPU descriptors. That is the evidence used here. The suite does **not** claim exact process/GPU-driver VRAM because browsers do not expose a portable authoritative value. A stable owned-resource count and descriptor-derived byte total are treated as the leak proxy required by #45.

Hosted browser execution is correctness/stability evidence, not GTX 1650 SUPER performance evidence. No CPU duration is reported as GPU timing.

## Soak monitor

`engine/webgpu_soak.js` records bounded time-series snapshots from existing diagnostics without taking ownership of GPU resources. For each stable framebuffer extent after warm-up it records:

- live resource and resource-definition counts;
- descriptor-derived renderer bytes;
- resource create/destroy/rebuild/resize counters and device generation;
- pipeline-cache population;
- SM-404 transition revision/event-log length;
- SM-403 editor revision/event-log length;
- uncaptured WebGPU error count and backend status.

The monitor rejects post-warm-up growth for a previously seen extent unless a caller explicitly supplies a bounded slack. This avoids confusing legitimate resize-dependent byte changes with a leak: each extent receives its own steady-state baseline. Transition/editor logs are separately required to respect their configured bounded history sizes.

## Deterministic stress loop

`tools/validate_webgpu_soak.js` drives 1,200 cycles against the real production JavaScript classes with a fake GPU-handle backend so lifetime accounting is exact and fast. It repeatedly:

- uploads frame-local dynamic data;
- cycles four framebuffer extents;
- performs room-change and resize invalidations;
- performs place/move/delete/undo/redo editor invalidations;
- rejects stale derived object-ID records after room changes;
- rebuilds the registry for repeated device generations;
- verifies temporal history receives history-clearing invalidation;
- verifies `createCount - destroyCount == resourceCount` throughout;
- proves a deliberately growing synthetic resource series is rejected by the monitor;
- exercises the production backend-runtime initialization-failure path and requires WebGL2 fallback;
- closes the registry and requires all owned fake GPU handles to be released.

This test is part of the normal source/regression gate and therefore also protects future changes outside the dedicated SM-803 workflow.

## Real browser soak

`webgpu-soak-smoke.html` repeats the same lifecycle patterns on a real `GPUDevice` and actual `GPUTexture`/`GPUBuffer` objects. The dedicated Windows workflow runs it with fresh temporary browser profiles using:

- Chrome: 1,500 cycles;
- Firefox: 400 cycles as the shorter cross-browser stability check.

Each browser run exercises four resize-dependent extents, dynamic uploads, room changes, editor mutation invalidation, registry device-generation rebuilds, actual WebGPU canvas reconfigure/resize calls, bounded transition/editor histories, stale-state rejection, and zero uncaptured WebGPU errors. It retains a JSON time series and diagnostic screenshot.

The browser page additionally exercises failure/recovery semantics through the production `BackendRuntime`:

1. deliberate WebGPU initialization failure must enter the WebGL2 fallback state;
2. an actual WebGL2 context must still be obtainable;
3. a fresh production WebGPU selection must recover successfully;
4. the production device-loss callback must move back to WebGL2 fallback;
5. a subsequent WebGPU restart must succeed.

Synthetic invocation of the already-production device-loss callback proves state-machine cleanup/recovery. It is not represented as proof that the browser/driver physically lost the adapter during CI.

## Acceptance mapping

1. **Long-run loops complete without accumulating validation/uncaptured errors.** Both browser reports must return `ok=true`; the final production manager diagnostics must contain zero uncaptured errors, and significant Chrome console errors fail the run.
2. **Persistent resource counts/estimated memory remain bounded after warm-up.** The monitor rejects steady-extent growth; the registry additionally proves live balance from production create/destroy counters on every cycle and zero live resources after close.
3. **Room/editor/resize transitions leave no stale state.** The soak repeatedly invalidates/rebuilds SM-403/404 state, checks bounded event history, and proves old derived object-ID records are unreadable after room transitions.
4. **Fallback/recovery remains playable.** Deliberate initialization failure and synthetic device-loss state transition both select WebGL2, an actual WebGL2 context is created, and WebGPU can subsequently restart.

The dedicated report is `artifacts/sm803/soak-report.json`. Screenshots are retained under `artifacts/sm803/screenshots/`. Exact browser versions and host metadata come from that report rather than being hard-coded in this document.
