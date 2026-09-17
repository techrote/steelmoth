# Steel Moth task → GitHub issue map

This map was reconciled against the complete issue set on 2026-09-16 and updated after SM-000 merged on 2026-09-17. Task codes are canonical in `MASTER_WEBGPU_PROGRAMME.md`; issue numbers are GitHub execution handles. The programme tracker is #51 and is not itself a task code.

| Milestone | Task | Issue | Status | Title |
| --- | --- | ---: | --- | --- |
| M0 | SM-000 | #1 | complete | Import and provenance the v1.2.3 baseline |
| M0 | SM-001 | #2 | open | Recover authoritative visual references and build regression fixtures |
| M0 | SM-002 | #3 | open | Build deterministic renderer capture and diagnostics harness |
| M0 | SM-003 | #4 | open | Establish WebGL2 GTX 1650 Super baseline measurements |
| M0 | SM-004 | #5 | open | Audit imported baseline against historical renderer contracts |
| M0 | SM-005 | #49 | open | Establish repository CI and autonomous verification entrypoints |
| M1 | SM-100 | #6 | open | Introduce backend-neutral Render Scene Description |
| M1 | SM-101 | #7 | open | Centralize shared root, foot, and render transform authority |
| M1 | SM-102 | #8 | open | Implement WebGPU device lifecycle, error handling, and WebGL2 fallback |
| M1 | SM-103 | #9 | open | Build WebGPU resource registry, frame graph, and pipeline infrastructure |
| M1 | SM-104 | #10 | open | Add WGSL, pipeline, resource, and failure-path validation suite |
| M2 | SM-200 | #11 | open | Port Material-v2 G-buffer to WebGPU with deterministic readback |
| M2 | SM-201 | #12 | open | Derive and validate the canonical pseudo-depth projection model |
| M2 | SM-202 | #13 | open | Implement per-pixel pseudo-depth and object ownership |
| M2 | SM-203 | #14 | open | Build reusable pseudo-depth hierarchy |
| M2 | SM-204 | #15 | open | Port canonical light buffers and deferred Material-v2 PBR |
| M2 | SM-205 | #46 | open | Port height self-shadow and contact-shadow parity to WebGPU |
| M2 | SM-206 | #47 | open | Port transparent sprite, particle, objective, and guide FX parity |
| M2 | SM-207 | #48 | open | Port bloom, colour grade, post-processing, and final output parity |
| M3 | SM-300 | #16 | open | Build GPU occluder representation and spatial tile binning |
| M3 | SM-301 | #17 | open | Implement stable occluder clustering |
| M3 | SM-302 | #18 | open | Add dominant-occluder scoring and hysteresis |
| M3 | SM-303 | #19 | open | Implement Deep Silhouette Occlusion hard core |
| M3 | SM-304 | #20 | open | Add DSO near/mid/far silhouette hierarchy and tile culling |
| M3 | SM-305 | #21 | open | Implement Dark Bloom soft residual occlusion |
| M3 | SM-306 | #22 | open | Add temporal stabilization for Dark Bloom and far penumbra |
| M3 | SM-307 | #23 | open | Consolidate DSO, self-shadow, contact, Dark Bloom, and AO visibility |
| M4 | SM-400 | #24 | open | Port water to canonical WebGPU light/depth/shadow state |
| M4 | SM-401 | #25 | open | Port foliage and Fine Grass to canonical WebGPU lighting/visibility |
| M4 | SM-402 | #26 | open | Formalize transparent/procedural render ordering and depth interaction |
| M4 | SM-403 | #27 | open | Integrate WebGPU with editor and eliminate ghost render state |
| M4 | SM-404 | #28 | open | Implement room-transition and render-history invalidation contract |
| M4 | SM-405 | #29 | open | Cross-browser WebGPU functional parity gate |
| M5 | SM-500 | #30 | open | Add pass-level GPU performance and memory instrumentation |
| M5 | SM-501 | #31 | open | Define quality tiers and pass GTX 1650 Super WebGPU acceptance |
| M5 | SM-502 | #32 | open | Audit and correct linear/sRGB/HDR colour pipeline |
| M5 | SM-503 | #33 | open | Calibrate Material-v2 normals, height, roughness, metalness, and AO semantics |
| M5 | SM-504 | #34 | open | Add reusable tile/light culling and expensive-pass skipping |
| M5 | SM-505 | #50 | open | Final WebGPU default-backend promotion and release acceptance |
| M6 | SM-600 | #35 | open | Implement half-resolution GTAO prototype with depth-aware upscale |
| M6 | SM-601 | #36 | open | Stabilize and performance-gate GTAO on GTX 1650 Super |
| M6 | SM-602 | #37 | open | Prototype low-resolution diffuse SSGI |
| M6 | SM-603 | #38 | open | Stabilize, tune, and performance-gate diffuse SSGI |
| M7 | SM-700 | #39 | open | Prototype depth-aware volumetric flashlight scattering |
| M7 | SM-701 | #40 | open | Stabilize volumetric occlusion, temporal history, and performance |
| M7 | SM-702 | #41 | open | Integrate advanced transparent lighting with depth, AO, and indirect diffuse |
| M8 | SM-800 | #42 | open | Study precision and bandwidth optimizations without reducing correctness |
| M8 | SM-801 | #43 | open | Measure render-bundle and static-submission optimization value |
| M8 | SM-802 | #44 | open | Implement optional slow adaptive-quality controller |
| M8 | SM-803 | #45 | open | Add long-run soak, resize, transition, and GPU-resource leak suite |

## Counts

- M0: 6 tasks
- M1: 5 tasks
- M2: 8 tasks
- M3: 8 tasks
- M4: 6 tasks
- M5: 6 tasks
- M6: 4 tasks
- M7: 3 tasks
- M8: 4 tasks
- **Total implementation/research tasks: 50**
- Completed: **1**
- Open: **49**
- Programme tracker: **#51**
