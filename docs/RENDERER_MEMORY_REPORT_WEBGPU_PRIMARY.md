# WebGPU primary renderer memory report — SM-505 reconciliation

## 2026-10-31 normal-presenter candidate

The [overnight checkpoint](SM505_OVERNIGHT_2026-10-30.md) retains native telemetry
and producer resource diagnostics at `9b5b932b2f23d5203422b1de6c7d5575c481f4d1`.
The observed 427–1904 MiB device-wide memory range includes retained WebGL2,
WebGPU, the browser and diagnostic readback/replay work. It is **not** a measured
production footprint or leak result. Complete normal-presenter descriptor totals
and bounded soak acceptance remain NOT RUN. One source-defined additional
1920×1080 `rgba16float` world texture alone accounts for 16,588,800 descriptor
bytes; backdrop/legacy copies, foliage buffers and other contexts must also be
accounted separately. The historical staged totals below are not relabelled as
the new normal-presenter total.

Date: 2026-10-03  
Evidence source: accepted SM-501 reconciled physical campaign at `2e4d490f7af21a4b21a1e8e3e8c392e03968dfc4`

## Measurement semantics

SM-500 memory reporting is deterministic descriptor accounting for renderer-owned textures, buffers and temporal/history resources. It is **not** a claim about driver allocation, residency, compression, paging, browser overhead or total process VRAM.

All accepted SM-501 Chrome scene runs at native 1920x1080, DPR 1, Medium and GTAO off report the same fixed renderer-owned allocation footprint:

| Category | Bytes | Approx MiB |
| --- | ---: | ---: |
| Textures excluding separately classified histories | 178,676,016 | 170.40 |
| Temporal/history resources | 165,888,000 | 158.20 |
| Buffers | 2,577,984 | 2.46 |
| **Total estimated renderer-owned** | **347,142,000** | **331.06** |

The fixed total across canonical scenes is expected because the accepted path preallocates persistent surface-sized resources and bounded buffers; scene complexity changes active work, not those descriptor extents.

## Interpretation

The retained value is suitable for:

- detecting accidental resource-footprint changes between source-identical/candidate paths;
- confirming bounded persistent allocation policy;
- release documentation of the renderer-owned descriptor footprint.

It must not be presented as measured physical VRAM residency. The GTX 1650 SUPER campaign records a 4 GB-class target, but no percentage-of-VRAM conclusion is used as an acceptance claim because browser/driver allocation behavior is outside this accounting model.

## SM-505 disposition

No current memory contradiction blocks the accepted staged core. The missing normal-game WebGPU presentation consumer may introduce presentation/runtime resources; any future candidate must regenerate this report from the exact integrated path and explain material deltas before #50 closes.
