import animalsData from '../../../data/animals.json' with { type: 'json' }
import { LEAD_LENGTH, ROPE_FRICTION, ROPE_MAX_SPEED, ROPE_MIN_MASS, ROPE_PULL, SUB, TPS } from './constants.ts'
import { failIn, fieldsOf, numberField, onlyFields, secondsField, speedField, textField, tilesField, wholeField, type Fail, type Fields } from './data-check.ts'
import { ITEMS, itemFromKey, type ItemId } from './items.ts'

// The animals, from data/animals.json. Animals are not part of the factory's simulation: they wander across chunk
// edges, so the server runs them (apps/server/src/animals.ts) and sends where they are with the players, and what
// they are (kind, sex, stats, hunger) on the log whenever it changes.
//
// The skeletons and the frost lich are monsters, not animals: see monsters.ts.
//
// In the file, for each kind:
// - `hp`, and `armor`: how much it takes off every hit on it (see damageAfterArmor; never all of it); `speed` in tiles
//   a second; `size`: how big it is drawn, in tiles;
//   `halfSize`: how far it reaches from its middle to each side, in tiles, for walking into things; `mass`: how hard
//   it pulls on a rope, against a player's 1.
// - `foods`: what it eats from a feed box, by item key, or "#tag" for every item with that tag.
// - `herd`: how many come together when a herd is spawned; `biomes`: the biomes its wild herds live in (see
//   terrain.ts; none: it is never spawned by itself); `population`: how many wild ones each of those biomes keeps, for
//   every 10,000 tiles of it (its area, as a circle of its radius), topped up with herds as they are killed (see the
//   server's `populate` in animals.ts).
// - `temper`: "calm" (the default: it runs only from a hit), "skittish" (it runs from any player within `fleeRadius`
//   tiles, and from a hit, at `fleePace` times its speed, and its herd runs with it) or "hostile" (see `hunt`).
// - `hunt`, for a hostile one (a wolf): it keeps to its ground, and goes for a player who comes within `aggroRadius`
//   tiles or hurts it, and so does every one of its pack within `packRadius` tiles of it. It chases at `pace` times its
//   speed, bites for `damage` when within `reach` tiles, every `cooldown` seconds, and never gives a player up once it
//   has gone for them (only if they leave the game). With `flank`, the pack spreads out round its prey and darts in from different
//   sides, falling back between bites, rather than all running straight at it. It only notices a player it can see.
//   Packs keep apart: a wolf wanders where it likes, but with a wolf of another pack within half of `territory` tiles,
//   it walks off away from it; and no new pack turns up within `territory` tiles of another's wolves. Hit, a hunter backs off and does not bite again for `recoil` seconds (1 if not given), so a
//   player who lands a blow is not bitten straight back.
// - `grazes`: whether it eats grass (true unless false).
// - `solitary`: it lives alone (a spider): it never goes back to others of its kind, and turns up one at a time (each
//   one's sex by chance), whatever its `herd` says.
// - `webs`: it spins cobwebs round itself (a spider): one every `everySeconds` or so, on a free tile within `radius`
//   tiles of it, while fewer than `most` of the cobwebs it has spun still stand (wherever it has wandered since).
// - `drops`: what an adult drops when killed: a fixed `min` to `max`, or about as many as its `stat` (meat).
// - `milk`: the item a cow is milked for (as many as its milk stat, built up over time); `lays`: the item a chicken
//   lays (every eggTime seconds).
// - `life`: how fast it gets hungry (`hungerMinutes` from full to starving), how hungry it has to be to go looking for
//   grass (`hungryAt`, percent) and how far it looks (`grassRadius`, tiles), how much a tuft of grass fills it
//   (`grassFills`, percent), how long a meal from a feed box keeps it well fed (`wellFedMinutes`), how long after
//   breeding before it breeds again (`breedCooldownMinutes`), and how long a cow takes to make a unit of milk
//   (`milkMinutes`).
// - `stats`: what every animal of the kind is born with: `base` give or take `spread` for a wild one, kept within
//   `min` and `max`. A baby gets about the average of its parents'. `growth` is how long a baby takes to grow up, in
//   seconds; `eggTime` is in seconds too.
export type Sex = 'm' | 'f'
export type StatDef = { key: string; label: string; base: number; spread: number; min: number; max: number }
export type AnimalDrop = { item: ItemId; stat?: number; min: number; max: number }
// An animal's life, in ticks and in hunger points (HUNGER_MAX is starving).
export const HUNGER_MAX = 1000
export type AnimalLife = {
  hungerEvery: number
  hungryAt: number
  grassFills: number
  grassRadius: number
  wellFed: number
  breedCooldown: number
  milkEvery: number
}

