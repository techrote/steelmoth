# Steel Moth

Steel Moth is the current engine/game codebase for **The Small Machine at the Edge of Night**. This repository is being prepared for a WebGPU-primary renderer migration and a long-horizon lighting-quality programme.

## Repository status

**Planning/workflow scaffold only.** At the time this repository was inspected on 2026-09-16 it was empty: no source tree, issues, pull requests, or repository documentation were present. The latest known working baseline from the development conversations is **v1.2.3**, but that source has not yet been imported here. No WebGPU implementation or performance result should be inferred from this repository until the baseline-import and verification issues are completed.

## Architectural direction

- Raw **WebGPU/WGSL** becomes the primary future renderer.
- The proven WebGL2 renderer remains a compatibility fallback at the v1.2.x visual tier.
- Preserve Material v2, gameplay/editor behaviour, pixel-art presentation, deterministic root/foot anchoring, and procedural-system coherence.
- Replace whole-sprite overlap assumptions with per-pixel pseudo-depth ownership.
- Build GPU occluder clustering, Deep Silhouette Occlusion (DSO), dominant-occluder ownership, and Dark Bloom natively on the WebGPU path.
- Reuse the resulting depth/material/light infrastructure for later GTAO, low-resolution temporally accumulated SSGI, and volumetric flashlight scattering.
- Primary performance reference: **GTX 1650 Super 4 GB, 1920×1080, 60 FPS**. The programme target is mean renderer GPU time ≤12 ms and p95 ≤14.5 ms; these are acceptance targets, not measured facts.

## Canonical documentation

Read in this order:

1. [`AGENTS.md`](AGENTS.md) — execution rules for autonomous coding agents.
2. [`docs/INDEX.md`](docs/INDEX.md) — documentation map and source-of-truth rules.
3. [`docs/RAG_REFERENCE_STEELMOTH.md`](docs/RAG_REFERENCE_STEELMOTH.md) — reconciled historical context and provenance.
4. [`docs/MASTER_WEBGPU_PROGRAMME.md`](docs/MASTER_WEBGPU_PROGRAMME.md) — canonical milestone/dependency plan.
5. [`docs/WEBGPU_ARCHITECTURE.md`](docs/WEBGPU_ARCHITECTURE.md) — renderer architecture and invariants.
6. [`docs/WEBGPU_VALIDATION_PLAN.md`](docs/WEBGPU_VALIDATION_PLAN.md) — correctness, visual, editor, browser, and performance gates.
7. [`docs/LIGHTING_FIDELITY_ROADMAP.md`](docs/LIGHTING_FIDELITY_ROADMAP.md) — post-migration lighting-quality roadmap.
8. [`docs/DEPENDENCY_AND_CONCURRENCY.md`](docs/DEPENDENCY_AND_CONCURRENCY.md) — task graph and safe parallelism.
9. [`docs/EXECUTION_LEDGER.md`](docs/EXECUTION_LEDGER.md) — durable planning/execution ledger.

## Milestone hierarchy

- **M0 — Baseline acquisition and verification**
- **M1 — Backend abstraction and WebGPU infrastructure**
- **M2 — Material-v2 parity and per-pixel ownership**
- **M3 — Overlap/occlusion architecture: clustering, DSO, Dark Bloom**
- **M4 — Procedural/editor integration and release hardening**
- **M5 — Lighting foundation calibration and performance architecture**
- **M6 — GTAO and indirect diffuse lighting**
- **M7 — Volumetric/transparent lighting integration**
- **M8 — Bandwidth, quality-scaling, and long-term optimization**

## Immediate blocker

The implementation baseline is not in the repository. The first implementation task is to import and provenance the latest verified v1.2.3 source, run its inherited validation, and establish a clean baseline commit before any renderer migration work is merged.
