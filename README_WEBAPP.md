# The Small Machine at the Edge of Night v1.2.3 — Static Webapp

This is a plain static WebGL2/PWA application. Hosted play requires no Python, Node, database, server-side API, or build step.

## Deploy

Upload the **contents of this directory** to an ordinary static host while preserving directory structure. GitHub Pages, Cloudflare Pages, Netlify, nginx/Apache and S3-compatible static hosting are suitable. The entry point is `index.html`; runtime paths are relative, so repository/subdirectory hosting is supported.

Do not open `index.html` directly with `file://`, because JSON and atlas files are fetched by the browser. For local preview use any static server, or the included optional `0Play-Webapp-v1.2.3.bat` on Windows.





## v1.2.3 SurfaceFX / foliage coherence fix

The large yellow regions reported in v1.2.2 were finally traced to the **Fine GrassField itself**, not to point lights, water or stale browser code. The procedural field was using the default Dusk-Rust `far_forest/tree_lights` palette and an almost/fully opaque alpha formula, so hundreds of overlapping blades formed bright amber masses that ignored Material-v2 lighting.

v1.2.3 changes the Fine GrassField to a dark teal Wet-Relay vegetation palette, reduces blade dimensions/opacity, and makes it sample the already-lit Material-v2 scene beneath it. FoliageFX now does the same and also consumes the Material-v2 normal atlas instead of remaining a separate bump-lit island. Both procedural vegetation systems therefore follow the actual player/main light direction and disappear naturally into darkness rather than glowing independently.

The hard flashlight visibility profile is also raised from 65/97 rays to **193 cone / 257 omni rays** at quality 3, greatly reducing long-throw angular stair-stepping. Local `localhost` / `127.0.0.1` preview deliberately unregisters prior service workers and clears `small-machine-web-*` caches, so BAT/Python development previews are now uncached by design.

See `BUGFIX_AUDIT_v1.2.3.md` and `docs/FINE_GRASS_ROOT_CAUSE_v1.2.3.png`.

## v1.2.0 Material v2 / pseudo-G-buffer renderer

This is a renderer architecture release, not a gameplay redesign. Normal HD sprites now participate in one Material v2 convention: explicit pseudo-height, coherent 2.5D normal, roughness, metalness, local material AO and emissive/auxiliary. The runtime rasterizes albedo + material fields into a three-target WebGL2 MRT pseudo-G-buffer, then performs deferred diffuse/GGX lighting, bounded pseudo-height self-shadowing and half-resolution screen-space contact shadows.

The legacy bump/specular atlases remain packaged solely for A/B/debug fallback. Material v2 is the default. Existing v1.1.2 macro projected terrain shadows remain as the long-range component and are composed separately from the new fine self/contact shadow terms.

All 314 runtime atlas regions have Material v2 data. Dynamic characters/robots and foreground copies use the same convention and shared foot/root anchor as static scenery. See `MATERIAL_V2_AUDIT.md`, `GBUFFER_LAYOUT.md`, `IMPLEMENTATION_REPORT_v1.2.0.md`, `PERFORMANCE_REPORT_v1.2.0.md` and `VALIDATION_v1.2.0.txt`.

## v1.1.2 corrected sectioned-silhouette terrain shadows

v1.1.1 had the right general idea but a critical units bug: generated terrain `height_px` values were atlas-pixel heights (often ~140–170) while runtime projection treated them as logical/world pixels. That made ordinary props geometrically taller than the pseudo-3D light and produced the enormous black wedges visible in the reported screenshot.

v1.1.2 stores terrain height as a **unitless fraction of the rendered sprite height** (`height_ratio`) and converts to logical pixels at runtime. For the current terrain set, the tallest sampled shadow section is now about 20.6 logical px rather than ~170. At the player's pseudo-light elevation this keeps the largest normal section projection factor around 0.325 instead of hitting the old 3.4 clamp.

The actual map blocker sprite is now used when building each terrain shadow caster, so crates, dumpsters, barriers, poles, pipes and frames use their own silhouette slices instead of falling back to the map-cell collision rectangle. Each generated profile groups multiple alpha-silhouette spans into height slices, preserving open-frame and multi-pipe gaps.

Direct flashlight clipping is also split from AI LOS: **free-standing props no longer act like infinite-height walls that cut the entire beam**. The rendered cone hard-clips only at map boundaries and structural vertical planes; ordinary props cast their sectioned projected ground shadow instead. Robot LOS/detection continues using the full physical obstruction set.

Bump/specular terrain atlases were regenerated again from the audited material pipeline. See `TERRAIN_LIGHTING_AUDIT_v1.1.2.md` and `docs/SHADOW_PROJECTION_DIAGNOSTIC_v1.1.2.png`.

## v1.1.1 physical terrain lighting pass

