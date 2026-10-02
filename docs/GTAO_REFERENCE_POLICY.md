# GTAO reconstruction reference policy — 2026-10-02

Status: reference-only correctness repair. This is separate from SM-601 performance
acceptance and the unmerged experiments in PRs #104, #105 and #106.

## Decision and rationale

Preserve the deployed WGSL reconstruction policy and align the JavaScript reference
to it. The canonical cutoff is the binary32 value represented by `0.000001`
(`0x358637bd`, approximately `9.999999974752427e-7`). For an enabled, occupied output:

- accumulate the existing four ordered depth/normal/spatial weighted taps;
- reconstruct only when `weightSum > cutoff` (strict comparison);
- otherwise return the existing nearest raw visibility and confidence exactly zero;
- equality falls back; do not divide by the small sum or search for another raw tap.

Disabled and unoccupied output remains exactly neutral (visibility and confidence 1).
Clamped duplicate edge taps, occupancy tests, weighting equations, accumulation order,
raw format and output formats are unchanged.

The original SM-600 merge, `d9296442202e97e54658c765662ec8e8e4aa1101` / PR #96,
introduced both values: the JS guard was `1e-8`, but WGSL used `0.000001`.
Issue #35, PR #96 and `WEBGPU_GTAO_SM600.md` establish bounded depth-aware
reconstruction and predictable disable semantics, but do not specify an alternative
numeric cutoff or supply evidence that the JS value was the intended product rule.
Both values predate the retained SM-601 measurements.

This decision is therefore about **compatibility and an honest oracle**, not a claim
that `1e-6` is a numerically or artistically optimal tuning value. Changing the
production shader to `1e-8` would alter existing pixels without a rendering requirement
or visual acceptance evidence. Repairing the reference preserves deployed behavior.
A future deliberate rendering-policy change requires its own decision and tests.

## Implementation boundary

`engine/webgpu_gtao.js` owns one lexical spelling,
`UPSAMPLE_WEIGHT_EPSILON_WGSL='0.000001'`. The exported
`UPSAMPLE_WEIGHT_EPSILON` is its f32 value; `upsampleHasSupport()` applies the strict
comparison in the JS reference. The same spelling is interpolated into WGSL.
This removes independent magic numbers **without changing the generated shader**.

Pinned pre/post WGSL SHA-256:

| Source | SHA-256 |
| --- | --- |
| Raw horizon | `d6bbbf28517866d9b3ca6e5de3b54847e4147f89a15df1be3ce47200d0cbae78` |
| Reconstruction | `7ddda64b8e31f11998ce77abb721c4b1e105e468e1e3785e28374eb0c9ef81cd` |

The GPU class, parameter serialization, half-resolution reference, options, quality
bounds, formats and Material-AO policy are unchanged and source-checked. Neither
SM-500 instrumentation nor the SM-601 temporal/readback implementation is edited.
No optimization candidate is adopted. No historical benchmark is rewritten.

## Reproducer and branch tests

The original PR #106 witness supplies valid finite intermediate inputs to a 4x4
reconstruction invocation. Raw visibility is `[0.25, 0.75, 0.75, 0.75]`, depth is
0.5, and the sample normals are encoded as `[1, 0.5, 0.5126953125]` while the
output normal is `[0.5, 0.5, 1]`. These texture values are binary16-representable.
With normal power 4, the double-precision reference sums approximately
`4.50556144e-7`. The former JS reference returned `0.5591996312141418`; the repaired
reference and deployed shader select nearest raw `0.25` with confidence zero.

This is an intermediate-input counterexample, not proof that the exact fixture has
occurred in gameplay or that a visible game defect has been observed.

The regression suite includes:

- the witness and ten controlled sums straddling `1e-8` and `1e-6`, with the existing
  continuous normal-power control serialized to f32;
- extreme permitted depth-sigma/normal-power settings, binary16 depth rounding ties,
  empty/invalid raw samples, opposed normals and a nearest-invalid fallback control;
