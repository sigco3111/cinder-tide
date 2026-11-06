// Pixel world simulation. One cell = 10 cm.
// Dense typed arrays (Sandspiel-style), 32x32 chunks with dirty rects (Noita-style), only chunks near the camera
// update (the rest keep their pending work for later), element rules as a data table written for this game
// (An open-source falling-sand game was a design reference only: none of its code or data is used.)
// Water is conserved through its whole cycle: water boils to steam, steam rises and becomes cloud, cloud rains water.

export const AIR = 0, STONE = 1, SAND = 2, WATER = 3, LAVA = 4, FIRE = 5, SMOKE = 6, STEAM = 7, WOOD = 8, METAL = 9,
	GLASS = 10, ACID = 11, TNT = 12, ICE = 13, OBSIDIAN = 14, RUBBLE = 15, EMBER = 16, MOLTEN = 17, MGLASS = 18,
	BEDROCK = 19, SHARD = 20, DIRT = 21, CLOUD = 22, SNOW = 23, BRICK = 24, ROOF = 25, GRASS = 26, BASALT = 27,
	PLASTER = 28, TEAL = 29, CLOTH = 30, TERRA = 31, STORM = 32, FROST = 33, GRIT = 34;
export const EMPTY = 0, SOLID = 1, POWDER = 2, LIQUID = 3, GAS = 4;

const N = 40;
export const ST = new Uint8Array(N), DENS = new Float32Array(N), COND = new Float32Array(N), HARD = new Float32Array(N),
	MELT = new Float32Array(N).fill(1e9), MELTTO = new Uint8Array(N), COOL = new Float32Array(N).fill(-1e9), COOLTO = new Uint8Array(N),
	FLAM = new Float32Array(N), SPREAD = new Uint8Array(N), VISC = new Float32Array(N), AIRLOSS = new Float32Array(N), SPAWNT = new Float32Array(N).fill(20),
	LIFE0 = new Uint16Array(N), LIFEV = new Uint16Array(N), PBREAK = new Float32Array(N).fill(1e9);
export const NAMES: string[] = [];
export const COLOR = new Uint8Array(N * 4); // rgb + variance

