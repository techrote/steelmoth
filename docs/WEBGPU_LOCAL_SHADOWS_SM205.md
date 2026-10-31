# SM-205 WebGPU local self-shadow and contact-shadow parity

Status: **implemented as staged WebGPU visibility passes; final multi-shadow composition remains owned by SM-307**.

## Authority and scope

SM-205 ports the accepted v1.2.3 local Material-v2 height self-shadow and short-range contact-shadow roles to WebGPU. These passes are renderer-only visibility data. Gameplay, collision, objectives, save state, DSO state and world simulation never read them.

This issue deliberately does **not** implement DSO macro shadows, Dark Bloom, GTAO, SSGI, volumetrics, transparent ordering or final bounded shadow composition. Those remain in their assigned tasks.

## Quality/sample contracts

The compatibility quality tiers are explicit and capped:

- self-shadow quality 0/1/2/3/4 → **0/8/12/16/28 samples**;
- contact-shadow quality 0/1/2/3 → **0/4/8/12 samples**;
- at most 8 relevant self-shadow lights are considered;
- self-shadow trace distance remains bounded to the configured compatibility range;
- contact-shadow distance remains clamped to **4–36 logical pixels**, with the normal runtime default still 20 px.

The player cone is prioritized for local visibility when present. Remaining self-shadow candidates are selected deterministically by relevance, using the canonical SM-204 light records rather than inventing another light representation.

## Local height semantics

Both passes trace **Material-v2 local height** from G2.R, converted with the retained 64-unit pseudo-height scale and the current `heightStrength` setting. This is the same role as the accepted WebGL2 path.

SM-203's shared hierarchy stores canonical SM-202 **ownership depth**, not local Material-v2 height. SM-205 therefore does not substitute hierarchy values into these compatibility traces: doing so would change the meaning of the effect. The module records this explicitly in diagnostics. Later work may use the hierarchy only for conservative culling/skip decisions that can be proved not to change local-height results.

## Self-shadow pass

`engine/webgpu_local_shadows.js` creates a persistent full-resolution `r16float` self-visibility texture `sm205:self`.

For each covered Material-v2 pixel and selected light, the pass:

1. reconstructs the current local pseudo-Z from G2.R;
2. traces toward the canonical light position over the bounded configured distance;
3. applies the retained deterministic pixel/light jitter;
4. skips uncovered G-buffer samples;
5. compares sampled local height against the interpolated ray height plus compatibility bias;
6. exits early on the first qualifying local occluder;
7. keeps the minimum bounded visibility across selected lights.

The compatibility occluded visibility range remains deliberately soft and local rather than becoming a second macro-shadow mechanism.

## Contact-shadow pass and depth-aware reconstruction

### Shared light-buffer queue ordering

Self and contact retain the single canonical light buffer. The self encoder is
submitted **before** `queue.writeBuffer()` replaces its selected-light payload
with the contact driver; contact/reconstruction use a second encoder/submission.
Both submissions remain queue ordered, with no intervening CPU completion wait.
The optional final `wait` still waits once after all local-shadow work. Disabled
outputs retain their existing neutral clears and allocate no extra light buffer.

The former single encoder was submitted only after both buffer writes, so its
self pass could read the contact-only payload while reporting multiple selected
self lights. A deterministic queue model retains that failure witness. Earlier
physical outputs remain source-separated evidence; this ordering repair requires
fresh native numeric validation and does not establish a timing improvement.

The raw contact pass renders to persistent half-resolution `r16float` texture `sm205:contact`. It uses the compatibility 4/8/12 sample families, player-cone-first contact driver selection, the configured short trace distance and the compatibility bias relationship (`selfShadowBias × 0.70`, clamped).

A separate full-resolution `sm205:contact-visibility` pass performs the retained **3×3 depth-aware reconstruction**. Neighbor weights decay exponentially with G2 local-height disagreement and the center tap receives double weight. The configured `contactShadowStrength` is applied only during this reconstruction, producing a 0..1 visibility field ready for later bounded composition.

The default contact path is intentionally incapable of producing long macro throws. The real-WebGPU fixture checks that a 20 px range cannot reach an occluder beyond that range while an explicit 36 px setting can.

## Debug/readback contract

Independent debug/readback views are exposed for:

- `self-shadow` — full-resolution local self visibility;
- `contact-shadow` — full-resolution depth-aware reconstructed contact visibility.

The raw half-resolution contact-occlusion texture is also available for diagnostics. Self and contact can each be disabled; disabled passes clear to fully visible output and do not mutate any gameplay or DSO state.

## Validation fixtures

Deterministic Node tests pin:

- the exact self/contact quality/sample tables and caps;
- cone/strong-light selection;
- local-height self-occlusion and early-exit behavior;
- eight 45° light directions;
- short-range contact-distance behavior;
- depth-aware reconstruction rejection across large local-height discontinuities;
- fully visible disabled outputs;
- gameplay-state non-authority.

The required hosted WebGPU gate uses production Material-v2 controls `cargo_crate`, `rust_barrel`, `server_cabinet`, and `hex_maintenance_idle_0` across all eight 45° light directions. A deterministic synthetic local-height step is rendered through the same production WGSL to prove actual self occlusion, short-range contact occlusion, contact-distance extension, disabled masks, and readback.

## Timing evidence boundary

