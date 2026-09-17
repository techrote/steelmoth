# Shadow / Lighting / Detection Audit — Webapp v1.0.8

## Problem found

The previous renderer had two different notions of obstruction:

1. robot LOS/light detection used collision geometry;
2. projected shadows used a synthetic point + `footW` and one of three width classes (`robot`, `largeDecor`, `smallDecor`).

That made terrain shadow coverage inconsistent and made shadow shape depend more on a category multiplier than the actual obstacle geometry. It also meant the player's directional cone was visually bright through geometry even when robot LOS correctly treated the same geometry as opaque.

v1.0.8 removes that split.

## One obstruction authority

`Room.rebuildLightOccluders()` builds the terrain-perception representation from the same physical data used by collision:

- room boundary strips;
- every authored wall's `collisionRect()`;
- every solid free-position `decorCollider.rect`.

`Room.raycastDistance()` is now the common primitive for:

- player cone visibility;
- player omni visibility;
- robot line-of-sight/light detection.

A terrain object therefore cannot be opaque to the robots but transparent to the player's interactive light merely because the two systems used different tests.

Across the nine shipped rooms the authored map contains **116 wall/blocker cells**, **45 solid free-position editor props**, **18 authored lamp assemblies**, and **27 objective machines**. Floor microtiles and passable foliage remain deliberately non-occluding.

## Direct player-light occlusion: ray-sectioned visibility

The player lights need much finer silhouette behavior than the old single-width projected wedge, because the light cone is also the robot-detection mechanism.

At quality 3:

- cone: **65** angular ray sections across the soft outer cone;
- omni: **97** angular ray sections around 360 degrees.

Quality ladder:

| Quality | Cone rays | Omni rays |
| ---: | ---: | ---: |
| 0 | 0 | 0 |
| 1 | 25 | 37 |
| 2 | 41 | 65 |
| 3 | 65 | 97 |

Each ray records the nearest solid-terrain hit distance. The light-map shader interpolates adjacent sections and applies a tunable soft cutoff around that hit distance. This produces genuine occluded light volumes behind walls, barrels, cabinets, barriers and other collision-bearing terrain instead of drawing the cone through them.

The ray arrays are fixed-cap GPU uniforms; quality changes the active count rather than allocating an unbounded structure.

## General point-light terrain shadows: obstruction-edge projection

The old width-class model has been deleted.

For each caster rectangle and each selected point light, v1.0.8:

1. takes the caster's real collision/shadow rectangle;
2. computes its angular extreme/tangent corners relative to the light;
3. projects those two silhouette edges away from the emitter to the light's effective range;
4. creates the core shadow quadrilateral;
5. adds low-alpha offset edge quads as a penumbra approximation;
6. composites every result into the existing half-resolution MAX shadow mask.

MAX composition is retained, so four overlapping shadow sources do not multiply into an implausibly black region.

The number of point lights allowed to project terrain shadows is bounded and user-configurable; default is **4**.

## Terrain/caster coverage

The caster audit now requires:

- every mapped wall/blocker rectangle;
- every solid authored free-position prop;
- non-solid authored sprites explicitly tagged `casts_shadow`;
- objectives;
- large ambient robots;
- follower robots.

The runtime cap is 192 geometric casters per frame. Current authored rooms are far below this before dynamic actors are added.

## Contact AO

Contact AO uses actual rectangle width/height. It no longer relies on the removed size classes.

AO is independent of the directional projected-shadow distance cull, so a terrain object may still ground itself with contact AO even when it is outside a useful range for long projected extrusion.

## Player self-light

The face-mounted omni light was increased slightly:

- previous: 52 px / 0.105;
- v1.0.8: **60 px / 0.14**.

It remains intentionally weak. Its purpose is to keep the protagonist readable in very dark scenes and to create a minimum illuminated personal space that active stalkers prefer not to enter.

The player omni is marked `independent`, so the global emitter/emissive multiplier cannot reduce it to zero. It still obeys:

- master Lighting toggle;
- terrain occlusion;
- light-map/post pipeline.

## Graphics + Lighting controls

The menu now exposes the physical/perception model directly.

### Shadow / occlusion

- Projected shadows
- Shadow strength
- Shadow length
- Shadow softness
- Shadowed point lights
- Terrain light occlusion
- Occlusion quality
- Occlusion strength
- Occlusion edge softness
- Contact AO
- AO strength

### Player light

- Omni radius
- Omni intensity
- Cone range
- Cone intensity
- Cone inner angle
- Cone outer angle

### Light groups

Radius and intensity controls are exposed for:

- pulse;
- objective;
- companion;
- fragment;
- orbiter;
- ambient life;
- firefly.

Colors remain semantic-LUT driven rather than introducing another independent RGB UI.

## Default behavior change

Projected shadows are **ON by default in v1.0.8**. This intentionally supersedes the earlier screenshot-derived default where the setting controlled the old coarse wedge implementation. The replacement shadow system is now part of the terrain/perception model rather than an optional approximation that normally looked worse when enabled.

Graphics settings use a fresh `signalOrchardGraphicsV108` namespace; gameplay progression remains untouched.

## Validation performed

- all nine room obstruction sets constructed against production map/atlas data;
- all wall + solid free-position terrain caster coverage checked;
- ray/rectangle intersection distance tested;
- LOS and raycast obstruction parity tested;
- rectangle silhouette tangent selection tested;
- player cone/omni obstruction cutoffs tested with the actual game methods;
- robot visibility behind the same obstruction tested;
- all graphics controls/defaults checked against HTML and runtime settings;
- old width-class identifiers verified absent from production runtime;
- modified light-map GLSL ES 3.00 compiled and linked under Mesa EGL/GLES alongside the normal production render shaders.

The managed execution environment still does not provide a reliable interactive Chromium localhost navigation path, so this report does not claim a live visual browser smoke that could not be performed. Geometry, runtime contracts, static hosting closure, and shader compilation are validated directly.
