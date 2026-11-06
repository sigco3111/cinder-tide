// Counter and combo checks (headless, muted, pointer-lock guarded). Each scenario rebuilds the world, puts the hero
// and one or two enemies on the plateau and plays it with real inputs (aim + buttons through __game.setInput):
//   counters: a frozen magma crawler shatters into chunks (and the lance barely hurts a crawler); a rock brute's plate
//   tears off with Grip, Meteor Drop cracks plates, and its heart takes no damage until the chest plates are gone;
//   a frost wraith melts under the lance and refreezes if left; a sand swarm scatters and re-forms, and heat fuses a
//   mote to glass that then shatters for good.
//   combos: Strike, Shatterfall, Steam Bomb, Sandstorm, Scald, Juggle.
// Writes shots/combat/counters.json.   node scripts/counters.mjs [--only name]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, startPreview, watch, arg } from './lib.mjs';
mkdirSync('shots/combat', { recursive: true });
const only = arg('only', '');
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
await page.evaluate(() => {
	const g = () => __game.game;
	// a clear test ground: the town's buildings are lifted off the plateau so nothing blocks the powers
	window.__fresh = (x = 880, fly = false) => { const G = g(); G.build(); G.begin('sandbox'); { const w = G.w, a = G.arena; for (let xx = 680; xx < 1105; xx++) for (let yy = 40; yy < a.ground[xx] - 1; yy++) { const i = yy * w.W + xx; if (w.type[i] !== 0 && w.type[i] !== 3) { w.type[i] = 0; } } w.wakeAll(); } G.teleportHero(x, G.arena.ground[x] - 1, fly); G.cam.x = x - G.viewW() / 2; G.cam.y = G.arena.ground[x] - G.viewH * 0.6; __game.clearInput(); };
	window.__run = (n, inp, aim) => { const G = g(); for (let k = 0; k < n; k++) { const i = typeof inp === 'function' ? inp(G, k) : inp; if (aim) { const a = aim(G, k); if (a) __game.aimAt(a[0], a[1]); } __game.setInput(i || {}); G.tick(); if (i && i.stop && i.stop(G)) break; } G.draw(); };
	window.__c = (m) => g().enemies.aimPoint(m);
});
const results = {};
const scen = async (name, fn) => { if (only && !name.includes(only)) return; const t0 = Date.now(); try { results[name] = await page.evaluate(fn); } catch (e) { results[name] = { pass: false, error: String(e).slice(0, 300) }; } results[name].ms = Date.now() - t0; console.log(name, JSON.stringify(results[name])); };

