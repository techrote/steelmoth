# SM-702 advanced forward lighting

Issue authority: [SM-702 #41](https://github.com/techrote/steelmoth/issues/41).
Accepted prerequisites are SM-400, SM-401, SM-402, SM-601 and SM-603.

## Decision â€” optional borrowed inputs

`engine/webgpu_forward_lighting.js` supplies the optional shared interface.
`sourceFromPaths({lighting, gbuffer, hierarchy, visibility, ssgi,
opaqueResolvedView})` accepts the canonical producers. `refreshSource` captures
their current views, native extent, device, resource generations, update counts
and invalidation counts, registry resize/destruction and canonical handle identity.
Raw opaque resolved views are scoped to their factory resource lifetime; rebuild
the source after resource/device replacement. Upstream updates must be awaited and frames serialized;
known in-flight SSGI updates are rejected. `assertFresh` rejects a producer that changed during
encoding/submission. SSGI incident history is refreshed on every update because
its ping-pong view changes without a resource-generation change. A supplied
invalid SSGI producer is an error; omitted optional SSGI uses persistent zero
incident radiance. Missing required depth/light/visibility inputs are errors.

The source borrows the sole SM-204 light buffer, SM-202 native ownership depth,
object ID and G1 normal, SM-203 hierarchy identity, SM-307 visibility and SM-603
quarter-resolution **incident** diffuse. It does not reconstruct another depth
pyramid or use opaque composed colour as incident lighting. Water refraction may
read the stable opaque resolved image, including its already composed lighting;
it never feeds back the evolving transparent target.

SM-601's object/depth/normal compatibility test compares each native opaque
anchor with the quarter cell representative. Empty, cross-object, depth or
normal discontinuities receive zero indirect diffuse. The transparent material
does not need to own an opaque G-buffer ID. Incoming channels are finite,
nonnegative and capped at 0.08 before material response. Each new diffuse term is
`incident * ownDiffuse * indirectWeight * SM307.B`. Material AO and GTAO have
already been reconciled by SM-307; their product is never applied again. The
existing direct response and the already lit refracted image retain their
existing visibility treatment.

## Decision â€” explicit material participation

| Material | New indirect diffuse | Depth / special boundary |
| --- | --- | --- |
| Water | Own water palette; bounded weight | Explicit finite `surface.worldZ`, canonical category/layer/bias; native actor occlusion and existing refraction discontinuity rejection |
| Large BUSH / BROAD_LEAF | Own non-emissive palette at the root; only existing macro-eligible classes | Existing rooted deformation/front classification; canonical projected height/layer/bias |
| Fine Grass, moss, small foliage, fern/flower contact classes | Zero | Existing bounded receiver/contact response; no per-blade rays or DSO generation |
| Explicit `clear-glass` | Zero | Canonical surface depth and crisp atlas sampling; compatibility colour/alpha retained |
| Explicit `frosted-glass` / `diffuse-surface` | Own sampled/tinted diffuse; weight 0..1 | World-alpha only; canonical surface depth and crisp atlas sampling |
| Untagged alpha, additive FX, top/readability overlays | Zero | Existing compatibility stage policy |
| Other transmission materials | Deferred | No new physical transmission, subsurface or generic OIT model |

Glass opt-in is per sprite `style.forwardLighting` with `material`, `worldZ`,
optional category/layer/bias and `diffuseWeight` (default 0.25).
`colorSpace` is `srgb` by default for the legacy authored atlas and tint; diffuse
participants decode both before response. `linear` explicitly declares an
already-decoded atlas view and linear tint (including numeric test inputs). A
caller using an sRGB texture view must declare the sampled atlas/tint linear to
avoid decoding twice. Clear/compatibility colour retains its established path. Atlas class names
do not implicitly opt smoke, EMP or gameplay effects into glass lighting. Clear
glass forces weight zero. Unsupported material roles retain compatibility
behaviour and an explicit deferred reason. Known participating roles require a
finite physical height; normalized ownership depth is never inverted into one.

SM-202 projection receives actual native framebuffer Y and normalized local
height, with the canonical layer/bias lanes. Water rejects a surface behind the
opaque actor before refraction. World-alpha samples the native depth while
attaching it read-only, uses `less-equal`, and never writes opaque ownership.

## Decision â€” bounded resources and staged integration

All advanced paths remain disabled by default. Optional pipeline preparation is
explicit; the existing compatibility shaders, controls and gameplay fallback
remain available. One forward binding owner holds a 48-byte uniform and an
8-byte neutral incident texture, with at most six cached binding groups. Existing
water ripple cap 12, foliage cap 208 and transparent sprite cap 640 remain.
Foliage keeps its 80-byte input / 48-byte output ABI. Advanced alpha uses a
68-byte vertex record in one ordered stage batch; legacy records remain 36 bytes.
Per-vertex material/surface data preserve overlap order without per-object draws.
Tagged glass additionally owns one 32-byte canonical direct-response uniform;
its light buffer is borrowed. Cached groups remain bounded. Deferred compilation
and pipeline preparation cannot allocate or publish readiness after close.

The production foliage path produces its established compute output buffer.
The acceptance fixture supplies a bounded GPU compositor that consumes that
actual buffer in the SM-402 stage order. This compositor is acceptance material;
it does not establish normal-game WebGPU presentation. `Auto` remains WebGL2 and
SM-505's physical presentation/human-review gates remain separate.

## Verification and measurement boundary

```text
node tools/validate_sm702_forward_lighting.js
node tools/validate_sm702_transparent_materials.js
node tools/validate_sm702_forward_fixtures.js
python tools/validate_sm702_target_report.py --self-test
python tools/validate_sm702_forward_browser.py --report artifacts/sm702-forward.json --out artifacts/sm702-forward
python tools/run_sm702_target_campaign.py --firefox --firefox-windowed --firefox-webgpu-override --out artifacts/sm702-target
python tools/validate_sm702_target_report.py artifacts/sm702-target/campaign.json
python tools/run_checks.py --report artifacts/core-checks.json
python tools/validate_clean_package.py --report artifacts/clean-package.json
```

The mixed fixture uses actual production ownership, hierarchy, direct lighting,
occluder bins/clusters/dominance/DSO, GTAO/adopted SM-601 history, SM-307 and
SM-603. Positive incident diffuse, GTAO occlusion and DSO are required. Generated
test atlases are named fixture inputs. Correctness includes material exemptions,
single ambient response, canonical actor overlap/refraction, moving lights and
actors, history changes and producer lifecycle rejection. Tagged frosted/diffuse glass has a separate actual canonical-light/G
and single-B oracle; clear, additive and readability exemptions are read back
independently. Captures retain raw
linear HDR/data values plus named display transforms.

The frozen comparison modules are exact LF-normalized accepted-main `cb068323`
water, foliage and TransparentFX. Native characterization uses three fresh
Chrome processes per representative/stress configuration, native 1920x1080,
DPR 1, pixel scale 3, 300 warm-up pairs and 600 retained pairs. Stress reaches
existing caps. SM-500 brackets one actual mixed-forward submission in each
variant. The baseline water command is captured by narrow test-only submission
instrumentation and atomically submitted with the remaining forward commands;
its shaders and pipelines are unchanged. Water, foliage, world-alpha and equal
fixture composition have separate real pass observers. World-alpha is nested
inside the composition observer and cannot be added to it again.

Complete forward timing includes the equal fixture compositor and its post copy.
Upstream opaque/DSO/GTAO/SSGI production, scene upload, query resolution/readback
and presentation are excluded and labelled. These measurements characterize the
tested forward delta, not a complete renderer frame or remaining frame budget.
Owned descriptor bytes are accounting, not measured resident VRAM. Source closure
and raw artifact hashes must be retained before any measured result is adopted.

## Current evidence state

Implementation and CPU contract preparation are in progress. No SM-702 native
measurement, browser compatibility, human visual acceptance or default promotion
is claimed by this preparation document.
