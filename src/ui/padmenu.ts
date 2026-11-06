// A pad drives the menus: the D-pad or the left stick moves between buttons (left and right move a slider), A presses
// the lit one (Start too, on the title), B goes back. Keyboard and mouse work as before; the ring shows only while a pad
// is in use, and it's a class, not focus, so Space in play can never press a hidden button.
import type { Input } from '../game/input';
import type { UI } from './ui';

export class PadMenu {
	private prev: boolean[] = []; private layer: HTMLElement | null = null; private at: HTMLElement | null = null;
	private dir = ''; private repeatAt = 0;
	constructor(private input: Input, private ui: UI) {}
	/** The menu on top, or null in play. */
	open(): HTMLElement | null {
		for (const id of ['report', 'help', 'pause']) { const el = document.getElementById(id)!; if (el.classList.contains('open')) return el; }
		const t = document.getElementById('title')!;
		return t.classList.contains('gone') ? null : t;
	}
	private items(layer: HTMLElement) {
		const list = [...layer.querySelectorAll<HTMLElement>('button, input[type=range]')];
		// while paused, the tutorial's Skip is in reach too (it has no key)
		const skip = document.getElementById('skip-tut');
		if (layer.id === 'pause' && skip && document.getElementById('tut')?.classList.contains('on')) list.push(skip);
		return list.filter(el => !el.hidden && el.offsetParent !== null);
	}
	private light(el: HTMLElement | null) { this.at?.classList.remove('padfocus'); this.at = el; el?.classList.add('padfocus'); }
	/** Once a frame, before the game reads its input. */
	update(now: number) {
		const g = this.input.pad(), layer = this.open(), prev = this.prev;
		const b = (i: number) => !!g?.buttons[i]?.pressed, bp = (i: number) => b(i) && !prev[i];
		this.prev = g ? g.buttons.map(x => x.pressed) : [];
		if (layer && g?.buttons.some(x => x.pressed)) this.input.usingPad = true; // so the first press counts, not only lights the ring
		if (layer !== this.layer) { this.layer = layer; this.light(null); }
		if (!layer || !g || !this.input.usingPad) { this.light(null); return; }
		const items = this.items(layer);
		if (!items.length) return;
		if (!this.at || !items.includes(this.at)) this.light(items.find(el => el.classList.contains('primary')) ?? items[0]);
		const at = this.at!;
		// direction: D-pad, or the left stick pushed past half; the first step at once, then repeats while held
		const lx = g.axes[0] ?? 0, ly = g.axes[1] ?? 0;
		const dir = b(12) || ly < -0.5 ? 'up' : b(13) || ly > 0.5 ? 'down' : b(14) || lx < -0.5 ? 'left' : b(15) || lx > 0.5 ? 'right' : '';
		let step = '';
		if (dir !== this.dir) { this.dir = dir; step = dir; this.repeatAt = now + 350; }
		else if (dir && now >= this.repeatAt) { step = dir; this.repeatAt = now + 120; }
		if (step) {
			const range = at instanceof HTMLInputElement && at.type === 'range' ? at : null;
			if (range && (step === 'left' || step === 'right')) {
				const s = +range.step || 0.05;
				range.value = String(Math.min(+range.max, Math.max(+range.min, +range.value + (step === 'right' ? s : -s))));
				range.dispatchEvent(new Event('input', { bubbles: true }));
			} else {
				const i = items.indexOf(at), n = items.length;
				this.light(items[(i + (step === 'up' || step === 'left' ? n - 1 : 1)) % n]);
			}
		}
		if (bp(0) || (layer.id === 'title' && bp(9))) {
			if (!(at instanceof HTMLInputElement)) { at.click(); this.input.swallow(); }
		} else if (bp(1)) {
			if (layer.id === 'help') this.ui.toggleHelp(false);
			else if (layer.id === 'pause') this.ui.pause(false);
			this.input.swallow();
		}
	}
}
