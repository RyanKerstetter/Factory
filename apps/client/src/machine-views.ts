import {
  BARREL_CAPACITY,
  BARREL_SOLIDS,
  barrelFraction,
  BARREL_RECIPES,
  bucketFor,
  LIQUIDS,
  matches,
  RACK_RECIPES,
  type Match,
  cookFraction,
  countOf,
  getItem,
  HEAT_MAX,
  haveForStation,
  ITEMS,
  itemId,
  LIQUID_TANNIN,
  rackFraction,
  STATION_INPUT_SLOT,
  STATION_RECIPES,
  STATION_TOOL_SLOT,
  stationRecipe,
  TPS,
  WORKBENCH_INPUT_SLOTS,
  type Entity,
  type Inventory,
  type ItemId,
} from '../../../packages/shared/src/index.ts'
import type { MachineView } from './ui/inventory-view.ts'
import type { BookEntry } from './ui/recipe-book.ts'

// What each machine's panel shows (see MachineView): its slots, gauges, what it is doing, its buttons, and its recipes
// at the side. `player` is the player's inventory and `inv` the machine's, both as they will be once what has been
// asked for is done. What it is doing shows in its progress arrow and gauges, not in words.
export function machineView(entity: Entity, player: Inventory, inv: Inventory): MachineView | undefined {
  switch (entity.kind) {
    case 'stump': {
      return {
        inputs: [
          { index: STATION_TOOL_SLOT, label: 'Tool' },
          { index: STATION_INPUT_SLOT, label: 'Input' },
        ],
        outputs: [{ index: 2, label: 'Output' }],
        gauges: [],
        buttons: [],
        recipes: { title: 'Stump recipes', action: 'Craft', entries: stumpBook(player, inv) },
      }
    }
    case 'workbench': {
      return {
        inputs: WORKBENCH_INPUT_SLOTS.map((index) => ({ index, label: 'Input' })),
        outputs: [{ index: 3, label: 'Output' }],
        gauges: [],
        buttons: [],
        recipes: { title: 'Workbench recipes', action: 'Craft', entries: workbenchBook(player, inv) },
      }
    }
    case 'campfire':
      return {
        // What cooks above, the fuel under it.
        inputs: [
          { index: 1, label: 'Cook' },
          { index: 0, label: 'Fuel' },
        ],
        outputs: [
          { index: 2, label: 'Cooked' },
          { index: 3, label: 'Charcoal' },
        ],
        gauges: [{ label: 'Heat', fraction: entity.heat / HEAT_MAX, text: `${entity.heat}°`, tone: 'heat' }],
        buttons: [{ id: entity.lit ? 'douse' : 'light', label: entity.lit ? 'Put out' : 'Light', disabled: false, primary: !entity.lit }],
        recipes: { title: 'Cooking and fuel', action: '', entries: campfireBook(player, inv) },
      }
    case 'barrel': {
      const liquid = LIQUIDS[entity.liquid] || 'nothing'
      return {
        inputs: BARREL_SOLIDS.map((index) => ({ index, label: 'In' })),
        outputs: [{ index: 3, label: 'Out' }],
        gauges: [
          {
            label: 'Liquid',
            fraction: entity.amount / BARREL_CAPACITY,
            text: entity.amount === 0 ? 'empty' : `${entity.amount}/${BARREL_CAPACITY} ${liquid}`,
            tone: entity.liquid === LIQUID_TANNIN ? 'tannin' : LIQUIDS[entity.liquid] === 'milk' ? 'milk' : 'water',
          },
          { label: 'Heat', fraction: entity.heat / HEAT_MAX, text: `${entity.heat}°`, tone: 'heat' },
        ],
        buttons: [{ id: entity.sealed ? 'unseal' : 'seal', label: entity.sealed ? 'Unseal' : 'Seal', disabled: false, primary: !entity.sealed }],
        recipes: { title: 'Barrel', action: '', entries: barrelBook(player, inv, entity.liquid, entity.amount) },
      }
    }
    case 'rack': {
      return {
        inputs: [{ index: 0, label: 'Hide' }],
        outputs: [{ index: 1, label: 'Dried' }],
        gauges: [{ label: 'Heat', fraction: entity.heat / HEAT_MAX, text: `${entity.heat}°`, tone: 'heat' }],
        buttons: [],
        recipes: {
          title: 'Drying rack',
          action: '',
          entries: RACK_RECIPES.map((recipe) =>
            entry(recipe.index, 'Drying (faster by a fire)', recipe.output, 1, [[recipe.input, 1, haveForStation(player, inv, recipe.input, [0])]], recipe.ticks / TPS),
          ),
        },
      }
    }
    default:
      return undefined
  }
}

// How far a machine is through what it is doing, 0 to 1, drawn between the factory's last tick and the next.
export function machineProgress(entity: Entity, alpha: number): number | undefined {
  switch (entity.kind) {
    case 'stump': {
      const recipe = stationRecipe('stump', entity.inv)
      return recipe && entity.active ? (entity.progress + alpha) / recipe.ticks : 0
    }
    case 'workbench': {
      const recipe = STATION_RECIPES.workbench[entity.recipe - 1]
      return recipe && entity.active ? (entity.progress + alpha) / recipe.ticks : 0
    }
    case 'campfire':
      return cookFraction(entity)
    case 'barrel':
      return barrelFraction(entity)
    case 'rack':
      return rackFraction(entity)
    default:
      return undefined
  }
}

