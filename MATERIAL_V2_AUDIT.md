# MATERIAL V2 AUDIT

Generated for all **314** atlas regions.

Channel contract:

- Normal/Roughness: `RGB = encoded XYZ normal`, `A = roughness`.
- Height/Material: `R = pseudo-world Z / 64`, `G = material AO`, `B = metalness`, `A = emissive/auxiliary`.

Class coverage:

- `barrel`: 1
- `box`: 26
- `character`: 48
- `flat`: 8
- `foliage`: 3
- `frame`: 3
- `glass`: 17
- `pipe`: 2
- `pole`: 5
- `robot`: 193
- `vertical_plane`: 8

Generation parameters are recorded machine-readably in `assets/generated/material_v2_report.json`.

Representative means:

- **cargo_crate** — `box`, height `21.06` px, rough `0.5756`, metal `0.5902`, AO `0.8962`
- **rust_barrel** — `barrel`, height `23.0208` px, rough `0.5851`, metal `0.5392`, AO `0.9002`
- **server_cabinet** — `box`, height `23.544` px, rough `0.5708`, metal `0.5985`, AO `0.8957`
- **pipe_cluster** — `pipe`, height `22.248` px, rough `0.5772`, metal `0.5918`, AO `0.8851`
- **street_lamp** — `pole`, height `24.852` px, rough `0.452`, metal `0.5947`, AO `0.8928`
- **hex_maintenance_idle_0** — `robot`, height `15.12` px, rough `0.5047`, metal `0.5492`, AO `0.8798`

The legacy `sprite_bumpmap.png` and `sprite_specularmap.png` remain in the package only for A/B fallback/debug. Material v2 is authoritative by default.
