# The Small Machine at the Edge of Night — Webapp v1.1.0

## Added

- Sectioned terrain shadow profiles for major blocker, terrain-prop and objective sprites.
- Terrain lighting audit document: `TERRAIN_LIGHTING_AUDIT_v1.1.0.md`.
- Regeneration tool: `tools/regenerate_terrain_lighting_maps.py`.
- Exported profile summary: `assets/generated/terrain_shadow_profiles_v1.1.0.json`.

## Changed

- Terrain/objective sprites now use silhouette-derived grounded footprints and multiple horizontal shadow sections to better fit the webapp's 2.5D/isometric presentation.
- Shadow overlay renderer now supports sectioned sprite casters instead of only rectangle silhouettes.
- Bump and specular atlases were regenerated for the audited terrain/objective sprites.
- Collision footprint factors for the audited sprites were normalised to remain gameplay-safe while better matching their visual base.
- Service-worker cache bumped to `small-machine-web-v1.1.0-r1`.

## Notes

- Existing `signalOrchardGraphicsV108` settings namespace is intentionally retained.
- Historical changelog files are preserved unchanged.
