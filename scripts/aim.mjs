// Aim accuracy (headless, muted, pointer-lock guarded). Moves the real mouse along a path over the canvas while the
// hero flies and the camera scrolls, holding the Magma Lance. Every frame it checks:
//   - the world point under the pointer (from the page's own pixels) is where the game thinks the cursor is (<= 0.5 cell)
//   - the drawn beam ends on the ray from the hand through the cursor (<= 1 cell off the ray)
//   - and at the first solid on that ray (<= 1 cell), and the crosshair element sits exactly on the pointer
// Runs at two setups (a big window where the canvas is downscaled, and a 1.5x DPR window), then checks the right stick.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, startPreview, watch } from './lib.mjs';
mkdirSync('shots/aim', { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const out = {};
for (const [name, vw, vh, dsf] of [['big-2400x1350', 2400, 1350, 1], ['dpr1.5-1280x720', 1280, 720, 1.5]]) {
	const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dsf });
	const page = await ctx.newPage(); const w = watch(page, prev.url);
	await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
	await page.evaluate(() => { const g = __game.game; g.resize(); __game.teleport(420, g.arena.sea - 70); g.hero.flying = true; g.hero.face = 1; });
	const errs = [], perp = [], end = [], cur = [], dom = [], old = [];
	for (let f = 0; f < 240; f++) {
		const t = f / 60, mx = vw * (0.5 + 0.38 * Math.sin(t * 1.7)), my = vh * (0.55 + 0.3 * Math.sin(t * 2.3 + 1));
		await page.mouse.move(mx, my);
		const r = await page.evaluate(([mx, my]) => {
			const g = __game.game, p = g.powers;
			__game.setInput({ lance: true, x: 0.6 }); g.tick(); g.draw();
			const rect = g.canvas.getBoundingClientRect();
			const exp = { x: g.cam.x + (mx - rect.left) * (g.canvas.width / rect.width) / g.scale(), y: g.cam.y + (my - rect.top) * (g.canvas.height / rect.height) / g.scale() };
			const a = g.lastDrawAim, b = p.drawnBeam;
			if (!b) return null;
			const dx = a.x - b.x0, dy = a.y - b.y0, L = Math.hypot(dx, dy) || 1;
			const perp = Math.abs((b.x1 - b.x0) * dy / L - (b.y1 - b.y0) * dx / L);
			const ref = p.ray({ x: b.x0, y: b.y0 }, a);
			const el = document.getElementById('cursor').getBoundingClientRect();
			// what 0.1.0 did: offsetX * devicePixelRatio, ignoring the canvas's own size
			const old = { x: g.cam.x + (mx - rect.left) * devicePixelRatio / g.scale(), y: g.cam.y + (my - rect.top) * devicePixelRatio / g.scale() };
			return { old: Math.hypot(exp.x - old.x, exp.y - old.y), cur: Math.hypot(exp.x - a.x, exp.y - a.y), perp, end: Math.hypot(ref.x - b.x1, ref.y - b.y1), dom: Math.hypot(el.left - mx, el.top - my), cam: [g.cam.x, g.cam.y] };
		}, [mx, my]);
		if (!r) continue;
		old.push(r.old); cur.push(r.cur); perp.push(r.perp); end.push(r.end); dom.push(r.dom);
		if (f === 120) await page.screenshot({ path: `shots/aim/${name}.png` });
	}
	const mx = a => +Math.max(...a).toFixed(3);
	out[name] = { frames: perp.length, v010CursorErrMaxCells: mx(old), cursorWorldErrMaxCells: mx(cur), beamOffRayMaxCells: mx(perp), beamEndVsFirstSolidMaxCells: mx(end), crosshairOffPointerMaxPx: mx(dom), errors: w.errors.slice(0, 3) };
	out[name].pass = out[name].cursorWorldErrMaxCells <= 0.5 && out[name].beamOffRayMaxCells <= 1 && out[name].beamEndVsFirstSolidMaxCells <= 1 && out[name].crosshairOffPointerMaxPx <= 1.5 && !w.errors.length;
	await ctx.close();
}
// right stick: a faked standard gamepad
{
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
	await ctx.addInitScript(() => { window.__pad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [{ id: 'test', index: 0, connected: true, mapping: 'standard', axes: window.__pad.axes, buttons: window.__pad.buttons, timestamp: performance.now() }]; });
	const page = await ctx.newPage(); const w = watch(page, prev.url);
	await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
	await page.evaluate(() => { const g = __game.game; __game.teleport(420, g.arena.sea - 70); g.hero.flying = true; __game.clearInput(); __game.game.input.virtual = null; });
	const errs = [];
	for (let f = 0; f < 120; f++) {
		const ang = f / 120 * Math.PI * 2;
		const e = await page.evaluate(ang => {
			const g = __game.game; window.__pad.axes = [0, 0, Math.cos(ang), Math.sin(ang)]; window.__pad.buttons[7] = { pressed: true, value: 1 };
			g.tick(); g.draw();
			const b = g.powers.drawnBeam, h = g.hero; if (!b) return null;
			const aimAng = Math.atan2(g.aimW.y - (h.y - 9), g.aimW.x - h.x);
			let d = Math.abs(aimAng - ang) % (Math.PI * 2); if (d > Math.PI) d = Math.PI * 2 - d;
			const ref = g.powers.ray({ x: b.x0, y: b.y0 }, g.lastDrawAim);
			return { deg: d * 180 / Math.PI, end: Math.hypot(ref.x - b.x1, ref.y - b.y1) };
		}, ang);
		if (e) errs.push(e);
	}
	out.gamepadRightStick = { frames: errs.length, stickToAimMaxDeg: +Math.max(...errs.map(e => e.deg)).toFixed(2), beamEndVsFirstSolidMaxCells: +Math.max(...errs.map(e => e.end)).toFixed(3), errors: w.errors.slice(0, 3) };
	out.gamepadRightStick.pass = out.gamepadRightStick.stickToAimMaxDeg <= 1 && out.gamepadRightStick.beamEndVsFirstSolidMaxCells <= 1 && !w.errors.length;
	await ctx.close();
}
out.pass = Object.values(out).every(v => v.pass);
writeFileSync('shots/aim/aim.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
await browser.close(); prev.stop();
process.exit(out.pass ? 0 : 1);
