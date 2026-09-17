# Steel Moth documentation index

This directory is the repository source of truth for the WebGPU migration and subsequent lighting-quality programme.

## Authority order

When documents conflict, use this order unless an issue explicitly records a newer decision:

1. explicit current user requirements recorded in an issue/decision;
2. accepted ADR/architecture decisions;
3. `MASTER_WEBGPU_PROGRAMME.md`;
4. subsystem specifications/plans;
5. historical/RAG context;
6. implementation notes and speculation.

Do not silently promote a historical suggestion into a requirement.

## Canonical documents

- [`RAG_REFERENCE_STEELMOTH.md`](RAG_REFERENCE_STEELMOTH.md) — reconciled prior-development context, known baseline history, provenance and unresolved facts.
- [`BASELINE_V123_AUDIT.md`](BASELINE_V123_AUDIT.md) — SM-004 source-level classification of the imported v1.2.3 renderer contracts and migration implications.
- [`MASTER_WEBGPU_PROGRAMME.md`](MASTER_WEBGPU_PROGRAMME.md) — programme goals, M0–M8 decomposition, task codes and release gates.
- [`WEBGPU_ARCHITECTURE.md`](WEBGPU_ARCHITECTURE.md) — backend boundaries, scene representation, G-buffer, pseudo-depth ownership, clustering/DSO/Dark Bloom architecture.
- [`RENDER_SCENE_DESCRIPTION.md`](RENDER_SCENE_DESCRIPTION.md) — implemented SM-100 RenderScene/Sprite/Material/Light/Occluder/Procedural record schemas, identity rules and WebGL2 compatibility adapter boundary.
- [`WEBGPU_VALIDATION_PLAN.md`](WEBGPU_VALIDATION_PLAN.md) — API, WGSL, readback, visual, editor, browser and hardware testing.
- [`CI_AND_VERIFICATION.md`](CI_AND_VERIFICATION.md) — stable local/CI entrypoints, failure-report schema, package extraction gate, and evidence boundaries.
- [`LIGHTING_FIDELITY_ROADMAP.md`](LIGHTING_FIDELITY_ROADMAP.md) — post-migration lighting/material/indirect-light development sequence.
- [`DEPENDENCY_AND_CONCURRENCY.md`](DEPENDENCY_AND_CONCURRENCY.md) — dependency graph, serialization points and safe parallel lanes.
- [`RESEARCH_AND_DECISIONS.md`](RESEARCH_AND_DECISIONS.md) — external research findings, assumptions, ADR-style decisions and unresolved questions.
- [`ISSUE_MAP.md`](ISSUE_MAP.md) — canonical task-code → GitHub issue-number map. Task codes/dependency docs define order; issue-number order does not.
- [`ISSUE_SET_REVIEW_2026-09-16.md`](ISSUE_SET_REVIEW_2026-09-16.md) — two independent issue-set reviews, defects found, and corrections applied.
- [`EXECUTION_LEDGER.md`](EXECUTION_LEDGER.md) — durable record of planning/reconciliation stages, blockers and implementation checkpoints.

## Repository-native workflow artifacts

- `AGENTS.md` — autonomous implementation/verification contract.
- `.github/workflows/verification.yml` — hosted source/regression, GLSL/MRT software, and clean-package verification.
- `tools/run_checks.py` — stable cross-platform verification runner and failure-report contract.
- `tools/validate_clean_package.py` — fresh ZIP/extraction/integrity validation.
- `.github/PULL_REQUEST_TEMPLATE.md` — evidence-oriented implementation PR contract.
- `.github/ISSUE_TEMPLATE/autonomous-implementation.md` — future task template matching programme structure.
- GitHub issue **#51** — top-level execution tracker/checklist.

## Status vocabulary

Use these words consistently:

- **Requirement** — externally imposed product/engineering constraint.
- **Decision** — architecture/product choice adopted by this repository.
- **Target** — desired acceptance/performance value; not yet a measurement.
- **Measured** — reproduced empirical value with environment/method.
- **Research finding** — sourced fact about APIs/hardware/algorithms.
- **Assumption** — working premise requiring validation.
- **Blocked** — cannot proceed safely without a named dependency/input.
- **Deferred** — intentionally postponed and not a blocker for current milestone.

## Current repository state

The repository is no longer source-blocked. SM-000 imported and provenance-verified the authoritative v1.2.3 WebGL2/Material-v2 baseline. SM-002 added the deterministic capture/diagnostics harness, and SM-001 added the durable visual-reference/fixture corpus and adapter integration.

SM-004 audited the imported v1.2.3 renderer rather than relying on conversation memory. The authoritative baseline implementation reconciliation is `BASELINE_V123_AUDIT.md`. In particular, current WebGL2 G2.R is local Material-v2 height rather than final fragment ownership depth, and root/foot authority is only partially centralized; downstream WebGPU issues must follow the audited dependency chain rather than treating historical shorthand as current implementation fact.

SM-005 establishes the repository-native automated verification surface. Hosted checks deliberately separate deterministic source/API correctness from browser/hardware/performance claims; those remain owned by their explicit hardware/visual gates.

SM-100 introduces the first backend-neutral renderer boundary. `engine/render_scene.js` defines typed per-frame renderer records and `engine/webgl2_scene_adapter.js` makes the existing WebGL2 renderer consume that description through compatibility replay. This does not resolve the audited root/foot debt or invent fragment ownership depth; SM-101 and SM-201/202 retain those responsibilities.

Historical context in `RAG_REFERENCE_STEELMOTH.md` remains useful for intent and provenance, but source-level implementation claims should defer to the imported code, its validation records, the SM-004 audit, implemented subsystem contracts, and current verification reports.
