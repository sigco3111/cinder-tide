// Playwright bot (headless, muted, pointer-lock guarded): plays story mode from the tutorial into the first wave.
// It flies, uses all five powers (plus the charged blast), fights Cinderlings, and asserts the world reacts:
// the sea boils into steam, steam condenses into cloud, cloud rains back, the sea freezes, a chunk is torn out and
// thrown, the slam lands, the dash carves, enemies die, nothing hovers, no errors, no requests to other hosts.
//   node scripts/bot.mjs [--seed 1] [--clip]
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { launch, startPreview, watch, arg } from './lib.mjs';
const seed = +arg('seed', 1), clip = !!arg('clip', false), out = 'shots/bot';
mkdirSync(out, { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
const t0 = Date.now();
await page.goto(prev.url + `?patch-test=1&seed=${seed}&mode=story`); await page.waitForFunction(() => window.__game);
const bootS = (Date.now() - t0) / 1000;
let frame = 0, ff = null;
if (clip) ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', `${out}/bot.mp4`], { stdio: ['pipe', 'ignore', 'inherit'] });
// run n frames; `fn` (a string) returns the input for each frame and may return null to stop early
async function run(n, fn, aim) {
	for (let k = 0; k < n; k++) {
		const stop = await page.evaluate(([src, aimSrc]) => {
			const g = __game.game, h = g.hero, a = g.arena;
			const inp = (0, eval)(src)(g, h, a);
			if (inp === null) return true;
			if (aimSrc) { const p = (0, eval)(aimSrc)(g, h, a); __game.aimAt(p[0], p[1]); }
			__game.setInput(inp); g.tick(); return false;
		}, [fn, aim]);
		frame++;
		if (clip && frame % 2 === 0) { await page.evaluate(() => __game.game.draw()); ff.stdin.write(await page.screenshot({ type: 'jpeg', quality: 88 })); }
		if (stop) return k;
	}
	return n;
}
const flyTo = (x, y) => `(g, h) => { if (h.grounded) return { jumpPressed: true, jump: true }; if (!h.flying) return h.vy > -6 ? { jumpPressed: true } : { jump: true }; const dx = ${x} - h.x, dy = ${y} - h.y; if (Math.hypot(dx, dy) < 6) return null; const l = Math.hypot(dx, dy); return { x: dx / l, y: dy / l }; }`;
const state = () => page.evaluate(() => __game.state());
const shot = n => page.evaluate(() => __game.game.draw()).then(() => page.screenshot({ path: `${out}/${n}.png` }));
const log = {};
// 1. move and jump, then take off
await run(40, '() => ({ x: 1 })');
await run(1, '() => ({ jumpPressed: true, jump: true })'); await run(16, '() => ({ jump: true })');
await run(20, '() => ({ x: -1 })');
await run(1, '() => ({ jumpPressed: true, jump: true })'); await run(14, '() => ({ jump: true })');
await run(1, '() => ({ jumpPressed: true })');
await run(200, flyTo(730, 110)); await run(300, flyTo(540, '__game.arena().sea - 70'));
log.afterFly = (await state()).hero;
await shot('1-fly');
// 2. boil the sea with the Magma Lance
await run(360, '() => ({ lance: true })', '(g, h, a) => [h.x - 26, a.sea + 4]');
await shot('2-boil');
// 3. Lava Blast at the cliff
await run(60, '() => ({ charge: true })', '(g, h, a) => [672, a.sea - 40]'); await run(30, '() => ({})');
await shot('3-blast');
// 4. watch steam become cloud and rain while freezing the sea
await run(100, '() => ({ rime: true })', '(g, h, a) => [h.x - 50, a.sea + 3]');
await shot('4-freeze');
await run(120, '() => ({})');
// 5. Grip a piece of the cliff and throw it into the sea
await run(200, flyTo(610, '__game.arena().sea - 30'));
// press E with the cursor on the cliff: that circle tears out; carry it with the cursor; flick toward the sea and let go
await run(1, '() => ({ grip: true, gripPressed: true })', '(g, h, a) => [650, a.sea - 12]');
await run(40, '(g) => ({ grip: true })', '(g, h, a) => { const k = Math.min(1, (g.frame % 1000) / 1); return [650 - 90 * Math.min(1, (g.__gt = (g.__gt || 0) + 1) / 40), a.sea - 12 - 38 * Math.min(1, g.__gt / 40)]; }');
await shot('5-grip');
await run(6, '(g) => ({ grip: true })', '(g, h, a) => { g.__gf = (g.__gf || 0) + 1; return [560 - g.__gf * 14, a.sea - 50 + g.__gf * 6]; }');
await run(1, '() => ({})'); await run(60, '() => ({})');
// 6. Meteor Drop onto the beach
await run(200, flyTo(585, '__game.arena().sea - 80'));
await run(1, '() => ({ meteorPressed: true })'); await run(60, '() => ({})');
await shot('6-slam');
// 7. Phase Dash into the cliff
await run(300, flyTo(598, '__game.arena().sea - 22')); await run(1, '() => ({ drop: true })'); await run(40, '() => ({})');
log.dash = (await state()).hero;
await run(1, '() => ({ dashPressed: true })', '(g, h, a) => [h.x + 60, h.y - 9]'); await run(40, '() => ({})');
await shot('7-dash');
log.tutorial = (await state()).tutorial;
// 8. the tutorial is done: magma crawlers come. Fly to the far end of town and fight them with their counter:
// Rime Burst sets a crawler to obsidian, then the lance on it steam-bombs it.
await run(400, '(g, h, a) => { if (g.tut.step >= 0) return { x: 0 }; return null; }');
await run(200, flyTo('h.x', 110)); await run(500, flyTo(1060, 110));
const hunt = `(g, h) => { const e = g.enemies.list[0]; if (!e && g.enemies.spawned > 0 && g.enemies.alive() === 0) return null; if (!e) return {}; const dx = e.x - h.x; const counter = e.kind === 'crawler' || e.kind === 'brute' ? (e.frozen > 0 ? { lance: true } : { rime: true }) : { lance: true }; return { ...counter, x: Math.abs(dx) > 70 ? Math.sign(dx) : 0, y: (e.y - 50 - h.y) / 60 }; }`;
const huntAim = `(g, h) => { const e = g.enemies.list.slice().sort((p, q) => Math.hypot(p.x - h.x, p.y - h.y) - Math.hypot(q.x - h.x, q.y - h.y))[0]; return e ? (() => { const c = g.enemies.aimPoint(e); return [c.x, c.y]; })() : [h.x + 40, h.y]; }`;
await run(1500, hunt, huntAim);
await shot('8-fight');
// 9. let it settle, then check nothing hovers anywhere in the world
await run(240, '() => ({})');
// the engine sweeps the whole world within 2 s of any structural change; let one sweep happen, then nothing may hover
await page.evaluate(() => { __game.game.structChanged = true; }); await run(130, '() => ({})');
const islands = await page.evaluate(() => __game.hovering());
const hover = islands.length;
const st = await state();
if (ff) { ff.stdin.end(); await new Promise(r => ff.on('close', r)); }
const W = st.world, P = st.powers;
const checks = {
	boot: bootS < 10, fly: log.afterFly.flying, boil: W.boiled > 1500, cloud: W.condensed > 800, rain: W.rained > 100, freeze: W.frozen > 100,
	blast: P.blasts >= 1, grip: P.grips >= 1 && P.throws >= 1, slam: P.slams >= 1, dash: P.dashes >= 1 && P.dashCarved > 5,
	lance: P.lanceCarved + W.boiled > 0, tutorial: log.tutorial === -1 || st.tutorial === -1, enemies: st.enemies.killed >= 2,
	noHover: hover === 0, errors: w.errors.length === 0, offHost: w.offHost.length === 0,
};
const res = { pass: Object.values(checks).every(Boolean), checks, bootS, frames: frame, world: W, powers: P, enemies: st.enemies, town: st.town, sea: st.sea, wave: st.wave, hover, islands: islands.slice(0, 12), heroAtDash: log.dash, errors: w.errors.slice(0, 5), offHost: w.offHost.slice(0, 5) };
writeFileSync(`${out}/bot.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await browser.close(); prev.stop();
process.exit(res.pass ? 0 : 1);