interface Def { name: string; st: number; c: number[]; v?: number; dens?: number; cond?: number; hard?: number; melt?: number; meltTo?: number; cool?: number; coolTo?: number; flam?: number; spread?: number; visc?: number; airloss?: number; t?: number; life?: number; lifev?: number; pbreak?: number }
function def(id: number, o: Def) {
	NAMES[id] = o.name; ST[id] = o.st; DENS[id] = o.dens ?? 0; COND[id] = o.cond ?? 0.1; HARD[id] = o.hard ?? 0;
	if (o.melt !== undefined) { MELT[id] = o.melt; MELTTO[id] = o.meltTo!; }
	if (o.cool !== undefined) { COOL[id] = o.cool; COOLTO[id] = o.coolTo!; }
	FLAM[id] = o.flam ?? 0; SPREAD[id] = o.spread ?? 0; VISC[id] = o.visc ?? 1; AIRLOSS[id] = o.airloss ?? 0.002;
	SPAWNT[id] = o.t ?? 20; LIFE0[id] = o.life ?? 0; LIFEV[id] = o.lifev ?? 0; PBREAK[id] = o.pbreak ?? 1e9;
	COLOR.set([...o.c, o.v ?? 10], id * 4);
}
def(AIR, { name: 'air', st: EMPTY, c: [0, 0, 0] });
def(STONE, { name: 'stone', st: SOLID, dens: 2.6, cond: 0.22, hard: 0.75, melt: 1250, meltTo: LAVA, c: [150, 128, 136], v: 16, pbreak: 6 });
def(SAND, { name: 'sand', st: POWDER, dens: 1.6, cond: 0.12, hard: 0.08, melt: 1650, meltTo: MGLASS, c: [236, 196, 128], v: 22 });
def(WATER, { name: 'water', st: LIQUID, dens: 1.0, cond: 0.45, spread: 7, melt: 100, meltTo: STEAM, cool: -2, coolTo: ICE, airloss: 0.004, c: [40, 140, 200], v: 6 });
def(LAVA, { name: 'lava', st: LIQUID, dens: 2.5, cond: 0.3, spread: 2, visc: 0.22, cool: 820, coolTo: OBSIDIAN, airloss: 0.0012, t: 1500, c: [255, 110, 30], v: 20 });
def(FIRE, { name: 'fire', st: GAS, dens: -1, cond: 0.5, airloss: 0, t: 950, life: 26, lifev: 30, c: [255, 140, 40], v: 30 });
def(SMOKE, { name: 'smoke', st: GAS, dens: -0.4, cond: 0.05, airloss: 0.02, life: 90, lifev: 140, c: [70, 62, 72], v: 8 });
def(STEAM, { name: 'steam', st: GAS, dens: -0.6, cond: 0.1, airloss: 0.006, t: 130, life: 140, lifev: 160, c: [232, 232, 240], v: 10 });
def(WOOD, { name: 'wood', st: SOLID, dens: 0.7, cond: 0.06, hard: 0.3, flam: 0.05, melt: 290, meltTo: EMBER, c: [150, 92, 54], v: 18, pbreak: 4 });
def(METAL, { name: 'metal', st: SOLID, dens: 7.8, cond: 0.9, hard: 0.92, melt: 1450, meltTo: MOLTEN, c: [150, 164, 182], v: 8 });
def(GLASS, { name: 'glass', st: SOLID, dens: 2.5, cond: 0.2, hard: 0.35, melt: 1400, meltTo: MGLASS, c: [176, 228, 244], v: 10, pbreak: 2.2 });
def(ACID, { name: 'acid', st: LIQUID, dens: 1.1, cond: 0.3, spread: 4, melt: 300, meltTo: SMOKE, c: [130, 255, 70], v: 16 });
def(TNT, { name: 'blast barrel', st: SOLID, dens: 1.6, cond: 0.1, hard: 0.3, c: [214, 60, 52], v: 18 });
def(ICE, { name: 'ice', st: SOLID, dens: 0.92, cond: 0.6, hard: 0.45, melt: 2, meltTo: WATER, t: -20, c: [190, 232, 252], v: 10, pbreak: 3 });
def(OBSIDIAN, { name: 'obsidian', st: SOLID, dens: 2.4, cond: 0.25, hard: 0.85, melt: 1300, meltTo: LAVA, c: [60, 44, 74], v: 10 });
def(RUBBLE, { name: 'rubble', st: POWDER, dens: 2.2, cond: 0.2, hard: 0.12, melt: 1250, meltTo: LAVA, c: [160, 140, 146], v: 24 });
def(EMBER, { name: 'ember', st: SOLID, dens: 0.6, cond: 0.2, hard: 0.1, airloss: 0, t: 760, life: 180, lifev: 260, c: [80, 44, 34], v: 20 });
def(MOLTEN, { name: 'molten metal', st: LIQUID, dens: 7.0, cond: 0.8, spread: 3, visc: 0.5, cool: 1350, coolTo: METAL, t: 1600, c: [255, 170, 80], v: 10 });
def(MGLASS, { name: 'molten glass', st: LIQUID, dens: 2.4, cond: 0.2, spread: 1, visc: 0.15, cool: 1200, coolTo: GLASS, t: 1700, c: [255, 200, 120], v: 10 });
def(BEDROCK, { name: 'bedrock', st: SOLID, dens: 9, cond: 0.1, hard: 2, c: [70, 58, 76], v: 8 });
def(SHARD, { name: 'shards', st: POWDER, dens: 2.5, cond: 0.2, hard: 0.05, melt: 1400, meltTo: MGLASS, c: [200, 240, 252], v: 30 });
def(DIRT, { name: 'earth', st: SOLID, dens: 1.8, cond: 0.12, hard: 0.35, melt: 1300, meltTo: LAVA, c: [168, 110, 78], v: 18, pbreak: 7 });
def(CLOUD, { name: 'cloud', st: GAS, dens: -0.5, cond: 0.05, airloss: 0.02, cool: -40, coolTo: SNOW, c: [236, 230, 238], v: 10 });
def(SNOW, { name: 'snow', st: POWDER, dens: 0.4, cond: 0.2, hard: 0.02, melt: 3, meltTo: WATER, t: -10, c: [246, 250, 255], v: 6 });
def(BRICK, { name: 'brick', st: SOLID, dens: 2.0, cond: 0.18, hard: 0.55, melt: 1350, meltTo: LAVA, c: [196, 98, 74], v: 16, pbreak: 5 });
def(ROOF, { name: 'roof tile', st: SOLID, dens: 1.8, cond: 0.15, hard: 0.4, melt: 1300, meltTo: LAVA, c: [84, 110, 160], v: 12, pbreak: 4 });
def(GRASS, { name: 'grass', st: SOLID, dens: 1.2, cond: 0.1, hard: 0.15, flam: 0.03, melt: 250, meltTo: FIRE, c: [126, 170, 82], v: 22, pbreak: 6 });
def(PLASTER, { name: 'plaster', st: SOLID, dens: 1.9, cond: 0.15, hard: 0.45, melt: 1300, meltTo: LAVA, c: [238, 214, 178], v: 8, pbreak: 4 });
def(TEAL, { name: 'painted plaster', st: SOLID, dens: 1.9, cond: 0.15, hard: 0.45, melt: 1300, meltTo: LAVA, c: [92, 166, 160], v: 8, pbreak: 4 });
def(CLOTH, { name: 'awning', st: SOLID, dens: 0.4, cond: 0.05, hard: 0.1, flam: 0.08, melt: 220, meltTo: FIRE, c: [214, 72, 60], v: 6, pbreak: 2 });
def(TERRA, { name: 'terracotta', st: SOLID, dens: 1.8, cond: 0.15, hard: 0.4, melt: 1300, meltTo: LAVA, c: [200, 104, 64], v: 12, pbreak: 4 });
def(STORM, { name: 'storm water', st: LIQUID, dens: 1.0, cond: 0.45, spread: 7, melt: 100, meltTo: STEAM, cool: -2, coolTo: ICE, airloss: 0.004, c: [22, 66, 118], v: 16 }); // the leviathan's body: sea water with a storm in it
def(FROST, { name: 'wraith ice', st: SOLID, dens: 0.92, cond: 0.6, hard: 0.45, melt: 2, meltTo: WATER, t: -30, c: [88, 146, 206], v: 16, pbreak: 3 }); // the frost wraith's body: blue glacier ice
def(GRIT, { name: 'swarm sand', st: POWDER, dens: 1.6, cond: 0.25, hard: 0.05, melt: 1400, meltTo: MGLASS, c: [170, 118, 58], v: 22 }); // the sand swarm's motes: dark scorched sand
def(BASALT, { name: 'basalt', st: SOLID, dens: 2.9, cond: 0.25, hard: 0.82, melt: 1300, meltTo: LAVA, c: [120, 104, 122], v: 14, pbreak: 9 });

export const isStructural = (t: number) => ST[t] === SOLID;

let rng = 0x9e3779b9;
export function seed(s: number) { rng = (s >>> 0) || 1; }
export function rand() { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; }
export const AMB = 20;
const CS = 32, SH = 5;

