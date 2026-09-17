# Steel Moth Material v2 — WebGL2 pseudo-G-buffer layout

## Purpose

The v1.2.3 WebGL2 renderer treats ordinary HD sprites as shallow 2.5D material fields rather than forward-lit quads with a generic bump texture. Gameplay coordinates remain the existing 640×360 logical XY world. Material v2 supplies **local pseudo-world height above a sprite's visible root plane**.

SM-004 correction: the baseline does **not** contain the future light-independent fragment-ownership depth described by the WebGPU architecture. G2.R is local material height only. Sprite overlap is still resolved primarily by foot/painter ordering, and the baseline has no object-ID attachment or hardware depth ownership path for these material sprites. See `docs/BASELINE_V123_AUDIT.md`.

## Material atlas contract

Two coordinate-identical Material-v2 atlases are generated for all 314 runtime regions.

### `sprite_material_normal_roughness.png`

```text
R = encoded normal X
G = encoded normal Y
B = encoded normal Z
A = roughness
```

Normals are coherent 2.5D surface normals generated from physical class, macro shape, height gradients and restrained source-art structure. Transparent pixels use the safe default `(128,128,255)` and runtime samples are NEAREST with region-safe UVs.

### `sprite_material_height_material.png`

```text
R = local pseudo-world height / 64
G = local material AO / cavity
B = metalness
A = emissive / material auxiliary
```

The channel contract is global. No sprite overloads channels differently.

The generator derives height from visible opaque coverage and forces the visible standing-sprite foot to height zero. Metadata carries `height_scale`, `height_bias`, `root_anchor`, material class and summary parameters. `root_anchor` is currently `[0.5,1.0]` for generated Material-v2 regions.

Legacy `sprite_bumpmap.png` and `sprite_specularmap.png` are retained for the explicit legacy/debug compatibility path and for specialized forward fallback use.

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

### G2 — Local pseudo-height / material

Preferred:

```text
RGBA16F
R = normalized local pseudo-height
G = metalness
B = material AO
A = emissive / auxiliary
```

Fallback:

```text
RGBA8
```

The packed Material-v2 atlas uses `R=height,G=AO,B=metal,A=emissive`; the runtime MRT G2 intentionally reorders the material fields to `R=height,G=metal,B=AO,A=emissive`. The conversion happens in the G-buffer sprite shader and is not a second asset convention.

**G2.R is not final visibility depth.** It contains no sprite-root Y term, object ID, layer projection or accepted SM-201 depth formula.

## Coverage

The G-buffer receives:

- static floor/background albedo with conservative default material;
- static HD scenery and decorations through retained static material descriptors;
- objectives;
- player;
- large robots and animated HD sprites;
- ordinary dynamic HD sprites;
- foreground HD copies and subrects.

SurfaceFX water/fine grass and FoliageFX remain specialized bounded forward adapters. Ordinary HD actors/scenery are restored after those adapters from the already-lit deferred scene so their Material-v2 response and visual ordering remain consistent.

## Root / foot / ordering semantics

Material descriptors share:

```text
getSpriteFootAnchor(...)
```

The helper reads Material-v2 `root_anchor` metadata and handles full sprites and subrects. It produces `footX/footY` used for descriptor ordering.

However, SM-004 verified that v1.2.3 does **not** yet have one universal root/foot/visibility-depth authority:

- static painter descriptors normally pass bottom-anchor coordinates;
- live/foreground renderer descriptors normally pass centre coordinates;
- macro shadow casters use separate `bottomY` + `shadow_profile` footprint/section conventions;
- some dynamic caster paths, notably robots, derive their own caster bottom;
- FoliageFX keeps a separate `rootY`/depth-bias foreground classifier.

Those conventions can be visually consistent in the compatibility renderer, but they are distributed. SM-101 owns centralization before SM-201/202 derive and implement fragment ownership depth.

Conceptually the current material field is:

```text
screenX = authored/rendered sprite X
screenY = authored/rendered sprite Y
localZ  = materialHeight * renderedSpriteHeightScale
footY   = getSpriteFootAnchor(...).y   # painter/order input
```

