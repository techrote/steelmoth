# Research, assumptions, and architecture decisions

This document separates sourced WebGPU facts from Steel Moth decisions and from assumptions that still require measurement.

## External research findings

### R-001 — WebGPU errors are asynchronous and contagious

**Finding:** WebGPU validation happens asynchronously; invalid objects can contaminate dependent calls. `GPUDevice.pushErrorScope()` / `popErrorScope()` capture scoped validation/internal/OOM errors, while `uncapturederror` is available for unexpected errors.

**Sources:**
- https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/pushErrorScope
- https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/popErrorScope

**Implementation consequence:** initialization, pipeline/resource construction and representative test frames must use explicit validation error scopes; an apparently created object is not proof of valid configuration.

### R-002 — shader compilation information is queryable

**Finding:** `GPUShaderModule.getCompilationInfo()` provides compiler messages including type, line/position and message text.

**Source:** https://developer.mozilla.org/en-US/docs/Web/API/GPUShaderModule/getCompilationInfo

**Implementation consequence:** every production WGSL module/entry point must have an automated compilation-info test. Warnings are recorded; errors fail validation.

### R-003 — optional features and texture capabilities require runtime negotiation

**Finding:** advanced format capabilities and query support can depend on adapter features; texture format usage has portability/performance constraints.

**Sources:**
- https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createTexture
- https://gpuweb.github.io/gpuweb/wgsl/
- https://gpuweb.github.io/types/interfaces/GPUTextureDescriptor.html

**Implementation consequence:** do not assume optional features. Inspect adapter features/limits and maintain documented core/fallback G-buffer configurations. Avoid adding alternate texture/view formats without measured need.

### R-004 — copyExternalImageToTexture has explicit destination constraints

**Finding:** destination textures must satisfy format, usage, dimensional and sample-count requirements.

**Source:** https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/copyExternalImageToTexture

**Implementation consequence:** atlas-upload tests must validate real production descriptors rather than assuming browser image uploads will work for arbitrary material formats.

### R-005 — WebGPU normalized device depth is application-oriented 0..1

**Finding:** WebGPU normalized device Z is 0..1. Which end is treated as near is determined by the application's projection, depth clear and comparison configuration. WGSL can write fragment depth explicitly through `@builtin(frag_depth)`.

**Sources:**
- https://gpuweb.github.io/gpuweb/#coordinate-systems
- https://gpuweb.github.io/gpuweb/wgsl/#frag-depth-builtin

**Implementation consequence:** Steel Moth can define a monotonic pseudo-depth key first, then map nearer/larger ownership keys to smaller 0..1 depth for a conventional `less` test without importing an OpenGL-style -1..1 assumption.

## Accepted architecture decisions

### ADR-001 — WebGPU is the primary future renderer

**Status:** accepted.

**Reason:** future architectural leverage. DSO, GTAO, SSGI, volumetrics, temporal history and GPU spatial structures should be implemented once on the intended long-term backend rather than duplicated in WebGL2 first.

**Consequence:** WebGL2 remains a compatibility renderer at approximately the current v1.2.x feature tier; future fidelity work is WebGPU-first.

### ADR-002 — raw WebGPU/WGSL, no renderer framework

**Status:** accepted requirement.

No Three.js, Babylon, Pixi, Phaser or equivalent renderer abstraction. Preserve direct control over resource formats, frame graph, synchronization, quality tiers and diagnostics.

### ADR-003 — representation correctness precedes shadow aesthetics

**Status:** accepted.

Per-pixel pseudo-depth/object ownership must be stable and light-independent before DSO/Dark Bloom visual tuning is considered authoritative. The bin screenshots showed that several shadow artifacts originate in ownership/segmentation, not merely insufficient filtering.

### ADR-004 — coherent cluster ownership beats duplicated “physical” wedges

**Status:** accepted.

For overlapping large props, one dominant cluster member owns the principal macro shadow body. Secondary members may thicken/extend structural occlusion and contribute soft residual occlusion, but do not each produce equal full-strength competing wedges.

### ADR-005 — secondary effects may run reduced resolution; primary ownership may not

**Status:** accepted.

Native-resolution/crisp data: albedo, object ID, primary depth/ownership and critical edges.

Candidates for half/quarter resolution: Dark Bloom, contact shadow, GTAO, SSGI, volumetric scattering and far DSO. Do not solve performance problems by globally reducing the scene render resolution before exhausting spatial/temporal/quality scaling of secondary effects.

