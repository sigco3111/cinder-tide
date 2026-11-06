// Rigid bodies made of pixels.
// Connectivity: a flood fill from the anchors (bedrock and the world's bottom and sides) through solid cells; every solid
// cell it can't reach is loose. Small islands become rubble, bigger ones leave the grid and become Rapier 2D bodies whose
// collider is a union of greedy-meshed boxes. Every frame a body is erased from the grid, stepped and stamped back, so sand
// piles on it and the renderer lights it like any other cells. Hard impacts shatter it into Voronoi fragments plus rubble
// along the cracks and dent whatever it hit. A body asleep for a while is written back into the grid as terrain.
// Static terrain colliders live in 64x64 regions that rebuild only when their solid cells change.
import RAPIER from '@dimforge/rapier2d-compat';
import * as S from './sim';
const M = 10;
export async function initPhysics() { await RAPIER.init(); }

function greedy(mask: Uint8Array, w: number, h: number) {
	const used = new Uint8Array(w * h), out: { x: number; y: number; w: number; h: number }[] = [];
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		const i = y * w + x; if (!mask[i] || used[i]) continue;
		let ww = 1; while (x + ww < w && mask[i + ww] && !used[i + ww]) ww++;
		let hh = 1; outer: while (y + hh < h) { for (let k = 0; k < ww; k++) { const j = (y + hh) * w + x + k; if (!mask[j] || used[j]) break outer; } hh++; }
		for (let yy = 0; yy < hh; yy++) for (let k = 0; k < ww; k++) used[(y + yy) * w + x + k] = 1;
		out.push({ x, y, w: ww, h: hh });
	}
	return out;
}

export interface Body {
	id: number; rb: RAPIER.RigidBody; mask: Uint8Array; types: Uint8Array; shade: Uint8Array; temp: Float32Array; bw: number; bh: number; ox: number; oy: number; n: number;
	stamped: number[]; asleep: boolean; lastV: { x: number; y: number }; gen: number; age: number; sleepT: number; held: boolean; thrown: number; mass: number;
}
export interface BodyEvent { type: 'detach' | 'shatter' | 'impact' | 'settle'; x: number; y: number; n: number; dv?: number }