await scen('crawler: lance barely hurts it', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('crawler', 940); m.cool = 99; const n0 = G.enemies.cellsAlive(m);
	__run(150, { lance: true }, () => { const c = __c(m); return [c.x, c.y]; });
	const left = G.enemies.cellsAlive(m) / n0; return { cellsLeft: +left.toFixed(2), dead: m.dead, pass: !m.dead && left > 0.8 };
});
await scen('crawler: freeze then shatter into chunks', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('crawler', 930); m.cool = 99; const b0 = G.bodies.list.length;
	let t = 0; __run(200, (G2, k) => { t = k; return m.frozen > 0 ? { stop: () => true } : { rime: true }; }, () => { const c = __c(m); return [c.x, c.y]; });
	const frozeAfter = t, frozen = m.frozen > 0;
	__run(30, { charge: true }, () => { const c = __c(m); return [c.x, c.y]; }); __run(20, {});
	return { frozeAfterTicks: frozeAfter, frozen, shattered: G.enemies.stats.shattered, dead: m.dead, chunks: G.bodies.list.length - b0, combos: G.style.found, pass: frozen && m.dead && G.enemies.stats.shattered >= 1 && G.bodies.list.length - b0 >= 1 };
});
await scen('crawler: blows crack the shell and spill real lava', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('crawler', 960); m.cool = 99; const lava0 = G.w.census()[4] || 0;
	__run(40, { charge: true }, () => { const c = __c(m); return [c.x, c.y]; }); __run(30, {});
	return { spilled: G.enemies.stats.spilled, lavaCellsAfter: (G.w.census()[4] || 0) - lava0, dead: m.dead, pass: G.enemies.stats.spilled > 0 };
});
await scen('brute: heart is armoured until the chest plates are gone', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('brute', 960); m.cool = 99;
	const hp0 = m.hp; G.enemies.hit(m, m.x, m.y - 15, 60, 'blast', -1, 0); G.enemies.hit(m, m.x, m.y - 15, 60, 'blast', -1, 0);
	return { hpAfterTwoBlasts: m.hp, hp0, blocked: G.enemies.stats.blockedHeart, platesAlive: m.plates.filter(p => p.alive).length, pass: m.hp === hp0 };
});
await scen('brute: Grip tears a plate off (and it can be thrown)', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('brute', 940); m.cool = 99; __run(5, {});
	const tx = m.x - m.face * 6, ty = m.y - 15; // its chest
	__run(1, { grip: true, gripPressed: true }, () => [tx, ty]);
	const held = !!G.powers.held, torn = G.enemies.stats.platesTorn;
	__run(10, { grip: true }, (G2, k) => [tx - 10 - k * 2, ty - 20 - k]); __run(4, { grip: true }, (G2, k) => [tx - 40 - k * 30, ty - 30]); __run(1, {}, () => [tx - 160, ty - 30]); __run(30, {});
	return { torn, held, throws: G.powers.stats.throws, combos: G.style.found, pass: torn >= 1 && held };
});
await scen('brute: Meteor Drop cracks plates', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('brute', 925); m.cool = 99; __run(5, {});
	G.hero.x = m.x - 18; G.hero.y = m.y - 50; G.hero.flying = false; G.hero.grounded = false;
	__run(1, { meteorPressed: true }); __run(60, {});
	const cracked = G.enemies.stats.platesCracked; return { cracked, platesAlive: m.plates.filter(p => p.alive).length, pass: cracked >= 1 };
});
await scen('brute: dies once the heart is open and hit', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('brute', 960); m.cool = 99; __run(5, {});
	for (let k = 0; k < 6; k++) G.enemies.detachPlate(m, k, 0, -10, false);
	let n = 0; while (!m.dead && n++ < 12) { __run(30, { charge: true }, () => { const c = __c(m); return [c.x, c.y]; }); __run(15, {}); }
	return { dead: m.dead, blasts: n, heartHits: G.enemies.stats.heartHits, pass: m.dead };
});
await scen('wraith: the lance melts it to water and steam', () => {
	__fresh(880, true); const G = __game.game, m = G.enemies.spawn('wraith', 920, G.hero.y - 30); m.cool = 99; const n0 = G.enemies.cellsAlive(m);
	__run(40, { lance: true }, () => { const c = __c(m); return [c.x, c.y]; });
	const after = G.enemies.cellsAlive(m); return { n0, after, melted: G.enemies.stats.melted, pass: G.enemies.stats.melted > 10 && after < n0 * 0.9 };
});
await scen('wraith: left alone it refreezes', () => {
	__fresh(880, true); const G = __game.game, m = G.enemies.spawn('wraith', 920, G.hero.y - 30); m.cool = 99;
	__run(30, { lance: true }, () => { const c = __c(m); return [c.x, c.y]; }); const low = G.enemies.cellsAlive(m);
	__run(240, {}); const later = G.enemies.cellsAlive(m);
	return { low, later, refrozen: G.enemies.stats.refrozen, lastHeat: m.data.lastHeat, dead: m.dead, n0: m.n0, inList: G.enemies.list.includes(m), pass: later > low && G.enemies.stats.refrozen > 0 };
});
await scen('wraith: kept under the lance it dies', () => {
	__fresh(880, true); const G = __game.game, m = G.enemies.spawn('wraith', 920, G.hero.y - 30); m.cool = 99;
	let t = 0; __run(400, (G2, k) => { t = k; return m.dead ? { stop: () => true } : { lance: true }; }, () => { const c = __c(m); return [c.x, c.y]; });
	return { dead: m.dead, ticks: t, cells: G.enemies.cellsAlive(m), n0: m.n0, dist: Math.hypot(m.x - G.hero.x, m.y - G.hero.y), beam: G.powers.beam, hitMob: G.powers.hitMob, pass: m.dead };
});
await scen('swarm: a blast scatters motes and they re-form from the sand', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('swarm', 900); m.cool = 99; __run(30, {});
	__run(30, { charge: true }, () => { const c = __c(m); return [c.x, c.y]; }); __run(10, {});
	const scattered = G.enemies.stats.scattered; const bl = G.powers.lastBolt; const sandNear = () => { let n = 0; for (let y = Math.floor(m.y - 30); y < m.y + 60; y++) for (let x = Math.floor(m.x - 45); x < m.x + 45; x++) if (G.w.get(x, y) === 2) n++; return n; }; const s0 = sandNear(); __run(420, {});
	return { scattered, bolt: bl && [Math.round(bl.x1), Math.round(bl.y1)], m: [Math.round(m.x), Math.round(m.y)], hero: [Math.round(G.hero.x), Math.round(G.hero.y)], sandNear0: s0, sandNear: sandNear(), deadT: m.parts.map(p => +p.deadT.toFixed(1)), reformed: G.enemies.stats.reformed, alive: !m.dead, pass: scattered >= 2 && G.enemies.stats.reformed >= 1 };
});
await scen('swarm: heat fuses a mote to glass, and glass shatters for good', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('swarm', 900); m.cool = 99; __run(30, {});
	__run(90, { lance: true }, () => { const p = m.parts.find(p => p.alive && !p.glass) || m.parts[0]; const q = G.enemies.worldOf(m, p, 0, 0); return [q.x, q.y]; });
	const fused = G.enemies.stats.fused;
	const glass = m.parts.filter(p => p.alive && p.glass); const reforms0 = glass.map(p => p.reforms);
	__run(30, { charge: true }, () => { const p = m.parts.find(p => p.alive && p.glass); if (!p) return [m.x, m.y]; const q = G.enemies.worldOf(m, p, 0, 0); return [q.x, q.y]; }); __run(10, {});
	return { fused, glassBefore: glass.length, glassReformsLeft: reforms0, glassShatteredForGood: glass.filter(p => !p.alive && p.reforms === 0).length, pass: fused >= 1 && glass.filter(p => !p.alive && p.reforms === 0).length >= 1 };
});
// ---- combos
await scen('combo: Strike (Grip an enemy, throw it into another)', () => {
	__fresh(); const G = __game.game, a = G.spawnAt('crawler', 910), b = G.spawnAt('crawler', 1000); a.cool = b.cool = 99; __run(10, {});
	__run(1, { grip: true, gripPressed: true }, () => { const c = __c(a); return [c.x, c.y]; });
	const held = !!G.powers.heldMob;
	__run(15, { grip: true }, (G2, k) => { const c = __c(a); return [c.x, c.y - 4 - k]; });
	__run(4, { grip: true }, (G2, k) => { const c = __c(a), t = __c(b); return [c.x + (t.x - c.x) * 0.5 * (k + 1), c.y + (t.y - c.y) * 0.5 * (k + 1)]; });
	__run(1, {}); let t = 0; __run(90, (G2, k) => { t = k; return G.style.found.includes('Strike') ? { stop: () => true } : {}; });
	return { held, combos: G.style.found, pass: G.style.found.includes('Strike') };
});
await scen('combo: Shatterfall (freeze, then Meteor Drop)', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('crawler', 920); m.cool = 99; __run(5, {});
	__run(200, () => m.frozen > 0 ? { stop: () => true } : { rime: true }, () => { const c = __c(m); return [c.x, c.y]; });
	G.hero.x = m.x - 6; G.hero.y = m.y - 40; G.hero.grounded = false; G.hero.flying = false;
	__run(1, { meteorPressed: true }); __run(50, {});
	return { frozen: G.enemies.stats.frozen, dead: m.dead, how: G.deathLog, combos: G.style.found, pass: G.style.found.includes('Shatterfall') };
});
await scen('combo: Steam Bomb (lance a frozen enemy)', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('crawler', 930); m.cool = 99; __run(5, {});
	__run(200, () => m.frozen > 0 ? { stop: () => true } : { rime: true }, () => { const c = __c(m); return [c.x, c.y]; });
	__run(20, { lance: true }, () => { const c = __c(m); return [c.x, c.y]; });
	return { dead: m.dead, combos: G.style.found, pass: G.style.found.includes('Steam Bomb') };
});
await scen('combo: Sandstorm (dash through sand)', () => {
	__fresh(); const G = __game.game, m = G.spawnAt('swarm', 920); m.cool = 99; __run(40, {});
	for (let k = 0; k < 3 && !G.style.found.includes('Sandstorm'); k++) { __run(1, { dashPressed: true }, () => [m.x, m.y]); __run(14, {}, () => [m.x, m.y]); G.powers.dashCd = [0, 0]; }
	return { scattered: G.enemies.stats.scattered, combos: G.style.found, pass: G.style.found.includes('Sandstorm') };
});
await scen('combo: Scald (Lava Blast into water)', () => {
	__fresh(560, true); const G = __game.game; G.hero.y = G.arena.sea - 30; const m = G.enemies.spawn('wraith', 468, G.arena.sea - 10); m.cool = 99; m.launched = 99; __run(5, {});
	__run(30, { charge: true }, () => [492, G.arena.sea + 3]); __run(20, {});
	return { combos: G.style.found, dead: m.dead, pass: G.style.found.includes('Scald') };
});
await scen('combo: Juggle (launch with a blast, keep it up with the lance)', () => {
	__fresh(880, true); const G = __game.game, m = G.spawnAt('crawler', 920); m.cool = 99; __run(5, {}); G.hero.y -= 30;
	__run(30, { charge: true }, () => { const c = __c(m); return [c.x - 2, c.y + 3]; });
	__run(90, () => G.style.found.includes('Juggle') ? { stop: () => true } : { lance: true }, () => { const c = __c(m); return [c.x, c.y]; });
	return { juggles: m.juggles, launched: m.launched, combos: G.style.found, pass: G.style.found.includes('Juggle') };
});
const pass = Object.values(results).every(r => r.pass);
writeFileSync('shots/combat/counters.json', JSON.stringify({ pass, results, errors: w.errors.slice(0, 5) }, null, 1));
console.log(JSON.stringify({ pass, failed: Object.entries(results).filter(([, r]) => !r.pass).map(([k]) => k), errors: w.errors.slice(0, 3) }));
await browser.close(); prev.stop();
process.exit(pass ? 0 : 1);
