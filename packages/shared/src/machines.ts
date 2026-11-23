import stationsData from '../../../data/stations.json' with { type: 'json' }
import { TPS } from './constants.ts'
import { failIn, fieldsOf, onlyFields, secondsField, textField, wholeField, type Fail } from './data-check.ts'
import { countIn, fitsIn, putIn, takeFromSlot, takeIn, type Inventory } from './inventory.ts'
import type { FireKind } from './buildings.ts'
import { getItem, itemFromKey, itemId, ITEMS, matches, matchesOf, matchName, type ItemId, type Match } from './items.ts'
import { hashInts } from './rng.ts'

// The campfire (and the oven), the barrel and the drying rack: what they do each tick, in the simulation (so the same everywhere).

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

// ---- the campfire, and the oven

// The oven is a campfire of stone: it burns the same, but cooks OVEN_COOK_SPEED times as fast, and cooks what only an
// oven can (its own recipes: dough into bread).
export const OVEN_COOK_SPEED = 2

// What a fire cooks, from data/stations.json: the campfire's list is "fire"; the oven is a station of its own, "oven",
// `{ "includes": ["fire"], "recipes": [...] }`: its own recipes and everything a campfire cooks besides. One `input` at a
// time in its cook slot becomes `into`, once the fire is at least `heat`, taking `ticks` at that heat (quicker the
// hotter it is; an oven quicker still). `oven`: an oven's own (only an oven cooks it).
export type FireRecipe = { index: number; input: ItemId; into: ItemId; heat: number; ticks: number; oven: boolean }

// What a fire of a kind cooks (an oven its own recipes first, then the campfire's).
export function fireRecipes(kind: FireKind): readonly FireRecipe[] {
  return kind === 'oven' ? OVEN_RECIPES : CAMPFIRE_RECIPES
}

// What a fire of a kind cooks an item into, if it can.
export function cookingOf(item: ItemId, kind: FireKind): FireRecipe | undefined {
  return fireRecipes(kind).find((recipe) => recipe.input === item)
}

// Its slots: fuel; something to cook; what it has cooked; the charcoal its logs leave.
export const CAMPFIRE_FUEL = 0
export const CAMPFIRE_COOK = 1
export const CAMPFIRE_COOKED = 2
export const CAMPFIRE_CHARCOAL = 3
export const CAMPFIRE_SLOTS = 4
// Each log burnt leaves charcoal one time in CHARCOAL_ODDS.
const CHARCOAL_ODDS = 4
const LOG = itemId('log')
const CHARCOAL = itemId('charcoal')
// How long each fuel burns, by the heat it burns at (each burns at a heat of its own: see `fuel` in items.json).
const BURN_TICKS = new Map(ITEMS.flatMap((item) => (item.fuel ? [[item.fuel.heat, item.fuel.ticks] as const] : [])))

