import {
  ALTAR_RECIPES,
  altarBusy,
  altarRoomFor,
  altarHas,
  altarHasLiquid,
  ritualFraction,
  type AltarSurroundings,
  BARREL_CAPACITY,
  CAMPFIRE_CHARCOAL,
  CAMPFIRE_COOK,
  CAMPFIRE_COOKED,
  CAMPFIRE_FUEL,
  countIn,
  BARREL_OUTPUT,
  BARREL_SOLIDS,
  barrelFraction,
  burnFraction,
  BARREL_RECIPES,
  barrelHow,
  barrelPlan,
  type Barrel,
  matchName,
  bucketFor,
  LIQUIDS,
  matches,
  type Match,
  cookFraction,
  cookingOf,
  fireRecipes,
  countOf,
  OVEN_COOK_SPEED,
  type FireKind,
  getItem,
  HEAT_MAX,
  haveForStation,
  ITEMS,
  STATION_LAYOUT,
  STATION_RECIPES,
  TPS,
  type StationKind,
  type Entity,
  type Inventory,
  type ItemId,
} from '../../../packages/shared/src/index.ts'
import { liquidLook } from './liquids.ts'
import type { MachineView } from './ui/inventory-view.ts'
import type { BookEntry, BookLiquid } from './ui/recipe-book.ts'

// A machine's heat, as a gauge.
const heatGauge = (heat: number): MachineView['gauges'][number] => ({ label: 'Heat', fraction: heat / HEAT_MAX, text: `${heat}°`, tone: 'heat' })

// What each machine's panel shows (see MachineView): its slots, gauges, what it is doing, its buttons, and its recipes
// at the side. `player` is the player's inventory and `inv` the machine's, both as they will be once what has been
// asked for is done. What it is doing shows in its progress arrow and gauges, not in words. An altar's rituals count
// what is on the pedestals and in the barrels round it (`around`).
export function machineView(entity: Entity, player: Inventory, inv: Inventory, around?: AltarSurroundings): MachineView | undefined {
  switch (entity.kind) {
    case 'altar': {
      const busy = altarBusy(entity)
      const making = ALTAR_RECIPES[entity.recipe - 1]
      return {
        inputs: [],
        outputs: [{ index: 0 }],
        gauges: [],
        buttons: [],
        recipes: { title: 'Rituals', action: busy ? '' : 'Craft', entries: altarBook({ ...entity, inv }, around) },
        status: making ? `Performing the ritual of ${matchName(making.output).toLowerCase()}` : 'Not performing a ritual',
      }
    }
    case 'stump':
    case 'workbench':
    case 'carpenter': {
      // The tool slot first (marked as one), then what it works from, then what comes out.
      const layout = STATION_LAYOUT[entity.kind]
      return {
        inputs: [{ index: layout.tool, tool: true }, ...layout.inputs.map((index) => ({ index }))],
        outputs: [{ index: layout.output }],
        gauges: [],
        buttons: [],
        recipes: { title: STATION_BOOK_TITLES[entity.kind], action: 'Craft', entries: stationBook(entity.kind, player, inv) },
        status: stationStatus(entity.kind, entity.recipe, entity.active),
      }
    }
    case 'campfire':
    case 'oven':
      return {
        // What cooks above, the flame, the fuel under it.
        inputs: [{ index: CAMPFIRE_COOK }, { index: CAMPFIRE_FUEL }],
        outputs: [{ index: CAMPFIRE_COOKED }, { index: CAMPFIRE_CHARCOAL }],
        flame: entity.lit ? burnFraction(entity) : 0,
        gauges: [heatGauge(entity.heat)],
        buttons: [{ id: entity.lit ? 'douse' : 'light', label: entity.lit ? 'Put out' : 'Light', disabled: false, primary: !entity.lit }],
        recipes: { title: entity.kind === 'oven' ? 'Oven' : 'Campfire', action: '', entries: fireBook(entity.kind, player, inv, entity.heat) },
        status: fireStatus(entity.kind, entity.inv, entity.heat),
      }
    case 'barrel': {
      const liquid = LIQUIDS[entity.liquid] || 'nothing'
      return {
        inputs: BARREL_SOLIDS.map((index) => ({ index })),
        outputs: [{ index: BARREL_OUTPUT }],
        gauges: [
          {
            label: 'Liquid',
            fraction: entity.amount / BARREL_CAPACITY,
            text: entity.amount === 0 ? 'empty' : `${entity.amount}/${BARREL_CAPACITY} ${liquid}`,
            tone: liquidLook(LIQUIDS[entity.liquid]).tone,
          },
          heatGauge(entity.heat),
        ],
        buttons: [{ id: entity.sealed ? 'unseal' : 'seal', label: entity.sealed ? 'Unseal' : 'Seal', disabled: false, primary: !entity.sealed }],
        recipes: { title: 'Barrel', action: '', entries: barrelBook(player, inv, entity.liquid, entity.amount, entity.heat) },
        status: barrelStatus(entity),
      }
    }
    default:
      return undefined
  }
}