The terrain renderer now treats the major environment sprites as **2.5D objects rather than flat shadow-width classes**. Each standing prop has a grounded footprint plus several horizontal silhouette cross-sections sampled through its artwork. Those cross-sections are assigned inferred height above the floor and projected away from the real light emitter using a virtual light elevation. This means a barrel, cabinet, lamp post, pipe bundle and open scaffold no longer cast the same generic wedge.

The mouse flashlight itself participates in terrain shadow casting from the player's face position. Its shadow contribution is clipped to the visible cone, while the omni fill continues to provide local grounding. The shadow mask is now rendered at full scene resolution for crisper edges. Bump/specular shading also uses the **actual player emitter origin**, rather than a point halfway down the beam.

All 45 static terrain/environment/objective sprites were reprocessed for material response. Floor tiles use shallow local relief; wall/door/window art uses planar relief; boxes/cabinets use volumetric relief; barrels use cylindrical relief; poles use narrow vertical relief; frames/pipes preserve multipart structure. Standing volumes additionally receive sectioned projected-shadow metadata.

The player flashlight cone default intensity is now **2.0** and local omni fill is **0.16**. Bump lighting is enabled by default at a moderated **1.45** strength with **0.42** specular response to make the regenerated maps visible without overwhelming the pixel art.

Passive robot behavior is also corrected: when a passive stalker is visibly illuminated but is outside the shorter fear cone and outside close-flee range, it **stops completely** instead of continuing to adjust its 16 m stand-off distance and bouncing at the edge of the light.

See `TERRAIN_LIGHTING_AUDIT_v1.1.1.md` and `assets/generated/terrain_shadow_profiles_v1.1.1.json`.

## v1.1.0 terrain lighting / shadow profile pass

This version adds a terrain-lighting audit pass over the major blocker / objective sprites. Eligible sprites now carry generated sectioned shadow profiles derived from their alpha silhouette, and the terrain bump/specular atlases have been regenerated to better fit the isometric 2.5D presentation.

## v1.0.9 fear volume, corner escape and periodic stalker rush

Robot perception now distinguishes the **visible flashlight** from the **fear volume** used for immediate flight. The rendered cone remains the long 248 px beam. The fear cone follows the same mouse direction and terrain raycast, but is deliberately **wider** (5° additional half-angle) and only **72% as long** (178.56 px at the default beam range). A 240 ms fear latch prevents edge flicker when a robot sits around the cone boundary. This means a distant robot can be clearly visible in the end of the beam without instantly fleeing, while a nearer robot reacts before the rendered edge can oscillate across it. The player's 60 px omni light still counts as fear illumination.

Every level now contributes one dedicated robot that begins in **active stalk mode**. The total ambient population remains hard-capped at 16; spawn reservation guarantees all nine level-starters can exist while earlier robots still persist between rooms. Objective/crate activation continues promoting one additional passive robot to active stalking when possible.

Fleeing or distance-correcting robots can use the four map corners as escape routes. They path normally to a clear inner corner, cross only the final corner boundary segment, then are teleported to the **furthest collision-valid tile from the player** and resume their prior passive/active stalking role. This gives a cornered robot a believable escape valve without granting general noclip.

The current level's dedicated active stalker has a separate non-damaging **45-second rush**. At the interval it receives temporary noclip for at most 2.4 seconds, rushes directly at the player, can deliver one physical bump, then noclip is removed and it immediately returns to normal collision-aware flee/pathfinding. This is not the old attack system: there is no health/damage/attack state and `robot_attack_mode` remains false.

The AI candidate budget was also tightened: cover generation considers the 14 nearest physical occluders plus 16 bounded free candidates, and ordinary visible-stalker replans were slowed while fear reactions remain immediate. This offsets the added per-level starter robots.

## v1.0.8 terrain shadow and light-volume rework

Terrain lighting is now geometry-aware. The player cone uses 65 ray sections and the face-mounted omni light uses 97 at the default quality tier; both query the same room obstruction rectangles and `raycastDistance()` path used by robot LOS/light detection. Direct light therefore stops behind walls and solid authored props rather than merely drawing an unoccluded cone over them.

Projected point-light shadows now derive silhouette edges from each obstruction's actual collision rectangle and project those edges away from the light. The old robot/large-decor/small-decor width classes have been removed. Every mapped blocker and every solid authored free-position prop participates, along with objectives and large robots. Contact AO continues to use the unified MAX compositor.

The player's local face light is slightly stronger at **60 px radius / 0.14 intensity**, enough to keep the protagonist visible in very dark areas and enlarge the minimum light halo used by robot evasion. It is not multiplied by the global emissive control, but master Lighting and terrain occlusion still apply.

The Graphics + Lighting menu now provides terrain occlusion quality/strength/softness, shadowed-light count, full player omni/cone parameters, and radius/intensity controls for the pulse, objective, companion, fragment, orbiter, ambient-life and firefly light groups. New defaults use `signalOrchardGraphicsV108`.

## v1.0.7 gameplay changes

### Face-mounted player lamp

The mouse-directed cone now originates at the protagonist's **face/head area** rather than the logical body centre. It retains the long 248 px directional beam.

