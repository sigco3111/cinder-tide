// The arena: a coastal island at golden hour. Left to right: open sea with a rock islet, a beach, sea cliffs with a
// lighthouse, a town on the plateau, caves under it, a rock arch over a gully, and a volcano with a crater lake and a
// magma chamber. Generated from the seed, all in cells (10 cm).
import * as S from '../engine/sim';

export interface House { x0: number; x1: number; y0: number; y1: number }
export interface ArenaInfo {
	W: number; H: number; sea: number; seaX1: number; plateau: number; town: House[]; townBox: [number, number, number, number];
	spawn: { x: number; y: number }; volcano: { x: number; top: number; chamber: [number, number] }; arch: [number, number, number, number];
	ground: Int32Array; caveMouth: { x: number; y: number }; crater: { x: number; y: number };
}

export function noise1(seedv: number) {
	const p: number[] = []; let s = seedv >>> 0 || 1;
	for (let i = 0; i < 1024; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; p.push((s >>> 0) / 4294967296); }
	return (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return p[i & 1023] * (1 - u) + p[(i + 1) & 1023] * u; };
}

export function buildArena(w: S.World, seedv: number): ArenaInfo {
	const W = w.W, H = w.H, ty = w.type;
	const n = noise1(seedv), n2 = noise1(seedv * 7 + 3), n3 = noise1(seedv * 13 + 5);
	const SEA = Math.round(H * 0.54), PLAT = Math.round(H * 0.36);
	const seaX1 = 520;
	const ground = new Int32Array(W);
	const VX = 1430, VTOP = Math.round(H * 0.17);
	for (let x = 0; x < W; x++) {
		let g: number;
		if (x < 400) g = SEA + 120 + (n(x / 60) - 0.5) * 40 - Math.max(0, 1 - ((x - 190) / 46) ** 2) * 142 - Math.max(0, 1 - ((x - 190) / 20) ** 2) * 10; // sea floor with an islet
		else if (x < seaX1) g = SEA + 120 - (x - 400) / 120 * 130 + (n(x / 30) - 0.5) * 10;
		else if (x < 640) g = SEA - 10 - (x - seaX1) / 120 * 26 + (n2(x / 20) - 0.5) * 4; // beach
		else if (x < 680) g = SEA - 36 - (x - 640) / 40 * (SEA - 36 - PLAT); // cliff face
		else if (x < 1110) g = PLAT + (n(x / 80) - 0.5) * 8; // town plateau
		else if (x < 1260) { const u = (x - 1110) / 150; g = PLAT + Math.sin(u * Math.PI) * 70 + (n2(x / 25) - 0.5) * 6; } // gully under the arch
		else { const d = Math.abs(x - VX); g = VTOP + Math.max(0, d - 18) * 1.05 + (n3(x / 18) - 0.5) * 8; if (d < 18) g = VTOP + 26 - (18 - d) * 0.6; g = Math.min(g, PLAT + 40); } // volcano and crater
		ground[x] = Math.max(20, Math.min(H - 8, Math.round(g)));
	}
	for (let x = 0; x < W; x++) {
		const g = ground[x];
		for (let y = g; y < H; y++) {
			const d = y - g; let t = S.STONE;
			if (y >= H - 4) t = S.BEDROCK;
			else if (x >= 1260) t = d < 3 && Math.abs(x - VX) > 30 ? S.BASALT : (((y + n(x / 40) * 10) % 23) < 2 ? S.OBSIDIAN : S.BASALT);
			else if (x < seaX1 + 10 && g > SEA) t = d < 4 + n2(x / 7) * 4 ? S.SAND : S.STONE;
			else if (x < 640) t = d < 10 + n2(x / 9) * 5 ? S.SAND : S.STONE;
			else if (d < 2 && x >= 680 && x < 1110) t = S.GRASS;
			else if (d < 7 + n2(x / 11) * 5) t = S.DIRT;
			else if (((y + n(x / 90) * 14 + n2(x / 31) * 4) % 41) < 2.2 + n3(x / 17) * 1.8) t = S.BASALT;
			ty[y * W + x] = t;
		}
	}
	// the sea
	for (let x = 0; x < 640; x++) for (let y = SEA; y < ground[x]; y++) ty[y * W + x] = S.WATER;
	// caves under the plateau: worm tunnels, plus a cave mouth in the cliff
	const carve = (cx: number, cy: number, r: number) => { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) { if (x < 0 || y < 0 || x >= W || y >= H - 6) continue; if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) { const i = y * W + x; if (ty[i] !== S.WATER) ty[i] = S.AIR; } } };
	const worm = (x: number, y: number, len: number, dir: number, r0: number, k: number) => {
		let a = dir;
		for (let s = 0; s < len; s++) { a += (n2(s * 0.05 + k) - 0.5) * 0.25; x += Math.cos(a) * 2; y += Math.sin(a) * 1.2; y = Math.max(PLAT + 30, Math.min(H - 40, y)); carve(x, y, r0 + n3(s * 0.07 + k) * 6); }
		return { x, y };
	};
	worm(690, PLAT + 60, 170, 0.1, 8, 1); worm(820, PLAT + 120, 160, -0.2, 7, 5); worm(980, PLAT + 90, 150, 0.35, 9, 9);
	const mouth = { x: 672, y: SEA - 50 };
	for (let k = 0; k < 30; k++) carve(660 + k * 1.6, SEA - 46 - k * 0.6, 9);
	// magma chamber under the volcano, feeding a pipe up into a crater lake
	const chamber: [number, number] = [VX - 40, Math.round(H * 0.66)];
	for (let y = chamber[1] - 30; y < chamber[1] + 30; y++) for (let x = chamber[0] - 70; x < chamber[0] + 70; x++) {
		if (((x - chamber[0]) / 70) ** 2 + ((y - chamber[1]) / 30) ** 2 < 1 && y < H - 6) { const i = y * W + x; ty[i] = S.LAVA; w.temp[i] = 1500; }
	}
	for (let y = VTOP + 20; y < chamber[1]; y++) for (let x = VX - 4 + Math.round(Math.sin(y * 0.05) * 6); x < VX + 4 + Math.round(Math.sin(y * 0.05) * 6); x++) {
		const i = y * W + x; if (ty[i] !== S.AIR) { ty[i] = y < VTOP + 40 ? S.OBSIDIAN : S.LAVA; w.temp[i] = y < VTOP + 40 ? 600 : 1500; }
	}
	for (let x = VX - 16; x <= VX + 16; x++) for (let y = ground[x] - 1; y >= VTOP + 14; y--) { if (ty[y * W + x] === S.AIR) { ty[y * W + x] = S.LAVA; w.temp[y * W + x] = 1500; } }
	// lava pocket near the deep caves (under the arch)
	for (let y = PLAT + 150; y < PLAT + 185; y++) for (let x = 1120; x < 1200; x++) if (((x - 1160) / 40) ** 2 + ((y - PLAT - 168) / 17) ** 2 < 1) { const i = y * W + x; ty[i] = S.LAVA; w.temp[i] = 1450; }
	// the rock arch over the gully
	const arch: [number, number, number, number] = [1120, PLAT - 14, 1262, PLAT + 6];
	for (let x = arch[0]; x <= arch[2]; x++) { const u = (x - arch[0]) / (arch[2] - arch[0]); const top = Math.round(PLAT - 12 + Math.sin(u * Math.PI) * -4); const th = Math.round(14 + Math.abs(u - 0.5) * 16); for (let y = top; y < top + th; y++) if (ty[y * W + x] === S.AIR) ty[y * W + x] = n((x + y) / 7) > 0.5 ? S.BASALT : S.STONE; }
	// the town
	const town: House[] = [];
	const house = (x0: number, wid: number, floors: number, style: number) => {
		let gy = 1e9; for (let x = x0; x < x0 + wid; x++) gy = Math.min(gy, ground[x]);
		const fh = 13, hgt = floors * fh + 3, top = gy - hgt;
		const wallT = [S.BRICK, S.PLASTER, S.TEAL, S.WOOD, S.PLASTER][style % 5];
		const roofT = [S.ROOF, S.TERRA, S.TERRA, S.ROOF, S.ROOF][style % 5];
		const flat = style === 2;
		const doorX = style % 2 ? wid - 9 : 4;
		for (let x = x0; x < x0 + wid; x++) {
			for (let y = gy; y < ground[x] + 1; y++) ty[y * W + x] = S.STONE;
			for (let y = top; y < gy; y++) {
				const lx = x - x0, ly = y - top, fl = (ly - 3) % fh, floorN = Math.floor((ly - 3) / fh);
				const wall = lx < 2 || lx >= wid - 2;
				const floor = ly >= 3 && fl < 2;
				const ground1 = floorN === floors - 1;
				const door = ground1 && lx >= doorX && lx < doorX + 5 && fl >= 4;
				const win = !wall && !floor && !door && fl > 3 && fl < 10 && (lx % 8) > 2 && (lx % 8) < 6 && !(ground1 && Math.abs(lx - doorX - 2) < 6);
				let t: number;
				if (ly < 3) t = flat ? S.PLASTER : roofT;
				else if (door) t = S.WOOD;
				else if (win) t = S.GLASS;
				else t = wallT;
				ty[y * W + x] = t;
			}
		}
		if (!flat) {
			const steep = style === 3 ? 0.9 : 0.55;
			for (let k = 0; k < Math.floor(wid / 2); k++) for (let x = x0 + k; x < x0 + wid - k; x++) { const y = top - 1 - Math.floor(k * steep); if (y > 0 && k < wid / 2 - 1 && x >= 0) ty[y * W + x] = roofT; }
		} else { for (let x = x0 - 1; x <= x0 + wid; x++) ty[(top - 1) * W + x] = S.TEAL; for (const x of [x0 - 1, x0 + wid]) for (let y = top - 3; y < top; y++) ty[y * W + x] = S.TEAL; }
		if (style !== 2 && wid > 26) { const cx = x0 + wid - 8; for (let y = top - Math.floor(wid * 0.3); y < top - 1; y++) for (let x = cx; x < cx + 3; x++) ty[y * W + x] = S.BRICK; }
		if (style === 1 || style === 4) { const ay = gy - 10; for (let x = x0 + doorX - 2; x < x0 + doorX + 7; x++) { ty[ay * W + x] = S.CLOTH; ty[(ay + 1) * W + x] = ((x >> 1) & 1) ? S.CLOTH : S.PLASTER; } }
		town.push({ x0, x1: x0 + wid, y0: top - Math.floor(wid * 0.5), y1: gy });
	};
	let x = 740; let k = 0;
	const widths = [30, 24, 38, 28, 34, 26, 32], floorsL = [2, 1, 3, 2, 1, 3, 2];
	while (x < 1060 && k < widths.length) { const wd = widths[k]; house(x, wd, floorsL[(k + seedv) % 7], (k + seedv) % 5); x += wd + 10 + ((k * 7) % 9); k++; }
	// lighthouse at the cliff edge
	{
		const lx = 690, gy = ground[lx + 6];
		for (let y = gy - 70; y < gy; y++) for (let xx = lx; xx < lx + 12; xx++) { const ly = gy - y; ty[y * W + xx] = ly > 62 ? S.GLASS : (Math.floor(ly / 8) % 2 ? S.BRICK : S.STONE); if (xx > lx + 2 && xx < lx + 9 && ly < 60 && ly > 2) ty[y * W + xx] = S.AIR; }
		for (let xx = lx - 2; xx < lx + 14; xx++) ty[(gy - 72) * W + xx] = S.METAL;
		for (let y = gy; y < ground[lx] + 1; y++) for (let xx = lx; xx < lx + 12; xx++) ty[y * W + xx] = S.STONE;
		town.push({ x0: lx, x1: lx + 12, y0: gy - 72, y1: gy });
	}
	// water tower on metal legs
	{
		const tx = 1070, gy = ground[tx + 10];
		for (let y = gy - 40; y < gy; y++) { for (const lx of [tx, tx + 1, tx + 18, tx + 19]) ty[y * W + lx] = S.METAL; if ((gy - y) % 10 === 0) for (let xx = tx; xx < tx + 20; xx++) ty[y * W + xx] = S.METAL; }
		for (let y = gy - 62; y < gy - 40; y++) for (let xx = tx - 2; xx < tx + 22; xx++) { const edge = xx < tx || xx > tx + 19 || y === gy - 41 || y < gy - 60; ty[y * W + xx] = edge ? S.METAL : S.WATER; }
		town.push({ x0: tx - 2, x1: tx + 22, y0: gy - 62, y1: gy });
	}
	// a few blast barrels near the gully (the dangerous bit)
	for (const bxp of [1100, 1104]) { const gy = ground[bxp]; for (let y = gy - 6; y < gy; y++) for (let xx = bxp; xx < bxp + 4; xx++) ty[y * W + xx] = S.TNT; }
	for (let i = 0; i < W * H; i++) { const t = ty[i]; if (t !== S.LAVA && !(t === S.OBSIDIAN && w.temp[i] > 100)) w.temp[i] = S.SPAWNT[t]; w.life[i] = S.LIFE0[t] + ((S.rand() * S.LIFEV[t]) | 0); }
	w.cloudLine = Math.round(H * 0.14);
	w.wakeAll();
	let tx0 = 1e9, ty0 = 1e9, tx1 = 0, ty1 = 0; for (const hh of town) { tx0 = Math.min(tx0, hh.x0); tx1 = Math.max(tx1, hh.x1); ty0 = Math.min(ty0, hh.y0); ty1 = Math.max(ty1, hh.y1); }
	return {
		W, H, sea: SEA, seaX1: 640, plateau: PLAT, town, townBox: [tx0, ty0, tx1, ty1], spawn: { x: 712, y: ground[712] }, ground,
		volcano: { x: VX, top: VTOP, chamber }, arch, caveMouth: mouth, crater: { x: VX, y: VTOP + 14 },
	};
}

