# SM-403 — editor integration and ghost-state invalidation

SM-403 keeps the existing F2 editor and WebGL2 presentation path intact while making editor mutations explicit invalidation events for the staged WebGPU renderer. It does **not** redesign editor UX and it does not move gameplay/editor ownership onto the GPU.

## Author identity and persistence

`maps.json` remains the authoritative editor/project representation. Existing `editor_decor[].editor_id` values are author identities, not GPU object IDs. The SM-403 integration repairs missing or duplicate decor IDs deterministically at the editor boundary and preserves an existing `editor_id` when a decor object is moved. A move therefore cannot silently turn one authored object into a newly identified object.

GPU object IDs, buffer offsets, cluster IDs, history indices, texture handles, resource generations, and other derived renderer identities are never serialized into the project. Render IDs continue to be regenerated from the canonical RenderScene submission. Save/reload determinism is verified from the same serialized author state: after serialization and reload, canonical map identity and the resulting editor/render identity sequence must match exactly.

## Invalidation contract

`engine/webgpu_editor_state.js` is the editor-to-renderer invalidation boundary. Every place/move/delete/undo/redo/paste/erase/rebuild operation clears the last captured RenderScene and marks all frame-local outputs dirty:

- instance submission;
- material/G-buffer content;
- canonical ownership depth;
- object-ID attachment;
- local/contact shadow output;
- final visibility composition.

Persistent derived stages are invalidated through their existing production `invalidate(reason)` APIs rather than through an editor-only approximation:

- SM-203 depth hierarchy;
- SM-300 occluder bins;
- SM-301 clusters;
- SM-302 dominant-owner state;
- SM-303 DSO hard core;
- SM-304 DSO hierarchy;
- SM-305 Dark Bloom;
- SM-306 Dark Bloom temporal history.

SM-302 dominance and SM-306 temporal state are invalidated with history clearing enabled. This is intentionally stronger than trying to patch old ownership/history after an authoring mutation. On the next renderer frame, frame-local G-buffer/contact/visibility outputs are rebuilt from the current RenderScene; their production passes already clear/rewrite their targets each frame.

The hub exposes diagnostics containing the editor revision, mutation reason, room hash, registered production stages, dirty state, and bounded recent invalidation events. The diagnostics explicitly state that GPU IDs are not persistent project state.

## Canonical two-bin regression

The deterministic regression follows the validation-plan sequence with two overlapping authored props: place A, place B, capture identity, move B, delete B, undo, redo, undo, save, serialize/reload, and capture again. It checks that:

1. moving B retains B's author identity and does not consume a fresh decor ID;
2. each mutation clears the stale canonical scene snapshot;
3. every registered persistent WebGPU stage becomes invalid, with owner/temporal history dropped;
4. object-ID/contact/material/depth outputs are marked for current-frame rebuild;
5. delete/undo/redo do not leave the removed object's author identity in the wrong state;
6. save/reload produces the same canonical map hash and editor/render identity sequence;
7. no renderer-derived identifiers appear in serialized map state;
8. the editor's WebGL2 fallback remains selected and its rebuild path still executes.

`webgpu-editor-smoke.html` additionally constructs the real SM-203 WebGPU depth-hierarchy resource on a Chrome WebGPU device and proves an editor move drives that production object through its real invalidation API without changing its resource generation. The rest of the persistent-chain contract is exercised with the same named invalidator ABI in the deterministic test; downstream stages remain independently protected by their existing dedicated real-WebGPU gates.

## Evidence boundary

Hosted CI can prove deterministic state transitions, production invalidation calls, real-WebGPU SM-203 resource invalidation, save/reload identity, and preservation of the WebGL2 fallback. It cannot supply the requested human WYSIWYG judgement for representative props, foliage, and objectives. The smoke-page screenshot is retained as inspection evidence only; the project must not describe that artifact as a human visual sign-off. Likewise, hosted CI makes no GTX 1650 Super timing claim.

This issue does not introduce a schema migration: the existing decor author-ID field can express stable author identity, while renderer/GPU IDs remain derived and transient as required by the validation plan.