A very small omnidirectional fill also originates at the face: **52 logical px radius, 0.105 intensity**. This is intentionally only enough to make the immediate area readable and form a close personal-light boundary for actively stalking robots.

### Passive stalking — default

Every large ambient robot that is not explicitly active uses **passive stalk** behavior. For AI distance language, the webapp defines 1 nominal metre as 8 logical pixels; passive robots therefore attempt to maintain **16 m / 128 logical px** from the player.

They do not simply stand on a ring. They cautiously explore around that distance while preferring terrain cover and positions outside direct player line of sight. Blocking tiles and solid authored props are used to generate cover-to-cover waypoint candidates.

### Active stalking

Every successful objective/crate activation promotes one available passive robot to **active stalk** mode. Active stalkers try to get much closer—around 60 logical px—while avoiding exposure.

If the flashlight cone catches a robot, or it enters the small face-mounted omnidirectional halo with line of sight, the robot reacts immediately: it accelerates away, drops the current path, and rapidly replans for covered terrain. Active stalkers therefore try to remain just beyond the weak personal-light boundary, moving between barrels, cabinets, barriers, machinery and other occluders where possible.

### Chase response and bumping

All robots become more reactive when the player actively closes distance. A sufficiently close, rapidly approaching player triggers flee behavior even before physical overlap.

Robot attacks remain disabled. Physical bumping is retained but reduced and remains collision-resolved. Passive/active stalkers do not normally shove an idle player; repeated bumping should mostly occur when the player pursues a fleeing robot into a corner or narrow passage.

### Stable robot orientation

Robots can move backwards naturally. Their left/right sprite direction therefore follows a short rolling average of horizontal motion with hysteresis rather than instantaneous velocity. Small velocity sign changes no longer cause rapid sprite flipping.

### Little follower friend timing

The little follower companion is not present in levels 1–6. Mote first appears in **level 7, Dusk Switchyard**, and can follow from there. Level 8 / Edge Station retains Mote's independent-choice beat.

## Controls

- **Mouse** — aim player light cone
- **WASD / Arrow keys** — move
- **Space / E** — field pulse / inspect / activate current objective
- **C** — gather fragments
- **F** — companion formation
- **L** — area select / save menu
- **P** — pause
- **H** — help
- **G** — graphics / lighting
- **U** — LUT mixer
- **F2** — WYSIWYG editor
- **F11** — fullscreen

Controller movement/interactions remain supported; mouse input owns light direction only.

## Save data

Gameplay and graphics preferences remain in browser `localStorage`, scoped to the deployed origin. Existing gameplay progress remains compatible. The level-7 follower gate is enforced at runtime even if an older save already contains Mote.

## WYSIWYG editor on a static host

F2 still opens the editor. A static host cannot overwrite `game_data/maps.json`, so **SAVE MAPS** attempts the writable development endpoint when available and otherwise downloads `signal_orchard_maps.json`.

## PWA / offline behavior

`manifest.webmanifest`, `webapp.js` and `sw.js` provide installable/offline behavior on supporting HTTPS hosts. Application shell and JSON data are pre-cached; large atlas PNGs cache on demand. v1.2.3 uses `small-machine-web-v1.2.3-r1`.

### v1.1.1 terrain audit artifacts

- `TERRAIN_LIGHTING_AUDIT_v1.1.1.md` — per-sprite 2.5D classification and shadow-profile summary.
- `assets/generated/terrain_shadow_profiles_v1.1.1.json` — machine-readable footprint/height-section data.
- `docs/TERRAIN_SPRITE_MONTAGE_v1.1.1.png` — visual inventory of the audited terrain/objective sprites.
- `docs/TERRAIN_MATERIAL_SAMPLES_v1.1.1.png` — representative color/bump/specular comparisons.
- `tools/regenerate_terrain_lighting_maps.py` — deterministic material/profile regeneration tool.

### v1.2.0 Material-v2 / G-buffer artifacts

- `MATERIAL_V2_AUDIT.md` — 314-region material classification/generation summary.
- `assets/generated/material_v2_report.json` — machine-readable per-region Material-v2 metadata and generation parameters.
- `GBUFFER_LAYOUT.md` — MRT/pseudo-depth/deferred-lighting channel and frame ownership.
- `RENDERER_PHASE0_AUDIT_v1.2.0.md` — audited inherited render paths and baseline-fix verification.
- `IMPLEMENTATION_REPORT_v1.2.0.md` — architecture implementation report.
- `PERFORMANCE_REPORT_v1.2.0.md` — bounded-work/memory/timer-query report.
- `VALIDATION_v1.2.0.txt` — release validation ledger.
- `docs/v120_captures/` — deterministic before/after and moving-light material diagnostics for crate, barrel, cabinet, pipe cluster, lamp/pole, robot and mixed terrain.
- `tools/generate_material_v2.py` — deterministic atlas generator.
- `tools/validate_*_v120.py` — material, renderer, ghost-material, visual, GLSL/MRT and static-web validators.
