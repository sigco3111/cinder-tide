// Procedural hero: a kinematic controller on the pixel grid plus a fully procedural rig. No clips.
// Ground: planned steps that stay fixed in world space while planted (no sliding by construction), phase-locked gait,
// obstacle-aware swing arcs, soft two-bone IK, a pelvis spring on the smoothed ground with feed-forward, lean and head
// lag on springs, squash on the upper body only, turns that blend through side-on.
// Air modes: flight (body leans into the velocity, superman arm), dive (meteor drop), dash, tumble (knockback spin).
// Mode switches blend the skeleton in root-relative space for ~0.18 s, so nothing pops.
// Cape and hair are verlet chains that collide with the world. Units: cells (10 cm); tuning in metres and seconds.
import * as S from './sim';
const M = 10;
const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
export const isSolidCell = (t: number) => { const s = S.ST[t]; return s === S.SOLID || s === S.POWDER; };
type Spr = { x: number; v: number };
function spring(st: Spr, target: number, w: number, z: number, dt: number) { st.v += (w * w * (target - st.x) - 2 * z * w * st.v) * dt; st.x += st.v * dt; return st.x; }
type P = { x: number; y: number };
// clamp with soft shoulders: inside [lo+m, hi-m] unchanged, then an exponential approach that never passes the limit
const softClamp = (a: number, lo: number, hi: number, m: number) => {
	m = Math.min(m, (hi - lo) / 2); if (m <= 1e-4) return clamp(a, lo, hi);
	if (a > hi - m) return hi - m * Math.exp(-(a - (hi - m)) / m);
	if (a < lo + m) return lo + m * Math.exp((a - (lo + m)) / m);
	return a;
};
const segX = (a: P, b: P, c: P, d: P) => { const o = (p: P, q: P, r: P) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };

export const TUNE = {
	run: 8.5, accel: 70, decel: 95, turn: 120, airAccel: 45,
	jumpH: 2.6, apexT: 0.34, fallMul: 1.65, cut: 0.45, term: 34, coyote: 0.1, buffer: 0.12,
	fly: 12, flyBoost: 18, flyAccel: 55, stepUp: 4,
	thigh: 4.5, shin: 4.5, spine: 4.4, neck: 1.0, headR: 1.6, upperArm: 3.1, foreArm: 2.9,
	hipStand: 8.6, hipRun: 8.2,
};
export interface HeroEvent { type: string; x?: number; y?: number; v?: number; vx?: number; side?: number; speed?: number; up?: number }

