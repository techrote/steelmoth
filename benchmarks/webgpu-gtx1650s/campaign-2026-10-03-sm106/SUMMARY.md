# Target arithmetic/cache controls

Source `2b8d01582fa6ccd954b4437f175658f1d337709b` is a diagnostic-only
reconciliation of the occupied-plane oracle with existing canonical arithmetic
policy. Frozen #106 and its failed witness remain intact; all shaders,
parameters, candidate byte comparisons and timer boundaries are unchanged.

All dense, sparse, empty and occupied-plane controls completed three fresh
GTX 1650 SUPER processes, with 300 warm-up and 600 retained samples per variant.
Each process passes 122 correctness configurations. See `summary.json` for
per-pass and two-pass means and the four raw reports for all samples and metadata.

No arithmetic/cache candidate is selected: sparse/empty regressions outweigh
the dense/plane reconstruction benefit. The production deferred/counter adoption
in PR #110 is unchanged. No physical timings or sample distributions from frozen
or other overlay heads are mixed into these results.

The detailed checkpoint and resume instructions are in
[`PHYSICAL_CAMPAIGN_PAUSE_2026-10-03.md`](../../../docs/PHYSICAL_CAMPAIGN_PAUSE_2026-10-03.md).
