# SM-505 native presentation units

## Requirement and evidence boundary

WebGPU is intended to provide higher lighting quality. Its shadow proportions
and output may differ substantially from WebGL2. Matching WebGL2 shadow length,
brightness or final pixels is **not** a visual acceptance criterion. These
repairs address internal resolution invariance, material integrity, canonical
ownership and stable topology. They do not redesign the lighting model.

The user-approved development-v2 inspection controls remain unchanged
(ambient 0.18, cone 35°, range 900, intensity 6). They are diagnostic settings,
excluded from release/performance qualification. Nearest sampling may produce
straw-like fine shadows; distant noise still needs characterization. Neither
observation alone establishes an incorrect world-distance scale.

## What the earlier source established

The native engineering diagnostic at exact source
`b5f5817e82156aebb7c807e1d083e8593a75c69e` completed its diagnostic checks;
`physicalAcceptance` was false. Its originals remain separate under the campaign
run's `physical-b5f5817-development-v2` directory, including source fingerprints,
raw material/ownership/depth/light buffers, PNGs, logs and SHA-256 manifest. Its
`ok:true` is not visual or release acceptance, and it cannot qualify later source.

The initial hypothesis that material heights were simply left unscaled was
incomplete. The actual ownership producer inherited SM-200's compatibility
height factor: native sprite height was divided by an authored atlas base,
already increasing the factor at a larger presentation extent. That factor was
clamped to 0.18–4.5, then sampled material height was clamped to 0–1. Some heights
therefore increased and clipped before lighting. Multiplying or dividing the
result afterwards cannot recover the lost material values.

Other paths mixed native coordinates with logical bias, ray span, DSO limits,
depth inputs and cluster thresholds. The repair preserves authored relationships
across an internal coordinate conversion; it does not adopt WebGL2 output as its
reference image or promise unchanged depth versus the mixed-unit b5 source.

## Candidate conversion

The presenter derives native XY from the immutable gameplay scene. Internal
`worldScale` carries the uniform distance ratio; `materialHeightScaleY` carries
the vertical presentation ratio. Defaults are 1, preserving existing logical
callers and artistic controls. Actual material bytes and canonical depth rules,
rather than arbitrary brightness compensation, define the test authority.

| Boundary | Conversion and preserved contract |
| --- | --- |
| Material production | `nativeOwnershipAtlas` scales a derived atlas `world_scale` by the accumulated native Y ratio **before** the compatibility-factor clamp. The original atlas/assets, region UVs and dimensionless material controls remain unchanged. The derived metadata is cached per source atlas/extent; one canonical instance array feeds ownership and forward exclusion. |
| SM-204/SM-205 | Material height, light elevation, bias and finite trace distance use consistent distance units after artistic clamps. SM-205's near cutoffs, contact smoothing length and jitter positions use the same conversion. SM-204's default WGSL remains byte-identical; scale1 preserves its equations. |
| SM-202 ownership | The optional frame scalar converts native fragment Y to logical Y before the unchanged canonical depth kernel. Local material height, layer and fine bias retain their canonical meanings. Stable object IDs and winning ownership are tested against logical fixtures, not against erroneous b5 depth. |
| Sprite/transparent depth | `depth01` is computed from logical geometry before native scaling. Transparent vertices consume that same key; rederivation must not compound scale. |
| Foliage raster | Native root Y is converted to logical units for its canonical depth key. Existing raster modes receive the same scalar on extent changes; albedo remains nearest sampled. |
| Occluders/DSO | Bounds, roots/contact coordinates, section endpoints and elevation ranges convert together. DSO minimum/maximum throws and its secondary minimum length scale as distances; dimensionless factors and bounded work caps remain unchanged. |
| Clusters | Adjacency, cross-class adjacency, ground-Y, depth and Z thresholds scale as distances; tiny-connector area scales by the square. Tile size, native filter/kernel pixel budgets and candidate/member/storage caps retain their existing meanings. |

Uniform 1×/2×/3× conversions have deterministic invariance tests. Anisotropic
tests verify the stated separate XY/material ratios; they are not a claim that
arbitrary nonuniform stretching preserves isotropic lighting.

## Verification and outstanding qualification

Core and clean-package gates run
[`validate_sm505_native_units.js`](../tools/validate_sm505_native_units.js),
[`validate_sm505_ownership_units.js`](../tools/validate_sm505_ownership_units.js)
and [`validate_sm505_dso_world_scale.js`](../tools/validate_sm505_dso_world_scale.js).
They exercise real canonical producers/reference equations and packing, full and
subrect material factors at both clamp limits, nonzero material/elevation/bias/
span/jitter, stable IDs/depth winners, transparent keys, cluster membership and
nonmutation. Retained negative controls expose old material clipping, native-Y
winner reversal, missed trace blockers, split clusters and DSO saturation.

These are CPU/source results. Fresh native shader/readback, actual-game visual,
transition/fallback, Firefox and performance qualification remain separate gates
for the corrected source. Default compatibility tests do not establish GPU
equivalence. Follow the [normal presentation benchmark gate](SM505_NORMAL_PRESENTATION_BENCHMARK.md)
only after source-matched presentation and visual qualification pass. Auto stays
WebGL2; no timing or release acceptance follows from these repairs.
