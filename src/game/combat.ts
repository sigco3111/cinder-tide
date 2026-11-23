// Style: a combo counter and a style rank that rewards variety. Every hit scores by what did it; the same move again
// within the last few scores less each time, a combo scores a lot, and getting hurt knocks the meter down. The rank
// (D, C, B, A, S) comes from the meter, which drains over time. Combos are named the first time they happen.
export const COMBOS: Record<string, string> = {
	'스트라이크': '적을 그립으로 잡아 다른 적에게 던지기',
	'셰터폴': '적을 얼린 뒤 메테오 드롭으로 내려찍기',
	'스팀 밤': '얼린 적을 랜스로 공격: 얼음이 순식간에 증기로',
	'샌드스톰': '페이즈 대시로 샌드 스웜 관통하기',
	'스콜드': '물에 라바 블래스트: 화상 증기 폭발',
	'저글': '폭발로 적을 띄우고 랜스로 계속 띄워두기',
	'아이스브레이커': '얼어붙은 마그마 크롤러 산산조각 내기',
	'디스암': '그립으로 록 브루트의 장갑판 뜯어내기',
	'스로백': '적의 장갑으로 그 적을 때리기',
};
export const MOVE_KO: Record<string, string> = { heat: '히트', blast: '블래스트', slam: '슬램', dash: '대시', thrown: '투척', chunk: '파편', steam: '스팀', grip: '그립', freeze: '빙결', crush: '분쇄', fall: '낙하', kill: '처치' };
const RANKS = [{ r: 'D', at: 0 }, { r: 'C', at: 120 }, { r: 'B', at: 300 }, { r: 'A', at: 600 }, { r: 'S', at: 1000 }];
const BASE: Record<string, number> = { heat: 2, blast: 40, slam: 45, dash: 30, thrown: 45, chunk: 40, steam: 30, grip: 30, freeze: 35, crush: 30, fall: 10, kill: 50 };

export class Style {
	meter = 0; best = 0; bestRank = 'D'; combo = 0; comboT = 0; maxCombo = 0; recent: string[] = []; seen = new Set<string>(); found: string[] = []; points = 0;
	last = ''; lastT = 0; heatAcc = 0;
	rank() { let r = 'D'; for (const k of RANKS) if (this.meter >= k.at) r = k.r; return r; }
	next() { const i = RANKS.findIndex(k => k.r === this.rank()); return i < RANKS.length - 1 ? RANKS[i + 1].at : 1400; }
	progress() { const i = RANKS.findIndex(k => k.r === this.rank()); const a = RANKS[i].at, b = this.next(); return Math.max(0, Math.min(1, (this.meter - a) / (b - a))); }
	// a scoring move: variety multiplier from the last eight moves
	move(kind: string, mult = 1) {
		if (kind === 'heat') { this.heatAcc += mult; if (this.heatAcc < 20) return 0; this.heatAcc = 0; }
		const reps = this.recent.filter(k => k === kind).length;
		const v = 1 / (1 + reps * 0.6);
		const pts = (BASE[kind] ?? 20) * mult * v * (1 + Math.min(1.5, this.combo * 0.05));
		this.recent.push(kind); if (this.recent.length > 8) this.recent.shift();
		this.meter = Math.min(1600, this.meter + pts); this.points += pts;
		this.combo++; this.comboT = 2.5; this.maxCombo = Math.max(this.maxCombo, this.combo);
		this.last = kind; this.lastT = 1.2;
		return pts;
	}
	// a named combo: big points, and its name the first time
	comboNamed(name: string) {
		const first = !this.seen.has(name); this.seen.add(name); if (first) this.found.push(name);
		const reps = this.recent.filter(k => k === name).length;
		const pts = 160 / (1 + reps * 0.8);
		this.recent.push(name); if (this.recent.length > 8) this.recent.shift();
		this.meter = Math.min(1600, this.meter + pts); this.points += pts * 2; this.combo += 2; this.comboT = 3; this.maxCombo = Math.max(this.maxCombo, this.combo);
		this.last = name; this.lastT = 1.6;
		return first;
	}
	hurt(dmg: number) { this.meter *= Math.max(0.4, 1 - dmg * 0.02); this.combo = 0; this.comboT = 0; }
	tick(dt: number) {
		this.meter = Math.max(0, this.meter - dt * (10 + this.meter * 0.06));
		if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
		if (this.lastT > 0) this.lastT -= dt;
		const r = this.rank(); if ('DCBAS'.indexOf(r) > 'DCBAS'.indexOf(this.bestRank)) this.bestRank = r;
		this.best = Math.max(this.best, this.meter);
	}
}
