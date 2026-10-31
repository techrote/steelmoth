# SM-505 frame completion and backpressure

The normal presenter awaits `GPUQueue.onSubmittedWorkDone()` after submitting
the frame's presentation commands. `_drain` retains at most one in-flight GPU
frame and one latest pending cosmetic scene. New snapshots replace pending
snapshots while gameplay continues independently; they do not create an
unbounded GPU submission backlog.

`submittedFrames` counts frames submitted to this completion boundary.
`completedFrames` and the compatibility field `presentedFrames` advance only
after the queue completion promise succeeds and the presenter is still open.
These counters prove completed presentation commands, not delivery by the browser
compositor or display. Actual displayed-frame evidence still requires a capture.
`waitingForGPU` describes the outstanding completion wait.

`lastHostCompletionWaitMs` is host wall-clock latency around the queue completion
promise. It includes scheduling/notification effects and is **not GPU execution
time**. It must not replace GPU timestamps, be subtracted from a queue span, or
be used as a renderer performance result.

Missing completion support fails explicitly. A rejected completion promise takes
the existing failure/fallback path; it does not count a completed frame or retry
the workload. A presenter closed during a wait cannot publish completion or send
a stale failure notification to a replacement presenter. External diagnostic
deadlines and the physical watchdog remain necessary for bounded execution.

## Timing and verification limits

The actual-index benchmark observer awaits the original `_drain`, including this
completion boundary. Its SM-500 `rendererTotal` remains a GPU timestamp **queue
span**. The callback's host completion wait can delay submission of the ending
marker and introduce GPU-idle time into that span. Explicit command coverage is
still zero, so `commandGpuMs` remains `null`. See
[the timing boundary](SM500_TIMING_BOUNDARY.md) and
[normal benchmark contract](SM505_NORMAL_PRESENTATION_BENCHMARK.md).

[`validate_sm505_frame_completion.js`](../tools/validate_sm505_frame_completion.js)
uses deferred CPU queue promises to verify bounded latest-scene behavior,
completion-before-counting, host-time labels, cancellation, rejection and no
automatic retry. It is run by core and clean-package gates. This test does not
execute a GPU or establish performance, visual or browser compatibility.

The earlier b5 hosted failure involved shared-image/context loss. Its underlying
cause remains unknown. Backpressure is a boundedness/accounting repair; it does
not prove that failure's cause or claim the hosted failure is fixed. Preserve the
original failure snapshot and obtain fresh source-matched native/CI evidence.
