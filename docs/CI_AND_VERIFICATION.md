# CI and verification

Steel Moth uses one stable cross-platform verification runner plus focused package, GLSL and bounded browser jobs. The goal is to automate repository/source correctness without pretending hosted software rendering or hosted WebGPU exposure is target-hardware evidence.

## Local entrypoints

Install Python validation dependencies:

```text
python -m pip install -r tools/requirements-ci.txt
```

Node.js is required for JavaScript syntax/contract checks. Node 24 is the CI reference version.

Run the normal source + deterministic regression gate:

```text
python tools/run_checks.py
```

Equivalent explicit form:

```text
python tools/run_checks.py --group source --group regression
```

Write the same machine-readable report used by CI:

```text
python tools/run_checks.py --group source --group regression --report artifacts/core-checks.json
```

Run the Mesa/EGL GLSL + framebuffer gate when local EGL/OpenGL ES libraries are available:

```text
python tools/run_checks.py --group glsl --report artifacts/glsl-checks.json
```

On Linux CI this runs with `EGL_PLATFORM=surfaceless` and `LIBGL_ALWAYS_SOFTWARE=1`. Passing proves shader compile/link and framebuffer-format correctness in the tested Mesa software environment only. It is not GTX 1650 Super performance or browser-hardware evidence.

Validate a clean source ZIP/extraction:

```text
python tools/validate_clean_package.py --report artifacts/clean-package.json
```

The inherited v1.2.3 `SHA256SUMS.txt` remains provenance for the original release, but migration work intentionally changes runtime code. Clean-package validation therefore re-verifies only the imported immutable content subset—generated assets, game data, icons, the launcher and minimal static-host files—against historical hashes. Evolving engine/webapp/backend modules, manifests, documentation and tooling are validated by current source/regression/GLSL/package gates instead of being required to remain byte-identical to v1.2.3.

### SM-101 browser pixel-parity gate

When Chrome/Chromium is available, run:

```text
python tools/validate_render_transform_browser.py \
  --report artifacts/render-transform-browser.json \
  --out artifacts/render-transform-browser
```

This gate captures two representative deterministic fixtures (`box-pair` at 45° and `dense-mixed` at 225°) twice in each of two modes from the same checkout:

- **baseline-sm100** — test-only recreation of the immediately-pre-SM-101 SM-100 renderer boundary;
- **shared-sm101** — normal shared-transform integration.

For each case it requires both the canvas PNG SHA-256 and the headless-browser viewport screenshot SHA-256 to be deterministic and byte-identical before versus after SM-101. The test-only baseline mode is accepted only when `renderTest=1`; normal gameplay cannot select it. CI uploads the report and both sets of capture evidence.

This is strong before/after visual-regression evidence for the root/foot refactor in one controlled browser environment. It is **not** evidence of target-GPU timing, broad browser compatibility, or final human visual approval.

### SM-102 WebGPU lifecycle gate

The normal source/regression runner includes:

```text
node tools/validate_webgpu_lifecycle.js
python tools/validate_webgpu_contract.py
```

The deterministic JavaScript test uses fake adapter/device/context objects to exercise success and failure paths that cannot be induced reliably on hosted physical hardware: capability inventory, optional-feature negotiation, validation scopes, configure/reconfigure, uncaptured errors, device loss, deliberate initialization failure and fallback. It also asserts that `Auto` does not request a WebGPU adapter before SM-505.

When Chrome/Chromium is available, run the browser smoke:

```text
python tools/validate_webgpu_browser.py --report artifacts/webgpu-browser-smoke.json
```

The smoke loads the actual browser API entrypoint, asserts the staged `Auto → WebGL2` policy, exercises deliberate failure handling and, when `navigator.gpu` plus a usable adapter are exposed, performs real device/context configure + resize/reconfigure. A non-required local run may legitimately expose no usable WebGPU adapter; that absence is recorded rather than converted into a fabricated hardware claim.

### SM-103 WebGPU resource/frame infrastructure gate

The normal source/regression runner additionally includes:

```text
node tools/validate_webgpu_resources.js
python tools/validate_webgpu_resources_contract.py
```

The deterministic fake-device test verifies that named persistent resources survive ordinary frames, only resize-dependent textures rebuild on surface resize, all definitions rebuild on device reset, static and dynamic upload paths remain separate and bounded, dynamic arenas reuse one buffer across frames, frame-graph dependencies compile in stable order, missing/cyclic dependencies fail, every pass and pipeline creation uses validation error scopes, pipeline keys reuse cached objects, and diagnostics report dimensions/formats/estimated bytes/rebuild counts.

When Chrome/Chromium is available, run:

```text
python tools/validate_webgpu_resources_browser.py \
  --report artifacts/webgpu-resource-browser-smoke.json
```

If the browser exposes a usable WebGPU adapter, this smoke creates actual GPU textures/buffers, performs queue uploads, submits command buffers through scoped frame-graph passes, executes three frames, and performs two manager/registry resizes while asserting selective resource rebuilding. A non-required environment may record unavailable WebGPU explicitly.

### SM-104 WGSL/pipeline/resource/failure-path gate

The normal source/regression runner includes the deterministic validation-suite tests:

```text
node tools/validate_webgpu_validation.js
python tools/validate_webgpu_validation_contract.py
```

The Node test uses a fake device to prove the inventory/report contract, compiler-warning retention, core/fallback resource registration, atlas-copy path, pipeline submission path and deliberate validation capture. It then injects a WGSL compilation error and a pipeline validation error and requires both to fail with the registered shader/pipeline label in the exception/report context.

