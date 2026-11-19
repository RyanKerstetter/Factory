import { TPS } from './constants.ts'
import type { Inventory } from './inventory.ts'
import stationsData from '../../../data/stations.json' with { type: 'json' }
import { getItem, itemByKey, ITEMS, stackLimit, type ItemId } from './items.ts'
import { hashInts } from './rng.ts'

// The campfire, the barrel and the drying rack: what they do each tick, in the simulation (so the same everywhere).

// ---- heat

// Heat goes from 0 to HEAT_MAX. A lit campfire climbs HEAT_RISE a tick towards the heat its fuel can reach (`fuel.heat`
// in items.json: charcoal burns hotter than wood), and falls HEAT_FALL a tick when it is out or burning something
// cooler. Barrels and drying racks take heat from a campfire beside them (all of it), or one tile further (half). From
// a fire in their own chunk they take it every tick; from one over a chunk's edge (`border`), the server works it out
// every BORDER_HEAT_EVERY ticks and sends it, rounded down to BORDER_HEAT_STEP, when it changes (a page may not have the
// other chunk to work it out from).
export const HEAT_MAX = 1000
const HEAT_RISE = 2
const HEAT_FALL = 1
export const BORDER_HEAT_STEP = 25
export const BORDER_HEAT_EVERY = 10

// What a building beside a fire gets of its heat, by how far it is (in tiles, the larger of across and down).
export function heatFrom(fireHeat: number, distance: number): number {
  if (distance <= 1) return fireHeat
  if (distance === 2) return Math.floor(fireHeat / 2)
  return 0
}

// ---- the campfire

// Its slots: fuel; something to cook; what it has cooked; the charcoal its logs leave.
export const CAMPFIRE_FUEL = 0
export const CAMPFIRE_COOK = 1
export const CAMPFIRE_COOKED = 2
export const CAMPFIRE_CHARCOAL = 3
export const CAMPFIRE_SLOTS = 4
// Each log burnt leaves charcoal one time in CHARCOAL_ODDS.
const CHARCOAL_ODDS = 4

export type Campfire = {
  id: number
  inv: Inventory
  // Whether it is alight; the ticks left of what it is burning, and the heat that can reach; its heat now; how far it
  // is through cooking (in heat-ticks); how many logs it has burnt (for picking which leave charcoal).
  lit: number
  burn: number
  target: number
  heat: number
  cook: number
  burnt: number
}

export function stepCampfire(fire: Campfire): void {
  if (fire.lit) {
    if (fire.burn <= 0) {
      const fuel = fire.inv.slots[CAMPFIRE_FUEL]
      const def = fuel.count > 0 ? getItem(fuel.item) : undefined
      if (def?.fuel) {
        fuel.count--
        if (fuel.count === 0) fuel.item = 0
        fire.burn = def.fuel.ticks
        fire.target = def.fuel.heat
        if (def.key === 'log') {
          fire.burnt++
          if (hashInts(fire.id, fire.burnt, 77) % CHARCOAL_ODDS === 0) putIn(fire.inv, CAMPFIRE_CHARCOAL, itemOf('charcoal'), 1)
        }
      } else {
        fire.lit = 0
        fire.target = 0
      }
    }
    if (fire.lit) fire.burn--
  }
  if (fire.lit && fire.heat < fire.target) fire.heat = Math.min(fire.target, fire.heat + HEAT_RISE)
  else if (fire.heat > (fire.lit ? fire.target : 0)) fire.heat = Math.max(fire.lit ? fire.target : 0, fire.heat - HEAT_FALL)

  // Cooking: the fire has to be hot enough, and the hotter it is the quicker it goes.
  const raw = fire.inv.slots[CAMPFIRE_COOK]
  const cooks = raw.count > 0 ? getItem(raw.item).cooks : undefined
  const into = cooks ? itemOf(cooks.into) : 0
  if (!cooks || fire.heat < cooks.heat || !fits(fire.inv, CAMPFIRE_COOKED, into)) {
    if (!cooks) fire.cook = 0
    return
  }
  fire.cook += fire.heat
  if (fire.cook < cooks.heat * cooks.ticks) return
  fire.cook = 0
  raw.count--
  if (raw.count === 0) raw.item = 0
  putIn(fire.inv, CAMPFIRE_COOKED, into, 1)
}

