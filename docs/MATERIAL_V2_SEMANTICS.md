# Material-v2 semantic contract

Status: **SM-503 canonical**. This document defines the meaning of the generated Material-v2 fields. It is deliberately a material/geometry contract, not a screenshot-tuning guide.

## Channel contract

Material-v2 remains coordinate-identical to `sprite_runtime_atlas.png` and uses two generated RGBA atlases:

- normal/roughness: `RGB = encoded XYZ normal`, `A = roughness`;
- height/material: `R = authored pseudo-world Z / 64`, `G = intra-object material AO`, `B = metalness`, `A = emissive/auxiliary`.

Transparent texels carry safe defaults and never contribute coverage. Albedo alpha owns coverage.

## World-height meaning

For every authored region, the generator records `heightScaleWorld`, `heightBiasWorld`, `rootAnchor`, and `heightEncodingMaxWorld`.

At authored scale:

`worldZ = localShapeHeight × heightScaleWorld + heightBiasWorld`

and the height atlas stores:

`HM.R = clamp(worldZ / heightEncodingMaxWorld, 0, 1)`

`heightEncodingMaxWorld` is currently **64 world units**, identical to `SteelMothPseudoDepth.MAX_WORLD_Z`. Current standing sprites use `heightBiasWorld = 0`; their visible foot/base at `rootAnchor = [0.5, 1.0]` is therefore exact Z=0. A future non-zero bias is allowed only when the region has a documented physical reason and the shared consumer contract is updated with it.

The G-buffer's existing rendered-size compatibility factor scales the encoded height uniformly when a sprite is rendered away from its authored atlas size. After that stage, G2.R is the canonical encoded world-Z input used by ownership depth and self/contact shadowing. Consumers must not reconstruct an independent height from colour, legacy bump maps, sprite category, or a second private scale.

## Geometry priors

| Prior | Macro/meso intent | Height intent |
| --- | --- | --- |
| `flat` | near-planar floor; restrained lips/engraving only | shallow, normally <3 world units |
| `box` | coherent front/top/side planes with bounded lips and recesses | standing volume rooted at its foot |
| `barrel` | cylindrical body with coherent rim/hoops | standing cylinder rooted at its foot |
| `pole` | narrow cylinder | tall rooted height, no flat-card normal |
| `pipe` | separate cylindrical runs; alpha gaps remain gaps | each visible run contributes, holes do not fill |
| `frame` | independent members/struts; alpha gaps remain gaps | member geometry only |
| `vertical_plane` | standing plane with shallow trim/fasteners | broad plane plus small relief |
| `robot` / `character` | coherent macro body, restrained panel/body relief | rooted articulated volume |
| `foliage` | rooted organic macro volume | soft height variation |
| `glass` | shallow dielectric pane/effect volume | conservative relief |

Macro/meso geometry owns normals and height. Source luminance may identify broad authored seams, lips and recesses, but pixel colour noise must never become the primary pseudo-geometry source. Normal smoothing is class-specific and edge-preserving because the generator is region-isolated and never filters across atlas-region boundaries.

## Material vocabulary and priors

| Material prior | Roughness/metalness intent | Notes |
| --- | --- | --- |
| `painted_steel` | medium-rough dielectric paint, low metalness | bounded bright chips may expose some metal; colour never selects the broad class |
| `rusted_steel` | high roughness, mostly dielectric | rust is **not** metalness=1; bounded clean chips may expose metal |
| `bare_steel` | low/medium roughness, high metalness | explicitly unpainted steel only |
| `galvanized` | medium roughness, clearly metallic | poles, pipes, frames and similar zinc-coated hardware |
| `plastic` | dielectric, medium roughness | no metalness |
| `glass` | smooth dielectric | transmission/refraction belongs to renderer stages, not this atlas |
| `concrete` | very rough dielectric | dry mineral surface |
| `wet_concrete` | lower roughness dielectric | wetness changes roughness, not metalness |
| `stone` | rough dielectric | mineral material |
| `plant` | rough dielectric | foliage/organic material |
| `water` | smooth dielectric | procedural water remains authoritative for optics |

The generator chooses this broad prior from authored metadata/name semantics. Source colour is allowed only as a bounded *within-class* wear signal; it cannot silently turn painted/rusted material into bare metal.

A per-region override is permitted through authored `material_v2_prior` metadata only when the default semantic classification is objectively wrong. Such an override must use a vocabulary value above and should be documented in the PR that introduces it. SM-503 does not introduce screenshot-specific exceptions.

## Material AO

Material AO (HM.G) means **intra-object cavity occlusion only**: seams, enclosed lips and similarly local cavities visible inside one sprite. `1.0` means unoccluded. It must not encode adjacency to other scene objects, DSO, contact shadowing, directional visibility, or a future screen-space GTAO/SSGI result.

The final visibility composer therefore treats material AO as one independent material term. Future GTAO/SSGI remains an inter-surface scene term and must be bounded/composed separately so the same darkness is not applied twice.

## Calibration fixtures

SM-503 owns six deterministic semantic fixtures drawn from the production atlas:

| Fixture | Geometry | Material prior |
| --- | --- | --- |
| `floor_plate` | `flat` | `painted_steel` |
| `cargo_crate` | `box` | `painted_steel` |
| `rust_barrel` | `barrel` | `rusted_steel` |
| `street_lamp` | `pole` | `galvanized` |
| `pipe_cluster` | `pipe` | `galvanized` |
| `scaffold` | `frame` | `galvanized` |

`assets/generated/material_v2_report.json` records class/prior, world-height metadata, root height, normal statistics and material-channel means for each fixture. `docs/material_v2/material_v2_calibration_8angle.png` is a deterministic eight-angle lighting diagnostic generated from the calibrated normal field; it is evidence of directional coherence, not a replacement for real renderer/browser readback.

## Verification boundary

A complete SM-503 change requires all of the following:

- deterministic regeneration of the committed Material-v2 atlases and metadata;
- zero-height visible roots for standing calibration fixtures;
- coherent class-specific normal tests, including cylindrical barrel/pole response;
- explicit material-prior and material-AO semantics in machine-readable metadata;
- output SHA-256 verification and a clean second regeneration (`git diff --exit-code`);
- the existing real-WebGPU G-buffer readback so generated fields are proven to reach the production GPU path;
- the eight-angle calibration capture for the six semantic fixtures.

SM-503 does not add GTAO/SSGI, change the final visibility-composition policy, or use one reference screenshot as a tuning oracle.
