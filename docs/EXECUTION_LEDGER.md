# Execution ledger

This ledger records the repository-planning operation requested on 2026-09-16 and provides durable checkpoints for future implementation.

## Planning/reconciliation pass

| Stage | Status | Result |
| --- | --- | --- |
| 1. Reconcile relevant conversations | complete | v1.2.0→v1.2.3 renderer history, Branch Steel Moth Forgetful bin/box findings, WebGPU migration decision, unverified v1.3 checkpoint, and lighting roadmap reconciled into `RAG_REFERENCE_STEELMOTH.md`. |
| 2. Determine decomposition readiness | complete | plan is decomposable; implementation is intentionally blocked on source import because repository began empty. |
| 3. Repair omissions/contradictions/weak assumptions | complete | separated targets from measurements; added baseline/source blocker, pseudo-depth research task, original-reference provenance, API/error-scope/format validation, complete frame-parity tasks, CI, final promotion gate, and safe later-lighting dependencies. |
| 4. Create supporting canonical docs | complete | README, AGENTS, index, RAG reference, master programme, architecture, validation plan, lighting roadmap, research/decisions, concurrency plan, issue map, review record, ledger and GitHub workflow templates. |
| 5. Milestone/dependency hierarchy | complete | M0–M8 and 50 task codes defined in `MASTER_WEBGPU_PROGRAMME.md`. |
| 6. Concurrency analysis | complete | hard serialization spine, safe parallel lanes, unsafe concurrency pairs and blocker propagation documented in `DEPENDENCY_AND_CONCURRENCY.md`. |
| 7. Inspect current repository/GitHub state | complete | repository was empty at first inspection: no implementation files/issues; default branch `main`; repository write access available. |
| 8. Create/update canonical project documentation | complete | planning/workflow scaffold committed directly to `main` because repository contained no implementation branch history to preserve. |
| 9. Create/update GitHub issues | complete | 50 structured task issues created/reconciled plus #51 programme tracker. Each task contains objective, scope/non-goals, dependencies/concurrency, canonical context, implementation prompt, acceptance, verification, expected artifacts and stop conditions. |
| 10. Review resulting issue set | complete | first independent review found missing self/contact parity, general transparent/effect parity, post/output parity, CI, and separation of functional vs final release gate. |
| 11. Correct review findings and perform second review | complete | added SM-005/205/206/207/505; corrected SM-102/307/402; second review tightened GTAO prerequisite, serialized volumetrics after stabilized SSGI, and made adaptive quality depend on mature SSGI/volumetric tiers. Details in `ISSUE_SET_REVIEW_2026-09-16.md`. |
| 12. Final repository-wide consistency pass | complete | complete task-issue search returned 50 unique `SM-*` task issues; `ISSUE_MAP.md` reconciles issue numbers/task codes; #51 matches the 50-task set; canonical docs/templates are present; root blocker/dependency and default-promotion policies agree across README/master/dependency/issues. A reusable `tools/validate_planning.py` consistency checker was added for future checkout/CI use. |

## Repository-native workflow artifacts

- `README.md` — status, architecture, milestone overview and start point.
- `AGENTS.md` — autonomous execution contract.
- `docs/INDEX.md` — source-of-truth order/status vocabulary.
- `docs/RAG_REFERENCE_STEELMOTH.md` — historical/reconciled context.
- `docs/RESEARCH_AND_DECISIONS.md` — sourced WebGPU findings, ADRs and open questions.
- `docs/MASTER_WEBGPU_PROGRAMME.md` — 50-task M0–M8 decomposition.
- `docs/WEBGPU_ARCHITECTURE.md` — target renderer contracts.
- `docs/WEBGPU_VALIDATION_PLAN.md` — API/readback/visual/editor/browser/performance gates.
- `docs/LIGHTING_FIDELITY_ROADMAP.md` — Material/DSO → GTAO → SSGI → volumetric → optimization roadmap.
- `docs/DEPENDENCY_AND_CONCURRENCY.md` — serialized spine/safe parallelism/blocker propagation.
- `docs/ISSUE_MAP.md` — task code ↔ issue number map.
- `docs/ISSUE_SET_REVIEW_2026-09-16.md` — two review passes and corrections.
- `.github/PULL_REQUEST_TEMPLATE.md` — evidence-oriented implementation PR contract.
- `.github/ISSUE_TEMPLATE/autonomous-implementation.md` — future task template.
- `tools/validate_planning.py` — local/CI static consistency check for canonical task mapping/docs.
- GitHub issue #51 — top-level execution tracker.

