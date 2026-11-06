// Boots dist headless and muted, steps the game, takes screenshots, prints state and any errors or off-host requests.
//   node scripts/smoke.mjs [--q "x=1"] [--frames 120] [--out shots/smoke]
import { mkdirSync } from 'node:fs';
import { launch, startPreview, watch, arg } from './lib.mjs';
const out = arg('out', 'shots/smoke'); mkdirSync(out, { recursive: true });
const frames = +arg('frames', 120); const q = arg('q', '');
const [vw, vh] = String(arg('size', '1280x720')).split('x').map(Number);
const prev = await startPreview('dist');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const w = watch(page, prev.url);
const t0 = Date.now();
await page.goto(prev.url + '?patch-test=1&seed=7' + (q ? '&' + q : ''));
await page.waitForFunction(() => window.__game, null, { timeout: 30000 });
const bootS = (Date.now() - t0) / 1000;
await page.evaluate(n => window.__game.advance(n), frames);
await page.screenshot({ path: `${out}/a.png` });
console.log(JSON.stringify({ bootS, state: await page.evaluate(() => window.__game.state()), errors: w.errors.slice(0, 10), offHost: w.offHost.slice(0, 5) }, null, 1));
await browser.close(); prev.stop();
