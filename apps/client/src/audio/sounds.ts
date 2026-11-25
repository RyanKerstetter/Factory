// The game's sounds. Each one is made up on the spot with Web Audio (a recipe below), unless there is a file for it
// under res/sounds/: then a file is played instead, picked at random when there are several. A sound `step/grass`
// is played from `res/sounds/step-grass.ogg`, or from `step-grass-1.ogg`, `step-grass-2.ogg` and so on (.ogg, .mp3
// or .wav). The dev server picks a new file up on reload; a hosted build needs `npm run build`.
//
// A new sound is a recipe in RECIPES (its name is its key there) and a volume in SOUND_VOLUME.

import { biomeAt, isInDungeons, isSeaAt, WARP_LIGHT_LEVELS, WARP_SECONDS, warpLightAt, type Terrain } from '../../../../packages/shared/src/index.ts'
import { snowOnTile } from '../snow.ts'

// What the ground underfoot sounds like: grass in the forest and on the meadow, sand on the beaches and all over the
// desert, rock in the mountains and snow where it lies, and the ice crypt's frozen flagstones. A new surface needs a footstep recipe in FOOTSTEPS (or only its files)
// and a place in `surfaceAt`.
export type Surface = 'grass' | 'sand' | 'stone' | 'snow' | 'ice' | 'wood'

// Every sound, by name (see RECIPES).
export type SoundId = keyof typeof RECIPES

// The surface a player standing on tile x, y walks on.
export function surfaceAt(terrain: Terrain | undefined, x: number, y: number): Surface {
  if (isInDungeons(x, y)) return 'ice'
  if (!terrain) return 'grass'
  const biome = biomeAt(terrain, x, y)
  // Snow exactly where the ground is drawn white (a whole tile at a time: see isSnowAt), so what you hear is what you see.
  if (biome?.key === 'mountain') return snowOnTile(terrain, x, y) ? 'snow' : 'stone'
  if (biome?.ground === 'sand') return 'sand'
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isSeaAt(terrain, x + dx, y + dy)) return 'sand'
  return 'grass'
}

// The sound an animal of a kind makes when it is hurt.
export function animalSound(kind: string): SoundId {
  if (kind === 'chicken') return 'animal/chicken'
  if (kind === 'deer') return 'animal/deer'
  if (kind === 'wolf') return 'animal/wolf'
  if (kind === 'spider') return 'animal/spider'
  return 'animal/cow'
}

// The sound a monster of a kind makes when it is hurt: a skeleton's bones rattle; a wisp tinkles like ice; a goblin
// squeals; a mummy groans; a bee buzzes.
export function monsterSound(kind: string): SoundId {
  if (kind === 'frost-wisp') return 'punch/stone'
  if (kind === 'goblin') return 'animal/goblin'
  if (kind === 'mummy') return 'animal/mummy'
  if (kind === 'bee' || kind === 'queen-bee') return 'animal/bee'
  return 'animal/skeleton'
}

export function footstep(surface: Surface): SoundId {
  return `step/${surface}`
}

// How loud everything is at full volume (the volume settings scale it), 0 to 1.
const MASTER_VOLUME = 1

// How loud each sound is, on top of the volume settings: 1 as made, 0.5 half as loud, 2 twice as loud. Tweak these to
// balance the sounds against each other. (A file in res/sounds/ is played at this volume too.)
export const SOUND_VOLUME: Readonly<Record<SoundId, number>> = {
  // Hitting things and breaking them.
  'punch/wood': 1,
  'punch/leaves': 1,
  'punch/stone': 1,
  'break/tree': 1,
  'break/bush': 1,
  'break/rock': 1,
  'hit/animal': 1,
  // Being hurt, and the frost lich, and traps.
  hurt: 1,
  cast: 1,
  blizzard: 1,
  // A waystone charging to send a player off, and arriving at another.
  'warp/charge': 1,
  'warp/arrive': 1,
  'trap/click': 1,
  'trap/spikes': 1,
  // Creatures crying out when hurt.
  'animal/cow': 1,
  'animal/chicken': 1,
  'animal/deer': 1,
  'animal/wolf': 1,
  'animal/spider': 1,
  'animal/goblin': 1,
  'animal/mummy': 1,
  'animal/bee': 0.7,
  'animal/skeleton': 1,
  // Attacks.
  'attack/jab': 1,
  'attack/swing': 1,
  'attack/thrust': 1,
  'attack/shoot': 1,
  'attack/draw': 1,
  // Charged attacks: ready to let go, and each kind let go.
  'charge/ready': 0.5,
  'attack/spin': 1,
  'attack/slam': 1,
  'attack/dash': 1,
  // A skeleton raising its sword to swing, and crouching to charge.
  'monster/raise': 0.9,
  'monster/charge': 1,
  // Everything else.
  plant: 1,
  rustle: 0.6,
  pickup: 1,
  eat: 1,
  sleep: 1,
  move: 1,
  'craft/one': 1,
  'craft/some': 1,
  'craft/all': 1,
  'craft/fail': 1,
  // Footsteps, by what is underfoot.
  'step/grass': 0.45,
  'step/sand': 0.45,
  'step/stone': 0.45,
  'step/snow': 0.45,
  'step/ice': 0.45,
  'step/wood': 0.5,
}

