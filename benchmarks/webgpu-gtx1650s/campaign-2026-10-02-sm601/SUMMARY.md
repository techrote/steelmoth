# Retained SM-601 physical campaign

This folder preserves source-separated studies, failed/partial reports, native
combination evidence, final production acceptance and command diagnostics.
The campaign started on 2026-10-02 and was checkpointed on 2026-10-03 at the
user's request. Production source is `b1e87b0a8e07ac2ca3e240dbec8f2a708eaa5275`.

See [`PHYSICAL_CAMPAIGN_CHECKPOINT_2026-10-03.md`](../../../docs/PHYSICAL_CAMPAIGN_CHECKPOINT_2026-10-03.md)
for status, measurements, source identities, blockers and resume instructions,
and [`SM601_MEASURED_ADOPTION.md`](../../../docs/SM601_MEASURED_ADOPTION.md) for
the adopted candidate's contracts and boundaries.

- Final queue-only acceptance: 1.088006 ms mean of three run means; worst p95
  1.288608 ms. All 1,800 raw timestamp samples remain retained.
- Separate explicit-command diagnostic: 1.069927 ms mean / 1.269472 ms p95,
  with both submissions covered; its queue distribution is separate.
- Physical production/frozen equivalence: four full-HD snapshots and 63
  rejection/lifecycle fixtures pass exact texture/counter comparison.
- Repository source/regression 86/86 and package checks 18/18 pass.
- #106 remains blocked before performance by its strict baseline neutral
  assertion. No research PR is merged, no quality is reduced, no tolerance is
  relaxed, and no new human visual sign-off is asserted.

`EVIDENCE_MANIFEST.json` records Windows raw byte hashes and canonical Git text
hashes for portable verification. Text canonicalization changes only CRLF to LF;
raw sample values are never changed. Old timeout and startup-failure evidence is
retained rather than overwritten or pooled with new source heads.
