# Lighting fidelity and performance roadmap

This roadmap begins **after** the WebGPU backend has reached API/resource correctness and Material-v2/depth ownership stability. It is intentionally sequenced to avoid building sophisticated effects on untrustworthy scene data.

## Guiding order

```text
colour/material correctness
→ visibility/shadows
→ local ambient occlusion
→ diffuse indirect lighting
→ participating-media lighting
→ bandwidth/quality scaling
```

Do not use a later effect to conceal a defect in an earlier representation.

## 1. Colour-space and HDR correctness

Before stronger PBR/indirect effects, audit the full colour pipeline:

- albedo source decoded as sRGB then converted to linear for lighting;
- normal/roughness/height/material channels always interpreted linearly;
- lighting and bloom occur in linear/HDR space;
- tone mapping/display transform occurs at output;
- debug views clearly state whether they show linear or display-space data.

Create numeric fixtures for 18% grey, white, primary colours, a dielectric and a metal. This work often improves material fidelity more than simply increasing specular intensity.

## 2. Material-v2 semantic calibration

### Normal field

Separate macro geometry, meso detail and micro/art texture. Macro and meso geometry should dominate lighting normals; pixel-colour noise should contribute little.

Per-class priors:

- **box:** front/top/side planes, bevels/recesses;
- **barrel/cylinder:** wrapped cylinder and rim;
- **pole:** narrow cylinder;
- **pipe:** several separate cylinders rather than one flat region;
- **frame:** independent members/gaps;
- **floor:** near-flat with limited lip/engraving height.

Add edge-preserving `macro_normal_smoothing` or equivalent generator control.

### Height semantics

Store interpretable per-region metadata:

```text
heightScaleWorld
heightBias
rootAnchor
```

Conceptually:

```text
worldZ = textureHeight × heightScaleWorld + heightBias
```

All depth ownership, self-shadow, DSO, contact, GTAO and later SSGI must use the same Z.

### Material vocabulary

Define priors for:

- painted steel;
- rusted steel;
- bare steel;
- galvanized metal;
- plastic;
- glass where applicable;
- concrete/wet concrete;
- stone;
- plant;
- water.

Spatial subregions may override priors; e.g. rusted steel is not simply “metalness 1”.

## 3. DSO/shadow refinement

Priority:

1. correct clusters;
2. stable dominant ownership;
3. coherent silhouette;
4. near/mid/far simplification;
5. Dark Bloom;
6. temporal soft-history stabilization.

### Dominant score

Candidate factors:

- exposed silhouette area;
- light-facing contribution;
- pseudo-height;
- frontmost depth;
- previous-frame hysteresis.

Do not let light-angle noise cause owner flicker.

### Tile culling

Use 8×8 or 16×16 screen tiles (to be profiled) to identify relevant DSO/occluder work. Empty floor should incur almost no expensive DSO traversal.

### Silhouette hierarchy

Maintain multiple levels from detailed near contour to coarse long-throw major-mass contour. Choose level from projected throw, quality tier and screen resolution.

## 4. Dark Bloom

Dark Bloom is a perceptual low-frequency shadow field, not generic Gaussian blur.

Pipeline:

```text
DSO core
→ lower-resolution depth-aware expansion/dilation
→ bounded falloff
→ optional temporal accumulation
→ depth-aware upsample
```

Near contribution should be small; long-throw contribution can be stronger. Hard core remains crisp.

## 5. Contact/self-shadow boundaries

### Contact shadows

Short range only: feet, bin/floor junctions, crate bases, pipe crossings, machinery intersections. Suggested logical distance range: roughly 6–24 px, quality 4/8/12 samples, half resolution by default.

### Height self-shadow

Used for local material/height occlusion toward strongest lights. Keep bounded trace distance, quality tiers and early exit. Reuse depth hierarchy instead of rebuilding local structures.

### Composition

DSO, contact, self-shadow, Dark Bloom and AO feed a bounded visibility model. Never allow every term to independently multiply to near-black.

## 6. GTAO

First major post-migration fidelity feature after shadow correctness.

Initial design:

- half resolution;
- pseudo-depth + normal horizon search;
- 6–8 directions initially;
- bounded samples;
- bilateral/depth-aware upscale;
- optional temporal reuse after non-temporal correctness.

