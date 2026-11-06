// Combo clips (headless, muted, pointer-lock guarded): Strike, Shatterfall and Steam Bomb, played with real inputs on the
// cleared plateau; written to shots/combat/clips/*.mp4 with a still of the key moment.
//   node scripts/combatmedia.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { launch, startPreview, watch } from './lib.mjs';
const OUT = 'shots/combat/clips'; mkdirSync(OUT, { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
	const g = () => __game.game;
	window.__fresh = (x = 880, fly = false) => { const G = g(); G.build(); G.begin('sandbox'); { const w = G.w, a = G.arena; for (let xx = 680; xx < 1105; xx++) for (let yy = 40; yy < a.ground[xx] - 1; yy++) { const i = yy * w.W + xx; if (w.type[i] !== 0) w.type[i] = 0; } w.wakeAll(); } G.zoomOverride = 150; G.viewH = 150; G.teleportHero(x, G.arena.ground[x] - 1, fly); G.cam.x = x - G.viewW() / 2 + 40; G.cam.y = G.arena.ground[x] - G.viewH * 0.62; __game.clearInput(); G.ui.objective('', ''); };
	window.__c = m => g().enemies.aimPoint(m);
});
const results = {};
async function clip(name, setup, steps) {
	const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', `${OUT}/${name}.mp4`], { stdio: ['pipe', 'ignore', 'inherit'] });
	await page.evaluate(setup);
	let f = 0, still = false;
	for (const [n, inp, aim, opts] of steps) {
		for (let k = 0; k < n; k++) {
			const r = await page.evaluate(([inp, aim, k]) => { const G = __game.game; const i = typeof inp === 'string' ? (0, eval)(inp)(G, k) : inp; if (aim) { const a = (0, eval)(aim)(G, k); if (a) __game.aimAt(a[0], a[1]); } __game.setInput(i || {}); G.tick(); G.draw(); return i && i.__stop ? 1 : 0; }, [inp, aim, k]);
			if (f++ % 2 === 0) ff.stdin.write(await page.screenshot({ type: 'jpeg', quality: 88 }));
			if (opts?.still && k === opts.still && !still) { still = true; await page.screenshot({ path: `${OUT}/${name}.png` }); }
			if (r) break;
		}
	}
	ff.stdin.end(); await new Promise(r => ff.on('close', r));
	results[name] = await page.evaluate(() => ({ kills: { ...__game.game.killsByKind }, combos: [...__game.game.style.found], deaths: __game.game.deathLog }));
	console.log(name, JSON.stringify(results[name]));
}
const aimM = `(G) => { const m = G.enemies.list[0]; if (!m) return null; const c = G.enemies.aimPoint(m); return [c.x, c.y]; }`;
// (each enemy's death clip comes from the fight bot: node scripts/fight.mjs --mode arena --solo <kind> --clip)
// 5. combo: Strike (Grip a crawler and throw it into another)
await clip('combo-strike', () => { __fresh(820); const G = __game.game; const a = G.spawnAt('crawler', 860), b = G.spawnAt('crawler', 960); a.cool = b.cool = 99; },
	[[15, {}], [1, { grip: true, gripPressed: true }, `(G) => { const c = G.enemies.aimPoint(G.enemies.list[0]); return [c.x, c.y]; }`], [16, { grip: true }, `(G, k) => { const c = G.enemies.center(G.enemies.list[0]); return [c.x, c.y - 5 - k]; }`],
	 [4, { grip: true }, `(G, k) => { const a = G.enemies.center(G.enemies.list[0]), t = G.enemies.center(G.enemies.list[1] || G.enemies.list[0]); return [a.x + (t.x - a.x) * 0.5 * (k + 1), a.y + (t.y - a.y) * 0.5 * (k + 1)]; }`], [1, {}], [90, {}, null, { still: 8 }]]);
// 6. combo: Shatterfall (freeze a crawler, then Meteor Drop onto it)
await clip('combo-shatterfall', () => { __fresh(850, true); const G = __game.game; G.hero.y -= 30; const m = G.spawnAt('crawler', 900); m.cool = 99; },
	[[15, {}], [60, '(G) => (G.enemies.list[0]?.frozen > 0 ? { __stop: 1 } : { rime: true })', aimM], [24, '(G, k) => ({ x: Math.sign((G.enemies.list[0]?.x ?? G.hero.x) - G.hero.x), y: -0.2 })'], [1, { meteorPressed: true }], [80, {}, null, { still: 14 }]]);
// 7. combo: Steam Bomb (lance a frozen crawler)
await clip('combo-steambomb', () => { __fresh(840); const G = __game.game; const m = G.spawnAt('crawler', 905); m.cool = 99; },
	[[15, {}], [60, '(G) => (G.enemies.list[0]?.frozen > 0 ? { __stop: 1 } : { rime: true })', aimM], [20, { lance: true }, aimM], [70, {}, null, { still: 2 }]]);
writeFileSync(`${OUT}/clips.json`, JSON.stringify({ results, errors: w.errors.slice(0, 5) }, null, 1));
console.log(JSON.stringify({ errors: w.errors.slice(0, 3) }));
await browser.close(); prev.stop();
