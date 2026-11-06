// Title, controls card, tutorial prompt and pause menu in the normal (rAF) game, headless and muted.
import { mkdirSync } from 'node:fs';
import { launch, startPreview, watch } from './lib.mjs';
mkdirSync('shots/ui', { recursive: true });
const prev = await startPreview('dist'); const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }); const w = watch(page, prev.url);
await page.goto(prev.url + '?seed=7'); await page.waitForFunction(() => window.__game); await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/ui/title.png' });
await page.click('#title-controls'); await page.waitForTimeout(300); await page.screenshot({ path: 'shots/ui/controls.png' });
await page.click('#help-close'); await page.click('#play-story'); await page.waitForTimeout(1500); await page.screenshot({ path: 'shots/ui/tutorial.png' });
await page.keyboard.press('Escape'); await page.waitForTimeout(300); await page.screenshot({ path: 'shots/ui/pause.png' });
console.log(JSON.stringify({ errors: w.errors, offHost: w.offHost, state: (await page.evaluate(() => __game.state())).tutorial }));
await browser.close(); prev.stop();
