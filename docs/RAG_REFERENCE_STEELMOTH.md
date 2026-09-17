# Steel Moth RAG reference

Purpose: give future implementation agents durable context from the development conversations without requiring access to chat history. This document distinguishes historical claims from current repository authority.

## Product identity

- Game: **The Small Machine at the Edge of Night** (`signal_orchard`).
- Current engine/codebase name: **Steel Moth**.
- Product direction: authored, atmospheric, screen-sized-room exploration with dense industrial/ecological visuals and strong localized lighting.
- Rendering intent from the original game brief: high ambient readability, localized directional lights, soft material response, restrained bloom, deep foreground overlap, and a dense but readable diorama.
- Platform intent: Windows desktop browser / packaged desktop wrapper; keyboard/controller gameplay retained.

## Current repository baseline

The authoritative **v1.2.3** source distribution is merged to `main` by PR #52. Source archive SHA-256:

`2399a50d08785211470a2af86bf693bff71f5d622d717432a595295a23208727`

Steel Moth v1.2.3 is raw editable HTML/JavaScript/WebGL2/Python/JSON plus generated/material assets. The webapp ZIP is therefore the source distribution rather than a compiled-only release.

SM-000 import evidence records:

- internal `SHA256SUMS.txt`: 93/93 entries verified;
- 94 release files copied and repository-copy verified;
- Material-v2 validation: 314 regions;
- 26 production GLSL programs compiled/linked in the inherited native validation path;
- exact remote Git-blob checks for the principal runtime/material assets and `engine/game.js`;
- preservation of the exact v1.2.3 Windows launcher bytes after correcting local Git CRLF normalization;
- merged `main` baseline commit: `089d7a34ceae1b12c72b6426b38be410e087d50e`.

SM-004 subsequently audited the imported source contract-by-contract. `docs/BASELINE_V123_AUDIT.md` is the authoritative implementation reconciliation; historical renderer claims below should be interpreted through that audit.

See `docs/BASELINE_V123_PROVENANCE.md`, `docs/BASELINE_V123_IMPORT_REPORT.txt`, and `docs/BASELINE_V123_AUDIT.md` for evidence and limitations.

## Historical renderer progression

### v1.2.0 historical claim — reconciled by SM-004

Conversation work reported an integrated Material-v2 renderer with:

- explicit Normal XYZ + Roughness atlas;
- Height + AO + Metalness + Emissive/aux atlas;
- 314 atlas regions generated deterministically;
- MRT pseudo-G-buffer;
- deferred GGX/Cook-Torrance-style direct lighting;
- bounded height self-shadow tiers;
- half-resolution contact shadows;
- retained macro projected shadows;
- legacy bump/spec maps for debug/fallback;
- G-buffer/material debug views and validation tooling.

SM-004 verified these mechanisms in the imported v1.2.3 source, with two important qualifications:

1. WebGL2 `G2.R` is **local Material-v2 pseudo-height**, not the future light-independent fragment-ownership depth. The baseline has no object-ID attachment or per-pixel hardware ownership depth for material sprites.
2. Material descriptors share `getSpriteFootAnchor()` for ordering, but v1.2.3 does not yet have one universal root/foot authority: macro-shadow and FoliageFX root/bottom conventions remain separately implemented.

Thus the successful Material-v2 material/direct-light response is a preserved baseline contract, while backend-neutral scene extraction, unified transforms and true per-pixel ownership remain migration work.

### v1.2.1 historical patch

A patch attempted to address normal-direction inconsistency, yellow/glowing SurfaceFX artifacts, and long-shadow aliasing. The user reported that the visible problems remained unchanged.

### v1.2.2 reconciliation

The later audit determined v1.2.1 was not a trustworthy visual comparison artifact because it still carried stale v1.2.0 service-worker/cache identity and some fixes targeted the wrong subsystem. Work then tightened cache/version identity, lighting conventions, floor material response and player-shadow ownership.

### v1.2.3 baseline

The user confirmed two material improvements after v1.2.3:

- the yellow/glowing artifact was fixed;
- shadows looked substantially better in general.

The yellow artifact was traced to Fine GrassField/procedural rendering rather than the main deferred lighting path. The correction required procedural grass to consume coherent scene illumination and a suitable dark vegetation palette rather than behaving like a self-lit amber layer.

SM-004 verified the source-side fix: Fine GrassField samples the lit scene/current main-light direction and caps blade alpha; FoliageFX samples the lit scene and Material-v2 normals; water also uses the lit scene and main-light direction. These remain forward compatibility adapters rather than consumers of the future canonical WebGPU light/depth/visibility buffers.

**v1.2.3 is the current imported WebGL2/Material-v2 compatibility baseline for the WebGPU migration.**

## Overlap/bin screenshot findings

A conversation fork named **Branch Steel Moth Forgetful** contained the omitted box/bin screenshots. SM-001 recovered and committed eight exact historical references: `boxleft`, `boxright`, `boxup`, `boxdown`, `binsleft`, `binsright`, `binsup`, and supplementary `binsupright`.

The user later clarified that `binsupleft.png` was also a historical screenshot; it was simply omitted when the other references were attached. Its original bytes/file have not yet been recovered or committed, so the current `binsupleft` deterministic fixture remains explicitly reconstructed rather than being mislabeled as the original image.

The reconciled conclusions are:

### Boxes — positive control

- isolated compact objects already produced convincing material/light response;
- Material v2, height response and the basic direct-light model should be preserved rather than replaced wholesale.

