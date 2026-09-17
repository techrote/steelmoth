# Steel Moth / The Small Machine at the Edge of Night — Webapp v1.2.2

## Why this release exists

v1.2.1 was packaged incorrectly as a patch overlay while still carrying the v1.2.0 service-worker cache/version contract. That made it impossible to treat a visual comparison as reliable: a registered PWA could continue using v1.2.0 assets, and the patch did not force Material-v2 atlas refreshes.

v1.2.2 is a complete release with a new cache namespace and cache-busted engine/material URLs.

## Directional-light consistency

- Restored the Material-v2 normal convention used by the generator and deferred light equations. The temporary v1.2.1 `n.y = -n.y` inversion was incorrect and has been removed.
- SurfaceFX water now uses the same world/screen convention: X is screen-right, the 3D lighting Y axis is screen-up, so screen-down gradients map consistently into the world normal field.
- SurfaceFX water now uses the current player/main-light XY rather than a hard-coded light vector.

## Gold / yellow light islands

Several independent factors could reinforce into the large warm islands visible in the supplied screenshots. v1.2.2 removes all of them:

- companion/follower point lights no longer use the warm Dusk-Rust `robot_faces` LUT channel;
- companion light defaults are reduced from 84 px / 0.22 to 56 px / 0.07 and use the cool `fx_creature` light colour;
- oxidised/painted floor materials are regenerated as rougher and much less metallic, while exposed/bare details can still rise spatially toward metal;
- direct PBR response is gently compressed before the 8-bit scene target to prevent individual channels from clipping into flat yellow regions;
- SurfaceFX water now refracts the already-lit deferred scene, is visibility-gated, and is explicitly capped so it cannot become substantially brighter than the underlying scene.

## Long-throw / green shadow aliasing

- In Material v2, the player flashlight no longer participates in the legacy macro projected-shadow extrusion.
- Flashlight object/inter-object shadows are now owned by the pseudo-depth self-shadow/contact-shadow architecture.
- Default pseudo-depth self-shadow trace range is increased from 84 to 176 logical pixels.
- Macro shadows remain for secondary point lights, but their mask is rendered at 2× scene resolution and linearly reconstructed.
- Legacy mode retains the old flashlight macro-shadow path for A/B validation.

## Deployment/cache correctness

- service-worker cache: `small-machine-web-v1.2.2-r1`;
- engine scripts use `?v=1.2.2` URLs;
- service worker is registered as `sw.js?v=1.2.2` with `updateViaCache:'none'`;
- runtime atlas/material PNGs are loaded with an explicit `?v=1.2.2` cache-buster;
- fresh graphics namespace: `signalOrchardGraphicsV122`;
- gameplay save namespace is unchanged.
