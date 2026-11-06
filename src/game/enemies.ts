// Enemies made of matter. Every enemy is a set of simulated cells (rock, lava, ice, sand, glass...) carried on a frame:
// each tick its cells are lifted out of the world, the frame moves, and the cells are stamped back where the frame now
// is (what they cover is saved and put back, so a swimmer doesn't empty the sea). The renderer lights them like any
// other matter, the lance and blasts hit the very cells they touch, and when a cell breaks it goes back into the world
// as what it is: lava spills and burns, rock falls as rubble or rigid chunks, ice pings into shards, sand pours.
// Each kind has a counter power, so a fight is a puzzle, not spam:
//   Magma crawler  lava core in a rock shell. Hits crack the shell and spill real lava. Rime Burst sets it to
//                  obsidian; then any hit shatters it into chunks. The lance barely warms it.
//   Rock brute     basalt armour plates over a molten heart. Tear plates off with Grip or crack them with Meteor Drop
//                  (they become throwable debris); the heart can only be hurt once its plates are gone. Guards crawlers.
//   Frost wraith   a flying body of ice that shoots ice shards. Heat melts it to water and steam; leave it alone and it
//                  refreezes. Cold only feeds it.
//   Sand swarm     motes of sand that scatter when blasted and re-form from loose sand nearby; heat fuses a mote to
//                  glass, and glass shatters for good.
// Bosses (bosses.ts) use the same frames with more parts. Shared rules: hit-stop scaled to damage, directional
// knockback, clear tells (wind-up, flash, sound) before every attack.
import * as S from '../engine/sim';
import type { Renderer } from '../engine/render';
import type { Hero } from '../engine/hero';
import type { Bodies } from '../engine/bodies';

export type Kind = 'crawler' | 'brute' | 'wraith' | 'swarm' | 'titan' | 'leviathan';
export const ID0 = 50000; // world.body ids at or above this belong to enemies (rigid bodies count up from 1)
export const SHELL = 0, CORE = 1, PLATE = 2, EYE = 3, LIMB = 4, FLESH = 5;

export interface Cell { lx: number; ly: number; t: number; t0: number; role: number; plate: number; alive: boolean; temp: number; wi: number; part: number }
export interface Part {
	px: number; py: number; ang: number; flip: boolean; alive: boolean; cells: Cell[];
	gx0: number; gy0: number; gw: number; gh: number; grid: Int32Array; // local lookup for stamping by inverse mapping
	vx: number; vy: number; deadT: number; heat: number; glass: boolean; reforms: number; n0: number; data: Record<string, number>;
}
export interface Mob {
	id: number; kind: Kind; x: number; y: number; vx: number; vy: number; face: number;
	parts: Part[]; stamped: number[]; under: number[]; underT: number[];
	n0: number; hp: number; max: number; dead: boolean; grounded: boolean; phase: number; seed: number;
	state: string; stateT: number; cool: number; frost: number; frozen: number; hurt: number; hurtX: number; hurtY: number;
	held: boolean; thrown: number; launched: number; juggles: number; lastHit: string; lastHitT: number; hidden: boolean;
	r: number; mass: number; plates: { hp: number; alive: boolean; n: number; max: number }[]; data: Record<string, number>; boss: boolean;
	flee: number; tell: number; tellKind: string; dmgTaken: number;
}
export interface Shot { x: number; y: number; vx: number; vy: number; kind: 'lava' | 'ice' | 'bolt'; life: number; dmg: number; g: number; id?: number }
export interface Ev { type: string; x: number; y: number; kind?: string; v?: number; dx?: number; dy?: number; name?: string; mob?: Mob }

const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
const rnd = Math.random;
const solidOrPowder = (t: number) => { const s = S.ST[t]; return s === S.SOLID || s === S.POWDER; };

export function makePart(cells: Cell[], px = 0, py = 0, flip = true): Part {
	const p: Part = { px, py, ang: 0, flip, alive: true, cells, gx0: 0, gy0: 0, gw: 1, gh: 1, grid: new Int32Array(1), vx: 0, vy: 0, deadT: 0, heat: 1, glass: false, reforms: 0, n0: cells.length, data: {} };
	regrid(p); return p;
}
export function regrid(p: Part) {
	let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
	for (const c of p.cells) { if (c.lx < x0) x0 = c.lx; if (c.ly < y0) y0 = c.ly; if (c.lx > x1) x1 = c.lx; if (c.ly > y1) y1 = c.ly; }
	if (!p.cells.length) { x0 = y0 = x1 = y1 = 0; }
	p.gx0 = x0; p.gy0 = y0; p.gw = x1 - x0 + 1; p.gh = y1 - y0 + 1; p.grid = new Int32Array(p.gw * p.gh).fill(-1);
	p.cells.forEach((c, k) => { p.grid[(c.ly - y0) * p.gw + (c.lx - x0)] = k; });
}
export function cell(lx: number, ly: number, t: number, role: number, plate = -1, temp?: number): Cell {
	return { lx, ly, t, t0: t, role, plate, alive: true, temp: temp ?? S.SPAWNT[t], wi: -1, part: 0 };
}

// ---------------------------------------------------------------- shapes
function crawlerCells(seed: number): Cell[] {
	const out: Cell[] = [];
	for (let ly = -9; ly <= -2; ly++) for (let lx = -8; lx <= 8; lx++) {
		const u = lx / 8.4, v = (ly + 2) / 7.6; if (u * u + v * v > 1) continue;
		const core = Math.abs(lx) <= 4 && ly >= -6 && ly <= -3 && (lx * lx) / 20 + ((ly + 4.5) ** 2) / 3 <= 1;
		const crack = !core && ((lx + ly * 2 + Math.round(seed * 7)) % 7 === 0) && ly > -8 && Math.abs(lx) < 7;
		out.push(cell(lx, ly, core ? S.LAVA : crack ? S.LAVA : ly <= -8 ? S.OBSIDIAN : S.BASALT, core ? CORE : SHELL, -1, core || crack ? 1500 : 60));
	}
	out.push(cell(7, -4, S.EMBER, EYE, -1, 900), cell(8, -4, S.EMBER, EYE, -1, 900));
	return out;
}
function bruteCells(): Cell[] {
	const out: Cell[] = [];
	const inside = (lx: number, ly: number) => {
		if (ly >= -7) return (lx >= -8 && lx <= -3) || (lx >= 3 && lx <= 8); // legs
		if (ly >= -22) { const half = 9 + Math.round((ly + 22) * -0.12) + (ly < -18 ? 1 : 0); return Math.abs(lx) <= half + 1; } // torso, broad at the shoulders
		return Math.abs(lx) <= 4 && ly >= -28; // head
	};
	const has = (x: number, y: number) => inside(x, y);
	for (let ly = -28; ly <= -1; ly++) for (let lx = -12; lx <= 12; lx++) {
		if (!inside(lx, ly)) continue;
		const edge = !has(lx - 1, ly) || !has(lx + 1, ly) || !has(lx, ly - 1) || !has(lx - 2, ly) || !has(lx + 2, ly) || !has(lx, ly - 2) || !has(lx + 1, ly + 1) && ly < -7;
		const core = Math.abs(lx) <= 2 && ly >= -17 && ly <= -13;
		let plate = -1;
		if (edge || Math.abs(lx) >= 3 && ly < -7) {
			if (ly <= -23) plate = 0; // helm
			else if (ly <= -19) plate = lx < 0 ? 1 : 2; // shoulders
			else if (ly <= -12) plate = lx < 0 ? 3 : 4; // chest, covering the heart
			else if (ly <= -8) plate = 5; // belly
		}
		if (!core && Math.abs(lx) <= 3 && ly >= -18 && ly <= -12) plate = lx < 0 ? 3 : 4; // the chest plates close over the heart
		out.push(cell(lx, ly, core ? S.MOLTEN : plate >= 0 ? S.BASALT : S.STONE, core ? CORE : plate >= 0 ? PLATE : FLESH, plate, core ? 1600 : 40));
	}
	out.push(cell(2, -26, S.EMBER, EYE, -1, 900), cell(-1, -26, S.EMBER, EYE, -1, 900));
	return out;
}
function wraithCells(seed: number): Cell[] {
	const out: Cell[] = [];
	for (let ly = -9; ly <= 9; ly++) for (let lx = -7; lx <= 7; lx++) {
		let ok = false;
		if (ly <= -2) ok = lx * lx + (ly + 4) ** 2 <= 26; // hood
		else { const half = 6 - (ly + 2) * 0.35; ok = Math.abs(lx) <= half && !(ly > 4 && ((lx + Math.round(seed * 5) + ly) % 3 === 0)); } // body, ragged hem
		if (!ok) continue;
		const face = ly >= -6 && ly <= -2 && Math.abs(lx) <= 2;
		out.push(cell(lx, ly, face ? S.SNOW : S.FROST, face ? FLESH : SHELL, -1, -30));
	}
	return out;
}
function moteCells(seed: number): Cell[] {
	const out: Cell[] = [];
	for (let ly = -2; ly <= 2; ly++) for (let lx = -2; lx <= 2; lx++) { if (lx * lx + ly * ly > 5.2 + ((seed * 13 + lx * 3 + ly) % 2)) continue; out.push(cell(lx, ly, S.GRIT, SHELL)); }
	return out;
}

