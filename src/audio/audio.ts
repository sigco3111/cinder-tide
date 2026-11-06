// Sound from real recordings (Sonniss GDC bundle libraries, games-only licence, and CC0 recordings), built by
// scripts/sounds.mjs into public/sfx. Events are layered (transient/body, sub, distant tail, debris sized by what broke),
// every play gets +-7% pitch, a stereo position and a voice cap per sound, and loops are seamless recordings whose
// level, pitch and stereo position follow the world (the sea and surf by the shoreline, rain by the drops the clouds
// really drop, lava, boiling and steam by what the simulation is doing). Music: "An Untold Legend" (SkyleTheFrench,
// CC0), from the top once, then looping its second half. Bus: voices -> sfx bus -> compressor -> limiter -> out; the
// ambience and the music sit on a ducking bus that dips under big events.

type Loop = { src: AudioBufferSourceNode; g: GainNode; f: BiquadFilterNode; p: StereoPannerNode; base: number };
export class Sound {
	ctx: AudioContext | null = null; out!: GainNode; sfx!: GainNode; amb!: GainNode; duck!: GainNode; mus!: GainNode; musicLevel = 0.11; musicOn = true; ambLevel = 0.48;
	buffers: Record<string, AudioBuffer[]> = {}; loops: Record<string, Loop> = {}; started = false; volume = 0.8; muted = false;
	lastPlay: Record<string, number> = {}; active: Record<string, number[]> = {}; musicLoop: number[] = [57.5, 106.75];
	ready = false; loadErrors = 0;
	start() {
		if (this.started) return;
		this.started = true;
		try {
			const ctx = new AudioContext(); this.ctx = ctx;
			const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.005; comp.release.value = 0.2; comp.knee.value = 6;
			const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -3; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06; lim.knee.value = 0;
			this.out = ctx.createGain(); this.out.gain.value = this.volume;
			comp.connect(lim); lim.connect(this.out); this.out.connect(ctx.destination);
			this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(comp);
			this.duck = ctx.createGain(); this.duck.connect(comp);
			this.amb = ctx.createGain(); this.amb.gain.value = this.ambLevel; // Chrome's bus compressor adds makeup gain: beds sit low this.amb.connect(this.duck);
			this.mus = ctx.createGain(); this.mus.gain.value = 0; this.mus.connect(this.duck);
			void this.load();
		} catch { this.ctx = null; }
	}
	async load() {
		const ctx = this.ctx!; let manifest: Record<string, string[]> = {};
		try { manifest = await (await fetch('sfx/manifest.json')).json(); } catch { this.loadErrors++; return; }
		const ml = (manifest as unknown as Record<string, unknown>).musicLoop; if (Array.isArray(ml)) this.musicLoop = ml as number[];
		delete (manifest as Record<string, unknown>).musicLoop;
		const one = async (base: string) => {
			for (const ext of ['ogg', 'm4a']) { try { const r = await fetch(`sfx/${base}.${ext}`); if (!r.ok) continue; return await ctx.decodeAudioData(await r.arrayBuffer()); } catch { /* try the next format */ } }
			this.loadErrors++; return null;
		};
		await Promise.all(Object.entries(manifest).map(async ([id, list]) => { this.buffers[id] = (await Promise.all(list.map(one))).filter(Boolean) as AudioBuffer[]; }));
		for (const id of ['beam_loop', 'steam_loop', 'lava_loop', 'lava_rumble_loop', 'wind_loop', 'gale_loop', 'frost_loop', 'grip_loop', 'charge_loop', 'sea_loop', 'surf_loop', 'rain_light_loop', 'rain_heavy_loop', 'boil_loop', 'sizzle_loop']) this.mkLoop(id);
		const mb = this.buffers.music?.[0];
		if (mb) { // from the top once, then the loop section forever
			const src = ctx.createBufferSource(); src.buffer = mb; src.loop = true; src.loopStart = this.musicLoop[0]; src.loopEnd = Math.min(mb.duration, this.musicLoop[1]);
			src.connect(this.mus); src.start(ctx.currentTime + 0.3);
		}
		this.ready = true;
	}
	mkLoop(id: string) {
		const ctx = this.ctx!, buf = this.buffers[id]?.[0]; if (!buf) return;
		const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
		const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 18000;
		const g = ctx.createGain(); g.gain.value = 0; const p = ctx.createStereoPanner();
		const bed = ['wind_loop', 'lava_loop', 'lava_rumble_loop', 'sea_loop', 'surf_loop', 'rain_light_loop', 'rain_heavy_loop'].includes(id);
		src.connect(f); f.connect(g); g.connect(p); p.connect(bed ? this.amb : this.sfx); src.start(0, Math.random() * buf.duration);
		this.loops[id.replace('_loop', '')] = { src, g, f, p, base: 1 };
	}
	setVolume(v: number) { this.volume = v; if (this.out) this.out.gain.value = this.muted ? 0 : v; }
	// level 0..1, a pitch factor and a stereo position for a loop ('beam', 'steam', 'lava', 'lava_rumble', 'wind', 'gale',
	// 'frost', 'grip', 'charge', 'sea', 'surf', 'rain_light', 'rain_heavy', 'boil', 'sizzle'); `tc` is the smoothing time
	loop(name: string, v: number, p = 1, pan = 0, tc = 0.06, lowpass = 18000) {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		const L = this.loops[name]; if (!L) return;
		L.g.gain.setTargetAtTime(v * 1.6, t, tc); L.src.playbackRate.setTargetAtTime(Math.max(0.5, Math.min(2, p)), t, 0.08);
		L.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.25); L.f.frequency.setTargetAtTime(lowpass, t, 0.2);
	}
	setMusic(on: boolean) { this.musicOn = on; }
	duckMusic(amount: number) { if (!this.ctx) return; const t = this.ctx.currentTime; this.duck.gain.cancelScheduledValues(t); this.duck.gain.setTargetAtTime(1 - amount, t, 0.02); this.duck.gain.setTargetAtTime(1, t + 0.3, 0.7); }
	// one recording: random variant, +-7% pitch (times rate), pan, optional delay and darkening for distance
	one(id: string, o: { pan?: number; vol?: number; rate?: number; at?: number; dark?: number; cap?: number } = {}) {
		const ctx = this.ctx, list = this.buffers[id]; if (!ctx || !list?.length) return;
		const now = ctx.currentTime, act = (this.active[id] ||= []).filter(t => t > now); this.active[id] = act;
		if (act.length >= (o.cap ?? 4)) return;
		const buf = list[(Math.random() * list.length) | 0];
		const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = (o.rate ?? 1) * (0.93 + Math.random() * 0.14);
		const g = ctx.createGain(); g.gain.value = o.vol ?? 1;
		const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
		let node: AudioNode = src;
		if (o.dark) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 18000 * (1 - o.dark) + 600 * o.dark; src.connect(f); node = f; }
		node.connect(g); g.connect(p); p.connect(this.sfx);
		const at = now + (o.at ?? 0); src.start(at); act.push(at + buf.duration / src.playbackRate.value);
	}
	ok(name: string, gap: number) { const t = performance.now(); if ((this.lastPlay[name] ?? 0) + gap > t) return false; this.lastPlay[name] = t; return true; }
	play(name: string, o: { pan?: number; size?: number; vol?: number } = {}) {
		if (!this.ctx || this.muted || !this.ready) return;
		const pan = Math.max(-1, Math.min(1, o.pan ?? 0)), s = o.size ?? 1, v = o.vol ?? 1;
		const far = Math.min(1, Math.abs(pan) * 0.6), dark = far * 0.5;
		switch (name) {
			case 'blast': if (!this.ok(name, 45)) return;
				this.one(s > 0.55 ? 'blast' : 'blast_small', { pan, vol: v * (0.6 + 0.4 * Math.min(1, s)), dark, cap: 3 }); // crack and body
				this.one('blast_sub', { pan: pan * 0.3, vol: v * Math.min(1, 0.4 + s * 0.6), cap: 2 }); // sub
				this.one('blast_tail', { pan, vol: v * 0.45, at: 0.06 + far * 0.08, dark: 0.3 + dark, cap: 2 }); // reflections and tail
				this.one('debris', { pan, vol: v * Math.min(1, 0.25 + s * 0.5), at: 0.22, cap: 3 }); // debris sized by the blast
				this.duckMusic(0.65); break;
			case 'impact': if (!this.ok(name, 45)) return;
				this.one(s > 0.45 ? 'rock_heavy' : 'rock_hit', { pan, vol: v * (0.5 + 0.5 * Math.min(1, s)), dark, cap: 4 });
				if (s > 0.25) this.one('debris', { pan, vol: v * Math.min(0.8, s), at: 0.1, cap: 3 });
				break;
			case 'shatter': if (!this.ok(name, 60)) return; this.one('glass', { pan, vol: v, dark }); break;
			case 'crumble': if (!this.ok(name, 110)) return; this.one('crumble', { pan, vol: v * 0.8, dark }); break;
			case 'splash': if (!this.ok(name, 90)) return; this.one('splash', { pan, vol: v * (0.5 + 0.5 * Math.min(1, s)), rate: 1.15 - Math.min(0.3, s * 0.3) }); break;
			case 'step': if (!this.ok(name, 55)) return; this.one(s < 0.5 ? 'step_soft' : 'step_hard', { pan, vol: v * 0.55, cap: 2 }); break;
			case 'land': this.one('land', { pan, vol: v * Math.min(1, 0.35 + s * 0.6), rate: 1.1 - Math.min(0.25, s * 0.2) }); if (s > 0.7) this.one('rock_hit', { pan, vol: 0.4 }); break;
			case 'jump': this.one('whoosh_fast', { pan, vol: v * 0.22, rate: 1.4 }); break;
			case 'fly': this.one('whoosh', { pan, vol: v * 0.5, rate: 0.85 }); break;
			case 'dash': this.one('whoosh_fast', { pan, vol: v * 0.7, rate: 1.1 }); this.one('whoosh', { pan, vol: v * 0.4, rate: 1.3 }); break;
			case 'slam': this.play('blast', { pan, size: 1.3 }); this.one('quake', { pan: 0, vol: 0.8 }); this.one('rock_heavy', { pan, vol: 0.9 }); break;
			case 'release': this.one('blast_small', { pan, vol: 0.7 }); this.one('fireball', { pan, vol: 0.75 }); this.one('whoosh', { pan, vol: 0.35, rate: 1.4 }); break;
			case 'grab': this.one('tear', { pan, vol: v * (0.6 + 0.4 * Math.min(1, s)) }); this.one('crumble', { pan, vol: 0.5, at: 0.05 }); break;
			case 'throw': this.one('whoosh', { pan, vol: v * (0.5 + 0.5 * Math.min(1, s)), rate: 0.9 }); break;
			case 'freeze': if (!this.ok(name, 120)) return; this.one('ice', { pan, vol: v * 0.45, cap: 2 }); break;
			case 'enemyHit': if (!this.ok(name, 60)) return; this.one('rock_hit', { pan, vol: v * 0.55, rate: 1.35 }); break;
			case 'enemyDie': this.one('enemy_die', { pan, vol: v * 0.9 }); break;
			case 'hurt': this.one('hurt', { pan, vol: v * 0.7 }); break;
			case 'wood': if (!this.ok(name, 90)) return; this.one('wood', { pan, vol: v * 0.7, dark }); break;
			case 'metal': if (!this.ok(name, 90)) return; this.one('metal', { pan, vol: v * 0.7, dark }); break;
			case 'ui': this.one('ui', { vol: 0.6 }); break;
			case 'objective': this.one('objective', { vol: 0.7 }); break;
			case 'wave': this.one('wave', { pan, vol: v, dark, cap: 3 }); break;
			case 'thunder': // far thunder is darker and arrives later; close thunder ducks the bed
				this.one('thunder', { pan, vol: v, dark: Math.min(0.8, 1 - s), at: (1 - s) * 0.8, cap: 2 }); if (s > 0.6) this.duckMusic(0.4); break;
			case 'sizzle': if (!this.ok(name, 140)) return; this.one('sizzle', { pan, vol: v * 0.8, cap: 3 }); break;
			case 'fireball': this.one('fireball', { pan, vol: v * 0.8, cap: 2 }); break;
			case 'punch': if (!this.ok(name, 50)) return; this.one('punch', { pan, vol: v * (0.5 + 0.5 * Math.min(1, s)), cap: 3 }); if (s > 0.6) this.one('thud', { pan, vol: 0.6 * s }); break;
			case 'clank': if (!this.ok(name, 70)) return; this.one('clank', { pan, vol: v * 0.7, dark, cap: 2 }); this.one('rock_hit', { pan, vol: 0.4 }); break;
			case 'rock': this.one('rock_heavy', { pan, vol: v * 0.9, dark }); this.one('debris', { pan, vol: 0.5, at: 0.1 }); break;
			case 'roar': this.one('rumble', { pan: pan * 0.5, vol: v * 0.9, rate: 0.75, cap: 2 }); this.one('quake', { pan: 0, vol: 0.5 * v }); this.duckMusic(0.5); break;
			case 'tell': if (!this.ok(name, 90)) return; if (s > 0.7) { this.one('rumble', { pan, vol: 0.55, rate: 1.1, cap: 2 }); this.one('stomp', { pan, vol: 0.4, at: 0.05 }); } else this.one('ice_tell', { pan, vol: 0.55, rate: 0.9 + Math.random() * 0.3, cap: 2 }); break;
			case 'combo': this.one('objective', { vol: 0.55 }); this.one('whoosh_fast', { vol: 0.35, rate: 1.3 }); break;
			case 'glasshit': if (!this.ok(name, 60)) return; this.one('glass', { pan, vol: v * 0.6, rate: 1.2 }); break;
			case 'iceBreak': this.one('ice_break', { pan, vol: v, dark, cap: 3 }); break;
			case 'melt': if (!this.ok(name, 200)) return; this.one('melt', { pan, vol: v * 0.6, cap: 2 }); break;
			case 'hiss': if (!this.ok(name, 120)) return; this.one('hiss', { pan, vol: v * 0.6 }); break;
			case 'grabmob': this.one('grabmob', { pan, vol: v * 0.8 }); break;
			case 'stomp': if (!this.ok(name, 120)) return; this.one('stomp', { pan, vol: v * (0.4 + 0.6 * Math.min(1, s)), dark, cap: 2 }); break;
		}
	}
	// the wind bed over the island and the music (the game drives the rest of the ambience)
	tickMusic(_dt: number, intensity: number) {
		this.loop('wind', 0.2, 1);
		if (!this.ctx || !this.mus) return;
		this.mus.gain.setTargetAtTime(this.musicOn ? this.musicLevel * (1 - 0.25 * Math.min(1, intensity)) : 0, this.ctx.currentTime, 0.8);
	}
}
