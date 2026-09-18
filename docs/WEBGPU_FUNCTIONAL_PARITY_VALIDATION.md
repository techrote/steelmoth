# SM-405 WebGPU functional parity validation

SM-405 is the functional/cross-browser gate after the M0–M4 renderer work. It consolidates the already-merged production smoke/readback contracts into one Windows Chrome + Firefox execution matrix. It does **not** promote `Auto`, does not set release performance policy, and does not substitute hosted software/virtual adapters for GTX 1650 Super performance evidence. `Auto` remains WebGL2-first until SM-505.

## Evidence boundary

The dedicated SM-405 job is accepted only when both Chrome and Firefox execute the complete matrix and the direct probe proves a real `GPUAdapter`/`GPUDevice`, WGSL pipeline creation, queue submission, deterministic compute readback, canvas submission, a captured validation error, and an available WebGL2 fallback context. The Firefox hosted-CI profile explicitly enables WebGPU and ignores the hosted machine's graphics blocklist; that makes the result useful browser-implementation functional evidence, but **not** physical-target support certification.

Hosted screenshots are retained for inspection, but no automated run is described as human visual sign-off. Likewise, no SM-405 result is GTX 1650 Super GPU timing, memory, driver-support, or 1080p/60 evidence. Those remain SM-500/501/505 concerns.

The authoritative machine-readable artifact is `artifacts/sm405/cross-browser-functional.json`; per-page screenshots are stored under `artifacts/sm405/screenshots/<browser>/`.

## Gate mapping

| Release-plan gate | SM-405 evidence |
| --- | --- |
| **Gate A — API correctness** | Direct cross-browser API probe, production lifecycle/fallback smoke, and SM-104 WGSL/resource/API validation. The direct probe requires real compute readback and a deliberate scoped validation error in each browser. |
| **Gate B — representation correctness** | Production Material-v2 G-buffer, object-ID/pseudo-depth ownership, and depth hierarchy browser readbacks. |
| **Gate C — functional/material/procedural parity** | G-buffer controls, deferred lighting, self/contact shadows, visibility composition, water, foliage/Fine Grass, transparent FX, post/output, and the explicit SM-402 ordering contract. |
| **Gate D — overlap/shadow architecture** | Occluder preparation, stable clusters, moving-light dominant ownership, hard DSO, near/mid/far hierarchy, Dark Bloom, temporal residual and bounded visibility composition. |
| **Gate E — editor/runtime integrity** | Temporal rejection, SM-402 ordering, SM-403 editor place/move/delete/undo/redo/save/reload ghost-state path, and SM-404 room/resize/backend/device invalidation. |

Gate F is deliberately not closed by SM-405: target-hardware performance and the final cross-browser target-machine release run remain SM-501/505 evidence.

## Fixture/control accounting

The recovered deterministic fixture catalog remains the authority for names and authored state. SM-405 does not invent substitute content. The required non-overlap controls are represented by `single-box`, `crate`, `barrel`, `cabinet`, `robot`, `pipe-bundle`, `water-material`, and `foliage-dense`. Their renderer semantics are covered by the production G-buffer/material, deferred-light, local-shadow, water and foliage browser gates; the inherited WebGL2 deterministic harness remains the compatibility reference for authored fixture state and non-overlap presentation.

The overlap set is `binsright`, `binsleft`, `binsupleft`, and `binsup`. The SM-300–307 browser gates validate the representation intent rather than reintroducing four independent full-strength shadow owners: stable cluster membership, deterministic dominant owner/hysteresis, one hard macro DSO mass, bounded near/mid/far secondary detail, subordinate Dark Bloom, temporal rejection, and bounded final visibility. The original `binsupleft` reference bytes remain historically unavailable as already recorded by the programme; the deterministic reconstructed fixture is not mislabeled as an original image.

SM-405 screenshots provide a browser-by-browser diagnostic record, not a new visual baseline. An actual browser result only counts when its structured result says `ok=true`; if a stage exposes a `realWebGPU` flag, the aggregate runner requires every exposed flag to be true.

## Browser matrix

The dedicated workflow runs on `windows-latest` and records browser/version/platform/user-agent plus adapter description/features/limits where exposed. Chrome uses its WebGPU test enablement flag so hosted runners can exercise the real implementation. Firefox uses its current WebGPU preference plus an explicit hosted-CI blocklist override; that override is recorded in the JSON evidence and must not be omitted from later support claims.

The same 23-page production matrix runs in both Chrome and Firefox:

1. direct API/compute/canvas/fallback probe;
2. lifecycle/fallback;
3. WGSL/resource validation;
4. G-buffer/material controls;
5. object ownership;
6. depth hierarchy;
7. deferred lighting;
8. local self/contact shadows;
9. occluder preparation;
10. cluster construction;
11. dominant-owner moving-light behaviour;
12. DSO hard core;
13. DSO distance hierarchy;
14. Dark Bloom;
15. Dark Bloom temporal stabilization;
16. visibility composition;
17. water;
18. foliage/Fine Grass;
19. transparent/effects;
20. post/output;
21. transparent/procedural ordering;
22. editor ghost-state integration;
23. room/resize/backend/device transition invalidation.

Any page failure, timeout, missing structured result, failed direct compute readback, missing WebGL2 fallback context, or exposed false `realWebGPU` flag makes the browser and aggregate job fail.

## Device loss, initialization failure, and fallback

The direct probe executes the production `WebGPUDeviceManager` deliberate adapter-failure path and requires it to fail closed. The inherited lifecycle and validation gates cover initialization failure/fallback and validation handling, while SM-404 covers backend/device transition invalidation. The fallback control is a real WebGL2 context in both browsers plus the retained WebGL2 regression/package gates. A black-canvas or uncaptured transition failure is a blocker, not an allowed warning.

## Acceptance record

The repository document is the durable protocol and evidence interpretation. The exact browser versions, adapter metadata, page outcomes, structured payloads and screenshot paths come from the successful SM-405 workflow artifact for the PR head. This section must not be converted into an optimistic pass statement before that workflow and the inherited repository Verification workflow are both green.

SM-405 changes validation infrastructure only. It does not change rendering algorithms, does not change gameplay, and does not change the `Auto` backend policy owned by SM-505.