### binsright / binsleft

- overlapping large sprites exposed fragmented shadow ownership;
- multiple independent source sections produced competing/discontinuous macro shadows;
- the failure was primarily representation/ownership, not simply insufficient sample count.

### binsupleft

- the historical screenshot existed, although the original artifact is not currently committed;
- the failure changed with light direction;
- a static footprint-only correction is insufficient.

### binsup

- a coherent lower-bin primary shadow plus soft feathered residual occlusion would already look convincing;
- maximum physical simulation fidelity is unnecessary;
- a dominant coherent occluder plus low-frequency soft occlusion is preferable to several independently “accurate” but visibly segmented shadows.

## Accepted migration decision

The user explicitly chose WebGPU **for future architectural leverage**, not as an emergency performance rescue. The goal is to avoid implementing DSO/GTAO/SSGI/volumetrics in WebGL2 and then duplicating them later.

Accepted direction:

- raw WebGPU/WGSL primary renderer;
- WebGL2 v1.2.x-tier compatibility fallback;
- backend-neutral Render Scene Description;
- Material-v2 G-buffer parity first;
- per-pixel pseudo-depth/object ownership before new shadow aesthetics;
- GPU occluder clustering;
- Deep Silhouette Occlusion (DSO);
- dominant-cluster ownership;
- Dark Bloom / soft residual occlusion;
- shared depth/light/temporal infrastructure for later GTAO, SSGI, and volumetric flashlight scattering.

Explicit prohibitions:

- no engine/framework replacement;
- no Three.js/Babylon/Pixi/Phaser dependency;
- no polygonal mesh conversion of sprite content;
- no gameplay redesign as part of renderer migration.

## Diagnostic lighting preset

The user used and approved these stronger settings for visual diagnosis. SM-001 now records them as a reproducible deterministic fixture preset:

- Emissive strength: `2`
- Light-radius multiplier: `2`
- Player omni radius: `80`
- Player omni intensity: `1.6`
- Player cone intensity: `2`
- Cone inner angle: `30°`
- Cone outer angle: `60°`

SM-004 verified that these are **not** the v1.2.3 compatibility runtime defaults. Baseline defaults remain emissive `1`, light-radius multiplier `1`, omni `60 / 0.16`, and cone `2 / 17° / 30°`. Any promotion of the stronger preset to product defaults is a separate visual/product decision.

## Performance targets

Primary reference hardware:

- GTX 1650 Super 4 GB
- 1920×1080
- 60 FPS

Programme targets:

- mean renderer GPU time ≤ `12 ms`
- p95 renderer GPU time ≤ `14.5 ms`
- absolute 60-Hz frame budget `16.67 ms`

These are **targets, not measured baseline results**. Earlier observed ~12% → ~35% GPU utilization after lighting improvements was informal Task Manager context on a GTX 1650 Super and must not be treated as pass-level benchmark data. SM-003 owns the target-hardware WebGL2 measurement dataset.

## Historical v1.3 checkpoint

A later development attempt reportedly created a WebGPU checkpoint with distinct G-buffer, clustering, DSO, contact-shadow and Dark Bloom passes and identified a static bottom-anchor versus Material-v2 center interpretation mismatch. However the checkpoint was explicitly **not release-ready**: actual WebGPU frame execution/readback, authoritative bin visual review, editor stale-state checks, and GTX 1650 Super timings were not verified. Treat that work as inspiration/recoverable implementation only if its source is available; do not accept its unverified claims as completed milestones.

SM-004 found the baseline condition that makes that historical warning relevant: static and live Material-v2 descriptors both call `getSpriteFootAnchor()`, but with different input anchor conventions, while macro shadows and foliage retain additional root/bottom conventions. SM-101 therefore remains necessary before SM-201 derives final ownership depth.

## Lighting roadmap already agreed in principle

After WebGPU correctness and overlap/shadow architecture stabilize:

1. linear/sRGB/HDR pipeline audit;
2. Material-v2 normal/height/material calibration;
3. DSO/contact/self-shadow/Dark Bloom refinement;
4. GTAO;
5. restrained low-resolution temporally accumulated diffuse SSGI;
6. depth-aware volumetric flashlight scattering;
7. deeper transparent water/foliage integration;
8. bandwidth/precision/tile/light-culling optimization and optional adaptive quality.

## Unresolved facts that must not be guessed

- The original bytes/file for the historical `binsupleft.png` screenshot remain unrecovered/uncommitted; do not substitute the reconstructed fixture for it.
- Actual WebGL2 pass timings on GTX 1650 Super.
- Actual WebGPU pass timings on GTX 1650 Super.
- Exact pseudo-depth projection formula that produces stable per-pixel ownership for all sprite classes; SM-004 confirmed the current WebGL2 G2 local-height channel is not that formula.
- Which optional WebGPU texture/query features are exposed by the real target browsers/adapters at runtime.

## Source/provenance categories

- Product/rendering requirements: user game brief and explicit Steel Moth conversation decisions.
- Current implementation baseline: imported v1.2.3 source plus provenance/validation records and `docs/BASELINE_V123_AUDIT.md`.
- Historical implementation state: prior assistant delivery reports; use only where not contradicted by current source/audit.
- Screenshot analysis: recovered SM-001 references, Branch Steel Moth Forgetful conversation, and user confirmation regarding `binsupleft`.
- External WebGPU facts: official MDN/GPUWeb/WGSL documentation recorded in `RESEARCH_AND_DECISIONS.md`.
