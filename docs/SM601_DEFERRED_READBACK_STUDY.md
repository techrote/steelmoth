# SM-601: bounded deferred diagnostic readback

Status: **opt-in runtime candidate; no target-performance acceptance**. References: issue #36, retained physical evidence PR #102, independent counter aggregation study PR #104. The SM-501 branch/PR #92 is not changed.

## Scope and source

This study adds `engine/webgpu_gtao_readback.js`, an opt-in subclass/adapter of the existing `WebGPUGTAOTemporal`. It reuses the production temporal WGSL, quality resolver, uniform serializer, history textures, resource registry and output bindings. It does not introduce new AO equations or combine the independent PR #104 counter-shader change.

Baseline: main `73b6f1222b47219966130a3b135067ef74d65e39`; `engine/webgpu_gtao_stabilization.js` blob `8df297355612a7955baa2ce945e54fac12d8ee0d`, also present at the physical measurement source `5d1258032b27af270a925e29379e01bc84acf1d7`.

All existing runtime files and their callers remain unchanged. In particular the existing acceptance benchmark still selects the original producer and retains its original timing boundary. The new adapter is loaded only by its standalone study page until a separate adoption decision. This is executable producer code, not a placeholder, but it is not automatically enabled in the game.

## Confirmed synchronization boundary

The original temporal `update()` submits its compute pass and a 32-byte diagnostic copy. It suppresses `onSubmittedWorkDone()` when `wait:false`, but always awaits the diagnostic buffer's `mapAsync()` before returning or advancing its CPU-side history index.

The existing SM-500 wrapper submits its ending timestamp after the callback returns. Consequently the enclosing queue-span measurement can include idle intervals caused by CPU scheduling and diagnostic-readback delivery. The recorded approximately 2.88 ms physical result remains real evidence for that path, not a measured shader-only cost. This source inspection does not determine how much of the result comes from the mapping wait or promise a speedup.

