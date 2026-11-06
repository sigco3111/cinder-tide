// Builds the game's sound set from real recordings, locally with ffmpeg only. MISSING_ASSETS.md says where each comes from.
// Sources, each a folder you point it at:
//   SONNISS_DIR  the Sonniss GDC Game Audio Bundles, laid out <year>/<library>/<file> (games-only licence: the sounds may
//                ship inside a game, never as loose files, and never go to any AI service)
//   CC0_DIR      the CC0 recordings (Freesound, Kenney), by the file names below
//   MUSIC_DIR    the CC0 music bed, "An Untold Legend" by SkyleTheFrench (OpenGameArt), as an_untold_legend_v2.mp3
// Any sound whose recording isn't there is skipped, and the files already in public/sfx stay as they are.
// Loops are made seamless: the cut runs one crossfade longer and its tail is crossfaded into its head.
// Each sound: cut (or each separate hit found in a multi-hit take), filtered, mono for one-shots, faded, loudness-normalised
// two-pass (EBU R128, -1 dBTP ceiling), encoded to .ogg (Vorbis) and .m4a (AAC). public/sfx/manifest.json already lists
// every sound; the measured loudness of each file built goes to shots/audio/loudness.json.
//   SONNISS_DIR=... [CC0_DIR=...] [MUSIC_DIR=...] node scripts/sounds.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const SON = process.env.SONNISS_DIR ?? 'sonniss', CC0 = process.env.CC0_DIR ?? 'cc0', MUSIC = process.env.MUSIC_DIR ?? 'music';
const OUT = 'public/sfx', TMP = 'shots/audio/tmp';
mkdirSync(OUT, { recursive: true }); mkdirSync(TMP, { recursive: true });
const s = p => join(SON, p), c = p => join(CC0, p);
// id: [{ src, start?, dur?, hits?: n (split a multi-hit take into separate hits), af?: extra filters, lufs, loop?, stereo? }]
const SPEC = {
	// explosions, layered in game as crack/body + sub + distant tail + debris
	blast: [{ src: s('2017/Gamemaster Audio -  Explosion Sound Pack/explosion_large_08.wav'), dur: 3.2, lufs: -13 }, { src: s('2020/Stefano Cremona - Explosions/BigExplosion02.wav'), dur: 3.4, lufs: -13 }, { src: s('2020/Bluezone - Tank - Explosion Sound Effects/Bluezone_BC0271_explosion_outdoors_large_005.wav'), dur: 3.4, lufs: -13 }],
	blast_small: [{ src: s('2017/Gamemaster Audio -  Explosion Sound Pack/explosion_large_no_tail_03.wav'), dur: 1.6, lufs: -14 }, { src: s('2018/Olivier Girardot - Guns & Explosions/Explosion 8.wav'), dur: 1.8, lufs: -14 }, { src: s('2017/Gamemaster Audio -  Explosion Sound Pack/explosion_med_long_tail_01.wav'), dur: 2.2, lufs: -14 }],
	blast_sub: [{ src: s('2020/Stefano Cremona - Explosions/DeepExplosion02.wav'), dur: 2.5, af: 'lowpass=f=140', lufs: -16 }],
	blast_tail: [{ src: s('2018/Lukas Tvrdon - Distant Blast/Distant Blast 05.wav'), dur: 3.5, lufs: -20 }, { src: s('2018/Lukas Tvrdon - Distant Blast/Distant Blast 17.wav'), dur: 3.5, lufs: -20 }],
	debris: [{ src: s('2020/Bluezone - Tank - Explosion Sound Effects/Bluezone_BC0271_debris_falling_rock_dust_002.wav'), dur: 3.0, lufs: -18 }, { src: s('2020/Tatak Audio - Rocks and Debris/Tatak_ROCKS_Falling Heavy Dusty Debris.wav'), dur: 3.0, lufs: -18 }, { src: s('2016/Alexander Kopeikin - Rocks/rocks stream down heavy 02.wav'), dur: 3.0, lufs: -18 }],
	crumble: [{ src: s('2017/Mechanical Wave - Rock,Brick and Dirt - Part 02/Crumbling Rock Slide_RBDII 07.wav'), dur: 2.6, lufs: -17 }, { src: s('2018/Soundrangers - Foley Elements Rocks, Dirt And Stone/rockslide_02.wav'), dur: 2.6, lufs: -17 }, { src: s('2018/Soundrangers - Foley Elements Rocks, Dirt And Stone/dirt_collapse_05.wav'), dur: 2.2, lufs: -17 }],
	rock_hit: [{ src: s('2020/PMSFX - Rocky Impacts/PM_RI_Source_53 Rocks Impact Hit Single Stone.wav'), dur: 1.0, lufs: -16 }, { src: s('2020/PMSFX - Rocky Impacts/PM_RI_Source_92 Rocks Impact Hit Single Stone.wav'), dur: 1.0, lufs: -16 }, { src: s('2020/Tatak Audio - Rocks and Debris/Tatak_ROCKS_Single Rock Impact on Stones.wav'), dur: 1.0, lufs: -16 }, { src: s('2016/Alexander Kopeikin - Rocks/rock impact medium 26.wav'), dur: 1.2, lufs: -16 }],
	rock_heavy: [{ src: s('2020/PMSFX - Rocky Impacts/PM_RI_Designed_19 Rocks Impact Hit Big LFE Heavy Designed.wav'), dur: 2.4, lufs: -13 }, { src: s('2020/PMSFX - Shattering Bricks/PM_SB_DESIGNED_IMPACT_116 Impact brick rock dirt gravel designed multi LFE.wav'), dur: 2.4, lufs: -13 }, { src: s('2018/Soundrangers - Foley Elements Rocks, Dirt And Stone/boulder_impact_on_stones_14.wav'), dur: 2.0, lufs: -13 }],
	brick: [{ src: s('2018/Soundrangers - Foley Elements Rocks, Dirt And Stone/brick_impact_debris_02.wav'), dur: 1.6, lufs: -16 }, { src: s('2020/PMSFX - Shattering Bricks/PM_SB_SOURCE_16 Impact brick rock dirt gravel single hit.wav'), dur: 1.4, lufs: -16 }],
	glass: [{ src: s('2017/Chris Skyes - Shards Broken Glass/Glass,Shards,Smash,Medium Impact,Lots of Large Shards.wav'), dur: 1.8, lufs: -17 }, { src: s('2017/Chris Skyes - Shards Broken Glass/Window,Small,Break,Medium Impact,Large Amount of Clinking Pieces.wav'), dur: 2.0, lufs: -17 }, { src: s('2019/Airborne Sound - Elements Glass/Glass,Pint Glass,Break,Debris,Rock,Medium Distant.wav'), dur: 1.6, lufs: -17 }],
	ice: [{ src: s('2017/Chris Skyes - Shards Broken Glass/Window,Small,Crack,Medium Impact,Bright.wav'), dur: 0.9, af: 'highpass=f=900', lufs: -19 }, { src: s('2018/Gamemaster Audio - Guns, Bullets and Explosions/bullet_impact_ice_06.wav'), dur: 0.9, lufs: -19 }],
	frost_loop: [{ src: s('2016/Qbsound Studio - Bar Effects/Ice filling glass 01 NT1-A.wav'), dur: 4.0, af: 'highpass=f=1500', lufs: -24, loop: true }],
	wood: [{ src: s('2017/Double Trouble Audio - Tools and Wood/Small Wood Pile, Smash.wav'), dur: 1.6, lufs: -17 }, { src: s('2019/BlueZone - Wood Sound Effects/Bluezone_BC0254_wood_crushing_branches_001_001.wav'), dur: 1.6, lufs: -17 }],
	metal: [{ src: s('2019/BlueZone - Heavy Metal Impact Sound Effects/Bluezone_BC0251_heavy_metal_impact_steel_barrel_01.wav'), dur: 1.6, lufs: -16 }, { src: s('2019/BlueZone - Heavy Metal Impact Sound Effects/Bluezone_BC0251_heavy_metal_impact_metal_plate_medium.wav'), dur: 1.6, lufs: -16 }],
	splash: [{ src: s('2016/Mattia Cellotto - Rocks Momentum/Glacial Lake - Large Size Rock Splashes - 5 Meters. Water,Splash,Large,Rock,Impact,Various_06.wav'), hits: 4, dur: 2.2, lufs: -16 }],
	whoosh: [{ src: s('2017/Bluezone Corporation - War Zone (Designed Explosions)/Bluezone-BC0214-explosion-whooshe-003.wav'), dur: 1.4, lufs: -18 }, { src: s('2018/Bluezone Corporation - Metal Debris/Bluezone_BC0236_metal_whoosh_021.wav'), dur: 1.0, lufs: -18 }, { src: s('2018/Bluezone Corporation - Metal Debris/Bluezone_BC0236_metal_whoosh_037.wav'), dur: 1.0, lufs: -18 }],
	whoosh_fast: [{ src: s('2018/Gamemaster Audio - Guns, Bullets and Explosions/bullet_flyby_fast_06.wav'), dur: 0.8, lufs: -19 }, { src: s('2020/Bluezone - Tank - Explosion Sound Effects/Bluezone_BC0271_shell_trajectory_004.wav'), dur: 1.2, lufs: -19 }],
	tear: [{ src: s('2018/Gregor Quendel - Designed Rocks/Designed Rocks - ELEM027 - Texture - Granular 3.wav'), dur: 1.4, lufs: -16 }, { src: s('2018/Gregor Quendel - Designed Rocks/Designed Rocks - RAW08.wav'), dur: 1.2, lufs: -16 }],
	grip_loop: [{ src: s('2018/Gregor Quendel - Designed Rocks/Designed Rocks - EVO19 - Texture - Filtered 4.wav'), start: 3, dur: 6, lufs: -24, loop: true, stereo: true }],
	charge_loop: [{ src: s('2018/Olivier Girardot - Guns & Explosions/Earthquake 3 - Big.wav'), start: 6, dur: 6, af: 'lowpass=f=900', lufs: -22, loop: true, stereo: true }],
	beam_loop: [{ src: s('2015/Soundopolis - Foley Plus_Full/Lighter_Blue Flame_E_Light_Fienup_001.wav'), start: 1.5, dur: 4.5, lufs: -20, loop: true, stereo: true }],
	steam_loop: [{ src: s('2020/Pole Position - Car Destruction/Car_Destruction_Damaged_Engine_t22_Ext_Heavy_Damage_No_Oil_Water_Hiss_XY_RSM191.wav'), start: 4, dur: 8, af: 'highpass=f=700', lufs: -22, loop: true, stereo: true }],
	lava_loop: [{ src: s('2018/Discover Oregon - Lava from the Kilauea Volcano in Hawaii/Lava Lava Short Windy Crackles.WAV'), start: 1, dur: 18, af: 'highpass=f=70', lufs: -23, loop: true, stereo: true }],
	lava_rumble_loop: [{ src: s('2018/Olivier Girardot - Guns & Explosions/Volcano Eruption 1.wav'), start: 4, dur: 10, af: 'lowpass=f=900', lufs: -25, loop: true, stereo: true }],
	// the sea: open water offshore, surf on the beach, and single waves breaking
	sea_loop: [{ src: s('2018/Discover Oregon - Ocean and Stream/Ocean Waves 2017 Kauai Night Waves.WAV'), start: 140, dur: 30, af: 'lowpass=f=7000,highpass=f=40', lufs: -24, loop: true, stereo: true }],
	surf_loop: [{ src: s('2018/Discover Oregon - Ocean and Stream/Coast 2014 Coast Mono 1.wav'), start: 1, dur: 42, af: 'highpass=f=50', lufs: -22, loop: true, stereo: true }],
	wave: [20.4, 121.4, 176.4, 224.8].map(t => ({ src: s('2018/Discover Oregon - Ocean and Stream/Ocean Waves 2017 Kauai Night Waves.WAV'), start: t, dur: 7, af: 'lowpass=f=9000', lufs: -21, stereo: true })),
	// rain the clouds really drop: light and heavy beds crossfaded by the drops in view, thunder from dense clouds
	rain_light_loop: [{ src: s('2017/Double Trouble Audio - Rain and Thunder/RATH - Rain and Distant Thunder Loop 01.wav'), start: 0, dur: 8.2, af: 'highpass=f=200', lufs: -26, loop: true, stereo: true }],
	rain_heavy_loop: [{ src: s('2017/Double Trouble Audio - Rain and Thunder/RATH - Rain Hard Loop 08.wav'), start: 0, dur: 18.5, af: 'highpass=f=90', lufs: -23, loop: true, stereo: true }],
	thunder: [{ src: s('2017/Double Trouble Audio - Rain and Thunder/RATH - Rain and Distant Thunder Loop 01.wav'), start: 8.6, dur: 8.5, af: 'lowpass=f=6000', lufs: -16, stereo: true }, { src: s('2017/Double Trouble Audio - Rain and Thunder/RATH - Rain and Distant Thunder Loop 01.wav'), start: 21.6, dur: 6.5, af: 'lowpass=f=6000', lufs: -17, stereo: true }, { src: s('2017/Double Trouble Audio - Rain and Thunder/RATH - Rain, Distant Thunder and Bird Loop.wav'), start: 24.6, dur: 13, af: 'lowpass=f=5000', lufs: -15, stereo: true }],
	// boiling: a roiling bubble bed, a steady sizzle (envelope flattened) and sizzle hits when lava meets water
	boil_loop: [{ src: s('2018/Discover Oregon - Ocean and Stream/Streams 2014 McKenzie 1.wav'), start: 5, dur: 24, af: 'lowpass=f=2600,highpass=f=60', lufs: -24, loop: true, stereo: true }],
	sizzle_loop: [{ src: s('2017/RedSonic - Frying Water/water_in_frying_pan_05.wav'), start: 0.3, dur: 5.5, af: 'dynaudnorm=f=120:g=11:p=0.9,highpass=f=300', lufs: -25, loop: true, stereo: true }],
	sizzle: [{ src: s('2017/RedSonic - Frying Water/water_in_frying_pan_05.wav'), start: 0, dur: 1.8, lufs: -19 }, { src: s('2017/RedSonic - Frying Water/water_dropped_on_electric_stove_02.wav'), start: 0, dur: 2.2, lufs: -19 }],
	// combat: blows, armour, tells, roars, ice breaking
	punch: [{ src: s('2020/PMSFX - Lethal Blow/PM_LB_DESIGNED_PUNCH_SIMPLE_CLEAN_DEEP_48.wav'), dur: 0.9, lufs: -17 }, { src: s('2020/Shapeforms - Hit & Punch/PUNCH_PERCUSSIVE_HEAVY_06.wav'), dur: 0.9, lufs: -17 }, { src: s('2017/Gamemaster Audio -  Punch Sound Pack/punch_general_body_impact_03.wav'), dur: 0.8, lufs: -17 }],
	thud: [{ src: s('2020/Shapeforms - Hit & Punch/IMPACT_LOW_THUD_10.wav'), dur: 1.2, lufs: -16 }],
	clank: [{ src: s('2016/3maze - High Impact/med_dark_001.wav'), dur: 1.0, lufs: -18 }, { src: s('2016/3maze - High Impact/short_med_003.wav'), dur: 0.8, lufs: -18 }],
	rumble: [{ src: s('2020/Bluezone - Forest Creature Sound Effects/Bluezone_BC0269_creature_wood_texture_crack_heavy_rumble_006.wav'), dur: 3.6, lufs: -17, stereo: true }],
	stomp: [{ src: s('2017/Eiravaein Sound - Gravitas/Gravitas,bridge,stomp,large,arched,wood,metal,heavyiron,deepstream,greenway,strong,resonant,loose,XY.wav'), dur: 2.5, af: 'lowpass=f=3000', lufs: -16 }],
	ice_break: [{ src: s('2018/FLYSOUND - Ice Fury/IC0151 BIG CHISEL HIT DEBRIS 06.wav'), dur: 1.25, lufs: -16 }, { src: s('2018/FLYSOUND - Ice Fury/IC0318 KETTLEBELL SMASH DEBRIS 02.wav'), dur: 2.6, lufs: -15 }],
	ice_tell: [{ src: s('2018/FLYSOUND - Ice Fury/IC0120 CHISEL SCRAPE DEBRIS 09.wav'), dur: 1.3, af: 'highpass=f=700', lufs: -20 }],
	melt: [{ src: s('2016/3maze -  ICE BLOCK/burn_ice_001.wav'), start: 0.2, dur: 2.0, lufs: -21 }],
	hiss: [{ src: s('2018/Gregor Quendel - Designed Rocks/Designed Rocks - ELEM027 - Texture - Granular 3.wav'), dur: 1.2, af: 'highpass=f=1500', lufs: -20 }],
	grabmob: [{ src: s('2020/PMSFX - Lethal Blow/PM_LB_DESIGNED_GRAB_BLOCK_THROW_7.wav'), dur: 1.0, lufs: -18 }],
	fireball: [{ src: s('2018/Gregor Quendel - Designed Fire/Designed Fire - Swooshes - Burst, evolving 34.wav'), start: 1.5, dur: 1.9, lufs: -16 }, { src: s('2018/Gregor Quendel - Designed Fire/Designed Fire - Swooshes - Burst, evolving 34.wav'), start: 4.6, dur: 2.2, lufs: -16 }],
	wind_loop: [{ src: c('fs150174_windtrees.ogg'), start: 2, dur: 12, lufs: -24, loop: true, stereo: true }],
	gale_loop: [{ src: c('fs557188_tornado_julienmatthey.ogg'), start: 2, dur: 8, af: 'lowpass=f=2500', lufs: -22, loop: true, stereo: true }],
	quake: [{ src: s('2018/Olivier Girardot - Guns & Explosions/Earthquake 3 - Big.wav'), start: 0.4, dur: 2.6, lufs: -15 }],
	step_hard: [0, 1, 2, 3, 4].map(n => ({ src: c(`kenney_footstep_concrete_00${n}.ogg`), dur: 0.4, lufs: -24 })),
	step_soft: [0, 1, 2, 3, 4].map(n => ({ src: c(`kenney_footstep_grass_00${n}.ogg`), dur: 0.4, lufs: -24 })),
	land: [{ src: s('2017/Mechanical Wave - Rock,Brick and Dirt - Part 02/Hit Rock into Gravel_RBDII 06.wav'), dur: 0.9, lufs: -19 }, { src: s('2018/Antisample - Rocks and Stones/Rock_Impact_Snowy_Ground_Roll_Foliage_Debris_MONO_72.wav'), dur: 0.9, lufs: -19 }],
	hurt: [0, 1, 2].map(n => ({ src: c(`kenney_impactPunch_heavy_00${n}.ogg`), dur: 0.5, lufs: -18 })),
	enemy_die: [{ src: s('2020/PMSFX - Shattering Bricks/PM_SB_DESIGNED_IMPACT_48 Impact brick rock dirt gravel designed multi LFE.wav'), dur: 1.8, lufs: -15 }, { src: s('2020/Wav Junction Sound Effects - Rocks/0228_Single_Small_Rocks_Tumble_Cliff_004.wav'), dur: 1.4, lufs: -16 }],
	ui: [{ src: c('kenney_click_001.ogg'), dur: 0.3, lufs: -24 }],
	objective: [{ src: c('kenney_confirmation_004.ogg'), dur: 1.2, lufs: -20 }],
};
const run = (args) => { const r = spawnSync('ffmpeg', args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr.slice(-600)); return r.stderr; };
function hitsOf(src, n, maxDur) {
	const log = run(['-hide_banner', '-i', src, '-af', 'silencedetect=noise=-38dB:d=0.18', '-f', 'null', '-']);
	const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]);
	const starts = [0, ...ends].slice(0, n * 2);
	return starts.slice(0, n).map(t => ({ start: Math.max(0, t - 0.02), dur: maxDur }));
}
function measure(file) {
	const log = run(['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
	const I = +(log.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)[0] ?? 0);
	const tp = +(log.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop()?.match(/-?[\d.]+/)[0] ?? 0);
	return { I, tp };
}
const table = [], skipped = [];
for (const [id, list] of Object.entries(SPEC)) {
	const missing = list.filter(it => !existsSync(it.src));
	if (missing.length) { skipped.push(`${id} (${missing[0].src})`); continue; }
	let n = 0;
	for (const it of list) {
		const cuts = it.hits ? hitsOf(it.src, it.hits, it.dur) : [{ start: it.start ?? 0, dur: it.dur }];
		for (const cut of cuts) {
			const base = `${id}_${n++}`, wav = join(TMP, base + '.wav');
			const fadeOut = Math.min(0.08, cut.dur * 0.15), XF = Math.min(1.5, cut.dur * 0.2);
			const pre = ['-hide_banner', '-y', '-ss', String(cut.start), '-i', it.src];
			if (it.loop) { // seamless: [XF, dur+XF] with its last XF crossfaded into [0, XF]
				const fmt = it.stereo ? 'aformat=channel_layouts=stereo' : 'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1';
				const base0 = [fmt, 'aresample=44100', it.af].filter(Boolean).join(',');
				run(['-hide_banner', '-y', '-ss', String(cut.start + XF), '-t', String(cut.dur), '-i', it.src, '-ss', String(cut.start), '-t', String(XF + 0.2), '-i', it.src, '-filter_complex', `[0]${base0},asetpts=PTS-STARTPTS[b];[1]${base0},asetpts=PTS-STARTPTS[a];[b][a]acrossfade=d=${XF}:c1=qsin:c2=qsin,atrim=0:${cut.dur}`, '-ar', '44100', wav]);
			} else {
				const chain = [`atrim=0:${cut.dur}`, it.stereo ? 'aformat=channel_layouts=stereo' : 'pan=mono|c0=0.5*c0+0.5*c1', 'aresample=44100', it.af, 'afade=t=in:d=0.002', `afade=t=out:st=${Math.max(0, cut.dur - fadeOut)}:d=${fadeOut}`].filter(Boolean).join(',');
				run([...pre, '-af', chain.replace('pan=mono|c0=0.5*c0+0.5*c1', 'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1'), '-ar', '44100', wav]);
			}
			// two-pass loudness normalisation with a true-peak ceiling
			const l1 = run(['-hide_banner', '-i', wav, '-af', `loudnorm=I=${it.lufs}:TP=-1.5:LRA=18:print_format=json`, '-f', 'null', '-']);
			const j = JSON.parse(l1.slice(l1.lastIndexOf('{'), l1.lastIndexOf('}') + 1));
			const norm = join(TMP, base + '.n.wav');
			if (!isFinite(+j.input_i) || +j.input_i < -60) { // too short for gated loudness (< 0.4 s): normalise the peak instead
				const vd = run(['-hide_banner', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-']); const mx = +(vd.match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? 0);
				run(['-hide_banner', '-y', '-i', wav, '-af', `volume=${(it.lufs + 12 - mx).toFixed(2)}dB,alimiter=limit=0.76:level=disabled`, '-ar', '44100', norm]);
			} else
			run(['-hide_banner', '-y', '-i', wav, '-af', `loudnorm=I=${it.lufs}:TP=-1.5:LRA=18:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true${it.loop ? '' : ',alimiter=limit=0.76:attack=1:release=40:level=disabled'},aresample=44100`, '-ar', '44100', norm]);
			run(['-hide_banner', '-y', '-i', norm, '-c:a', 'libvorbis', '-q:a', it.loop ? '3' : '5', join(OUT, base + '.ogg')]); // long beds: lighter
			run(['-hide_banner', '-y', '-i', norm, '-c:a', 'aac', '-b:a', it.loop ? '96k' : '128k', join(OUT, base + '.m4a')]);
			const m = measure(join(OUT, base + '.ogg'));
			table.push({ file: base + '.ogg', target: it.lufs, lufsI: m.I, truePeakDb: m.tp, loop: !!it.loop, source: it.src.replace(join(SON, '/'), 'Sonniss/').replace(join(CC0, '/'), 'CC0/') });
		}
	}
}
// music bed: "An Untold Legend" (SkyleTheFrench, CC0). Plays from the top once, then loops 57.50 s -> 106.75 s (the
// second statement of the theme, chosen by chroma similarity 0.83 and a level match within 0.1 dB). The file ends at the
// loop end with its last 2 s crossfaded into the 2 s before the loop start, so the jump back is seamless.
if (!existsSync(join(MUSIC, 'an_untold_legend_v2.mp3'))) skipped.push(`music (${join(MUSIC, 'an_untold_legend_v2.mp3')})`);
else {
	const src = join(MUSIC, 'an_untold_legend_v2.mp3'), LS = 57.5, LE = 106.75, XF = 2, wav = join(TMP, 'music.wav'), norm = join(TMP, 'music.n.wav');
	run(['-hide_banner', '-y', '-i', src, '-filter_complex', `[0]aresample=44100,asplit=3[h][t][u];[h]atrim=0:${LE - XF},asetpts=PTS-STARTPTS[head];[t]atrim=${LE - XF}:${LE},asetpts=PTS-STARTPTS,afade=t=out:d=${XF}:curve=qsin[ta];[u]atrim=${LS - XF}:${LS},asetpts=PTS-STARTPTS,afade=t=in:d=${XF}:curve=qsin[tb];[ta][tb]amix=inputs=2:normalize=0[mix];[head][mix]concat=n=2:v=0:a=1,acompressor=threshold=-26dB:ratio=2:attack=120:release=900:makeup=2`, '-ar', '44100', wav]);
	const l1 = run(['-hide_banner', '-i', wav, '-af', 'loudnorm=I=-18:TP=-2:LRA=11:print_format=json', '-f', 'null', '-']);
	const j = JSON.parse(l1.slice(l1.lastIndexOf('{'), l1.lastIndexOf('}') + 1));
	run(['-hide_banner', '-y', '-i', wav, '-af', `loudnorm=I=-18:TP=-2:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`, '-ar', '44100', norm]);
	run(['-hide_banner', '-y', '-i', norm, '-c:a', 'libvorbis', '-q:a', '4', join(OUT, 'music_0.ogg')]);
	run(['-hide_banner', '-y', '-i', norm, '-c:a', 'aac', '-b:a', '128k', join(OUT, 'music_0.m4a')]);
	const m = measure(join(OUT, 'music_0.ogg'));
	table.push({ file: 'music_0.ogg', target: -18, lufsI: m.I, truePeakDb: m.tp, loop: true, source: 'music/an_untold_legend_v2.mp3 (CC0, SkyleTheFrench)' });
}
mkdirSync('shots/audio', { recursive: true });
writeFileSync('shots/audio/loudness.json', JSON.stringify(table, null, 1));
rmSync(TMP, { recursive: true, force: true });
console.log(`${table.length} files built, ${skipped.length} skipped`); for (const k of skipped) console.log(`skipped ${k}`); for (const t of table) console.log(`${t.file.padEnd(18)} I ${String(t.lufsI).padStart(6)} LUFS  TP ${String(t.truePeakDb).padStart(6)} dB  (target ${t.target})`);
