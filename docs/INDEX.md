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
- [`RENDER_SCENE_DESCRIPTION.md`](RENDER_SCENE_DESCRIPTION.md) — implemented SM-100 RenderScene schemas and WebGL2 compatibility boundary, reconciled to SM-101 root authority.
- [`ROOT_FOOT_CONVENTION.md`](ROOT_FOOT_CONVENTION.md) — SM-101 canonical sprite root/foot/placement API, compatibility rules, editor/shadow/backend integration and downstream contract.
- [`WEBGPU_DEVICE_LIFECYCLE.md`](WEBGPU_DEVICE_LIFECYCLE.md) — SM-102 adapter/device/context lifecycle, staged backend selection, diagnostics, loss/error handling and WebGL2 fallback contract.
- [`WEBGPU_RESOURCE_INFRASTRUCTURE.md`](WEBGPU_RESOURCE_INFRASTRUCTURE.md) — SM-103 persistent resource registry, bounded upload arenas, explicit frame graph, pipeline cache, invalidation and diagnostics contract.
- [`WEBGPU_API_VALIDATION.md`](WEBGPU_API_VALIDATION.md) — SM-104 executable WGSL/pipeline/resource/failure-path inventory, report schemas and evidence boundaries.
- [`WEBGPU_GBUFFER_SM200.md`](WEBGPU_GBUFFER_SM200.md) — SM-200 production Material-v2 G-buffer formats, atlas semantics, deterministic clears/readbacks and material/object-ID debug contract; its depth-disabled class is retained as a compatibility/control path.
- [`PSEUDO_DEPTH_MODEL.md`](PSEUDO_DEPTH_MODEL.md) — SM-201 accepted light-independent fragment ownership projection, units/ranges/layers, numeric vectors and rejected alternatives, now mechanically adopted by SM-202.
- [`WEBGPU_OWNERSHIP_SM202.md`](WEBGPU_OWNERSHIP_SM202.md) — SM-202 production per-pixel fragment-depth/object-ID ownership, alpha cutout, layer/bias, readback/debug and eight-angle/perturbation validation contract.
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
- `.github/workflows/verification.yml` — hosted source/regression, required real-WebGPU WGSL/pipeline/resource/G-buffer/ownership validation, WebGL2 pixel parity, GLSL/MRT software, and clean-package verification.
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

The repository is no longer source-blocked. SM-000 imported and provenance-verified the authoritative v1.2.3 WebGL2/Material-v2 baseline. SM-001/002 established the visual fixture corpus and deterministic capture/diagnostics harness; SM-004 audited the imported implementation, and SM-005 established repository-native automated verification.

The SM-004 reconciliation remains important: WebGL2 G2.R is local Material-v2 height rather than final fragment ownership depth. Historical root/foot calculations were distributed among static, dynamic, foreground, editor and shadow paths.

SM-100 introduced the first backend-neutral renderer boundary through typed RenderScene records and WebGL2 compatibility replay. SM-101 supplies the shared `steelmoth-render-transform/v1` authority consumed by active Material-v2 roots, editor placement/hit geometry, shadow profile helpers and RenderScene roots while preserving accepted v1.2.3 placement.

SM-102 adds the production WebGPU platform lifecycle boundary without claiming a WebGPU game renderer already exists. Explicit migration selection can acquire/inventory an adapter and device, negotiate exposed optional features, configure/reconfigure a dedicated WebGPU context, collect asynchronous errors/loss diagnostics, and fall back safely. Normal `Auto` remains WebGL2 and does not request an adapter until SM-505 authorizes promotion. During this device-only stage a successful explicit WebGPU selection still presents the game through the accepted WebGL2 compatibility renderer.

SM-103 layers deterministic persistent GPU ownership on that lifecycle: named texture/buffer definitions survive ordinary frames, only surface-dependent resources rebuild on resize, backend reset rebuilds definitions on the replacement device, static uploads and bounded dynamic arenas are separate, pass order is explicit, and pipeline/resource diagnostics are inspectable.

SM-104 makes that WebGPU platform independently falsifiable. The production validation inventory compiles WGSL with compilation-info collection, creates and executes real render/compute pipelines under validation scopes, creates core/fallback descriptors, exercises `copyExternalImageToTexture`, validates optional-feature absence, deliberately captures an invalid descriptor, and forces both initialization failure and device loss back to WebGL2 without mutating gameplay-authoritative sentinel state.

SM-200 is the first production WebGPU representation pass on that infrastructure. It adds the explicit Material-v2 G0/G1/G2/Object-ID/Depth attachment set, coordinate-identical nearest-sampled atlas upload, alpha-cutout material submission for static/dynamic/foreground RenderScene records, deterministic per-frame clears, executable debug views and required real-WebGPU fixture readbacks. The original SM-200 class remains a depth-disabled material/control path for A/B validation.

SM-201 resolves the ownership-depth research question. The accepted `steelmoth-pseudo-depth/v1` model reconstructs pseudo-ground ownership as `fragmentScreenY + worldZ`, combines it with explicit layer/bias lanes, and maps the resulting visibility key monotonically into 0..1 WebGPU depth. Numeric vectors and box/bin prototypes pin vertical-face cancellation, static/dynamic parity, foreground separation, alpha cutout, subpixel stability, rotation/flip semantics and light-angle independence.

SM-202 mechanically adopts that model in the staged production WebGPU ownership pass. Covered Material-v2 fragments now write canonical `depth32float` plus the stable object ID under `depthCompare: less`; alpha-cutout pixels own neither. Static and dynamic share one depth lane, foreground retains its explicit lane, and explicit fine bias is data-driven. Real-WebGPU CI reads depth/object-ID buffers for two-bin overlap, reversed submission order, transparent holes, the eight light angles and ±0.25/0.5/1-pixel perturbations. Object-ID and depth debug views are executable. Normal game presentation still remains WebGL2 pending later full-frame/backend-promotion gates.

The root/foot authority and per-pixel ownership representation are therefore implemented prerequisites for the shared depth hierarchy and later clustering/DSO work. Downstream systems must consume the resolved SM-202 ownership field rather than treating G2.R local height as ownership depth.

Historical context in `RAG_REFERENCE_STEELMOTH.md` remains useful for intent and provenance, but source-level implementation claims should defer to the imported code, its validation records, the SM-004 audit, implemented subsystem contracts, and current verification reports.
