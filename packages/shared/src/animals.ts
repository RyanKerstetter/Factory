import animalsData from '../../../data/animals.json' with { type: 'json' }
import { LEAD_LENGTH, PLAYER_MASS, SUB, TPS } from './constants.ts'
import { ITEMS, itemByKey, type ItemId } from './items.ts'

// The animals, from data/animals.json. Animals are not part of the factory's simulation: they wander across chunk
// edges, so the server runs them (apps/server/src/animals.ts) and sends where they are with the players, and what
// they are (kind, sex, stats, hunger) on the log whenever it changes.
//
// In the file, for each kind:
// - `hp`: hits it takes (a fist does 1, a knife 2); `speed` in tiles a second; `size`: how big it is drawn, in tiles;
//   `halfSize`: how far it reaches from its middle to each side, in tiles, for walking into things; `mass`: how hard
//   it pulls on a rope, against a player's 1.
// - `foods`: what it eats from a feed box, by item key, or "#tag" for every item with that tag.
// - `herd`: how many come together when a herd is spawned; `spawnWeight`: how often this kind is picked.
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

export type AnimalDef = {
  kind: string
  id: number
  name: string
  hp: number
  // Units a tick.
  speed: number
  size: number
  // Units.
  halfSize: number
  mass: number
  foods: ReadonlySet<ItemId>
  herd: readonly [number, number]
  spawnWeight: number
  drops: readonly AnimalDrop[]
  milk?: ItemId
  lays?: ItemId
  life: AnimalLife
  stats: readonly StatDef[]
}

export const ANIMALS: readonly AnimalDef[] = parseAnimals(animalsData)

function parseAnimals(data: unknown): AnimalDef[] {
  if (typeof data !== 'object' || data === null) throw new Error('data/animals.json must be an object of animals.')
  return Object.entries(data).map(([kind, raw]: [string, Record<string, unknown>]): AnimalDef => {
    const fail = (problem: string): never => {
      throw new Error(`data/animals.json, ${kind}: ${problem}`)
    }
    const num = (value: unknown, name: string, min = 0): number =>
      typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fail(`"${name}" must be a number, ${min} or more`)
    const item = (key: unknown): ItemId => {
      const found = typeof key === 'string' ? itemByKey(key) : undefined
      return found ? found.id : fail(`there is no item "${String(key)}"`)
    }
    if (typeof raw.name !== 'string') fail('"name" must be text')
    const foods = new Set<ItemId>()
    if (!Array.isArray(raw.foods)) fail('"foods" must be a list')
    for (const food of raw.foods as unknown[]) {
      if (typeof food === 'string' && food.startsWith('#')) {
        const tag = food.slice(1)
        // Every item with the tag (see `tags` in items.json).
        for (const candidate of ITEMS) if (candidate.tags.includes(tag)) foods.add(candidate.id)
      } else foods.add(item(food))
    }
    const herd = raw.herd as number[]
    if (!Array.isArray(herd) || herd.length !== 2 || !(herd[0] >= 1) || !(herd[1] >= herd[0])) fail('"herd" must be [fewest, most]')
    const stats = Object.entries((raw.stats ?? {}) as Record<string, Record<string, unknown>>).map(([key, stat]) => ({
      key,
      label: typeof stat.label === 'string' ? stat.label : key,
      base: num(stat.base, `stats.${key}.base`),
      spread: num(stat.spread, `stats.${key}.spread`),
      min: num(stat.min, `stats.${key}.min`),
      max: num(stat.max, `stats.${key}.max`),
    }))
    if (!stats.some((stat) => stat.key === 'growth')) fail('every animal needs a "growth" stat')
    const statIndex = (key: unknown): number => {
      const index = stats.findIndex((stat) => stat.key === key)
      return index >= 0 ? index : fail(`there is no stat "${String(key)}"`)
    }
    const drops = ((raw.drops ?? []) as Array<Record<string, unknown>>).map((drop) => ({
      item: item(drop.item),
      ...(drop.stat !== undefined ? { stat: statIndex(drop.stat) } : {}),
      min: drop.min === undefined ? 1 : num(drop.min, 'drops.min'),
      max: drop.max === undefined ? 1 : num(drop.max, 'drops.max'),
    }))
    const life = (raw.life ?? {}) as Record<string, unknown>
    const minutes = (name: string, fallback: number): number => Math.max(1, Math.round(num(life[name] ?? fallback, `life.${name}`) * 60 * TPS))
    const percent = (name: string, fallback: number): number => Math.round((num(life[name] ?? fallback, `life.${name}`) * HUNGER_MAX) / 100)
    if (raw.milk !== undefined) statIndex('milk')
    if (raw.lays !== undefined) statIndex('eggTime')
    return {
      kind,
      id: num(raw.id, 'id', 1),
      name: raw.name as string,
      hp: num(raw.hp, 'hp', 1),
      speed: Math.max(1, Math.round((num(raw.speed, 'speed') * SUB) / TPS)),
      size: num(raw.size, 'size'),
      halfSize: Math.round(num(raw.halfSize, 'halfSize') * SUB),
      mass: num(raw.mass, 'mass'),
      foods,
      herd: [herd[0], herd[1]] as const,
      spawnWeight: num(raw.spawnWeight ?? 1, 'spawnWeight'),
      drops,
      ...(raw.milk !== undefined ? { milk: item(raw.milk) } : {}),
      ...(raw.lays !== undefined ? { lays: item(raw.lays) } : {}),
      life: {
        hungerEvery: Math.max(1, Math.round(minutes('hungerMinutes', 10) / HUNGER_MAX)),
        hungryAt: percent('hungryAt', 40),
        grassFills: percent('grassFills', 35),
        grassRadius: num(life.grassRadius ?? 12, 'life.grassRadius'),
        wellFed: minutes('wellFedMinutes', 5),
        breedCooldown: minutes('breedCooldownMinutes', 10),
        milkEvery: minutes('milkMinutes', 3),
      },
      stats,
    }
  })
}

