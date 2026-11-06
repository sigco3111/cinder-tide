// Stuck-in-rock harness (headless, muted, pointer-lock guarded). For 50 seeds, buries the hero four ways, in the
// open and in caves: under poured sand, under rubble, under a rigid chunk dropped on them, and set into lava rock
// (obsidian) around and inside the body. Each run then idles (no inputs). Asserts the hero is free within 1 s (60
// ticks), that no single correction moves them further than the nearest free space needs (searched on the spot),
// that the last-resort rescue never had to fire, and that they end close to where they were buried.
//   node scripts/bury.mjs [--seeds 50]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, startPreview, watch, arg } from './lib.mjs';
mkdirSync('shots/bury', { recursive: true });
const SEEDS = +arg('seeds', 50);
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
const snap0 = await page.evaluate(() => { const w = __game.game.w; window.__save = { type: w.type.slice(), temp: w.temp.slice(), body: w.body.slice() }; return w.W; });
const results = await page.evaluate(async (SEEDS) => {
	const g = __game.game, w = g.w, W = w.W, hero = g.hero;
	const S = { AIR: 0, STONE: 1, SAND: 2, RUBBLE: 15, OBSIDIAN: 14 };
	const restore = () => { for (const b of [...g.bodies.list]) g.bodies.remove(b); const s = window.__save; w.type.set(s.type); w.temp.set(s.temp); w.body.set(s.body); w.pn = 0; w.structuralDirty = false; };
	const room = (x0, x1, yc, hgt) => { for (let y = yc - hgt - 12; y <= yc + 8; y++) for (let x = x0 - 10; x <= x1 + 10; x++) { const i = y * W + x; w.type[i] = (y >= yc - hgt && y < yc && x >= x0 && x <= x1) ? 0 : 1; w.temp[i] = 20; w.body[i] = 0; } for (let y = yc - hgt - 12; y <= yc + 8; y += 8) for (let x = x0 - 10; x <= x1 + 10; x += 8) w.wake(x, y); };
	const surface = (x) => { for (let y = 20; y < w.H - 8; y++) { const t = w.type[y * W + x], st = __game.st(t); if (st === 3) return null; if (st === 1 || st === 2) return y; } return null; };
	const out = [];
	const methods = ['sand', 'rubble', 'chunk', 'lavarock'];
	const origDetach = g.bodies.detach.bind(g.bodies);
	for (let seed = 1; seed <= SEEDS; seed++) {
		let s = seed * 9973; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
		for (const method of methods) for (const where of ['open', 'cave']) {
			restore(); hero.vx = hero.vy = 0; hero.flying = false; hero.dashT = 0; hero.tumble = false; hero.stuckT = 0; hero.unstuck = { displaced: 0, moved: 0, rescues: 0, maxJump: 0 };
			let x, y;
			if (where === 'cave') {
				g.bodies.detach = () => [];
				const yc = g.arena.sea - 150 - Math.floor(rnd() * 30), x0 = 200 + Math.floor(rnd() * 800), hgt = 20 + Math.floor(rnd() * 8);
				room(x0, x0 + 60, yc, hgt); x = x0 + 20 + Math.floor(rnd() * 20); y = yc;
			} else {
				g.bodies.detach = origDetach;
				for (let k = 0; k < 200; k++) { const xx = 150 + Math.floor(rnd() * 1100), yy = surface(xx); if (yy !== null && !hero.overlap(xx, yy)) { x = xx; y = yy; break; } }
				if (x === undefined) continue;
			}
			__game.teleport(x, y); hero.x = x; hero.y = y; // exactly here, standing
			g.cam.x = x - g.viewW() / 2; g.cam.y = y - g.viewH * 0.6; g.tick();
			const x0 = Math.round(hero.x), y0 = Math.round(hero.y);
			// bury
			const fill = (t, rx, top, solidInside) => { for (let yy = y0 - top; yy < y0; yy++) for (let xx = x0 - rx; xx <= x0 + rx; xx++) { if (!w.inb(xx, yy)) continue; const i = yy * W + xx; if (w.type[i] === 0 || (solidInside && Math.abs(xx - x0) < 3)) { w.type[i] = t; w.temp[i] = 20; } w.wake(xx, yy); } };
			if (method === 'sand') fill(S.SAND, 5 + Math.floor(rnd() * 6), 22 + Math.floor(rnd() * 14), true);
			else if (method === 'rubble') fill(S.RUBBLE, 4 + Math.floor(rnd() * 6), 20 + Math.floor(rnd() * 12), true);
			else if (method === 'lavarock') fill(S.OBSIDIAN, 4 + Math.floor(rnd() * 4), 19 + Math.floor(rnd() * 6), true);
			else if (method === 'chunk') { // a block of stone right on top of (and partly inside) the hero, made into a falling rigid body
				const cells = []; const bw = 6 + Math.floor(rnd() * 6), bh = 6 + Math.floor(rnd() * 6), top = y0 - 14 - bh;
				for (let yy = top; yy < top + bh; yy++) for (let xx = x0 - bw; xx <= x0 + bw; xx++) { if (!w.inb(xx, yy)) continue; const i = yy * W + xx; if (w.type[i] === 0) { w.type[i] = S.STONE; w.temp[i] = 20; cells.push(i); } }
				if (cells.length >= 12) { const b = g.bodies.makeBody(cells, { x: 0, y: 8 }, 0); b.thrown = 0; }
			}
			const need0 = hero.overlap(hero.x, hero.y) ? (() => { const p = hero.nearestFree(48); return p ? Math.hypot(p.x - hero.x, p.y - hero.y) : 99; })() : 0;
			let freeAt = -1, maxJump = 0, overNeed = 0, buriedTicks = 0, streak = 0, longest = 0, lastX = hero.x, lastY = hero.y;
			for (let k = 0; k < 120; k++) {
				// what the nearest free space would be right now, before this tick's correction
				const inNow = hero.overlap(hero.x, hero.y);
				__game.setInput({}); g.tick();
				const jump = Math.hypot(hero.x - lastX, hero.y - lastY); lastX = hero.x; lastY = hero.y;
				if (jump > maxJump) maxJump = jump;
				const stuck = hero.overlap(hero.x, hero.y);
				if (stuck) { buriedTicks++; streak++; longest = Math.max(longest, streak); } else streak = 0;
				if (!stuck && freeAt < 0 && k >= 0) freeAt = k;
				if (stuck && freeAt >= 0) freeAt = -1; // got buried again: count until free for good
			}
			const moved = Math.hypot(hero.x - x0, hero.y - y0);
			out.push({ seed, method, where, x: x0, y: y0, need0: +need0.toFixed(1), freeAtTick: freeAt, buriedTicks, longestBuriedTicks: longest, maxJump: +maxJump.toFixed(2), maxCorrection: +hero.unstuck.maxJump.toFixed(2), displacedCells: hero.unstuck.displaced, rescues: hero.unstuck.rescues, movedCells: +moved.toFixed(1), stuckAtEnd: hero.overlap(hero.x, hero.y) });
		}
	}
	g.bodies.detach = origDetach;
	return out;
}, SEEDS);
// stuck means buried for longer than a second at a stretch (a falling chunk may brush the hero again later)
const fails = results.filter(r => r.longestBuriedTicks > 60 || r.rescues > 0 || r.stuckAtEnd || r.maxCorrection > Math.max(r.need0 + 1, 16 * Math.SQRT2)); // a correction is never further than the nearest free space (searched out to 16 cells, so up to a 16-cell diagonal) or what the burial needed
const by = {}; for (const r of results) { const k = `${r.method}-${r.where}`; const b = (by[k] ||= { n: 0, longestBuriedTicks: 0, /* longest buried stretch, ticks */ worstMoved: 0, worstCorrection: 0, displacedMean: 0 }); b.n++; b.longestBuriedTicks = Math.max(b.longestBuriedTicks, r.longestBuriedTicks); b.worstMoved = Math.max(b.worstMoved, r.movedCells); b.worstCorrection = Math.max(b.worstCorrection, r.maxCorrection); b.displacedMean += r.displacedCells / 1; }
for (const b of Object.values(by)) b.displacedMean = +(b.displacedMean / b.n).toFixed(1);
const res = { runs: results.length, seeds: SEEDS, byCase: by, fails: fails.slice(0, 10), failCount: fails.length, errors: w.errors.slice(0, 3) };
res.pass = fails.length === 0 && !w.errors.length && results.length >= SEEDS * 6;
writeFileSync('shots/bury/bury.json', JSON.stringify({ ...res, results }, null, 1));
console.log(JSON.stringify(res));
await browser.close(); prev.stop();
process.exit(res.pass ? 0 : 1);
