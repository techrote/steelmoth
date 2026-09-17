# The Small Machine at the Edge of Night / Steel Moth Renderer — Webapp v1.2.0

## Major rendering architecture upgrade

v1.2.0 replaces bump/specular as the authoritative ordinary-HD-sprite material model with one integrated Material v2 + pseudo-G-buffer + pseudo-depth shadow architecture.

### Material v2

- Added deterministic region-by-region generation for all 314 runtime atlas regions.
- Added `sprite_material_normal_roughness.png`:
  - RGB explicit XYZ normal;
  - A roughness.
- Added `sprite_material_height_material.png`:
  - R normalized pseudo-world Z;
  - G local material AO;
  - B metalness;
  - A emissive/auxiliary.
- Retained legacy bump/specular atlases strictly for A/B/debug fallback.
- Added physical material classes: flat, vertical plane, box, barrel, pole, frame, pipe, robot, character, foliage and glass.
- Added coherent plane/cylinder/structure normal generation and spatial paint/rust/bare-metal roughness/metalness variation.
- Added exact visible-root Z=0 contract for standing sprites.
- Added safe neutral material gutters and nearest/half-pixel runtime sampling.

### Shared material geometry authority

- Added shared `getSpriteFootAnchor()` material/root computation.
- Static, dynamic, foreground and subrect material descriptors use the same anchor system.
- Added explicit deterministic clearing of static material buffers before room rebuild.
- Added explicit per-frame `clearBufferfv()` of all G-buffer attachments.
- Editor/static rebuild now replaces material descriptors instead of retaining removed geometry.

### Pseudo-G-buffer

- Added WebGL2 MRT G-buffer:
  - G0 RGBA8 albedo/coverage;
  - G1 RGBA16F normal/roughness when supported;
  - G2 RGBA16F pseudo-Z/metalness/AO/emissive when supported.
- Added automatic all-RGBA8 fallback when float colour attachments are unavailable.
- Static scenery, objectives, player, robots, normal dynamic HD sprites and foreground copies share the convention.

### Deferred direct lighting

- Moved primary ordinary-HD material response into fullscreen deferred lighting.
- Added restrained Lambert/half-Lambert diffuse.
- Added GGX NDF, Schlick Fresnel and Smith/Schlick visibility.
- Added dielectric F0 ≈ 0.04 and albedo-derived metallic F0.
- Added metalness-aware diffuse suppression.
- Added material AO, roughness, metalness, normal, height and PBR specular scales.
- Added explicit pseudo-Z/elevation for light groups; player face light is elevated.

### Height-aware self-shadowing

- Added bounded pseudo-height ray self-shadowing in the direct-light visibility path.
- Quality tiers: 0 / 8 / 12 / 16 / 28 samples.
- Added jitter, bias, early exit, trace-distance limit and self-shadowed-light limit.
- Crate lips, barrel rims and dense pipe/robot structure can now occlude lower pseudo-depth surfaces.

### Screen-space contact shadows

- Added separate half-resolution pseudo-depth contact-shadow target.
- Quality tiers: 0 / 4 / 8 / 12 samples.
- Added configurable distance/strength.
- Deferred reconstruction uses a 3×3 pseudo-depth-aware weighted filter rather than indiscriminate blur.
- Existing v1.1.2 macro terrain shadows remain for long floor projection.

### Material + Depth UI / diagnostics

Added user controls for:

- Material v2 / temporary legacy fallback;
- normal, height, roughness, metalness and AO scales;
- PBR specular strength;
- self-shadow toggle/quality/light count/bias/max distance;
- contact-shadow toggle/distance/strength/quality;
- albedo, pseudo-depth, normal, roughness, metalness, AO, emissive, diffuse, specular, self-shadow, contact-shadow and final debug views.

Added diagnostics for:

- G-buffer size/format/memory;
- material sprite counts;
- self/contact sample counts;
- self-shadowed light count;
- best-effort WebGL2 GPU timer-query measurements for G-buffer, contact shadows and deferred direct lighting.

### Validation/tooling

- Added `tools/generate_material_v2.py`.
- Added `tools/validate_material_v2.py`.
- Added `tools/validate_renderer_v120.py`.
- Added `tools/validate_ghost_material_v120.py`.
- Added `tools/validate_visual_material_v120.py`.
- Added `tools/validate_glsl_v120.py` using surfaceless EGL/OpenGL ES.
- Added `tools/validate_webapp_v120.py`.
- Production validation compiles/links 26 GLSL program pairs and verifies both preferred float MRT and RGBA8 fallback framebuffer completeness.
- Added deterministic representative before/after captures and moving-light sweep diagnostics for crate, barrel, cabinet, pipe cluster, lamp and maintenance robot.

### Inherited fixes retained

- v1.1.2 grounded sectioned-silhouette macro terrain shadows;
- hard-light obstruction model used by player light and robot perception;
- existing robot AI/gameplay;
- static-web/PWA deployment;
- WYSIWYG editor behavior;
- SurfaceFX and FoliageFX specialized passes;
- gameplay/save data.

No gameplay redesign is part of this release.
