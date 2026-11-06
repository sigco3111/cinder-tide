// Destruction debris check (headless, muted): blasts the cliff, a house and the plateau, slams, and lets rain fall,
// while scanning every frame for one-pixel-wide straight vertical runs of loose cells (the "dotted lines" bug): a run
// is 6+ loose cells (powder, liquid or flying cells) in one column, with gaps of up to 3 cells, and nothing loose beside
// them on either side. Saves screenshots and a clip.
//   node scripts/debris.mjs [--tag before|after]
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { launch, startPreview, watch, arg } from './lib.mjs';
const tag = arg('tag', 'after'), out = `shots/debris/${tag}`; mkdirSync(out, { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', `${out}/debris.mp4`], { stdio: ['pipe', 'ignore', 'inherit'] });
const scan = () => page.evaluate(() => {
	const g = __game.game, w = g.w, W = w.W, H = w.H;
	const x0 = Math.max(1, Math.floor(g.cam.x)), x1 = Math.min(W - 2, Math.floor(g.cam.x + g.viewW())), y0 = Math.max(0, Math.floor(g.cam.y)), y1 = Math.min(H - 1, Math.floor(g.cam.y + g.viewH));
	const loose = new Uint8Array(W * H);
	const ST = [];
	for (let y = y0; y <= y1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) { const t = w.type[y * W + x]; const st = __game.st(t); if ((st === 2 || st === 3) && !w.body[y * W + x]) loose[y * W + x] = 1; }
	for (let k = 0; k < w.pn; k++) { const x = w.px[k] | 0, y = w.py[k] | 0; if (x >= 0 && y >= 0 && x < W && y < H && __game.st(w.pt[k]) !== 4 && w.pt[k] !== 3) loose[y * W + x] = 2; } // flying water is drawn as rain streaks, not cells
	// a column run of loose cells, gaps of at most one cell, nothing loose on either side, and air below it somewhere
	// inside a dense cloud of debris a column lines up by chance and reads as noise, not a line: a run only counts
	// when the columns beside it (2 to 4 cells away) hold fewer loose cells than the run itself
	const cloud = (x, y0r, len) => { let n = 0; for (let yy = y0r; yy < y0r + len + 2; yy++) for (const dx of [-4, -3, -2, 2, 3, 4]) if (loose[yy * W + x + dx]) n++; return n >= len; };
	let runs = 0, longest = 0; const where = [];
	for (let x = x0; x <= x1; x++) {
		let len = 0, gap = 0, start = -1;
		for (let y = y0; y <= y1; y++) {
			const i = y * W + x, here = loose[i] && !loose[i - 1] && !loose[i + 1] && w.type[i - 1] === 0 && w.type[i + 1] === 0;
			if (here) { if (len === 0) start = y; len++; gap = 0; }
			else if (len > 0 && gap < 3 && w.type[i] === 0) { gap++; }
			else { if (len >= 6 && !cloud(x, start, len)) { runs++; longest = Math.max(longest, len); if (where.length < 6) { const types = []; for (let yy = start; yy < start + len + 6; yy++) { const i2 = yy * W + x; types.push(loose[i2] === 2 ? 'p' : w.type[i2]); } where.push([x, start, len, types.join('.')]); } } len = 0; gap = 0; }
		}
		if (len >= 6 && !cloud(x, start, len)) { runs++; longest = Math.max(longest, len); }
	}
	return { runs, longest, where, particles: w.pn };
});
let overAllow = -9, frames = 0, maxRuns = 0, sumRuns = 0, worst = null, maxP = 0;
// render check: below each flying cell in open sky, the screen must look like the sky beside it (no shade trails)
const renderTrail = () => page.evaluate(() => {
	const g = __game.game, w = g.w, gl = g.r.gl; g.draw();
	const sc = g.scale(), H = g.r.H, px = new Uint8Array(4);
	const lum = (x, y) => { gl.readPixels(Math.round(x), Math.round(H - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (px[0] + px[1] + px[2]) / 3; };
	let worst = 0, n = 0;
	for (let k = 0; k < w.pn && n < 40; k++) {
		const x = w.px[k], y = w.py[k]; if (__game.st(w.pt[k]) === 4 || w.pt[k] === 3) continue;
		let clear = true; for (let dy = -2; dy < 34 && clear; dy++) for (let dx = -5; dx <= 5; dx++) { const t = w.get(Math.floor(x + dx), Math.floor(y + dy)); if (t && __game.st(t) !== 4) { if (dy > 1 || Math.abs(dx) > 1) clear = false; } }
		if (!clear) continue;
		// the hero, enemies and held or flying chunks are drawn over the sky too: not a shade trail
		const near = (ax, ay, hw, h0, h1) => Math.abs(ax - x) < hw && ay - y > h0 && ay - y < h1;
		if (near(g.hero.x, g.hero.y, 8, -4, 46) || g.enemies.list.some(e => !e.dead && near(e.x, e.y, 10, -4, 46))) continue;
		n++;
		// a trail is darker than both sides (a soft cave-shade edge is darker than one side only)
		let below = 0, sideR = 0, sideL = 0;
		for (let dy = 4; dy < 30; dy++) { below += lum((x - g.cam.x) * sc, (y + dy - g.cam.y) * sc); sideR += lum((x + 4 - g.cam.x) * sc, (y + dy - g.cam.y) * sc); sideL += lum((x - 4 - g.cam.x) * sc, (y + dy - g.cam.y) * sc); }
		const side = Math.min(sideL, sideR), v = (side - below) / 26; if (v > worst) { worst = v; const r = g.canvas.getBoundingClientRect(), kk = r.width / g.canvas.width; window.__trailWorst = { x, y, t: w.pt[k], vx: w.pvx[k], vy: w.pvy[k], below: below / 26, side: side / 26, sx: (x - g.cam.x) * sc * kk + r.left, sy: (y - g.cam.y) * sc * kk + r.top }; }
	}
	return { checked: n, worstDarkerBelowParticle: +worst.toFixed(2), at: window.__trailWorst };
});
let trail = { checked: 0, worstDarkerBelowParticle: 0 };
async function run(n, fn) {
	for (let k = 0; k < n; k++) {
		await page.evaluate(fn => { const g = __game.game; (0, eval)(fn)(g); g.tick(); }, fn);
		const s = await scan(); frames++; sumRuns += s.runs; maxP = Math.max(maxP, s.particles);
		// chance alignments grow with the number of particles in flight: allow one more per thousand (a real line is
		// many frames of runs; these are single frames inside dense clouds)
		const allow = 1 + Math.floor(s.particles / 1000); if (s.runs - allow > overAllow) overAllow = s.runs - allow;
		if (s.runs > maxRuns) { maxRuns = s.runs; worst = s; if (s.runs > 1) { await page.evaluate(() => __game.game.draw()); await page.screenshot({ path: `${out}/runs-worst.png` }); worst.frame = frames; worst.cam = await page.evaluate(() => [__game.game.cam.x, __game.game.cam.y, __game.game.scale(), __game.game.canvas.getBoundingClientRect().width / __game.game.canvas.width]); } }
		if (k % 12 === 5) { const t = await renderTrail(); trail.checked += t.checked; if (t.worstDarkerBelowParticle > trail.worstDarkerBelowParticle) { trail.worstDarkerBelowParticle = t.worstDarkerBelowParticle; trail.at = t.at; if (t.worstDarkerBelowParticle > 16) await page.screenshot({ path: `shots/debris/${tag}/trail-worst.png`, clip: { x: Math.max(0, t.at.sx - 80), y: Math.max(0, t.at.sy - 60), width: 160, height: 160 } }); } }
		if (k % 2 === 1) { await page.evaluate(() => __game.game.draw()); ff.stdin.write(await page.screenshot({ type: 'jpeg', quality: 88 })); }
	}
}
const shot = n => page.evaluate(() => __game.game.draw()).then(() => page.screenshot({ path: `${out}/${n}.png` }));
// 1. a lava blast into the sea cliff
await page.evaluate(() => { const g = __game.game; __game.teleport(560, g.arena.sea - 60); g.hero.flying = true; g.hero.face = 1; g.cam.x = 560 - g.viewW() / 2; g.cam.y = g.arena.sea - 60 - g.viewH * 0.55; });
await run(20, '() => __game.setInput({})');
await run(1, '(g) => g.w.explode(668, g.arena.sea - 30, 16, 1.4)');
await run(14, '() => __game.setInput({})'); await shot('1-cliff-blast');
await run(80, '() => __game.setInput({})'); await shot('2-cliff-after');
// 2. blow up a house
await page.evaluate(() => { const g = __game.game, h = g.arena.town[2]; __game.teleport((h.x0 + h.x1) / 2 - 60, h.y0 - 10); g.hero.flying = true; });
await run(30, '() => __game.setInput({})');
await run(1, '(g) => { const h = g.arena.town[2]; g.w.explode((h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2 + 6, 18, 1.3); }');
await run(16, '() => __game.setInput({})'); await shot('3-house-blast');
await run(90, '() => __game.setInput({})'); await shot('4-house-after');
// 3. slam the plateau and blast the arch
await page.evaluate(() => { const g = __game.game; __game.teleport(1170, 120); g.hero.flying = false; g.hero.invuln = 2; });
await run(1, '() => __game.setInput({ meteorPressed: true })'); await run(40, '() => __game.setInput({})');
await run(1, '(g) => g.w.explode(1200, g.arena.plateau + 2, 14, 1.3)');
await run(20, '() => __game.setInput({})'); await shot('5-arch-blast');
await run(100, '() => __game.setInput({})'); await shot('6-arch-after');
// 4. boil the sea into cloud, let it rain, freeze part of the cloud into snow, and kill a few Cinderlings
await page.evaluate(() => { const g = __game.game; __game.teleport(470, g.arena.sea - 50); g.hero.flying = true; g.hero.face = -1; });
await run(300, '(g) => { __game.aimAt(g.hero.x - 30, g.arena.sea + 4); __game.setInput({ lance: true }); }');
await page.evaluate(() => { const g = __game.game; __game.teleport(470, g.w.cloudLine + 90); g.hero.flying = true; });
await run(300, '() => __game.setInput({})'); await shot('6b-rain');
await page.evaluate(() => { const g = __game.game; __game.teleport(470, g.w.cloudLine + 40); g.hero.flying = true; });
await run(60, '(g) => { __game.aimAt(g.hero.x - 10, g.w.cloudLine - 6); __game.setInput({ rime: true }); }');
await run(80, '() => __game.setInput({})'); await shot('7-rain-snow');
await page.evaluate(() => { const g = __game.game; g.spawnWave(1); for (const e of g.enemies.list) { e.x = 480 + Math.random() * 60; e.y = g.arena.sea - 80; } });
await run(5, '() => __game.setInput({})');
await page.evaluate(() => { const g = __game.game; for (const e of g.enemies.list) g.enemies.kill(e, 'test'); });
await run(90, '() => __game.setInput({})'); await shot('8-kills');
ff.stdin.end(); await new Promise(r => ff.on('close', r));
const res = { tag, frames, renderTrail: trail, maxRunsInAFrame: maxRuns, meanRunsPerFrame: +(sumRuns / frames).toFixed(2), worst, maxParticles: maxP, bodies: (await page.evaluate(() => __game.state().bodies)), errors: w.errors.slice(0, 3) };
res.runsOverAllowance = overAllow;
res.pass = overAllow <= 0 && trail.worstDarkerBelowParticle < 16 && !w.errors.length;
writeFileSync(`${out}/debris.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await browser.close(); prev.stop();
process.exit(res.pass ? 0 : 1);
