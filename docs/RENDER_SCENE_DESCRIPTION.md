# Render Scene Description

Status: **SM-100 v1 scene contract, reconciled by SM-101 shared transform authority**

The Render Scene Description (RSD) is the backend-neutral renderer input introduced by SM-100. The v1.2.3 game/world/editor remains authoritative for gameplay. RSD is renderer-facing data only; it is not a second world model, save format, collision model, AI state store, or objective authority.

## Authority boundary

```text
Game / world / editor authority
        |
        | compatibility render submissions
        v
shared RenderTransform root/foot authority (SM-101)
        |
        v
RenderSceneBuilder
        |
        v
RenderScene (`steelmoth-render-scene/v1`)
        |
        +--> WebGL2SceneAdapter --> existing v1.2.3 WebGL2 renderer
        |
        +--> future WebGPU backend
```

`engine/webgl2_scene_adapter.js` captures existing renderer-facing calls and replays them through the original WebGL2 methods in original submission order. `engine/render_transform.js` and `engine/render_transform_scene_adapter.js` ensure the scene carries one numeric root/foot result rather than requiring each backend to reconstruct anchor math. Simulation, collision, AI, progression, room ownership and save state never read from RSD.

If scene capture or adaptation fails, the SM-100 bridge fails open for the session: pending submissions are replayed directly and the original WebGL2 path resumes. A renderer-boundary fault must not corrupt or gate gameplay.

## Record schemas

All schemas remain versioned independently. SM-101 adds `transformAuthority` metadata to the scene and canonical numeric roots without changing the existing `steelmoth-render-scene/v1` record family.

### `RenderScene`

Schema: `steelmoth-render-scene/v1`

Fields include frame identity/logical size, `sprites`, deduplicated `materials`, `lights`, `occluders`, `proceduralLayers`, renderer `settings`, post-grade inputs, overlays, the compatibility player-cone alias, deterministic stats, and after SM-101 a `transformAuthority` descriptor.

The scene is data only. A backend may maintain GPU resources and cosmetic temporal history, but it may not move gameplay authority into the scene.

### `SpriteInstance`

Schema: `steelmoth-sprite-instance/v1`

Each sprite records stable renderer ID/basis, explicit category (`static`, `ground`, `dynamic`, `foreground`, `top`), primitive/atlas/sprite/material IDs, position/size/rotation/flip, canonical numeric root metadata, style/blend/material mode, optional atlas subrect, rooted/sway data, coverage, cast/receive flags, material class and occluder class.

After SM-101, active runtime scenes use root authority `shared-render-transform/v1` or `explicit-shared-root`. Equivalent static, dynamic and foreground placements therefore carry the same root coordinate. Backends must consume that coordinate rather than recomputing it from sprite bounds.

### `MaterialInstance`

Schema: `steelmoth-material-instance/v1`

Material records identify the atlas region/material class; coordinate-identical albedo, Normal/Roughness and Height/Material resources; Material-v2 root-anchor metadata; local material height scale/bias; and compatibility material-mode overrides.

Material-v2 Height/Material remains **local material height**, not fragment ownership depth.

### `LightInstance`

Schema: `steelmoth-light-instance/v1`

A light record carries renderer-facing position, colour, intensity, radius, group/type and cone/visibility metadata. The player face cone has the semantic singleton ID `light:player-cone:0`. SM-204 remains responsible for canonical WebGPU light-buffer/deferred-lighting implementation.

### `OccluderInstance`

Schema: `steelmoth-occluder-instance/v1`

An occluder includes stable ID/basis, compatibility caster fields, normalized bounds, root/contact point, observed section Z range and material/silhouette class. SM-101 marks active occluder roots with the shared transform authority while preserving caller-selected numeric caster roots, so shadow placement is not visually retuned. SM-300 onward still owns the final clustering/DSO representation.

### `ProceduralLayer`

Schema: `steelmoth-procedural-layer/v1`

Water, Fine Grass, FoliageFX and effects are explicit procedural records with stable semantic layer ID, kind, ordering/visibility mode, declared future resource requirements and current descriptor payload. Full procedural depth/visibility integration remains downstream work.

## Category contract

