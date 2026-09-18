# WebGPU architecture

## Purpose

Define the target renderer architecture and invariants that implementation issues must preserve. This is not a statement that the code already exists in the repository.

## v1.2.3 baseline reconciliation (SM-004)

`docs/BASELINE_V123_AUDIT.md` records the source-level audit of the imported WebGL2 compatibility baseline. This architecture remains the target, but downstream work must start from these verified baseline facts:

- v1.2.3 has no backend-neutral Render Scene Description, WebGPU backend, object-ID attachment, hardware fragment-ownership depth, reusable pseudo-depth hierarchy, clustering, DSO, or Dark Bloom;
- Material-v2 G2.R is **local material pseudo-height**, not fragment visibility depth;
- Material descriptors share `getSpriteFootAnchor()` for ordering, but macro-shadow and FoliageFX root/bottom conventions were separate in the baseline;
- static, dynamic, and foreground Material-v2 descriptors are painter/foot ordered rather than resolved by per-pixel object ownership;
- SurfaceFX grass/water and FoliageFX coherently sample the lit WebGL2 scene/current main-light direction, but they do not yet consume the canonical future light/depth/visibility buffers defined below.

SM-100/101 subsequently established the backend-neutral scene and shared root authority, SM-200 ported Material-v2 representation, SM-201 defined the canonical ownership projection, and SM-202 enabled real per-pixel depth/object ownership. SM-203 now derives the one reusable min/max pseudo-depth hierarchy consumed by later visibility and screen-space passes.

## Backend model

```text
Game / world / editor
        |
Backend-neutral Render Scene Description
        |
+-------------------------+
|                         |
WebGPU primary        WebGL2 fallback
future fidelity       v1.2.x compatibility tier
```

The game owns gameplay state. The renderer consumes a description of visible/renderable state and may maintain cosmetic temporal history, GPU resources and diagnostics only.

## Render Scene Description

Minimum records:

### `SpriteInstance`

- stable instance/object ID;
- sprite/atlas region ID;
- material region ID;
- world/screen transform;
- shared foot/root anchor;
- size, scale, rotation, flip;
- explicit render layer/depth bias;
- pseudo-height scale;
- tint/alpha;
- coverage class;
- shadow-cast/receive flags;
- material/occluder class.

### `MaterialInstance`

- Material-v2 atlas references/region;
- material class/prior;
- world height scale/bias;
- optional overrides for roughness/metalness/AO/emissive.

### `LightInstance`

- stable ID/type;
- position XYZ in canonical pseudo-world convention;
- colour/intensity/radius;
- cone data where applicable;
- shadow mode/flags;
- quality/relevance metadata.

### `OccluderInstance`

- object ID;
- screen/world bounds;
- root XY;
- max pseudo-height / Z range;
- material/silhouette/profile class;
- layer/flags.

### `ProceduralLayer`

- water/foliage/grass/effects descriptors;
- canonical light/depth access requirements;
- explicit ordering/visibility mode.

## Canonical coordinate conventions

One authority only for:

- sprite root/foot;
- pseudo-height/world Z;
- world/screen XY;
- fragment visibility depth;
- foreground/layer bias.

SM-101 owns root/foot placement. SM-201 owns the light-independent fragment-depth projection, specified in `PSEUDO_DEPTH_MODEL.md` and executable in `engine/pseudo_depth.js`:

```text
worldZ = clamp(localHeight, 0, 1) * 64
projectedGroundY = fragmentScreenY + worldZ
visibilityKey = layer * 1024 + projectedGroundY + bias
depth01 = clamp((3072 - visibilityKey) / 5120, 0, 1)
```

Larger visibility keys are nearer; the inverse 0..1 mapping uses a conventional `less` depth comparison in the SM-202 ownership pass. Static and dynamic share layer 0; ground/foreground/top use explicit -1/+1/+2 lanes. The model is deterministic, light-independent, alpha-cutout aware, stable under subpixel movement, and defined from the same shared transform for static/dynamic/foreground/editor paths. Rotation changes actual raster fragment position but not the SM-101 root; horizontal flip changes UV/height sampling without introducing a second geometry convention.

No subsystem may independently invent a competing convention. G2.R remains local Material-v2 height, not final visibility depth.

## Material-v2 resources

Primary source atlases remain coordinate-identical:

- albedo;
- Normal XYZ + Roughness;
- Height + material AO + Metalness + Emissive/aux.

Legacy bump/spec maps are WebGL2 compatibility/debug resources, not dependencies of the WebGPU primary path.

## Initial G-buffer

Start explicit and debuggable. Production staging layout:

- **G0 `rgba8unorm`** — linear/unlit albedo + coverage;
- **G1 `rgba16float`** — pseudo-world normal XYZ + roughness;
- **G2 `rgba16float`** — Material-v2 local height plus metalness + material AO + emissive/aux;
- **Object ID `r32uint`** — stable visible instance/object ID;
- **Depth `depth32float`** — canonical SM-201 projection written per fragment by SM-202 using `less` ownership testing.

Do not pack normals/material channels until correctness/performance data justifies it. Do not relabel local G2 height as ownership depth.

## Frame graph target

