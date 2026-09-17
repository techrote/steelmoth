# Execution ledger

This ledger records the repository-planning operation requested on 2026-09-16 and provides durable checkpoints for future implementation.

## Planning/reconciliation pass

| Stage | Status | Result |
| --- | --- | --- |
| 1. Reconcile relevant conversations | complete | v1.2.0→v1.2.3 renderer history, Branch Steel Moth Forgetful bin/box findings, WebGPU migration decision, unverified v1.3 checkpoint, and lighting roadmap reconciled into `RAG_REFERENCE_STEELMOTH.md`. |
| 2. Determine decomposition readiness | complete | plan is decomposable; implementation was initially blocked on source import because repository began empty. |
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
- `docs/BASELINE_V123_AUDIT.md` — SM-004 audited implementation contract for the imported baseline.
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

## SM-000 baseline-import execution — 2026-09-17

### Recovered source

The authoritative v1.2.3 source distribution is the delivered webapp ZIP itself. SHA-256:

`2399a50d08785211470a2af86bf693bff71f5d622d717432a595295a23208727`

### Import evidence

- archive internal `SHA256SUMS.txt`: **93/93 OK**;
- release files copied by repository import helper: **94**;
- repository copy verification before commit: **PASS**;
- JavaScript syntax checks: PASS;
- v1.2.3 surface/webapp/coherence validators: PASS;
- Material-v2 validation: PASS, **314 regions**;
- renderer/ghost/visual/webapp validators: PASS;
- GLSL validation: PASS, **26 production programs** plus MRT/fallback framebuffer checks;
- planning consistency validation: PASS during the import workflow;
- critical remote Git blobs were cross-checked against locally computed blobs from the authoritative ZIP, including `engine/game.js` and all five large generated runtime/material PNGs;
- Windows launcher CRLF normalization introduced by local Git was corrected to the exact archive bytes;
- PR #52 was squash-merged to `main` at commit `089d7a34ceae1b12c72b6426b38be410e087d50e`;
- issue #1 closed automatically as completed;
- the merged `main` runtime atlas blob was rechecked and matches the authoritative Git blob SHA `8a48fd0354169cab2bb6ade51f29f6ef93e28f31`.

Full evidence is in `docs/BASELINE_V123_PROVENANCE.md`, `docs/BASELINE_V123_FILE_MANIFEST.tsv`, and `docs/BASELINE_V123_IMPORT_REPORT.txt`.

### SM-000 status

**Complete.** Source recovery, binary transfer, repository import, PR review/merge, merge verification, and issue closure are complete. The programme's former root source blocker is removed.

## SM-002 deterministic capture harness — 2026-09-17

**Complete.** PR #53 merged the deterministic WebGL2 render-test entrypoint/harness, named fixture loading, eight canonical light angles, self-describing screenshot/diagnostics metadata, seeded/fixed-time isolation, and a local Chromium automation path. The managed execution environment could not provide a trustworthy EGL/ANGLE GPU capture path, and that limitation is recorded rather than faked.

SM-002 closed issue #3. SM-001 later integrated its richer fixture corpus with this harness through a narrow test-only adapter.

## SM-001 visual references and regression fixtures — 2026-09-17

**Complete.** PR #54 merged the deterministic visual fixture corpus, provenance/catalog documentation, reference validator, and eight exact historical PNGs under `render-tests/references/original/` by reusing the exact Git blobs uploaded under `images/`.

Recovered exact reference artifacts:

- `boxleft.png`, `boxright.png`, `boxup.png`, `boxdown.png`;
- `binsleft.png`, `binsright.png`, `binsup.png`;
- supplementary `binsupright.png`.

The user later clarified that `binsupleft.png` also existed historically and was simply omitted when the images were attached. Its original bytes/file are still unrecovered/uncommitted, so the current `binsupleft` fixture remains explicitly reconstructed and must not be represented as the original screenshot.

Issue #2 is closed as completed because its blocking rule explicitly allowed missing originals to be recorded while independent deterministic fixture work completed.

## SM-004 imported-baseline contract audit — 2026-09-17

Source audit result: **no baseline runtime corrective patch required.** The renderer core on current main remains byte-identical to the imported v1.2.3 `engine/game.js` blob, so the SM-000 executable validation evidence applies to the exact renderer bytes audited.

Principal reconciliations recorded in `docs/BASELINE_V123_AUDIT.md`:

