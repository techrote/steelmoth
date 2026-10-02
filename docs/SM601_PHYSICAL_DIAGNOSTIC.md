# SM-601 current-main physical diagnostic

This harness localizes the production GTAO path without editing existing engine
files, production shaders, quality policy, acceptance reports or release defaults.
It is diagnostic evidence only. Full acceptance remains the unchanged canonical
moving-scene campaign and human visual review where required.

`webgpu-gtao-physical-diagnostic.html` copies the canonical `dynamic-robot`
`buildScene()` function from `webgpu-target-benchmark.html`. The preservation test
requires exact equality after newline normalization and pins all three deployed
GTAO shader hashes. Scene preparation remains outside the GTAO measurement.

The two production producers receive a constructor `queue` facade. This facade
routes their two command-buffer submissions explicitly through the current
SM-500 timing scope. The native queue is never patched. Command coverage includes
raw plus reconstruction in one submission and temporal plus its 32-byte stats
copy in the other. Parameter `writeBuffer()` operations retain their existing
ordering; their transfer cost is not inferred as command execution time.

A probe-only device/encoder facade adds timestamps to the actual raw,
reconstruction and temporal compute passes. Two empty timestamp compute passes
also bracket the stats copy inside its original command buffer. The resulting
copy interval includes transitions and observer costs and may quantize to zero;
it cannot establish an uninstrumented 32-byte transfer cost. Diagnostic atomics
remain inside the temporal shader. Their contribution requires the separate
counter A/B study, never CPU subtraction.

Each retained row keeps the eight direct timestamp values as decimal nanosecond
strings, direct intervals, counters, native stats-map host latency and CPU
parameter-write-to-submit intervals. The complete current SM-500 frame report
retains callback queue span, both explicit command spans, callback wall time,
explicit map host wait and timestamp-readback map latency. Awaited callbacks are
not relabeled as pure CPU encoding.

The direct and SM-500 timestamp transports each use eight persistent slots.
All timestamp resolves/maps are outside the measured GTAO callback. Additional
markers, resolves and diagnostic transport impose observer work, so this report
does not replace the historical-compatible unmodified acceptance baseline.
GPU counters must satisfy the existing exact production semantics; no counter,
copy or rejection work is removed.

Run CPU/source-preservation checks first:

```text
node tools/validate_sm601_physical_diagnostic.js
```

Run on the physical target with a new output path:

```text
python tools/run_sm601_physical_diagnostic.py --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --runs 3 --warmup 300 --samples 600 --timeout 1200 --report artifacts/sm601-main-physical-diagnostic.json
```

The runner requires clean tracked source, records exact Git SHA and all relevant
source hashes, inventories the physical NVIDIA device/driver, creates three fresh
Chrome processes/profiles, and refuses to overwrite an existing report. The page
requires unscaled 1920x1080 render attachments/DPR 1, a nonfallback NVIDIA Turing adapter, and genuine
timestamp queries. If adapter exposure is opaque, the sole NVIDIA device must
identify the GTX 1650 SUPER so the adapter-family and inventory conjunction is
unambiguous. Inspect the retained adapter fields before treating any result as
authoritative. Failures stop the bounded campaign; no until-passing retries occur.
Desktop physical dimensions are retained independently; the runner never changes
the desktop display mode.

The test suite proves source preservation and queue-facade accounting only.
Actual target execution, costs, visual acceptance and adoption are established by
the physical reports, not by this document or mocked tests. #36 remains open and
SM-602 remains blocked until its real criteria are satisfied.

## Physical instrumentation blocker — 2026-10-03

The first physical diagnostic at clean source
`d69faf9bad7b70ec6d0ecadcc086dfc06412d140` retained 600 rows after 300 warm-up
frames on the nonfallback NVIDIA Turing adapter in Chrome `154.0.8037.92`.
The campaign inventory identified the GTX 1650 SUPER. The run failed, as required,
because every SM-500 queue and command result was zero. The retained local report
is `artifacts/physical-campaign-2026-10-02/main-d69faf9-decomposition/diagnostic.json`.
Do not reinterpret those zero results as valid performance or replace the frozen
file with a repaired run.

The independent direct-pass timestamps remain positive: their 600-sample means
are raw horizon **0.214035 ms**, reconstruction **0.185324 ms**, and temporal
compute **0.683761 ms**. These are one diagnostic process with observer work,
not a completed three-run baseline or acceptance distribution. No valid enclosing
SM-500 queue/command attribution can be made from this failed report.

Source investigation found that SM-500 packed the command-query resolve at
`queueUsed * 8` bytes: 16 bytes for this one-pass case. The
[WebGPU resolveQuerySet validation contract](https://www.w3.org/TR/webgpu/#dom-gpucommandencoder-resolvequeryset)
requires each destination offset to be a multiple of 256 and its resolved range
to fit the buffer. The invalid resolve invalidated the encoder; the original
mock did not enforce either constraint, and zero-duration checks in the tiny
resource smoke could not distinguish invalid API work from timer precision.

The repair keeps the queue section at offset zero, adds a fixed 256-byte-aligned
command section after maximum queue capacity, sizes both persistent ring buffers
for padding plus maximum command capacity, and decodes command results from that
section. Queue-only resolve/copy layout and historical aliases are preserved.
The mock now rejects invalid offsets/ranges and checks changing pass/submission
counts across reused slots. The real resource smoke collects API errors before
interpreting timings. The diagnostic likewise pops its validation scope before
numeric guards and captures any outstanding scoped error during cleanup.

Repaired source requires new physical evidence. The failed sample set remains
retained as a precise instrumentation defect, with no weakening of timestamp or
acceptance gates and no implied production GTAO adoption.