export type Temper = 'calm' | 'skittish' | 'hostile'
// A hostile animal's hunting, in units and ticks.
export type Hunt = {
  aggroRadius: number
  packRadius: number
  pace: number
  damage: number
  reach: number
  cooldown: number
  flank: boolean
  territory: number
  // Ticks: hit, it backs off (out to the flanking ring round its prey) and does not bite again for this long.
  recoil: number
}

export type AnimalDef = {
  kind: string
  id: number
  name: string
  hp: number
  // How much it takes off every hit on it (see damageAfterArmor).
  armor: number
  // Units a tick.
  speed: number
  size: number
  // Units.
  halfSize: number
  mass: number
  foods: ReadonlySet<ItemId>
  herd: readonly [number, number]
  biomes: readonly string[]
  population: number
  temper: Temper
  // Units; 0 for an animal that only runs from a hit.
  fleeRadius: number
  fleePace: number
  hunt?: Hunt
  grazes: boolean
  solitary: boolean
  // Ticks, tiles, and how many.
  webs?: { every: number; radius: number; most: number }
  drops: readonly AnimalDrop[]
  milk?: ItemId
  lays?: ItemId
  life: AnimalLife
  stats: readonly StatDef[]
}

const ANIMAL_FIELDS = ['id', 'name', 'hp', 'armor', 'speed', 'size', 'halfSize', 'mass', 'foods', 'herd', 'population', 'biomes', 'temper', 'fleeRadius', 'fleePace', 'hunt', 'grazes', 'solitary', 'webs', 'drops', 'milk', 'lays', 'life', 'stats']
const LIFE_FIELDS = ['hungerMinutes', 'hungryAt', 'grassFills', 'grassRadius', 'wellFedMinutes', 'breedCooldownMinutes', 'milkMinutes']
const HUNT_FIELDS = ['aggroRadius', 'packRadius', 'pace', 'damage', 'reach', 'cooldown', 'flank', 'territory', 'recoil']

export const ANIMALS: readonly AnimalDef[] = parseAnimals(animalsData)
const BY_KIND = new Map(ANIMALS.map((def) => [def.kind, def]))