// The heading over each station's recipes.
const STATION_BOOK_TITLES: Readonly<Record<StationKind, string>> = { stump: 'Stump recipes', workbench: 'Workbench recipes', carpenter: "Carpenter's bench recipes" }

// What a machine is doing now, in a few words for the foot of its panel ("Crafting planks"; "Not crafting" while it is
// idle).
function stationStatus(kind: StationKind, recipe: number, active: boolean | number): string {
  const making = active ? STATION_RECIPES[kind][recipe - 1] : undefined
  return making ? `Crafting ${matchName(making.output, making.count > 1).toLowerCase()}` : 'Not crafting'
}
function fireStatus(kind: FireKind, inv: Inventory, heat: number): string {
  const raw = inv.slots[CAMPFIRE_COOK]
  const cooks = raw.count > 0 ? cookingOf(raw.item, kind) : undefined
  if (!cooks) return kind === 'oven' ? 'Not baking' : 'Not cooking'
  const what = matchName(raw.item).toLowerCase()
  if (cooks.smoke) return heat >= cooks.heat ? `Making smoke from ${what}` : `Waiting for ${cooks.heat}° to make smoke from ${what}`
  return heat >= cooks.heat ? `${cooks.oven ? 'Baking' : 'Cooking'} ${what}` : `Waiting for ${cooks.heat}° to cook ${what}`
}
function barrelStatus(barrel: Barrel): string {
  const plan = barrelPlan(barrel, false)
  if (!plan.recipe || !plan.ready) return 'Not making anything'
  const made = plan.recipe.output ? matchName(plan.recipe.output, true) : LIQUIDS[plan.recipe.liquidOut || plan.recipe.liquidInto]
  return `Making ${made.toLowerCase()}`
}

// How far a machine is through what it is doing, 0 to 1, drawn between the factory's last tick and the next.
export function machineProgress(entity: Entity, alpha: number): number | undefined {
  switch (entity.kind) {
    case 'stump':
    case 'workbench':
    case 'carpenter': {
      const recipe = STATION_RECIPES[entity.kind][entity.recipe - 1]
      return recipe && entity.active ? (entity.progress + alpha) / recipe.ticks : 0
    }
    case 'campfire':
    case 'oven':
      return cookFraction(entity)
    case 'barrel':
      return barrelFraction(entity)
    case 'altar':
      return ritualFraction(entity, entity.recipe ? alpha : 0)
    default:
      return undefined
  }
}

function entry(
  id: number,
  category: string,
  output: ItemId,
  count: number,
  inputs: BookEntry['inputs'],
  seconds?: number,
  tool?: { name: string; have: boolean },
): BookEntry {
  return {
    id,
    category,
    output,
    count,
    inputs,
    ...(tool ? { tool } : {}),
    ...(seconds !== undefined ? { seconds } : {}),
    ready: inputs.every((input) => input.have >= input.need) && (tool?.have ?? true),
  }
}

// How often (ms) an "any of a kind" ingredient shows the next item of the kind.
const CYCLE_MS = 1_000

// An ingredient in a book, `have` of it to hand: an item as itself; "#tag" (any item with the tag) named for the kind,
// its picture going through every item of it, one a second.
function ingredient(match: Match, need: number, have: number): BookEntry['inputs'][number] {
  if (typeof match !== 'string') return { item: match, need, have }
  const kind = ITEMS.filter((item) => matches(match, item.id))
  const shown = kind[Math.floor(Date.now() / CYCLE_MS) % Math.max(1, kind.length)]?.id ?? 0
  return { item: shown, need, have, label: `Any ${match.slice(1)} (${shown ? getItem(shown).name : '…'})` }
}

// A station's recipes (the stump's, the workbench's), in the order their categories first come, and in each, what it has
// from the smaller stations first and what is new at it last (see `level` in stations.ts). What the player has
// counts what is already in the station, and a tool it needs counts whether it is on the player or in the station's tool
// slot (it goes in when Craft is pressed, and is not used up).
function stationBook(kind: StationKind, player: Inventory, inv: Inventory): BookEntry[] {
  const layout = STATION_LAYOUT[kind]
  const recipes = STATION_RECIPES[kind]
  const categories = [...new Set(recipes.map((recipe) => recipe.category))]
  return [...recipes]
    .sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category) || a.level - b.level)
    .map((recipe) =>
      entry(
        recipe.index,
        recipe.category,
        recipe.output,
        recipe.count,
        recipe.inputs.map(([match, need]) => ingredient(match, need, haveForStation(player, inv, match, layout.inputs))),
        recipe.ticks / TPS,
        recipe.tool
          ? {
              name: `${recipe.tool[0].toUpperCase()}${recipe.tool.slice(1)} (kept)`,
              have: [...player.slots, inv.slots[layout.tool]].some((slot) => slot !== undefined && slot.count > 0 && getItem(slot.item).tool === recipe.tool),
            }
          : undefined,
      ),
    )
}

