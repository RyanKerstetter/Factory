import { addItems, cloneInventory, countOf, removeItems, type Inventory } from './inventory.ts'
import recipesData from '../../../data/recipes.json' with { type: 'json' }
import { itemByKey, type ItemId } from './items.ts'

// What can be made by hand from the inventory, from data/recipes.json. A recipe's number is part of the protocol (a
// `craft` command names it), so a new one takes the next number. In the file, items are named by their keys, and
// `count` (how many it makes) can be left out (1).
export type Recipe = { id: number; category: string; output: ItemId; count: number; inputs: ReadonlyArray<readonly [ItemId, number]> }

const isWhole = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min

export const RECIPES: readonly Recipe[] = parseRecipes(recipesData)

function parseRecipes(data: unknown): Recipe[] {
  if (!Array.isArray(data)) throw new Error('data/recipes.json must be a list of recipes.')
  const seen = new Set<number>()
  return data.map((raw: Record<string, unknown>, index): Recipe => {
    const fail = (problem: string): never => {
      throw new Error(`data/recipes.json, recipe ${index + 1}: ${problem}`)
    }
    if (typeof raw !== 'object' || raw === null) fail('is not an object')
    const { id, output, count = 1, inputs, category = 'Other' } = raw
    if (typeof category !== 'string') fail('"category" must be text')
    if (!isWhole(id, 1)) return fail('"id" must be a whole number above 0')
    if (seen.has(id)) fail(`"id" ${id} is used twice`)
    seen.add(id)
    const item = (key: unknown): ItemId => {
      const found = typeof key === 'string' ? itemByKey(key) : undefined
      return found ? found.id : fail(`there is no item "${String(key)}"`)
    }
    if (!isWhole(count, 1)) return fail('"count" must be a whole number above 0')
    if (typeof inputs !== 'object' || inputs === null || Object.keys(inputs).length === 0) return fail('"inputs" must name at least one item')
    return {
      id,
      category: category as string,
      output: item(output),
      count,
      inputs: Object.entries(inputs as Record<string, unknown>).map(([key, n]) => {
        if (!isWhole(n, 1)) return fail(`"inputs" needs a whole number above 0 of ${key}`)
        return [item(key), n] as const
      }),
    }
  })
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
