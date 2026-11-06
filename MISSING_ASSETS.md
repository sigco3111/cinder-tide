# Missing assets

The released game has 105 sounds. 18 are in this repo (CC0). The other 87 aren't, because they come from the **Sonniss GDC Game Audio Bundles**, whose licence lets anyone use the sounds in a game but not pass them on as sound files. This file lists each one so you can get it and put it back.

## What happens without them

The game builds and plays. Those 87 sounds are silent: explosions, crumbling rock, glass, ice, splashes, the sea and surf, rain and thunder, the Magma Lance's flame, steam, lava, punches, the bosses' roars and stomps. The browser logs a 404 for each missing file as the game loads. Music, footsteps, wind, the hurt and UI sounds still play. `scripts/ambience.mjs` and `scripts/mix.mjs` measure the sound, so they need the sounds back.

## Where to get them

- **Source:** the Sonniss GDC Game Audio Bundles, free from Sonniss, one bundle per year: https://sonniss.com/gameaudiogdc/ (this game uses the 2015 to 2020 bundles). Each bundle is a set of libraries, one folder per library, named `<Publisher> - <Library>`.
- **Licence:** https://sonniss.com/gdc-bundle-license/. Royalty-free, for commercial and non-commercial projects, no credit required (this game credits the libraries in `public/CREDITS.md` anyway). You may use the sounds inside your game; you may not share, sell or give away the sound files themselves, on their own or in a collection. So keep them out of git, out of Patch's asset library and away from AI services, and a released game that ships them keeps a proprietary art licence.

## How to put them back

