# SM-801 — render-bundle/static-submission study

## Purpose

SM-801 measures whether WebGPU render bundles materially improve Steel Moth's already-batched room submission path. The production SM-200 G-buffer currently groups instances by render category and emits at most five instanced draws per frame. This study therefore tests the realistic optimization opportunity rather than constructing an artificially draw-call-heavy workload.

## Prototype boundary

The A/B implementation is study-only. Production `engine/webgpu_gbuffer.js` is intentionally unchanged while evidence is gathered. The prototype records only the stable `static` and `ground` category draws in a render bundle; dynamic, foreground and top categories remain ordinary render-pass commands. Static/editor or room changes invalidate and rebuild the prototype bundle. This avoids pretending dynamic scene state is immutable.

Two deterministic workload shapes are used:

- **representative:** 320 static, 64 ground, 96 dynamic, 64 foreground, 32 top instances;
- **dense:** 768 static, 128 ground, 256 dynamic, 128 foreground, 64 top instances.

Both retain the same category-batched submission shape as the production G-buffer. The study uses a compact synthetic shader so CPU submission differences are not obscured by unrelated material/lighting work.

## Method

The dedicated Windows workflow runs fresh temporary Chrome and Firefox profiles through `webgpu-static-submission-smoke.html`. Each browser executes three A/B runs for both workloads. Run order alternates to reduce ordering bias.

CPU command-encoding measurements time command construction/finish only, in blocks, and are reported separately from GPU execution. Render-bundle rebuild CPU cost is measured separately. GPU milliseconds are emitted only when the adapter exposes `timestamp-query`; no CPU or queue-wait duration is relabelled as GPU time.

Each browser also verifies:

- baseline/bundle pixel parity;
- WGSL compilation;
- zero scoped WebGPU validation errors;
- render-bundle reuse before invalidation;
- rebuild after editor-static invalidation;
- rebuild after room change.

The machine-readable artifact is `artifacts/sm801/static-submission-report.json`.

## Decision policy

Render bundles are adopted only if the complete Chrome+Firefox representative+dense matrix is valid, CPU encode p50 improves by at least 10% in every row, and any available GPU p50 does not regress by more than 3%. This is deliberately conservative because the existing renderer already uses coarse instanced batches, while a bundle cache adds invalidation and rebuild complexity.

If those conditions are not met, SM-801 records an explicit rejection and leaves the production submission path unchanged. Hosted measurements are browser/API evidence only and are not a GTX 1650 SUPER performance claim.

## Acceptance record

Pending the dedicated PR workflow artifact. This section must be updated with the measured Chrome/Firefox results and final adopt/reject decision before SM-801 is considered complete.
