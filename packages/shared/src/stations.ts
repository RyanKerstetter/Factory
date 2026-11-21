import stationsData from '../../../data/stations.json' with { type: 'json' }
import { TPS } from './constants.ts'
import { countOf, type Inventory } from './inventory.ts'
import { getItem, itemByKey, stackLimit, type ItemId, type ToolKind } from './items.ts'

// Work stations, from data/stations.json. Each works through a recipe every `seconds`, again and again, but only while
// a player stays at it (see GameRoom).
//
// - The stump: a slot for a tool, one for what it works on, and one for what comes out. It works out the recipe from
//   what is in it (an axe and logs make planks; twine on its own makes rope), and keeps going while it can.
// - The workbench: three slots for what it works on, one for what comes out, and one for a tool (a recipe that needs a
//   tool, such as a knife for a spear, needs it there: not just in the player's inventory). The player picks the recipe;
//   it keeps making it while there is enough in it. Each press of Craft puts in enough for one more (or five, or all),
//   and the tool if it needs one and has none.
export type StationKind = 'stump' | 'workbench'
export type StationRecipe = {
  // Its place in its station's list (what a `work` command names).
  index: number
  category: string
  // The tool it needs in the stump's tool slot, if any.
  tool?: ToolKind
  inputs: ReadonlyArray<readonly [ItemId, number]>
  output: ItemId
  count: number
  // How long one takes, in ticks.
  ticks: number
}

// Which slot of the stump is which.
export const STATION_TOOL_SLOT = 0
export const STATION_INPUT_SLOT = 1
export const STATION_OUTPUT_SLOT = 2
export const STATION_SLOTS = 3
// The workbench's: three to work from, one for what it makes, and one for a tool.
export const WORKBENCH_INPUT_SLOTS: readonly number[] = [0, 1, 2]
export const WORKBENCH_OUTPUT_SLOT = 3
export const WORKBENCH_TOOL_SLOT = 4
export const WORKBENCH_SLOTS = 5

const isWhole = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min

export const STATION_RECIPES: Readonly<Record<StationKind, readonly StationRecipe[]>> = parseStations(stationsData)

function parseStations(data: unknown): Record<StationKind, StationRecipe[]> {
  if (typeof data !== 'object' || data === null) throw new Error('data/stations.json must be an object of stations.')
  const parsed: Record<StationKind, StationRecipe[]> = { stump: [], workbench: [] }
  for (const [station, list] of Object.entries(data)) {
    // The barrel's and the drying rack's recipes are read in machines.ts.
    if (station === 'barrel' || station === 'rack') continue
    if (!(station in parsed)) throw new Error(`data/stations.json: there is no station "${station}"`)
    if (!Array.isArray(list)) throw new Error(`data/stations.json, ${station}: must be a list of recipes`)
    parsed[station as StationKind] = list.map((raw: Record<string, unknown>, index): StationRecipe => {
      const fail = (problem: string): never => {
        throw new Error(`data/stations.json, ${station} recipe ${index + 1}: ${problem}`)
      }
      const item = (key: unknown): ItemId => {
        const found = typeof key === 'string' ? itemByKey(key) : undefined
        return found ? found.id : fail(`there is no item "${String(key)}"`)
      }
      const { tool, inputs, output, count = 1, seconds, category = 'Recipes' } = raw
      if (tool !== undefined && tool !== 'axe' && tool !== 'pickaxe' && tool !== 'knife') return fail('"tool" must be axe, pickaxe or knife, or left out')
      if (!isWhole(count, 1)) return fail('"count" must be a whole number above 0')
      if (typeof seconds !== 'number' || seconds <= 0) return fail('"seconds" must be a number above 0')
      if (typeof category !== 'string') return fail('"category" must be text')
      if (typeof inputs !== 'object' || inputs === null || Object.keys(inputs).length === 0) return fail('"inputs" must name at least one item')
      const needs = Object.entries(inputs as Record<string, unknown>).map(([key, n]) => {
        if (!isWhole(n, 1)) return fail(`"inputs" needs a whole number above 0 of ${key}`)
        return [item(key), n] as const
      })
      if (station === 'stump' && needs.length !== 1) fail('a stump recipe takes one kind of input')
      if (station === 'workbench' && needs.length > WORKBENCH_INPUT_SLOTS.length) fail('a workbench recipe takes at most three kinds of input')
      return {
        index,
        category,
        ...(tool !== undefined ? { tool } : {}),
        inputs: needs,
        output: item(output),
        count,
        ticks: Math.max(1, Math.round(seconds * TPS)),
      }
    })
  }
  return parsed
}