```text
1. update/upload scene buffers
2. opaque Material-v2 G-buffer + object/depth ownership
3. reusable pseudo-depth hierarchy
4. occluder/tile preparation
5. cluster construction / dominant ownership
6. DSO hard macro occlusion
7. Dark Bloom / far penumbra
8. short-range contact shadow
9. deferred direct PBR + bounded self-shadow
10. transparent/procedural world
11. bloom/post/grade
12. debug/UI/present
```

Reserved later insertion points:

- GTAO after depth/normal preparation and before final lighting composition;
- SSGI after stable GTAO/depth hierarchy;
- volumetric flashlight after direct/depth/DSO data are stable.

## Pseudo-depth hierarchy

SM-203 implements the shared hierarchy in `engine/webgpu_depth_hierarchy.js`; the complete representation and invalidation contract is `WEBGPU_DEPTH_HIERARCHY_SM203.md`.

One hierarchy serves:

- self-shadow acceleration;
- DSO traversal/culling;
- GTAO;
- SSGI;
- volumetric occlusion.

Each level is an unfiltered `rg32float` texture storing the nearest and farthest **occupied** canonical ownership depth. Level 0 derives occupancy from the SM-202 `r32uint` object-ID target so the depth clear value `1.0` is never mistaken for geometry. Empty hierarchy cells are the invalid range `(1,0)`. Higher levels reduce valid children with `min(nearest)` / `max(farthest)`.

Level dimensions use ceiling division by two until `1x1`; odd edges reduce only existing children. Level textures are persistent across normal frame rebuilds and are recreated only on extent/device changes. Room/history/resize/device invalidation marks the hierarchy stale, and its public sampling API rejects stale views until a complete rebuild succeeds.

`rg32float` is deliberately sampled with `textureLoad`; SM-203 does not require float filtering, blending, or optional texture-format tiers. Do not build independent depth pyramids per effect.

## Occluder clustering

Goal: overlapping substantial props form coherent shadow-casting groups rather than independent competing shadow wedges.

Candidate clustering signals:

- projected AABB overlap/adjacency;
- ground-footprint overlap;
- pseudo-Z/depth proximity;
- silhouette overlap;
- material/occluder class.

Tiny decor should not merge whole rooms into giant clusters.

Cluster output must expose:

- cluster ID;
- member IDs/range;
- combined bounds;
- depth/Z range;
- dominant object ID;
- diagnostics for largest cluster, count and instability.

## Dominant occluder

For each relevant light/cluster, the principal macro shadow is owned by one stable dominant object/mass. Secondary members may:

- widen/thicken the contour;
- add upper structural occlusion;
- affect local self/contact shadow;
- contribute soft residual Dark Bloom.

They should not each add an equal full-strength long macro wedge.

Dominance should consider exposed silhouette, light direction, pseudo-height, front-depth and temporal hysteresis.

## DSO

Deep Silhouette Occlusion is the primary WebGPU macro-overlap shadow mechanism for the player light.

Near/mid/far behaviour:

- **Near:** high silhouette fidelity, crisp core.
- **Mid:** reduced contour complexity, moderate feather.
- **Far:** low-frequency coherent contour, greater feather and reduced fine detail.

Distance simplification should reduce aliasing/segmentation rather than merely supersampling source notches.

## Dark Bloom

Separate low-frequency visibility field derived from DSO core. It is not a generic blur.

Pipeline concept:

```text
DSO hard core
→ reduced-resolution depth-aware expansion/dilation
→ bounded falloff
→ optional temporal accumulation
→ depth-aware upsample/composition
```

Requirements:

- weaker than hard core;
- bounded radius;
- near contribution small;
- stronger role at long throw;
- temporal history rejected on depth/object/cluster/light discontinuity.

## Shadow visibility composition

Inputs include:

- DSO macro visibility;
- height self-shadow;
- contact shadow;
- Dark Bloom;
- material AO;
- later GTAO.

Compose as bounded visibility/occlusion rather than blindly multiplying all terms. Avoid double/triple-darkening dense industrial geometry.

## Direct lighting

Retain restrained GGX/Cook-Torrance style response:

- Schlick Fresnel;
- GGX NDF;
- Smith visibility;
- dielectric F0 around 0.04;
- metallic F0 from albedo;
- reduced diffuse for metallic surfaces;
- artistic clamps/scales to preserve illustrated pixel-art readability.

Lighting is linear-space work; colour-space correctness is validated in SM-502.

## Procedural/transparent policy

Water, foliage and grass may remain forward/transparent, but must consume canonical:

- light buffers;
- root/depth convention;
- resolved scene/depth;
- shadow visibility where appropriate.

Fine grass remains non-emissive and cheap. Large foliage may become an occluder class; tiny grass should generally receive lighting/occlusion without becoming expensive DSO geometry.

## Resource/performance rules

- persistent buffers/textures; no per-frame resource churn;
- static per-room instance/occluder data rebuilt only when invalidated;
- dynamic buffers bounded and batched;
- tile/light/occluder culling before expensive pixel work;
- secondary effects may run half/quarter resolution;
- core albedo/object/depth ownership stays native-resolution/crisp;
- CPU prep/encode timings and GPU timestamp timings reported separately.

## Failure isolation

WebGPU initialization/device/pipeline failure must never corrupt gameplay state. When safe, record diagnostics and fall back to WebGL2. Device loss must not silently leave a black canvas.
