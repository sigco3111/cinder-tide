// The game: fixed 60 Hz steps, a camera over a world larger than the screen (only the region near it simulates),
// the powers, the enemy waves, the bosses, the tutorial, the water-cycle meters and all the juice (shake, hit-stop, flashes,
// sound on every event). Test hooks live on window.__game.
import * as S from '../engine/sim';
import { Renderer, GOLDEN } from '../engine/render';
import { Bodies } from '../engine/bodies';
import { Hero } from '../engine/hero';
import { buildArena, buildRunway, townCells, type ArenaInfo } from './arena';
import { Fx } from './fx';
import { Enemies, type Mob } from './enemies';
import { Bosses } from './bosses';
import { Style, COMBOS } from './combat';
import { Powers } from './powers';
import { Input, type Intent } from './input';
import { Sound } from '../audio/audio';
import { UI } from '../ui/ui';
import { PadMenu } from '../ui/padmenu';

const VIEW_GROUND = 228, VIEW_FLY = 262; // cells visible vertically: the hero (18 cells) is ~7-8% of the screen
const DT = 1 / 60;

type Mode = 'title' | 'story' | 'sandbox' | 'arena' | 'titan' | 'leviathan';
type PlayMode = Exclude<Mode, 'title'>;
// Arena waves: 6 to 10 enemies each, mixed so every counter gets used
const ARENA_WAVES: [string, number][][] = [
	[['crawler', 3], ['wraith', 2], ['brute', 1]],
	[['crawler', 3], ['swarm', 1], ['wraith', 2], ['brute', 1]],
	[['crawler', 4], ['brute', 2], ['wraith', 2], ['swarm', 2]],
];
const TUTORIAL = [
	{ t: 'Move and jump', b: 'A and D to run, Space to jump. Gamepad: left stick and A.', p: 'Left stick to run, {A} to jump.', done: (g: Game) => g.tut.moved > 60 && g.tut.jumped },
	{ t: 'Fly', b: 'Press Space again in the air to fly. Steer with W A S D. C stops flying.', p: 'Press {A} again in the air to fly. Steer with the left stick. {Y} stops flying.', done: (g: Game) => g.tut.flyTime > 1.2 },
	{ t: 'Boil the sea', b: 'Hold the left mouse button over the sea: the Magma Lance boils it into steam. Watch the steam rise into clouds.', p: 'Aim at the sea with the right stick and hold {RT}: the Magma Lance boils it into steam. Watch the steam rise into clouds.', done: (g: Game) => g.w.stats.boiled - g.tut.boil0 > 600 },
	{ t: 'Lava Blast', b: 'Hold the right mouse button to charge, release to blast.', p: 'Hold {LT} to charge, release to blast.', done: (g: Game) => g.powers.stats.blasts > 0 },
	{ t: 'Grip', b: 'Point at rock and hold E to tear out what is inside the circle, then flick the mouse and let go to throw it (scroll to resize the circle).', p: 'Aim at rock and hold {RB} to tear out what is inside the circle, then flick the right stick and let go to throw it (d-pad up or down with {RB} resizes the circle).', done: (g: Game) => g.powers.stats.throws > 0 },
	{ t: 'Rime Burst', b: 'Hold F to freeze. Freeze the sea, or freeze a cloud into snow.', p: 'Hold {LB} to freeze. Freeze the sea, or freeze a cloud into snow.', done: (g: Game) => g.w.stats.frozen - g.tut.frozen0 > 150 || g.powers.stats.rimeFrames > 90 },
	{ t: 'Meteor Drop', b: 'Press Q (in the air, or on the ground to leap first) to dive and slam.', p: 'Press {X} (in the air, or on the ground to leap first) to dive and slam.', done: (g: Game) => g.powers.stats.slams > 0 },
	{ t: 'Phase Dash', b: 'Shift dashes toward the cursor and carves a tunnel through rock. Metal, basalt and obsidian stop you.', p: '{B} dashes toward where you aim and carves a tunnel through rock. Metal, basalt and obsidian stop you.', done: (g: Game) => g.powers.stats.dashes > 0 },
];

