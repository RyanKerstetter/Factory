import stationsData from '../../../data/stations.json' with { type: 'json' }
import { TPS } from './constants.ts'
import { failIn, fieldsOf, onlyFields, secondsField, wholeField } from './data-check.ts'
import { fitsIn, putIn, type Inventory } from './inventory.ts'
import { itemFromKey, matches, matchesOf, type ItemId, type Match } from './items.ts'
import { LIQUIDS } from './machines.ts'

// The altar's rituals. An altar draws what a ritual takes from the pedestals round it (in the 5 × 5 square on it,
// ALTAR_REACH tiles each way) and the liquid it takes from the barrels there. The player picks a ritual at the altar
// and presses Craft: if everything is there, the server takes it all at once (so nothing can be taken back halfway) and
// writes down on the altar what came from where (its offerings), and the altar works through the ritual on its own,
// `seconds` long, putting what it makes in its slot at the end. The offerings are only for showing it: the page draws
// each pedestal's item drawn in to the altar on a beam, one after another, then the liquid from each barrel, and the
// burst at the end (see ritual-effects.ts in the client).
//
// The rituals are "altar" in data/stations.json: `inputs` (items, or "#tag" for any item with the tag), `liquids` (by
// name, as a bucket item holds it, and how many buckets), what it makes (`output`, `count`), and `seconds`.

export const ALTAR_REACH = 2
// How long the altar glows after a ritual (ticks), for the burst at its end.
export const ALTAR_GLOW_TICKS = Math.round(1.5 * TPS)

export type AltarRecipe = {
  // Its place in the list (what a `work` command at an altar names).
  index: number
  inputs: ReadonlyArray<readonly [Match, number]>
  // Each liquid (its number in LIQUIDS) and how many buckets of it.
  liquids: ReadonlyArray<readonly [number, number]>
  output: ItemId
  count: number
  ticks: number
}

export const ALTAR_RECIPES: readonly AltarRecipe[] = (() => {
  const list = (stationsData as Record<string, unknown>).altar ?? []
  if (!Array.isArray(list)) throw new Error('data/stations.json, altar: must be a list of rituals')
  return list.map((entry, index): AltarRecipe => {
    const fail = failIn(`data/stations.json, altar ritual ${index + 1}`)
    const raw = fieldsOf(entry, 'it', fail)
    onlyFields(raw, ['inputs', 'liquids', 'output', 'count', 'seconds'], fail)
    const liquidsRaw = raw.liquids === undefined ? {} : fieldsOf(raw.liquids, '"liquids"', fail)
    const liquids = Object.keys(liquidsRaw).map((name) => {
      const liquid = LIQUIDS.indexOf(name)
      if (liquid <= 0) fail(`there is no liquid "${name}" (a liquid is what a bucket item holds)`)
      return [liquid, wholeField(liquidsRaw, name, fail, 1)] as const
    })
    const inputs = matchesOf(raw.inputs, fail)
    if (inputs.length === 0 && liquids.length === 0) fail('it needs something to take')
    return {
      index,
      inputs,
      liquids,
      output: itemFromKey(raw.output, fail),
      count: wholeField(raw, 'count', fail, 1, 1),
      ticks: secondsField(raw, 'seconds', fail),
    }
  })
})()

// ---- the offerings

// What a ritual took, and from where: kept on the altar as a flat list of numbers, OFFERING_SIZE to each: where it came
// from (across and down from the altar), what (an item's number, or minus a liquid's), and how many (buckets, for a
// liquid).
export const OFFERING_SIZE = 4
export type Offering = { dx: number; dy: number; item: ItemId; liquid: number; count: number }

export function offeringsOf(flat: readonly number[]): Offering[] {
  const list: Offering[] = []
  for (let i = 0; i + OFFERING_SIZE <= flat.length; i += OFFERING_SIZE) {
    const [dx, dy, what, count] = flat.slice(i, i + OFFERING_SIZE)
    if (count <= 0 || what === 0) continue
    list.push({ dx, dy, item: what > 0 ? what : 0, liquid: what < 0 ? -what : 0, count })
  }
  return list
}

export function flatOfferings(list: readonly Offering[]): number[] {
  return list.flatMap((offering) => [offering.dx, offering.dy, offering.liquid ? -offering.liquid : offering.item, offering.count])
}

// ---- what is round an altar

// What the altar sees of a building round it (only pedestals and barrels count).
export type AltarNeighbour = { id: number; kind: string; inv?: Inventory; liquid?: number; amount?: number }
export type AltarSurroundings = {
  // Each pedestal with something on it: what, and how many.
  pedestals: ReadonlyArray<{ id: number; dx: number; dy: number; item: ItemId; count: number }>
  // Each barrel with a liquid in it: which, and how many buckets.
  barrels: ReadonlyArray<{ id: number; dx: number; dy: number; liquid: number; amount: number }>
}

