# SM-404 — room-transition and render-history invalidation

SM-404 defines one explicit invalidation graph for gameplay room changes, project reloads, surface resizes, renderer/backend reconfiguration, and device rebuilds. The graph is intentionally narrower than a blanket `resetEverything()` strategy: each transition invalidates only state whose authority has become incompatible, while every room-sensitive identity and history class is rejected before the next room can render.

## Ownership boundary

`engine/webgpu_transition_state.js` owns transition epochs and invalidation diagnostics. It does not own gameplay, authored map data, render-scene construction, or GPU pass implementation. Existing production stages keep their own `invalidate(reason[, clearHistory])` APIs. SM-404 calls those APIs through a shared graph and marks frame-local/procedural state dirty for rebuilding from canonical current state.

Three monotonically increasing epochs form the stale-state guard:

- **room epoch** changes for room changes, room/project loads, and project reloads;
- **surface epoch** changes when target dimensions/DPR become incompatible, and also on backend/device rebuilds;
- **backend epoch** changes whenever the renderer/backend or device generation is rebuilt.

Derived state can be stamped with these epochs. A stale stamp is rejected rather than patched into a new room, target size, or device generation.

## Room/load profile

A room change, room load, or project reload invalidates all room-derived classes:

- canonical RenderScene capture and static instance/material submission;
- ownership depth and object-ID output;
- SM-203 depth hierarchy;
- SM-300 occluders and SM-301 clusters;
- SM-302 dominant-owner state;
- SM-303/304 DSO hard/hierarchy state;
- SM-305 Dark Bloom and SM-306 temporal history;
- local/contact shadow and SM-307 visibility output;
- SM-400 water, SM-401 foliage, SM-206 transparent/procedural descriptors, and SM-402 ordering state.

The integration wraps the existing gameplay `enterRoom()` boundary. Old RenderScene/renderer bridge captures are cleared before the new room is entered. SM-302 and SM-306 receive history-clearing invalidation. The graph records both transition endpoints and the affected/invoked resources.

## Resize profile

Resize is deliberately selective. Surface-sized ownership/object-ID, depth hierarchy, local/contact/visibility output, DSO/Dark Bloom/temporal resources, and procedural/composition targets are invalidated. Geometry-only occluders, clusters, static instance/material descriptions, and dominant ownership remain valid because their authority is world geometry rather than framebuffer dimensions.

The existing SM-103 resource registry remains responsible for physically rebuilding `resizeDependent` textures. Its persistent geometry buffers are not recreated by resize. SM-404 supplies the semantic invalidation layer above that resource behavior and rejects temporal history at incompatible dimensions.

A no-op resize to the existing width/height/DPR emits no redundant transition event.

## Backend and device profile

Explicit backend reconfiguration or device rebuild invalidates every derived renderer class because GPU handles and device-generation state are not portable. CPU-authored gameplay/map data remains authoritative and is not reset. Device loss is recorded as a `device-rebuild` event before fallback handling completes.

This is not a backend-selection feature: Auto remains governed by the existing SM-102/SM-505 policy.

## Diagnostics and ghost-state checks

Diagnostics expose the latest reason, room/backend/extent, all three epochs, registered targets, dirty state, live stamped records, and a bounded event log. Each event includes its invalidation token (`sm404:<reason>:<revision>`), transition endpoints, affected resource classes, production invalidators invoked, and whether history clearing was requested.

The deterministic regression reads the real `game_data/maps.json`, cycles every room repeatedly, publishes representative object-ID/cluster/temporal records, then proves those records cannot be read after a room transition. It separately proves resize preserves geometry-only cluster/occluder state while rejecting target-sized state, and that backend/device changes invalidate all derived GPU representations.

`webgpu-transition-smoke.html` adds Chrome real-WebGPU evidence using the production SM-103 resource registry and SM-203 depth hierarchy. It proves a surface resize recreates a resize-dependent GPU texture without recreating a persistent static buffer, drives the real depth hierarchy through SM-404 invalidation, and verifies room/backend transitions cannot expose stale records.

## Acceptance mapping

1. **All rooms rebuild correctly:** repeated cycling of every map room advances the room epoch, dirties the complete room-derived profile, and allows only current-room records to be republished.
2. **No old IDs/clusters/shadows/history:** object-ID, cluster, DSO/Dark Bloom and ownership/history classes are invalidated on room transitions; stamped old records are rejected.
3. **Resize/backend reconfigure is stable and selective:** resize leaves geometry topology clean while rebuilding target-sized resources; backend/device changes invalidate the complete GPU-derived set.
4. **Diagnostics report transition work:** every transition records reason, epochs, endpoints, affected classes, invoked production invalidators, and bounded recent history.

Hosted CI demonstrates state/resource correctness and retains a diagnostic screenshot. It does not claim target-GPU performance or substitute a screenshot for human visual judgement.
