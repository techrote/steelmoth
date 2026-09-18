# SM-207 WebGPU bloom, grading, post-processing, and final-output contract

SM-207 establishes the staged WebGPU frame-output path after SM-204 opaque lighting and SM-206 transparent/gameplay feedback. It ports the restrained v1.2.3 bloom and post controls, provides a deliberate raw/debug bypass, and proves presentation into the browser's preferred WebGPU canvas format. WebGL2 remains the production presentation authority until SM-505.

## Compatibility baseline

The accepted v1.2.3 surface uses half-resolution bloom, soft bright extraction with knee `0.12`, one horizontal/vertical five-tap Gaussian pair, bloom threshold `0.70`, intensity `1.0`, saturation `1.20`, grade mix `0.25`, vignette `0.065`, grain `0.0006`, exposure `1.60`, brightness `0.0`, contrast `1.12`, gamma `1.0`, neutral temperature/tint, shadow lift `-0.10`, and highlight gain `0.80`. Graphics settings persist through `signalOrchardGraphicsV123`; SM-207 does not rename or reinterpret those fields.

Material-v2 already performs direct lighting before post. The WebGPU post module therefore accepts the already-lit SM-204/SM-206 scene and deliberately does not recreate the legacy light-map multiplication step.

## Bloom and quality

`bloomQuality=1` is the compatibility tier: half-resolution extraction followed by one horizontal/vertical blur pair. Bounded staged tiers are `0` extraction only, `1` one pair, `2` two pairs, and `3` three pairs. This supplies a quality scaler without changing the default art direction. Bloom intermediates use `rgba16float`; final output format is independent.

## Grade and output equation

The shader preserves the established operation order: bloom, saturation, grade mix, temperature/tint, shadow lift/highlight gain, vignette, exponential exposure, contrast/brightness, gamma, deterministic grain, then the compatibility `0.96` output power.

## Raw/debug bypass

Raw/debug output is a distinct pipeline using `textureLoad()`. It copies the already-lit scene directly to the output attachment and skips bloom, grade, exposure, vignette, grain, gamma, and the remaining post chain. This is intentionally stronger than merely neutralizing controls.

## Browser presentation

`WebGPUPost` takes a WebGPU render-attachment view and output format; it has no WebGL framebuffer assumptions. The browser gate configures a real `GPUCanvasContext` with `navigator.gpu.getPreferredCanvasFormat()`, renders to `getCurrentTexture()`, and waits for successful submission. Numeric evidence uses a separate `rgba8unorm` readback target.

## Colour-space boundary

SM-207 conservatively retains the v1.2.3 transfer behavior. It does not add sRGB/linear reinterpretation, display-P3 behavior, HDR display semantics, or a new tone mapper. That work belongs to SM-502, and diagnostics state the deferral explicitly.

## Verification

Deterministic checks cover defaults, persistence, normalization, monotonic exposure/brightness/gamma/temperature/shadow/highlight controls, saturation/grade/vignette behavior, bloom enable/intensity/quality, uniform layout, and compatibility shader constants. Required hosted real-WebGPU validation additionally covers WGSL compilation, `rgba16float` bloom targets, representative GPU before/after samples, raw copy parity, restrained bloom, bounded quality scaling, and real preferred-format canvas presentation.

Passing SM-207 proves staged API/data/numeric post parity and browser presentation viability. It does not prove SM-502 colour-space redesign, SM-505 backend promotion, target-GPU performance, later water/foliage ordering, or subjective final visual approval.
