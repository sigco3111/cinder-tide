// The two bosses, built on the same matter frames as the enemies (enemies.ts), each a destruction puzzle in its own
// part of the island:
//   The Magma Titan (in the volcano's crater): a huge body of rock plates over lava. Its arms are white-hot and shrug off
//   blows; cool one (Rime Burst, or water: rain from the clouds you boil out of the sea) until it sets dark, then break
//   it off. With both arms gone its chest plates burst and the core shows: freeze the core, then shatter it, three
//   times. It throws boulders (catch them with Grip and throw them back), sends lava waves along the ground and, once
//   its core is open, calls up geysers.
//   The Storm Leviathan (in the bay): a serpent of sea water and cloud around a storm-glass core. Boil its body away to
//   reveal the shell round the core (it heals by drinking the sea when it dives, so a boiled-down sea starves it); freeze
//   it to stop it diving, then tear the shell off with Grip; then break the core. It surges waves at the town and drags
//   in storm clouds that strike lightning (sand struck turns to glass).
// Both telegraph every attack (a wind-up, a glow, a sound), show their health by breaking (plus a slim bar), change
// phase visibly, and die big.
import * as S from '../engine/sim';
import type { Hero } from '../engine/hero';
import { Enemies, makePart, regrid, cell, CORE, PLATE, SHELL, LIMB, EYE, FLESH, type Mob, type Cell, type Part } from './enemies';

const rnd = Math.random;
const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
export interface Wave { x: number; dir: number; life: number; kind: 'lava' | 'surge'; hit: boolean }
export interface Mark { x: number; y: number; t: number; kind: 'geyser' | 'bolt'; done: boolean; y0: number }

