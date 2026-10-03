# SM-505 WebGPU release validation

Date: 2026-10-03  
Issue: #50 / SM-505  
Evaluated source: `19cca285fe7a3ae902626aa2e54c534dff5603ce`

## Disposition

**BLOCKED — do not promote `Auto`.**

SM-405 functional parity and SM-501 target-hardware performance are complete, but the normal application still has no WebGPU presentation consumer. A successful explicit WebGPU backend selection currently acquires a WebGPU device/resource stack while ordinary game frames are still replayed and presented by the WebGL2 compatibility renderer. The retained physical campaigns deliberately did not claim final normal-game WebGPU canvas/presentation ownership.

A second independent release blocker exists in deployment identity: the live service worker uses `small-machine-web-v1.2.3-r26`, while `DEPLOYMENT_MANIFEST.json`, `DEPLOY.md`, and `README_WEBAPP.md` still advertise `small-machine-web-v1.2.3-r1`. This mismatch must be reconciled in the actual release candidate together with the renderer asset/cache revision.

No physical-GPU run was performed during this review. `AUTO_WEBGPU_ENABLED` remains false.

## Gate reconciliation

| SM-505 criterion | Disposition | Evidence |
| --- | --- | --- |
| 1. SM-405 functional parity | PASS | #29 closed by PR #90. GTX 1650 SUPER Windows Chrome/Firefox target-hardware matrix passed 23/23 pages and Gates A-E. The SM-405 report explicitly states normal presentation remains WebGL2 until SM-505. |
| 2. SM-500/501 target performance | PASS for the accepted initial-release core | #31 closed by PR #92. Reconciled source `2e4d490f7af21a4b21a1e8e3e8c392e03968dfc4` passed all eight Chrome scenes and Firefox representative with Medium, native 1920x1080, DPR 1 and GTAO off. See `PERFORMANCE_REPORT_WEBGPU_PRIMARY.md`. |
| 3. No release-blocking renderer defect | **FAIL** | `engine/webgl2_scene_adapter.js` unconditionally consumes captured normal-game RenderScene frames through WebGL2; `engine/backend_runtime.js` reports WebGPU active but `presentationBackend=webgl2`. There is no normal-game WebGPU presentation consumer. |
| 4. Runnable WebGL2 fallback | PASS | Existing WebGL2 compatibility path remains the live presentation path. Current-main hosted WebGL2 root-transform pixel parity is green. |
| 5. Static/PWA cache and asset identity | **FAIL** | `sw.js` is cache revision r26 while deployment manifest/docs still declare r1. A release candidate must atomically bump/reconcile cache identity and include its final renderer assets. |
| 6. Clean package/build/extraction/retest | PASS for current pre-promotion main; must rerun on candidate | Current-main `clean source package + extraction` check passed on 2026-10-03. Any renderer/presentation/cache candidate changes require the exact candidate to rerun this gate. |
| 7. Deterministic/cross-browser correctness | PASS for staged renderer; **not established for promoted normal presentation** | SM-405 and current hosted WebGPU suites are green, but they validate staged/offscreen and dedicated test paths. They do not prove the not-yet-implemented normal application presentation cutover. |
| 8. Evidence sufficient to promote `Auto` | **FAIL** | The promoted behavior does not yet exist and therefore cannot have source-identical physical presentation evidence. |

## Source-identity review after SM-501

The accepted SM-501 reconciliation source is `2e4d490f7af21a4b21a1e8e3e8c392e03968dfc4`. Subsequent work does not invalidate its initial-release core GPU timing result:

- PR #109 repairs SM-500 explicit command-query diagnostic alignment in `engine/webgpu_performance.js`; renderer shaders, quality settings and SM-501 queue-span workload are unchanged.
- PR #110 changes GTAO diagnostic/readback behavior and the campaign harness for SM-601. GTAO is deliberately disabled and excluded from the SM-501 initial-release scope.
- PR #111 is documentation-only.

The benchmark harness is therefore not byte-identical to the measured source, but the accepted Medium/GTAO-off renderer kernels and quality configuration remain the relevant retained performance authority. That is sufficient to preserve the SM-501 result; it is **not** sufficient to certify a normal-game WebGPU presentation path that does not exist at the measured source.

## Exact missing evidence

Before #50 can close:

1. Implement a bounded normal-game WebGPU presentation consumer for the existing backend-neutral RenderScene boundary, preserving the accepted M0-M5 modules/settings and WebGL2 fallback.
2. Prove the normal application in `Auto` selects and **presents through WebGPU**, rather than only acquiring a WebGPU device while replaying through WebGL2.
3. On the exact candidate source, run physical GTX 1650 SUPER Chrome and Firefox normal-application presentation/fallback acceptance with fresh profiles where practical. Retain adapter identity, screenshots/captures, diagnostics showing `presentationBackend=webgpu`, and explicit fallback evidence.
4. Perform a candidate source/configuration identity audit against the accepted SM-501 GPU command path. If integration changes the measured GPU command stream, quality configuration, resource formats, or queue-span behavior, rerun the full SM-501 three-session/eight-scene physical timing campaign. If those are demonstrably unchanged, retain the existing SM-501 timing dataset and record the equivalence rather than rerunning merely for freshness.
5. Reconcile PWA/static asset identity (service-worker cache revision, deployment manifest/docs and final renderer asset query/cache identity), then rerun clean package/extract/retest and required hosted suites on that exact candidate.

Items 2-3 require new physical target-hardware evidence that cannot be inferred from the retained staged/offscreen record. Under the current no-physical-GPU constraint, SM-505 must stop here.

## Current-main hosted verification

At `19cca285fe7a3ae902626aa2e54c534dff5603ce`, all five current hosted check runs are green:

- source + deterministic regression;
- GLSL + MRT software validation;
- clean source package + extraction;
- WebGL2 root-transform browser pixel parity;
- WebGPU lifecycle/resources/WGSL/representation/lighting/shadow and inherited browser validation.

These checks are admissible non-physical correctness/package evidence. They do not substitute for the missing target-machine normal-presentation evidence.

## Scope exclusions

SM-602 and later SSGI/volumetric fidelity work are not release blockers for this initial WebGPU-primary gate. GTAO remains outside the accepted SM-501 initial-release timing scope. No work on #37 was started by this checkpoint.
