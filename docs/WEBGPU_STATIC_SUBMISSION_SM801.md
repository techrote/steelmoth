# SM-801 — render-bundle/static-submission study

## Purpose

SM-801 measures whether WebGPU render bundles materially improve Steel Moth's already-batched room submission path. The production SM-200 G-buffer currently groups instances by render category and emits at most five instanced draws per frame. This study therefore tests the realistic optimization opportunity rather than constructing an artificially draw-call-heavy workload.

## Prototype boundary

The A/B implementation is study-only. Production `engine/webgpu_gbuffer.js` remains unchanged. The prototype records only the stable `static` and `ground` category draws in a render bundle; dynamic, foreground and top categories remain ordinary render-pass commands. Static/editor or room changes invalidate and rebuild the prototype bundle. This avoids pretending dynamic scene state is immutable.

Two deterministic workload shapes are used:

- **representative:** 320 static, 64 ground, 96 dynamic, 64 foreground, 32 top instances;
- **dense:** 768 static, 128 ground, 256 dynamic, 128 foreground, 64 top instances.

Both retain the same category-batched submission shape as the production G-buffer. The study uses a compact synthetic shader so CPU submission differences are not obscured by unrelated material/lighting work.

## Method

The dedicated Windows workflow runs fresh temporary Chrome and Firefox profiles through `webgpu-static-submission-smoke.html`. Each browser executes three A/B runs for both workloads. Run order alternates to reduce ordering bias.

CPU command-encoding measurements time command construction/finish only and are reported separately from GPU execution. The first end-to-end page exposed Firefox's coarse timer resolution for such small batches, so `webgpu-static-submission-cpu-smoke.html` adds a second high-resolution CPU-only measurement: each timed sample encodes 512 command buffers without submitting them, making the encode interval measurable while preventing GPU execution from contaminating the CPU result. Render-bundle rebuild CPU cost is measured separately. GPU milliseconds are emitted only when the adapter exposes `timestamp-query`; no CPU or queue-wait duration is relabelled as GPU time.

Each browser also verifies:

- baseline/bundle pixel parity;
- WGSL compilation;
- zero scoped WebGPU validation errors;
- render-bundle reuse before invalidation;
- rebuild after editor-static invalidation;
- rebuild after room change.

The machine-readable artifacts are `artifacts/sm801/static-submission-report.json` and `artifacts/sm801/cpu-encode-report.json`.

## Decision policy

Render bundles are adopted only if the complete Chrome+Firefox representative+dense matrix is valid, CPU encode p50 improves by at least 10% in every row, and any available GPU p50 does not regress by more than 3%. This is deliberately conservative because the existing renderer already uses coarse instanced batches, while a bundle cache adds invalidation and rebuild complexity.

If those conditions are not met, SM-801 records an explicit rejection and leaves the production submission path unchanged. Hosted measurements are browser/API evidence only and are not a GTX 1650 SUPER performance claim.

## Acceptance record

PR #98 dedicated run `35428890405` completed the three-run Chrome/Firefox representative+dense matrix after repairing the CPU probe's initially optimized-away bind group. The retained evidence uses Chrome 152.0.7977.83 and Firefox 155.0.1 on the hosted Windows runner. Chrome reported the Google SwiftShader adapter; therefore none of these numbers are target-GTX1650S performance evidence.

High-resolution CPU command-encoding p50, in milliseconds per encoded frame:

| Browser | Workload | Current inline batches | Static render bundle | Change |
| --- | --- | ---: | ---: | ---: |
| Chrome | representative | 0.003125 | 0.002734 | 12.5% faster |
| Chrome | dense | 0.002344 | 0.002344 | 0.0% |
| Firefox | representative | 0.003906 | 0.003906 | 0.0% |
| Firefox | dense | 0.001953 | 0.003906 | 100% slower |

The optional timestamp-query path was available in both hosted browsers. Three-run GPU p50-of-run-p50 values from the end-to-end page were:

| Browser | Workload | Current inline batches | Static render bundle | Change |
| --- | --- | ---: | ---: | ---: |
| Chrome | representative | 3.7376 ms | 3.8688 ms | 3.5% slower |
| Chrome | dense | 7.9599 ms | 8.3803 ms | 5.3% slower |
| Firefox | representative | 0.3784 ms | 0.3750 ms | 0.9% faster |
| Firefox | dense | 0.6339 ms | 0.6478 ms | 2.2% slower |

The prototype preserved exact sampled pixel output in both workloads and both browsers, emitted no final scoped validation errors, reused its cached bundle before invalidation, and rebuilt after both editor-static and room invalidation. Its resource delta is one cached `GPURenderBundle` per room submission state, with no additional buffers or textures and reuse of the existing pipeline/bind group. Bundle reconstruction itself was tiny on the hosted runner, but it is still another invalidation/cache lifetime to own.

**Decision: reject render-bundle adoption for the current SM-200 static submission path.** The existing five-category instanced batching is already cheap enough that the proposed cache fails the minimum 10% CPU improvement in three of four browser/workload rows and regresses materially in Firefox dense CPU encoding. Chrome also exceeded the 3% GPU-regression ceiling in both workloads. The production `engine/webgpu_gbuffer.js` therefore remains on the simpler inline category-batched path. Revisit only if later renderer changes materially increase static draw/submission count or a future browser implementation changes the measured trade-off.