export function animalDef(kind: string): AnimalDef {
  const def = ANIMALS.find((candidate) => candidate.kind === kind)
  if (!def) throw new Error(`There is no animal ${kind}.`)
  return def
}

// The index of a stat in an animal's stats, or -1.
export function statIndex(def: AnimalDef, key: string): number {
  return def.stats.findIndex((stat) => stat.key === key)
}

// What a page is told about an animal, on the log, whenever any of it changes. `stats` are in the order of the kind's
// stats in animals.json. `growth` is how grown up it is, in percent (100 is an adult); `hunger` in percent too.
// `leader` is the player leading it on a rope, or 0.
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
  milk: number
  // What it is doing, in a few words (for the debug view).
  doing: string
}

// Where an animal is, in units, as it is sent with the players' positions: [id, x, y].
export type AnimalPosition = [number, number, number]

// How a rope between a player and an animal pulls them, when it is stretched past LEAD_LENGTH: each moves towards the
// other by its share of the stretch, the lighter one more. Gives how far each moves, in units (undefined while it is
// slack).
export function ropePull(
  player: { x: number; y: number },
  animal: { x: number; y: number },
  animalMass: number,
): { player: { dx: number; dy: number }; animal: { dx: number; dy: number } } | undefined {
  const dx = animal.x - player.x
  const dy = animal.y - player.y
  const distance = Math.hypot(dx, dy)
  if (distance <= LEAD_LENGTH || distance === 0) return undefined
  const stretch = distance - LEAD_LENGTH
  const total = PLAYER_MASS + animalMass
  const ux = dx / distance
  const uy = dy / distance
  const playerShare = (stretch * animalMass) / total
  const animalShare = (stretch * PLAYER_MASS) / total
  return {
    player: { dx: Math.round(ux * playerShare), dy: Math.round(uy * playerShare) },
    animal: { dx: -Math.round(ux * animalShare), dy: -Math.round(uy * animalShare) },
  }
}
