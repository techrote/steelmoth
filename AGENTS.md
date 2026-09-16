# AGENTS.md — Steel Moth autonomous execution contract

This repository is intended for long-horizon autonomous implementation. Future agents should execute issues through implementation, tests, documentation reconciliation, PR creation, CI repair, and merge when authorized and safe.

## Read order

Before coding, read:

1. the assigned GitHub issue in full;
2. `docs/INDEX.md`;
3. all canonical documents linked by the issue;
4. current `main` and relevant recent merged PRs;
5. inherited tests and diagnostics for the subsystem being changed.

The issue is task authority; canonical documents are shared architectural/product authority. If they conflict, stop and document the conflict rather than silently choosing one.

## Non-negotiable product/engine constraints

- Do not redesign gameplay while implementing renderer work.
- Raw WebGPU/WGSL only for the primary renderer; do not introduce Three.js, Babylon, Pixi, Phaser, or another engine/framework.
- Do not convert sprite content into polygonal mesh assets.
- Preserve WebGL2 fallback at the v1.2.x compatibility tier; do not duplicate every future WebGPU-only feature into WebGL2.
- Preserve pixel-art sharpness: nearest/crisp albedo sampling, atlas gutters/padding, no cross-region material leakage.
- Preserve one authoritative sprite root/foot/pseudo-depth convention across static, dynamic, foreground, editor, shadow, and both rendering backends.
- Gameplay-critical state must never depend on cosmetic renderer success.
- Procedural systems must consume canonical light/depth/material state rather than inventing incompatible lighting conventions.
- Do not claim GPU timings, browser compatibility, screenshot parity, or hardware performance without actual measurement.

## Autonomous issue execution

For implementation issues:

1. Confirm dependencies named in the issue are merged or explicitly waived by a documented decision.
2. Create a focused branch.
3. Implement only the issue scope plus necessary reconciliations.
4. Add/update automated tests and diagnostics before declaring completion.
5. Run the issue verification instructions and the relevant inherited suite.
6. Update canonical docs if architecture/contracts changed.
7. Open a PR that references the issue and summarizes measured/verified outcomes.
8. Repair CI/test failures caused by the change.
9. If repository permissions allow, merge the PR only after required automated checks pass and acceptance criteria are genuinely satisfied.
10. Verify the merge landed on `main`; then close the issue.

Do not close an issue merely because code was written.

## Stop/block conditions

Stop the assigned issue and record a blocker when any of the following occurs:

- a required source artifact or authoritative fixture is missing;
- a dependency is not merged and the issue cannot safely proceed independently;
- a requested WebGPU feature/format is unsupported on the tested adapter and no documented fallback/alternative is approved;
- the change would alter gameplay/product behaviour outside issue scope;
- acceptance requires unavailable physical hardware or a human visual judgement that cannot be reproduced in the current environment;
- measured data contradicts a canonical architecture assumption and continuing would embed the contradiction.

A blocked issue should identify dependent work and, when useful, create or reference a research/decision issue. Continue independent work elsewhere; do not block the whole programme unnecessarily.

## Verification standard

Use evidence appropriate to the claim:

- API/resource claims → WebGPU validation scopes, shader compilation info, pipeline creation, readback tests.
- representation claims → deterministic G-buffer/object-ID/depth/cluster readbacks.
- visual claims → reproducible fixture captures at documented light angles plus human review where required.
- performance claims → timestamp queries when available, fixed benchmark scenes, warm-up/sample windows, browser/GPU/driver metadata.
- fallback claims → deliberately exercise WebGPU absence/failure and confirm WebGL2 gameplay.

CPU timings must never be reported as GPU timings. Task Manager GPU utilization may be recorded as context only.

## Documentation discipline

Large shared context belongs in canonical repository documents, not duplicated into every issue. Issues should link exact sections and contain only task-specific context.

Distinguish explicitly:

- **Requirement** — user/product constraint.
- **Decision** — adopted architecture/product choice.
- **Research finding** — sourced external fact.
- **Assumption** — unverified premise requiring validation.
- **Target** — desired acceptance number, not measured result.
- **Measured result** — empirical value with environment/method recorded.
- **Speculation/idea** — not implementation authority until promoted by a decision.

## Performance discipline

The GTX 1650 Super 4 GB at 1080p/60 is the primary reference target. The programme target of ≤12 ms mean renderer GPU and ≤14.5 ms p95 is a target until measured.

Profile before optimizing and before claiming improvement. Prefer bounded work, persistent resources, reusable depth/light/history infrastructure, tile/light culling, and reduced-resolution secondary effects over global render-resolution reduction.

## Change hygiene

- Keep issues/PRs small enough to verify independently.
- Avoid unrelated movement/AI/content refactors.
- No unbounded per-frame CPU scans, resource churn, or per-object draw architecture without measured justification.
- Preserve deterministic tests and clean extraction/package validation.
- Significant architecture changes require updating the relevant ADR/canonical document in the same PR.
