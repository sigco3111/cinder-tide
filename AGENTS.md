# Working on Cinder Tide

A 2D falling-matter superhero game on [Patch](https://patch.gg), in TypeScript with plain WebGL2 and Rapier 2D, bundled by Vite. Start with `npm ci`. What the person asks for comes first: nothing here says what to make.

## Missing sounds

87 of the game's sound effects aren't in the repo, because their licence doesn't allow passing them on as files. The game runs without them: `public/sfx/manifest.json` lists only the sounds that are here, and `src/audio/audio.ts` plays nothing for a sound it doesn't have, so those sounds are silent. To put them back, follow [MISSING_ASSETS.md](MISSING_ASSETS.md): download the free sound bundles it names, then `SONNISS_DIR=<folder> node scripts/sounds.mjs` rebuilds them into `public/sfx/` and lists them in the manifest. Never commit those files, never add them to Patch's asset library, and never send them to an AI service. New sounds you add should be CC0 or CC-BY (credited), so they can stay in the repo.

## Run

- `npm run dev`: Vite on port 5191, with the game host's isolation headers.
- `npm run build`: makes `dist/`, which is the whole release. `node scripts/preview.mjs dist 8080` serves it with the game host's headers.
- URL flags (`src/main.ts`): `?mode=story|sandbox|arena|titan|leviathan`, `?autostart=1`, `?seed=`, `?arena=runway` (the animation course), `?patch-test=1` (a test drives the clock with `__game.advance(n)`).
- `window.__game` exposes `state()`, `setInput()`, `aimAt()`, `teleport()`, `census()`, `hovering()`, `noHover()` and `spawnWave()` for scripts.

## Check

The browser scripts use `PATCH_CHROME` if it's set, otherwise Playwright's Chromium (`npx playwright install chromium`). They always run muted, and `scripts/no-pointer-lock.mjs` fakes the mouse lock, so a test never takes the real mouse. Keep both in any new script by importing `scripts/lib.mjs`.

| Command | What it checks |
| --- | --- |
| `pch check` (after a build) | Patch's own look at the game, as its host serves it |
| `pch validate` | `patch.json`, its recipe and its files |
| `npm run typecheck` | Types |
| `npm run check` | `dist/` against Patch's submit-time file checks |
| `node scripts/bot.mjs` | Story mode with real inputs: flying, every power, the water cycle, enemies, no hovering, no errors, no requests to other hosts |
| `node scripts/anim.mjs` | The hero's rig: planted feet never slide, few pops, no big jumps |
| `node scripts/perf.mjs`, `node scripts/perfboss.mjs` | 60 fps at 1080p under load, and in both boss fights |
| `node scripts/counters.mjs` | Every enemy's counter works and the six combos fire |
| `node scripts/fight.mjs --mode arena` (or `titan`, `leviathan`) | A bot clears the Arena or beats a boss with real inputs |
| `node scripts/bury.mjs`, `node scripts/debris.mjs`, `node scripts/cape.mjs` | Never stuck when buried; no loose cells left hanging; the cape in narrow caves |
| `node scripts/aim.mjs`, `node scripts/gripclip.mjs`, `node scripts/combatui.mjs` | Aim under zoom and DPR; Grip lifts exactly what's in the circle; boss prompts |
| `node scripts/ambience.mjs`, `node scripts/mix.mjs` | The sound beds follow the world; a busy mix stays under its true peak. Both need the missing sounds |

Screenshots and clips go in `shots/`, which git ignores.

## Change

- Code that runs is all in `src/`. `public/` ships as it is: `CREDITS.md`, `LICENSE` (a copy of the one at the top, so change both), `patch-credits.js` (the "i" credits button) and `sfx/`.
- `public/sfx/manifest.json` lists each sound's takes by id; the game picks a random take per event and plays `.ogg` or `.m4a`, whichever decodes. `node scripts/sounds.mjs --manifest` rewrites it from the files in `public/sfx/`.
- Patch's game host is case-sensitive, serves only what's in the release and blocks requests to other hosts: `npm run check` must pass.
- To publish: put the next version in `patch.json`, commit, then `pch publish`, which says what comes next. A fork's `patch.json` has to name the fork, and a fork that ships the missing sounds must keep a proprietary art licence, as this game's release does.

## Where things live

| Path | What |
| --- | --- |
| `src/engine/sim.ts` | The cellular world: the materials table, 32x32 chunks with dirty rects simulated near the camera, heat, a coarse air-pressure field, steam to cloud to rain, free-flying cells, blasts |
| `src/engine/render.ts` | WebGL2: lit cells, caves, strata, a soft lit gas layer, emissive light and bloom, capsule sprites, the grade |
| `src/engine/bodies.ts` | Rigid pixel bodies in Rapier 2D: connectivity, box colliders, stamping, buoyancy, shattering, sleep |
| `src/engine/hero.ts` | The controller and procedural rig: gait, flight, dive, dash, tumble |
| `src/game/` | The game loop, arena, powers, enemies, bosses, combat, effects, input |
| `src/audio/audio.ts` | Sound: event layering, the beds that follow the world, the music |
| `src/ui/ui.ts` | Title, HUD and menus |
| `scripts/` | Test, media and sound-building scripts |
