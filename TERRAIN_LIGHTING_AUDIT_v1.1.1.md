# Terrain Lighting Audit v1.1.1

This pass regenerates material maps for every static terrain/environment/objective sprite and height-aware sectioned shadow profiles for standing volumes.

## Process

1. Inspect each eligible terrain/objective sprite in the runtime atlas.
2. Derive a grounded footprint from the lower opaque band.
3. Sample multiple horizontal silhouette sections to create a 2.5D shadow profile.
4. Regenerate bump height and specular masks from luminance, silhouette distance, edge detail, and vertical bias.

## 2.5D interpretation

- `flat`: floor plates, grates and manholes; local relief only, never vertical bulging.
- `vertical_plane`: doors, windows, wall panels and fences; shallow planar relief.
- `box`: crates, cabinets, barriers, terminals and machinery; volumetric top/side relief.
- `barrel`: cylindrical radial relief.
- `pole`: narrow vertical occluders with tall height projection.
- `frame` / `pipe`: open/multipart silhouettes retain multiple cross-section spans.

## Updated sprites

- **barrier_concrete** — class `box`, 5 projected sections, collision `0.504 × 0.179`
- **barrier_hazard** — class `box`, 5 projected sections, collision `0.361 × 0.182`
- **bench** — class `box`, 5 projected sections, collision `0.508 × 0.182`
- **bollard** — class `pole`, 4 projected sections, collision `0.351 × 0.180`
- **cargo_crate** — class `box`, 4 projected sections, collision `0.820 × 0.179`
- **catwalk** — class `frame`, receiver/material only, collision `0.270 × 0.181`
- **checkpoint_post** — class `pole`, 5 projected sections, collision `0.343 × 0.179`
- **door_access** — class `vertical_plane`, receiver/material only, collision `0.768 × 0.180`
- **door_heavy** — class `vertical_plane`, receiver/material only, collision `0.794 × 0.182`
- **dumpster** — class `box`, 5 projected sections, collision `0.820 × 0.179`
- **fan_unit** — class `box`, 5 projected sections, collision `0.755 × 0.180`
- **fence_panel** — class `vertical_plane`, receiver/material only, collision `0.820 × 0.179`
- **floor_concrete** — class `flat`, receiver/material only, collision `0.784 × 0.180`
- **floor_cracked** — class `flat`, receiver/material only, collision `0.820 × 0.179`
- **floor_grate** — class `flat`, receiver/material only, collision `0.820 × 0.178`
- **floor_hazard** — class `flat`, receiver/material only, collision `0.820 × 0.182`
- **floor_plate** — class `flat`, receiver/material only, collision `0.820 × 0.178`
- **hvac_unit** — class `box`, 5 projected sections, collision `0.793 × 0.179`
- **industrial_frame** — class `frame`, 6 projected sections, collision `0.244 × 0.180`
- **manhole** — class `flat`, receiver/material only, collision `0.660 × 0.178`
- **objective_beacon** — class `box`, 5 projected sections, collision `0.415 × 0.178`
- **objective_core** — class `box`, 4 projected sections, collision `0.502 × 0.220`
- **objective_fuel** — class `box`, 5 projected sections, collision `0.562 × 0.182`
- **objective_module** — class `frame`, 6 projected sections, collision `0.362 × 0.180`
- **objective_relay** — class `box`, 5 projected sections, collision `0.320 × 0.179`
- **pipe_cluster** — class `pipe`, 7 projected sections, collision `0.390 × 0.180`
- **pipe_wall** — class `vertical_plane`, receiver/material only, collision `0.703 × 0.181`
- **platform_low** — class `box`, receiver/material only, collision `0.320 × 0.177`
- **power_box_wall** — class `vertical_plane`, 5 projected sections, collision `0.678 × 0.182`
- **power_cabinet** — class `box`, 5 projected sections, collision `0.714 × 0.179`
- **rust_barrel** — class `barrel`, 5 projected sections, collision `0.587 × 0.179`
- **scaffold** — class `frame`, 10 projected sections, collision `0.200 × 0.179`
- **server_cabinet** — class `box`, 5 projected sections, collision `0.757 × 0.179`
- **shutter** — class `vertical_plane`, receiver/material only, collision `0.820 × 0.181`
- **signal_pole** — class `pole`, 5 projected sections, collision `0.218 × 0.182`
- **stairs** — class `frame`, receiver/material only, collision `0.331 × 0.179`
- **street_lamp** — class `pole`, 5 projected sections, collision `0.308 × 0.179`
- **street_terminal** — class `box`, 5 projected sections, collision `0.696 × 0.181`
- **utility_hut** — class `box`, receiver/material only, collision `0.820 × 0.181`
- **vending_unit** — class `box`, 5 projected sections, collision `0.782 × 0.179`
- **wall_panel** — class `vertical_plane`, receiver/material only, collision `0.792 × 0.181`
- **wall_vent** — class `vertical_plane`, receiver/material only, collision `0.820 × 0.180`
- **warning_light** — class `pole`, 5 projected sections, collision `0.460 × 0.178`
- **window_broken** — class `vertical_plane`, receiver/material only, collision `0.772 × 0.178`
- **window_intact** — class `vertical_plane`, receiver/material only, collision `0.820 × 0.183`
