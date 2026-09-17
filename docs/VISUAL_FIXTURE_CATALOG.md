# Steel Moth visual fixture catalog

This catalog is the durable SM-001 corpus for renderer and lighting regression work. It separates recovered historical screenshots from deterministic reconstructed engine fixtures. The fixtures intentionally do **not** change renderer algorithms; SM-002 owns browser capture automation and direct query-parameter loading.

## Contract

Each `render-tests/fixtures/<name>.json` document uses `steelmoth-render-fixture/v1` and contains four deterministic inputs: `deterministic`, `camera`, `light`, and `scene`. `scene` is deliberately shaped like a `game_data/maps.json` room so the capture harness can inject it without inventing a second scene model. `camera.player` and `camera.aim` are explicit world coordinates. Every fixture declares `requires_gameplay_save_state: false`.

`render-tests/fixtures/index.json` records a SHA-256 fingerprint over those four deterministic inputs. `tools/validate_render_fixtures.py` loads every fixture repeatedly (three times by default), recomputes the fingerprint, checks authored procedural seeds, validates referenced atlas assets, and verifies exact historical-reference hashes. This is the SM-001 named-load path; SM-002 should consume the same files rather than fork their definitions.

Run:

```text
python tools/validate_render_fixtures.py
python tools/validate_render_fixtures.py --fixture binsright --repeat 3
python tools/validate_render_fixtures.py --fixture dense-mixed --print-state
```

The v1 angle convention is screen-space: 0° east, 90° south, 180° west, 270° north. Every current fixture uses one of the eight canonical 45° increments from `WEBGPU_VALIDATION_PLAN.md`. The diagnostic preset is fixed to the historical values: emissive 2.0, light-radius multiplier 2.0, player omni radius 80, omni intensity 1.6, cone intensity 2.0, cone inner 30°, cone outer 60°.

## Historical reference recovery

SM-001 recovered eight exact PNGs from the user's retained Library and preserves their original filenames and bytes under `render-tests/references/original/`. Byte counts, dimensions, SHA-256 digests and recovery status live in `render-tests/references/provenance.json`.

The historical `boxes` positive-control family was recovered as four directional captures: `boxleft.png`, `boxright.png`, `boxup.png`, and `boxdown.png`. No source file literally named `boxes.png` was found, so the family label is retained without fabricating such a file.

The requested `binsright.png`, `binsleft.png`, and `binsup.png` were recovered. `binsupright.png` was also recovered from the same directional family and is retained as supplementary evidence. The user later confirmed that `binsupleft.png` **was also a historical screenshot**, but its original bytes/file have not been recovered or committed. Its artifact status therefore remains explicitly missing in provenance; the current `binsupleft` JSON fixture is reconstructed and must never be represented as the original screenshot.

## Fixture inventory

| Fixture | Purpose | Primary authored content | Historical reference |
| --- | --- | --- | --- |
| `empty-floor` | clear/background control | no authored objects | none |
| `single-box` | compact positive control | one `cargo_crate` | box directional family |
| `box-pair` | compact overlap control | two overlapping `cargo_crate` sprites | box directional family |
| `binsright` | overlapping-bin directional control | three overlapping `dumpster` sprites | `binsright.png` |
| `binsleft` | opposite horizontal bin direction | same deterministic bin topology | `binsleft.png` |
| `binsupleft` | diagonal overlap stress case | same deterministic bin topology | historical image confirmed; **original artifact missing** |
| `binsup` | upward directional bin case | same deterministic bin topology | `binsup.png` |
| `crate` | Material-v2 box/crate control | `cargo_crate` | none |
| `barrel` | cylindrical normal control | `rust_barrel` | none |
| `cabinet` | tall metal planar/detail control | `server_cabinet` | none |
| `pipe-bundle` | cylindrical/internal-gap control | `pipe_cluster` | none |
| `lamp-pole` | thin silhouette + emissive context | `street_lamp`, `signal_pole` | none |
| `robot` | frozen robot material control | `hex_maintenance_idle_0` | none |
| `foliage-dense` | authored + seeded foliage control | 3 foliage sprites, 2 seeded clumps | none |
| `water-material` | water/canonical-light control | deterministic water grid + props | none |
| `dense-mixed` | representative stress scene | bins, crate, barrel, cabinet, pipes, foliage, water, lamp | none |

## Expected observations

The recovered box captures remain positive controls: compact isolated objects historically produced convincing Material-v2/direct-light response. The bin captures document the overlap failure family. `binsright` and `binsleft` are expected to expose fragmented shadow ownership when large overlapping sprites are treated independently. `binsupleft` exists to exercise the historical direction sensitivity; because its original artifact is currently unavailable, the fixture is a deliberately reconstructed topology rather than a visual-parity oracle for that historical image. `binsup` records the later qualitative target: one coherent lower-bin primary shadow with softer low-frequency residual occlusion rather than several independently strong wedges.

These observations are diagnostic expectations, not renderer fixes or pass/fail screenshot thresholds. Future WebGPU ownership, clustering, DSO, and Dark Bloom work should add machine-readable representation metrics without changing the immutable provenance of recovered original PNGs.

## SM-002 integration handoff

The renderer harness should load a fixture by name from `index.json`, construct a synthetic room from `scene`, place the player at `camera.player`, aim at `camera.aim`, apply the declared diagnostic-light fields, freeze deterministic time where requested, and bypass persistent gameplay progression. It should preserve the fixture state SHA-256 in capture metadata. SM-002 may add backend/quality/resolution/DPR/capture controls, but it should not silently mutate SM-001 transforms or seeds.

Original PNGs are evidence only. They are never to be overwritten by generated captures.
