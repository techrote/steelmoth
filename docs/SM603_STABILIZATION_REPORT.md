# SM-603 stabilization evidence — 4 October 2026

## Disposition and enablement decision

**Verified optional candidate for #38.** The donor-set change eliminates the
scripted partial-deletion history witness, preserves bounded diffuse energy and
uses canonical ambient visibility once. Three fresh native processes for each
of six tier/scene configurations and a source-matched Firefox correctness
spot-check pass. All SSGI defaults remain off, including Medium.

The tested complete SSGI submission costs 2.379–3.337 ms mean and
2.405–3.823 ms p95. Stabilization adds 0.083–0.149 ms per process run and
7.910 MiB of owned descriptor storage. This is a useful bounded optional
feature, but its absolute cost is substantial enough that these isolated
measurements do not justify promotion. No complete current renderer-frame
budget, normal-game presentation, default-browser compatibility or human
art-direction acceptance is claimed. SM-505 remains the separate release gate.

## Exact source and environment

The [campaign manifest](../benchmarks/webgpu-gtx1650s/sm603-2026-10-04/campaign-237bf76/campaign.json)
identifies runtime commit `237bf7696ffbd177df3743d2d6105ad73c9ed50a`, clean
tracked state, all fifteen executable closure paths tracked, and equal raw
SHA-256 hashes before and after all nineteen serialized browser processes.
Every individual report is SHA-256 referenced. The complete raw reports,
timestamps, readbacks and acceptance files are retained alongside the manifest.
Later evidence/document changes preserve this executable closure; the
[source-equivalence proof](../benchmarks/webgpu-gtx1650s/sm603-2026-10-04/source-equivalence.json)
checks current raw bytes and LF-normalized Git blobs against that runtime.

The comparison is the exact test-only LF-normalized SM-602 production source
from `34b63f0255c53a40485bab66f5b341c150ef2c42`, SHA-256
`5108e3de85daab4a3fcd4e248c8254bb3913a2ecbc5d2999c2068c56fb4ddf48`.
It is not another production renderer. Relevant candidate hashes are:

| Closure member | Raw measured SHA-256 |
| --- | --- |
| `engine/webgpu_ssgi.js` | `24d343fad6dc6e8a8e2b936acf5a72aad4ac1c182374aa23a809291761990ea6` |
| `webgpu-ssgi-stabilization-smoke.html` | `841e09effb371838b498898ac01d30f8d2150679630e7377ce30d02d09e10567` |
| `tools/sm603_ssgi_fixtures.js` | `230164878dc008f7cba2097f61fedb82526f3d9816cad23dc3e3983d9386b0cf` |

Host: Windows 11 build 26200, NVIDIA GeForce GTX 1650 SUPER 4096 MiB,
driver 616.92 (Windows version 32.0.16.1692), Chrome 154.0.8037.93,
Firefox 157.0. Chrome exposes NVIDIA/Turing adapter information and an actual
non-fallback flag. Firefox exposes an actual non-fallback flag with
privacy-redacted names; complete Windows controller inventory shows exactly
one adapter, PCI `VEN_10DE&DEV_2187`, corroborated by NVIDIA inventory.

Firefox is windowed/minimized with the existing repository's explicit
temporary preferences: `dom.webgpu.enabled`, `gfx.webrender.all`, and
`webgl.force-enabled`. These are recorded in its report. Earlier headless
probes returned no adapter and are retained under
[firefox-probes](../benchmarks/webgpu-gtx1650s/sm603-2026-10-04/firefox-probes/).
They are diagnostic failures, not discarded performance trials or proof of
default windowed compatibility. No blocklist bypass or global preference
change is claimed. All owned campaign browser/driver processes exited.

## Production correctness and captures

Each native Chrome run executes the same Medium 67×51 correctness fixtures
before its separately configured full-HD timing workload. Firefox executes
those correctness fixtures without timing. All production shaders/pipelines
run under validation scopes; validation, uncaptured-error and JavaScript
exception lists are empty. Firefox passes 49 assertions; each Chrome timing
run passes 57, including timing and warmed-workload assertions.

