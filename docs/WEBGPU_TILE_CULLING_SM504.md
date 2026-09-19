# SM-504 — reusable WebGPU tile/light culling

SM-504 introduces one reusable screen-tile relevance snapshot for expensive WebGPU work. It deliberately **reuses the SM-300 32×32 tile grid as the single tile authority** rather than creating a second lighting grid. The new state is derived data only: authored world state remains in `RenderScene`, canonical direct lights remain SM-204 state, and macro-occluder/cluster/dominance authority remains SM-300–302.

## Shared tile ABI

`engine/webgpu_tile_culling.js` consumes an SM-300 occluder snapshot plus the ordered canonical SM-204 light list. Each 16-byte tile record contains four `u32` values:

1. bounded flags (`OCCLUDER`, `STATIC`, `DYNAMIC`, optional `TRANSPARENT`, `LIT`, `DSO_RELEVANT`);
2. SM-300 occluder count for the tile;
3. offset into the canonical light-reference array;
4. conservative relevant-light count.

Light membership uses each canonical light's screen-space radius AABB and `SM-300 Occluders.tileRange`. This is conservative: it may retain lights in corner pixels outside the circular/cone influence, but it cannot discard a light that the SM-204 shading equation could use. The snapshot stores canonical light IDs and fails closed if a consumer presents a reordered/stale light list.

`WebGPUSharedTileBuffers` uploads that exact CPU snapshot to bounded storage buffers. The browser gate runs a real WebGPU compute consumer over the ABI and reads the tile counts back; it is not a source-only contract.

## Direct light relevance and parity

The direct-light consumer helper resolves the tile at a pixel, gathers only the tile's canonical light references and calls the existing SM-204 CPU shading reference. A deterministic 256×128 two-light fixture samples more than 500 points with culling on/off and requires maximum channel error below `2e-6`. Because the list is conservative and the original shader already rejects out-of-radius/cone samples, this is an exact relevance optimization rather than a new lighting model.

The same fixture records candidate work as pixel×light tests. The SM-504 gate requires a material reduction (greater than 45% in the bounded fixture) while rejecting any light-reference overflow. Diagnostics expose baseline, submitted and avoided pixel-light candidates, lit/unlit tile counts, maximum list length and overflow state.

## DSO work skipping

DSO keeps its existing SM-303 job and tile-header authority. `withDSORelevance()` projects those authoritative non-empty DSO tile headers into the shared tile flags; `buildDSOWork()` then consumes that shared metadata to produce a compact active-tile/workgroup list. It verifies room/grid identity and rejects any bit/header drift.

This does not change DSO silhouettes, dominance, hard-core geometry, hierarchy, Dark Bloom or temporal semantics. A tile is skipped only when the existing SM-303 header already says it has zero DSO jobs. The deterministic gate requires the compact active set to match SM-303 non-empty tiles exactly and records full-screen versus submitted workgroups. The representative fixture must reduce DSO workgroups by more than 20% without removing any authoritative DSO tile.

## Debugging and future consumers

`debugTileOverlay()` exposes tile rectangles, flags, occluder counts, relevant light counts and DSO relevance. The snapshot also reserves interface names for **GTAO**, **SSGI** and **volumetrics**. Those effects are not implemented or enabled by SM-504; the reservation prevents later passes from inventing incompatible spatial grids.

Overflow is a correctness failure for the staged consumer path. Callers must increase the bounded light-ref capacity rather than silently dropping influence. Room/grid mismatch, stale light ordering and DSO relevance drift also fail closed.

## Validation and measured evidence

The deterministic gate covers static/dynamic occupancy, canonical light identity, conservative direct-light visual parity, empty/unlit tiles, DSO work projection, debug overlays and stale-state rejection. The real Chrome/Chromium WebGPU gate uploads the shared ABI, executes a compute consumer, reads it back exactly, and repeats the direct-light/work-count checks.

The deterministic representative fixture establishes architecture-level work reduction before default integration: light candidate work is required to fall by more than 45%, and DSO workgroups by more than 20%. These are work counters, not fabricated GPU milliseconds. The culling path remains bounded and inspectable; it does not introduce precision packing, render bundles, adaptive quality, GTAO, SSGI or volumetrics.

**GTX 1650 SUPER evidence boundary:** hosted CI is **not target-hardware timing**. SM-504 acceptance asks for target-hardware GPU delta *when available*. No GTX 1650 SUPER timing is claimed by this change. The existing SM-500 instrumentation remains the timing authority, and the SM-501 physical-hardware lane remains responsible for target GPU performance evidence. If a later target run shows culling overhead exceeds savings in normal scenes, the pass must be restricted or simplified rather than retaining complexity for theoretical wins.
