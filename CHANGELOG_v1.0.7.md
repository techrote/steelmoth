# The Small Machine at the Edge of Night — Webapp v1.0.7

## Robot perception / stalking redesign

- Added two explicit ambient hexapod stalking states:
  - **passive stalk** — default for every robot not actively stalking;
  - **active stalk** — promoted one robot at a time by successful objective/crate activations.
- Introduced a nominal world scale of **8 logical pixels per metre** for AI distance language. Passive stalkers target **16 m = 128 logical px** from the player.
- Active stalkers target roughly **60 px**, but strongly avoid both direct line of sight and the player's light.
- Robot candidate planning now samples **terrain-cover positions** derived from blocking tiles and authored physical decor. This makes stalking movement prefer skittering from object to object rather than selecting only generic open cells.
- Any robot actually caught by the directional cone or the player's close omnidirectional light reacts immediately: it receives an escape impulse, clears its path and replans toward cover on a very short cadence.
- Player pursuit is detected before direct contact: a nearby robot being closed on quickly enters flee behavior.
- Passive robots remain cautious, preferring covered/no-LOS positions around the 16 m stand-off ring instead of unrelated wandering.
- Active robots repeatedly seek closer covered positions while respecting a hard penalty for entering the close player-light halo.
- Existing collision bumping is retained but softened. There is **no attack/charge state**. A robot that is not fleeing/evading does not normally shove an idle player; repeated bumping should mostly result from chasing a robot into constrained geometry.

## Player light

- Moved the directional cone emitter from the player's body centre to the **face/head area** (`y - 14.5` logical px).
- Restored a deliberately weak omnidirectional player light from the same face point: **52 px radius / 0.105 intensity**.
- Robot perception uses the same face-origin cone, LOS raycast and omnidirectional halo as rendering.
- The active stalk target distance sits just outside this weak halo, so an unseen stalker can become uncomfortably close without normally occupying the directly illuminated personal space.

## Robot facing

- Ambient robots and follower robots no longer flip sprites from instantaneous horizontal velocity.
- Facing now uses a short exponentially smoothed horizontal movement average with ±4.8 px/s hysteresis.
- This allows the mechanically plausible behavior of moving backwards/sideways without rapid left/right sprite flicker.

## Little follower robots

- Mote is removed from the early rooms and first becomes recruitable in **level 7 / Dusk Switchyard**.
- Follower synchronization is hard-gated to room index 6+ (human level 7+), so an older local save containing Mote cannot display a little follower in levels 1–6.
- Edge Station remains the following level where Mote can make its independent choice.

## PWA

- Service worker cache bumped to `small-machine-web-v1.0.7-r1` so installed v1.0.6 clients do not retain the old robot/light runtime.