There is no baseline equation combining `footY + localZ + layerBias` into a hardware fragment-depth value.

## Static material rebuild semantics

`StaticPainter.build()` does the following on each static-room rebuild:

1. resets `staticMaterialSprites`;
2. creates and explicitly clears bump/spec/NR/HM CPU canvases;
3. records static Material-v2 descriptors while painting the room;
4. returns the descriptor snapshot with the static maps.

The current WebGL2 Material-v2 G-buffer does **not** sample the generated per-room NR/HM canvases. `Renderer.setBackground()` uploads the static albedo plus legacy bump/spec background maps and replaces `staticMaterialSprites`; the G-buffer then re-rasterizes those static descriptors from the coordinate-identical global Material-v2 atlases. The per-room NR/HM canvases are therefore build-side compatibility/intermediate state rather than the authoritative runtime material source.

`tools/validate_ghost_material_v120.py` covers descriptor reset, static canvas clearing, MRT clearing and editor invalidation.

## Frame lifecycle

Each Material-v2 frame:

1. dynamic material/sprite submission arrays are reset;
2. all three MRT colour attachments are explicitly cleared with `clearBufferfv`;
3. static room albedo/default material is written;
4. retained static Material-v2 descriptors are rasterized;
5. dynamic main-layer descriptors are `footY`/sequence ordered and rasterized;
6. foreground Material-v2 descriptors are ordered and rasterized;
7. half-resolution contact shadows are traced from local G2 height;
8. fullscreen deferred lighting consumes G0/G1/G2 + contact mask;
9. specialized water/grass/foliage forward adapters are integrated around the deferred scene;
10. deferred results for ordinary HD material sprites are restored in the appropriate visual layers;
11. existing projected macro shadow/AO overlay, bloom/post, top FX and UI complete the frame.

Editor mutations rebuild `Room`, invalidate `bgKey`, and call `ensureBackground(true)`, so stale static descriptors are not intentionally retained across an edit.

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

The player face cone uses light Z `22` logical units. Other light groups have explicit elevations in the runtime light collection path.

## Height self-shadowing

For configured self-shadowed lights, the direct-light shader marches a bounded number of samples in logical XY toward the light and interpolates expected ray Z. If sampled **local G2 height** exceeds that ray plus bias, direct visibility is reduced.

Quality mapping:

```text
0 = off
1 = 8 samples
2 = 12 samples
3 = 16 samples
4 = 28 samples
```

The trace has jitter, bias, maximum distance and early exit. Because G2 is local height rather than accepted cross-object ownership depth, this is a compatibility self-shadow approximation, not the future SM-201/202 visibility model.

## Contact shadows

A separate half-resolution target traces a short distance through G2 local height toward the dominant light. Quality mapping is bounded at 4/8/12 samples. Deferred lighting reconstructs the mask with a 3×3 height-aware weighted filter, reducing blur across large local-height discontinuities.

The contact target is persistent. No per-frame render-target allocation is performed.

## Macro shadows

The grounded sectioned-silhouette projected-shadow system remains for long floor shadows from relevant lights/casters. It is a separate representation driven by caster footprints/sections and caller-supplied bottoms rather than G2 fragment ownership.

In the Material-v2 path the player cone is not routed through the old legacy cone-macro insertion. Player-light local detail comes from Material-v2 self/contact shadow and hard-light terrain visibility; other projected caster/light shadows remain in the macro overlay.

This separation is important to the later bin/DSO work: the baseline does not already have cluster ownership or a unified shadow representation.

## Debug views

The Graphics → MATERIAL + DEPTH panel exposes fullscreen diagnostics for:

- albedo;
- `debugPseudoDepth` — compatibility name; currently displays local G2 pseudo-height;
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

Debug output bypasses bloom/post grading so the underlying quantity can be inspected directly.

## Migration note

SM-200 should preserve the v1.2.3 material-channel semantics and deterministic clear/readback behaviour. SM-201 must derive the missing root/local-height/layer → fragment-ownership projection, and SM-202 must implement object-ID/per-pixel ownership. Do not treat baseline G2.R or the `debugPseudoDepth` label as an already-accepted depth formula.
