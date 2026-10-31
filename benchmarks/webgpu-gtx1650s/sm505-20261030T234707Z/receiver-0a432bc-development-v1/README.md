# Receiver diagnostic: 0a432bc, development preset version 1

Actual local GTX 1650 SUPER diagnostic of normal `index.html`, Chrome156,
1920×1080/DPR1/Medium/GTAOoff. Source and original files are frozen separately
from later inspection settings. This is **not visual/performance/release acceptance**.

`originals.zip` contains every original PNG, numeric buffer, report, browser log,
watchdog telemetry, source fingerprint, stdout/stderr and attempt manifest from
`physical-0a432bc-development` and its guard. Extract it to verify each original
manifest in its original directory. Direct PNG/report copies aid review; the
campaign-level manifest covers all published files.

The source-matched receiver probe passed12/12 checks: zero changed object IDs,
shader-visible ownership-depth values or occupied material bytes; all1,941,112
unowned pixels have the neutral background material; the old missing-receiver
negative has no floor lighting; the cone changes1,488,593 floor pixels.64GPU/CPU
quantized-material samples have maximum error0.00005746035 against0.003 tolerance.
These are representation/lighting checks, not human visual acceptance.

Inspection version1 used ambient0.55, full beam150°, range520, intensity3 and
explicit neutral diagnostic grading. The user rejected the broad/bright view;
later version2 settings are a different dataset and must not be pooled here.

Visible unresolved faults: opaque composition does not consume SM307 shadow
visibility; central static props have a second material copy below background
artwork. `anchor-analysis.json` retains source/ID metrics and screenshot hashes.
Both native backends show the inherited anchor mismatch. No visual gate passes.
