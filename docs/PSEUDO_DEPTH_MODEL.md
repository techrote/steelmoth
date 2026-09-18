# Canonical pseudo-depth projection model

Status: **SM-201 accepted model; production depth writes remain deferred to SM-202**.

## Purpose

Steel Moth needs one light-independent fragment-ownership depth for overlapping Material-v2 sprites. The model must use the shared SM-101 root/foot authority, preserve the Material-v2 world-height semantics established by the generator/SM-200, remain deterministic under editor/runtime placement, and be expressible directly in WebGPU without teaching static, dynamic, foreground, editor or shadow paths different formulas.

The executable reference is `engine/pseudo_depth.js`, schema `steelmoth-pseudo-depth/v1`. It is a research/reference module in SM-201. `engine/webgpu_gbuffer.js` intentionally keeps `depthWriteEnabled:false` and `depthCompare:'always'`; SM-202 is the production implementation owner.

## Coordinate model and units

Steel Moth uses the fixed logical 640×360 screen/world convention already consumed by the game and renderer:

- +X points right;
- +Y points down the screen and toward the viewer in painter-order terms;
- the SM-101 sprite root is the unrotated ground-contact/order point;
- pseudo-world +Z points upward;
- one pseudo-world Z unit projects to one logical screen Y pixel (`Z_TO_SCREEN_Y = 1`).

The projection is the orthographic pseudo-world relation

```text
fragmentScreenY = projectedGroundY - worldZ
```

and therefore

```text
projectedGroundY = fragmentScreenY + worldZ
```

This is the key result. A standing vertical face whose raster position rises by 20 logical pixels while its pseudo-world Z rises by 20 units reconstructs the same ground-depth coordinate. A horizontal/top surface can legitimately produce varying reconstructed ground depth because its screen-Y and Z relation differs.

The same relation can be written explicitly from the shared root:

```text
localFromRootY = fragmentScreenY - rootY
projectedGroundY = rootY + localFromRootY + worldZ
```

The root therefore defines the common placement origin, while actual per-fragment raster position and Material-v2 Z determine the ownership coordinate.

## Material-v2 world Z

`tools/generate_material_v2.py` defines one global world-height encoding with `MAX_WORLD_Z = 64.0`. The source HM atlas stores:

```text
R = world pseudo-Z / 64
G = material AO
B = metalness
A = emissive/material auxiliary
```

SM-200 writes the compatibility-scaled/clamped local height into G2.R. SM-201 interprets that normalized local height as:

```text
worldZ = clamp(localHeight, 0, 1) * 64
```

No extra per-renderer height curve is permitted. Material generation/classification remains the authority for the shape of pseudo-Z, and the existing SM-200 compatibility height factor remains the authority for render-scale adjustment.

## Visibility key

Ownership is first defined in an abstract monotonically increasing key where **larger means nearer/in front**:

```text
projectedGroundY = fragmentScreenY + worldZ
visibilityKey = layer * 1024 + projectedGroundY + bias
```

`bias` is an explicit fine depth bias in logical-depth units. It defaults to zero and must be data/contract driven; it is not a hidden per-backend fudge factor.

### Default layer lanes

| Render category | Layer | Meaning |
| --- | ---: | --- |
| `ground` | -1 | always behind ordinary world ownership |
| `static` | 0 | ordinary world geometry |
| `dynamic` | 0 | ordinary world geometry; no category advantage over static |
| `foreground` | 1 | explicit foreground copy/layer |
| `top` | 2 | formal overlay lane; normal top/UI presentation may remain outside ownership depth |

Static and dynamic deliberately share the same lane. The purpose of SM-201 is to replace category/painter ownership with geometry where possible, not encode the old draw order into hardware depth. Foreground remains an explicit separate visibility contract because those copies are intentionally forced in front.

`LAYER_STRIDE = 1024` is larger than the complete fixed-camera world-depth span (`screen Y 0..360` plus `worldZ 0..64` and normal fine bias), so lanes cannot cross accidentally.

## WebGPU depth mapping

WebGPU normalized device depth is 0..1. The reference model maps the visibility key into a conservative fixed range:

```text
DEPTH_KEY_MIN = -2048
DEPTH_KEY_MAX = 3072

depth01 = clamp((3072 - visibilityKey) / 5120, 0, 1)
```

Nearer/larger visibility keys therefore produce smaller `depth01`, suitable for a conventional `less` comparison in SM-202. The generous range leaves room around the current ground/world/foreground/top lanes without tying the formula to framebuffer resolution.

The WebGPU specification defines NDC depth as 0..1 and leaves near/far interpretation to the application through projection/depth comparison. See <https://gpuweb.github.io/gpuweb/#coordinate-systems> and WGSL `frag_depth` at <https://gpuweb.github.io/gpuweb/wgsl/#frag-depth-builtin>.

## Coverage and alpha cutout

Ownership exists only for a covered fragment. The model uses the Material-v2 compatibility cutoff:

```text
if sourceAlpha < 0.12:
    no ownership depth is produced
```

