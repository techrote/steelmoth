# Terrain Lighting Audit v1.1.0

This pass introduces generated sectioned sprite shadow profiles and regenerated terrain bump/specular maps.

## Process

1. Inspect each eligible terrain/objective sprite in the runtime atlas.
2. Derive a grounded footprint from the lower opaque band.
3. Sample multiple horizontal silhouette sections to create a 2.5D shadow profile.
4. Regenerate bump height and specular masks from luminance, silhouette distance, edge detail, and vertical bias.

## Updated sprites

- **barrier_concrete** — class `box`, 5 sections, collision `0.504 × 0.179`
- **barrier_hazard** — class `box`, 5 sections, collision `0.361 × 0.182`
- **bench** — class `box`, 5 sections, collision `0.508 × 0.182`
- **bollard** — class `pole`, 4 sections, collision `0.351 × 0.180`
- **cargo_crate** — class `box`, 4 sections, collision `0.820 × 0.179`
- **checkpoint_post** — class `pole`, 5 sections, collision `0.343 × 0.179`
- **dumpster** — class `box`, 5 sections, collision `0.820 × 0.179`
- **fan_unit** — class `box`, 5 sections, collision `0.755 × 0.180`
- **hvac_unit** — class `box`, 5 sections, collision `0.793 × 0.179`
- **industrial_frame** — class `frame`, 6 sections, collision `0.244 × 0.180`
- **objective_beacon** — class `box`, 5 sections, collision `0.415 × 0.178`
- **objective_core** — class `box`, 4 sections, collision `0.502 × 0.220`
- **objective_fuel** — class `box`, 5 sections, collision `0.562 × 0.182`
- **objective_module** — class `frame`, 6 sections, collision `0.362 × 0.180`
- **objective_relay** — class `box`, 5 sections, collision `0.320 × 0.179`
- **pipe_cluster** — class `pipe`, 7 sections, collision `0.390 × 0.180`
- **power_box_wall** — class `box`, 5 sections, collision `0.678 × 0.182`
- **power_cabinet** — class `box`, 5 sections, collision `0.714 × 0.179`
- **rust_barrel** — class `barrel`, 5 sections, collision `0.587 × 0.179`
- **scaffold** — class `frame`, 10 sections, collision `0.200 × 0.179`
- **server_cabinet** — class `box`, 5 sections, collision `0.757 × 0.179`
- **signal_pole** — class `pole`, 5 sections, collision `0.218 × 0.182`
- **street_lamp** — class `pole`, 5 sections, collision `0.308 × 0.179`
- **street_terminal** — class `box`, 5 sections, collision `0.696 × 0.181`
- **vending_unit** — class `box`, 5 sections, collision `0.782 × 0.179`
- **warning_light** — class `pole`, 5 sections, collision `0.460 × 0.178`
