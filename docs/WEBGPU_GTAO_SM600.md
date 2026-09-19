# SM-600 — half-resolution GTAO prototype

SM-600 adds the first post-migration world/inter-surface ambient-occlusion producer. It is deliberately a **non-temporal correctness prototype**: half-resolution horizon sampling consumes the canonical SM-203 pseudo-depth hierarchy and calibrated Material-v2 normals, then reconstructs a full-resolution visibility field with depth/normal-aware weights before handing that field to the already-reserved SM-307 `gtaoVisibilityView` input.

This issue does not own target-hardware tuning, temporal accumulation, adaptive quality, SSGI or default-backend promotion. Those remain SM-601, SM-802, SM-602/603 and SM-505 respectively.

## Representation authority

GTAO does not create a private depth model. `WebGPUGTAO.sourceFromPaths()` requires `WebGPUDepthHierarchy.levelView(0)`, whose occupied pixels are the canonical SM-202 pseudo-depth resolved by SM-203. A stale/invalid hierarchy is rejected. Material normals come from the Material-v2 G1 buffer and are decoded from the existing `normal * .5 + .5` representation.

Local Material-v2 height is not treated as ownership depth. GTAO therefore cannot silently reinterpret G2.R or duplicate the SM-203 hierarchy.

## Half-resolution horizon pass

The raw pass runs at `ceil(width/2) × ceil(height/2)`. Each half-resolution sample chooses the corresponding full-resolution canonical depth/normal point and searches a bounded ring of directions/radii:

- default directions: **6**, bounded to 4–8;
- default steps per direction: **4**, bounded to 2–6;
- default full-resolution search radius: **12 logical pixels**, bounded to 4–24;
- no stochastic rotation, temporal history or previous-frame data in SM-600;
- empty/unowned source pixels remain fully visible;
- output is bounded to at least 0.15 visibility in the prototype so GTAO cannot become a replacement hard shadow.

The raw `rgba16float` texture stores visibility plus representative canonical depth/occupancy metadata for reconstruction. The pass is intentionally conservative and local: its job is machinery grounding and crease/intersection depth, not macro light visibility.

## Depth-aware reconstruction

A second compute pass reconstructs a full-resolution `r32float` visibility texture. Four nearby half-resolution candidates are weighted by:

1. canonical pseudo-depth agreement;
2. Material-v2 normal agreement;
3. spatial proximity.

This prevents reduced-resolution AO from bleeding across the large depth discontinuities used by foreground machinery. Debug output can show final visibility, occlusion (`1 - visibility`), the nearest raw half-resolution value, or reconstruction confidence.

## Material AO separation and SM-307 composition

Material AO remains **intra-object** information from Material-v2. GTAO is **inter-surface/world** occlusion. SM-600 does not multiply the two terms. The existing SM-307 composition contract uses strongest-occluder/min semantics for ambient AO evidence, so the fields cannot blindly compound toward black.

When GTAO is enabled, `recommendedVisibilityOptions()` supplies `materialAOStrength = 0.50` (down from the SM-307 standalone default 0.62) with `gtaoStrength = 1.0`. This keeps baked/intra-object AO subordinate when a world-space GTAO producer is present. Disabling GTAO produces exactly neutral visibility (`1.0`) and SM-307 can return to its pre-GTAO path.

`WebGPUGTAO.bindings()` exposes both `gtaoVisibility` and `visibility`; `WebGPUVisibilityComposition.sourceFromPaths()` already accepts that producer through the reserved GTAO interface introduced by SM-307.

## Deterministic fixtures

`tools/validate_webgpu_gtao.js` provides a CPU reference for the exact bounded horizon and reconstruction equations. It covers:

- a uniform plane that must remain unoccluded;
- a single box control whose adjacent floor gains grounding without bleeding through the box core;
- representative `box`, `bin`, `cabinet`, and `dense` overlap patterns;
- disabled-mode neutrality;
- bounded option clamping and material-AO policy.

The dense fixture must produce more world/inter-surface AO than the single-box control while remaining bounded away from black.

## Real-WebGPU gate

`webgpu-gtao-smoke.html` builds a real `depth32float` + object-ID fixture, runs the production SM-203 hierarchy, runs both SM-600 compute passes, reads the final visibility texture back, and compares it with the deterministic reference. It additionally verifies:

- finite bounded visibility;
- meaningful dense-scene occlusion;
- debug-view semantics;
- exact disabled neutrality;
- production SM-307 consumption of the GTAO texture with the reduced Material-AO recommendation;
- stale SM-203 hierarchy rejection.

The dedicated hosted workflow is correctness/API evidence only. It does **not** claim GTX 1650 SUPER timing or human visual sign-off. GPU performance stabilization and the working Medium budget of roughly 0.7–1.2 ms remain SM-601 acceptance work.

## Controls and diagnostics

The prototype exposes bounded controls for enabled state, direction count, sample steps, search radius, bias, depth scale, intensity, reconstruction depth sigma, reconstruction normal power and debug mode. Diagnostics report the full/half extents, active bounded settings, debug modes, material-AO policy, resource state and pipeline state. `temporalHistory` is explicitly `false` in the snapshot.

The intended visual result is subtle: adjacent machinery and dense intersections gain depth, while broad surfaces remain readable and the existing DSO/contact/self-shadow architecture remains authoritative for light visibility.
