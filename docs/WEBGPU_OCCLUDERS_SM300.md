# SM-300 WebGPU occluder representation and tile-binning contract

SM-300 establishes the bounded GPU data path used by later SM-301 clustering and SM-302 Deep Silhouette Occlusion. It represents scene `OccluderInstance` records compactly, partitions static and dynamic updates, and bins only substantial macro occluders into deterministic 32-pixel logical screen/world tiles. It does not create clusters or shade shadows.

## Identity and record ABI

The production record stride is 64 bytes. Each record carries the canonical numeric object key, classification flags, material/silhouette profile hash, source hash, logical bounds, shared root/contact position, min/max pseudo-Z, layer, strength, and a stable-id hash. Numeric object keys use the same FNV-1a authority as the Material-v2 G-buffer (`objectIdForStableId`); an explicit non-zero `OccluderInstance.objectId` wins when supplied.

SM-300 does not derive identity from sprite names. The textual render-scene occluder ID/source is the fallback identity basis, and profile hashing consumes material/silhouette metadata rather than a hard-coded sprite table.

## Substantial versus receiver-only policy

Authored metadata has priority. `majorOccluder`/`macroOccluder` can opt an occluder into the macro path; `receiverOnly` or explicit false macro metadata keeps it out. Otherwise the bounded geometric fallback treats an occluder as substantial when any of these are true: footprint area is at least 72 logical pixels squared, maximum footprint extent is at least 12 logical pixels, or pseudo-Z reaches at least 4 logical units. Non-substantial records remain inspectable receiver-only records but are never inserted in the major-occluder tile lists, so tiny decor cannot bridge or expand later clusters.

This is deliberately metadata/geometry driven. A future asset classification refinement should extend atlas/material metadata instead of adding sprite-name exceptions.

## Spatial bins and caps

The default logical tile size is 32 pixels. Tile dimensions use ceiling division over the frame logical size. Each tile stores an offset/count header into a flat `u32` record-index list. Defaults are bounded to 512 occluder records, 32 substantial references per tile, and 8192 total tile references. Global and per-tile overflow are counted explicitly in diagnostics; overflow never allocates unbounded memory.

The current game has a fixed 640x360 logical room projection, so these bins simultaneously represent screen and pseudo-world XY relevance. This contract can later be generalized to a camera transform without changing the packed occluder ABI.

## Static/dynamic update strategy

Records are deterministically sorted by numeric object ID and stable text ID, with static records packed before dynamic records. Static and dynamic byte signatures are tracked separately. A dynamic-only movement rewrites only the dynamic record range; static changes rewrite the static range and relocate/rewrite the dynamic tail as necessary. Tile headers/references are rebuilt whenever scene membership or placement changes because spatial relevance depends on both classes.

Room changes, editor changes, resize, and device reset invalidate public bindings. Stale buffers cannot be sampled through the public API until a complete rebuild succeeds. Removal tests explicitly prove that invalidated/rebuilt scenes do not expose stale prior-room records.

## Shared depth hierarchy boundary

SM-300 is staged immediately after the canonical SM-203 min/max pseudo-depth hierarchy. It does not construct or own another depth pyramid. Later clustering/DSO passes can consume both the shared SM-203 hierarchy and SM-300 tile/object data according to their distinct roles: hierarchy for occupied depth range queries, tiles for bounded occluder candidate relevance.

## Diagnostics and debug view

Diagnostics expose active/static/dynamic/substantial/receiver-only counts, global and tile-reference overflow, non-empty tile count, maximum occupancy, signatures, upload counts, invalidation state, and resource diagnostics. `debugTileOverlay()` emits tile rectangles, membership counts, overflow markers, and object IDs; the browser smoke draws these primitives to a diagnostic canvas.

## Verification boundary

Deterministic Node checks cover source-order invariance, the 64-byte ABI, static/dynamic partitioning, receiver-only exclusion, explicit classification overrides, dense-room caps, and tile-reference bounds. Required hosted WebGPU validation additionally performs actual storage-buffer uploads and readback, proves dynamic-only updates avoid static re-upload, rejects stale bindings after editor invalidation, removes stale records after editor/room rebuilds, and exercises the debug overlay.

Passing SM-300 proves bounded representation, update, relevance, invalidation, and GPU-buffer correctness. It does not prove SM-301 cluster quality, SM-302 DSO visibility, target-GPU performance, or subjective shadow appearance.