export function townCells(w: S.World, a: ArenaInfo) {
	const [x0, y0, x1, y1] = a.townBox; let n = 0;
	for (let y = Math.max(0, y0 - 4); y <= y1; y++) for (let x = x0; x <= x1; x++) { const t = w.type[y * w.W + x]; if (t === S.BRICK || t === S.WOOD || t === S.GLASS || t === S.ROOF || (t === S.METAL)) n++; }
	return n;
}

// A test course for the animation harness: loose sand mounds, steps, a ledge, a pit and a ramp (same layout as the spike).
export function buildRunway(w: S.World, seedv: number): ArenaInfo {
	const W = w.W, H = w.H, n = noise1(seedv);
	const ground = new Int32Array(W);
	const base = Math.round(H * 0.6);
	for (let x = 0; x < W; x++) {
		const u = x / 800; let h = base + (n(x / 40) - 0.5) * 10;
		if (u > 0.2 && u < 0.28) h -= 10;
		if (u > 0.28 && u < 0.34) h -= 18;
		if (u > 0.47 && u < 0.53) h += 22;
		if (u > 0.78 && u < 1) h -= (u - 0.78) * 120;
		ground[x] = Math.round(Math.min(H - 6, h));
	}
	for (let x = 0; x < W; x++) for (let y = ground[x]; y < H; y++) w.type[y * W + x] = y >= H - 4 ? S.BEDROCK : (y - ground[x] < 4 ? S.DIRT : S.STONE);
	const mound = (cx: number, r: number, hgt: number) => { for (let x = cx - r; x <= cx + r; x++) { const dh = Math.round(hgt * (1 - ((x - cx) / r) ** 2)); for (let y = ground[x] - dh; y < ground[x]; y++) w.type[y * W + x] = S.SAND; ground[x] -= dh; } };
	mound(96, 26, 9); mound(320, 34, 12); mound(512, 40, 7);
	// rough ground for the jitter harness: broken stone with holes, rubble-strewn stretches, a bumpy stretch, a steep bank
	const n2 = noise1(seedv * 5 + 1);
	for (let x = 130; x < 160; x++) { const holes = Math.floor(n2(x * 0.9) * 4); for (let y = ground[x]; y < ground[x] + holes; y++) w.type[y * W + x] = S.AIR; if (holes) ground[x] += holes; }
	for (const [x0, x1] of [[176, 216], [560, 604]]) for (let x = x0; x < x1; x++) { const dh = Math.max(0, Math.round((n2(x * 0.37) - 0.35) * 7)); for (let y = ground[x] - dh; y < ground[x]; y++) w.type[y * W + x] = S.RUBBLE; ground[x] -= dh; }
	for (let x = 440; x < 500; x++) { const dh = Math.round((n2(x * 0.6) - 0.5) * 4); if (dh > 0) { for (let y = ground[x] - dh; y < ground[x]; y++) w.type[y * W + x] = S.STONE; ground[x] -= dh; } else if (dh < 0) { for (let y = ground[x]; y < ground[x] - dh; y++) w.type[y * W + x] = S.AIR; ground[x] -= dh; } }
	for (let x = 690; x < 720; x++) { const dh = Math.round((x - 690) * 0.7); for (let y = ground[x] - dh; y < ground[x]; y++) w.type[y * W + x] = S.STONE; ground[x] -= dh; }
	for (let i = 0; i < W * H; i++) w.temp[i] = S.SPAWNT[w.type[i]];
	w.wakeAll();
	return { W, H, sea: H - 10, seaX1: 0, plateau: base, town: [{ x0: 0, x1: 1, y0: 0, y1: 1 }], townBox: [0, 0, 1, 1], spawn: { x: 40, y: ground[40] }, ground, volcano: { x: 1500, top: 100, chamber: [1500, 400] }, arch: [0, 0, 0, 0], caveMouth: { x: 0, y: 0 }, crater: { x: 1500, y: 100 } };
}
