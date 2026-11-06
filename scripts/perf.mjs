// Real-time performance (headless, muted): the normal game loop with rAF, a heavy scripted session (boiling the sea,
// blasts, chunks, a wave of Cinderlings), measuring frame intervals and the game's own CPU time per frame.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, startPreview, watch, arg } from './lib.mjs';
const [vw, vh] = String(arg('size', '1920x1080')).split('x').map(Number);
mkdirSync('shots/perf', { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: vw, height: vh } }); const w = watch(page, prev.url);
const t0 = Date.now();
await page.goto(prev.url + '?autostart=1&mode=sandbox&seed=2'); await page.waitForFunction(() => window.__game);
const firstPlayable = (Date.now() - t0) / 1000;
await page.evaluate(() => {
	const g = __game.game; window.__perf = { frames: [], cpu: [] };
	let last = performance.now();
	const tick = g.tick.bind(g), draw = g.draw.bind(g);
	g.tick = () => { const a = performance.now(); tick(); window.__perf.cpu.push(performance.now() - a); };
	const loop = n => { window.__perf.frames.push(n - last); last = n; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
	// a heavy session driven in real time
	const h = g.hero, a = g.arena; let f = 0;
	g.hero.flying = true; g.hero.x = 560; g.hero.y = a.sea - 60;
	setInterval(() => {
		f++;
		if (f < 300) { __game.aimAt(h.x - 30, a.sea + 4); __game.setInput({ lance: true }); }
		else if (f < 360) { __game.aimAt(660, a.sea - 30); __game.setInput({ charge: true }); }
		else if (f < 600) { __game.aimAt(h.x - 60, a.sea + 4); __game.setInput({ lance: f % 120 < 60, rime: f % 120 >= 60 }); }
		else __game.setInput({});
		if (f === 400) g.spawnWave(3);
	}, 16);
});
await page.waitForTimeout(14000);
const r = await page.evaluate(() => { const st = v => { const s = [...v].slice(60).sort((a, b) => a - b); return { mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), p99: +s[Math.floor(s.length * 0.99)].toFixed(2), max: +s[s.length - 1].toFixed(2), n: s.length }; }; return { frameMs: st(__perf.frames), cpuMs: st(__perf.cpu), state: __game.state() }; });
await page.screenshot({ path: 'shots/perf/end.png' });
const res = { size: [vw, vh], firstPlayableS: firstPlayable, fps: +(1000 / r.frameMs.mean).toFixed(1), frameMs: r.frameMs, tickCpuMs: r.cpuMs, renderMs: r.state.renderMs, world: r.state.world, bodies: r.state.bodies, enemies: r.state.enemies, errors: w.errors.slice(0, 5), offHost: w.offHost.slice(0, 5) };
res.pass = res.fps >= 58 && res.frameMs.p95 < 20 && res.errors.length === 0 && res.offHost.length === 0 && firstPlayable < 10;
writeFileSync('shots/perf/perf.json', JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await browser.close(); prev.stop();
process.exit(res.pass ? 0 : 1);
