# SM-307 bounded shadow / occlusion visibility composition

SM-307 is the composition boundary between the already-validated shadow/occlusion producers and later WebGPU lighting integration. It consumes existing masks; it does **not** reinterpret upstream mask meanings and does not generate any new occlusion field.

## Inputs and meanings

All composition inputs are converted to **visibility** (`0 = fully occluded`, `1 = fully visible`) before combination:

| Producer | Input semantic | SM-307 conversion / role |
| --- | --- | --- |
| SM-304 DSO hierarchy | hard macro occlusion, `0/1` darkness mask | `dsoVisibility = 1 - dsoOcclusion`; coherent macro blocker |
| SM-205 height self-shadow | visibility | local material-height occlusion |
| SM-205 contact reconstruction | visibility | short-range grounding only |
| SM-306 temporal Dark Bloom | residual occlusion amount | `darkBloomVisibility = 1 - residual`; soft macro residual only |
| Material-v2 G2.z | material AO visibility | intra-object ambient visibility, blended by `materialAOStrength` |
| reserved GTAO | visibility | future inter-surface/world ambient visibility; no GTAO is implemented by SM-307 |

Dark Bloom remains weaker than its hard DSO source and is capped by `bloomMax`. SM-307 never temporally smooths DSO, ownership, self-shadow, contact shadow, AO, or the combined result.

## Formula and rationale

The inputs overlap semantically, so they are **not multiplied independently**. Blind multiplication would allow a dense bin intersection that is already represented by DSO, self-shadow, contact, Bloom and AO to collapse toward black multiple times for the same physical obstruction.

For enabled terms:

```text
macroVisibility   = min(dsoVisibility, darkBloomVisibility)
localVisibility   = min(selfShadowVisibility, contactVisibility)
directVisibility  = min(macroVisibility, localVisibility)

materialAOVis     = 1 - (1 - materialAO) * materialAOStrength
gtaoVis           = 1 - (1 - gtaoVisibility) * gtaoStrength
ambientVisibility = max(ambientFloor, min(materialAOVis, gtaoVis))

combinedEnvelope  = max(
  dsoHard ? hardCoreFloor : combinedFloor,
  directWeight * directVisibility + ambientWeight * ambientVisibility
)
```

Default direct/ambient weights are `0.8 / 0.2` and are normalized if changed. Defaults are `ambientFloor=0.35`, `combinedFloor=0.18`, and `hardCoreFloor=0.12`.

The `min` operations mean *strongest overlapping evidence wins* rather than stacking equivalent evidence. DSO hard core can still drive **direct** visibility to zero, but it does not erase the ambient readability envelope. This distinction is important for later deferred-lighting integration: consumers should use the dedicated direct and ambient channels instead of blindly applying the combined debug envelope as a universal multiplier.

## Output

`WebGPUVisibilityComposition` writes one persistent `rgba16float` visibility texture:

- R: combined visibility envelope (diagnostic / bounded final-composition proxy);
- G: direct shadow visibility;
- B: ambient/AO visibility;
- A: DSO macro visibility.

It also writes an `r32float` debug texture. The available debug modes are:

`combined`, `direct`, `ambient`, `dso`, `self-shadow`, `contact-shadow`, `dark-bloom`, `material-ao`, `gtao`, `macro`, and `local`.

All individual debug modes use visibility convention: white is visible, black is occluded. This keeps term comparisons unambiguous.

## Term toggles

Each term has an independent flag (`dso`, `selfShadow`, `contactShadow`, `darkBloom`, `materialAO`, `gtao`). Disabling a term substitutes neutral visibility (`1`) for only that term. No upstream resource is cleared or mutated and no other term's state is rewritten. Toggle tests therefore compare the affected direct/ambient channel while requiring the unrelated channel to remain unchanged.

## Dense-scene readability

The default floors are intentionally conservative. They do not weaken the upstream hard DSO mask; they bound the **composition envelope** after the shadow and ambient channels have been separated. Diagnostic dense-bin tests use simultaneous strong self/contact/Bloom/AO evidence and require:

- no non-hard combined sample below `0.18`;
- hard DSO samples retain at least the `0.12` ambient readability envelope;
- the bounded result remains materially brighter than the equivalent blind-product result;
- direct visibility still reaches zero under a hard DSO core.

These are diagnostic composition bounds, not a claim about final game luminance. SM-307 does not alter exposure, tone mapping, emissive response, or post-processing.

## Reserved GTAO interface

SM-307 defines the consumer side of GTAO without implementing GTAO:

- semantic: visibility, `0 = occluded`, `1 = visible`;
- boundary resolution: full resolution;
- texture contract: single-channel float texture sampled as `texture_2d<f32>`;
- producer may run reduced-resolution internally, but must depth-aware reconstruct before the SM-307 boundary;
- absent GTAO is neutral visibility `1` and the GTAO flag is off;
- enabling GTAO without supplying `gtaoVisibilityView` is an error.

`sourceFromPaths(..., gtao)` accepts either a future producer exposing `bindings().visibility` / `bindings().gtaoVisibility` or a direct compatible texture view. There is no GTAO generator, horizon search, temporal GTAO history, or quality budget in this task.

## Invalidation and ownership

SM-307 owns only its output textures, uniform buffer, pipeline cache and validity flag. Resize/device reset recreates those resources. Input producers continue to own their own invalidation rules. Because the pass is stateless per frame, room/light/object changes require no additional history rejection in SM-307.

## Validation boundary

The dedicated SM-307 gate covers:

1. deterministic CPU formula and term-toggle matrix;
2. dense-scene visibility sanity bounds versus a blind-product baseline;
3. real Chrome/WebGPU WGSL execution and GPU/CPU readback agreement;
4. every individual and combined debug mode;
5. two shifted/moving-light-style input captures proving the composition is stateless and follows current input;
6. reserved GTAO-off and GTAO-on interface behaviour;
7. a retained screenshot of the control/dense visibility panels for later human review.

Hosted CI is correctness evidence only. It does not claim GTX 1650 Super GPU timing or replace later whole-scene visual tuning.
