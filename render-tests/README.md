# Renderer regression fixtures

- `fixtures/` — deterministic SM-001 engine-scene inputs and `index.json` state fingerprints.
- `references/original/` — immutable recovered historical PNG evidence.
- `references/provenance.json` — exact hashes, byte counts, dimensions, recovery/missing status.

Validate with `python tools/validate_render_fixtures.py`.

Browser capture/query automation belongs to SM-002; it must consume this corpus rather than duplicate it.
