# PR reconciliation — 21 October 2026

## Scope and authority

This evidence/documentation-only pass reconciles historical PRs [#101](https://github.com/techrote/steelmoth/pull/101), [#102](https://github.com/techrote/steelmoth/pull/102), [#104](https://github.com/techrote/steelmoth/pull/104), [#105](https://github.com/techrote/steelmoth/pull/105) and [#106](https://github.com/techrote/steelmoth/pull/106), starting from `main` `9ad695d185c241093bb2a8468658e96a351a8b8a`.

The dispositions below authorize closing those PRs **without merging their implementation branches**, after the preservation change is merged and verified. Their individual timelines record the executed closure actions. Original branches, source commits, comments and evidence are not deleted or rewritten. This supplements the historical [18 October snapshot](PROJECT_STATUS_2026-10-18.md), rather than rewriting its then-open PR count.

[SM601_MEASURED_ADOPTION.md](SM601_MEASURED_ADOPTION.md) remains the acceptance authority. PR #110 accepted bounded deferred telemetry plus workgroup counter aggregation; #36 is complete. This reconciliation does not reopen #36, promote `Auto`, change quality/timing gates, rerun a physical benchmark, or close the separate [SM-505 release gate](WEBGPU_RELEASE_VALIDATION.md).

## PR #102: exact historical archive preservation

The entire original [benchmark archive](../benchmarks/webgpu-gtx1650s/sm601-2026-09-19/) is retained at its original path, including raw reports, four PNG screenshots, the SVG fixture, correctness reports, repository checks and validator log.

- Source PR head: `39bb68ec652640fa83fa04c76c332df0abbbd781`.
- Measured product source: `5d1258032b27af270a925e29379e01bc84acf1d7`.
- Complete original Git subtree: `5320682dd6942ef30ea6ba4a96fdc1729c45c785`.
- Inventory: **16 files, 1,410,027 bytes**, with per-file modes, sizes and Git blob IDs in the sibling [preservation manifest](../benchmarks/webgpu-gtx1650s/sm601-2026-09-19-preservation.json).

Preservation reuses that exact existing Git tree object, including binary blobs. The manifest stays outside the archive so its tree hash and every original byte remain unchanged. No old tools, validators, shaders, workflows or `webgpu-target-benchmark.html` changes from #102 are imported.

The original `SUMMARY.md` deliberately still says to keep #36 open: that was the correct historical disposition on 19 September. It is **not current task authority**. Its approximately 2.820–2.915 ms means and 3.816 ms worst p95 are historical **queue-span** observations enclosing awaited diagnostic delivery, not shader-only execution time. Later #110 acceptance is separately recorded as 1.088006 ms queue mean / 1.288608 ms worst p95. Do not pool distributions, subtract host wait, relabel the old over-budget result as a pass, or claim a new measurement from this archival work.

With the source commit available locally, verify exact tree identity and the absence of archive changes:

```text
git rev-parse HEAD:benchmarks/webgpu-gtx1650s/sm601-2026-09-19
git diff --exit-code 39bb68ec652640fa83fa04c76c332df0abbbd781 HEAD -- benchmarks/webgpu-gtx1650s/sm601-2026-09-19
```

The first command must print `5320682dd6942ef30ea6ba4a96fdc1729c45c785`; the second must print no diff. The manifest's paths/modes/blob IDs independently reconstruct the same tree. Git IDs are identified as Git object hashes, not mislabeled as SHA-256 checksums. Source-tree identity proves preservation, not new benchmark validity or human screenshot approval.

## Useful findings and immutable study references

| Study | Preserved finding | Canonical disposition and original source |
| --- | --- | --- |
| #104 counter aggregation | Aggregating exact diagnostics within each 8×8 workgroup reduces global atomic updates, but operation-count reduction alone is not a performance claim. Actual output/counter equality and native combined measurements matter. | Incorporated through separately reviewed [PR #110](https://github.com/techrote/steelmoth/pull/110), not by merging the study. See [accepted independent-study and native-combination results](SM601_MEASURED_ADOPTION.md#independent-study-dispositions) and the [frozen original study](https://github.com/techrote/steelmoth/blob/ad06d9f128f7d2494e467da8d6b47de7151e606a/docs/SM601_GPU_FREE_PERFORMANCE_STUDY.md). |
| #105 deferred readback | Awaiting diagnostic `mapAsync()` can delay history progress and enlarge the queue span. Bounded slots, saturation handling, stale-result rejection and explicit attribution decouple diagnostics from visible output. | Incorporated through #110. Frozen/incomplete timing and later complete overlay/native data remain distinct in [accepted findings](SM601_MEASURED_ADOPTION.md#independent-study-dispositions) and the [timing-boundary contract](SM500_TIMING_BOUNDARY.md). [Frozen original study](https://github.com/techrote/steelmoth/blob/dad8c46d371522c699ecbeeb1770cfc2e6a29443/docs/SM601_DEFERRED_READBACK_STUDY.md). |
| #106 arithmetic/cache audit | Workgroup caching can regress sparse/empty workloads; lower source-level work does not guarantee a speedup. CPU LUT rounding and coarse-depth substitution have correctness counterexamples. | **No arithmetic/cache candidate adopted.** [Accepted disposition](SM601_MEASURED_ADOPTION.md#independent-study-dispositions), [frozen original audit](https://github.com/techrote/steelmoth/blob/1813085f158a24d52365b0ee5011dc32c0251c90/docs/SM601_SHADER_ARITHMETIC_MEMORY_AUDIT.md), and [later completed controls at checkpoint 94278db](https://github.com/techrote/steelmoth/blob/94278db13087ae75d43c104d76dc33e6e8b63929/docs/PHYSICAL_CAMPAIGN_PAUSE_2026-10-03.md). |

Frozen #106 stopped before physical timing on the one-ULP neutral-fixture assertion. Its software-CI success and exact candidate equality do not erase that failure. The later dense/sparse/empty/plane controls belong to separately identified diagnostic source `2b8d01582fa6ccd954b4437f175658f1d337709b`, not the frozen PR. The CPU/WGSL fallback-cutoff discrepancy was a different defect, repaired separately by [PR #107](https://github.com/techrote/steelmoth/pull/107); [GTAO_REFERENCE_POLICY.md](GTAO_REFERENCE_POLICY.md) preserves the deployed strict binary32 cutoff and nearest-raw fallback.

## Explicit PR dispositions

| PR | Close without merge because | Evidence retained |
| --- | --- | --- |
| #101 | Its coordinated SM-501/SM-601/SM-800 acceptance plan is superseded by completed #31/#36/#42 and accepted PRs #92/#110/#103. It must not become new task authority. | [Original non-canonical packet at its exact head](https://github.com/techrote/steelmoth/blob/57706cdea5cf9fd0a5e87b8955fb3b05b6fa0b51/docs/SM501_SM601_SM800_PHYSICAL_GPU_ACCEPTANCE_2026-09-19.md), existing accepted reports and issue history. |
| #102 | Its historical baseline remains useful, but its old tooling is not the accepted production implementation. #110 supplies the later acceptance. | Entire 16-file original archive and exact-tree manifest above. |
| #104 | The useful counter-aggregation work was incorporated through #110's separately measured production change. | Frozen study link, original PR/CI discussion, accepted source-separated results. |
| #105 | The useful deferred-diagnostic scheduling work was incorporated through #110; merging the old adapter would duplicate or conflict with accepted code. | Frozen study link, original PR/CI discussion, accepted source-separated results. |
| #106 | Later physical controls do not justify adopting these arithmetic/cache candidates; closure records a negative research result, not incorporation. | Frozen audit/failure, distinct later controls, #107 policy repair and accepted rejection rationale. |

## Verification boundary

Check that the preservation PR changes only this document, the documentation index, the sibling manifest and the 16 historical archive files. Verify the archive subtree hash on the candidate and again on merged `main`; compare the manifest inventory to the source tree. Run the normal hosted Verification workflow and inspect all final-head jobs before merge. Local GitHub cloning was unavailable in this execution environment, so no local full-repository, browser or physical-GPU run is claimed. Hosted results and the verified merge/closure receipts are recorded on the reconciliation PR and the five original PRs.
