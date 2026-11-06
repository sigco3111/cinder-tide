// Cape harness (headless, muted, pointer-lock guarded): walk, fly and dash through narrow, ragged caves and under low
// ceilings, and through the arena's own cliff cave. Every frame it checks the cape: no segment velocity spikes relative
// to the shoulders, no self-intersections, no angle beyond the limits, never pointing up, never stretched, no point
// inside rock. Writes shots/cape/<tag>/cape.json and a contact sheet of the cape in the caves.
//   node scripts/cape.mjs [--tag after] [--dist dist]
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { launch, startPreview, watch, arg } from './lib.mjs';
const tag = arg('tag', 'after'), out = `shots/cape/${tag}`; mkdirSync(out, { recursive: true });
const prev = await startPreview(arg('dist', 'dist')); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
	const g = __game.game; g.bodies.detach = () => []; // test rooms float in the sky: keep them from falling as rigid bodies
	window.__room = (x0, x1, yc, hgt, rag, seed) => { // stone block with a corridor of height hgt (floor at yc), ragged ceiling and stalactites
		const w = g.w, W = w.W; let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
		for (let y = yc - hgt - 14; y <= yc + 10; y++) for (let x = x0 - 12; x <= x1 + 12; x++) { const i = y * W + x; w.type[i] = 1; w.temp[i] = 20; w.body[i] = 0; }
		let ceil = 0;
		for (let x = x0; x <= x1; x++) {
			ceil = Math.max(-rag, Math.min(rag, ceil + Math.round((rnd() - 0.5) * 2.2)));
			let top = yc - hgt + ceil; if (rnd() < 0.08) top += 2 + Math.floor(rnd() * 4); // stalactite
			const floor = yc + (rnd() < 0.1 ? -1 : 0);
			for (let y = top; y < floor; y++) w.type[y * W + x] = 0;
		}
		for (let y = yc - hgt - 14; y <= yc + 10; y += 8) for (let x = x0 - 12; x <= x1 + 12; x += 8) w.wake(x, y);
	};
	window.__capeRec = [];
	window.__capeFrame = () => {
		const r = g.hero.rig, w = g.w, c = r.cape, a = c[0];
		let inside = 0; const anchorIn = (() => { const st = __game.st(w.get(Math.floor(a.x), Math.floor(a.y))); return st === 1 || st === 2; })(); if (!anchorIn) for (let i = 1; i < c.length; i++) { const t = w.get(Math.floor(c[i].x), Math.floor(c[i].y)); const st = __game.st(t); if (st === 1 || st === 2) inside++; }
		let maxSeg = 0, up = 0; for (let i = 1; i < c.length; i++) { const dx = c[i].x - c[i - 1].x, dy = c[i].y - c[i - 1].y; maxSeg = Math.max(maxSeg, Math.hypot(dx, dy)); const ang = Math.atan2(Math.abs(dx), dy); if (ang > 1.80) up++; }
		// the limits the cape promises: from 0.2 rad in front of straight down to 1.75 rad behind, +-0.6 mid-turn
		const fv = r.capeF ? r.capeF.x : r.fv, lim = f => f >= 0 ? -0.6 + (-1.75 + 0.6) * f : -0.6 + (-0.2 + 0.6) * -f, lo = lim(fv), hi = -lim(-fv); let beyond = 0;
		for (let i = 1; i < c.length; i++) { const ang = Math.atan2(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y); beyond = Math.max(beyond, ang < lo ? lo - ang : ang > hi ? ang - hi : 0); }
		const o = (p, q, s) => Math.sign((q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x)); let cross = 0;
		for (let i = 1; i < c.length; i++) for (let j = i + 2; j < c.length; j++) { const A = c[i - 1], B = c[i], C = c[j - 1], D = c[j]; if (o(A, B, C) * o(A, B, D) < 0 && o(C, D, A) * o(C, D, B) < 0) cross++; }
		return { rel: c.map(p => [p.x - a.x, p.y - a.y]), inside, maxSeg, up, beyond, cross, heroStuck: g.hero.overlap(g.hero.x, g.hero.y) };
	};
});
const tick = (inp, n = 1) => page.evaluate(([inp, n]) => { const g = __game.game; const out = []; for (let k = 0; k < n; k++) { const i = typeof inp === 'string' ? (0, eval)(inp)(g, k) : inp; __game.setInput(i); g.tick(); out.push(window.__capeFrame()); } return out; }, [inp, n]);
const shot = async (name) => { await page.evaluate(() => __game.game.draw()); const c = await page.evaluate(() => { const g = __game.game, r = g.canvas.getBoundingClientRect(), k = r.width / g.canvas.width, sc = g.scale(); return [(g.hero.x - g.cam.x) * sc * k + r.left, (g.hero.y - 9 - g.cam.y) * sc * k + r.top]; }); const path = `${out}/${name}.png`; await page.screenshot({ path, clip: { x: Math.max(0, Math.min(1280 - 240, c[0] - 120)), y: Math.max(0, Math.min(720 - 180, c[1] - 90)), width: 240, height: 180 } }); return path; };
const place = (x, y, fly) => page.evaluate(([x, y, fly]) => { const g = __game.game; __game.teleport(x, y); g.hero.flying = fly; g.hero.dashT = 0; g.cam.x = x - g.viewW() / 2; g.cam.y = y - 10 - g.viewH * 0.5; }, [x, y, fly]);
const frames = [], shots = [];
const runScenario = async (name, setup, steps) => {
	await setup();
	await tick({}, 10);
	let k = 0; for (const [inp, n, snap] of steps) { const f = await tick(inp, n); frames.push(...f.map(x => ({ ...x, name }))); if (snap) shots.push(await shot(`${name}-${k++}`)); }
	frames.push(null); // scenario break for the second difference
};
const SEA = await page.evaluate(() => __game.game.arena.sea);
const sky = SEA - 140;
// 1. walk through a cave barely taller than the hero (20 cells), ragged ceiling, turning back and forth
await runScenario('walk-low', async () => { await page.evaluate(([y]) => __room(260, 420, y, 20, 2, 11), [sky]); await place(270, sky, false); },
	[[{ x: 1 }, 50, true], [{ x: 1 }, 60, false], [{ x: -1 }, 25, true], [{ x: 1 }, 25, false], [{ x: -1 }, 12, true], [{ x: 1 }, 12, false], [{ x: 1 }, 40, true], [{}, 30, true]]);
