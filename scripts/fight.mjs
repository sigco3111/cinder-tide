// Fight bot (headless, muted, pointer-lock guarded): plays an Arena run or a boss fight to the end with real inputs
// only (movement, aim and power buttons through __game.setInput, the same path as the keyboard and mouse). Each tick a
// small policy reads the visible game state and picks the counter power for what it's fighting, keeps its distance and
// dodges tells. --human plays like a person: it notices a threat a quarter of a second late, misses about a third of
// dodges, and its aim wobbles. Records frames for clips (--clip) and writes shots/combat/<mode>.json.
//   node scripts/fight.mjs --mode arena|titan|leviathan [--clip] [--max 9000]
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { launch, startPreview, watch, arg } from './lib.mjs';
const mode = arg('mode', 'titan'), clip = !!arg('clip', false), MAX = +arg('max', 9000), human = !!arg('human', false);
mkdirSync('shots/combat', { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
const solo = arg('solo', ''); // --solo crawler|brute|wraith|swarm: one enemy on the cleared plateau, closer camera, until it dies
if (clip && !solo) await page.evaluate(() => { window.__frame = true; });
if (solo) await page.evaluate((kind) => { const g = __game.game; g.build(); g.begin('sandbox'); { const w = g.w, a = g.arena; for (let xx = 680; xx < 1105; xx++) for (let yy = 30; yy < a.ground[xx] - 1; yy++) w.type[yy * w.W + xx] = 0; w.wakeAll(); } g.mode = 'arena'; g.result = 'x'; g.waveTimer = 1e9; g.waveActive = true; g.zoomOverride = 175; g.viewH = 175; g.teleportHero(850, g.arena.ground[850] - 40, true); const m = kind === 'wraith' ? g.enemies.spawn('wraith', 920, g.hero.y - 10) : g.spawnAt(kind, 925); window.__solo = m; g.result = ''; g.ui.objective('', ''); }, solo);
else await page.evaluate((m) => { const g = __game.game; g.build(); g.begin(m); }, mode);
const ff = clip ? spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-movflags', '+faststart', solo ? `shots/combat/clips/death-${solo}.mp4` : `shots/combat/${mode}${human ? '-human' : ''}.mp4`], { stdio: ['pipe', 'ignore', 'inherit'] }) : null;
await page.evaluate(([mode, human]) => {
	const G = () => __game.game;
	const B = { t: 0, charge: 0, gripT: -1, gripTarget: null, flick: 0, jumpT: 0, plan: '', side: 1, lastBolt: 0 };
	window.__bot = B;
	if (human) { const raw = __game.aimAt; __game.aimAt = (x, y) => raw(x + Math.sin(B.t * 0.23) * 3 + Math.sin(B.t * 0.071) * 2, y + Math.cos(B.t * 0.19) * 3); }
	// movement toward a point while flying; take off if grounded
	const go = (g, x, y, inp) => { const h = g.hero; if (!h.flying) { B.jumpT++; if (B.jumpT % 12 === 1) inp.jumpPressed = true; inp.jump = true; } const dx = x - h.x, dy = y - h.y; inp.x = Math.abs(dx) > 4 ? Math.sign(dx) * Math.min(1, Math.abs(dx) / 20) : 0; inp.y = Math.abs(dy) > 4 ? Math.sign(dy) * Math.min(1, Math.abs(dy) / 20) : (h.flying ? -0.05 : 0); return inp; };
	const dodge = (g, inp) => {
		const h = g.hero, en = g.enemies;
		for (const s of en.shots) { if (human && (3 - s.life < 0.25 || ((s.id ?? 0) * 7919) % 10 < 4)) continue; const dx = h.x - s.x, dy = h.y - 9 - s.y; const d = Math.hypot(dx, dy); if (d < 40 && (s.vx * dx + s.vy * dy) > 0) { inp.y = dy > 0 ? 1 : -1; if (Math.abs(dy) < 6) inp.y = -1; return true; } }
		const bb = g.bosses.boss; if (bb && !bb.dead && (bb.state === 'windSwipe' || bb.state === 'windBite' || bb.state === 'bite') && (!human || (bb.stateT > 0.25 && (Math.floor(g.time / 3) * 7919) % 10 >= 3))) { inp.x = Math.sign(h.x - bb.x) || 1; inp.y = -1; return true; }
		for (const v of g.bosses.waves) if (Math.abs(v.x - h.x) < (human ? 30 : 50) && Math.sign(h.x - v.x) === v.dir) { inp.y = -1; return true; }
		for (const mk of g.bosses.marks) if (!mk.done && Math.abs(mk.x - h.x) < 12 && (!human || mk.t < 0.7)) { inp.x = h.x > mk.x ? 1 : -1; return true; }
		return false;
	};
	const blastAt = (g, x, y, inp, k = 0.7) => { __game.aimAt(x, y); if (B.charge < 60 * 0.9 * k) { inp.charge = true; B.charge++; } else { B.charge = 0; } return inp; };
	window.__policy = () => {
		const g = G(), h = g.hero, en = g.enemies, b = g.bosses.boss; B.t++;
		const inp = {};
		if (g.result) return inp;
		if (B.charge > 0 && B.charge < 200) { /* keep charging below */ }
		// a Grip in progress: carry the plate out and flick it away
		if (B.gripT >= 0) {
			B.gripT++; const a = g.powers.heldMob ? en.center(g.powers.heldMob) : g.powers.held ? (() => { const p = g.powers.held.rb.translation(); return { x: p.x * 10, y: p.y * 10 }; })() : null;
			if (!a) { B.gripT = -1; return inp; }
			const tgt = B.gripTarget;
			if (B.gripT < 12) { __game.aimAt(a.x + (h.x < a.x ? 6 : -6), a.y - 6); inp.grip = true; }
			else if (B.gripT < 17) { const t = tgt ? [tgt.x, tgt.y] : [a.x + (a.x > h.x ? 60 : -60), a.y - 40]; __game.aimAt(a.x + (t[0] - a.x) * 0.45 * (B.gripT - 11), a.y + (t[1] - a.y) * 0.45 * (B.gripT - 11)); inp.grip = true; }
			else { B.gripT = -1; }
			return inp;
		}
		if (mode === 'titan' && b && !b.dead) {
			const d = b.data, arms = [b.parts[2], b.parts[3]].filter(p => p.alive);
			if (d.phase === 0) return go(g, 1330, 120, inp);
			let tx, ty, aim;
			if (d.phase === 1 && arms.length) {
				const arm = arms.sort((p, q) => p.heat - q.heat)[0], q = en.worldOf(b, arm, 0, 34), out = arm === b.parts[2] ? -1 : 1;
				tx = q.x + out * 48; ty = q.y - 6; aim = q;
				go(g, tx, ty, inp); if (!dodge(g, inp)) {}
				if (arm.heat >= 0.3) { __game.aimAt(aim.x, aim.y); inp.rime = true; B.charge = 0; }
				else blastAt(g, aim.x, aim.y, inp, 0.6);
				B.plan = 'arm ' + arm.heat.toFixed(2);
			} else {
				aim = { x: b.x, y: b.y - 31 }; tx = b.x - 52; ty = b.y - 40; go(g, tx, ty, inp); dodge(g, inp);
				if (d.coreFrozen <= 0) { __game.aimAt(aim.x, aim.y); inp.rime = true; B.charge = 0; } else blastAt(g, aim.x, aim.y, inp, 0.55);
				B.plan = 'core ' + d.coreFrost.toFixed(2) + ' ' + d.coreFrozen.toFixed(1);
			}
			return inp;
		}
		if (mode === 'leviathan' && b && !b.dead) {
			const d = b.data, sea = d.sea, head = { x: b.x, y: b.y };
			const tx = Math.max(60, Math.min(500, head.x + (h.x > head.x ? 46 : -46))), ty = sea - 44;
			go(g, tx, ty, inp); dodge(g, inp);
			if (d.phase === 1) { const a = en.aimPoint(b); __game.aimAt(a.x, a.y); inp.lance = Math.hypot(head.x - h.x, head.y - h.y) < 140; B.plan = 'boil ' + (d.waterNow / d.water0).toFixed(2); }
			else if (d.phase === 2) {
				if (d.frozen <= 0.6) { __game.aimAt(head.x, head.y); inp.rime = true; B.plan = 'freeze ' + d.frost.toFixed(2); }
				else {
					// grip the shell plate with most cells left
					const hd = b.parts[0]; let best = -1, bn = 0; for (let k = 0; k < 4; k++) { const n = hd.cells.filter(c => c.alive && c.plate === k).length; if (n > bn) { bn = n; best = k; } }
					if (best >= 0) { const cs = hd.cells.filter(c => c.alive && c.plate === best); let x = 0, y = 0; for (const c of cs) { const q = en.worldOf(b, hd, c.lx, c.ly); x += q.x; y += q.y; } x /= cs.length; y /= cs.length; __game.aimAt(x, y); inp.grip = true; inp.gripPressed = true; B.gripT = 0; B.gripTarget = { x: x + (x > h.x ? 60 : -60), y: y - 50 }; B.plan = 'tear ' + best; }
				}
			} else { blastAt(g, head.x, head.y, inp, 0.5); B.plan = 'core ' + d.coreHp.toFixed(0); }
			return inp;
		}
		// arena: the nearest enemy, with its counter
		const list = en.list.filter(m => !m.dead && !m.held && (m.kind !== 'swarm' || m.parts.some(p => p.alive))); if (!list.length) { return go(g, 880, g.arena.ground[880] - 70, inp); }
		const m = list.sort((p, q) => Math.hypot(p.x - h.x, p.y - h.y) - Math.hypot(q.x - h.x, q.y - h.y))[0], c = en.aimPoint(m);
		const gnd = g.arena.ground[Math.max(0, Math.min(1599, Math.round(c.x)))];
		const hover = { x: c.x + (h.x > c.x ? 50 : -50), y: Math.max(gnd - 110, Math.min(c.y - (m.kind === 'wraith' ? 4 : 30), gnd - 40)) };
		go(g, hover.x, hover.y, inp); dodge(g, inp);
		if (m.kind === 'crawler') { if (m.frozen <= 0) { __game.aimAt(c.x, c.y); inp.rime = true; B.charge = 0; } else { __game.aimAt(c.x, c.y); inp.lance = true; } B.plan = 'crawler'; }
		else if (m.kind === 'wraith') { __game.aimAt(c.x, c.y); inp.lance = true; B.plan = 'wraith'; }
		else if (m.kind === 'swarm') { const p = m.parts.filter(p => p.alive).sort((p, q) => (q.glass ? 1 : 0) - (p.glass ? 1 : 0))[0]; if (p) { const q = en.worldOf(m, p, 0, 0); if (p.glass) blastAt(g, q.x, q.y, inp, 0.4); else { __game.aimAt(q.x, q.y); inp.lance = true; } } B.plan = 'swarm'; }
		else if (m.kind === 'brute') {
			const chest = [3, 4, 0, 1, 2, 5].find(k => m.plates[k].alive);
			if (chest !== undefined && Math.hypot(c.x - h.x, c.y - h.y) < 90) {
				const cs = m.parts[0].cells.filter(cc => cc.alive && cc.plate === chest); let x = 0, y = 0; for (const cc of cs) { const q = en.worldOf(m, m.parts[0], cc.lx, cc.ly); x += q.x; y += q.y; } x /= cs.length || 1; y /= cs.length || 1;
				__game.aimAt(x, y); inp.grip = true; inp.gripPressed = true; B.gripT = 0; B.gripTarget = null; B.plan = 'brute plate ' + chest;
			} else if (chest === undefined) blastAt(g, m.x, m.y - 15, inp, 0.6); // its heart
			B.plan = B.plan || 'brute';
		}
		return inp;
	};
}, [mode, human]);
if (arg('diag')) await page.evaluate(() => { const g = __game.game, en = g.enemies; window.__diag = { heat: 0, cold: 0, lanceTicks: 0, beamHitMob: 0, headAbove: 0, n: 0, dist: 0 }; const hb = en.bossHeat; en.bossHeat = (...a) => { window.__diag.heat++; return hb(...a); }; const bc = en.bossCold; en.bossCold = (...a) => { window.__diag.cold++; return bc(...a); }; const cc = en.coldCell.bind(en); en.coldCell = (...a) => { window.__diag.coldCell = (window.__diag.coldCell || 0) + 1; return cc(...a); }; });
// readability in the bay: how much of the view is steam or cloud, how full the sea stays, and whether the serpent's
// body is one connected piece (counted as connected groups of its cells in the grid)
const bay = { steamMax: 0, steamSum: 0, n: 0, seaMin: 1, bodyPiecesMax: 0, bodyPiecesSum: 0, bodyN: 0 };
const bayProbe = () => page.evaluate(() => { const g = __game.game, w = g.w, b = g.bosses.boss; const x0 = Math.max(0, Math.floor(g.cam.x)), x1 = Math.min(w.W - 1, Math.floor(g.cam.x + g.viewW())), y0 = Math.max(0, Math.floor(g.cam.y)), y1 = Math.min(w.H - 1, Math.floor(g.cam.y + g.viewH)); let gas = 0, all = 0; for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) { const t = w.type[y * w.W + x]; all++; if (t === 7 || t === 22) gas++; }
	let pieces = 0; if (b && !b.dead && b.stamped.length) { const set = new Set(b.stamped), seen = new Set(); for (const i of b.stamped) { if (seen.has(i)) continue; pieces++; const st = [i]; seen.add(i); while (st.length) { const j = st.pop(); for (const q of [j - 1, j + 1, j - w.W, j + w.W, j - w.W - 1, j - w.W + 1, j + w.W - 1, j + w.W + 1]) if (set.has(q) && !seen.has(q)) { seen.add(q); st.push(q); } } } }
	return { steam: gas / all, sea: g.sea, pieces, phase: b ? b.data.phase : 0 }; });
let frame = 0, last = null; const log = [];
for (; frame < MAX; frame++) {
	const st = await page.evaluate(() => { if (window.__solo && !window.__solo.dead) __game.game.camFocus = __game.game.enemies.aimPoint(window.__solo); else if (window.__frame && __game.game.bosses.boss && !__game.game.bosses.boss.dead) { const b = __game.game.bosses.boss; __game.game.camFocus = b.kind === 'titan' ? { x: b.x, y: b.y - 45 } : { x: b.x, y: b.y }; } const inp = window.__policy(); __game.setInput(inp); __game.game.tick(); const g = __game.game; if (g.frame % 2 === 0) g.draw(); return { r: g.result, hp: Math.round(g.hero.health), plan: window.__bot.plan, boss: g.bosses.boss ? { ph: g.bosses.stats.phase, hl: +g.bosses.health().toFixed(2) } : null, alive: g.enemies.alive(), wave: g.wave, t: +g.time.toFixed(1) }; });
	last = st;
	if (arg('diag')) await page.evaluate(() => { const g = __game.game, d = window.__diag, b = g.bosses.boss; if (!b) return; d.n++; if (g.powers.beamPow > 0) d.lanceTicks++; if (g.powers.hitMob) d.beamHitMob++; if (b.y < b.data.sea) d.headAbove++; d.dist += Math.hypot(b.x - g.hero.x, b.y - g.hero.y); });
	if (mode === 'leviathan' && !solo && frame % 30 === 0) { const q = await bayProbe(); bay.n++; bay.steamSum += q.steam; bay.steamMax = Math.max(bay.steamMax, q.steam); bay.seaMin = Math.min(bay.seaMin, q.sea); if (q.pieces && q.phase === 1) { bay.bodyN++; bay.bodyPiecesSum += q.pieces; bay.bodyPiecesMax = Math.max(bay.bodyPiecesMax, q.pieces); } }
	if (frame % 120 === 0) { log.push(st); console.log(JSON.stringify(st)); if (arg('diag')) console.log(JSON.stringify(await page.evaluate(() => ({ ...window.__diag, dist: window.__diag.dist / window.__diag.n, boiled: __game.game.bosses.stats.boiled, regrown: __game.game.bosses.stats.regrown, frost: __game.game.bosses.boss?.data.frost, chill: __game.game.bosses.boss?.data.chill, rime: __game.game.powers.rime, phase: __game.game.bosses.boss?.data.phase, hero: [Math.round(__game.game.hero.x), Math.round(__game.game.hero.y)], head: [Math.round(__game.game.bosses.boss?.x), Math.round(__game.game.bosses.boss?.y)] })))); }
	if (ff && frame % 2 === 0) ff.stdin.write(await page.screenshot({ type: 'jpeg', quality: 82 }));
	if (st.r) break;
	if (solo && await page.evaluate(() => window.__solo.dead)) break;
}
for (let k = 0; k < 90 && ff; k++) { await page.evaluate(() => { __game.setInput({}); __game.game.tick(); __game.game.draw(); }); if (k % 2 === 0) ff.stdin.write(await page.screenshot({ type: 'jpeg', quality: 82 })); }
if (ff) { ff.stdin.end(); await new Promise(r => ff.on('close', r)); }
const state = await page.evaluate(() => __game.state());
if (arg('diag')) console.log(JSON.stringify(await page.evaluate(() => { const g = __game.game, en = g.enemies; return { hero: [g.hero.x, g.hero.y], beam: g.powers.beam, list: en.list.map(m => ({ k: m.kind, x: Math.round(m.x), y: Math.round(m.y), st: m.state, cells: en.cellsAlive(m), stamped: m.stamped.length, parts: m.kind === 'swarm' ? m.parts.map(p => ({ a: p.alive, g: p.glass, r: p.reforms, h: +p.heat.toFixed(2), q: (() => { const q = en.worldOf(m, p, 0, 0); return [Math.round(q.x), Math.round(q.y)]; })() })) : undefined, plates: m.plates.map(p => p.alive) })) }; })));
const bayRes = mode === 'leviathan' ? { steamCoverMax: +bay.steamMax.toFixed(3), steamCoverMean: +(bay.steamSum / Math.max(1, bay.n)).toFixed(3), seaLevelMin: +bay.seaMin.toFixed(3), bodyPiecesMean: +(bay.bodyPiecesSum / Math.max(1, bay.bodyN)).toFixed(2), bodyPiecesMax: bay.bodyPiecesMax } : undefined;
const res = { mode, human, bay: bayRes, result: last.r || 'timeout', frames: frame, seconds: +(frame / 60).toFixed(1), heroHealth: last.hp, combat: state.combat, enemies: state.enemies, errors: w.errors.slice(0, 3) };
res.pass = (solo ? await page.evaluate(() => window.__solo.dead) : res.result === 'won') && !w.errors.length;
writeFileSync(solo ? `shots/combat/clips/death-${solo}.json` : `shots/combat/${mode}${human ? '-human' : ''}.json`, JSON.stringify({ ...res, log }, null, 1));
console.log(JSON.stringify(res));
await browser.close(); prev.stop();
process.exit(res.pass ? 0 : 1);
