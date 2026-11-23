import armorData from '../../../data/armor.json' with { type: 'json' }
import foodData from '../../../data/food.json' with { type: 'json' }
import itemsData from '../../../data/items.json' with { type: 'json' }
import { isBuildingKind, type BuildingKind } from './buildings.ts'
import { failIn, fieldsOf, onlyFields, secondsField, textField, wholeField, type Fail, type Fields } from './data-check.ts'

// The items in the game. In the simulation an item is its number (`ItemId`); 0 is no item.
export type ItemId = number
export const NO_ITEM: ItemId = 0

export type ItemDef = {
  id: ItemId
  // How data files and the code name it (lower-case letters, digits and dashes).
  key: string
  name: string
  // The colour of its stand-in picture, until it has one (see the client's ui/icons.ts).
  color: number
  // Ores are found in deposits and dug by miners; plants' items come from punching plants; minerals from rocks and
  // the ground; tools are crafted.
  category: ItemCategory
  // How many ticks a miner takes to dig one out of a deposit of it (ores only; 0 for anything else).
  mineTicks: number
  // How common its deposits are, relative to the other ores (0 for anything that is not an ore).
  weight: number
  // What it becomes when placed on the ground with a right click, if anything: an acorn is planted as a sapling.
  places?: BuildingKind
  // The kind of tool it is, if it is one: what it can chop, break or cut (see `resourceDamage` in weapons.ts), and the
  // tool a station recipe can ask for (see stations.ts).
  tool?: ToolKind
  // The most that fit in one slot, if fewer than an inventory's usual stack (a tool does not stack).
  stack?: number
  // Words that group items, such as "seed" or "meat": what an animal eats can be named by one (see animals.ts).
  tags: readonly string[]
  // The crop it grows into when planted in a garden plot, by the crop's key (see crops.ts), if it is a seed.
  crop?: string
  // Its picture, as a path under res/ (the client draws a stand-in in its colour where there is none).
  icon?: string
  // Burnt in a campfire: how hot it can get the fire (see machines.ts), and how long one lasts, in ticks.
  fuel?: { heat: number; ticks: number }
  // Cooked on a campfire or in an oven: what it becomes, the heat it needs, and how long it takes at that heat, in
  // A bucket, and what is in it.
  bucket?: string
  // Armour: the slot it is worn in, how many degrees warmer it keeps its wearer (see cold.ts), and how much less damage
  // each hit does to them (see `damageAfterArmor`).
  armor?: { slot: ArmorSlot; warmth: number; defense: number }
  // Food: how much health eating one gives back.
  heals?: number
}

export const ARMOR_SLOTS = ['head', 'body', 'feet'] as const
export type ArmorSlot = (typeof ARMOR_SLOTS)[number]

const CATEGORIES = ['ore', 'plant', 'mineral', 'tool', 'weapon', 'food', 'material', 'animal', 'structure', 'armor'] as const
export type ItemCategory = (typeof CATEGORIES)[number]
const TOOL_KINDS = ['axe', 'pickaxe', 'knife', 'mortar'] as const
export type ToolKind = (typeof TOOL_KINDS)[number]

// Every item, from data/items.json. Their numbers are part of the save format and the protocol, so a new item takes
// the next number. In the file a colour is written "#rrggbb", and `mineTicks` and `weight` can be left out (0).
//
// What each item is lives in data/items.json; the numbers to tune live beside others of their kind, by item key:
// data/food.json (how much a food heals; what a fire cooks is in data/stations.json, "fire") and data/armor.json (its
// slot, warmth and defense). (Weapons are data/weapons.json, read in weapons.ts.) They are put onto their items before
// the items are read, so each is checked as part of its item.
const ITEM_FIELDS = ['id', 'key', 'name', 'category', 'color', 'mineTicks', 'weight', 'places', 'tool', 'stack', 'tags', 'crop', 'icon', 'fuel', 'bucket']
const STAT_FILES = [
  { file: 'food.json', data: foodData as Record<string, unknown>, fields: ['heals'] },
  { file: 'armor.json', data: armorData as Record<string, unknown>, fields: ['slot', 'warmth', 'defense'] },
] as const

export const ITEMS: readonly ItemDef[] = parseItems(itemsData)

const byId = new Map(ITEMS.map((item) => [item.id, item]))
const byKey = new Map(ITEMS.map((item) => [item.key, item]))

