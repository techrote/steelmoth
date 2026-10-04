# SM-602 — bounded diffuse SSGI prototype

## Requirement and scope

Issue [#37](https://github.com/techrote/steelmoth/issues/37) adds a restrained,
quarter-resolution diffuse screen-space indirect prototype after accepted
SM-500, SM-502 and SM-601. It adds no glossy GI, gameplay dependency or default
enablement. Stabilization and target quality characterization belong to
SM-603; normal renderer promotion remains the separate SM-505 gate.

The producer is `engine/webgpu_ssgi.js`. The executable fixture and diagnostic
views are `webgpu-ssgi-smoke.html`. Both consume canonical renderer data;
the fixture does not redefine sprite placement, ownership or light authority.

## Decision — one depth and temporal convention

The pass consumes valid SM-203 `rg32float` occupied min/max levels, then refines
candidate hits against level 0 and the canonical object ID. Empty ranges use
the shared `(1, 0)` sentinel. It creates no depth pyramid. Ray work, distance
and quality are bounded. The output extent is `ceil(width/4)` by
`ceil(height/4)`, including odd edges.

Material-v2 normals and G2 height/metalness retain their existing numeric
meaning. Pseudo-depth reconstruction uses SM-201 constants and the implemented
SM-202 framebuffer-Y ownership convention; an object in an explicit foreground
layer cannot become a bounce donor for a world-layer receiver merely because
it overlaps in screen space. Layer inference assumes ordinary fine bias is
less than half the canonical 1024-unit lane. Extreme bias overrides are not a
validated prototype case.

SSGI reuses SM-601's depth/object/normal compatibility thresholds and global
room/device/backend rejection. Camera changes and light discontinuity epochs
additionally invalidate the colour-dependent history through `cameraRevision`
and `lightRevision`. There is no motion-vector reprojection in this prototype:
callers must change the camera revision when the camera changes. A light
revision denotes an abrupt incompatible change, rather than a per-frame
upload counter; smooth radiance changes use validated previous-frame resolved
colour and bounded temporal accumulation.

Both the receiver history and sampled donor colour must remain compatible
with current geometry. Cold, invalid, resized or reset history contributes no
indirect light. History values are effect-specific; the validity policy is
shared. The accepted measured GTAO WGSL remains unchanged.

## Decision — linear colour, diffuse addition and feedback boundary

Resolved colour input is linear HDR before bloom, grade, tone mapping and the
display transfer. It is resolved **before this SSGI addition**. The pass saves
that input for the next frame; its own composed output is never its colour
source. This contract prevents recursive indirect feedback.

The quarter buffer stores incident diffuse irradiance. Energy and saturation
are constrained on that raw contribution; energy is clamped again after
neighborhood/delta-constrained history reuse. Full-resolution composition
applies each receiver texel's own G0 albedo and G2 non-metal diffuse weight,
so adjacent material subregions never inherit the quarter-center material;
there is no glossy lobe. Composition adds the bounded diffuse result to a
separate linear HDR target using geometry-aware quarter-resolution support.
It does not rewrite direct lighting, shadows, ownership, material textures or
game state. Disabling SSGI yields zero indirect and preserves resolved direct
colour in the composed target at its existing storage precision.

## Prototype API and controls

`new WebGPUSSGI({device, width, height})` is disabled by default.
`sourceFromPaths(sharedHierarchy, canonicalGBuffer, directResolvedColourView)`
constructs the canonical source, including pixel scale `width/640`.
`update(source, {enabled: true, quality, meta})` explicitly enables a preset;
`enabled: false` and Low both select the neutral output. Quality changes
invalidate previous colour/history. The fixture automates these controls;
they are not wired into normal gameplay.

| Quality | Rays | Steps | Logical radius | History weight | Enablement |
| --- | ---: | ---: | ---: | ---: | --- |
| Low | 4 | 4 | 16 | 0 | Always off |
| Medium | 4 | 6 | 24 | 0.85 | Explicit prototype option |
| High | 6 | 8 | 32 | 0.88 | Explicit prototype option |
| Ultra | 8 | 8 | 40 | 0.90 | Explicit prototype option |

Every tier remains quarter resolution. Overrides are clamped to 4–8 rays,
4–8 steps and radius 8–48; each step performs at most three fine checks.
Default strength is 0.12, donor limit 1, incident energy cap 0.08,
luminance-mix saturation 0.35 and temporal delta cap 0.025. These are prototype
decisions, not measured optimum settings. Depth/normal validity remains the
adopted shared SM-601 policy rather than a tier-specific convention.
`bindings()` exposes raw/indirect/rejection quarter views and native composed
colour. `readback()` is an explicit diagnostic operation; normal updates
perform no mapping or host wait. `resize`, `invalidate`, `resetDevice` and
`close` preserve the shared lifecycle contract.

## Verification and evidence boundaries

```text
node tools/validate_webgpu_ssgi.js
node tools/validate_sm602_ssgi_lifecycle.js
python tools/validate_webgpu_ssgi_browser.py --report artifacts/webgpu-ssgi-browser.json --out artifacts/webgpu-ssgi
python tools/run_checks.py --report artifacts/core-checks.json
python tools/validate_clean_package.py --report artifacts/clean-package.json
```

The browser gate executes production WGSL/pipelines under validation scopes,
reads actual indirect/composed/debug buffers, and retains labelled colour-bounce,
clamp and rejection comparisons. Fixtures cover bright versus dark donors,
dense geometry, discontinuities, moving light/objects, cold/disabled history
and odd extents. Deterministic tests exercise bounds and shared validity.
Deferred-compilation mocks exercise single-writer history, resize/reset/loss,
explicit invalidation, failed submission and persistent resource bounds.

Optional GPU query samples are initial prototype measurements only. Reports
retain browser/adapter/driver identity, source hashes, warm-up/sample windows
and the exact command coverage. CPU callback or mapping duration is never GPU
time. Software adapters provide correctness evidence, not target performance.
No final human art-direction or SM-603 stabilization claim follows from a
numeric readback or hosted CI pass.

Measured results and any remaining acceptance blocker are recorded in
`SM602_PROTOTYPE_REPORT.md` at the verified candidate checkpoint.