SM-205 records CPU submit/wait wall time only when no GPU timestamp query is used. Diagnostics expose `gpuMs: null` rather than mislabeling CPU time as GPU time. This is initial execution evidence, not GTX 1650 Super performance acceptance. Target-hardware timing remains owned by SM-003/SM-500/SM-501.

## Composition boundary

SM-205 outputs local visibility fields. It does not blindly multiply them into every other visibility term and it does not own DSO/Dark Bloom/AO state. SM-307 remains responsible for bounded visibility composition so dense industrial geometry cannot be independently darkened by several unrelated terms to near black.


## SM-505 native extent unit conversion

**Decision:** `settings.worldScale` is a renderer-derived conversion shared with
SM-204, defaulting to 1 and bounded to 1/16–16 for finite positive inputs. Apply
ordinary artistic clamps first, then convert material height, trace distance,
bias, near-light cutoff and contact smooth transition width into native units.
The contact fallback light elevation is converted too. This preserves the
configured 4–36 logical-pixel contact range and self trace limits rather than
reinterpreting those limits as native pixels. Quality tap counts are unchanged.
The existing 48-byte frame uses its previously unused final word for float scale
bits; self/contact WGSL reads that word with `bitcast<f32>`.

The previous 3× presenter combined scaled light coordinates with unscaled HM
height, 176-native-pixel self reach and 20-native-pixel contact reach. That was a
unit mismatch, not an approved shortening of shadow quality. The conversion
restores corresponding geometry. Sample hash coordinates are converted back to logical units before jitter, so
corresponding logical sample positions retain their authored pattern. Different
raster sample grids and nearest material sampling still prevent a promise of
byte-identical masks across extents. The 3-logical-pixel contact smooth transition and
1/2-logical-pixel near cutoffs scale with the same conversion.

CPU reference and packed-frame checks are in
`tools/validate_sm505_native_units.js`; actual changed-source GPU compilation and
readbacks remain necessary for native correctness evidence.


## Optional single-light self-shadow reconstruction (SM-505)

**Decision:** SM-505 may opt in to spatial reconstruction of one selected raw
self-shadow driver. This addresses sparse trace aliasing as a WebGPU quality
improvement; reproducing WebGL2 shadow lengths, shapes or noise is not its target.
The accepted raw default path and its quality tap counts remain available.
`initializeSelfReconstruction()` compiles the optional shader under the caller's
validation scope and allocates one persistent full-extent R16float target
(4,147,200 bytes at1920x1080), reused across drivers and frames. There is no
additional trace, temporal/history field, light buffer or per-frame texture.

The render option is `render(gbuffer, scene, settings, {reconstructSelf:true})`.
It requires exactly one selected self light and enabled self samples. The raw
self commands submit first. Reconstruction submits next, while the shared
canonical buffer still contains that driver's record. Only then may contact
replace that canonical buffer and submit its existing work. No CPU wait is
inserted. `selfTexture()` selects the filtered result only after an opted-in
invocation; a subsequent default/global invocation selects raw again.
`rawSelfTexture()` always exposes the raw texture and `reconstructionTexture()`
returns the optional persistent target or null. Diagnostics retain invocation
count and the last reconstructed driver's canonical identity.

For raw occlusion `o=1-selfVisibility`, one symmetric 3x3 diffusion step is:

```text
o'(p) = o(p) + sum_q weight(p,q) * (o(q) - o(p))
axial base weight = 2/16; diagonal base weight = 1/16
weight(p,q) = baseWeight * min(aliasStrength(p), aliasStrength(q))
```

Native offset stride is `max(1, round(worldScale))`. Reject out-of-bounds pairs;
do not clamp/repeat their neighbor coordinates. Reject a pair unless both ends
are covered, have identical exact object IDs, differ by at most1 logical world
pixel in decoded material height and at most1.5 logical depth-key units
(`abs(depthP-depthQ)*5120`). Both ends must also lie inside the existing canonical
point radius or cone radius/outer angle. All gates are symmetric, so rejected
weights remain at their original centre and the accepted operator conserves
occlusion mass in real arithmetic. Its total neighbor weight is at most3/4,
keeping the result inside the original visibility range. R16float storage adds
quantization; native readbacks must characterize its mass error separately.

Alias strength uses the existing traced step length in logical units:
`min(lightXYdistance, maxSelfSpan)/(worldScale * tapCount)`. Smoothstep transitions
from0 at6 world pixels to1 at12 world pixels; the min of both endpoints preserves
symmetry and protects nearby thin vegetation with finer trace steps. These
values are explicit algorithm quality choices, not artistic brightness controls
or claims of measured visual acceptance. Ambient, emissive, contact, DSO and the
canonical material defaults remain unchanged.

`selfReconstructionReference(input, canonicalLight, settings)` is the independent
CPU replay interface: input contains width/height and equally sized visibility,
objectIds, coverage, heights (encoded local HM) and depth (canonical depth01)
arrays. `tools/validate_sm505_self_reconstruction.js` checks constants, range,
mass conservation, symmetric rejected boundaries, canonical light support,
near protection, thin shadow survival, white-noise frequency reduction, real
resource descriptors/queue ordering and pending compiler cancellation. A retained
nonsymmetric negative witness demonstrates mass drift. This CPU evidence is not
WGSL execution, GPU timing or human visual acceptance; source-matched native raw
and filtered captures are required before accepting the quality change.
