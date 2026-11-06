// Real-time performance in the boss fights (headless, muted, 1920x1080): the normal game loop with rAF while a scripted
// fight runs in real time (Rime Burst, Lava Blasts and the lance on the boss, the boss attacking back). Measures frame
// intervals and the game's CPU time per tick for each boss. Target: 60 fps.
//   node scripts/perfboss.mjs [--size 1920x1080]
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, startPreview, watch, arg } from './lib.mjs';
const [vw, vh] = String(arg('size', '1920x1080')).split('x').map(Number);
mkdirSync('shots/perf', { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const out = {};
for (const mode of ['titan', 'leviathan']) {
	const page = await browser.newPage({ viewport: { width: vw, height: vh } }); const w = watch(page, prev.url);
	await page.goto(prev.url + `?autostart=1&mode=${mode}&seed=7`); await page.waitForFunction(() => window.__game);
	await page.evaluate((mode) => {
		const g = __game.game; window.__perf = { frames: [], cpu: [], cells: 0, bodies: 0, particles: 0 };
		let last = performance.now();
		const tick = g.tick.bind(g);
		g.tick = () => { const a = performance.now(); tick(); window.__perf.cpu.push(performance.now() - a); const p = window.__perf; p.bodies = Math.max(p.bodies, g.bodies.list.length); p.particles = Math.max(p.particles, g.w.pn); };
		const loop = n => { window.__perf.frames.push(n - last); last = n; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
		let f = 0;
		setInterval(() => {
			f++; const b = g.bosses.boss; if (!b || b.dead) { __game.setInput({}); return; }
			const h = g.hero;
			if (mode === 'titan') {
				const arm = [b.parts[2], b.parts[3]].find(p => p.alive);
				const q = arm ? g.enemies.worldOf(b, arm, 0, 34) : { x: b.x, y: b.y - 31 };
				__game.aimAt(q.x, q.y);
				const phase = f % 200;
				__game.setInput({ rime: phase < 110, charge: phase >= 120 && phase < 160, lance: phase >= 170, x: Math.sign(q.x - 50 - h.x) * 0.6, y: Math.sign(q.y - 10 - h.y) * 0.6 });
			} else {
				__game.aimAt(b.x, b.y);
				const phase = f % 240;
				__game.setInput({ lance: phase < 120, rime: phase >= 120 && phase < 190, charge: phase >= 200 && phase < 230, x: Math.sign(b.x + 46 - h.x) * 0.6, y: Math.sign(b.data.sea - 44 - h.y) * 0.6 });
			}
		}, 16);
	}, mode);
	await page.waitForTimeout(16000);
	const r = await page.evaluate(() => { const st = v => { const s = [...v].slice(90).sort((a, b) => a - b); return { mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), p99: +s[Math.floor(s.length * 0.99)].toFixed(2), max: +s[s.length - 1].toFixed(2), n: s.length }; }; const g = __game.game; return { frameMs: st(__perf.frames), cpuMs: st(__perf.cpu), maxBodies: __perf.bodies, maxParticles: __perf.particles, boss: g.state().combat.boss, renderMs: g.state().renderMs }; });
	await page.screenshot({ path: `shots/perf/${mode}.png` });
	out[mode] = { fps: +(1000 / r.frameMs.mean).toFixed(1), ...r, errors: w.errors.slice(0, 3) };
	out[mode].pass = out[mode].fps >= 58 && r.frameMs.p95 < 20 && !w.errors.length;
	console.log(mode, JSON.stringify(out[mode]));
	await page.close();
}
const pass = Object.values(out).every(o => o.pass);
writeFileSync('shots/perf/bosses.json', JSON.stringify({ size: [vw, vh], ...out, pass }, null, 1));
await browser.close(); prev.stop();
process.exit(pass ? 0 : 1);
