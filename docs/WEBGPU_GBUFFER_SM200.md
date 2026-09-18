# SM-200 WebGPU Material-v2 G-buffer

Status: **implemented and required by the hosted real-WebGPU validation gate**.

This document defines the WebGPU Material-v2 representation introduced by SM-200. `GBUFFER_LAYOUT.md` remains the authoritative description of the inherited v1.2.3 WebGL2 material semantics; this document records how those semantics are carried into the staged WebGPU backend without prematurely implementing SM-201/SM-202 ownership depth.

## Production attachments

| Attachment | WebGPU format | Deterministic clear | SM-200 meaning |
| --- | --- | --- | --- |
| G0 | `rgba8unorm` | `(0,0,0,0)` | unlit/tinted albedo RGB + binary written-fragment coverage |
| G1 | `rgba16float` | `(0.5,0.5,1,0.88)` | encoded normalized pseudo-world normal XYZ + roughness |
| G2 | `rgba16float` | `(0,0,1,0)` | local Material-v2 height, metalness, material AO, emissive/aux |
| Object ID | `r32uint` | `0` | deterministic stable renderer-object ID for written fragments |
| Depth | `depth32float` | `1.0` | allocated/cleared production depth attachment; ownership projection intentionally absent |

The G1 roughness clear of `0.88` and sprite alpha-cutout threshold of `0.12` deliberately match the audited v1.2.3 G-buffer rather than introducing new defaults during migration.

The depth attachment is deliberately configured with `depthCompare: "always"` and `depthWriteEnabled: false`. SM-200 therefore does **not** claim that painter order has become the accepted fragment-depth formula. SM-201 derives the light-independent root/local-height/layer projection; SM-202 owns hardware per-pixel depth/object ownership.

## Material atlas semantics

The WebGPU pass consumes the same coordinate-identical generated atlases as the compatibility renderer:

- albedo: `sprite_runtime_atlas.png`;
- normal/roughness: `sprite_material_normal_roughness.png`;
- height/material: `sprite_material_height_material.png`.

Sampling is `nearest` with clamped region UVs. Region endpoints are inset to source texel centres so scaling, flip and subrect use cannot sample an adjacent atlas region. Atlas upload requires identical dimensions for all three resources.

G2 preserves the established runtime channel reorder:

```text
source HM atlas: R=height, G=material AO, B=metalness, A=emissive/aux
WebGPU G2:       R=height, G=metalness, B=material AO, A=emissive/aux
```

G2.R remains **local material pseudo-height**. It is not visibility depth. The runtime multiplier is the same compatibility `heightFactor` used by WebGL2: rendered full-sprite height divided by the atlas region's default world height, clamped to `0.18..4.5`. Material-v2 metadata is already baked into the generated atlas; SM-200 does not add a competing height-bias formula.

Normal XYZ is decoded from the Material-v2 atlas, transformed for sprite flip/rotation, normalized, and re-encoded into G1 RGB. Roughness remains G1.A.

The three v1.2.3 albedo modes are preserved rather than collapsed into generic multiply tint:

- `normal`: `mix(albedo, albedo * tint, 0.07)`;
- `flat`: `mix(albedo, tint, tintStrength)`, with the compatibility default `0.18` where no explicit strength exists;
- `tint`: the inherited luminance-driven colourisation formula.

Descriptors below alpha `0.5` are excluded as in the compatibility material descriptor path. For accepted descriptors, source albedo alpha below `0.12` is discarded; surviving G0 pixels write alpha/coverage `1.0`, matching v1.2.3.

## Submission boundary

`engine/webgpu_gbuffer.js` consumes backend-neutral RenderScene records via `buildSceneInstances()`/`renderScene()`. SM-200 covers the material-bearing `static`, `dynamic`, and `foreground` categories required by issue #11. Stable string instance IDs are deterministically mapped to non-zero `u32` object IDs; clear/unowned pixels remain object ID zero.

Static descriptors retain source sequence order. Dynamic and foreground descriptors use the shared SM-101 root Y plus source sequence as their painter-order compatibility key, mirroring the audited WebGL2 material submission without defining hardware ownership depth.

The implementation uses one bounded persistent instance storage buffer and batched category draws. It does not allocate one GPU resource per sprite or create per-object pipelines. Resize recreation is delegated to the SM-103 resource registry.

## Deterministic clear and deletion behaviour

Every `renderInstances()` call clears G0, G1, G2, Object ID and Depth before submission, including a frame with zero instances. A render followed by an empty render therefore returns the same region to the documented default values. This is the WebGPU counterpart to the inherited ghost-material regression.

Readback helpers allocate staging buffers only when explicitly requested for validation/diagnostics; they are not part of the normal per-frame path.

## Debug views

SM-200 provides executable fullscreen debug modes for:

- albedo;
- normals;
- roughness;
- local height;
- metalness;
- material AO;
- emissive/aux;
- object ID.

These are representation/debug views, not final post-processing.

## Validation evidence

`webgpu-gbuffer-smoke.html` and `tools/validate_webgpu_gbuffer_browser.py` execute the production WGSL and production attachment descriptors on a real WebGPU device in hosted Chrome. The required gate covers:

- shader compilation information and render-pipeline validation;
- exact production G0/G1/G2/Object-ID/Depth formats and compatibility clears;
- real generated atlas upload and sampling;
- crate/box source-channel readback;
- barrel/cylinder normal readback;
- mixed-material readback from representative metal props;
- a synthetic flat-plate control with known normal/height/material values;
- static/dynamic/foreground semantic parity;
- alpha cutout leaving cleared/default attachments;
- object deletion followed by an empty frame;
- adjacent-atlas boundary isolation;
- all debug modes compiling and executing.

The hosted run is API/representation correctness evidence only. It is not GTX 1650 Super performance evidence, Firefox acceptance, or human visual parity.

## Explicit non-goals retained

SM-200 does not implement or imply:

- the final light-independent fragment ownership depth projection;
- depth-tested sprite ownership;
- cluster/tile representation;
- DSO or Dark Bloom;
- GTAO/SSGI;
- final deferred lighting or complete WebGPU presentation.

Those remain owned by their downstream issues.
