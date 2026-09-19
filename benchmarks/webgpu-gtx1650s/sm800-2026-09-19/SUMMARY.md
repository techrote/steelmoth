# SM-800 physical GTX 1650 SUPER full-renderer study

Status: **COMPLETED NEGATIVE STUDY — close #42 with production formats unchanged.**

The physical full-renderer sweep completed on 2026-09-19 at Medium, native 1920x1080, DPR 1, GTAO off, using a non-fallback NVIDIA GeForce GTX 1650 SUPER with genuine `timestamp-query`. The clean measured source was `d50ba83b3c7c70c5a9a8c4891cecd61f2658fd7c`.

`reference`, `material8`, and `octMaterial8` each ran in a fresh Chrome process. Every canonical scene recreated the production resources, warmed for 100 frames, and retained 200 whole-renderer GPU samples. The study changed no HDR format and did not retest `hdr11` or treat `combined` as adoptable.

## Reference to material8

| Scene | Reference mean (ms) | material8 mean (ms) | Relative gain |
|---|---:|---:|---:|
| empty | 7.01 | 7.44 | -6.10% |
| representative | 188.90 | 206.08 | -9.09% |
| dense-static | 653.79 | 686.46 | -5.00% |
| dynamic-robot | 364.95 | 366.41 | -0.40% |
| foliage | 117.26 | 110.13 | +6.08% |
| bin-cluster | 66.09 | 114.09 | -72.62% |
| diagnostic-light | 360.01 | 374.34 | -3.98% |
| mixed | 477.32 | 473.83 | +0.73% |

Only foliage showed a potentially useful gain; five scenes regressed by at least 3%. `material8` therefore stops after the initial sweep.

## Reference to octMaterial8

| Scene | Reference mean (ms) | octMaterial8 mean (ms) | Relative gain |
|---|---:|---:|---:|
| empty | 7.01 | 7.92 | -13.04% |
| representative | 188.90 | 196.67 | -4.12% |
| dense-static | 653.79 | 641.29 | +1.91% |
| dynamic-robot | 364.95 | 372.62 | -2.10% |
| foliage | 117.26 | 106.24 | +9.40% |
| bin-cluster | 66.09 | 102.42 | -54.97% |
| diagnostic-light | 360.01 | 381.43 | -5.95% |
| mixed | 477.32 | 469.26 | +1.69% |

Only foliage showed a potentially useful gain; four scenes regressed by at least 3%, while dense-static and mixed stayed inside ordinary reference variation. `octMaterial8` therefore also stops after the initial sweep. Although oct packing improves several scenes relative to `material8`, neither candidate establishes a useful benefit relative to reference, so paired/interleaved confirmation would spend target time without an adoption candidate.

The matched reference agrees closely with the broad three-session SM-501 reference for representative, dense-static, dynamic-robot, empty, and mixed. Bin-cluster is an explicit outlier (66.09 ms here versus 9.95 ms in SM-501), consistent with cross-process/order/resource-release variation; it is not used as the sole basis for either rejection. Removing bin-cluster still leaves four material8 regressions and three octMaterial8 regressions at the 3% decision boundary.

## Numeric, downstream, and cross-browser parity

Every per-scene production readback comparison passed. `material8` was exact at the sampled production pixels. Across `octMaterial8`, the worst normal angular error was 0.268321°, roughness error was 0.00046722, material-channel error was 0, and final HDR lighting error was 0.00146484—all inside the declared thresholds.

The existing real-WebGPU precision matrix also passed on non-fallback physical Chrome and Firefox with `timestamp-query`: both reported 0.7177° maximum deterministic oct-normal error and material-8 error within the half-LSB normalized threshold. Screenshots are retained for both browsers and every full-renderer scene/variant. This correctness evidence does not override the negative full-renderer performance result.

## Evidence and disposition

- `target-report.json` contains clean source/environment/method metadata, all candidate scene statistics, three attribution directions, and per-scene production readback parity.
- `raw/` contains all 4,800 retained full-renderer GPU timestamps (three variants × eight scenes × 200 samples) and 24 screenshots.
- `correctness/` contains the real-WebGPU Chrome/Firefox numeric/readback matrix and screenshots.
- `repository-checks/` contains the pre-sweep 80/80 inherited verification report, supporting generated fixtures, and a fresh 80/80 report from the independent main-based SM-800 branch.
- `validator.log` records `completedNegativeStudy: true` with no pending paired confirmation.

No candidate is adopted. Production G1/G2/HDR formats remain unchanged, `hdr11` remains rejected, and `combined` remains a non-adoptable sensitivity bound. This completed negative physical study satisfies #42's evidence objective without claiming a bandwidth win.
