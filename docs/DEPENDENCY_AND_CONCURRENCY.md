# Dependency and concurrency plan

Task codes refer to `MASTER_WEBGPU_PROGRAMME.md`; issue-number mapping is in `EXECUTION_LEDGER.md`.

## Root implementation dependency

`SM-000` is the source root. Until the v1.2.3 implementation is imported/provenanced, no renderer implementation issue may merge. Planning, research, issue/docs work may continue.

`SM-004` reconciles the imported source against historical claims. Migration contracts should target the audited source, not conversation assumptions.

`SM-005` establishes CI/check entrypoints after baseline commands are known; it can run in parallel with early evidence/platform work.

## Hard serialization spine

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

The spine is deliberately strict: later shadow aesthetics cannot be trusted if root/depth/object/cluster ownership is unresolved. Temporal work is last so it cannot hide incorrect static-frame results.

## M0 parallel evidence/automation lanes

After SM-000:

- **SM-001** visual references/fixtures and **SM-002** capture harness can proceed concurrently.
- **SM-003** hardware WebGL2 baseline depends on SM-002 and GTX 1650 Super access.
- **SM-004** audits the imported source and blocks migration assumptions.
- **SM-005** CI/check setup depends on the actual baseline test inventory from SM-000/004, but can overlap fixture work.

## M1 platform lane

After source/audit stability:

```text
SM-100 scene description
SM-102 device lifecycle/fallback
SM-103 resource/frame graph
SM-104 API/WGSL validation
```

SM-100 and SM-102/103 can largely proceed in parallel. SM-104 test scaffolding may start while SM-102/103 are built, but production validation requires their real descriptors/pipelines. SM-101 follows the scene-data boundary and must be coordinated with any transform work.

## M2 parity lanes

### Serialized representation lane

`SM-200 → SM-201 → SM-202 → SM-203`.

### Lighting/output lane

- **SM-204** deferred light parity depends on SM-200 and can progress while SM-201 is researched if it does not invent a competing depth convention; final integration waits for SM-202.
- **SM-205** self/contact shadow parity depends on SM-202/203/204.
- **SM-206** transparent sprite/effect parity can begin after core backend/scene/light interfaces stabilize and may overlap late M3 work.
- **SM-207** bloom/post/output parity depends on a usable opaque/transparent WebGPU frame and can overlap late M3/procedural work. It must not absorb SM-502 colour-space redesign.

M2 visual parity is not complete without 204–207: a correct G-buffer alone is not a complete playable renderer.

## M3 occlusion lane

- SM-300 begins only after SM-202 ownership contracts are stable; it should reuse SM-203 where useful.
- SM-301 → SM-302 → SM-303 are serialized.
- SM-304 follows correct DSO core semantics.
- SM-305 follows usable hard-core DSO and should consume SM-304 distance semantics.
- SM-306 follows correct non-temporal DSO/Dark Bloom.
- SM-307 depends on SM-303–306 **and SM-205** self/contact-shadow parity.

SM-500 performance instrumentation may run in parallel and should be extended as these passes land.

## M4 procedural/editor lane

After SM-204 and stable SM-307 visibility semantics:

- **SM-400** water and **SM-401** foliage/Fine Grass can proceed concurrently.
- **SM-402** final transparent/procedural ordering depends on SM-400, SM-401, and the general transparent/effect path SM-206 plus post interface SM-207 where ordering reaches post.
- **SM-403** editor integration and **SM-404** room/resource invalidation can proceed concurrently once M2/M3 ownership/invalidation APIs are stable.
- **SM-405** is a functional/cross-browser gate after M0–M4 runtime work. It does not own final performance acceptance or default-backend promotion.

## M5 performance/foundation/release lane

- **SM-500** should start as soon as SM-102/103 can support timestamps/diagnostics and evolve with passes.
- **SM-501** depends on SM-500 and the feature set intended for the initial WebGPU-primary release, plus SM-003 WebGL2 baseline.
- **SM-502** colour-space audit and **SM-503** material-semantic calibration depend on SM-200/204 and may run concurrently with late DSO work if they coordinate shared formats/fixtures.
- **SM-504** tile/light culling requires stable pass semantics and SM-500 measurements; optimize only after correctness fixtures exist.
- **SM-505** is the final initial-release promotion gate. It depends on SM-405 functional parity and SM-500/501 target-hardware evidence plus clean deployment/package validation. Only SM-505 may switch `Auto` to WebGPU-first for the initial primary release.

SM-502–504 may be included before SM-505 when they are needed to meet fidelity/performance gates, but GTAO/SSGI/volumetrics in M6/M7 are not mandatory for the first WebGPU-primary release unless deliberately promoted into that release scope.

## M6–M8 serialization/parallelism

- **SM-600** GTAO depends on stable depth/normal hierarchy, SM-307 visibility composition, **SM-502 colour correctness and SM-503 material semantics**; SM-601 follows it.
- **SM-602** SSGI depends on stable SM-601 GTAO/depth-temporal infrastructure; SM-603 follows it.
- **SM-700** volumetric flashlight work is deliberately serialized **after SM-603** so it reuses mature depth/temporal infrastructure and is designed against the measured remaining frame budget; SM-701 follows it.
- **SM-702** advanced transparent lighting depends on SM-400/401/402 plus stable GTAO/indirect interfaces and may overlap late SM-701 polish once those interfaces are stable.
- **SM-800** precision study, **SM-801** render-bundle/static-submission study and **SM-803** soak testing can run concurrently once the renderer is mature enough to profile. SM-800 G-buffer changes require coordination with every consumer.
- **SM-802** adaptive quality is intentionally last and depends on trustworthy SM-500 timings, stable SM-501 static presets, SM-603 SSGI tiers and SM-701 volumetric tiers. It must not be used to hide an over-budget static renderer.

## Unsafe concurrency combinations

Do not develop independently without explicit coordination:

- SM-101 root authority vs SM-201/202 depth formula/ownership;
- SM-200 G-buffer layout vs SM-203/204/205 consumers;
- SM-201/202 vs any subsystem introducing private pseudo-depth math;
- SM-301/302 clustering ownership vs SM-303 DSO semantics;
- SM-305 Dark Bloom vs SM-307 composition if mask semantics change;
- SM-400/401/206 independent ordering assumptions vs SM-402;
- SM-502 colour-space changes vs SM-503 material calibration captures;
- SM-800 precision/packing while active work assumes the old G-buffer layout.

## Blocker propagation

- If SM-000 is blocked, implementation merges are blocked but planning/research/docs remain useful.
- If SM-201 is blocked, platform/direct-light/output parity can continue where depth-independent, but DSO/GTAO/SSGI work must not merge speculative depth conventions.
- If target GTX 1650 Super hardware is unavailable, functional/visual work continues, but SM-003/501/505/601/603/701 and any issue claiming target performance remain open/pending hardware verification.
- If original bin screenshots cannot be recovered, reconstructed deterministic fixtures still support representation testing; original-reference visual acceptance remains explicitly unresolved rather than silently waived.
- If hosted CI cannot run trustworthy WebGPU/hardware tests, SM-005 must preserve honest local/manual/self-hosted acceptance paths rather than emulating performance claims.