## Current blockers

### B-001 — implementation source absent

`techrote/steelmoth` was empty when first inspected. Historical conversations identify v1.2.3 as the latest known good baseline, but no implementation tree exists here yet. **#1 / SM-000** owns recovery/import/provenance and is the root implementation blocker.

### B-002 — authoritative box/bin screenshots absent

The original `boxes`, `binsright`, `binsleft`, `binsupleft`, and `binsup` files are not yet committed. **#2 / SM-001** owns recovery/provenance. Deterministic reconstructed fixtures may proceed but may not be mislabeled as originals.

### B-003 — target-hardware performance evidence absent

No pass-level GTX 1650 Super WebGL2/WebGPU dataset has been measured in this repository. The ≤12 ms mean / ≤14.5 ms p95 values remain programme targets, not facts. **#4 / SM-003**, **#31 / SM-501**, and later performance gates own measurement.

### B-004 — canonical pseudo-depth formula intentionally unresolved

The exact projection from root/local pixel/Material-v2 height/layer bias to fragment ownership depth must be derived and validated before production use. **#12 / SM-201** owns this research/decision.

## Issue mapping

Canonical task/issue mapping is maintained in `docs/ISSUE_MAP.md`:

- 50 implementation/research tasks across M0–M8;
- issue numbers #1–#50 (task-code ordering is authoritative; number ordering is not);
- programme execution tracker #51.

## Significant planning corrections

1. Source import/provenance became an explicit root milestone because the repository was empty.
2. Historical renderer claims are context until revalidated against imported source.
3. Pseudo-depth derivation became a research/decision issue before implementation.
4. API/WGSL/resource validation is independent of screenshot/performance success.
5. Material-v2 parity now includes self/contact shadow, ordinary transparent/effect, bloom/post and final output paths rather than stopping at G-buffer/direct lighting.
6. DSO is decomposed into occluder data → clustering → dominance → hard core → distance hierarchy → Dark Bloom → temporal soft history → final visibility composition.
7. Temporal shadow work is explicitly serialized after correct static-frame results.
8. Water/foliage/Fine Grass are canonical light/depth consumers, not independent lighting worlds.
9. Cross-browser functional parity (SM-405) is separated from target-hardware/default promotion (SM-505).
10. `Auto` remains migration-gated until SM-505; adapter availability alone cannot promote WebGPU.
11. GTAO requires colour/material semantic correctness; SSGI follows stabilized GTAO; volumetrics follow stabilized SSGI; adaptive quality follows mature effect tiers.
12. Performance vocabulary distinguishes target, measured GPU timing, CPU timing, and informal utilization context.
13. Hosted/software CI may validate APIs/tests but cannot substitute for real GTX 1650 Super performance evidence.

## Final planning verification performed

- Inspected repository/root and docs contents after updates.
- Re-searched all `SM-*` issue titles after corrections: 50 task issues present, with no duplicate task code observed in the reconciled set.
- Compared task counts by milestone against `ISSUE_MAP.md`: M0 6, M1 5, M2 8, M3 8, M4 6, M5 6, M6 4, M7 3, M8 4 = 50.
- Reconciled unsafe dependency findings from the second review in issue bodies and `DEPENDENCY_AND_CONCURRENCY.md`.
- Added `tools/validate_planning.py` so the same canonical-map/dependency/index checks can run automatically once the repository is checked out/CI is established.

No gameplay/WebGPU implementation or target-hardware benchmark was performed during this planning-only repository bootstrap; those are intentionally represented by open task issues rather than implied as complete.