// 2. stand and idle under a ceiling 18 cells high (one above the hero's head)
await runScenario('idle-tight', async () => { await page.evaluate(([y]) => __room(470, 520, y, 18, 0, 5), [sky]); await place(495, sky, false); },
	[[{}, 60, true], [{ x: 1 }, 6, false], [{ x: -1 }, 6, false], [{}, 40, true]]);
// 3. fly through a zigzag corridor 26 cells high
await runScenario('fly-cave', async () => { await page.evaluate(([y]) => __room(560, 760, y, 26, 3, 23), [sky]); await place(570, sky - 4, true); },
	[[{ x: 1, y: -0.4 }, 30, true], [{ x: 1, y: 0.5 }, 30, false], [{ x: 1, y: -0.6 }, 30, true], [{ x: -1 }, 20, false], [{ x: 1, y: 0.3 }, 40, true], [{ x: 0, y: -1 }, 20, true], [{ x: 0, y: 1 }, 20, false], [{}, 30, true]]);
// 4. dash through a low cave (dash carves; turn and dash back)
await runScenario('dash-cave', async () => { await page.evaluate(([y]) => __room(800, 980, y, 22, 2, 31), [sky]); await place(810, sky, false); },
	[[{ x: 1 }, 10, false], [{ x: 1, dashPressed: true }, 1, false], [{ x: 1 }, 14, true], [{ x: 1 }, 30, false], [{ x: -1, dashPressed: true }, 1, false], [{ x: -1 }, 12, true], [{ x: -1 }, 30, false], [{}, 30, true]]);
// 5. the arena's cliff cave: fly in, look around, fly out
await runScenario('cliff-cave', async () => { await place(672, SEA - 44, true); },
	[[{ x: 1, y: -0.2 }, 30, true], [{ x: 1 }, 25, false], [{ x: -1, y: 0.2 }, 20, true], [{ x: 1, y: -0.5 }, 20, false], [{ x: 0 }, 30, true], [{ x: -1 }, 40, true]]);
// 6. bury the hero in the cave ceiling (the reported bug): they must get out and the cape must hang normally
await runScenario('buried', async () => { await page.evaluate(([y]) => __room(1020, 1100, y, 20, 1, 41), [sky]); await page.evaluate(([y]) => { const g = __game.game; g.hero.x = 1060; g.hero.y = y - 24; g.hero.vx = g.hero.vy = 0; }, [sky]); },
	[[{}, 30, true], [{ x: 1 }, 30, true], [{}, 20, true]]);