export type Campfire = {
  id: number
  kind: FireKind
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

// How much is left of what a campfire is burning, 1 when it has just caught to 0 when it is burnt out (each fuel burns
// at a heat of its own, so its target heat says which it is).
export function burnFraction(fire: Pick<Campfire, 'burn' | 'target'>): number {
  if (fire.burn <= 0) return 0
  const ticks = BURN_TICKS.get(fire.target)
  return ticks ? Math.min(1, fire.burn / ticks) : 1
}

export function stepCampfire(fire: Campfire): void {
  if (fire.lit) {
    if (fire.burn <= 0) {
      const fuel = fire.inv.slots[CAMPFIRE_FUEL]
      const def = fuel.count > 0 ? getItem(fuel.item) : undefined
      if (def?.fuel) {
        takeFromSlot(fire.inv, CAMPFIRE_FUEL, 1)
        fire.burn = def.fuel.ticks
        fire.target = def.fuel.heat
        if (def.id === LOG) {
          fire.burnt++
          if (hashInts(fire.id, fire.burnt, 77) % CHARCOAL_ODDS === 0) putIn(fire.inv, CAMPFIRE_CHARCOAL, CHARCOAL, 1)
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
  const cooks = raw.count > 0 ? cookingOf(raw.item, fire.kind) : undefined
  if (!cooks || fire.heat < cooks.heat || !fitsIn(fire.inv, CAMPFIRE_COOKED, cooks.into)) {
    if (!cooks) fire.cook = 0
    return
  }
  fire.cook += fire.heat * (fire.kind === 'oven' ? OVEN_COOK_SPEED : 1)
  if (fire.cook < cooks.heat * cooks.ticks) return
  fire.cook = 0
  takeFromSlot(fire.inv, CAMPFIRE_COOK, 1)
  putIn(fire.inv, CAMPFIRE_COOKED, cooks.into, 1)
}

// How far through cooking what is on it the fire is, 0 to 1.
export function cookFraction(fire: Campfire): number {
  const raw = fire.inv.slots[CAMPFIRE_COOK]
  const cooks = raw.count > 0 ? cookingOf(raw.item, fire.kind) : undefined
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
//   of the liquid used up; `liquidOut`: instead of an item, `count` buckets of this liquid, made from its solids alone
//   (only in a barrel with no other liquid in it, and room for them: meat into blood);
// - `seconds`: how long it takes.
export type BarrelRecipe = {
  index: number
  category: string
  liquid: number
  liquidMin: number
  liquidUse: number
  liquidInto: number
  liquidOut: number
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

const stationLists = stationsData as Record<string, unknown>

// A list of fire recipes, numbered on from `first` (so the campfire's and the oven's own never share a number).
function fireList(list: unknown[], station: string, first: number, oven: boolean): FireRecipe[] {
  return list.map((entry, i) => {
    const fail = failIn(`data/stations.json, ${station} recipe ${i + 1}`)
    const raw = fieldsOf(entry, 'it', fail)
    onlyFields(raw, ['input', 'output', 'heat', 'seconds'], fail)
    return {
      index: first + i,
      input: itemFromKey(raw.input, fail),
      into: itemFromKey(raw.output, fail),
      heat: wholeField(raw, 'heat', fail),
      ticks: secondsField(raw, 'seconds', fail),
      oven,
    }
  })
}
const CAMPFIRE_RECIPES: readonly FireRecipe[] = fireList(listOf('fire'), 'fire', 0, false)
const OVEN_RECIPES: readonly FireRecipe[] = (() => {
  const fail = failIn('data/stations.json, oven')
  const raw = fieldsOf(stationLists.oven ?? { recipes: [] }, 'it', fail)
  onlyFields(raw, ['includes', 'recipes'], fail)
  const includes = raw.includes ?? []
  if (!Array.isArray(includes) || !includes.every((name) => name === 'fire')) fail('"includes" can only be ["fire"]')
  if (!Array.isArray(raw.recipes)) fail('"recipes" must be a list of recipes')
  const own = fireList(raw.recipes as unknown[], 'oven', CAMPFIRE_RECIPES.length, true)
  // Its own first, then the campfire's it has no recipe of its own for.
  const included = (includes as unknown[]).length > 0 ? CAMPFIRE_RECIPES.filter((recipe) => !own.some((mine) => mine.input === recipe.input)) : []
  return [...own, ...included]
})()

export const RACK_RECIPES: readonly RackRecipe[] = listOf('rack').map((entry, index) => {
  const fail = failIn(`data/stations.json, rack recipe ${index + 1}`)
  const raw = fieldsOf(entry, 'it', fail)
  onlyFields(raw, ['input', 'output', 'seconds', 'heatDouble'], fail)
  return {
    index,
    input: itemFromKey(raw.input, fail),
    output: itemFromKey(raw.output, fail),
    ticks: secondsField(raw, 'seconds', fail),
    heatDouble: wholeField(raw, 'heatDouble', fail, 1, 100),
  }
})

const BARREL_FIELDS = ['category', 'liquid', 'liquidMin', 'liquidUse', 'liquidInto', 'liquidOut', 'liquidPerSolid', 'sealed', 'dry', 'solids', 'perBucket', 'heat', 'output', 'count', 'seconds']

export const BARREL_RECIPES: readonly BarrelRecipe[] = listOf('barrel').map((entry, index): BarrelRecipe => {
  const fail = failIn(`data/stations.json, barrel recipe ${index + 1}`)
  const raw = fieldsOf(entry, 'it', fail)
  onlyFields(raw, BARREL_FIELDS, fail)
  const liquidUse = wholeField(raw, 'liquidUse', fail, 0, 0)
  const recipe: BarrelRecipe = {
    index,
    category: textField(raw, 'category', fail, 'Sealed'),
    liquid: liquidOf(raw.liquid, fail),
    liquidMin: wholeField(raw, 'liquidMin', fail, 1, Math.max(1, liquidUse)),
    liquidUse,
    liquidInto: liquidOf(raw.liquidInto, fail),
    liquidOut: liquidOf(raw.liquidOut, fail),
    liquidPerSolid: wholeField(raw, 'liquidPerSolid', fail, 0, 0),
    sealed: raw.sealed !== false,
    dry: raw.dry === true,
    solids: matchesOf(raw.solids, fail),
    perBucket: matchesOf(raw.perBucket, fail),
    heat: wholeField(raw, 'heat', fail, 0, 0),
    output: raw.output === undefined ? 0 : itemFromKey(raw.output, fail),
    count: wholeField(raw, 'count', fail, 1, 1),
    ticks: secondsField(raw, 'seconds', fail),
  }
  if (recipe.liquid === 0 && (recipe.perBucket.length > 0 || recipe.liquidInto || recipe.liquidUse)) fail('only a recipe with a "liquid" can use buckets of it')
  if (recipe.liquid === 0 && recipe.solids.length === 0) fail('it needs something to work on')
  if (recipe.liquidPerSolid > 0 && (recipe.liquid === 0 || recipe.solids.length === 0)) fail('"liquidPerSolid" needs a "liquid" and a solid')
  if (recipe.dry && recipe.liquid !== 0) fail('a "dry" recipe cannot need a liquid')
  if (recipe.liquidOut && (recipe.liquid !== 0 || recipe.output || recipe.dry)) fail('a "liquidOut" recipe makes its liquid from solids alone: no "liquid", "output" or "dry"')
  return recipe
})

// A machine's list of recipes in stations.json.
function listOf(machine: 'fire' | 'rack' | 'barrel'): unknown[] {
  const list = stationLists[machine] ?? []
  if (!Array.isArray(list)) throw new Error(`data/stations.json, ${machine}: must be a list of recipes`)
  return list
}

// A liquid by its name (0 for none), failing for one no bucket holds.
function liquidOf(name: unknown, fail: Fail): number {
  if (name === undefined) return 0
  const found = LIQUIDS.indexOf(name as string)
  return found > 0 ? found : fail(`there is no liquid "${String(name)}" (a liquid is what a bucket item holds)`)
}

// A number of ticks as seconds for the player: to at most two decimals (1.33, 2, 0.8).
export function secondsText(ticks: number): string {
  return `${Math.round((ticks / TPS) * 100) / 100}`
}

// How a barrel recipe goes, for the player, in a few words: whether it works on everything in the barrel at once (one
// timer for the whole lot, `batch`) or makes one at a time (a timer each), and how often.
export function barrelHow(recipe: BarrelRecipe): { batch: boolean; text: string } {
  const batch = recipe.liquidPerSolid > 0 || recipe.liquidInto > 0
  return { batch, text: `${batch ? 'All' : '1'} every ${secondsText(recipe.ticks)} seconds` }
}

export type Rack = { inv: Inventory; progress: number; heat: number }

// The recipe a rack dries an item with.
export function rackRecipe(item: ItemId): RackRecipe | undefined {
  return RACK_RECIPES.find((recipe) => recipe.input === item)
}

export function stepRack(rack: Rack): void {
  const hide = rack.inv.slots[RACK_INPUT]
  const recipe = hide.count > 0 ? rackRecipe(hide.item) : undefined
  if (!recipe || !fitsIn(rack.inv, RACK_OUTPUT, recipe.output)) {
    rack.progress = 0
    return
  }
  rack.progress += 100 + Math.floor((rack.heat * 100) / recipe.heatDouble)
  if (rack.progress < 100 * recipe.ticks) return
  rack.progress = 0
  takeFromSlot(rack.inv, RACK_INPUT, 1)
  putIn(rack.inv, RACK_OUTPUT, recipe.output, 1)
}

export function rackFraction(rack: Rack): number {
  const hide = rack.inv.slots[RACK_INPUT]
  const recipe = hide.count > 0 ? rackRecipe(hide.item) : undefined
  return recipe ? Math.min(1, rack.progress / (100 * recipe.ticks)) : 0
}

// ---- the barrel

// It holds up to BARREL_CAPACITY buckets of one liquid, and solids in one slot, with another for what it makes.
export const BARREL_SOLIDS: readonly number[] = [0]
export const BARREL_OUTPUT = 1
export const BARREL_SLOTS = 2
export const BARREL_CAPACITY = 8

// `process` is the recipe it is working on, plus one (0 for none).
export type Barrel = { inv: Inventory; liquid: number; amount: number; sealed: number; process: number; progress: number; heat: number }

function solidsOf(barrel: Barrel, match: Match): number {
  return countIn(barrel.inv, BARREL_SOLIDS, (item) => matches(match, item))
}

// What a barrel would be working on (the recipe), whether it is (`ready`), and if not, why not, in words for its panel
// (`reason`; left empty with `words` false, as each tick of the simulation asks).
export function barrelPlan(barrel: Barrel, words = true): { recipe?: BarrelRecipe; ready: boolean; reason: string } {
  const say = (text: () => string): string => (words ? text() : '')
  const recipe = BARREL_RECIPES.find(
    (candidate) =>
      (candidate.liquid === 0 || (barrel.liquid === candidate.liquid && barrel.amount > 0)) &&
      (!candidate.dry || barrel.amount === 0) &&
      (!candidate.liquidOut || barrel.amount === 0 || barrel.liquid === candidate.liquidOut) &&
      [...candidate.solids, ...candidate.perBucket].every(([match]) => solidsOf(barrel, match) > 0),
  )
  if (!recipe) return { ready: false, reason: say(() => 'Nothing to work on: see the recipes at the side.') }
  const notStarted = (why: () => string): { recipe: BarrelRecipe; ready: boolean; reason: string } => ({ recipe, ready: false, reason: say(() => `Not started: ${why()}`) })
  if (recipe.liquidPerSolid > 0) {
    const lots = batchOf(barrel, recipe)
    if (barrel.amount < lots * recipe.liquidPerSolid) return notStarted(() => `${lots} need ${lots * recipe.liquidPerSolid} buckets of ${LIQUIDS[recipe.liquid]}.`)
    if (!fitsIn(barrel.inv, BARREL_OUTPUT, recipe.output, lots * recipe.count)) return notStarted(() => 'take out what it made first.')
  } else if (recipe.liquid && barrel.amount < recipe.liquidMin) {
    return notStarted(() => `it needs ${recipe.liquidMin} buckets of ${LIQUIDS[recipe.liquid]} (${barrel.amount} in).`)
  }
  for (const [match, need] of recipe.solids) {
    const have = solidsOf(barrel, match)
    if (have < need) return notStarted(() => `it needs ${need} ${matchName(match, need > 1)} (${have} in).`)
  }
  for (const [match, per] of recipe.perBucket) {
    const have = solidsOf(barrel, match)
    const need = per * barrel.amount
    if (have < need) return notStarted(() => `${barrel.amount} buckets of ${LIQUIDS[recipe.liquid]} need ${need} ${matchName(match, need > 1)} (${have} in).`)
  }
  if (recipe.output && !fitsIn(barrel.inv, BARREL_OUTPUT, recipe.output)) return notStarted(() => 'take out what it made first.')
  if (recipe.liquidOut && barrel.amount + recipe.count > BARREL_CAPACITY) return notStarted(() => `it is full of ${LIQUIDS[recipe.liquidOut]}: draw some off first.`)
  if (recipe.sealed && !barrel.sealed) return notStarted(() => 'seal the barrel to start.')
  if (barrel.heat < recipe.heat) return { recipe, ready: false, reason: say(() => `Not hot enough: put it beside a lit campfire (heat ${barrel.heat}/${recipe.heat}).`) }
  return { recipe, ready: true, reason: say(() => `Making ${recipe.output ? getItem(recipe.output).name.toLowerCase() : LIQUIDS[recipe.liquidOut || recipe.liquidInto]}…`) }
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
  const plan = barrelPlan(barrel, false)
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
  for (const [match, need] of recipe.solids) takeIn(barrel.inv, BARREL_SOLIDS, (item) => matches(match, item), need * lots)
  for (const [match, per] of recipe.perBucket) takeIn(barrel.inv, BARREL_SOLIDS, (item) => matches(match, item), per * barrel.amount)
  if (recipe.output) putIn(barrel.inv, BARREL_OUTPUT, recipe.output, recipe.count * lots)
  if (recipe.liquidInto) barrel.liquid = recipe.liquidInto
  if (recipe.liquidOut) {
    barrel.liquid = recipe.liquidOut
    barrel.amount = Math.min(BARREL_CAPACITY, barrel.amount + recipe.count * lots)
  }
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