export class Hero {
	w: S.World; x: number; y: number; vx = 0; vy = 0; face = 1;
	halfW = 2.5; height = 17;
	grounded = false; coyote = 0; jumpBuf = 0; jumping = false; airTime = 0; skid = false; ax = 0; impact = 0;
	flying = false; flyHold = 0; diving = false; dashT = 0; dashDir = { x: 1, y: 0 }; tumble = false; tumbleSpin = 0; stun = 0;
	health = 100; invuln = 0;
	onBody: ((id: number) => void) | null = null; // set by the game: shove a rigid body off the hero
	stuckT = 0; unstuck = { displaced: 0, moved: 0, rescues: 0, maxJump: 0 };
	input = { x: 0, y: 0, jump: false, jumpPressed: false, drop: false };
	events: HeroEvent[] = [];
	rig: Rig;
	constructor(world: S.World, x: number, y: number) { this.w = world; this.x = x; this.y = y; this.rig = new Rig(this); }
	overlap(x: number, y: number) {
		const w = this.w, x0 = Math.floor(x - this.halfW), x1 = Math.floor(x + this.halfW - 1e-3), y0 = Math.floor(y - this.height), y1 = Math.floor(y - 1e-3);
		for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) if (isSolidCell(w.get(xx, yy))) return true;
		return false;
	}
	groundAt(x: number, yFrom: number, up = 6, down = 14): number | null {
		const w = this.w, xi = Math.floor(x);
		for (let y = Math.floor(yFrom - up); y <= yFrom + down; y++) if (isSolidCell(w.get(xi, y)) && !isSolidCell(w.get(xi, y - 1))) return y;
		return null;
	}
	knock(vx: number, vy: number) {
		if (this.invuln > 0) return;
		this.vx += vx; this.vy += vy; const sp = Math.hypot(vx, vy);
		if (sp > 12) { this.tumble = true; this.flying = false; this.diving = false; this.tumbleSpin = clamp(vx * 0.9, -14, 14) || 6; this.stun = 0.35; this.events.push({ type: 'tumble', v: sp }); }
	}
	startDive() { if (this.grounded) return false; this.diving = true; this.flying = false; this.vy = 40; this.vx *= 0.25; this.events.push({ type: 'dive' }); return true; }
	startDash(dx: number, dy: number) { const l = Math.hypot(dx, dy) || 1; this.dashDir = { x: dx / l, y: dy / l }; this.dashT = 0.18; this.invuln = 0.2; this.tumble = false; this.events.push({ type: 'dash' }); }
	update(dt: number) {
		const T = TUNE, inp = this.input;
		this.events.length = 0;
		if (this.invuln > 0) this.invuln -= dt;
		const g = 2 * T.jumpH / (T.apexT * T.apexT), v0 = 2 * T.jumpH / T.apexT;
		const vxPrev = this.vx;
		if (this.stun > 0) this.stun -= dt;
		if (this.dashT > 0) {
			this.dashT -= dt; this.vx = this.dashDir.x * 24; this.vy = this.dashDir.y * 24;
			if (Math.abs(this.dashDir.x) > 0.2) this.face = Math.sign(this.dashDir.x);
			if (this.dashT <= 0) { this.vx *= 0.35; this.vy *= 0.35; if (!this.grounded) this.flying = this.flying || this.vy < 0; }
		} else if (this.flying) {
			const want = Math.hypot(inp.x, inp.y) > 0.1;
			this.flyHold = want ? this.flyHold + dt : 0;
			const sp = this.flyHold > 0.6 ? T.flyBoost : T.fly;
			const l = Math.max(1, Math.hypot(inp.x, inp.y));
			const tx = inp.x / l * sp, ty = inp.y / l * sp;
			const k = want ? T.flyAccel : 30;
			const dvx = tx - this.vx, dvy = ty - this.vy, dl = Math.hypot(dvx, dvy), step = k * dt;
			if (dl <= step) { this.vx = tx; this.vy = ty; } else { this.vx += dvx / dl * step; this.vy += dvy / dl * step; }
			if (Math.abs(inp.x) > 0.1) this.face = Math.sign(inp.x);
			if (inp.drop) { this.flying = false; this.events.push({ type: 'unfly' }); }
		} else if (!this.tumble || this.stun <= 0) {
			const target = this.tumble ? 0 : inp.x * T.run;
			let a: number;
			if (this.grounded) a = inp.x === 0 ? T.decel : (Math.sign(inp.x) !== Math.sign(this.vx) && Math.abs(this.vx) > 0.5 ? T.turn : T.accel);
			else a = T.airAccel;
			if (this.diving) a = 0;
			if (this.vx < target) this.vx = Math.min(target, this.vx + a * dt); else if (this.vx > target) this.vx = Math.max(target, this.vx - a * dt);
			if (inp.x !== 0 && this.grounded) this.face = Math.sign(inp.x);
			else if (inp.x !== 0 && Math.abs(this.vx) > 2) this.face = Math.sign(this.vx);
		}
		this.skid = this.grounded && !this.flying && inp.x !== 0 && Math.sign(inp.x) !== Math.sign(this.vx) && Math.abs(this.vx) > 3;
		// jump, or take off into flight with a second press in the air
		if (inp.jumpPressed) this.jumpBuf = T.buffer; else this.jumpBuf -= dt;
		if (this.grounded) this.coyote = T.coyote; else this.coyote -= dt;
		if (this.jumpBuf > 0 && this.coyote > 0 && !this.flying && !this.tumble) {
			this.vy = -v0; this.grounded = false; this.coyote = 0; this.jumpBuf = 0; this.jumping = true;
			this.events.push({ type: 'jump', x: this.x, y: this.y, vx: this.vx });
		} else if (inp.jumpPressed && !this.grounded && this.coyote <= 0 && !this.flying && !this.diving) {
			this.flying = true; this.tumble = false; this.jumping = false; this.vy = Math.min(this.vy, -2); this.jumpBuf = 0; this.events.push({ type: 'fly', x: this.x, y: this.y });
		}
		if (this.jumping && !inp.jump && this.vy < 0) { this.vy *= T.cut; this.jumping = false; }
		if (!this.grounded && !this.flying && this.dashT <= 0) { this.vy += g * (this.vy > 0 ? T.fallMul : 1) * dt * (this.diving ? 1.6 : 1); if (this.vy > (this.diving ? 48 : T.term)) this.vy = this.diving ? 48 : T.term; }
		const mid = this.w.get(Math.floor(this.x), Math.floor(this.y - this.height * 0.4));
		if (S.ST[mid] === S.LIQUID && !this.flying && this.dashT <= 0) { this.vx *= 1 - 3 * dt; this.vy = this.vy * (1 - 4 * dt) - 14 * dt; }
		// wind from blasts pushes the hero
		const a = this.w.air.at(Math.floor(this.x), Math.floor(this.y - 8));
		if (this.invuln <= 0) { this.vx += this.w.air.vx[a] * 12 * dt; this.vy += this.w.air.vy[a] * 12 * dt; } // the hero isn't blown about by his own blasts
		this.ax = (this.vx - vxPrev) / dt;
		// integrate X with step-up
		const wasGrounded = this.grounded;
		const dx = this.vx * M * dt; const nX = Math.max(1, Math.ceil(Math.abs(dx) / 0.5));
		for (let k = 0; k < nX; k++) {
			const nx = this.x + dx / nX;
			if (nx < 4 || nx > this.w.W - 4) { this.vx = 0; break; }
			if (!this.overlap(nx, this.y) || (this.dashT > 0 && this.overlap(this.x, this.y))) { this.x = nx; continue; }
			let stepped = false;
			if (this.grounded || this.coyote > 0 || this.flying) for (let up = 1; up <= T.stepUp; up++) {
				if (!this.overlap(nx, this.y - up)) { this.x = nx; this.y -= up; stepped = true; this.events.push({ type: 'stepup', up }); break; }
			}
			if (!stepped) { this.events.push({ type: 'wall', v: this.vx }); this.vx = 0; break; }
		}
		const dy = this.vy * M * dt; const nY = Math.max(1, Math.ceil(Math.abs(dy) / 0.5));
		this.grounded = false;
		for (let k = 0; k < nY; k++) {
			const ny = this.y + dy / nY;
			if (ny - this.height < 2) { this.vy = Math.max(0, this.vy); break; }
			if (!this.overlap(this.x, ny) || (this.dashT > 0 && this.overlap(this.x, this.y))) { this.y = ny; continue; }
			if (dy > 0) {
				let yy = Math.floor(ny); while (this.overlap(this.x, yy) && yy > this.y - 3) yy--;
				this.y = yy; this.grounded = true;
				if (!wasGrounded) { this.impact = this.vy; this.events.push({ type: this.diving ? 'slam' : 'land', x: this.x, y: this.y, v: this.vy }); }
				this.vy = 0; this.jumping = false;
			} else { this.events.push({ type: 'bonk', v: this.vy }); this.vy = 0; this.jumping = false; }
			break;
		}
		if (!this.grounded && this.vy >= 0 && !this.flying) {
			if (this.overlap(this.x, this.y + 0.5)) { this.grounded = true; this.y = Math.round(this.y); if (!wasGrounded) this.events.push({ type: this.diving ? 'slam' : 'land', x: this.x, y: this.y, v: this.vy }); }
			else if (wasGrounded && !this.jumping) {
				for (let k = 1; k <= 5; k++) if (this.overlap(this.x, Math.floor(this.y) + k)) { this.y = Math.floor(this.y) + k - 1; this.grounded = true; break; }
			}
		}
		if (this.flying && this.overlap(this.x, this.y + 0.6) && inp.y >= 0 && this.dashT <= 0) { // touch down out of flight
			this.flying = false; this.grounded = true; this.y = Math.round(this.y); this.events.push({ type: 'land', x: this.x, y: this.y, v: Math.max(0, this.vy) });
		}
		if (this.grounded) { this.diving = false; if (this.tumble && Math.hypot(this.vx, this.vy) < 4 && this.stun <= 0) { this.tumble = false; this.events.push({ type: 'recover' }); } }
		if (this.tumble && this.grounded) this.vx *= 1 - 6 * dt;
		if (this.dashT <= 0 && this.overlap(this.x, this.y)) this.depenetrate(8);
		this.airTime = this.grounded ? 0 : this.airTime + dt;
		this.displaceLoose();
		this.rig.update(dt);
	}
	displaceLoose() {
		const w = this.w, x0 = Math.floor(this.x - this.halfW), x1 = Math.floor(this.x + this.halfW - 1e-3);
		for (let y = Math.floor(this.y - this.height); y < Math.floor(this.y) - 1; y++) for (let x = x0; x <= x1; x++) {
			const t = w.get(x, y); const st = S.ST[t];
			if ((st === S.POWDER || st === S.LIQUID) && !w.body[y * w.W + x]) { const side = x < this.x ? -1 : 1; w.eject(x, y, side * (6 + Math.abs(this.vx) * 6), -8); }
		}
	}
	center(): P { return { x: this.x, y: this.y - 9 }; }
	// nearest position (whole-cell offsets, closest first, up preferred on ties) where the body box is free
	nearestFree(maxR: number): P | null {
		const bx = Math.round(this.x * 2) / 2, by = Math.round(this.y);
		let best: P | null = null, bd = Infinity;
		for (let r = 0; r <= maxR; r++) {
			if (best && r > Math.sqrt(bd) + 1) break;
			for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				const d = dx * dx + dy * dy + (dy > 0 ? 0.5 : 0); if (d >= bd) continue;
				const x = bx + dx, y = by + dy; if (x < 4 || x > this.w.W - 4 || y - this.height < 2 || y > this.w.H - 2) continue;
				if (!this.overlap(x, y)) { best = { x, y }; bd = d; }
			}
		}
		return best;
	}
	depenetrate(maxR: number) {
		const p = this.nearestFree(maxR); if (!p) return false;
		const d = Math.hypot(p.x - this.x, p.y - this.y);
		this.unstuck.maxJump = Math.max(this.unstuck.maxJump, d); this.unstuck.moved++;
		this.x = p.x; this.y = p.y;
		if (p.y < this.y) this.vy = Math.min(this.vy, 0);
		return true;
	}
	// After the world moved: nothing the simulation does may leave matter inside the hero. A few cells that settled,
	// landed, froze or set inside the body are pushed out of it (the world gives way); when the hero is mostly
	// buried, they step out to the nearest free space instead; if that fails for about a second, a wide rescue.
	unstick(dt: number) {
		const w = this.w;
		if (this.dashT > 0 || !this.overlap(this.x, this.y)) { this.stuckT = 0; return; }
		const x0 = Math.floor(this.x - this.halfW), x1 = Math.floor(this.x + this.halfW - 1e-3), y0 = Math.floor(this.y - this.height), y1 = Math.floor(this.y - 1e-3);
		const cells: number[] = [];
		for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) if (w.inb(xx, yy) && isSolidCell(w.get(xx, yy))) cells.push(yy * w.W + xx);
		const total = (x1 - x0 + 1) * (y1 - y0 + 1);
		if (cells.length > total * 0.2 && this.depenetrate(16)) { this.stuckT = 0; return; }
		const shoved = new Set<number>();
		for (const i of cells) {
			const t = w.type[i]; if (t === S.BEDROCK) continue;
			if (w.body[i]) { if (!shoved.has(w.body[i])) { shoved.add(w.body[i]); this.onBody?.(w.body[i]); } continue; }
			const xx = i % w.W, yy = (i / w.W) | 0, side = xx + 0.5 < this.x ? -1 : 1;
			if (w.eject(xx, yy, side * (5 + Math.random() * 8), -4 - Math.random() * 8)) this.unstuck.displaced++;
			else { w.type[i] = S.AIR; this.unstuck.displaced++; } // particle buffer full: just clear it
		}
		if (!this.overlap(this.x, this.y)) { this.stuckT = 0; return; }
		if (this.depenetrate(10)) { this.stuckT = 0; return; }
		this.stuckT += dt;
		if (this.stuckT > 1) { // last resort: wide search, else straight up to open air
			if (!this.depenetrate(48)) { let y = this.y; while (y - this.height > 3 && this.overlap(this.x, y)) y--; this.y = y; }
			this.unstuck.rescues++; this.stuckT = 0; this.vx = this.vy = 0;
		}
	}
}