// metrics: second difference of each cape point relative to the shoulder anchor (cells/frame^2)
const per = {}, accs = []; let cross = 0, beyond = 0, maxAcc = 0, spikes = 0, n = 0, inside = 0, up = 0, maxSeg = 0; const where = [];
for (let i = 2; i < frames.length; i++) {
	const a = frames[i], b = frames[i - 1], c = frames[i - 2]; if (!a || !b || !c) continue;
	n++; inside += a.inside; up += a.up; maxSeg = Math.max(maxSeg, a.maxSeg); cross += a.cross; beyond = Math.max(beyond, a.beyond);
	for (let k = 1; k < a.rel.length; k++) { const d = Math.hypot(a.rel[k][0] - 2 * b.rel[k][0] + c.rel[k][0], a.rel[k][1] - 2 * b.rel[k][1] + c.rel[k][1]); accs.push(d); if (d > maxAcc) maxAcc = d; if (d > 4.0) { spikes++; per[a.name] = (per[a.name] || 0) + 1; if (where.length < 30) where.push({ s: a.name, i, k, d: +d.toFixed(2) }); } }
}
if (arg('dump')) { const nm = arg('dump'); const rows = []; for (let i = 2; i < frames.length; i++) { const a = frames[i], b = frames[i - 1], c = frames[i - 2]; if (!a || !b || !c || a.name !== nm) continue; let m = 0, mk = 0; for (let k = 1; k < a.rel.length; k++) { const d = Math.hypot(a.rel[k][0] - 2 * b.rel[k][0] + c.rel[k][0], a.rel[k][1] - 2 * b.rel[k][1] + c.rel[k][1]); if (d > m) { m = d; mk = k; } } rows.push(`${i}:${m.toFixed(2)}@${mk} tip(${a.rel[8][0].toFixed(1)},${a.rel[8][1].toFixed(1)})`); } console.log(rows.join(' ')); }
const st = await page.evaluate(() => ({ unstuck: __game.game.hero.unstuck, stuckNow: __game.game.hero.overlap(__game.game.hero.x, __game.game.hero.y) }));
accs.sort((a, b) => a - b); const q = f => +accs[Math.floor(accs.length * f)].toFixed(3);
const res = { frames: n, maxAccelCellsPerFrame2: +maxAcc.toFixed(3), p99: q(0.99), p999: q(0.999), over1: accs.filter(v => v > 1).length, over2: accs.filter(v => v > 2).length, over3: accs.filter(v => v > 3).length, spikesOver4: spikes, spikeWhere: where, spikesPerScenario: per, selfCrossings: cross, angleBeyondLimitsRad: +beyond.toFixed(4), framesPointingUp: up, pointsInsideRock: inside, maxSegment: +maxSeg.toFixed(3), segRest: 1.15, unstuck: st.unstuck, stuckAtEnd: st.stuckNow, errors: w.errors.slice(0, 3) };
// a spike is a snap of more than 4 cells/frame^2 at any cape point relative to the shoulders (12.6 px/frame^2 at 720p);
// turning and dashing swing the cape at up to about 3, which reads as cloth, not thrashing
res.pass = res.maxAccelCellsPerFrame2 < 4 && !res.selfCrossings && res.angleBeyondLimitsRad < 1e-3 && !res.framesPointingUp && res.pointsInsideRock === 0 && res.maxSegment <= 1.15 + 1e-3 && !res.stuckAtEnd && !w.errors.length;
writeFileSync(`${out}/cape.json`, JSON.stringify(res, null, 1));
// contact sheet: 6 columns
const cols = 6, rows = Math.ceil(shots.length / cols);
const args = ['-y', '-v', 'error']; for (const s of shots) args.push('-i', s);
const pad = cols * rows - shots.length; for (let i = 0; i < pad; i++) args.push('-f', 'lavfi', '-i', 'color=c=black:s=240x180:d=1');
const L = []; for (let i = 0; i < cols * rows; i++) L.push(`${(i % cols) * 240}_${Math.floor(i / cols) * 180}`);
args.push('-filter_complex', `${Array.from({ length: cols * rows }, (_, i) => `[${i}]`).join('')}xstack=inputs=${cols * rows}:layout=${L.join('|')}`, '-frames:v', '1', `${out}/sheet.png`);
spawnSync('ffmpeg', args, { stdio: 'inherit' });
console.log(JSON.stringify(res));
await browser.close(); prev.stop();
process.exit(res.pass ? 0 : 1);