| Category | Current source | Compatibility behaviour |
| --- | --- | --- |
| `static` | room `staticMaterialSprites` snapshot | represented in RSD; already resident in WebGL2 background/material state |
| `ground` | ground sprites/background rooted grass | replayed before ordinary world submissions |
| `dynamic` | player, objectives, robots, moths, particles, ordinary world sprites | replayed in original submission order |
| `foreground` | canopies/tall decor/subrect foreground/front-rooted grass | replayed into existing foreground paths |
| `top` | sparks/orbs/top overlays | replayed into existing top-overlay paths |
| procedural | water/grass/foliage/effects | separate `ProceduralLayer` records |

Foreground categorization must not invent a second root transform. Foreground visibility/depth bias is separate from root placement and remains available to later ownership-depth work.

## Stable identity contract

Current renderer ID bases remain:

- static material sprite: `sprite:static:<room-id>:<room-static-ordinal>`;
- dynamic/ground/foreground/top sprite: `sprite:<render-scope>:<ordinal>`;
- ordinary light: `light:<group>:<ordinal>`;
- player cone: `light:player-cone:0`;
- compatibility caster: `occluder:<source>:<ordinal>`;
- procedural layers: semantic singleton IDs such as `procedural:water`.

These are renderer identities, not gameplay identities. Animation-frame, tint or subpixel-transform changes do not by themselves change stable IDs while subsystem submission topology remains unchanged.

## WebGL2 compatibility adapter

Per frame:

1. original `renderer.begin()` preserves existing buffer-reset/timer behaviour;
2. the bridge creates an RSD builder and snapshots static material descriptors;
3. `add*` calls become typed scene records;
4. the SM-101 scene adapter resolves every sprite root through `SteelMothRenderTransform`;
5. `renderer.end(...)` converts lights/casters/procedural arguments;
6. the scene is validated;
7. `WebGL2SceneAdapter` replays records in original order;
8. original WebGL2 `end(...)` presents the frame with existing shading semantics.

The current scene remains diagnostically exposed as `game.renderScene`, `renderer.lastRenderScene`, and `globalThis.steelMothLastRenderScene`. Those are inspection surfaces, not gameplay APIs.

`webapp.js` loads shared transform/integration first, then RenderScene canonicalization, then the WebGL2 scene adapter. The service worker precaches all of these modules. If transform integration arrives after Game construction, it rebuilds the static descriptor cache once through the parity-preserving shared resolver.

## Root and depth semantics

SM-101 resolves the root/foot debt identified by SM-004 at the renderer boundary. The canonical contract is `docs/ROOT_FOOT_CONVENTION.md`.

The v1 root is an **unrotated ground-contact / ordering point**. Material-v2 `root_anchor` metadata determines its normalized position (default bottom-centre). Centre, bottom and top input anchors that describe the same rectangle converge on one numeric root. Rotation and horizontal flip retain the accepted v1.2.3 root position; they modify texel orientation, not ground-contact ordering. The historically specific subrect-centre rule is preserved exactly and is now explicit/tested.

Active RSD sprites therefore carry numeric roots with `shared-render-transform/v1` or `explicit-shared-root` authority. Static, dynamic and foreground copies do not ask a backend to independently interpret bottom/centre metadata.

This still does **not** define final pseudo-depth. **SM-201** must derive the light-independent fragment visibility-depth projection from the shared root, local Material-v2 height and adopted layer/bias rules; SM-202 then implements per-pixel depth/object ownership. `G2.R` remains local material height until those tasks explicitly change the representation.

## Procedural layers

The v1 RSD carries water, grass, foliage and effect descriptors while declaring future resource needs. Rooted procedural geometry may use `explicit-shared-root`: animation can bend geometry above that point but must not silently move the root. SM-400/401/402 own complete canonical light/depth/visibility integration.

## Failure isolation and gameplay safety

The renderer boundary stores no objectives, collision state, AI decisions or save progression. Game update remains independent of scene success. Initialization/capture failure leaves direct WebGL2 available and records diagnostics rather than silently producing a black canvas.

## Verification

SM-100's existing `validate_render_scene.js` and `validate_render_scene_contract.py` remain required. SM-101 adds `validate_render_transform.js` and `validate_render_transform_contract.py`, covering exact old/new numeric root parity, centre/bottom/top equivalence, scaling, subrects, flip/rotation behavior, editor placement, shadow footprint input, static/dynamic/foreground root parity, runtime load ordering and offline registration.

All are registered in `tools/run_checks.py`; inherited renderer/material/fixture/GLSL/package suites remain mandatory evidence that the data-boundary and root-authority migrations do not intentionally change accepted WebGL2 behaviour.
