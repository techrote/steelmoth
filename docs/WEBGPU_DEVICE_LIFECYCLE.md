# WebGPU device lifecycle and staged backend policy

Status: **SM-102 implementation contract**

This document defines the production device/context boundary introduced before Steel Moth has a WebGPU renderer. It deliberately separates **WebGPU platform readiness** from **frame presentation** so device work can be validated without pretending Material-v2 or full-frame WebGPU rendering already exists.

## Staged backend policy

The user-facing selector exposes three requested modes:

- `Auto`
- `WebGPU (device test)`
- `WebGL2`

During migration, `Auto` resolves to WebGL2. `engine/webgpu_device.js` keeps `AUTO_WEBGPU_ENABLED=false` and reports the policy as `webgl2-until-sm505`. Only SM-505 may promote ordinary `Auto` startup to WebGPU-first after the programme release gates are satisfied.

Explicit `WebGPU` is a development/migration selection. In SM-102 it initializes the WebGPU adapter/device/canvas-context platform layer on a dedicated probe canvas while the accepted v1.2.x WebGL2 renderer continues to present the game frame. Diagnostics therefore distinguish:

- `requestedBackend`
- `activeBackend`
- `presentationBackend`

A successful explicit WebGPU selection reports `activeBackend=webgpu` and `presentationBackend=webgl2`. This is not a claim that the game frame is already rendered through WebGPU. Later SM-103/SM-200+ work will consume the initialized platform layer.

Explicit `WebGL2` never requests a WebGPU adapter. `Auto` also does not request a WebGPU adapter while the SM-505 gate remains closed.

## Device and context lifecycle

`engine/webgpu_device.js` owns:

1. `navigator.gpu` capability detection;
2. `requestAdapter()` with the configured power preference;
3. adapter feature, limit and adapter-info inventory where exposed;
4. negotiation of only desired optional features that the selected adapter actually exposes (currently `timestamp-query`);
5. `requestDevice()` using that negotiated feature set;
6. `GPUDevice.uncapturederror` collection;
7. `GPUDevice.lost` observation;
8. preferred canvas format discovery;
9. `GPUCanvasContext.configure()` under a validation error scope;
10. resize-driven reconfiguration;
11. `unconfigure()` / `device.destroy()` cleanup where supported.

No WebGPU render pipeline, Material-v2 resource, G-buffer or WGSL shader is introduced by SM-102.

The platform probe canvas is intentionally separate from the accepted WebGL2 presentation canvas. A browser canvas cannot safely be treated as both an already-created WebGL2 context and the future WebGPU presentation context. Later renderer integration must transfer presentation ownership deliberately rather than corrupting the fallback canvas during device probing.

## Failure isolation

Initialization failure never mutates gameplay/save authority and never destroys the existing WebGL2 renderer. The runtime retains the requested mode for diagnostics, records the failure, changes the active backend to WebGL2 and continues WebGL2 presentation.

Failure paths include:

- missing `navigator.gpu`;
- null adapter;
- device-request failure;
- missing WebGPU canvas context;
- canvas-configure validation failure;
- explicit deterministic failure injection in local/render-test development URLs;
- device loss after successful initialization.

`webgpuFail=<stage>` is honored only for localhost, explicit `devWebGPU=1`, or deterministic `renderTest=1` URLs. It is ignored on ordinary remote gameplay URLs.

`uncapturederror` is retained as diagnostic evidence. Device loss causes the staged backend runtime to fall back to WebGL2 immediately; automatic WebGPU device recreation is intentionally not invented in this issue because later resource/pipeline ownership must define safe recreation semantics.

## Diagnostics

`window.engineDiagnostics()` / F10 diagnostics gain a `backend` record after the runtime attaches to the game. The record contains:

- requested, active and presentation backend;
- selection source (`default`, persisted storage, URL or UI);
- current staged policy and `AUTO_WEBGPU_ENABLED` state;
- fallback reason and most recent platform error;
- adapter information where exposed;
- adapter feature inventory;
- selected optional features;
- adapter limits;
- preferred canvas format;
- configured canvas dimensions/DPR;
- configure and resize counts;
- device-loss record;
- bounded uncaptured-error history.

The graphics menu receives a migration-backend selector plus a status line. Selection persists through local storage except URL test overrides.

## Verification

Repository verification adds three evidence layers:

1. `node tools/validate_webgpu_lifecycle.js` — deterministic fake-adapter/device/context tests covering capability inventory, optional-feature negotiation, validation scopes, configure/reconfigure, uncaptured errors, device loss, staged Auto policy, deliberate initialization failures, and WebGL2 fallback.
2. `python tools/validate_webgpu_contract.py` — source/offline/documentation wiring and SM-505 gate assertions.
3. `python tools/validate_webgpu_browser.py` — hosted Chrome/Chromium smoke of the actual browser API surface when available, plus deliberate-failure and staged-Auto assertions. If the hosted browser exposes no usable WebGPU adapter, that absence is recorded and WebGL2 fallback remains the correct result.

Hosted browser results are API/fallback correctness evidence only. They are not GTX 1650 Super capability, driver, Firefox-target, visual-parity, or performance evidence. Real Chrome/Firefox target-hardware capability remains part of the later hardware/cross-browser programme gates.