- 1-pixel and odd extents, duplicate edge taps, disabled/unoccupied outputs and all
  four debug modes: 64 finite fixtures, 256 fixture/debug configurations;
- 512 seeded randomized independent CPU comparisons;
- a frozen legacy-reference function and seven ordinary scene sets proving unchanged
  raw, visibility and confidence fields on the same JavaScript runtime;
- exact scalar branch tests at the cutoff and neighboring f32 values, including an
  equality mutant and the former `1e-8` policy mutant.

The browser suite executes the unchanged production reconstruction shader and a
**test-only** lower-cutoff variant. Both policies are compared to their respective
references. The lower-cutoff variant is a counterfactual control, never a runtime
option. Two executions reuse every fixture's resources, and both output textures
must remain byte-stable on repeat.

## Numerical evidence limits

A shared branch policy is not a promise of a bit-identical general-purpose GPU
emulator. The reference retains JavaScript double-precision weighting/accumulation;
WGSL uses f32 and permits implementation-dependent rounding/accuracy for operations
such as `normalize` and `pow`. Actual accumulated sums extremely close to the cutoff
can differ across evaluation paths or adapters. This repair neither hides that fact
nor adds an epsilon band that silently changes rendering policy.

Consequently the tests separate three claims:

1. Given the same representable sum, CPU/WGSL cutoff classification must agree exactly,
   including equality and adjacent f32 values. A small standalone kernel executes the
   exact conditional extracted from production WGSL.
2. For the finite full-reconstruction fixtures, the fallback branch and nearest-raw
   result are asserted exactly, independently of the arithmetic error bound. The
   controlled weighted-sum targets have at least 1% separation from a policy boundary.
3. Ordinary non-branch arithmetic may differ by up to `2e-6` absolute in the new
   browser suite. This bound cannot excuse choosing the wrong fallback branch.

Texture inputs to the browser fixture tests are quantized to the actual binary16
storage before CPU evaluation. `referenceGTAO()` remains an analytic helper with an
unquantized raw Float32Array; this task does not silently change its format model.
Read back/quantize the raw intermediate before comparing `referenceUpsample()` with
GPU reconstruction. The pre-repair stock hashes in
`render-tests/gtao-reference-baseline.json` are retained provenance; same-runtime
legacy/repaired byte equality, rather than cross-runtime transcendental hashes, is
the ordinary-scene regression gate.

Primary API context checked for this repair:

- [WGSL floating-point evaluation and accuracy](https://www.w3.org/TR/WGSL/#floating-point-evaluation)
- [WebGPU texture formats](https://www.w3.org/TR/webgpu/#texture-formats)

These specify numeric/format behavior; neither specifies a GTAO cutoff. The cutoff
is the repository compatibility decision above, not an externally mandated number.

## Verification and disposition

```text
node tools/validate_webgpu_gtao_reference.js
node tools/validate_webgpu_gtao.js
python tools/validate_webgpu_gtao_reference_browser.py --report artifacts/gtao-reference-browser.json
python tools/run_checks.py --report artifacts/core-checks.json
```

The existing GTAO deterministic entrypoint invokes the new CPU suite, so the normal
repository gate includes the repair. The dedicated `sm600-reference-policy.yml`
workflow additionally executes actual WGSL on software WebGPU. The runner requests
a fallback adapter, collects no timestamps, has a bounded timeout, and treats
unavailable WebGPU or any shader/resource failure as failure rather than a skip.
Check exact-head CI and its retained artifacts for actual run results.

This reference-only repair can be reviewed independently of physical performance
adoption. SM-601 / #36 remains open, SM-602 remains gated, and the separate experiment
branches retain their pinned source. PR #106's historical mismatch assertion must be
reconciled explicitly if that study is later rebased onto this repair: its old
witness result remains historical evidence, while its shader hashes remain valid.
Do not mutate its existing evidence or weaken its shader-equivalence gate.
