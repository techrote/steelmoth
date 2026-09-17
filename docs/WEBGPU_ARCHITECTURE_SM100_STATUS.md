# SM-100 architecture implementation status

This note records the implementation transition corresponding to the `Render Scene Description` target in `WEBGPU_ARCHITECTURE.md`.

As of SM-100, the repository now has a backend-neutral per-frame renderer contract in `engine/render_scene.js` and a WebGL2 compatibility consumer in `engine/webgl2_scene_adapter.js`. The game/world/editor remains gameplay authority; the scene is cosmetic renderer input only.

This implementation does **not** supersede the baseline reconciliation in `WEBGPU_ARCHITECTURE.md`: v1.2.3 itself still had no RSD. SM-100 adds the boundary on top of that audited baseline while preserving its WebGL2 shading/submission semantics.

Remaining architecture responsibilities are unchanged:

- SM-101 centralizes root/foot transforms; the v1 RSD exposes current compatibility root authority rather than claiming it is unified.
- SM-102 introduces real WebGPU lifecycle/fallback; SM-100 does not create a WebGPU renderer.
- SM-200 ports Material-v2 G-buffer semantics.
- SM-201 derives canonical fragment ownership depth.
- SM-202 implements per-pixel depth/object ownership.

The detailed record schemas, stable-ID rules, procedural-layer contract and fail-open WebGL2 replay behavior are canonical in `RENDER_SCENE_DESCRIPTION.md`.