// How far through cooking what is on it the fire is, 0 to 1.
export function cookFraction(fire: Campfire): number {
  const raw = fire.inv.slots[CAMPFIRE_COOK]
  const cooks = raw.count > 0 ? getItem(raw.item).cooks : undefined
  return cooks ? Math.min(1, fire.cook / (cooks.heat * cooks.ticks)) : 0
}

// ---- the drying rack

// Its slots: one thing drying; what it has dried.
export const RACK_INPUT = 0
export const RACK_OUTPUT = 1
export const RACK_SLOTS = 2

// What a drying rack dries, from data/stations.json ("rack"): one `input` at a time becomes `output`, taking `seconds`
// cold, and as fast again for every `heatDouble` of heat from a campfire beside it.
export type RackRecipe = { index: number; input: ItemId; output: ItemId; ticks: number; heatDouble: number }

// A barrel's recipes, from data/stations.json ("barrel"). The first whose ingredients are in it (its liquid, and at
// least one of each solid) is what it works on, once it has all it needs (and is sealed, if the recipe says so):
// - `sealed`: whether it has to be sealed (true unless it says false); `dry`: whether it needs no liquid in it at all;
// - `liquid`: the liquid it needs (by name: what a bucket item holds, see `bucket` in items.json), at least
//   `liquidMin` buckets of it (or `liquidUse`);
// - `solids`: how many of each solid it takes ("#tag" for any item with that tag); `perBucket`: as many of each for
//   every bucket of liquid in it; `liquidPerSolid`: instead, it works on every one of its (first) solid in it at once,
//   using this many buckets of the liquid for each (and not starting without enough for them all), and makes `count`
//   for each;
// - `heat`: how hot it has to be kept, by a campfire beside it;
// - what it makes: `output` (`count` of it) into its out slot; the liquid turned into `liquidInto`; `liquidUse` buckets
//   of the liquid used up;
// - `seconds`: how long it takes.
export type Match = ItemId | `#${string}`
export type BarrelRecipe = {
  index: number
  category: string
  liquid: number
  liquidMin: number
  liquidUse: number
  liquidInto: number
  liquidPerSolid: number
  sealed: boolean
  dry: boolean
  solids: ReadonlyArray<readonly [Match, number]>
  perBucket: ReadonlyArray<readonly [Match, number]>
  heat: number
  output: ItemId
  count: number
  ticks: number
}

// The liquids: what the bucket items hold (see `bucket` in items.json), in the order they first come there. A barrel
// keeps its liquid as its number here (0 for none).
export const LIQUIDS: readonly string[] = ['', ...new Set(ITEMS.flatMap((item) => (item.bucket && item.bucket !== 'empty' ? [item.bucket] : [])))]
export const LIQUID_NONE = 0
export const LIQUID_WATER = LIQUIDS.indexOf('water')
export const LIQUID_TANNIN = LIQUIDS.indexOf('tannin')

// The bucket that holds a liquid, and the liquid a bucket holds (0 for an empty one, or anything else).
export function bucketFor(liquid: number): ItemId {
  return ITEMS.find((item) => item.bucket === LIQUIDS[liquid])?.id ?? 0
}
export function liquidIn(item: ItemId): number {
  const bucket = getItem(item).bucket
  return bucket && bucket !== 'empty' ? LIQUIDS.indexOf(bucket) : 0
}

const whole = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min

function itemOrFail(key: unknown, fail: (problem: string) => never): ItemId {
  const found = typeof key === 'string' ? itemByKey(key) : undefined
  return found ? found.id : fail(`there is no item "${String(key)}"`)
}

function wholeOr(value: unknown, fallback: number, min: number, what: string, fail: (problem: string) => never): number {
  const got = value ?? fallback
  return whole(got, min) ? got : fail(`"${what}" must be a whole number, ${min} or more`)
}

