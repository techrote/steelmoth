# SM-401 — canonical WebGPU foliage and Fine Grass

SM-401 stages the existing rooted FoliageFX/Fine Grass representation on the canonical WebGPU light, depth, and visibility state. It is a representation port, not a gameplay rewrite and not the final transparent-ordering cutover.

## Authority boundary

`engine/foliagefx.js` already keeps gameplay/collision authority outside the renderer. SM-401 reuses its deterministic registry, instance generation, rooted deformation, interaction-source model, and depth classifier through `FoliageFrameAuthority`. Actor inputs are copied into plain renderer data before update; WebGPU preparation never mutates player, follower, wildlife, collision, objective, or navigation state.

Presentation remains staged while `auto` still selects WebGL2. `webgpu_foliage.js` is loaded with the existing WebGPU preparation chain so later cutover work has one canonical foliage representation. SM-402 owns transparent/procedural ordering and compositing. SM-401 therefore emits bounded per-instance WebGPU shading/deformation state rather than inventing a second ordering model.

## Canonical inputs

The pass consumes exactly the existing renderer representations:

- SM-204 `sm204:lights` using the shared 64-byte `Light` ABI and the +X / -screen-Y / +Z convention;
- canonical depth from the G-buffer/depth chain at the foliage root position;
- SM-307 visibility, with direct and ambient visibility kept separate;
- FoliageFX rooted/depth classification and bounded interaction sources.

There is no independent foliage light list, shadow map, fake amber glow, or foliage-owned gameplay state.

## Fine Grass material contract

Fine Grass (`SHORT_GRASS`) is deliberately dark teal and non-emissive. The staged palette is `[0.065, 0.255, 0.225]`; darkness with zero ambient and no canonical light resolves to zero colour. Canonical direct light and SM-307 visibility modulate it in the same screen/pseudo-Z direction convention as opaque materials. This prevents the earlier yellow/amber self-lit failure mode while retaining a restrained teal identity when lit.

Roots stay locked through the existing `RootedDeformation.weight` contract. Wind remains coherent in screen/world coordinates; movement does not randomize normals frame-to-frame, avoiding shimmer as the canonical light direction changes.

## Occlusion classification

SM-401 makes the planned cost boundary explicit and bounded:

| vegetation | classification | receiver | contact | macro DSO |
| --- | --- | ---: | ---: | ---: |
| ground moss / Fine Grass / height < 14 px | receiver-only | yes | no | no |
| fern / flower / height < 28 px | contact-receiver | yes | yes | no |
| substantial bush / broad leaf >= 28 px | macro-eligible | yes | yes | yes |

This avoids per-blade DSO simulation. Tiny grass is receiver-only. Medium foliage may participate in local contact/AO-style visibility. Only substantial foliage is eligible to become a macro occluder.

## Root/depth semantics

Each generated plant keeps a single root at `(x, rootY)`. Actor-relative foreground/background transitions reuse the existing hysteretic `DepthClassifier`; the resulting blend is packed into the WebGPU instance record rather than recomputed from unrelated GPU state. This keeps actor overlap stable and leaves SM-402 one authoritative depth/ordering signal to compose.

## GPU record and output

The bounded instance cap remains the legacy FoliageFX hard cap (208). Each staged instance occupies 80 bytes and carries root/size, deformation profile, root-depth blend, base palette, category, and classification flags. The compute output is 48 bytes per instance: lit RGBA, illumination/direct/ambient/depth state, plus classification/category/bend/front-blend diagnostics.

The compute pass samples canonical visibility and depth at the root and consumes the canonical SM-204 light buffer. Diagnostic modes expose lighting, visibility, depth, front blend, classification, and bend without creating new gameplay state.

## Verification evidence

`tools/validate_webgpu_foliage.js` checks deterministic instance generation, dark-teal/no-emissive behaviour, the canonical light-vector convention, eight-angle directional response, root lock, bounded classification, source binding, and non-mutation of actor inputs.

`webgpu-foliage-smoke.html` plus `tools/validate_webgpu_foliage_browser.py --require-webgpu` execute the real WGSL compute path in Chrome/Chromium. The hosted gate records eight light angles, direct-visibility suppression, canonical depth sampling, the receiver/contact/macro classification matrix, root/depth accounting, renderer-independent interaction inputs, dark-scene no-glow behaviour, and diagnostics. The screenshot is retained as evidence, but hosted CI does not claim GTX 1650 Super timing or substitute a screenshot for numeric readback.

## Explicit non-goals

- No foliage art redesign or density retuning.
- No per-blade DSO or per-blade shadow rays.
- No new gameplay/collision ownership in GPU objects.
- No final procedural/transparent ordering policy; that is SM-402.
- No presentation-backend cutover; that remains later programme work.
