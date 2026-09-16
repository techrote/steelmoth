# Steel Moth

Steel Moth is the current engine/game codebase for **The Small Machine at the Edge of Night**. This repository is being prepared for a WebGPU-primary renderer migration and a long-horizon lighting-quality programme.

## Repository status

**Planning/workflow scaffold only.** At the time this repository was inspected on 2026-09-16 it was empty: no source tree, issues, pull requests, or repository documentation were present. The latest known working baseline from the development conversations is **v1.2.3**, but that source has not yet been imported here. No WebGPU implementation or performance result should be inferred from this repository until the baseline-import and verification issues are completed.

The complete autonomous execution workflow is now represented by **50 task issues** plus programme tracker **#51**. Task-code order, not GitHub issue-number order, is authoritative; see [`docs/ISSUE_MAP.md`](docs/ISSUE_MAP.md).

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
4. [`docs/MASTER_WEBGPU_PROGRAMME.md`](docs/MASTER_WEBGPU_PROGRAMME.md) — canonical milestone/task decomposition.
5. [`docs/WEBGPU_ARCHITECTURE.md`](docs/WEBGPU_ARCHITECTURE.md) — renderer architecture and invariants.
6. [`docs/WEBGPU_VALIDATION_PLAN.md`](docs/WEBGPU_VALIDATION_PLAN.md) — correctness, visual, editor, browser, and performance gates.
7. [`docs/LIGHTING_FIDELITY_ROADMAP.md`](docs/LIGHTING_FIDELITY_ROADMAP.md) — post-migration lighting-quality roadmap.
8. [`docs/DEPENDENCY_AND_CONCURRENCY.md`](docs/DEPENDENCY_AND_CONCURRENCY.md) — task graph and safe parallelism.
9. [`docs/ISSUE_MAP.md`](docs/ISSUE_MAP.md) — task-code ↔ GitHub issue mapping.
10. [`docs/ISSUE_SET_REVIEW_2026-09-16.md`](docs/ISSUE_SET_REVIEW_2026-09-16.md) — independent review/correction record.
11. [`docs/EXECUTION_LEDGER.md`](docs/EXECUTION_LEDGER.md) — durable planning/execution ledger.

## Milestone hierarchy

- **M0 — Baseline acquisition, evidence harness, and CI**
- **M1 — Backend abstraction and WebGPU infrastructure**
- **M2 — Material-v2 parity, pseudo-depth ownership, and complete frame parity**
- **M3 — Overlap/occlusion architecture: clustering, DSO, Dark Bloom**
- **M4 — Procedural/editor integration and cross-browser functional parity**
- **M5 — Performance/foundation work and first WebGPU-primary release gate**
- **M6 — GTAO and indirect diffuse lighting**
- **M7 — Volumetric/advanced transparent lighting integration**
- **M8 — Bandwidth, quality scaling, soak testing, and long-term optimization**

## Immediate blocker

The implementation baseline is not in the repository. The first implementation task is **#1 / SM-000**: import and provenance the latest verified v1.2.3 source, run its inherited validation, and establish a clean baseline commit before renderer migration work is merged.

## Autonomous continuation

Start from programme tracker **#51** and select the earliest unblocked task allowed by `docs/DEPENDENCY_AND_CONCURRENCY.md`. Implementation PRs should use `.github/PULL_REQUEST_TEMPLATE.md`; future tasks should use the autonomous implementation issue template. `Auto` must not become WebGPU-first until **SM-505 / #50** passes the functional, performance, fallback, deployment, and clean-package release gates.
