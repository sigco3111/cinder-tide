// DOM overlays: title, HUD (powers, objective, meters), tutorial prompts, controls card, pause menu, report card, toasts.
const $ = (id: string) => document.getElementById(id)!;

export const POWERS = [
	{ id: 'lance', name: '마그마 랜스', key: '왼쪽 마우스 유지', pad: '{RT}', hint: '물을 끓이고 바위와 금속을 녹입니다' },
	{ id: 'blast', name: '라바 블래스트', key: '오른쪽 마우스 유지 후 놓기', pad: '{LT}', hint: '커서를 향해 충전 폭발을 발사합니다' },
	{ id: 'grip', name: '그립', key: '바위에 E 유지, 튕기듯 놓기', pad: '{RB} (십자키 + {RB}: 크기)', hint: '커서 위치 원 안의 것을 뜯어냅니다. 스크롤로 크기 조절' },
	{ id: 'rime', name: '라임 버스트', key: 'F 유지', pad: '{LB}', hint: '물, 용암, 증기, 적을 얼립니다' },
	{ id: 'meteor', name: '메테오 드롭', key: '공중에서 Q', pad: '{X}', hint: '급강하해 충격파를 내리꽂습니다' },
	{ id: 'dash', name: '페이즈 대시', key: 'Shift', pad: '{B}', hint: '금속보다 부드러운 모든 것을 뚫고 지나갑니다' },
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
		$('hint').textContent = pad ? label('{Back} 조작법 · {Start} 메뉴') : 'H 조작법 · Esc 메뉴';
		$('help-table').innerHTML = [
			['이동', 'A / D', '왼쪽 스틱'], ['점프', 'Space', '{A}'], ['비행', '공중에서 Space 한 번 더, 이후 W A S D', '공중에서 {A}, 왼쪽 스틱'], ['비행 해제', 'C', '{Y}'],
			...POWERS.map(p => [p.name, p.key, p.pad]), ['조준', '마우스', '오른쪽 스틱'], ['이 카드', 'H', '{Back}'], ['일시정지', 'Esc', '{Start}'],
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
		$('style-combo').textContent = combo > 1 ? `${combo}연타` : ''; $('style-move').textContent = move;
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