1. Download the bundles for the years listed below and unzip them into one folder, laid out `<year>/<library folder>/<file>`, for example `sonniss/2017/Gamemaster Audio -  Explosion Sound Pack/explosion_large_08.wav`. The exact folder and file names are in `scripts/sounds.mjs` (a few library folders have a double space, as in the bundle).
2. Install [ffmpeg](https://ffmpeg.org), with libvorbis and AAC.
3. Run `SONNISS_DIR=<that folder> node scripts/sounds.mjs`. It cuts, filters and loudness-normalises each recording, writes `public/sfx/<id>_<n>.ogg` and `.m4a`, and skips any recording it can't find, saying which. The 18 CC0 files already here are left alone unless you also point `CC0_DIR` and `MUSIC_DIR` at their recordings.
4. `npm run build`. `public/sfx/` ships as it is, and `public/sfx/manifest.json` already lists every sound.

The rebuilt files won't be byte-identical to the released game's (encoders differ), but they're the same cuts at the same loudness.

## The files

Each row is one sound, shipped as two files. The bundle year says which Sonniss bundle the library is in; the time is the part of the recording `scripts/sounds.mjs` uses.

| Files | What it is | Recording (bundle year, library, file) |
| --- | --- | --- |
| `public/sfx/blast_0.ogg`, `.m4a` | Big explosion, the crack and body | 2017 bundle, Gamemaster Audio: Explosion Sound Pack, `explosion_large_08.wav` (first 3.2 s) |
| `public/sfx/blast_1.ogg`, `.m4a` | Big explosion, the crack and body | 2020 bundle, Stefano Cremona: Explosions, `BigExplosion02.wav` (first 3.4 s) |
| `public/sfx/blast_2.ogg`, `.m4a` | Big explosion, the crack and body | 2020 bundle, Bluezone: Tank - Explosion Sound Effects, `Bluezone_BC0271_explosion_outdoors_large_005.wav` (first 3.4 s) |
| `public/sfx/blast_small_0.ogg`, `.m4a` | Smaller explosion | 2017 bundle, Gamemaster Audio: Explosion Sound Pack, `explosion_large_no_tail_03.wav` (first 1.6 s) |
| `public/sfx/blast_small_1.ogg`, `.m4a` | Smaller explosion | 2018 bundle, Olivier Girardot: Guns & Explosions, `Explosion 8.wav` (first 1.8 s) |
| `public/sfx/blast_small_2.ogg`, `.m4a` | Smaller explosion | 2017 bundle, Gamemaster Audio: Explosion Sound Pack, `explosion_med_long_tail_01.wav` (first 2.2 s) |
| `public/sfx/blast_sub_0.ogg`, `.m4a` | Explosion sub-bass layer | 2020 bundle, Stefano Cremona: Explosions, `DeepExplosion02.wav` (first 2.5 s) |
| `public/sfx/blast_tail_0.ogg`, `.m4a` | Distant explosion tail | 2018 bundle, Lukas Tvrdon: Distant Blast, `Distant Blast 05.wav` (first 3.5 s) |
| `public/sfx/blast_tail_1.ogg`, `.m4a` | Distant explosion tail | 2018 bundle, Lukas Tvrdon: Distant Blast, `Distant Blast 17.wav` (first 3.5 s) |
| `public/sfx/debris_0.ogg`, `.m4a` | Falling rock and dust after a blast | 2020 bundle, Bluezone: Tank - Explosion Sound Effects, `Bluezone_BC0271_debris_falling_rock_dust_002.wav` (first 3 s) |
| `public/sfx/debris_1.ogg`, `.m4a` | Falling rock and dust after a blast | 2020 bundle, Tatak Audio: Rocks and Debris, `Tatak_ROCKS_Falling Heavy Dusty Debris.wav` (first 3 s) |
| `public/sfx/debris_2.ogg`, `.m4a` | Falling rock and dust after a blast | 2016 bundle, Alexander Kopeikin: Rocks, `rocks stream down heavy 02.wav` (first 3 s) |
| `public/sfx/crumble_0.ogg`, `.m4a` | Rock crumbling, a slide | 2017 bundle, Mechanical Wave: Rock,Brick and Dirt - Part 02, `Crumbling Rock Slide_RBDII 07.wav` (first 2.6 s) |
| `public/sfx/crumble_1.ogg`, `.m4a` | Rock crumbling, a slide | 2018 bundle, Soundrangers: Foley Elements Rocks, Dirt And Stone, `rockslide_02.wav` (first 2.6 s) |
| `public/sfx/crumble_2.ogg`, `.m4a` | Rock crumbling, a slide | 2018 bundle, Soundrangers: Foley Elements Rocks, Dirt And Stone, `dirt_collapse_05.wav` (first 2.2 s) |
| `public/sfx/rock_hit_0.ogg`, `.m4a` | A single stone hitting rock | 2020 bundle, PMSFX: Rocky Impacts, `PM_RI_Source_53 Rocks Impact Hit Single Stone.wav` (first 1 s) |
| `public/sfx/rock_hit_1.ogg`, `.m4a` | A single stone hitting rock | 2020 bundle, PMSFX: Rocky Impacts, `PM_RI_Source_92 Rocks Impact Hit Single Stone.wav` (first 1 s) |
| `public/sfx/rock_hit_2.ogg`, `.m4a` | A single stone hitting rock | 2020 bundle, Tatak Audio: Rocks and Debris, `Tatak_ROCKS_Single Rock Impact on Stones.wav` (first 1 s) |
| `public/sfx/rock_hit_3.ogg`, `.m4a` | A single stone hitting rock | 2016 bundle, Alexander Kopeikin: Rocks, `rock impact medium 26.wav` (first 1.2 s) |
| `public/sfx/rock_heavy_0.ogg`, `.m4a` | A heavy rock impact | 2020 bundle, PMSFX: Rocky Impacts, `PM_RI_Designed_19 Rocks Impact Hit Big LFE Heavy Designed.wav` (first 2.4 s) |
| `public/sfx/rock_heavy_1.ogg`, `.m4a` | A heavy rock impact | 2020 bundle, PMSFX: Shattering Bricks, `PM_SB_DESIGNED_IMPACT_116 Impact brick rock dirt gravel designed multi LFE.wav` (first 2.4 s) |
| `public/sfx/rock_heavy_2.ogg`, `.m4a` | A heavy rock impact | 2018 bundle, Soundrangers: Foley Elements Rocks, Dirt And Stone, `boulder_impact_on_stones_14.wav` (first 2 s) |
| `public/sfx/brick_0.ogg`, `.m4a` | Brick breaking | 2018 bundle, Soundrangers: Foley Elements Rocks, Dirt And Stone, `brick_impact_debris_02.wav` (first 1.6 s) |
| `public/sfx/brick_1.ogg`, `.m4a` | Brick breaking | 2020 bundle, PMSFX: Shattering Bricks, `PM_SB_SOURCE_16 Impact brick rock dirt gravel single hit.wav` (first 1.4 s) |
| `public/sfx/glass_0.ogg`, `.m4a` | Glass shattering | 2017 bundle, Chris Skyes: Shards Broken Glass, `Glass,Shards,Smash,Medium Impact,Lots of Large Shards.wav` (first 1.8 s) |
| `public/sfx/glass_1.ogg`, `.m4a` | Glass shattering | 2017 bundle, Chris Skyes: Shards Broken Glass, `Window,Small,Break,Medium Impact,Large Amount of Clinking Pieces.wav` (first 2 s) |
| `public/sfx/glass_2.ogg`, `.m4a` | Glass shattering | 2019 bundle, Airborne Sound: Elements Glass, `Glass,Pint Glass,Break,Debris,Rock,Medium Distant.wav` (first 1.6 s) |
| `public/sfx/ice_0.ogg`, `.m4a` | Ice cracking | 2017 bundle, Chris Skyes: Shards Broken Glass, `Window,Small,Crack,Medium Impact,Bright.wav` (first 0.9 s) |
| `public/sfx/ice_1.ogg`, `.m4a` | Ice cracking | 2018 bundle, Gamemaster Audio: Guns, Bullets and Explosions, `bullet_impact_ice_06.wav` (first 0.9 s) |
| `public/sfx/frost_loop_0.ogg`, `.m4a` | Rime Burst loop, ice crackle | 2016 bundle, Qbsound Studio: Bar Effects, `Ice filling glass 01 NT1-A.wav` (first 4 s) |
| `public/sfx/wood_0.ogg`, `.m4a` | Wood breaking | 2017 bundle, Double Trouble Audio: Tools and Wood, `Small Wood Pile, Smash.wav` (first 1.6 s) |
| `public/sfx/wood_1.ogg`, `.m4a` | Wood breaking | 2019 bundle, BlueZone: Wood Sound Effects, `Bluezone_BC0254_wood_crushing_branches_001_001.wav` (first 1.6 s) |
| `public/sfx/metal_0.ogg`, `.m4a` | Metal impact | 2019 bundle, BlueZone: Heavy Metal Impact Sound Effects, `Bluezone_BC0251_heavy_metal_impact_steel_barrel_01.wav` (first 1.6 s) |
| `public/sfx/metal_1.ogg`, `.m4a` | Metal impact | 2019 bundle, BlueZone: Heavy Metal Impact Sound Effects, `Bluezone_BC0251_heavy_metal_impact_metal_plate_medium.wav` (first 1.6 s) |
| `public/sfx/splash_0.ogg`, `.m4a` | A rock splashing into water | 2016 bundle, Mattia Cellotto: Rocks Momentum, `Glacial Lake - Large Size Rock Splashes - 5 Meters. Water,Splash,Large,Rock,Impact,Various_06.wav` (hit 1 of the take) |
| `public/sfx/splash_1.ogg`, `.m4a` | A rock splashing into water | 2016 bundle, Mattia Cellotto: Rocks Momentum, `Glacial Lake - Large Size Rock Splashes - 5 Meters. Water,Splash,Large,Rock,Impact,Various_06.wav` (hit 2 of the take) |
| `public/sfx/splash_2.ogg`, `.m4a` | A rock splashing into water | 2016 bundle, Mattia Cellotto: Rocks Momentum, `Glacial Lake - Large Size Rock Splashes - 5 Meters. Water,Splash,Large,Rock,Impact,Various_06.wav` (hit 3 of the take) |
| `public/sfx/splash_3.ogg`, `.m4a` | A rock splashing into water | 2016 bundle, Mattia Cellotto: Rocks Momentum, `Glacial Lake - Large Size Rock Splashes - 5 Meters. Water,Splash,Large,Rock,Impact,Various_06.wav` (hit 4 of the take) |
| `public/sfx/whoosh_0.ogg`, `.m4a` | Something big flying past | 2017 bundle, Bluezone Corporation: War Zone (Designed Explosions), `Bluezone-BC0214-explosion-whooshe-003.wav` (first 1.4 s) |
| `public/sfx/whoosh_1.ogg`, `.m4a` | Something big flying past | 2018 bundle, Bluezone Corporation: Metal Debris, `Bluezone_BC0236_metal_whoosh_021.wav` (first 1 s) |
| `public/sfx/whoosh_2.ogg`, `.m4a` | Something big flying past | 2018 bundle, Bluezone Corporation: Metal Debris, `Bluezone_BC0236_metal_whoosh_037.wav` (first 1 s) |
| `public/sfx/whoosh_fast_0.ogg`, `.m4a` | A fast fly-by | 2018 bundle, Gamemaster Audio: Guns, Bullets and Explosions, `bullet_flyby_fast_06.wav` (first 0.8 s) |
| `public/sfx/whoosh_fast_1.ogg`, `.m4a` | A fast fly-by | 2020 bundle, Bluezone: Tank - Explosion Sound Effects, `Bluezone_BC0271_shell_trajectory_004.wav` (first 1.2 s) |
| `public/sfx/tear_0.ogg`, `.m4a` | Grip tearing rock out | 2018 bundle, Gregor Quendel: Designed Rocks, `Designed Rocks - ELEM027 - Texture - Granular 3.wav` (first 1.4 s) |
| `public/sfx/tear_1.ogg`, `.m4a` | Grip tearing rock out | 2018 bundle, Gregor Quendel: Designed Rocks, `Designed Rocks - RAW08.wav` (first 1.2 s) |
| `public/sfx/grip_loop_0.ogg`, `.m4a` | Grip loop, held rock grinding | 2018 bundle, Gregor Quendel: Designed Rocks, `Designed Rocks - EVO19 - Texture - Filtered 4.wav` (3-9 s) |
| `public/sfx/charge_loop_0.ogg`, `.m4a` | Lava Blast charging, a low rumble loop | 2018 bundle, Olivier Girardot: Guns & Explosions, `Earthquake 3 - Big.wav` (6-12 s) |
| `public/sfx/beam_loop_0.ogg`, `.m4a` | Magma Lance loop, a torch flame | 2015 bundle, Soundopolis: Foley Plus_Full, `Lighter_Blue Flame_E_Light_Fienup_001.wav` (1.5-6 s) |
| `public/sfx/steam_loop_0.ogg`, `.m4a` | Steam hiss loop | 2020 bundle, Pole Position: Car Destruction, `Car_Destruction_Damaged_Engine_t22_Ext_Heavy_Damage_No_Oil_Water_Hiss_XY_RSM191.wav` (4-12 s) |
| `public/sfx/lava_loop_0.ogg`, `.m4a` | Lava crackle loop | 2018 bundle, Discover Oregon: Lava from the Kilauea Volcano in Hawaii, `Lava Lava Short Windy Crackles.WAV` (1-19 s) |
| `public/sfx/lava_rumble_loop_0.ogg`, `.m4a` | Deep lava rumble loop | 2018 bundle, Olivier Girardot: Guns & Explosions, `Volcano Eruption 1.wav` (4-14 s) |
| `public/sfx/sea_loop_0.ogg`, `.m4a` | Open sea offshore, loop | 2018 bundle, Discover Oregon: Ocean and Stream, `Ocean Waves 2017 Kauai Night Waves.WAV` (140-170 s) |
| `public/sfx/surf_loop_0.ogg`, `.m4a` | Surf on the beach, loop | 2018 bundle, Discover Oregon: Ocean and Stream, `Coast 2014 Coast Mono 1.wav` (1-43 s) |
| `public/sfx/wave_0.ogg`, `.m4a` | A single wave breaking | 2018 bundle, Discover Oregon: Ocean and Stream, `Ocean Waves 2017 Kauai Night Waves.WAV` (20.4-27.4 s) |
| `public/sfx/wave_1.ogg`, `.m4a` | A single wave breaking | 2018 bundle, Discover Oregon: Ocean and Stream, `Ocean Waves 2017 Kauai Night Waves.WAV` (121.4-128.4 s) |
| `public/sfx/wave_2.ogg`, `.m4a` | A single wave breaking | 2018 bundle, Discover Oregon: Ocean and Stream, `Ocean Waves 2017 Kauai Night Waves.WAV` (176.4-183.4 s) |
| `public/sfx/wave_3.ogg`, `.m4a` | A single wave breaking | 2018 bundle, Discover Oregon: Ocean and Stream, `Ocean Waves 2017 Kauai Night Waves.WAV` (224.8-231.8 s) |
| `public/sfx/rain_light_loop_0.ogg`, `.m4a` | Light rain loop | 2017 bundle, Double Trouble Audio: Rain and Thunder, `RATH - Rain and Distant Thunder Loop 01.wav` (0-8.2 s) |
| `public/sfx/rain_heavy_loop_0.ogg`, `.m4a` | Heavy rain loop | 2017 bundle, Double Trouble Audio: Rain and Thunder, `RATH - Rain Hard Loop 08.wav` (0-18.5 s) |
| `public/sfx/thunder_0.ogg`, `.m4a` | Thunder from dense clouds | 2017 bundle, Double Trouble Audio: Rain and Thunder, `RATH - Rain and Distant Thunder Loop 01.wav` (8.6-17.1 s) |
| `public/sfx/thunder_1.ogg`, `.m4a` | Thunder from dense clouds | 2017 bundle, Double Trouble Audio: Rain and Thunder, `RATH - Rain and Distant Thunder Loop 01.wav` (21.6-28.1 s) |
| `public/sfx/thunder_2.ogg`, `.m4a` | Thunder from dense clouds | 2017 bundle, Double Trouble Audio: Rain and Thunder, `RATH - Rain, Distant Thunder and Bird Loop.wav` (24.6-37.6 s) |
| `public/sfx/boil_loop_0.ogg`, `.m4a` | Boiling water roil, loop | 2018 bundle, Discover Oregon: Ocean and Stream, `Streams 2014 McKenzie 1.wav` (5-29 s) |
| `public/sfx/sizzle_loop_0.ogg`, `.m4a` | Steady sizzle loop | 2017 bundle, RedSonic: Frying Water, `water_in_frying_pan_05.wav` (0.3-5.8 s) |
| `public/sfx/sizzle_0.ogg`, `.m4a` | Sizzle when lava meets water | 2017 bundle, RedSonic: Frying Water, `water_in_frying_pan_05.wav` (0-1.8 s) |
| `public/sfx/sizzle_1.ogg`, `.m4a` | Sizzle when lava meets water | 2017 bundle, RedSonic: Frying Water, `water_dropped_on_electric_stove_02.wav` (0-2.2 s) |
| `public/sfx/punch_0.ogg`, `.m4a` | A punch landing | 2020 bundle, PMSFX: Lethal Blow, `PM_LB_DESIGNED_PUNCH_SIMPLE_CLEAN_DEEP_48.wav` (first 0.9 s) |
| `public/sfx/punch_1.ogg`, `.m4a` | A punch landing | 2020 bundle, Shapeforms: Hit & Punch, `PUNCH_PERCUSSIVE_HEAVY_06.wav` (first 0.9 s) |
| `public/sfx/punch_2.ogg`, `.m4a` | A punch landing | 2017 bundle, Gamemaster Audio: Punch Sound Pack, `punch_general_body_impact_03.wav` (first 0.8 s) |
| `public/sfx/thud_0.ogg`, `.m4a` | A low body thud | 2020 bundle, Shapeforms: Hit & Punch, `IMPACT_LOW_THUD_10.wav` (first 1.2 s) |
| `public/sfx/clank_0.ogg`, `.m4a` | Armour clank | 2016 bundle, 3maze: High Impact, `med_dark_001.wav` (first 1 s) |
| `public/sfx/clank_1.ogg`, `.m4a` | Armour clank | 2016 bundle, 3maze: High Impact, `short_med_003.wav` (first 0.8 s) |
| `public/sfx/rumble_0.ogg`, `.m4a` | The bosses' rumbling roar | 2020 bundle, Bluezone: Forest Creature Sound Effects, `Bluezone_BC0269_creature_wood_texture_crack_heavy_rumble_006.wav` (first 3.6 s) |
| `public/sfx/stomp_0.ogg`, `.m4a` | A boss stomp | 2017 bundle, Eiravaein Sound: Gravitas, `Gravitas,bridge,stomp,large,arched,wood,metal,heavyiron,deepstream,greenway,strong,resonant,loose,XY.wav` (first 2.5 s) |
| `public/sfx/ice_break_0.ogg`, `.m4a` | An enemy frozen in ice breaking | 2018 bundle, FLYSOUND: Ice Fury, `IC0151 BIG CHISEL HIT DEBRIS 06.wav` (first 1.25 s) |
| `public/sfx/ice_break_1.ogg`, `.m4a` | An enemy frozen in ice breaking | 2018 bundle, FLYSOUND: Ice Fury, `IC0318 KETTLEBELL SMASH DEBRIS 02.wav` (first 2.6 s) |
| `public/sfx/ice_tell_0.ogg`, `.m4a` | An ice enemy's warning scrape | 2018 bundle, FLYSOUND: Ice Fury, `IC0120 CHISEL SCRAPE DEBRIS 09.wav` (first 1.3 s) |
| `public/sfx/melt_0.ogg`, `.m4a` | Ice melting under heat | 2016 bundle, 3maze: ICE BLOCK, `burn_ice_001.wav` (0.2-2.2 s) |
| `public/sfx/hiss_0.ogg`, `.m4a` | The sand swarm's hiss | 2018 bundle, Gregor Quendel: Designed Rocks, `Designed Rocks - ELEM027 - Texture - Granular 3.wav` (first 1.2 s) |
| `public/sfx/grabmob_0.ogg`, `.m4a` | Grabbing and throwing an enemy | 2020 bundle, PMSFX: Lethal Blow, `PM_LB_DESIGNED_GRAB_BLOCK_THROW_7.wav` (first 1 s) |
| `public/sfx/fireball_0.ogg`, `.m4a` | The Lava Blast's fire swoosh | 2018 bundle, Gregor Quendel: Designed Fire, `Designed Fire - Swooshes - Burst, evolving 34.wav` (1.5-3.4 s) |
| `public/sfx/fireball_1.ogg`, `.m4a` | The Lava Blast's fire swoosh | 2018 bundle, Gregor Quendel: Designed Fire, `Designed Fire - Swooshes - Burst, evolving 34.wav` (4.6-6.8 s) |
| `public/sfx/quake_0.ogg`, `.m4a` | Meteor Drop shockwave rumble | 2018 bundle, Olivier Girardot: Guns & Explosions, `Earthquake 3 - Big.wav` (0.4-3 s) |
| `public/sfx/land_0.ogg`, `.m4a` | Landing on rock | 2017 bundle, Mechanical Wave: Rock,Brick and Dirt - Part 02, `Hit Rock into Gravel_RBDII 06.wav` (first 0.9 s) |
| `public/sfx/land_1.ogg`, `.m4a` | Landing on rock | 2018 bundle, Antisample: Rocks and Stones, `Rock_Impact_Snowy_Ground_Roll_Foliage_Debris_MONO_72.wav` (first 0.9 s) |
| `public/sfx/enemy_die_0.ogg`, `.m4a` | An enemy breaking apart | 2020 bundle, PMSFX: Shattering Bricks, `PM_SB_DESIGNED_IMPACT_48 Impact brick rock dirt gravel designed multi LFE.wav` (first 1.8 s) |
| `public/sfx/enemy_die_1.ogg`, `.m4a` | An enemy breaking apart | 2020 bundle, Wav Junction Sound Effects: Rocks, `0228_Single_Small_Rocks_Tumble_Cliff_004.wav` (first 1.4 s) |

## Already here

These 18 sounds are CC0 and in `public/sfx/`, as `.ogg` and `.m4a`:

- `music_0`: "An Untold Legend" by SkyleTheFrench, CC0 1.0, https://opengameart.org/content/an-untold-legend
- `wind_loop_0`: Freesound #150174, "wind in trees", CC0, https://freesound.org/s/150174/
- `gale_loop_0`: Freesound #557188, "JM_NATURAL ELEMENTS_Wind 01 - Tornado" by Julien Matthey, CC0, https://freesound.org/people/Julien_Matthey/sounds/557188/
- `step_hard_0` to `_4`, `step_soft_0` to `_4`, `hurt_0` to `_2`, `ui_0`, `objective_0`: Kenney's Impact Sounds (footsteps, punches) and Interface Sounds (click, confirmation), CC0, https://kenney.nl/assets/impact-sounds and https://kenney.nl/assets/interface-sounds
