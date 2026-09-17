# Steel Moth Material v2 — Pseudo-G-buffer Layout

## Purpose

The v1.2.0 renderer treats ordinary HD sprites as shallow 3D material fields rather than forward-lit quads with a generic bump texture. Gameplay coordinates remain the existing 640×360 logical XY world. The third coordinate is pseudo-world Z derived from Material v2 height and the shared sprite foot/root anchor.

## Material atlas contract

Two coordinate-identical Material v2 atlases are generated for all 314 runtime regions.

### `sprite_material_normal_roughness.png`

```text
R = encoded normal X
G = encoded normal Y
B = encoded normal Z
A = roughness
```

Normals are coherent 2.5D surface normals generated from physical class, macro shape, height gradients and restrained source-art structure. Transparent pixels use the safe default `(128,128,255)` and runtime samples are NEAREST with half-pixel region insets.

### `sprite_material_height_material.png`

```text
R = pseudo-world Z / 64
G = local material AO / cavity
B = metalness
A = emissive / material auxiliary
```

The channel contract is global. No sprite overloads channels differently.

Pseudo-Z is generated relative to the same visible root/foot zero plane used by sprite positioning. Metadata carries `height_scale`, `height_bias`, `root_anchor`, material class and summary parameters.

Legacy `sprite_bumpmap.png` and `sprite_specularmap.png` are retained only for the explicit legacy/debug fallback.

## WebGL2 MRT G-buffer

### G0 — Albedo / coverage

Preferred and fallback format:

```text
RGBA8
RGB = unlit albedo
A   = sprite coverage
```

### G1 — Normal / roughness

Preferred:

```text
RGBA16F
RGB = encoded pseudo-world normal
A   = roughness
```

Fallback when `EXT_color_buffer_float` is unavailable:

```text
RGBA8
```

### G2 — Pseudo-depth / material

Preferred:

```text
RGBA16F
R = normalized pseudo-Z
G = metalness
B = material AO
A = emissive / auxiliary
```

Fallback:

```text
RGBA8
```

The packed Material-v2 atlas uses `R=height,G=AO,B=metal,A=emissive`; the MRT G2 intentionally reorders the runtime fields to `R=height,G=metal,B=AO,A=emissive` because those are the quantities consumed together by deferred shading. The conversion happens in the G-buffer sprite shader and is not a second asset convention.

## Coverage

The G-buffer receives:

- static floor/background albedo with conservative default material;
- static HD scenery and decorations;
- objectives;
- player;
- all large robots and animated HD sprites;
- ordinary dynamic HD sprites;
- foreground HD copies and subrects.

SurfaceFX water and fine grass, and FoliageFX, remain specialized bounded forward adapters. Ordinary HD actors/scenery are restored after those adapters from the already-lit deferred scene so their Material-v2 response and depth ordering remain consistent.

## Shared anchor / pseudo-world position

Every relevant static, live, foreground and subrect material descriptor calls the same:

```text
getSpriteFootAnchor(...)
```

Conceptually:

```text
worldX = logical screen X
worldY = logical screen Y
worldZ = materialHeight * renderedSpriteHeightScale
```

The root/foot anchor is Z=0. This same zero plane is used by G-buffer pseudo-depth, material generation, object ordering and the existing macro shadow system.

## Frame lifecycle

Each frame:

1. all three MRT attachments are explicitly cleared with `clearBufferfv`;
2. the static room albedo/default material is written;
3. static Material-v2 sprite descriptors are rasterized once;
4. dynamic main-layer descriptors are depth/foot ordered and rasterized;
5. foreground Material-v2 descriptors are rasterized with the same metadata;
6. half-resolution contact shadows are traced from G2 pseudo-depth;
7. fullscreen deferred lighting consumes G0/G1/G2 + contact mask;
8. forward-specialized water/foliage adapters are integrated around the deferred scene;
9. existing macro projected shadow/AO mask, top FX and post-processing complete the frame.

Static room reconstruction also explicitly clears the CPU/static material canvases before rebuilding, so deleted/moved sprites cannot leave ghost material state.

## Deferred lighting

The fullscreen direct-light pass uses:

- restrained Lambert/half-Lambert diffuse;
- GGX normal distribution;
- Schlick Fresnel;
- Smith/Schlick visibility;
- dielectric F0 ≈ 0.04;
- metallic F0 derived from albedo;
- roughness and metalness scales;
- local material AO on ambient only;
- bounded PBR specular scale;
- per-light pseudo-Z elevation.

The player face cone uses pseudo-Z `22` logical units. Other light groups have explicit elevations in `collectLights()`.

## Height self-shadowing

For the configured self-shadowed lights, the direct-light shader marches a bounded number of samples in logical XY toward the light and interpolates the expected ray Z. If sampled G2 pseudo-Z exceeds that ray plus bias, direct visibility is reduced.

Quality mapping:

```text
0 = off
1 = 8 samples
2 = 12 samples
3 = 16 samples
4 = 28 samples
```

The trace has jitter, bias, maximum distance and early exit.

## Contact shadows

A separate half-resolution target traces only a short distance through G2 pseudo-depth toward the dominant light. Quality mapping is bounded at 4/8/12 samples. Deferred lighting reconstructs the mask with a 3×3 depth-aware weighted filter, so it does not blur freely across large pseudo-depth discontinuities.

The contact target is persistent. No per-frame render-target allocation is performed.

## Macro shadows

The v1.1.2 grounded sectioned-silhouette shadow system remains for long projected floor shadows. Material-v2 self-shadow and contact shadow provide local visibility detail rather than replacing the macro system. The components are deliberately composed in separate stages to avoid multiplying three unrelated black masks together.

## Debug views

The Graphics → MATERIAL + DEPTH panel exposes fullscreen diagnostics for:

- albedo;
- pseudo-depth;
- normals;
- roughness;
- metalness;
- material AO;
- emissive/auxiliary;
- direct diffuse;
- direct specular;
- self-shadow visibility;
- contact-shadow visibility;
- final combined lighting.

Debug output bypasses bloom/post grading so the underlying buffer quantity can be inspected directly.
