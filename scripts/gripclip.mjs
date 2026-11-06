// Grip clip with the real mouse (headless, muted, pointer-lock guarded): scroll to size the circle, press E over the
// islet, carry the chunk with the cursor, flick toward the cliff and let go. The crosshair and grab circle are DOM,
// so they're in the frames. Also checks that what lifted was exactly the cells inside the circle at the cursor.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { launch, startPreview, watch } from './lib.mjs';
mkdirSync('shots/grip', { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-movflags', '+faststart', 'shots/grip/grip.mp4'], { stdio: ['pipe', 'ignore', 'inherit'] });
await page.evaluate(() => { const g = __game.game; __game.teleport(232, g.arena.sea - 72); g.hero.flying = true; g.hero.face = -1; g.cam.x = 232 - g.viewW() / 2; g.cam.y = g.arena.sea - 72 - g.viewH * 0.55; });
const toScreen = (x, y) => page.evaluate(([x, y]) => { const g = __game.game, r = g.canvas.getBoundingClientRect(), k = r.width / g.canvas.width; return [(x - g.cam.x) * g.scale() * k + r.left, (y - g.cam.y) * g.scale() * k + r.top]; }, [x, y]);
let f = 0;
const step = async (input, frames = 1) => { for (let i = 0; i < frames; i++) { await page.evaluate(inp => { __game.setInput(inp); __game.game.tick(); __game.game.draw(); }, input); if (f++ % 2 === 0) ff.stdin.write(await page.screenshot({ type: 'jpeg', quality: 90 })); } };
const sea = await page.evaluate(() => __game.game.arena.sea);
let [mx, my] = await toScreen(190, sea - 14);
await page.mouse.move(mx, my); await step({}, 10);
for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, -100); await step({}, 6); } // bigger circle: the outline shows what will lift
await page.screenshot({ path: 'shots/grip/1-aim.png' });
const before = await page.evaluate(() => { const g = __game.game, p = g.powers; const a = g.lastDrawAim; return { aim: a, r: p.gripR, cells: p.gripCells(a.x, a.y, p.gripR).length }; });
await step({ grip: true, gripPressed: true });
const lifted = await page.evaluate(() => { const b = __game.game.powers.held; return b ? b.n : 0; });
// carry it up and away with the cursor
for (let k = 0; k <= 40; k++) { const [x, y] = await toScreen(190 + k * 2.4, sea - 14 - k * 1.8); await page.mouse.move(x, y); await step({ grip: true }); }
await page.screenshot({ path: 'shots/grip/2-carry.png' });
// flick toward the cliff and let go
for (let k = 1; k <= 5; k++) { const [x, y] = await toScreen(286 + k * 26, sea - 86 + k * 9); await page.mouse.move(x, y); await step({ grip: true }); }
await step({});
for (let k = 0; k < 30; k++) { await step({}); if (k === 10) await page.screenshot({ path: 'shots/grip/3-throw.png' }); }
await step({}, 50); await page.screenshot({ path: 'shots/grip/4-impact.png' });
ff.stdin.end(); await new Promise(r => ff.on('close', r));
const st = await page.evaluate(() => __game.state());
const res = { circleRadiusCells: before.r, cellsInCircleAtCursor: before.cells, cellsLifted: lifted, exact: Math.abs(before.cells - lifted) <= Math.max(1, before.cells * 0.01), throws: st.powers.throws, shatters: st.bodyStats.shatters, errors: w.errors.slice(0, 3) };
res.pass = res.exact && res.throws === 1 && !w.errors.length;
writeFileSync('shots/grip/grip.json', JSON.stringify(res, null, 1)); console.log(JSON.stringify(res));
await browser.close(); prev.stop();
process.exit(res.pass ? 0 : 1);