WebGPU mapping makes a buffer unavailable for GPU reuse while mapped, and promise settlement ordering across different buffers is not guaranteed. The design therefore owns explicit slot state and frame identity rather than assuming completion order. Primary specification: [WebGPU buffer mapping and asynchronous operations](https://www.w3.org/TR/webgpu/#buffer-mapping).

## Opt-in API

Load `webgpu_resources.js`, `webgpu_gtao_stabilization.js`, then `webgpu_gtao_readback.js`.

```js
const temporal = new SteelMothWebGPUGTAOReadback.WebGPUGTAOTemporal({
  device,
  width: 1920,
  height: 1080,
  statsMode: 'deferred',
  statsSlots: 3,
});

const diagnostics = await temporal.update(
  temporal.sourceFromPaths(gtao, depthHierarchy, gbuffer),
  {
    wait: false,
    quality: 'Medium',
    meta: { roomId, deviceGeneration, backendGeneration },
  },
);
// Submission/history advancement is complete. Diagnostic mapping need not be.
const visibility = temporal.bindings().visibility;

// Outside the frame-critical path, explicitly drain current in-flight samples.
await temporal.flushStats();
const samples = temporal.takeCompletedStats();
```

The adapter defaults to `statsMode:'blocking'` unless explicitly configured otherwise. A per-update `statsMode` can override the constructor setting. `wait` remains a separate queue-completion option: the nonblocking path requires **deferred statistics and `wait:false`**. Compilation/initialization can still await its ordinary readiness work. Explicit blocking mode returns that frame's counters or rejects on mapping/lifecycle failure.

Updates on one producer must be serialized by awaiting submission. Overlapping `update()` calls fail explicitly rather than queueing an unbounded set of operations or racing the ping-pong history.

## Boundedness and frame attribution

The ring contains three 32-byte staging buffers by default, strictly configurable to 1–8 slots. The first slot reuses the original registry-owned `statsReadback` buffer; additional slots add only `(slots - 1) * 32` bytes of staging payload, excluding browser allocation overhead. All slots are visible in the existing resource registry. Slot capacity is immutable after construction.

Each copied sample carries its submission sequence, telemetry epoch, producer generation, dimensions, quality, room ID, device generation and backend generation. Submission sequences do not restart on resize or device replacement. A completion may update the latest diagnostics only if its epoch is current and its frame sequence is newer than the published result. Late completion never advances rendering history.

`lastStats` can be absent or belong to an older completed frame. Consumers must inspect `readback.lastStatsFrame` and `readback.statsForCurrentFrame`; delayed statistics are never relabeled as current. All eight words are copied before unmapping and checked against frame extent and rejection-total invariants.

There are two explicit telemetry-loss boundaries:

- **No free staging slot:** deferred mode skips the new diagnostic copy, increments `skipped`, and records the skipped frame. The full temporal shader, all per-pixel output/rejection semantics, and its GPU counters still execute. No new buffer is allocated and rendering does not await a free slot.
- **Undrained completed-record history:** at most `statsSlots` completed records are retained. Older records are evicted with an explicit `evicted` count. The newest published result is retained separately.

`takeCompletedStats()` consumes the retained records. For lossless diagnostic collection use blocking mode, or explicitly drain batches no larger than the ring outside the measured frame span. A bounded nonblocking producer cannot promise unlimited lossless telemetry when a consumer stops draining it.

## Lifecycle and failures

Resize/reconfigure, explicit invalidation, room/device/backend discontinuities and quality transitions invalidate diagnostic attribution. Pending mappings are cancelled; slots are not reused until their old completion/finalization has settled. New registry generations have their own bounded pool. Old callbacks cannot write the new producer's diagnostics.

Device loss invalidates history and statistics and rejects new submissions until explicit device reset. Late loss from a replaced device is ignored. Close is idempotent, cancels mappings and leaves no usable output bindings. Compilation completion is generation-checked before installing a pipeline.

Map rejection or invalid counter contents are reported as telemetry failures in deferred mode without silently fabricating data or invalidating otherwise submitted rendering work. Blocking callers receive an error. Failed unmapping retires a slot instead of risking mapped-buffer reuse. Submission failure releases its reserved slot without advancing history. Deferred completion promises handle rejection internally, including teardown cancellation.

## Verification entrypoints

```text
node tools/validate_sm601_gtao_readback.js --report artifacts/sm601-readback-cpu.json
python tools/run_sm601_gtao_readback_study.py --report artifacts/sm601-readback-browser.json
```

The CPU suite exercises controlled slow and out-of-order maps, full-ring behavior, current-frame blocking compatibility, independent queue waiting, cancellation, resize, three metadata discontinuities, device loss/reset, close, synchronous/asynchronous mapping failures, failed unmapping, invalid counter totals, concurrent calls, delayed compilation, submission failure, malformed inputs, retention limits, tier changes and a 512-frame seeded stress sequence. These are mocked API-ordering tests, not GPU measurements.

The browser suite uses the actual unchanged WGSL and real resource registry. It compares all four history textures byte-for-byte and all eight counter words exactly over 56 frame/extent cases, including odd and one-dimensional extents, changing objects/depth/normals, global resets and disabled temporal reuse. It also checks an independent CPU visibility reference. A real-buffer fault-injection case deliberately delays JavaScript delivery of successful mappings, fills a two-slot pool over six submitted frames, and proves final texture equality while four diagnostic copies are explicitly skipped.

The dedicated workflow uses software WebGPU only, with one bounded job and a ten-minute timeout. Missing WebGPU, validation failures or timeouts fail the job; they are not converted into passing skips. Existing repository verification remains independent.

## Physical diagnostic handoff

Do not run this on unavailable/shared target hardware merely to obtain a number. When the GTX 1650 SUPER is available:

```text
python tools/run_sm601_gtao_readback_study.py --hardware --benchmark --runs 3 --width 1920 --height 1080 --warmup 300 --samples 600 --timeout 1800 --report artifacts/sm601-readback-physical.json
```

Each run creates a fresh browser process. The bounded diagnostic compares original blocking and candidate deferred paths in alternating order, with unchanged Medium 6-direction × 4-step raw GTAO. It records separate raw-horizon, reconstruction and temporal compute-pass timestamps, an enclosing **instrumented queue span**, CPU callback duration, and diagnostic-map CPU latency. Query and remaining diagnostic drains occur outside the recorded callback/queue span. The test-only device proxy adds pass timestamps without changing production shader sources. Every positive timestamp sample is retained; invalid/zero samples fail rather than being silently filtered.

This uses synthetic canonical-format depth/normal/object fixtures, not the full game or original SM-601 acceptance workload. Extra timestamp instrumentation and isolated scheduling differ from the historical campaign. **Do not subtract CPU/map latency from queue spans, infer shader-only cost from their difference, or substitute these rows for acceptance evidence.**

Software runs never collect performance timings. The physical-only timing branch requires explicit `--hardware --benchmark` and is not hardware-validated by software correctness success.

## Acceptance disposition

No GTX 1650 SUPER measurement or performance improvement is claimed by this change. Keep #36 open and SM-602 blocked; keep the original quality, visibility, timing targets and release defaults. Review this adapter independently of PR #104. If physical evidence supports adopting deferred scheduling, integrate it deliberately and rerun the unchanged full moving-scene SM-601 acceptance campaign on exact source. PR #92's pending SM-501 measurement remains independent.
