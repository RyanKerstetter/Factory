import stationsData from '../../../data/stations.json' with { type: 'json' }
import { failIn, fieldsOf, onlyFields, secondsField, textField, wholeField, type Fail, type Fields } from './data-check.ts'
import { countIn, fitsIn, inventoryTotals, putIn, takeIn, type Inventory } from './inventory.ts'
import { getItem, itemFromKey, matches, matchesOf, type ItemId, type Match, type ToolKind } from './items.ts'
import { PLAYER_CRAFT_SPEED, RECIPES } from './recipes.ts'

// Work stations, from data/stations.json: the stump and the workbench, which work the same way (and are the same kind
// of building in the simulation: see entity.ts). Each has a slot for a tool, slots for what it works from, and one for
// what comes out (STATION_LAYOUT). The player picks a recipe and presses Craft: enough for one more (or five, or all)
// goes in from their inventory, and the tool the recipe needs goes into the tool slot (taking the place of any other
// tool there, which goes back to the player); then it makes the recipe every `seconds`, again and again while what is
// in it is enough, but only while a player stays at it (see GameRoom). A tool is not used up.
//
// A new station is a kind here (STATION_KINDS, STATION_LAYOUT), its recipes in stations.json, and a building that is
// one (see BUILDINGS and entity.ts).
export const STATION_KINDS = ['stump', 'workbench'] as const
export type StationKind = (typeof STATION_KINDS)[number]

export function isStationKind(kind: string): kind is StationKind {
  return (STATION_KINDS as readonly string[]).includes(kind)
}

export type StationRecipe = {
  // Its place in its station's list (what a `work` command names).
  index: number
  category: string
  // The tool it needs in the station's tool slot, if any.
  tool?: ToolKind
  // What it takes: items, or "#tag" for any item with the tag ("#cooked meat").
  inputs: ReadonlyArray<readonly [Match, number]>
  output: ItemId
  count: number
  // How long one takes, in ticks.
  ticks: number
}

// Which slot of each station is which: its tool slot, the slots it works from (four, shown two by two: room for a
// breakfast sandwich's four things), and the one what it makes goes to. (The numbers are as they are so saves from
// when they had fewer input slots still load: the new ones came at the end.)
export type StationLayout = { tool: number; inputs: readonly number[]; output: number; slots: number }
export const STATION_LAYOUT: Readonly<Record<StationKind, StationLayout>> = {
  stump: { tool: 0, inputs: [1, 3, 4, 5], output: 2, slots: 6 },
  workbench: { tool: 4, inputs: [0, 1, 2, 5], output: 3, slots: 6 },
}

export const STATION_RECIPES: Readonly<Record<StationKind, readonly StationRecipe[]>> = parseStations(stationsData)

