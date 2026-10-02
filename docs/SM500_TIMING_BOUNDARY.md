# SM-500 timing boundary hardening

This document records the timing semantics used by `engine/webgpu_performance.js` after the SM-601 GTAO investigation exposed a host-wait ambiguity in the original SM-500 pass wrapper.

## Finding

The historical SM-500 wrapper submits an empty timestamp pass before invoking an async frame-graph callback and another after the callback returns. That is a valid GPU **queue span**: it measures the GPU timestamp interval between those two queued markers. It is not necessarily pure command execution time.

If the callback submits GPU work and then waits on `mapAsync()`, `onSubmittedWorkDone()`, another host dependency, or simply delays before the ending marker is submitted, the GPU may become idle between the measured commands. That idle interval can appear in the queue-span result. It must not be attributed to shader arithmetic or memory traffic.

Existing reports are retained. Their historical `gpuMs` field remains an exact alias of `queueSpanGpuMs`; old evidence is not rewritten.

## Hardened metrics

### `queueSpanGpuMs`

Historical measurement. Empty timestamp command buffers are submitted before and after the async pass callback. It is useful as an end-to-end queue-latency signal and for comparison with retained reports, but it can contain GPU-idle gaps caused by host waits.

### `commandGpuMs`

Attribution measurement. A pass opts in through `performanceTimingScope.submit(commandBuffers)`. SM-500 places a start marker, the supplied command buffers, and an end marker into the **same `GPUQueue.submit()` call**. Multiple explicit submissions are measured individually and summed for the pass. Host time between calls is excluded from that sum.

Only command buffers explicitly submitted through this scope contribute to `commandGpuMs`. A missing command span is reported as `null`; SM-500 never guesses or derives it by subtracting CPU time.

### `hostWaitMs`

Optional wall-clock accounting for known host waits. A pass can use `recordHostWait(name, ms)` or `measureHostWait(name, callback)`. This is diagnostic CPU/host latency and is never GPU time.

### `readbackMapLatencyMs`

Wall-clock latency of SM-500's own timestamp-buffer `mapAsync()`. It describes diagnostic transport/readback latency, not GPU command execution.

## Compatibility

- `steelmoth-webgpu-performance/v1` and frame schema v1 remain unchanged.
- `gpuMs` remains populated exactly as before and aliases `queueSpanGpuMs`.
- `summary.gpuPasses` remains the historical queue-span summary.
- New explicit summaries are `gpuPassQueueSpans`, `gpuPassCommandSpans`, `passHostWaits`, and `timestampReadbackMapLatency`.
- Timestamp-query unavailable, GPU timing disabled, and instrumentation disabled paths remain functional and never fabricate times.
- Existing frame-graph passes require no modification. `attachFrameGraph()` now injects `performanceTimingScope` into the pass context for opt-in command-span adoption.

## Boundedness and attribution

Command spans use the same timestamp query set and readback ring as historical timing. The per-pass command-span count is bounded (`maxCommandSpansPerPass`, default 4), and total frame capacity is bounded by `maxPasses * maxCommandSpansPerPass`. Escaped timing scopes are invalid once their callback returns, preventing late submissions from being attributed to the wrong frame.

No queue method is monkey-patched. Production subsystems continue to own their queues and command encoders unless they explicitly adopt the scope.

## Evidence and limitations

The deterministic validator includes a synthetic clock witness where two explicit GPU submissions total about 5 ms while a 9 ms host gap occurs between them. The historical queue span includes the gap; `commandGpuMs` does not. This proves the instrumentation semantics, not real target-GPU performance.

Actual Chrome/Firefox/GTX 1650 SUPER performance claims still require the canonical physical campaign. Hosted/fake-device tests establish API behavior and accounting only.

## Adoption rule

Do not reinterpret historical queue-span datasets as command execution time. For future bottleneck attribution, prefer `commandGpuMs` only for passes with complete explicit submission coverage. Keep queue span alongside it because queue idle can still be a real end-to-end frame-latency problem.

Do not subtract CPU callback time, host wait time, or readback latency from queue span to manufacture a command-time estimate.
