# SM-602 prototype evidence — 4 October 2026

## Disposition

**Verified prototype candidate for #37.** The quarter-resolution diffuse pass
responds to nearby bright direct surfaces, rejects incompatible receiver/donor
history, bounds energy and preserves direct colour exactly when disabled. It
remains disabled by default. This is a synthetic-fixture prototype, with no
normal-game presentation, whole-renderer performance or human art-direction
acceptance claim. SM-603 owns stabilization and quality/performance policy.

The dependency review confirmed closed SM-500/#30, SM-502/#32 and SM-601/#36.
SM-601's accepted #110/#111 evidence supersedes older study blockers. Current
main at the start was `fee947782d6068dc077a109a2d63c798072ad648`; the focused
branch is `codex/sm602-diffuse-ssgi`.

## Exact measured source

The retained [native report](../benchmarks/webgpu-gtx1650s/sm602-2026-10-04/chrome-initial/report.json)
identifies measured commit `34b63f0255c53a40485bab66f5b341c150ef2c42` and the complete ten-file renderer/fixture/timing
dependency closure by SHA-256, before and after execution. These hashes are
equal, with clean tracked state. Subsequent evidence/document commits retain
this measured runtime closure. Raw working-file hashes include native line
endings; `source-equivalence.json` also verifies LF-normalized content against
the measured Git blobs. In particular:

| File | Measured SHA-256 |
| --- | --- |
| `engine/webgpu_ssgi.js` | `5108e3de85daab4a3fcd4e248c8254bb3913a2ecbc5d2999c2068c56fb4ddf48` |
| `engine/webgpu_gtao_stabilization.js` | `b595afe8836eaeec6d5457d5801689d80df2faf166ef3e10408071cba98a6580` |
| `webgpu-ssgi-smoke.html` | `7938ebeceed79074dcb2a9dc10003bf988aeb17ad83319d62450270dfe1efb48` |

The adopted SM-601 temporal WGSL bytes are unchanged; only its reusable CPU
pixel-validity helper and equivalent WGSL validity function are exported for
SSGI. The inherited readback/adoption tests verify this boundary.

Environment: Windows 11 build 26200, NVIDIA GeForce GTX 1650 SUPER 4096 MiB,
driver 616.92, fresh Chrome 154.0.8037.93 process/profile, NVIDIA/Turing
nonfallback WebGPU adapter, negotiated `timestamp-query`, DPR 1.

## Correctness and captures

The browser gate compiles all four production shaders, creates and executes
their pipelines under validation scopes, and compares actual GPU readbacks
against deterministic fixtures. There are 113 base assertions. The timing run
adds donor-support, warmed-history, timestamp and command-coverage assertions
for 1,318 passing assertions total. Validation, uncaptured error and JavaScript
exception lists are empty.

The normal 67×51 machinery/floor fixture yields 17×13 indirect texels.
Bright-donor raw maximum is `0.007965087890625`; darkening only the previous
direct donor radiance reduces it to zero. After accumulation, the retained
indirect figure visibly records restrained nearby response. Extreme HDR stays
finite; a forced `0.005` energy cap produces maximum `0.00499725341796875`,
demonstrating actual clipping. Saturation is a documented luminance mix, not a
peak RGB ratio limit. Both previous donor geometry and receiver history reject
object/depth/normal changes; room/device/backend/camera/light discontinuities
clear colour history. Smooth translated/ramped light changes affect the
validated previous colour rather than feeding composed SSGI back into itself.
Nine light-field frames keep geometry and revisions fixed: the prior-colour
reference differs from GPU raw output by at most `0.00000381051`, while an
incorrect current-colour control differs by `0.0021188`. Three 4-pixel same-ID
object translations restore canonical floor depth/material/direct colour;
39 vacated quarter representatives reject history and use current irradiance
exactly, and 104 new-donor representatives reject incompatible old geometry.
Per-frame metrics and moving-light/object captures are retained. The light
field is synthetic resolved radiance, rather than the canonical direct-light
producer; this short sequence is not the SM-603 pathological campaign.

Native composition uses every receiver texel's own albedo and non-metal weight.
Adjacent black/red/metal material tests preserve that boundary. Canonical input
colour/depth/object/normal/material bytes remain unchanged. Disabled composed
output equals direct colour exactly at storage precision. Empty/odd/dense,
foreground-lane exclusion and an early thin hit across a coarse-cell boundary
are covered.

