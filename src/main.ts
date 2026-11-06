import { initPhysics } from './engine/bodies';
import { Game } from './game/game';
import * as S from './engine/sim';

const q = new URLSearchParams(location.search);
const seed = +(q.get('seed') ?? 7) || 7;
const testMode = q.get('patch-test') === '1' || q.get('manual') === '1';

async function boot() {
	await initPhysics();
	const canvas = document.getElementById('view') as HTMLCanvasElement;
	const game = new Game(canvas, seed, testMode);
	game.resize();
	const api = {
		game,
		state: () => game.state(),
		advance: (n: number) => game.advance(n),
		start: (mode: 'story' | 'sandbox' | 'arena' | 'titan' | 'leviathan' = 'sandbox') => game.begin(mode),
		setInput: (v: Record<string, unknown>) => { const o = game.input.virtual || {}; game.input.virtual = { aimWX: o.aimWX, aimWY: o.aimWY, ...v }; }, // actions replace, aim persists
		clearInput: () => { game.input.virtual = {}; },
		aimAt: (x: number, y: number) => { game.input.virtual = { ...(game.input.virtual || {}), aimWX: x, aimWY: y }; },
		census: () => { const c = game.w.census(); const o: Record<string, number> = {}; S.NAMES.forEach((n, i) => { if (c[i]) o[n] = c[i]; }); return o; },
		noHover: () => game.bodies.detach(1).length, // unsupported solid islands left in the grid (0 means nothing hovers)
		st: (t: number) => S.ST[t],
		islands: () => game.bodies.islands(),
		// hovering = an unsupported solid island of 4+ cells that isn't floating in a liquid
		hovering: () => game.bodies.islands().filter(c => c.n >= 4 && !c.wet),
		arena: () => game.arena,
		teleport: (x: number, y: number) => { game.hero.x = x; game.hero.y = y; game.hero.vx = game.hero.vy = 0; if (game.hero.overlap(x, y)) { game.hero.depenetrate(48); x = game.hero.x; y = game.hero.y; } const r = game.hero.rig; r.lastImpactFrame = r.stats.frames + 2; r.prevJ = null; r.prevJ2 = null; r.hipW = null; r.blendT = 0.2; for (const f of r.feet) { f.x = x; f.y = y - 0.6; f.plant = false; } r.resetCloth(); },
		skipTutorial: () => game.endTutorial(),
		spawnWave: (n: number) => game.spawnWave(n),
	};
	(window as any).__game = api;
	// what the renderer puts on screen for the hero (pixel-snap anchored to the hero's root), for the jitter harness
	(window as any).__jitterSample = () => { const h = game.hero, j = h.rig.j; return { sc: game.scale(), cam: [game.cam.x, game.cam.y], snap: game.r.pix > 0 ? 'local' : 'none', pix: game.r.pix, plant: h.rig.feet.map(f => f.plant), root: [h.x, h.y], j: ['pel', 'head', 'ankle0', 'ankle1'].map(n => [j[n].x, j[n].y]), grounded: h.grounded && !h.flying, ev: h.events.map(e => e.type).join(','), y: h.y, vx: h.vx, hipW: h.rig.hipW?.x ?? 0 }; };
	if (testMode || q.get('autostart')) game.begin((q.get('mode') as 'story' | 'sandbox' | 'arena' | 'titan' | 'leviathan') || 'sandbox');
	document.getElementById('loading')?.remove();
	document.body.classList.add('ready');
	requestAnimationFrame(game.frameLoop);
}
boot().catch(e => { console.error(e); const el = document.getElementById('loading'); if (el) el.textContent = 'This game needs WebGL2. ' + String(e?.message ?? e); });