export class Enemies {
	list: Mob[] = []; killed = 0; spawned = 0; events: Ev[] = []; shots: Shot[] = [];
	owner = new Map<number, [Mob, Cell]>(); nextId = ID0; bodies: Bodies | null = null; hero: Hero | null = null;
	difficulty = 1; // scales damage to the hero
	leash: { x0: number; x1: number; ground: Int32Array } | null = null; // Arena: walkers keep to the fighting ground
	stats = { shattered: 0, platesTorn: 0, platesCracked: 0, melted: 0, refrozen: 0, fused: 0, scattered: 0, reformed: 0, spilled: 0, frozen: 0, heartHits: 0, blockedHeart: 0 };
	constructor(public w: S.World) {}
	newMob(kind: Kind, x: number, y: number, parts: Part[], hp: number): Mob {
		const n0 = parts.reduce((s, p) => s + p.cells.length, 0);
		parts.forEach((p, k) => p.cells.forEach(c => { c.part = k; }));
		const m: Mob = {
			id: this.nextId++, kind, x, y, vx: 0, vy: 0, face: -1, parts, stamped: [], under: [], underT: [], n0, hp, max: hp, dead: false, grounded: false,
			phase: rnd() * 6, seed: rnd(), state: 'move', stateT: 0, cool: 1 + rnd() * 2, frost: 0, frozen: 0, hurt: 0, hurtX: 0, hurtY: 0, held: false, thrown: 0,
			launched: 0, juggles: 0, lastHit: '', lastHitT: 0, hidden: false, r: 8, mass: 1, plates: [], data: {}, boss: false, flee: 0, tell: 0, tellKind: '', dmgTaken: 0,
		};
		if (this.nextId > 65000) this.nextId = ID0;
		this.list.push(m); this.spawned++;
		return m;
	}
	spawn(kind: Kind | 'moth', x: number, y: number): Mob {
		const seed = rnd();
		if (kind === 'crawler' || kind === 'moth') { const m = this.newMob('crawler', x, y, [makePart(crawlerCells(seed))], 1); m.r = 8; m.mass = 1; m.cool = 1.5 + rnd() * 2; return m; }
		if (kind === 'brute') {
			const m = this.newMob('brute', x, y, [makePart(bruteCells())], 1); m.r = 14; m.mass = 5;
			for (let k = 0; k < 6; k++) { const n = m.parts[0].cells.filter(c => c.plate === k).length; m.plates.push({ hp: 60, alive: true, n, max: 60 }); }
			m.cool = 2.5; return m;
		}
		if (kind === 'wraith') { const m = this.newMob('wraith', x, y, [makePart(wraithCells(seed))], 1); m.r = 9; m.mass = 0.8; m.cool = 2 + rnd() * 2; m.data.lastHeat = -9; return m; }
		// a sand swarm: eight motes flocking round one centre
		const parts: Part[] = []; for (let k = 0; k < 8; k++) { const p = makePart(moteCells(rnd() * 9), (rnd() - 0.5) * 30, (rnd() - 0.5) * 18); p.reforms = 3; p.data.ang = k / 8 * Math.PI * 2; parts.push(p); }
		const m = this.newMob('swarm', x, y, parts, 1); m.r = 22; m.mass = 0.3; m.cool = 2; return m;
	}
	alive() { return this.list.filter(e => !e.dead).length; }
	cellsAlive(m: Mob) { let n = 0; for (const p of m.parts) for (const c of p.cells) if (c.alive) n++; return n; }
	// where to aim at it: the middle of what's left of it
	aimPoint(m: Mob) { let x = 0, y = 0, n = 0; for (const p of m.parts) for (const c of p.cells) if (c.alive) { const q = c.wi >= 0 ? { x: c.wi % this.w.W + 0.5, y: ((c.wi / this.w.W) | 0) + 0.5 } : this.worldOf(m, p, c.lx, c.ly); x += q.x; y += q.y; n++; } return n ? { x: x / n, y: y / n } : this.center(m); }
	center(m: Mob) { if (m.kind === 'crawler') return { x: m.x, y: m.y - 5 }; if (m.kind === 'brute') return { x: m.x, y: m.y - 14 }; return { x: m.x, y: m.y }; }
	// ---------------------------------------------------------------- world <-> cells
	worldOf(m: Mob, p: Part, lx: number, ly: number) {
		const fx = p.flip ? (m.face < 0 ? -1 : 1) : 1; // shapes are drawn facing +x and mirrored to face -x
		const c = Math.cos(p.ang), s = Math.sin(p.ang);
		const rx = lx * c - ly * s, ry = lx * s + ly * c;
		return { x: m.x + p.px * fx + rx * fx, y: m.y + p.py + ry };
	}
	erase(m: Mob) {
		const w = this.w;
		for (let k = 0; k < m.stamped.length; k++) { const i = m.stamped[k]; if (w.body[i] === m.id) { w.type[i] = m.under[k]; w.temp[i] = m.underT[k]; w.body[i] = 0; } }
		m.stamped.length = 0; m.under.length = 0; m.underT.length = 0;
		for (const p of m.parts) for (const c of p.cells) c.wi = -1;
	}
	stamp(m: Mob) {
		if (m.hidden || m.dead) return;
		const w = this.w, W = w.W;
		for (const p of m.parts) {
			if (!p.alive) continue;
			const fx = p.flip ? (m.face < 0 ? -1 : 1) : 1, c = Math.cos(p.ang), s = Math.sin(p.ang);
			const ox = m.x + p.px * fx, oy = m.y + p.py;
			const R = Math.hypot(Math.max(-p.gx0, p.gx0 + p.gw), Math.max(-p.gy0, p.gy0 + p.gh)) + 1;
			const x0 = Math.max(0, Math.floor(ox - R)), x1 = Math.min(W - 1, Math.ceil(ox + R)), y0 = Math.max(0, Math.floor(oy - R)), y1 = Math.min(w.H - 1, Math.ceil(oy + R));
			for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
				const dx = (x + 0.5 - ox) * fx, dy = y + 0.5 - oy;
				const lx = Math.round(dx * c + dy * s - 0.5), ly = Math.round(-dx * s + dy * c - 0.5);
				const gx = lx - p.gx0, gy = ly - p.gy0; if (gx < 0 || gy < 0 || gx >= p.gw || gy >= p.gh) continue;
				const k = p.grid[gy * p.gw + gx]; if (k < 0) continue;
				const ce = p.cells[k]; if (!ce.alive || ce.wi >= 0) continue;
				const i = y * W + x, t = w.type[i];
				if (w.body[i]) continue;
				const st = S.ST[t];
				if (st === S.SOLID && t !== S.AIR) continue; // terrain wins (a burrower, or a mob pressed into a wall)
				m.stamped.push(i); m.under.push(st === S.GAS && t !== S.CLOUD ? S.AIR : t); m.underT.push(w.temp[i]);
				w.type[i] = ce.t; w.temp[i] = ce.temp; w.body[i] = m.id; ce.wi = i; this.owner.set(i, [m, ce]);
			}
		}
	}
	mobCell(i: number): [Mob, Cell] | null { const id = this.w.body[i]; if (id < ID0) return null; const o = this.owner.get(i); return o && o[0].id === id && o[1].alive ? o : null; }
	// enemies whose cells are within r of (x, y)
	at(x: number, y: number, r: number): Mob[] {
		const w = this.w, out = new Set<Mob>(); const R = Math.ceil(r);
		for (let yy = Math.floor(y) - R; yy <= Math.floor(y) + R; yy++) for (let xx = Math.floor(x) - R; xx <= Math.floor(x) + R; xx++) {
			if (!w.inb(xx, yy) || (xx - x) ** 2 + (yy - y) ** 2 > r * r) continue; const o = this.mobCell(yy * w.W + xx); if (o) out.add(o[0]);
		}
		return [...out];
	}
	// release a cell into the world: as a flying particle of its own matter, or left in place as plain terrain
	release(m: Mob, c: Cell, vx: number, vy: number, asParticle = true, t?: number) {
		if (!c.alive) return; c.alive = false;
		const w = this.w;
		if (c.wi >= 0 && w.body[c.wi] === m.id) {
			const i = c.wi, k = m.stamped.indexOf(i);
			const tt = t ?? c.t, under = k >= 0 ? m.under[k] : S.AIR, underT = k >= 0 ? m.underT[k] : S.AMB;
			if (k >= 0) { m.stamped.splice(k, 1); m.under.splice(k, 1); m.underT.splice(k, 1); }
			w.body[i] = 0;
			const x = i % w.W, y = (i / w.W) | 0;
			if (!asParticle) { w.type[i] = tt; w.temp[i] = c.temp; }
			else {
				// what the mob was covering comes back (a swimmer's sea stays full); its own matter flies off as a particle
				w.type[i] = under; w.temp[i] = underT;
				if (S.ST[tt] === S.GAS) { let yy = y; while (yy > 1 && w.type[yy * w.W + x] !== S.AIR) yy--; if (y - yy < 24) { w.type[yy * w.W + x] = tt; w.temp[yy * w.W + x] = c.temp; w.life[yy * w.W + x] = S.LIFE0[tt] + 60; w.wake(x, yy); } }
				else if (tt !== S.AIR) w.spawnParticle(x + 0.5, y + 0.5, vx, vy, tt, c.temp);
			}
			w.wake(x, y);
		} else if (asParticle && (t ?? c.t) !== S.AIR) {
			const p = m.parts[c.part], q = this.worldOf(m, p, c.lx, c.ly);
			w.spawnParticle(q.x, q.y, vx, vy, t ?? c.t, c.temp);
		}
		c.wi = -1;
	}
	// cells of a mob become rigid chunks (frozen crawlers, torn plates, boss limbs): returns the bodies made
	chunk(m: Mob, cells: Cell[], vel: { x: number; y: number }, pieces = 1) {
		const w = this.w, b = this.bodies; if (!b) { for (const c of cells) this.release(m, c, vel.x, vel.y); return []; }
		const groups: number[][] = []; const live = cells.filter(c => c.alive && c.wi >= 0);
		if (!live.length) { for (const c of cells) this.release(m, c, vel.x, vel.y); return []; }
		// split by angle around the centroid so chunks are irregular wedges
		let cx = 0, cy = 0; for (const c of live) { cx += c.wi % w.W; cy += (c.wi / w.W) | 0; } cx /= live.length; cy /= live.length;
		const off = rnd() * Math.PI * 2;
		for (let k = 0; k < pieces; k++) groups.push([]);
		for (const c of live) { const a = (Math.atan2(((c.wi / w.W) | 0) - cy, (c.wi % w.W) - cx) + off + Math.PI * 4) % (Math.PI * 2); groups[Math.min(pieces - 1, Math.floor(a / (Math.PI * 2) * pieces))].push(c.wi); }
		for (const c of live) { const i = c.wi; const k = m.stamped.indexOf(i); if (k >= 0) { m.stamped.splice(k, 1); m.under.splice(k, 1); m.underT.splice(k, 1); } w.body[i] = 0; w.type[i] = c.t; w.temp[i] = c.temp; c.alive = false; c.wi = -1; }
		for (const c of cells) if (c.alive) this.release(m, c, vel.x, vel.y);
		const out: import('../engine/bodies').Body[] = [];
		for (const g of groups) {
			if (g.length < 6) { for (const i of g) w.eject(i % w.W, (i / w.W) | 0, vel.x + (rnd() - 0.5) * 30, vel.y - rnd() * 20); continue; }
			let gx = 0, gy = 0; for (const i of g) { gx += i % w.W; gy += (i / w.W) | 0; } gx /= g.length; gy /= g.length;
			const dx = gx - cx, dy = gy - cy, l = Math.hypot(dx, dy) || 1;
			const body = b.makeBody(g, { x: (vel.x + dx / l * 6) / 10, y: (vel.y + dy / l * 6 - 4) / 10 }, (rnd() - 0.5) * 6); body.thrown = 0; out.push(body);
		}
		w.structuralDirty = true;
		return out;
	}
	// ---------------------------------------------------------------- damage
	hitStop(dmg: number) { return Math.min(0.12, 0.015 + dmg * 0.0016); }
	ev(type: string, m: Mob | null, x: number, y: number, extra: Partial<Ev> = {}) { this.events.push({ type, x, y, kind: m?.kind, mob: m ?? undefined, ...extra }); }
	knock(m: Mob, dx: number, dy: number, k: number) {
		if (m.boss) return; const l = Math.hypot(dx, dy) || 1; const f = k / m.mass;
		m.vx += dx / l * f; m.vy += dy / l * f - (m.grounded ? f * 0.3 : 0);
		if (m.vy < -10 && m.kind !== 'wraith') { m.launched = 1.2; m.grounded = false; }
	}
	// generic damage from a power: amount at a point (x, y), direction of the blow, and what did it
	hit(m: Mob, x: number, y: number, amount: number, kind: string, dx = 0, dy = 0) {
		if (m.dead || amount <= 0) return;
		m.lastHit = kind; m.lastHitT = 0; m.hurt = 0.12; m.hurtX = x; m.hurtY = y; m.dmgTaken += amount;
		const frozen = m.frozen > 0;
		this.ev('hit', m, x, y, { v: amount, dx, dy, name: kind });
		if (m.kind === 'crawler') {
			if (frozen && amount > 4) { this.shatterFrozen(m, dx, dy, kind); return; }
			// the shell cracks where it's hit; once the core shows, hits spill its lava
			const c0 = this.center(m); const n = Math.ceil(amount / 6);
			const cells = m.parts[0].cells.filter(c => c.alive).sort((a, b) => this.dist2(m, a, x, y) - this.dist2(m, b, x, y));
			let broke = 0;
			for (const c of cells) {
				if (broke >= n) break;
				const out = { x: (c0.x - x), y: (c0.y - y) }; const ol = Math.hypot(out.x, out.y) || 1;
				if (c.role === CORE) { this.release(m, c, -out.x / ol * 30 + dx * 20 + (rnd() - 0.5) * 20, -out.y / ol * 20 - 25 + dy * 10); this.stats.spilled++; broke++; }
				else if (c.role === SHELL || c.role === EYE) { this.release(m, c, dx * 25 + (rnd() - 0.5) * 30, -15 - rnd() * 20, true, c.t === S.LAVA ? S.LAVA : S.RUBBLE); broke++; }
			}
			if (amount > 20) { let q = Math.min(6, Math.floor(amount / 12)); for (const c of m.parts[0].cells) { if (q <= 0) break; if (c.alive && c.role === CORE) { this.release(m, c, dx * 30 + (rnd() - 0.5) * 40, -25 - rnd() * 25); this.stats.spilled++; q--; } } }
			this.knock(m, dx || Math.sign(m.x - x), dy - 0.3, amount * 0.8);
			const core = m.parts[0].cells.filter(c => c.role === CORE), left = core.filter(c => c.alive).length;
			if (left <= core.length * 0.35 || this.cellsAlive(m) < m.n0 * 0.3) this.kill(m, kind);
			return;
		}
		if (m.kind === 'brute') {
			// plates take blows first; the heart only once the chest plates are gone
			const near = m.parts[0].cells.filter(c => c.alive).sort((a, b) => this.dist2(m, a, x, y) - this.dist2(m, b, x, y))[0];
			const heartOpen = !m.plates[3].alive && !m.plates[4].alive, heart = { x: m.x, y: m.y - 15 };
			const atHeart = heartOpen && (Math.hypot(x - heart.x, y - heart.y) < 14 || m.plates.every(p => !p.alive)); // with the chest open, a blow near the heart lands on it (anywhere, once it has no armour left)
			if (!atHeart && near && near.role === PLATE && m.plates[near.plate].alive) {
				const pl = m.plates[near.plate]; pl.hp -= amount * (kind === 'slam' ? 3 : kind === 'heat' ? 0.15 : 0.6);
				this.knock(m, dx, dy, amount * 0.25);
				if (pl.hp <= 0) this.detachPlate(m, near.plate, dx * 20, -20, false);
				else if (kind !== 'heat') this.ev('clank', m, x, y);
				return;
			}
			if (heartOpen) {
				m.hp -= amount / 120; this.stats.heartHits++;
				for (const c of m.parts[0].cells) if (c.alive && c.role === CORE && rnd() < amount / 200) this.release(m, c, dx * 20 + (rnd() - 0.5) * 20, -20);
				this.knock(m, dx, dy, amount * 0.4);
				if (m.hp <= 0) this.kill(m, kind);
			} else { this.stats.blockedHeart++; this.ev('clank', m, x, y); }
			return;
		}
		if (m.kind === 'wraith') {
			// blows chip ice into shards
			const n = Math.ceil(amount / 5);
			const cells = m.parts[0].cells.filter(c => c.alive).sort((a, b) => this.dist2(m, a, x, y) - this.dist2(m, b, x, y));
			for (let k = 0; k < Math.min(n, cells.length); k++) this.release(m, cells[k], dx * 30 + (rnd() - 0.5) * 40, -10 - rnd() * 30, true, rnd() < 0.5 ? S.SHARD : S.ICE);
			this.knock(m, dx, dy, amount * 1.2);
			if (this.cellsAlive(m) < m.n0 * 0.42) this.kill(m, kind);
			return;
		}
		if (m.kind === 'swarm') {
			// the mote nearest the blow scatters (glass ones shatter for good)
			let best: Part | null = null, bd = 1e9;
			for (const p of m.parts) { if (!p.alive) continue; const q = this.worldOf(m, p, 0, 0); const d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
			if (best && bd < 16 * 16) this.scatter(m, best, x, y, amount, kind);
			return;
		}
		if (m.boss) this.bossHit?.(m, x, y, amount, kind, dx, dy);
	}
	bossHit: ((m: Mob, x: number, y: number, amount: number, kind: string, dx: number, dy: number) => void) | null = null;
	bossHeat: ((m: Mob, c: Cell, amount: number) => void) | null = null;
	bossCold: ((m: Mob, c: Cell, amount: number) => void) | null = null;
	dist2(m: Mob, c: Cell, x: number, y: number) { if (c.wi >= 0) { const cx = c.wi % this.w.W, cy = (c.wi / this.w.W) | 0; return (cx - x) ** 2 + (cy - y) ** 2; } const q = this.worldOf(m, m.parts[c.part], c.lx, c.ly); return (q.x - x) ** 2 + (q.y - y) ** 2; }
	damage(m: Mob, amount: number, kind: string) { const c = this.center(m); this.hit(m, c.x, c.y, amount, kind, 0, -1); } // old API
	// heat on one cell (the lance, lava): melts ice, fuses sand, warms rock
	heatCell(i: number, amount: number, dx: number, dy: number) {
		const o = this.mobCell(i); if (!o) return false; const [m, c] = o;
		m.data.lastHeat = 0;
		if (m.boss) { this.bossHeat?.(m, c, amount); return true; }
		if (m.frozen > 0 && m.kind !== 'wraith') { this.steamBomb(m, i); return true; }
		if (m.kind === 'wraith') {
			c.temp += amount * 0.08;
			// the hit cell and its neighbours thaw: water, or steam if it's hot enough
			const p = m.parts[0];
			for (const cc of p.cells) { if (!cc.alive) continue; const d2 = this.dist2(m, cc, i % this.w.W, (i / this.w.W) | 0); if (d2 > 5) continue; cc.temp += amount * 0.05; if (cc.temp > 0) { this.release(m, cc, dx * 10 + (rnd() - 0.5) * 10, rnd() * 5, true, cc.temp > 40 ? S.STEAM : S.WATER); this.stats.melted++; } }
			if (rnd() < 0.3) this.ev('melt', m, i % this.w.W, (i / this.w.W) | 0);
			m.hurt = 0.08;
			if (this.cellsAlive(m) < m.n0 * 0.42) this.kill(m, 'heat'); // too thin to hold together
			return true;
		}
		if (m.kind === 'swarm') {
			const p = m.parts[c.part]; if (p.glass) return true;
			p.heat += amount * 0.004;
			if (p.heat > 2.2) { p.glass = true; for (const cc of p.cells) if (cc.alive) { cc.t = S.GLASS; cc.temp = 300; } p.reforms = 0; this.stats.fused++; this.ev('fuse', m, i % this.w.W, (i / this.w.W) | 0); }
			return true;
		}
		if (m.kind === 'crawler') { // lava doesn't mind heat: it just glows and is pushed back a little
			m.vx += dx * 0.8; if (rnd() < 0.05) this.ev('shrug', m, i % this.w.W, (i / this.w.W) | 0);
			if (m.launched > 0) this.juggle(m, dx); return true;
		}
		if (m.kind === 'brute') { this.hit(m, i % this.w.W, (i / this.w.W) | 0, amount * 0.02, 'heat', dx, dy); return true; }
		return true;
	}
	// a frozen enemy hit by the lance: the ice flashes to steam and it blows apart
	steamBomb(m: Mob, i: number) {
		const x = i % this.w.W, y = (i / this.w.W) | 0;
		this.ev('combo', m, x, y, { name: 'Steam Bomb' });
		for (const p of m.parts) for (const c of p.cells) if (c.alive) { const q = c.wi >= 0 ? { x: c.wi % this.w.W, y: (c.wi / this.w.W) | 0 } : this.worldOf(m, p, c.lx, c.ly); const a = Math.atan2(q.y - y, q.x - x); this.release(m, c, Math.cos(a) * (40 + rnd() * 50), Math.sin(a) * (40 + rnd() * 50) - 20, true, rnd() < 0.5 ? S.STEAM : c.t); }
		this.w.explode(x, y, 9, 0.9, false);
		for (const o of this.list) if (o !== m && !o.dead) { const c = this.center(o); const d = Math.hypot(c.x - x, c.y - y); if (d < 30) this.hit(o, c.x, c.y, 40 * (1 - d / 30), 'steam', Math.sign(c.x - x), -0.5); }
		this.kill(m, 'steam', true);
	}
	juggle(m: Mob, dx: number) { m.vy = Math.min(m.vy, -14); m.vx += dx * 2; m.launched = Math.max(m.launched, 0.5); m.juggles++; if (m.juggles === 12) this.ev('combo', m, m.x, m.y, { name: 'Juggle' }); }
	coldCell(i: number, amount: number) {
		const o = this.mobCell(i); if (!o) return false; const [m, c] = o;
		if (m.boss) { this.bossCold?.(m, c, amount); return true; }
		if (m.kind === 'wraith') { m.data.lastHeat = Math.min(m.data.lastHeat, 0); m.data.fed = (m.data.fed || 0) + amount; if (rnd() < 0.02) this.ev('shrug', m, m.x, m.y); return true; } // cold only feeds it
		if (m.kind === 'swarm') { const p = m.parts[c.part]; p.heat = Math.max(0, p.heat - amount * 0.01); return true; }
		m.data.chill = (m.data.chill ?? 0) + amount; // applied once a tick, so it takes the same time however many rays land
		return true;
	}
	freeze(m: Mob) {
		m.frozen = m.kind === 'brute' ? 3 : 5; m.frost = 0; this.stats.frozen++; m.data.frozeAt = 0;
		for (const p of m.parts) for (const c of p.cells) if (c.alive) { c.t = c.t === S.LAVA || c.t === S.MOLTEN ? S.OBSIDIAN : c.t === S.EMBER ? S.ICE : c.t; c.temp = -10; }
		this.ev('freeze', m, m.x, m.y - 5);
	}
	thaw(m: Mob) { for (const p of m.parts) for (const c of p.cells) if (c.alive) { c.t = c.t0; c.temp = c.t0 === S.LAVA ? 1500 : c.t0 === S.MOLTEN ? 1600 : c.t0 === S.EMBER ? 900 : 40; } this.ev('thaw', m, m.x, m.y - 5); }
	shatterFrozen(m: Mob, dx: number, dy: number, kind: string) {
		this.stats.shattered++;
		const all = m.parts.flatMap(p => p.cells.filter(c => c.alive));
		this.chunk(m, all, { x: dx * 30, y: dy * 20 - 15 }, 3);
		this.kill(m, kind, true);
		this.ev('shatter', m, m.x, m.y - 5, { name: kind });
		if (kind === 'slam') this.ev('combo', m, m.x, m.y - 5, { name: 'Shatterfall' });
	}
	detachPlate(m: Mob, k: number, vx: number, vy: number, torn: boolean) {
		const pl = m.plates[k]; if (!pl.alive) return null; pl.alive = false;
		if (torn) this.stats.platesTorn++; else this.stats.platesCracked++;
		const cells = m.parts[0].cells.filter(c => c.alive && c.plate === k);
		const bodies = this.chunk(m, cells, { x: vx, y: vy }, torn ? 1 : 2);
		this.ev(torn ? 'plateTorn' : 'plateCrack', m, m.x, m.y - 14);
		if (!m.plates[3].alive && !m.plates[4].alive) this.ev('heartOpen', m, m.x, m.y - 14);
		return bodies[0] ?? null;
	}
	scatter(m: Mob, p: Part, x: number, y: number, amount: number, kind: string) {
		const q = this.worldOf(m, p, 0, 0), a0 = Math.atan2(q.y - y, q.x - x);
		const glass = p.glass;
		for (const c of p.cells) if (c.alive) { const a = a0 + (rnd() - 0.5) * 2.4; const sp = 8 + rnd() * 26 + amount * 0.15; this.release(m, c, Math.cos(a) * sp, Math.sin(a) * sp - 10, true, glass ? S.SHARD : S.SAND); }
		p.alive = false; p.deadT = 0; p.heat = 0;
		if (glass) { p.reforms = 0; this.ev('shatter', m, q.x, q.y, { name: 'glass' }); } else { this.stats.scattered++; this.ev('scatter', m, q.x, q.y, { name: kind }); }
		if (kind === 'dash') { m.data.dashScatter = (m.data.dashScatter || 0) + 1; if (m.data.dashScatter >= 3) { m.data.dashScatter = -99; this.ev('combo', m, q.x, q.y, { name: 'Sandstorm' }); } }
		if (m.parts.every(pp => !pp.alive && pp.reforms <= 0)) this.kill(m, kind);
	}
	kill(m: Mob, kind: string, quiet = false) {
		if (m.dead) return;
		m.dead = true; this.killed++;
		const c0 = this.center(m);
		if (!quiet) {
			// burst into matter, the way its material breaks
			for (const p of m.parts) for (const c of p.cells) {
				if (!c.alive) continue;
				const q = c.wi >= 0 ? { x: c.wi % this.w.W, y: (c.wi / this.w.W) | 0 } : this.worldOf(m, p, c.lx, c.ly);
				const a = Math.atan2(q.y - c0.y, q.x - c0.x) + (rnd() - 0.5) * 1.4, sp = 20 + rnd() * 45; // scattered angles: no column of cells flies (and falls) in a straight line
				let t = c.t;
				if (m.kind === 'crawler') t = c.t === S.LAVA ? S.LAVA : rnd() < 0.7 ? S.RUBBLE : c.t;
				else if (m.kind === 'wraith') t = rnd() < 0.5 ? S.SHARD : S.ICE;
				else if (m.kind === 'swarm') t = p.glass ? S.SHARD : S.SAND;
				else if (m.kind === 'brute') t = c.role === CORE ? S.MOLTEN : rnd() < 0.6 ? S.RUBBLE : c.t;
				this.release(m, c, Math.cos(a) * sp + (rnd() - 0.5) * 24, Math.sin(a) * sp - 20, true, t);
			}
		}
		this.erase(m);
		this.ev('die', m, c0.x, c0.y, { name: kind });
	}
	// ---------------------------------------------------------------- area effects from powers
	blastKind: string | null = null; // a Meteor Drop's crater counts as the slam
	blast(x: number, y: number, r: number, power: number) {
		const bk = this.blastKind ?? 'blast';
		for (const m of this.list) {
			if (m.dead) continue;
			if (m.kind === 'swarm') { for (const p of m.parts) { if (!p.alive) continue; const q = this.worldOf(m, p, 0, 0); const d = Math.hypot(q.x - x, q.y - y); if (d < r * 1.7) this.scatter(m, p, x, y, 60 * power, 'blast'); } continue; }
			if (m.boss) { this.hit(m, x, y, 50 * power * Math.min(1.4, r / 12), 'blast', 0, -1); continue; }
			const c = this.center(m); const d = Math.max(0, Math.hypot(c.x - x, c.y - y) - m.r * 0.6); if (d > r * 1.6) continue;
			const k = 1 - d / (r * 1.6);
			this.hit(m, x + (c.x - x) * 0.7, y + (c.y - y) * 0.7, 70 * power * k, bk, Math.sign(c.x - x) || 1, (c.y - y) / (Math.hypot(c.x - x, c.y - y) || 1) - 0.6);
			if (!m.dead) { this.knock(m, c.x - x, c.y - y - 6, 34 * k * power); if (m.vy < -8) m.launched = 1.5; }
		}
	}
	slam(x: number, y: number, R: number, k: number) {
		for (const m of this.list) {
			if (m.dead) continue;
			if (m.boss) { this.hit(m, x, y - 6, 55 * k, 'slam', 0, -1); continue; }
			const c = this.center(m); const d = Math.hypot(c.x - x, c.y - y); if (d > R + m.r) continue;
			const f = 1 - Math.max(0, d - m.r) / R;
			if (m.kind === 'brute') { // the shockwave cracks the nearest plate (or two, close in)
				const alive = m.plates.map((p, i) => ({ p, i })).filter(o => o.p.alive);
				alive.sort((a, b) => (a.i === 5 ? -1 : 0) - (b.i === 5 ? -1 : 0));
				const n = f > 0.6 ? 2 : 1; for (let q = 0; q < Math.min(n, alive.length); q++) this.detachPlate(m, alive[q].i, Math.sign(c.x - x) * 30, -35, false);
				if (!alive.length) this.hit(m, c.x, c.y, 60 * f * k, 'slam', Math.sign(c.x - x), -1);
				this.knock(m, c.x - x, -10, 20 * f); continue;
			}
			this.hit(m, c.x, c.y, 60 * f * k, 'slam', Math.sign(c.x - x) || 1, -1);
			if (!m.dead) this.knock(m, c.x - x, -12, 40 * f);
		}
	}
	// the dash passes through: sand scatters, others take a hit
	dashThrough(x: number, y: number, dx: number, dy: number) {
		for (const m of this.list) {
			if (m.dead) continue;
			if (m.kind === 'swarm') { for (const p of m.parts) { if (!p.alive) continue; const q = this.worldOf(m, p, 0, 0); if (Math.hypot(q.x - x, q.y - y) < 10) this.scatter(m, p, x - dx * 4, y - dy * 4, 40, 'dash'); } continue; }
			if (m.data.dashHitT > 0) continue;
			if (m.boss) { if (this.at(x, y, 7).includes(m)) { m.data.dashHitT = 0.3; this.hit(m, x, y, 30, 'dash', dx, dy); } continue; }
			const c = this.center(m); if (Math.hypot(c.x - x, c.y - y) > m.r + 6) continue;
			m.data.dashHitT = 0.3; this.hit(m, c.x, c.y, 30, 'dash', dx, dy - 0.3);
		}
	}
	// Grip on an enemy: brute plates tear off; anything small (or frozen) is picked up whole
	gripAt(x: number, y: number, r: number): { plate: any } | { mob: Mob } | { slip: true } | null {
		const bg = this.bossGrip?.(x, y, r); if (bg === 'slip') return { slip: true }; if (bg) return { plate: bg };
		let best: Mob | null = null, bd = 1e9;
		for (const m of this.list) { if (m.dead || m.boss) continue; const c = this.center(m); const d = Math.hypot(c.x - x, c.y - y) - m.r; if (d < r * 0.6 && d < bd) { bd = d; best = m; } }
		if (!best) return null;
		if (best.kind === 'brute') {
			// the plate with most cells inside the circle
			let pk = -1, pn = 0;
			for (let k = 0; k < 6; k++) { if (!best.plates[k].alive) continue; let n = 0; for (const c of best.parts[0].cells) if (c.alive && c.plate === k && this.dist2(best, c, x, y) < r * r) n++; if (n > pn) { pn = n; pk = k; } }
			if (pk < 0) return best.frozen > 0 || best.plates.every(p => !p.alive) ? { mob: best } : null;
			const body = this.detachPlate(best, pk, 0, 0, true);
			return body ? { plate: body } : null;
		}
		if (best.kind === 'swarm') return null;
		return { mob: best };
	}
	// ---------------------------------------------------------------- hero damage
	hurtHero(hero: Hero, dmg: number, fromX: number, kind: string) {
		if (hero.invuln > 0 || hero.dashT > 0) return false;
		hero.health -= dmg * this.difficulty; hero.invuln = 0.55;
		hero.knock(Math.sign(hero.x - fromX || 1) * (8 + dmg * 0.5), -6 - dmg * 0.3);
		this.ev('hurtHero', null, hero.x, hero.y - 8, { v: dmg, name: kind });
		return true;
	}
	shoot(x: number, y: number, vx: number, vy: number, kind: Shot['kind'], dmg: number) { this.shots.push({ x, y, vx, vy, kind, life: 3, dmg, g: kind === 'lava' ? 60 : kind === 'ice' ? 8 : 0, id: this.shotId++ } as Shot); }
	shotId = 0;
	stepShots(dt: number, hero: Hero) {
		const w = this.w;
		for (let k = this.shots.length - 1; k >= 0; k--) {
			const s = this.shots[k]; s.life -= dt; s.vy += s.g * dt;
			const n = Math.max(1, Math.ceil(Math.hypot(s.vx, s.vy) * dt / 0.8)); let gone = s.life <= 0;
			for (let q = 0; q < n && !gone; q++) {
				s.x += s.vx * dt / n; s.y += s.vy * dt / n;
				if (Math.abs(s.x - hero.x) < 3 && s.y > hero.y - 17 && s.y < hero.y) { this.hurtHero(hero, s.dmg, s.x - s.vx * 0.05, s.kind); gone = true; break; }
				const t = w.get(Math.floor(s.x), Math.floor(s.y)); if (w.body[Math.floor(s.y) * w.W + Math.floor(s.x)] >= ID0) continue;
				if (solidOrPowder(t) || S.ST[t] === S.LIQUID) gone = true;
			}
			if (gone) {
				if (s.kind === 'lava') for (let q = 0; q < 6; q++) w.spawnParticle(s.x - s.vx * 0.02, s.y - s.vy * 0.02, (rnd() - 0.5) * 20, -rnd() * 15, S.LAVA, 1500);
				if (s.kind === 'ice') { for (let q = 0; q < 3; q++) w.spawnParticle(s.x - s.vx * 0.02, s.y - s.vy * 0.02, (rnd() - 0.5) * 30, -rnd() * 20, S.SHARD); this.ev('shardHit', null, s.x, s.y); }
				this.shots[k] = this.shots[this.shots.length - 1]; this.shots.pop();
			}
		}
	}
	// ---------------------------------------------------------------- behaviour
	blocked(x: number, y: number, hw: number, h: number, id: number) {
		const w = this.w;
		for (let yy = Math.floor(y - h); yy < Math.floor(y); yy += 2) for (let xx = Math.floor(x - hw); xx <= Math.floor(x + hw); xx += 2) { const i = yy * w.W + xx; if (xx < 0 || xx >= w.W || yy >= w.H) return true; if (yy < 0) continue; /* open sky above the top */ if (w.body[i] === id) continue; if (solidOrPowder(w.type[i]) && !(w.body[i] >= ID0)) return true; }
		return false;
	}
	walk(m: Mob, dt: number, hw: number, h: number, g = 60) {
		const w = this.w;
		m.vy += g * dt; if (m.vy > 60) m.vy = 60;
		const nx = m.x + m.vx * dt;
		if (!this.blocked(nx, m.y, hw, h, m.id)) m.x = nx;
		else { let up = 0; const maxUp = m.kind === 'brute' ? 3 : 5; for (let k = 1; k <= maxUp; k++) if (!this.blocked(nx, m.y - k, hw, h, m.id)) { up = k; break; } if (up && m.grounded && !(m.data.stepT > 0)) { m.x = nx; m.y -= up; m.data.stepT = 0.12; } else { if (m.thrown > 0) this.impact(m, Math.abs(m.vx)); m.vx *= -0.2; } }
		const ny = m.y + m.vy * dt;
		if (!this.blocked(m.x, ny, hw, h, m.id)) { m.y = ny; m.grounded = false; }
		else { if (m.vy > 0) { if (m.thrown > 0 || m.vy > 40) this.impact(m, m.vy); m.grounded = true; let guard = 0; while (this.blocked(m.x, m.y, hw, h, m.id) && guard++ < 8) m.y -= 1; m.launched = 0; m.juggles = 0; } m.vy = 0; }
		m.x = clamp(m.x, hw + 2, w.W - hw - 2); if (m.y < h + 4) { m.y = h + 4; m.vy = Math.max(0, m.vy); } if (m.y > w.H - 5) this.kill(m, 'fall');
	}
	impact(m: Mob, v: number) { if (v < 25 || m.held) return; const c = this.center(m); if (m.thrown > 0 || v > 45) this.hit(m, c.x, c.y + 3, (v - 20) * (m.thrown > 0 ? 1.4 : 0.6), m.thrown > 0 ? 'thrown' : 'fall', 0, 1); m.thrown = 0; }
	nearest(m: Mob, kind: Kind) { let best: Mob | null = null, bd = 1e9; for (const o of this.list) { if (o === m || o.dead || o.kind !== kind) continue; const d = Math.hypot(o.x - m.x, o.y - m.y); if (d < bd) { bd = d; best = o; } } return best; }
	step(dt: number, hero: Hero, target: { x: number; y: number }) {
		this.hero = hero; // (events are cleared by the game once it has handled them)
		for (const m of this.list) this.erase(m);
		this.owner.clear();
		const idx = new Map<Kind, number>();
		for (const m of this.list) {
			if (m.dead) continue;
			const k = (idx.get(m.kind) ?? 0); idx.set(m.kind, k + 1);
			m.phase += dt; m.stateT += dt; m.lastHitT += dt; if (m.hurt > 0) m.hurt -= dt; if (m.launched > 0) m.launched -= dt; if (m.thrown > 0) m.thrown -= dt;
			if (m.data.dashHitT > 0) m.data.dashHitT -= dt; if (m.data.stepT > 0) m.data.stepT -= dt; if (m.data.frozeAt !== undefined) m.data.frozeAt += dt; m.data.lastHeat = (m.data.lastHeat ?? 0) + dt;
			if (m.data.chill > 0 && !m.boss) { if (m.frozen <= 0) { m.frost += Math.min(1, m.data.chill / 25) * (m.kind === 'brute' ? 1 / 90 : 1 / 36); if (m.frost >= 1) this.freeze(m); } m.data.chill = 0; } // ~0.6 s of Rime for a crawler, 1.5 s for a brute
			else if (m.frost > 0 && m.frozen <= 0) m.frost = Math.max(0, m.frost - dt * 0.12);
			if (m.frozen > 0) { m.frozen -= dt; if (m.frozen <= 0) this.thaw(m); }
			if (m.tell > 0) m.tell -= dt;
			if (m.boss) { this.bossStep?.(m, dt, hero); continue; }
			if (m.held) { m.x += m.vx * dt; m.y += m.vy * dt; m.x = clamp(m.x, 10, this.w.W - 10); m.y = clamp(m.y, 12, this.w.H - 8); continue; } // the Grip moves it
			if (m.kind === 'crawler') this.crawler(m, dt, hero, target, k);
			else if (m.kind === 'brute') this.brute(m, dt, hero);
			else if (m.kind === 'wraith') this.wraith(m, dt, hero, k);
			else this.swarm(m, dt, hero);
			// thrown enemies hit others
			if (m.thrown > 0 && Math.hypot(m.vx, m.vy) > 20) {
				for (const o of this.list) { if (o === m || o.dead) continue; const a = this.center(o), b = this.center(m); if (Math.hypot(a.x - b.x, a.y - b.y) < o.r + m.r * 0.7) { const v = Math.hypot(m.vx, m.vy); this.hit(o, a.x, a.y, 30 + v * 0.8, 'thrown', Math.sign(m.vx), -0.4); this.hit(m, b.x, b.y, 20 + v * 0.5, 'thrown', -Math.sign(m.vx), -0.4); this.ev('combo', o, a.x, a.y, { name: 'Strike' }); m.thrown = 0; m.vx *= -0.3; break; } }
			}
		}
		for (const a of this.list) { if (a.dead || a.boss || a.kind === 'swarm' || a.held) continue; for (const b of this.list) { if (b === a || b.dead || b.boss || b.kind === 'swarm' || b.held) continue; const ca = this.center(a), cb = this.center(b), dx = ca.x - cb.x, dy = ca.y - cb.y, d = Math.hypot(dx, dy), min = (a.r + b.r) * 0.75; if (d < min && d > 0.01) { const push = (min - d) * 0.25 / a.mass * Math.min(1, a.mass + b.mass); a.x += dx / d * push; if (a.kind === 'wraith') a.y += dy / d * push; } } }
		this.stepShots(dt, hero);
		this.list = this.list.filter(e => !e.dead);
		for (const m of this.list) this.stamp(m);
	}
	bossStep: ((m: Mob, dt: number, hero: Hero) => void) | null = null;
	bossGrip: ((x: number, y: number, r: number) => import('../engine/bodies').Body | 'slip' | null) | null = null;
	tellStart(m: Mob, kind: string, t: number) { m.state = 'windup'; m.stateT = 0; m.tell = t; m.tellKind = kind; m.data.tellT = t; this.ev('tell', m, m.x, m.y - 6, { name: kind }); }
	crawler(m: Mob, dt: number, hero: Hero, target: { x: number; y: number }, k: number) {
		const w = this.w;
		if (m.frozen > 0) { m.vx *= 0.9; this.walk(m, dt, 7, 9); return; }
		const toHero = hero.x - m.x, dH = Math.hypot(toHero, hero.y - m.y);
		const low = this.cellsAlive(m) < m.n0 * 0.55;
		if (low && m.flee <= 0 && m.data.fled !== 1) { m.flee = 3; m.data.fled = 1; }
		if (m.flee > 0) m.flee -= dt;
		const aggro = dH < 160 || !target;
		let goalX = m.flee > 0 ? m.x - Math.sign(toHero) * 50 : aggro ? hero.x + (k % 2 ? 1 : -1) * (18 + (k % 3) * 8) : target.x; // flank: half come from each side
		if (this.leash) { goalX = clamp(goalX, this.leash.x0, this.leash.x1); const gy = this.leash.ground[Math.floor(clamp(m.x, 0, w.W - 1))]; if (m.y > gy + 12 && m.state !== 'burrow' && m.state !== 'emerge') { m.data.lostT = (m.data.lostT ?? 0) + dt; if (m.data.lostT > 4) { m.data.lostT = 0; m.x = clamp(m.x, this.leash.x0, this.leash.x1); m.state = 'burrow'; m.stateT = 2.3; } } else m.data.lostT = 0; } // fallen into a cave: it digs back up
		if (m.state === 'burrow') { // under the ground, a dust trail at the surface, heading for the hero
			m.hidden = true; m.x += clamp(hero.x - m.x, -1, 1) * 22 * dt;
			if (rnd() < 0.5) { let gy = Math.floor(m.y) - 12; while (gy < w.H - 2 && !solidOrPowder(w.get(Math.floor(m.x), gy))) gy++; this.ev('dust', m, m.x, gy); }
			if (m.stateT > 2.4 || Math.abs(hero.x - m.x) < 4) { m.state = 'emerge'; m.stateT = 0; m.tell = 0.6; m.tellKind = 'emerge'; this.ev('tell', m, m.x, m.y, { name: 'emerge' }); }
			return;
		}
		if (m.state === 'emerge') { // the ground bulges and rumbles for a moment, then it bursts out
			if (m.stateT > 0.6) {
				m.hidden = false; m.state = 'move'; m.stateT = 0; m.vy = -32;
				let gy = Math.floor(m.y) - 1; while (gy > 4 && solidOrPowder(w.get(Math.floor(m.x), gy - 1))) gy--;
				for (let yy = gy; yy <= m.y; yy++) for (let xx = Math.floor(m.x) - 7; xx <= m.x + 7; xx++) { const i = yy * w.W + xx; if (w.inb(xx, yy) && solidOrPowder(w.type[i]) && !w.body[i] && w.type[i] !== S.BEDROCK) w.eject(xx, yy, (xx - m.x) * 5, -30 - rnd() * 20); }
				m.y = gy; this.ev('emerge', m, m.x, m.y);
				if (Math.abs(hero.x - m.x) < 12 && Math.abs(hero.y - m.y) < 18) this.hurtHero(hero, 14, m.x, 'emerge');
			}
			return;
		}
		if (m.state === 'windup') { m.vx *= 0.8; if (m.stateT > m.data.tellT) { // spit: a blob of real lava
			// a lob that lands where the hero will be (gravity and their motion accounted for)
			const T = clamp(Math.hypot(hero.x - m.x, hero.y - m.y) / 95, 0.35, 1.3), tx = hero.x + hero.vx * 10 * T * 0.8, ty = hero.y - 9 + hero.vy * 10 * T * 0.5;
			const dx = tx - m.x - m.face * 7, dy = ty - (m.y - 6), d = Math.hypot(dx, dy) || 1, sp = d / T;
			this.shoot(m.x + m.face * 7, m.y - 6, dx / T, dy / T - 0.5 * 60 * T, 'lava', 12);
			for (const c of m.parts[0].cells) if (c.alive && c.role === CORE && rnd() < 0.05) { this.release(m, c, dx / d * sp * 0.6, -20); break; }
			m.state = 'move'; m.stateT = 0; m.cool = 1.7 + rnd() * 1.4; this.ev('spit', m, m.x, m.y);
		} this.walk(m, dt, 7, 9); return; }
		m.face = Math.sign(goalX - m.x) || m.face;
		if (m.grounded) m.vx += ((Math.abs(goalX - m.x) < 4 ? 0 : m.face * (m.flee > 0 ? 16 : 11)) - m.vx) * Math.min(1, dt * 5);
		m.cool -= dt;
		if (aggro && m.cool <= 0 && dH < 110 && m.flee <= 0 && m.grounded) { m.face = Math.sign(toHero) || m.face; this.tellStart(m, 'spit', 0.55); }
		else if (aggro && m.grounded && dH > 90 && dH < 220 && m.stateT > 4 && rnd() < dt * 0.25 && solidOrPowder(w.get(Math.floor(m.x), Math.floor(m.y) + 2))) { m.state = 'burrow'; m.stateT = 0; m.y += 14; this.ev('burrow', m, m.x, m.y); }
		this.walk(m, dt, 7, 9);
		// contact
		if (m.frozen <= 0 && Math.abs(hero.x - m.x) < 9 && hero.y > m.y - 12 && hero.y < m.y + 6) this.hurtHero(hero, 8, m.x, 'bite');
	}
	brute(m: Mob, dt: number, hero: Hero) {
		// a plate whose every cell has been knocked off is gone
		if (m.phase % 0.5 < dt) for (let k = 0; k < m.plates.length; k++) if (m.plates[k].alive && !m.parts[0].cells.some(c => c.alive && c.plate === k)) { m.plates[k].alive = false; if (!m.plates[3].alive && !m.plates[4].alive) this.ev('heartOpen', m, m.x, m.y - 14); }
		if (m.frozen > 0) { m.vx *= 0.85; this.walk(m, dt, 8, 27); return; }
		// guard: stand between the hero and the nearest crawler; otherwise press in
		const ward = this.nearest(m, 'crawler'); const toHero = hero.x - m.x, dH = Math.hypot(toHero, hero.y - m.y);
		let goal = hero.x - Math.sign(toHero) * 14;
		if (ward && Math.abs(ward.x - m.x) < 120) goal = ward.x + Math.sign(hero.x - ward.x) * 22;
		if (this.leash) goal = clamp(goal, this.leash.x0, this.leash.x1);
		if (m.state === 'windup') {
			m.vx *= 0.7;
			if (m.stateT > m.data.tellT) {
				if (m.tellKind === 'pound') { // ground pound: a shockwave along the ground, jump or fly to dodge
					this.w.explode(m.x + m.face * 8, m.y + 1, 6, 0.6, false); this.w.air.add(m.x, m.y, 50, 5);
					this.ev('pound', m, m.x, m.y);
					if (Math.abs(hero.x - m.x) < 48 && hero.grounded && Math.abs(hero.y - m.y) < 12) this.hurtHero(hero, 18, m.x, 'pound');
				} else { m.vx = m.face * 55; m.data.charging = 0.5; this.ev('charge', m, m.x, m.y); }
				m.state = 'move'; m.stateT = 0; m.cool = 2.2 + rnd() * 1.2;
			}
			this.walk(m, dt, 8, 27); return;
		}
		if (m.data.charging > 0) { m.data.charging -= dt; if (Math.abs(hero.x - m.x) < 11 && Math.abs(hero.y - m.y) < 26) { this.hurtHero(hero, 16, m.x, 'charge'); m.data.charging = 0; } }
		else { m.face = Math.sign(hero.x - m.x) || m.face; if (m.grounded) m.vx += ((Math.abs(goal - m.x) < 4 ? 0 : Math.sign(goal - m.x) * 6) - m.vx) * Math.min(1, dt * 3); }
		m.cool -= dt;
		if (m.cool <= 0 && m.grounded) { if (dH < 44) this.tellStart(m, 'pound', 0.85); else if (dH < 120 && Math.abs(hero.y - m.y) < 20) this.tellStart(m, 'charge', 0.7); }
		this.walk(m, dt, 8, 27);
		if (Math.abs(hero.x - m.x) < 10 && hero.y > m.y - 28 && hero.y < m.y + 4) this.hurtHero(hero, 10, m.x, 'shove');
	}
	wraith(m: Mob, dt: number, hero: Hero, k: number) {
		const p = m.parts[0];
		// refreeze: left alone for a while (or fed cold), it grows its ice back
		if (m.data.lastHeat > 1.6 || (m.data.fed ?? 0) > 0) {
			const dead = p.cells.filter(c => !c.alive);
			if (dead.length && rnd() < dt * (6 + (m.data.fed ? 20 : 0))) { const c = dead[(rnd() * dead.length) | 0]; c.alive = true; c.t = c.t0; c.temp = -30; this.stats.refrozen++; if (rnd() < 0.2) this.ev('refreeze', m, m.x, m.y); }
			m.data.fed = Math.max(0, (m.data.fed ?? 0) - dt * 40);
		}
		const low = this.cellsAlive(m) < m.n0 * 0.45;
		const ang = m.phase * 0.5 + k * 2.1, dist = low ? 120 : 70;
		let ground = Math.max(0, Math.floor(m.y)); const wx = Math.floor(clamp(m.x, 0, this.w.W - 1)); while (ground < this.w.H - 2 && !solidOrPowder(this.w.get(wx, ground))) ground++;
		const gx = hero.x + Math.cos(ang) * dist, gy = clamp(hero.y - 40 + Math.sin(ang) * 22 - (low ? 30 : 0), ground - 120, ground - 22); // it keeps to the air above the ground, not the top of the sky
		const ax = (gx - m.x) * 1.2 - m.vx * 1.4, ay = (gy - m.y) * 1.2 - m.vy * 1.4;
		if (m.launched <= 0) { m.vx += ax * dt; m.vy += ay * dt; } else m.vy += 30 * dt;
		m.face = Math.sign(hero.x - m.x) || 1;
		if (m.state === 'windup') { m.vx *= 0.92; m.vy *= 0.92; if (m.stateT > m.data.tellT) { // a fan of three ice shards
			const dx = hero.x - m.x, dy = hero.y - 9 - m.y, d = Math.hypot(dx, dy) || 1, a = Math.atan2(dy, dx);
			for (const da of [-0.24, -0.12, 0, 0.12, 0.24]) this.shoot(m.x + dx / d * 6, m.y + dy / d * 6, Math.cos(a + da) * 115, Math.sin(a + da) * 115, 'ice', 7);
			m.state = 'move'; m.stateT = 0; m.cool = 1.6 + rnd() * 1.2; this.ev('shoot', m, m.x, m.y);
		} }
		else { m.cool -= dt; if (m.cool <= 0 && Math.hypot(hero.x - m.x, hero.y - m.y) < 170) this.tellStart(m, 'shards', 0.65); }
		m.x += m.vx * dt; m.y += m.vy * dt;
		const w = this.w; m.x = clamp(m.x, 10, w.W - 10); m.y = clamp(m.y, 12, w.H - 12);
		if (this.blocked(m.x, m.y + 9, 6, 18, m.id)) { m.y -= 1; m.vy = Math.min(0, m.vy); if (m.thrown > 0) this.impact(m, 40); }
	}
	swarm(m: Mob, dt: number, hero: Hero) {
		const w = this.w;
		// the swarm's centre drifts at the hero's flank; motes flock round it and lunge in waves
		const side = Math.sin(m.phase * 0.3 + m.seed * 6) > 0 ? 1 : -1;
		let ground = Math.floor(m.y); while (ground < w.H - 2 && !solidOrPowder(w.get(Math.floor(m.x), ground))) ground++;
		const anyAlive = m.parts.some(p => p.alive);
		if (!anyAlive) { m.data.spentT = (m.data.spentT ?? 0) + dt; if (m.data.spentT > 6) { this.kill(m, 'spent', true); return; } } else m.data.spentT = 0; // no sand left to re-form from
		const gx = hero.x + side * 34, gy = anyAlive ? Math.max(ground - 70, Math.min(ground - 8, hero.y - 14)) : ground - 6; // it skims the ground, and sinks to it to gather sand
		m.vx += ((gx - m.x) * 1.4 - m.vx * 1.6) * dt; m.vy += ((gy - m.y) * 1.4 - m.vy * 1.6) * dt;
		m.x += m.vx * dt; m.y += m.vy * dt; m.x = clamp(m.x, 20, w.W - 20); m.y = clamp(m.y, 20, w.H - 20);
		for (let n = 0; n < 4 && solidOrPowder(w.get(Math.floor(m.x), Math.floor(m.y + 6))); n++) { m.y -= 2; m.vy = Math.min(0, m.vy); }
		m.face = 1;
		let lunge = false;
		if (m.state === 'windup') { if (m.stateT > m.data.tellT) { m.state = 'lunge'; m.stateT = 0; this.ev('lunge', m, m.x, m.y); } }
		else if (m.state === 'lunge') { lunge = true; if (m.stateT > 0.9) { m.state = 'move'; m.stateT = 0; m.cool = 2.5 + rnd(); } }
		else { m.cool -= dt; if (m.cool <= 0) this.tellStart(m, 'hiss', 0.6); }
		const contract = m.state === 'windup' ? 0.45 : 1;
		let alive = 0;
		for (const p of m.parts) {
			if (!p.alive) {
				// re-form from loose sand nearby (sand blown far away, or fused to glass, can't come back)
				p.deadT += dt;
				if (p.reforms > 0 && p.deadT > 2.5) {
					const need = Math.ceil(p.n0 * 0.6), got: number[] = []; const R = 40; // a re-formed mote is a little smaller each time
					for (let yy = Math.floor(m.y - R * 0.6); yy <= m.y + R * 1.6 && got.length < need; yy++) for (let xx = Math.floor(m.x - R); xx <= m.x + R && got.length < need; xx++) { if (!w.inb(xx, yy)) continue; const i = yy * w.W + xx; if (w.type[i] === S.SAND && !w.body[i]) got.push(i); }
					if (got.length >= need) { for (const i of got) { this.ev('suck', m, i % w.W, (i / w.W) | 0); w.type[i] = S.AIR; w.wake(i % w.W, (i / w.W) | 0); } p.alive = true; p.reforms--; p.glass = false; p.heat = 0; let left = need; for (const c of p.cells) { c.alive = left-- > 0; c.t = S.GRIT; c.temp = 20; } p.px = (rnd() - 0.5) * 10; p.py = (rnd() - 0.5) * 10; this.stats.reformed++; this.ev('reform', m, m.x, m.y); }
					else p.deadT = 1.5; // try again in a second
				}
				continue;
			}
			alive++;
			if (p.glass) { p.vy += 60 * dt; p.vx *= 0.98; } // fused: heavy and brittle, it drops
			else {
				p.data.ang = (p.data.ang ?? 0) + dt * (1.4 + (p.n0 % 3) * 0.3);
				let tx = Math.cos(p.data.ang) * 14 * contract, ty = Math.sin(p.data.ang * 1.3) * 9 * contract;
				if (lunge) { tx = hero.x - m.x + Math.cos(p.data.ang) * 4; ty = hero.y - 9 - m.y + Math.sin(p.data.ang) * 4; }
				p.vx += ((tx - p.px) * (lunge ? 7 : 3) - p.vx * 2.2) * dt; p.vy += ((ty - p.py) * (lunge ? 7 : 3) - p.vy * 2.2) * dt;
				p.heat = Math.max(0, p.heat - dt * 0.6);
			}
			p.px += p.vx * dt; p.py += p.vy * dt;
			let q = this.worldOf(m, p, 0, 0);
			p.px = clamp(p.px, -40, 40); p.py = clamp(p.py, -40, 40); q = this.worldOf(m, p, 0, 0); // motes stay with their swarm
			if (!p.glass) { let n = 0; while (n++ < 6 && w.inb(Math.floor(q.x), Math.floor(q.y)) && solidOrPowder(w.get(Math.floor(q.x), Math.floor(q.y))) && !(w.body[Math.floor(q.y) * w.W + Math.floor(q.x)] >= ID0)) { p.py -= 1.5; p.vy = Math.min(p.vy, 0) * 0.5; q = this.worldOf(m, p, 0, 0); } } // motes slide over terrain, never into it
			else if (p.vy === 0 || !w.inb(Math.floor(q.x), Math.floor(q.y))) { p.data.restT = (p.data.restT ?? 0) + dt; if (p.data.restT > 2.5) { this.scatter(m, p, q.x, q.y - 2, 10, 'fall'); continue; } } // a glass mote that has landed cracks apart by itself
			if (p.glass && solidOrPowder(w.get(Math.floor(q.x), Math.floor(q.y) + 3))) { p.vy = 0; p.vx *= 0.8; }
			if (!p.glass && Math.abs(hero.x - q.x) < 4 && q.y > hero.y - 18 && q.y < hero.y + 2) { if (this.hurtHero(hero, 4, q.x, 'sand')) { p.vx *= -1; p.vy -= 20; } }
			for (const c of p.cells) if (c.alive) { c.temp = 20 + p.heat * 250; }
		}
		if (!alive && m.parts.every(p => p.reforms <= 0)) this.kill(m, 'scatter');
	}
	// ---------------------------------------------------------------- overlays: legs, eyes, tells, frost, shots
	draw(r: Renderer, t: number) {
		for (const m of this.list) {
			if (m.dead) continue;
			const hurt = m.hurt > 0, fr = m.frozen > 0;
			const tellK = m.tell > 0 ? 1 - m.tell / (m.data.tellT || 1) : 0, flash = m.tell > 0 && m.tell < 0.18 ? 1 : 0;
			if (m.kind === 'crawler' && !m.hidden) {
				const leg = fr ? [0.6, 0.66, 0.75, 1] : [0.06, 0.045, 0.06, 1], moving = Math.abs(m.vx) > 1 ? 1 : 0.15;
				for (let k = 0; k < 6; k++) {
					const side = k < 3 ? -1 : 1, ph = m.phase * 12 + (k % 2) * Math.PI + k;
					const hx = m.x + side * (2 + (k % 3) * 2), hy = m.y - 3;
					const fx = hx + side * 2.6 + Math.sin(ph) * 1.4 * moving, fy = m.y - Math.max(0, Math.cos(ph)) * 1.3 * moving;
					r.cap(hx, hy, (hx + fx) / 2 + side * 0.6, hy - 1.6, 0.45, 0.4, leg, null); r.cap((hx + fx) / 2 + side * 0.6, hy - 1.6, fx, fy, 0.4, 0.3, leg, null);
				}
				if (m.tell > 0) r.glow(m.x + m.face * 6, m.y - 6, 3 + 6 * tellK, [8 * tellK + 4 * flash, 3 * tellK, 0.6]);
			}
			if (m.kind === 'brute') {
				const arm = fr ? [0.55, 0.6, 0.7, 1] : [0.2, 0.17, 0.2, 1];
				const up = m.tell > 0 && m.tellKind === 'pound' ? tellK : 0, sw = Math.sin(m.phase * 4) * 0.5 * (Math.abs(m.vx) > 1 ? 1 : 0.2);
				for (const s of [-1, 1]) { const sx = m.x + s * 11, sy = m.y - 21; const ex = sx + s * 3, ey = sy + 7 - up * 16, hx = ex + s * 1 + sw * s, hy = ey + 7 - up * 10; r.cap(sx, sy, ex, ey, 2.2, 2.0, arm, null); r.cap(ex, ey, hx, hy, 2.0, 2.6, arm, null); }
				if (m.tell > 0) { r.glow(m.x, m.y - 26, 4 + 5 * tellK, [6 * tellK + 5 * flash, 2.5 * tellK, 0.5]); }
				if (!m.plates[3].alive && !m.plates[4].alive) r.glow(m.x, m.y - 15, 6 + Math.sin(t * 6) * 1.5, [5, 2.2, 0.6]);
			}
			if (m.kind === 'wraith') {
				const c = this.center(m);
				r.glow(c.x + m.face * 1, c.y - 4, 3.2, fr ? [0.5, 0.8, 1.2] : [0.9 + flash * 4, 2.2 + flash * 4, 3.4 + flash * 3]);
				for (const s of [-1.2, 1.2]) r.cap(c.x + s + m.face * 0.6, c.y - 4, c.x + s + m.face * 0.6, c.y - 4, 0.45, 0.45, [0.8, 0.95, 1, 1], [2.5 + flash * 6, 5 + flash * 6, 7], true);
				if (m.tell > 0) for (let k = 0; k < 3; k++) { const a = t * 5 + k * 2.1; r.glow(c.x + Math.cos(a) * 9 * (1 - tellK), c.y + Math.sin(a) * 9 * (1 - tellK), 1.5, [1.2 * tellK, 2.5 * tellK, 4 * tellK]); }
			}
			if (m.kind === 'swarm') {
				for (const p of m.parts) { if (!p.alive) continue; const q = this.worldOf(m, p, 0, 0); if (p.glass) { r.glow(q.x, q.y, 2.5, [0.6, 0.9, 1.1]); continue; } if (p.heat > 0.4) r.glow(q.x, q.y, 2 + p.heat, [p.heat * 2, p.heat * 0.8, 0.1]); if (m.state === 'windup') r.glow(q.x, q.y, 1.6, [2 * tellK, 1.4 * tellK, 0.5 * tellK]); }
			}
			if (hurt && !m.boss) r.glow(m.hurtX, m.hurtY, 3, [3, 2.6, 2.2]);
			if (fr && !m.boss) { const c = this.center(m); r.glow(c.x, c.y, m.r * 0.9, [0.4, 0.7, 1.1]); }
			if (m.frost > 0.1 && m.frozen <= 0 && !m.boss) { const c = this.center(m); r.glow(c.x, c.y, m.r * 0.6 * m.frost, [0.3 * m.frost, 0.6 * m.frost, 1 * m.frost]); }
		}
		for (const s of this.shots) {
			const l = Math.hypot(s.vx, s.vy) || 1;
			if (s.kind === 'lava') { r.cap(s.x, s.y, s.x - s.vx / l * 2.5, s.y - s.vy / l * 2.5, 1.3, 0.6, [1, 0.45, 0.1, 1], [7, 2.6, 0.5], false); r.glow(s.x, s.y, 4, [3, 1.1, 0.2]); }
			else if (s.kind === 'ice') { r.cap(s.x, s.y, s.x - s.vx / l * 3.5, s.y - s.vy / l * 3.5, 0.55, 0.2, [0.85, 0.97, 1, 1], [1.5, 3, 4.5], false); }
		}
	}
}
