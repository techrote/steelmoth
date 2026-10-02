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
