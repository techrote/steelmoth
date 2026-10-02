# SM-601 native four-way adoption comparison

This is a diagnostic comparison, not production adoption or SM-601 acceptance.
It independently compares original blocking, aggregated counters with blocking,
original counters with deferred delivery, and their combination on the canonical
native `dynamic-robot` fixture. Existing production files, quality policy,
acceptance harnesses and prior evidence remain unchanged.

The original PR #105 adapter at `dad8c46d371522c699ecbeeb1770cfc2e6a29443`
is copied unchanged to `tools/experiments/frozen_sm601_readback.js` (Git blob
`f4f82852d3bf04b5c9c665f5370f1a7f915325ff`). The original PR #104 generator at
`ad06d9f128f7d2494e467da8d6b47de7151e606a` is copied unchanged to
`tools/experiments/frozen_sm601_counter.js` (Git blob
`af765d115a0b8f02684c4d7a68d5549ba100a2e4`). Whole-module source guards refuse
drift. Only a test device facade substitutes the exact guarded counter WGSL;
the deployed pixel math, parameters, formats and reconstruction cutoff remain
unchanged. No arithmetic/cache candidate is included.

The canonical `buildScene()` function is copied byte-for-byte after newline
normalization. Each producer owns independent ping-pong history and receives the
same moving actor/light frame and room metadata. Uninitialized, moving, room
discontinuity and explicit-reset snapshots read all four full-HD temporal output
textures and all eight actual GPU counter words. Texture equality is byte-exact;
hashes and counter words are retained. Rejection assertions establish that the
labels correspond to exercised behavior. This does not establish human visual
stability or complete backend/device-transition acceptance.

Each fresh Chrome process warms up 300 frames per variant and retains at least
600 frames per variant. Order rotates every logical frame, with process offsets
0/1/2; at 600 frames each variant appears 150 times in every position per process.
Scene preparation is shared outside all callbacks. A queue facade explicitly
routes the raw+reconstruction and temporal+stats-copy submissions through current
SM-500. Native queue methods are never patched. Direct timestamps enclose the
three real compute passes; the temporal command span additionally includes the
32-byte diagnostic copy. All raw direct timestamps and complete SM-500 frames
are retained, with per-variant summaries rather than a pooled adoption statistic.

The frozen deferred adapter requests mapping inside `update()` but does not await
completion. Map latency is retained as asynchronous host transport, never as a
callback host wait after its timing scope closes. Remaining drains occur after
all four variants of each frame, outside every measured callback and queue span.
Each deferred producer has three slots. This campaign requires lossless per-frame
diagnostics and refuses skipped/failed/evicted records; the separate PR #105
saturation fault-injection evidence remains independent.

Four producers, shared raw GTAO, and eight-slot direct/SM-500 timestamp rings are
bounded persistent resources. Four histories have approximately 380 MiB of
descriptor payload; full-HD snapshot staging and CPU comparison storage are used
only outside measurement. Shared queue scheduling, pending mapping delivery and
timestamp transport can influence subsequent variants. Rotation controls order
bias but does not turn this into freely pipelined game-throughput measurement.
Extra query/marker/resolve/map work and mapped-word observation are disclosed.
There are no extra empty copy-bracketing passes, unlike the earlier Phase 2
diagnostic; those distributions must remain separate. CPU time is never
subtracted from queue timestamps.

Source/accounting tests, without GPU execution:

```text
node tools/validate_sm601_adoption_comparison.js
```

Run three fresh physical Chrome processes with a new report path:

```text
python tools/run_sm601_adoption_comparison.py --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --runs 3 --warmup 300 --samples 600 --timeout 1800 --report artifacts/sm601-native-four-way.json
```

The runner refuses overwrite, dirty tracked state, wrong target inventory,
fallback adapters, missing timestamps, source/driver/browser changes and invalid
sample counts. It retains Git SHA, whole-source hashes, frozen-source identities,
native adapter information, driver inventory, fresh process/profile identity,
render resolution/DPR, raw rows, exact snapshots and API failures. The page keeps
desktop dimensions as metadata while requiring unscaled 1920x1080 attachments
and DPR 1. One failure stops the bounded campaign.

No physical outcome is claimed by creating this tooling. Any adoption must be a
new production patch from current main, justified by these native comparisons
and followed by the unchanged full moving-scene SM-601 acceptance campaign.
#36 remains open; SM-602 remains blocked until genuine acceptance is complete.
