// Screenshots of each part of the arena (teleporting the hero), headless and muted.
import { mkdirSync } from 'node:fs';
import { launch, startPreview, watch, arg } from './lib.mjs';
const out = arg('out', 'shots/tour'); mkdirSync(out, { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
const spots = { sea: [300, 250], town: [880, 190], arch: [1190, 180], volcano: [1440, 120], caves: [820, 330] };
for (const [name, [x, y]] of Object.entries(spots)) {
  await page.evaluate(([x, y]) => { __game.teleport(x, y); __game.game.cam.x = x - __game.game.viewW() / 2; __game.game.cam.y = y - 170; }, [x, y]);
  await page.evaluate(() => __game.advance(30));
  await page.screenshot({ path: `${out}/${name}.png` });
}
console.log(JSON.stringify({ state: await page.evaluate(() => __game.state()), errors: w.errors.slice(0, 5) }).slice(0, 600));
await browser.close(); prev.stop();
