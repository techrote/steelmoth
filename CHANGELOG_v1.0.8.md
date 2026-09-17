# The Small Machine at the Edge of Night — Webapp v1.0.8

## Terrain shadow / perception-light rework

v1.0.8 replaces the old three-class shadow-width approximation with two geometry-driven systems that share the same obstruction authority used by robot perception.

### Ray-sectioned player lighting

The mouse-directed cone and local player omni light now raycast against the room's real blocking geometry. At the default quality level the cone is sampled in **65 angular sections** and the omni light in **97 sections**. The nearest terrain hit for each section is uploaded to the light shader, which interpolates between adjacent rays and clips direct illumination behind obstruction edges with configurable softness.

The exact `Room.raycastDistance()` geometry is also used by robot light/LOS detection. A wall, barrel, cabinet or other solid authored prop that blocks the player's light therefore blocks robot perception consistently rather than using a separate approximation.

### Obstruction-edge projected shadows

General point-light terrain shadows no longer depend on `robot / large decor / small decor` width multipliers. Every mapped blocker and solid authored collision rectangle supplies actual obstruction geometry. For each selected point light the renderer derives the two silhouette/tangent corners of that rectangle relative to the emitter and projects those edges to the light's effective range, producing a proper shadow wedge with a soft side penumbra.

The unified MAX mask remains authoritative, so overlapping shadows do not darken exponentially. Contact AO uses the actual obstruction footprint instead of a class width.

### Terrain coverage

Shadow/occlusion geometry now covers:

- every map wall/blocker collision rectangle;
- every solid free-position authored prop;
- room boundary geometry for interactive light raycasts;
- objectives;
- large ambient robots and followers;
- other authored non-solid sprites explicitly marked as shadow casters.

Floor tiles and passable foliage are deliberately not treated as opaque shadow blockers.

### Player self-light

The face-mounted omnidirectional player light increases from 52 px / 0.105 to **60 px / 0.14**. It remains intentionally weak, but makes the protagonist readable in near-black scenes and expands the minimum illuminated zone that active stalkers prefer not to enter. It is independent of the global emitter/emissive multiplier, while still respecting the master Lighting toggle and terrain occlusion.

### Graphics controls

The Graphics + Lighting menu now exposes:

- projected-shadow strength, length and softness;
- number of point lights allowed to project shadows;
- terrain light-occlusion toggle, quality, strength and edge softness;
- player omni radius/intensity;
- player cone range/intensity/inner angle/outer angle;
- pulse, objective, companion, fragment, orbiter, ambient-life and firefly radius/intensity controls.

A fresh `signalOrchardGraphicsV108` preference namespace applies the new defaults without modifying gameplay progress.

### Defaults

Projected terrain shadows are now **ON by default**. This intentionally supersedes the earlier screenshot-derived default because the old option controlled a much cruder shadow implementation; the replacement is now part of the game's terrain/perception lighting model.

### Validation

Dedicated regressions verify obstruction geometry, silhouette selection, all-wall/all-solid-prop caster coverage, ray-count quality tiers, player-cone/omni terrain cutoffs, robot detection parity, menu/default coverage, and compilation/linking of the modified light-map GLSL ES 3.00 program.
