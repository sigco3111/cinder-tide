// The water cycle, for calibration: boil the sea, watch steam become cloud, cloud rain back.
import { mkdirSync } from 'node:fs';
import { launch, startPreview, watch, arg } from './lib.mjs';
const out = arg('out', 'shots/boil'); mkdirSync(out, { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
await page.evaluate(() => { const g = __game.game, a = g.arena; g.hero.flying = true; __game.teleport(470, a.sea - 50); g.hero.flying = true; });
const run = (n, inp, aim) => page.evaluate(([n, inp, aim]) => { const g = __game.game, h = g.hero, a = g.arena; for (let k = 0; k < n; k++) { if (aim) __game.aimAt(h.x + aim[0], a.sea + aim[1]); __game.setInput(inp); g.tick(); } g.draw(); }, [n, inp, aim]);
let i = 0; const shot = async () => page.screenshot({ path: `${out}/b${i++}.png` });
await run(20, {}); await shot();
for (let k = 0; k < 4; k++) { await run(60, { lance: true }, [-30 + k * 20, 4]); await shot(); }
for (let k = 0; k < 6; k++) { await run(90, {}); await shot(); }
console.log(JSON.stringify(await page.evaluate(() => __game.state().world)), w.errors);
await browser.close(); prev.stop();