- Material-v2 atlases, 314-region coverage, MRT G-buffer, deferred GGX-style lighting, bounded height self-shadow, half-resolution contact shadow, macro projected shadows, debug views and cache/version closure are present.
- WebGL2 G2.R is **local Material-v2 pseudo-height**, not final fragment visibility/ownership depth.
- v1.2.3 has no object-ID G-buffer target or hardware per-pixel sprite ownership path; material sprites are foot/painter ordered.
- `getSpriteFootAnchor()` is shared by Material-v2 descriptors, but macro-shadow and FoliageFX root/bottom conventions remain independent; SM-101 therefore remains necessary.
- static material ghost-clearing is explicit and covered by inherited regression tooling.
- grass/water/foliage are coherent forward adapters using the lit scene/main-light direction, not yet canonical future WebGPU light/depth consumers.
- the stronger diagnostic-light preset is a reproducible test preset, not the v1.2.3 compatibility runtime default.

These findings confirm rather than reorder the SM-100 → SM-101/SM-200 → SM-201/202 dependency rationale.

## Current blockers

### B-001 — baseline source import

**Resolved.** SM-000 / #1 is complete and merged to `main`.

### B-002 — authoritative box/bin screenshot corpus

**Largely resolved.** SM-001 / #2 committed eight exact historical directional references and the deterministic fixture corpus. The only missing original artifact is `binsupleft.png`: the user has confirmed that the screenshot was historical, but its original bytes/file have not been recovered. This does not block independent migration work; reconstructed `binsupleft` fixture output must continue to be labeled reconstructed.

### B-003 — target-hardware performance evidence absent

No pass-level GTX 1650 Super WebGL2/WebGPU dataset has been measured in this repository. The ≤12 ms mean / ≤14.5 ms p95 values remain programme targets, not facts. **#4 / SM-003**, **#31 / SM-501**, and later performance gates own measurement.

### B-004 — canonical pseudo-depth formula intentionally unresolved

The exact projection from shared root/transform + local Material-v2 height + layer bias to fragment ownership depth must be derived and validated before production use. SM-004 confirmed that existing WebGL2 G2.R is only local material height and is not this formula. **#12 / SM-201** owns the research/decision.

## Issue mapping

Canonical task/issue mapping is maintained in `docs/ISSUE_MAP.md`:

- 50 implementation/research tasks across M0–M8;
- issue numbers #1–#50 (task-code ordering is authoritative; number ordering is not);
- programme execution tracker #51.

## Significant planning corrections

1. Source import/provenance became an explicit root milestone because the repository was empty.
2. Historical renderer claims remain context until classified against imported source; SM-004 now provides that classification for the v1.2.3 renderer contracts.
3. Pseudo-depth derivation remains a research/decision issue before implementation; local Material-v2 height is not accepted ownership depth.
4. API/WGSL/resource validation is independent of screenshot/performance success.
5. Material-v2 parity includes self/contact shadow, ordinary transparent/effect, bloom/post and final output paths rather than stopping at G-buffer/direct lighting.
6. DSO is decomposed into occluder data → clustering → dominance → hard core → distance hierarchy → Dark Bloom → temporal soft history → final visibility composition.
7. Temporal shadow work is explicitly serialized after correct static-frame results.
8. Water/foliage/Fine Grass must become canonical light/depth consumers in WebGPU; their v1.2.3 lit-scene adapters are compatibility behaviour, not the final architecture.
9. Cross-browser functional parity (SM-405) is separated from target-hardware/default promotion (SM-505).
10. `Auto` remains migration-gated until SM-505; adapter availability alone cannot promote WebGPU.
11. GTAO requires colour/material semantic correctness; SSGI follows stabilized GTAO; volumetrics follow stabilized SSGI; adaptive quality follows mature effect tiers.
12. Performance vocabulary distinguishes target, measured GPU timing, CPU timing, and informal utilization context.
13. Hosted/software CI may validate APIs/tests but cannot substitute for real GTX 1650 Super performance evidence.

## Planning verification performed

- Inspected repository/root and docs contents after updates.
- Re-searched all `SM-*` issue titles after corrections: 50 task issues present, with no duplicate task code observed in the reconciled set.
- Compared task counts by milestone against `ISSUE_MAP.md`: M0 6, M1 5, M2 8, M3 8, M4 6, M5 6, M6 4, M7 3, M8 4 = 50.
- Reconciled unsafe dependency findings from the second review in issue bodies and `DEPENDENCY_AND_CONCURRENCY.md`.
- Added `tools/validate_planning.py` so the same canonical-map/dependency/index checks can run automatically once repository CI is established.

No target-hardware benchmark has yet been accepted; SM-003 remains the WebGL2 GTX 1650 Super measurement lane and may proceed concurrently with documentation/source-audit work where baseline identity is pinned.
