# Render Scene Description

Status: **SM-100 v1 contract**

The Render Scene Description (RSD) is the backend-neutral renderer input introduced by SM-100. The v1.2.3 game/world/editor remains authoritative for gameplay. The RSD is a per-frame description of renderer-facing state only; it is not a second world model, save format, collision model, AI state store, or objective authority.

## Authority boundary

The data flow is:

```text
Game / world / editor authority
        |
        | existing render submissions + lights/casters/procedural descriptors
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

SM-100 deliberately preserves the existing WebGL2 compatibility implementation. `engine/webgl2_scene_adapter.js` captures the existing renderer-facing calls, creates typed records, then replays those records through the original WebGL2 methods in their original submission order. Simulation, collision, AI, progression, room ownership and save state never read from the RSD.

If scene capture or adaptation fails, the bridge fails open for the session: pending submissions are replayed directly and the original WebGL2 path resumes. A renderer-boundary fault must not corrupt or gate gameplay.

## Record schemas

All schemas are versioned independently so later tasks can extend records without pretending that an ownership-depth formula already exists.

### `RenderScene`

Schema: `steelmoth-render-scene/v1`

Fields:

- `frame` — frame sequence, room ID, logical size and optional frame time;
- `sprites` — all captured `SpriteInstance` records, including the static-room descriptor snapshot;
- `materials` — deduplicated `MaterialInstance` records referenced by HD sprites;
- `lights` — point/group lights plus the player cone where present;
- `occluders` — current compatibility caster records converted to `OccluderInstance`;
- `proceduralLayers` — water, grass, foliage and effects descriptors;
- `settings` — renderer settings snapshot for the frame;
- `post` — colour-grade inputs;
- `overlays` — compatibility guide/objective-marker records;
- `playerCone` — explicit compatibility alias for the cone light while the WebGL2 adapter still accepts that argument separately;
- `stats` — deterministic category/record counts for diagnostics.

The scene is data only. A backend may maintain its own GPU resources and cosmetic temporal history, but it may not move gameplay authority into the scene.

### `SpriteInstance`

Schema: `steelmoth-sprite-instance/v1`

Fields include:

- stable `id` and `stableIdBasis`;
- explicit `category`: `static`, `ground`, `dynamic`, `foreground`, or `top`;
- primitive kind and atlas family (`legacy` or `hd`);
- sprite/region ID and optional Material-v2 `materialId`;
- renderer-facing transform: position, size, rotation and flip;
- root metadata describing the current compatibility authority;
- tint/colour, alpha, blend/glow and compatibility material mode;
- optional atlas subrect;
- rooted-grass/sway information where applicable;
- coverage, cast/receive flags, material class and occluder class.

`top` is retained as an explicit overlay category because the v1.2.3 path renders those submissions after post/bloom. It is not a claim that all future backends must use the same implementation stage.

### `MaterialInstance`

Schema: `steelmoth-material-instance/v1`

A Material instance identifies:

- the atlas region/material region;
- material class and source material class;
- coordinate-identical albedo, Normal/Roughness and Height/Material atlas resources;
- Material-v2 root-anchor metadata;
- local material height scale/bias;
- compatibility material-mode overrides.

The Material-v2 Height/Material source channel retains the audited v1.2.3 semantics. It does **not** become fragment ownership depth merely by entering the RSD.

### `LightInstance`

Schema: `steelmoth-light-instance/v1`

A light record carries the existing renderer-facing position, colour, intensity, radius, group/type and any cone/visibility metadata supplied by the game. The player face cone has the semantic singleton ID `light:player-cone:0`.

SM-100 extracts the boundary; it does not redesign the current light model. SM-204 remains responsible for the canonical WebGPU light-buffer/deferred-lighting implementation.

### `OccluderInstance`

Schema: `steelmoth-occluder-instance/v1`

A compatibility occluder includes:

- stable ID/basis;
- original compatibility caster fields;
- normalized bounds and root/contact point;
- observed section Z range;
- material/silhouette class.

These records preserve the current caster representation for WebGL2 parity. They are not the final GPU clustering/DSO representation; SM-300 onward owns that work.

### `ProceduralLayer`

Schema: `steelmoth-procedural-layer/v1`

Water, Fine Grass, FoliageFX and effects are explicit procedural records rather than implicit positional arguments. Each record declares:

- stable semantic layer ID;
- kind;
- compatibility ordering mode;
- visibility mode;
- the canonical resources it is expected eventually to consume;
- the current descriptor payload.

This makes procedural dependencies visible without changing the v1.2.3 SurfaceFX/FoliageFX algorithms in SM-100.

## Category contract

The compatibility scene distinguishes the categories that were implicit in v1.2.3:

| Category | Current source | Compatibility behaviour |
| --- | --- | --- |
| `static` | `renderer.staticMaterialSprites` room snapshot | already resident in WebGL2 background/material state; represented in RSD but not replayed per frame |
| `ground` | ground sprites and background/rooted grass | replayed before ordinary world submissions |
| `dynamic` | player, objectives, robots, moths, particles and ordinary world sprites | replayed in original submission order |
| `foreground` | canopies/tall decor/subrect foreground and front-rooted grass | replayed into the existing foreground paths |
| `top` | sparks/orbs and other top overlays | replayed into the existing top overlay paths |
| procedural | water/grass/foliage/effects descriptors | separate `ProceduralLayer` records |

The RSD does not infer gameplay semantics from those categories.

## Stable identity contract

SM-100 needs deterministic renderer identity before every gameplay subsystem has been refactored to provide semantic render IDs. The v1 contract therefore records both the ID and how it was derived.

Current bases are:

- static material sprite: `sprite:static:<room-id>:<room-static-ordinal>`;
- dynamic/ground/foreground/top sprite: `sprite:<render-scope>:<ordinal>`;
- ordinary light: `light:<group>:<ordinal>`;
- player cone: `light:player-cone:0`;
- compatibility caster: `occluder:<source>:<ordinal>`;
- procedural layers: semantic singleton IDs such as `procedural:water`.

Known render scopes include player, objectives, followers, creatures, fireflies, moths, particles, mini-robots, trees, hero grass, floaters and foreground scenery. Consequently an animation-frame change, tint change, or subpixel transform change does not itself change the stable sprite ID as long as the subsystem submission topology is unchanged.

These IDs are **renderer identity, not gameplay identity**. Later extraction work may replace an ordinal basis with an authoritative object/entity ID where one exists, while keeping the record schema and documenting the new `stableIdBasis`. No gameplay logic may depend on these compatibility IDs.

## WebGL2 compatibility adapter

`engine/webgl2_scene_adapter.js` installs after the v1.2.3 game begins loading. It wraps the existing renderer rather than replacing the renderer object, because current game code legitimately reads renderer diagnostics/capability state such as FoliageFX readiness.

Per frame:

1. original `renderer.begin()` runs, preserving all existing buffer reset/timer behaviour;
2. the bridge begins an RSD builder and snapshots static material descriptors;
3. existing `add*` submission methods create `SpriteInstance`/`MaterialInstance` records rather than immediately populating WebGL2 arrays;
4. `renderer.end(...)` converts the existing light/caster/procedural arguments into the remainder of the scene;
5. the scene is validated;
6. `WebGL2SceneAdapter` replays the captured sprite records in order to the original renderer methods;
7. the original WebGL2 `end(...)` presents the frame unchanged in architecture and shading semantics.

The current scene is exposed diagnostically as `game.renderScene`, `renderer.lastRenderScene`, and `globalThis.steelMothLastRenderScene`. Those are inspection surfaces, not gameplay APIs.

The bridge is loaded asynchronously from `webapp.js`; the service worker precaches both modules. `render-test.html` remains compatible because its existing configurable `window.game` adapter is composed rather than replaced.

## Root and depth semantics

SM-100 does **not** claim to solve the root/foot discrepancies found by SM-004.

RSD root fields say which compatibility input currently owns a sprite root:

- `compatibility-recorded-foot` for the static descriptor snapshot;
- `compatibility-metadata` for ordinary HD submissions;
- `explicit-root` for rooted-grass submissions;
- `compatibility-input` for simple legacy quads.

This makes the debt explicit. **SM-101** remains responsible for one authoritative root/foot transform shared by static, dynamic, foreground, editor, shadow and procedural paths.

Likewise, Material-v2 local height remains local height. **SM-201** must derive the light-independent fragment visibility-depth projection, and SM-202 must implement per-pixel depth/object ownership. SM-100 introduces no competing depth formula and does not reinterpret `G2.R`.

## Procedural layers

The v1 RSD carries current water, grass, foliage and effect descriptors exactly enough for WebGL2 replay while declaring future resource needs:

- water: canonical light + resolved scene;
- Fine Grass: canonical light + resolved scene;
- foliage: canonical light + resolved scene + root/depth;
- effects: canonical light.

Those requirements are declarations for later backend work. SM-100 does not make current WebGL2 procedural shading consume unavailable WebGPU buffers.

## Failure isolation and gameplay safety

The bridge is deliberately cosmetic infrastructure:

- it stores no objectives, collision state, AI decisions or save progression;
- the game continues to update independently of renderer-scene success;
- initialization failure leaves direct WebGL2 available;
- per-frame scene-capture failure replays pending submissions, disables the bridge for the session, and resumes direct WebGL2;
- the failure is recorded in bridge diagnostics/console rather than silently producing a black canvas.

This is the same authority rule future WebGPU lifecycle/fallback work must preserve.

## Verification

SM-100 adds two deterministic gates:

- `node tools/validate_render_scene.js` creates a mock game/renderer, captures a representative frame, validates all typed records, proves explicit categories, confirms stable scope IDs across animation/transform changes, verifies exact compatibility replay order, and asserts gameplay state is untouched;
- `python tools/validate_render_scene_contract.py` checks runtime/offline registration plus the source/document contract.

Both are registered in `tools/run_checks.py`. The ordinary inherited renderer/material/fixture/GLSL/package suites remain required; they provide regression evidence that introducing the data boundary did not intentionally change the accepted WebGL2 compatibility renderer.
