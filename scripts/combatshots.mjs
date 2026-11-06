// Combat screenshots at 1920x1080 (headless, muted, pointer-lock guarded) for the listing and the report: the four
// enemies, the Magma Titan cooling and with its core open, the Storm Leviathan breaching and frozen, the style meter
// with a combo banner, and the title menu. Writes shots/combat/shots/*.png.
import { mkdirSync } from 'node:fs';
import { launch, startPreview, watch } from './lib.mjs';
const OUT = 'shots/combat/shots'; mkdirSync(OUT, { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
const run = (n, fn) => page.evaluate(([n, fn]) => { const G = __game.game; for (let k = 0; k < n; k++) { const i = fn ? (0, eval)(fn)(G, k) : {}; __game.setInput(i || {}); G.tick(); } G.draw(); }, [n, fn]);
const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
// title menu
await page.evaluate(() => { const G = __game.game; G.build(); G.mode = 'title'; G.ui.showTitle(); document.body.classList.remove('playing'); });
await run(30); await shot('title');
await page.evaluate(() => { document.getElementById('title').classList.add('gone'); });
// the four enemies up close on the plateau
await page.evaluate(() => { const G = __game.game; G.build(); G.begin('sandbox'); G.ui.objective('Arena', 'Magma crawler, rock brute, frost wraith, sand swarm'); G.zoomOverride = 130; G.viewH = 130; { const w = G.w, a = G.arena; for (let xx = 680; xx < 1105; xx++) for (let yy = 30; yy < a.ground[xx] - 1; yy++) w.type[yy * w.W + xx] = 0; w.wakeAll(); } G.teleportHero(840, G.arena.ground[840] - 1, false); const a = G.spawnAt('crawler', 880), b = G.spawnAt('brute', 930), c = G.enemies.spawn('wraith', 905, G.arena.ground[905] - 46), d = G.spawnAt('swarm', 960); for (const m of [a, b, c, d]) m.cool = 99; window.__r = [a, b, c, d]; });
await run(50, '(G) => { G.camFocus = { x: 900, y: G.arena.ground[900] - 28 }; return {}; }'); await shot('enemies');
// a frozen crawler and the brute losing a plate to Grip, with the style meter up
await run(26, '(G) => { G.camFocus = { x: 900, y: G.arena.ground[900] - 28 }; const c = G.enemies.aimPoint(window.__r[0]); __game.aimAt(c.x, c.y); return { rime: true }; }'); await shot('freeze');
await run(1, '(G) => { const m = window.__r[1]; const cs = m.parts[0].cells.filter(c => c.alive && c.plate === 3); let x = 0, y = 0; for (const c of cs) { const q = G.enemies.worldOf(m, m.parts[0], c.lx, c.ly); x += q.x; y += q.y; } __game.aimAt(x / cs.length, y / cs.length); return { grip: true, gripPressed: true }; }');
await run(12, '(G, k) => { G.camFocus = { x: 900, y: G.arena.ground[900] - 28 }; __game.aimAt(870 - k * 3, G.arena.ground[870] - 50 - k * 2); return { grip: true }; }'); await shot('grip-plate');
// the Magma Titan: cooling an arm with Rime Burst, then the core open in phase 2
await page.evaluate(() => { const G = __game.game; G.build(); G.begin('titan'); });
await run(170, '(G) => { const b = G.bosses.boss; G.camFocus = { x: b.x - 30, y: b.y - 40 }; const h = G.hero; return { x: Math.sign(1350 - h.x) * 0.5, y: Math.sign(90 - h.y) * 0.5 }; }');
await run(80, '(G) => { const b = G.bosses.boss; G.camFocus = { x: b.x - 30, y: b.y - 40 }; const q = G.enemies.worldOf(b, b.parts[2], 0, 34); __game.aimAt(q.x, q.y); const h = G.hero; return { rime: true, x: Math.sign(q.x - 48 - h.x) * 0.5, y: Math.sign(q.y - 6 - h.y) * 0.5 }; }'); await shot('titan-cooling');
await page.evaluate(() => { const G = __game.game, b = G.bosses.boss; for (const p of [b.parts[2], b.parts[3]]) { p.heat = 0; p.data.cracks = 1; } });
await run(2, '(G) => ({})');
await page.evaluate(() => { const G = __game.game, b = G.bosses.boss; for (const p of [b.parts[2], b.parts[3]]) if (p.alive) G.bosses.breakArm(b, p, 0, -1); });
await run(150, '(G) => { const b = G.bosses.boss; G.camFocus = { x: b.x - 30, y: b.y - 40 }; __game.aimAt(b.x, b.y - 31); const h = G.hero; return { rime: G.frame % 200 < 120, x: Math.sign(b.x - 60 - h.x) * 0.5, y: Math.sign(b.y - 45 - h.y) * 0.5 }; }'); await shot('titan-core');
// the Storm Leviathan breaching, lanced; then frozen with its shell being torn
await page.evaluate(() => { const G = __game.game; G.build(); G.begin('leviathan'); });
await run(200, '(G) => { const b = G.bosses.boss; G.camFocus = { x: b.x, y: b.y - 10 }; const a = G.enemies.aimPoint(b); __game.aimAt(a.x, a.y); const h = G.hero; return { lance: G.frame > 90 && b.y < b.data.sea + 4, x: Math.sign(b.x + 50 - h.x) * 0.5, y: Math.sign(b.data.sea - 46 - h.y) * 0.5 }; }'); await shot('leviathan');
await page.evaluate(() => { const G = __game.game, b = G.bosses.boss; b.data.phase = 2; G.bosses.leviFreeze(b, true); });
await run(30, '(G) => { const b = G.bosses.boss; G.camFocus = { x: b.x, y: b.y - 10 }; __game.aimAt(b.x, b.y); return { rime: true }; }'); await shot('leviathan-frozen');
console.log(JSON.stringify({ errors: w.errors.slice(0, 3) }));
await browser.close(); prev.stop();