// The pedestals and barrels round an altar at x, y, in the order a ritual draws on them: round the altar clockwise,
// from the north (nearer first where two are in a line).
export function altarSurroundings(x: number, y: number, at: (x: number, y: number) => AltarNeighbour | undefined): AltarSurroundings {
  const spots: Array<{ dx: number; dy: number }> = []
  for (let dy = -ALTAR_REACH; dy <= ALTAR_REACH; dy++) for (let dx = -ALTAR_REACH; dx <= ALTAR_REACH; dx++) if (dx !== 0 || dy !== 0) spots.push({ dx, dy })
  const turn = (spot: { dx: number; dy: number }): number => (Math.atan2(spot.dx, -spot.dy) + Math.PI * 2) % (Math.PI * 2)
  spots.sort((a, b) => turn(a) - turn(b) || Math.max(Math.abs(a.dx), Math.abs(a.dy)) - Math.max(Math.abs(b.dx), Math.abs(b.dy)))
  const pedestals: Array<AltarSurroundings['pedestals'][number]> = []
  const barrels: Array<AltarSurroundings['barrels'][number]> = []
  for (const { dx, dy } of spots) {
    const there = at(x + dx, y + dy)
    if (there?.kind === 'pedestal' && there.inv) {
      const slot = there.inv.slots[0]
      if (slot && slot.count > 0) pedestals.push({ id: there.id, dx, dy, item: slot.item, count: slot.count })
    } else if (there?.kind === 'barrel' && there.liquid && there.amount) {
      barrels.push({ id: there.id, dx, dy, liquid: there.liquid, amount: there.amount })
    }
  }
  return { pedestals, barrels }
}

// How many of what an ingredient names are on the pedestals round an altar.
export function altarHas(around: AltarSurroundings, match: Match): number {
  return around.pedestals.reduce((sum, pedestal) => sum + (matches(match, pedestal.item) ? pedestal.count : 0), 0)
}

// How many buckets of a liquid are in the barrels round an altar.
export function altarHasLiquid(around: AltarSurroundings, liquid: number): number {
  return around.barrels.reduce((sum, barrel) => sum + (barrel.liquid === liquid ? barrel.amount : 0), 0)
}

// What a ritual would take from each pedestal and barrel round the altar (each with the building's ID), in the order
// they go round it, or undefined if they do not hold it all.
export function planRitual(recipe: AltarRecipe, around: AltarSurroundings): Array<Offering & { id: number }> | undefined {
  const left = new Map<number, number>()
  const taken: Array<Offering & { id: number; order: number }> = []
  for (const [match, need] of recipe.inputs) {
    let wanted = need
    around.pedestals.forEach((pedestal, order) => {
      if (wanted === 0 || !matches(match, pedestal.item)) return
      const count = Math.min(wanted, left.get(pedestal.id) ?? pedestal.count)
      if (count <= 0) return
      left.set(pedestal.id, (left.get(pedestal.id) ?? pedestal.count) - count)
      wanted -= count
      taken.push({ id: pedestal.id, dx: pedestal.dx, dy: pedestal.dy, item: pedestal.item, liquid: 0, count, order })
    })
    if (wanted > 0) return undefined
  }
  for (const [liquid, need] of recipe.liquids) {
    let wanted = need
    around.barrels.forEach((barrel, order) => {
      if (wanted === 0 || barrel.liquid !== liquid) return
      const count = Math.min(wanted, left.get(barrel.id) ?? barrel.amount)
      if (count <= 0) return
      left.set(barrel.id, (left.get(barrel.id) ?? barrel.amount) - count)
      wanted -= count
      taken.push({ id: barrel.id, dx: barrel.dx, dy: barrel.dy, item: 0, liquid, count, order: 1000 + order })
    })
    if (wanted > 0) return undefined
  }
  // The items first, round the altar, then the liquids.
  return taken.sort((a, b) => a.order - b.order).map(({ order: _order, ...offering }) => offering)
}

// ---- the ritual, tick by tick

export type Altar = { inv: Inventory; recipe: number; progress: number; glow: number; offerings: number[] }

// Whether an altar is in the middle of a ritual (it takes and gives nothing then).
export function altarBusy(altar: Pick<Altar, 'recipe'>): boolean {
  return altar.recipe !== 0
}

// Whether there is room on an altar for what a ritual makes.
export function altarRoomFor(altar: Pick<Altar, 'inv'>, recipe: AltarRecipe): boolean {
  return fitsIn(altar.inv, 0, recipe.output, recipe.count)
}

export function stepAltar(altar: Altar): void {
  if (altar.glow > 0) altar.glow--
  if (altar.recipe === 0) return
  const recipe = ALTAR_RECIPES[altar.recipe - 1]
  altar.progress++
  if (recipe && altar.progress < recipe.ticks) return
  if (recipe) putIn(altar.inv, 0, recipe.output, recipe.count)
  altar.recipe = 0
  altar.progress = 0
  altar.offerings = []
  altar.glow = ALTAR_GLOW_TICKS
}

// How far through its ritual an altar is, 0 to 1.
export function ritualFraction(altar: Pick<Altar, 'recipe' | 'progress'>, alpha = 0): number {
  const recipe = ALTAR_RECIPES[altar.recipe - 1]
  return recipe ? Math.min(1, (altar.progress + alpha) / recipe.ticks) : 0
}
