# SM-505 background receiver and development inspection

Status: source implementation and deterministic tests; native qualification is
recorded separately per source/configuration. Auto remains WebGL2.

## Missing input, rather than a brightness compensation

The first native checkpoint showed all 1,952,847 unowned pixels with zero G0
coverage and zero SM-204 raw lighting despite a nonzero backdrop. WebGL2's
`gbufferBackgroundProg` instead writes that entire retained background into G0,
with flat neutral G1/G2, before material sprites. Without that input WebGPU's
floor cannot receive the flashlight. A high overall black fraction alone is not
a sufficient failure criterion for this intentionally dark game.

The normal presenter now runs one bounded fullscreen receiver pass after sprite
ownership and before depth/shadows/lighting. It samples the existing
`rgba8unorm-srgb` background with nearest filtering and writes only unowned
G0/G1/G2 pixels, using the exact WebGL2 flat material defaults. It reads object ID;
ID and depth are never attachments or outputs. Owned sprite material bytes must
remain unchanged. No mesh, floor object or new depth convention is introduced.

The pipeline, sampler and bindgroup are persistent. The bindgroup refreshes only
when the background texture or G-buffer ownership texture changes; room/resize/
close follow existing lifetimes. Initialization records compiler messages and
awaits validation before reporting readiness. The ownership module is untouched.
See [the receiver representation exception](WEBGPU_GBUFFER_SM200.md#sm-505-non-owning-background-receiver).

## User-requested development inspection preset

`renderTest=1&inspection=development` selects an explicit test-only view:

| Control | Development value |
| --- | ---: |
| Ambient fill | 0.55 |
| Flashlight range, logical pixels | 520 |
| Inner / outer half-angle | 50° / 75° |
| Flashlight intensity | 3 |
| Shadow lift | 0 |
| Contrast / saturation | 1 / 1 |
| Grade mix / vignette / grain | 0 / 0 / 0 |
| Bloom | off |

The beam uses existing supported control limits: about 2.1× normal range,
150° full outer width versus normal 60°, and 1.5× normal intensity. Exposure,
gamma and brightness are unchanged. Normal post processing still executes;
this is an explicit inspection configuration, not a raw bypass or production
rendering repair. Original fixture controls remain available as `inspection=none`.
Both backends receive the same preset, and reports retain all settings.

This preset follows the user's request to expose terrain and material faults
outside the ordinary dark beam. It does not alter production defaults or storage.
It is refused in benchmark mode and never supplies release/performance acceptance.

## Verification

- CPU tests exercise real receiver pipeline/load descriptors, exact integer
  ownership guard, neutral materials, nearest sRGB source, persistent cache,
  invalidation, compiler cancellation/errors/warnings and closed-entry refusal.
- Canonical CPU lighting controls prove cone-on, rotated-away and off response;
  the old empty-material input produces exactly zero raw lighting.
- The source-matched native receiver probe retains before/after/cone-control
  material, ID, shader-visible full depth and raw-lighting buffers. It requires
  global ID/depth identity and exact occupied material preservation, neutral
  background material, nonzero cone contribution and GPU/CPU error ≤0.003.
- Diagnostic readback/replay is never included in performance claims. Different
  source heads/configurations have separate directories and are never pooled.

Visible issue posts include the actual screenshot, observed symptom, suspected
cause, exact measured comparison or labelled visual criterion, and a targeted
human-review question when useful. Intended darkness and artistic preferences
are distinguished from missing material/lighting data.