export interface Stats { boiled: number; condensed: number; rained: number; frozen: number; melted: number; carved: number; blasts: number; quenched: number }

// Coarse air field (one sample per 4x4 cells): pressure and velocity. Blasts push pressure in, the gradient
// accelerates air, air carries gases and free cells and pushes the hero. Over-pressure shatters glass and cracks stone.
export class Air {
	PW: number; PH: number; p: Float32Array; vx: Float32Array; vy: Float32Array; solid: Uint8Array; tmp: Float32Array;
	constructor(W: number, H: number) {
		this.PW = Math.ceil(W / 4); this.PH = Math.ceil(H / 4); const n = this.PW * this.PH;
		this.p = new Float32Array(n); this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.solid = new Uint8Array(n); this.tmp = new Float32Array(n);
	}
	add(x: number, y: number, r: number, amount: number) {
		const cx = x / 4, cy = y / 4, R = Math.max(1, r / 4);
		for (let j = Math.floor(cy - R); j <= cy + R; j++) for (let i = Math.floor(cx - R); i <= cx + R; i++) {
			if (i < 0 || j < 0 || i >= this.PW || j >= this.PH) continue;
			const d = Math.hypot(i - cx, j - cy) / R; if (d > 1) continue;
			this.p[j * this.PW + i] += amount * (1 - d * 0.7);
		}
	}
	step() {
		const W = this.PW, H = this.PH, p = this.p, vx = this.vx, vy = this.vy, s = this.solid;
		for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
			const k = j * W + i;
			if (s[k]) { vx[k] = 0; vy[k] = 0; continue; }
			vx[k] = (vx[k] - (p[k + 1] - p[k - 1]) * 0.18) * 0.96;
			vy[k] = (vy[k] - (p[k + W] - p[k - W]) * 0.18) * 0.96;
		}
		const t = this.tmp;
		for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
			const k = j * W + i;
			if (s[k]) { t[k] = 0; continue; }
			const div = (vx[k + 1] - vx[k - 1] + vy[k + W] - vy[k - W]) * 0.5;
			t[k] = (p[k] - div * 0.35) * 0.975;
			// light diffusion
			t[k] = t[k] * 0.8 + (p[k - 1] + p[k + 1] + p[k - W] + p[k + W]) * 0.05;
		}
		p.set(t);
	}
	at(x: number, y: number) { const i = Math.min(this.PW - 1, Math.max(0, x >> 2)), j = Math.min(this.PH - 1, Math.max(0, y >> 2)); return j * this.PW + i; }
}

