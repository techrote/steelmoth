# Project status — 18 October 2026

This is a dated reconciliation of live GitHub issue/PR state, merged source and accepted evidence. It is not a new release acceptance, performance campaign or deployed-site test.

- Repository: [techrote/steelmoth](https://github.com/techrote/steelmoth)
- Examined `main`: `f0813d06946970c33ccbd7c5ac6e95f84c8dbdc4` (merge of [PR #115](https://github.com/techrote/steelmoth/pull/115), 4 October 2026).
- Programme authority: [issue #51](https://github.com/techrote/steelmoth/issues/51); task definitions: [MASTER_WEBGPU_PROGRAMME.md](MASTER_WEBGPU_PROGRAMME.md); status map: [ISSUE_MAP.md](ISSUE_MAP.md).
- **46/50 task issues closed; four remain open.** #51 is a separate open programme tracker.
- **Five PRs are open**, none merged. See the distinction between retained studies and accepted mainline below.

## Milestone position

| Milestone | Closed / total | Status |
| --- | ---: | --- |
| M0 — baseline, fixtures, CI | 6 / 6 | Complete |
| M1 — WebGPU platform | 5 / 5 | Complete |
| M2 — material, ownership, frame parity | 8 / 8 | Complete |
| M3 — DSO, clustering, shadow composition | 8 / 8 | Complete |
| M4 — water/foliage/editor, functional gate | 6 / 6 | Complete |
| M5 — performance, foundation, release | 5 / 6 | SM-505 release gate open |
| M6 — GTAO and SSGI | 4 / 4 | Complete; SSGI is optional/off by default |
| M7 — volumetric and forward lighting | 1 / 3 | Forward lighting complete; volumetrics open |
| M8 — optimization and quality control | 3 / 4 | Adaptive controller deferred |
| **Total** | **46 / 50** | **Initial WebGPU-primary release not accepted** |

“Complete” means the task was closed following its issue-specific accepted evidence and merged work, not that a WebGPU-first playable release exists.

## What actually runs

Normal gameplay at `index.html` uses the WebGL2 compatibility presentation path in `Auto`. The backend policy in `engine/webgpu_device.js` still has `AUTO_WEBGPU_ENABLED=false`. Explicit `WebGPU` selection can initialize the device and persistent GPU infrastructure, but `engine/backend_runtime.js` continues to report `presentationBackend=webgl2`. The live `RenderSceneBridge` continues to replay through `WebGL2SceneAdapter`. Staged WebGPU render/test passes are genuine and independently validated; they are **not** proof that normal gameplay is presented by WebGPU.

The merged staged renderer includes Material-v2 G-buffer and alpha-cutout per-pixel object/depth ownership, a shared depth hierarchy, canonical deferred lighting, height self/contact shadows, clustering, DSO, Dark Bloom, composited visibility, water/foliage/effect ordering, editor and transition invalidation, quality policy, GTAO, optional SSGI, and optional canonical forward water/large-foliage/tagged diffuse-glass lighting. Gameplay and WebGL2 fallback remain separate from this staged qualification.

## Accepted evidence and limits

| Task | Accepted outcome | Boundary |
| --- | --- | --- |
| [SM-405 #29](https://github.com/techrote/steelmoth/issues/29) / [PR #90](https://github.com/techrote/steelmoth/pull/90) | Physical Chrome/Firefox functional matrix (23/23 pages), Gates A–E accepted | Staged/dedicated rendering; not live WebGPU game presentation |
| [SM-501 #31](https://github.com/techrote/steelmoth/issues/31) / [PR #92](https://github.com/techrote/steelmoth/pull/92) | Three fresh GTX 1650 SUPER Chrome runs across eight scenes, plus Firefox representative; worst scene mean 6.411803 ms, worst p95 8.190048 ms, against ≤12/≤14.5 ms | Native 1080p, DPR 1, Medium, **GTAO off**, staged GPU queue span, measured source `2e4d490...`; not whole live-app presentation |
| [SM-601 #36](https://github.com/techrote/steelmoth/issues/36) / [PR #110](https://github.com/techrote/steelmoth/pull/110) | Adopted deferred GTAO telemetry + counter aggregation; retained GTX1650S Medium queue mean 1.088006 ms / worst run p95 1.288608 ms | Separate measured path, not an arithmetic/cache speedup or a combined-frame budget; [full report](SM601_MEASURED_ADOPTION.md) |
| [SM-603 #38](https://github.com/techrote/steelmoth/issues/38) / [PR #114](https://github.com/techrote/steelmoth/pull/114) | Stabilized donor history; physical SSGI pass mean 2.379–3.337 ms across source-matched tier/scene runs | Optional/off; excludes upstream and full-frame costs; [full report](SM603_STABILIZATION_REPORT.md) |
| [SM-702 #41](https://github.com/techrote/steelmoth/issues/41) / [PR #115](https://github.com/techrote/steelmoth/pull/115) | Native forward-lighting mean overhead 0.088–0.104 ms representative, 2.969–3.036 ms stress | Optional/off; excludes shared opaque/DSO/GTAO/SSGI work and whole-frame headroom; [full report](SM702_FORWARD_LIGHTING_REPORT.md) |
| [SM-800 #42](https://github.com/techrote/steelmoth/issues/42) / [PR #103](https://github.com/techrote/steelmoth/pull/103) | Two reduced-format alternatives rejected after physical study | Production G1/G2/HDR formats unchanged |
| [SM-801 #43](https://github.com/techrote/steelmoth/issues/43) / [PR #98](https://github.com/techrote/steelmoth/pull/98) | Render-bundle static-submission adoption rejected by measured A/B | Current submission architecture retained |

For baseline WebGL2 numbers, see [WEBGL2_BASELINE_PERFORMANCE.md](WEBGL2_BASELINE_PERFORMANCE.md). Timestamp queue spans, command-span decomposition, callback wall time, descriptor-estimated memory and physically resident VRAM are different quantities. Do not pool isolated pass campaigns or describe them as measured full-frame performance. The accepted initial-release core's GTAO-off performance is not the same as a complete GTAO+SSGI+forward+volumetric configuration.

## Open tasks and dependency order

- **[SM-505 / #50](https://github.com/techrote/steelmoth/issues/50) — blocked release gate.** Implement the normal-game WebGPU `RenderScene` presentation consumer; then qualify `Auto` WebGPU selection/presentation and WebGL2 fallback on the exact candidate with native GTX1650S Chrome/Firefox evidence. Perform GPU-command/source-equivalence review against SM-501; rerun its full campaign if command stream, settings, formats or timing semantics changed. Finish static/PWA deployment identity checks and clean extraction before promotion. See [WEBGPU_RELEASE_VALIDATION.md](WEBGPU_RELEASE_VALIDATION.md).
- **[SM-700 / #39](https://github.com/techrote/steelmoth/issues/39) — pending.** The SM-603 dependency has merged. Establish the *remaining current total Medium frame budget* before the bounded flashlight-scattering prototype; isolated SSGI and forward timings do not establish available headroom.
- **[SM-701 / #40](https://github.com/techrote/steelmoth/issues/40) — downstream of SM-700.** Only then stabilize occlusion, temporal rejection, explicit tiers and native cost.
- **[SM-802 / #44](https://github.com/techrote/steelmoth/issues/44) — deferred.** An opt-in slow quality controller depends on reliable SM-500 timing plus stable SM-501, SM-603 and SM-701 effect tiers. It must not conceal an over-budget static configuration.

M6/M7 fidelity work is not an automatic blocker for the initial M5 WebGPU-primary release; #50 may proceed separately without claiming later effects are production defaults.

## Open pull requests — not accepted mainline

| PR | Nature | Status at reconciliation |
| --- | --- | --- |
| [#101](https://github.com/techrote/steelmoth/pull/101) | Coordinated physical-campaign execution packet | Open, non-draft; non-canonical planning artifact |
| [#102](https://github.com/techrote/steelmoth/pull/102) | Older physical GTAO evidence, pre-adoption performance result | Open, non-draft; superseded for final #36 acceptance by #110/#111 |
| [#104](https://github.com/techrote/steelmoth/pull/104) | Isolated GPU-free counter study | Open draft; study-only |
| [#105](https://github.com/techrote/steelmoth/pull/105) | Deferred-readback A/B study | Open draft; study-only |
| [#106](https://github.com/techrote/steelmoth/pull/106) | Arithmetic/cache probe and negative witnesses | Open draft; **no arithmetic/cache candidate adopted** |

These PRs must not be counted as merged implementation, must not override the completed #36 evidence and must not be merged wholesale into the currently accepted production path. Reconcile/close superseded studies separately if desired; their open state does not reopen completed issue #36.

## Release identity and next verification

[PR #112](https://github.com/techrote/steelmoth/pull/112) recorded an October 3 SM-505 checkpoint when the service worker was `r26` while deployment documentation said `r1`. That **historical mismatch is repaired in repository source** by [PR #115](https://github.com/techrote/steelmoth/pull/115): `sw.js`, `DEPLOYMENT_MANIFEST.json`, `DEPLOY.md` and `README_WEBAPP.md` now consistently identify `small-machine-web-v1.2.3-r29`. This is not proof that a particular deployed origin, live service worker, profile, or old cache has migrated correctly. Exact-candidate deployment/PWA testing remains outstanding.

The Oct 4 #115 merge is the most recent `main` change found in this review. Its recorded hosted checks passed at the PR head; **no new hardware, live-deployment or post-documentation CI pass is claimed here**. Re-run appropriate automation on the documentation PR and full acceptance on any future SM-505 code candidate.
