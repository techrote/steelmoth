# WebGPU API validation contract

Status: **SM-104 implementation contract**

This document defines the executable WebGPU correctness gate introduced after SM-102 device lifecycle and SM-103 resource/frame infrastructure. It supplements `WEBGPU_VALIDATION_PLAN.md` §§2–4; it does not replace later representation, visual, cross-browser, or performance gates.

## Production inventory

`engine/webgpu_validation.js` owns a versioned machine-readable inventory (`steelmoth-webgpu-validation/v1`). Every WGSL module, entry point, pipeline descriptor, and current core/fallback resource layout that belongs to the WebGPU implementation must be registered here or in a later inventory extension consumed by the same suite.

At SM-104 the renderer has not yet reached the Material-v2 G-buffer implementation. Consequently the current WGSL inventory is intentionally small and contains only two infrastructure readiness pipelines:

- `infrastructure-render-probe`: vertex `vs_main` + fragment `fs_main`, targeting the adapter's preferred canvas format;
- `infrastructure-compute-probe`: compute `cs_main` with a one-thread workgroup.

These are real WebGPU pipelines used to validate the production pipeline/resource infrastructure. They are not visual-parity implementations and must not be described as G-buffer, lighting, shadow, or post-processing passes. SM-200 and later WebGPU issues must extend the inventory as their production shaders and descriptors land.

Current resource profiles include the preferred render-target format, an explicit `rgba8unorm` fallback target, an atlas-upload destination, a frame-uniform buffer, and instance/storage buffer. The suite also exercises SM-103 resize-dependent versus fixed-resource recreation through the real `ResourceRegistry`.

## Compilation information

For every registered WGSL module the validation suite:

1. creates a labelled `GPUShaderModule` under a `validation` error scope;
2. calls `getCompilationInfo()` when the implementation exposes it;
3. records every compiler message with type/message/line/position/offset/length;
4. fails on any compilation message of type `error`;
5. records warnings without suppressing them;
6. records whether compilation-info retrieval was available.

The required hosted WebGPU job treats missing `getCompilationInfo()` as a failure because the tested Chrome environment is expected to expose it. A different local/browser environment may instead record the capability as impossible/unavailable; it must not silently report the check as executed.

## Validation scopes and pipeline execution

Pipeline creation is wrapped in `GPUDevice.pushErrorScope('validation')` / `popErrorScope()`. Render and compute pipelines prefer their asynchronous creation APIs when available and fall back to synchronous creation only when necessary. Errors include the registered pipeline label so reports identify the failed object rather than only reporting a generic browser error.

The suite does not stop at object creation. It creates a real render attachment, records one draw with the registered render pipeline, records one compute dispatch with the registered compute pipeline, submits the command buffer, and waits for submitted work when supported.

A deliberate invalid buffer descriptor (`usage: 0`) is also created inside a labelled validation scope. The test passes only when the invalid operation is observed either as the scoped `GPUError` expected by WebGPU or as an immediate implementation exception. The normal suite treats any *unexpected* scoped validation error as fatal.

## Atlas upload

The browser harness builds a deterministic 2×2 canvas and uploads it with `GPUQueue.copyExternalImageToTexture()` into the registered `rgba8unorm` atlas destination (`COPY_DST | TEXTURE_BINDING`). The exact destination descriptor is retained in the machine-readable report. Failure or absence of this path fails a required WebGPU run rather than being inferred from unrelated texture creation.

Future Material-v2 atlas/resource work must extend this check with its exact production descriptors rather than creating a parallel untracked upload convention.

## Optional-feature absence

SM-102 permits `timestamp-query` only when the adapter advertises it. SM-104 therefore validates both policy branches without making the optional feature mandatory:

- the primary manager records adapter features and negotiates its normal optional-feature set;
- a second real device is requested with `desiredFeatures: []`;
- the report asserts that the second device requested no optional features and still initializes successfully.

