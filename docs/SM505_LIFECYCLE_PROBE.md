# SM-505 frozen normal-index lifecycle probe

`tools/sm505_lifecycle_probe.js` supplies `sm505LifecycleProbe(options)` for an
already frozen, idle, native 1920×1080/DPR1/Medium/GTAO-off normal-index fixture.
It does not launch a browser, select hardware or qualify image quality. The
outer runner must supply physical guard/adapter proof, a workload deadline,
source-before/after fingerprints and browser-compositor screenshots.

Options are `timeoutMs` (default 120000, bounded 1000–180000), optional
`sourceIdentity` and `observerSha256` from the loader. Missing source identity
remains explicitly null; JS cannot infer a Git commit from a browser surface.
Existing fixture inspection settings are recorded and preserved.

The probe performs exactly two explicit WebGPU→WebGL2→WebGPU rounds. Every
render uses `game.__smHarnessRenderOnce()` and the normal bridge. GPU checks
require exposed submitted/completed counters and a completed idle frame;
legacy CPU presentation counts cannot replace GPU completion.
The compatibility WebGL2 context must remain live and the normal-game frame-error
counter must remain zero; a surviving canvas node alone cannot prove fallback.

Resize uses the actual public `renderer.resizeToDisplaySize()` route invoked
by normal game rendering. Only test-owned `#game` and parent frame CSS width/
height change: 1280×720, then 1920×1080 and the original CSS. Actual canvas,
renderer and presenter dimensions are checked. Full presenter rebuild replaces
the G-buffer registry, whose numeric generation may reset to 1. Recreation proof
therefore records actual registry and object-target reference identities plus
their numeric generations, and verifies the retired registry has no resources.
These observations are not driver-memory/leak measurements. Missing APIs yield
explicit `NOT RUN` coverage and `ok:false`, never a passing resize claim.

One controlled `_presenterFailed` probe runs last, after saving the full runtime,
scene, resource and gameplay checkpoint. It must retire the sole WebGPU canvas,
retain before-close failure diagnostics and present a compatibility frame without
changing gameplay state. It never reselects WebGPU afterwards and never calls
`device.destroy()` to inject device loss. Actual physical device-loss testing,
room transitions and editor mutations remain separate `NOT RUN` entries.

The return object includes `ok`, `checks`, `errors`, `expectedFallback`,
`restoredExtent`, `source`, `checkpoints`, `beforeExpectedFallback`,
`afterExpectedFallback`, `notRun`, `cleanup`, and PNGs as
`screenshots:[{name,pngBase64,width,height,presentationBackend}]`.
Canvas PNGs do not replace outer browser-compositor captures. All visual,
performance and release acceptance flags remain false.

Unexpected failures stop immediately and retain failure state before cleanup.
Cleanup restores owned CSS/hooks/listeners without rendering, submitting GPU
work or retrying a backend. Native targets may consequently remain at the failed
extent; the result requires outer owned-browser teardown rather than claiming a
successful GPU restore. The CPU test is
`node tools/validate_sm505_lifecycle_probe.js`; mocks are not physical evidence.