const RS = 64;
export class Bodies {
	w: S.World; pw: RAPIER.World; list: Body[] = []; nextId = 1; events: BodyEvent[] = [];
	ground: RAPIER.RigidBody; regions: Map<number, { cols: RAPIER.Collider[]; hash: number }> = new Map();
	rw: number; rh: number; seen: Uint8Array; stack: Int32Array;
	// the hero as a kinematic box: chunks land on, roll off and get pushed by the hero instead of passing into them
	heroBox: { x: number; y: number; hw: number; h: number } | null = null; heroRb: RAPIER.RigidBody | null = null;
	stats = { islands: 0, bodies: 0, shatters: 0, rubble: 0, refrozen: 0, connectivityMs: 0, regionRebuilds: 0, regionMs: 0, stepMs: 0 };
	constructor(world: S.World) {
		this.w = world;
		this.pw = new RAPIER.World({ x: 0, y: 9.81 * 1.6 }); // a little heavier than real: 10 cm cells read floaty at true g
		this.pw.integrationParameters.numSolverIterations = 6;
		this.ground = this.pw.createRigidBody(RAPIER.RigidBodyDesc.fixed());
		this.rw = Math.ceil(world.W / RS); this.rh = Math.ceil(world.H / RS);
		this.seen = new Uint8Array(world.W * world.H); this.stack = new Int32Array(world.W * world.H);
	}
	regionHash(rx: number, ry: number) {
		const w = this.w, W = w.W; let h = 0;
		for (let y = ry * RS; y < Math.min(w.H, ry * RS + RS); y++) for (let x = rx * RS, i = y * W + x; x < Math.min(W, rx * RS + RS); x++, i++) if (S.ST[w.type[i]] === S.SOLID && !w.body[i]) h = (h * 31 + i) | 0;
		return h;
	}
	buildRegion(rx: number, ry: number, hash: number) {
		const t0 = performance.now();
		const w = this.w, W = w.W, x0 = rx * RS, y0 = ry * RS, bw = Math.min(RS, W - x0), bh = Math.min(RS, w.H - y0);
		const old = this.regions.get(ry * this.rw + rx);
		if (old) for (const c of old.cols) this.pw.removeCollider(c, false);
		const mask = new Uint8Array(bw * bh);
		for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = (y0 + y) * W + x0 + x; mask[y * bw + x] = S.ST[w.type[i]] === S.SOLID && !w.body[i] ? 1 : 0; }
		const cols: RAPIER.Collider[] = [];
		for (const b of greedy(mask, bw, bh)) cols.push(this.pw.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2 / M, b.h / 2 / M).setTranslation((x0 + b.x + b.w / 2) / M, (y0 + b.y + b.h / 2) / M).setFriction(0.8), this.ground));
		this.regions.set(ry * this.rw + rx, { cols, hash });
		this.stats.regionRebuilds++; this.stats.regionMs = +(performance.now() - t0).toFixed(2);
	}
	// Rebuild terrain colliders around bodies when their cells changed (checked a few regions per frame).
	syncRegions(force = false) {
		const need = new Set<number>();
		for (const b of this.list) {
			const p = b.rb.translation(); const R = Math.hypot(b.bw, b.bh) / 2 + 40;
			for (let ry = Math.max(0, Math.floor((p.y * M - R) / RS)); ry <= Math.min(this.rh - 1, Math.floor((p.y * M + R) / RS)); ry++)
				for (let rx = Math.max(0, Math.floor((p.x * M - R) / RS)); rx <= Math.min(this.rw - 1, Math.floor((p.x * M + R) / RS)); rx++) need.add(ry * this.rw + rx);
		}
		let budget = force ? 1e9 : 3;
		for (const k of need) {
			const rx = k % this.rw, ry = (k / this.rw) | 0;
			const cur = this.regions.get(k);
			if (cur && !force && budget <= 0) continue;
			const h = this.regionHash(rx, ry);
			if (!cur || cur.hash !== h) { this.buildRegion(rx, ry, h); budget--; }
		}
	}
	// Flood fill from the anchors. Returns the bodies made.
	// Flood fill inside a window (the camera plus a margin): solid cells on the window's border, plus bedrock and the
	// world's own bottom and sides, are anchors. Matter only changes near the camera, so islands are found there.
	detach(minCells = 12, win?: [number, number, number, number]): Body[] {
		const t0 = performance.now();
		const w = this.w, W = w.W, H = w.H, ty = w.type, seen = this.seen, stack = this.stack, body = w.body;
		const [x0, y0, x1, y1] = win ?? [0, 0, W - 1, H - 1];
		for (let y = y0; y <= y1; y++) seen.fill(0, y * W + x0, y * W + x1 + 1);
		let sp = 0;
		const ST = S.ST, SOLID = S.SOLID;
		const push = (i: number) => { if (!seen[i] && ST[ty[i]] === SOLID && !body[i]) { seen[i] = 1; stack[sp++] = i; } };
		for (let x = x0; x <= x1; x++) { push(y1 * W + x); if (y0 > 0) push(y0 * W + x); }
		for (let y = y0; y <= y1; y++) { push(y * W + x0); push(y * W + x1); }
		for (let y = Math.max(y0, H - 5); y <= y1; y++) for (let x = x0; x <= x1; x++) push(y * W + x);
		while (sp) {
			const i = stack[--sp], x = i % W, y = (i / W) | 0;
			if (x > x0) { const j = i - 1; if (!seen[j] && ST[ty[j]] === SOLID && !body[j]) { seen[j] = 1; stack[sp++] = j; } }
			if (x < x1) { const j = i + 1; if (!seen[j] && ST[ty[j]] === SOLID && !body[j]) { seen[j] = 1; stack[sp++] = j; } }
			if (y > y0) { const j = i - W; if (!seen[j] && ST[ty[j]] === SOLID && !body[j]) { seen[j] = 1; stack[sp++] = j; } }
			if (y < y1) { const j = i + W; if (!seen[j] && ST[ty[j]] === SOLID && !body[j]) { seen[j] = 1; stack[sp++] = j; } }
		}
		const made: Body[] = [];
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
			const i = y * W + x;
			if (seen[i] || ST[ty[i]] !== SOLID || body[i]) continue;
			const cells: number[] = []; sp = 0; seen[i] = 1; stack[sp++] = i;
			while (sp) { const j = stack[--sp]; cells.push(j); const x = j % W; const nb = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]; for (const k of nb) if (k >= 0 && k < W * H && !seen[k] && ST[ty[k]] === SOLID && !body[k]) { seen[k] = 1; stack[sp++] = k; } }
			if (cells.length < minCells) { for (const j of cells) { ty[j] = ty[j] === S.ICE ? S.SNOW : ty[j] === S.GLASS ? S.SHARD : S.RUBBLE; w.wake(j % W, (j / W) | 0); } this.stats.rubble += cells.length; continue; }
			const b = this.makeBody(cells); made.push(b);
			this.events.push({ type: 'detach', x: b.rb.translation().x * M, y: b.rb.translation().y * M, n: b.n });
		}
		this.stats.connectivityMs = +(performance.now() - t0).toFixed(2);
		if (made.length) this.stats.islands += made.length;
		w.structuralDirty = false;
		return made;
	}
	// Diagnostics: unanchored solid components in the whole world, without changing anything.
	islands() {
		const w = this.w, W = w.W, H = w.H, ty = w.type, seen = new Uint8Array(W * H), stack = this.stack, body = w.body; let sp = 0;
		const ok = (i: number) => !seen[i] && S.ST[ty[i]] === S.SOLID && !body[i];
		for (let x = 0; x < W; x++) { const i = (H - 1) * W + x; if (ok(i)) { seen[i] = 1; stack[sp++] = i; } }
		for (let y = 0; y < H; y++) for (const i of [y * W, y * W + W - 1]) if (ok(i)) { seen[i] = 1; stack[sp++] = i; }
		const fill = () => { const cells: number[] = []; while (sp) { const i = stack[--sp]; cells.push(i); const x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && ok(j)) { seen[j] = 1; stack[sp++] = j; } } return cells; };
		fill();
		const out: { n: number; x: number; y: number; t: string; wet: boolean }[] = [];
		for (let i = 0; i < W * H; i++) if (ok(i)) { seen[i] = 1; stack[sp++] = i; const c = fill(); const wet = c.some(j => [j - 1, j + 1, j - W, j + W].some(k => k >= 0 && k < W * H && S.ST[ty[k]] === S.LIQUID)); out.push({ n: c.length, x: c[0] % W, y: (c[0] / W) | 0, t: S.NAMES[ty[c[0]]], wet }); }
		return out;
	}
	makeBody(cells: number[], vel?: { x: number; y: number }, angvel?: number, gen = 0): Body {
		const w = this.w, W = w.W;
		let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, cx = 0, cy = 0;
		for (const j of cells) { const x = j % W, y = (j / W) | 0; if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; cx += x + 0.5; cy += y + 0.5; }
		cx /= cells.length; cy /= cells.length;
		const bw = maxx - minx + 1, bh = maxy - miny + 1;
		const mask = new Uint8Array(bw * bh), types = new Uint8Array(bw * bh), shade = new Uint8Array(bw * bh), temp = new Float32Array(bw * bh);
		let mass = 0;
		for (const j of cells) {
			const x = j % W - minx, y = ((j / W) | 0) - miny, k = y * bw + x;
			mask[k] = 1; types[k] = w.type[j]; shade[k] = w.shade[j]; temp[k] = w.temp[j]; mass += S.DENS[w.type[j]];
			w.type[j] = S.AIR; w.temp[j] = S.AMB; w.body[j] = 0; w.wake(j % W, (j / W) | 0);
		}
		const id = this.nextId++;
		const rb = this.pw.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(cx / M, cy / M).setLinvel(vel?.x ?? 0, vel?.y ?? 0).setAngvel(angvel ?? 0).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.25));
		for (const b of greedy(mask, bw, bh)) {
			const lx = minx + b.x + b.w / 2 - cx, ly = miny + b.y + b.h / 2 - cy;
			this.pw.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2 / M * 0.98, b.h / 2 / M * 0.98).setTranslation(lx / M, ly / M).setDensity(Math.max(0.5, mass / cells.length)).setFriction(0.7).setRestitution(0.05), rb);
		}
		// the terrain colliders it was cut from must go now, or the new body starts jammed inside them
		for (let ry = Math.max(0, Math.floor((miny - 2) / RS)); ry <= Math.min(this.rh - 1, Math.floor((maxy + 2) / RS)); ry++)
			for (let rx = Math.max(0, Math.floor((minx - 2) / RS)); rx <= Math.min(this.rw - 1, Math.floor((maxx + 2) / RS)); rx++) this.buildRegion(rx, ry, this.regionHash(rx, ry));
		const body: Body = { id, rb, mask, types, shade, temp, bw, bh, ox: minx - cx, oy: miny - cy, n: cells.length, stamped: [], asleep: false, lastV: { x: vel?.x ?? 0, y: vel?.y ?? 0 }, gen, age: 0, sleepT: 0, held: false, thrown: 0, mass };
		this.list.push(body); this.stats.bodies++;
		return body;
	}
	erase() {
		const w = this.w;
		for (const b of this.list) {
			if (b.asleep) continue; // a sleeping body stays stamped where it is
			for (const i of b.stamped) if (w.body[i] === b.id) {
				// keep the stamped cells' temperature (a body heats and cools with the world)
				const k = this.localIndex(b, i); if (k >= 0) b.temp[k] = w.temp[i];
				w.type[i] = S.AIR; w.body[i] = 0; w.temp[i] = S.AMB; w.wake(i % w.W, (i / w.W) | 0);
			}
			b.stamped.length = 0;
		}
	}
	localIndex(b: Body, i: number) {
		const W = this.w.W, p = b.rb.translation(), a = b.rb.rotation(), c = Math.cos(a), s = Math.sin(a);
		const dx = (i % W) + 0.5 - p.x * M, dy = ((i / W) | 0) + 0.5 - p.y * M;
		const ix = Math.floor(c * dx + s * dy - b.ox), iy = Math.floor(-s * dx + c * dy - b.oy);
		if (ix < 0 || iy < 0 || ix >= b.bw || iy >= b.bh) return -1; return iy * b.bw + ix;
	}
	stamp() {
		const w = this.w, W = w.W, H = w.H;
		for (const b of this.list) {
			if (b.asleep) continue;
			const p = b.rb.translation(), a = b.rb.rotation(), c = Math.cos(a), s = Math.sin(a);
			const px = p.x * M, py = p.y * M; const R = Math.hypot(Math.max(-b.ox, b.bw + b.ox), Math.max(-b.oy, b.bh + b.oy)) + 1;
			for (let y = Math.max(0, Math.floor(py - R)); y <= Math.min(H - 1, py + R); y++) for (let x = Math.max(0, Math.floor(px - R)); x <= Math.min(W - 1, px + R); x++) {
				const dx = x + 0.5 - px, dy = y + 0.5 - py;
				const lx = c * dx + s * dy - b.ox, ly = -s * dx + c * dy - b.oy;
				const ix = Math.floor(lx), iy = Math.floor(ly);
				if (ix < 0 || iy < 0 || ix >= b.bw || iy >= b.bh) continue;
				const k = iy * b.bw + ix; if (!b.mask[k]) continue;
				const i = y * W + x, t = w.type[i];
				if (w.body[i]) continue;
				if (t !== S.AIR) { const st = S.ST[t]; if (st === S.SOLID) continue; if (!w.eject(x, y, (dx > 0 ? 1 : -1) * 20, -25)) continue; }
				w.type[i] = b.types[k]; w.shade[i] = b.shade[k]; w.temp[i] = b.temp[k]; w.body[i] = b.id; b.stamped.push(i);
			}
		}
	}
	bodyAt(x: number, y: number) { const i = Math.floor(y) * this.w.W + Math.floor(x); const id = this.w.body[i]; return id ? this.list.find(b => b.id === id) || null : null; }
	wakeAll() { for (const b of this.list) if (b.asleep || b.rb.isSleeping()) { b.rb.wakeUp(); b.sleepT = 0; } }
	step(dt: number) {
		const t0 = performance.now();
		if (this.w.structuralDirty || this.w.removedSolid > 0) this.wakeAll();
		this.erase();
		for (const b of this.list) if (b.asleep) { if (!b.rb.isSleeping()) { // woke up: lift its stamp before it moves
			for (const i of b.stamped) if (this.w.body[i] === b.id) { this.w.type[i] = S.AIR; this.w.body[i] = 0; this.w.temp[i] = S.AMB; this.w.wake(i % this.w.W, (i / this.w.W) | 0); }
			b.stamped.length = 0; b.asleep = false; } }
		if (this.list.length) this.syncRegions();
		// buoyancy: sample the body's cells against the grid (it's erased now, so water shows through)
		for (const b of this.list) {
			if (b.asleep) continue;
			const p = b.rb.translation(), a = b.rb.rotation(), c = Math.cos(a), s2 = Math.sin(a);
			let wet = 0, n = 0; const stepK = Math.max(1, Math.floor(b.n / 24));
			for (let k = 0, m = 0; k < b.mask.length; k++) { if (!b.mask[k]) continue; if ((m++ % stepK) !== 0) continue; const lx = (k % b.bw) + 0.5 + b.ox, ly = Math.floor(k / b.bw) + 0.5 + b.oy; const x = Math.floor(p.x * M + c * lx - s2 * ly), y = Math.floor(p.y * M + s2 * lx + c * ly); n++; if (S.ST[this.w.get(x, y)] === S.LIQUID) wet++; }
			if (!wet) continue;
			const f = wet / n, mass = b.rb.mass();
			b.rb.addForce({ x: 0, y: -f * b.n * 0.01 * 1.0 * 9.81 * 1.6 }, true);
			const v = b.rb.linvel(); b.rb.setLinvel({ x: v.x * (1 - 2.5 * f * dt), y: v.y * (1 - 3.5 * f * dt) }, true);
			b.rb.setAngvel(b.rb.angvel() * (1 - 2 * f * dt), true);
			void mass;
		}
		if (this.heroBox) {
			const hb = this.heroBox, tx = hb.x / M, ty = (hb.y - hb.h / 2) / M;
			if (!this.heroRb) {
				this.heroRb = this.pw.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(tx, ty));
				this.pw.createCollider(RAPIER.ColliderDesc.cuboid(hb.hw / M, hb.h / 2 / M).setFriction(0.6), this.heroRb);
			}
			const p = this.heroRb.translation();
			if (Math.hypot(p.x - tx, p.y - ty) * M > 6) this.heroRb.setTranslation({ x: tx, y: ty }, true); // a teleport
			else this.heroRb.setNextKinematicTranslation({ x: tx, y: ty });
		}
		this.pw.timestep = dt; this.pw.step();
		for (const b of this.list) b.rb.resetForces(true);
		for (const b of [...this.list]) {
			b.age += dt; if (b.thrown > 0) b.thrown -= dt;
			const v = b.rb.linvel(); const dv = Math.hypot(v.x - b.lastV.x, v.y - b.lastV.y) * M;
			if (!b.held && dv > 32 && b.age > 0.15) {
				const p = b.rb.translation();
				this.events.push({ type: 'impact', x: p.x * M, y: p.y * M, n: b.n, dv });
				if (dv > 55 || b.thrown > 0) this.w.explode(p.x * M + v.x * 0.5, p.y * M + v.y * 0.5, Math.min(14, 3 + Math.sqrt(b.n) * 0.25), Math.min(1.3, 0.4 + dv / 150), false);
				if (b.n >= 30 && b.gen < 3) { this.shatter(b, dv); continue; }
			}
			b.lastV = { x: v.x, y: v.y };
			// a body that has stopped sleeps: it stays stamped and costs nothing until something wakes it
			if (!b.held && Math.hypot(v.x, v.y) < 0.03 && Math.abs(b.rb.angvel()) < 0.03) b.sleepT += dt; else b.sleepT = 0;
			if (b.sleepT > 1.0 && !b.asleep) { b.rb.sleep(); this.events.push({ type: 'settle', x: b.rb.translation().x * M, y: b.rb.translation().y * M, n: b.n }); }
		}
		this.stamp();
		for (const b of this.list) if (!b.asleep && b.rb.isSleeping()) b.asleep = true;
		this.stats.stepMs = +(performance.now() - t0).toFixed(2);
	}
	refreeze(b: Body) {
		const w = this.w, W = w.W, p = b.rb.translation(), a = b.rb.rotation(), c = Math.cos(a), s = Math.sin(a);
		for (let iy = 0; iy < b.bh; iy++) for (let ix = 0; ix < b.bw; ix++) {
			const k = iy * b.bw + ix; if (!b.mask[k]) continue;
			const lx = ix + 0.5 + b.ox, ly = iy + 0.5 + b.oy;
			const x = Math.floor(p.x * M + c * lx - s * ly), y = Math.floor(p.y * M + s * lx + c * ly);
			if (!w.inb(x, y)) continue; const i = y * W + x; if (w.type[i] !== S.AIR) continue;
			w.type[i] = b.types[k]; w.shade[i] = b.shade[k]; w.temp[i] = b.temp[k]; w.wake(x, y);
		}
		this.pw.removeRigidBody(b.rb); this.list.splice(this.list.indexOf(b), 1);
		this.stats.refrozen++; w.structuralDirty = true; // it may rest on loose ground: the next detach decides
		this.events.push({ type: 'settle', x: p.x * M, y: p.y * M, n: b.n });
	}
	shatter(b: Body, dv: number) {
		const w = this.w, W = w.W;
		this.stats.shatters++;
		const p = b.rb.translation(), a = b.rb.rotation(), c = Math.cos(a), s = Math.sin(a), v = b.rb.linvel(), av = b.rb.angvel();
		const world: number[] = [];
		for (let iy = 0; iy < b.bh; iy++) for (let ix = 0; ix < b.bw; ix++) {
			const k = iy * b.bw + ix; if (!b.mask[k]) continue;
			const lx = ix + 0.5 + b.ox, ly = iy + 0.5 + b.oy;
			const x = Math.floor(p.x * M + c * lx - s * ly), y = Math.floor(p.y * M + s * lx + c * ly);
			if (!w.inb(x, y)) continue; const i = y * W + x; if (w.type[i] !== S.AIR) continue;
			w.type[i] = b.types[k]; w.shade[i] = b.shade[k]; w.temp[i] = b.temp[k]; w.body[i] = 0; world.push(i);
		}
		this.pw.removeRigidBody(b.rb); this.list.splice(this.list.indexOf(b), 1);
		if (!world.length) return;
		const nSeeds = Math.min(6, 2 + Math.floor(b.n / 250));
		const seeds: number[] = []; for (let k = 0; k < nSeeds; k++) seeds.push(world[(S.rand() * world.length) | 0]);
		const groups: number[][] = seeds.map(() => []);
		const owner = new Map<number, number>();
		for (const i of world) {
			const x = i % W, y = (i / W) | 0; let best = 0, bd = 1e9;
			for (let k = 0; k < nSeeds; k++) { const sx = seeds[k] % W, sy = (seeds[k] / W) | 0; const d = (x - sx) ** 2 + (y - sy) ** 2 * 1.3 + S.rand() * 6; if (d < bd) { bd = d; best = k; } }
			owner.set(i, best);
		}
		for (const i of world) {
			const o = owner.get(i)!, x = i % W;
			const crack = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W].some(j => owner.has(j) && owner.get(j) !== o);
			if (crack && S.rand() < 0.75) {
				w.type[i] = w.type[i] === S.ICE ? S.SNOW : w.type[i] === S.GLASS ? S.SHARD : S.RUBBLE; w.wake(x, (i / W) | 0); this.stats.rubble++;
				if (S.rand() < 0.4) w.eject(x, (i / W) | 0, v.x * M + (S.rand() - 0.5) * dv, v.y * M - S.rand() * dv * 0.8);
			} else groups[o].push(i);
		}
		for (const g of groups) {
			if (g.length < 12) { for (const i of g) { w.type[i] = S.RUBBLE; w.wake(i % W, (i / W) | 0); } continue; }
			const gx = g.reduce((a2, i) => a2 + (i % W), 0) / g.length - p.x * M;
			const kick = 0.25 * dv / M;
			const nb = this.makeBody(g, { x: v.x + Math.sign(gx) * kick * S.rand(), y: v.y - kick * 0.5 * S.rand() }, av + (S.rand() - 0.5) * 3, b.gen + 1);
			nb.age = 0;
		}
		this.events.push({ type: 'shatter', x: p.x * M, y: p.y * M, n: b.n, dv });
	}
	// push a body away from a point (the hero) and wake it: used when one ends up overlapping the hero anyway
	shove(id: number, fromX: number, fromY: number, sp: number) {
		const b = this.list.find(q => q.id === id); if (!b || b.held) return false;
		if (b.asleep) { for (const i of b.stamped) if (this.w.body[i] === b.id) { this.w.type[i] = S.AIR; this.w.body[i] = 0; } b.stamped.length = 0; b.asleep = false; }
		const p = b.rb.translation(); let dx = p.x * M - fromX, dy = p.y * M - fromY; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
		if (dy > -0.3) dy = -0.6; // mostly up and off
		b.rb.wakeUp(); b.sleepT = 0;
		b.rb.setTranslation({ x: p.x + dx * 1.5 / M, y: p.y + dy * 1.5 / M }, true);
		b.rb.setLinvel({ x: dx * sp / M, y: dy * sp / M }, true);
		return true;
	}
	remove(b: Body) { this.pw.removeRigidBody(b.rb); const i = this.list.indexOf(b); if (i >= 0) this.list.splice(i, 1); }
	// cleanup: small bodies far from the camera go back into the grid right away
	cleanup(cx: number, cy: number) {
		for (const b of [...this.list]) { const p = b.rb.translation(); if (b.n < 60 && Math.hypot(p.x * M - cx, p.y * M - cy) > 500) this.refreeze(b); }
		if (this.list.length > 60) { const small = [...this.list].sort((a, b) => a.n - b.n); for (let k = 0; k < this.list.length - 60; k++) this.refreeze(small[k]); }
	}
}
