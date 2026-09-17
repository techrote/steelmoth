# v1.2.3 — SurfaceFX / Foliage Lighting Root-Cause Audit

## Why v1.2.2 still looked almost identical

The large yellow regions visible in the user screenshot were not point lights, water, cached shaders, or Material-v2 PBR highlights.
They were the procedural **Fine GrassField** itself.

The v1.2.2 runtime built the fine grass palette from:

```text
base      = far_forest @ 176
tip       = far_forest @ 250
highlight = tree_lights @ 244
```

Those elements belong to the default **Dusk Rust** WORLD/MATERIALS palette. Their source colours are:

```text
far_forest[176] = #755F40
far_forest[250] = #B98E52
tree_lights[244] = #BE9153
```

Pixels sampled from the bright yellow region in the supplied screenshot have median RGB approximately:

```text
200, 169, 102
```

That is exactly the expected post-exposure range of the Dusk Rust amber grass palette.

The GrassField fragment shader also had no scene-light input and emitted nearly/fully opaque blades:

```text
alpha ≈ 1.04 + 0.24 * tint
```

Hundreds of overlapping blades therefore formed an opaque amber mass independent of the Material-v2 flashlight.
This is why changing point-light colours, water lighting, normal orientation and service-worker identity did not materially change the screenshot.

## Fix

### Fine GrassField

v1.2.3 now uses the EFFECTS/Wet Relay vegetation-compatible palette:

```text
base      = fx_creature @ 82   -> #1E3D40
 tip      = fx_creature @ 148  -> #39686A
highlight = fx_water @ 190     -> #558B89
```

The procedural field now:

- samples the already-lit Material-v2 scene beneath each blade;
- follows the current player/main light direction;
- receives only a small highlight proportional to actual scene visibility;
- caps per-blade alpha at 0.42;
- uses narrower and shorter blades so overlap does not form opaque rectangular masses;
- retains the Fine GrassField feature and its wind/interaction behavior.

### FoliageFX

FoliageFX previously remained a forward-lit island even in the Material-v2 pipeline.
v1.2.3 now:

- samples the lit Material-v2 scene for local light visibility;
- uses the Material-v2 normal/roughness atlas when that pipeline is active;
- preserves the legacy bump derivative only for legacy-renderer fallback;
- uses the same `delta.x, -delta.y, +Z` light-vector convention as the deferred renderer;
- handles flipped foliage normals explicitly.

### Long-throw hard-light edge quality

The hard flashlight visibility profile was only:

```text
quality 3: 65 cone rays / 97 omni rays
```

At a 248 px cone throw this can exceed several screen pixels between angular samples near the outer range, producing visible stepped edges.

v1.2.3 raises the quality tiers to:

```text
quality 1:  49 cone /  65 omni
quality 2:  97 cone / 129 omni
quality 3: 193 cone / 257 omni
```

At quality 3 the 60° visible cone is sampled at about 0.3125° intervals, approximately 1.35 logical pixels of lateral spacing at maximum throw before interpolation.
The existing 2× macro-shadow mask is retained.

## Local-preview cache behavior

On `localhost` / `127.0.0.1`, v1.2.3 deliberately unregisters old service workers and deletes `small-machine-web-*` caches.
The Python/BAT preview path therefore runs uncached during development.
HTTPS/static deployments continue using the versioned offline service worker.

## Regression coverage

`tools/validate_v123_surface_coherence.py` prevents the specific regression by checking:

- no `far_forest/tree_lights` Fine GrassField palette in the runtime path;
- lit-scene sampling in GrassField;
- alpha cap and removal of the old over-opaque formula;
- Material-v2 normal and scene-light use in FoliageFX;
- consistent screen/world light-vector convention;
- 193/257 quality-3 visibility ray counts.
