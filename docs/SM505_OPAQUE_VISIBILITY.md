# SM-505 opaque visibility integration

This document records the explicit normal-game WebGPU candidate's consumption of
the accepted [SM-307 visibility channels](WEBGPU_VISIBILITY_SM307.md). It is an
implementation decision for the candidate, not release acceptance. `Auto` remains
WebGL2. Fresh source-matched native correctness, visual review and performance
qualification are required after this change; earlier captures and measurements
remain evidence for their original source only.

## Source findings

The previous presenter generated SM-205 local shadows, DSO, temporal Dark Bloom
and SM-307 visibility, but its opaque SM-204 lighting call consumed none of the
composed direct visibility G channel. Producing a mask alone did not apply its
occlusion to the opaque light contribution.

Multiplying the already-resolved total light by one global mask would introduce
a second defect. A merged visibility texture has no light identity: the shadow
of one cone or point light would suppress unrelated lights, ambient and emissive
terms. SM-307 R is a diagnostic combined envelope, not a universal multiplier.
The candidate therefore preserves light identity until direct accumulation and
uses G for direct light and B for ambient visibility at their respective stages.

SM-205 also shared one canonical light buffer between its self-shadow and contact
passes. Queue writes for contact could precede submission of the earlier encoded
self-shadow draw, causing that draw to read the contact payload. The repaired
path submits self-shadow work before overwriting the buffer for contact. It adds
neither another light buffer nor a CPU completion wait.

## Bounded streamed composition

The presenter builds one canonical light plan. Existing light, self-shadow,
contact, dominance, DSO job/member/tile and sampling caps remain unchanged. The
plan separates only the union of the existing selected self-shadow lights, the
single contact driver and the single available DSO macro driver. Each affected
light receives its own raw-direct batch; all unaffected lights share one batch
with neutral direct visibility. With no affected lights an empty or neutral batch
still clears the accumulation target deterministically.

The DSO driver follows the existing contact/cone preference when that light has
an available canonical dominance record; otherwise it uses the first canonical
light with available dominance. No new per-light DSO hierarchy, history atlas or
unbounded light-by-pixel allocation is introduced. DSO, Dark Bloom and temporal
history advance once per normal frame, not once per streamed batch.

For each batch, the presenter renders the selected SM-205 local masks, composes
SM-307 with only that batch's applicable local/macro terms, and calls the optional
SM-204 `accumulateDirect` API. This API computes the existing uncompressed GGX
diffuse plus specular contribution, multiplies it once by SM-307 G and adds it to
one persistent `rgba16float` target. The first batch clears it; subsequent batches
load it. Batch alpha is zero. Ambient, emissive and direct compression are absent
from this stage. Canonical light identity is checked after scene subsetting.

After all batches, the presenter restores the full-scene SM-205 and SM-307 masks
for existing forward consumers without advancing DSO/Bloom/temporal producers
again. `resolveDirect` then restores the full canonical light-buffer payload and
resolves the opaque output once:

```text
direct = rawDirect / (1 + 0.22 * rawDirect)
ambient = albedo * ambientScalar * (0.72 + 0.28 * B) * existingMetalTint
emissive = albedo * materialEmissive * 0.8
output = max(0, ambient + direct + emissive)
```

B already contains the SM-307 material-AO blend and any enabled ambient policy.
It replaces the old material-AO term; it is not multiplied by material AO again.
Emissive remains unmasked. The candidate keeps GTAO off and leaves artistic
controls, visibility thresholds, exposure, contrast and postprocessing defaults
unchanged. Canonical postprocessing and foreground/UI ordering still apply.

The additional accumulation texture costs 16,588,800 bytes (16.6 MB decimal,
15.82 MiB) at 1920×1080, excluding existing targets and driver allocation
overhead. It is allocated when the optional path is initialized; the normal
presenter initializes it inside its validation scope before readiness. It is
persistent, recreated through the resource registry on resize, and released with
that registry. This is a new candidate memory cost to
measure, not an accepted performance result.

The original SM-204 `DEFERRED_WGSL` and default `render` path remain unchanged.
The optional streamed shaders derive the existing direct-light calculation and
use a separate resolve. Neutral visibility reproduces the default CPU math when
B equals its existing material-AO blend; intermediate GPU half-float accumulation
introduces quantization that requires native readback tolerances and measurement.

## Verification and remaining gates

The repository core and clean-package gates execute:

- `validate_sm505_light_stream.js`: real presenter batch orchestration, canonical
  identity, per-light policy, neutral batch and full forward-mask restoration.
- `validate_sm505_streamed_lighting.js`: optional lighting API lifecycle, shader
  bindings, direct-only accumulation, one compression/AO resolve, neutral CPU
  equivalence and retained negative witnesses for global masking/double AO.
- `validate_sm205_light_queue.js`: actual shadow render submission ordering with
  distinct selected lights and the retained old shared-buffer overwrite witness.

These are deterministic CPU/source tests, not GPU execution or visual acceptance.
`sm505_visibility_probe.js` is an injected native diagnostic whose syntax is
checked by the same gates. Its captured input masks and outputs must be kept with
the exact runtime source/configuration and original failed attempts.

Native gates still require distinct-light occluder controls, direct/ambient/
emissive readbacks, unchanged material/ownership/depth, forward ordering and
normal-game visual correctness. Physical timing must follow
[the actual-index benchmark methodology](SM505_NORMAL_PRESENTATION_BENCHMARK.md)
only after its exact-source presentation and visual qualification gates pass.
Additional batches and full-mask restoration can increase GPU work; no speed or
target-budget claim follows from this repair. Cross-browser, transitions, loss,
fallback, resource recreation and soak acceptance remain independent gates.
