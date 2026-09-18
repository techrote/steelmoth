# SM-402 — transparent/procedural ordering and depth interaction

SM-402 freezes one explicit ordering and visibility contract for the staged WebGPU renderer. It reconciles SM-400 water, SM-401 foliage/Fine Grass, SM-206 transparent/gameplay feedback, SM-207 post output, and the canonical SM-201/202 ownership depth. It does not promote WebGPU to the default presentation backend; SM-505 still owns that cutover.

## Accepted compatibility evidence

The accepted Material-v2 WebGL2 path already has a deliberate sequence rather than one generic transparent bucket. After deferred lighting it renders water, Fine Grass/ground procedural material, background foliage, ordinary world alpha/additive sprites, front grass/foreground foliage, then bloom/post. Gameplay shader FX are rendered after post, followed by top glow sprites, top alpha sprites, the active objective marker, and finally the guide. SM-206 preserved the relative transparent-feedback tail specifically so SM-402 could integrate procedural surfaces without relying on JavaScript call order.

The WebGPU path keeps those semantics where they are intentional, but replaces accidental painter-order visibility with canonical depth/classifier data. In particular, water or background foliage being submitted late is never permission to cover an opaque actor that is nearer in SM-201/202 depth.

## Canonical frame order

The executable authority is `engine/webgpu_ordering.js`. Its frame graph is:

1. `opaque-resolved` — SM-204/SM-307 lit opaque scene plus canonical object/depth ownership.
2. `water` — SM-400 forward water, sampling the stable opaque-resolved scene and canonical depth.
3. `fine-grass` — SM-401 receiver-only Fine Grass in the lit world.
4. `foliage-background` — SM-401 foliage classified behind representative actors/props.
5. `world-alpha` — SM-206 ordinary alpha world sprites.
6. `world-additive` — SM-206 additive/glow world sprites.
7. `foliage-foreground` — only SM-401 foliage explicitly classified in front by the existing `frontBlend`/depth classifier.
8. `post` — SM-207 bloom/grade/final transform, or an explicit raw/debug copy at the same boundary.
9. `post-effects` — SM-206 procedural gameplay FX that intentionally remain ungraded for compatibility/readability.
10. `top-additive` — top-layer additive sprites.
11. `top-alpha` — top-layer alpha sprites.
12. `objective` — active objective marker.
13. `guide` — guide feedback.
14. `debug-ui-present` — ordering visualization, external UI and presentation.

This is the only SM-402 ordering list. Backends may batch within a stage, but may not silently change stage ordinals. Unknown contributors are rejected by the ordering authority rather than appended opportunistically.

## Why water samples only the opaque-resolved scene

SM-400 needs a resolved colour source for conservative refraction. That source is deliberately `opaque-resolved`, not the evolving transparent target. Water therefore cannot become cyclic with foliage or later alpha effects: opaque lighting resolves first, water samples that stable texture, and later forward layers composite onto the new world target. This is a bounded one-way dependency.

Depth interaction remains canonical. Water, Fine Grass, background foliage, and SM-206 world transparent sprites test/sample SM-201/202 ownership depth and do not acquire transparent depth ownership. A farther water/grass/alpha fragment must not cover a nearer actor merely because its pass executes later.

## Foliage background/foreground policy

SM-401 already owns rooted deformation and the hysteretic actor-relative `frontBlend` classifier. SM-402 consumes that signal; it does not infer front/back from submission time or create another root/depth convention.

- Fine Grass is always `fine-grass`: receiver-only, non-emissive world material.
- Foliage with `frontBlend < 0.5` is `foliage-background` and remains subject to canonical opaque depth rejection.
- Foliage with `frontBlend >= 0.5` is `foliage-foreground` and may cross the actor surface because the classifier explicitly says it is in front.

This preserves the intended pass-behind/pass-in-front behavior without allowing every transparent plant to become an always-top overlay.

## Post, raw/debug, and readability tail

Raw/debug output does not mean “return early before later gameplay feedback.” SM-207's post slot remains stage 8 in every mode:

- normal mode executes the post transform;
- raw mode executes a raw copy;
- debug mode executes a debug copy/visualization.

The relative order before and after that slot is identical. `post-effects`, top sprites, objective and guide therefore retain their compatibility readability semantics in normal, raw and debug paths. A debug view can deliberately visualize a producer, but it cannot accidentally reorder unrelated layers.

## Blend and ownership rules

SM-402 does not redefine blend equations. SM-206 remains authoritative for alpha (`src-alpha / one-minus-src-alpha`) and additive (`src-alpha / one`) gameplay sprites. SM-400/401 remain authoritative for their own forward shading. The ordering module records each stage's blend/depth policy so diagnostics can expose mismatches.

World transparency never writes canonical ownership depth. `world-alpha` and `world-additive` use `less-equal`-style canonical rejection with no depth write. Water and background procedural vegetation sample/test the same authority. Top/readability layers intentionally bypass world depth and are explicit exceptions, not hidden backend hacks.

## No OIT in SM-402

No accepted fixture requires order-independent transparency. The current art direction has explicit semantic layers, bounded alpha/additive batches, and an actor-relative foliage classifier. OIT would not remove those semantic distinctions and would add substantial resource/composition complexity. If a later fixture demonstrates same-stage alpha ordering that cannot be solved deterministically, it should become a separate decision issue with evidence.

## Diagnostics and verification

`WebGPUOrdering.diagnostics()` exposes the canonical stage list, ordinals, reason, depth policy, post domain, enabled counts, raw/debug operation, water source, and the fact that hidden backend ordering is forbidden. `debugRows()` is the frame-graph visualization data source.

Deterministic validation covers the complete stage order, SM-206 stage mapping, raw/debug invariance, foliage thresholding, canonical depth acceptance, unknown-stage rejection, hidden-order rejection, and a representative actor/water/foliage/effect stack.

The hosted Chrome/WebGPU gate executes the production ordering debug compute path and reads the fourteen stage IDs back from a real GPU buffer. It also checks a representative overlap where water/background foliage behind an actor are rejected while a near world glow, explicitly foreground foliage, post FX, objective and guide remain visible. The gate records a screenshot of the debug stage strip and structured JSON evidence. It does not claim full WebGPU presentation cutover, subjective parity, or GTX 1650 Super timing.

## Backend/failure boundary

SM-402 is backend-neutral orchestration data plus a WebGPU debug/readback surface. Gameplay state remains authoritative outside the renderer. Failure to build or validate this staged ordering module must preserve the existing WebGL2 presentation fallback; it must not alter collision, objectives, save state, or actor simulation.
