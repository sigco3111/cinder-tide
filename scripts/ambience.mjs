// Ambience test (headless, muted, pointer-lock guarded): the recorded beds follow what the world is doing.
// - sea and surf: loud on the beach, near silent up in the town;
// - rain: boil the sea, let the cloud form, and the rain beds track the drops actually falling in view (correlation),
//   silent when nothing falls; thunder only while it rains;
// - boiling, steam and sizzle while the Magma Lance boils water; sizzle hits when lava is quenched by the sea;
// - lava crackle near the volcano; the music bed is playing and ducks under a blast.
// Records the levels the game asks for (Sound.loop targets) every frame. Writes shots/audio/ambience.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, startPreview, watch } from './lib.mjs';
mkdirSync('shots/audio', { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
await page.evaluate(() => __game.game.sound.start()); await page.waitForFunction(() => __game.game.sound.ready, null, { timeout: 30000 });
await page.evaluate(() => {
	const s = __game.game.sound; window.__lv = {}; window.__plays = [];
	const L = s.loop.bind(s); s.loop = (n, v, ...r) => { window.__lv[n] = v; return L(n, v, ...r); };
	const P = s.play.bind(s); s.play = (n, o) => { window.__plays.push(n); return P(n, o); };
});
const run = (n, inp = '() => ({})', aim = null) => page.evaluate(([n, inp, aim]) => {
	const g = __game.game, out = [];
	for (let k = 0; k < n; k++) {
		const i = (0, eval)(inp)(g); if (aim) { const [x, y] = (0, eval)(aim)(g, g.hero, g.arena); __game.aimAt(x, y); }
		__game.setInput(i); g.tick();
		out.push({ ...window.__lv, drops: g.amb.rain, thunders: g.amb.thunders, waves: g.amb.waves, duck: g.sound.duck ? g.sound.duck.gain.value : 1 });
	}
	return out;
}, [n, inp, aim]);
const put = (x, y, fly = true) => page.evaluate(([x, y, fly]) => { const g = __game.game; __game.teleport(x, y); g.hero.flying = fly; g.cam.x = x - g.viewW() / 2; g.cam.y = y - 10 - g.viewH * 0.55; }, [x, y, fly]);
const sea = await page.evaluate(() => __game.game.arena.sea), spawn = await page.evaluate(() => __game.game.arena.spawn);
const mean = (a, k) => a.reduce((s, f) => s + (f[k] || 0), 0) / a.length;
const res = {};
// beach vs town
await put(560, sea - 24); const beach = await run(240);
await put(spawn.x + 160, spawn.y - 30); const town = await run(240);
res.surfBeach = +mean(beach.slice(60), 'surf').toFixed(3); res.surfTown = +mean(town.slice(60), 'surf').toFixed(3);
res.seaBeach = +mean(beach.slice(60), 'sea').toFixed(3); res.seaTown = +mean(town.slice(60), 'sea').toFixed(3);
res.wavesOnBeach = beach[beach.length - 1].waves;
// lava near the volcano
const vx = await page.evaluate(() => __game.game.arena.volcano);
await put(vx.x, vx.top - 30); const volc = await run(120);
res.lavaNearVolcano = +mean(volc.slice(30), 'lava').toFixed(3); res.lavaInTown = +mean(town.slice(60), 'lava').toFixed(3);
// boil the sea
await put(470, sea - 50);
const boil = await run(360, '() => ({ lance: true })', '(g, h, a) => [h.x - 26, a.sea + 4]');
res.boilWhileLancing = +mean(boil.slice(60), 'boil').toFixed(3); res.steamWhileLancing = +mean(boil.slice(60), 'steam').toFixed(3); res.sizzleWhileLancing = +mean(boil.slice(60), 'sizzle').toFixed(3);
const after = await run(90); res.boilAfterStopping = +mean(after.slice(60), 'boil').toFixed(3);
// lava blast into the sea: quench sizzles
await page.evaluate(() => { window.__plays.length = 0; });
await page.evaluate(() => { const g = __game.game, w = g.w, x0 = Math.round(g.hero.x) - 30, y0 = g.arena.sea - 12; for (let y = y0; y < y0 + 8; y++) for (let x = x0 - 6; x <= x0 + 6; x++) { const i = y * w.W + x; if (w.type[i] === 0) { w.type[i] = 4; w.temp[i] = 1500; w.wake(x, y); } } }); // a blob of lava dropped into the sea
await run(180);
res.sizzleHitsAfterLavaInSea = await page.evaluate(() => window.__plays.filter(p => p === 'sizzle').length);
res.quenched = await page.evaluate(() => __game.game.w.stats.quenched);
// rain: wait under the cloud (steam rises, condenses and falls); then move away from it
await put(470, await page.evaluate(() => __game.game.w.cloudLine + 70));
const rain = await run(900);
const xs = rain.map(f => f.drops), ys = rain.map(f => (f.rain_light || 0) + (f.rain_heavy || 0));
const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
res.rainDropsInViewMax = +Math.max(...xs).toFixed(1); res.rainDropsInViewMean = +mx.toFixed(1);
res.rainLevelVsDropsCorrelation = +(sxy / Math.sqrt(sxx * syy || 1)).toFixed(3);
res.rainLevelWhenNoDrops = +Math.max(0, ...rain.filter(f => f.drops < 0.5).map(f => (f.rain_light || 0) + (f.rain_heavy || 0))).toFixed(3);
res.thunders = rain[rain.length - 1].thunders;
await put(spawn.x + 300, spawn.y - 30); const dry = await run(200);
res.rainLevelAwayFromCloud = +mean(dry.slice(120), 'rain_light').toFixed(3);
res.thundersStartedWhileDry = dry[dry.length - 1].thunders - rain[rain.length - 1].thunders;
// music: playing, and ducked by a blast
res.musicGain = await page.evaluate(() => +__game.game.sound.mus.gain.value.toFixed(3));
// audio time runs in real time while ticks here run faster, so wait for the duck in real time
res.duckDuringBlast = await page.evaluate(async () => { const s = __game.game.sound; s.play('blast', { size: 1 }); await new Promise(r => setTimeout(r, 120)); return +s.duck.gain.value.toFixed(3); });
res.errors = w.errors.slice(0, 3);
res.pass = res.surfBeach > 0.15 && res.surfTown < 0.05 && res.seaBeach > res.seaTown && res.lavaNearVolcano > res.lavaInTown && res.boilWhileLancing > 0.1 && res.boilAfterStopping < 0.05
	&& res.sizzleHitsAfterLavaInSea > 0 && res.rainDropsInViewMax > 20 && res.rainLevelVsDropsCorrelation > 0.7 && res.rainLevelWhenNoDrops < 0.05 && res.rainLevelAwayFromCloud < 0.05
	&& res.thundersStartedWhileDry === 0 && res.musicGain > 0.02 && res.duckDuringBlast < 0.8 && !w.errors.length;
writeFileSync('shots/audio/ambience.json', JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await browser.close(); prev.stop();
process.exit(res.pass ? 0 : 1);
