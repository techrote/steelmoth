# SM-702 forward-lighting evidence — 4 October 2026

## Measured disposition

**Verified optional implementation for [SM-702 #41](https://github.com/techrote/steelmoth/issues/41).** Actual native GPU tests verify water, eligible large foliage and explicitly tagged diffuse glass consuming the canonical light, depth, visibility and incident-irradiance producers. The disabled paths preserve the frozen compatibility output. All advanced forward paths remain off by default.

The complete measured forward submission, including equal fixture composition, costs 1.052–1.081 ms mean in the representative scene and 5.899–5.960 ms mean at the scripted stress caps. Relative to the frozen production baseline, the increases are 0.088–0.104 ms and 2.969–3.036 ms mean respectively. The stress increase is dominated by actual world-alpha work: its candidate mean is 3.382–3.407 ms. These measurements support retaining explicit opt-in. They do not establish a current whole-renderer frame budget, justify default promotion, or claim an optimization.

The executable contract is [WEBGPU_FORWARD_LIGHTING_SM702.md](WEBGPU_FORWARD_LIGHTING_SM702.md). This report distinguishes actual GPU correctness and isolated GPU cost from normal-game presentation, human visual acceptance and release readiness. SM-505 remains a separate presentation/release gate.

## Source provenance and native environment

The [campaign manifest](../benchmarks/webgpu-gtx1650s/sm702-2026-10-04/campaign-a0be3ed/campaign.json) identifies runtime commit `a0be3ed2194b482374d2e7403e511fd00c3fd698` on `codex/sm702-forward-lighting`. All 33 executable closure paths are tracked, tracked state is clean, and raw SHA-256 hashes match before and after the campaign and every individual process. Disposable untracked artifacts and Python caches are recorded separately in the manifest; none belongs to the executable closure. All six Chrome reports and the Firefox report are individually SHA-256 referenced. Every run is new rather than resumed.

The three test-only baseline files are exact LF-normalized Git blobs from accepted production commit `cb068323a7a93e6273d879126fe261f951d589f7`. They preserve the old shaders and pipeline behavior; the narrow legacy-water queue proxy captures its actual command buffer for the paired atomic submission. It neither substitutes CPU colour nor suppresses validation. These baseline modules are experimental acceptance inputs, not a second production renderer.

| Pinned baseline | LF-normalized SHA-256 |
| --- | --- |
| `tools/experiments/sm702_water_baseline.js` | `542b9a63da85c3e4577286d9beb6590312a95fe6e1bbcd5d1671c3d5e7c3f80d` |
| `tools/experiments/sm702_foliage_baseline.js` | `32f85778d29f780023572f7da894116a043ccd9f723c82eec9e1e9593c15343a` |
| `tools/experiments/sm702_transparent_fx_baseline.js` | `c32a7e75a2de7a6997568201cdb21ea16e4bd72bb5232ee97c51e3a65af242e7` |

| Principal measured closure member | Raw SHA-256 |
| --- | --- |
| `webgpu-forward-lighting-smoke.html` | `2aa0407ac7fe413fa3e6adb67dcfa7916ca95376ce5199dd24e7ee9dec1da5d0` |
| `tools/sm702_forward_fixtures.js` | `27a94526dd14b195b42acb221f94297368bb314f6ff3fb72b8908ac32c36cc2d` |
| `engine/webgpu_forward_lighting.js` | `4b9f744fc4b84c953ebd7f49f42417ba2c4e25318b12b4da04cc70c6e34460cb` |
| `engine/webgpu_water.js` | `02d0463eea51e030fbfdb53d55d618b9cfa4a182f86cdf2346010a1f24d3eae2` |
| `engine/webgpu_foliage.js` | `791191ea8b24364ff55490a302bd9b7772d6ad016e877d8b81ef6f769540624b` |
| `engine/webgpu_transparent_fx.js` | `595314389482898cdd22dc2575d27de9d4bc0099b52b1e66c4e9e54406ca0743` |

Host: Windows 11 build 26200, NVIDIA GeForce GTX 1650 SUPER, 4096 MiB, NVIDIA driver 616.92 (Windows driver version `32.0.16.1692`), Python 3.14.7. Chrome is `154.0.8037.93` and exposes `nvidia` / `turing`, a real WebGPU device, DPR 1 and explicit `isFallbackAdapter: false`. Both timestamp-query support and the requested device feature are recorded. NVIDIA inventory and the complete unfiltered Windows controller inventory corroborate the single PCI `VEN_10DE&DEV_2187` target adapter.

Firefox 157.0 provides a separate correctness spot-check. Its adapter names are privacy-redacted, but its actual fallback flag is false; target attribution uses that explicit flag plus the complete single-controller Windows and NVIDIA inventories. It runs windowed in a disposable profile with recorded explicit `dom.webgpu.enabled`, `gfx.webrender.all` and `webgl.force-enabled` preferences, DPR 1, and cache preferences. This is not default Firefox compatibility. Firefox timing was not requested and is not reported. Firefox exception monitoring consists of page completion and explicit fixture catches/assertions; it has no Chrome-CDP exception stream. All seven owned browser processes exited.

The raw measured source closure is listed below; the manifest records the raw hash of every member, baseline Git-blob verification and the literal page script list.

| Closure member | Role |
| --- | --- |
| `webgpu-forward-lighting-smoke.html` | Actual GPU fixture and report producer |
| `tools/sm702_forward_fixtures.js` | Canonical synthetic scene and equal GPU compositor |
| `tools/experiments/sm702_water_baseline.js` | Frozen accepted water producer |
| `tools/experiments/sm702_foliage_baseline.js` | Frozen accepted foliage producer |
| `tools/experiments/sm702_transparent_fx_baseline.js` | Frozen accepted alpha/FX producer |
| `tools/validate_sm702_forward_browser.py` | Native browser, attribution and capture runner |
| `tools/run_sm702_target_campaign.py` | Serialized paired campaign coordinator |
| `tools/validate_sm702_target_report.py` | Strict report validator |
| `tools/validate_webgpu_ssgi_browser.py` | Inherited browser/CDP and evidence helpers |
| `tools/validate_sm603_target_report.py` | Inherited hardware/provenance helpers |
| `engine/webgpu_resources.js` | Actual resource registry and frame graph |
| `engine/webgpu_performance.js` | SM-500 complete-command timestamp instrumentation |
| `engine/pseudo_depth.js` | Canonical physical projection constants |
| `engine/foliagefx.js` | Canonical foliage classes and instance authoring |
| `engine/webgpu_gbuffer.js` | Material-v2 atlas/ownership inputs |
| `engine/webgpu_ownership.js` | Authoritative sprite root/depth ownership |
| `engine/webgpu_depth_hierarchy.js` | Reused SM-203 depth hierarchy |
| `engine/webgpu_lighting.js` | Actual SM-204 canonical direct shading/light buffer |
| `engine/webgpu_occluders.js` | Actual opaque occluder construction |
| `engine/webgpu_clusters.js` | Actual light/occluder clustering |
| `engine/webgpu_dominance.js` | Actual canonical dominant-light selection |
| `engine/webgpu_dso.js` | Actual direct-shadow occlusion |
| `engine/webgpu_dso_hierarchy.js` | Actual shadow hierarchy refinement |
| `engine/webgpu_gtao.js` | Actual GTAO producer |
| `engine/webgpu_gtao_stabilization.js` | Adopted temporal GTAO and shared compatibility policy |
| `engine/webgpu_gtao_readback.js` | Actual deferred statistics/readback path |
| `engine/webgpu_visibility.js` | Actual SM-307 visibility composition |
| `engine/webgpu_ssgi.js` | Accepted SM-603 incident irradiance/history producer |
| `engine/webgpu_ordering.js` | SM-402 explicit stage plan |
| `engine/webgpu_forward_lighting.js` | Candidate borrowed-input/freshness/material interface |
| `engine/webgpu_water.js` | Candidate production water |
| `engine/webgpu_foliage.js` | Candidate production foliage compute |
| `engine/webgpu_transparent_fx.js` | Candidate production glass/alpha/readability |

## Actual production correctness and captures

Each Chrome process passes 95/95 assertions, including the separately configured timing checks; Firefox passes 87/87 correctness assertions. The correctness scene is 67×51, with 17×13 quarter irradiance and an actual 71×55 lifecycle resize. The full-HD configuration belongs to timing only. WebGPU validation scopes, uncaptured-error lists and explicit JavaScript exception lists are empty. Fifteen named shader compilation records per Chrome report have no messages; actual baseline, candidate and advanced shader identities are retained.

The generated Material-v2 atlas and canonical scene are explicitly synthetic. Production ownership consumes its native height, normal, material AO and object identity, and the production SM-204 shader generates the direct image. The donor readback confirms height `0.501953125`, AO `0.7998046875`, metalness zero and emissive zero. The actual upstream chain includes ownership, the reused depth hierarchy, canonical light/occluder/cluster/dominance state, DSO and its hierarchy, GTAO with adopted stabilization, SM-307, and SM-603 SSGI. Disabled self/contact-shadow and dark-bloom inputs are explicitly neutral. No uploaded fake resolved-colour image or stale producer wrapper substitutes for these producers.

The first retained Chrome correctness report records positive incident irradiance `0.006481170654296875`, DSO maximum 1, GTAO minimum `0.9794920682907104`, SM-307 ambient minimum `0.7998046875` and valid SSGI history. The warmed full-HD witnesses remain positive in all 600 samples per variant: representative incident maximum `0.00395965576171875`, GTAO minimum `0.9784817099571228`; stress incident maximum `0.00579071044921875`, GTAO minimum `0.9760740995407104`. DSO maximum is 1 and ambient minimum `0.7998046875` in both timing scenes. AO is the stronger envelope in this fixture; the actual native B channel is used once.

The independently checked forward witnesses include:

- Disabled advanced water/foliage/glass preserve actual frozen mixed pixels exactly. Tiny and medium foliage output records are byte-identical; isolated world-additive, top-alpha, post-effects, objective and guide pixels are byte-identical.
- Eligible large foliage receives bounded positive GI through its actual compute output buffer. Its maximum added diffuse is `0.00045902488636784256`. Three actual root records match `incident * ownDiffuse * 0.6 * native SM307.B`, with maximum error `1.8611789897888392e-11`, using the shared object/depth/normal and physical-surface guards.
- Actual native water indirect debug texture is read back independently of mixed composition. Across 3,417 native pixels, 1,538 positive visible-floor pixels match the shared support/surface-gated `incident * baseColor * 0.6 * SM307.B` oracle, maximum error `4.7355890274046117e-7` against tolerance `0.00002`. Maximum water GI is `0.0009646415710449219`.
- Explicit clear glass has zero diffuse GI; explicit frosted glass has positive diffuse GI. The final glass oracle uses actual canonical light RGB, direct visibility G, ambient B, incident irradiance, own diffuse, original alpha and physical visibility. Eight angles 0° through 315° move the light and a stable actor from x18 to x32; outputs are finite and causal. A visible G=1 witness has positive direct contribution `0.056430000000000036`; its G=0 counterpart retains zero direct contribution. Maximum eight-angle oracle error is `0.00009399228962136963`, below `0.0003`.
- Lower-intensity `dim-warm` and `dim-blue` controls retain G=1 and unsaturated canonical RGB. Their direct RGB values are respectively `[0.054091724184592946, 0.053347570568273696, 0.05034471689916798]` and `[0.002036982527343835, 0.013146792664141314, 0.06669444179214458]`. Actual glass colour follows this buffer change, so a constant saturated cap cannot satisfy the witness. Oracle errors are `0.00011243608166236485` and `0.00008678460872116323`, below `0.0003`. These controls are outside the fixed benchmark scene.
- Native water visibility exposes floor and rejects the hidden actor/donor. A separate bounded refraction stress uses strength 3, wave scale 5, normal/detail/refraction 3, depth reject `0.001` and physical water Z=64. Actual shader readbacks match 2,174 tested depth-boundary samples, including 36 rejected offsets, with zero reported error. Offset rounding cases near half-integers are explicitly skipped, not claimed.
- Partial donor deletion of four/eight columns, full deletion and dark-blocker reveal reject respectively 36/50/61/52 quarter history pixels and use current irradiance exactly at rejected receivers. Stale real SSGI is rejected; independently primed room/camera/light resets clear borrowed indirect. Actual water/foliage resize rejects the old native extent, accepts the new odd extent and starts with neutral prior colour.
- Twelve frames at light multiplier 8 and SSGI energy maximum `0.003` retain positive bounded current donor work: raw maximum `0.0029544830322265625`, resolved maximum `0.0029315948486328125`, and mixed HDR maximum `3.91796875`. SSGI rejects its own composed output as direct input. This is a scripted feedback/energy boundary, not an exhaustive scene or soak claim.

Actual staged commands follow the complete SM-402 plan. Equal GPU composition in both variants reads the production foliage 80-byte instance and 48-byte output buffers directly, preserves rooted deformation/front classification, and uses canonical native-Y pseudo-depth. World-alpha attaches the same sampled opaque depth read-only. Actual foreground foliage staging is covered; this fixture does not provide a dedicated near-actor foreground-bypass witness.

The [retained acceptance page](../benchmarks/webgpu-gtx1650s/sm702-2026-10-04/campaign-a0be3ed/representative/run-1/acceptance.html), [native capture](../benchmarks/webgpu-gtx1650s/sm702-2026-10-04/campaign-a0be3ed/representative/run-1/acceptance.png) and [raw readbacks](../benchmarks/webgpu-gtx1650s/sm702-2026-10-04/campaign-a0be3ed/representative/run-1/readbacks.json) retain eight labelled actual GPU captures: baseline/candidate mixed, incident, water indirect, SM-307 visibility, water guard, and actor before/after. Mixed/actor images use exposure 1, quarter incident uses 8, water GI uses 16; the linear display transfer is exposure → `v/(1+v)` → IEC sRGB. Visibility/guard display normalized debug channels directly with recorded [0,1] ranges. These inspection exposures and debug units are recorded per capture. No human art-direction acceptance or normal-game presentation is inferred from them.

## Matched scene settings and caps

Both variants use the same canonical upstream, synthetic atlas, geometry, fixed animation frame and bounded GPU composition. Production lighting uses ambient 0.2, normal/height/roughness/metalness scale 1, material-AO strength 0.62 and specular strength 0.7. SM-307 enables actual DSO, material AO and GTAO with strengths 1 and ambient floor 0; self/contact shadow and dark bloom are off. GTAO uses six directions, four steps, intensity 1 and radius 24 scaled to 72 native pixels at full HD. SSGI is explicitly enabled Medium with pixel scale 3. This fixture opt-in does not change production defaults.

Water uses quality 3, strength 1.2, wave scale 1.3, speed 0.8, normal 1.45, detail 1.25, highlights 1.55, refraction 1.4 and depth reject `0.004`; the resolved defaults, colours, foam/ripple/edge controls and canonical surface are retained in every variant's `actualSettings`. Foliage uses quality 3, wind strength/speed 0.78/0.82, shading 0.9 and bend 1, with ambient 0.2. Candidate material GI weights are 0.6; water surface is physical Z=0, dynamic category, layer 0, bias 0. Tagged glass explicitly declares linear atlas/tint input, ambient 0.2, direct cap 0.22 and indirect weight 0.6. The baseline retains legacy shading; all candidate advanced paths are opt-in for the comparison.

| Timing scene | Ripples | Foliage | Transparent sprites | Canonical lights |
| --- | ---: | ---: | ---: | ---: |
| Representative | 2 | 6 | 5 | 2 |
| Stress | 12 | 208 | 640 | 17 |

Stress reaches the existing ripple/foliage/transparent caps; the fixture also bounds opaque inputs at 256. These synthetic configurations are reproducible workloads, not an exhaustive worst-case bound. No physical transmission, generic OIT, gameplay redesign or new per-object draw architecture is claimed.

## Measured complete forward GPU cost

All values below are GPU timestamps in milliseconds. Each scene uses three independent fresh native Chrome processes, at 1920×1080, DPR 1, pixel scale 3. Shared upstream is primed for 30 frames outside the measured forward span. Each process performs 300 warm-up pairs followed by 600 retained pairs. Within a pair both variants execute; first-variant order alternates by `(sampleIndex + rotationOffset) % 2`, with offsets 0/1/2 for runs 1/2/3. All 7,200 measured variant samples are retained, exactly 600 per variant per process, with valid warmed history, positive upstream work and one atomic measured submission each. No outlier is removed.

| Scene / fresh run | Baseline mean | Candidate mean | Mean difference | Baseline p95 | Candidate p95 | p95 difference |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Representative 1 | 0.992286 | 1.080737 | +0.088452 | 1.257472 | 1.337632 | +0.080160 |
| Representative 2 | 0.964511 | 1.052397 | +0.087886 | 1.204224 | 1.302240 | +0.098016 |
| Representative 3 | 0.964110 | 1.067900 | +0.103790 | 1.202176 | 1.339200 | +0.137024 |
| Stress 1 | 2.930796 | 5.899452 | +2.968655 | 3.235840 | 6.192128 | +2.956288 |
| Stress 2 | 2.912628 | 5.916687 | +3.004059 | 3.198080 | 6.227968 | +3.029888 |
| Stress 3 | 2.924020 | 5.960193 | +3.036173 | 3.215392 | 6.174016 | +2.958624 |

The table preserves process variation; its p95 difference subtracts the two variant p95s, not the p95 of paired deltas. Pooled descriptive values over 1,800 samples per variant per scene are representative mean 0.973636 → 1.067011 ms (+0.093376, +9.590%) and stress 2.922481 → 5.925444 ms (+3.002962, +102.754%). Pooled p95s are 1.214464 → 1.328224 ms and 3.222464 → 6.193120 ms. Neither pooling nor 600 frames per process establishes independent experimental replication or statistical significance.

The primary array `variants.*.gpuMs` is explicitly SM-500 `commandGpuMs`, also retained as the single per-frame `commandSpansGpuMs` duration. Each complete start/work/end sequence is submitted atomically. Frozen water's captured actual command and the caller's foliage/composition/stage command are enclosed by that same one submission; candidate encoding likewise has one measured submission. Separately retained `queueSpanGpuMs` may include host gaps. The nested SM-500 `timingSemantics.gpuMs` describes its inherited legacy queue-span alias, not this fixture's explicitly mapped primary array. No CPU encoding, callback, wait or readback-map latency is reported as GPU cost.

Four pass observers retain eight raw timestamp strings per sample, with mapping water [0,1], foliage [2,3], world-alpha [4,5], fixture-composition [6,7]. Composition is bounded by GPU marker passes and includes the world-alpha render pass, remaining staged composition, raw-post copy and readability work. World-alpha is nested inside composition and must not be added a second time. The following ranges are means of each fresh process's actual pass array.

| Scene / observer | Baseline run-mean range | Candidate run-mean range | Candidate-minus-baseline run-mean range |
| --- | ---: | ---: | ---: |
| Representative water | 0.485–0.502 | 0.564–0.579 | +0.078–+0.080 |
| Representative foliage | 0.023–0.027 | 0.028–0.035 | +0.002–+0.010 |
| Representative world-alpha (nested) | 0.005849–0.005953 | 0.013450–0.013862 | +0.007572–+0.007909 |
| Representative composition (includes alpha) | 0.428–0.441 | 0.436–0.450 | +0.002–+0.013 |
| Stress water | 1.603–1.615 | 1.345–1.355 | −0.260–−0.258 |
| Stress foliage | 0.080–0.094 | 0.071–0.089 | −0.023–+0.008 |
| Stress world-alpha (nested) | 0.240470–0.240880 | 3.382199–3.407167 | +3.141688–+3.166288 |
| Stress composition (includes alpha) | 1.201–1.210 | 4.460–4.494 | +3.250–+3.287 |

The stress alpha observer accounts for the dominant added work in the approximately +3 ms complete-submission mean. It is the actual capped production world-alpha batch with canonical direct/visibility/material response. The negative stress water shifts and small foliage shifts are observations of this matched fixture, not evidence that the feature optimizes either subsystem. Per-pass p95s cannot be summed into a submission p95; observer sums do not replace the complete submission measurement.

Ownership, depth hierarchy, direct lighting, DSO, GTAO, SM-307 and SSGI generation are shared and outside the primary timing span. Uploads, timestamp query resolution and diagnostic maps/readbacks are also excluded. Equal fixture GPU composition is included in both variants. This is forward-submission cost, not complete renderer/frame cost. Historical SM-501/GTAO/SSGI timings cannot be added to infer remaining frame budget or compliance with the programme's ≤12 ms mean / ≤14.5 ms p95 whole-renderer targets.

## Owned descriptor estimates and persistent resources

| Scene / owned descriptors plus equal composition | Baseline | Candidate | Difference |
| --- | ---: | ---: | ---: |
| Representative bytes | 58,092,416 | 58,093,896 | +1,480 |
| Representative MiB | 55.401245 | 55.402657 | +0.001411 |
| Stress bytes | 58,229,376 | 58,386,248 | +156,872 |
| Stress MiB | 55.531860 | 55.681465 | +0.149605 |

Each baseline inventory has 19 named descriptors; each candidate has 27. History storage owned by these forward consumers is zero. Water/foliage/transparent each adds a persistent 48-byte forward uniform and 1×1 `rgba16float` neutral incident texture (8 bytes); tagged glass adds a 32-byte lighting uniform. The other addition is the actual advanced world-alpha vertex buffer, with 68-byte records in one ordered batch; the legacy 36-byte record buffer remains allocated. The original foliage input/output strides remain 80/48 bytes. Descriptor bytes are format/extent/buffer-size accounting, not measured resident VRAM.

The exact named inventory below accounts for all 19/27 entries. Where a row groups N descriptor names it contributes N entries. Texture extents are 1920×1080×1 except the explicitly neutral 1×1 textures. Buffer values are bytes. Baseline fixture targets are 0/2 and candidate targets are 1/3; each variant accounts for two targets with equal extents.

| Names (entry count) | Format / size | Baseline representative / stress bytes | Candidate representative / stress bytes |
| --- | --- | ---: | ---: |
| `sm400:output` (1) | `rgba16float` | 16,588,800 / 16,588,800 | 16,588,800 / 16,588,800 |
| `sm400:params` (1) | Buffer 128 | 128 / 128 | 128 / 128 |
| `sm400:ripples` (1) | Buffer 384 | 384 / 384 | 384 / 384 |
| `water:field` (1) | `rgba8unorm` | 8,294,400 / 8,294,400 | 8,294,400 / 8,294,400 |
| `foliage:instances` (1) | Buffer 208×80 | 16,640 / 16,640 | 16,640 / 16,640 |
| `foliage:output` (1) | Buffer 208×48 | 9,984 / 9,984 | 9,984 / 9,984 |
| `foliage:params` (1) | Buffer 64 | 64 / 64 | 64 / 64 |
| `transparent:world-alpha` (1) | 256-aligned vertex buffer | 768 / 82,944 | 768 / 82,944 |
| `transparent:world-additive` (1) | 256-aligned vertex buffer | 256 / 27,648 | 256 / 27,648 |
| `transparent:top-alpha` (1) | 256-aligned vertex buffer | 256 / 27,648 | 256 / 27,648 |
| `transparent:post-effects:params`, `transparent:objective:params`, `transparent:guide:params` (3) | Three buffers 1,024 each | 3,072 / 3,072 | 3,072 / 3,072 |
| `transparent:frame` (1) | Buffer 16 | 16 / 16 | 16 / 16 |
| `fixture:mixed:0`, `fixture:mixed:2` baseline; `fixture:mixed:1`, `fixture:mixed:3` candidate (2) | Two `rgba16float` textures | 33,177,600 / 33,177,600 | 33,177,600 / 33,177,600 |
| `fixture:foliage-draw:0`, `fixture:foliage-draw:1`, `fixture:foliage-draw:2` (3) | Three buffers 16 each | 48 / 48 | 48 / 48 |
| `water:forward-params`, `foliage:forward-params`, `transparent:forward-params` (3 candidate-only) | Three buffers 48 each | 0 / 0 | 144 / 144 |
| `water:neutral-incident`, `foliage:neutral-incident`, `transparent:neutral-incident` (3 candidate-only) | Three 1×1 `rgba16float` textures | 0 / 0 | 24 / 24 |
| `transparent:glass-lighting` (1 candidate-only) | Buffer 32 | 0 / 0 | 32 / 32 |
| `transparent:forward-world-alpha` (1 candidate-only) | 256-aligned 68-byte vertex buffer | 0 / 0 | 1,280 / 156,672 |

Shared ownership/hierarchy/light/DSO/GTAO/SM-307/SSGI descriptors, shared atlases, query/readback resources and driver allocations are excluded. The lab compositor retains persistent targets, views, uniforms and bounded cached bind groups; producer views are reused until their texture handle changes. These inventories establish bounded named allocations, not a device-wide VRAM measurement or a soak result.

## Final verification and root reconciliation

The raw campaign has `ok: true`, six Chrome 95/95 reports, Firefox 87/87, no campaign errors and all owned browser processes exited. Independent read-only strict campaign validation and artifact/reference SHA-256 resolution pass. Raw review reproduces the per-run mean/p95 arrays, verifies each report hash against the manifest, confirms equal before/after 33-path closure hashes and finds 600 raw pass records, 600 valid-history samples and one measured submission per variant per process. `targetAcceptance: false` deliberately separates this scoped result from release/default enablement. Deterministic fixture checks passed 67 before source freeze; the final repository gate must include the retained evidence and documentation.

The full raw campaign, all reports/readbacks/captures and both preparatory native probes are retained under the linked campaign directory. [Source equivalence](../benchmarks/webgpu-gtx1650s/sm702-2026-10-04/source-equivalence.json) checks all 33 current raw bytes and LF-normalized measured/current Git blobs. [Git retention](../benchmarks/webgpu-gtx1650s/sm702-2026-10-04/git-retention-proof.json) verifies exact staged artifact bytes; scoped attributes prevent newline conversion. The [strict campaign check](../benchmarks/webgpu-gtx1650s/sm702-2026-10-04/strict-campaign-validation.json) passes.

The exact saved acceptance HTML replays successfully in a fresh installed Chrome with GPU disabled: eight actual readback canvases, correct runtime/33-path provenance and raw report link, no JavaScript exceptions and verified owned-process exit. The [replay receipt](../benchmarks/webgpu-gtx1650s/sm702-2026-10-04/acceptance-replay.json) and PNG retain the view/hash. Root inspected both native and replay captures; this is agent verification, not human approval.

The [source gate](../benchmarks/webgpu-gtx1650s/sm702-2026-10-04/sm702-final-core.json) passes 99/99 and [clean extraction](../benchmarks/webgpu-gtx1650s/sm702-2026-10-04/sm702-final-package.json) passes 26/26. A sandboxed package attempt could not create its temporary ZIP; the unchanged required command passed with native temporary-directory access. The initial native probe's screenshot-size export failure remains retained; repaired probe02 passes 87/87 and exports all artifacts. The first source-head hosted SM-404 job timed out without publishing; its entire loaded closure was unchanged, and an unchanged retry passed with no timeout or assertion adjustment. The [CI failure/retry receipt](../benchmarks/webgpu-gtx1650s/sm702-2026-10-04/initial-ci-failure.json) preserves this distinction.

[PR #115](https://github.com/techrote/steelmoth/pull/115) and [issue #41](https://github.com/techrote/steelmoth/issues/41) carry the exact final-head actual-job and verified-main landing receipts. Merge and issue closure require those final automated checks; source-head results alone cannot authorize landing. `targetAcceptance: false` continues to mean no full-renderer release/default promotion.

Reproduce into a fresh output folder; physical browser execution must be serialized with other GPU work:

```text
python tools/run_sm702_target_campaign.py --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --firefox --firefox-windowed --firefox-webgpu-override --out <fresh-output> --timeout 600
python tools/validate_sm702_target_report.py <fresh-output>/campaign.json
python tools/run_checks.py --report artifacts/core-checks.json
python tools/validate_clean_package.py --report artifacts/clean-package.json
```

The report's accepted boundary remains synthetic production-path correctness and paired complete forward-submission cost with equal fixture composition. It contains no optimization, full-frame-budget, resident-VRAM, default Firefox, human visual, normal-game presentation or dedicated near-actor foreground-bypass acceptance claim.
