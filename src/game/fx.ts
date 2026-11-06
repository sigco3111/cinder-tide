// Effect particles that aren't matter: spark streaks, soft dust and steam puffs, shock rings, glows and afterimages.
import type { Renderer } from '../engine/render';
import * as S from '../engine/sim';

interface Spark { x: number; y: number; px: number; py: number; vx: number; vy: number; life: number; max: number; e: number[]; g: number; w: number }
interface Puff { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; col: number[]; grow: number }
interface Ring { x: number; y: number; r0: number; r1: number; life: number; max: number; e: number[] }
interface Glow { x: number; y: number; r: number; life: number; max: number; e: number[] }
export interface Ghost { joints: any; life: number; max: number; tint: number[] }

export class Fx {
	sparks: Spark[] = []; puffs: Puff[] = []; rings: Ring[] = []; glows: Glow[] = []; ghosts: Ghost[] = [];
	spark(x: number, y: number, vx: number, vy: number, max = 0.4, e = [7, 3, 0.8], g = 140, w = 0.2) { if (this.sparks.length < 3000) this.sparks.push({ x, y, px: x, py: y, vx, vy, life: 0, max, e, g, w }); }
	burst(x: number, y: number, n: number, sp: number, e = [7, 3, 0.8], up = 0) { for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, s = sp * (0.3 + Math.random() * 0.7); this.spark(x, y, Math.cos(a) * s, Math.sin(a) * s - up, 0.2 + Math.random() * 0.5, e); } }
	puff(x: number, y: number, n: number, sp: number, col: number[], rad = 1.4, grow = 3, max = 0.6) { for (let k = 0; k < n; k++) { const a = Math.PI + Math.random() * Math.PI; if (this.puffs.length < 1500) this.puffs.push({ x, y, vx: Math.cos(a) * sp * (0.4 + Math.random()), vy: Math.sin(a) * sp * 0.4 * Math.random(), r: rad * (0.6 + Math.random() * 0.8), life: 0, max: max * (0.6 + Math.random() * 0.8), col, grow }); } }
	ring(x: number, y: number, r0: number, r1: number, max: number, e = [3, 2.2, 1.6]) { this.rings.push({ x, y, r0, r1, life: 0, max, e }); }
	glow(x: number, y: number, r: number, max: number, e: number[]) { this.glows.push({ x, y, r, life: 0, max, e }); }
	step(dt: number, w: S.World) {
		for (let i = this.sparks.length - 1; i >= 0; i--) {
			const p = this.sparks[i]; p.life += dt; p.vy += p.g * dt; p.vx *= 0.985; p.px = p.x; p.py = p.y; p.x += p.vx * dt; p.y += p.vy * dt;
			if (p.life > p.max || S.ST[w.get(Math.floor(p.x), Math.floor(p.y))] === S.SOLID) { this.sparks[i] = this.sparks[this.sparks.length - 1]; this.sparks.pop(); }
		}
		for (let i = this.puffs.length - 1; i >= 0; i--) { const p = this.puffs[i]; p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy = p.vy * 0.92 - 4 * dt; if (p.life > p.max) { this.puffs[i] = this.puffs[this.puffs.length - 1]; this.puffs.pop(); } }
		for (const arr of [this.rings, this.glows, this.ghosts] as any[]) for (let i = arr.length - 1; i >= 0; i--) { arr[i].life += dt; if (arr[i].life > arr[i].max) arr.splice(i, 1); }
	}
	draw(r: Renderer) {
		for (const p of this.puffs) { const a = 1 - p.life / p.max, rr = p.r * (1 + p.life * p.grow), al = p.col[3] * a; r.cap(p.x, p.y, p.x, p.y, rr, rr, [p.col[0] * al, p.col[1] * al, p.col[2] * al, al], null, false); }
		for (const p of this.sparks) { const a = 1 - p.life / p.max; r.cap(p.px, p.py, p.x, p.y, p.w, p.w * 0.75, [0, 0, 0, 0], [p.e[0] * a, p.e[1] * a, p.e[2] * a], false); }
		for (const g of this.rings) {
			const u = g.life / g.max, rad = g.r0 + (g.r1 - g.r0) * (1 - (1 - u) ** 2), a = (1 - u) ** 1.5, n = 28;
			for (let k = 0; k < n; k++) { const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2; r.cap(g.x + Math.cos(a0) * rad, g.y + Math.sin(a0) * rad, g.x + Math.cos(a1) * rad, g.y + Math.sin(a1) * rad, 0.9, 0.9, [0, 0, 0, 0], [g.e[0] * a, g.e[1] * a, g.e[2] * a], false); }
		}
		for (const g of this.glows) { const a = (1 - g.life / g.max) ** 2; r.glow(g.x, g.y, g.r * (0.6 + 0.8 * g.life / g.max), [g.e[0] * a, g.e[1] * a, g.e[2] * a]); }
	}
}