export class Game {
	canvas: HTMLCanvasElement; w!: S.World; arena!: ArenaInfo; r!: Renderer; bodies!: Bodies; hero!: Hero; enemies!: Enemies; powers!: Powers; fx = new Fx();
	zoomOverride = 0; camFocus: { x: number; y: number } | null = null; // media only: a closer camera for clips
	dmg = { taken: 0, hits: 0, minHealth: 100, byKind: {} as Record<string, number> };
	bosses!: Bosses; style = new Style(); slowmo = 0; hurtT = 9; result: '' | 'won' | 'lost' = ''; killsByKind: Record<string, number> = {}; deathLog: { kind: string; how: string; t: number }[] = [];
	input: Input; sound = new Sound(); ui = new UI(); padMenu: PadMenu; private words = '';
	mode: Mode = 'title'; seed: number; testMode: boolean;
	cam = { x: 0, y: 0, vx: 0, vy: 0 }; trauma = 0; stop = 0; flashV = 0; time = 0; frame = 0;
	acc = 0; last = 0; fps = 60; fpsAcc = 0; fpsN = 0; frameMs: number[] = []; simMsAvg = 0; renderMsAvg = 0;
	aimW = { x: 0, y: 0 }; it!: Intent;
	tut = { step: -1, moved: 0, jumped: false, flyTime: 0, boil0: 0, frozen0: 0, lastX: 0, timer: 0 };
	wave = 0; waveTimer = 0; waveActive = false; done = false; totalWaves = 3;
	townInit = 1; town = 1; seaInit = 1; sea = 1; lastStats = { boiled: 0, rained: 0, quenched: 0 };
	errors: string[] = []; started = false; structChanged = false; viewH = VIEW_GROUND; titleT = 0; health = 100;
	constructor(canvas: HTMLCanvasElement, seed: number, testMode: boolean) {
		this.canvas = canvas; this.seed = seed; this.testMode = testMode;
		this.input = new Input(canvas);
		this.padMenu = new PadMenu(this.input, this.ui);
		this.input.onPointer = (x, y) => { if (this.mode !== 'title') this.ui.cursorAt(x, y, true); };
		this.ui.onPlay = m => this.begin(m);
		this.ui.onSkip = () => this.endTutorial();
		this.ui.onRestart = () => this.restart();
		this.ui.onKeep = () => { this.done = true; this.ui.objective('Keep wrecking', `Everything still works. ${this.menuKey()} for the menu.`); };
		this.ui.onSpawn = () => this.spawnWave(Math.max(1, this.wave));
		this.ui.onVolume = v => this.sound.setVolume(v);
		this.ui.onMusic = v => { this.sound.musicLevel = v; };
		this.build();
	}
	build() {
		S.seed(this.seed);
		this.w = new S.World(1600, 560);
		this.arena = new URLSearchParams(location.search).get('arena') === 'runway' ? buildRunway(this.w, this.seed) : buildArena(this.w, this.seed);
		if (!this.r) this.r = new Renderer(this.canvas, this.w, GOLDEN); else this.r.world = this.w;
		this.r.seaLevel = this.arena.sea;
		this.bodies = new Bodies(this.w);
		this.hero = new Hero(this.w, this.arena.spawn.x, this.arena.spawn.y);
		this.hero.face = this.arena.seaX1 ? -1 : 1;
		this.hero.onBody = id => this.bodies.shove(id, this.hero.x, this.hero.y - 9, 30);
		this.enemies = new Enemies(this.w); this.enemies.bodies = this.bodies;
		this.bosses = new Bosses(this.enemies); this.style = new Style(); this.dmg = { taken: 0, hits: 0, minHealth: 100, byKind: {} }; this.slowmo = 0; this.result = ''; this.killsByKind = {}; this.deathLog = [];
		this.enemies.bossGrip = (x, y, r) => this.bosses.gripLevi(x, y, r);
		this.fx = new Fx();
		this.powers = new Powers({ w: this.w, hero: this.hero, bodies: this.bodies, fx: this.fx, sound: this.sound, enemies: this.enemies, shake: t => this.shake(t), hitstop: s => this.hitstop(s), flash: v => { this.flashV = Math.max(this.flashV, v); }, pan: x => this.pan(x) });
		this.w.onExplode = (x, y, rr, p) => {
			this.enemies.blast(x, y, rr, p);
			if (rr >= 6) this.chunksFrom(x, y, rr, p);
			this.fx.puff(x, y, Math.round(8 + rr * 1.5), 10 + rr * 2, [0.72, 0.64, 0.6, 0.45], 1.6 + rr * 0.12, 2.6, 1.3); // dust
			if (rr >= 8) this.fx.puff(x, y - rr * 0.3, Math.round(rr * 0.6), 6 + rr, [0.18, 0.16, 0.18, 0.5], 2 + rr * 0.15, 2, 1.8); // smoke
			this.fx.burst(x, y, Math.round(20 + rr * 3), 70 + rr * 6, [7, 3.2, 0.9], 25); // sparks
			if (rr >= 8) { this.shake(Math.min(1, 0.3 + rr / 30)); this.sound.play('blast', { pan: this.pan(x), size: Math.min(1.5, rr / 14) }); this.fx.glow(x, y, rr * 1.8, 0.45, [7, 3.5, 1.4]); }
		};
		this.townInit = townCells(this.w, this.arena); this.town = 1;
		this.seaInit = this.seaCount(); this.sea = 1;
		this.cam.x = this.hero.x - this.viewW() / 2; this.cam.y = this.hero.y - this.viewH * 0.6;
		this.wave = 0; this.waveActive = false; this.done = false; this.health = 100;
		this.lastStats = { boiled: 0, rained: 0, quenched: 0 };
		// settle the world a little so the first frame isn't mid-pour
		this.w.setActive(0, 0, this.w.W - 1, this.w.H - 1);
		for (let k = 0; k < 4; k++) this.w.step(DT);
	}
	restart() { this.build(); this.begin(this.mode === 'title' ? 'sandbox' : this.mode); }
	viewW() { return this.r.W / this.scale(); }
	scale() { return this.r.H / this.viewH; }
	seaCount() { let n = 0; const W = this.w.W; for (let y = this.arena.sea - 40; y < this.w.H; y++) for (let x = 0, i = y * W; x < this.arena.seaX1; x++, i++) if (this.w.type[i] === S.WATER) n++; return n; }
	pan(x: number) { return Math.max(-1, Math.min(1, (x - (this.cam.x + this.viewW() / 2)) / (this.viewW() / 2))); }
	shake(t: number) { this.trauma = Math.min(1, Math.max(this.trauma, t)); }
	hitstop(s: number) { this.stop = Math.max(this.stop, Math.min(0.12, s)); }
	begin(m: PlayMode) {
		this.mode = m; this.ui.bossBar(false); this.ui.clearPrompts();
		this.ui.meterSet(m === 'story' || m === 'sandbox', m === 'story' || m === 'sandbox' || m === 'leviathan'); this.ui.hideTitle(this.testMode); document.body.classList.add('playing'); this.sound.start(); this.started = true;
		if (m === 'story') { this.tut.step = 0; this.tut.boil0 = this.w.stats.boiled; this.tut.frozen0 = this.w.stats.frozen; this.showTut(); }
		else if (m === 'sandbox') { this.tut.step = -1; this.ui.prompt(null); this.ui.objective('Sandbox', `Every power, no fail. ${this.menuKey()} for the menu (spawn enemies there).`); }
		else { this.tut.step = -1; this.ui.prompt(null); this.beginCombat(m); }
	}
	showTut() {
		const s = TUTORIAL[this.tut.step];
		if (!s) { this.endTutorial(); return; }
		this.ui.prompt(s.t, this.input.usingPad ? this.input.padText(s.p) : s.b, `${this.tut.step + 1} / ${TUTORIAL.length}`);
		this.ui.objective('Learn your powers', 'Skip the tutorial any time.');
	}
	endTutorial() {
		this.tut.step = -1; this.ui.prompt(null);
		if (this.mode === 'story') { this.ui.toast('Magma crawlers are climbing out of the volcano. Protect the town!'); this.waveTimer = 3; this.sound.play('objective'); }
	}
	// the bay is open to the ocean: during the Leviathan's fight the ocean holds the bay at sea level, filling it back
	// from the bottom up (a few hundred cells a tick), so the fight never drains the bay it's fought in
	tideIn() {
		const w = this.w, a = this.arena, x1 = Math.min(a.seaX1 - 140, 500); let n = 0;
		for (let y = Math.min(w.H - 8, a.sea + 60); y > a.sea && n < 300; y--) for (let x = 2; x < x1 && n < 300; x++) { const i = y * w.W + x; if (w.type[i] === S.AIR && !w.body[i] && S.ST[w.type[i + w.W]] !== S.EMPTY) { w.type[i] = S.WATER; w.temp[i] = 15; w.wake(x, y); n++; } }
	}
	// Arena and boss fights
	beginCombat(m: 'arena' | 'titan' | 'leviathan') {
		const a = this.arena, h = this.hero;
		this.enemies.difficulty = 1; this.result = ''; this.waveTimer = 2.5; this.wave = 0; this.waveActive = false;
		if (m === 'arena') { // the plateau, cleared of the town: an open arena
			{ const w = this.w; for (let xx = 680; xx < 1105; xx++) for (let yy = 30; yy < a.ground[xx] - 1; yy++) { const i = yy * w.W + xx; if (w.type[i] !== S.AIR && w.type[i] !== S.WATER) w.type[i] = S.AIR; else if (w.type[i] === S.WATER) w.type[i] = S.AIR; } w.wakeAll(); this.townInit = 1; }
			this.enemies.leash = { x0: 700, x1: 1090, ground: a.ground };
			this.teleportHero(860, a.ground[860] - 1, false); this.ui.objective('Arena', 'Three waves. Use the right power on each enemy.'); this.ui.toast('Arena: three waves are coming'); }
		if (m === 'titan') {
			this.teleportHero(1300, a.ground[1300] - 40, true); h.face = 1;
			const cx = a.volcano.x; let gy = 20; while (gy < this.w.H - 5 && S.ST[this.w.get(cx, gy)] !== S.SOLID && S.ST[this.w.get(cx, gy)] !== S.LIQUID) gy++;
			this.bosses.spawnTitan(cx, gy + 2); this.ui.objective('The Magma Titan', 'Cool an arm with Rime Burst, then break it off.');
		}
		if (m === 'leviathan') {
			this.teleportHero(560, a.sea - 40, true); h.face = -1;
			const lv = this.bosses.spawnLeviathan(300, a.sea + 30); lv.data.sea = a.sea; lv.data.shore = 430;
			this.ui.objective('The Storm Leviathan', 'Boil its body away with the Magma Lance.');
		}
		this.cam.x = h.x - this.viewW() / 2; this.cam.y = h.y - this.viewH * 0.6;
		this.sound.play('objective');
	}
	teleportHero(x: number, y: number, fly: boolean) {
		const h = this.hero; h.x = x; h.y = y; h.vx = h.vy = 0; h.flying = fly; if (h.overlap(x, y)) h.depenetrate(48);
		const r = h.rig; r.lastImpactFrame = r.stats.frames + 2; r.prevJ = null; r.prevJ2 = null; r.hipW = null; r.blendT = 0.2; for (const f of r.feet) { f.x = h.x; f.y = h.y - 0.6; f.plant = false; } r.resetCloth();
	}
	spawnAt(kind: string, x: number) {
		const w = this.w; let y = 20; while (y < w.H - 5 && !(S.ST[w.get(Math.floor(x), y)] === S.SOLID || S.ST[w.get(Math.floor(x), y)] === S.POWDER)) y++;
		if (kind === 'wraith' || kind === 'swarm') return this.enemies.spawn(kind as any, x, y - 60 - Math.random() * 30);
		return this.enemies.spawn(kind as any, x, y - 1);
	}
	spawnArena(n: number) {
		const list = ARENA_WAVES[Math.min(ARENA_WAVES.length - 1, n - 1)]; let k = 0;
		for (const [kind, c] of list) for (let q = 0; q < c; q++) { const side = k++ % 2 ? 1 : -1; const x = 860 + side * (150 + Math.random() * 90); this.spawnAt(kind, Math.max(700, Math.min(1090, x))); }
		this.waveActive = true; this.wave = n;
		this.ui.toast(`Wave ${n} of ${ARENA_WAVES.length}`); this.sound.play('objective');
	}
	spawnWave(n: number) {
		if (this.mode === 'arena') { this.spawnArena(n); return; }
		const a = this.arena;
		if (this.mode !== 'story') { // sandbox: a mixed handful near the hero
			const h = this.hero; let k = 0;
			for (const kind of ['crawler', 'crawler', 'brute', 'wraith', 'swarm']) { const x = h.x + (k++ % 2 ? 1 : -1) * (60 + k * 14); this.spawnAt(kind, Math.max(40, Math.min(this.w.W - 40, x))); }
			this.waveActive = true; this.wave = n; this.ui.toast('Enemies incoming'); return;
		}
		const crawlers = 2 + n * 2, moths = 0;
		if (n >= 2) for (let k = 0; k < n - 1; k++) this.enemies.spawn('wraith', a.crater.x - 40 - k * 20, a.crater.y - 50);
		if (n >= 3) this.spawnAt('brute', a.volcano.x - 150);
		for (let k = 0; k < crawlers; k++) { const x = a.volcano.x - 90 - k * 14 + Math.random() * 10; let y = 20; while (y < this.w.H - 5 && !(S.ST[this.w.get(Math.floor(x), y)] === S.SOLID || S.ST[this.w.get(Math.floor(x), y)] === S.POWDER)) y++; this.enemies.spawn('crawler', x, y - 1); }
		for (let k = 0; k < moths; k++) this.enemies.spawn('moth', a.crater.x - 20 + k * 10, a.crater.y - 30);
		this.waveActive = true; this.wave = n;
		this.ui.toast(`Wave ${n} of ${this.totalWaves}`); this.sound.play('objective');
	}
	// ---------------------------------------------------------------- loop
	frameLoop = (now: number) => {
		requestAnimationFrame(this.frameLoop);
		const dtReal = Math.min(0.1, (now - (this.last || now)) / 1000); this.last = now;
		this.fpsAcc += dtReal; this.fpsN++;
		if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
		if (this.testMode) { this.draw(); return; } // tests drive the clock with __game.advance
		this.padMenu.update(now); this.padWords();
		this.resize();
		if (!this.ui.paused) {
			if (this.slowmo > 0) { this.slowmo -= dtReal; this.acc += dtReal * 0.28; } else this.acc += dtReal;
			let n = 0;
			while (this.acc >= DT && n < 3) { this.snapshot(); this.tick(); this.acc -= DT; n++; }
			if (n === 3) this.acc = 0;
		} else this.readMenuInput();
		this.draw(this.testMode ? 1 : Math.min(1, this.acc / DT));
	};
	/** The words follow the device: keys and mouse, or the pad in use (with its own button names). */
	padWords() {
		const k = this.input.usingPad ? this.input.padKind : 'keys';
		if (k === this.words) return;
		this.words = k;
		this.ui.words(this.input.usingPad, s => this.input.padText(s));
		if (this.tut.step >= 0) this.showTut();
	}
	menuKey() { return this.input.usingPad ? this.input.padLabel('Start') : 'Esc'; }
	readMenuInput() { const it = this.input.read(); if (it.pausePressed) this.ui.pause(false); if (it.help) this.ui.toggleHelp(); }
	resize() {
		const dpr = Math.min(2, devicePixelRatio || 1);
		let w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
		const k = Math.min(1, 1920 / w, 1080 / h); w = Math.round(w * k); h = Math.round(h * k);
		if (w !== this.r.W || h !== this.r.H) { this.r.resize(w, h); this.canvas.style.width = innerWidth + 'px'; this.canvas.style.height = innerHeight + 'px'; }
	}
	tick() {
		const t0 = performance.now();
		const it = this.it = this.input.read();
		if (it.pausePressed && this.mode !== 'title') { this.ui.pause(!this.ui.paused); return; }
		if (it.help) this.ui.toggleHelp();
		if (this.mode === 'title') { this.titleTick(); return; }
		if (this.stop > 0) { this.stop -= DT; this.time += DT; this.fx.step(DT * 0.25, this.w); return; }
		this.frame++; this.time += DT;
		const hero = this.hero, w = this.w;
		this.camera(DT);
		// aim in world space: mouse, or a stick direction from the hero
		const sc = this.scale();
		if (it.aimWX !== undefined && it.aimWY !== undefined) this.aimW = { x: it.aimWX, y: it.aimWY };
		else if (it.aimIsScreen) { this.aimW = this.screenToWorld(it.aimX, it.aimY, this.cam.x, this.cam.y); }
		else { const l = Math.hypot(it.aimX, it.aimY); if (l > 0.2) this.aimW = { x: hero.x + it.aimX / l * 60, y: hero.y - 9 + it.aimY / l * 60 }; else if (Math.hypot(this.aimW.x - hero.x, this.aimW.y - hero.y) > 200) this.aimW = { x: hero.x + hero.face * 60, y: hero.y - 9 }; }
		const busy = hero.tumble && hero.stun > 0;
		hero.input.x = busy ? 0 : it.x; hero.input.y = busy ? 0 : it.y; hero.input.jump = it.jump; hero.input.jumpPressed = it.jumpPressed && !busy; hero.input.drop = it.drop;
		if (!hero.flying && it.y > 0.5 && !hero.grounded) { /* S in the air does nothing special; meteor is Q */ }
		if ((it.lance || it.charge || it.rime) && Math.abs(this.aimW.x - hero.x) > 2 && !hero.flying) hero.face = Math.sign(this.aimW.x - hero.x);
		if ((it.lance || it.charge || it.rime) && hero.flying && Math.abs(it.x) < 0.1) hero.face = Math.sign(this.aimW.x - hero.x) || hero.face;
		this.powers.update(DT, it, this.aimW);
		hero.update(DT);
		this.heroEvents();
		// the sim runs only near the camera (plus a margin)
		const vw = this.viewW(), M = 64;
		w.setActive(Math.max(0, Math.floor(this.cam.x - M)), Math.max(0, Math.floor(this.cam.y - M)), Math.min(w.W - 1, Math.floor(this.cam.x + vw + M)), Math.min(w.H - 1, Math.floor(this.cam.y + this.viewH + M)));
		w.wind = 0.15 + Math.sin(this.time * 0.07) * 0.25;
		this.enemies.step(DT, hero, this.townTarget());
		this.bosses.step(DT, hero);
		this.scald();
		this.enemyEvents();
		if (w.structuralDirty) this.structChanged = true;
		if (w.structuralDirty && this.frame % 6 === 0) this.bodies.detach(12, this.window(48));
		else if (this.structChanged && this.frame % 120 === 60) { this.bodies.detach(12); this.structChanged = false; } // whole-world sweep: nothing hovers anywhere
		this.bodies.heroBox = { x: hero.x, y: hero.y, hw: hero.halfW, h: hero.height };
		this.bodies.step(DT);
		this.chunkHits();
		this.bodyEvents();
		w.removedSolid = 0;
		w.step(DT);
		hero.unstick(DT); // nothing the world did this tick may leave matter inside the hero
		this.fx.step(DT, w);
		this.hurtT += DT; this.style.tick(DT);
		const combat = this.mode === 'arena' || this.mode === 'titan' || this.mode === 'leviathan';
		this.health = hero.health = Math.min(100, hero.health + DT * (combat ? (this.hurtT > 3 ? 2.5 : 0) : 4));
		if (hero.health <= 0) { if (combat && !this.result) this.lose(); else if (!combat) { hero.health = 60; hero.knock(0, -10); this.ui.toast('Knocked flat! Up you get.'); } else hero.health = 1; }
		this.dmg.minHealth = Math.min(this.dmg.minHealth, hero.health);
		this.combatHud();
		if (this.mode === 'leviathan') this.tideIn();
		this.ambience();
		this.objectives();
		this.simMsAvg = this.simMsAvg * 0.95 + (performance.now() - t0) * 0.05;
	}
	titleTick() {
		// title: the camera drifts along the coast while the world idles
		this.titleT += DT; this.time += DT; this.frame++;
		const vw = this.viewW();
		const x = 380 + Math.sin(this.titleT * 0.05) * 260;
		this.cam.x = Math.max(0, Math.min(this.w.W - vw, x)); this.cam.y = Math.max(0, Math.min(this.w.H - this.viewH, this.arena.sea - this.viewH * 0.62));
		this.w.setActive(Math.max(0, Math.floor(this.cam.x - 40)), Math.max(0, Math.floor(this.cam.y - 40)), Math.min(this.w.W - 1, Math.floor(this.cam.x + vw + 40)), Math.min(this.w.H - 1, Math.floor(this.cam.y + this.viewH + 40)));
		this.hero.input.x = 0; this.hero.update(DT);
		this.w.step(DT); this.fx.step(DT, this.w);
		if (this.it?.anyPressed && this.testMode) { /* tests start explicitly */ }
	}
	screenToWorld(px: number, py: number, camX: number, camY: number) { const sc = this.scale(); return { x: camX + px / sc, y: camY + py / sc }; }
	// Blasts throw irregular rigid chunks: blobs grown at random from the rim of the crater, with jagged edges
	chunksFrom(cx: number, cy: number, r: number, power: number) {
		const w = this.w, W = w.W, n = Math.min(7, 2 + Math.floor(r / 5));
		const taken = new Set<number>();
		for (let k = 0; k < n; k++) {
			const a = Math.random() * Math.PI * 2, d = r * (1.0 + Math.random() * 0.45);
			let sx = Math.round(cx + Math.cos(a) * d), sy = Math.round(cy + Math.sin(a) * d);
			let seed = -1;
			for (let t = 0; t < 6 && seed < 0; t++) { const i = sy * W + sx; if (w.inb(sx, sy) && S.ST[w.type[i]] === S.SOLID && w.type[i] !== S.BEDROCK && !w.body[i] && !taken.has(i)) seed = i; else { sx += Math.round(Math.cos(a)); sy += Math.round(Math.sin(a)); } }
			if (seed < 0) continue;
			const want = 18 + Math.floor(Math.random() * Math.random() * 130 * Math.min(1.5, r / 12));
			const blob: number[] = [seed], queue = [seed]; taken.add(seed);
			while (queue.length && blob.length < want) {
				const i = queue.splice(Math.floor(Math.random() * queue.length), 1)[0];
				for (const j of [i - 1, i + 1, i - W, i + W]) {
					if (taken.has(j) || j < 0 || j >= w.type.length) continue;
					const t = w.type[j]; if (S.ST[t] !== S.SOLID || t === S.BEDROCK || w.body[j]) continue;
					const jx = j % W, jy = (j / W) | 0; if (Math.hypot(jx - cx, jy - cy) > r * 1.9) continue;
					if (Math.hypot(jx - sx, jy - sy) > Math.sqrt(want) * 0.75 + 1) continue; // stay compact around the seed (jagged, not a sliver)
					if (Math.random() < 0.62) { taken.add(j); blob.push(j); queue.push(j); } // random acceptance: a jagged fracture outline
				}
			}
			if (blob.length < 12) continue;
			const sp = (6 + Math.random() * 14) * power, ang = Math.atan2(sy - cy, sx - cx) + (Math.random() - 0.5) * 0.6;
			const b = this.bodies.makeBody(blob, { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp - 4 * power }, (Math.random() - 0.5) * 9);
			b.thrown = 0; // chunks shatter on hard landings, they do not set off more blasts
		}
		w.structuralDirty = true;
	}
	window(m: number): [number, number, number, number] { const vw = this.viewW(); return [Math.max(0, Math.floor(this.cam.x - m)), Math.max(0, Math.floor(this.cam.y - m)), Math.min(this.w.W - 1, Math.floor(this.cam.x + vw + m)), Math.min(this.w.H - 1, Math.floor(this.cam.y + this.viewH + m))]; }
	townTarget() { const t = this.arena.town; const h = t[t.length - 1]; return { x: (h.x0 + h.x1) / 2, y: h.y1 - 6 }; }
	camera(dt: number) {
		const h = this.hero, vw = this.viewW();
		const zT = this.zoomOverride || (h.flying || this.powers.beamPow > 0 ? VIEW_FLY : VIEW_GROUND); const cx = this.cam.x + this.viewW() / 2, cy = this.cam.y + this.viewH / 2;
		this.viewH += (zT - this.viewH) * (1 - Math.exp(-1.5 * dt)); this.cam.x = cx - this.viewW() / 2; this.cam.y = cy - this.viewH / 2;
		const look = h.flying ? 0.35 : 0.25;
		const pel = h.rig.j.pel ?? { x: h.x, y: h.y - 9 };
		let tx = pel.x + h.vx * 10 * look - vw / 2, ty = pel.y + (h.flying ? h.vy * 10 * 0.2 : 0) - this.viewH * 0.55;
		if (this.camFocus) { tx = (pel.x + this.camFocus.x) / 2 - vw / 2; ty = (pel.y + this.camFocus.y) / 2 - this.viewH * 0.5; } // media: frame the hero and what they're fighting
		const wc = 5;
		this.cam.vx += (wc * wc * (tx - this.cam.x) - 2 * wc * this.cam.vx) * dt; this.cam.x += this.cam.vx * dt;
		this.cam.vy += (wc * wc * (ty - this.cam.y) - 2 * wc * this.cam.vy) * dt; this.cam.y += this.cam.vy * dt;
		this.cam.x = Math.max(0, Math.min(this.w.W - vw, this.cam.x)); this.cam.y = Math.max(0, Math.min(this.w.H - this.viewH, this.cam.y));
		this.trauma = Math.max(0, this.trauma - dt * 1.6);
		this.flashV *= 0.82;
	}
	heroEvents() {
		const h = this.hero, s = this.sound, fx = this.fx, w = this.w;
		for (const e of h.events) {
			if (e.type === 'step') {
				const gx = Math.floor(e.x!), gy = Math.floor(e.y!);
				const t0 = w.get(gx, gy);
				s.play('step', { pan: this.pan(e.x!), size: t0 === S.SAND || t0 === S.SNOW ? 0.3 : 1, vol: 0.8 });
				if (t0 === S.SAND || t0 === S.SNOW || t0 === S.RUBBLE) {
					const back = -Math.sign(h.vx || h.face);
					for (let k = 0; k < 2 + ((e.speed ?? 0) > 6 ? 3 : 0); k++) { const xx = gx + back * (k % 3), yy = gy + (k > 2 ? 1 : 0); if (w.get(xx, yy) === t0) w.eject(xx, yy, back * (10 + (e.speed ?? 0) * 5 * Math.random()), -(8 + (e.speed ?? 0) * 2.5 * Math.random())); }
					fx.puff(e.x!, e.y!, 3, 6 + (e.speed ?? 0), [0.9, 0.78, 0.6, 0.35], 1.2);
				} else if ((e.speed ?? 0) > 4) fx.puff(e.x!, e.y!, 2, 4 + (e.speed ?? 0) * 0.5, [0.8, 0.72, 0.72, 0.25], 1.0);
			}
			if (e.type === 'jump') { fx.puff(e.x!, e.y!, 5, 10, [0.85, 0.78, 0.7, 0.35], 1.4); s.play('jump'); this.tut.jumped = true; }
			if (e.type === 'fly') { fx.puff(h.x, h.y, 10, 18, [1, 0.92, 0.85, 0.35], 1.6); fx.ring(h.x, h.y - 2, 1, 12, 0.25, [2, 1.6, 1.2]); s.play('fly'); }
			if (e.type === 'land') {
				const v = e.v ?? 0, k = Math.min(1, v / 25);
				fx.puff(e.x!, e.y!, 6 + Math.round(10 * k), 10 + 20 * k, [0.88, 0.8, 0.7, 0.4], 1.6);
				s.play('land', { pan: 0, size: 0.4 + k });
				if (v > 10) for (let dx = -5; dx <= 5; dx++) for (let dy = 0; dy < 3; dy++) { const xx = Math.floor(e.x!) + dx, yy = Math.floor(e.y!) + dy; const t = w.get(xx, yy); if ((t === S.SAND || t === S.SNOW || t === S.RUBBLE) && Math.random() < 0.55 * k) w.eject(xx, yy, Math.sign(dx || 1) * (8 + 25 * k * Math.random()), -(10 + 30 * k * Math.random())); }
				if (v > 15) { this.hitstop(0.05 + 0.04 * k); this.shake(0.35 * k); } else this.shake(0.12 * k);
			}
			if (e.type === 'tumble') { s.play('hurt'); this.shake(0.4); }
			if (e.type === 'dash') { this.hitstop(0.02); }
		}
	}
	// every enemy event gets its juice: hit-stop scaled to damage, shake, sound by material, particles; and style points
	enemyEvents() {
		const s = this.sound, fx = this.fx, st = this.style;
		for (const e of this.enemies.events) {
			const pan = this.pan(e.x), k = e.kind ?? '';
			if (e.mob?.boss && e.mob !== this.bosses.boss && e.type !== 'bossDead') continue; // prompts belong to the boss being fought
			switch (e.type) {
				case 'hit': {
					const v = e.v ?? 0; if (e.name === 'heat') { st.move('heat', v / 60); break; }
					st.move(e.name ?? 'blast', Math.min(2, v / 40));
					this.hitstop(this.enemies.hitStop(v)); this.shake(Math.min(0.6, 0.1 + v / 160));
					s.play('punch', { pan, size: Math.min(1, v / 60) });
					if (k === 'crawler') s.play('impact', { pan, size: 0.3 }); else if (k === 'wraith') s.play('freeze', { pan, vol: 0.7 }); else if (k === 'brute' || k === 'titan') s.play('clank', { pan });
					fx.burst(e.x, e.y, 10 + Math.round(v / 4), 60 + v, k === 'wraith' ? [1.5, 2.5, 4] : [6, 3, 1]);
					break;
				}
				case 'clank': s.play('clank', { pan, vol: 0.6 }); fx.burst(e.x, e.y, 6, 50, [5, 4, 3]); break;
				case 'shrug': fx.burst(e.x, e.y, 4, 30, k === 'wraith' ? [1, 2, 3.5] : [6, 2, 0.4]); if (Math.random() < 0.15 && !this.testMode) this.ui.toast(k === 'wraith' ? 'Cold only feeds the wraith' : k === 'crawler' ? 'Lava shrugs off heat: freeze it' : k === 'titan' ? 'Too hot to break: cool it first' : 'No effect'); break;
				case 'die': {
					this.killsByKind[k] = (this.killsByKind[k] ?? 0) + 1; this.deathLog.push({ kind: k, how: e.name ?? '', t: this.time });
					st.move('kill', k === 'brute' ? 2 : 1);
					s.play('enemyDie', { pan }); s.play(k === 'wraith' ? 'shatter' : k === 'swarm' ? 'crumble' : 'blast', { pan, size: 0.45 });
					fx.glow(e.x, e.y, 14, 0.4, k === 'wraith' ? [1.5, 2.6, 4] : [5, 2, 0.5]); fx.puff(e.x, e.y, 14, 18, k === 'swarm' ? [0.9, 0.78, 0.55, 0.5] : [0.7, 0.62, 0.6, 0.4], 2, 2, 0.9);
					this.hitstop(0.06); this.shake(0.45);
					if ((this.mode === 'arena' || this.mode === 'story') && this.waveActive && this.enemies.alive() === 0) { this.slowmo = 0.9; this.flashV = Math.max(this.flashV, 0.08); }
					break;
				}
				case 'tell': { const big = e.name === 'pound' || e.name === 'wave' || e.name === 'surge' || e.name === 'boulder' || e.name === 'emerge'; s.play('tell', { pan, size: big ? 1 : 0.4 }); if (e.name === 'bolt') s.play('sizzle', { pan, vol: 0.6 }); if (e.name === 'hiss') s.play('hiss', { pan }); if (e.name === 'spit') s.play('fireball', { pan, vol: 0.3 }); break; }
				case 'spit': s.play('fireball', { pan, vol: 0.5 }); break;
				case 'shoot': s.play('ice', { pan }); break;
				case 'shardHit': fx.burst(e.x, e.y, 6, 40, [1.5, 2.5, 4]); s.play('freeze', { pan, vol: 0.4 }); break;
				case 'pound': case 'bossSlam': this.shake(0.7); this.hitstop(0.05); s.play('slam', { pan }); fx.ring(e.x, e.y - 1, 2, 48, 0.3, [3, 2.2, 1.6]); fx.puff(e.x, e.y, 24, 26, [0.8, 0.7, 0.6, 0.45], 2.2); break;
				case 'charge': s.play('dash', { pan }); break;
				case 'burrow': s.play('crumble', { pan }); fx.puff(e.x, e.y - 12, 16, 16, [0.8, 0.7, 0.6, 0.5], 2); break;
				case 'dust': if (Math.random() < 0.3) fx.puff(e.x, e.y, 2, 8, [0.82, 0.72, 0.6, 0.45], 1.6); if (Math.random() < 0.05) s.play('crumble', { pan, vol: 0.3 }); break;
				case 'emerge': this.shake(0.5); s.play('impact', { pan, size: 0.8 }); fx.puff(e.x, e.y, 24, 24, [0.8, 0.7, 0.6, 0.5], 2.2); break;
				case 'lunge': s.play('whoosh', { pan }); break;
				case 'freeze': st.move('freeze'); s.play('freeze', { pan }); s.play('ice', { pan }); fx.burst(e.x, e.y, 20, 60, [1.5, 2.5, 4]); break;
				case 'thaw': s.play('sizzle', { pan, vol: 0.5 }); break;
				case 'shatter': s.play('shatter', { pan }); s.play('iceBreak', { pan }); this.hitstop(0.08); this.shake(0.55); fx.burst(e.x, e.y, 40, 120, [1.6, 2.4, 3.6]); if (k === 'crawler') this.combo('Icebreaker', e.x, e.y); break;
				case 'plateTorn': s.play('tear', { pan }); this.shake(0.4); if (k === 'brute') this.combo('Disarm', e.x, e.y); break;
				case 'plateCrack': s.play('rock', { pan }); this.shake(0.4); fx.burst(e.x, e.y, 20, 80, [5, 4, 3]); break;
				case 'heartOpen': s.play('roar', { pan, vol: 0.6 }); this.ui.toast('Its heart is open'); break;
				case 'melt': s.play('melt', { pan }); fx.puff(e.x, e.y, 2, 6, [1, 1, 1, 0.3], 1.6); break;
				case 'refreeze': if (Math.random() < 0.3) s.play('freeze', { pan, vol: 0.3 }); break;
				case 'fuse': s.play('sizzle', { pan }); fx.glow(e.x, e.y, 5, 0.3, [4, 2.5, 1]); break;
				case 'scatter': s.play('crumble', { pan, vol: 0.6 }); fx.puff(e.x, e.y, 10, 22, [0.92, 0.8, 0.58, 0.5], 1.8, 2.4, 0.9); break;
				case 'suck': if (Math.random() < 0.1) fx.spark(e.x, e.y, (this.enemies.list.find(m => m.kind === 'swarm')?.x ?? e.x) - e.x, -20, 0.25, [1.6, 1.3, 0.8], 0, 0.2); break;
				case 'reform': s.play('crumble', { pan, vol: 0.35 }); break;
				case 'combo': this.combo(e.name ?? '', e.x, e.y); break;
				case 'hurtHero': this.hurtT = 0; this.dmg.taken += e.v ?? 0; this.dmg.hits++; this.dmg.byKind[e.name ?? '?'] = (this.dmg.byKind[e.name ?? '?'] ?? 0) + (e.v ?? 0); st.hurt(e.v ?? 10); s.play('hurt'); this.shake(0.45); this.flashV = Math.max(this.flashV, 0.06); break;
				case 'bossIntro': this.ui.banner(e.name ?? '', 'Boss'); s.play('roar', { pan }); this.shake(0.6); break;
				case 'bossPhase': this.ui.banner(e.name ?? '', 'Next phase'); s.play('roar', { pan }); this.shake(0.8); this.flashV = Math.max(this.flashV, 0.1); this.hitstop(0.1); break;
				case 'bossThrow': s.play('whoosh', { pan, size: 1 }); break;
				case 'bossSwipe': s.play('whoosh', { pan, size: 1 }); s.play('dash', { pan }); this.shake(0.35); break;
				case 'bossBreath': s.play('fireball', { pan }); s.play('release', { pan }); this.shake(0.3); break;
				case 'limbCool': s.play('freeze', { pan }); s.play('sizzle', { pan }); if (!this.result) this.ui.toast('The arm has cooled: break it!'); break;
				case 'limbHot': s.play('fireball', { pan, vol: 0.4 }); break;
				case 'limbCrack': s.play('rock', { pan }); this.shake(0.5); this.hitstop(0.06); if (!this.result) this.ui.toast('Cracked! One more blow'); break;
				case 'limbBreak': st.move('blast', 3); s.play('shatter', { pan }); s.play('rock', { pan }); s.play('roar', { pan, vol: 0.8 }); this.hitstop(0.12); this.shake(1); this.flashV = Math.max(this.flashV, 0.12); break;
				case 'coreShatter': st.move('blast', 3); s.play('shatter', { pan }); s.play('iceBreak', { pan }); this.hitstop(0.12); this.shake(1); fx.burst(e.x, e.y, 60, 150, [8, 4, 1.5]); break;
				case 'bossDying': this.slowmo = 1.6; this.flashV = 0.2; s.play('roar', { pan }); this.shake(1); break;
				case 'bossCrumble': s.play('rock', { pan, vol: 0.6 }); this.shake(0.4); break;
				case 'bossDead': this.killsByKind[k] = 1; this.shake(1); this.flashV = 0.3; s.play('blast', { pan, size: 1.5 }); s.play('thunder', { pan, size: 1, vol: 1 }); this.ui.banner(`${e.name} is down`, 'Victory'); break;
				case 'bossSurge': s.play('wave', { pan, vol: 1 }); s.play('splash', { pan, size: 1 }); this.shake(0.5); break;
				case 'bossDive': s.play('splash', { pan, size: 1 }); break;
				case 'bossClouds': s.play('fly', { pan }); break;
				case 'bolt': s.play('thunder', { pan, size: 1, vol: 1 }); s.play('impact', { pan, size: 0.8 }); this.flashV = Math.max(this.flashV, 0.25); this.shake(0.6); break;
				case 'geyser': s.play('blast', { pan, size: 0.7 }); this.shake(0.4); break;
				case 'splashHit': s.play('splash', { pan, size: 0.6 }); break;
				case 'vapour': if (Math.random() < 0.25) fx.puff(e.mob ? e.mob.x + (Math.random() - 0.5) * 20 : e.x, (e.mob ? e.mob.y : e.y) - 4, 2, 10, [1, 1, 1, 0.3], 2.2, 2.5, 0.7); break;
				case 'coreHit': s.play('glasshit', { pan }); this.hitstop(0.04); break;
				case 'slip': if (Math.random() < 0.5 && !this.testMode) this.ui.toast('It slips out of the Grip: freeze it first'); break;
			}
		}
		this.enemies.events.length = 0;
	}
	combo(name: string, x: number, y: number) {
		if (!name) return;
		const first = this.style.comboNamed(name);
		this.sound.play('combo'); this.fx.ring(x, y, 2, 30, 0.3, [5, 4, 2]);
		if (first) this.ui.banner(name, COMBOS[name] ?? '');
	}
	// a Lava Blast into water: a scalding steam burst that hurts what's near
	scald() {
		const b = this.powers.lastBlast; if (!b) return; this.powers.lastBlast = null;
		if (!b.wet) return;
		const w = this.w; let hit = false;
		for (let n = 0; n < 220; n++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 16; const x = Math.floor(b.x + Math.cos(a) * r), y = Math.floor(b.y - 4 + Math.sin(a) * r * 0.7); if (w.inb(x, y) && (w.type[y * w.W + x] === S.AIR || w.type[y * w.W + x] === S.WATER) && !w.body[y * w.W + x]) { w.type[y * w.W + x] = S.STEAM; w.temp[y * w.W + x] = 160; w.life[y * w.W + x] = 140; w.wake(x, y); } }
		for (const m of [...this.enemies.list]) { if (m.dead) continue; const c = this.enemies.center(m); const d = Math.hypot(c.x - b.x, c.y - b.y); if (d < 36) { this.enemies.hit(m, c.x, c.y, 40 * (1 - d / 36) + 10, 'steam', Math.sign(c.x - b.x), -0.6); hit = true; } }
		this.fx.puff(b.x, b.y - 4, 30, 30, [1, 1, 1, 0.5], 3, 3, 1.2); this.sound.play('sizzle', { pan: this.pan(b.x), vol: 1 });
		if (hit) this.combo('Scald', b.x, b.y);
	}
	// rigid chunks flying into enemies (thrown with Grip, or blown off by a blast) hit them
	chunkHitT = new Map<number, number>();
	chunkHits() {
		for (const b of this.bodies.list) {
			if (b.held) continue; const v = b.rb.linvel(), sp = Math.hypot(v.x, v.y) * 10; if (sp < 110) continue;
			if ((this.chunkHitT.get(b.id) ?? 0) > this.time) continue;
			const p = b.rb.translation(), x = p.x * 10, y = p.y * 10, R = Math.sqrt(b.n) * 0.55;
			for (const m of this.enemies.list) {
				if (m.dead || m.boss || m.held) continue; const c = this.enemies.center(m);
				if (Math.hypot(c.x - x, c.y - y) > m.r + R) continue;
				const dmg = 15 + Math.min(60, b.n * sp * 0.0004);
				this.enemies.hit(m, c.x, c.y, dmg, 'chunk', Math.sign(v.x), Math.sign(v.y) * 0.3 - 0.3);
				if (b.thrown > 0) this.combo('Throwback', c.x, c.y);
				b.rb.setLinvel({ x: v.x * 0.45, y: v.y * 0.45 }, true); this.chunkHitT.set(b.id, this.time + 0.25); break;
			}
		}
	}
	combatHud() {
		const combat = this.mode === 'arena' || this.mode === 'titan' || this.mode === 'leviathan' || (this.enemies.list.length > 0 && this.mode !== 'title');
		this.ui.styleHud(combat, this.style.rank(), this.style.progress(), this.style.combo, this.style.lastT > 0 ? this.style.last : '');
		const b = this.bosses.boss;
		if (b && !b.dead) this.ui.bossBar(true, b.kind === 'titan' ? 'The Magma Titan' : 'The Storm Leviathan', this.bosses.health(), this.bosses.phaseName());
		else this.ui.bossBar(false);
	}
	combatObjectives() {
		if (this.result) return;
		if (this.mode === 'arena') {
			if (!this.waveActive) {
				this.waveTimer -= DT;
				if (this.waveTimer <= 0) { if (this.wave < ARENA_WAVES.length) this.spawnArena(this.wave + 1); }
				this.ui.objective(this.wave === 0 ? 'Get ready' : `Wave ${this.wave} cleared`, `Next wave in ${Math.max(0, Math.ceil(this.waveTimer))}s`);
			} else {
				const n = this.enemies.alive();
				const kinds = [...new Set(this.enemies.list.map(e => e.kind))].map(k => ({ crawler: 'magma crawlers', brute: 'rock brutes', wraith: 'frost wraiths', swarm: 'sand swarms' } as Record<string, string>)[k] ?? k).join(', ');
				this.ui.objective(`Wave ${this.wave} of ${ARENA_WAVES.length}: ${n} left`, kinds);
				if (n === 0) { this.waveActive = false; this.waveTimer = 5; if (this.wave >= ARENA_WAVES.length) this.win(); else this.ui.toast(`Wave ${this.wave} cleared. Style: ${this.style.rank()}`); }
			}
			return;
		}
		const b = this.bosses.boss;
		if (b) { this.ui.objective(b.kind === 'titan' ? 'The Magma Titan' : 'The Storm Leviathan', this.bosses.phaseName()); if (b.dead) this.win(); }
	}
	win() {
		this.result = 'won'; this.done = true; this.ui.clearPrompts();
		const st = this.style, mins = `${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, '0')}`;
		const rows: [string, string][] = this.mode === 'arena'
			? [['Waves cleared', `${ARENA_WAVES.length}`], ['Enemies', `${this.enemies.killed}`], ['Best style', st.bestRank], ['Longest combo', `${st.maxCombo} hits`], ['Combos found', st.found.length ? st.found.join(', ') : 'none yet'], ['Time', mins]]
			: [['Boss', this.mode === 'titan' ? 'The Magma Titan' : 'The Storm Leviathan'], ['Best style', st.bestRank], ['Longest combo', `${st.maxCombo} hits`], ['Combos found', st.found.length ? st.found.join(', ') : 'none yet'], ['Time', mins]];
		setTimeout(() => this.ui.report(rows, this.mode === 'arena' ? 'The arena is yours.' : 'Victory.'), this.testMode ? 0 : 1800);
		this.sound.play('objective');
	}
	lose() {
		this.result = 'lost'; this.done = true; this.hero.health = 1; this.ui.clearPrompts();
		this.ui.report([['Reached', this.mode === 'arena' ? `Wave ${this.wave}` : `Phase ${this.bosses.stats.phase}`], ['Best style', this.style.bestRank], ['Combos found', this.style.found.length ? this.style.found.join(', ') : 'none yet']], 'Knocked out. Try again?');
	}
	bodyEvents() {
		for (const e of this.bodies.events) {
			if (e.type === 'detach') { if (e.n > 30) { this.sound.play('crumble', { pan: this.pan(e.x), vol: Math.min(1, e.n / 800) }); } }
			if (e.type === 'impact') { const k = Math.min(1, e.n / 1500); const wet = S.ST[this.w.get(Math.floor(e.x), Math.floor(e.y) + 6)] === S.LIQUID; this.sound.play(wet ? 'splash' : 'impact', { pan: this.pan(e.x), size: k, vol: 0.4 + k }); this.fx.puff(e.x, e.y + 4, 8 + Math.round(20 * k), 14, [0.8, 0.7, 0.65, 0.4], 2, 2, 0.8); this.shake(0.15 + 0.5 * k); if (k > 0.3) this.hitstop(0.05); for (const en of this.enemies.at(e.x, e.y, Math.sqrt(e.n) * 0.6 + 4)) this.enemies.damage(en, 30 + e.n * 0.04, 'crush'); }
			if (e.type === 'shatter') { this.sound.play('shatter', { pan: this.pan(e.x), vol: 0.6 }); this.sound.play('crumble', { pan: this.pan(e.x) }); }
		}
		this.bodies.events.length = 0;
		if (this.frame % 60 === 0) this.bodies.cleanup(this.cam.x + this.viewW() / 2, this.cam.y + this.viewH / 2);
	}
	// The ambience follows the world: what the simulation is doing near the camera, where it is, how much of it.
	amb = { boil: 0, quench: 0, rain: 0, rainPan: 0, lava: 0, lavaPan: 0, shoreX: 520, nextWave: 3, nextThunder: 6, thunders: 0, waves: 0 };
	ambience() {
		const st = this.w.stats, s = this.sound, w = this.w, h = this.hero, A = this.amb, ar = this.arena;
		const boilRate = st.boiled - this.lastStats.boiled, quench = st.quenched - this.lastStats.quenched;
		this.lastStats.boiled = st.boiled; this.lastStats.rained = st.rained; this.lastStats.quenched = st.quenched;
		const vw = this.viewW(), cx = this.cam.x + vw / 2, cy = this.cam.y + this.viewH / 2;
		const panOf = (x: number) => Math.max(-1, Math.min(1, (x - cx) / (vw * 0.6)));
		// boiling and steam: a roiling bed, a steady sizzle and the steam hiss, by how much water is boiling right now
		A.boil = A.boil * 0.92 + boilRate * 0.08; A.quench = A.quench * 0.9 + quench * 0.1;
		const b = this.powers.drawnBeam, bp = b ? panOf(b.x1) : 0;
		s.loop('steam', Math.min(0.3, A.boil * 0.02), 1, bp * 0.5, 0.12);
		s.loop('boil', Math.min(0.42, A.boil * 0.03), 0.8 + Math.min(0.35, A.boil * 0.012), bp, 0.15);
		s.loop('sizzle', Math.min(0.32, A.boil * 0.015 + A.quench * 0.03), 1, bp, 0.1);
		if (quench > 0 && Math.random() < Math.min(0.6, quench * 0.06)) s.play('sizzle', { pan: bp, vol: Math.min(1, 0.45 + quench * 0.04) });
		// rain: the drops the clouds are dropping in view right now, and on which side
		if (this.frame % 3 === 0) {
			let n = 0, px = 0; const x0 = this.cam.x - 20, x1 = this.cam.x + vw + 20, y0 = this.cam.y - 40, y1 = this.cam.y + this.viewH + 10;
			for (let k = 0; k < w.pn; k++) { if (w.pt[k] !== S.WATER || w.pvy[k] < 6) continue; const x = w.px[k], y = w.py[k]; if (x < x0 || x > x1 || y < y0 || y > y1) continue; n++; px += x; }
			A.rain = A.rain * 0.8 + n * 0.2; if (n) A.rainPan = A.rainPan * 0.8 + panOf(px / n) * 0.2;
		}
		const heavy = Math.max(0, Math.min(1, (A.rain - 70) / 260));
		s.loop('rain_light', Math.min(1, A.rain / 50) * 0.42 * (1 - heavy * 0.6), 1, A.rainPan * 0.6, 0.35);
		s.loop('rain_heavy', heavy * 0.5, 1, A.rainPan * 0.6, 0.35);
		// thunder: only from a raining, heavy cloud; the harder it rains the closer and more often
		if (A.rain > 90 && this.time > A.nextThunder) {
			const near = Math.min(1, 0.25 + heavy * 0.75) * (0.6 + Math.random() * 0.4);
			s.play('thunder', { pan: A.rainPan * 0.7 + (Math.random() - 0.5) * 0.4, size: near, vol: 0.55 + near * 0.45 });
			A.nextThunder = this.time + 9 + Math.random() * 12 - heavy * 5; A.thunders++;
		} else if (A.rain < 30) A.nextThunder = Math.max(A.nextThunder, this.time + 4);
		// the sea offshore and the surf on the shoreline (found from the water itself: it moves when the sea is boiled)
		if (this.frame % 30 === 0 && ar.seaX1 > 0) { let x = ar.seaX1; const row = (ar.sea + 2) * w.W; while (x > 0 && w.type[row + x] !== S.WATER) x--; A.shoreX = x; }
		if (ar.seaX1 > 0) {
			const over = Math.max(0, Math.min(1, (A.shoreX - this.cam.x) / vw)), high = 1 - Math.min(1, Math.abs(ar.sea - cy) / (this.viewH * 1.4));
			const full = Math.max(0.2, Math.min(1, this.sea));
			s.loop('sea', 0.42 * over * high * full, 1, panOf(this.cam.x + Math.min(vw, Math.max(0, A.shoreX - this.cam.x)) / 2), 0.6, 2500 + 15000 * high);
			const d = Math.hypot(cx - A.shoreX, (cy - ar.sea) * 1.6), surf = Math.max(0, Math.min(1, 1 - d / 280)) * full;
			s.loop('surf', 0.5 * surf ** 1.4, 1, panOf(A.shoreX), 0.6);
			if (surf > 0.12 && this.time > A.nextWave) { s.play('wave', { pan: panOf(A.shoreX), vol: 0.25 + surf * 0.65 }); A.nextWave = this.time + 5.5 + Math.random() * 6; A.waves++; }
		}
		// lava: the crackle of molten rock in view, the volcano's rumble by distance
		if (this.frame % 10 === 0) {
			let n = 0, px = 0; const x0 = Math.max(0, Math.floor(this.cam.x)), x1 = Math.min(w.W - 1, Math.floor(this.cam.x + vw)), y0 = Math.max(0, Math.floor(this.cam.y)), y1 = Math.min(w.H - 1, Math.floor(this.cam.y + this.viewH));
			for (let y = y0; y <= y1; y += 3) for (let x = x0, i = y * w.W + x0; x <= x1; x += 3, i += 3) if (w.type[i] === S.LAVA) { n++; px += x; }
			A.lava = A.lava * 0.6 + n * 0.4; if (n) A.lavaPan = panOf(px / n);
		}
		const dv = Math.abs(h.x - ar.volcano.x);
		s.loop('lava', Math.min(0.45, A.lava * 0.004 + Math.max(0, 0.14 - dv / 1100)), 1, A.lavaPan, 0.4);
		s.loop('lava_rumble', Math.max(0, 0.3 - dv / 800), 1, panOf(ar.volcano.x), 0.6);
		s.loop('gale', h.flying ? Math.min(0.3, Math.hypot(h.vx, h.vy) * 0.016) : 0, 0.8 + Math.hypot(h.vx, h.vy) * 0.025);
		s.tickMusic(DT, Math.min(1, this.enemies.alive() / 6));
	}
	objectives() {
		const h = this.hero;
		if (this.frame % 30 === 0) { this.town = townCells(this.w, this.arena) / this.townInit; this.sea = this.seaCount() / this.seaInit; }
		this.ui.meters(this.town, this.sea, h.health);
		this.ui.activePower(this.powers.beamPow > 0 ? 'lance' : this.powers.charging ? 'blast' : (this.powers.grip || this.powers.held) ? 'grip' : this.powers.rime > 0 ? 'rime' : h.diving ? 'meteor' : h.dashT > 0 ? 'dash' : null);
		// tutorial
		if (this.tut.step >= 0) {
			this.tut.moved += Math.abs(h.x - this.tut.lastX); this.tut.lastX = h.x;
			if (h.flying) this.tut.flyTime += DT;
			const s = TUTORIAL[this.tut.step];
			if (s && s.done(this)) { this.sound.play('objective'); this.tut.step++; if (this.tut.step >= TUTORIAL.length) this.endTutorial(); else this.showTut(); }
			return;
		}
		if (this.mode === 'arena' || this.mode === 'titan' || this.mode === 'leviathan') { this.combatObjectives(); return; }
		if (this.mode !== 'story' || this.done) return;
		if (!this.waveActive) {
			this.waveTimer -= DT;
			if (this.waveTimer <= 0 && this.wave < this.totalWaves) this.spawnWave(this.wave + 1);
			this.ui.objective(this.wave === 0 ? 'Get ready' : `Wave ${this.wave} cleared`, this.wave < this.totalWaves ? `Next wave in ${Math.max(0, Math.ceil(this.waveTimer))}s` : '');
		} else {
			const n = this.enemies.alive();
			this.ui.objective(`Wave ${this.wave} of ${this.totalWaves}: ${n} left`, 'They come from the volcano. Keep the town standing.');
			if (n === 0) { this.waveActive = false; this.waveTimer = 6; if (this.wave >= this.totalWaves) this.finish(); else this.ui.toast(`Wave ${this.wave} cleared`); }
		}
		if (this.town < 0.35) this.finish(true);
	}
	finish(lost = false) {
		this.done = true;
		const st = this.w.stats;
		this.ui.report([
			['Town still standing', `${Math.round(this.town * 100)}%`], ['Sea level', `${Math.round(this.sea * 100)}%`], ['Enemies cleared', `${this.enemies.killed}`],
			['Water boiled', `${(st.boiled / 1000).toFixed(1)}k cells`], ['Rain that fell back', `${(st.rained / 1000).toFixed(1)}k cells`], ['Time', `${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, '0')}`],
		], lost ? 'The town is mostly rubble. The council will write.' : this.town > 0.85 ? 'Town saved. The council is almost grateful.' : 'Town saved, mostly. Expect a bill.');
		this.sound.play('objective');
	}
	// ---------------------------------------------------------------- draw
	// state of the previous tick, for drawing between ticks (smooth motion on any display rate, no stepping)
	prev: { cam: { x: number; y: number }; j: Record<string, { x: number; y: number }>; cape: { x: number; y: number }[]; hair: { x: number; y: number }[]; root: { x: number; y: number } } | null = null;
	snapshot() {
		const rig = this.hero.rig, j: Record<string, { x: number; y: number }> = {};
		for (const k in rig.j) { const v = (rig.j as any)[k]; if (v && typeof v.x === 'number') j[k] = { x: v.x, y: v.y }; }
		this.prev = { cam: { x: this.cam.x, y: this.cam.y }, j, cape: rig.cape.map(p => ({ x: p.x, y: p.y })), hair: rig.hair.map(p => ({ x: p.x, y: p.y })), root: { x: this.hero.x, y: this.hero.y } };
	}
	draw(alpha = 1) {
		const pr = this.prev, rig = this.hero.rig;
		if (!pr || alpha >= 1) { this.drawFrame(this.cam.x, this.cam.y, this.hero.x, this.hero.y); return; }
		const L = (a: number, b: number) => a + (b - a) * alpha;
		const saveJ = rig.j, saveCape = rig.cape.map(p => ({ x: p.x, y: p.y })), saveHair = rig.hair.map(p => ({ x: p.x, y: p.y }));
		const j: any = { ...saveJ };
		for (const k in pr.j) if (saveJ[k]) j[k] = { x: L(pr.j[k].x, saveJ[k].x), y: L(pr.j[k].y, saveJ[k].y) };
		rig.j = j;
		rig.cape.forEach((p, i) => { if (pr.cape[i]) { p.x = L(pr.cape[i].x, p.x); p.y = L(pr.cape[i].y, p.y); } });
		rig.hair.forEach((p, i) => { if (pr.hair[i]) { p.x = L(pr.hair[i].x, p.x); p.y = L(pr.hair[i].y, p.y); } });
		this.drawFrame(L(pr.cam.x, this.cam.x), L(pr.cam.y, this.cam.y), L(pr.root.x, this.hero.x), L(pr.root.y, this.hero.y));
		rig.j = saveJ; rig.cape.forEach((p, i) => { p.x = saveCape[i].x; p.y = saveCape[i].y; }); rig.hair.forEach((p, i) => { p.x = saveHair[i].x; p.y = saveHair[i].y; });
	}
	drawFrame(camX: number, camY: number, rootX: number, rootY: number) {
		const t0 = performance.now();
		const r = this.r;
		const sh = this.trauma * this.trauma;
		r.scale = this.scale(); r.cam = [camX, camY];
		r.shake = [Math.sin(this.time * 61) * 0.005 * sh, Math.sin(this.time * 47 + 1) * 0.007 * sh]; r.shakeRot = Math.sin(this.time * 53 + 2) * 0.028 * sh;
		r.flash = this.flashV; r.aberr = 0.004 * sh;
		const p = this.powers, h = this.hero;
		if (p.held && !this.bodies.list.includes(p.held)) p.held = null; // a held chunk that broke up or settled is gone (never touch a removed body)
		// beam: outer heat, core and white-hot centre, with flares at both ends
		const aimNow = this.drawAim(camX, camY);
		this.lastDrawAim = aimNow;
		if (p.beam && p.beamPow > 0) {
			const m0 = p.muzzle(), hit = p.ray(m0, aimNow);
			const b = { x0: m0.x, y0: m0.y, x1: hit.x, y1: hit.y, hit: hit.hit }; p.drawnBeam = b;
			const k = p.beamPow, fl = 1 + 0.15 * Math.sin(this.time * 90);
			r.glow(b.x0, b.y0, 7 * k, [3.5 * k, 1.1 * k, 0.25 * k], b.x1, b.y1);
			r.cap(b.x0, b.y0, b.x1, b.y1, 0.9 * k * fl, 1.3 * k * fl, [0, 0, 0, 0], [9 * k, 4.5 * k, 1.6 * k], false);
			r.cap(b.x0, b.y0, b.x1, b.y1, 0.35 * k, 0.45 * k, [0, 0, 0, 0], [14 * k, 12 * k, 9 * k], false);
			if (b.hit) r.glow(b.x1, b.y1, (6 + 2 * Math.sin(this.time * 50)) * k, [8 * k, 3.5 * k, 0.9 * k]);
			r.glow(b.x0, b.y0, 2.8 * k, [8 * k, 5 * k, 2 * k]);
		}
		if (p.charging && p.charge > 0) { const m = p.muzzle(), c = p.charge; r.glow(m.x, m.y, 2 + 5 * c + Math.sin(this.time * 40) * c, [4 + 8 * c, 1.6 + 3 * c, 0.5 + c]); }
		if (p.lastBolt && p.lastBolt.t > 0) { const b = p.lastBolt; r.cap(b.x0, b.y0, b.x1, b.y1, 1.2 * b.t / 0.12, 1.6 * b.t / 0.12, [0, 0, 0, 0], [14, 8, 3], false); b.t -= 1 / 60; }
		if (p.rime > 0) { const m = p.muzzle(); r.glow(m.x, m.y, 4 * p.rime, [1.2, 2.2, 3.4]); }
		// Grip: before grabbing, outline exactly the cells the circle would lift; while holding, outline the chunk
		if (p.grip && !p.held) { const cells = p.gripCells(p.grip.x, p.grip.y, p.grip.r); const set = new Set(cells); const W = this.w.W; const fail = p.gripFail > 0; for (const i of cells) { if (set.has(i - 1) && set.has(i + 1) && set.has(i - W) && set.has(i + W)) continue; const x = (i % W) + 0.5, y = ((i / W) | 0) + 0.5; r.cap(x, y, x, y, 0.55, 0.55, [0, 0, 0, 0], fail ? [3, 0.5, 0.4] : [1.4, 1.0, 3.2], false); } }
		if (p.held) { const b = p.held, t2 = b.rb.translation(), a2 = b.rb.rotation(), c2 = Math.cos(a2), s2 = Math.sin(a2); for (let k = 0; k < b.mask.length; k++) { if (!b.mask[k]) continue; const ix = k % b.bw, iy = (k / b.bw) | 0; const edge = ix === 0 || iy === 0 || ix === b.bw - 1 || iy === b.bh - 1 || !b.mask[k - 1] || !b.mask[k + 1] || !b.mask[k - b.bw] || !b.mask[k + b.bw]; if (!edge) continue; const lx = ix + 0.5 + b.ox, ly = iy + 0.5 + b.oy; const x = t2.x * 10 + c2 * lx - s2 * ly, y = t2.y * 10 + s2 * lx + c2 * ly; r.cap(x, y, x, y, 0.5, 0.5, [0, 0, 0, 0], [1.0, 0.7, 2.6], false); } }
		if (p.held) { const b = p.held, q = b.rb.translation(), m = h.rig.j['hand' + (h.rig.fv > 0 ? 1 : 0)] ?? { x: h.x, y: h.y - 10 }; for (let k = 0; k < 3; k++) { const jx = (Math.random() - 0.5) * 3, jy = (Math.random() - 0.5) * 3; r.cap(m.x, m.y, q.x * 10 + jx, q.y * 10 + jy, 0.15, 0.15, [0, 0, 0, 0], [1.2, 0.9, 3.2], false); } }
		// flying water (rain, spray, splashes) as short light streaks along its motion
		{ const w = this.w, x0 = camX - 4, x1 = camX + this.viewW() + 4, y0 = camY - 4, y1 = camY + this.viewH + 4;
			for (let k = 0; k < w.pn; k++) { if (w.pt[k] !== S.WATER) continue; const x = w.px[k], y = w.py[k]; if (x < x0 || x > x1 || y < y0 || y > y1) continue; const vx = w.pvx[k], vy = w.pvy[k]; r.cap(x, y, x - vx * 0.035, y - vy * 0.035, 0.16, 0.12, [0.62, 0.78, 0.9, 0.55], null, false); } }
		this.fx.draw(r);
		for (const g of this.fx.ghosts) { const save = h.rig.j; h.rig.j = g.joints; r.anchor = [g.joints.pel?.x ?? 0, g.joints.pel?.y ?? 0]; const a = 1 - g.life / g.max; h.rig.draw(r, [g.tint[0] * a, g.tint[1] * a, g.tint[2] * a, g.tint[3] * a]); h.rig.j = save; }
		this.enemies.draw(r, this.time);
		this.bosses.draw(r, this.time);
		r.anchor = [rootX, rootY]; h.rig.draw(r); r.anchor = [0, 0];
		r.render(this.time);
		// screen-space reticle for Grip
		const sc = this.scale();
		// pad aim: put the crosshair on the game's aim point
		if (this.input.usingPad && this.mode !== 'title') { const rect = this.canvas.getBoundingClientRect(); this.ui.cursorAt((this.aimW.x - camX) * sc * rect.width / this.canvas.width, (this.aimW.y - camY) * sc * rect.height / this.canvas.height, true); }
		if (p.grip || p.held) this.ui.gripRing(p.gripR * sc * this.canvas.getBoundingClientRect().width / this.canvas.width, !!p.held); else this.ui.gripRing(0, false);
		this.renderMsAvg = this.renderMsAvg * 0.95 + (performance.now() - t0) * 0.05;
	}
	// ---------------------------------------------------------------- test hooks
	lastDrawAim = { x: 0, y: 0 };
	// where the cursor is in the world for this drawn frame (mouse: under the pointer; stick: the game's aim point)
	drawAim(camX: number, camY: number) {
		const it = this.it;
		if (it && it.aimWX !== undefined && it.aimWY !== undefined) return { x: it.aimWX, y: it.aimWY };
		if (!this.input.usingPad && !this.input.virtual?.aimWX) { const rect = this.canvas.getBoundingClientRect(); const c = this.input.css; if (c.x >= 0) return this.screenToWorld(c.x * this.canvas.width / Math.max(1, rect.width), c.y * this.canvas.height / Math.max(1, rect.height), camX, camY); }
		return this.aimW;
	}
	advance(n: number) { for (let k = 0; k < n; k++) this.tick(); this.draw(); }
	state() {
		const h = this.hero, st = this.w.stats, ps = this.powers.stats;
		return {
			mode: this.mode, frame: this.frame, time: +this.time.toFixed(2), fps: +this.fps.toFixed(1), simMs: +this.simMsAvg.toFixed(2), renderMs: +this.renderMsAvg.toFixed(2), worldMs: +this.w.simMs.toFixed(2),
			hero: { x: +h.x.toFixed(1), y: +h.y.toFixed(1), vx: +h.vx.toFixed(2), vy: +h.vy.toFixed(2), grounded: h.grounded, flying: h.flying, tumble: h.tumble, health: Math.round(h.health) },
			world: { ...st, particles: this.w.pn, activeChunks: this.w.activeChunks, updated: this.w.updated },
			powers: { ...ps }, bodies: this.bodies.list.length, bodyStats: { ...this.bodies.stats },
			enemies: { alive: this.enemies.alive(), killed: this.enemies.killed, spawned: this.enemies.spawned, kinds: this.enemies.list.map(e => e.kind), stats: { ...this.enemies.stats }, shots: this.enemies.shots.length },
			combat: { damage: { taken: Math.round(this.dmg.taken), hits: this.dmg.hits, minHealth: Math.round(this.dmg.minHealth), byKind: this.dmg.byKind }, result: this.result, rank: this.style.rank(), bestRank: this.style.bestRank, meter: Math.round(this.style.meter), maxCombo: this.style.maxCombo, combos: [...this.style.found], kills: { ...this.killsByKind }, boss: this.bosses.boss ? { kind: this.bosses.boss.kind, dead: this.bosses.boss.dead, health: +this.bosses.health().toFixed(3), phase: this.bosses.stats.phase, stats: { ...this.bosses.stats } } : null },
			town: +this.town.toFixed(3), sea: +this.sea.toFixed(3), wave: this.wave, tutorial: this.tut.step,
			rig: { ...h.rig.stats, pops: { over: h.rig.pops.over, hard: h.rig.pops.hard, max: h.rig.pops.max, impactMax: h.rig.pops.impactMax } },
		};
	}
}