function secondsOf(value: unknown, fail: (problem: string) => never): number {
  return typeof value === 'number' && value > 0 ? Math.max(1, Math.round(value * TPS)) : fail('"seconds" must be a number above 0')
}

const stationLists = stationsData as Record<string, unknown>

export const RACK_RECIPES: readonly RackRecipe[] = ((stationLists.rack ?? []) as Array<Record<string, unknown>>).map((raw, index) => {
  const fail = (problem: string): never => {
    throw new Error(`data/stations.json, rack recipe ${index + 1}: ${problem}`)
  }
  return {
    index,
    input: itemOrFail(raw.input, fail),
    output: itemOrFail(raw.output, fail),
    ticks: secondsOf(raw.seconds, fail),
    heatDouble: wholeOr(raw.heatDouble, 100, 1, 'heatDouble', fail),
  }
})

export const BARREL_RECIPES: readonly BarrelRecipe[] = ((stationLists.barrel ?? []) as Array<Record<string, unknown>>).map((raw, index): BarrelRecipe => {
  const fail = (problem: string): never => {
    throw new Error(`data/stations.json, barrel recipe ${index + 1}: ${problem}`)
  }
  const liquid = (name: unknown): number => {
    if (name === undefined) return 0
    const found = LIQUIDS.indexOf(name as string)
    return found > 0 ? found : fail(`there is no liquid "${String(name)}" (a liquid is what a bucket item holds)`)
  }
  const ingredients = (list: unknown): Array<readonly [Match, number]> =>
    Object.entries((list ?? {}) as Record<string, unknown>).map(([key, n]) => {
      if (!whole(n, 1)) fail(`needs a whole number above 0 of ${key}`)
      return [key.startsWith('#') ? (key as Match) : itemOrFail(key, fail), n as number] as const
    })
  const liquidUse = wholeOr(raw.liquidUse, 0, 0, 'liquidUse', fail)
  const recipe: BarrelRecipe = {
    index,
    category: typeof raw.category === 'string' ? raw.category : 'Sealed',
    liquid: liquid(raw.liquid),
    liquidMin: wholeOr(raw.liquidMin, Math.max(1, liquidUse), 1, 'liquidMin', fail),
    liquidUse,
    liquidInto: liquid(raw.liquidInto),
    liquidPerSolid: wholeOr(raw.liquidPerSolid, 0, 0, 'liquidPerSolid', fail),
    sealed: raw.sealed !== false,
    dry: raw.dry === true,
    solids: ingredients(raw.solids),
    perBucket: ingredients(raw.perBucket),
    heat: wholeOr(raw.heat, 0, 0, 'heat', fail),
    output: raw.output === undefined ? 0 : itemOrFail(raw.output, fail),
    count: wholeOr(raw.count, 1, 1, 'count', fail),
    ticks: secondsOf(raw.seconds, fail),
  }
  if (recipe.liquid === 0 && (recipe.perBucket.length > 0 || recipe.liquidInto || recipe.liquidUse)) fail('only a recipe with a "liquid" can use buckets of it')
  if (recipe.liquid === 0 && recipe.solids.length === 0) fail('it needs something to work on')
  if (recipe.liquidPerSolid > 0 && (recipe.liquid === 0 || recipe.solids.length === 0)) fail('"liquidPerSolid" needs a "liquid" and a solid')
  if (recipe.dry && recipe.liquid !== 0) fail('a "dry" recipe cannot need a liquid')
  return recipe
})

// Whether an item is what an ingredient names (an item, or "#tag" for any item with the tag).
export function matches(match: Match, item: ItemId): boolean {
  return typeof match === 'string' ? getItem(item).tags.includes(match.slice(1)) : match === item
}

// Words for an ingredient, for a barrel's panel.
export function matchName(match: Match, plural = false): string {
  if (typeof match === 'string') return `${match.slice(1)} thing${plural ? 's' : ''}`
  const name = getItem(match).name.toLowerCase()
  return plural && !name.endsWith('s') ? `${name}s` : name
}