export class Bosses {
	boss: Mob | null = null; waves: Wave[] = []; marks: Mark[] = []; bolts: { x: number; y0: number; y1: number; t: number }[] = [];
	boulders = new Set<number>(); // rigid body ids thrown by the titan (they hurt the hero; thrown back, they hurt the titan)
	stats = { limbsBroken: 0, coreShatters: 0, platesTorn: 0, boiled: 0, frozen: 0, regrown: 0, attacks: {} as Record<string, number>, phase: 1 };
	constructor(public en: Enemies) {
		en.bossStep = (m, dt, h) => m.kind === 'titan' ? this.titanStep(m, dt, h) : this.leviStep(m, dt, h);
		en.bossHit = (m, x, y, a, k, dx, dy) => m.kind === 'titan' ? this.titanHit(m, x, y, a, k, dx, dy) : this.leviHit(m, x, y, a, k, dx, dy);
		en.bossHeat = (m, c, a) => m.kind === 'titan' ? this.titanHeat(m, c, a) : this.leviHeat(m, c, a);
		en.bossCold = (m, c, a) => m.kind === 'titan' ? this.titanCold(m, c, a) : this.leviCold(m, c, a);
	}
	get w() { return this.en.w; }
	attack(name: string) { this.stats.attacks[name] = (this.stats.attacks[name] ?? 0) + 1; }
	health(): number {
		const m = this.boss; if (!m || m.dead) return 0;
		if (m.kind === 'titan') return (m.data.armsLeft + m.data.layers) / 5;
		const body = m.data.waterNow / m.data.water0, shell = m.data.platesLeft / 4, core = Math.max(0, m.data.coreHp) / 160;
		return m.data.phase === 1 ? 0.67 + 0.33 * clamp((body - 0.38) / 0.62, 0, 1) : m.data.phase === 2 ? 0.34 + 0.33 * shell : 0.34 * core;
	}
	phaseName() { const m = this.boss; if (!m) return ''; if (m.kind === 'titan') return m.data.phase === 1 ? 'Cool an arm, then break it' : m.data.phase === 2 ? 'Freeze the core, then shatter it' : ''; return m.data.phase === 1 ? 'Boil its body away' : m.data.phase === 2 ? 'Freeze it, then tear off its shell with Grip' : 'Break the storm core'; }
	// ======================================================================= the Magma Titan
	spawnTitan(x: number, y: number) {
		const torso: Cell[] = [], head: Cell[] = [];
		const inT = (lx: number, ly: number) => { if (ly < -52 || ly > -1) return false; const half = 19 + Math.round((-ly) * 0.16) - (ly < -47 ? (ly + 47) * -2 : 0); return Math.abs(lx) <= half; };
		for (let ly = -52; ly <= -1; ly++) for (let lx = -30; lx <= 30; lx++) {
			if (!inT(lx, ly)) continue;
			let depth = 9; for (let k = 1; k <= 8; k++) if (!inT(lx - k, ly) || !inT(lx + k, ly) || !inT(lx, ly - k)) { depth = k; break; }
			const r2 = lx * lx + (ly + 31) ** 2, core = r2 <= 64, chest = !core && r2 <= 170 && ly < -18;
			// a few cracks of lava across dark rock (not a grid of dots)
			const c1 = Math.abs((((lx + ly * 0.55) % 17) + 17) % 17 - 8.5) < 0.55, c2 = Math.abs((((lx * -0.9 + ly * 0.7 + 5) % 23) + 23) % 23 - 11.5) < 0.5;
			const vein = !core && !chest && depth > 3 && (c1 || c2) && ((lx * 7 + ly * 3) & 7) !== 0;
			const skirt = ly >= -3;
			let plate = -1; if (chest) plate = (lx < 0 ? 0 : 1) + (ly < -31 ? 0 : 2);
			const t = core ? S.LAVA : skirt ? S.LAVA : chest ? S.BASALT : depth <= 3 ? S.BASALT : vein ? S.LAVA : S.OBSIDIAN;
			torso.push(cell(lx, ly, t, core ? CORE : chest ? PLATE : skirt ? FLESH : SHELL, plate, t === S.LAVA ? 1500 : 120));
		}
		for (let ly = -17; ly <= 0; ly++) for (let lx = -11; lx <= 11; lx++) {
			if (lx * lx / 121 + (ly + 8) ** 2 / 90 > 1) continue;
			const eye = (ly === -9 || ly === -10) && (Math.abs(lx) === 4 || Math.abs(lx) === 5), mouth = ly >= -4 && ly <= -3 && Math.abs(lx) < 5;
			head.push(cell(lx, ly, eye ? S.EMBER : mouth ? S.LAVA : S.BASALT, eye ? EYE : SHELL, -1, eye ? 900 : mouth ? 1500 : 120));
		}
		const arm = () => { const out: Cell[] = []; for (let ly = 0; ly <= 58; ly++) for (let lx = -9; lx <= 9; lx++) { const half = ly > 46 ? 8.5 : ly < 8 ? 7.5 : 5.5 + Math.sin(ly * 0.22) * 0.8; if (Math.abs(lx) > half) continue; const vein = (Math.abs(lx) <= 1 && ly > 4 && ly < 56) || (ly > 47 && ((lx + ly) & 3) === 0 && Math.abs(lx) < 7); out.push(cell(lx, ly, vein ? S.LAVA : S.BASALT, vein ? CORE : LIMB, -1, vein ? 1500 : 300)); } return out; };
		const parts = [makePart(torso, 0, 0, false), makePart(head, 0, -52, false), makePart(arm(), -31, -47, false), makePart(arm(), 31, -47, false)];
		parts[2].heat = 1; parts[3].heat = 1; parts[2].ang = 0.15; parts[3].ang = -0.15;
		const m = this.en.newMob('titan', x, y + 75, parts, 1); m.boss = true; m.r = 30; m.mass = 99; m.face = -1;
		m.data = { phase: 0, armsLeft: 2, layers: 3, coreFrost: 0, coreFrozen: 0, x0: x, y0: y, rise: 0, cool: 3, stagger: 0, dying: 0, breathT: 0, invuln: 0, throwArm: 2 };
		this.boss = m; this.stats.phase = 1;
		this.en.ev('bossIntro', m, x, y - 40, { name: 'The Magma Titan' });
		return m;
	}
	arms(m: Mob) { return [m.parts[2], m.parts[3]]; }
	setArmLook(p: Part) { const cool = p.heat < 0.3; for (const c of p.cells) if (c.alive && c.role === CORE) { c.t = cool ? S.OBSIDIAN : S.LAVA; c.temp = cool ? 60 : 1500; } else if (c.alive) c.temp = cool ? 30 : 200 + 400 * p.heat; }
	titanStep(m: Mob, dt: number, hero: Hero) {
		const d = m.data, w = this.w;
		if (d.dying > 0) return; // comes apart in afterStamp
		// rise out of the crater
		if (d.phase === 0) { d.rise += dt; m.y = d.y0 + 75 * Math.max(0, 1 - d.rise / 2.6); if (d.rise > 2.6) { d.phase = 1; m.state = 'idle'; m.stateT = 0; this.en.ev('bossPhase', m, m.x, m.y - 40, { name: 'Cool an arm, then break it' }); } this.idlePose(m, dt); return; }
		const arms = this.arms(m);
		// arms: cooled by rime (titanCold) and by water touching them (afterStamp); left alone they heat back up
		for (const p of arms) {
			if (!p.alive) continue;
			if (p.data.chill > 0) { p.heat = Math.max(0, p.heat - Math.min(1, p.data.chill / 25) * 0.0042); p.data.chill = 0; } // about 3 s of Rime Burst cools an arm
			if (p.heat < 0.3) { p.data.coolT = (p.data.coolT ?? 0) + dt; if (p.data.coolT > 7) p.heat += dt * 0.06; } else { p.data.coolT = 0; if (p.heat < 1) p.heat = Math.min(1, p.heat + dt * 0.05); }
			const wasCool = p.data.wasCool === 1, isCool = p.heat < 0.3;
			if (isCool !== wasCool) { p.data.wasCool = isCool ? 1 : 0; this.setArmLook(p); this.en.ev(isCool ? 'limbCool' : 'limbHot', m, m.x + p.px, m.y + p.py + 20); }
		}
		if (d.coreChill > 0) { if (d.coreFrozen <= 0) { d.coreFrost += Math.min(1, d.coreChill / 25) / 130; if (d.coreFrost >= 1) this.setCore(m, true); } d.coreChill = 0; }
		if (d.coreFrozen > 0) { d.coreFrozen -= dt; if (d.coreFrozen <= 0) this.setCore(m, false); }
		if (d.coreFrost > 0 && d.coreFrozen <= 0) d.coreFrost = Math.max(0, d.coreFrost - dt * 0.1);
		if (d.stagger > 0) { d.stagger -= dt; this.idlePose(m, dt, 0.4); return; }
		// attacks, each with a wind-up
		d.cool -= dt;
		if (m.state === 'idle' && d.cool <= 0) {
			const r = rnd(), p2 = d.phase === 2, liveArms = arms.filter(a => a.alive);
			// a hero close to a live arm gets swatted
			const near = liveArms.find(a => { const q = this.en.worldOf(m, a, 0, 40); return Math.hypot(hero.x - q.x, hero.y - 9 - q.y) < 62; });
			if (near) { m.state = 'windSwipe'; d.throwArm = m.parts.indexOf(near); m.tell = 0.65; m.data.tellT = 0.65; this.en.ev('tell', m, m.x, m.y - 50, { name: 'swipe' }); }
			else if (r < 0.3) { m.state = 'windBreath'; m.tell = 0.7; m.data.tellT = 0.7; this.en.ev('tell', m, m.x, m.y - 60, { name: 'breath' }); }
			else if (r < 0.58) { m.state = 'windThrow'; d.throwArm = liveArms.length ? (liveArms.length === 2 ? (hero.x < m.x ? 2 : 3) : m.parts.indexOf(liveArms[0])) : 1; m.tell = 1.0; m.data.tellT = 1.0; this.en.ev('tell', m, m.x, m.y - 50, { name: 'boulder' }); }
			else if (r < 0.8 || !p2) { m.state = 'windWave'; m.tell = 1.2; m.data.tellT = 1.2; this.en.ev('tell', m, m.x, m.y - 50, { name: 'wave' }); }
			else { m.state = 'windGeyser'; m.tell = 0.3; m.data.tellT = 0.3; for (let k = 0; k < 4; k++) { const gx = k === 0 ? hero.x : m.x + (rnd() - 0.5) * 220; this.marks.push({ x: gx, y: this.groundAt(gx, hero.y - 60), t: 1.1, kind: 'geyser', done: false, y0: 0 }); } this.en.ev('tell', m, m.x, m.y - 50, { name: 'geyser' }); }
			m.stateT = 0;
		}
		if (m.state === 'windSwipe') {
			const p = m.parts[d.throwArm], s2 = d.throwArm === 2 ? 1 : -1;
			if (!p.alive) m.state = 'idle';
			else if (m.stateT < 0.65) p.ang = s2 * (0.15 + Math.min(1, m.stateT / 0.65) * 0.9); // pulls back
			else if (m.stateT < 0.95) { // and sweeps through
				p.ang = s2 * (1.05 - (m.stateT - 0.65) / 0.3 * 2.2);
				for (const t of [30, 44, 56]) { const q = this.en.worldOf(m, p, 0, t); if (Math.hypot(hero.x - q.x, hero.y - 9 - q.y) < 16) { this.en.hurtHero(hero, 22, q.x, 'swipe'); break; } }
				if (!d.swung) { d.swung = 1; this.en.ev('bossSwipe', m, m.x, m.y - 30); this.attack('swipe'); }
			} else { d.swung = 0; m.state = 'recover'; m.stateT = 0; d.cool = 1.4; }
		}
		if (m.state === 'windBreath') {
			if (m.stateT > 0.7) { // a fan of lava from the mouth
				const mx = m.x + m.parts[1].px, my = m.y - 55, dx = hero.x - mx, dy = hero.y - 9 - my, a = Math.atan2(dy, dx);
				for (const da of [-0.3, -0.15, 0, 0.15, 0.3]) this.en.shoot(mx, my, Math.cos(a + da) * 115, Math.sin(a + da) * 115, 'lava', 10);
				this.en.ev('bossBreath', m, mx, my); this.attack('breath');
				m.state = 'recover'; m.stateT = 0; d.cool = d.phase === 2 ? 1.3 : 1.9;
			}
		}
		if (m.state === 'windThrow') {
			const p = m.parts[d.throwArm]; const s = d.throwArm === 2 ? 1 : -1;
			if (d.throwArm >= 2) p.ang = s * (0.15 + Math.min(1, m.stateT / 1.0) * 2.4); // the arm swings up and back
			if (!p.alive) { m.state = 'idle'; }
			else if (m.stateT > 1.0) { this.throwBoulder(m, p, hero); m.state = 'recover'; m.stateT = 0; d.cool = d.phase === 2 ? 1.4 : 2.0; }
		} else if (m.state === 'windWave') {
			for (const p of arms) if (p.alive) p.ang = (p === arms[0] ? 1 : -1) * (0.15 + Math.min(1, m.stateT / 1.2) * 2.6);
			if (m.stateT > 1.2) { // slam down: lava waves race out along the ground both ways
				for (const p of arms) if (p.alive) p.ang = (p === arms[0] ? 1 : -1) * 0.1;
				for (const dir of [-1, 1]) this.waves.push({ x: m.x + dir * 30, dir, life: 3.2, kind: 'lava', hit: false });
				this.w.explode(m.x, m.y - 2, 10, 0.7, false); this.en.ev('bossSlam', m, m.x, m.y); this.attack('lavaWave');
				m.state = 'recover'; m.stateT = 0; d.cool = d.phase === 2 ? 1.6 : 2.4;
			}
		} else if (m.state === 'windGeyser') { if (m.stateT > 0.3) { m.state = 'recover'; m.stateT = 0; d.cool = 2.6; this.attack('geyser'); } }
		else if (m.state === 'recover') { this.idlePose(m, dt, 0.6); if (m.stateT > 0.8) m.state = 'idle'; }
		else this.idlePose(m, dt);
		// the heat round its body burns anyone hugging it
		if (Math.abs(hero.x - m.x) < 26 && hero.y > m.y - 70 && hero.y < m.y + 6) this.en.hurtHero(hero, 7, m.x, 'heat');
		// the titan sways and leans toward the hero
		m.x = d.x0 + Math.sin(m.phase * 0.5) * 4 + clamp((hero.x - d.x0) * 0.03, -8, 8);
		void hero;
	}
	idlePose(m: Mob, dt: number, k = 1) {
		const arms = this.arms(m); arms.forEach((p, i) => { if (!p.alive) return; const s = i === 0 ? 1 : -1; const target = s * (0.15 + Math.sin(m.phase * 1.1 + i) * 0.08 * k); p.ang += (target - p.ang) * Math.min(1, dt * 4); });
		m.parts[1].px = Math.sin(m.phase * 0.7) * 1.5;
	}
	groundAt(x: number, from: number) { const w = this.w; let y = Math.max(2, Math.floor(from)); while (y < w.H - 2 && !(S.ST[w.get(Math.floor(x), y)] === S.SOLID || S.ST[w.get(Math.floor(x), y)] === S.POWDER || S.ST[w.get(Math.floor(x), y)] === S.LIQUID)) y++; return y; }
	throwBoulder(m: Mob, p: Part, hero: Hero) {
		const w = this.w, b = this.en.bodies; if (!b) return;
		const hand = p === m.parts[1] ? { x: m.x + p.px, y: m.y - 70 } : this.en.worldOf(m, p, 0, 56), hx = Math.round(hand.x), hy = Math.round(hand.y) - 7;
		const cells: number[] = [];
		for (let y = hy - 5; y <= hy + 5; y++) for (let x = hx - 5; x <= hx + 5; x++) { if (!w.inb(x, y) || (x - hx) ** 2 + (y - hy) ** 2 > 26 + rnd() * 6) continue; const i = y * w.W + x; if (w.body[i] || S.ST[w.type[i]] === S.SOLID) continue; w.type[i] = rnd() < 0.2 ? S.OBSIDIAN : S.BASALT; w.temp[i] = 700; cells.push(i); }
		if (cells.length < 20) return;
		// aim to land on the hero: a lob, a little ahead of where they're going
		const tx = hero.x + hero.vx * 6, ty = hero.y - 8, dx = tx - hx, dy = ty - hy, T = clamp(Math.hypot(dx, dy) / 140, 0.6, 1.4), g = 9.81 * 1.6 * 10;
		const vx = dx / T, vy = dy / T - 0.5 * g * T;
		const body = b.makeBody(cells, { x: vx / 10, y: vy / 10 }, (rnd() - 0.5) * 4); body.thrown = 0;
		this.boulders.add(body.id); this.en.ev('bossThrow', m, hx, hy); this.attack('boulder');
	}
	setCore(m: Mob, frozen: boolean) {
		for (const c of m.parts[0].cells) if (c.alive && c.role === CORE) { c.t = frozen ? S.OBSIDIAN : S.LAVA; c.temp = frozen ? -20 : 1500; }
		if (frozen) { m.data.coreFrozen = 4.5; m.data.coreFrost = 0; this.stats.frozen++; this.en.ev('freeze', m, m.x, m.y - 31); } else this.en.ev('thaw', m, m.x, m.y - 31);
	}
	titanCold(m: Mob, c: Cell, amount: number) {
		const p = m.parts[c.part];
		if (p === m.parts[2] || p === m.parts[3]) { p.data.chill = (p.data.chill ?? 0) + amount; return; }
		// with the chest open, cold reaching the rock round the core seeps into it
		if (m.data.phase === 2 && m.data.coreFrozen <= 0 && p === m.parts[0] && this.en.dist2(m, c, m.x, m.y - 31) < 24 * 24) m.data.coreChill = (m.data.coreChill ?? 0) + amount;
	}
	titanHeat(m: Mob, c: Cell, amount: number) {
		const p = m.parts[c.part];
		if (p === m.parts[2] || p === m.parts[3]) { p.heat = Math.min(1, p.heat + amount * 0.00004); if (rnd() < 0.04) this.en.ev('shrug', m, m.x + p.px, m.y + p.py + 20); return; }
		if (c.role === CORE && m.data.coreFrozen > 0) { this.shatterCore(m, 'steam'); this.en.ev('combo', m, m.x, m.y - 31, { name: 'Steam Bomb' }); }
	}
	titanHit(m: Mob, x: number, y: number, amount: number, kind: string, dx: number, dy: number) {
		if (m.data.phase === 0 || m.data.dying > 0 || amount < 6) return;
		// which part was hit: the nearest live cell
		let best: Cell | null = null, bd = 1e9;
		for (const p of m.parts) { if (!p.alive) continue; for (let k = 0; k < p.cells.length; k += 2) { const c = p.cells[k]; if (!c.alive) continue; const d = this.en.dist2(m, c, x, y); if (d < bd) { bd = d; best = c; } } }
		if (!best || bd > 30 * 30) return;
		const p = m.parts[best.part];
		if ((p === m.parts[2] || p === m.parts[3])) {
			if (p.heat < 0.3 && amount >= 14) { p.data.cracks = (p.data.cracks ?? 0) + 1; if (p.data.cracks >= 2) { this.breakArm(m, p, dx, dy); return; } this.en.ev('limbCrack', m, x, y); for (const c of p.cells) if (c.alive && rnd() < 0.08) this.en.release(m, c, dx * 30 + (rnd() - 0.5) * 30, -20, true, S.RUBBLE); return; } // two hard blows break a cooled arm
			this.en.ev('clank', m, x, y); if (p.heat >= 0.3) this.en.ev('shrug', m, x, y); return;
		}
		if (m.data.phase === 2 && m.data.coreFrozen > 0 && Math.hypot(x - m.x, y - (m.y - 31)) < 26 && amount >= 12) { this.shatterCore(m, kind); return; }
		this.en.ev('clank', m, x, y);
		void dy;
	}
	breakArm(m: Mob, p: Part, dx: number, dy: number) {
		const cells = p.cells.filter(c => c.alive);
		this.en.chunk(m, cells, { x: dx * 30 + (p === m.parts[2] ? -20 : 20), y: dy * 10 - 20 }, 4);
		p.alive = false; m.data.armsLeft--; this.stats.limbsBroken++;
		const sh = this.en.worldOf(m, p, 0, 0);
		for (let k = 0; k < 60; k++) this.w.spawnParticle(sh.x + (rnd() - 0.5) * 6, sh.y + rnd() * 4, (rnd() - 0.5) * 60 + (p === m.parts[2] ? -30 : 30), -rnd() * 50, S.LAVA, 1500);
		m.data.stagger = 1.4; m.state = 'idle'; m.tell = 0;
		this.en.ev('limbBreak', m, sh.x, sh.y + 20);
		if (m.data.armsLeft <= 0) { // phase 2: the chest plates burst off and the core shows
			m.data.phase = 2; this.stats.phase = 2; m.data.stagger = 2.2;
			const plates = m.parts[0].cells.filter(c => c.alive && c.role === PLATE);
			for (let k = 0; k < 4; k++) this.en.chunk(m, plates.filter(c => c.plate === k), { x: (k % 2 ? 40 : -40), y: -40 }, 2);
			this.en.ev('bossPhase', m, m.x, m.y - 31, { name: 'Freeze the core, then shatter it' });
		}
	}
	shatterCore(m: Mob, kind: string) {
		const core = m.parts[0].cells.filter(c => c.alive && c.role === CORE);
		if (!core.length) return;
		// the outer ring of the core breaks away as chunks; the rest thaws back to lava
		const cx = m.x, cy = m.y - 31;
		const r = Math.max(...core.map(c => Math.hypot(c.lx, c.ly + 31)));
		const ring = core.filter(c => Math.hypot(c.lx, c.ly + 31) > r - 2.7 || m.data.layers <= 1);
		this.en.chunk(m, ring, { x: 0, y: -30 }, 3);
		m.data.layers--; this.stats.coreShatters++; m.data.coreFrozen = 0; this.setCore(m, false);
		this.en.ev('coreShatter', m, cx, cy, { name: kind });
		if (m.data.layers <= 0) { m.data.dying = 0.001; this.en.ev('bossDying', m, cx, cy); }
		else m.data.stagger = 1.6;
	}
	titanDie(m: Mob, dt: number) {
		const d = m.data; d.dying += dt;
		// it comes apart from the top down: plates as chunks, lava pouring out
		const live = m.parts.flatMap(p => p.alive ? p.cells.filter(c => c.alive) : []);
		live.sort((a, b) => this.en.dist2(m, a, m.x, m.y - 80) - this.en.dist2(m, b, m.x, m.y - 80));
		const n = Math.ceil(live.length * dt / Math.max(0.2, 2.6 - d.dying));
		const take = live.slice(0, n);
		const solid = take.filter(c => c.t !== S.LAVA), lava = take.filter(c => c.t === S.LAVA);
		if (solid.length > 30 && rnd() < 0.5) this.en.chunk(m, solid, { x: (rnd() - 0.5) * 40, y: -20 }, 2); else for (const c of solid) this.en.release(m, c, (rnd() - 0.5) * 50, -rnd() * 30, true, rnd() < 0.5 ? S.RUBBLE : c.t);
		for (const c of lava) this.en.release(m, c, (rnd() - 0.5) * 60, -10 - rnd() * 40, true, S.LAVA);
		if (rnd() < 0.3) this.en.ev('bossCrumble', m, m.x + (rnd() - 0.5) * 40, m.y - 30 - rnd() * 30);
		if (d.dying > 2.8 || !live.length) { this.en.kill(m, 'boss', true); this.boss = m; this.en.ev('bossDead', m, m.x, m.y - 30, { name: 'The Magma Titan' }); }
	}
	// ======================================================================= the Storm Leviathan
	spawnLeviathan(x: number, y: number) {
		const parts: Part[] = [];
		const head: Cell[] = [];
		for (let ly = -12; ly <= 12; ly++) for (let lx = -15; lx <= 15; lx++) {
			const e = lx * lx / 225 + ly * ly / 144; if (e > 1) continue;
			const r = Math.hypot(lx * 0.9, ly);
			const core = r <= 2.6, shell = !core && r <= 4.6;
			const eye = (lx === 9 || lx === 10) && (ly === -5 || ly === -6);
			const plate = shell ? (lx >= 0 ? 0 : 1) + (ly >= 0 ? 2 : 0) : -1;
			head.push(cell(lx, ly, core ? S.GLASS : shell ? S.OBSIDIAN : eye ? S.EMBER : S.STORM, core ? CORE : shell ? PLATE : eye ? EYE : FLESH, plate, core ? 20 : eye ? 900 : 15));
		}
		parts.push(makePart(head, 0, 0, true));
		// the body: each segment is a tube from its point forward to the one ahead of it, its radius tapering along the
		// way, so neighbours overlap into one smooth serpent that narrows to a fine tail
		const SEG = 12.5, rad = (k: number) => Math.max(1.6, 10.5 - k * 0.95);
		for (let k = 1; k <= 10; k++) {
			const r0 = rad(k), r1 = rad(k - 1) * (k === 1 ? 0.95 : 1), cs: Cell[] = [];
			for (let lx = -Math.ceil(r0); lx <= SEG + 2; lx++) for (let ly = -12; ly <= 12; ly++) {
				const t = Math.max(0, Math.min(1, lx / SEG)), r = r0 + (r1 - r0) * t;
				if (lx < 0 ? lx * lx + ly * ly > r0 * r0 : Math.abs(ly) > r) continue;
				cs.push(cell(lx, ly, k % 3 === 2 && Math.abs(ly) <= 1 && lx > 4 && lx < 8 ? S.CLOUD : S.STORM, FLESH, -1, 15));
			}
			parts.push(makePart(cs, 0, 0, false));
		}
		const m = this.en.newMob('leviathan', x, y, parts, 1); m.boss = true; m.r = 14; m.mass = 99; m.face = 1;
		const water0 = parts.reduce((s, p) => s + p.cells.filter(c => c.t === S.STORM).length, 0);
		m.data = { phase: 1, water0, waterNow: water0, platesLeft: 4, coreHp: 160, frost: 0, frozen: 0, dive: 0, surfaced: 0, cool: 3, x0: x, y0: y, dying: 0, revealed: 0, tx: x, ty: y, trail: 0 };
		m.data.trailX = x; (m as any).trail = Array.from({ length: 600 }, () => ({ x, y }));
		this.boss = m; this.stats.phase = 1;
		this.en.ev('bossIntro', m, x, y, { name: 'The Storm Leviathan' });
		return m;
	}
	leviStep(m: Mob, dt: number, hero: Hero) {
		const d = m.data, w = this.w, sea = d.sea as number;
		if (d.dying > 0) return;
		const trail = (m as any).trail as { x: number; y: number }[];
		d.waterNow = m.parts.reduce((s, p) => s + p.cells.filter(c => c.alive && (c.t === S.STORM || c.t === S.ICE)).length, 0);
		if (d.phase === 1 && d.waterNow < d.water0 * 0.38) { d.phase = 2; this.stats.phase = 2; this.en.ev('bossPhase', m, m.x, m.y, { name: 'Freeze it, then tear off its shell with Grip' }); }
		if (d.phase === 2 && d.platesLeft <= 0) { d.phase = 3; this.stats.phase = 3; this.en.ev('bossPhase', m, m.x, m.y, { name: 'Break the storm core' }); }
		if (d.chill > 0) { if (d.frozen <= 0) { d.frost += Math.min(1, d.chill / 25) / (d.phase >= 2 ? 200 : 500); if (d.frost >= 1) this.leviFreeze(m, true); } d.chill = 0; }
		if (d.frozen > 0) { d.frozen -= dt; if (d.frozen <= 0) this.leviFreeze(m, false); }
		else if (d.frost > 0 && !(d.chill > 0)) d.frost = Math.max(0, d.frost - dt * 0.08);
		// where the head goes: a slow patrol under the surface, breaching toward the hero; a dive to heal
		const frozen = d.frozen > 0;
		d.cool -= dt;
		if (frozen) { d.ty = sea - 2; d.tx = m.x; }
		else if (m.state === 'dive') { d.ty = sea + 40; d.tx = d.x0 + Math.sin(m.phase * 0.4) * 120; if (m.stateT > 3.5) { m.state = 'swim'; m.stateT = 0; } this.drink(m, dt); }
		else if (m.state === 'windSurge') { d.ty = sea - 26; d.tx = m.x + Math.sign(hero.x - m.x) * 4; if (m.stateT > 1.3) { this.waves.push({ x: m.x + 14, dir: 1, life: 4.5, kind: 'surge', hit: false }); this.attack('surge'); this.en.ev('bossSurge', m, m.x, sea); m.state = 'swim'; m.stateT = 0; d.cool = 2.5; } }
		else if (m.state === 'windBite') { d.tx = m.x; d.ty = m.y; if (m.stateT > 0.55) { m.state = 'bite'; m.stateT = 0; d.bx = hero.x; d.by = hero.y - 9; } }
		else if (m.state === 'bite') { d.tx = d.bx; d.ty = d.by; if (Math.hypot(hero.x - m.x, hero.y - 9 - m.y) < 13) { this.en.hurtHero(hero, 20, m.x, 'bite'); } if (m.stateT > 0.5) { m.state = 'swim'; m.stateT = 0; d.cool = 1.5; } }
		else {
			// swimming: weave below the surface near the hero's side of the bay, surface to strike
			const px = clamp(hero.x - 80 + Math.sin(m.phase * 0.35) * 90, 60, (d.shore as number) - 30);
			const breach = Math.sin(m.phase * 0.9 + m.seed * 6) > 0.35; // it comes up to breathe, back and head out of the water
			d.tx = px; d.ty = breach ? sea - 16 + Math.sin(m.phase * 2) * 4 : sea + 14 + Math.sin(m.phase * 0.8) * 6;
			if (d.cool <= 0) {
				const r = rnd(), near = Math.hypot(hero.x - m.x, hero.y - m.y) < 60;
				if (near) { m.state = 'windBite'; m.tell = 0.55; m.data.tellT = 0.55; this.en.ev('tell', m, m.x, m.y, { name: 'bite' }); this.attack('bite'); }
				else if (r < 0.35) { m.state = 'windSurge'; m.tell = 1.3; m.data.tellT = 1.3; this.en.ev('tell', m, m.x, m.y, { name: 'surge' }); }
				else if (r < 0.75) { this.lightning(m, hero); if (d.phase === 3) this.lightning(m, hero); d.cool = d.phase >= 2 ? 1.5 : 2.2; }
				else if (d.phase < 3 && (r < 0.9 || d.waterNow < d.water0 * 0.7)) { m.state = 'dive'; m.stateT = 0; this.en.ev('bossDive', m, m.x, sea); d.cool = 4; }
				else { this.dragClouds(m); d.cool = 1.5; }
				if (m.state === 'swim') m.stateT = 0;
			}
		}
		if (frozen) { /* locked in its ice, bobbing at the surface */ }
		// steer the head (fast in a bite, slow when frozen), and lay the body along its trail
		const sp = m.state === 'bite' ? 150 : frozen ? 6 : 55, dx = d.tx - m.x, dy = d.ty - m.y, dl = Math.hypot(dx, dy) || 1;
		m.vx += (dx / dl * Math.min(sp, dl * 3) - m.vx) * Math.min(1, dt * 3); m.vy += (dy / dl * Math.min(sp, dl * 3) - m.vy) * Math.min(1, dt * 3);
		m.x = clamp(m.x + m.vx * dt, 40, (d.shore as number)); m.y = clamp(m.y + m.vy * dt, 40, sea + 34);
		if (Math.abs(m.vx) > 3) m.face = Math.sign(m.vx);
		if (!frozen) { trail.unshift({ x: m.x, y: m.y }); trail.length = 600; }
		let acc = 0, idx = 0, dist = 0, target = 0; // arclength along the trail, so each segment sits one spacing behind the last
		for (let k = 1; k < m.parts.length; k++) {
			const want = k === 1 ? 13 : 12.5; // spacing along the trail (each tube reaches its leader)
			target += want; while (idx < trail.length - 1 && dist < target) { dist += Math.hypot(trail[idx + 1].x - trail[idx].x, trail[idx + 1].y - trail[idx].y); idx++; }
			const q = trail[Math.min(idx, trail.length - 1)];
			const prevP = k === 1 ? { x: m.x, y: m.y } : { x: m.x + m.parts[k - 1].px, y: m.y + m.parts[k - 1].py };
			m.parts[k].px = q.x - m.x; m.parts[k].py = q.y - m.y; m.parts[k].ang = Math.atan2(prevP.y - q.y, prevP.x - q.x); acc++;
		}
		void acc;
		// the storm: lightning marks resolve into bolts
		// regrowth while drinking happens in drink()
		void w;
	}
	drink(m: Mob, dt: number) {
		// healing: water cells grow back from the sea around the body (the sea goes down to pay for it)
		const d = m.data, w = this.w; if (d.phase === 3) return;
		d.regenAcc = (d.regenAcc ?? 0) + dt * 45; const budget = Math.floor(d.regenAcc); d.regenAcc -= budget; // ~45 cells a second while it drinks
		let grown = 0;
		for (let n = 0; n < 400 && grown < budget; n++) {
			const p = m.parts[(rnd() * m.parts.length) | 0]; const dead = p.cells.filter(c => !c.alive && c.t0 === S.STORM); if (!dead.length) continue;
			const c = dead[(rnd() * dead.length) | 0], q = this.en.worldOf(m, p, c.lx, c.ly);
			// find sea water within a few cells of where the cell goes
			let src = -1; for (let t = 0; t < 8 && src < 0; t++) { const xx = Math.floor(q.x + (rnd() - 0.5) * 16), yy = Math.floor(q.y + (rnd() - 0.5) * 16); if (!w.inb(xx, yy)) continue; const i = yy * w.W + xx; if (w.type[i] === S.WATER && !w.body[i]) src = i; }
			if (src < 0) continue;
			w.type[src] = S.AIR; w.wake(src % w.W, (src / w.W) | 0);
			c.alive = true; c.t = S.STORM; c.temp = 15; grown++; this.stats.regrown++;
		}
	}
	lightning(m: Mob, hero: Hero) {
		const x = hero.x + hero.vx * 3, y = this.groundAt(x, Math.max(10, hero.y - 80));
		this.marks.push({ x, y, t: 0.95, kind: 'bolt', done: false, y0: this.w.cloudLine });
		this.en.ev('tell', m, x, y, { name: 'bolt' }); this.attack('lightning');
		if (rnd() < 0.5) this.dragClouds(m);
	}
	dragClouds(m: Mob) {
		const w = this.w, cx = m.x + (rnd() - 0.5) * 200, cy = w.cloudLine + 6 + rnd() * 10;
		for (let k = 0; k < 160; k++) { const x = Math.floor(cx + (rnd() - 0.5) * 60), y = Math.floor(cy + (rnd() - 0.5) * 10); if (w.inb(x, y) && w.type[y * w.W + x] === S.AIR) { w.type[y * w.W + x] = S.CLOUD; w.temp[y * w.W + x] = 5; w.wake(x, y); } }
		this.en.ev('bossClouds', m, cx, cy); this.attack('clouds');
	}
	leviFreeze(m: Mob, on: boolean) {
		const d = m.data;
		for (const p of m.parts) for (const c of p.cells) if (c.alive && (c.t === S.STORM || c.t === S.ICE || c.t === S.CLOUD)) { c.t = on ? S.ICE : c.t0; c.temp = on ? -20 : 15; }
		if (on) { d.frozen = 4.5; d.frost = 0; this.stats.frozen++; m.state = 'swim'; this.en.ev('freeze', m, m.x, m.y); } else this.en.ev('thaw', m, m.x, m.y);
	}
	leviCold(m: Mob, c: Cell, amount: number) { const d = m.data; if (d.frozen > 0 || d.dying > 0) return; d.chill = (d.chill ?? 0) + amount; void c; }
	leviHeat(m: Mob, c: Cell, amount: number) {
		const d = m.data;
		if (c.role === CORE && d.phase === 3) { d.coreHp -= amount * 0.002; this.coreCheck(m); return; }
		if (d.frozen > 0 && c.t === S.ICE) { c.temp += amount * 0.02; if (c.temp > 2) { this.en.release(m, c, 0, -10, true, S.WATER); } return; }
		{
			// the beam flashes the water it touches to steam: the hit cell and its nearest neighbours boil off at once (hitting
			// the shell still boils the water round it)
			const p = m.parts[c.part], k = Math.max(1, Math.round(amount / 80)), R2 = c.t === S.STORM || c.t === S.CLOUD ? 8 : 26;
			const near = p.cells.filter(cc => cc.alive && (cc.t === S.STORM || cc.t === S.CLOUD) && (cc.lx - c.lx) ** 2 + (cc.ly - c.ly) ** 2 <= R2).sort((a, b) => ((a.lx - c.lx) ** 2 + (a.ly - c.ly) ** 2) - ((b.lx - c.lx) ** 2 + (b.ly - c.ly) ** 2)).slice(0, k);
			for (const cc of near) { this.en.release(m, cc, (rnd() - 0.5) * 10, -10, true, this.stats.boiled % 3 === 0 ? S.STEAM : S.AIR); this.stats.boiled++; this.en.ev('vapour', m, m.x, m.y); } // a third becomes real steam, the rest flashes off as vapour
		}
	}
	leviHit(m: Mob, x: number, y: number, amount: number, kind: string, dx: number, dy: number) {
		const d = m.data; if (d.dying > 0) return;
		if (d.phase === 3 && Math.hypot(x - m.x, y - m.y) < 20) { d.coreHp -= amount * (d.frozen > 0 ? 0.5 : 0.12); this.en.ev('coreHit', m, m.x, m.y); this.coreCheck(m); return; }
		// blasts splash its water away (it splashes into the sea, it does not boil)
		const n = Math.ceil(amount / 4);
		const cells = m.parts.flatMap(p => p.cells.filter(c => c.alive && (c.t === S.STORM || c.t === S.ICE))).sort((a, b) => this.en.dist2(m, a, x, y) - this.en.dist2(m, b, x, y)).slice(0, n);
		for (const c of cells) this.en.release(m, c, dx * 30 + (rnd() - 0.5) * 30, -20 - rnd() * 20, true, c.t === S.ICE ? S.ICE : S.WATER);
		this.en.ev('splashHit', m, x, y);
		void dy; void kind;
	}
	coreCheck(m: Mob) { if (m.data.coreHp <= 0 && m.data.dying <= 0) { m.data.dying = 0.001; this.en.ev('bossDying', m, m.x, m.y); } }
	// Grip on the leviathan: only once it's frozen, the shell plates tear off
	gripLevi(x: number, y: number, r: number) {
		const m = this.boss; if (!m || m.kind !== 'leviathan' || m.dead) return null;
		if (Math.hypot(x - m.x, y - m.y) > r + 14) return null;
		if (m.data.frozen <= 0 || m.data.phase < 2) { this.en.ev('slip', m, m.x, m.y); return 'slip'; }
		let pk = -1, pn = 0; const head = m.parts[0];
		for (let k = 0; k < 4; k++) { let n = 0; for (const c of head.cells) if (c.alive && c.plate === k && this.en.dist2(m, c, x, y) < r * r) n++; if (n > pn) { pn = n; pk = k; } }
		if (pk < 0) return null;
		const bodies = this.en.chunk(m, head.cells.filter(c => c.alive && c.plate === pk), { x: 0, y: 0 }, 1);
		m.data.platesLeft--; this.stats.platesTorn++; this.en.stats.platesTorn++;
		this.en.ev('plateTorn', m, m.x, m.y);
		return bodies[0] ?? null;
	}
	leviDie(m: Mob, dt: number) {
		const d = m.data; d.dying += dt;
		// the body bursts into a downpour; the core shatters into glass
		if (d.dying < 0.1 || rnd() < 0.5) {
			for (const p of m.parts) for (const c of p.cells) if (c.alive && rnd() < dt * 2.5) this.en.release(m, c, (rnd() - 0.5) * 70, -30 - rnd() * 80, true, c.role === CORE ? S.SHARD : c.t === S.ICE ? S.ICE : S.WATER);
		}
		if (d.dying > 2.4) { for (const p of m.parts) for (const c of p.cells) if (c.alive) this.en.release(m, c, (rnd() - 0.5) * 80, -40 - rnd() * 60, true, c.role === CORE ? S.SHARD : S.WATER); this.en.kill(m, 'boss', true); this.en.ev('bossDead', m, m.x, m.y, { name: 'The Storm Leviathan' }); }
	}
	// ======================================================================= shared: waves, marks, bolts, boulders
	afterStamp(dt: number) {
		const m = this.boss, w = this.w; if (!m || m.dead) return;
		if (m.kind === 'titan') {
			if (m.data.dying > 0) { this.titanDie(m, dt); return; }
			for (const p of this.arms(m)) {
				if (!p.alive) continue; let wet = 0;
				for (let k = 0; k < p.cells.length; k += 3) { const c = p.cells[k]; if (!c.alive || c.wi < 0) continue; for (const j of [c.wi - 1, c.wi + 1, c.wi - w.W, c.wi + w.W]) { const t = w.type[j]; if (!w.body[j] && (t === S.WATER || t === S.SNOW || t === S.ICE)) { wet++; w.type[j] = S.STEAM; w.temp[j] = 120; w.wake(j % w.W, (j / w.W) | 0); this.stats.boiled++; } } }
				if (wet) p.heat = Math.max(0, p.heat - wet * 0.004);
			}
		} else if (m.data.dying > 0) this.leviDie(m, dt);
	}
	step(dt: number, hero: Hero) {
		const w = this.w;
		this.afterStamp(dt);
		for (let k = this.waves.length - 1; k >= 0; k--) {
			const v = this.waves[k]; v.life -= dt; const sp = v.kind === 'lava' ? 75 : 62; v.x += v.dir * sp * dt;
			const gy = this.groundAt(v.x, v.kind === 'surge' ? (this.boss?.data.sea ?? 300) - 40 : hero.y - 70);
			// the front: real matter thrown along the ground, and a blow to the hero if they're down there
			for (let q = 0; q < (v.kind === 'lava' ? 4 : 10); q++) w.spawnParticle(v.x + (rnd() - 0.5) * 3, gy - 1 - rnd() * 3, v.dir * (30 + rnd() * 40), -20 - rnd() * (v.kind === 'surge' ? 70 : 35), v.kind === 'lava' ? S.LAVA : S.WATER, v.kind === 'lava' ? 1500 : 15);
			if (!v.hit && Math.abs(hero.x - v.x) < 6 && hero.y > gy - (v.kind === 'surge' ? 56 : 30)) { if (this.en.hurtHero(hero, 16, v.x - v.dir * 10, v.kind)) v.hit = true; }
			if (v.life <= 0 || v.x < 4 || v.x > w.W - 4) this.waves.splice(k, 1);
		}
		for (let k = this.marks.length - 1; k >= 0; k--) {
			const mk = this.marks[k]; mk.t -= dt;
			if (mk.t <= 0 && !mk.done) {
				mk.done = true;
				if (mk.kind === 'geyser') {
					for (let q = 0; q < 70; q++) w.spawnParticle(mk.x + (rnd() - 0.5) * 4, mk.y - 2, (rnd() - 0.5) * 20, -60 - rnd() * 70, S.LAVA, 1500);
					if (Math.abs(hero.x - mk.x) < 7 && hero.y > mk.y - 70) this.en.hurtHero(hero, 16, mk.x, 'geyser');
					this.en.ev('geyser', null, mk.x, mk.y);
				} else {
					this.bolts.push({ x: mk.x, y0: mk.y0, y1: mk.y, t: 0.18 });
					if (Math.abs(hero.x - mk.x) < 7 && hero.y > mk.y0) this.en.hurtHero(hero, 22, mk.x, 'lightning'); // anywhere in the bolt's column
					for (const o of this.en.list) if (!o.boss && !o.dead) { const c = this.en.center(o); if (Math.abs(c.x - mk.x) < 10) this.en.hit(o, c.x, c.y, 40, 'lightning', 0, -1); }
					// struck ground: sand to glass, water to steam
					for (let yy = mk.y - 2; yy <= mk.y + 5; yy++) for (let xx = mk.x - 3; xx <= mk.x + 3; xx++) { if (!w.inb(xx, yy)) continue; const i = yy * w.W + xx; if (w.body[i]) continue; const t = w.type[i]; if (t === S.SAND) { w.type[i] = S.GLASS; w.temp[i] = 900; } else if (t === S.WATER) { w.type[i] = S.STEAM; w.temp[i] = 140; } else if (S.ST[t] === S.SOLID) w.temp[i] = Math.max(w.temp[i], 700); w.wake(xx, yy); }
					this.en.ev('bolt', null, mk.x, mk.y);
				}
			}
			if (mk.t < -0.4) this.marks.splice(k, 1);
		}
		for (let k = this.bolts.length - 1; k >= 0; k--) { this.bolts[k].t -= dt; if (this.bolts[k].t <= 0) this.bolts.splice(k, 1); }
		// boulders: they hurt the hero; thrown back with Grip they hurt a cooled limb or the frozen core
		const b = this.en.bodies;
		if (b) for (const body of b.list) {
			if (!this.boulders.has(body.id) && !body.thrown) continue;
			const v = body.rb.linvel(), sp = Math.hypot(v.x, v.y) * 10, p = body.rb.translation(), x = p.x * 10, y = p.y * 10;
			if (sp < 60) { if (this.boulders.has(body.id) && sp < 5 && body.age > 1) this.boulders.delete(body.id); continue; }
			if (this.boulders.has(body.id) && !body.held && Math.abs(hero.x - x) < 6 + Math.sqrt(body.n) * 0.5 && hero.y > y - 4 && hero.y - 17 < y + 4) { if (this.en.hurtHero(hero, 18, x, 'boulder')) this.boulders.delete(body.id); }
			const m = this.boss;
			if (m && !m.dead && body.thrown > 0 && m.kind === 'titan') {
				for (const part of [m.parts[2], m.parts[3], m.parts[0]]) {
					if (!part.alive) continue; const q = part === m.parts[0] ? { x: m.x, y: m.y - 31 } : this.en.worldOf(m, part, 0, 30);
					if (Math.hypot(q.x - x, q.y - y) < 14 + Math.sqrt(body.n) * 0.4) { this.titanHit(m, x, y, 30, 'thrown', Math.sign(v.x), 0); if (this.boulders.has(body.id)) this.en.ev('combo', m, x, y, { name: 'Throwback' }); body.thrown = 0; body.rb.setLinvel({ x: -v.x * 0.3, y: -v.y * 0.3 }, true); break; }
				}
			}
		}
	}
	draw(r: { glow: (...a: any[]) => void; cap: (...a: any[]) => void }, t: number) {
		const m = this.boss;
		for (const v of this.waves) { const gy = this.groundAt(v.x, (v.kind === 'surge' ? (m?.data.sea ?? 300) - 40 : (this.en.hero?.y ?? 200) - 70)); r.glow(v.x, gy - 4, 8, v.kind === 'lava' ? [6, 2.2, 0.5] : [0.6, 1.2, 1.8]); }
		for (const mk of this.marks) {
			if (mk.done) continue; const k = 1 - mk.t / 1.1;
			if (mk.kind === 'geyser') { r.glow(mk.x, mk.y - 1, 3 + 6 * k, [4 + 6 * k, 1.4 + 2 * k, 0.3]); r.cap(mk.x - 5, mk.y - 0.5, mk.x + 5, mk.y - 0.5, 0.4, 0.4, [0, 0, 0, 0], [5 * k, 2 * k, 0.4], false); }
			else { r.glow(mk.x, mk.y - 1, 3 + 5 * k, [1.5 * k, 2 * k, 4 * k]); r.cap(mk.x, mk.y0, mk.x, mk.y, 0.12 + 0.2 * k, 0.12, [0, 0, 0, 0], [0.4 * k, 0.6 * k, 1.2 * k], false); }
		}
		for (const b of this.bolts) {
			const k = b.t / 0.18; let px = b.x, py = b.y0; const n = 9;
			for (let q = 1; q <= n; q++) { const yy = b.y0 + (b.y1 - b.y0) * q / n, xx = b.x + (q < n ? (rnd() - 0.5) * 9 : 0); r.cap(px, py, xx, yy, 0.9 * k, 0.9 * k, [0, 0, 0, 0], [10 * k, 12 * k, 16 * k], false); px = xx; py = yy; }
			r.glow(b.x, b.y1, 14 * k, [6 * k, 7 * k, 10 * k]);
		}
		if (!m || m.dead) return;
		if (m.kind === 'titan') {
			const d = m.data;
			// eyes and core glow; the wind-up glows in the arm that will throw, or in both before a wave
			r.glow(m.x + m.parts[1].px, m.y - 61, 5, [6, 2.4, 0.6]);
			if (d.phase === 2) r.glow(m.x, m.y - 31, (d.coreFrozen > 0 ? 6 : 12) + Math.sin(t * 5) * 2, d.coreFrozen > 0 ? [0.8, 1.2, 2.2] : [9, 3.5, 0.8]);
			if (m.state === 'windThrow') { const p = m.parts[d.throwArm]; if (p.alive) { const hand = this.en.worldOf(m, p, 0, 54); const k = Math.min(1, m.stateT); r.glow(hand.x, hand.y, 5 + 8 * k, [8 * k, 3 * k, 0.6 * k]); } }
			if (m.state === 'windWave') { const k = Math.min(1, m.stateT / 1.2); r.glow(m.x, m.y - 2, 18 * k, [7 * k, 2.6 * k, 0.5 * k]); }
			if (m.state === 'windBreath') { const k = Math.min(1, m.stateT / 0.7); r.glow(m.x + m.parts[1].px, m.y - 55, 4 + 6 * k, [9 * k, 3.5 * k, 0.6 * k]); }
			if (m.state === 'windSwipe' && m.stateT < 0.65) { const p = m.parts[d.throwArm]; if (p.alive) { const q = this.en.worldOf(m, p, 0, 50); const k = m.stateT / 0.65; r.glow(q.x, q.y, 6 + 8 * k, [7 * k, 3 * k, 0.6 * k]); } }
			for (const p of this.arms(m)) if (p.alive && p.heat < 0.3) { const q = this.en.worldOf(m, p, 0, 30); r.glow(q.x, q.y, 12, [0.3, 0.5, 0.9]); }
		} else {
			const d = m.data;
			const segs = m.parts.map((p, k) => ({ x: m.x + (k === 0 ? 0 : p.px), y: m.y + p.py, alive: p.cells.some(c => c.alive) }));
			for (let k = 0; k < segs.length; k++) { const q = segs[k]; if (!q.alive) continue; const R = k === 0 ? 14 : 10.5 - k * 0.6; r.glow(q.x, q.y, R * 1.1, d.frozen > 0 ? [0.2, 0.4, 0.7] : [0.03, 0.12, 0.2]); }
			const R = (k: number) => k === 0 ? 11.5 : Math.max(1.6, 10.5 - k * 0.95);
			const edge = (k: number, side: number) => { const a = segs[Math.max(0, k - 1)], b = segs[Math.min(segs.length - 1, k + 1)]; let nx = -(b.y - a.y), ny = b.x - a.x; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; if (ny > 0) { nx = -nx; ny = -ny; } return { x: segs[k].x + nx * R(k) * side, y: segs[k].y + ny * R(k) * side }; };
			for (let k = 1; k < segs.length; k++) { if (!segs[k - 1].alive || !segs[k].alive) continue; const a = edge(k - 1, 1), b = edge(k, 1), c = edge(k - 1, -1), e = edge(k, -1); const wv = 0.6 - k * 0.04; r.cap(a.x, a.y, b.x, b.y, wv, wv, d.frozen > 0 ? [0.85, 0.95, 1, 0.9] : [0.9, 0.96, 1, 0.8], null, false); r.cap(c.x, c.y, e.x, e.y, wv * 0.8, wv * 0.8, [0.02, 0.07, 0.16, 0.55], null, false); }
			r.glow(m.x + m.face * 9.5, m.y - 5.5, 3.5, d.frozen > 0 ? [0.6, 1, 1.6] : [1.5, 3.5, 5]);
			for (const s2 of [-1, 1]) r.cap(m.x + m.face * 9.5, m.y - 5.5 + s2 * 0.01, m.x + m.face * 9.5, m.y - 5.5, 0.7, 0.7, [0.8, 1, 1, 1], d.frozen > 0 ? [1, 1.5, 2] : [3, 6, 8], true);
			if (d.phase >= 2) r.glow(m.x, m.y, 5 + Math.sin(t * 7) * 1, [1.6, 2.6, 4]);
			if (m.state === 'windSurge' || m.state === 'windBite') { const k = Math.min(1, m.stateT / (m.data.tellT || 1)); r.glow(m.x, m.y, 10 * k, [1.5 * k, 3 * k, 5 * k]); }
			if (d.frozen > 0) r.glow(m.x, m.y, 16, [0.5, 0.8, 1.4]);
		}
	}
}
// keep the imported role names referenced (used by the shapes above)
void SHELL; void regrid;
