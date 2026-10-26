// Catálogo de produção. Nenhuma credencial pertence a este arquivo.
const assets = [];
function add(id, type, seconds, prompt, opts = {}) {
  assets.push({ id, type, seconds, prompt, variants: 1, loop: false, ...opts });
}
const score = 'Original instrumental psychological and supernatural survival horror score for an abandoned Brazilian hospital called Santa Lucia. Recurring three-note motif: low D, dissonant Eb, unresolved A. Restrained cinematic detail, natural dynamics, textured acoustic sound, intimate oppressive space. No lyrics, no spoken words, no pop beat, no heroic melody. No sudden ending, no fade out: sustain the atmosphere at both boundaries for overlapping loop playback. ';
add('score_explore', 'music', 90, score + 'Very sparse bowed double bass, distant detuned hospital piano, fragile high string harmonics, almost subliminal breath-like reversed textures. Long uncomfortable silences between gestures. Someone unseen seems to be listening. Slow and oppressive, leave room for footsteps.');
add('score_basement', 'music', 90, score + 'Deep resonant subterranean dread, bowed metal, contra-bass clusters, muffled irregular pulses and isolated prepared-piano strings. Suggest a forbidden burial chamber under a hospital, vast pressure and spiritual corruption. Sparse, darker than the upstairs theme.');
add('score_stalk', 'music', 65, score + 'A presence approaches without being seen: tremulous sul ponticello strings, ambiguous scratch rhythms, unresolved close intervals, reversed glass and delicate low pulses. Patient anticipatory terror, no attack or jump scare, a slow feeling of suffocation.');
add('score_chase', 'music', 65, score + 'Desperate hunted panic: irregular propulsive low drum knocks, frantic dry string scrapes, distorted bowed bass and jagged clusters. Relentless nervous momentum with gaps for creature footfalls. Terror and vulnerability, no triumphant action music, no piercing sustained frequencies.');
add('score_finale', 'music', 80, score + 'The failing hospital generator awakens something beneath the earth. Mounting ritual-like polyrhythmic metallic pulses, dissonant low strings, wordless spectral bowed textures, a desperate rising repeating motif. Intense but leave space for an alarm and footsteps. Continuous urgency, no victory cadence.');
add('score_escape', 'music', 40, 'Original instrumental ending cue for escaping a haunted abandoned hospital into cold rain. The D Eb A motif dissolves into a fragile minor piano chord, distant warm string harmonics and a final lingering low unresolved note. Exhausted relief with an unsettling suggestion that the presence remains behind. Quiet, restrained, no vocals, no big orchestral climax. Natural fade at the end.');

const bed = 'Seamless stereo environment loop for a realistic supernatural horror game. Subtle, highly detailed, no music, no loud jumps, no intelligible dialogue. ';
add('amb_hospital', 'ambience', 25, bed + 'Empty decaying hospital corridor at night: stale air in vents, far away building groans, weak pipes settling, tiny dry dust movements. Spacious hollow oppressive room tone, hints of something moving beyond the walls.', { loop: true });
add('amb_basement', 'ambience', 25, bed + 'Deep concrete hospital basement: damp air, distant water drips, slow enormous structural groaning, muffled pipes, ominous subterranean pressure. Grounded physical texture, very sparse.', { loop: true });
add('amb_morgue', 'ambience', 25, bed + 'Abandoned cold morgue: very quiet refrigeration vibration, occasional distant stainless steel resonance, thin icy airflow. An unnatural hollow exhalation seems buried in the room tone.', { loop: true });
add('amb_noturna', 'ambience', 25, bed + 'An unlit sealed psychiatric ward: unnaturally still air, subtly moving distant breath-like textures, barely audible hollow wall resonance and far cloth dragging. An unseen spiritual presence, no clear speech.', { loop: true });
add('amb_boiler', 'ambience', 25, bed + 'Old underground boiler room: restrained low pipe vibration, faint steam hiss, metal slowly expanding, wet mechanical rumble. No loud operating machinery.', { loop: true });
add('amb_water', 'ambience', 25, bed + 'Flooded underground hospital cistern: gentle dark water movement against concrete, isolated dripping water, damp tunnel resonance, very distant gurgling drain.', { loop: true });
add('amb_rain', 'ambience', 25, bed + 'Cold night rain outside a hospital courtyard, drops on stone and distant roof gutter, mild wind. Consistent rain texture with no thunder or foreground footsteps.', { loop: true });
add('breath_calm', 'body', 12, 'Natural quiet close microphone human breathing, relaxed but uneasy adult breathing in and out slowly. Dry isolated breaths with small natural variations. No speech, no music, no background, seamless loop.', { loop: true });
add('breath_panic', 'body', 12, 'Realistic close microphone exhausted adult gasping breathing after running, anxious shaky inhales and heavy exhales at a steady fast pace. Dry isolated breathing, no screams, no words, no background, seamless loop.', { loop: true });
add('heartbeat', 'body', 0.85, 'One isolated natural muffled human heartbeat, a single lub dub pair. Soft bodily thud with low mid frequency detail, intimate internal chest sound, not an explosive sub bass impact. Immediate onset then silence, no ambience.');
add('hum_lamp', 'mechanical', 10, 'Seamless quiet buzzing of one failing old fluorescent hospital tube, irregular faint electrical flutter, isolated dry recording, no music or room ambience.', { loop: true });
add('hum_flashlight', 'mechanical', 8, 'Seamless subtle whine of a handheld flashlight electrical ballast under load, tiny vibrating transformer, restrained and intimate, dry isolated sound.', { loop: true });
add('siren', 'mechanical', 16, 'Seamless loop of a distant old hospital mechanical emergency siren, slow rising and falling pitch, gritty damaged speaker, muffled and unsettling but intelligible as an alarm. No music, no other sounds.', { loop: true });
add('burn', 'creature', 8, 'Seamless supernatural flesh sizzling and crackling under a concentrated flashlight beam, restrained wet hiss and faint tiny pops. Dry isolated sound, no fire roar, no voice, no music.', { loop: true });

