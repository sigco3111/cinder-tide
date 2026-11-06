// Combat HUD check (headless, muted, pointer-lock guarded): boss prompts are cleared when a fight starts and ends and
// belong to the boss being fought (a Titan prompt never shows in the Leviathan's fight), and the meters show what
// matters per mode (town and sea in Play and Sandbox, the sea in the bay fight, neither in Arena or at the Titan).
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, startPreview, watch } from './lib.mjs';
mkdirSync('shots/combat', { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
const res = await page.evaluate(() => {
	const G = __game.game, vis = id => { const el = document.getElementById(id); return getComputedStyle(el).display !== 'none' && el.offsetParent !== null; };
	const toastOn = () => document.getElementById('toast').classList.contains('show'), toastText = () => document.getElementById('toast').textContent;
	const out = {};
	for (const m of ['story', 'sandbox', 'arena', 'titan', 'leviathan']) { G.build(); G.begin(m); out[m] = { town: vis('meter-town'), sea: vis('meter-sea') }; }
	// a Titan prompt, then the Leviathan's fight starts: the prompt must be gone, and the old Titan can't raise new ones
	G.build(); G.begin('titan'); const titan = G.bosses.boss;
	for (let k = 0; k < 10; k++) { __game.setInput({}); G.tick(); }
	G.enemies.events.push({ type: 'limbCool', x: titan.x, y: titan.y, kind: 'titan', mob: titan }); G.enemyEvents();
	out.titanPromptShown = toastOn() && toastText().includes('arm');
	G.build(); G.begin('leviathan');
	out.afterSwitchToastOn = toastOn(); out.afterSwitchToast = toastText();
	G.enemies.events.push({ type: 'limbCool', x: 0, y: 0, kind: 'titan', mob: titan }); G.enemyEvents();
	out.staleTitanPromptShown = toastOn() && toastText().includes('arm');
	// prompts are cleared when a fight ends
	G.bosses.boss.data.dying = 0; G.ui.toast('Cracked! One more blow'); G.win(); out.afterWinToastOn = toastOn();
	return out;
});
res.pass = res.story.town && res.story.sea && res.sandbox.town && !res.arena.town && !res.arena.sea && !res.titan.town && !res.titan.sea && !res.leviathan.town && res.leviathan.sea
	&& res.titanPromptShown && !res.afterSwitchToastOn && !res.staleTitanPromptShown && !res.afterWinToastOn && !w.errors.length;
res.errors = w.errors.slice(0, 3);
writeFileSync('shots/combat/combatui.json', JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await browser.close(); prev.stop();
process.exit(res.pass ? 0 : 1);
