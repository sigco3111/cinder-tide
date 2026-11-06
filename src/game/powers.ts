// The five powers. Each acts on the simulated world, and each has its own effects, sound, shake and hit-stop.
//   Magma Lance (hold)      : a heat beam that boils water, melts and carves. Hold the charge button for a lava blast.
//   Meteor Drop (in the air): dive and slam; the shockwave throws loose matter and cracks rock.
//   Grip (hold, release)    : tear a disc of solid matter out as a rigid body, carry it, throw it.
//   Rime Burst (hold)       : a freezing cone. Water -> ice, lava -> obsidian, steam and cloud -> snow, fire out.
//   Phase Dash              : a short dash that carves a glowing tunnel through anything softer than metal.
import * as S from '../engine/sim';
import type { Hero } from '../engine/hero';
import type { Bodies, Body } from '../engine/bodies';
import type { Fx } from './fx';
import type { Sound } from '../audio/audio';
import { ID0, type Enemies, type Mob } from './enemies';

export interface Ctx {
	w: S.World; hero: Hero; bodies: Bodies; fx: Fx; sound: Sound; enemies: Enemies;
	shake(t: number): void; hitstop(s: number): void; flash(v: number): void; pan(x: number): void | number;
}
export interface PowerStats { lanceFrames: number; blasts: number; slams: number; grips: number; throws: number; rimeFrames: number; dashes: number; dashCarved: number; lanceCarved: number; frozen: number; boiled: number }