function entry(
  id: number,
  category: string,
  output: ItemId,
  count: number,
  inputs: ReadonlyArray<readonly [ItemId, number, number]>,
  seconds?: number,
  tool?: { name: string; have: boolean },
): BookEntry {
  return {
    id,
    category,
    output,
    count,
    inputs: inputs.map(([item, need, have]) => ({ item, need, have })),
    ...(tool ? { tool } : {}),
    ...(seconds !== undefined ? { seconds } : {}),
    ready: inputs.every(([, need, have]) => have >= need) && (tool?.have ?? true),
  }
}

// The stump's recipes. What the player has counts what is already in the stump.
function stumpBook(player: Inventory, inv: Inventory): BookEntry[] {
  return STATION_RECIPES.stump.map((recipe) => {
    const [input, need] = recipe.inputs[0]
    const toolHere =
      recipe.tool === undefined ||
      [...player.slots, inv.slots[STATION_TOOL_SLOT]].some((slot) => slot && slot.count > 0 && getItem(slot.item).tool === recipe.tool)
    const tool = recipe.tool ? { name: recipe.tool[0].toUpperCase() + recipe.tool.slice(1), have: toolHere } : undefined
    return entry(recipe.index, recipe.category, recipe.output, recipe.count, [[input, need, haveForStation(player, inv, input, [STATION_INPUT_SLOT])]], recipe.ticks / TPS, tool)
  })
}

// The workbench's recipes, in the order their categories first come. What the player has counts what is already in
// the workbench.
function workbenchBook(player: Inventory, inv: Inventory): BookEntry[] {
  const recipes = STATION_RECIPES.workbench
  const categories = [...new Set(recipes.map((recipe) => recipe.category))]
  return [...recipes]
    .sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category))
    .map((recipe) =>
      entry(
        recipe.index,
        recipe.category,
        recipe.output,
        recipe.count,
        recipe.inputs.map(([item, need]) => [item, need, haveForStation(player, inv, item, WORKBENCH_INPUT_SLOTS)] as const),
        recipe.ticks / TPS,
        // A tool it needs (a knife for a spear) has to be on the player, and is not used up.
        recipe.tool
          ? {
              name: `${recipe.tool[0].toUpperCase()}${recipe.tool.slice(1)} (kept)`,
              have: player.slots.some((slot) => slot.count > 0 && getItem(slot.item).tool === recipe.tool),
            }
          : undefined,
      ),
    )
}

// What a campfire cooks, and what it burns (each fuel as the thing it is, "taking" as long as it burns).
function campfireBook(player: Inventory, inv: Inventory): BookEntry[] {
  const cooking = ITEMS.filter((item) => item.cooks).map((item) =>
    entry(item.id, 'Cooking', itemId(item.cooks!.into), 1, [[item.id, 1, haveForStation(player, inv, item.id, [1])]], item.cooks!.ticks / TPS),
  )
  const fuels = ITEMS.filter((item) => item.fuel).map((item) =>
    entry(1000 + item.id, `Fuel (heat it reaches)`, item.id, item.fuel!.heat, [[item.id, 1, haveForStation(player, inv, item.id, [0])]], item.fuel!.ticks / TPS),
  )
  return [...cooking, ...fuels]
}

// What a barrel makes (see "barrel" in stations.json). A liquid shows as a bucket of it, and a "#tag" ingredient as the
// first item with that tag. What the player has counts what is in the barrel, and the buckets of it they carry.
function barrelBook(player: Inventory, inv: Inventory, liquid: number, amount: number): BookEntry[] {
  const solid = (match: Match): number =>
    player.slots.reduce((sum, slot) => sum + (slot.count > 0 && matches(match, slot.item) ? slot.count : 0), 0) +
    BARREL_SOLIDS.reduce((sum, i) => sum + (inv.slots[i].count > 0 && matches(match, inv.slots[i].item) ? inv.slots[i].count : 0), 0)
  const shown = (match: Match): ItemId => (typeof match === 'string' ? (ITEMS.find((item) => matches(match, item.id))?.id ?? 0) : match)
  return BARREL_RECIPES.map((recipe) => {
    const inputs: Array<readonly [ItemId, number, number]> = []
    if (recipe.liquid) {
      const bucket = bucketFor(recipe.liquid)
      inputs.push([bucket, recipe.liquidMin, (liquid === recipe.liquid ? amount : 0) + countOf(player, bucket)])
    }
    for (const [match, need] of recipe.solids) inputs.push([shown(match), need, solid(match)])
    for (const [match, per] of recipe.perBucket) inputs.push([shown(match), per, solid(match)])
    const output = recipe.output || bucketFor(recipe.liquidInto)
    const tagged = [...recipe.solids, ...recipe.perBucket].some(([match]) => typeof match === 'string')
    const category = recipe.category + (tagged ? ' (any of the kind)' : '') + (recipe.perBucket.length ? ', per bucket' : '') + (recipe.heat ? `, at ${recipe.heat}°` : '')
    return entry(recipe.index, category, output, recipe.output ? recipe.count : 1, inputs, recipe.ticks / TPS)
  })
}
