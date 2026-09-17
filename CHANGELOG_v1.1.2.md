# The Small Machine at the Edge of Night — Webapp v1.1.2

## Terrain shadow correction

- Fixed the v1.1.1 terrain shadow height unit mismatch: atlas-pixel heights are no longer interpreted as logical/world heights.
- Replaced absolute `height_px` metadata with scale-safe `height_ratio` metadata.
- Added explicit `slices[]` grouping to terrain shadow profiles; open frames/pipes may retain multiple spans per altitude.
- Terrain wall/blocker cells now build shadow casters from their actual sprite profile when available, rather than only from the collision-cell rectangle.
- Player cone/omni direct-light hard clipping now uses a separate hard-occluder set. Free-standing props cast projected shadows instead of behaving like infinite-height beam blockers.
- AI/robot LOS remains on the full physical obstruction set.
- Corrected projection uses rendered world height with a bounded pseudo-light elevation; normal maximum sampled terrain projection is now ~0.325 at the player cone light instead of saturating the old 3.4 clamp.
- Projected shadow opacity cap reduced slightly to prevent near-black terrain wedges while retaining contact/AO.
- Re-ran deterministic terrain bump/specular generation for the 45 audited static terrain/environment/objective sprites.
- Added a diagnostic projection image and v1.1.2 validation script.