export type Rack = { inv: Inventory; progress: number; heat: number }

// The recipe a rack dries an item with.
export function rackRecipe(item: ItemId): RackRecipe | undefined {
  return RACK_RECIPES.find((recipe) => recipe.input === item)
}

export function stepRack(rack: Rack): void {
  const hide = rack.inv.slots[RACK_INPUT]
  const recipe = hide.count > 0 ? rackRecipe(hide.item) : undefined
  if (!recipe || !fits(rack.inv, RACK_OUTPUT, recipe.output)) {
    rack.progress = 0
    return
  }
  rack.progress += 100 + Math.floor((rack.heat * 100) / recipe.heatDouble)
  if (rack.progress < 100 * recipe.ticks) return
  rack.progress = 0
  hide.count--
  if (hide.count === 0) hide.item = 0
  putIn(rack.inv, RACK_OUTPUT, recipe.output, 1)
}

export function rackFraction(rack: Rack): number {
  const hide = rack.inv.slots[RACK_INPUT]
  const recipe = hide.count > 0 ? rackRecipe(hide.item) : undefined
  return recipe ? Math.min(1, rack.progress / (100 * recipe.ticks)) : 0
}

// ---- the barrel

// It holds up to BARREL_CAPACITY buckets of one liquid, and solids in three slots, with a fourth for what it makes.
export const BARREL_SOLIDS: readonly number[] = [0, 1, 2]
export const BARREL_OUTPUT = 3
export const BARREL_SLOTS = 4
export const BARREL_CAPACITY = 8

// `process` is the recipe it is working on, plus one (0 for none).
export type Barrel = { inv: Inventory; liquid: number; amount: number; sealed: number; process: number; progress: number; heat: number }

function solidsOf(barrel: Barrel, match: Match): number {
  let total = 0
  for (const i of BARREL_SOLIDS) {
    const slot = barrel.inv.slots[i]
    if (slot.count > 0 && matches(match, slot.item)) total += slot.count
  }
  return total
}

// What a barrel would be working on (the recipe), whether it is (`ready`), and if not, why not, in words for its panel.
export function barrelPlan(barrel: Barrel): { recipe?: BarrelRecipe; ready: boolean; reason: string } {
  const recipe = BARREL_RECIPES.find(
    (candidate) =>
      (candidate.liquid === 0 || (barrel.liquid === candidate.liquid && barrel.amount > 0)) &&
      (!candidate.dry || barrel.amount === 0) &&
      [...candidate.solids, ...candidate.perBucket].every(([match]) => solidsOf(barrel, match) > 0),
  )
  if (!recipe) return { ready: false, reason: 'Nothing to work on: see the recipes at the side.' }
  const notStarted = (why: string): { recipe: BarrelRecipe; ready: boolean; reason: string } => ({ recipe, ready: false, reason: `Not started: ${why}` })
  if (recipe.liquidPerSolid > 0) {
    const lots = batchOf(barrel, recipe)
    if (barrel.amount < lots * recipe.liquidPerSolid) return notStarted(`${lots} need ${lots * recipe.liquidPerSolid} buckets of ${LIQUIDS[recipe.liquid]}.`)
    if (!fits(barrel.inv, BARREL_OUTPUT, recipe.output, lots * recipe.count)) return notStarted('take out what it made first.')
  } else if (recipe.liquid && barrel.amount < recipe.liquidMin) {
    return notStarted(`it needs ${recipe.liquidMin} buckets of ${LIQUIDS[recipe.liquid]} (${barrel.amount} in).`)
  }
  for (const [match, need] of recipe.solids) {
    const have = solidsOf(barrel, match)
    if (have < need) return notStarted(`it needs ${need} ${matchName(match, need > 1)} (${have} in).`)
  }
  for (const [match, per] of recipe.perBucket) {
    const have = solidsOf(barrel, match)
    const need = per * barrel.amount
    if (have < need) return notStarted(`${barrel.amount} buckets of ${LIQUIDS[recipe.liquid]} need ${need} ${matchName(match, need > 1)} (${have} in).`)
  }
  if (recipe.output && !fits(barrel.inv, BARREL_OUTPUT, recipe.output)) return notStarted('take out what it made first.')
  if (recipe.sealed && !barrel.sealed) return notStarted('seal the barrel to start.')
  if (barrel.heat < recipe.heat) return { recipe, ready: false, reason: `Not hot enough: put it beside a lit campfire (heat ${barrel.heat}/${recipe.heat}).` }
  return { recipe, ready: true, reason: `Making ${recipe.output ? getItem(recipe.output).name.toLowerCase() : LIQUIDS[recipe.liquidInto]}…` }
}

