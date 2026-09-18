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
