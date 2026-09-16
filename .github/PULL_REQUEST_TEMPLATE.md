## Steel Moth implementation PR

### Issue / task

Closes #<!-- issue number -->
Task code: `SM-___`

### Objective

<!-- One concise statement of what this PR implements. -->

### Scope actually changed

<!-- List relevant renderer/game/editor/docs/tests paths and note any necessary reconciliation outside the issue's nominal scope. -->

### Canonical contracts reviewed

- [ ] `AGENTS.md`
- [ ] assigned issue in full
- [ ] relevant documents from `docs/INDEX.md`
- [ ] current `main` and relevant recent merged PRs

### Verification performed

<!-- Exact commands, browser/hardware runs, fixture names, light angles, readbacks, and results. Do not write “tests pass” without naming them. -->

- [ ] issue-specific automated tests
- [ ] relevant inherited regressions
- [ ] WebGPU validation/error-scope checks where applicable
- [ ] deterministic fixtures/readbacks where applicable
- [ ] editor/room invalidation tests where applicable
- [ ] clean package/extraction test where applicable

### Visual evidence

<!-- Link/cite committed capture artifacts or state why visual review is not applicable. Distinguish reconstructed fixtures from authoritative reference screenshots. -->

### Performance evidence

<!-- If performance changed: record GPU/browser/driver/resolution/quality/fixture/method, GPU vs CPU timing, before/after distributions, and memory delta. If not measured, say so. Never infer GPU timing from CPU timing or Task Manager utilization. -->

### Architecture / documentation reconciliation

- [ ] no architecture contract changed
- [ ] OR relevant canonical docs/ADR were updated in this PR

Documents updated:

<!-- paths -->

### Fallback and failure behaviour

<!-- For WebGPU changes: state tested behaviour for unsupported/failed WebGPU, device loss where relevant, and WebGL2 fallback. -->

### Known limitations / blockers

<!-- Anything not actually verified, unavailable target hardware, missing reference screenshots, optional feature absence, etc. -->

### Acceptance checklist

- [ ] issue acceptance criteria are satisfied
- [ ] stopping conditions were reviewed and none remain applicable
- [ ] no unsupported empirical claim is presented as fact
- [ ] no gameplay authority moved into a cosmetic renderer subsystem
- [ ] no duplicate private root/depth/light convention was introduced
- [ ] CI/required checks pass before merge
