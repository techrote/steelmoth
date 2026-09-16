# Execution ledger

This ledger records the repository-planning operation requested on 2026-09-16 and provides durable checkpoints for future implementation.

## Planning/reconciliation pass

| Stage | Status | Result |
| --- | --- | --- |
| 1. Reconcile relevant conversations | complete | v1.2.0→v1.2.3 renderer history, Branch Steel Moth Forgetful bin/box findings, WebGPU migration decision, v1.3 unverified checkpoint, and lighting roadmap reconciled into `RAG_REFERENCE_STEELMOTH.md`. |
| 2. Determine decomposition readiness | complete | plan is decomposable, but implementation source is absent from repository. |
| 3. Repair omissions/contradictions/weak assumptions | complete | separated targets from measurements; added exact pseudo-depth research issue; added source-baseline blocker; made screenshot references explicit; clarified WebGL2 fallback policy; added API/error-scope/format validation and temporal-history rejection requirements. |
| 4. Create supporting canonical docs | complete | README, AGENTS, index, RAG reference, master programme, architecture, validation plan, lighting roadmap, research/decisions, concurrency plan, ledger. |
| 5. Milestone/dependency hierarchy | complete | M0–M8 and task-code hierarchy defined in master programme. |
| 6. Concurrency analysis | complete | hard serialization spine, safe parallel lanes and unsafe concurrency pairs documented. |
| 7. Inspect current repository/GitHub state | complete | repository was empty: no files/issues; default branch `main`; push/admin available. |
| 8. Create/update canonical project documentation | complete | canonical planning scaffold committed to `main`. |
| 9. Create/update GitHub issues | pending in this ledger revision | issue creation follows documentation bootstrap; mapping will be appended below. |
| 10. Review issue set | pending | perform after issue creation. |
| 11. Correct review findings | pending | perform after independent issue-set review. |
| 12. Final repository-wide consistency pass | pending | verify docs/task codes/issues/dependencies after corrections. |

## Immediate blocker

**B-001 — Implementation source absent.** `techrote/steelmoth` was empty when first inspected. Historical conversations identify v1.2.3 as the latest known good baseline, but no source/tree exists here yet. SM-000 must import/provenance it before implementation tasks can merge.

This blocker does not invalidate the programme; documentation, research, issue decomposition and other planning work can proceed.

## Other unresolved inputs

- **B-002 — Authoritative box/bin screenshot files not in repository.** Recover if possible; deterministic reconstructed fixtures can proceed but cannot substitute the original human-reference comparison.
- **B-003 — GTX 1650 Super pass-level timings not yet measured.** Performance targets remain targets.
- **B-004 — Exact pseudo-depth projection formula not yet derived/validated.** Dedicated SM-201 research/decision task required.

## Issue mapping

To be populated after GitHub issue creation.

## Significant planning changes made during review

1. Split platform/API validation from visual parity instead of treating “WebGPU initializes” as migration completion.
2. Added a baseline import/provenance milestone because the repository contains no implementation source.
3. Promoted pseudo-depth derivation to its own research/decision task before per-pixel ownership implementation.
4. Added object-ID/light-independence tests so moving the light cannot accidentally alter visibility ownership.
5. Made DSO clustering/dominance/core/distance hierarchy/Dark Bloom/temporal history separate tasks to avoid oversized untestable work.
6. Deliberately serialized temporal shadow work after non-temporal correctness.
7. Separated procedural water/foliage/grass coherence from the core opaque renderer.
8. Separated colour-space/material calibration from GTAO/SSGI/volumetrics.
9. Added pass-level hardware performance methodology and explicit “target vs measured” vocabulary.
10. Added long-run resource-leak/soak testing and optional adaptive quality only after static tiers/timing are trustworthy.
