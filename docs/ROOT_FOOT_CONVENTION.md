# Shared sprite root / foot convention

Status: **SM-101 canonical transform contract**

## Purpose

Steel Moth has one renderer-facing authority for converting sprite placement into frame geometry and a root/foot coordinate: `engine/render_transform.js`, schema `steelmoth-render-transform/v1`.

This contract removes the historical disagreement between static painter bottom anchors, live-renderer centre anchors, foreground copies, editor selection/preview geometry, Material-v2 descriptor ordering, shadow-caster placement and the backend-neutral Render Scene Description. It deliberately does **not** define the future fragment-ownership pseudo-depth projection; SM-201 owns that formula.

## Canonical API

`SteelMothRenderTransform.resolve(art, spriteId, options)` accepts `x`, `y`, `w`, `h`, an input anchor (`center`, `bottom`, or `top`), optional atlas `subrect`, `rotation`/`flip` metadata and an optional `explicitRoot` for already-rooted procedural systems.

It returns deterministic frame data plus a numeric root with normalized atlas metadata. `rootMetadata()`, `frameBounds()`, `editorBounds()`, `shadowFootRect()` and `shadowSections()` are related shared helpers. `legacyFootAnchor()` is a narrow compatibility façade reproducing the old `getSpriteFootAnchor()` result exactly.

`shadowPlacement()` is the shared bridge between canonical sprite roots and the accepted v1.2.3 shadow representation. It resolves the sprite root first, then records any legacy **shadow contact** point as an explicit offset from that root. This lets current WebGL2 retain exactly the old silhouette/footprint placement without teaching future backends another competing root convention.

## Root meaning

The v1 shared root is the **unrotated ground-contact / ordering point** of the sprite. Material-v2 `root_anchor` metadata supplies its normalized location, defaulting to `[0.5, 1.0]` (bottom centre).

Rotation and horizontal flip do not move this v1 root. They change rendered texel orientation around the existing draw placement, while depth ordering and ground contact retain the accepted v1.2.3 behavior. Making rotation alter the root inside SM-101 would retune overlap ordering and violate the placement-preservation requirement; any later change requires an explicit product/architecture decision.

Equivalent rectangle placements expressed through centre, bottom or top anchors therefore resolve to the same root. Scaling changes frame dimensions and the metadata-derived root proportionally.

## Historical subrect compatibility

The imported v1.2.3 Material-v2 helper has a specific subrect rule: for a subrect descriptor, `x/y` are interpreted as the subrect centre while full-sprite scale is reconstructed from source-region and subrect dimensions. That rule applies even when the source static draw was otherwise labelled bottom anchored.

SM-101 preserves that numeric behavior exactly because changing it would move accepted static/foreground material samples. The rule is now explicit and tested rather than remaining an accidental duplicate interpretation. A later art migration may normalize source data, but it must carry separate visual-parity evidence.

## Runtime migration without baseline byte drift

`engine/game.js` and `engine/editor.js` remain the audited v1.2.3 compatibility source. SM-101 does not mass-rewrite those large baseline files merely to move arithmetic. Instead:

1. `render_transform_integration.js` interposes active Material-v2 foot and shadow-profile helpers with calls into the shared module;
2. the WYSIWYG editor instance receives shared `editorBounds()` and `frameBounds()` implementations for hit geometry and sprite preview placement;
3. active `Game.collectCasters()` is replaced at the compatibility boundary with a parity-preserving implementation that resolves every sprite caster through the shared root API and stores old visual shadow contacts as explicit offsets;
4. if asynchronous module loading completes after `Game` construction, `WebGL2SceneAdapter.attachGame()` invokes the integration and the static material descriptor cache is rebuilt once through the shared resolver;
5. `render_transform_scene_adapter.js` canonicalizes every captured static, ground, dynamic, foreground and top RenderScene sprite to a numeric shared root, and carries shared caster roots plus shadow-contact offsets into `OccluderInstance` records;
6. WebGL2 replay uses the same geometry, contact rectangles, shadow sections and submission order, while future WebGPU work receives already-resolved roots rather than reimplementing anchor math.

The integration is observable through `SteelMothRenderTransformIntegration`. If scene/transform setup fails, the existing SM-100 bridge remains fail-open to direct WebGL2; gameplay state never depends on transform-adapter success.

## Static, dynamic and foreground parity

For an equivalent visible sprite rectangle, the following agree numerically:

- static Material-v2 descriptor root;
- dynamic Material-v2 descriptor root;
- foreground copy root;
- RenderScene `SpriteInstance.root`;
- editor selection/preview root where the same placement is represented;
- the canonical sprite-caster root used by the shadow system.

Foreground bias is a later visibility/depth concern. Copying a sprite into the foreground category must not invent a second root transform.

## Shadows and occluders

The baseline had two concepts conflated in caller-specific arithmetic: a sprite's root and the point used to seed its legacy shadow footprint. They are now separated.

For sprite casters, SM-101 first resolves the canonical root from the same sprite/transform authority used by Material-v2 and RenderScene. `shadowPlacement()` then stores the historical WebGL2 shadow contact as `(offsetX, offsetY)` from that root and evaluates the old footprint/section formula at the contact point. This preserves the accepted output exactly even where historical shadow contact intentionally differed from the material root—for example the robot proxy footprint at `u.y + 0.42*h` rather than the bottom-centre material root.

Generic rectangular occluders with no sprite transform use an explicit occluder-contact root; they do not invent Material-v2 metadata. `OccluderInstance.root` exposes the canonical sprite root where one exists, while `shadowContact` records the compatibility contact/offset separately. WebGL2 replay keeps its legacy `rect`, `contactY` and section data unchanged.

This distinction is architecture-critical: SM-101 centralizes **where the sprite root is** without using that migration to retune the accepted shadow artwork. SM-201 can consume the shared root; later DSO work can decide whether/how legacy shadow-contact offsets remain relevant.

## Procedural systems

Rooted grass/foliage descriptors may supply an explicit root. The shared module records such roots as `explicit-shared-root`; procedural animation may bend geometry above that root but must not move the root implicitly. Full canonical procedural depth/visibility integration remains owned by SM-400/401/402.

## Validation

`node tools/validate_render_transform.js` covers centre/bottom/top equivalence, exact numeric parity with the imported v1.2.3 helper, non-default atlas roots, subrect reconstruction, scaling, flip/rotation invariance, editor placement, shadow placement/contact offsets and static/dynamic/foreground RenderScene root parity.

`python tools/validate_render_transform_contract.py` verifies runtime load ordering, compatibility interposition, shared caster collection, late-Game integration, editor routing, RenderScene canonicalization and offline-cache registration.

`python tools/validate_render_transform_browser.py` captures representative WebGL2 fixtures in a test-only immediately-pre-SM-101 mode and normal SM-101 mode. CI requires deterministic canvas and viewport screenshot SHA-256 values to be byte-identical before versus after the root migration, while retaining the image evidence as workflow artifacts.

The inherited renderer/material/fixture/GLSL/package gates remain mandatory.

## Downstream contract

SM-201 may derive light-independent fragment-ownership depth from this root plus local Material-v2 height, layer/bias and the projection adopted there. It must consume this shared root rather than create another static/dynamic/editor/shadow-specific anchor formula. WebGL2 and WebGPU may differ in rendering fidelity, but neither backend owns sprite-root semantics.