// A station in data/stations.json is `{ "speed": n, "includes": [other stations], "recipes": [...] }`. It makes its own
// recipes, and everything the stations it includes make too (each recipe it has no recipe of its own for the same
// output of), after its own, so a bigger station can always do what a smaller one does: the stump includes "player"
// (what is made by hand, see recipes.ts), and the workbench includes the stump (and so the player's too). Includes can
// chain, but not go round in a circle.
//
// `speed` is how quick a station is at what it gets from others: a recipe it declares itself takes its own `seconds`,
// but one it includes takes `seconds` × the speed of the station that declared it ÷ its own speed. The player is 1, the
// stump 2 and the workbench 3, so a stump recipe of 3 s takes 2 s at the workbench, and a hand recipe of 6 s takes 3 s
// at the stump and 2 s at the workbench.
type Includable = StationKind | 'player'
function parseStations(data: unknown): Record<StationKind, StationRecipe[]> {
  if (typeof data !== 'object' || data === null) throw new Error('data/stations.json must be an object of stations.')
  const own: Record<StationKind, StationRecipe[]> = { stump: [], workbench: [] }
  const includes: Record<StationKind, Includable[]> = { stump: [], workbench: [] }
  const speed: Record<Includable, number> = { player: PLAYER_CRAFT_SPEED, stump: 1, workbench: 1 }
  for (const [station, entry] of Object.entries(data)) {
    // The player's recipes are read in recipes.ts; the fires' (the campfire's and the oven's), the barrel's and the
    // drying rack's in machines.ts; the altar's in altar.ts.
    if (station === 'player' || station === 'fire' || station === 'oven' || station === 'barrel' || station === 'rack' || station === 'altar') continue
    const fail = failIn(`data/stations.json, ${station}`)
    if (!isStationKind(station)) fail('there is no station of that name')
    const kind = station as StationKind
    const shaped = fieldsOf(entry, 'it', fail)
    onlyFields(shaped, ['speed', 'includes', 'recipes'], fail)
    if (!Array.isArray(shaped.recipes)) fail('"recipes" must be a list of recipes')
    speed[kind] = wholeField(shaped, 'speed', fail, 1)
    const named = shaped.includes ?? []
    if (!Array.isArray(named) || named.some((other) => typeof other !== 'string' || (other !== 'player' && !isStationKind(other)) || other === station)) {
      fail('"includes" must be a list of other stations (or "player")')
    }
    includes[kind] = named as Includable[]
    own[kind] = (shaped.recipes as unknown[]).map((raw, index) => parseRecipe(kind, raw, index))
  }
  // The player's recipes as a station's.
  const player: StationRecipe[] = RECIPES.map((recipe, index) => ({ index, category: recipe.category, inputs: recipe.inputs, output: recipe.output, count: recipe.count, ticks: recipe.ticks }))
  // A station's recipes, each taking as long as it takes there.
  const resolve = (kind: Includable, seen: readonly Includable[]): StationRecipe[] => {
    if (seen.includes(kind)) throw new Error(`data/stations.json: "includes" goes round in a circle through ${kind}`)
    if (kind === 'player') return player
    const list = [...own[kind]]
    const room = STATION_LAYOUT[kind].inputs.length
    for (const other of includes[kind]) {
      for (const recipe of resolve(other, [...seen, kind])) {
        if (list.some((mine) => mine.output === recipe.output)) continue
        if (recipe.inputs.length > room) throw new Error(`data/stations.json: ${kind} includes ${other}, but a recipe of it takes more kinds of input than ${kind} has slots`)
        const ticks = Math.max(1, Math.round((recipe.ticks * speed[other]) / speed[kind]))
        list.push({ ...recipe, index: list.length, ticks })
      }
    }
    return list
  }
  return { stump: resolve('stump', []), workbench: resolve('workbench', []) }
}

function parseRecipe(station: StationKind, entry: unknown, index: number): StationRecipe {
  const fail: Fail = failIn(`data/stations.json, ${station} recipe ${index + 1}`)
  const raw: Fields = fieldsOf(entry, 'it', fail)
  onlyFields(raw, ['category', 'tool', 'inputs', 'output', 'count', 'seconds'], fail)
  const { tool } = raw
  if (tool !== undefined && tool !== 'axe' && tool !== 'pickaxe' && tool !== 'knife' && tool !== 'mortar') fail('"tool" must be axe, pickaxe, knife or mortar, or left out')
  const inputs = matchesOf(raw.inputs, fail)
  if (inputs.length === 0) fail('"inputs" must name at least one thing')
  const room = STATION_LAYOUT[station].inputs.length
  if (inputs.length > room) fail(`a ${station} recipe takes at most ${room} kinds of input`)
  return {
    index,
    category: textField(raw, 'category', fail, 'Recipes'),
    ...(tool !== undefined ? { tool: tool as ToolKind } : {}),
    inputs,
    output: itemFromKey(raw.output, fail),
    count: wholeField(raw, 'count', fail, 1, 1),
    ticks: secondsField(raw, 'seconds', fail),
  }
}