// Which volume setting each sound is under: walking (footsteps and pushing through bushes), everything else, or (when
// played for them: see `play`) what the other players do.
const SOUND_CHANNELS = ['effects', 'footsteps', 'others'] as const
export type SoundChannel = (typeof SOUND_CHANNELS)[number]

function channelOf(id: SoundId): SoundChannel {
  return id.startsWith('step/') || id === 'rustle' ? 'footsteps' : 'effects'
}

export type SoundLevels = { master: number; effects: number; footsteps: number; others: number; muted: boolean }

// Where a sound comes from (tiles), and, for one another player makes, that it is theirs (under the "Other players"
// volume). It is quieter the further it is from the player, panned to its side, and not heard at all beyond HEAR_RADIUS.
export type SoundFrom = { x: number; y: number; other?: boolean }
const HEAR_RADIUS = 26
// How many tiles to one side a sound has to be to come from that side only.
const PAN_SPREAD = 12

type Recipe = (context: AudioContext, out: AudioNode, at: number, noise: AudioBuffer) => void

// The rustle of pushing through a bush: how high it sounds (1 as made, lower is deeper) and how drawn out it is (1 as
// made, higher is slower). A `rustle` file in res/sounds/ is played at RUSTLE_PITCH speed, which deepens and slows it
// both at once.
const RUSTLE_PITCH = 0.55
const RUSTLE_STRETCH = 1.8

const FOOTSTEPS: Record<Surface, Recipe> = {
  // A grassy crunch: a heel and then the rest of the foot, each pressing a dense cluster of tiny crackles out of the
  // grass, over a soft thud and a short rustle. The crackles are clicks a few milliseconds long in the middle of the
  // range, which is what makes a crunch; longer, brighter bursts sound like hiss. A low pass over the whole step
  // takes the fizz off the top.
  grass: (context, out, at, noise) => {
    const step = context.createBiquadFilter()
    step.type = 'lowpass'
    step.frequency.value = 3400
    step.Q.value = 0.5
    step.connect(out)
    burst(context, step, noise, { at, length: 0.07, gain: 0.45, filter: 'lowpass', frequency: 220 })
    burst(context, step, noise, { at: at + 0.01, length: 0.11, gain: 0.05, filter: 'bandpass', frequency: 1100, q: 0.7, attack: 0.015 })
    const roll = 0.045 + Math.random() * 0.025
    crackles(context, step, noise, at, 0.05, 9 + Math.floor(Math.random() * 5), 0.5)
    crackles(context, step, noise, at + roll, 0.06, 7 + Math.floor(Math.random() * 5), 0.35)
  },
  // Snow: a soft, squeaky, muffled crunch, lower and slower than grass, with no thud of hard ground under it.
  snow: (context, out, at, noise) => {
    const step = context.createBiquadFilter()
    step.type = 'lowpass'
    step.frequency.value = 1900
    step.connect(out)
    burst(context, step, noise, { at, length: 0.16, gain: 0.32, filter: 'bandpass', frequency: 700 * vary(0.1), to: 420, q: 0.9, attack: 0.03 })
    crackles(context, step, noise, at + 0.02, 0.12, 12 + Math.floor(Math.random() * 6), 0.32, 0.45)
    tone(context, step, { at: at + 0.04, type: 'sine', from: 1500 * vary(0.1), to: 1300, length: 0.05, gain: 0.025 })
  },
  // Rock: a hard, short tap of a heel and toe, a little grit under it.
  stone: (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.025, gain: 0.32, filter: 'bandpass', frequency: 2300 * vary(0.12), q: 2.2, attack: 0.001 })
    tone(context, out, { at, type: 'sine', from: 150, to: 90, length: 0.05, gain: 0.3 })
    burst(context, out, noise, { at: at + 0.06 + Math.random() * 0.02, length: 0.02, gain: 0.18, filter: 'bandpass', frequency: 2800 * vary(0.12), q: 2.5, attack: 0.001 })
    crackles(context, out, noise, at + 0.01, 0.04, 3, 0.12, 1.6)
  },
  // A raft's logs: a hollow knock of the heel on wood (a low, round tone, as a log rings), the toe a softer knock after,
  // and a little creak of the lashings.
  wood: (context, out, at, noise) => {
    tone(context, out, { at, type: 'triangle', from: 210 * vary(0.08), to: 150, length: 0.09, gain: 0.32 })
    burst(context, out, noise, { at, length: 0.03, gain: 0.22, filter: 'bandpass', frequency: 900 * vary(0.12), q: 1.6, attack: 0.001 })
    const toe = at + 0.07 + Math.random() * 0.02
    tone(context, out, { at: toe, type: 'triangle', from: 240 * vary(0.08), to: 175, length: 0.06, gain: 0.18 })
    burst(context, out, noise, { at: toe, length: 0.025, gain: 0.12, filter: 'bandpass', frequency: 1100 * vary(0.12), q: 1.8, attack: 0.001 })
    if (Math.random() < 0.35) tone(context, out, { at: at + 0.03, type: 'sawtooth', from: 520 * vary(0.15), to: 470, length: 0.08, gain: 0.012 })
  },
  // Sand: a soft shuffle, a hiss with little weight in it.
  sand: (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.13, gain: 0.14, filter: 'bandpass', frequency: 1800 * vary(0.12), to: 1100, q: 0.8, attack: 0.02 })
    burst(context, out, noise, { at, length: 0.06, gain: 0.25, filter: 'lowpass', frequency: 260 })
  },
  // The crypt's frozen flagstones: a muffled heel-and-toe on hard ground, with a faint gritty scuff of frost under the
  // sole. No ringing note (a tone on every step sounds like a beep, not ice): all of it filtered soft.
  ice: (context, out, at, noise) => {
    const step = context.createBiquadFilter()
    step.type = 'lowpass'
    step.frequency.value = 2600
    step.Q.value = 0.5
    step.connect(out)
    burst(context, step, noise, { at, length: 0.03, gain: 0.22, filter: 'bandpass', frequency: 1300 * vary(0.12), q: 1.3, attack: 0.002 })
    tone(context, step, { at, type: 'sine', from: 120, to: 75, length: 0.06, gain: 0.2 })
    burst(context, step, noise, { at: at + 0.01, length: 0.08, gain: 0.035, filter: 'bandpass', frequency: 3400 * vary(0.1), to: 2600, q: 0.8, attack: 0.01 })
    crackles(context, step, noise, at + 0.01, 0.05, 3, 0.06, 1.3)
    burst(context, step, noise, { at: at + 0.055 + Math.random() * 0.02, length: 0.02, gain: 0.1, filter: 'bandpass', frequency: 1700 * vary(0.12), q: 1.5, attack: 0.002 })
  },
}