class Foot {
	side: number; plant = true; x = 0; y = 0; sx = 0; sy = 0; tx = 0; ty = 0; t = 0; locked = false; px = 0; py = 0; idle = false; oy = 0; clearT = NaN; top = 0;
	constructor(side: number) { this.side = side; }
}
const JOINTS = ['pel', 'chest', 'head', 'hip0', 'hip1', 'knee0', 'knee1', 'ankle0', 'ankle1', 'toe0', 'toe1', 'sh0', 'sh1', 'el0', 'el1', 'hand0', 'hand1'];
const POPJ = ['pel', 'chest', 'head', 'knee0', 'knee1', 'ankle0', 'ankle1', 'hand0', 'hand1', 'el0', 'el1'];

export class Rig {
	h: Hero; phase = 0; feet = [new Foot(0), new Foot(1)];
	lean: Spr = { x: 0, v: 0 }; headLag: Spr = { x: 0, v: 0 }; squash: Spr = { x: 1, v: 0 }; faceV: Spr = { x: 1, v: 0 }; fv = 1;
	armUp: Spr[] = [{ x: 0, v: 0 }, { x: 0, v: 0 }]; armBend: Spr[] = [{ x: 0.4, v: 0 }, { x: 0.4, v: 0 }];
	bodyAng: Spr = { x: 0, v: 0 }; hipW: Spr | null = null; prevTarget = 0; prevRX: number | null = null; prevRY: number | null = null;
	runBlend = 0; duty = 0.6; cad = 0; inited = false;
	cape: { x: number; y: number; px: number; py: number }[] = []; hair: { x: number; y: number; px: number; py: number }[] = [];
	stats = { ikShort: 0, slideMax: 0, slideFrames: 0, forced: 0, frames: 0, steps: 0, pushOut: 0, groundFrames: 0 };
	j: Record<string, P> & { sq?: any } = {} as any; sm: Record<string, P> = {}; blendT = 0; mode = 'ground';
	prevJ: Record<string, P> | null = null; prevJ2: Record<string, P> | null = null;
	pops = { max: {} as Record<string, number>, over: 0, hard: 0, impactMax: 0, list: [] as any[] };
	lastImpactFrame = -9; impactFrame = 0; aim: P | null = null; recoil = 0; pose: string | null = null; muzzle: P | null = null;
	time = 0; sq = 1; sx = 1; wasAim = false; gFilt: number | null = null; wasGroundedRig = false; cyS: number | null = null;
	constructor(h: Hero) { this.h = h; }
	init() {
		const h = this.h;
		for (const f of this.feet) { const gx = h.x + (f.side ? 1 : -1) * 1.2; const gy = h.groundAt(gx, h.y) ?? h.y; f.x = gx; f.y = gy - 0.6; f.plant = true; f.px = f.x; f.py = f.y; }
		const ax = h.x - h.face * 0.8, ay = h.y - 15;
		for (let i = 0; i < 9; i++) this.cape.push({ x: ax - h.face * i * 1.2, y: ay + i * 0.3, px: ax - h.face * i * 1.2, py: ay + i * 0.3 });
		for (let i = 0; i < 4; i++) this.hair.push({ x: ax, y: ay - 3, px: ax, py: ay - 3 });
		this.inited = true;
	}
	update(dt: number) {
		const h = this.h, T = TUNE; if (!this.inited) this.init();
		this.time += dt;
		const mode = h.tumble ? 'tumble' : h.dashT > 0 ? 'dash' : h.diving ? 'dive' : h.flying ? 'fly' : 'ground';
		if (mode !== this.mode) { this.blendT = 0.18; this.mode = mode; this.lastImpactFrame = this.stats.frames; }
		if (!!this.aim !== this.wasAim) { this.blendT = Math.max(this.blendT, 0.12); this.wasAim = !!this.aim; }
		const sp = Math.abs(h.vx), dir = h.vx === 0 ? h.face : Math.sign(h.vx);
		this.runBlend = lerp(this.runBlend, clamp((sp - 2) / 5, 0, 1), 1 - Math.exp(-10 * dt));
		const L = T.thigh + T.shin;
		for (const e of h.events) {
			if ((e.type === 'land' || e.type === 'slam') && mode === 'ground') {
				const k = clamp((e.v ?? 0) / 22, 0, 1);
				this.squash.v -= 1.2 + 6.5 * k; if (this.hipW) this.hipW.v += 20 * k; this.lastImpactFrame = this.stats.frames;
				if ((e.v ?? 0) > 18 || e.type === 'slam') this.impactFrame = 2;
				const moving = Math.abs(h.vx) > 0.25;
				const order = [...this.feet].sort((p, q) => q.y - p.y);
				for (const f of order) {
					const gy = h.groundAt(f.x, h.y, 8, 8) ?? h.y;
					if (f === order[0] || !moving) { const oldY = f.y; f.plant = true; f.y = gy - 0.6; f.oy = clamp(oldY - f.y, -1.5, 1.5); f.px = f.x; f.py = f.y; }
					else { f.plant = false; f.sx = f.x; f.sy = f.y; f.t = 0; f.locked = false; f.idle = false; }
				}
				this.phase = (1 - order[0].side * 0.5) % 1;
			}
			if (e.type === 'jump') { this.squash.v += 3.2; for (const f of this.feet) f.plant = false; this.lastImpactFrame = this.stats.frames; }
		}
		const grounded = h.grounded && mode === 'ground';
		const duty = lerp(0.62, 0.32, this.runBlend); this.duty = duty;
		const Lc = 0.7 + 0.16 * sp;
		let cad = sp > 0.25 ? sp / Lc : 0;
		if (grounded && this.feet.some(f => !f.plant)) cad = Math.max(cad, 1.8);
		this.cad = cad;
		const hipH = lerp(T.hipStand, T.hipRun, this.runBlend);
		const hipNow = () => this.hipW ? this.hipW.x : h.y - 9;
		if (grounded) {
			this.stats.groundFrames++;
			this.phase = (this.phase + cad * dt) % 1;
			const Tst = cad > 0 ? duty / cad : 0.3;
			const walking = sp > 0.25;
			let idleFoot: Foot | null = null;
			if (!walking && this.feet.every(o => o.plant)) {
				let worst = 1.8;
				for (const o of this.feet) { const rx = h.x + (o.side ? 1 : -1) * 1.1 * h.face; const d = Math.abs(o.x - rx); if (d > worst) { worst = d; idleFoot = o; } }
			}
			for (const f of this.feet) {
				const p = (this.phase + f.side * 0.5) % 1;
				const restX = h.x + (f.side ? 1 : -1) * 1.1 * h.face;
				const wantSwing = walking ? p >= duty : f === idleFoot;
				if (f.plant && wantSwing) { f.plant = false; f.sx = f.x; f.sy = f.y; f.t = 0; f.locked = false; f.tx = f.x; f.ty = f.y; f.idle = !walking; }
				const moving = walking && !f.idle;
				if (!f.plant) {
					let t: number;
					if (!moving) { f.t += dt / 0.16; t = Math.min(1, f.t); }
					else { t = clamp((p - duty) / (1 - duty), 0, 1); if (p < duty && f.t > 0.5) t = 1; }
					t = Math.min(t, f.t + dt / 0.075);
					f.t = Math.max(f.t, t); t = f.t;
					if (!f.locked) {
						const swingDur = moving && cad > 0 ? (1 - duty) / cad : 0.16;
						const tLeft = (1 - t) * swingDur;
						const tx = !moving ? restX : h.x + h.vx * M * tLeft + h.vx * M * Tst * 0.5;
						const gy = h.groundAt(tx, h.y, 6, 12);
						const ty = (gy ?? h.y + 2) - 0.6;
						const kk = f.t < 0.05 ? 1 : 0.35;
						if (f.t < 0.05 || Math.abs(tx - f.tx) > 0.75 || Math.abs(ty - f.ty) > 0.75) { f.tx = lerp(f.tx, tx, kk); f.ty = lerp(f.ty, ty, kk); }
						if (t > 0.7) f.locked = true;
					}
					const e = smooth(t);
					const lift = clamp(1.0 + 0.36 * sp, 1.0, 4.2) * (moving ? 1 : 0.5);
					if (f.clearT !== f.tx) {
						let top = Math.min(f.sy, f.ty) + 0.6; const a0 = Math.min(f.sx, f.tx), a1 = Math.max(f.sx, f.tx);
						for (let xx = Math.floor(a0); xx <= a1; xx++) { const gy = h.groundAt(xx, Math.min(f.sy, f.ty) + 0.6, T.stepUp + 1, 0); if (gy !== null && gy < top) top = gy; }
						f.top = top; f.clearT = f.tx;
					}
					const mid = Math.min(f.sy, f.ty);
					const stepClear = Math.max(Math.max(0, f.sy - f.ty) * 0.6, mid - (f.top - 1.4) - lift * 0.8);
					f.x = lerp(f.sx, f.tx, e); f.y = lerp(f.sy, f.ty, e) - (lift + stepClear) * Math.sin(Math.PI * t);
					{ const ceil = hipNow() + 0.45 * L; if (f.y < ceil) f.y = ceil; }
					if (isSolidCell(h.w.get(Math.floor(f.x), Math.floor(f.y + 0.5)))) { f.y -= 1; this.stats.pushOut++; }
					if (t >= 1) {
						f.plant = true; f.x = f.tx; const gy = h.groundAt(f.x, f.ty + 0.6, 3, 4) ?? h.groundAt(f.x, h.y, 6, 12); f.y = (gy ?? h.y) - 0.6; f.px = f.x; f.py = f.y; this.stats.steps++;
						h.events.push({ type: 'step', x: f.x, y: f.y + 0.6, side: f.side, speed: sp });
					}
				}
			}
		} else if (mode === 'ground') {
			// jumping or falling: tuck while rising, reach for the ground while falling
			const rising = h.vy < 0;
			const gy = h.groundAt(h.x + h.vx * M * 0.12, h.y, 0, 30);
			const reach = !rising && gy !== null ? clamp(1 - (gy - h.y) / 25, 0, 1) : 0;
			const rdx = this.prevRX === null ? 0 : h.x - this.prevRX, rdy = this.prevRY === null ? 0 : h.y - this.prevRY;
			for (const f of this.feet) {
				f.x += rdx; f.y += rdy; f.plant = false; f.locked = false;
				const s = f.side ? 1 : -1;
				const tuckX = h.x + h.face * (s * 1.6 + 1.0), tuckY = hipNow() + L * 0.55;
				const reachX = h.x + h.face * s * 1.4 + h.vx * 0.5, reachY = (gy ?? h.y) - 0.6;
				const tx = lerp(tuckX, reachX, reach), ty = lerp(tuckY, Math.min(reachY, hipNow() + L * 0.97), reach);
				const k = 1 - Math.exp(-18 * dt);
				f.x = lerp(f.x, tx, k); f.y = lerp(f.y, ty, k); f.t = 0; f.idle = false; f.sx = f.x; f.sy = f.y;
			}
		}
		// pelvis spring (ground modes)
		const bob = (grounded ? 1 : 0) * (0.22 + 0.05 * sp) * Math.cos(4 * Math.PI * (this.phase - duty / 2));
		let target: number;
		if (grounded) {
			let sum = 0, wsum = 0;
			for (const [dx, wt] of [[-6, 0.6], [-4, 0.8], [-2, 1], [0, 1.2], [2, 1], [4, 0.8], [6, 0.6], [dir * 9, 1.2 * Math.min(1, sp / 5)]]) { const gy = h.groundAt(h.x + dx, h.y, 6, 10); if (gy !== null && wt > 0) { sum += gy * wt; wsum += wt; } }
			const gref = wsum ? sum / wsum : h.y;
			if (this.gFilt === null || !this.wasGroundedRig) this.gFilt = gref;
			this.gFilt += (gref - this.gFilt) * (1 - Math.exp(-dt / 0.07)); // support height, smoothed over ~70 ms
			target = Math.max(this.gFilt, h.y - 2) - hipH + bob;
		} else target = h.y - T.hipStand - 0.5 + (h.vy < 0 ? -0.5 : 0.4);
		if (!this.hipW) { this.hipW = { x: target, v: 0 }; this.prevTarget = target; }
		this.hipW.x += (target - this.prevTarget) * (grounded ? 0.85 : 1); this.prevTarget = target; this.wasGroundedRig = grounded;
		spring(this.hipW, target, grounded ? 26 : 22, 0.85, dt);
		const hipX = h.x; let hipY = this.hipW.x;
		if (grounded) for (const f of this.feet) {
			if (!f.plant) continue;
			const dx = f.x - hipX, dy = f.y - hipY, d = Math.hypot(dx, dy);
			if (d > L * 0.9) this.hipW.v += (d - L * 0.9) * 1400 * dt;
			if (d > L * 0.975) { f.plant = false; f.sx = f.x; f.sy = f.y; f.t = 0; f.locked = false; f.idle = sp < 0.25; this.stats.forced++; }
		}
		hipY = this.hipW.x;
		const rdx = this.prevRX === null ? 0 : h.x - this.prevRX, rdy = this.prevRY === null ? 0 : h.y - this.prevRY;
		this.prevRX = h.x; this.prevRY = h.y;
		for (const f of this.feet) {
			if (f.plant && grounded) {
				const gy = h.groundAt(f.x, f.y + 0.6, 2, 3);
				if (gy !== null && Math.abs(gy - 0.6 - f.y) > 0.01) f.y = gy - 0.6;
				const slide = Math.abs(f.x - f.px); if (slide > this.stats.slideMax) this.stats.slideMax = slide;
				if (slide > 0.05) this.stats.slideFrames++;
			}
			f.px = f.x; f.py = f.y;
			f.oy *= Math.exp(-dt / 0.035);
		}
		this.stats.frames++;
		// lean, squash, facing
		const leanT = grounded ? clamp(0.065 * h.vx + 0.006 * h.ax, -0.6, 0.6) * (h.skid ? -0.8 : 1) : clamp(0.03 * h.vx, -0.35, 0.35) + (h.vy < 0 ? -0.08 : 0.1) * h.face;
		spring(this.lean, leanT, 14, 0.7, dt);
		spring(this.headLag, -this.lean.v * 0.04, 20, 0.5, dt);
		const sTarget = mode === 'dive' ? 1.18 : mode === 'dash' ? 1.25 : grounded ? 1 : 1 + clamp(Math.abs(h.vy) / 30, 0, 0.12);
		spring(this.squash, sTarget, 26, 0.35, dt);
		const sq = clamp(this.squash.x, 0.72, 1.3); this.sq = sq; this.sx = 1 / Math.sqrt(sq);
		const fv = spring(this.faceV, h.face, 20, 1.0, dt); this.fv = fv;
		const j = this.j;
		if (mode === 'ground') { this.groundPose(dt, hipX, hipY, sq, fv, sp, grounded, L); this.cyS = this.j.pel.y + 0.6; }
		else this.airPose(dt, mode, sq, fv, L, rdx, rdy);
		// aiming a power: both arms reach along the aim line, recoil kicks the shoulder back
		const shoulder = j.sh0;
		this.muzzle = null;
		if (this.aim) {
			const ax = this.aim.x - shoulder.x, ay = this.aim.y - shoulder.y, al = Math.hypot(ax, ay) || 1, ux = ax / al, uy = ay / al;
			const kick = this.recoil;
			for (const side of [0, 1]) {
				const reach = side === (fv > 0 ? 1 : 0) ? 1 : 0.85;
				const sh = { x: shoulder.x - ux * kick, y: shoulder.y - uy * kick };
				const el = { x: sh.x + ux * T.upperArm * reach - uy * 0.5 * fv, y: sh.y + uy * T.upperArm * reach + ux * 0.5 * fv };
				const hd = { x: el.x + ux * T.foreArm, y: el.y + uy * T.foreArm };
				j['sh' + side] = sh; j['el' + side] = el; j['hand' + side] = hd;
			}
			const nh = j['hand' + (fv > 0 ? 1 : 0)]; this.muzzle = { x: nh.x + ux * 0.8, y: nh.y + uy * 0.8 };
		}
		// blend between modes in root-relative space
		const root = { x: h.x, y: h.y };
		const kb = 1 - Math.exp(-dt / 0.05);
		for (const n of JOINTS) {
			const rel = { x: j[n].x - root.x, y: j[n].y - root.y };
			const s = this.sm[n];
			if (this.blendT > 0 && s && !(mode === 'ground' && grounded && n.startsWith('ankle'))) { s.x = lerp(s.x, rel.x, kb); s.y = lerp(s.y, rel.y, kb); j[n] = { x: root.x + s.x, y: root.y + s.y }; }
			else this.sm[n] = rel;
		}
		if (this.blendT > 0) this.blendT -= dt;
		spring(this.capeF, h.face, 9, 1.0, dt);
		const anchor = { x: j.chest.x - fv * 0.9 * Math.cos(this.bodyAng.x), y: j.chest.y + 0.4 };
		this.chain(this.cape, anchor, 1.15, dt, 0.9, 1.0, 1.75, 0.6);
		this.chain(this.hair, { x: j.head.x - fv * 1.0, y: j.head.y - 0.9 }, 0.7, dt, 0.85, 0.6, 1.9, 0.8);
		// pop metric (second difference, cells/frame^2), skipping frames right after jumps, landings and mode switches
		if (this.prevJ && this.prevJ2) {
			for (const n of POPJ) {
				const p = j[n], a = this.prevJ[n], b = this.prevJ2[n];
				const d2 = Math.hypot(p.x - 2 * a.x + b.x, p.y - 2 * a.y + b.y);
				if (this.stats.frames - this.lastImpactFrame <= 2) { if (d2 > this.pops.impactMax) this.pops.impactMax = +d2.toFixed(2); continue; }
				if (!(d2 <= (this.pops.max[n] ?? 0))) this.pops.max[n] = +d2.toFixed(3);
				if (d2 > 1.2) this.pops.hard++;
				if (d2 > 3) { this.pops.over++; if (this.pops.list.length < 60) this.pops.list.push({ f: this.stats.frames, n, d2: +d2.toFixed(2), mode, ev: h.events.map(e => e.type).join(',') }); }
			}
		}
		this.prevJ2 = this.prevJ; this.prevJ = {}; for (const n of POPJ) this.prevJ[n] = { x: j[n].x, y: j[n].y };
	}
	groundPose(dt: number, hipX: number, hipY: number, sq: number, fv: number, sp: number, grounded: boolean, L: number) {
		const h = this.h, T = TUNE, j = this.j;
		spring(this.bodyAng, 0, 14, 1, dt);
		const pel = { x: hipX, y: hipY + (1 - sq) * 3.0 };
		const th = this.lean.x;
		const spineL = T.spine * sq;
		const chest = { x: pel.x + Math.sin(th) * spineL, y: pel.y - Math.cos(th) * spineL };
		const hth = th * 0.45 + this.headLag.x;
		const head = { x: chest.x + Math.sin(hth) * (T.neck + T.headR) * sq, y: chest.y - Math.cos(hth) * (T.neck + T.headR) * sq };
		j.pel = pel; j.chest = chest; j.head = head;
		for (const f of this.feet) {
			const hip = { x: pel.x + (f.side ? 0.35 : -0.35) * fv, y: pel.y };
			const ank = { x: f.x, y: f.y + f.oy };
			const ik = ik2(hip, ank, T.thigh, T.shin, fv);
			if (f.plant && grounded && ik.short > this.stats.ikShort) this.stats.ikShort = ik.short;
			j['hip' + f.side] = hip; j['knee' + f.side] = ik.knee; j['ankle' + f.side] = ik.end;
			const toeA = f.plant ? 0 : clamp(-0.6 + f.t * 0.9, -0.6, 0.4);
			j['toe' + f.side] = { x: ik.end.x + fv * 1.6 * Math.cos(toeA), y: ik.end.y + 0.5 + 1.6 * Math.sin(toeA) * 0.6 };
		}
		const shoulder = { x: chest.x - Math.sin(th) * 0.6, y: chest.y + Math.cos(th) * 0.6 };
		for (const side of [0, 1]) {
			const opp = this.feet[1 - side];
			let up: number, bend: number;
			if (grounded) {
				const rel = clamp((opp.x - pel.x) * fv / (L * 0.55), -1.2, 1.2);
				up = -rel * Math.min(1.25, 0.42 + 0.1 * sp) - th * 0.3;
				bend = Math.min(1.9, 0.45 + 0.14 * sp) + Math.max(0, up) * 0.5;
				if (h.skid) { up = 0.9; bend = 0.6; }
				if (sp < 0.3) { up = 0.08 + Math.sin(this.time * 1.7 + side) * 0.04; bend = 0.25 + Math.sin(this.time * 1.7) * 0.03; } // idle breathing
			} else {
				const rising = h.vy < 0;
				up = rising ? 2.3 - side * 0.5 : 1.4 + Math.sin(h.airTime * 14 + side) * 0.35;
				bend = rising ? 0.3 : 0.7;
			}
			up = spring(this.armUp[side], up, 24, 0.75, dt); bend = spring(this.armBend[side], bend, 24, 0.75, dt);
			const ua = up * fv;
			const elbow = { x: shoulder.x + Math.sin(ua) * T.upperArm, y: shoulder.y + Math.cos(ua) * T.upperArm };
			const fa = ua + bend * fv;
			j['sh' + side] = shoulder; j['el' + side] = elbow; j['hand' + side] = { x: elbow.x + Math.sin(fa) * T.foreArm, y: elbow.y + Math.cos(fa) * T.foreArm };
		}
	}
	// Flight, dive, dash and tumble: the body is a rotated frame around its centre; limbs are posed in that frame.
	airPose(dt: number, mode: string, sq: number, fv: number, L: number, rdx: number, rdy: number) {
		const h = this.h, T = TUNE, j = this.j;
		const spd = Math.hypot(h.vx, h.vy);
		let angT = 0;
		if (mode === 'fly') angT = clamp(h.vx / 10, -1, 1) * 1.3 * smooth(clamp((spd - 3) / 7, 0, 1));
		else if (mode === 'dash') angT = clamp(h.dashDir.x, -1, 1) * 1.2;
		if (mode === 'tumble') { this.bodyAng.v = h.tumbleSpin; this.bodyAng.x += this.bodyAng.v * dt; }
		else { if (Math.abs(this.bodyAng.x) > Math.PI) this.bodyAng.x -= Math.sign(this.bodyAng.x) * 2 * Math.PI; spring(this.bodyAng, angT, mode === 'fly' ? 9 : 16, 0.9, dt); }
		const th = this.bodyAng.x;
		const ux = Math.sin(th), uy = -Math.cos(th), rx = Math.cos(th), ry = Math.sin(th); // up and right of the body frame
		const hover = mode === 'fly' ? Math.sin(this.time * 2 * Math.PI * 1.1) * 0.35 * (1 - clamp(spd / 6, 0, 1)) : 0;
		// body centre: follow the root's motion, but filter out the cell-sized steps it takes on slopes and step-ups
		if (this.cyS === null || Math.abs(this.cyS - (h.y - 9)) > 6) this.cyS = h.y - 9;
		this.cyS += h.vy * 10 * dt; this.cyS += (h.y - 9 - this.cyS) * (1 - Math.exp(-dt / 0.045));
		const C = { x: h.x, y: this.cyS + hover };
		const at = (a: number, b: number) => ({ x: C.x + ux * a + rx * b * fv, y: C.y + uy * a + ry * b * fv }); // a along up, b along facing
		const pel = at(-0.6, 0), chest = at(-0.6 + T.spine * sq, 0.15), head = at(-0.6 + T.spine * sq + T.neck + T.headR, 0.25);
		j.pel = pel; j.chest = chest; j.head = head;
		// legs
		const fast = clamp((spd - 4) / 8, 0, 1);
		for (const f of this.feet) {
			const s = f.side ? 1 : -1;
			let a: number, b: number;
			if (mode === 'fly') { a = -0.6 - L * lerp(0.86, 0.97, fast) + (f.side ? 0.9 * (1 - fast) : 0); b = lerp(s * 0.6, -1.2 - s * 0.4, fast) + Math.sin(this.time * 3 + f.side) * 0.25 * (1 - fast); }
			else if (mode === 'dive') { a = -0.6 - L * 0.95; b = s * 0.25; }
			else if (mode === 'dash') { a = -0.6 - L * 0.9; b = -1.5 - s * 0.6; }
			else { a = -0.6 - L * 0.55; b = s * 1.4 + 1.2; } // tumble tuck
			const tgt = at(a, b);
			// feet move with the root, then ease toward the pose
			f.x += rdx; f.y += rdy;
			const k = 1 - Math.exp(-22 * dt);
			f.x = lerp(f.x, tgt.x, k); f.y = lerp(f.y, tgt.y, k); f.plant = false; f.t = 0; f.sx = f.x; f.sy = f.y;
			const hip = at(-0.6, (f.side ? 0.35 : -0.35));
			const ik = ik2(hip, { x: f.x, y: f.y }, T.thigh, T.shin, fv * Math.cos(th) >= 0 ? 1 : -1);
			j['hip' + f.side] = hip; j['knee' + f.side] = ik.knee; j['ankle' + f.side] = ik.end;
			const dx = ik.end.x - ik.knee.x, dy = ik.end.y - ik.knee.y, dl = Math.hypot(dx, dy) || 1; // toe continues the shin a little, pointed
			j['toe' + f.side] = { x: ik.end.x + dx / dl * 1.3 + rx * fv * 0.5, y: ik.end.y + dy / dl * 1.3 + ry * fv * 0.5 };
		}
		// arms, as angles from "down the body" toward the facing side
		const sh = at(-0.6 + T.spine * sq - 0.6, 0.1);
		for (const side of [0, 1]) {
			const near = side === (fv > 0 ? 1 : 0);
			let up: number, bend: number;
			if (mode === 'fly') { if (fast > 0.5) { up = near ? 3.0 : 0.25; bend = near ? 0.05 : 0.3; } else { up = 0.7 + Math.sin(this.time * 2.2 + side) * 0.12 + (near ? 0.2 : 0); bend = 0.55; } }
			else if (mode === 'dive') { up = 2.9; bend = 0.15; }
			else if (mode === 'dash') { up = -0.7; bend = 0.4; }
			else { up = 1.6 + Math.sin(this.time * 18 + side * 2) * 0.6; bend = 0.9; }
			up = spring(this.armUp[side], up, 26, 0.8, dt); bend = spring(this.armBend[side], bend, 26, 0.8, dt);
			const dA = { x: -ux * Math.cos(up) + rx * fv * Math.sin(up), y: -uy * Math.cos(up) + ry * fv * Math.sin(up) };
			const el = { x: sh.x + dA.x * T.upperArm, y: sh.y + dA.y * T.upperArm };
			const ub = up + bend;
			const dB = { x: -ux * Math.cos(ub) + rx * fv * Math.sin(ub), y: -uy * Math.cos(ub) + ry * fv * Math.sin(ub) };
			j['sh' + side] = sh; j['el' + side] = el; j['hand' + side] = { x: el.x + dB.x * T.foreArm, y: el.y + dB.y * T.foreArm };
		}
	}
	// Cloth chains (cape, hair), solved root to tip in one pass so nothing can stretch or lag a frame behind:
	// - verlet with damping and air drag; most of the shoulders' own motion is carried straight into every point, so a
	//   dash or a jolt of the body doesn't whip the cloth;
	// - each point's velocity relative to the shoulders may change by at most aMax per tick (a sway, never a snap);
	// - every segment points into a range hanging behind the hero (it swings with the smoothed facing), approached with
	//   soft shoulders, so the cape can stream back or hang down but never stands up like a pole or flips through the
	//   body; segments that all lie in one range narrower than 180 degrees can't cross each other;
	// - neighbouring segments bend at most maxBend; segments never get longer than seg (they fold shorter when needed);
	// - collision is swept from the parent point: a point that would end inside matter slides around it or stops at
	//   the last free spot on the way, so the cloth folds against rock instead of snagging, climbing or tunnelling.
	resetCloth() {
		const h = this.h, ax = h.x - h.face * 0.9, ay = h.y - 13;
		this.cape.forEach((p, i) => { p.x = p.px = ax - h.face * i * 0.45; p.y = p.py = ay + i * 1.05; });
		this.hair.forEach((p, i) => { p.x = p.px = h.x - h.face * (1 + i * 0.5); p.y = p.py = h.y - 17 + i * 0.4; });
		this.capeRV.fill(0); this.hairRV.fill(0); this.capeF.x = h.face; this.capeF.v = 0;
	}
	capeRV: number[] = []; hairRV: number[] = []; capeF: Spr = { x: 1, v: 0 };
	capeStats = { maxAng: 0, crossings: 0, frames: 0 };
	chain(pts: { x: number; y: number; px: number; py: number }[], anchor: P, seg: number, dt: number, damp: number, grav: number, cone = 1.15, maxBend = 0.7) {
		const w = this.h.w, h = this.h;
		const ax0 = pts[0].x, ay0 = pts[0].y;
		pts[0].x = anchor.x; pts[0].y = anchor.y; pts[0].px = anchor.x; pts[0].py = anchor.y;
		let adx = anchor.x - ax0, ady = anchor.y - ay0;
		if (adx * adx + ady * ady > 64) { adx = 0; ady = 0; } // a teleport, not motion
		const g = 98 * grav * dt * dt; const t = this.time;
		const spd = Math.abs(h.vx) + Math.abs(h.vy);
		const free = (x: number, y: number) => !isSolidCell(w.get(Math.floor(x), Math.floor(y)));
		const buried = !free(anchor.x, anchor.y);
		// facing right: [-cone, +0.2]; facing left: [-0.2, +cone]; mid-turn (facing out of the screen): [-0.6, +0.6]
		// (angles from straight down, positive toward +x)
		const lim = (f: number) => f >= 0 ? lerp(-0.6, -cone, f) : lerp(-0.6, -0.2, -f);
		const f = pts === this.cape ? this.capeF.x : this.fv; // the cape's range turns a little slower than the body
		const lo = lim(f), hi = -lim(-f), centre = (lo + hi) / 2;
		const rv = pts === this.cape ? this.capeRV : this.hairRV, aMax = 0.5 * seg;
		while (rv.length < pts.length * 2) rv.push(0);
		let prevA = centre;
		for (let i = 1; i < pts.length; i++) {
			const p = pts[i], a = pts[i - 1];
			const inh = 0.92 - 0.22 * (i / (pts.length - 1));
			let vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp;
			const flutter = Math.sin(t * 11 + i * 1.3) * 0.02 * Math.min(1.5, spd / 6) * i;
			const drag = 0.0016 * i;
			vx += adx * inh - h.vx * drag * 10 - f * 0.0012 * i; vy += ady * inh + g + flutter - h.vy * drag * 4;
			// rate limit, relative to the shoulders
			let rx = vx - adx, ry = vy - ady; const ox = rv[i * 2], oy = rv[i * 2 + 1], dvx = rx - ox, dvy = ry - oy, dl = Math.hypot(dvx, dvy);
			if (dl > aMax) { rx = ox + dvx / dl * aMax; ry = oy + dvy / dl * aMax; }
			const qx = p.x + adx + rx, qy = p.y + ady + ry;
			p.px = p.x; p.py = p.y;
			// project onto the constraints
			const dx = qx - a.x, dy = qy - a.y; let d = Math.hypot(dx, dy);
			let ang = d > 1e-4 ? Math.atan2(dx, dy) : prevA;
			ang = softClamp(ang, lo, hi, 0.4);
			if (i > 1) ang = softClamp(ang, prevA - maxBend, prevA + maxBend, 0.2);
			d = clamp(d + (seg - d) * 0.5, seg * 0.35, seg);
			let nx = a.x + Math.sin(ang) * d, ny = a.y + Math.cos(ang) * d;
			if (!buried && !(free(nx, ny) && free((a.x + nx) / 2, (a.y + ny) / 2))) {
				let slid = false;
				for (const da of [0.3, -0.3, 0.6, -0.6]) {
					const a2 = clamp(ang + da, lo, hi); if (i > 1 && Math.abs(a2 - prevA) > maxBend) continue;
					const sx = a.x + Math.sin(a2) * d, sy = a.y + Math.cos(a2) * d;
					if (free(sx, sy) && free((a.x + sx) / 2, (a.y + sy) / 2)) { nx = sx; ny = sy; ang = a2; slid = true; break; }
				}
				if (!slid) { // fold: the last free spot on the way from the parent
					let lx = a.x, ly = a.y; for (let k = 1; k <= 6; k++) { const qx2 = a.x + (nx - a.x) * k / 6, qy2 = a.y + (ny - a.y) * k / 6; if (!free(qx2, qy2)) break; lx = qx2; ly = qy2; }
					nx = lx; ny = ly;
				}
			}
			// second rate limit on the final position (the projection above moves children with their parent): keep the
			// change small, then only pull back within the segment length and the hard range
			{
				const fx = nx - p.px - adx, fy = ny - p.py - ady, ex = fx - ox, ey = fy - oy, el = Math.hypot(ex, ey);
				if (el > aMax * 1.6 && !buried) {
					let mx = p.px + adx + ox + ex / el * aMax * 1.6, my = p.py + ady + oy + ey / el * aMax * 1.6;
					let ddx = mx - a.x, ddy = my - a.y; const dd = Math.hypot(ddx, ddy);
					if (dd > seg) { mx = a.x + ddx / dd * seg; my = a.y + ddy / dd * seg; ddx = mx - a.x; ddy = my - a.y; }
					const ma = Math.atan2(ddx, ddy), mc = clamp(ma, lo, hi);
					if (mc !== ma) { const l2 = Math.hypot(ddx, ddy); mx = a.x + Math.sin(mc) * l2; my = a.y + Math.cos(mc) * l2; }
					if (free(mx, my) && Math.hypot(mx - a.x, my - a.y) > seg * 0.3) { nx = mx; ny = my; ang = Math.atan2(nx - a.x, ny - a.y); }
				}
			}
			p.x = nx; p.y = ny; prevA = ang;
			rv[i * 2] = p.x - p.px - adx; rv[i * 2 + 1] = p.y - p.py - ady;
		}
		// stats for the harness
		const cs = this.capeStats; if (pts === this.cape) {
			cs.frames++;
			for (let i = 1; i < pts.length; i++) {
				const a = pts[i - 1], b = pts[i]; const ang = Math.atan2(b.x - a.x, b.y - a.y); cs.maxAng = Math.max(cs.maxAng, ang < lo ? lo - ang : ang > hi ? ang - hi : 0);
			}
			for (let i = 1; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) if (segX(pts[i - 1], pts[i], pts[j - 1], pts[j])) cs.crossings++;
		}
	}
	draw(r: { cap: (...a: any[]) => void }, tint: number[] | null = null) {
		const j = this.j; if (!j.pel) return;
		const suit = [0.07, 0.08, 0.17, 1], suitFar = [0.035, 0.04, 0.09, 1], boot = [0.025, 0.025, 0.04, 1];
		const capeIn = [0.66, 0.08, 0.07, 1], capeOut = [0.40, 0.03, 0.05, 1], skin = [0.86, 0.6, 0.46, 1], hair = [0.92, 0.92, 0.95, 1];
		const glow = this.impactFrame > 0 || !!tint;
		const c = (col: number[]) => tint ? tint : glow ? [1, 0.95, 0.85, 1] : col;
		const E = tint ? [tint[0] * 2, tint[1] * 2, tint[2] * 2] : glow ? [1.1, 0.9, 0.7] : null;
		const fv = this.fv, far = fv > 0 ? 0 : 1, near = 1 - far, sx = this.sx;
		const leg = (s: number, col: number[], rr: number) => { r.cap(j['hip' + s].x, j['hip' + s].y, j['knee' + s].x, j['knee' + s].y, 1.05 * rr, 0.9 * rr, c(col), E); r.cap(j['knee' + s].x, j['knee' + s].y, j['ankle' + s].x, j['ankle' + s].y, 0.9 * rr, 0.7 * rr, c(col), E); r.cap(j['ankle' + s].x, j['ankle' + s].y, j['toe' + s].x, j['toe' + s].y, 0.75, 0.55, c(boot), E); };
		const arm = (s: number, col: number[]) => { r.cap(j['sh' + s].x, j['sh' + s].y, j['el' + s].x, j['el' + s].y, 0.8, 0.68, c(col), E); r.cap(j['el' + s].x, j['el' + s].y, j['hand' + s].x, j['hand' + s].y, 0.66, 0.6, c(col), E); r.cap(j['hand' + s].x, j['hand' + s].y, j['hand' + s].x, j['hand' + s].y, 0.78, 0.78, c(boot), E); };
		if (!tint) {
			for (let i = 1; i < this.cape.length; i++) { const a = this.cape[i - 1], b = this.cape[i]; const w0 = 0.45 + i * 0.07; r.cap(a.x, a.y, b.x, b.y, w0, w0 + 0.07, c(capeOut), E); }
			for (let i = 1; i < this.cape.length - 1; i++) { const a = this.cape[i - 1], b = this.cape[i]; r.cap(a.x, a.y - 0.25, b.x, b.y - 0.25, 0.22, 0.22, c(capeIn), E); }
		}
		arm(far, suitFar); leg(far, suitFar, 0.95);
		r.cap(j.pel.x, j.pel.y, j.chest.x, j.chest.y, 1.55 * sx, 1.85 * sx, c(suit), E);
		const bx = (j.chest.x - j.pel.x) / 4.4, by = (j.chest.y - j.pel.y) / 4.4; // spine direction
		r.cap(j.pel.x + by * fv * 0.1 + bx * 0.4, j.pel.y - bx * fv * 0.1 + by * 0.4, j.pel.x - by * fv * 0.2 + bx * 0.4, j.pel.y + bx * fv * 0.2 + by * 0.4, 1.1 * sx, 1.1 * sx, c([0.03, 0.03, 0.05, 1]), E);
		const cx = lerp(j.pel.x, j.chest.x, 0.72) - by * fv * 0.9, cy = lerp(j.pel.y, j.chest.y, 0.72) + bx * fv * 0.9;
		if (!tint) r.cap(cx, cy, cx, cy, 0.55, 0.55, [1, 0.6, 0.2, 1], [5, 2.0, 0.5]);
		for (let i = 1; i < this.hair.length; i++) { const a = this.hair[i - 1], b = this.hair[i]; r.cap(a.x, a.y, b.x, b.y, 0.85 - i * 0.15, 0.7 - i * 0.15, c(hair), E); }
		r.cap(j.chest.x, j.chest.y, j.head.x, j.head.y, 0.65, 0.65, c(skin), E);
		r.cap(j.head.x, j.head.y, j.head.x, j.head.y, TUNE.headR, TUNE.headR, c(skin), E);
		const hx = (j.head.x - j.chest.x) / 2.6, hy = (j.head.y - j.chest.y) / 2.6; // head up axis
		r.cap(j.head.x + hx * 0.9 + hy * fv * 0.3, j.head.y + hy * 0.9 - hx * fv * 0.3, j.head.x + hx * 1.0 + hy * fv * 0.6, j.head.y + hy * 1.0 - hx * fv * 0.6, 1.05, 0.9, c(hair), E);
		if (!tint) r.cap(j.head.x - hy * fv * 0.55 + hx * 0.25, j.head.y + hx * fv * 0.55 + hy * 0.25, j.head.x - hy * fv * 1.35 + hx * 0.3, j.head.y + hx * fv * 1.35 + hy * 0.3, 0.38, 0.32, [1, 0.75, 0.4, 1], [3.5, 1.6, 0.5]);
		leg(near, suit, 1); arm(near, suit);
		if (this.impactFrame > 0 && !tint) this.impactFrame--;
	}
}

export function ik2(hip: P, foot: P, a: number, b: number, face: number) {
	const dx = foot.x - hip.x, dy = foot.y - hip.y; const d = Math.hypot(dx, dy) || 1e-6;
	const L = a + b, ds = 0.96 * L, dmin = Math.abs(a - b) + 1e-3;
	let de = d;
	if (d > ds) de = ds + (L - ds) * (1 - Math.exp(-(d - ds) / (L - ds)));
	if (de > L - 1e-3) de = L - 1e-3; if (de < dmin) de = dmin;
	const ux = dx / d, uy = dy / d;
	const end = { x: hip.x + ux * de, y: hip.y + uy * de };
	const base = Math.atan2(uy, ux); const al = Math.acos(clamp((a * a + de * de - b * b) / (2 * a * de), -1, 1));
	const ang = base - al * face;
	return { knee: { x: hip.x + a * Math.cos(ang), y: hip.y + a * Math.sin(ang) }, end, short: d - de };
}
