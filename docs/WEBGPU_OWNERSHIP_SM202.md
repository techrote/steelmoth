# SM-202 WebGPU per-pixel pseudo-depth and object ownership

Status: **implemented in the staged WebGPU representation path; required by hosted real-WebGPU validation**.

SM-202 mechanically adopts the accepted `steelmoth-pseudo-depth/v1` model from `PSEUDO_DEPTH_MODEL.md` into production WebGPU fragment depth. It does not redefine the model, tune Material-v2 semantics, or introduce DSO/clustering behaviour.

## Production boundary

`engine/webgpu_ownership.js` extends the SM-200 `WebGPUMaterialGBuffer` with hardware ownership resolution. The SM-200 class remains available as the material-semantic compatibility/control path; the staged production migration path loads `WebGPUOwnershipGBuffer` after `webgpu_gbuffer.js` and `pseudo_depth.js`.

The ownership pass retains the SM-200 attachment formats:

| Attachment | Format | Ownership behaviour |
| --- | --- | --- |
| G0 | `rgba8unorm` | winning fragment albedo/coverage |
| G1 | `rgba16float` | winning normal/roughness |
| G2 | `rgba16float` | winning **local** Material-v2 height/metal/AO/emissive |
| Object ID | `r32uint` | stable ID of the depth-winning covered fragment; `0` when unowned |
| Depth | `depth32float` | canonical SM-201 ownership depth; clear `1.0` |

G2.R remains local Material-v2 height. The depth attachment is the light-independent ownership field. They are deliberately distinct representations.

## Canonical formula

The production WGSL constants are generated from `engine/pseudo_depth.js` constants and the shader implements the same relation:

```text
worldZ = clamp(localHeight, 0, 1) * 64
projectedGroundY = fragmentScreenY + worldZ
visibilityKey = layer * 1024 + projectedGroundY + bias
depth01 = clamp((3072 - visibilityKey) / 5120, 0, 1)
```

The material fragment shader writes `@builtin(frag_depth)`. The render pipeline uses:

```text
depthWriteEnabled = true
depthCompare = "less"
```

Larger visibility keys therefore win by producing smaller normalized depth.

No light position, light direction, cone state, shadow direction, object name, material class or stable-ID hash participates in the depth formula.

## Layer and bias contract

Default category lanes remain the SM-201 values:

- ground: `-1`;
- static: `0`;
- dynamic: `0`;
- foreground: `1`;
- top: `2`.

Static and dynamic therefore have identical ownership semantics. Foreground has the explicit documented layer advantage. `depthLayer` may override the category lane only when explicitly supplied by scene data. `depthBias` is an explicit fine logical-depth offset and defaults to zero.

The existing 80-byte SM-200 instance ABI is retained. Its previously reserved `ids.z`/`ids.w` words carry the bit representation of `depthLayer` and `depthBias`; this avoids a second instance buffer/layout during the migration while keeping the values explicit in the CPU contract.

## Alpha cutout and ties

Source albedo alpha below the Material-v2 cutoff (`0.12`) is discarded before G-buffer, object-ID, or depth writes. Transparent atlas padding/holes therefore cannot own pixels or occlude an underlying sprite.

Exact coplanar equal-depth ties are intentionally not perturbed with an object-ID hash. `depthCompare: "less"` means the first equal-depth fragment retained by the pass remains the owner. Physically meaningful separation must come from geometry, the explicit layer lane, or explicit `depthBias`; hidden name/identity-specific epsilon hacks are forbidden.

## Static, dynamic and foreground submission

The CPU may continue to submit/batch categories in deterministic order for efficiency and compatibility, but ordinary static/dynamic ownership is resolved per pixel by the depth attachment rather than whole-quad root ordering. Reversing two geometrically separated overlapping world instances does not change the resolved owner.

Foreground remains an intentional separate lane rather than geometry pretending to be coplanar world content.

## Debug/readback contract

SM-202 retains all SM-200 debug modes and adds `depth`. `object-id` and `depth` can therefore be inspected independently. `readPixel()` returns G0/G1/G2/Object-ID plus the `depth32float` value for deterministic representation tests.

The depth diagnostic deliberately uses a tiny compute pass that performs `textureLoad` on the production `texture_depth_2d`, writes that shader-visible value into a storage buffer, then copies four bytes to a mappable staging buffer. The initial direct depth-texture-to-buffer probe produced a zero value on hosted Chrome/Dawn despite the winning G-buffer/object-ID fragment being correct; using the same `textureLoad` path downstream shaders will consume avoids treating implementation-specific depth-copy behaviour as the ownership value. The compute/storage/map buffers are validation/debug resources only, not normal per-frame allocations in the intended renderer path.

## Required regression evidence

`webgpu-ownership-smoke.html` and `tools/validate_webgpu_ownership_browser.py` execute the production ownership WGSL on a real hosted WebGPU device and require:

- two overlapping vertical bin-like faces resolving the nearer per-pixel owner;
- reversed whole-object submission order producing the same owner/depth;
- exposed rear pixels retaining the rear object ID;
- an alpha-cutout hole exposing the rear object rather than writing depth/ID;
- numeric `depth32float` readback matching the accepted SM-201 CPU reference;
- static and dynamic equality, with only the documented foreground lane advantage;
- explicit foreground-layer and fine-bias behaviour;
- ownership/depth invariance across the eight diagnostic light angles `0°..315°`;
- stable ownership under `±0.25`, `±0.5`, and `±1` logical-pixel object-Y perturbations;
- deletion/empty-frame clearing to object ID `0` and depth `1.0`;
- executable object-ID and depth debug views.

The inherited SM-200 real-GPU material readbacks remain required, as does the SM-101 WebGL2 non-overlap pixel-parity gate. SM-202 does not alter WebGL2 compatibility presentation.

## Evidence boundary and downstream use

Hosted Chrome/Dawn success proves the tested API, WGSL, attachment, object-ID and depth-readback contracts on that adapter. It is not GTX 1650 Super performance evidence, final deferred-lighting parity, Firefox acceptance, DSO quality, or human visual acceptance.

SM-203 and later clustering/DSO/GTAO/SSGI/volumetric work must consume this resolved ownership depth/object field. They must not fall back to G2.R local height as if it were ownership depth or derive another competing pseudo-depth projection.