function parseAnimals(data: unknown): AnimalDef[] {
  if (typeof data !== 'object' || data === null) throw new Error('data/animals.json must be an object of animals.')
  return Object.entries(data).map(([kind, entry]): AnimalDef => {
    const fail: Fail = failIn(`data/animals.json, ${kind}`)
    const raw = fieldsOf(entry, 'it', fail)
    onlyFields(raw, ANIMAL_FIELDS, fail)
    const foods = new Set<ItemId>()
    if (!Array.isArray(raw.foods)) fail('"foods" must be a list')
    for (const food of raw.foods as unknown[]) {
      if (typeof food === 'string' && food.startsWith('#')) {
        const tag = food.slice(1)
        // Every item with the tag (see `tags` in items.json).
        for (const candidate of ITEMS) if (candidate.tags.includes(tag)) foods.add(candidate.id)
      } else foods.add(itemFromKey(food, fail))
    }
    const herd = raw.herd as number[]
    if (!Array.isArray(herd) || herd.length !== 2 || !(herd[0] >= 1) || !(herd[1] >= herd[0])) fail('"herd" must be [fewest, most]')
    const stats = Object.entries(fieldsOf(raw.stats ?? {}, '"stats"', fail)).map(([key, value]) => {
      const stat = fieldsOf(value, `"stats.${key}"`, fail)
      onlyFields(stat, ['label', 'base', 'spread', 'min', 'max'], fail, `"stats.${key}": `)
      return {
        key,
        label: textField(stat, 'label', fail, key),
        base: numberField(stat, 'base', fail),
        spread: numberField(stat, 'spread', fail),
        min: numberField(stat, 'min', fail),
        max: numberField(stat, 'max', fail),
      }
    })
    if (!stats.some((stat) => stat.key === 'growth')) fail('every animal needs a "growth" stat')
    const statIndex = (key: unknown): number => {
      const index = stats.findIndex((stat) => stat.key === key)
      return index >= 0 ? index : fail(`there is no stat "${String(key)}"`)
    }
    const drops = ((raw.drops ?? []) as unknown[]).map((value) => {
      const drop = fieldsOf(value, 'a drop', fail)
      onlyFields(drop, ['item', 'stat', 'min', 'max'], fail, '"drops": ')
      return {
        item: itemFromKey(drop.item, fail),
        ...(drop.stat !== undefined ? { stat: statIndex(drop.stat) } : {}),
        min: numberField(drop, 'min', fail, 0, 1),
        max: numberField(drop, 'max', fail, 0, 1),
      }
    })
    const life = fieldsOf(raw.life ?? {}, '"life"', fail)
    onlyFields(life, LIFE_FIELDS, fail, '"life": ')
    const minutes = (name: string, fallback: number): number => Math.max(1, Math.round(numberField(life, name, fail, 0, fallback) * 60 * TPS))
    const percent = (name: string, fallback: number): number => Math.round((numberField(life, name, fail, 0, fallback) * HUNGER_MAX) / 100)
    if (raw.milk !== undefined) statIndex('milk')
    if (raw.lays !== undefined) statIndex('eggTime')
    const temper = (raw.temper ?? 'calm') as Temper
    if (temper !== 'calm' && temper !== 'skittish' && temper !== 'hostile') fail('"temper" must be calm, skittish or hostile')
    const biomes = (raw.biomes ?? []) as unknown[]
    if (!Array.isArray(biomes) || !biomes.every((biome) => typeof biome === 'string')) fail('"biomes" must be a list of biome keys')
    if (temper === 'hostile' && raw.hunt === undefined) fail('a hostile animal needs "hunt"')
    return {
      kind,
      id: wholeField(raw, 'id', fail, 1),
      name: textField(raw, 'name', fail),
      hp: numberField(raw, 'hp', fail, 1),
      armor: numberField(raw, 'armor', fail, 0, 0),
      speed: Math.max(1, speedField(raw, 'speed', fail)),
      size: numberField(raw, 'size', fail),
      halfSize: tilesField(raw, 'halfSize', fail),
      mass: numberField(raw, 'mass', fail),
      foods,
      herd: [herd[0], herd[1]] as const,
      biomes: biomes as string[],
      population: numberField(raw, 'population', fail, 0, 0),
      temper,
      fleeRadius: tilesField(raw, 'fleeRadius', fail, 0),
      fleePace: numberField(raw, 'fleePace', fail, 0, 1.8),
      ...(raw.hunt !== undefined ? { hunt: huntOf(fieldsOf(raw.hunt, '"hunt"', fail), fail) } : {}),
      grazes: raw.grazes !== false,
      solitary: raw.solitary === true,
      ...(raw.webs !== undefined ? { webs: websOf(fieldsOf(raw.webs, '"webs"', fail), fail) } : {}),
      drops,
      ...(raw.milk !== undefined ? { milk: itemFromKey(raw.milk, fail) } : {}),
      ...(raw.lays !== undefined ? { lays: itemFromKey(raw.lays, fail) } : {}),
      life: {
        hungerEvery: Math.max(1, Math.round(minutes('hungerMinutes', 10) / HUNGER_MAX)),
        hungryAt: percent('hungryAt', 40),
        grassFills: percent('grassFills', 35),
        grassRadius: numberField(life, 'grassRadius', fail, 0, 12),
        wellFed: minutes('wellFedMinutes', 5),
        breedCooldown: minutes('breedCooldownMinutes', 10),
        milkEvery: minutes('milkMinutes', 3),
      },
      stats,
    }
  })
}

function websOf(webs: Fields, fail: Fail): { every: number; radius: number; most: number } {
  onlyFields(webs, ['everySeconds', 'radius', 'most'], fail, '"webs": ')
  return { every: secondsField(webs, 'everySeconds', fail), radius: wholeField(webs, 'radius', fail, 1), most: wholeField(webs, 'most', fail, 1) }
}

