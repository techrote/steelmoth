# v1.2.2 Rendering Bugfix Audit

## 1. v1.2.1 deployment fault

The v1.2.1 patch archive still contained:

```text
WEBAPP_VERSION v1.2.0
small-machine-web-v1.2.0-r1
0Play-Webapp-v1.2.0.bat
unversioned engine script URLs
unversioned Material-v2 PNG URLs
```

Therefore it was not a reliable visual comparison artifact. v1.2.2 replaces it with a fully versioned build and forces new URLs for both code and generated material textures.

## 2. Normal-space convention

Material-v2 generation uses screen-down source gradients but stores normals in a world basis where:

```text
+X = screen right
+Y = screen up
+Z = pseudo-height
```

The deferred light conversion already maps screen-space light deltas using:

```text
L = (dx, -dy, dz)
```

The v1.2.1 patch additionally inverted normal Y in the G-buffer. That was a double inversion. v1.2.2 removes it and adds a regression preventing its return.

SurfaceFX water is brought into the same basis.

## 3. Warm isolated light pools

The runtime still had a warm companion light source:

```text
robot_faces / Dusk Rust
84 px radius
0.22 intensity
```

On a floor that Material v2 classified around 0.5–0.65 metalness, this could generate large warm specular/diffuse pools. Because the deferred scene target is RGBA8, strong material response could then clamp before post processing.

v1.2.2 changes the source light, floor material priors and direct-light output behaviour together rather than merely reducing exposure.

Representative floor Material-v2 means after regeneration:

```text
floor_cracked: roughness > 0.72, metalness ~0.26
floor_plate:   roughness > 0.74, metalness ~0.24
floor_hazard:  roughness > 0.81, metalness ~0.15
```

Boxes/barrels retain much higher spatial metalness.

## 4. Player-flashlight double shadowing

v1.2.0 rendered the player flashlight through two independent shadow mechanisms:

1. Material-v2 pseudo-depth self-shadowing/contact shadows;
2. the inherited sectioned macro projected-shadow extrusion.

At long horizontal throws, the second path can dominate visually and expose the low-frequency silhouette segmentation, especially around dense vegetation/scenery.

v1.2.2 removes player-cone participation from the macro path whenever Material v2 is active. The pseudo-depth path receives a longer trace budget instead. Macro projection remains for secondary point lights and legacy A/B mode.

## 5. SurfaceFX water

The v1.2.0 SurfaceFX water shader used a hard-coded light direction and sampled the raw background texture. This made it independent of the actual deferred-light direction and capable of looking self-lit relative to its surroundings.

v1.2.2:

- receives the actual main-light position;
- uses the same normal-space convention as deferred materials;
- refracts the already-lit deferred scene;
- gates highlight/foam contribution by local scene visibility;
- caps water output relative to the underlying lit scene.