// How many lots a `liquidPerSolid` recipe works on at once: every one of its first solid in the barrel.
function batchOf(barrel: Barrel, recipe: BarrelRecipe): number {
  return recipe.liquidPerSolid > 0 ? Math.floor(solidsOf(barrel, recipe.solids[0][0]) / recipe.solids[0][1]) : 1
}

// What a barrel is working on, as a number: its recipe's (plus one; 0 for none), and, for a recipe that works on all of
// a solid at once, how many lots (so putting more in starts it again).
function processCode(barrel: Barrel, recipe: BarrelRecipe | undefined): number {
  return recipe ? recipe.index + 1 + 1000 * (recipe.liquidPerSolid > 0 ? batchOf(barrel, recipe) : 0) : 0
}

export function stepBarrel(barrel: Barrel): void {
  const plan = barrelPlan(barrel)
  const code = processCode(barrel, plan.recipe)
  if (barrel.process !== code) {
    barrel.process = code
    barrel.progress = 0
  }
  if (!plan.ready || !plan.recipe) return
  const recipe = plan.recipe
  barrel.progress++
  if (barrel.progress < recipe.ticks) return
  barrel.progress = 0
  const lots = batchOf(barrel, recipe)
  for (const [match, need] of recipe.solids) takeSolids(barrel, match, need * lots)
  for (const [match, per] of recipe.perBucket) takeSolids(barrel, match, per * barrel.amount)
  if (recipe.output) putIn(barrel.inv, BARREL_OUTPUT, recipe.output, recipe.count * lots)
  if (recipe.liquidInto) barrel.liquid = recipe.liquidInto
  const used = recipe.liquidPerSolid > 0 ? recipe.liquidPerSolid * lots : recipe.liquidUse
  if (used) {
    barrel.amount = Math.max(0, barrel.amount - used)
    if (barrel.amount === 0) barrel.liquid = LIQUID_NONE
  }
}

export function barrelFraction(barrel: Barrel): number {
  const recipe = BARREL_RECIPES[(barrel.process % 1000) - 1]
  return recipe ? Math.min(1, barrel.progress / recipe.ticks) : 0
}

export function isOrganic(item: ItemId): boolean {
  return getItem(item).tags.includes('organic')
}

function takeSolids(barrel: Barrel, match: Match, count: number): void {
  let left = count
  for (const i of BARREL_SOLIDS) {
    const slot = barrel.inv.slots[i]
    if (left === 0 || slot.count === 0 || !matches(match, slot.item)) continue
    const taken = Math.min(left, slot.count)
    slot.count -= taken
    left -= taken
    if (slot.count === 0) slot.item = 0
  }
}

// ---- slots

// Whether one more of an item fits in a slot.
// Whether `count` more of an item fit in a slot.
function fits(inv: Inventory, index: number, item: ItemId, count = 1): boolean {
  const slot = inv.slots[index]
  return (slot.count === 0 || slot.item === item) && slot.count + count <= stackLimit(item, inv.stack)
}

function putIn(inv: Inventory, index: number, item: ItemId, count: number): void {
  if (!fits(inv, index, item, count)) return
  const slot = inv.slots[index]
  slot.item = item
  slot.count += count
}

const ids = new Map<string, ItemId>()
function itemOf(key: string): ItemId {
  let id = ids.get(key)
  if (id === undefined) {
    id = itemByKey(key)?.id ?? 0
    ids.set(key, id)
  }
  return id
}