// Whether there is room in a slot for what a recipe makes.
// Whether a station's output slot has room for what a recipe makes (empty, or the same item with room in its stack).
export function stationOutputFits(kind: StationKind, inv: Inventory, recipe: StationRecipe): boolean {
  return outputFits(inv, kind === 'workbench' ? WORKBENCH_OUTPUT_SLOT : STATION_OUTPUT_SLOT, recipe)
}

function outputFits(inv: Inventory, slot: number, recipe: StationRecipe): boolean {
  const output = inv.slots[slot]
  if (!output) return false
  if (output.count === 0) return recipe.count <= stackLimit(recipe.output, inv.stack)
  return output.item === recipe.output && output.count + recipe.count <= stackLimit(recipe.output, inv.stack)
}

// The recipe the stump can work on now: the tool it needs (if any) in its tool slot, enough of the input in its input
// slot, and room in its output slot.
export function stationRecipe(kind: 'stump', inv: Inventory): StationRecipe | undefined {
  const tool = inv.slots[STATION_TOOL_SLOT]
  const input = inv.slots[STATION_INPUT_SLOT]
  if (!tool || !input || input.count === 0) return undefined
  const held = tool.count > 0 ? getItem(tool.item).tool : undefined
  return STATION_RECIPES[kind].find((recipe) => {
    const [item, need] = recipe.inputs[0]
    if ((recipe.tool !== undefined && recipe.tool !== held) || item !== input.item || input.count < need) return false
    return outputFits(inv, STATION_OUTPUT_SLOT, recipe)
  })
}

// How many of an item are in a workbench's input slots.
export function workbenchHas(inv: Inventory, item: ItemId): number {
  let total = 0
  for (const slot of WORKBENCH_INPUT_SLOTS) if (inv.slots[slot]?.item === item) total += inv.slots[slot].count
  return total
}

// Whether a workbench has the tool a recipe needs (if it needs one) in its tool slot.
export function workbenchHasTool(inv: Inventory, recipe: StationRecipe): boolean {
  if (!recipe.tool) return true
  const slot = inv.slots[WORKBENCH_TOOL_SLOT]
  return slot !== undefined && slot.count > 0 && getItem(slot.item).tool === recipe.tool
}

// Whether a workbench can make one of a recipe now: its tool, enough of each input, and room for what it makes.
export function workbenchCan(inv: Inventory, recipe: StationRecipe): boolean {
  return workbenchHasTool(inv, recipe) && recipe.inputs.every(([item, need]) => workbenchHas(inv, item) >= need) && outputFits(inv, WORKBENCH_OUTPUT_SLOT, recipe)
}

// Takes one recipe's inputs out of a workbench's input slots and puts what it makes in its output slot.
export function workbenchMake(inv: Inventory, recipe: StationRecipe): void {
  for (const [item, need] of recipe.inputs) {
    let left = need
    for (const index of WORKBENCH_INPUT_SLOTS) {
      const slot = inv.slots[index]
      if (left === 0 || slot.item !== item) continue
      const taken = Math.min(left, slot.count)
      slot.count -= taken
      left -= taken
      if (slot.count === 0) slot.item = 0
    }
  }
  const output = inv.slots[WORKBENCH_OUTPUT_SLOT]
  output.item = recipe.output
  output.count += recipe.count
}

// Which slot of the stump an item put in by hand goes to: a tool to the tool slot, anything a recipe works on to the
// input slot, and nothing else (nothing goes into the output slot by hand).
export function stationSlotFor(kind: 'stump', item: ItemId): number | undefined {
  if (getItem(item).tool) return STATION_TOOL_SLOT
  return STATION_RECIPES[kind].some((recipe) => recipe.inputs[0][0] === item) ? STATION_INPUT_SLOT : undefined
}

// How many of an item a player has to hand for a recipe: in their inventory, and already in the station.
export function haveForStation(player: Inventory, station: Inventory, item: ItemId, slots: readonly number[]): number {
  let inStation = 0
  for (const index of slots) if (station.slots[index]?.item === item) inStation += station.slots[index].count
  return countOf(player, item) + inStation
}
