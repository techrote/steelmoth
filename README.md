# Steel Moth

Steel Moth is the current engine/game codebase for **The Small Machine at the Edge of Night**. This repository is being prepared for a WebGPU-primary renderer migration and a long-horizon lighting-quality programme.

## Repository status

The verified **v1.2.3 WebGL2/Material-v2 source baseline is now imported on the SM-000 branch** from the exact delivered webapp/source ZIP. The recovered archive SHA-256 is `2399a50d08785211470a2af86bf693bff71f5d622d717432a595295a23208727`; its internal release checks verified 93/93 listed files, and the repository import report records 94 release files copied and verified. See [`docs/BASELINE_V123_PROVENANCE.md`](docs/BASELINE_V123_PROVENANCE.md).

No WebGPU implementation or GTX 1650 Super performance result should be inferred from the baseline import. Those remain later programme tasks with explicit validation gates.

The complete autonomous execution workflow is represented by **50 task issues** plus programme tracker **#51**. Task-code order, not GitHub issue-number order, is authoritative; see [`docs/ISSUE_MAP.md`](docs/ISSUE_MAP.md).

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

## Current execution state

**SM-000 / #1** is the baseline-import gate. Its source-recovery and binary-transfer blockers are resolved; the remaining gate is PR/check/merge verification. Once SM-000 is merged, independent M0 evidence/CI work may proceed and the earliest migration work remains constrained by `docs/DEPENDENCY_AND_CONCURRENCY.md`.

## Autonomous continuation

Start from programme tracker **#51** and select the earliest unblocked task allowed by `docs/DEPENDENCY_AND_CONCURRENCY.md`. Implementation PRs should use `.github/PULL_REQUEST_TEMPLATE.md`; future tasks should use the autonomous implementation issue template. `Auto` must not become WebGPU-first until **SM-505 / #50** passes the functional, performance, fallback, deployment, and clean-package release gates.
