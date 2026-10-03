# SM-601 GTAO shader arithmetic and memory audit

Date: 2026-10-02. Scope: GPU-free investigation and isolated candidates under #36.
Status: **No production adoption or target-performance acceptance.**

## Scope and source identity

This audit follows the separate counter-aggregation experiment (PR #104) and deferred diagnostic-readback experiment (PR #105). Neither experiment is stacked, edited or incorporated here. SM-501 / PR #92 remains a separate physical-validation lane at `672c7097c5ee6f436cca5acf40f8d221ece3cc70`.

Baseline main is `73b6f1222b47219966130a3b135067ef74d65e39`. The audited `engine/webgpu_gtao.js` Git blob is `7960a3e12e8ffaa9922f81899e42d326b9a43606`; its SHA-256 is `6f26e5feb3f0f1b70ff524114987884058c4414bbce2b7f699e52d80e6ab2c91`. Candidate generation refuses drift in either exported production WGSL string. The CPU suite additionally guards the complete source blob. No existing engine file, preset, benchmark, threshold, depth representation or backend default is changed.

Issue #36, `AGENTS.md`, `docs/INDEX.md`, `WEBGPU_GTAO_SM600.md`, `WEBGPU_GTAO_SM601.md`, `WEBGPU_VALIDATION_PLAN.md`, `LIGHTING_FIDELITY_ROADMAP.md`, and `DEPENDENCY_AND_CONCURRENCY.md` remain authority. This document records findings, not replacement acceptance requirements. SM-602 remains blocked by the existing SM-601 gate.

The retained PR #102 result (~2.88 ms mean) spans raw GTAO, reconstruction and temporal update; the existing readback can also delay the enclosing ending timestamp. It does not localize shader costs. Nothing below converts source operation counts into milliseconds or claims a bottleneck has been measured.

## Executable pass and resource inventory

Raw GTAO evaluates `ceil(W/2) * ceil(H/2)` invocations. A covered invocation reads canonical SM-203 level-zero depth and G1 normal, then visits `directions * steps` integer-offset depth samples. The default/Medium geometry is six directions, four steps, radius 12. The prototype intensity default is 1.1, whereas SM-601 Medium uses 1.0; the hardware probe explicitly uses 1.0. Both settings are covered without changing production defaults.

The exposed API accepts **every integer direction count 4 through 8 and step count 2 through 6**, not just the preset counts 4/6/8. Radius and `normalPower` are continuous bounded controls. A preset-only specialization must not silently change the other supported values.

The raw `rgba16float` result stores visibility, quantized representative depth, occupancy, and occlusion. Reconstruction reads four half-resolution samples in the existing `(oy, ox)` order, including duplicate clamped edge samples, applies depth/normal/spatial weights, and writes full-resolution visibility and debug textures. Temporal stabilization then reads full-resolution current/history data and writes the next four history planes; that shader and its counters are unchanged by this study.

At 1920x1080: 2,073,600 full-resolution pixels; 518,400 half-resolution pixels; 8,160 raw workgroups (the final row is padded); 32,400 reconstruction workgroups.

### Source-level requested work at fully occupied 1080p

The following is an explicit **all-covered, all-samples-occupied upper-work model**, with all temporal histories accepted. Texture byte counts multiply requested texels by format size. They are **not measured external-memory traffic, cache misses, compiled instructions or bandwidth requirements**. Compilers can hoist expressions or remove loads; texture caches can satisfy repeated reads.

| Stage | Source-level work | Requested read payload | Writes |
|---|---|---:|---:|
| Raw horizon | 12,960,000 depth loads; 518,400 normal loads; 6,220,800 scalar sin/cos evaluations | 107,827,200 B | 4,147,200 B |
| Reconstruction | 2,073,600 depth loads; 10,368,000 normal loads/normalizations; 8,294,400 raw loads; 8,294,400 pow and distance evaluations each | 165,888,000 B | 16,588,800 B |
| Temporal, accepted path | Current/history reads plus the 3x3 clamp neighbourhood; source model includes current-normal and centre-visibility reloads | 190,771,200 B | 49,766,400 B |

Temporal atomic read/modify/write traffic is deliberately not included in these byte counts. PR #104 already studies it independently. Rejection paths and empty coverage do less texture work; they have different counter work.

Persistent descriptor-derived GTAO-owned storage at this extent is **120,268,960 B (~114.70 MiB)**: raw 4,147,200 B; visibility and debug 8,294,400 B each; two sets of temporal visibility/depth/object/normal histories 99,532,800 B; 160 B of current production buffers. Shared G-buffer/depth hierarchy, driver allocations, texture layout overhead and staging for external captures are excluded. This is not a VRAM measurement.

## Prepared candidates

All variants run only in `sm601-gtao-arithmetic-study.html`. Four variants make effects independently attributable: baseline, raw-shared only, reconstruction-shared only, and their combination. The code retains the production shader's sample ordering, arithmetic expressions, rounded-offset rule, fallback threshold, quality controls, formats and resource bindings. Exact A/B output equality is a test gate, not a promise across all possible compilers or adapters.

### Raw-shared: evaluate uniform sampling geometry per workgroup

Directions, distances and integer offsets do not depend on the pixel. The candidate computes them using the **same WGSL sin/cos and f32 expressions on the same adapter**, then shares them across an 8x8 workgroup. It does not upload a JavaScript trigonometry table or replace divisions with reciprocals. The original per-pixel depth traversal and normal-dependent direction weighting remain.

Storage is 472 workgroup bytes: eight `vec2f` directions, six f32 distances, and 48 `vec2i` offsets. Two uniform barriers separate producer/consumer phases. Padded and disabled lanes reach both barriers before the original early returns. Each cache element has a single writer.

At fully covered 1080p/6x4 the source-level sin/cos count falls from 6,220,800 to **97,920**, and offset constructions from 12,441,600 to **195,840**. Raw depth/normal texture reads do not fall. This is not a demonstrated speedup: workgroup accesses, barriers and occupancy costs can outweigh arithmetic savings, particularly on sparse or empty scenes.

### Reconstruction-shared: reuse a 5x5 neighbourhood

An 8x8 block of full-resolution outputs samples a 4x4 range of half-resolution base coordinates plus its positive one-sample border: **5x5**, not 8x8. The candidate loads those 25 raw texels and, where occupied, their 25 decoded normals once per workgroup. Per-output centre normal/depth and per-sample weighting remain unchanged. Repeated clamped boundary taps are retained rather than deduplicated out of the sum.

Storage is 800 workgroup bytes: 25 `vec4f` raw entries and 25 `vec3f` normals (16-byte array stride). One uniform barrier precedes the original per-pixel guard. There are no new persistent textures or buffers.

At fully covered 1080p, each class of repeated raw/sample-normal loads falls from 8,294,400 to **810,000**. Including unchanged centre depth/normal reads, requested reconstruction read payload falls from 165,888,000 to **46,137,600 B** (72.1875% fewer source-requested bytes). Normalizations fall from 10,368,000 to 2,883,600. Pow, distance and output-store counts are unchanged. Additional workgroup-memory traffic is excluded from this texture-payload estimate.

Empty output pixels previously avoided these samples; the shared cache still initializes. Sparse/empty performance is therefore an explicit possible regression, not an assumed win. No benefit can be claimed without both dense and sparse physical comparisons.

## Unsafe shortcuts and existing discrepancies

### CPU direction lookup is not automatically equivalent

The integer sample mapping uses `sign(v) * floor(abs(v) + 0.5001)`. Tiny direction/radius differences near this discontinuity can move a sample by a full texel. A reproducible f32-evaluation model witness uses directions=4, direction index=2, steps=2, step index=0, radius=`4.2423577308654785`: a CPU-precomputed cosine gives offset -2, whereas a sequential f32 angle-evaluation model gives -1.

That model is **not a prediction of a particular GPU intrinsic**. It demonstrates why double-precision JavaScript trigonometry and runtime WGSL may not be interchanged merely because the real-number formulas agree. WGSL allows implementation-dependent floating-point evaluation and intrinsic error. The selected raw candidate keeps computation on the GPU; physical A/B checks still remain mandatory.

The production angular range also extends beyond pi. The WGSL accuracy table's stated sin/cos bound is for [-pi, pi]; do not extrapolate it into a cross-adapter bitwise guarantee. Reducing angles to that interval is another arithmetic change, not silently part of this patch.

### CPU/WGSL reconstruction fallback mismatch: executable finding

The existing production JS reference uses weight-sum threshold **1e-8**; the actual WGSL uses **1e-6**. This is not just a negligible output epsilon. A 4x4 fixture with valid, exactly binary16-representable normal inputs and four valid raw samples has weight sum ~`4.5055614e-7`. At pixel (0,0), the JS reference gives **0.55919963 visibility**, while the GPU equation takes nearest-raw fallback and gives **0.25**.

The suite retains the legacy reference and adds an explicitly GPU-equation-matched independent reference; it does not alter either production threshold or enlarge the exact A/B comparison tolerance. The real-browser probe separately asserts this branch and records the observed legacy/GPU disagreement. A later corrective patch must explicitly decide which threshold is intended, update the corresponding oracle/implementation, and validate edge behaviour. That decision is not smuggled into an optimization experiment.

### Blindly substituting hierarchy minima changes occlusion

A centre depth of 0.7 sampling a particular point at depth 0.8 has no positive near-depth term. Substituting a coarser cell's adjacent minimum of 0.2 produces a near term of ~0.4985 with bias 0.0015, despite not sampling that occluder in the original algorithm. Therefore level-zero point samples cannot simply be replaced with coarse min/max values as an exact optimization. Conservative proofs that an entire cell cannot contribute could support rejection, but require a separate traversal/coverage proof and cost study. No private hierarchy or depth representation is introduced.

### Other candidates assessed, not adopted

`pow(nd, 4)` versus `(nd*nd)*(nd*nd)` can differ under floating-point/intrinsic rules; normalPower is not restricted to four or even integers. Near the fallback discontinuity, small weight changes need branch-sensitive tests, not just a broad average-image tolerance. Likewise, reciprocal multiplication, precomputed spatial weights and compile-time loop specialization need independent arithmetic and cache/compilation-cost evidence.

Direction weight is loop-invariant per direction, and a horizon already equal to its hard upper bound can permit an exact early exit on valid finite data. These are lower-priority candidates because the compiler may already hoist the weight and divergent early exits may not help. They are not combined with the two cache experiments.

Raw depth is already stored at binary16 precision. Removing that quantization while caching, moving reconstruction before the raw store, or fusing raw/upsample would change the reference output. The raw fourth channel is unused by reconstruction, but visibility/depth/occupancy still require representation; a smaller format is not a free, semantics-preserving drop-in. Similarly the full-resolution debug store cannot simply disappear while its public binding/debug controls remain observable.

Raw and reconstruction normalize without guarding a zero decoded normal, unlike the temporal shader. Encoded (0.5,0.5,0.5) is outside WGSL normalize's domain. This audit's finite-valid-input fixtures reject it rather than claiming undefined results are equivalent. Whether upstream material generation can produce such an occupied normal is not established here.

## Verification and reproduction

GPU-free verification:

```text
node tools/validate_sm601_gtao_arithmetic_study.js --report artifacts/sm601-arithmetic-cpu.json
```

The initial local run passed 122 deterministic configurations, 512 seeded randomized cached/direct reconstruction comparisons, 80,628 exact tile-coordinate checks, every finite binary16 bit-pattern roundtrip, ties-to-even cases, source drift refusal and invalid-input guards. The negative witnesses above are asserted, not merely described. Node loads the exact production pure functions with an inert Resources namespace; this is not GPU/API execution.

Software-WebGPU verification, with no timing collection:

```text
python tools/run_sm601_gtao_arithmetic_study.py --timeout 180 --report artifacts/sm601-arithmetic-browser.json
```

The dedicated bounded workflow executes the actual WGSL on SwiftShader. It must compile all kernels, pass scoped resource validation, compare **all three outputs byte-for-byte** across four variants for 122 configurations (each repeated with reused resources), retain finite bounded output and neutral disabled/empty/plane cases, and reproduce the weak-weight witness. The CPU-vs-GPU reference error is reported separately; it does not replace or relax exact A/B equality. No skipped adapter or compile failure is a passing test.

At publication, local real-GPU execution and physical timing are **not claimed**. Consult the PR's exact-head CI evidence checkpoint for actual hosted results. The workflow also retains source hashes. Existing repository Verification remains a separate gate.

## Physical handoff and stop conditions

The standalone runner supports an explicit hardware-only microbenchmark, after all correctness cases pass:

```text
python tools/run_sm601_gtao_arithmetic_study.py --hardware --benchmark --runs 3 --width 1920 --height 1080 --warmup 300 --samples 600 --pattern dense --timeout 1800 --report artifacts/sm601-arithmetic-dense-hardware.json
```

Run separate sparse, empty/plane and edge/saturated controls rather than extrapolating dense results. The runner uses fresh browser processes, records adapter/browser/source identity and available NVIDIA driver inventory, rotates variant order, retains every timestamp, and fails invalid/zero samples rather than filtering until a pass. Record clocks/power/background conditions and confirm the physical GTX 1650 SUPER before interpreting the result as target-specific.

Raw and reconstruction each receive timestamps on their actual compute passes. A separate first-raw-start to last-upsample-end command span is also retained. Query readback is outside these pass timestamps. This is synthetic two-pass kernel data, **not the old acceptance queue span**, not the temporal cost, and not the complete renderer. No CPU subtraction is allowed.

Keep this work draft/unmerged as an experiment. Adopt only candidates with exact target-adapter correctness and useful measured benefit, in a separately reviewed production change, then rerun the unchanged complete SM-601 moving-scene acceptance campaign. Do not close #36, unblock SM-602, combine with PR #104/#105, weaken quality or performance gates, or touch PR #92 on the strength of this audit.

## Physical neutral-failure witness — 2026-10-03

The requested exact head `1813085f158a24d52365b0ee5011dc32c0251c90` stopped its physical GTX 1650 SUPER run at `case-18-3x5-plane`, after 18 completed correctness cases and before any performance samples. The unchanged check reported `Neutral fixture is not neutral.` All three textures across all four variants are compared byte-for-byte **before** that baseline-neutral assertion. The failure therefore followed successful candidate/baseline equality in the failing repeat; it does not itself establish a candidate divergence. The original report omitted the failed case's floats and bits, so its magnitude and cause are unresolved.

This diagnostic-only overlay retains that assertion, the exact A/B checks, all shaders, CPU thresholds and benchmark guards. Before a neutral failure it records the repeat/options/source shader hashes, float32 words, bit hex, compact actual texture bytes and complete byte hashes for each variant, plus frozen CPU reference values and host reconstruction tap/weight details. Host sums use JavaScript double arithmetic on captured raw values and serialized inputs; they are explicitly **not** GPU accumulator readbacks. Failure validation scopes are popped and their errors retained alongside the witness. The original failure is still thrown and cannot enter the benchmark loop.

A CPU-only model of the 3x5 plane has raw samples `[1, 0.5, 1, 0]`, visibility 1 and weight sums 1.180612903055417–4. A reconstruction-rounding explanation is a hypothesis until the physical witness is captured. It does not justify relaxing exact neutral output, changing quality or manufacturing performance results. The frozen branch's 1e-8 JS control is historical; merged #107 establishes the current authoritative strict `> f32(0.000001)` policy. That repaired policy is not reopened here.

Run the witness separately, without timing:

```text
python tools/run_sm601_gtao_arithmetic_study.py --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --hardware --timeout 180 --report artifacts/sm601-arithmetic-neutral-witness.json
```

The arithmetic performance campaign remains stopped at this correctness gate. No successful physical witness, performance acceptance or production adoption is claimed by this addition.

## Canonical diagnostic neutral-policy overlay — 2026-10-03

This section supersedes the *diagnostic occupied-plane assertion* for this new
overlay only. Frozen study head `1813085f158a24d52365b0ee5011dc32c0251c90`, the
failed strict run, and preserved witness head
`5425c9b939791451fb4a6cb6f45db52cafc6473f` retain their original disposition.
Their reports are not rewritten or relabeled passed. The new overlay must be
identified by its own Git SHA and file hashes in each report/sidecar.

The captured physical witness reported reconstructed visibility
`0.9999999403953552` (`0x3f7fffff`) at plane pixel (0,1), while raw visibility was
exactly 1 and all three outputs across all four variants were byte-identical.
No captured API errors occurred. Host reconstruction weights exceeded 1.18;
those host sums are not GPU accumulator readbacks. The observed value is one
representable step below 1, not evidence of candidate divergence or a measured
performance result.

Current shared authority is the merged main
[`GTAO_REFERENCE_POLICY.md` numerical-evidence policy](https://github.com/techrote/steelmoth/blob/b82debb8f18f02d33baf437d3f43b4b79a3db705/docs/GTAO_REFERENCE_POLICY.md),
which distinguishes exact literal/fallback behavior from ordinary non-branch
GPU arithmetic and uses `2e-6` absolute for the latter. The
[WGSL concrete-accuracy rules](https://www.w3.org/TR/WGSL/#accuracy-of-concrete-expressions)
permit 2.5 ULP error for f32 division with a normal divisor in the specified
range; [reassociation and permitted fusion](https://www.w3.org/TR/WGSL/#floating-point-reassociation)
can also alter floating evaluation. An analytically neutral weighted quotient
therefore has no universal bit-exact-one guarantee. These rules support a narrow
oracle correction; they do not identify the actual compiler transformation used
by this adapter, mandate the repository's `2e-6` bound, or establish performance.

`tools/sm601_neutral_probe_policy.js` now applies that existing bound only to
**enabled, occupied plane reconstructed visibility**, retaining the existing
finite/range bound. Raw neutral visibility, empty outputs, disabled outputs and
unoccupied pixels remain exactly 1. Every candidate's raw/visibility/debug
textures must still match baseline byte-for-byte before this control is checked.
The strict shader cutoff, nearest raw fallback, exact weak-weight pixel 0.25 /
confidence 0, and all positive timestamp assertions are unchanged. The frozen
1e-8 JS discrepancy remains historical evidence; no production policy is changed.

Allowed ordinary deviations are retained as separately labeled observations
with the original float/bits/hashes and accepted policy. Values outside the
existing bound, any literal-neutral drift, and any candidate bit difference
still fail before timing begins. The source-preservation manifest pins the
whole frozen engine/generator, all four shader pairs, parameter serialization,
dispatch, exact byte comparator and the complete timing loop. CPU boundary and
mutation tests verify these distinctions without GPU execution:

```text
node tools/validate_sm601_neutral_probe_policy.js
python tools/validate_sm601_probe_browser_startup.py
```

Browser startup alone uses the already validated bounded port-file/page-target
helper under the original deadline. Shader assertions are not retried; benchmark
settings, limits, warm-up, retained sample counts and timing boundaries are not
changed. A new source-identified physical dense/sparse/empty/plane campaign is
still required. No speedup, production adoption, issue closure or downstream
unblock follows from this diagnostic correction.

## External technical references (original study)

Primary specifications consulted on 2026-10-02:

- W3C WGSL, floating-point evaluation and intrinsic accuracy: https://www.w3.org/TR/WGSL/#floating-point-evaluation and https://www.w3.org/TR/WGSL/#accuracy-of-concrete-expressions
- W3C WGSL, normalize domain: https://www.w3.org/TR/WGSL/#normalize-builtin
- W3C WGSL, synchronization and workgroupBarrier: https://www.w3.org/TR/WGSL/#workgroupBarrier-builtin
- W3C WebGPU, compute-pass timestamp writes: https://www.w3.org/TR/webgpu/#dictdef-gpucomputepasstimestampwrites

These support the API/numerical cautions, not claims about NVIDIA performance. Source-derived counts, witnesses and candidate behaviour are established by repository code and the accompanying tests.