SM-202 must perform the same discard before writing depth/object ID. Transparent atlas padding therefore cannot occlude another sprite.

## Local sprite position, rotation, flip and subrects

The fragment screen position is the actual rasterized position of the sprite quad. For a normalized local coordinate `(u,v)` in a draw rectangle:

```text
local = ((u - 0.5) * width, (v - 0.5) * height)
fragmentScreen = drawCentre + rotate(local, rotation)
```

The SM-101 root itself does not rotate or move under horizontal flip. That accepted placement rule remains authoritative.

Horizontal flip mirrors atlas U when selecting albedo/material samples; it does not move the fragment geometry or root. If an asymmetric height map is flipped, the sampled `localHeight` changes because the UV changes, not because the ownership formula has a flip branch.

Subrects use the SM-101 reconstructed full-sprite root and the visible subrect's actual raster position. No alternate subrect depth origin is introduced.

## Representative invariants

The committed numeric vectors in `render-tests/pseudo-depth/vectors.json` pin these cases:

- root contact: `(screenY=180, Z=0) -> projectedGroundY=180`;
- vertical mid-face: `(screenY=160, Z=20) -> 180`;
- vertical top-face: `(screenY=120, Z=60) -> 180`;
- a root moved from 180 to 181 moves ownership monotonically by +1;
- a +0.25 subpixel placement moves the key by exactly +0.25;
- a foreground fragment at Y=40 remains in front of an ordinary world fragment at Y=400 because lane separation is explicit;
- alpha below 0.12 produces no ownership depth.

The reference test also checks a rotated fragment, flip geometry invariance, static/dynamic lane parity, depth-range mapping and light-angle independence.

## Box/bin overlap prototype

`tools/validate_pseudo_depth.js` evaluates the committed `binsright`, `binsleft`, `binsup`, `binsupleft` and `box-pair` fixtures. It writes:

- `artifacts/pseudo-depth-debug.json` — numeric per-object prototype keys and front-to-back order;
- `artifacts/pseudo-depth-fixtures.svg` — an inspectable root/vertical-face visualization.

The four bin fixtures intentionally keep identical bin geometry while changing diagnostic light direction. Their root prototype order is therefore identical for every light angle:

```text
bin-front (Y=181) > bin-rear (Y=166) > bin-side (Y=154)
```

The box control produces:

```text
box-a (Y=166) > box-b (Y=157)
```

For each object the debug prototype also samples a vertical-face point above the root and assigns matching world-Z; the reconstructed ownership key remains equal to the object's root key. This directly demonstrates the intended `screenY + worldZ` cancellation.

These fixture visualizations are model/debug evidence, not a claim of final per-pixel screenshot parity. The original bin imagery remains qualitative evidence for later ownership/DSO work; SM-202 must implement real per-fragment depth/object writes before visual ownership can be judged in the production WebGPU path.

## Rejected alternatives

### Root Y only

`depth = rootY` preserves painter-style object ordering but cannot represent a top/front plane within one sprite. It throws away the Material-v2 height field and cannot resolve intersecting elevated surfaces.

### Screen Y only

`depth = fragmentScreenY` makes the top of a tall standing prop artificially farther away merely because it appears higher on screen. A vertical face would shear through the ownership field instead of reconstructing one ground-depth plane.

### Root Y plus world Z

`depth = rootY + worldZ` double-counts elevation for standing sprites. Their raster Y already moved upward because of height; adding Z to an unchanged root makes upper pixels spuriously nearer instead of cancelling the projection.

### G2.R / local height alone

Local Material-v2 height contains no world placement. Two sprites at different roots but identical material texels would receive the same depth.

### Painter/category order as primary depth

Encoding static/dynamic submission sequence into depth would preserve the old renderer rather than solve representation correctness. Static and dynamic therefore share layer 0. Only explicit ground/foreground/top visibility contracts receive separate lanes.

### Light-dependent projection

Any formula containing light direction, shadow direction or cone state is rejected. Ownership describes visible geometry and must remain unchanged when only lighting changes.

### Rotating the root

SM-101 explicitly fixes the root as an unrotated ground-contact authority. Rotating it here would create a second placement convention and break the already-verified WebGL2/editor parity contract.

### Stable-ID hash epsilon

Adding an object-ID hash to depth would make exact ties deterministic but physically arbitrary and would encode identity into geometry. Exact coplanar ties remain a submission/tie-policy concern for SM-202; semantic biases must be explicit data rather than hidden hashes.

## Production adoption boundary

SM-201 accepts the mathematical model and reference implementation only. It does **not** change the production G-buffer pipeline, WebGL2 compatibility renderer, editor rendering, or gameplay state.

SM-202 must consume `engine/pseudo_depth.js` semantics when it enables hardware depth/object ownership. It must not copy/rederive the formula independently in WGSL, editor code and CPU diagnostics. A production WGSL form may be mechanically equivalent, but its constants and tests must stay contract-linked to this reference model.

Downstream depth hierarchy, clustering, DSO, GTAO, SSGI and volumetric work must consume the resolved ownership depth produced from this model rather than Material-v2 local height directly.
