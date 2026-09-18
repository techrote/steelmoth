# SM-400 canonical WebGPU water

SM-400 ports the existing SurfaceFX water identity into a staged raw-WebGPU forward pass. It is a renderer migration task, not a water redesign: the established wave spectrum, bounded interaction ripples, shoreline field, material controls, and conservative refraction remain recognizable while lighting/depth/occlusion authority moves to the canonical WebGPU state.

## Scope boundary

The pass does not move gameplay authority into WebGPU. `engine/game.js` and the accepted WebGL2 `WaterField` interaction path remain unchanged, including collision, movement-triggered ripple calls, objectives, room logic, and save state. SM-400 consumes cosmetic/render descriptors and bounded ripple data only. WebGL2 remains the compatibility/default presentation until the later backend-promotion gate.

SM-400 also does not resolve final procedural ordering. The water output is staged as a transparent/forward world input; SM-402 owns reconciliation of water/foliage/grass/transparent ordering.

## Canonical inputs

`WebGPUWaterPass.sourceFromPaths(...)` binds four existing authorities rather than constructing substitutes:

- `sm204:lights`, the exact SM-204 canonical `Light` storage-buffer ABI and active-light count;
- the SM-204 resolved lit-scene texture beneath water;
- the SM-202 `depth32float` canonical ownership depth;
- SM-307 visibility, using the direct-shadow visibility channel for water direct/highlight response.

The water WGSL declares the same 64-byte `Light` structure as SM-204. Light vectors use the same pseudo-world convention: X follows screen X, screen-Y displacement is negated in the shading vector, and Z comes from the canonical light elevation. Water therefore cannot invent the former fixed `z=96` lighting world.

## Water field and room lifetime

The compatibility shoreline representation is retained as persistent `rgba8unorm` data:

- R: wet mask;
- G: normalized interior distance from shore;
- B: normalized near-shore helper retained for compatibility/future use;
- A: opaque field payload.

`buildShoreField()` uses the same bounded two-pass distance construction as SurfaceFX. `setField()` uploads only when room/revision/extent changes. A frame whose room ID does not match the currently uploaded field is rejected instead of sampling stale water from a previous room. Resize/device reset invalidates renderer-owned outputs without altering gameplay state.

## Wave and ripple identity

The shader keeps the established multi-band directional spectrum and quality tiers. The SM-400 CPU reference uses the same wave set for deterministic tests. Interaction ripples preserve the existing bounded model:

- hard cap: 12 live sources;
- age/lifetime normalization;
- radius, amplitude and foam controls;
- `waterRippleStrength` scaling;
- old sources are discarded first when the cap is exceeded.

This is intentionally not an FFT ocean, SSR water, transmission model, wetness system, or physically based rewrite.

## Scene/depth-aware refraction

Water samples the current resolved scene at the current pixel and at the wave-displaced refracted pixel. It samples canonical ownership depth at both locations. When the depth discontinuity exceeds `waterDepthReject`, the refracted contribution is smoothly rejected so foreground/background ownership boundaries are not pulled through one another merely because the water normal points across the edge.

The refraction source is the current frame's resolved scene. Combined with stale-room field rejection, a room transition cannot legally keep using the previous room's scene/mask pairing.

## Darkness and shadow behavior

The old WebGL2 shader estimated visibility from lit-scene luminance and used an independent fixed-elevation main-light vector. SM-400 replaces that independent light with canonical direct energy and SM-307 direct visibility while retaining scene luminance as a conservative resolved-scene term.

Water color, highlights, foam contribution, and alpha are bounded by received illumination. With a black resolved scene and zero canonical lights, the output is transparent black. This is the executable no-self-light condition: base/foam/highlight colors are not sufficient to make dark water glow.

SM-307 visibility suppresses direct/highlight energy without mutating the visibility texture or upstream shadow producers.

## Output and diagnostics

The staged output is `rgba16float` transparent water. Debug views are `final`, `mask`, `light`, `visibility`, `depth`, and `refraction`.

Diagnostics report field revision/room, upload count, canonical light-buffer name, active light count, ripple count, quality, input authority flags, pipeline compilation messages, and persistent resource state. Hosted CI reports correctness/readback evidence only; it does not claim GTX 1650 Super GPU timing or human visual parity.

## Verification

The deterministic validator covers shoreline encoding, 12-ripple bounding, eight canonical light directions, the no-self-light reference case, SM-307 direct-visibility suppression, depth-discontinuity rejection, ripple response, parameter packing, and source-path binding to SM-204/SM-202/SM-307.

The dedicated Chrome/WebGPU gate compiles and executes the production shader and validates eight 45-degree point-light positions against the CPU reference, measurable angular response, transparent-black dark-water output, canonical-depth/refraction reads, direct-light suppression by SM-307 visibility, bounded ripple response, stale-room rejection followed by a successful new-room render, and canonical-authority diagnostics.

The normal repository verification still runs the inherited SurfaceFX/WebGL2 coherence tests. Since SM-400 does not alter `engine/surfacefx.js` or gameplay interaction code, WebGL2 compatibility behavior remains the regression reference.