The frozen baseline preserves stale red incident irradiance
`0.0035762786865234375` after donor columns 33–36 are deleted while another
donor remains. The candidate resolves current irradiance exactly at the
geometry-compatible receiver, residual zero, diagnostic reason 6
(`donorSetChanged`). Actual before/after donor-coordinate textures are read
back. Twelve repeated deletion frames, three translations with restored floor,
blocker reveal, and room/device/backend/camera/light/resize/explicit resets
exercise rejection without persistent scripted trails.

Twenty-four frames of primary-red 10000 HDR input remain finite and bounded;
maximum incident irradiance is `0.0056915283203125`. The pass explicitly
rejects its own composed texture as a direct-colour source. These tests show
the bounded feedback boundary, not a human judgment of every game scene.

The real SM-307 producer supplies material AO visibility 0.6 and GTAO
visibility 0.5, yielding canonical B = 0.5. The new contribution receives
that envelope once, rather than their product 0.3; resolved direct input is
preserved. Native material composition checks cover 2,653 colour channels,
maximum storage-precision error `0.000030517578125`. No native opaque
albedo/metal boundary is replaced by quarter-resolution material sampling.

Open the [exact retained acceptance page](../benchmarks/webgpu-gtx1650s/sm603-2026-10-04/campaign-237bf76/Medium/representative/run-1/acceptance.html)
to replay ten actual GPU readbacks and case metadata without WebGPU.
The [native fixture capture](../benchmarks/webgpu-gtx1650s/sm603-2026-10-04/campaign-237bf76/Medium/representative/run-1/acceptance.png)
and [raw capture data](../benchmarks/webgpu-gtx1650s/sm603-2026-10-04/campaign-237bf76/Medium/representative/run-1/readbacks.json)
are retained. Incident images use explicit 8× inspection exposure and
Reinhard/IEC-sRGB display transfer; rejection red is reason/6, with green/blue
ray fractions. Composed images use their recorded exposure. The exact saved
page is also smoke-tested in a fresh Chrome process with GPU disabled;
`acceptance-replay.json` and `acceptance-replay.png` record that independent
artifact replay. No human acceptance was requested or invented.

## Measured GPU cost

All timings below are GPU timestamps in milliseconds. Each triple is fresh
process run 1 / 2 / 3, preserving process variation. Each process performs two
priming frames, 300 warm-up pairs, then 600 retained samples per variant at
native 1920×1080, DPR 1 and pixel scale 3. The variant order alternates within
every run; offsets 0 / 1 / 2 start with baseline / candidate / baseline.
All 21,600 variant samples are retained, with valid warmed history, positive
donor work and exactly one producer submission per sample. No outliers are
removed and the three process windows are not treated as independent frame
replicates for an invented significance claim.

| Tier / scene | Baseline mean | Candidate mean | Baseline p95 | Candidate p95 |
| --- | --- | --- | --- | --- |
| Medium representative | 2.297 / 2.288 / 2.335 | 2.379 / 2.380 / 2.424 | 2.327 / 2.322 / 2.673 | 2.405 / 2.413 / 2.769 |
| Medium dense | 2.473 / 2.402 / 2.433 | 2.568 / 2.535 / 2.538 | 2.958 / 2.992 / 3.043 | 3.062 / 3.217 / 3.169 |
| High representative | 2.429 / 2.408 / 2.450 | 2.526 / 2.515 / 2.586 | 3.103 / 3.026 / 3.099 | 3.213 / 3.107 / 3.250 |
| High dense | 2.671 / 2.690 / 2.716 | 2.801 / 2.803 / 2.816 | 3.273 / 3.333 / 3.199 | 3.425 / 3.442 / 3.215 |
| Ultra representative | 2.770 / 2.743 / 2.765 | 2.897 / 2.878 / 2.866 | 3.115 / 3.081 / 3.285 | 3.243 / 3.274 / 3.403 |
| Ultra dense | 3.176 / 3.188 / 3.217 | 3.305 / 3.337 / 3.336 | 3.686 / 3.515 / 3.541 | 3.823 / 3.650 / 3.645 |

