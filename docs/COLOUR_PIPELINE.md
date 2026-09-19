# Steel Moth WebGPU colour pipeline

Status: canonical SM-502 contract for the staged WebGPU renderer. This document describes numeric representation, not subjective colour grading. `Auto` remains WebGL2-first until SM-505.

## Contract

| Resource / stage | Stored or authored space | Consumer semantics |
| --- | --- | --- |
| Sprite albedo PNG / external image | sRGB | Uploaded to `rgba8unorm-srgb`; texture sampling performs the one sRGB→linear decode. |
| Sprite tint values | authored sRGB | Decoded on CPU before instance packing; material blending is linear. |
| Normal + roughness atlas | numeric linear data | `rgba8unorm`; sampled without transfer. RGB is normal data, A roughness. |
| Height + material atlas | numeric linear data | `rgba8unorm`; sampled without transfer. Channels retain height/metalness/AO/emissive semantics. |
| G0 | linear albedo, `rgba8unorm` | Internal linear value. Quantisation is 8-bit; no display transfer is implied. |
| G1 / G2 | linear numeric material data, `rgba16float` | No colour transfer. |
| Authored light colours | sRGB | Decoded during canonical-light construction before packing. |
| SM-204 deferred lighting | linear HDR, `rgba16float` | GGX, diffuse, specular, ambient and emissive math operate on linear values. |
| Bloom extraction + blur | linear HDR, `rgba16float` | Thresholding, filtering and accumulation are linear. |
| Grade / exposure / tone stage | linear working values | Compatibility controls remain artistic operators, but they execute before the display transfer. |
| Final presentation | sRGB | IEC sRGB OETF is applied exactly once by SM-207 before writing the browser-preferred unorm canvas texture; `GPUCanvasContext` is explicitly configured `colorSpace: 'srgb'`. |

WebGPU textures are treated as numeric storage. The `-srgb` sampling format is used only at the albedo input boundary. Internal G-buffer/HDR targets do not use sRGB formats.

## Numeric fixtures

The deterministic regression pins the IEC transfer curve and round trips. In particular:

- sRGB code value `0.5` decodes to approximately `0.21404114` linear;
- **18% linear grey** (`0.18`) display-encodes to approximately `0.46135613` sRGB;
- black, white and RGB primaries remain exact at the endpoints;
- authored tint and light colours are decoded before material/direct-light work;
- dielectric and metal fixtures execute the same linear GGX path and remain finite/non-negative.

The real-WebGPU G-buffer smoke compares production PNG albedo readback against host-decoded sRGB→linear expectations while continuing exact numeric checks for normal/roughness and height/material channels. The post smoke feeds known linear scene values and verifies the raw presentation path performs only the required display transfer.

## Debug views

Debug values are defined by their producer, not by how bright they happen to look on an sRGB monitor:

- SM-200 `albedo` is **linear albedo**; normal, roughness, height, metalness, AO and emissive views are **linear numeric data**; object-ID is unitless diagnostic colour.
- SM-204 `final`, `diffuse` and `specular` are **linear HDR**. `light-count` is unitless.
- SM-207 `raw` means **no bloom/grade/tone controls**, not “skip the display transform”; when presented to an sRGB output it still receives the final linear→sRGB transfer.

Readback tests of an internal linear target compare linear numbers. Human-facing presentation of those values must apply a display transform; tuning must not infer material response from an untransformed linear debug buffer.

## Browser boundary

The browser canvas is configured explicitly as sRGB. SM-405 already runs the production G-buffer and post pages in both Chrome and Firefox on Windows; those inherited jobs therefore exercise this contract cross-browser. If either browser changes external-image or canvas colour handling enough to break the numeric readbacks, that is a validation failure rather than grounds for eye-tuning a compensating gamma.

## Non-goals

SM-502 does not change the GGX model, material-generator channel semantics, gameplay lighting ownership, quality tiers, HDR-display promotion, or the SM-505 backend-default decision.
