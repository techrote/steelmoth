# CI and verification

Steel Moth uses one stable cross-platform verification runner plus focused package and GLSL jobs. The goal is to automate repository/source correctness without pretending hosted software rendering is target-hardware evidence.

## Local entrypoints

Install Python validation dependencies:

```text
python -m pip install -r tools/requirements-ci.txt
```

Node.js is required only for JavaScript syntax checks. Node 24 is the CI reference version.

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

List registered checks:

```text
python tools/run_checks.py --list
```

Run the Mesa/EGL GLSL + framebuffer gate when local EGL/OpenGL ES libraries are available:

```text
python tools/run_checks.py --group glsl --report artifacts/glsl-checks.json
```

On Linux CI this runs with `EGL_PLATFORM=surfaceless` and `LIBGL_ALWAYS_SOFTWARE=1`. Passing this proves shader compile/link and framebuffer-format correctness in the tested Mesa software environment only. It is not GTX 1650 Super performance or browser evidence.

Validate a clean source ZIP/extraction without relying on the current checkout layout:

```text
python tools/validate_clean_package.py --report artifacts/clean-package.json
```

The package check creates a temporary ZIP, rejects unsafe archive paths, extracts into a fresh directory, re-verifies the inherited `SHA256SUMS.txt` baseline entries, then runs the v1.2.3 webapp, render-harness, and render-fixture validators from the extracted copy.

## CI workflow

`.github/workflows/verification.yml` runs on pull requests, pushes to `main`, and manual dispatch. It has three independent jobs:

1. **source + deterministic regression** — Python compile check, Node syntax checks, planning, fixture/harness, webapp, renderer, Material-v2, ghost-material, visual-material, and inherited coherence regressions;
2. **GLSL + MRT software validation** — production GLSL compile/link plus float-MRT and RGBA8 fallback framebuffer validation under Mesa/EGL software rendering;
3. **clean source package + extraction** — fresh-archive/extraction and path/integrity validation.

Each job writes structured JSON under `artifacts/` and uploads it with `actions/upload-artifact` even when an earlier validation step fails where possible.

## Failure diagnostics contract

`tools/run_checks.py` records, for every check:

- stable check name and group;
- exact argument-vector command;
- exit code;
- duration;
- captured stdout;
- captured stderr.

The runner includes a non-mutating deliberate failure probe:

```text
python tools/run_checks.py --self-test-failure --report artifacts/failure-probe.json
```

The probe launches a child command that exits with code 17 and confirms that both stdout and stderr plus the return code are retained. The probe itself returns success only when the failure evidence is actionable. CI runs this after the core gate, including on failed runs, so the reporting mechanism is continuously checked without intentionally breaking repository files.

## What CI does not prove

Hosted CI must not be used as evidence for:

- GTX 1650 Super GPU time, utilization, or memory behaviour;
- 1080p/60 performance acceptance;
- human visual parity or final screenshot approval;
- Chrome/Firefox hardware WebGPU support;
- device-loss behaviour on a real target adapter;
- authoritative moving-light visual quality.

Those require the browser/hardware gates specified by SM-003, SM-405, SM-501, and SM-505.

The current v1.2.3 baseline has no production WebGPU backend or WGSL modules, so SM-005 does not create a fake WebGPU test. SM-102/SM-104 must register real production WGSL/API tests once those resources exist. Hosted execution is acceptable for API/resource correctness only when the environment actually supports the tested path; otherwise the limitation must be reported explicitly.

## Extending the gate

Future issues should add deterministic checks to `tools/run_checks.py` when they are fast and repository-native. Hardware/browser tests should remain separate unless a runner can execute them meaningfully. Do not hide a hardware requirement inside a software-CI pass.