Open the [recorded acceptance page](../benchmarks/webgpu-gtx1650s/sm602-2026-10-04/chrome-initial/acceptance.html)
to replay off/on/incident-irradiance/ownership-rejection readbacks without a
GPU. Its capture settings and per-case provenance are retained. The indirect
figure uses 4× exposure; off/on use explicit Reinhard plus IEC sRGB display
transfer. The [PNG capture](../benchmarks/webgpu-gtx1650s/sm602-2026-10-04/chrome-initial/acceptance.png)
and [raw readbacks](../benchmarks/webgpu-gtx1650s/sm602-2026-10-04/chrome-initial/readbacks.json)
are retained. These synthetic figures establish prototype response and debug
behavior; no separate human visual judgment is recorded or required by #37.

## Initial measured GPU cost

One fresh process, two priming frames, 300 warm-up frames and 600 retained
samples; no outliers removed. Dense 1920×1080 input, 480×270 indirect buffer,
Medium enabled explicitly, 4 rays × 6 steps × at most 3 fine checks, logical
radius 24 with production-equivalent pixel scale 3 (native radius 72), history
weight 0.85 and energy cap 0.08. A positive warmed donor maximum of
`0.01544952392578125` prevents timing a no-hit cold workload. Every retained
frame uses valid warmed history.

| GPU timestamp boundary | Mean (ms) | p95 (ms) |
| --- | ---: | ---: |
| Complete SM-500 SSGI command submission | 2.389376 | 2.885024 |
| Trace compute | 1.362723 | 1.757024 |
| Temporal resolve compute | 0.203744 | 0.206656 |
| Native composition compute | 0.301604 | 0.420992 |
| Previous-colour/geometry snapshot compute | 0.521280 | 0.647328 |

The primary value covers exactly one submission containing all four passes.
Separate per-pass timestamps are compute-only; their p95 values cannot be
summed into a submission p95. Shared depth-hierarchy construction, source
uploads, diagnostic output copies, query resolution and CPU/map latency are
excluded. Callback queue spans and CPU submit/map durations remain separately
labelled in the raw report. This initial distribution is neither a full-game
frame time nor the three-run SM-603 quality campaign. The programme's ≤12 ms
mean / ≤14.5 ms p95 renderer budget remains a target.

`chrome-pre-motion/` preserves the earlier harness at the original uncommitted
overlay, before motion verification was added. Its 2.485186/3.439328 ms
distribution is separate. The renderer hash is unchanged; the later smaller
values are not claimed as an implementation improvement.

**Descriptor estimate:** SSGI owns ten persistent textures and one 80-byte
uniform, four pipelines and six bounded bind groups. At 1920×1080 its declared
storage totals 79,833,680 bytes (76.135 MiB), calculated from formats/extents:
36 bytes per native pixel plus five 8-byte quarter-resolution textures and
the uniform. This excludes shared inputs/hierarchy, driver overhead and
explicit diagnostic/query buffers; it is not measured resident VRAM.

## Verification and continuation

Local source/regression gate: 90/90 checks pass. Deterministic SSGI: 81
assertions; lifecycle/API mock suite: 14/14 cases. Clean extraction: 20/20
checks and 16 unchanged imported-content hashes pass. Hosted Mesa/EGL and
browser gates remain required before merge. No Windows Mesa success is claimed.

An earlier inherited lifecycle smoke timed out WebGPU initialization under
its virtual-time runner and exercised WebGL2 fallback. Its separately retained
`native-lifecycle-initialization-timeout.json` reports `initialized: false`;
it is excluded from native SSGI execution/performance claims. The successful
SSGI runner uses actual CDP wall time. The initial sandbox package attempt was
blocked by Windows temporary-directory permissions; the native extraction
rerun succeeded. Neither failed attempt is relabelled as hardware success.

Reproduce the native initial measurement in a fresh output folder:

```text
python tools/validate_webgpu_ssgi_browser.py --hardware --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --timing --warmup 300 --samples 600 --timeout 240 --out <fresh-output>
python tools/run_checks.py --report artifacts/core-checks.json
python tools/validate_clean_package.py --report artifacts/clean-package.json
```

After #37 lands, refresh ownership and full #38 context before starting SM-603.
It still needs scripted multi-frame disocclusion/room/pathological sequences,
three fresh target-hardware runs for normal and worst-case quality, full-HD
resource reporting, cross-browser correctness and evidence-based enablement.
Keep SSGI optional/off on Medium if useful quality costs too much. SM-505's
separate normal-game WebGPU presentation blocker remains open.
