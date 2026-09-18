# SM-306 — Temporal stabilization for Dark Bloom and far penumbra

## Contract

SM-306 adds temporal history only to the low-frequency `r32float` Dark Bloom residual produced after SM-305. The hard DSO core, canonical object ownership, dominant-cluster ownership and Material-v2 depth remain current-frame authoritative and are never temporally smoothed.

The production path retains two persistent ping-pong history sets for residual, canonical SM-203 pseudo-depth range and SM-202 object ID. CPU-side validity state retains the current room, quantized geometry-only cluster signature and player-light state. A frame may reuse soft history only when all of those domains remain compatible.

## Acceptance and rejection

History is accepted per pixel when:

- the history set is initialized and not globally invalidated;
- the current pixel is outside the DSO hard core;
- nearest/farthest pseudo-depth remains within the configured compatibility threshold;
- canonical object ID is unchanged; and
- CPU validity has not detected a room, cluster or light discontinuity.

History is globally rejected on room change, resize/reconfigure, device reset, explicit/editor invalidation, large cluster movement/deletion, light-ID change, light-angle discontinuity or large light-position movement. The default light gate accepts the scripted slow-motion case (2 degrees and 1 pixel) but rejects changes above 6 degrees or 12 pixels. Geometry-only cluster bounds are quantized to 4-pixel cells so sub-pixel/noise motion does not discard useful history while large movement does.

## Anti-trail policy

Accepted history is not blended blindly. Before accumulation, the previous residual is clamped to the 3x3 current-frame residual neighborhood. This local envelope prevents a previously soft bin/beam silhouette from persisting after the current low-frequency field has disappeared from that area. Hard-core pixels are written as zero residual every frame regardless of history.

The default temporal weight is 0.72 and is clamped to 0..0.95. Temporal accumulation is exponential only within the soft residual field; it is not a substitute for a correct static SM-303/304/305 result.

## Diagnostics

The GPU records accepted, rejected, hard-core, depth, object and global rejection counts. Diagnostics expose accepted/rejected percentages, the reset reason, light delta, cluster signature, history weight and the explicit `hardCoreUnsmooth`, `neighborhoodClamp` and `softHistoryOnly` scope markers.

The dedicated browser sequence forces slow light motion, light teleport, local object-ID and depth discontinuities, large cluster movement, room transition, explicit editor invalidation and resize/reconfigure. GPU `r32float` readback is compared with the deterministic CPU temporal reference where applicable. Hosted CI retains a debug screenshot but does not claim human visual review or GTX 1650 Super GPU timing; wall-clock submit measurements are diagnostic only.

## Lifecycle boundary

SM-306 is still a staged WebGPU representation module. `Auto` remains WebGL2 until the later backend-cutover task. GTAO/SSGI history is not introduced here; future history users may reuse the validity concepts only after their own tests exist.