function huntOf(hunt: Fields, fail: Fail): Hunt {
  onlyFields(hunt, HUNT_FIELDS, fail, '"hunt": ')
  return {
    aggroRadius: tilesField(hunt, 'aggroRadius', fail),
    packRadius: tilesField(hunt, 'packRadius', fail),
    pace: numberField(hunt, 'pace', fail),
    damage: numberField(hunt, 'damage', fail, 1),
    reach: tilesField(hunt, 'reach', fail),
    cooldown: secondsField(hunt, 'cooldown', fail),
    flank: hunt.flank === true,
    territory: tilesField(hunt, 'territory', fail),
    recoil: secondsField(hunt, 'recoil', fail, 1),
  }
}

export function animalDef(kind: string): AnimalDef {
  const def = BY_KIND.get(kind)
  if (!def) throw new Error(`There is no animal ${kind}.`)
  return def
}

// The index of a stat in an animal's stats, or -1.
export function statIndex(def: AnimalDef, key: string): number {
  return def.stats.findIndex((stat) => stat.key === key)
}

// What a page is told about an animal, on the log, whenever any of it changes. `stats` are in the order of the kind's
// stats in animals.json. `growth` is how grown up it is, in percent (100 is an adult); `hunger` in percent too.
// `leader` is the player leading it on a rope, or 0; `post`, the fence it is tied to, if it is.
export type AnimalInfo = {
  id: number
  kind: string
  sex: Sex
  stats: number[]
  growth: number
  hp: number
  hunger: number
  fed: boolean
  leader: number
  post?: number
  milk: number
  // What it is doing, in a few words (for the debug view).
  doing: string
  // A hostile one that is after a player.
  angry?: boolean
}

// Tying to a fence (an animal or a raft, on a rope: see the server's commands.ts): the rope goes from the fence's post
// (`fencePost`, units: the middle of its tile), and can only be tied to something within TIE_REACH of it. Tied, it is
// pulled in to the post as if led there (see `ropeForce`), and the fence does not give.
export const TIE_REACH = 5 * SUB
export function fencePost(fence: { x: number; y: number }): { x: number; y: number } {
  return { x: fence.x * SUB + SUB / 2, y: fence.y * SUB + SUB / 2 }
}

// Where an animal is, in units, as it is sent with the players' positions: [id, x, y].
export type AnimalPosition = [number, number, number]

// How hard a rope from `from` to `to` pulls `from` towards `to` (what pulls `to` back is the same the other way):
// ROPE_PULL for each unit it is stretched past LEAD_LENGTH, nothing while it is slack (see LEAD_LENGTH in constants.ts).
export function ropeForce(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  if (distance <= LEAD_LENGTH) return { x: 0, y: 0 }
  const pull = ((distance - LEAD_LENGTH) * ROPE_PULL) / distance
  return { x: dx * pull, y: dy * pull }
}

// How fast something on a rope goes on it a tick later (units a tick, besides its own walking): its rope speed
// (`velocity`), sped up by the rope's pull (`force`) over its weight (`mass`, at least ROPE_MIN_MASS), less
// ROPE_FRICTION of it, and at most ROPE_MAX_SPEED.
export function ropeStep(velocity: { x: number; y: number }, force: { x: number; y: number }, mass: number): { x: number; y: number } {
  const weight = Math.max(mass, ROPE_MIN_MASS)
  let x = (velocity.x + force.x / weight) * (1 - ROPE_FRICTION)
  let y = (velocity.y + force.y / weight) * (1 - ROPE_FRICTION)
  const speed = Math.hypot(x, y)
  if (speed < 0.05) return { x: 0, y: 0 }
  if (speed > ROPE_MAX_SPEED) {
    x *= ROPE_MAX_SPEED / speed
    y *= ROPE_MAX_SPEED / speed
  }
  return { x, y }
}

// Moves something at `at` on by its rope speed (`move`: how it moves, stopping against what is in its way). Gives
// where it got to, and its rope speed after: none along a way it was stopped (so it does not shoot off once free).
export function ropeMove(
  at: { x: number; y: number },
  speed: { x: number; y: number },
  move: (dx: number, dy: number) => { x: number; y: number },
): { position: { x: number; y: number }; speed: { x: number; y: number } } {
  const dx = Math.round(speed.x)
  const dy = Math.round(speed.y)
  if (dx === 0 && dy === 0) return { position: { x: at.x, y: at.y }, speed }
  const moved = move(dx, dy)
  return { position: moved, speed: { x: moved.x - at.x === dx ? speed.x : 0, y: moved.y - at.y === dy ? speed.y : 0 } }
}