export class Powers {
	c: Ctx; beamPow = 0; hitMob = false; heldMob: Mob | null = null; beam: { x0: number; y0: number; x1: number; y1: number; hit: boolean } | null = null; charge = 0; charging = false;
	grip: { r: number; x: number; y: number } | null = null; held: Body | null = null; heldDist = 30; rime = 0; pendingDive = false; dashCd = [0, 0];
	cooldownMeteor = 0;
	stats: PowerStats = { lanceFrames: 0, blasts: 0, slams: 0, grips: 0, throws: 0, rimeFrames: 0, dashes: 0, dashCarved: 0, lanceCarved: 0, frozen: 0, boiled: 0 };
	constructor(c: Ctx) { this.c = c; }
	update(dt: number, it: { lance: boolean; charge: boolean; grip: boolean; gripPressed: boolean; rime: boolean; meteorPressed: boolean; dashPressed: boolean; x: number; y: number; wheel?: number }, aim: { x: number; y: number }) {
		const { hero, w } = this.c;
		const busy = hero.tumble && hero.stun > 0;
		// what the arms do: aim while any power is active
		const aiming = !busy && (it.lance || it.charge || this.charging || it.rime || this.held !== null || this.heldMob !== null);
		hero.rig.aim = aiming ? aim : null;
		this.lance(dt, it.lance && !busy && !it.charge, aim);
		this.chargeBlast(dt, it.charge && !busy, aim);
		this.gripUpdate(dt, it.grip && !busy, it.gripPressed && !busy, aim, it.wheel || 0);
		this.rimeUpdate(dt, it.rime && !busy, aim);
		this.cooldownMeteor -= dt;
		if (it.meteorPressed && !busy && this.cooldownMeteor <= 0) this.meteor();
		if (this.pendingDive && hero.vy >= -2 && !hero.grounded) { this.pendingDive = false; hero.startDive(); this.c.sound.play('dash', { pan: 0 }); }
		for (let k = 0; k < 2; k++) this.dashCd[k] = Math.max(0, this.dashCd[k] - dt);
		if (it.dashPressed && !busy) this.dash(it, aim);
		if (hero.dashT > 0) this.dashCarve();
		hero.rig.recoil = this.beamPow > 0 ? 0.35 * this.beamPow + 0.12 * Math.sin(performance.now() * 0.44) * this.beamPow : 0;
		for (const e of hero.events) if (e.type === 'slam') this.slam(e.x!, e.y!, e.v ?? 40);
		void w;
	}
	drawnBeam: { x0: number; y0: number; x1: number; y1: number; hit: boolean } | null = null;
	ray(o: { x: number; y: number }, aim: { x: number; y: number }) {
		const { w, enemies } = this.c;
		let dx = aim.x - o.x, dy = aim.y - o.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
		let x = o.x, y = o.y, wet = 0;
		for (let s = 0; s < 640; s++) {
			x += dx * 0.5; y += dy * 0.5; const ix = Math.floor(x), iy = Math.floor(y);
			if (!w.inb(ix, iy)) return { x, y, hit: false, dx, dy };
			const t = w.type[iy * w.W + ix], st = S.ST[t];
			if (w.body[iy * w.W + ix] >= ID0) return { x, y, hit: true, dx, dy };
			if (st === S.LIQUID) { if (t === S.WATER && ++wet > 18) return { x, y, hit: true, dx, dy }; continue; }
			if (st === S.SOLID || st === S.POWDER) return { x, y, hit: true, dx, dy };
		}
		return { x, y, hit: false, dx, dy };
	}
	muzzle() { const m = this.c.hero.rig.muzzle; const h = this.c.hero; return m ?? { x: h.x + h.face * 3, y: h.y - 12 }; }
	// ---- Magma Lance
	lance(dt: number, on: boolean, aim: { x: number; y: number }) {
		const { w, fx, enemies, bodies } = this.c;
		this.beamPow = on ? Math.min(1, this.beamPow + dt / 0.12) : Math.max(0, this.beamPow - dt / 0.06);
		this.c.sound.loop('beam', this.beamPow * 0.5, 0.9 + this.beamPow * 0.3);
		if (this.beamPow <= 0) { this.beam = null; return; }
		this.stats.lanceFrames++;
		const pow = this.beamPow, o = this.muzzle();
		let dx = aim.x - o.x, dy = aim.y - o.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
		let x = o.x, y = o.y, hit: { x: number; y: number } | null = null, wet = 0; this.hitMob = false;
		// does the beam reach an enemy through water? then it cuts a clean channel to it rather than boiling the path
		let toMob = false;
		{ let px = o.x, py = o.y, pw = 0; for (let s = 0; s < 640; s++) { px += dx * 0.5; py += dy * 0.5; const jx = Math.floor(px), jy = Math.floor(py); if (!w.inb(jx, jy)) break; const j = jy * w.W + jx; if (w.body[j] >= ID0) { toMob = pw > 0; break; } const st2 = S.ST[w.type[j]]; if (st2 === S.LIQUID) { if (w.type[j] === S.WATER && ++pw > 18) break; continue; } if (st2 === S.SOLID || st2 === S.POWDER) break; } }
		for (let s = 0; s < 640; s++) {
			x += dx * 0.5; y += dy * 0.5; const ix = Math.floor(x), iy = Math.floor(y);
			if (!w.inb(ix, iy)) break;
			const i = iy * w.W + ix, ty = w.type[i], st = S.ST[ty];
			if (w.body[i] >= ID0) { enemies.heatCell(i, 9000 * dt * pow, dx, dy); hit = { x, y }; this.hitMob = true; break; }
			if (st === S.LIQUID) { // boil as it passes
				// water soaks up the beam: the first cells flash to steam, and it stops a little way down
				if (ty === S.WATER) { wet++; if (!toMob) { w.temp[i] += 9000 * dt * pow / (1 + wet * 0.1); w.keep(ix, iy); } if (wet > 18) { hit = { x, y }; break; } } else w.temp[i] += 200 * dt; continue;
			}
			if (st === S.GAS && (ty === S.CLOUD) && Math.random() < 0.02) { w.temp[i] += 50; }
			if (st === S.SOLID || st === S.POWDER) { hit = { x, y }; break; }
		}
		this.beam = { x0: o.x, y0: o.y, x1: hit ? hit.x : x, y1: hit ? hit.y : y, hit: !!hit };
		if (wet > 0 && hit && !this.hitMob) { // a boiling column: everything wet within a few cells of the end flashes to steam
			const R2 = 4 + 3 * pow;
			for (let yy = Math.floor(hit.y - R2 * 1.6); yy <= hit.y + R2; yy++) for (let xx = Math.floor(hit.x - R2); xx <= hit.x + R2; xx++) {
				if (!w.inb(xx, yy)) continue; const i = yy * w.W + xx; if (w.type[i] !== S.WATER) continue;
				if ((xx - hit.x) ** 2 + ((yy - hit.y) * 0.62) ** 2 > R2 * R2) continue;
				w.temp[i] += 2600 * dt * pow; w.keep(xx, yy);
			}
			if (Math.random() < 0.5) this.c.fx.puff(hit.x, hit.y - R2, 2, 10, [1, 0.96, 0.92, 0.35], 2.5, 2, 0.7);
		}
		this.c.shake(0.16 * pow);
		if (!hit || this.hitMob) return;
		const R = 2.6 + pow * 1.4;
		for (let yy = Math.floor(hit.y - R); yy <= hit.y + R; yy++) for (let xx = Math.floor(hit.x - R); xx <= hit.x + R; xx++) {
			if (!w.inb(xx, yy)) continue; const d = Math.hypot(xx - hit.x, yy - hit.y); if (d > R) continue;
			const i = yy * w.W + xx, ty = w.type[i]; if (ty === S.AIR || ty === S.BEDROCK) continue;
			const k = 1 - d / R;
			if (w.body[i]) { if (Math.random() < 0.08 * pow) this.damageBodyCell(i, -dx, -dy); continue; }
			w.temp[i] += 9000 * dt * pow * k * (0.6 + 0.4 * (1 - S.HARD[ty]));
			w.keep(xx, yy); w.wake(xx, yy);
			if (k > 0.45 && Math.random() < 0.7 * pow * (1.1 - S.HARD[ty]) * dt * 60 * 0.5) {
				w.temp[i] = Math.max(w.temp[i], 1400);
				if (w.eject(xx, yy, -dx * (15 + 30 * Math.random()) + (Math.random() - 0.5) * 30, -dy * (15 + 30 * Math.random()) - 15 * Math.random())) this.stats.lanceCarved++;
			}
		}
		for (let k = 0; k < 4; k++) { const a = Math.atan2(-dy, -dx) + (Math.random() - 0.5) * 2.2, sp = 30 + 80 * Math.random(); fx.spark(hit.x, hit.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.15 + Math.random() * 0.35); }
		void bodies;
	}
	damageBodyCell(i: number, nx: number, ny: number) {
		const { w, bodies } = this.c; const b = bodies.list.find(bb => bb.id === w.body[i]); if (!b) return;
		const k = bodies.localIndex(b, i); if (k < 0 || !b.mask[k]) return;
		b.mask[k] = 0; b.n--; w.body[i] = 0; w.temp[i] = 1400; this.stats.lanceCarved++;
		w.eject(i % w.W, (i / w.W) | 0, nx * 30, ny * 30 - 10);
		const si = b.stamped.indexOf(i); if (si >= 0) b.stamped.splice(si, 1);
		if (b.n < 12) { bodies.remove(b); }
	}
	// ---- charged lava blast
	chargeBlast(dt: number, on: boolean, aim: { x: number; y: number }) {
		const { w, fx, sound, enemies } = this.c;
		if (on) { this.charging = true; this.charge = Math.min(1, this.charge + dt / 0.9); this.c.shake(0.08 * this.charge); sound.loop('charge', 0.12 + this.charge * 0.2, 1 + this.charge * 1.5); return; }
		sound.loop('charge', 0, 1);
		if (!this.charging) return;
		this.charging = false;
		const k = Math.max(0.25, this.charge); this.charge = 0;
		const o = this.muzzle();
		let dx = aim.x - o.x, dy = aim.y - o.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
		let x = o.x, y = o.y;
		for (let s = 0; s < 400; s++) { x += dx; y += dy; const ix = Math.floor(x), iy = Math.floor(y); if (!w.inb(ix, iy)) break; const st = S.ST[w.type[iy * w.W + ix]]; if (st === S.SOLID || st === S.POWDER || st === S.LIQUID || w.body[iy * w.W + ix] >= ID0) break; }
		this.lastBlast = { x, y, wet: S.ST[w.get(Math.floor(x), Math.floor(y))] === S.LIQUID && w.get(Math.floor(x), Math.floor(y)) === S.WATER };
		w.explode(x, y, 8 + 11 * k, 1.0 + 0.6 * k);
		for (let n = 0; n < 40 * k; n++) { const a = Math.random() * Math.PI * 2, sp = 30 + 60 * Math.random(); w.spawnParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 30, S.LAVA, 1500); }
		this.stats.blasts++;
		fx.ring(x, y, 2, 24 + 20 * k, 0.35, [4, 2.4, 1.2]); fx.glow(x, y, 26 * k + 8, 0.6, [9, 4.5, 1.8]); fx.burst(x, y, 90 * k + 20, 160);
		fx.spark(o.x, o.y, 0, 0, 0.12, [14, 10, 6], 0, 1.2);
		this.lastBolt = { x0: o.x, y0: o.y, x1: x, y1: y, t: 0.12 };
		this.c.hitstop(0.06 + 0.05 * k); this.c.flash(0.12 * k); this.c.shake(0.7 + 0.3 * k); this.c.hero.invuln = Math.max(this.c.hero.invuln, Math.hypot(x - this.c.hero.x, y - this.c.hero.y) < 40 ? 0.4 : 0);
		sound.play('release', { pan: this.c.pan(x) as number }); sound.play('blast', { pan: this.c.pan(x) as number, size: k });
	}
	lastBolt: { x0: number; y0: number; x1: number; y1: number; t: number } | null = null;
	lastBlast: { x: number; y: number; wet: boolean } | null = null;
	// ---- Meteor Drop
	meteor() {
		const { hero, sound } = this.c;
		this.cooldownMeteor = 0.5;
		if (hero.grounded) { hero.vy = -15; hero.grounded = false; hero.coyote = 0; this.pendingDive = true; sound.play('jump'); }
		else hero.startDive();
		hero.flying = false;
	}
	slam(x: number, y: number, v: number) {
		const { w, fx, sound, enemies, hero } = this.c;
		const k = Math.min(1.4, Math.max(0.6, v / 40));
		this.stats.slams++;
		// crater: soft ground blown out; a pressure pulse; loose matter thrown up and out
		enemies.blastKind = 'slam'; w.explode(x, y + 1, 7 * k, 0.9 * k, false); enemies.blastKind = null;
		w.air.add(x, y, 60, 8 * k);
		const R = 60;
		// throw only what was lying on the surface before the slam (top two loose cells of each column), each at its own
		// angle and speed, so the ground erupts in a spray instead of shooting columns straight up
		const throwList: [number, number, number][] = [];
		for (let xx = Math.floor(x - R); xx <= x + R; xx++) {
			let taken = 0;
			for (let yy = Math.floor(y - 30); yy <= y + 10 && taken < 2; yy++) {
				if (!w.inb(xx, yy)) continue; const d = Math.hypot(xx - x, yy - y); if (d > R) continue;
				const i = yy * w.W + xx, t = w.type[i], st = S.ST[t];
				if (st === S.POWDER || st === S.LIQUID) { if (w.type[i - w.W] === S.AIR && Math.random() < 0.75 * (1 - d / R)) { throwList.push([xx, yy, d]); taken++; } else if (taken) break; }
				else if (st === S.SOLID) { if ((t === S.STONE || t === S.DIRT || t === S.BRICK) && d < 22 * k && Math.random() < 0.35 * (1 - d / (22 * k))) w.set(xx, yy, S.RUBBLE, w.temp[i]); break; }
			}
		}
		for (const [xx, yy, d] of throwList) {
			const a = Math.atan2(-1, Math.sign(xx - x) * (0.4 + Math.random())) + (Math.random() - 0.5) * 0.9;
			const sp = (14 + 30 * Math.random()) * (1 - d / R) * k;
			w.eject(xx, yy, Math.cos(a) * sp, Math.sin(a) * sp);
		}
		enemies.slam(x, y, R, k);
		for (const b of this.c.bodies.list) { const p = b.rb.translation(); const d = Math.hypot(p.x * 10 - x, p.y * 10 - y); if (d < R) { b.rb.wakeUp(); b.rb.applyImpulse({ x: Math.sign(p.x * 10 - x) * 2 * b.n * 0.01 * (1 - d / R), y: -4 * b.n * 0.01 * (1 - d / R) }, true); } }
		fx.ring(x, y - 1, 2, R, 0.3, [3, 2.4, 1.8]); fx.ring(x, y - 1, 1, R * 0.6, 0.22, [5, 3, 1.6]);
		fx.puff(x, y, 40, 30, [0.82, 0.7, 0.6, 0.45], 2.4, 2.5, 1.0);
		this.c.hitstop(0.09); this.c.shake(0.85); this.c.flash(0.05);
		sound.play('slam', { pan: this.c.pan(x) as number });
		hero.vy = -6; hero.invuln = 0.5;
	}
	// ---- Grip: the circle sits on the cursor. Press and hold E: exactly the solid matter inside the circle tears out and
	// follows the cursor (springy, slower and heavier the bigger it is). Let go: it flies off with the cursor's flick.
	// The scroll wheel sizes the circle. Nothing is ever taken from anywhere but under the cursor.
	gripR = 16; gripShowT = 0; aimHist: { x: number; y: number; t: number }[] = []; gripFail = 0;
	gripCells(cx: number, cy: number, r: number) {
		const { w } = this.c; const cells: number[] = [];
		for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
			if (!w.inb(x, y) || (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
			const i = y * w.W + x, t = w.type[i];
			if (S.ST[t] === S.SOLID && t !== S.BEDROCK && !w.body[i]) cells.push(i);
		}
		return cells;
	}
	gripUpdate(dt: number, hold: boolean, pressed: boolean, aim: { x: number; y: number }, wheel: number) {
		const { bodies, fx, sound, hero } = this.c;
		if (wheel) { this.gripR = Math.max(6, Math.min(40, this.gripR - wheel * 3)); this.gripShowT = 2; }
		if (this.gripShowT > 0) this.gripShowT -= dt;
		if (this.gripFail > 0) this.gripFail -= dt;
		this.aimHist.push({ x: aim.x, y: aim.y, t: performance.now() }); if (this.aimHist.length > 6) this.aimHist.shift();
		this.grip = (hold || this.gripShowT > 0) && !this.held && !this.heldMob ? { r: this.gripR, x: aim.x, y: aim.y } : null;
		if (this.held) {
			const b = this.held;
			if (!bodies.list.includes(b)) { this.held = null; sound.loop('grip', 0); return; }
			const p = b.rb.translation();
			// the chunk chases the cursor; mass makes it lag and cap its speed
			const heavy = Math.min(1, b.n / 9000);
			const k = 14 * (1 - heavy * 0.75);
			const vx = (aim.x - p.x * 10) / 10 * k, vy = (aim.y - p.y * 10) / 10 * k;
			const vl = Math.hypot(vx, vy), vmax = 32 * (1 - heavy * 0.65);
			b.rb.setLinvel({ x: vl > vmax ? vx / vl * vmax : vx, y: vl > vmax ? vy / vl * vmax : vy }, true);
			b.rb.setAngvel(b.rb.angvel() * 0.9 + (vx * 0.004), true);
			b.held = true; b.sleepT = 0; b.asleep = false;
			hero.rig.aim = { x: p.x * 10, y: p.y * 10 }; // the arm reaches for it
			sound.loop('grip', 0.16 + heavy * 0.12, 1 + Math.min(0.4, vl * 0.01));
			if (Math.random() < 0.5) fx.spark(p.x * 10 + (Math.random() - 0.5) * b.bw * 0.6, p.y * 10 + b.bh * 0.3, 0, 8, 0.4, [1.2, 0.8, 2.6], 30, 0.15);
			if (heavy > 0.3) this.c.shake(0.05 * heavy);
			if (!hold) { // let go: throw with the cursor's flick
				const h0 = this.aimHist[0], h1 = this.aimHist[this.aimHist.length - 1], dtS = Math.max(0.016, (h1.t - h0.t) / 1000);
				let fvx = (h1.x - h0.x) / dtS / 10, fvy = (h1.y - h0.y) / dtS / 10; // m/s
				const fl = Math.hypot(fvx, fvy), cap = Math.max(8, Math.min(45, 45 * Math.sqrt(1000 / b.n)));
				if (fl > cap) { fvx *= cap / fl; fvy *= cap / fl; }
				const thrown = fl > 3;
				b.rb.setLinvel(thrown ? { x: fvx, y: fvy } : { x: vx * 0.3, y: vy * 0.3 }, true);
				if (thrown) b.rb.setAngvel((Math.random() - 0.5) * 3 + fvx * 0.08, true);
				b.held = false; b.thrown = thrown ? 2.0 : 0; b.age = 0; b.lastV = { x: fvx, y: fvy }; this.held = null;
				if (thrown) { this.stats.throws++; sound.play('throw', { pan: this.c.pan(p.x * 10) as number, size: Math.min(1, fl / 30) }); this.c.shake(0.3); }
				sound.loop('grip', 0);
			}
			return;
		}
		if (this.heldMob) { // an enemy in the Grip: it follows the cursor, then flies with the flick
			const m = this.heldMob, en = this.c.enemies;
			if (m.dead) { this.heldMob = null; sound.loop('grip', 0); return; }
			const c = en.center(m), heavy = Math.min(1, m.mass / 5);
			const k = 9 * (1 - heavy * 0.6); let vx = (aim.x - c.x) * k, vy = (aim.y - c.y) * k; const vl = Math.hypot(vx, vy), vmax = 260;
			if (vl > vmax) { vx *= vmax / vl; vy *= vmax / vl; }
			m.vx = vx; m.vy = vy; m.held = true; m.grounded = false;
			hero.rig.aim = { x: c.x, y: c.y };
			sound.loop('grip', 0.2, 1 + Math.min(0.4, vl * 0.002));
			if (Math.random() < 0.6) fx.spark(c.x + (Math.random() - 0.5) * m.r, c.y + (Math.random() - 0.5) * m.r, 0, 8, 0.3, [1.2, 0.8, 2.6], 30, 0.15);
			if (!hold) {
				const h0 = this.aimHist[0], h1 = this.aimHist[this.aimHist.length - 1], dtS = Math.max(0.016, (h1.t - h0.t) / 1000);
				let fvx = (h1.x - h0.x) / dtS, fvy = (h1.y - h0.y) / dtS; const fl = Math.hypot(fvx, fvy), cap = 320 / Math.sqrt(m.mass);
				if (fl > cap) { fvx *= cap / fl; fvy *= cap / fl; }
				m.held = false; this.heldMob = null; sound.loop('grip', 0);
				if (fl > 30) { m.vx = fvx; m.vy = fvy; m.thrown = 2; this.stats.throws++; sound.play('throw', { pan: this.c.pan(c.x) as number, size: Math.min(1, fl / 300) }); this.c.shake(0.3); }
				else { m.vx *= 0.2; m.vy *= 0.2; }
			}
			return;
		}
		if (pressed) {
			const g = this.c.enemies.gripAt(aim.x, aim.y, this.gripR);
			if (g && 'slip' in g) { this.gripFail = 0.4; this.gripShowT = 1.2; sound.play('hurt'); return; }
			if (g && 'plate' in g) { this.held = g.plate; g.plate.held = true; this.stats.grips++; sound.play('grab', { size: 0.6 }); this.c.shake(0.4); this.c.hitstop(0.05); return; }
			if (g && 'mob' in g) { this.heldMob = g.mob; g.mob.held = true; this.stats.grips++; sound.play('grab', { size: 0.5 }); this.c.shake(0.3); this.c.hitstop(0.04); return; }
			const existing = bodies.bodyAt(aim.x, aim.y);
			if (existing) { this.held = existing; existing.held = true; existing.rb.wakeUp(); existing.asleep = false; this.stats.grips++; sound.play('grab'); return; }
			const cells = this.gripCells(aim.x, aim.y, this.gripR);
			if (cells.length < 12) { this.gripFail = 0.4; this.gripShowT = 1.5; sound.play('hurt'); return; }
			const { w } = this.c;
			// a glowing cut along the rim of exactly what lifts
			const set = new Set(cells);
			for (const i of cells) { const x = i % w.W, y = (i / w.W) | 0; const edge = [i - 1, i + 1, i - w.W, i + w.W].some(j => !set.has(j)); if (edge && Math.random() < 0.5) { fx.spark(x + 0.5, y + 0.5, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.3, [3, 1.6, 4], 20); w.temp[i] = Math.max(w.temp[i], 700); } }
			const b = bodies.makeBody(cells); b.held = true; this.held = b;
			w.structuralDirty = true; w.removedSolid += cells.length;
			this.stats.grips++; sound.play('grab', { size: Math.min(1, cells.length / 3000) }); this.c.shake(0.35); this.c.hitstop(0.04);
		}
	}
	// ---- Rime Burst
	rimeUpdate(dt: number, on: boolean, aim: { x: number; y: number }) {
		const { w, fx, enemies, sound } = this.c;
		this.rime = on ? Math.min(1, this.rime + dt / 0.1) : Math.max(0, this.rime - dt / 0.1);
		sound.loop('frost', this.rime * 0.25, 1);
		if (this.rime <= 0) return;
		this.stats.rimeFrames++;
		const o = this.muzzle();
		const base = Math.atan2(aim.y - o.y, aim.x - o.x), half = 0.44, R = 120;
		for (let n = 0; n < 700; n++) {
			const a = base + (Math.random() * 2 - 1) * half, r = Math.sqrt(Math.random()) * R;
			let x = o.x, y = o.y; const cx = Math.cos(a), cy = Math.sin(a);
			// march the ray so it stops at the first solid (no freezing through walls)
			let stop = false;
			for (let s = 0; s < r; s += 2) { x = o.x + cx * s; y = o.y + cy * s; if (w.body[Math.floor(y) * w.W + Math.floor(x)] >= ID0) { stop = true; break; } const st = S.ST[w.get(Math.floor(x), Math.floor(y))]; if (st === S.SOLID && w.get(Math.floor(x), Math.floor(y)) !== S.ICE) { stop = true; break; } }
			const ix = Math.floor(x), iy = Math.floor(y); if (!w.inb(ix, iy)) continue;
			const i = iy * w.W + ix, t = w.type[i];
			if (w.body[i] >= ID0) { enemies.coldCell(i, 1); continue; }
			if (w.body[i]) continue;
			if (t === S.WATER) { w.temp[i] = Math.min(w.temp[i], -15); w.wake(ix, iy); }
			else if (t === S.STEAM || t === S.CLOUD) { w.set(ix, iy, S.SNOW); }
			else if (t === S.FIRE || t === S.SMOKE) { w.set(ix, iy, S.AIR); }
			else if (t === S.LAVA || t === S.MOLTEN || t === S.MGLASS) { w.temp[i] -= 600; w.keep(ix, iy); }
			else if (t !== S.AIR) { w.temp[i] -= 80; w.keep(ix, iy); }
			void stop;
		}
		void enemies; //en = Math.min(3, e.frozen + dt * 2.5); }
		for (let k = 0; k < 6; k++) { const a = base + (Math.random() * 2 - 1) * half, sp = 80 + Math.random() * 80; fx.spark(o.x, o.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.4, [1.2, 2.0, 3.0], 0, 0.3); }
		if (Math.random() < 0.3) sound.play('freeze');
	}
	// ---- Phase Dash
	dash(it: { x: number; y: number }, aim: { x: number; y: number }) {
		const { hero, sound, fx } = this.c;
		const slot = this.dashCd[0] <= 0 ? 0 : this.dashCd[1] <= 0 ? 1 : -1; if (slot < 0) return;
		this.dashCd[slot] = 1.2;
		let dx = it.x, dy = it.y;
		if (Math.abs(dx) + Math.abs(dy) < 0.2) { dx = aim.x - hero.x; dy = aim.y - (hero.y - 9); }
		hero.startDash(dx, dy);
		this.stats.dashes++;
		sound.play('dash', { pan: 0 }); this.c.shake(0.25);
		fx.puff(hero.x, hero.y - 8, 8, 20, [0.9, 0.8, 1, 0.3], 2, 2, 0.4);
		this.ghostT = 0;
	}
	ghostT = 0;
	dashCarve() {
		const { w, hero, fx, enemies } = this.c;
		const d = hero.dashDir, cx = hero.x + d.x * 4, cy = hero.y - 9 + d.y * 4;
		const R = 10.5;
		let hard = false;
		for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R * 0.6); x <= cx + R * 0.6; x++) {
			if (!w.inb(x, y)) continue; const dd = Math.hypot((x - cx) / 0.6, y - cy); if (dd > R) continue;
			const i = y * w.W + x, t = w.type[i]; if (t === S.AIR || w.body[i]) continue;
			const st = S.ST[t];
			if (st === S.GAS || st === S.LIQUID) continue;
			if (S.HARD[t] >= 0.8) { if (dd < R * 0.7 && (x - hero.x) * d.x + (y - hero.y + 9) * d.y > 2) hard = true; continue; }
			if (dd > R * 0.8) { w.temp[i] = Math.max(w.temp[i], 900); w.keep(x, y); continue; } // glowing rim
			w.temp[i] = 1000; if (w.eject(x, y, -d.x * (20 + Math.random() * 20) + (Math.random() - 0.5) * 20, -d.y * 20 - Math.random() * 20)) this.stats.dashCarved++;
		}
		enemies.dashThrough(hero.x, hero.y - 9, d.x, d.y);
		this.ghostT -= 1;
		if (this.ghostT <= 0) { this.ghostT = 3; fx.ghosts.push({ joints: structuredClone(hero.rig.j), life: 0, max: 0.25, tint: [1, 0.55, 0.25, 0.6] }); }
		if (hard) { hero.dashT = 0; hero.vx = -d.x * 8; hero.vy = -d.y * 8 - 4; this.c.hitstop(0.05); this.c.shake(0.4); fx.burst(cx + d.x * 6, cy + d.y * 6, 30, 90, [8, 6, 3]); this.c.sound.play('impact', { size: 0.6 }); }
	}
}