const RECIPES = {
  // A fist on a trunk: a hollow knock (a short, falling note with a woody click on top) and a low thump under it.
  'punch/wood': (context, out, at, noise) => {
    tone(context, out, { at, type: 'triangle', from: 210 * vary(0.1), to: 120, length: 0.1, gain: 0.55 })
    tone(context, out, { at, type: 'sine', from: 95, to: 60, length: 0.12, gain: 0.5 })
    burst(context, out, noise, { at, length: 0.03, gain: 0.35, filter: 'bandpass', frequency: 950 * vary(0.1), q: 3, attack: 0.001 })
  },
  // A fist into leaves: a short rustle and a few crackling twigs.
  'punch/leaves': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.16, gain: 0.22, filter: 'bandpass', frequency: 2400 * vary(0.1), to: 1200, q: 0.8, attack: 0.015 })
    burst(context, out, noise, { at, length: 0.06, gain: 0.25, filter: 'lowpass', frequency: 300 })
    crackles(context, out, noise, at + 0.01, 0.08, 6, 0.3)
  },
  // A tree coming down: a sharp crack as the trunk gives, the rush of the canopy falling, and a heavy thud.
  'break/tree': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.05, gain: 0.5, filter: 'bandpass', frequency: 1700, q: 1.2, attack: 0.001 })
    crackles(context, out, noise, at, 0.12, 10, 0.4)
    burst(context, out, noise, { at: at + 0.05, length: 0.35, gain: 0.2, filter: 'bandpass', frequency: 1800, to: 700, q: 0.7, attack: 0.08 })
    tone(context, out, { at: at + 0.32, type: 'sine', from: 110, to: 38, length: 0.35, gain: 0.8 })
    burst(context, out, noise, { at: at + 0.32, length: 0.3, gain: 0.55, filter: 'lowpass', frequency: 260 })
  },
  // A bush pulled apart: a longer rustle full of snapping stems.
  'break/bush': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.3, gain: 0.25, filter: 'bandpass', frequency: 2200, to: 900, q: 0.7, attack: 0.03 })
    burst(context, out, noise, { at, length: 0.1, gain: 0.3, filter: 'lowpass', frequency: 280 })
    crackles(context, out, noise, at, 0.22, 16, 0.38)
  },
  // Attacks: a quick puff for a jab, a whoosh for a swing, a sharp hiss for a thrust, and a twang for a shot.
  'attack/jab': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.06, gain: 0.25, filter: 'bandpass', frequency: 1400 * vary(0.1), q: 1, attack: 0.005 })
  },
  'attack/swing': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.16, gain: 0.25, filter: 'bandpass', frequency: 900 * vary(0.1), to: 2200, q: 1.2, attack: 0.04 })
  },
  'attack/thrust': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.1, gain: 0.25, filter: 'bandpass', frequency: 2600 * vary(0.1), to: 1600, q: 2, attack: 0.01 })
  },
  'attack/shoot': (context, out, at, noise) => {
    tone(context, out, { at, type: 'triangle', from: 320 * vary(0.08), to: 180, length: 0.12, gain: 0.3 })
    burst(context, out, noise, { at, length: 0.12, gain: 0.15, filter: 'bandpass', frequency: 3000, to: 1800, q: 1.5, attack: 0.005 })
  },
  // A shot being wound up: a bowstring creaking back, or a sling's cord starting to whoosh round.
  'attack/draw': (context, out, at, noise) => {
    tone(context, out, { at, type: 'triangle', from: 140 * vary(0.08), to: 190, length: 0.22, gain: 0.08 })
    burst(context, out, noise, { at, length: 0.24, gain: 0.06, filter: 'bandpass', frequency: 900, to: 1400, q: 2, attack: 0.08 })
  },
  // A charge ready to let go: something to pick up on in the background, not a beep: a soft, low creak of the grip
  // tightening, muffled.
  'charge/ready': (context, out, at, noise) => {
    tone(context, out, { at, type: 'sine', from: 260 * vary(0.05), to: 300, length: 0.09, gain: 0.06 })
    burst(context, out, noise, { at, length: 0.1, gain: 0.04, filter: 'bandpass', frequency: 700, to: 900, q: 1.5, attack: 0.02 })
  },
  // A spin: two whooshes round, one after the other, a turn apart.
  'attack/spin': (context, out, at, noise) => {
    for (const turn of [0, 0.27]) burst(context, out, noise, { at: at + turn, length: 0.22, gain: 0.28, filter: 'bandpass', frequency: 700 * vary(0.1), to: 2400, q: 1.1, attack: 0.06 })
  },
  // A slam or a big strike: a heavy whoosh down and a deep thud into the ground.
  'attack/slam': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.16, gain: 0.25, filter: 'bandpass', frequency: 1400, to: 500, q: 1, attack: 0.04 })
    tone(context, out, { at: at + 0.13, type: 'sine', from: 120 * vary(0.08), to: 40, length: 0.3, gain: 0.7 })
    burst(context, out, noise, { at: at + 0.13, length: 0.22, gain: 0.45, filter: 'lowpass', frequency: 300 })
  },
  // A dash: a fast rush of air going past.
  'attack/dash': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.24, gain: 0.3, filter: 'bandpass', frequency: 600 * vary(0.1), to: 3000, q: 0.9, attack: 0.02 })
    burst(context, out, noise, { at, length: 0.1, gain: 0.2, filter: 'lowpass', frequency: 240 })
  },
  // A skeleton raising its sword: bones creaking, and a short scrape of rusty metal.
  'monster/raise': (context, out, at, noise) => {
    for (let i = 0; i < 3; i++) burst(context, out, noise, { at: at + i * 0.04, length: 0.025, gain: 0.16, filter: 'bandpass', frequency: 1900 * vary(0.25) })
    burst(context, out, noise, { at: at + 0.08, length: 0.18, gain: 0.12, filter: 'bandpass', frequency: 3600, to: 2600, q: 6, attack: 0.03 })
  },
  // A skeleton crouching to charge: a low, rising rattle and a long scrape of its blade, building to the dash.
  'monster/charge': (context, out, at, noise) => {
    for (let i = 0; i < 10; i++) burst(context, out, noise, { at: at + i * 0.08 * vary(0.2), length: 0.03, gain: 0.08 + i * 0.015, filter: 'bandpass', frequency: (1200 + i * 120) * vary(0.2) })
    burst(context, out, noise, { at, length: 0.9, gain: 0.1, filter: 'bandpass', frequency: 2200, to: 4200, q: 7, attack: 0.5 })
    tone(context, out, { at, type: 'sawtooth', from: 70, to: 110, length: 0.9, gain: 0.07 })
  },
  // A hurt cow: a short, low, falling moo. A hurt chicken: a sharp squawk.
  'animal/cow': (context, out, at) => {
    tone(context, out, { at, type: 'sawtooth', from: 170 * vary(0.08), to: 110, length: 0.32, gain: 0.18 })
    tone(context, out, { at, type: 'sine', from: 85 * vary(0.08), to: 60, length: 0.32, gain: 0.3 })
  },
  'animal/chicken': (context, out, at, noise) => {
    tone(context, out, { at, type: 'square', from: 900 * vary(0.1), to: 1500, length: 0.07, gain: 0.08 })
    tone(context, out, { at: at + 0.07, type: 'square', from: 1300 * vary(0.1), to: 700, length: 0.12, gain: 0.07 })
    burst(context, out, noise, { at, length: 0.15, gain: 0.08, filter: 'bandpass', frequency: 2400, q: 1.5, attack: 0.01 })
  },
  // A hurt deer: a short, high bleat. A hurt wolf: a snarl and a yelp.
  'animal/deer': (context, out, at) => {
    tone(context, out, { at, type: 'triangle', from: 620 * vary(0.1), to: 420, length: 0.16, gain: 0.22 })
    tone(context, out, { at: at + 0.02, type: 'sine', from: 900 * vary(0.1), to: 600, length: 0.12, gain: 0.1 })
  },
  'animal/wolf': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.14, gain: 0.2, filter: 'lowpass', frequency: 420 })
    tone(context, out, { at, type: 'sawtooth', from: 140 * vary(0.08), to: 110, length: 0.14, gain: 0.12 })
    tone(context, out, { at: at + 0.12, type: 'triangle', from: 1100 * vary(0.1), to: 700, length: 0.12, gain: 0.16 })
  },
  // A hurt spider: a dry hiss. A hurt goblin: a squeal, high and nasal. A hurt bee: an angry buzz.
  'animal/spider': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.22, gain: 0.22, filter: 'highpass', frequency: 3200 * vary(0.1), attack: 0.02 })
    burst(context, out, noise, { at: at + 0.03, length: 0.12, gain: 0.1, filter: 'bandpass', frequency: 5200, q: 2, attack: 0.01 })
  },
  'animal/goblin': (context, out, at) => {
    tone(context, out, { at, type: 'sawtooth', from: 620 * vary(0.1), to: 900, length: 0.08, gain: 0.12 })
    tone(context, out, { at: at + 0.08, type: 'sawtooth', from: 880 * vary(0.1), to: 420, length: 0.16, gain: 0.12 })
  },
  // A hurt mummy: a low, dry groan through dusty wrappings.
  'animal/mummy': (context, out, at, noise) => {
    tone(context, out, { at, type: 'sawtooth', from: 95 * vary(0.08), to: 70, length: 0.42, gain: 0.14 })
    tone(context, out, { at: at + 0.03, type: 'triangle', from: 190 * vary(0.08), to: 140, length: 0.36, gain: 0.08 })
    burst(context, out, noise, { at, length: 0.3, gain: 0.08, filter: 'bandpass', frequency: 700 * vary(0.1), q: 1.5, attack: 0.06 })
  },
  'animal/bee': (context, out, at) => {
    tone(context, out, { at, type: 'sawtooth', from: 230 * vary(0.08), to: 260, length: 0.22, gain: 0.08 })
    tone(context, out, { at, type: 'square', from: 460 * vary(0.08), to: 520, length: 0.22, gain: 0.03 })
  },
  // A skeleton: a dry rattle of bones.
  'animal/skeleton': (context, out, at, noise) => {
    for (let i = 0; i < 4; i++) burst(context, out, noise, { at: at + i * 0.045 * vary(0.3), length: 0.03, gain: 0.22, filter: 'bandpass', frequency: 2200 * vary(0.25) })
  },
  // You are hurt: a heavy thud in the chest and a short grunt.
  hurt: (context, out, at, noise) => {
    tone(context, out, { at, type: 'sine', from: 110 * vary(0.08), to: 55, length: 0.16, gain: 0.6 })
    burst(context, out, noise, { at, length: 0.07, gain: 0.35, filter: 'lowpass', frequency: 520 })
    tone(context, out, { at: at + 0.02, type: 'sawtooth', from: 210 * vary(0.1), to: 140, length: 0.13, gain: 0.1 })
    burst(context, out, noise, { at: at + 0.02, length: 0.12, gain: 0.12, filter: 'bandpass', frequency: 900 * vary(0.1), q: 3 })
  },
  // The frost lich starting a spell: a cold, rising shimmer.
  cast: (context, out, at, noise) => {
    tone(context, out, { at, type: 'sine', from: 520, to: 1040, length: 0.9, gain: 0.12 })
    tone(context, out, { at: at + 0.05, type: 'triangle', from: 780, to: 1560, length: 0.8, gain: 0.06 })
    burst(context, out, noise, { at, length: 0.9, gain: 0.08, filter: 'bandpass', frequency: 3200, to: 5200, q: 3, attack: 0.3 })
  },
  // A waystone charging (WARP_SECONDS long): a hum rising under it, a shimmer swelling, and a chime as each pair of its
  // lights comes on (see `warpLightAt`), higher each time.
  'warp/charge': (context, out, at, noise) => {
    tone(context, out, { at, type: 'sine', from: 110, to: 220, length: WARP_SECONDS, gain: 0.14 })
    tone(context, out, { at, type: 'triangle', from: 220, to: 440, length: WARP_SECONDS, gain: 0.04 })
    burst(context, out, noise, { at, length: WARP_SECONDS, gain: 0.07, filter: 'bandpass', frequency: 500, to: 2600, q: 2, attack: WARP_SECONDS * 0.8 })
    for (let level = 0; level <= WARP_LIGHT_LEVELS; level++) {
      const pitch = 520 * 1.122 ** level
      tone(context, out, { at: at + warpLightAt(level) * WARP_SECONDS, type: 'sine', from: pitch, to: pitch, length: 0.4, gain: 0.07 })
    }
  },
  // Arriving at a waystone: a rush of air and a bright ringing chord.
  'warp/arrive': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.6, gain: 0.25, filter: 'bandpass', frequency: 3000, to: 500, q: 0.9, attack: 0.02 })
    for (const [pitch, gain] of [[523, 0.1], [659, 0.08], [784, 0.07], [1047, 0.05]] as const) tone(context, out, { at, type: 'sine', from: pitch * 1.02, to: pitch, length: 1.4, gain })
    tone(context, out, { at, type: 'sine', from: 160, to: 60, length: 0.5, gain: 0.3 })
  },
  // A blizzard: a long, deep, howling gust.
  blizzard: (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 2.2, gain: 0.3, filter: 'bandpass', frequency: 420, to: 900, q: 0.7, attack: 0.5 })
    tone(context, out, { at, type: 'sine', from: 70, to: 55, length: 2, gain: 0.25 })
  },
  // A spike trap set off: a dry click of a catch let go; then the spikes shooting up: a sharp scrape and clank.
  'trap/click': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.03, gain: 0.35, filter: 'bandpass', frequency: 2600, q: 3, attack: 0.001 })
    tone(context, out, { at, type: 'triangle', from: 900, to: 600, length: 0.05, gain: 0.12 })
  },
  'trap/spikes': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.12, gain: 0.45, filter: 'bandpass', frequency: 1800, to: 3600, q: 1.5, attack: 0.002 })
    tone(context, out, { at, type: 'square', from: 220, to: 160, length: 0.1, gain: 0.08 })
  },
  // A hit on an animal: a soft, dull thump.
  'hit/animal': (context, out, at, noise) => {
    tone(context, out, { at, type: 'sine', from: 160 * vary(0.1), to: 80, length: 0.09, gain: 0.5 })
    burst(context, out, noise, { at, length: 0.05, gain: 0.25, filter: 'lowpass', frequency: 600 })
  },
  // A hit on a rock: a hard, bright click with a dull knock under it.
  'punch/stone': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.025, gain: 0.4, filter: 'bandpass', frequency: 3200 * vary(0.1), q: 2.5, attack: 0.001 })
    tone(context, out, { at, type: 'triangle', from: 420 * vary(0.08), to: 300, length: 0.06, gain: 0.3 })
    tone(context, out, { at, type: 'sine', from: 120, to: 70, length: 0.08, gain: 0.35 })
  },
  // A rock breaking apart: a crack, then the pieces clattering down.
  'break/rock': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.06, gain: 0.5, filter: 'bandpass', frequency: 2400, q: 1.2, attack: 0.001 })
    tone(context, out, { at, type: 'sine', from: 140, to: 50, length: 0.2, gain: 0.5 })
    crackles(context, out, noise, at + 0.05, 0.3, 14, 0.4)
    burst(context, out, noise, { at: at + 0.04, length: 0.25, gain: 0.25, filter: 'lowpass', frequency: 500 })
  },
  // An acorn pressed into the ground: a soft pat of earth with a little grit in it.
  plant: (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.09, gain: 0.5, filter: 'lowpass', frequency: 380 })
    tone(context, out, { at, type: 'sine', from: 140, to: 70, length: 0.08, gain: 0.3 })
    crackles(context, out, noise, at + 0.01, 0.05, 5, 0.18)
  },
  // Pushing through a bush: a soft, quiet swish of leaves with a twig or two in it, a little different every time.
  rustle: (context, out, at, noise) => {
    const pitch = RUSTLE_PITCH
    const stretch = RUSTLE_STRETCH
    const length = (0.22 + Math.random() * 0.12) * stretch
    burst(context, out, noise, {
      at,
      length,
      gain: 0.08,
      filter: 'bandpass',
      frequency: 1900 * pitch * vary(0.2),
      to: 1100 * pitch,
      q: 0.9,
      attack: 0.06 * stretch,
    })
    burst(context, out, noise, {
      at: at + 0.05 * stretch,
      length: length * 0.8,
      gain: 0.05,
      filter: 'bandpass',
      frequency: 3200 * pitch * vary(0.15),
      to: 2000 * pitch,
      q: 1.2,
      attack: 0.05 * stretch,
    })
    crackles(context, out, noise, at + 0.03 * stretch, length * 0.7, 3 + Math.floor(Math.random() * 3), 0.07, pitch)
  },
  // An item picked up off the ground: a small, soft rising pop.
  pickup: (context, out, at) => {
    tone(context, out, { at, type: 'sine', from: 520 * vary(0.06), to: 880, length: 0.08, gain: 0.18 })
    tone(context, out, { at: at + 0.035, type: 'sine', from: 780 * vary(0.06), to: 1180, length: 0.07, gain: 0.1 })
  },
  // An item moved about an inventory: a soft, short tick.
  move: (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.025, gain: 0.14, filter: 'bandpass', frequency: 1800 * vary(0.15), q: 2 })
    tone(context, out, { at, type: 'triangle', from: 520 * vary(0.05), to: 480, length: 0.05, gain: 0.05 })
  },
  // Eating: a few soft, quick bites.
  eat: (context, out, at, noise) => {
    for (let i = 0; i < 3; i++) burst(context, out, noise, { at: at + i * 0.09, length: 0.05, gain: 0.2, filter: 'bandpass', frequency: 900 * vary(0.2), q: 1.5 })
  },
  // Lying down to sleep: a low, falling hum.
  sleep: (context, out, at) => {
    tone(context, out, { at, type: 'sine', from: 330, to: 196, length: 0.6, gain: 0.14 })
    tone(context, out, { at: at + 0.2, type: 'sine', from: 247, to: 147, length: 0.6, gain: 0.1 })
  },
  // Crafting: a knock and a rising chime, one note for one, two for five (shift), three for all you can (ctrl).
  'craft/one': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.05, gain: 0.25, filter: 'bandpass', frequency: 700, q: 2 })
    tone(context, out, { at: at + 0.03, type: 'triangle', from: 660, to: 660, length: 0.12, gain: 0.14 })
  },
  'craft/some': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.05, gain: 0.25, filter: 'bandpass', frequency: 700, q: 2 })
    tone(context, out, { at: at + 0.03, type: 'triangle', from: 660, to: 660, length: 0.1, gain: 0.13 })
    tone(context, out, { at: at + 0.11, type: 'triangle', from: 880, to: 880, length: 0.12, gain: 0.13 })
  },
  'craft/all': (context, out, at, noise) => {
    burst(context, out, noise, { at, length: 0.06, gain: 0.28, filter: 'bandpass', frequency: 600, q: 2 })
    tone(context, out, { at: at + 0.03, type: 'triangle', from: 660, to: 660, length: 0.09, gain: 0.13 })
    tone(context, out, { at: at + 0.1, type: 'triangle', from: 880, to: 880, length: 0.09, gain: 0.13 })
    tone(context, out, { at: at + 0.17, type: 'triangle', from: 1100, to: 1100, length: 0.14, gain: 0.13 })
  },
  // A craft that cannot be done: a flat, buzzing double thud.
  'craft/fail': (context, out, at) => {
    tone(context, out, { at, type: 'square', from: 150, to: 120, length: 0.09, gain: 0.1 })
    tone(context, out, { at: at + 0.12, type: 'square', from: 130, to: 100, length: 0.12, gain: 0.1 })
  },
  'step/grass': FOOTSTEPS.grass,
  'step/snow': FOOTSTEPS.snow,
  'step/stone': FOOTSTEPS.stone,
  'step/sand': FOOTSTEPS.sand,
  'step/ice': FOOTSTEPS.ice,
  'step/wood': FOOTSTEPS.wood,
} satisfies Record<string, Recipe>

