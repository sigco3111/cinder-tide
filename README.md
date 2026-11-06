---
kind: game
engine: WebGL2
---

# Cinder Tide

A 2D superhero sandbox where every pixel is real matter. Boil the sea into clouds and rain, tear chunks out of cliffs, and fight enemies made of lava, rock, ice and sand, plus a Magma Titan and a Storm Leviathan.

On Patch as `blendi/cinder-tide`.

> **Most of the sound effects aren't in this repo.** They're cut from a sound library whose licence allows them inside a game but not as files anyone can download. The game builds and plays without them, with those sounds silent. [MISSING_ASSETS.md](MISSING_ASSETS.md) lists every one, where to get its recording and how to put it back.

## How it's built

A browser game in TypeScript, bundled by Vite into a folder of static files. The world is a cellular simulation (`src/engine/sim.ts`): heat spreads, water boils to steam that rises into cloud and rains back, lava sets into obsidian, and loose pieces break off as rigid bodies in [Rapier 2D](https://rapier.rs) and shatter where they land. It draws with plain WebGL2 (`src/engine/render.ts`). There are no sprite or model files: the hero, the enemies, the effects and the island are all drawn in code, and the hero is animated by a procedural rig.

## Run it

It takes Node 20 or newer.

```sh
npm ci
npm run dev        # http://localhost:5191
npm run build      # makes dist/, the game as Patch serves it
node scripts/preview.mjs dist 8080   # serves dist/ with the game host's headers
```

Controls: A and D to move, Space to jump, Space again in the air to fly (W A S D steers, C stops flying). Hold left mouse for the Magma Lance, hold right mouse to charge a Lava Blast, hold E to Grip rock (flick and let go to throw, scroll to size the circle), hold F for Rime Burst, Q in the air for Meteor Drop, Shift to Phase Dash. H shows the controls, Esc pauses. Gamepads work too, menus included: the D-pad or left stick picks a button, A presses it, B goes back, Start pauses.

Modes: Play (a guided tour, then waves on the town), Arena, the two boss fights, and Sandbox.

`AGENTS.md` says how to check and change it, and where things live.

## What's left out

87 sound effects, each shipped as `.ogg` and `.m4a` (174 files in `public/sfx/`): explosions, rock and debris, glass, ice, water and waves, rain and thunder, the Magma Lance's flame, steam, lava, punches and the bosses' roars. They come from the Sonniss GDC Game Audio Bundles, which are free to download and to use in games, but may not be passed on as files. Without them those sounds are silent; the music, footsteps, wind, hurt and UI sounds are here. [MISSING_ASSETS.md](MISSING_ASSETS.md) has the list and the steps to rebuild them with `scripts/sounds.mjs`.

## Licence

The code is MIT ([LICENSE](LICENSE)). The sounds in this repo are CC0: the music, "An Untold Legend" by SkyleTheFrench, and recordings from Freesound and Kenney. The released game's art licence is proprietary only because of the left-out sounds. Rapier keeps its own licence, in [LICENSES/](LICENSES). Credits: [public/CREDITS.md](public/CREDITS.md).