// What a campfire or an oven cooks (and how hot it has to be: it is `heat` now; an oven quicker, and what only an oven
// can). What burns away into smoke (leaves) shows smoke as what it makes.
function fireBook(kind: FireKind, player: Inventory, inv: Inventory, heat: number): BookEntry[] {
  const speed = kind === 'oven' ? OVEN_COOK_SPEED : 1
  return fireRecipes(kind).map((recipe) => ({
    ...entry(recipe.index, recipe.oven ? 'Baking' : 'Cooking', recipe.smoke ? recipe.input : recipe.into, 1, [ingredient(recipe.input, 1, haveForStation(player, inv, recipe.input, [CAMPFIRE_COOK]))], recipe.ticks / TPS / speed),
    ...(recipe.smoke ? { outputSmoke: true } : {}),
    heat: { need: recipe.heat, now: heat },
  }))
}

// An altar's rituals: each ingredient counted on the pedestals round it, each liquid in the barrels round it. One can
// be started when everything is there, nothing else is under way, and there is room on the altar for what it makes.
function altarBook(altar: Parameters<typeof altarRoomFor>[0] & { recipe: number }, around: AltarSurroundings | undefined): BookEntry[] {
  const nothing: AltarSurroundings = { pedestals: [], barrels: [] }
  const seen = around ?? nothing
  return ALTAR_RECIPES.map((recipe) => {
    const inputs: Array<BookEntry['inputs'][number]> = recipe.inputs.map(([match, need]) => ingredient(match, need, altarHas(seen, match)))
    for (const [liquid, need] of recipe.liquids) {
      inputs.push({ item: bucketFor(liquid), need, have: altarHasLiquid(seen, liquid), liquid: bookLiquid(liquid) })
    }
    return {
      id: recipe.index,
      category: 'Rituals',
      output: recipe.output,
      count: recipe.count,
      inputs,
      seconds: recipe.ticks / TPS,
      how: 'From the pedestals and barrels round the altar',
      ready: inputs.every((input) => input.have >= input.need) && !altarBusy(altar) && altarRoomFor(altar, recipe),
    }
  })
}

// How a liquid looks in a book.
function bookLiquid(liquid: number): BookLiquid {
  const name = LIQUIDS[liquid] || 'water'
  return { name, tone: liquidLook(name).tone }
}

// What a barrel makes (see "barrel" in stations.json). A liquid shows as itself (what the player has counts what is in
// the barrel and the buckets of it they carry); a "#tag" ingredient as the kind, its picture going through every item of
// it, one a second; and the heat a recipe needs, against how hot the barrel is (`heat`).
function barrelBook(player: Inventory, inv: Inventory, liquid: number, amount: number, heat: number): BookEntry[] {
  const everySlot = [...player.slots.keys()]
  const solid = (match: Match): number =>
    countIn(player, everySlot, (item) => matches(match, item)) + countIn(inv, BARREL_SOLIDS, (item) => matches(match, item))
  return BARREL_RECIPES.map((recipe) => {
    const inputs: Array<BookEntry['inputs'][number]> = []
    if (recipe.liquid) {
      const bucket = bucketFor(recipe.liquid)
      const each = recipe.liquidPerSolid > 0 ? ` (${recipe.liquidPerSolid} per ${matchName(recipe.solids[0][0])})` : ''
      const name = LIQUIDS[recipe.liquid][0].toUpperCase() + LIQUIDS[recipe.liquid].slice(1)
      inputs.push({
        item: bucket,
        need: recipe.liquidPerSolid || recipe.liquidMin,
        have: (liquid === recipe.liquid ? amount : 0) + countOf(player, bucket),
        liquid: bookLiquid(recipe.liquid),
        ...(each ? { label: name + each } : {}),
      })
    }
    for (const [match, need] of recipe.solids) inputs.push(ingredient(match, need, solid(match)))
    for (const [match, per] of recipe.perBucket) {
      const input = ingredient(match, per, solid(match))
      inputs.push({ ...input, label: `${input.label ?? getItem(input.item).name} (${per} per bucket)` })
    }
    const how = barrelHow(recipe)
    // A dry recipe: nothing liquid may be in the barrel.
    const dry = recipe.dry ? { ok: amount === 0 } : undefined
    // The liquid it makes, if it makes one rather than an item: one it turns its liquid into, or makes from solids.
    const madeLiquid = recipe.liquidOut || recipe.liquidInto
    return {
      id: recipe.index,
      category: recipe.sealed ? 'Sealed' : 'Open',
      output: recipe.output || bucketFor(madeLiquid),
      ...(recipe.output ? {} : { outputLiquid: bookLiquid(madeLiquid) }),
      count: recipe.output || recipe.liquidOut ? recipe.count : 1,
      inputs,
      ...(recipe.heat ? { heat: { need: recipe.heat, now: heat } } : {}),
      ...(dry ? { dry } : {}),
      seconds: recipe.ticks / TPS,
      how: how.text,
      ready: inputs.every((input) => input.have >= input.need) && heat >= recipe.heat && (dry?.ok ?? true),
    }
  })
}
