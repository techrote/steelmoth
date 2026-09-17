# The Small Machine at the Edge of Night — Webapp v1.2.3

## Fixed

- Identified the large yellow blobs as the procedural Fine GrassField, not point-light or water artifacts.
- Replaced the Dusk-Rust `far_forest/tree_lights` Fine GrassField palette with a dark teal Wet-Relay vegetation palette.
- Fine GrassField now samples the lit Material-v2 scene and follows the actual main-light direction.
- Reduced Fine GrassField blade width/height and capped alpha to prevent opaque clump masses.
- FoliageFX now consumes Material-v2 normals and the lit-scene visibility field instead of remaining an independently lit legacy layer.
- Flipped foliage now flips its material normal X component correctly.
- Increased hard-light visibility sampling from 65/97 rays to 193/257 rays at quality 3, substantially reducing long-throw angular stepping.
- Local BAT/Python preview now unregisters old service workers and deletes old `small-machine-web-*` caches automatically; localhost preview is intentionally uncached.

## Preserved

- Material v2 MRT G-buffer / GGX lighting.
- Height self-shadowing and contact shadows.
- v1.1.2 macro secondary-light shadows.
- Current robot behavior, gameplay and editor data.
- Legacy material pipeline fallback.
