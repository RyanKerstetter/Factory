import stationsData from '../../../data/stations.json' with { type: 'json' }
import { failIn, fieldsOf, onlyFields, secondsField, textField, wholeField, type Fail } from './data-check.ts'
import { addItems, cloneInventory, countOf, removeItems, type Inventory } from './inventory.ts'
import { itemFromKey, type ItemId } from './items.ts'

// What a player can make by hand from their inventory: the "player" station in data/stations.json. Made by hand it is
// made at once; `seconds` is how long it takes at the player's own `speed` (1), which the stations that include it
// make quicker (see `includes` and `speed` in stations.ts). A recipe's number (`id`) is its place in the list plus one,
// and is part of the protocol (a `craft` command names it), so a new one goes at the end. In the file, items are named
// by their keys, and `count` (how many it makes) can be left out (1).
export type Recipe = { id: number; category: string; output: ItemId; count: number; inputs: ReadonlyArray<readonly [ItemId, number]>; ticks: number }

// The player's speed at making things (see `speed` in stations.ts).
export const PLAYER_CRAFT_SPEED: number = parsePlayer(stationsData).speed
export const RECIPES: readonly Recipe[] = parsePlayer(stationsData).recipes

function parsePlayer(data: unknown): { speed: number; recipes: Recipe[] } {
  const fail = failIn('data/stations.json, player')
  const entry = fieldsOf(fieldsOf(data, 'data/stations.json', fail).player, 'it', fail)
  onlyFields(entry, ['speed', 'recipes'], fail)
  if (!Array.isArray(entry.recipes)) fail('"recipes" must be a list of recipes')
  const recipes = (entry.recipes as unknown[]).map((item: unknown, index): Recipe => {
    const fail = failIn(`data/stations.json, player recipe ${index + 1}`)
    const raw = fieldsOf(item, 'it', fail)
    onlyFields(raw, ['category', 'output', 'count', 'inputs', 'seconds'], fail)
    return {
      id: index + 1,
      category: textField(raw, 'category', fail, 'Other'),
      output: itemFromKey(raw.output, fail),
      count: wholeField(raw, 'count', fail, 1, 1),
      inputs: ingredientsOf(raw.inputs, fail),
      ticks: secondsField(raw, 'seconds', fail),
    }
  })
  return { speed: wholeField(entry, 'speed', fail, 1), recipes }
}

// A recipe's ingredients as a data file writes them, `{ "item key": how many }`: each item's number and how many.
export function ingredientsOf(value: unknown, fail: Fail): Array<readonly [ItemId, number]> {
  const inputs = fieldsOf(value ?? {}, '"inputs"', fail)
  const list = Object.keys(inputs).map((key) => [itemFromKey(key, fail), wholeField(inputs, key, fail, 1)] as const)
  return list.length > 0 ? list : fail('"inputs" must name at least one item')
}

export function getRecipe(id: number): Recipe | undefined {
  return RECIPES.find((candidate) => candidate.id === id)
}

export function canAfford(inventory: Inventory, recipe: Recipe): boolean {
  return recipe.inputs.every(([item, count]) => countOf(inventory, item) >= count)
}

// Makes a recipe in an inventory: takes what it needs and puts in what it makes, or changes nothing and says why not
// (not enough of something, or no room for what it makes once the inputs are gone).
export function craftIn(inventory: Inventory, recipe: Recipe): 'lacking' | 'full' | undefined {
  if (!canAfford(inventory, recipe)) return 'lacking'
  const after = cloneInventory(inventory)
  for (const [item, count] of recipe.inputs) removeItems(after, item, count)
  if (addItems(after, recipe.output, recipe.count) < recipe.count) return 'full'
  after.slots.forEach((slot, i) => Object.assign(inventory.slots[i], slot))
  return undefined
}
