# Issue-set review — 2026-09-16

Purpose: record the two required independent planning reviews, the defects found, and the durable corrections made before implementation begins.

## Review method

The repository began empty. After canonical docs and the initial task decomposition were created, the complete GitHub issue set was searched/re-read and compared against:

- the reconciled v1.2.3/Branch Steel Moth Forgetful/WebGPU conversation history;
- `MASTER_WEBGPU_PROGRAMME.md`;
- `WEBGPU_ARCHITECTURE.md`;
- `WEBGPU_VALIDATION_PLAN.md`;
- `LIGHTING_FIDELITY_ROADMAP.md`;
- `DEPENDENCY_AND_CONCURRENCY.md`.

The review specifically looked for missing implementation work, oversized tasks, hidden assumptions, dependency cycles, unsafe concurrency, missing acceptance/verification paths, and targets incorrectly presented as measurements.

## First review findings

### F1 — complete frame parity was under-decomposed

The first decomposition had G-buffer/deferred work but no explicit WebGPU tasks for the existing height self-shadow/contact path, ordinary transparent/effect sprites, or bloom/post/final output. A G-buffer that compiles is not a playable renderer.

**Correction:** created SM-205 (#46), SM-206 (#47), and SM-207 (#48); added them to M2 and downstream dependencies.

### F2 — repository-native CI/autonomous checks were missing

Individual issues required tests, but the newly empty repository had no task to establish durable local/CI entrypoints.

**Correction:** created SM-005 (#49) for stable local check commands, honest hosted CI, clean-package validation, and explicit separation of hosted/software tests from real-GPU performance.

### F3 — M4 release gate mixed functional parity with M5 performance/default promotion

SM-405 originally depended on M5 performance evidence while living in M4, creating a milestone ordering contradiction and making the functional browser gate unnecessarily inseparable from hardware performance.

**Correction:** updated #29/SM-405 to be the Chrome/Firefox functional parity gate (Gates A–E). Created SM-505 (#50) as the final Gate A–F/default-backend promotion and release task.

### F4 — final promotion authority was ambiguous

Early WebGPU lifecycle wording could have caused `Auto` to select WebGPU merely because initialization succeeded, bypassing the later validation/performance programme.

**Correction:** updated #8/SM-102: explicit/dev WebGPU selection is allowed during migration, but normal default promotion is reserved for SM-505.

### F5 — final shadow composition did not name the new self/contact dependency

SM-307 relied on “current self/contact ports” without a durable task dependency.

**Correction:** updated #23/SM-307 to depend explicitly on SM-205 plus DSO/Dark-Bloom tasks.

### F6 — transparent ordering did not depend on the general effect/post paths

SM-402 originally named water/foliage but not SM-206 ordinary transparent/effects or the SM-207 output/post interface.

**Correction:** updated #26 dependencies/scope to reconcile all four paths.

## Second independent review findings

The revised complete issue set was searched again (50 task issues plus the later programme tracker) without assuming the first review was sufficient.

### S1 — GTAO could have been tuned before material semantics stabilized

The original GTAO issue treated Material-v2 calibration as preferable rather than required. That risks tuning AO against normals/heights that will immediately change.

**Correction:** updated #35/SM-600 to require SM-502 colour correctness and SM-503 calibrated normal/height/AO semantics in addition to stable depth/shadow composition.

### S2 — volumetrics still had unsafe early-concurrency language

The programme's recommended visual order was Material/DSO → GTAO → SSGI → volumetrics, but the volumetric issue allowed an earlier prototype after M3. That could duplicate temporal/depth work and consume an unknown frame budget.

**Correction:** updated #39/SM-700 to depend on stabilized SM-603 SSGI/performance state; updated the concurrency plan to serialize volumetrics after M6.

### S3 — adaptive quality could precede the effects it is meant to adapt

SM-802 originally depended mainly on timing/static presets while its degradation order referenced SSGI and volumetrics.

**Correction:** updated #44/SM-802 to require stable SM-603 and SM-701 tiers as well as SM-500/501.

### S4 — task/issue mapping needed a durable source

Late review additions mean GitHub issue number order no longer matches milestone/task-code order. Future agents could otherwise misread sequencing from issue numbers.

**Correction:** created `ISSUE_MAP.md` with an explicit 50-task mapping and #51 top-level programme tracker. Task codes/dependency docs, not numeric issue order, define execution order.

### S5 — autonomous PR evidence format was implicit

`AGENTS.md` defined standards, but future autonomous PRs had no repository-native template forcing exact verification/performance/limitation reporting.

**Correction:** added `.github/PULL_REQUEST_TEMPLATE.md` and an autonomous implementation issue template.

## Dependency/cycle review

No intentional circular dependency remains in the canonical graph.

Important serialization points:

- source/audit before migration;
- shared root authority before pseudo-depth research;
- pseudo-depth derivation before production ownership;
- ownership before clustering;
- clustering before dominance;
- dominance before DSO;
- non-temporal DSO before Dark Bloom temporal stabilization;
- self/contact parity before final visibility composition;
- functional browser parity before final default promotion;
- material/colour calibration before GTAO;
- GTAO stabilization before SSGI;
- SSGI stabilization before volumetrics;
- static quality/per-effect tiers before adaptive quality.

Safe parallel lanes remain documented explicitly in `DEPENDENCY_AND_CONCURRENCY.md`.

## Oversize-task review

The largest risky domains were deliberately decomposed:

- WebGPU migration → scene abstraction, device lifecycle, resources, validation, G-buffer, depth research/implementation, lights, shadows, transparents, post;
- overlap shadows → occluders, clustering, dominance, hard DSO, distance hierarchy, Dark Bloom, temporal history, composition;
- GTAO/SSGI/volumetrics → prototype then stabilization/performance issues;
- final release → functional browser gate separate from performance/default-promotion gate.

No remaining issue is intentionally allowed to combine unrelated gameplay redesign with renderer work.

## Verification-path review

Every task issue includes objective, scope, non-goals, dependencies/concurrency, canonical context, implementation prompt, acceptance criteria, verification, expected artifacts, and blocking/stopping conditions. Hardware-specific issues explicitly remain open when target hardware evidence is unavailable; hosted/software rendering cannot substitute for GTX 1650 Super measurements.

## Known unresolved blockers after review

- **B-001:** actual v1.2.3 implementation source still absent from repository; #1 owns recovery/import.
- **B-002:** original box/bin screenshots not yet committed; #2 owns recovery/provenance.
- **B-003:** real GTX 1650 Super pass-level measurements do not yet exist; #4/#31 own them.
- **B-004:** exact pseudo-depth projection intentionally unresolved; #12 owns research/decision.

These blockers are represented as work; they do not invalidate the planning workflow.
