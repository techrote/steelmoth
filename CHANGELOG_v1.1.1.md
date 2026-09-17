# The Small Machine at the Edge of Night — Webapp v1.1.1

## Lighting / shadows

- Replaced terrain shadow-width approximation with **height-projected sectioned sprite shadows**.
- Standing terrain props use silhouette-derived cross-sections, inferred 2.5D height and a virtual light elevation.
- The flashlight cone is now an explicit shadow-casting light originating at the player's face and clipped to the visible beam.
- Bump/specular light direction now originates at the actual player light emitter, not a point halfway down the cone.
- Shadow mask promoted from half-resolution to **full scene resolution** for crisp edges.
- Bump lighting enabled by default at 1.45; specular response 0.42.
- Player cone intensity default increased to **2.0**; omni fill increased slightly to **0.16**.

## Terrain material regeneration

- Inspected and reprocessed **45** static terrain/environment/objective sprites.
- Regenerated bump and specular atlas regions for the complete static terrain set.
- Added material classes: flat, vertical_plane, box, barrel, pole, frame, pipe.
- Added height-aware projected shadow profiles to standing/solid/objective volumes.
- Flat ground remains a shadow receiver rather than a vertical caster.
- Added deterministic regeneration tool and machine-readable profile report.

## Robot behavior

- Passive stalkers that are visible in the rendered light but outside fear/close-flee distance now enter `freeze_lit`: path cleared, target speed zero, velocity rapidly damped.
- Active stalkers retain evasive behavior; the shorter/wider fear cone remains authoritative for actual flight.
