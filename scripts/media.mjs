// Listing media (headless, muted): a choreographed showcase recorded deterministically at 30 fps (every second
// 60 Hz step), plus the cover and screenshots at 1920x1080.
//   node scripts/media.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { launch, startPreview, watch } from './lib.mjs';
const out = 'shots/listing'; mkdirSync(out, { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
await page.evaluate(() => { const g = __game.game; g.resize = () => {}; g.r.resize(1920, 1080); });
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', `${out}/raw.mp4`], { stdio: ['pipe', 'ignore', 'inherit'] });
let frames = 0;
const hud = on => page.evaluate(v => { for (const id of ['hud']) document.getElementById(id).style.visibility = v ? 'visible' : 'hidden'; }, on);
async function run(n, fn, aim) {
	for (let k = 0; k < n; k++) {
		await page.evaluate(([fn, aim]) => { const g = __game.game, h = g.hero, a = g.arena; const inp = (0, eval)(fn)(g, h, a); if (aim) { const p = (0, eval)(aim)(g, h, a); __game.aimAt(p[0], p[1]); } __game.setInput(inp || {}); g.tick(); }, [fn, aim]);
		if (k % 2 === 1) { await page.evaluate(() => __game.game.draw()); ff.stdin.write(await page.screenshot({ type: 'jpeg', quality: 90 })); frames++; }
	}
}
const still = async (name, withHud = true) => { await hud(withHud); await page.evaluate(() => __game.game.draw()); await page.screenshot({ path: `${out}/${name}.png` }); await hud(true); };
const fly = (x, y) => `(g, h) => { h.flying = true; const dx = ${x} - h.x, dy = ${y} - h.y, l = Math.hypot(dx, dy); return l < 5 ? {} : { x: dx / l, y: dy / l }; }`;
const place = (x, y, face = -1) => page.evaluate(([x, y, face]) => { __game.teleport(x, y); const g = __game.game; g.hero.flying = true; g.hero.face = face; g.hero.invuln = 1.5; g.hero.tumble = false; g.hero.health = 100; g.cam.x = x - g.viewW() / 2; g.cam.y = y - g.viewH * 0.55; }, [x, y, face]);
await hud(false);
// A: hover over the sea and boil it
await place(480, 250);
await run(40, '() => ({})');
await run(150, '() => ({ lance: true })', '(g, h, a) => [h.x - 32 + Math.sin(g.frame * 0.03) * 18, a.sea + 4]');
await still('cover', false);
await run(60, '() => ({ lance: true })', '(g, h, a) => [h.x - 10, a.sea + 4]');
await still('boil');
// B: rise with the steam into the clouds and watch it rain
await run(90, fly(450, 175));
await run(30, '() => ({})');
await still('clouds');
// C: freeze the sea
await run(90, fly(420, '__game.arena().sea - 40'));
await run(90, '() => ({ rime: true })', '(g, h, a) => [h.x - 45, a.sea + 3]');
await still('freeze');
// D: tear the top off the sea islet and hurl it at the cliff
await place(225, 205, -1);
await run(20, '() => ({})');
await run(1, '() => ({ grip: true, gripPressed: true })', '(g, h, a) => [190, a.sea - 14]');
await run(50, '() => ({ grip: true })', '(g, h, a) => { g.__m = (g.__m || 0) + 1; const k = Math.min(1, g.__m / 50); return [190 + 110 * k, a.sea - 14 - 76 * k]; }');
await still('grip');
await run(6, '() => ({ grip: true })', '(g, h, a) => { g.__f = (g.__f || 0) + 1; return [300 + g.__f * 30, a.sea - 90 + g.__f * 10]; }');
await run(1, '() => ({})');
await run(70, '() => ({})');
await still('throw');
// E: Cinderlings on the rock arch: lava blast, meteor drop, lance
await page.evaluate(() => { const g = __game.game; g.spawnWave(2); let k = 0; for (const e of g.enemies.list) { if (e.kind === 'crawler') { e.x = 1140 + (k++ % 8) * 14; let y = 20; while (y < g.w.H - 5 && !g.hero.overlap(e.x, y + 1)) y++; e.y = y - 1; } else { e.x = 1420; e.y = 60; } } });
await place(1180, 120, 1); await page.evaluate(() => { __game.game.hero.flying = false; });
await run(10, '() => ({})');
await run(1, '() => ({ meteorPressed: true })'); await run(22, '() => ({})');
await still('slam');
await run(30, '() => ({})');
await page.evaluate(() => { __game.game.hero.flying = true; });
await run(40, '() => ({ charge: true })', '(g, h) => { const e = g.enemies.list[0]; return e ? [e.x, e.y - 4] : [h.x + 60, h.y + 20]; }');
await run(12, '() => ({})');
await run(140, '(g, h) => ({ lance: true })', '(g, h) => { const e = g.enemies.list.slice().sort((p, q) => Math.abs(p.x - h.x) - Math.abs(q.x - h.x))[0]; return e ? [e.x, e.y - 4] : [h.x + 40, h.y + 30]; }');
await still('fight');
// F: phase dash through the cliff
await place(600, 278, 1); await page.evaluate(() => { __game.game.hero.flying = false; });
await run(20, '() => ({})');
await run(1, '() => ({ dashPressed: true })', '(g, h) => [h.x + 60, h.y - 9]');
await run(50, '() => ({})');
ff.stdin.end(); await new Promise(r => ff.on('close', r));
// title still
await page.goto(prev.url + '?seed=7'); await page.waitForFunction(() => window.__game); await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/title.png` });
// 15 s listing clip from the raw take (mp4 + webm), no audio
const dur = frames / 30;
const start = Math.max(0, Math.min(1, dur - 15));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-t', '15', '-i', `${out}/raw.mp4`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-movflags', '+faststart', `${out}/clip.mp4`]);
writeFileSync(`${out}/media.json`, JSON.stringify({ frames, seconds: dur, errors: w.errors, offHost: w.offHost }, null, 1));
console.log(JSON.stringify({ frames, seconds: dur, errors: w.errors.slice(0, 5), offHost: w.offHost.slice(0, 5) }));
await browser.close(); prev.stop();
