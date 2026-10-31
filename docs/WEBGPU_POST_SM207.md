# SM-207 WebGPU bloom, grading, post-processing, and final-output contract

SM-207 establishes the staged WebGPU frame-output path after SM-204 opaque lighting and SM-206 transparent/gameplay feedback. It ports the restrained v1.2.3 bloom and post controls, provides a deliberate raw/debug bypass, and proves the final pipeline against the browser's preferred WebGPU canvas format. WebGL2 remains the production presentation authority until SM-505.

## Compatibility baseline

The accepted v1.2.3 surface uses half-resolution bloom, soft bright extraction with knee `0.12`, one horizontal/vertical five-tap Gaussian pair, bloom threshold `0.70`, intensity `1.0`, saturation `1.20`, grade mix `0.25`, vignette `0.065`, grain `0.0006`, exposure `1.60`, brightness `0.0`, contrast `1.12`, gamma `1.0`, neutral temperature/tint, shadow lift `-0.10`, and highlight gain `0.80`. Graphics settings persist through `signalOrchardGraphicsV123`; SM-207 does not rename or reinterpret those fields.

Material-v2 already performs direct lighting before post. The WebGPU post module therefore accepts the already-lit SM-204/SM-206 scene and deliberately does not recreate the legacy light-map multiplication step.

## Bloom and quality

`bloomQuality=1` is the compatibility tier: half-resolution extraction followed by one horizontal/vertical blur pair. Bounded staged tiers are `0` extraction only, `1` one pair, `2` two pairs, and `3` three pairs. This supplies a quality scaler without changing the default art direction. Bloom intermediates use `rgba16float`; final output format is independent.

## Grade and output equation

The shader preserves the established operation order: bloom, saturation, grade mix, temperature/tint, shadow lift/highlight gain, vignette, exponential exposure, contrast/brightness, gamma and deterministic grain. The subsequently adopted [SM-502 colour contract](COLOUR_PIPELINE.md) replaces the historical compatibility `0.96` output power with exactly one IEC sRGB display transfer. Internal scene/bloom/grading values are linear HDR.

## Raw/debug bypass

Raw/debug output is a distinct pipeline using `textureLoad()`. It skips bloom, grade, exposure, vignette, grain and gamma, while applying the SM-502 final linear-to-sRGB display transfer. It is not an untransformed copy of linear values into a display attachment.

## Browser presentation

`WebGPUPost` takes a WebGPU render-attachment view and output format; it has no WebGL framebuffer assumptions. The hosted browser gate obtains `navigator.gpu.getPreferredCanvasFormat()`, executes the production final-post pipeline successfully against a render attachment of exactly that format, and configures a real `GPUCanvasContext` with the same format. It also attempts submission to `getCurrentTexture()`. Current hosted headless Chrome/Dawn can fail that final swapchain acquisition because its SharedImage compositor backing is unavailable; that exact infrastructure limitation is recorded separately and is not treated as evidence about shader/pipeline format compatibility. Numeric evidence uses a separate `rgba8unorm` readback target.

## Colour-space boundary

The original SM-207 transfer description was superseded by the adopted SM-502 contract. Source albedo and authored colour inputs are decoded at their documented boundaries; scene/bloom/grading are linear, and final/raw display output encodes once. Display-P3 and HDR display semantics are not introduced.

The [2026-10-31 native SM-505 checkpoint](SM505_OVERNIGHT_2026-10-30.md) exposes a release-blocking compatibility problem in the unchanged artistic equation: negative shadow lift and contrast clamp low linear values before display encoding. The neutral default cutoff is approximately 0.12650575 linear, and production CPU/GPU replay reproduces the opaque blackout. This is a known visual failure, not accepted grading calibration. Defaults, saved control semantics and the linear contract remain unchanged pending a reviewed decision; raw output is diagnostic, never a repair or release bypass.

## Verification

Deterministic checks cover defaults, persistence, normalization, monotonic exposure/brightness/gamma/temperature/shadow/highlight controls, saturation/grade/vignette behavior, bloom enable/intensity/quality, uniform layout, and compatibility shader constants. Required hosted real-WebGPU validation additionally covers WGSL compilation, `rgba16float` bloom targets, representative GPU before/after samples, raw copy parity, restrained bloom, bounded quality scaling, preferred-format final-pipeline execution, real `GPUCanvasContext` configuration, and an explicit swapchain-presentation attempt with any host compositor limitation recorded.

Passing SM-207 proves staged API/data/numeric post parity and browser-format presentation viability without WebGL-specific assumptions. It does not claim that the hosted headless compositor itself can allocate a WebGPU swapchain, and it does not prove SM-502 colour-space redesign, SM-505 backend promotion, target-GPU performance, later water/foliage ordering, or subjective final visual approval.