const files = import.meta.glob('../../../../res/sounds/**/*.{ogg,mp3,wav}', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>

// The files for a sound, from its name: `step/grass` is step-grass.ogg, step-grass-1.ogg and so on.
function filesFor(id: SoundId): string[] {
  const stem = id.replace('/', '-')
  const pattern = new RegExp(`/${stem}(-\\d+)?\\.(ogg|mp3|wav)$`)
  return Object.entries(files)
    .filter(([path]) => pattern.test(path))
    .map(([, url]) => url)
}

// Plays the sounds. Browsers only let a page make sound after the player has pressed something, so nothing plays until
// `unlock` has been called from a key or click.
export class Sounds {
  private context: AudioContext | undefined
  private out: GainNode | undefined
  private noise: AudioBuffer | undefined
  private readonly loaded = new Map<SoundId, AudioBuffer[]>()
  private readonly channels = new Map<SoundChannel, GainNode>()
  private levels: SoundLevels = { master: 1, effects: 1, footsteps: 1, others: 0.5, muted: false }
  // Where the player hears from (tiles).
  private listener = { x: 0, y: 0 }

  // How loud the game is: the master volume, each kind's, and whether it is muted (the sound settings).
  setLevels(levels: SoundLevels): void {
    this.levels = { ...levels }
    this.applyLevels()
  }

  private applyLevels(): void {
    if (this.out) this.out.gain.value = this.levels.muted ? 0 : MASTER_VOLUME * this.levels.master
    for (const [channel, gain] of this.channels) gain.gain.value = this.levels[channel]
  }

  unlock(): void {
    if (!this.context) {
      try {
        this.context = new AudioContext()
      } catch {
        return
      }
      this.out = this.context.createGain()
      this.out.connect(this.context.destination)
      for (const channel of SOUND_CHANNELS) {
        const gain = this.context.createGain()
        gain.connect(this.out)
        this.channels.set(channel, gain)
      }
      this.applyLevels()
      this.noise = whiteNoise(this.context)
      void this.loadFiles(this.context)
    }
    if (this.context.state === 'suspended') void this.context.resume()
  }

  // Where the player is, to hear sounds from (tiles).
  listen(x: number, y: number): void {
    this.listener = { x, y }
  }

  // Plays a sound: the player's own, or, `from` somewhere, as loud as it is from there (see SoundFrom).
  play(id: SoundId, from?: SoundFrom): void {
    const context = this.context
    const channel = this.channels.get(from?.other ? 'others' : channelOf(id))
    // A context still starting up plays what it is given as soon as it is running. Nothing is made while muted.
    if (!context || !channel || !this.noise || context.state === 'closed' || this.levels.muted) return
    // This sound's own volume (SOUND_VOLUME), let go of once it has had time to play out.
    const own = context.createGain()
    own.gain.value = SOUND_VOLUME[id]
    own.connect(channel)
    setTimeout(() => own.disconnect(), 4_000)
    let out: AudioNode = own
    if (from) {
      const dx = from.x - this.listener.x
      const distance = Math.hypot(dx, from.y - this.listener.y)
      const near = 1 - distance / HEAR_RADIUS
      if (near <= 0.02) return
      const gain = context.createGain()
      gain.gain.value = near * near
      const pan = context.createStereoPanner()
      pan.pan.value = Math.max(-1, Math.min(1, dx / PAN_SPREAD))
      gain.connect(pan).connect(own)
      out = gain
      // Let go once it has had time to play out.
      setTimeout(() => {
        gain.disconnect()
        pan.disconnect()
      }, 4_000)
    }
    const buffers = this.loaded.get(id)
    if (buffers && buffers.length > 0) {
      const source = context.createBufferSource()
      source.buffer = buffers[Math.floor(Math.random() * buffers.length)]
      source.playbackRate.value = (id === 'rustle' ? RUSTLE_PITCH : 1) * vary(0.05)
      source.connect(out)
      source.start()
      return
    }
    const recipe: Recipe = RECIPES[id]
    recipe(context, out, context.currentTime, this.noise)
  }

  dispose(): void {
    void this.context?.close()
    this.context = undefined
    this.channels.clear()
  }

  private async loadFiles(context: AudioContext): Promise<void> {
    for (const id of Object.keys(RECIPES) as SoundId[]) {
      const buffers: AudioBuffer[] = []
      for (const url of filesFor(id)) {
        try {
          buffers.push(await context.decodeAudioData(await (await fetch(url)).arrayBuffer()))
        } catch (error) {
          console.warn(`Could not load the sound ${url}, so ${id} is made up instead.`, error)
        }
      }
      if (buffers.length > 0) this.loaded.set(id, buffers)
    }
  }
}

// ---- the pieces the recipes are made of

// A number near 1, up to `amount` either way, so a sound played again is not quite the same.
function vary(amount: number): number {
  return 1 + (Math.random() * 2 - 1) * amount
}

function whiteNoise(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

// `count` tiny clicks scattered over `spread` seconds from `at`, loudest first, each a few milliseconds of noise
// pitched somewhere in the middle of the range (times `pitch`).
function crackles(
  context: AudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  at: number,
  spread: number,
  count: number,
  gain: number,
  pitch = 1,
): void {
  for (let i = 0; i < count; i++) {
    const offset = spread * Math.random() ** 1.5
    burst(context, out, noise, {
      at: at + offset,
      length: 0.002 + Math.random() * 0.005,
      gain: gain * (1 - offset / (spread * 1.4)) * (0.5 + Math.random() * 0.5),
      filter: 'bandpass',
      frequency: (700 + Math.random() * 1800) * pitch,
      q: 2 + Math.random() * 2.5,
      attack: 0.0005,
    })
  }
}

// A short burst of filtered noise that dies away, its filter sliding to `to` if given.
function burst(
  context: AudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  shape: { at: number; length: number; gain: number; filter: BiquadFilterType; frequency: number; to?: number; q?: number; attack?: number },
): void {
  const source = context.createBufferSource()
  source.buffer = noise
  const filter = context.createBiquadFilter()
  filter.type = shape.filter
  filter.frequency.setValueAtTime(shape.frequency, shape.at)
  if (shape.to !== undefined) filter.frequency.exponentialRampToValueAtTime(shape.to, shape.at + shape.length)
  if (shape.q !== undefined) filter.Q.value = shape.q
  const gain = envelope(context, shape.at, shape.length, shape.gain, shape.attack)
  source.connect(filter).connect(gain).connect(out)
  source.start(shape.at, Math.random() * 0.5)
  source.stop(shape.at + shape.length + 0.02)
}

// A note sliding from one pitch to another, dying away.
function tone(
  context: AudioContext,
  out: AudioNode,
  shape: { at: number; type: OscillatorType; from: number; to: number; length: number; gain: number },
): void {
  const oscillator = context.createOscillator()
  oscillator.type = shape.type
  oscillator.frequency.setValueAtTime(shape.from, shape.at)
  oscillator.frequency.exponentialRampToValueAtTime(shape.to, shape.at + shape.length)
  oscillator.connect(envelope(context, shape.at, shape.length, shape.gain)).connect(out)
  oscillator.start(shape.at)
  oscillator.stop(shape.at + shape.length + 0.02)
}

// A gain that rises to `peak` over `attack` seconds and dies away by `length`. The attack is never more than a quarter
// of the length, so a very short sound still rises before it falls.
function envelope(context: AudioContext, at: number, length: number, peak: number, attack = 0.004): GainNode {
  const rise = Math.min(attack, length / 4)
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + rise)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
  return gain
}
