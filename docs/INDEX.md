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
- [`MASTER_WEBGPU_PROGRAMME.md`](MASTER_WEBGPU_PROGRAMME.md) — programme goals, milestone decomposition, task codes and release gates.
- [`WEBGPU_ARCHITECTURE.md`](WEBGPU_ARCHITECTURE.md) — backend boundaries, scene representation, G-buffer, pseudo-depth ownership, clustering/DSO/Dark Bloom architecture.
- [`WEBGPU_VALIDATION_PLAN.md`](WEBGPU_VALIDATION_PLAN.md) — API, WGSL, readback, visual, editor, browser and hardware testing.
- [`LIGHTING_FIDELITY_ROADMAP.md`](LIGHTING_FIDELITY_ROADMAP.md) — post-migration lighting/material/indirect-light development sequence.
- [`DEPENDENCY_AND_CONCURRENCY.md`](DEPENDENCY_AND_CONCURRENCY.md) — dependency graph, serialization points and safe parallel lanes.
- [`RESEARCH_AND_DECISIONS.md`](RESEARCH_AND_DECISIONS.md) — external research findings, assumptions, ADR-style decisions and unresolved questions.
- [`EXECUTION_LEDGER.md`](EXECUTION_LEDGER.md) — durable record of planning/reconciliation stages and future implementation checkpoints.

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

As first inspected on 2026-09-16, `techrote/steelmoth` was empty. Therefore all implementation claims from earlier development conversations are historical context until the v1.2.3 baseline is imported and validated in this repository.
