# SM-206 WebGPU transparent sprite and gameplay FX contract

## Purpose

SM-206 ports the ordinary non-water/non-foliage transparent gameplay-feedback surface to staged WebGPU without moving gameplay authority into the renderer. The implementation is `engine/webgpu_transparent_fx.js`. WebGL2 presentation remains authoritative during migration; SM-206 establishes an executable WebGPU path and the ordering/depth hooks needed by later full-frame composition.

## Verified v1.2.3 compatibility surface

The accepted WebGL2 baseline separates several transparent roles rather than treating every translucent draw as one interchangeable bucket:

- ordinary legacy sprites use alpha blending unless their glow flag requests additive blending;
- gameplay shader FX are rendered additively after the compatibility post pass and the GPU shader accepts at most 16 live FX records;
- top-layer glow sprites precede top-layer alpha sprites;
- the active objective marker is rendered after top sprites;
- the guide effect is rendered after the objective marker;
- `ParticleField.update()` retains at most 300 live particles after update;
- `ShaderFX` retains at most 18 gameplay records, while the WebGL2 shader consumes the first 16;
- objective, pulse, pickup, teleport and portal timing/state remain owned by the game and are only consumed by the renderer.

SM-206 preserves these distinctions instead of inventing new FX art direction.

## Explicit stage order

The staged WebGPU contract is:

1. `world-alpha`
2. `world-additive`
3. `post-effects`
4. `top-additive`
5. `top-alpha`
6. `objective`
7. `guide`

This is deliberately explicit so SM-402 can integrate water/foliage/grass without hidden draw-order assumptions. SM-207 still owns final bloom/post/grade output and may relocate the complete transparent composite relative to post-processing when full-frame parity is established; SM-206 only pins the relative semantics among its own compatibility roles.

## Blend contract

Alpha sprites use WebGPU `src-alpha / one-minus-src-alpha`. Additive sprites and procedural feedback use `src-alpha / one`. The two paths have distinct render pipelines and real-GPU readback tests; additive and alpha are not inferred from shader colour values.

## Atlas sampling

Legacy transparent sprite sampling uses the supplied atlas region and a half-texel inset on all packed-region edges. The browser fixture uses adjacent white/blue synthetic regions and verifies that edge sampling does not bleed into the neighbouring packed sprite.

The compatibility frame extractor reports unresolved atlas regions and omits only the invalid cosmetic record. It does not manufacture UVs or mutate gameplay state.

## Depth and ordering policy

World transparent sprites may consume canonical ownership depth when a `depth32float` view and per-instance canonical depth are supplied. Their pipeline uses `less-equal` and never writes depth, so transparent pixels can be rejected behind opaque ownership without stealing ownership from later fragments.

Top sprites, objective markers and guide FX deliberately bypass world depth in SM-206 because the baseline defines them as top/readability feedback. Their relative order is explicit in the stage list rather than inherited accidentally from JavaScript submission order.

SM-206 does not derive a second pseudo-depth convention. SM-201/202 remain the authority for canonical ownership depth.

## Bounded batching and renderer authority

`MAX_TRANSPARENT_SPRITES` is 640, giving headroom over the current 300-particle post-update cap while remaining hard bounded. `MAX_SHADER_FX` is 16, exactly matching the compatibility GPU shader. Excess records are counted as dropped in diagnostics rather than triggering unbounded allocation.

Per-stage vertex buffers and procedural uniform buffers are persistent and grow only to bounded demand. The renderer consumes a cloned compatibility frame and never mutates RenderScene or gameplay objects. Missing sprite regions are isolated to the offending cosmetic record.

## Procedural feedback

The production WGSL path covers the currently data-driven pulse/objective/teleport/pickup/portal effect kinds and separate objective/guide overlays. Position and age/life normalization are copied from RenderScene/gameplay inputs. The browser gate verifies pulse, objective and guide output at their requested logical coordinates.

Water and foliage are not part of this module. Bloom, colour grade and final output transform are not part of this module.

## Diagnostics

`WebGPUTransparentFX.diagnostics()` reports:

- schema and extent;
- batch caps;
- exact stage order;
- explicit blend states;
- world/top depth policy;
- per-stage render counts;
- WGSL compilation information;
- current frame statistics;
- bounded persistent-resource policy;
- WebGL2 fallback authority and the last isolated error.

These diagnostics are correctness evidence, not target-GPU performance evidence.

## Verification

Deterministic source/regression validation checks the extraction/classification model, input immutability, exact blend definitions, batch caps, atlas-edge math, missing-region isolation, procedural packing and compatibility-source contracts.

The required hosted real-WebGPU gate compiles the production WGSL and exercises actual pipelines/readback for alpha blending, additive blending, adjacent packed-atlas edges, opaque-depth rejection/acceptance, top-over-world ordering, pulse placement, objective placement, guide placement, caps and fault isolation.

Inherited WebGL2 browser pixel parity remains in the workflow, so adding the staged module cannot silently replace compatibility presentation.

## Evidence boundary and deferrals

SM-206 establishes functional/API/data parity for this transparent-feedback surface. It does **not** claim:

- final bloom/post/grade parity — SM-207;
- water/foliage/grass final ordering — SM-400/401/402;
- complete WebGPU game-frame presentation — later migration integration and SM-505 promotion;
- GTX 1650 Super performance — hardware measurement tasks;
- subjective final visual approval.

A failure in this staged path must remain renderer-cosmetic and preserve the WebGL2 fallback/gameplay state boundary.
