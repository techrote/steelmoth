# Native diagnostic: 0de5890, development inspection v2

Exact source: `0de5890a49e1c82d7a1cda643201193ec3309fba`. Actual local GTX1650SUPER4096MiB,
driver616.92, Chrome156.0.8078.74,1920x1080/DPR1/Medium/GTAOoff.
Inspection controls remain ambient0.18/full beam35 degrees/range900/intensity6.
All acceptance flags remain false; these are correctness diagnostics, not timings.

`originals.zip` contains EVERY original file from the native attempt, its guard
and its source-check directory. Attempt directories and their original manifests
are retained inside the ZIP; extract them to verify custody. DirectPNG/JSONcopies
aid review. Different heads/configurations are not pooled.

Receiver controls:12/12 PASS, unchanged IDs/full shader-visible depth/occupied
material; GPU/CPU floor reference64samples maximum error
3.20435709446e-05 versus0.003.
Streamed direct controls:57pixels x4states PASS, maximum error
9.52259070985e-05 versus0.003.
The actual scene has0emissive material pixels; materialemissivephysicalcoverage
is explicitlyNOTRUN here. NoGPUtimestamps/performance target results are claimed.

The GPU checks141visible bottom-anchored staticobjects with0ownedpixels outside
their declared drawrectangle and0at/below their bottomdrawanchor. The user
reviewed this exactPNG and answered: "No remaining doubled outlines visible".
This accepts the duplication correction in this capture only. Distant shadow
noise remains rejected and blocks complete visual qualification. Internalunit
fixes preserve material/depth/topology; WebGL2 visual parity is not a criterion.
