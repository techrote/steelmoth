# Renderer Phase-0 Audit — v1.2.0

## Baseline actually inspected

The latest executable artifact available in the workspace was the static webapp v1.1.2. The separate Steel Moth DEV audit description was used as a required contract list, but its claims were verified against source rather than assumed.

Two expected DEV fixes were absent from that executable source and were implemented before the architecture change:

1. no shared `getSpriteFootAnchor()` existed;
2. static material canvases were not explicitly cleared as a contract before reconstruction.

The v1.2.0 regressions now require both.

## Static-world render paths

`StaticPainter.build()` owns static-room rasterization. It draws:

- procedural floor/path/water/blocker microtiles into the static colour canvas;
- blocker sprites;
- vegetation/decor;
- editor decor;
- static robots;
- completed objectives;
- gates;
- UI backing.

Ordinary static HD sprite calls flow through `StaticPainter.sprite()` / `spriteSubrect()`. Those functions now both call `recordMaterialSprite()`, which stores the atlas region, transform, tint mode and shared foot/root anchor for the GPU Material-v2 reconstruction.

The procedural floor colour canvas enters the G-buffer with a conservative flat default material. Ordinary static HD sprites are re-rasterized into the MRT from Material-v2 atlas data.

Static legacy bump/specular and Material-v2 NR/HM canvases are still reconstructed for audit/fallback parity; all are explicitly cleared before painting.

## Dynamic HD sprite paths

The live renderer exposes the existing paths:

```text
addHD
addHDSubrect
addHDTint
```

They continue populating existing forward batches for legacy/fallback and established visual adapters, while also recording Material-v2 descriptors. Each descriptor uses `getSpriteFootAnchor()`.

Player, objectives, large robots and ordinary animated HD sprites consequently write into the same G-buffer convention.

## Foreground paths

Foreground paths:

```text
addHDForeground
addHDSubrectForeground
```

record the same material region and root/height information as ordinary world copies, differing only in layer/order. This is the foreground parity contract.

## Legacy material sampling

The legacy path remains present for validation/debug fallback:

- `uBumpTex` / `uSpecularTex` sampling in HD forward shaders;
- static background legacy material shader;
- user-visible `Legacy material pipeline` toggle.

Legacy material lighting uses the correctly declared/bound `uBumpStrength` name in its current shader family. Material-v2 deferred lighting uses `uNormalStrength`. Validation rejects the historical `u_bump_strength` / `u_normal_strength` naming mismatch.

## Material-v2 sampling

The G-buffer material shader samples:

```text
uAlbedo
uNormalRoughness
uHeightMaterial
```

with NEAREST atlas textures. Region UV helpers use a half-pixel inset. Transparent pixels below the coverage threshold are discarded, and generated transparent material gutters are neutral.

## Light accumulation

The previous forward light-map path remains for the explicit legacy mode. Material v2 uses the fullscreen deferred pass with explicit pseudo-Z lights.

Light groups receive class elevations. The player cone originates at the current face-light XY and pseudo-Z 22.

## Macro shadows

The existing v1.1.2 grounded sectioned-silhouette projected-shadow system remains authoritative for long floor cast shadows. It uses the same room/light obstruction authority already shared with player flashlight/robot perception.

Material-v2 self/contact shadows are local visibility terms and do not replace that macro system.

## Contact AO / contact shadow

Existing macro/contact AO remains in the shadow mask. Material v2 adds a separate half-resolution pseudo-depth contact-shadow pass for fine inter-object/grounding visibility.

## Render targets before v1.2

Inherited targets include:

```text
scene
light
shadowMask
bloomA
bloomB
background colour/material textures
water/foliage subsystem resources
```

## New v1.2 persistent targets

```text
G0 albedo/coverage
G1 normal/roughness
G2 pseudo-Z/material
contactMask (half resolution)
deferredCopy
```

No target is allocated per frame.

## Material buffer clearing contract

Static CPU material canvases are explicitly cleared with identity transform and `clearRect()` before every rebuild.

Every G-buffer frame explicitly clears attachments 0/1/2 with `clearBufferfv()` before rendering. Static material descriptor arrays are reset/replaced rather than appended.

## Sprite root/depth contract

`getSpriteFootAnchor()` is the shared authority for ordinary, foreground, static and subrect material descriptors. Material-v2 standing sprites use visible root pseudo-Z = 0. This links root positioning, pseudo-depth and existing sprite depth ordering.

## Graphics settings consumed by Material v2

The new deferred path consumes:

```text
materialV2
materialPipelineLegacy
normalStrength
heightStrength
roughnessScale
metalnessScale
materialAOStrength
pbrSpecularStrength
selfShadowing
selfShadowQuality
selfShadowLightCount
selfShadowBias
selfShadowMaxDistance
contactShadows
contactShadowDistance
contactShadowStrength
contactShadowQuality
```

It also consumes the existing light/ambient/cone/terrain-occlusion controls. Existing macro projected-shadow controls remain active for the inherited macro system.
