# The Small Machine at the Edge of Night — Webapp v1.0.9

## Robot fear volume

- Split rendered illumination from immediate robot fear response.
- Default visible cone remains 248 px / 30° outer half-angle.
- Fear cone uses 72% of rendered range: 178.56 px at defaults.
- Fear cone is 5° wider on each side: 35° half-angle at defaults.
- Added a 240 ms fear latch so robots do not dance between flee/non-flee states at the beam edge.
- Distant robots may therefore remain visibly illuminated without immediately entering `evade_light`.
- The player's 60 px omnidirectional light remains part of the fear volume and minimum-distance behavior.

## Per-level active stalker

- Every one of the nine areas now contributes a dedicated `level-stalker:<room>` robot.
- Each dedicated level robot begins in active stalking mode immediately.
- Objective/crate activation still promotes an additional passive robot when capacity allows.
- Persistent population remains bounded at 16.
- Ambient spawning reserves future capacity so all nine level starters can be guaranteed without allowing unbounded carried populations.

## Corner escape

- `flee`, `evade_light`, and substantial distance-correction states may select a corner escape.
- Robot uses normal collision/pathfinding to reach a clear inner corner staging tile.
- Only the final corner crossing is allowed through the map boundary.
- After leaving the visible map, the robot is teleported to the furthest collision-valid tile from the player.
- It then resumes its previous passive/active stalking role.
- Corner escape has a 6 second per-robot cooldown.

## 45-second noclip rush

- The current area's dedicated active stalker is selected every 45 seconds.
- It receives temporary noclip for at most 2.4 seconds and rushes directly toward the player at 184 logical px/s.
- Contact can produce one forced physical bump but no health/damage/attack state.
- Noclip is removed immediately on contact or timeout.
- If the robot ends inside terrain, it is first restored to a valid collision point, then normal flee/pathfinding begins.
- `robot_attack_mode` remains false.

## Performance / stability

- Population cap retained at 16.
- Cover-point generation now considers only the 14 nearest physical occluders.
- Free candidate sample reduced to 16 per decision.
- Ordinary visible-stalker replanning cadence reduced; fear/light reaction remains immediate.
- Service-worker cache bumped to `small-machine-web-v1.0.9-r1`.
