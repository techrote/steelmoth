# Native diagnostic: b5f5817, development inspection v2

Exact source: `b5f5817e82156aebb7c807e1d083e8593a75c69e`. Actual local GTX1650SUPER4096MiB,
driver616.92, Chrome156.0.8078.74,1920x1080/DPR1/Medium/GTAOoff.
Inspection controls remain ambient0.18/full beam35 degrees/range900/intensity6.
All acceptance flags remain false; these are correctness diagnostics, not timings.

`originals.zip` contains EVERY original file from the native attempt, its guard
and its source-check directory. Attempt directories and their original manifests
are retained inside the ZIP; extract them to verify custody. DirectPNG/JSONcopies
aid review. Different heads/configurations are not pooled.

Receiver controls:12/12 PASS, unchanged IDs/full shader-visible depth/occupied
material; GPU/CPU floor reference64samples maximum error
0.00011567825944 versus0.003.
Streamed direct controls:57pixels x4states PASS, maximum error
9.52259070985e-05 versus0.003.
The actual scene has0emissive material pixels; materialemissivephysicalcoverage
is explicitlyNOTRUN here. NoGPUtimestamps/performance target results are claimed.

VisualFAIL: static material geometry duplicates the background artwork; distant
static-straw shadows are speckled. The user approved the inspection brightness,
not these defects. The524pixelDSOmask is reproduced exactly by CPU replay; its
coverage alone is not a failure threshold or a WebGL2-parity target.
