// Keyboard + mouse + standard gamepad, merged into one intent per frame. Tests write `virtual` instead.
export interface Intent {
	x: number; y: number; jump: boolean; jumpPressed: boolean; drop: boolean;
	lance: boolean; charge: boolean; grip: boolean; gripPressed: boolean; rime: boolean; meteorPressed: boolean; dashPressed: boolean;
	aimX: number; aimY: number; aimIsScreen: boolean; // screen pixels (mouse) or a direction (stick)
	help: boolean; pausePressed: boolean; anyPressed: boolean;
	aimWX?: number; aimWY?: number; // tests aim in world cells
	wheel?: number;
}
const blank = (): Intent => ({ x: 0, y: 0, jump: false, jumpPressed: false, drop: false, lance: false, charge: false, grip: false, gripPressed: false, rime: false, meteorPressed: false, dashPressed: false, aimX: 0, aimY: 0, aimIsScreen: true, help: false, pausePressed: false, anyPressed: false });

export class Input {
	keys = new Set<string>(); pressed = new Set<string>(); mouse = { x: 0, y: 0, l: false, r: false, moved: 0 }; mousePressed = { l: false, r: false };
	virtual: Partial<Intent> | null = null; prevPad: boolean[] = []; usingPad = false; lastVirtual: Partial<Intent> = {};
	el: HTMLCanvasElement; css = { x: -1, y: -1 }; wheel = 0; onPointer: ((x: number, y: number) => void) | null = null;
	constructor(el: HTMLCanvasElement) {
		this.el = el;
		addEventListener('keydown', e => { if (e.repeat) return; this.keys.add(e.code); this.pressed.add(e.code); this.usingPad = false; if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault(); });
		addEventListener('keyup', e => this.keys.delete(e.code));
		addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
		// the pointer in CSS pixels relative to the canvas; converted to canvas pixels with the canvas's own size at read time
		const move = (e: PointerEvent) => { const r = el.getBoundingClientRect(); this.css = { x: e.clientX - r.left, y: e.clientY - r.top }; this.mouse.moved = performance.now(); this.usingPad = false; this.onPointer?.(this.css.x, this.css.y); };
		el.addEventListener('pointermove', move); el.addEventListener('pointerdown', move);
		el.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
		el.addEventListener('pointerdown', e => { if (e.button === 0) { this.mouse.l = true; this.mousePressed.l = true; } if (e.button === 2) { this.mouse.r = true; this.mousePressed.r = true; } this.usingPad = false; });
		addEventListener('pointerup', e => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
		el.addEventListener('contextmenu', e => e.preventDefault());
	}
	read(): Intent {
		const k = (c: string) => this.keys.has(c), p = (c: string) => this.pressed.has(c);
		const it = blank();
		it.x = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
		it.y = (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0);
		it.jump = k('Space'); it.jumpPressed = p('Space');
		it.drop = p('KeyC') || p('ControlLeft');
		it.lance = this.mouse.l; it.charge = this.mouse.r;
		it.grip = k('KeyE'); it.gripPressed = p('KeyE');
		it.rime = k('KeyF'); it.meteorPressed = p('KeyQ'); it.dashPressed = p('ShiftLeft') || p('ShiftRight');
		const rect = this.el.getBoundingClientRect();
		it.aimX = this.css.x * this.el.width / Math.max(1, rect.width); it.aimY = this.css.y * this.el.height / Math.max(1, rect.height); it.aimIsScreen = true;
		it.wheel = this.wheel; this.wheel = 0;
		it.help = p('KeyH') || p('Tab'); it.pausePressed = p('Escape') || p('KeyP');
		it.anyPressed = this.pressed.size > 0 || this.mousePressed.l || this.mousePressed.r;
		// gamepad (standard mapping)
		const pads = navigator.getGamepads ? navigator.getGamepads() : [];
		for (const g of pads) {
			if (!g) continue;
			const b = (i: number) => !!g.buttons[i]?.pressed, bp = (i: number) => b(i) && !this.prevPad[i];
			const dz = (v: number) => Math.abs(v) < 0.2 ? 0 : v;
			const rdz = (x: number, y: number) => Math.hypot(x, y) < 0.2 ? [0, 0] : [x, y]; // radial deadzone keeps the stick's exact angle
			const [lx, ly] = rdz(g.axes[0] ?? 0, g.axes[1] ?? 0), [rx, ry] = rdz(g.axes[2] ?? 0, g.axes[3] ?? 0); void dz;
			const any = lx || ly || rx || ry || g.buttons.some(x => x.pressed);
			if (any) this.usingPad = true;
			if (!this.usingPad) { this.prevPad = g.buttons.map(x => x.pressed); continue; }
			it.x = lx || it.x; it.y = ly || it.y;
			if (b(14)) it.x = -1; if (b(15)) it.x = 1; if (b(12)) it.y = -1; if (b(13)) it.y = 1;
			it.jump = it.jump || b(0); it.jumpPressed = it.jumpPressed || bp(0);
			it.drop = it.drop || bp(3);
			it.lance = it.lance || (g.buttons[7]?.value ?? 0) > 0.3; it.charge = it.charge || (g.buttons[6]?.value ?? 0) > 0.3;
			it.grip = it.grip || b(5); it.gripPressed = it.gripPressed || bp(5);
			it.rime = it.rime || b(4); it.meteorPressed = it.meteorPressed || bp(2); it.dashPressed = it.dashPressed || bp(1);
			it.help = it.help || bp(8); it.pausePressed = it.pausePressed || bp(9);
			if (bp(12) && b(5)) it.wheel = (it.wheel || 0) - 1; if (bp(13) && b(5)) it.wheel = (it.wheel || 0) + 1;
			it.anyPressed = it.anyPressed || g.buttons.some((x, i) => x.pressed && !this.prevPad[i]);
			if (rx || ry) { it.aimX = rx; it.aimY = ry; it.aimIsScreen = false; }
			else if (lx || ly) { it.aimX = lx; it.aimY = ly; it.aimIsScreen = false; }
			else { it.aimX = 0; it.aimY = 0; it.aimIsScreen = false; }
			this.prevPad = g.buttons.map(x => x.pressed);
		}
		if (this.virtual) {
			const v = this.virtual;
			Object.assign(it, { x: 0, y: 0, jump: false, jumpPressed: false, drop: false, lance: false, charge: false, grip: false, gripPressed: false, rime: false, meteorPressed: false, dashPressed: false }, v);
			// "pressed" flags in the virtual input are one-shot
			v.jumpPressed = false; v.gripPressed = false; v.meteorPressed = false; v.dashPressed = false; v.drop = false; v.pausePressed = false;
		}
		this.pressed.clear(); this.mousePressed.l = this.mousePressed.r = false;
		return it;
	}
}
