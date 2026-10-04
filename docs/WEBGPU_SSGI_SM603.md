# SM-603 — optional diffuse SSGI stabilization

## Requirement and scope

Issue [#38](https://github.com/techrote/steelmoth/issues/38) extends the accepted
SM-602 prototype with reproducible disocclusion, bounded history, canonical
ambient composition and physical target cost characterization. It adds no
glossy bounce, volumetrics, gameplay dependency or backend promotion.

The inherited depth, colour and material contracts in `WEBGPU_SSGI_SM602.md`
remain authoritative. The stabilization fixture is
`webgpu-ssgi-stabilization-smoke.html`; its before comparison uses a test-only
frozen copy of the measured SM-602 implementation rather than a second
production renderer.

## Decision — remember the bounded donor set

Validating only the current hit's previous geometry cannot identify every
deleted source: a receiver can retain history from a removed donor while
another ray still hits an unchanged donor. Each enabled trace now records
up to eight native donor coordinates per quarter texel. Two persistent
`rgba32uint` array textures, each with two layers, alternate those records.
Unused rays use `0xffffffff`. The resolve rejects reuse with diagnostic
reason 6 when any previous/current coordinate differs. This supplements
SM-601 receiver/donor geometry validity; it creates no second depth authority.

Cold enabled frames record geometry while contributing zero bounce. The next
compatible frame can reuse the previous direct-colour snapshot. Room, camera,
light discontinuity, resize, reset and quality/settings changes still reject
globally. Callers must advance camera/light revisions for incompatible changes;
the pass provides no motion-vector reprojection. Smooth moving donors may lose
temporal reuse, keeping the current bounded contribution instead of trails.

The CPU oracle accepts `previousDonorCoordinates` and returns
`donorCoordinates`, each `Uint32Array(quarterPixels * 8)`. Missing prior CPU
records conservatively rejects history. Ordinary GPU updates perform no host
readback or per-object CPU scan.

## Decision — consume the canonical ambient envelope once

`sourceFromPaths(hierarchy, gbuffer, directResolvedView, visibility)` accepts a
valid SM-307 visibility producer or a caller-validated compatible native RGBA
view. Producer validity is checked across asynchronous preparation. The pass
uses only its B channel, `max(ambientFloor, min(materialAOVisibility,
gtaoVisibility))`, on the added diffuse contribution at the native receiver.
It applies that envelope once, after the receiver's own albedo and non-metal
weight. It never independently multiplies Material AO by GTAO, or applies the
ambient envelope to resolved direct colour. An omitted input is neutral,
preserving the explicit SM-602 prototype contract.

The colour source remains direct-only linear HDR before this addition and
before post processing. It never snapshots its own output. Donor radiance,
incident energy, saturation, neighborhood history and temporal delta remain
bounded by the inherited production limits.

## Decision — explicit optional tiers

| Tier | Rays | Steps | Logical radius | History weight | Effect resolution |
| --- | ---: | ---: | ---: | ---: | --- |
| Low | 4 | 4 | 16 | 0 | Off |
| Medium | 4 | 6 | 24 | 0.85 | Quarter |
| High | 6 | 8 | 32 | 0.88 | Quarter |
| Ultra | 8 | 8 | 40 | 0.90 | Quarter |

All remain disabled by default. Static quality selection records these
settings without enabling the effect. Core albedo, ownership, object ID and
G-buffer remain full/native resolution. Effect timings cannot establish the
budget of a complete renderer frame, and historical SM-501/GTAO-off totals
must not be added to current SSGI samples to invent a combined result.

## Verification protocol

```text
node tools/validate_webgpu_ssgi_stabilization.js
python tools/validate_sm603_ssgi_browser.py --report artifacts/sm603-ssgi-browser.json --out artifacts/sm603-ssgi
python tools/validate_sm603_target_report.py --self-test
python tools/run_sm603_target_campaign.py --firefox --firefox-windowed --firefox-webgpu-override --out artifacts/sm603-target
python tools/validate_sm603_target_report.py artifacts/sm603-target/campaign.json
python tools/run_checks.py --report artifacts/core-checks.json
python tools/validate_clean_package.py --report artifacts/clean-package.json
```

Scripted production readbacks compare the frozen baseline and candidate on
partial donor deletion, translation, reveal and room/camera/light changes;
HDR sequences check bounded energy and no recursive feedback. Canonical
SM-307 output exercises the ambient envelope. The inherited SM-602 gate and
deferred-compilation lifecycle suite remain required.

Physical characterization uses three fresh Chrome processes per quality/scene
configuration, native 1920×1080, DPR 1, 300 warm-up and 600 retained samples per
implementation. Baseline/candidate order is balanced within each process.
SM-500 brackets the complete SSGI command submission, including snapshot
copies; separate per-pass queries cover compute only. Shared hierarchy build,
upstream rendering, fixture upload, query resolution and diagnostic readback
are excluded. Raw per-pass query samples and separately labelled callback queue
spans are retained. Those queue spans are GPU timestamps that may include host
gaps; this fixture does not export CPU encoding/callback duration.
Representative and dense fixture results bound the tested scenes, not every
possible game scene. Firefox receives a native correctness spot-check.

## Current evidence state

The clean runtime `237bf7696ffbd177df3743d2d6105ad73c9ed50a` passes eighteen
fresh native Chrome runs (three per tier/scene) and a source-matched native
Firefox correctness spot-check. Complete SSGI submission means span
2.379–3.337 ms; per-process mean stabilization overhead spans 0.083–0.149 ms.
Owned descriptor storage is 88,128,096 bytes, 7.910 MiB above the frozen
prototype. Exact source, captures, raw samples, attribution, optional/off
enablement rationale and evidence limits are in `SM603_STABILIZATION_REPORT.md`.
Timing omits the optional ambient input; actual SM-307 composition is verified
separately. These effect measurements do not establish a current whole-frame
budget or default promotion. Final-head hosted checks and verified merge remain
the PR acceptance gate.
