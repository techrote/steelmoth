# Steel Moth Material v2 — Performance Report v1.2.0

## Bounded architecture

The v1.2.0 renderer deliberately spends available GPU budget on bounded screen-space work rather than CPU simulation or per-sprite draw multiplication.

- G-buffer material sprites are rasterized through batched dynamic buffers.
- Material fields are sampled with coordinate-identical atlases.
- self-shadow march has fixed compile-time maximum 28 samples;
- contact shadows use a half-resolution target;
- only a configured subset of lights performs expensive self-shadowing;
- transparent G-buffer pixels exit deferred shading immediately;
- height traces skip uncovered G-buffer samples and early-out on the first strong blocker;
- render targets are persistent and recreated only on framebuffer resize;
- static material descriptors are rebuilt only with the room/static background.

## Default work budgets

```text
Self-shadow quality:       2
Self-shadow samples:       12
Self-shadowed lights:      2
Self-shadow max distance:  84 logical px
Contact-shadow quality:    2
Contact-shadow samples:    8
Contact distance:          20 logical px
```

Quality controls allow self-shadow 0/8/12/16/28 and contact 0/4/8/12 samples.

## Material-buffer memory

At 1920×1080 with float colour-buffer support:

```text
G0 RGBA8                         7.91 MiB
G1 RGBA16F                      15.82 MiB
G2 RGBA16F                      15.82 MiB
-----------------------------------------
MRT G-buffer                    39.55 MiB
Half-res contact RGBA8           1.98 MiB
Deferred scene copy RGBA8        7.91 MiB
-----------------------------------------
Material-v2 working set         49.44 MiB
```

If RGBA16F MRT is unavailable, G1/G2 use RGBA8:

```text
MRT G-buffer                    23.73 MiB
Contact + deferred copy          9.89 MiB
-----------------------------------------
Fallback material working set   33.62 MiB
```

These figures exclude pre-existing scene/light/shadow/bloom targets and atlas textures.

The previously allocated unused half-resolution `contactTemp` scratch target was removed before release.

## GPU timer instrumentation

When `EXT_disjoint_timer_query_webgl2` is available the runtime records GPU timings for:

```text
gbuffer
contactShadow
directLighting
```

Height self-shadowing is part of `directLighting`, so diagnostics expose:

```text
heightSelfShadow = null
heightSelfShadowNote = "integrated in directLighting GPU pass"
```

This avoids presenting an invented split that cannot be measured without separating the lighting pass.

## Validation hardware/environment

Production GLSL and MRT compatibility were exercised using:

```text
OpenGL ES 3.2 Mesa 25.0.7-2
llvmpipe (LLVM 19.1.7, 256 bits)
surfaceless EGL
```

All 26 production shader programs compile and link, and both the preferred mixed RGBA8/RGBA16F MRT and all-RGBA8 fallback framebuffer are complete.

The managed Chromium environment used for automation exposes neither WebGL1 nor WebGL2, even with attempted software-GL flags, so no browser FPS or GPU-ms claim is fabricated here. Runtime timer instrumentation is present for target hardware measurement.

## CPU/material-build cost

Material atlas generation is an offline deterministic tool operation. Per-frame runtime material generation is zero. Static room material descriptors are retained; dynamic descriptor upload is bounded by visible sprites already participating in the existing renderer.

## Expected scaling

The dominant new runtime costs scale with framebuffer pixels and selected sample counts, not total atlas content:

```text
G-buffer cost     ~ visible material pixels
Deferred light    ~ covered screen pixels × active lights
Self shadow       ~ lit material pixels × selected self-shadow samples/lights
Contact shadow    ~ half-resolution covered pixels × contact samples
```

The user can disable self-shadowing/contact shadows or reduce their quality independently without changing gameplay, collision or AI.
