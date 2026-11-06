// Hero animation harness (headless, muted). Plays a scripted course on the runway: runs over sand mounds and steps,
// jumps, a hard skid turn, a pit, flight, a dash and hard landings. Asserts that planted feet never slide and that
// joints don't pop, and writes a clip plus contact sheets.
//   node scripts/anim.mjs [--clip] [--frames 900]
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { launch, startPreview, watch, arg } from './lib.mjs';
const out = 'shots/anim'; mkdirSync(out + '/frames', { recursive: true });
const frames = +arg('frames', 900), clip = !!arg('clip', false);
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=3&arena=runway'); await page.waitForFunction(() => window.__game);
await page.evaluate(() => { const g = __game.game; g.r.scale = 1; }); // camera scale stays the game's own
// the script: what to press on which frame (60 Hz)
const script = `(f, g) => {
  const h = g.hero; let x = 0, jump = false, jp = false, extra = {};
  if (f >= 40 && f < 330) x = 1; else if (f >= 330 && f < 345) x = -1; else if (f >= 360 && f < 600) x = -1; else if (f >= 640 && f < 860) x = 1;
  if (x !== 0 && h.grounded && !h.flying) { const wall = h.overlap(h.x + x * 4, h.y - 5) || h.overlap(h.x + x * 3, h.y - 5); const gg = h.groundAt(h.x + x * 9, h.y, 6, 20); if (wall || gg === null || gg > h.y + 8) jp = true; }
  if ([200, 470, 760].includes(f) && h.grounded) jp = true;
  if (f === 540 && h.grounded) jp = true; if (f === 556 && !h.grounded) { jp = true; } // take off into flight
  if (f >= 557 && f < 600) { extra.y = -0.6; }
  if (f === 600) extra.drop = true; // stop flying: fall and land hard
  if (f === 700) extra.dashPressed = true;
  if (jp) g.__hold = f + 18;
  return { x, jumpPressed: jp, jump: jp || (g.__hold > f), ...extra };
}`;
const shotEvery = 4, sheet = []; const samples = [];
let ff = null;
if (clip) ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', `${out}/hero-anim.mp4`], { stdio: ['pipe', 'ignore', 'inherit'] });
for (let f = 0; f < frames; f++) {
  const rec = await page.evaluate(([src, f]) => { const g = __game.game; const fn = eval(src); const inp = fn(f, g); if (inp.x !== 0 || inp.dashPressed) __game.aimAt(g.hero.x + (inp.x || g.hero.face) * 40, g.hero.y - 9); __game.setInput(inp); g.tick(); if (f % 2 === 1) g.draw(); return window.__jitterSample ? window.__jitterSample() : (() => { const j = g.hero.rig.j, sc = g.scale(); return { sc, cam: [g.cam.x, g.cam.y], snap: 'world', pix: g.r.pix, root: [g.hero.x, g.hero.y], j: ['pel', 'head', 'ankle0', 'ankle1'].map(n => [j[n].x, j[n].y]), grounded: g.hero.grounded && !g.hero.flying }; })(); }, [script, f]);
  samples.push(rec);
  if (clip && f % 2 === 1) ff.stdin.write(await page.screenshot({ type: 'jpeg', quality: 90 }));
  if (f % shotEvery === 0 && f >= 64 && f < 64 + 24 * shotEvery) {
    const c = await page.evaluate(() => { const g = __game.game; g.draw(); const sc = g.scale() / devicePixelRatio; return { x: (g.hero.x - g.cam.x) * sc, y: (g.hero.y - 9 - g.cam.y) * sc }; });
    const p = `${out}/frames/f${String(f).padStart(4, '0')}.png`;
    writeFileSync(p, await page.screenshot({ clip: { x: Math.max(0, Math.min(1280 - 120, c.x - 60)), y: Math.max(0, Math.min(720 - 120, c.y - 60)), width: 120, height: 120 } })); sheet.push(p);
  }
}
if (ff) { ff.stdin.end(); await new Promise(r => ff.on('close', r)); }
const st = await page.evaluate(() => __game.state());
// jitter: where each joint lands on screen (after the renderer's pixel snapping), then its frame-to-frame second
// difference in screen pixels. Ground frames only (that's where the slide showed).
const snap = (v, px, o, mode) => mode === 'none' || !px ? v : (Math.floor((v - o) / px) + 0.5) * px + o;
const names = ['pelvis', 'head', 'foot0', 'foot1', 'plantedFoot0', 'plantedFoot1']; // planted*: only while that foot is planted (a swinging foot is meant to move)
const jit = {};
for (let k = 0; k < names.length; k++) {
  const jk = k < 4 ? k : k - 2;
  const sp = samples.map(s => { const [x, y] = s.j[jk]; const ox = s.snap === 'local' ? s.root[0] : 0, oy = s.snap === 'local' ? s.root[1] : 0; return { x: (snap(x, s.pix, ox, s.snap) - s.cam[0]) * s.sc, y: (snap(y, s.pix, oy, s.snap) - s.cam[1]) * s.sc, g: s.grounded && (k < 4 || !s.plant || s.plant[k - 4]) }; });
  const d = []; for (let i = 2; i < sp.length; i++) if (sp[i].g && sp[i - 1].g && sp[i - 2].g) d.push(Math.hypot(sp[i].x - 2 * sp[i - 1].x + sp[i - 2].x, sp[i].y - 2 * sp[i - 1].y + sp[i - 2].y));
  if (k === 0) { const sp2 = []; for (let i = 2; i < sp.length; i++) if (sp[i].g && sp[i - 1].g && sp[i - 2].g) { const v = Math.hypot(sp[i].x - 2 * sp[i - 1].x + sp[i - 2].x, sp[i].y - 2 * sp[i - 1].y + sp[i - 2].y); if (v > 3) sp2.push({ i, v: +v.toFixed(1), ev: samples[i].ev + '|' + samples[i - 1].ev, y: samples[i].y, py: samples[i - 1].y, vx: +samples[i].vx.toFixed(1), hip: +samples[i].hipW.toFixed(2), phip: +samples[i - 1].hipW.toFixed(2) }); } jit.spikes = sp2.slice(0, 20); }
  d.sort((a, b) => a - b);
  jit[names[k]] = { meanPx: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2), p95Px: +d[Math.floor(d.length * 0.95)].toFixed(2), maxPx: +d[d.length - 1].toFixed(2), over2px: d.filter(v => v > 2).length, frames: d.length };
}
const pops = st.rig.pops;
const res = { jitter: jit, scalePxPerCell: +samples[0].sc.toFixed(2), frames, steps: st.rig.steps, groundFrames: st.rig.groundFrames, slideMaxCells: st.rig.slideMax, slideFrames: st.rig.slideFrames, visualSlipMaxCells: +st.rig.ikShort.toFixed(3), forcedLiftoffs: st.rig.forced, popsOver3: pops.over, popRate: +(pops.over / (frames * 11) * 1000).toFixed(2), hardAccel: pops.hard, popMax: pops.max, powers: st.powers, errors: w.errors.slice(0, 5) };
// gates: no sliding at all; pops at most 5 per 1000 joint-frames; no single joint jump over 8 cells/frame^2
res.pass = res.slideMaxCells === 0 && res.slideFrames === 0 && res.popRate <= 5 && Math.max(...Object.values(pops.max)) <= 8 && res.errors.length === 0 && res.steps > 20;
writeFileSync(`${out}/anim.json`, JSON.stringify(res, null, 1));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...sheet.flatMap(p => ['-i', p]), '-filter_complex', sheet.map((_, i) => `[${i}]scale=300:300:flags=neighbor[s${i}]`).join(';') + ';' + sheet.map((_, i) => `[s${i}]`).join('') + `xstack=inputs=${sheet.length}:layout=` + sheet.map((_, i) => `${(i % 8) * 300}_${Math.floor(i / 8) * 300}`).join('|'), `${out}/hero-sheet.png`]);
console.log(JSON.stringify(res));
await browser.close(); prev.stop();
process.exit(res.pass ? 0 : 1);
