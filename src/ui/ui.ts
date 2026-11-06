// DOM overlays: title, HUD (powers, objective, meters), tutorial prompts, controls card, pause menu, report card, toasts.
const $ = (id: string) => document.getElementById(id)!;

export const POWERS = [
	{ id: 'lance', name: 'Magma Lance', key: 'Hold left mouse', pad: '{RT}', hint: 'Boils water, melts rock and metal' },
	{ id: 'blast', name: 'Lava Blast', key: 'Hold right mouse, release', pad: '{LT}', hint: 'A charged blast at the cursor' },
	{ id: 'grip', name: 'Grip', key: 'Hold E on rock, flick, let go', pad: '{RB} (d-pad + {RB}: size)', hint: 'Tears out what is in the circle at the cursor; scroll sizes it' },
	{ id: 'rime', name: 'Rime Burst', key: 'Hold F', pad: '{LB}', hint: 'Freezes water, lava, steam and enemies' },
	{ id: 'meteor', name: 'Meteor Drop', key: 'Q in the air', pad: '{X}', hint: 'Dive and slam a shockwave' },
	{ id: 'dash', name: 'Phase Dash', key: 'Shift', pad: '{B}', hint: 'Carves a tunnel through anything softer than metal' },
];

export class UI {
	onPlay: (mode: 'story' | 'sandbox' | 'arena' | 'titan' | 'leviathan') => void = () => {};
	onSkip: () => void = () => {};
	onRestart: () => void = () => {};
	onKeep: () => void = () => {};
	onSpawn: () => void = () => {};
	onVolume: (v: number) => void = () => {};
	onMusic: (v: number) => void = () => {};
	paused = false; helpOpen = false;
	constructor() {
		$('play-story').addEventListener('click', () => this.onPlay('story'));
		$('play-sandbox').addEventListener('click', () => this.onPlay('sandbox'));
		$('play-arena').addEventListener('click', () => this.onPlay('arena'));
		$('play-titan').addEventListener('click', () => this.onPlay('titan'));
		$('play-leviathan').addEventListener('click', () => this.onPlay('leviathan'));
		$('title-controls').addEventListener('click', () => this.toggleHelp(true));
		$('help-close').addEventListener('click', () => this.toggleHelp(false));
		$('skip-tut').addEventListener('click', () => this.onSkip());
		$('pause-resume').addEventListener('click', () => this.pause(false));
		$('pause-controls').addEventListener('click', () => this.toggleHelp(true));
		$('pause-restart').addEventListener('click', () => { this.pause(false); this.onRestart(); });
		$('pause-spawn').addEventListener('click', () => { this.pause(false); this.onSpawn(); });
		$('report-keep').addEventListener('click', () => { $('report').classList.remove('open'); this.onKeep(); });
		$('report-again').addEventListener('click', () => { $('report').classList.remove('open'); this.onRestart(); });
		($('volume') as HTMLInputElement).addEventListener('input', e => this.onVolume(+(e.target as HTMLInputElement).value));
		($('music') as HTMLInputElement).addEventListener('input', e => this.onMusic(+(e.target as HTMLInputElement).value));
		const list = $('powers');
		list.innerHTML = POWERS.map((p, i) => `<div class="pw" id="pw-${p.id}"><div class="pw-i">${i + 1}</div><div><b>${p.name}</b><span>${p.key}</span></div></div>`).join('');
		this.words(false, s => s.replace(/\{(\w+)\}/g, '$1'));
	}
	/** Keyboard or pad words on the HUD's powers and hint line; the controls card's pad column in the pad's own names. */
	words(pad: boolean, label: (s: string) => string) {
		for (const p of POWERS) { const s = document.querySelector(`#pw-${p.id} span`); if (s) s.textContent = pad ? label(p.pad) : p.key; }
		$('hint').textContent = pad ? label('{Back} controls · {Start} menu') : 'H controls · Esc menu';
		$('help-table').innerHTML = [
			['Move', 'A / D', 'Left stick'], ['Jump', 'Space', '{A}'], ['Fly', 'Space again in the air, then W A S D', '{A} in the air, left stick'], ['Stop flying', 'C', '{Y}'],
			...POWERS.map(p => [p.name, p.key, p.pad]), ['Aim', 'Mouse', 'Right stick'], ['This card', 'H', '{Back}'], ['Pause', 'Esc', '{Start}'],
		].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${label(r[2])}</td></tr>`).join('');
	}
	hideTitle(instant = false) { if (instant) ($('title') as HTMLElement).style.transition = 'none'; $('title').classList.add('gone'); $('hud').classList.add('on'); }
	showTitle() { $('title').classList.remove('gone'); $('hud').classList.remove('on'); }
	toggleHelp(v?: boolean) { this.helpOpen = v ?? !this.helpOpen; $('help').classList.toggle('open', this.helpOpen); }
	pause(v: boolean) { this.paused = v; $('pause').classList.toggle('open', v); }
	prompt(title: string | null, body = '', step = '') {
		const el = $('tut'); if (!title) { el.classList.remove('on'); return; }
		el.classList.add('on'); $('tut-title').textContent = title; $('tut-body').textContent = body; $('tut-step').textContent = step;
	}
	objective(text: string, sub = '') { $('obj-text').textContent = text; $('obj-sub').textContent = sub; }
	meters(town: number, sea: number, health: number) {
		($('m-town') as HTMLElement).style.width = `${Math.round(town * 100)}%`; $('m-town-v').textContent = `${Math.round(town * 100)}%`;
		($('m-sea') as HTMLElement).style.width = `${Math.round(Math.min(1, sea) * 100)}%`; $('m-sea-v').textContent = `${Math.round(sea * 100)}%`;
		($('m-hp') as HTMLElement).style.width = `${Math.max(0, Math.round(health))}%`;
	}
	activePower(id: string | null) { for (const p of POWERS) $('pw-' + p.id).classList.toggle('on', p.id === id); }
	lastRank = '';
	styleHud(on: boolean, rank: string, prog: number, combo: number, move: string) {
		$('style').classList.toggle('on', on); if (!on) return;
		const r = $('style-rank'); if (rank !== this.lastRank) { r.textContent = rank; r.className = 'r' + rank; void r.offsetWidth; r.classList.add('bump'); setTimeout(() => r.classList.remove('bump'), 150); this.lastRank = rank; }
		($('style-bar') as HTMLElement).style.width = `${Math.round(prog * 100)}%`;
		$('style-combo').textContent = combo > 1 ? `${combo} hits` : ''; $('style-move').textContent = move;
	}
	bannerT = 0;
	banner(name: string, sub: string) { $('banner-name').textContent = name; $('banner-sub').textContent = sub; $('banner').classList.add('show'); clearTimeout(this.bannerT); this.bannerT = setTimeout(() => $('banner').classList.remove('show'), 2200) as unknown as number; }
	bossBar(on: boolean, name = '', fill = 0, hint = '') { $('bossbar').classList.toggle('on', on); if (!on) return; $('boss-name').textContent = name; ($('boss-fill') as HTMLElement).style.width = `${Math.round(fill * 100)}%`; $('boss-hint').textContent = hint; }
	// which meters matter: the town in Play and Sandbox, the sea there and in the Leviathan's bay (it drinks it to heal)
	meterSet(town: boolean, sea: boolean) { ($('meter-town') as HTMLElement).style.display = town ? '' : 'none'; ($('meter-sea') as HTMLElement).style.display = sea ? '' : 'none'; }
	clearPrompts() { $('toast').classList.remove('show'); $('banner').classList.remove('show'); clearTimeout(this.bannerT); }
	toast(text: string) { const t = $('toast'); t.textContent = text; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }
	report(rows: [string, string][], title: string) {
		$('report-title').textContent = title;
		$('report-rows').innerHTML = rows.map(r => `<div class="rr"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
		$('report').classList.add('open');
	}
	// the crosshair follows the pointer directly from the pointer event (no frame of lag)
	cursorAt(x: number, y: number, show = true) { const el = $('cursor') as HTMLElement; el.style.display = show ? 'block' : 'none'; el.style.transform = `translate(${x}px, ${y}px)`; }
	gripRing(rCss: number, holding: boolean) { const el = $('gripring') as HTMLElement; if (rCss <= 0) { el.style.display = 'none'; return; } el.style.display = 'block'; el.style.width = el.style.height = `${rCss * 2}px`; el.style.marginLeft = el.style.marginTop = `${-rCss}px`; el.classList.toggle('holding', holding); }
	reticle(x: number, y: number, r: number, show: boolean, kind: string) {
		const el = $('reticle') as HTMLElement; el.style.display = show ? 'block' : 'none'; if (!show) return;
		el.style.left = `${x / devicePixelRatio}px`; el.style.top = `${y / devicePixelRatio}px`; el.style.width = el.style.height = `${(r * 2) / devicePixelRatio}px`; el.className = 'reticle ' + kind;
	}
}
