# Shared sprite root / foot convention

Status: **SM-101 canonical transform contract**

## Purpose

Steel Moth has one renderer-facing authority for converting sprite placement into frame geometry and a root/foot coordinate: `engine/render_transform.js`, schema `steelmoth-render-transform/v1`.

This contract exists to remove the historical disagreement between static painter bottom anchors, live-renderer centre anchors, foreground copies, editor selection/preview geometry, Material-v2 descriptor ordering, shadow footprint helpers and the backend-neutral Render Scene Description. It deliberately does **not** define the future fragment-ownership pseudo-depth projection; SM-201 owns that formula.

## Canonical API

`SteelMothRenderTransform.resolve(art, spriteId, options)` accepts:

- `x`, `y`, `w`, `h`;
- input `anchor`: `center`, `bottom`, or `top`;
- optional atlas `subrect`;
- `rotation` and `flip` as render-transform metadata;
- optional `explicitRoot` for systems whose source data already stores a root, such as rooted procedural plants.

It returns deterministic frame data plus a numeric root with normalized atlas metadata. `rootMetadata()`, `frameBounds()`, `editorBounds()`, `shadowFootRect()` and `shadowSections()` are the related shared helpers. `legacyFootAnchor()` is a narrow compatibility façade reproducing the old `getSpriteFootAnchor()` result exactly.

## Root meaning

The v1 shared root is the **unrotated ground-contact / ordering point** of the sprite. Material-v2 `root_anchor` metadata supplies its normalized location, defaulting to `[0.5, 1.0]` (bottom centre).

Rotation and horizontal flip do not move this v1 root. They change rendered texel orientation around the existing draw placement, while depth ordering and ground contact retain the accepted v1.2.3 behavior. This is intentional: making rotation alter the root inside SM-101 would retune overlap ordering and violate the placement-preservation requirement. A later explicit product decision may revise that convention, but it must not happen implicitly inside SM-201.

Equivalent rectangle placements expressed through centre, bottom or top anchors therefore resolve to the same root. Scaling changes frame dimensions and the metadata-derived root in the expected proportional way.

## Historical subrect compatibility

The imported v1.2.3 Material-v2 helper has a specific subrect rule: for a subrect descriptor, `x/y` are interpreted as the subrect centre while full-sprite scale is reconstructed from the source-region and subrect dimensions. That rule applies even when the source static draw was otherwise labelled bottom anchored.

SM-101 preserves that numeric behavior exactly because changing it would move accepted static/foreground material samples. The rule is now explicit and tested rather than being an accidental duplicate interpretation. A later art migration may normalize source data, but it must carry its own visual-parity evidence.

## Runtime migration without baseline byte drift

`engine/game.js` and `engine/editor.js` are retained as the audited v1.2.3 compatibility source. SM-101 does not rewrite those large baseline files merely to move arithmetic. Instead:

1. `render_transform_integration.js` interposes the active global material-foot and shadow-profile helpers with calls into the shared module;
2. the WYSIWYG editor instance receives shared `editorBounds()` and `frameBounds()` implementations for hit geometry and sprite preview placement;
3. if the asynchronous module load completes after `Game` construction, the static material descriptor cache is rebuilt once through the new authority; because the resolver is numerically parity-preserving, this changes authority rather than art placement;
4. `render_transform_scene_adapter.js` canonicalizes every captured static, ground, dynamic, foreground and top RenderScene sprite to a numeric shared root before a backend consumes it;
5. WebGL2 replay uses the same scene and original submission order, while future WebGPU work receives the already-resolved root rather than reimplementing anchor math.

The interposition is deliberately narrow and observable through `SteelMothRenderTransformIntegration`. If transform setup fails, the existing SM-100 renderer bridge still retains its fail-open WebGL2 behavior; gameplay state is never made dependent on transform-adapter success.

## Static, dynamic and foreground parity

For an equivalent visible sprite rectangle, the following must agree numerically:

- static Material-v2 descriptor root;
- dynamic Material-v2 descriptor root;
- foreground copy root;
- RenderScene `SpriteInstance.root`;
- editor selection/preview root where the same placement is represented;
- the explicit caster root supplied to shadow footprint/profile generation.

Foreground bias is a later visibility/depth concern. Copying a sprite into the foreground category must not invent a second root transform.

## Shadows and occluders

Shadow footprint and section-profile math now consumes a single explicit caster root through the shared module. Existing caller-selected caster roots are preserved to avoid shadow retuning in SM-101. The RenderScene occluder record marks those roots with the shared transform authority so a future WebGPU shadow path does not need to reverse-engineer a bottom coordinate from bounds.

This distinction matters: SM-101 centralizes **where the root is and how placement maps to it**. It does not decide the SM-201 fragment-depth projection or the later DSO representation.

## Procedural systems

Rooted grass/foliage descriptors may supply an explicit root. The shared module records such roots as `explicit-shared-root`; procedural animation is free to bend geometry above that root but must not move the root implicitly. Full canonical procedural depth/visibility integration remains owned by SM-400/401/402.

## Validation

`node tools/validate_render_transform.js` covers:

- centre/bottom/top equivalence;
- exact numeric parity with the imported v1.2.3 helper;
- non-default atlas root metadata;
- subrect reconstruction;
- scaling;
- flip and rotation invariance of the ground-contact root;
- editor bottom/centre placement;
- shadow footprint/profile input;
- static/dynamic/foreground RenderScene root parity and numeric backend-ready roots.

`python tools/validate_render_transform_contract.py` verifies runtime load ordering, compatibility interposition, editor routing, RenderScene canonicalization and offline-cache registration. The inherited renderer/material/fixture gates remain required to catch placement or material-sampling regressions.

## Downstream contract

SM-201 may derive a light-independent fragment-ownership depth from this root plus local Material-v2 height, layer/bias and whatever projection is adopted there. It must consume this shared root rather than creating another static/dynamic/editor-specific anchor formula. WebGL2 and WebGPU may differ in rendering fidelity, but neither backend owns sprite-root semantics.
