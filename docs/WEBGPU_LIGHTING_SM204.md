# SM-204 canonical WebGPU lighting and deferred Material-v2 PBR

Status: **implemented by SM-204**. This document is the canonical contract for the first WebGPU opaque direct-lighting pass. It preserves the accepted v1.2.3 Material-v2 direct-light response without importing downstream shadow, AO, GI or volumetric work into this milestone.

## Authority and scope

Game/world state remains authoritative outside the renderer. `RenderScene.lights` is the renderer-facing source of truth. SM-204 normalizes those records into **one canonical light buffer** consumed by the opaque deferred pass. Point, player omni and player cone records therefore share one representation instead of separate backend-specific uniform paths.

SM-204 consumes Material-v2 G0/G1/G2 from SM-200 and is compatible with the SM-202 ownership/depth result. It does not alter G-buffer material semantics, the SM-201 ownership projection, gameplay, or WebGL2 compatibility rendering.

## Canonical light record

`engine/webgpu_lighting.js` packs at most 16 active lights, 64 bytes each:

| bytes | WGSL field | meaning |
| --- | --- | --- |
| 0–15 | `positionRadius` | pseudo-world X/Y/Z and effective radius/range |
| 16–31 | `colorIntensity` | RGB colour and compatibility intensity |
| 32–47 | `directionInnerOuter` | cone direction XY, inner cosine, outer cosine |
| 48–63 | `meta` | type, flags, enabled, reserved |

Type codes are point, omni and cone. The WebGL2 compatibility radius multiplier applies to point/omni lights. Its historical `emissive` control multiplies non-independent local-light intensity; the player omni and cone preserve their independent baseline behavior. `lighting=false` produces zero direct-light records and the compatibility full ambient path.

The buffer is persistent through the SM-103 resource registry and updated with bounded `GPUQueue.writeBuffer` uploads. Opaque direct lighting reads no second light list.

## Deferred PBR response

The fullscreen pass reads Material-v2 G0/G1/G2 with `textureLoad` and preserves the v1.2.3 response:

- normal XYZ decoded from G1 and adjusted by normal strength;
- roughness from G1.A with the baseline clamp;
- local material height from G2.R for light-vector Z only — this is **not** ownership depth;
- metalness from G2.G;
- material AO from G2.B and applied to ambient only;
- emissive from G2.A with the baseline 0.8 material-emission contribution;
- dielectric F0 ≈ 0.04 and albedo-derived metallic F0;
- Schlick Fresnel;
- GGX NDF;
- Smith/Schlick visibility term;
- reduced metallic diffuse;
- v1.2.3 point attenuation and cone angular/range falloff;
- the existing `(NoL × 0.86 + 0.14)` illustrated diffuse floor;
- the existing bounded direct-light compression `direct / (1 + 0.22 × direct)`.

Pseudo-world light Y is converted to the same normal-space convention used by the accepted WebGL2 shader. This prevents the historical normal-axis reversal failure.

Colour-space modernization is intentionally deferred to SM-502. SM-204 is parity-first and therefore does not silently reinterpret the imported unorm Material-v2 buffers as a new colour pipeline.

## Player cone and omni

The player omni enters the same canonical light buffer as ordinary point lights with type `omni`. The player cone enters the same buffer with type `cone`; its record carries direction, range, inner/outer cosines, intensity and colour. The deferred shader branches on light type inside the common loop rather than using a second cone-uniform lighting implementation.

Terrain occlusion, height self-shadow and contact-shadow visibility are deliberately not folded into this pass yet. SM-205 owns the WebGPU height-self/contact-shadow port, while later M3 tasks own DSO/Dark Bloom. Keeping direct BRDF and visibility separate prevents SM-204 from embedding an incompatible shadow model.

## Debug and diagnostics

Executable debug outputs are:

- `final` — ambient + bounded direct PBR + material emissive;
- `diffuse` — accumulated direct diffuse before final compression;
- `specular` — accumulated GGX specular before final compression;
- `light-count` — per-fragment active-light count normalized by the fixed 16-light capacity.

Diagnostics expose total active records, per-type counts, buffer stride/bytes, compilation messages, resource/pipeline diagnostics and the diagnostic preset. These counts are representation/debug evidence, not a performance measurement.

## Diagnostic preset

The historical stronger diagnostic control remains a reproducible test preset, not the runtime default:

- emissive/light-intensity multiplier: `2`;
- light-radius multiplier: `2`;
- player omni radius: `80`;
- player omni intensity: `1.6`;
- player cone intensity: `2`;
- cone inner angle: `30°`;
- cone outer angle: `60°`.

## Verification

`tools/validate_webgpu_lighting.js` checks light normalization/packing, compatibility multipliers, the preset, eight-angle CPU controls, X/Y normal orientation, metallic diffuse suppression and neutral-channel behavior.

`webgpu-lighting-smoke.html` plus `tools/validate_webgpu_lighting_browser.py` execute the production WGSL on real hosted WebGPU. The browser gate performs an **eight-angle** GPU-vs-reference control, X/Y normal-axis tests, neutral grey/white-light checks against yellow contamination, and readback of diffuse, specular, final and light-count modes. A mixed point/omni/cone frame verifies that all opaque direct lighting is driven from the single canonical buffer.

The inherited WebGL2 capture parity job remains mandatory. Hosted WebGPU success proves API/data/shader correctness on that browser/software adapter; it does not prove GTX 1650 Super timing or final visual approval.

## Downstream contract

SM-205 may apply height self-shadow/contact visibility around this direct-light response but must not create a competing light representation. Water, foliage and Fine Grass integration tasks must consume the same canonical light records rather than re-deriving light direction/intensity from WebGL2-specific state. DSO, Dark Bloom, GTAO, SSGI and volumetrics remain downstream consumers/compositors, not SM-204 responsibilities.