The real browser gate is:

```text
python tools/validate_webgpu_validation_browser.py \
  --require-webgpu \
  --report artifacts/webgpu-validation-browser.json
```

Unlike the earlier lifecycle/resource smoke commands, CI runs this with `--require-webgpu`. Losing real WebGPU execution fails the API-validation job rather than silently reducing it to fake-device coverage.

The SM-104 browser gate compiles registered WGSL, collects compilation information, creates actual render/compute pipelines under validation scopes, submits representative commands, creates registered resource descriptors, exercises resize, performs a real atlas upload, validates optional-feature absence, deliberately captures a validation error, and forces initialization/device-loss fallback without changing gameplay-authoritative sentinel state.

The report schema and precise evidence boundary are documented in `WEBGPU_API_VALIDATION.md`. Firefox remains explicitly unexecuted in this hosted Chromium lane; target Firefox execution belongs to SM-405.

### SM-200 Material-v2 G-buffer/readback gate

The normal source/regression runner adds:

```text
node tools/validate_webgpu_gbuffer.js
python tools/validate_webgpu_gbuffer_contract.py
```

The required real-WebGPU browser gate is:

```text
python tools/validate_webgpu_gbuffer_browser.py \
  --require-webgpu \
  --report artifacts/webgpu-gbuffer-browser.json
```

This uses the production `engine/webgpu_gbuffer.js` WGSL, attachment formats and resource descriptors. It uploads the coordinate-identical Material-v2 atlases and performs GPU readback checks for a flat control, crate/box, barrel/cylinder and a representative mixed-metal prop. It also verifies static/dynamic/foreground material parity, alpha cutout, deletion-to-clear behaviour, adjacent-atlas isolation, stable object IDs and execution of all registered G-buffer debug views.

The production SM-200 attachment contract is documented in `WEBGPU_GBUFFER_SM200.md`. In particular the `depth32float` attachment is allocated and deterministically cleared but does not yet write ownership depth: SM-201 derives that projection and SM-202 implements per-pixel ownership. CI must not reinterpret successful SM-200 object-ID writes as completion of SM-201/202.

SM-002's `render-tests/fixtures/harness-smoke.json` remains an intentional auxiliary harness fixture. The SM-001 corpus manifest remains authority for its 16 regression fixtures.

## CI workflow

`.github/workflows/verification.yml` runs on pull requests, pushes to `main`, and manual dispatch. It has five independent jobs:

1. **source + deterministic regression** — Python compile, Node syntax, planning, SM-100 Render Scene, SM-101 RenderTransform, SM-102 lifecycle, SM-103 resource/frame infrastructure, SM-104 validation and SM-200 G-buffer contracts, fixture/harness, webapp, renderer, Material-v2, ghost-material, visual-material and inherited coherence regressions;
2. **WebGPU lifecycle + resources + WGSL + G-buffer validation** — real headless Chrome lifecycle/fallback and resource smoke, required-real-WebGPU SM-104 validation, then required-real-WebGPU SM-200 production G-buffer rendering/readback with structured browser/adapter evidence;
3. **WebGL2 root-transform browser pixel parity** — real headless Chrome/Chromium before/after captures for representative SM-101 fixtures, with screenshot artifacts retained;
4. **GLSL + MRT software validation** — production WebGL2 GLSL compile/link plus float-MRT and RGBA8 fallback framebuffer validation under Mesa/EGL software rendering;
5. **clean source package + extraction** — fresh archive/extraction and path/integrity validation including current RenderScene/RenderTransform/WebGPU lifecycle/resource/API-validation/G-buffer contracts.

Each job writes structured evidence under `artifacts/` and uploads it even when an earlier validation step fails where possible.

## Failure diagnostics contract

`tools/run_checks.py` records stable check name/group, exact command, exit code, duration, captured stdout and captured stderr. Its non-mutating deliberate failure probe is:

```text
python tools/run_checks.py --self-test-failure --report artifacts/failure-probe.json
```

The probe launches a child command that exits 17 and verifies both output streams plus the return code are retained. CI runs it after the core gate, including on failed runs.

## What CI does not prove

Hosted CI must not be used as evidence for:

- GTX 1650 Super GPU time, utilization, memory behaviour, feature inventory or driver support;
- 1080p/60 target-hardware performance acceptance;
- human final screenshot/art-direction approval;
- Chrome/Firefox hardware WebGPU support on the target machine;
- spontaneous device-loss behaviour on a physical target adapter;
- authoritative moving-light visual quality.

The SM-101 Chrome pixel-parity job proves same-environment before/after WebGL2 image equality only. SM-102 proves staged lifecycle/fallback behavior. SM-103 proves resource/frame infrastructure on the exposed hosted adapter. SM-104 proves registered API/WGSL/pipeline/failure paths. SM-200 additionally proves its production Material-v2 G-buffer layouts and readback semantics on that same class of hosted real-WebGPU adapter. None of those hosted results are target-GPU performance, Firefox acceptance, final ownership-depth correctness, or human visual approval.

The production WGSL inventory is a growing gate. Every issue that adds shaders, formats, layouts, atlas classes or passes must add corresponding source and real-browser validation rather than treating SM-104/SM-200 as frozen one-time checkpoints.

## Extending the gate

Future issues should add deterministic checks to `tools/run_checks.py` when fast and repository-native. Retained historical regression scripts must validate retained contracts rather than obsolete intermediate version strings. Browser/hardware tests should remain separate jobs when their environment/evidence semantics differ from source correctness.
