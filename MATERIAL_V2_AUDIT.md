# MATERIAL V2 AUDIT

Generated for all **314** atlas regions.

Semantics: `SM-503/v1`.

Channel contract:

- Normal/Roughness: `RGB = encoded XYZ normal`, `A = roughness`.
- Height/Material: `R = authored pseudo-world Z / 64`, `G = intra-object material AO`, `B = metalness`, `A = emissive/auxiliary`.

World-height contract: `worldZ = localShapeHeight × heightScaleWorld + heightBiasWorld`; standing roots are authored at exact Z=0. Runtime render scaling is applied uniformly before depth/self/contact consumers use the same G2.R height.

Material AO is local cavity evidence only. It must not absorb DSO/contact/GTAO/SSGI scene occlusion.

Geometry class coverage:

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

Material-prior coverage:

- `concrete`: 2
- `galvanized`: 8
- `glass`: 17
- `painted_steel`: 235
- `plant`: 51
- `rusted_steel`: 1

Calibration fixtures:

- **floor_plate** — `flat` / `painted_steel`, scale `1.728` world units, max Z `0.0`, rough `0.6278`, metal `0.0808`, AO `0.8793`
- **cargo_crate** — `box` / `painted_steel`, scale `21.06` world units, max Z `18.8235`, rough `0.6283`, metal `0.0794`, AO `0.8759`
- **rust_barrel** — `barrel` / `rusted_steel`, scale `23.0208` world units, max Z `21.3333`, rough `0.8639`, metal `0.1783`, AO `0.8588`
- **street_lamp** — `pole` / `galvanized`, scale `24.852` world units, max Z `23.3412`, rough `0.5396`, metal `0.7202`, AO `0.8788`
- **pipe_cluster** — `pipe` / `galvanized`, scale `22.248` world units, max Z `20.0784`, rough `0.5372`, metal `0.7184`, AO `0.8789`
- **scaffold** — `frame` / `galvanized`, scale `19.872` world units, max Z `17.8196`, rough `0.5417`, metal `0.7185`, AO `0.8757`

Eight-angle calibration capture: `docs/material_v2/material_v2_calibration_8angle.png`.
Generation parameters and output hashes are recorded machine-readably in `assets/generated/material_v2_report.json`.

The legacy `sprite_bumpmap.png` and `sprite_specularmap.png` remain in the package only for A/B fallback/debug. Material v2 is authoritative by default.