// A station's recipe's ingredients as they are taken from the player (pressing Craft puts them in): an item as it is,
// and "any of a kind" ("#cooked meat") as one kind of it only, so they fit the station's few input slots (a breakfast
// sandwich takes all four: steak and chicken both would leave no room for the egg). That kind is the one already in
// the station, if the player has some of it; else the one the player has most of. Each as [item, how many for one]
// (still the "#tag", if the player has none of it).
export function oneKindEach(
  kind: StationKind,
  station: Inventory,
  player: Inventory,
  inputs: ReadonlyArray<readonly [Match, number]>,
): Array<readonly [Match, number]> {
  return inputs.map(([match, need]) => {
    if (typeof match !== 'string') return [match, need] as const
    const there = STATION_LAYOUT[kind].inputs.map((slot) => station.slots[slot]).find((slot) => slot && slot.count > 0 && matches(match, slot.item))
    const mine = inventoryTotals(player).filter(({ item }) => matches(match, item))
    const kept = there ? mine.find(({ item }) => item === there.item) : undefined
    const most = mine.reduce<{ item: ItemId; count: number } | undefined>((best, one) => (!best || one.count > best.count ? one : best), undefined)
    const chosen = kept ?? most
    return chosen ? ([chosen.item, need] as const) : ([match, need] as const)
  })
}

// How many of what an ingredient names are in a station's input slots.
export function stationHas(kind: StationKind, inv: Inventory, match: Match): number {
  return countIn(inv, STATION_LAYOUT[kind].inputs, (held) => matches(match, held))
}

// How many of what an ingredient names are anywhere in an inventory.
export function countMatching(inv: Inventory, match: Match): number {
  return countIn(inv, [...inv.slots.keys()], (held) => matches(match, held))
}

// The kind of tool in a station's tool slot, if any.
export function stationTool(kind: StationKind, inv: Inventory): ToolKind | undefined {
  const slot = inv.slots[STATION_LAYOUT[kind].tool]
  return slot && slot.count > 0 ? getItem(slot.item).tool : undefined
}

// Whether a station has the tool a recipe needs (if it needs one) in its tool slot.
export function stationHasTool(kind: StationKind, inv: Inventory, recipe: StationRecipe): boolean {
  return !recipe.tool || stationTool(kind, inv) === recipe.tool
}

// Whether a station can make one of a recipe now: its tool, enough of each input, and room for what it makes.
export function stationCan(kind: StationKind, inv: Inventory, recipe: StationRecipe): boolean {
  return (
    stationHasTool(kind, inv, recipe) &&
    recipe.inputs.every(([item, need]) => stationHas(kind, inv, item) >= need) &&
    fitsIn(inv, STATION_LAYOUT[kind].output, recipe.output, recipe.count)
  )
}

// Takes one recipe's inputs out of a station's input slots and puts what it makes in its output slot.
export function stationMake(kind: StationKind, inv: Inventory, recipe: StationRecipe): void {
  const layout = STATION_LAYOUT[kind]
  for (const [match, need] of recipe.inputs) takeIn(inv, layout.inputs, (held) => matches(match, held), need)
  putIn(inv, layout.output, recipe.output, recipe.count)
}

// Which slots of a station an item put in by hand goes to: a tool to the tool slot (one); anything else to the input
// slots (the stump only takes what one of its recipes works from); nothing goes into the output slot by hand.
export function stationSlotsFor(kind: StationKind, item: ItemId): { slots: readonly number[]; limit?: number } | undefined {
  const layout = STATION_LAYOUT[kind]
  if (getItem(item).tool) return { slots: [layout.tool], limit: 1 }
  if (kind === 'stump' && !STATION_RECIPES.stump.some((recipe) => recipe.inputs.some(([input]) => matches(input, item)))) return undefined
  return { slots: layout.inputs }
}

// How many of what an ingredient names a player has to hand for a recipe: in their inventory, and already in the
// station's `slots`.
export function haveForStation(player: Inventory, station: Inventory, match: Match, slots: readonly number[]): number {
  return countMatching(player, match) + countIn(station, slots, (held) => matches(match, held))
}