// Assombrações discretas: silêncio e detalhe físico deixam espaço para os passos.
add('children_laughter', 'ambience', 24, 'Dry close human vocals: two young children laughing naturally, clearly voiced ha ha ha and he he, little breaths and soft playful murmurs. Audible human mouth and throat, warm natural midrange, never squeaky. Five distinct laughter phrases with 2-3 second silent gaps across 24 seconds. Restrained unsettling delivery. No birds, chirps, whistles, animals, wind, music, screams or environmental sounds. Seamless quiet ends.', { loop: true, targetLufs: -27, promptInfluence: 0.9 });
add('toy_music', 'effect', 10, 'One isolated small wind-up toy music box in an abandoned hospital. Motor winds into motion, an original innocent three-note melody on softly detuned metal tines repeats uneasily with tiny mechanical clicks. Motor slows, melody falters and fully stops by 10 seconds. Dry, small scale, no voice, orchestra or loud impact.', { targetLufs: -26, promptInfluence: 0.75 });
add('haunt_door_knock', 'effect', 3, 'Close dry realistic Foley: human knuckles tap a solid wooden hospital door exactly three times with uneven pauses. Rounded quiet knocks with audible wooden body and brief natural decay. No sharp clicks, bass boom, echo, door opening, handle, voices, music or extra impacts.', { variants: 3, targetLufs: -24, promptInfluence: 0.75 });
add('morgue_glass', 'effect', 2.5, 'Dry realistic Foley: one small empty drinking glass topples from a steel morgue table onto ceramic tile. One brittle glass break, tiny shards scatter and settle with a brief clean tail. Isolated natural recording, no explosion, bass boom, voices, music or repeated shattering.', { variants: 2, targetLufs: -24, promptInfluence: 0.75 });
add('phantom_step', 'foley', 0.85, 'Realistic dry close Foley: ONE quiet light human shoe footfall on dusty hospital tile. Small heel contact, soft sole roll and brief fine rubber scuff within 300ms. A distant unseen visitor, lighter than heavy barefoot creature steps. No bass boom, drum, echo, speech, music or repeated steps.', { variants: 6, footstep: true, mono: true, targetLufs: -25, promptInfluence: 0.75 });

