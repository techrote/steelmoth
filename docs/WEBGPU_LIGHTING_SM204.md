# SM-204 canonical WebGPU lights and deferred Material-v2 PBR

Status: **implemented by SM-204; staged WebGPU representation, not yet the default presented renderer**.

## Authority and scope

SM-204 establishes one canonical GPU light representation for opaque WebGPU direct lighting and ports the accepted v1.2.3 Material-v2 direct-light response. Gameplay/world/editor state remains authoritative. The renderer consumes `RenderScene.lights`; it does not create gameplay light state.

This issue intentionally does **not** implement height self-shadow/contact-shadow parity (SM-205), transparent/effect parity (SM-206), final bloom/post/presentation parity (SM-207), DSO, GTAO, SSGI, or volumetrics.

## Canonical light buffer

`engine/webgpu_lighting.js` owns one persistent storage buffer named `sm204:lights`. Every opaque direct-light contribution consumes this one buffer.

The compatibility ceiling is 17 records: the WebGL2 baseline allowed up to 16 ordinary/omni point lights plus the separately evaluated player cone. SM-204 puts both families into one buffer instead of retaining a special cone side channel.

Each 64-byte record contains four `vec4<f32>` groups:

1. `position.xyz + radius` in the canonical pseudo-world convention;
2. `colour.rgb + intensity`;
3. `direction.xy + innerCos + outerCos` for cone lights;
4. numeric type/flags metadata.

Stable IDs continue to come from the backend-neutral Render Scene Description. The buffer is a renderer upload format, not a second light-authority model.

Compatibility pseudo-Z defaults are preserved when an explicit Z is absent: player omni/cone 22, pulse 19, objective 18, companion 13, fragment 9, orbiter/ambient life 8, firefly 6, generic 12.

Global compatibility controls preserve their v1.2.3 semantics: `lightRadius` scales point radii; `emissive` scales non-independent point-light intensity; independent player omni intensity and player-cone intensity are not multiplied by `emissive`.

## Deferred PBR parity contract

The WGSL direct-light pass consumes SM-200/202 G0/G1/G2 and preserves the accepted Material-v2 interpretation:

- G0 RGB = albedo; A = coverage;
- G1 RGB = encoded normal; A = roughness;
- G2 R = **local Material-v2 height** used to reconstruct pseudo-world Z for lighting, not ownership depth;
- G2 G = metalness;
- G2 B = material AO;
- G2 A = emissive.

The restrained v1.2.3 response is preserved deliberately:

- normal convention `+X / -screenY / +Z` for light vectors;
- fixed view vector `normalize(0, -0.12, 1)`;
- dielectric F0 `0.04`, metallic F0 from albedo;
- Schlick Fresnel;
- GGX NDF;
- Smith/Schlick geometry term;
- metal-aware diffuse reduction;
- point attenuation `exp(-2.3 * (distance/radius)^2)`;
- compatibility diffuse floor `(NoL * 0.86 + 0.14)`;
- direct artistic compression `direct / (1 + direct * 0.22)`;
- material AO applied to ambient only;
- emissive contribution `albedo * emissiveChannel * 0.8`.

The player cone uses the baseline XY cone edge and range fade, then the same canonical pseudo-world normal/light convention and GGX response as point lights. Terrain ray visibility, height self-shadow and contact shadow remain outside this SM-204 pass and are owned by later tasks.

## Diagnostic lighting preset

The historical diagnostic preset remains a fixture rather than a runtime-default change:

- emissive strength `2`;
- light-radius multiplier `2`;
- player omni radius `80`;
- player omni intensity `1.6`;
- player cone intensity `2`;
- cone inner `30°`;
- cone outer `60°`.

`DIAGNOSTIC_PRESET` in `engine/webgpu_lighting.js` exposes those values for deterministic validation. Baseline product defaults remain unchanged.

## Debug and diagnostics

The deferred pass exposes:

- `final`;
- `diffuse`;
- `specular`;
- `light-count`.

Runtime diagnostics report the active canonical-light count, the single canonical buffer name, packed light records, compiled WGSL diagnostics, output format, resource/pipeline diagnostics, and the explicit fact that self/contact shadows remain deferred to SM-205.

## Verification

`tools/validate_webgpu_lighting.js` validates buffer normalization/packing, player-cone de-duplication, compatibility scaling rules, the diagnostic preset, eight-angle CPU reference behavior, debug outputs, material-AO role separation, and gameplay-state non-authority.

`webgpu-lighting-smoke.html` + `tools/validate_webgpu_lighting_browser.py` execute the production WGSL on real hosted WebGPU. The smoke uses five production Material-v2 controls:

- `floor_plate` — box/plate positive control;
- `cargo_crate`;
- `rust_barrel`;
- `server_cabinet`;
- `hex_maintenance_idle_0` — robot control.

For every control it evaluates 0°, 45°, 90°, 135°, 180°, 225°, 270°, and 315° point-light positions. Diffuse, specular and final GPU readbacks are compared numerically with the v1.2.3-equivalent CPU reference derived from the same production G-buffer pixel. The gate also validates mixed omni+cone packing and active-light-count output.

This is deterministic API/data/parity evidence on the hosted adapter. It is not GTX 1650 Super performance evidence and is not final human visual acceptance.

## Downstream contract

SM-205 may add height self/contact visibility to the direct-light composition without creating a second light representation. SM-206 procedural/transparent systems must consume this canonical light state rather than re-deriving incompatible point/cone conventions. Later clustering/DSO/GTAO/SSGI/volumetric work may extend light metadata and visibility inputs, but should preserve this single-authority boundary unless an explicit architecture decision supersedes it.