This proves that the current core resource/pipeline gate does not accidentally acquire a `timestamp-query` dependency. Target-hardware availability of that feature remains an empirical SM-003/SM-500 concern.

## Device loss

The browser harness creates a separate explicit-WebGPU `BackendRuntime`, reaches the `ready-platform` state, destroys that device, waits for `GPUDevice.lost`, and requires the runtime to transition to `fallback-device-lost` with both active and presentation backends set to WebGL2. Gameplay-authoritative sentinel state is snapshotted around the operation and must remain unchanged.

Destroying a device is a deterministic test mechanism; it is not a claim about the frequency or cause of spontaneous target-hardware device loss.

## WebGL2 fallback

A second failure-path runtime injects a deliberate device-acquisition failure through the SM-102 failure hook. Acceptance requires:

- status `fallback`;
- active backend `webgl2`;
- presentation backend `webgl2`;
- a non-empty diagnostic reason;
- unchanged gameplay-authoritative sentinel state;
- a usable WebGL2 compatibility context on the hosted browser.

This directly guards against a failed WebGPU platform probe leaving an unexplained black presentation path.

## Machine-readable report

The browser runner writes `steelmoth-webgpu-validation-browser-report/v1`. The nested live suite writes `steelmoth-webgpu-validation-report/v1`. Reports retain:

- browser product/version and user agent;
- adapter/device diagnostics, advertised features/limits, requested optional features, and preferred canvas format;
- complete shader/entry-point inventory and compilation messages;
- pipeline kind/format/creation path;
- resource profile/descriptors and resize diagnostics;
- atlas-upload result;
- deliberate validation result and object label;
- optional-feature-absence result;
- initialization-fallback and device-loss results;
- explicit not-executed/limitation records.

`render-tests/webgpu-validation-report.sample.json` is schema documentation only and is marked `sampleOnly: true`; it is not evidence that a browser or GPU passed.

## Local and CI execution

Fast deterministic source checks:

```text
node tools/validate_webgpu_validation.js
python tools/validate_webgpu_validation_contract.py
```

Hosted Chromium real-WebGPU validation:

```text
python tools/validate_webgpu_validation_browser.py --require-webgpu --report artifacts/webgpu-validation-browser.json
```

Without `--require-webgpu`, a browser that cannot expose WebGPU may produce an explicit impossible/unavailable report instead of inventing a pass. CI uses `--require-webgpu` because the existing hosted Chrome/SwiftShader lane has already demonstrated real WebGPU device/resource execution in SM-103.

## Firefox

The validation page itself is standards-based and browser-neutral. The current GitHub-hosted automation collector uses Chromium DevTools Protocol and therefore records Firefox as **not executed** rather than claiming cross-browser coverage. Firefox target-hardware execution remains required by `WEBGPU_VALIDATION_PLAN.md` and is owned by the later SM-405 cross-browser functional gate; SM-104 does not convert Chromium software-adapter evidence into a Firefox claim.

A local Firefox run can serve the repository over HTTP(S), open `webgpu-validation-smoke.html`, and retain the JSON from `#webgpuValidationResult`; until a Firefox automation transport is added, such a run must carry its browser/version/adapter metadata manually with the report.

## Evidence boundary

A passing SM-104 hosted run proves API/WGSL/pipeline/resource/failure-path correctness for the exact reported browser and adapter. It does **not** prove:

- visual parity or image quality;
- final G-buffer/material semantics that do not exist yet;
- GTX 1650 Super compatibility or performance;
- Firefox compatibility;
- VRAM residency or renderer GPU timing;
- future shader/resource entries that have not yet been added to the inventory.

Later WebGPU implementation issues are responsible for extending this suite as production shaders, formats, and pass layouts become real. Gate A in `WEBGPU_VALIDATION_PLAN.md` is not permanently satisfied by SM-104 alone; it remains a growing release gate over the complete final inventory.
