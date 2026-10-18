# Steel Moth

Steel Moth is the browser game and engine codebase for **The Small Machine at the Edge of Night**. The shipped gameplay path is a v1.2.3 WebGL2/Material-v2 compatibility renderer; development is adding a raw WebGPU/WGSL renderer with per-pixel ownership, deeper occlusion and bounded lighting effects.

## Current status (18 October 2026)

**46 of 50 task issues are closed; the WebGPU-primary release has not yet passed its final gate.** The authoritative [programme tracker is #51](https://github.com/techrote/steelmoth/issues/51); see the [dated project-state audit](docs/PROJECT_STATUS_2026-10-18.md) and [live issue map](docs/ISSUE_MAP.md). The repository's latest reviewed `main` is `f0813d0` (merged [PR #115](https://github.com/techrote/steelmoth/pull/115)).

- **Normal gameplay:** `Auto` uses **WebGL2**. `AUTO_WEBGPU_ENABLED` remains `false`. Explicit WebGPU device selection initializes a platform/test stack, but normal game frames still present through the WebGL2 `RenderSceneBridge`. Do not mistake staged WebGPU smoke tests for a WebGPU-presented playable application.
- **Implemented and merged:** M0–M4 baseline, platform, Material-v2 ownership/depth, lighting/DSO/Dark Bloom, procedural/editor integration and staged cross-browser functional qualification; SM-500–504 instrumentation, quality and colour/material/culling foundations; M6 GTAO/SSGI; SM-702 optional forward lighting; SM-800/801/803 studies and soak coverage.
- **Physically qualified:** SM-501's native GTX 1650 SUPER Medium, 1080p, DPR 1, **GTAO-off** staged core met the ≤12 ms mean/≤14.5 ms p95 GPU queue-span targets across eight Chrome scenes with a Firefox representative. Its worst observed scene mean/p95 were 6.411803/8.190048 ms. This is *not* measured normal-game WebGPU presentation or a combined all-effects budget.
- **Optional effects:** SM-601 GTAO met its retained Medium working budget (1.088006 ms queue mean, worst run p95 1.288608 ms). SM-603 SSGI and SM-702 canonical forward water/large-foliage/tagged-glass lighting have bounded native evidence but remain **off by default**; their isolated pass costs are not whole-frame measurements.

Four tasks remain: [SM-505 / #50](https://github.com/techrote/steelmoth/issues/50) (normal-game WebGPU presentation and release acceptance), [SM-700 / #39](https://github.com/techrote/steelmoth/issues/39) and [SM-701 / #40](https://github.com/techrote/steelmoth/issues/40) (budgeted volumetric scattering), and [SM-802 / #44](https://github.com/techrote/steelmoth/issues/44) (late adaptive quality). Five older/study PRs remain open; none is an accepted substitute for the merged production state. See the [full PR reconciliation](docs/PROJECT_STATUS_2026-10-18.md#open-pull-requests--not-accepted-mainline).

## Run the game and inspect the renderer

This is a static web application: serve the repository root over HTTP(S), then open `index.html`. The included `0Play-Webapp-v1.2.3.bat` is the historical Windows launcher; [DEPLOY.md](DEPLOY.md) describes static hosting and caching. The game does not require a server-side application or a JavaScript bundler.

`render-test.html` provides deterministic fixtures/capture metadata for renderer regression work. Dedicated `webgpu-*-smoke.html`, `webgpu-target-benchmark.html` and diagnostic pages exercise the staged WebGPU passes. Their output is validation/benchmark evidence, **not** the ordinary game presentation path. See [RENDER_CAPTURE_HARNESS.md](docs/RENDER_CAPTURE_HARNESS.md), [VISUAL_FIXTURE_CATALOG.md](docs/VISUAL_FIXTURE_CATALOG.md) and [CI_AND_VERIFICATION.md](docs/CI_AND_VERIFICATION.md).

## Verification

Install the Python test dependencies (Node.js is also needed for JavaScript checks):

```sh
python -m pip install -r tools/requirements-ci.txt
python tools/run_checks.py
python tools/validate_clean_package.py --report artifacts/clean-package.json
```

The hosted verification workflow also runs software GLSL/MRT, browser and WebGPU tests. Use [CI_AND_VERIFICATION.md](docs/CI_AND_VERIFICATION.md) for the complete gate and hardware requirements. A hosted check or descriptor-based memory estimate does not establish GTX 1650 SUPER frame timing, human visual parity, normal-game WebGPU presentation or resident VRAM.

## Architecture and performance policy

- **Raw WebGPU/WGSL**, with WebGL2 retained as the v1.2.x compatibility fallback. No substitute game/rendering framework or converted polygonal-sprite assets.
- One backend-neutral `RenderScene`, shared sprite root/foot authority, Material-v2 G-buffer, canonical pseudo-depth and object ownership, reusable depth hierarchy and light buffer.
- Clustered occluders, Deep Silhouette Occlusion (DSO), dominant ownership, Dark Bloom, local/contact visibility, then GTAO and optional diffuse SSGI; later subtle flashlight volumetrics.
- Keep pixel-art albedo sharp, gameplay/editor state authoritative, temporal/resource ownership explicit, and secondary effect resolution/sample counts bounded.
- Primary acceptance machine: **GTX 1650 SUPER 4 GB, native 1920×1080, 60 FPS**. Whole staged-core GPU target: mean ≤12 ms, p95 ≤14.5 ms. Qualify each materially different render workload on its own evidence.

The v1.2.3 baseline itself was recovered verbatim from a verified archive (SHA-256 `2399a50d08785211470a2af86bf693bff71f5d622d717432a595295a23208727`) and imported by [PR #52](https://github.com/techrote/steelmoth/pull/52). Its WebGL2 G2.R stores **local material pseudo-height**, not the later WebGPU per-fragment ownership depth. Provenance and audit: [BASELINE_V123_PROVENANCE.md](docs/BASELINE_V123_PROVENANCE.md), [BASELINE_V123_AUDIT.md](docs/BASELINE_V123_AUDIT.md).

## Documentation and continuation

The **50 task issues** span M0–M8, with [#51](https://github.com/techrote/steelmoth/issues/51) tracking the overall programme. Work should follow issue dependencies, not issue-number order.

1. [AGENTS.md](AGENTS.md) — issue/PR workflow, evidence rules and stop conditions.
2. [docs/INDEX.md](docs/INDEX.md) — canonical documentation authority and subsystem index.
3. [docs/PROJECT_STATUS_2026-10-18.md](docs/PROJECT_STATUS_2026-10-18.md) — issue/PR reconciliation, physical evidence, outstanding gates and current state.
4. [docs/MASTER_WEBGPU_PROGRAMME.md](docs/MASTER_WEBGPU_PROGRAMME.md) — original 50-task architecture and acceptance programme.
5. [docs/DEPENDENCY_AND_CONCURRENCY.md](docs/DEPENDENCY_AND_CONCURRENCY.md) — serialization, parallel lanes and blockers.
6. [docs/WEBGPU_RELEASE_VALIDATION.md](docs/WEBGPU_RELEASE_VALIDATION.md) — SM-505 release qualification, including historical and current status.
7. [docs/EXECUTION_LEDGER.md](docs/EXECUTION_LEDGER.md) — chronological, source-separated implementation and review checkpoints.

**Release rule:** [SM-505 / #50](https://github.com/techrote/steelmoth/issues/50) alone may promote `Auto` to WebGPU. A normal-game WebGPU presentation consumer, exact-candidate physical Chrome/Firefox presentation/fallback evidence, source/timing equivalence or repeated performance campaign, deployed PWA/cache validation and clean-package checks are still required. The repository's source cache declarations have been reconciled to `small-machine-web-v1.2.3-r29` by PR #115; deployment acceptance is not implied.
