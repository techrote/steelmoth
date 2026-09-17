# Deterministic renderer capture harness (SM-002)

The v1.2.3 baseline now exposes a browser-native capture harness for repeatable renderer evidence. It is test infrastructure, not gameplay and not a new renderer. The current baseline supports `webgl2` only; future WebGPU work should implement the same contract rather than inventing a parallel harness.

## URL contract

Enable with `?renderTest=1`. Supported parameters:

| Parameter | Meaning | Default |
| --- | --- | --- |
| `fixture` | `render-tests/fixtures/<id>.json` | `harness-smoke` |
| `backend` | renderer backend | `webgl2` |
| `quality` | harness-only `low`, `medium`, `high`, `ultra`, `runtime-default` quality mapping | `high` |
| `width`, `height` | requested native framebuffer resolution | `640`, `360` |
| `dpr` | requested browser device scale factor | `1` |
| `lightAngle` | diagnostic light angle in degrees; 0=east, 90=south | `0` |
| `seed` | deterministic PRNG seed | `1397572098` |
| `fixedTimeMs` | fixed renderer animation time | `12000` |
| `settleFrames` | RAFs after fixture application | `4` |

Canonical angle set: **0, 45, 90, 135, 180, 225, 270, 315 degrees**.

The harness isolates the two v1.2.3 local-storage keys instead of clearing browser storage, replaces `Math.random` with a seeded generator before game construction, pauses simulation, pins renderer time, disables stochastic post grain, suppresses save writes, and applies fixture state directly. A fixture therefore does not depend on unlocked rooms or prior progression.

`width` and `height` are native targets. The harness sizes CSS by `target / requested DPR`; automation should launch the browser at the requested DPR. Diagnostics record requested and actual DPR and native size rather than silently claiming a match.

## Fixture schema

`steelmoth-render-fixture/v1` supports room selection, explicit progression sets, player/light placement, diagnostic graphics overrides, and optional dynamic-actor suppression. `render-tests/fixtures/harness-smoke.json` is the minimal independent SM-002 fixture. SM-001's canonical visual fixtures can be consumed without changing the URL/capture contract once merged.

## Browser API and outputs

When ready, `document.body.dataset.renderTestReady === "1"` and `window.SteelMothRenderHarness.result` contains `steelmoth-render-capture/v1` diagnostics. A machine-readable copy is emitted in `<script id="renderTestResult" type="application/json">` for headless DOM extraction.

`await window.SteelMothRenderHarness.capture()` returns the canvas PNG Blob/data URL plus the same diagnostics. Result metadata includes fixture/config, scene fingerprint, requested/actual resolution and DPR, engine renderer diagnostics, diagnostic-light state, PNG SHA-256, and GPU timer availability. GPU timing fields are reported only as observations from the actual adapter/browser; headless/software runs are never hardware-performance evidence.

## Zero-dependency headless runner

Run from the repository root:

```text
python tools/capture_render_fixture.py --fixture harness-smoke --angle 45 --width 640 --height 360 --dpr 1 --repeat 3 --out render-captures/smoke
```

The runner finds Chrome/Chromium, starts a loopback static server, launches a fresh browser profile for every repetition, uses the requested device scale factor, captures PNG + DOM diagnostics, writes `diagnostics.json` and `performance.json`, and compares scene fingerprints/canvas hashes across repeats. If no compatible browser exists it exits with code 2 and does not fabricate output.

Chrome CLI screenshots are full viewport captures. The harness hides all UI/chrome and sizes the page to the renderer surface so the viewport image is the renderer evidence. The diagnostics also contain an independent hash of `canvas.toBlob()` bytes.

## Determinism and limitations

Scene state/config metadata must be identical across repeated runs. PNG hash equality is expected for the same software/browser/adapter stack; a mismatch is reported as nondeterminism evidence rather than normalized away. Cross-driver raster differences are not assumed to be defects without investigation.

WebGPU, G-buffer/object/depth/DSO/Dark-Bloom dump hooks are intentionally not faked in this baseline. The capture schema has room for later backend-specific attachments; those become authoritative only when their owning implementation issues land.
