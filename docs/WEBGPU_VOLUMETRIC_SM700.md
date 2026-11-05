# SM-700 — bounded non-temporal scattering correctness reference (partial)

**Scope/status:** A fixture-only, disabled-by-default CPU reference for issue #39. This is **not** a WebGPU production pass, normal-game presentation feature or SM-700 acceptance. It does not alter the renderer default, cache, gameplay or existing resources.

## Authority and inputs

The reference in engine/webgpu_volumetrics.js consumes an **SM-204 normalized player cone** (position, direction, radius, innerCos, outerCos, intensity), and requires same-frame full-resolution **SM-203 level-zero depth ranges** (rg32float pair semantics with (1,0) empty), nonzero object IDs, an explicit **SM-300/DSO macro-occluder mask**, and a **per-cone DSO visibility field**. It does not invent a private pseudo-depth convention or treat arbitrary floor pixels as macro occluders. The actual mapping of these authorities into a production GPU pass is not yet implemented.

The oracle uses 4× downsampling with ceil extents and center samples; 12–20 midpoint low-frequency dust-density samples; smooth cone and range falloff; and a conservative full-resolution supercover occlusion trace so that thin blockers are not skipped by sparse rays. A positive depth range and nonzero object ID block only when the accepted macro-occluder mask also flags the pixel. Per-cone DSO visibility zero yields exact zero scattering.

This planar shadow test is a **deterministic visibility oracle**, not an approved physically accurate volumetric transport or full three-dimensional self-occlusion model. Its per-quarter-pixel CPU traversal is intentionally limited to at most 512×512 fixture inputs (both axes independently bounded, not just pixel area) and **must never be placed in a gameplay frame loop**. The exported supercover ray helper treats non-finite coordinates and out-of-bounds origins as blocked, including zero-length rays, rather than silently reporting clear space. For nonzero horizontal or vertical rays exactly coincident with a pixel boundary, both adjoining rows or columns are checked: the line continuously touches pixels on both sides, so testing only the floored row/column would miss legitimate macro occluders.

The reference returns a quarter-resolution Float32Array and a blocked mask. Disabled output is exact zero, strength and density are bounded, and scattering cannot exceed 0.12. No temporal accumulation, resource allocation or gameplay effects are introduced. GPU-frame cost and renderer-memory delta are **unmeasured**, not zero.

## Verification

Run the standalone Node regression:

    node tools/validate_webgpu_volumetrics.js

It is also registered in normal tools/run_checks.py and the clean-package extraction gate. Fixtures cover odd dimensions, empty air, macro-occluded wall, single-pixel/diagonal/corner supercover, unclassified material, empty depth range, per-light DSO zero and fractional visibility, cone rotation, outside-cone rejection, default/off/zero-strength neutrality, output bounds, deterministic repeats, non-mutation, and fail-closed invalid inputs.

**Not tested:** WGSL compilation, real WebGPU submission/readback, Chrome/Firefox visuals, full image fixture corpus, physical GTX 1650 SUPER timing/memory, life-cycle/resize/device loss, and normal-game presentation.

## Required next work (issue #39 remains open)

1. Establish source-matched *combined* GPU frame headroom after SM-603 on target hardware. Isolated SSGI pass timing alone is not a free whole-frame volumetrics budget.
2. Verify that the production runtime can expose exact authoritative macro-occluder classification and **per-light** DSO visibility. Do not silently substitute post-composition global visibility.
3. Implement an optional **off-by-default** quarter-resolution raw WGSL pass reusing SM-204 lights, SM-203 depth and adopted DSO authority, with no temporal history initially.
4. Add required real-WebGPU and visual fixtures for clear air, walls, bins, corner, foliage, moving player cone, invalidation and disabling. Do not imply numerical CPU/GPU equality without an explicit parity policy.
5. Qualify visuals, full-frame hardware GPU/memory and fallback before any Medium/default enablement decision. Preserve release gate #50 and PR #118 ownership.
