# SM-800 — precision and bandwidth study

## Purpose

SM-800 evaluates precision/packing candidates only after the renderer has stable correctness contracts and SM-500 timing/memory instrumentation. The explicit production representation remains the reference. This study makes **no production format change** until a candidate has numeric parity, cross-browser WebGPU validity, and measured benefit on the physical GTX 1650 SUPER target.

## Reference layout and memory baseline

At native 1920×1080, the studied production/reference attachments are:

| Attachment | Reference format | Descriptor bytes/pixel |
| --- | --- | ---: |
| G0 albedo | `rgba8unorm` | 4 |
| G1 XYZ normal + roughness | `rgba16float` | 8 |
| G2 height + metalness + AO + emissive | `rgba16float` | 8 |
| object ID | `r32uint` | 4 |
| primary pseudo-depth | `depth32float` | 4 |
| representative HDR intermediate | `rgba16float` | 8 |

That is 36 descriptor bytes/pixel, or 74,649,600 bytes / 71.19 MiB at 1080p for this bounded comparison set. This is a descriptor-derived allocation/write-footprint estimate, **not** a claim about physical VRAM residency, compression, cache traffic, or external allocations.

Core `rgba8unorm` albedo, `r32uint` object ownership and `depth32float` primary depth are invariant in every candidate. SM-800 does not trade away those correctness representations.

## Candidates

The study changes one precision dimension at a time and also measures the combined upper bound:

| Candidate | G1 | G2 | HDR | 1080p studied bytes | Saving vs reference |
| --- | --- | --- | --- | ---: | ---: |
| reference | `rgba16float` | `rgba16float` | `rgba16float` | 71.19 MiB | — |
| material8 | `rgba16float` | `rgba8unorm` | `rgba16float` | 63.28 MiB | 7.91 MiB |
| octMaterial8 | octahedral normal XY + roughness in `rgba8unorm` | `rgba8unorm` | `rgba16float` | 55.37 MiB | 15.82 MiB |
| hdr11 | `rgba16float` | `rgba16float` | `rg11b10ufloat` | 63.28 MiB | 7.91 MiB |
| combined | octahedral/material `rgba8unorm` | `rgba8unorm` | `rg11b10ufloat` | 47.46 MiB | 23.73 MiB |

### Material precision

Current Material-v2 source height/material channels originate in 8-bit normalized atlas data, but G2 is intentionally explicit `rgba16float` today because later passes may compute/interpolate values and because the representation has been easy to inspect. The `material8` candidate tests whether storing height/metalness/AO/emissive as `rgba8unorm` remains within a half-LSB normalized tolerance. It is not adopted merely because the source atlas is 8-bit.

### Octahedral normal packing

The `octMaterial8` candidate replaces explicit XYZ storage with octahedral XY plus roughness in `rgba8unorm`. The deterministic CPU corpus covers 4096 sphere directions; the browser probe renders and reads a separate deterministic 16×16 normal fixture and reconstructs normals from actual GPU bytes. The acceptance threshold for this study is ≤1.0° maximum angular error. Explicit XYZ remains the correctness/debug reference even if this candidate later proves worthwhile.

### HDR intermediate

The `hdr11` candidate compares positive-HDR `rg11b10ufloat` against `rgba16float`. The browser probe writes values spanning the representative positive HDR range, reads the packed bits back from WebGPU, decodes the unsigned-float channels and requires ≤2% maximum relative error. Alpha-bearing or signed intermediates are outside this candidate and must not be silently converted.

### Render-target lifetime / aliasing

No explicit aliasing implementation is proposed in this PR. WebGPU does not expose Vulkan-style explicit image-memory aliasing, and Steel Moth's persistent resource registry/lifecycle has already been soak-tested for deterministic ownership. Lifetime reuse should be revisited only for demonstrably non-overlapping same-purpose transient resources, with lifecycle/validation evidence; resource churn disguised as “aliasing” is not an optimization.

## Browser method

`webgpu-precision-smoke.html` runs in fresh hosted Chrome and Firefox profiles through the dedicated SM-800 workflow. It performs:

- actual WebGPU render-target creation for every candidate format tuple;
- validation-scoped pipeline creation;
- deterministic GPU write/readback for octahedral normal, material-8 and `rg11b10ufloat` numeric parity;
- a synthetic three-render-target fullscreen format/write microbenchmark;
- timestamp-query GPU pass distributions when the adapter exposes the feature;
- adapter/browser metadata and diagnostic screenshot capture.

The microbenchmark isolates format conversion/render-target write pressure. It is useful A/B evidence, but it is not a substitute for the full Steel Moth renderer benchmark.

Machine-readable hosted evidence is written to `artifacts/sm800/precision-bandwidth-report.json`.

## Decision policy

A candidate is rejected immediately if it fails numeric tolerance, is unsupported in either required browser, causes WebGPU validation errors, or regresses the hosted format/write microbenchmark by more than 5% without a stronger measured justification.

A candidate that passes hosted validation is still only **provisionally viable**. Production adoption requires a physical GTX 1650 SUPER A/B using the canonical fixed scenes and SM-500 timestamp-query methodology. The target run must show a measurable renderer GPU and/or memory/bandwidth benefit without downstream parity regressions. The study deliberately does not equate descriptor byte savings with real GPU performance.

Because that physical target benchmark is not available to the current hosted agent, this PR must not be treated as completing issue #42. The correct state is: cross-browser/numeric evidence may become green; production formats remain unchanged; target-hardware adoption/closure remains blocked.

## Current acceptance record

The deterministic model establishes the bounded descriptor footprint above and keeps object/depth correctness invariant. The dedicated browser workflow is the authority for actual Chrome/Firefox format support, readback tolerance and hosted timestamp-query A/B values for the PR head.

No GTX 1650 SUPER performance result is claimed here. No candidate is adopted into `engine/webgpu_gbuffer.js` or the HDR production chain in this non-hardware stage.