Purpose:

- ground adjacent machinery;
- strengthen creases between overlapping objects;
- improve dense-bin/intersection depth;
- remain subtle.

Material AO remains intra-object; GTAO is inter-surface/world occlusion. Reduce material-AO influence where GTAO would otherwise double-darken.

Working Medium budget: roughly 0.7–1.2 ms on GTX 1650 Super, to be validated rather than assumed.

## 7. Diffuse SSGI

Only after GTAO/depth hierarchy are stable.

Initial scope:

- quarter resolution;
- diffuse indirect only;
- 4–8 rays/pixel;
- shared depth-hierarchy traversal;
- previous-frame resolved colour;
- strong temporal accumulation;
- depth/normal/object rejection;
- firefly/energy clamp.

Art direction: subtle environmental bounce, not conspicuous coloured glow. No glossy GI initially.

## 8. Volumetric flashlight scattering

After SSGI stabilization.

Suggested design:

- quarter-resolution scattering buffer;
- 12–20 depth-aware cone steps initially;
- DSO/depth used to interrupt beam;
- low-frequency dust/moisture density;
- temporal accumulation with aggressive rejection on light/occluder changes.

Desired result: faint visible beam in atmosphere with convincing interruption, not an opaque fog cone.

## 9. Transparent/future foliage integration

Water, glass and large foliage should consume canonical depth/light/DSO/GTAO/indirect data without forcing every transparent element into the opaque G-buffer.

Foliage classification:

- tiny fine grass: receiver only;
- medium foliage: contact/GTAO contribution;
- substantial foliage: eligible macro occluder where visually justified.

## 10. Performance architecture

Principle: do high-quality work only where it can affect the final image.

### Shared tile classification

Per tile record useful properties such as:

- has opaque material;
- has occluder;
- has dynamic actor;
- has transparency;
- within relevant light volume;
- high-frequency geometry.

Use it to skip DSO/GTAO/SSGI/volumetric work where irrelevant.

### Light culling

Build per-tile light lists instead of looping every light over every pixel as light counts grow.

### Shared depth hierarchy

One hierarchy for self-shadow, DSO, GTAO, SSGI and volumetrics.

### Shared temporal validity

Centralize previous depth/object ID and light/camera validity logic. Individual effects keep separate history values but reuse rejection logic.

## 11. Precision/bandwidth optimization

Do this only after correctness/performance measurements.

Potential studies:

- octahedral normal encoding;
- reduced roughness/metal/AO precision;
- alternate HDR formats;
- render-target aliasing/lifetime optimization;
- stable static-world render bundles.

Core depth/ownership precision should be the last thing compromised.

## 12. Resolution strategy

Keep native-resolution:

- albedo;
- object ID;
- primary visibility depth;
- important silhouette edges.

Candidates for reduced resolution:

- Dark Bloom;
- contact shadows;
- GTAO;
- SSGI;
- volumetric scattering;
- far DSO.

Prefer this to global scene-resolution scaling.

## 13. Quality presets

Medium is the primary GTX 1650 Super design target, not a deliberately degraded mode.

| Feature | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| core G-buffer | full | full | full | full |
| self-shadow | ~8 | ~12 | ~16 | 24–32 equivalent |
| DSO | low | medium | high | high+ |
| Dark Bloom | quarter | half | half | half/full as measured |
| contact | 4 | 8 | 12 | 12 |
| GTAO | off/low | medium | high | high |
| SSGI | off | optional low | medium | high |
| volumetrics | off | low | medium | high |

Exact values remain tuning targets and may change after measurement.

## 14. Optional adaptive quality

Only after static quality tiers are stable.

Use a slow p95-based controller over seconds, not per-frame oscillation. Degrade secondary features in this order:

1. volumetrics;
2. SSGI rays/history resolution;
3. GTAO samples;
4. Dark Bloom resolution/radius;
5. far DSO detail;
6. self-shadow samples.

Never automatically degrade core albedo resolution, object ownership or primary depth correctness.

## 15. Change-performance policy

Every significant fidelity change should report:

- visual reason;
- affected passes;
- GPU delta on representative fixtures;
- renderer-memory delta;
- screenshots/debug buffers;
- quality-tier effect.

No “faster”/“cheaper” claims without measured evidence.