### ADR-006 — one canonical scene/light/depth convention

**Status:** accepted.

Water, foliage, grass, dynamic sprites, static scenery, editor rendering and shadow systems consume the same light/depth/root conventions. Procedural subsystems may adapt presentation but must not invent independent “main light” vectors or incompatible material-space conventions.

### ADR-007 — target hardware and timing budget

**Status:** accepted target, not measurement.

GTX 1650 Super 4 GB at 1920×1080/60 is the primary reference. Programme targets are ≤12 ms mean renderer GPU and ≤14.5 ms p95. These values must be revisited only through a documented decision supported by measurements.

### ADR-008 — canonical pseudo-depth projection

**Status:** accepted by SM-201; production adoption is owned by SM-202.

Steel Moth reconstructs a light-independent pseudo-ground depth from the actual fragment raster Y and Material-v2 pseudo-world Z:

```text
projectedGroundY = fragmentScreenY + worldZ
visibilityKey = layer * 1024 + projectedGroundY + bias
```

Material-v2 normalized local height maps to `worldZ = clamp(localHeight,0,1) * 64`, matching the generator's global `MAX_WORLD_Z`. Static and dynamic sprites share layer 0; explicit ground/foreground/top contracts use -1/+1/+2 lanes respectively. Larger visibility keys are nearer. For WebGPU ownership, the accepted reference mapping is `depth01 = clamp((3072 - visibilityKey) / 5120, 0, 1)`, so conventional `less` testing selects the nearer fragment.

The equivalent shared-root form is `projectedGroundY = rootY + (fragmentScreenY-rootY) + worldZ`. This makes the SM-101 root the common placement authority without incorrectly using root Y alone as per-fragment depth. Rotation affects the actual raster position; horizontal flip affects UV/height sampling but not the root. Alpha-cutout fragments below the compatibility threshold produce no ownership depth.

**Consequence:** SM-202 must mechanically implement this model and its constants rather than inventing a backend-specific formula. Material-v2 G2.R remains local pseudo-height and must not be relabelled as ownership depth. Full derivation, ranges, edge cases, rejected alternatives and fixture prototypes are in `PSEUDO_DEPTH_MODEL.md`.

## Open research/decision questions

### Q-001 — exact pseudo-depth projection — resolved

Resolved by SM-201 / ADR-008. The accepted model is `fragmentScreenY + worldZ`, expressed from the shared root where needed, plus explicit layer/bias packing. Numeric vectors and box/bin fixture prototypes pin light-angle independence, vertical-face cancellation, subpixel monotonicity, alpha cutout, rotation/flip behavior and static/dynamic/foreground semantics. Production hardware depth/object ownership remains SM-202 scope.

### Q-002 — authoritative screenshot artifacts

The original `binsright`, `binsleft`, `binsupleft`, `binsup` and box reference screenshots are not yet in this repository. Recover and commit them if possible. Until then deterministic reconstruction fixtures can test structure but cannot replace human comparison to the original references.

### Q-003 — hardware/browser feature set

Chrome/Firefox support and adapter capabilities must be recorded from the real GTX 1650 Super target environment. Do not convert general browser documentation into a claim that the target machine exposes a given optional feature.

### Q-004 — G-buffer packing/precision

Start with explicit/debuggable formats (including XYZ normals and sufficiently precise height/depth). Later packing such as octahedral normal encoding is a performance optimization only after visual correctness and pass-level bandwidth measurements exist.

### Q-005 — compute vs raster per pass

WebGPU compute is not assumed to be faster. Each candidate compute conversion must be justified by dataflow/reuse or measured performance. Conventional fullscreen/render passes remain valid where they are simpler or faster.

**SM-801 measured submission corollary:** WebGPU render bundles are likewise not assumed to beat simple inline encoding. The Chrome/Firefox representative+dense A/B study in `WEBGPU_STATIC_SUBMISSION_SM801.md` rejects render-bundle adoption for the current SM-200 path: the renderer already emits at most five coarse instanced category draws, the proposed static/ground bundle failed the ≥10% CPU improvement criterion in three of four browser/workload rows, Firefox dense CPU encoding regressed, and hosted Chrome timestamp-query measurements regressed beyond the 3% GPU ceiling in both workloads. Production retains inline category batching; revisit only if the submission shape materially changes or later browser implementations change the measured trade-off.