function parseItems(data: unknown): ItemDef[] {
  if (!Array.isArray(data)) throw new Error('data/items.json must be a list of items.')
  const keys = new Set(data.map((raw: Record<string, unknown>) => raw?.key))
  for (const { file, data: stats, fields } of STAT_FILES) {
    for (const [key, entry] of Object.entries(stats)) {
      const fail = failIn(`data/${file}, ${key}`)
      if (!keys.has(key)) fail('there is no item of that key in data/items.json')
      onlyFields(fieldsOf(entry, 'it', fail), fields, fail)
    }
  }
  const seenIds = new Set<number>()
  const seenKeys = new Set<string>()
  const items = data.map((entry: unknown, index): ItemDef => {
    const label = typeof (entry as Fields)?.key === 'string' ? ` (${(entry as Fields).key})` : ''
    const fail = failIn(`data/items.json, item ${index + 1}${label}`)
    const raw = fieldsOf(entry, 'it', fail)
    onlyFields(raw, ITEM_FIELDS, fail)
    const key = textField(raw, 'key', fail)
    if (!/^[a-z0-9-]+$/.test(key)) fail('"key" must be lower-case letters, digits and dashes')
    if (seenKeys.has(key)) fail(`"key" ${key} is used twice`)
    const id = wholeField(raw, 'id', fail, 1)
    if (seenIds.has(id)) fail(`"id" ${id} is used twice`)
    seenIds.add(id)
    seenKeys.add(key)
    // Its food and armour, from their own files.
    const food = foodData[key as keyof typeof foodData] as Fields | undefined
    const armor = armorData[key as keyof typeof armorData] as Fields | undefined
    const color = textField(raw, 'color', fail)
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail('"color" must look like "#a1b2c3"')
    const category = raw.category as ItemCategory
    if (!CATEGORIES.includes(category)) fail(`"category" must be one of ${CATEGORIES.join(', ')}`)
    const { places, tool, crop, icon, bucket, tags = [] } = raw
    if (places !== undefined && !isBuildingKind(places)) fail(`"places" ${String(places)} is not a building`)
    if (tool !== undefined && !TOOL_KINDS.includes(tool as ToolKind)) fail(`"tool" must be one of ${TOOL_KINDS.join(', ')}`)
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) fail('"tags" must be a list of words')
    if (crop !== undefined && typeof crop !== 'string') fail('"crop" must be the key of a crop')
    if (icon !== undefined && (typeof icon !== 'string' || !icon.endsWith('.png'))) fail('"icon" must be a .png path under res/')
    if (bucket !== undefined && typeof bucket !== 'string') fail('"bucket" must be "empty" or the name of the liquid it holds')
    const fuel = raw.fuel === undefined ? undefined : fieldsOf(raw.fuel, '"fuel"', fail)
    if (fuel) onlyFields(fuel, ['heat', 'seconds'], fail, '"fuel": ')
    if (armor && !ARMOR_SLOTS.includes(armor.slot as ArmorSlot)) fail(`"slot" (armor.json) must be one of ${ARMOR_SLOTS.join(', ')}`)
    return {
      id,
      key,
      name: textField(raw, 'name', fail),
      color: Number.parseInt(color.slice(1), 16),
      category,
      mineTicks: wholeField(raw, 'mineTicks', fail, 0, 0),
      weight: wholeField(raw, 'weight', fail, 0, 0),
      ...(places !== undefined ? { places: places as BuildingKind } : {}),
      ...(tool !== undefined ? { tool: tool as ToolKind } : {}),
      ...(raw.stack !== undefined ? { stack: wholeField(raw, 'stack', fail, 1) } : {}),
      tags: tags as string[],
      ...(crop !== undefined ? { crop: crop as string } : {}),
      ...(icon !== undefined ? { icon: icon as string } : {}),
      ...(fuel ? { fuel: { heat: wholeField(fuel, 'heat', fail), ticks: secondsField(fuel, 'seconds', fail) } } : {}),
      ...(bucket !== undefined ? { bucket: bucket as string } : {}),
      ...(armor ? { armor: { slot: armor.slot as ArmorSlot, warmth: wholeField(armor, 'warmth', fail), defense: wholeField(armor, 'defense', fail, 0, 0) } } : {}),
      ...(food?.heals !== undefined ? { heals: wholeField(food, 'heals', fail, 1) } : {}),
    }
  })
  return items
}

// An item's number from its key in a data file, failing with a clear message if there is no such item.
export function itemFromKey(key: unknown, fail: Fail): ItemId {
  const found = typeof key === 'string' ? byKey.get(key) : undefined
  return found ? found.id : fail(`there is no item "${String(key)}"`)
}

// The ores alone, which are what deposits are made of.
export const ORES: readonly ItemDef[] = ITEMS.filter((item) => item.category === 'ore')

export function getItem(id: ItemId): ItemDef {
  const item = byId.get(id)
  if (!item) throw new Error(`There is no item ${id}.`)
  return item
}

// How many of an item fit in one slot of an inventory whose stacks are `stack`.
export function stackLimit(id: ItemId, stack: number): number {
  return Math.min(stack, byId.get(id)?.stack ?? stack)
}

// Items that have been renamed: the key a save made before may still have, and the key it is now (so the save keeps
// them).
const RENAMED: Readonly<Record<string, string>> = { twine: 'fiber' }

export function itemByKey(key: string): ItemDef | undefined {
  return byKey.get(key) ?? (Object.hasOwn(RENAMED, key) ? byKey.get(RENAMED[key]) : undefined)
}

// An ingredient in a recipe: an item, or "#tag" for any item with that tag (a station's "#cooked meat", a barrel's
// "#organic").
export type Match = ItemId | `#${string}`

// Ingredients by item key or "#tag", and how many of each, from a data file.
export function matchesOf(value: unknown, fail: Fail): Array<readonly [Match, number]> {
  const list: Fields = fieldsOf(value ?? {}, 'ingredients', fail)
  return Object.keys(list).map((key) => {
    const match = key.startsWith('#') ? (key as Match) : itemFromKey(key, fail)
    if (typeof match === 'string' && !ITEMS.some((item) => item.tags.includes(match.slice(1)))) fail(`no item has the tag "${match.slice(1)}"`)
    return [match, wholeField(list, key, fail, 1)] as const
  })
}

// Whether an item is what an ingredient names.
export function matches(match: Match, item: ItemId): boolean {
  return typeof match === 'string' ? getItem(item).tags.includes(match.slice(1)) : match === item
}

// Words for an ingredient ("dried hide", "cooked meat things").
export function matchName(match: Match, plural = false): string {
  if (typeof match === 'string') return `${match.slice(1)} thing${plural ? 's' : ''}`
  const name = getItem(match).name.toLowerCase()
  return plural && !name.endsWith('s') ? `${name}s` : name
}

// An item's number by its key, for code that names a particular item. Throws for a key that is not an item.
export function itemId(key: string): ItemId {
  const item = byKey.get(key)
  if (!item) throw new Error(`There is no item called ${key}.`)
  return item.id
}
