// Renders a busy mix offline in the page with the game's own decoded recordings and the same bus (compressor ->
// limiter), then measures it with ffmpeg (EBU R128): the bed alone (music, wind, sea and surf by the beach, at the
// game's levels), the loudest moments, the true peak. Target: big events 14-16 LU above the music, nothing
// clipping. A rain shower with a thunderclap runs through the middle.
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { launch, startPreview, watch } from './lib.mjs';
mkdirSync('shots/audio', { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage(); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
await page.evaluate(() => __game.game.sound.start());
await page.waitForFunction(() => __game.game.sound.ready, null, { timeout: 30000 });
const b64 = await page.evaluate(async () => {
	const B = __game.game.sound.buffers, snd = __game.game.sound, SR = 44100, T = 18;
	const ctx = new OfflineAudioContext(2, SR * T, SR);
	const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.005; comp.release.value = 0.2; comp.knee.value = 6;
	const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -3; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06; lim.knee.value = 0;
	const out = ctx.createGain(); out.gain.value = 0.8; comp.connect(lim); lim.connect(out); out.connect(ctx.destination);
	const sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(comp);
	const duck = ctx.createGain(); duck.connect(comp);
	const one = (id, at, vol = 1, rate = 1, pan = 0, k = 0) => { const buf = B[id][k % B[id].length]; const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; const g = ctx.createGain(); g.gain.value = vol; const p = ctx.createStereoPanner(); p.pan.value = pan; s.connect(g); g.connect(p); p.connect(sfx); s.start(at); };
	const loop = (id, from, to, vol, bus) => { const s = ctx.createBufferSource(); s.buffer = B[id][0]; s.loop = true; const g = ctx.createGain(); g.gain.value = vol; s.connect(g); g.connect(bus); s.start(from); s.stop(to); };
	const mus = ctx.createGain(); mus.gain.value = snd.musicLevel; mus.connect(duck);
	{ const m = ctx.createBufferSource(); m.buffer = B.music[0]; m.connect(mus); m.start(0, 20); m.stop(T); } // 20 s into the track
	// the ambience bus as in the game, with the levels the game sets on the beach (the loudest bed: surf close, sea in view)
	const amb = ctx.createGain(); amb.gain.value = snd.ambLevel; amb.connect(duck);
	loop('wind_loop', 0, T, 0.2 * 1.6, amb); loop('surf_loop', 0, T, 0.3 * 1.6, amb); loop('sea_loop', 0, T, 0.2 * 1.6, amb); loop('lava_loop', 0, T, 0.05 * 1.6, amb);
	const wave = (at, v) => { const s2 = ctx.createBufferSource(); s2.buffer = B.wave[1]; const g = ctx.createGain(); g.gain.value = v; s2.connect(g); g.connect(amb); s2.start(at); };
	wave(4.2, 0.8); // after the bed window
	// a shower from 12 s, with a thunderclap
	loop('rain_light_loop', 12, T, 0.25 * 1.6, amb); loop('rain_heavy_loop', 13.5, T, 0.4 * 1.6, amb);
	{ const t2 = ctx.createBufferSource(); t2.buffer = B.thunder[2]; const g = ctx.createGain(); g.gain.value = 0.95; t2.connect(g); g.connect(sfx); t2.start(17.0); }
	const blast = (at, size, pan, k) => { one(size > 0.55 ? 'blast' : 'blast_small', at, 0.6 + 0.4 * size, 1, pan, k); one('blast_sub', at, Math.min(1, 0.4 + size * 0.6), 1, pan * 0.3); one('blast_tail', at + 0.08, 0.45, 1, pan, k); one('debris', at + 0.22, Math.min(1, 0.25 + size * 0.5), 1, pan, k); duck.gain.setTargetAtTime(0.35, at, 0.02); duck.gain.setTargetAtTime(1, at + 0.3, 0.7); };
	blast(3, 1, 0, 0); blast(6.5, 1, -0.4, 1); one('rock_heavy', 8, 1, 1, 0.3, 0); one('debris', 8.1, 0.8, 1, 0.3, 1); blast(10.5, 1.2, 0.2, 2); one('quake', 10.5, 0.8);
	loop('beam_loop', 11.8, 13.6, 0.5 * 1.6, sfx); loop('steam_loop', 12, 14, 0.3 * 1.6, sfx); loop('boil_loop', 12, 14, 0.4 * 1.6, sfx); loop('sizzle_loop', 12, 14, 0.25 * 1.6, sfx);
	const buf = await ctx.startRendering();
	// 16-bit PCM WAV
	const n = buf.length, data = new DataView(new ArrayBuffer(44 + n * 4)); const W = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
	W(0, 'RIFF'); data.setUint32(4, 36 + n * 4, true); W(8, 'WAVEfmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 2, true); data.setUint32(24, SR, true); data.setUint32(28, SR * 4, true); data.setUint16(32, 4, true); data.setUint16(34, 16, true); W(36, 'data'); data.setUint32(40, n * 4, true);
	const L = buf.getChannelData(0), R = buf.getChannelData(1); let peak = 0;
	for (let i = 0; i < n; i++) { const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i])); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); data.setInt16(44 + i * 4, l * 32767, true); data.setInt16(46 + i * 4, r * 32767, true); }
	let s = ''; const u8 = new Uint8Array(data.buffer); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return { wav: btoa(s), peak };
});
writeFileSync('shots/audio/busy-mix.wav', Buffer.from(b64.wav, 'base64'));
const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-v', 'verbose', '-i', 'shots/audio/busy-mix.wav', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
const lines = [...r.stderr.matchAll(/t:\s*([\d.]+)\s+TARGET:\S+ LUFS\s+M:\s*(-?[\d.]+)\s+S:\s*(-?[\d.]+)/g)].map(m => ({ t: +m[1], M: +m[2], S: +m[3] }));
const bed = lines.filter(l => l.t > 0.6 && l.t < 2.9).map(l => l.M), bedS = bed.reduce((a, b) => a + b, 0) / bed.length;
const maxM = Math.max(...lines.map(l => l.M).filter(isFinite));
const rainSeg = lines.filter(l => l.t > 15.0 && l.t < 16.9).map(l => l.M), rainM = rainSeg.reduce((a, b) => a + b, 0) / rainSeg.length;
const I = +(r.stderr.match(/I:\s+(-?[\d.]+) LUFS/g).pop().match(/-?[\d.]+/)[0]);
const TP = +(r.stderr.match(/Peak:\s+(-?[\d.]+) dBFS/g).pop().match(/-?[\d.]+/)[0]);
const res = { ambienceBedMomentaryLUFS: +bedS.toFixed(1), loudestMomentaryLUFS: +maxM.toFixed(1), eventsAboveBedLU: +(maxM - bedS).toFixed(1), rainShowerMomentaryLUFS: +rainM.toFixed(1), integratedLUFS: I, truePeakDbTP: TP, samplePeak: +b64.peak.toFixed(3), errors: w.errors.slice(0, 3) };
writeFileSync('shots/audio/mix.json', JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await browser.close(); prev.stop();
