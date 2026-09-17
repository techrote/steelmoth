# v1.0.6 — Light Cone + Cautious Robot AI

- Added mouse-directed dynamic player light cone.
- Added shared light-cone/AI perception geometry.
- Added collision-aware raycast line of sight through walls and solid authored props.
- Spread robot spawn placement across clear map space with cover/separation scoring.
- Normal robots explore cautiously and try to stay out of direct LOS.
- Each activated objective/crate promotes one available robot to stalk mode.
- Stalkers close distance while avoiding the active player beam; illuminated stalkers hide/reposition.
- Stalkers may creep closer through direct LOS when the player is looking elsewhere.
- All robots flee at very close range.
- Robot population persists through subsequent rooms.
- Removed old timed mass-charge/attack behavior.
- Retained moderate collision bumping only for actual close pursuit/corner contact.
- Extended render-shader validation to compile/link the modified light-map GLSL.
- Service-worker cache bumped to `small-machine-web-v1.0.6-r1`.
