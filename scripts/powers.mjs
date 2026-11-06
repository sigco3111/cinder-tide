// Exercises each power from sensible spots and saves a screenshot after each (headless, muted). Prints counters.
import { mkdirSync } from 'node:fs';
import { launch, startPreview, watch, arg } from './lib.mjs';
const out = arg('out', 'shots/powers'); mkdirSync(out, { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?patch-test=1&seed=7'); await page.waitForFunction(() => window.__game);
const G = (f, a) => page.evaluate(f, a);
const shot = n => page.screenshot({ path: `${out}/${n}.png` });
const step = (n, input) => G(([n, inp]) => { for (let k = 0; k < n; k++) { __game.setInput(inp); __game.advance(1); } }, [n, input || {}]);
const hold = (n, input, aim) => G(([n, inp, aim]) => { for (let k = 0; k < n; k++) { const g = __game.game; const a = aim === 'sea' ? [g.hero.x - 40, g.arena.sea + 4] : aim; __game.aimAt(a[0], a[1]); __game.setInput(inp); __game.advance(1); } }, [n, input, aim]);
// 1. take off from the town and fly out over the sea
await step(20, {});
await step(1, { jumpPressed: true, jump: true }); await step(14, { jump: true });
await step(1, { jumpPressed: true }); await step(25, { y: -1 }); await step(70, { x: -1, y: 0.25 }); await step(20, {});
await shot('1-fly');
// 2. boil the sea
await hold(150, { lance: true }, 'sea'); await shot('2-boil');
await hold(150, { lance: true }, 'sea');
await step(300, {}); await shot('3-clouds');
await step(400, {}); await shot('3b-rain');
// 3. freeze the sea
await hold(90, { rime: true }, 'sea'); await step(10, {}); await shot('4-freeze');
// 4. charged blast at the cliff
await hold(55, { charge: true }, [668, 250]); await step(1, {}); await shot('5-blast'); await step(40, {});
// 5. grip a chunk of the plateau and throw it into the sea
await G(() => { __game.teleport(900, 150); __game.game.hero.flying = true; }); await step(20, {});
await hold(40, { grip: true }, [880, 212]); await step(1, {}); await step(30, {}); await shot('6-grip-hold');
await hold(1, { gripPressed: true }, [560, 300]); await step(45, {}); await shot('7-throw');
// 6. meteor drop on the plateau
await G(() => { __game.teleport(1000, 90); __game.game.hero.flying = false; }); await step(1, { meteorPressed: true }); await step(40, {}); await shot('8-slam');
// 7. dash down through rock
await G(() => { __game.teleport(985, 200); }); await step(10, {}); await hold(1, { dashPressed: true }, [1040, 290]); await step(5, {}); await shot('9-dash'); await step(60, {});
const st = await G(() => __game.state());
const hover = await G(() => __game.noHover());
console.log(JSON.stringify({ powers: st.powers, world: st.world, bodies: st.bodies, bodyStats: st.bodyStats, sea: st.sea, town: st.town, hover, rig: st.rig.pops, errors: w.errors.slice(0, 8), offHost: w.offHost.slice(0, 3) }, null, 0));
await browser.close(); prev.stop();