export class World {
	W: number; H: number;
	type: Uint8Array; temp: Float32Array; life: Uint16Array; shade: Uint8Array; clk: Uint8Array; body: Uint16Array;
	cw: number; ch: number;
	cx0: Int16Array; cy0: Int16Array; cx1: Int16Array; cy1: Int16Array; nx0: Int16Array; ny0: Int16Array; nx1: Int16Array; ny1: Int16Array;
	frame = 0; updated = 0; activeChunks = 0; simMs = 0;
	PMAX = 40000; pn = 0;
	px: Float32Array; py: Float32Array; pvx: Float32Array; pvy: Float32Array; pt: Uint8Array; ptemp: Float32Array; pshade: Uint8Array;
	gravity = 60; heatOn = true;
	onExplode: ((x: number, y: number, r: number, power: number) => void) | null = null;
	// only chunks that overlap this window are simulated (the camera plus a margin)
	ax0 = 0; ay0 = 0; ax1 = 1e9; ay1 = 1e9;
	air: Air; wind = 0; cloudLine: number; cloudShape: Int16Array;
	structuralDirty = false; removedSolid = 0;
	stats: Stats = { boiled: 0, condensed: 0, rained: 0, frozen: 0, melted: 0, carved: 0, blasts: 0, quenched: 0 };
	constructor(W: number, H: number) {
		this.W = W; this.H = H; const n = W * H;
		this.type = new Uint8Array(n); this.temp = new Float32Array(n).fill(AMB); this.life = new Uint16Array(n);
		this.shade = new Uint8Array(n); this.clk = new Uint8Array(n); this.body = new Uint16Array(n);
		for (let i = 0; i < n; i++) this.shade[i] = (rand() * 255) | 0;
		this.cw = Math.ceil(W / CS); this.ch = Math.ceil(H / CS); const nc = this.cw * this.ch;
		this.cx0 = new Int16Array(nc); this.cy0 = new Int16Array(nc); this.cx1 = new Int16Array(nc).fill(-1); this.cy1 = new Int16Array(nc).fill(-1);
		this.nx0 = new Int16Array(nc).fill(CS); this.ny0 = new Int16Array(nc).fill(CS); this.nx1 = new Int16Array(nc).fill(-1); this.ny1 = new Int16Array(nc).fill(-1);
		this.px = new Float32Array(this.PMAX); this.py = new Float32Array(this.PMAX); this.pvx = new Float32Array(this.PMAX); this.pvy = new Float32Array(this.PMAX);
		this.pt = new Uint8Array(this.PMAX); this.ptemp = new Float32Array(this.PMAX); this.pshade = new Uint8Array(this.PMAX);
		this.air = new Air(W, H);
		this.cloudLine = Math.round(H * 0.16);
		this.cloudShape = new Int16Array(W); { let a = 0, b = 0; for (let x = 0; x < W; x++) { a += (rand() - 0.5) * 0.6; a *= 0.97; b += a; b *= 0.995; this.cloudShape[x] = Math.round(Math.max(-24, Math.min(24, b))); } }
	}
	inb(x: number, y: number) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
	markRect(x0: number, y0: number, x1: number, y1: number) {
		const W = this.W, H = this.H;
		if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= W) x1 = W - 1; if (y1 >= H) y1 = H - 1;
		if (x0 > x1 || y0 > y1) return;
		for (let cy = y0 >> SH; cy <= y1 >> SH; cy++) for (let cx = x0 >> SH; cx <= x1 >> SH; cx++) {
			const c = cy * this.cw + cx, bx = cx << SH, by = cy << SH;
			const a0 = Math.max(x0 - bx, 0), a1 = Math.min(x1 - bx, CS - 1), b0 = Math.max(y0 - by, 0), b1 = Math.min(y1 - by, CS - 1);
			if (a0 < this.nx0[c]) this.nx0[c] = a0; if (a1 > this.nx1[c]) this.nx1[c] = a1;
			if (b0 < this.ny0[c]) this.ny0[c] = b0; if (b1 > this.ny1[c]) this.ny1[c] = b1;
		}
	}
	wake(x: number, y: number) { this.markRect(x - 1, y - 1, x + 1, y + 1); }
	keep(x: number, y: number) {
		const c = (y >> SH) * this.cw + (x >> SH), lx = x & (CS - 1), ly = y & (CS - 1);
		if (lx < this.nx0[c]) this.nx0[c] = lx; if (lx > this.nx1[c]) this.nx1[c] = lx;
		if (ly < this.ny0[c]) this.ny0[c] = ly; if (ly > this.ny1[c]) this.ny1[c] = ly;
	}
	wakeAll() { this.markRect(0, 0, this.W - 1, this.H - 1); }
	set(x: number, y: number, t: number, temp?: number) {
		if (!this.inb(x, y)) return;
		const i = y * this.W + x;
		if (ST[this.type[i]] === SOLID && t !== this.type[i]) { this.structuralDirty = true; this.removedSolid++; }
		this.type[i] = t; this.temp[i] = temp ?? SPAWNT[t];
		this.life[i] = LIFE0[t] + ((rand() * LIFEV[t]) | 0); this.wake(x, y);
	}
	get(x: number, y: number) { return this.inb(x, y) ? this.type[y * this.W + x] : BEDROCK; }
	fillCircle(cx: number, cy: number, r: number, t: number, onlyEmpty = false) {
		for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
			if ((x - cx) ** 2 + (y - cy) ** 2 > r * r || !this.inb(x, y)) continue;
			if (onlyEmpty && this.type[y * this.W + x] !== AIR) continue;
			this.set(x, y, t);
		}
	}
	swap(i: number, j: number, xi: number, yi: number, xj: number, yj: number) {
		const ty = this.type, tm = this.temp, lf = this.life, sh = this.shade;
		let a = ty[i]; ty[i] = ty[j]; ty[j] = a;
		const b = tm[i]; tm[i] = tm[j]; tm[j] = b;
		a = lf[i]; lf[i] = lf[j]; lf[j] = a;
		a = sh[i]; sh[i] = sh[j]; sh[j] = a;
		this.clk[j] = this.clk[i];
		this.wake(xi, yi); this.wake(xj, yj);
	}
	eject(x: number, y: number, vx: number, vy: number) {
		const i = y * this.W + x, t = this.type[i];
		if (t === AIR || this.pn >= this.PMAX || this.body[i]) return false;
		if (ST[t] === SOLID) { this.structuralDirty = true; this.removedSolid++; }
		const k = this.pn++;
		this.px[k] = x + 0.5; this.py[k] = y + 0.5; this.pvx[k] = vx; this.pvy[k] = vy; this.pt[k] = t; this.ptemp[k] = this.temp[i]; this.pshade[k] = this.shade[i];
		this.type[i] = AIR; this.temp[i] = AMB; this.wake(x, y);
		return true;
	}
	spawnParticle(x: number, y: number, vx: number, vy: number, t: number, temp?: number) {
		if (this.pn >= this.PMAX) return;
		const k = this.pn++;
		this.px[k] = x; this.py[k] = y; this.pvx[k] = vx; this.pvy[k] = vy; this.pt[k] = t; this.ptemp[k] = temp ?? SPAWNT[t]; this.pshade[k] = (rand() * 255) | 0;
	}
	stepParticles(dt: number) {
		const W = this.W, H = this.H, ty = this.type, g = this.gravity, air = this.air;
		let n = this.pn;
		for (let k = 0; k < n; k++) {
			const t = this.pt[k];
			let vx = this.pvx[k], vy = this.pvy[k];
			const gas = ST[t] === GAS;
			const a = air.at(this.px[k] | 0, this.py[k] | 0);
			vx += air.vx[a] * 40 * dt; vy += air.vy[a] * 40 * dt;
			if (t === SNOW) { vy = Math.min(vy + g * 0.3 * dt, 9); vx = vx * 0.97 + (rand() - 0.5) * 160 * dt + this.wind * 20 * dt; } // snow flutters down
			else if (gas) { vx *= 0.9; vy = vy * 0.9 - 30 * dt; } else { vy += g * dt; vx = vx * 0.995 + (rand() - 0.5) * 90 * dt; } // turbulence: falling matter fans out instead of dropping in lines
			const dx = vx * dt, dy = vy * dt;
			const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
			let x = this.px[k], y = this.py[k], dead = false, landed = false;
			for (let s = 0; s < steps; s++) {
				const nx = x + dx / steps, ny = y + dy / steps, ix = nx | 0, iy = ny | 0;
				if (nx < 0 || ny < 0 || ix >= W || iy >= H) { dead = true; break; }
				const o = ty[iy * W + ix];
				if (o !== AIR && ST[o] !== GAS) { landed = true; break; }
				x = nx; y = ny;
			}
			const sp = Math.abs(vx) + Math.abs(vy);
			if (!dead && !landed && gas && sp < 6) landed = true;
			if (landed) {
				let ix = x | 0, iy = y | 0;
				if (!gas && Math.abs(vx) > 4) { // slide along the surface a little, in the direction it was going
					const d = vx > 0 ? 1 : -1, n2 = Math.min(3, Math.floor(Math.abs(vx) / 8) + 1);
					for (let k2 = 0; k2 < n2; k2++) { const nx = ix + d; if (nx < 0 || nx >= W || iy < 0 || iy >= H - 1) break; const j = iy * W + nx; if (ty[j] !== AIR) break; if (ty[j + W] === AIR) break; ix = nx; }
				}
				// find a free cell at or just above the landing point
				for (let up = 0; up < 3 && iy - up >= 0 && ty[(iy - up) * W + ix] !== AIR; up++) if (up === 2) iy = -1; else if (ty[(iy - up - 1) * W + ix] === AIR) { iy = iy - up - 1; break; }
				if (ix >= 0 && iy >= 0 && ix < W && iy < H && ty[iy * W + ix] === AIR) {
					const i = iy * W + ix; ty[i] = t; this.temp[i] = this.ptemp[k]; this.shade[i] = this.pshade[k];
					this.life[i] = LIFE0[t] + ((rand() * LIFEV[t]) | 0); this.wake(ix, iy);
					if (ST[t] === SOLID) this.structuralDirty = true;
				} else if (t === WATER) { // never lose water: try a little higher
					for (let up = 1; up < 12; up++) { const yy = (y | 0) - up; if (yy < 0) break; const i = yy * W + ix; if (ty[i] === AIR) { ty[i] = WATER; this.temp[i] = this.ptemp[k]; this.wake(ix, yy); break; } }
				}
				dead = true;
			}
			if (dead) { n--; this.copyP(n, k); k--; continue; }
			this.px[k] = x; this.py[k] = y; this.pvx[k] = vx; this.pvy[k] = vy;
		}
		this.pn = n;
	}
	copyP(from: number, to: number) {
		this.px[to] = this.px[from]; this.py[to] = this.py[from]; this.pvx[to] = this.pvx[from]; this.pvy[to] = this.pvy[from];
		this.pt[to] = this.pt[from]; this.ptemp[to] = this.ptemp[from]; this.pshade[to] = this.pshade[from];
	}
	// Blast: removes cells by hardness, throws some as particles, cracks the ring, heats it, and pushes the air.
	explode(cx: number, cy: number, r: number, power = 1, fire = true) {
		const W = this.W, R = r * 1.35;
		this.stats.blasts++;
		for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
			if (!this.inb(x, y)) continue;
			const d = Math.hypot(x - cx, y - cy) / r; if (d > 1.35) continue;
			const i = y * W + x, t = this.type[i];
			if (t === AIR) { if (fire && d < 0.8 && rand() < 0.2) this.set(x, y, FIRE); continue; }
			if (this.body[i]) continue;
			const f = power * (1 - d * 0.55);
			if (d <= 1 && HARD[t] < f) {
				const ang = Math.atan2(y - cy, x - cx) + (rand() - 0.5) * 0.7, sp = (30 + 110 * rand() * rand()) * power * (1.15 - d);
				if (t === TNT) { this.type[i] = FIRE; this.life[i] = 20; this.temp[i] = 1200; continue; }
				if (t === WATER) { if (rand() < 0.5) { this.eject(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp - 20); } continue; }
				if (rand() < 0.62 && ST[t] !== GAS) {
					if (t === GLASS || t === ICE) this.type[i] = t === ICE ? ICE : SHARD; else if (t === STONE || t === OBSIDIAN || t === DIRT || t === BRICK || t === BASALT) this.type[i] = RUBBLE;
					if (fire) this.temp[i] += 300 * (1 - d);
					this.eject(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp - (15 + 25 * rand()) * power);
					if (fire && FLAM[t] > 0 && rand() < 0.3) this.spawnParticle(x + 0.5, y + 0.5, Math.cos(ang) * sp * 0.7, Math.sin(ang) * sp * 0.7 - 20, EMBER, 760);
				} else if (fire && rand() < 0.5) { this.set(x, y, rand() < 0.6 ? FIRE : SMOKE); }
				else this.set(x, y, AIR);
			} else if (d < 1.35) {
				if ((t === STONE || t === DIRT || t === BRICK) && rand() < 0.45 * power) { this.set(x, y, RUBBLE, this.temp[i]); }
				else if (t === GLASS) { this.set(x, y, SHARD); }
				if (fire) this.temp[i] += 250 * power * (1.35 - d);
				this.wake(x, y);
			}
		}
		this.air.add(cx, cy, r * 1.6, 6 * power);
		if (this.onExplode) this.onExplode(cx, cy, r, power);
	}
	setActive(x0: number, y0: number, x1: number, y1: number) { this.ax0 = x0 >> SH; this.ay0 = y0 >> SH; this.ax1 = x1 >> SH; this.ay1 = y1 >> SH; }

	step(dt = 1 / 60) {
		const t0 = performance.now();
		this.frame++;
		const W = this.W, H = this.H, ty = this.type, tm = this.temp, lf = this.life, clk = this.clk, body = this.body;
		const par = this.frame & 1 ? 1 : 2;
		const nc = this.cw * this.ch;
		let active = 0;
		const ax0 = this.ax0, ay0 = this.ay0, ax1 = this.ax1, ay1 = this.ay1;
		for (let c = 0; c < nc; c++) {
			const cxx = c % this.cw, cyy = (c / this.cw) | 0;
			const inWin = cxx >= ax0 && cxx <= ax1 && cyy >= ay0 && cyy <= ay1;
			if (!inWin) { this.cx1[c] = -1; continue; } // out of the window: pending work stays in n* until the camera comes back
			this.cx0[c] = this.nx0[c]; this.cy0[c] = this.ny0[c]; this.cx1[c] = this.nx1[c]; this.cy1[c] = this.ny1[c];
			this.nx0[c] = CS; this.ny0[c] = CS; this.nx1[c] = -1; this.ny1[c] = -1;
			if (this.cx1[c] >= 0) active++;
		}
		this.activeChunks = active;
		let updated = 0;
		const flip = this.frame & 1;
		const air = this.air, avx = air.vx, avy = air.vy, PW = air.PW;
		const stats = this.stats, cloudLine = this.cloudLine, wind = this.wind;
		const cloudMass = Math.max(0, stats.condensed - stats.rained), rainBoost = Math.min(8, Math.max(1, cloudMass / 2500));
		for (let cy = Math.min(this.ch - 1, ay1); cy >= Math.max(0, ay0); cy--) {
			for (let q = Math.max(0, ax0); q <= Math.min(this.cw - 1, ax1); q++) {
				const cx = flip ? q : Math.min(this.cw - 1, ax1) + Math.max(0, ax0) - q, c = cy * this.cw + cx;
				if (this.cx1[c] < 0) continue;
				const bx = cx << SH, by = cy << SH;
				const xa = bx + this.cx0[c], xb = Math.min(bx + this.cx1[c], W - 1), ya = by + this.cy0[c], yb = Math.min(by + this.cy1[c], H - 1);
				for (let y = yb; y >= ya; y--) {
					const row = y * W;
					for (let xx = xa; xx <= xb; xx++) {
						const x = flip ? xx : xa + xb - xx;
						const i = row + x;
						const t = ty[i];
						if (t === AIR || clk[i] === par || body[i]) continue;
						clk[i] = par; updated++;
						const st = ST[t];
						if (this.heatOn) {
							const r = rand();
							const j = r < 0.25 ? (x > 0 ? i - 1 : -1) : r < 0.5 ? (x < W - 1 ? i + 1 : -1) : r < 0.75 ? (y > 0 ? i - W : -1) : (y < H - 1 ? i + W : -1);
							if (j >= 0) {
								const o = ty[j];
								if (o === AIR) { const k = AIRLOSS[t]; if (k > 0) tm[i] += (AMB - tm[i]) * k; }
								else if (!body[j]) {
									const k = (COND[t] < COND[o] ? COND[t] : COND[o]) * 0.5;
									const d = (tm[j] - tm[i]) * k;
									if (d > 0.05 || d < -0.05) { tm[i] += d; tm[j] -= d; if (d > 2 || d < -2) this.keep(j % W, (j / W) | 0); }
								}
							}
							const T = tm[i];
							if (T > MELT[t]) {
								const nt = MELTTO[t];
								if (t === WATER) stats.boiled++; else if (st === SOLID) { stats.melted++; this.structuralDirty = true; this.removedSolid++; }
								ty[i] = nt; lf[i] = LIFE0[nt] + ((rand() * LIFEV[nt]) | 0);
								if (nt === EMBER) tm[i] = 760;
								this.wake(x, y); continue;
							}
							if (T < COOL[t] && (t !== STEAM)) {
								const nt = COOLTO[t]; ty[i] = nt; if (nt === ICE) stats.frozen++; else if (t === LAVA) stats.quenched++;
								if (ST[nt] === SOLID) this.structuralDirty = true;
								this.wake(x, y); continue;
							}
							if (T > AMB + 3 || T < AMB - 3) this.keep(x, y);
						}
						if (st === POWDER) {
							if (y < H - 2) {
								const b = i + W;
								if (ty[b] === AIR && ty[b + W] === AIR && !body[b] && !body[b + W] && rand() < 0.55) { // irregular release: no evenly spaced strings
									const a = ((y >> 2) * PW + (x >> 2));
									const side = ty[b - 1] === AIR ? -1 : ty[b + 1] === AIR ? 1 : 0; // spills off an edge sideways, like real grains
									if (this.eject(x, y, side * (4 + rand() * 10) + (rand() < 0.5 ? -1 : 1) * (3 + rand() * 11) + avx[a] * 30, rand() * 16)) continue; // never straight down: grains fan out
								}
							}
							if (y < H - 1) {
								const b = i + W, ob = ty[b];
								if (ob === AIR || ((ST[ob] === LIQUID || ST[ob] === GAS) && DENS[ob] < DENS[t] && rand() < 0.6)) { if (!body[b]) { this.swap(i, b, x, y, x, y + 1); continue; } }
								if (t === SNOW && rand() < 0.6) continue; // snow sticks a bit
								const d = rand() < 0.5 ? -1 : 1;
								const x1 = x + d, x2 = x - d;
								if (x1 >= 0 && x1 < W) { const j = b + d, o = ty[j]; if ((o === AIR || (ST[o] === LIQUID && DENS[o] < DENS[t] && rand() < 0.3)) && !body[j]) { this.swap(i, j, x, y, x1, y + 1); continue; } }
								if (x2 >= 0 && x2 < W) { const j = b - d, o = ty[j]; if ((o === AIR || (ST[o] === LIQUID && DENS[o] < DENS[t] && rand() < 0.3)) && !body[j]) { this.swap(i, j, x, y, x2, y + 1); continue; } }
							}
						} else if (st === LIQUID) {
							if (t === LAVA || t === ACID || t === MOLTEN) this.react(i, x, y, t);
							if (ty[i] !== t) continue;
							if (y < H - 2 && x > 0 && x < W - 1 && ty[i + W] === AIR && ty[i + 2 * W] === AIR && ty[i - 1] === AIR && ty[i + 1] === AIR && !body[i + W]) {
								const a = ((y >> 2) * PW + (x >> 2));
								if (this.eject(x, y, (rand() - 0.5) * 6 + avx[a] * 30, 4 + rand() * 8)) continue;
							}
							if (y < H - 1) {
								const b = i + W, ob = ty[b];
								if ((ob === AIR || ((ST[ob] === LIQUID || ST[ob] === GAS) && DENS[ob] < DENS[t] && rand() < 0.5)) && !body[b]) { this.swap(i, b, x, y, x, y + 1); continue; }
								const d = rand() < 0.5 ? -1 : 1;
								if (x + d >= 0 && x + d < W && ty[b + d] === AIR && !body[b + d]) { this.swap(i, b + d, x, y, x + d, y + 1); continue; }
								if (x - d >= 0 && x - d < W && ty[b - d] === AIR && !body[b - d]) { this.swap(i, b - d, x, y, x - d, y + 1); continue; }
							}
							if (rand() < VISC[t]) {
								const d = ((this.frame + y) & 1) ? 1 : -1, s = SPREAD[t];
								let best = -1, bx2 = x;
								for (let k = 1; k <= s; k++) { const xx2 = x + d * k; if (xx2 < 0 || xx2 >= W) break; const j = row + xx2; if (ty[j] !== AIR || body[j]) break; best = j; bx2 = xx2; }
								if (best >= 0) { this.swap(i, best, x, y, bx2, y); continue; }
							}
						} else if (st === GAS) {
							this.keep(x, y);
							const a = ((y >> 2) * PW + (x >> 2));
							const awx = avx[a] + (t === CLOUD || t === STEAM ? wind : 0), awy = avy[a];
							if (t === CLOUD) {
								// clouds: drift with the wind, hold their altitude band, clump, and rain when dense
								const rr = rand();
								if (y > 1 && y < H - 2) {
									let nb = 0; if (ty[i - 1] === CLOUD) nb++; if (ty[i + 1] === CLOUD) nb++; if (ty[i - W] === CLOUD) nb++; if (ty[i + W] === CLOUD) nb++;
									if (nb >= 3 && ty[i + W] !== CLOUD && rr < 0.0035 * nb * rainBoost) { // rain from the underside
										ty[i] = AIR; tm[i] = AMB; stats.rained++;
										this.spawnParticle(x + rand() * 3 - 1, y + 1.2, wind * 22 + (rand() - 0.5) * 9, 10 + rand() * 14, WATER, 14);
										this.wake(x, y); continue;
									}
									if (nb === 0 && rr < 0.002) { ty[i] = AIR; tm[i] = AMB; stats.rained++; this.spawnParticle(x + rand() * 3 - 1, y + 1.2, wind * 22 + (rand() - 0.5) * 9, 12, WATER, 14); this.wake(x, y); continue; }
								}
								let dx = 0, dy = 0;
								if (rand() < Math.min(0.9, Math.abs(awx) * 0.6 + 0.08)) dx = awx > 0 ? 1 : awx < 0 ? -1 : (rand() < 0.5 ? -1 : 1);
								const band = cloudLine + this.cloudShape[x] ;
								if (y > band + 18 && rand() < 0.5) dy = -1; else if (y < band - 22 && rand() < 0.3) dy = 1; else if (rand() < 0.22) dy = rand() < 0.5 ? -1 : 1;
								if (awy < -0.5 && rand() < 0.5) dy = -1;
								if (dx === 0 && dy === 0) continue;
								const nx = x + dx, ny = y + dy;
								if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
								const j = ny * W + nx;
								if (ty[j] === AIR && !body[j]) {
									// cohesion: don't step away from the mass unless the wind pushes
									let nb2 = 0; if (ty[j - 1] === CLOUD) nb2++; if (ty[j + 1] === CLOUD) nb2++; if (j - W >= 0 && ty[j - W] === CLOUD) nb2++; if (j + W < ty.length && ty[j + W] === CLOUD) nb2++;
									if (nb2 >= 2 || rand() < 0.25 + Math.abs(awx) * 0.4) this.swap(i, j, x, y, nx, ny);
								}
								continue;
							}
							let l = lf[i];
							if (l > 0) { l--; lf[i] = l; }
							if (t === STEAM && (y <= cloudLine + 10 || l === 0)) {
								// steam that reaches the cold air up high (or has drifted long enough) condenses into cloud
								if (y <= cloudLine + 10 || rand() < 0.5) { ty[i] = CLOUD; tm[i] = 10; stats.condensed++; this.wake(x, y); continue; }
								lf[i] = 40;
							}
							if (l === 0 && t !== STEAM) {
								if (t === FIRE) { ty[i] = rand() < 0.35 ? SMOKE : AIR; lf[i] = LIFE0[SMOKE] + ((rand() * LIFEV[SMOKE]) | 0); tm[i] = ty[i] === AIR ? AMB : 200; }
								else { ty[i] = AIR; tm[i] = AMB; }
								this.wake(x, y); continue;
							}
							if (t === FIRE) { tm[i] = 950; this.ignite(i, x, y); }
							if (y > 0) {
								// rise, biased by the air field
								let d = 0; const r = rand();
								if (awx > 0.3 && r < 0.5) d = 1; else if (awx < -0.3 && r < 0.5) d = -1; else if (t === STEAM) d = r < 0.18 ? -1 : r < 0.36 ? 1 : 0; else d = r < 0.33 ? -1 : r < 0.66 ? 1 : 0;
								const up = awy > 0.6 ? i + W : i - W;
								const j = up + d;
								if (x + d >= 0 && x + d < W && j >= 0 && j < ty.length && rand() < (t === STEAM ? 0.9 : 0.8)) {
									const o = ty[j];
									if ((o === AIR || (ST[o] === GAS && o !== t && o !== CLOUD && rand() < 0.3)) && !body[j]) { this.swap(i, j, x, y, x + d, (j / W) | 0); continue; }
								}
								const dd = rand() < 0.5 ? -1 : 1;
								if (x + dd >= 0 && x + dd < W && ty[i + dd] === AIR && !body[i + dd]) { this.swap(i, i + dd, x, y, x + dd, y); continue; }
							} else if (t === STEAM) { ty[i] = CLOUD; } else { ty[i] = AIR; tm[i] = AMB; }
						} else if (st === SOLID) {
							if (t === EMBER) {
								let l = lf[i]; if (l > 0) lf[i] = --l;
								tm[i] = 760; this.keep(x, y);
								if (y > 0 && ty[i - W] === AIR && rand() < 0.12) { this.set(x, y - 1, FIRE); }
								if (rand() < 0.08) this.ignite(i, x, y);
								if (l === 0) { ty[i] = rand() < 0.5 ? SMOKE : AIR; lf[i] = 60; tm[i] = 200; this.structuralDirty = true; this.removedSolid++; this.wake(x, y); }
							} else if (t === TNT) {
								if (tm[i] > 220) { this.explode(x, y, 10, 1.15); }
							}
							// over-pressure breaks brittle solids
							const a = ((y >> 2) * PW + (x >> 2));
							if (air.p[a] > PBREAK[t] && rand() < 0.2) {
								if (t === GLASS || t === ICE) { ty[i] = SHARD; } else if (t === WOOD) { ty[i] = RUBBLE; } else ty[i] = RUBBLE;
								this.structuralDirty = true; this.removedSolid++;
								this.eject(x, y, avx[a] * 60 + (rand() - 0.5) * 20, avy[a] * 60 - 10);
							}
						}
					}
				}
			}
		}
		this.updated = updated;
		this.stepAir();
		this.stepParticles(dt);
		this.simMs = performance.now() - t0;
		return this.simMs;
	}
	stepAir() {
		const air = this.air, PW = air.PW, PH = air.PH, W = this.W;
		// mark coarse cells that are mostly solid (only near the window, every few frames)
		if (this.frame % 8 === 0) {
			const i0 = Math.max(0, (this.ax0 << SH) >> 2), i1 = Math.min(PW - 1, ((this.ax1 + 1) << SH) >> 2), j0 = Math.max(0, (this.ay0 << SH) >> 2), j1 = Math.min(PH - 1, ((this.ay1 + 1) << SH) >> 2);
			for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
				let n = 0; for (let yy = 0; yy < 4; yy += 2) for (let xx = 0; xx < 4; xx += 2) { const x = i * 4 + xx, y = j * 4 + yy; if (x < W && y < this.H && ST[this.type[y * W + x]] === SOLID) n++; }
				air.solid[j * PW + i] = n >= 3 ? 1 : 0;
			}
		}
		air.step();
	}
	ignite(i: number, x: number, y: number) {
		const W = this.W, ty = this.type;
		const r = rand(); const j = r < 0.25 ? i - 1 : r < 0.5 ? i + 1 : r < 0.75 ? i - W : i + W;
		if (j < 0 || j >= ty.length) return;
		const o = ty[j];
		if (FLAM[o] > 0 && rand() < FLAM[o] * 3) { this.temp[j] += 120; this.keep(j % W, (j / W) | 0); }
		if (o === TNT) this.temp[j] = 400;
		if (o === ICE || o === SNOW) this.temp[j] += 30;
	}
	react(i: number, x: number, y: number, t: number) {
		const W = this.W, ty = this.type, tm = this.temp;
		const r = rand(); const j = r < 0.25 ? (x > 0 ? i - 1 : -1) : r < 0.5 ? (x < W - 1 ? i + 1 : -1) : r < 0.75 ? (y > 0 ? i - W : -1) : (y < this.H - 1 ? i + W : -1);
		if (j < 0 || this.body[j]) return;
		const o = ty[j];
		if (t === LAVA || t === MOLTEN) {
			if (o === WATER || o === ICE || o === SNOW) { ty[j] = STEAM; tm[j] = 140; this.life[j] = 120 + ((rand() * 160) | 0); tm[i] -= 420; this.stats.boiled++; this.wake(j % W, (j / W) | 0); }
			else if (FLAM[o] > 0) tm[j] += 200;
			else if (o === TNT) tm[j] = 500;
		} else if (t === ACID) {
			if (o !== AIR && o !== ACID && o !== GLASS && o !== BEDROCK && ST[o] !== GAS && rand() < 0.12) {
				if (ST[o] === SOLID) { this.structuralDirty = true; this.removedSolid++; }
				ty[j] = rand() < 0.4 ? SMOKE : AIR; this.life[j] = 40; tm[j] = 60;
				if (rand() < 0.3) { ty[i] = SMOKE; this.life[i] = 40; }
				this.wake(j % W, (j / W) | 0); this.wake(x, y);
			}
		}
	}
	count(t: number, x0 = 0, y0 = 0, x1 = this.W - 1, y1 = this.H - 1) {
		let n = 0; const ty = this.type, W = this.W;
		for (let y = y0; y <= y1; y++) for (let x = x0, i = y * W + x0; x <= x1; x++, i++) if (ty[i] === t) n++;
		for (let k = 0; k < this.pn; k++) if (this.pt[k] === t) n++;
		return n;
	}
	census() { const c = new Uint32Array(N); for (let i = 0; i < this.type.length; i++) c[this.type[i]]++; for (let k = 0; k < this.pn; k++) c[this.pt[k]]++; return c; }
}