const isolated = 'Game-ready isolated sound effect, immediate onset, clean natural decay with a short tail, no music or unrelated sounds. ';
const shoe = 'Realistic dry close-miked Foley: ONE quiet footfall, soft rubber-soled shoe, heel contact then sole roll in 300ms. Natural fine detail; no bass boom, drum, cartoon sound, reverb, speech, music or repeated steps. ';
for (const [name, detail] of [
  ['lino', 'Worn smooth hospital linoleum: muted cushioned contact, tiny dry rubber scuff. Softer than ceramic, no squeak.'],
  ['tile', 'Hard glazed ceramic tile: small clear heel tick then restrained rubber friction, short dry contact.'],
  ['stone', 'Solid terrazzo stone: dense dry heel contact, fine grit and a brief smooth sole slide, no hollow resonance.'],
  ['concrete', 'Dusty unfinished concrete: soft flat contact, subtle sandy grit brushed by the sole, tiny dry scuff.'],
  ['brick', 'Clay brick pavers: rough porous contact, light gritty sole drag and tiny mortar grains, not gravel or breaking blocks.'],
  ['asphalt', 'Coarse damp outdoor asphalt: subdued contact and short granular road friction, no puddle splash.'],
  ['wood', 'Old wooden floorboards: soft contact, restrained woody resonance and tiny board flex, no loud creak or hollow knock.'],
  ['water', 'Two centimeters of water over concrete: small irregular splash, water displacement and a few droplets; soft submerged sole contact, no huge splash.'],
]) add('step_' + name, 'foley', 0.85, shoe + detail, { variants: 6, footstep: true, mono: true, targetLufs: -28, promptInfluence: 0.75 });
add('creature_step', 'creature', 0.85, 'Realistic dry studio Foley: ONE heavy barefoot footfall of a tall gaunt creature. Low-mid body weight, rough leathery sole slap, brief dragging toe scrape and tiny joint click. Single contact in 350ms, natural decay. Organic friction, no cinematic bass boom, drum, synthesized sound, voice, growl, music, ambience, reverb or repeated steps.', { variants: 6, footstep: true, mono: true, targetLufs: -21, promptInfluence: 0.75 });
const effects = [
  ['gasp', 1.2, 'A startled exhausted adult takes one sharp shaky inhale and a small exhale, intimate dry breath, no speech.'],
  ['click_on', 0.5, 'One close plastic and metal flashlight switch clicked on, small firm mechanical snap.'],
  ['click_off', 0.5, 'One close plastic flashlight switch clicked off, dry softer mechanical snap.'],
  ['flashlight_thump', 0.65, 'A hand firmly taps the casing of an old handheld flashlight once, dull plastic and loose battery rattle.'],
  ['overheat', 1.5, 'A flashlight transformer sputters, a sharp electrical snap followed by a fading hot hiss, small handheld scale.'],
  ['metal_hit', 1.8, 'One impact against an old hospital steel pipe, rough ringing clang with realistic damped resonances.'],
  ['door_slam', 1.4, 'One old heavy hospital door slammed violently, solid wooden impact and metal latch rattle, realistic close perspective.'],
  ['door_rattle', 1.4, 'A locked hospital door handle tried and rattled twice, dry metal latch and constrained wood movement.'],
  ['door_creak', 1.8, 'An old hospital door opens slowly with a disturbing irregular hinge creak and slight wood movement.'],
  ['door_close', 0.9, 'One old hospital door closed carefully, restrained wood thud and metal latch clicking into place.'],
  ['locker_bang', 1.7, 'A tall steel locker is struck once by a heavy creature, deep denting metal thump and rattling door.'],
  ['locker_move', 0.9, 'An old steel hospital locker door opened quietly, short hinge scrape and loose latch movement.'],
  ['drawer', 1.5, 'A stainless steel morgue body drawer slides out on rough old rails, dry metallic scrape and restrained stop clunk.'],
  ['pickup_paper', 0.9, 'A hand picks up and unfolds one worn hospital paper note, gentle dry paper rustle.'],
  ['pickup_fuse', 0.65, 'A hand picks up a ceramic electrical fuse, small ceramic click and metal cap rattle.'],
  ['pickup_key', 0.8, 'A hand picks up an old brass hospital key on a small ring, brief delicate metal jingle.'],
  ['fuse_insert', 1.8, 'A ceramic fuse pushed into an old electrical panel, contact clicks, relay clunk, brief restrained electricity crackle.'],
  ['lights_on', 2.0, 'A row of old fluorescent hospital lights flickers on in sequence, delicate starter ticks, short electrical crackles, ending quietly.'],
  ['lamp_burst', 1.4, 'One fluorescent tube bursts: sharp pop, fine glass shattering and small pieces falling to tile.'],
  ['lever', 1.4, 'A heavy industrial electrical lever pulled down, mechanical scraping and a firm contactor clunk.'],
  ['unlock', 2.0, 'A heavy hospital exit electromagnetic lock disengages, electrical relay knock and slow releasing metal latch.'],
  ['vent_rattle', 1.8, 'A ceiling ventilation grille rattles as a heavy body pushes behind it, thin metal shaking and one dull impact.'],
  ['vent_crawl', 2.0, 'A heavy unnatural body drags through a metal ventilation duct, uneven short scraping and muffled knocks, no vocals.'],
  ['whisper', 3.8, 'A very intimate spectral layered whisper, raspy breathy human-like syllables with no intelligible words, unnaturally reversed breath edges, a haunting feminine and masculine texture. Dry, not a scream.', 3],
  ['radio', 3.4, 'An abandoned analog hospital radio briefly wakes: soft static tuning, a ghostly unintelligible voice fragment buried deep in the interference, then cuts off. No understandable language.'],
  ['drip', 0.65, 'One clear water drop hits a small stagnant concrete puddle, small plink and tiny ripple.'],
  ['spirit_knock', 3.4, 'Three very slow hollow unexplained knocks from inside a plaster wall, uneven spacing, restrained ominous resonance.'],
  ['spirit_lament', 5.0, 'A far away spectral breathy lament, impossibly long mournful human-like exhale with trembling airy harmonics, no words, no scream, ambiguous spiritual presence.'],
  ['spirit_scrape', 3.5, 'Slow fingernails or a brittle object dragging along decaying plaster from the other side of a wall, tiny debris and dry scraping.'],
  ['blackout', 3.5, 'A building electrical failure: several small relays snap, deep power hum rapidly collapses, a hollow low air pressure shift lingers. Supernatural dread, no explosion.'],
  ['stinger', 2.8, 'A short terrifying supernatural discovery sting: abrupt dissonant bowed metal and low dry impact, reverse spectral breath sucked into a dark resonant tail. Original cinematic sound, no loud clipping or piercing whistle.'],
  ['death', 5.0, 'Terrifying close supernatural attack impact, visceral low collision, a cracked breath and dissonant metallic spectral swell that collapses into a muffled ringing void. Original restrained horror death cue, no explicit dialogue.'],
];
for (const [id, seconds, prompt, variants = 1] of effects) add(id, 'effect', seconds, isolated + prompt, { variants });
for (const [id, seconds, detail] of [
  ['click', 1.0, 'Brittle wet jaw and tendon clicks from an emaciated humanoid, a short irregular cluster, no breath.'],
  ['breath', 2.7, 'Ragged deep hollow breathing of a tall emaciated inhuman creature, two raspy wet exhales, unnervingly close.'],
  ['sniff', 1.5, 'An inhuman creature takes three short wet nasal sniffs, probing and predatory.'],
  ['pain', 0.9, 'One short raw hoarse inhuman pained yelp, a strained throat and wet rasp, immediate onset.'],
  ['moan', 3.0, 'A low tortured inhuman moan, hollow throat with unstable tremulous breath, haunting and exhausted.'],
  ['growl', 1.7, 'A restrained menacing guttural inhuman growl, deep damaged throat with wet layered rasp, predatory.'],
  ['roar', 2.7, 'A horrifying humanoid creature roar, deep ragged throat tearing into a breathy high harmonic, physical and spiritual, no animal lion roar.'],
  ['attack', 1.7, 'An immediate violent inhuman attack snarl, wet throat rasp and abrupt exhalation, no body impact.'],
  ['screech', 2.0, 'A raw inhuman panic screech from a damaged humanoid throat, broken breath and rough midrange harmonics, no piercing pure tone.'],
  ['hiss', 1.1, 'An aggressive dry inhuman throat hiss, breath forced through clenched teeth with a small wet rasp.'],
]) add('creature_' + id, 'creature', seconds, isolated + detail, { variants: ['breath', 'growl', 'moan'].includes(id) ? 2 : 1 });

export const CATALOG = Object.freeze(assets);
export const SPECS = Object.freeze(Object.fromEntries(CATALOG.map(a => [a.id, a])));
export const filenames = (asset) => Array.from({ length: asset.variants }, (_, i) => `${asset.id}${asset.variants > 1 ? '_' + (i + 1) : ''}.ogg`);
