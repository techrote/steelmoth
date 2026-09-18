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

The smoke loads the actual browser API entrypoint, asserts the staged `Auto → WebGL2` policy, exercises deliberate failure handling and, when `navigator.gpu` plus a usable adapter are exposed, performs real device/context configure + resize/reconfigure. Hosted Linux may legitimately expose no usable WebGPU adapter; that absence is recorded rather than converted into a fabricated success. Fallback correctness still must pass.

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

If the hosted browser exposes a usable WebGPU adapter, this smoke creates actual GPU textures/buffers, performs queue uploads, submits command buffers through scoped frame-graph passes, executes three frames, and performs two manager/registry resizes while asserting selective resource rebuilding. If the hosted browser does not expose a usable adapter, that fact is recorded and deterministic unit coverage remains authoritative for resource lifecycle semantics; no fake hardware claim is made.

SM-002's `render-tests/fixtures/harness-smoke.json` remains an intentional auxiliary harness fixture. The SM-001 corpus manifest remains authority for its 16 regression fixtures.

## CI workflow

`.github/workflows/verification.yml` runs on pull requests, pushes to `main`, and manual dispatch. It has five independent jobs:

1. **source + deterministic regression** — Python compile, Node syntax, planning, SM-100 Render Scene, SM-101 RenderTransform, SM-102 WebGPU lifecycle and SM-103 resource/frame infrastructure contracts, fixture/harness, webapp, renderer, Material-v2, ghost-material, visual-material and inherited coherence regressions;
2. **WebGPU lifecycle + resource browser smoke** — real headless Chrome/Chromium lifecycle/fallback smoke plus, when a usable adapter exists, persistent-resource/resize/scoped-frame execution with structured evidence;
3. **WebGL2 root-transform browser pixel parity** — real headless Chrome/Chromium before/after captures for the representative SM-101 fixtures, with screenshot artifacts retained;
4. **GLSL + MRT software validation** — production GLSL compile/link plus float-MRT and RGBA8 fallback framebuffer validation under Mesa/EGL software rendering;
5. **clean source package + extraction** — fresh-archive/extraction and path/integrity validation including current RenderScene/RenderTransform/WebGPU lifecycle/resource contracts.

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
- device-loss behaviour on a real target adapter;
- authoritative moving-light visual quality.

Those require the browser/hardware gates specified by SM-003, SM-405, SM-501, and SM-505. The SM-101 Chrome pixel-parity job proves same-environment before/after WebGL2 image equality only. The SM-102 browser job proves staged lifecycle/fallback behavior in its hosted browser only; deterministic fake-device tests provide controlled coverage of loss and failure states. The SM-103 hosted smoke proves only API/resource lifecycle correctness on the exposed hosted adapter, while its byte estimates are accounting estimates rather than measured VRAM residency.

SM-103 provides persistent resource/frame-graph/pipeline scaffolding but still no WebGPU game-frame renderer or production WGSL. SM-104 must extend verification with real production descriptors, WGSL modules, compilation information and validation-scope evidence.

## Extending the gate

Future issues should add deterministic checks to `tools/run_checks.py` when fast and repository-native. Retained historical regression scripts must validate retained contracts rather than obsolete intermediate version strings. Browser/hardware tests should remain separate jobs when their environment/evidence semantics differ from source correctness, as SM-101 through SM-103 do.