The primary boundary brackets the complete four-pass SSGI command submission:
trace, temporal resolve, native composition and previous-colour/geometry
snapshot. Raw fixture `variants.*.gpuMs` explicitly copies SM-500
`commandGpuMs`. The nested inherited `timingSemantics.gpuMs` describes the
instrumentation's legacy queue-span alias, not this fixture's renamed array;
the fixture's `boundary` and recorded submission counts state the mapping.
Separately retained `queueSpanGpuMs` may include host gaps. No CPU encoding or
callback duration is exported as GPU timing.

Separate eight-query compute observers identify trace and resolve as the main
added work. Candidate process means span trace 1.344–2.217 ms, resolve
0.226–0.262 ms, composition 0.298–0.325 ms and snapshot 0.507–0.563 ms.
Across the six configurations, the differences between averages of the three
process means are trace +0.063–0.092 ms, resolve +0.016–0.040 ms and composition
+0.001–0.008 ms. Small compose/snapshot shifts include measurement variation;
no optimization claim follows. Per-pass p95s cannot be summed into a total p95.

Shared hierarchy construction, upstream rendering, fixture uploads, query
resolution and diagnostic readbacks are outside this primary span. The timing
source omits the optional SM-307 ambient input, so it measures neutral-ambient
SSGI. Actual ambient composition is separately verified above; its additional
sampling cost and integrated GTAO/SSGI/full-frame cost are not measured here.
Representative and dense are fixed synthetic scenes, not an exhaustive
worst-case bound. Historical SM-501/GTAO means cannot be added to this dataset
to infer a remaining frame budget. The programme's ≤12 ms mean / ≤14.5 ms p95
whole-renderer numbers remain targets for a current combined configuration.

## Descriptor memory and bounded resources

| Owned descriptor estimate at 1920×1080 | Baseline | Candidate | Difference |
| --- | ---: | ---: | ---: |
| Bytes | 79,833,680 | 88,128,096 | +8,294,416 |
| MiB | 76.135 | 84.046 | +7.910 |

The candidate owns twelve persistent textures, one 96-byte uniform, four
pipelines and seven bounded bind groups. The addition is two 480×270×2
`rgba32uint` donor-coordinate textures (64 bytes per quarter texel) and sixteen
uniform bytes. History descriptors rise from 57.349 to 65.259 MiB. No per-frame
resource creation, host mapping or unbounded CPU geometry scan is introduced.
These are format/extent accounting estimates. Shared inputs, hierarchy,
diagnostic/query buffers and driver overhead are excluded; resident VRAM was
not measured.

## Verification and review gate

The strict campaign validator passes all source, hardware, report-hash,
timestamp, sample-count, history, positive-work, memory and process-cleanup
checks. Independent raw review reproduces means/p95s and all four compute
arrays from the actual timestamp records. Deterministic stabilization passes
77 assertions, inherited SSGI 81, lifecycle 18/18, and provenance self-test
18 structural mutants plus three additional attribution cases.

The normal repository gate passes 93/93 and clean extraction 22/22 at the
implementation checkpoint; final evidence/package checks are retained as
`sm603-core-checks-final.json` and `sm603-clean-package-final.json`. The full
initial hosted inventory is twenty workflows / twenty-four successful jobs.
[PR #114](https://github.com/techrote/steelmoth/pull/114) still requires the same
complete hosted inventory at its final evidence head before merge. Hosted
Mesa/EGL and software-browser results are correctness evidence only.

Reproduce into a fresh output folder:

```text
python tools/run_sm603_target_campaign.py --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --firefox --firefox-windowed --firefox-webgpu-override --out <fresh-output> --timeout 600
python tools/validate_sm603_target_report.py <fresh-output>/campaign.json
python tools/run_checks.py --report artifacts/core-checks.json
python tools/validate_clean_package.py --report artifacts/clean-package.json
```

After verified merge and issue closure, refresh ownership before another
project-chain task. SM-702 can consume these stable incident-irradiance
interfaces; SM-700 separately needs a known remaining current frame budget.
