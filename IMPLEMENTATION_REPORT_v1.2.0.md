# Steel Moth Renderer Architecture Upgrade — Implementation Report v1.2.0

## Baseline audit

The implementation started from the latest executable webapp artifact available in the project workspace, v1.1.2. The separately described “Steel Moth DEV” audit fixes were **not assumed** to exist. Inspection found two material differences from that description:

- no shared `getSpriteFootAnchor()` helper existed in the executable source;
- static material buffers depended on fresh-canvas construction rather than explicit deterministic clears.

Those contracts were therefore implemented first and converted into regressions before Material v2 work proceeded.

The inherited v1.1.2 systems retained include:

- corrected sectioned terrain macro shadows;
- hard-light obstruction split used by flashlight/robot detection;
- current player cone/omni lighting;
- robot stalking/fear/corner/rush behavior;
- editor/runtime placement authority;
- sprite order / foreground replay;
- SurfaceFX and FoliageFX;
- static webapp/PWA packaging.

## Shared foot/root authority

`getSpriteFootAnchor()` is now the one material-position authority for static descriptors, dynamic HD sprites, foreground sprites and subrect rendering. It reconstructs the full-sprite scale for subrects and consumes Material-v2 `root_anchor` metadata.

This gives pseudo-height one shared zero plane instead of separate static/live/foreground interpretations.

## Static material rebuild correctness

Static world reconstruction explicitly clears all CPU-side material canvases with identity transform + `clearRect()` before repainting them. Static material descriptor arrays are replaced, not appended.

The per-frame MRT path explicitly clears G0, G1 and G2 with `clearBufferfv()` before any room/background/sprite rasterization.

Editor room rebuilds invalidate/reconstruct these buffers through the same runtime path. A ghost-material regression models object-present → clear/rebuild → object-deleted and requires material state to return to baseline.

## Material v2

`tools/generate_material_v2.py` deterministically processes every one of the 314 runtime atlas regions.

Generated atlases:

```text
assets/generated/sprite_material_normal_roughness.png
assets/generated/sprite_material_height_material.png
```

The generator classifies regions as:

```text
flat
vertical_plane
box
barrel
pole
frame
pipe
robot
character
foliage
glass
```

Large coherent geometry dominates normal generation. Source luminance contributes only a restrained structural/detail signal. Transparent gutters are written to safe neutral material values and runtime uses nearest sampling plus half-pixel atlas insets.

Standing sprites use the visibly opaque bottom/root as exact pseudo-Z zero. Representative regression sprites—crate, barrel, lamp, robot and player—are required to contain Z=0 on their bottom-most visibly opaque row.

### Material semantics

- flat floor materials retain very low height ranges and near-upward normals;
- vertical planes remain shallow and front-facing;
- boxes receive coherent top/front/side response with broad lips/recesses;
- barrels and poles use wrapped cylindrical X normals;
- frames retain transparent holes rather than becoming material slabs;
- pipes preserve separated runs and rounded response;
- robots/characters receive conservative smooth generated geometry;
- metal regions spatially vary paint/rust/bare-metal roughness/metalness instead of assigning one uniform number to an entire sprite.

Legacy bump/specular atlases remain untouched as an explicit validation/fallback path only.

## Pseudo-G-buffer

The v1.2.0 renderer adds a persistent three-target WebGL2 MRT G-buffer:

- G0 RGBA8 albedo/coverage;
- G1 RGBA16F normal/roughness when float colour buffers are available, otherwise RGBA8;
- G2 RGBA16F pseudo-Z/metalness/AO/emissive when available, otherwise RGBA8.

The exact production GLSL is validated against both float and RGBA8 fallback framebuffer configurations using surfaceless EGL / OpenGL ES 3.2 Mesa.

## Dynamic and foreground coverage

Material descriptors are recorded from the same HD sprite entrypoints used by player, robots, objectives and scenery. Foreground and subrect copies use identical Material-v2 region data, height scale and root anchors.

FoliageFX and SurfaceFX remain specialized forward passes by design. Material-v2 sprite pixels are restored from an exact deferred-scene copy after those passes where necessary to preserve established pseudo-depth ordering without creating a second lighting interpretation.

## Deferred direct lighting

A fullscreen material-lighting shader reconstructs pseudo-world XY/Z and applies:

- coherent normal response;
- roughness/metalness scaling;
- local material AO;
- GGX NDF;
- Schlick Fresnel;
- Smith/Schlick geometry term;
- dielectric F0 ≈ 0.04;
- albedo-derived metallic F0;
- energy-reduced metallic diffuse;
- bounded artistic PBR specular response;
- explicit per-light pseudo-Z.

Player flashlight cone lighting is evaluated in the same pass rather than being painted as an unrelated additive material effect.

## Height-aware self-shadowing

The deferred shader traces pseudo-height toward selected lights. The trace is bounded by quality, maximum distance and light count, uses jitter/bias, skips transparent samples and terminates immediately on a blocker.

The default tier uses 12 samples and two self-shadowed lights; quality 3 uses 16 and Ultra uses 28.

The self-shadow calculation is integrated into each light’s direct visibility, so the timer-query diagnostic records its cost within `directLighting`. Diagnostics state that explicitly rather than inventing a separate timing value.

## Screen-space contact shadows

A separate half-resolution contact mask traces short pseudo-depth rays toward the dominant light. Deferred reconstruction uses local pseudo-depth difference as a bilateral weight before applying the contact visibility factor.

This provides short grounding and inter-object shadow detail while the inherited projected terrain shadow system remains responsible for macro cast shadows.

## Graphics + Lighting UI

The new MATERIAL + DEPTH group exposes:

- Material v2 enable;
- temporary legacy material pipeline fallback;
- normal / height / roughness / metalness scales;
- material AO and PBR specular strength;
- self-shadow toggle, quality, light count, bias and maximum distance;
- contact shadow toggle, distance, strength and quality;
- all requested material/debug views.

Existing lighting and terrain-shadow controls remain available.

## GPU diagnostics

The renderer records:

- MRT dimensions/format/fallback state;
- material buffer memory estimate;
- G-buffer sprite counts;
- contact-shadow samples;
- self-shadow sample/light counts;
- active material debug mode;
- best-effort `EXT_disjoint_timer_query_webgl2` timings for G-buffer, contact shadow and deferred direct lighting.

When timer queries are unavailable the renderer degrades to `null` timing values without affecting rendering.

## Validation environment limitation

The managed Chromium runtime available during implementation does not expose WebGL contexts, and localhost navigation is administratively blocked. It is therefore not used as evidence for a live browser GPU frame.

Instead, GPU release validation uses surfaceless EGL/OpenGL ES 3.2 Mesa to compile/link all production GLSL programs and instantiate both required MRT layouts. Deterministic offline moving-light captures use the actual generated Material-v2 data and shader-equivalent GGX/height calculations to audit material coherence under a swept light. They are diagnostic captures, not falsely labelled browser screenshots.
