# Dependency and concurrency plan

Task codes refer to `MASTER_WEBGPU_PROGRAMME.md`. GitHub issue numbers are mapped in `EXECUTION_LEDGER.md` after issue creation.

## Hard serialization spine

The following chain should be treated as serialized unless an issue explicitly proves independence:

```text
SM-000 baseline import
  ↓
SM-004 baseline audit
  ↓
SM-100 Render Scene Description
  ↓
SM-101 shared root/foot authority
  ↓
SM-200 WebGPU Material-v2 G-buffer
  ↓
SM-201 pseudo-depth derivation
  ↓
SM-202 per-pixel ownership
  ↓
SM-203 depth hierarchy
  ↓
SM-300 occluder representation
  ↓
SM-301 clustering
  ↓
SM-302 dominant ownership
  ↓
SM-303 DSO core
  ↓
SM-304 distance hierarchy
  ↓
SM-305 Dark Bloom
  ↓
SM-306 temporal soft history
  ↓
SM-307 shadow composition
```

The reason for this strict spine is representational dependency: later shadow quality cannot be trusted if object/root/depth ownership is unresolved.

## Early parallel lane A — test/evidence harness

After SM-000:

```text
SM-001 reference fixtures
SM-002 capture harness
SM-003 WebGL2 hardware baseline
```

SM-001 and SM-002 can proceed concurrently once the source/assets are available. SM-003 depends on SM-002 and target hardware access.

## Early parallel lane B — WebGPU platform infrastructure

After SM-000, mostly independent of the final depth formula:

```text
SM-102 device lifecycle/fallback
SM-103 resources/frame graph/pipeline infrastructure
SM-104 WGSL/API/resource validation
```

SM-104 depends on enough of SM-102/103 to create real resources/pipelines but its harness/tests can start concurrently.

## Material/lighting parity lane

SM-204 (canonical light buffers and deferred parity) depends on SM-200 but can proceed while SM-201/202 are being finalized, provided it does not invent another depth convention. Integration with final ownership waits for SM-202.

## Occlusion lane

SM-300 may begin after SM-202 contracts are stable. SM-301 → SM-302 → SM-303 are serialized. SM-304 can begin once DSO core semantics are stable; SM-305 follows usable DSO output. SM-306 is deliberately last because temporal accumulation must never hide a wrong non-temporal result.

## M4 concurrency

After SM-204 and SM-307 stabilize canonical lighting/visibility:

- SM-400 water coherence;
- SM-401 foliage/grass coherence;
- SM-402 transparent ordering;
- SM-403 editor integration;
- SM-404 room invalidation.

SM-400/401 can proceed concurrently. SM-402 must reconcile their final ordering contracts. SM-403/404 can proceed in parallel after object/depth/cluster invalidation APIs are stable.

SM-405 cross-browser release gate depends on all M0–M4 implementation issues that affect runtime correctness.

## M5 concurrency

SM-500 performance instrumentation should start as soon as WebGPU platform infrastructure exists and must be complete before performance acceptance.

SM-502 colour-space audit and SM-503 material semantics can begin after Material-v2 WebGPU parity (SM-200/204) and can proceed concurrently with late DSO work if they preserve G-buffer contracts or explicitly coordinate changes.

SM-504 tile/light culling depends on stable pass semantics and instrumentation. Do not optimize opaque algorithms before their correctness fixtures exist.

SM-501 quality/1650S acceptance depends on SM-500 plus the completed renderer features intended for the release.

## M6–M8 serialization/parallelism

- SM-600 GTAO depends on stable depth/normal hierarchy and shadow composition; SM-601 follows it.
- SM-602 SSGI depends on GTAO/depth-temporal infrastructure; SM-603 follows it.
- SM-700 volumetrics may prototype after stable depth/DSO, but default-quality work should wait until SSGI/GTAO resource/timing budgets are understood.
- SM-702 transparent advanced lighting depends on canonical GTAO/indirect interfaces and may overlap with volumetric polishing.
- SM-800 precision study, SM-801 render-bundle study and SM-803 soak testing can run concurrently once the WebGPU renderer is feature-complete enough to profile. Changes from SM-800/801 must be independently measured.
- SM-802 adaptive quality is last: it depends on trustworthy per-pass timing and stable static quality tiers.

## Unsafe concurrency combinations

Do not develop these independently in parallel without explicit coordination:

- SM-101 root authority vs SM-201/202 depth formula/ownership;
- SM-200 G-buffer layout vs SM-203/204 consumers;
- SM-301/302 clustering ownership vs SM-303 DSO semantics;
- SM-305 Dark Bloom vs SM-307 composition if either changes visibility meaning;
- SM-502 colour-space changes vs SM-503 material calibration screenshots;
- SM-800 precision/packing while other work assumes old G-buffer layouts.

## Blocker propagation

If SM-000 is blocked, implementation work is blocked but planning/research/docs remain valid.

If SM-201 is blocked, direct-light parity and platform/test infrastructure may continue, but DSO/GTAO/SSGI work that depends on final pseudo-depth must not merge speculative depth conventions.

If target GTX 1650 Super hardware is temporarily unavailable, functional/visual work may proceed, but issues requiring performance acceptance remain open and marked blocked/pending hardware verification.

If original bin screenshots cannot be recovered, deterministic reconstructed fixtures remain useful, but final visual acceptance of “matches the intended screenshot correction” remains a human/reference blocker rather than being silently waived.
