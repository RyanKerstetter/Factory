import itemsData from '../../../data/items.json' with { type: 'json' }
import { isBuildingKind, type BuildingKind } from './buildings.ts'
import { TPS } from './constants.ts'

// The items in the game. In the simulation an item is its number (`ItemId`); 0 is no item.
export type ItemId = number
export const NO_ITEM: ItemId = 0

export type ItemDef = {
  id: ItemId
  // The name its art is found by (see the client's art catalog) and the name used in messages.
  key: string
  name: string
  // The colour of its placeholder art, until it has a picture.
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
  // What it does when held in the picked hotbar slot (see tools.ts), if it is a tool.
  tool?: ToolKind
  // The most that fit in one slot, if fewer than an inventory's usual stack (a tool does not stack).
  stack?: number
  // Words that group items, such as "seed" or "meat": what an animal eats can be named by one (see animals.ts).
  tags: readonly string[]
  // The crop it grows into when planted in a garden plot, by the crop's key (see crops.ts), if it is a seed.
  crop?: string
  // Its picture, as a path under res/ (the client draws a placeholder in its colour where there is none).
  icon?: string
  // Burnt in a campfire: how hot it can get the fire (see machines.ts), and how long one lasts, in ticks.
  fuel?: { heat: number; ticks: number }
  // Cooked on a campfire: what it becomes (by key), the heat it needs, and how long it takes at that heat, in ticks.
  cooks?: { into: string; heat: number; ticks: number }
  // A bucket, and what is in it.
  bucket?: string
}

const CATEGORIES = ['ore', 'plant', 'mineral', 'tool', 'weapon', 'food', 'material', 'animal', 'structure'] as const
export type ItemCategory = (typeof CATEGORIES)[number]
const TOOL_KINDS = ['axe', 'pickaxe', 'knife'] as const
export type ToolKind = (typeof TOOL_KINDS)[number]

// Every item, from data/items.json. Their numbers are part of the save format and the protocol, so a new item takes
// the next number. In the file a colour is written "#rrggbb", and `mineTicks` and `weight` can be left out (0).
const isWhole = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min

export const ITEMS: readonly ItemDef[] = parseItems(itemsData)

// Reads the items file, and says plainly what is wrong with it if anything is, so a typo fails at start-up and not in
// the middle of a game.
function parseItems(data: unknown): ItemDef[] {
  if (!Array.isArray(data)) throw new Error('data/items.json must be a list of items.')
  const seenIds = new Set<number>()
  const seenKeys = new Set<string>()
  return data.map((raw: Record<string, unknown>, index): ItemDef => {
    const label = typeof raw?.key === 'string' ? ` (${raw.key})` : ''
    const fail = (problem: string): never => {
      throw new Error(`data/items.json, item ${index + 1}${label}: ${problem}`)
    }
    if (typeof raw !== 'object' || raw === null) fail('is not an object')
    const { id, key, name, color, category, mineTicks = 0, weight = 0, places, tool, stack, tags = [], crop, icon, fuel, cooks, bucket } = raw
    const seconds = (value: unknown, what: string): number =>
      typeof value === 'number' && value > 0 ? Math.max(1, Math.round(value * TPS)) : fail(`"${what}" must be a number of seconds above 0`)
    const heat = (value: unknown, what: string): number => (isWhole(value, 0) ? value : fail(`"${what}" must be a whole number, 0 or more`))
    const fuelDef = fuel as { heat?: unknown; seconds?: unknown } | undefined
    const cooksDef = cooks as { into?: unknown; heat?: unknown; seconds?: unknown } | undefined
    if (cooksDef !== undefined && typeof cooksDef.into !== 'string') fail('"cooks.into" must be the key of an item')
    if (bucket !== undefined && typeof bucket !== 'string') fail('"bucket" must be "empty" or the name of the liquid it holds')
    if (!isWhole(id, 1)) return fail('"id" must be a whole number above 0')
    if (seenIds.has(id)) fail(`"id" ${id} is used twice`)
    if (typeof key !== 'string' || !/^[a-z0-9-]+$/.test(key)) return fail('"key" must be lower-case letters, digits and dashes')
    if (seenKeys.has(key)) fail(`"key" ${key} is used twice`)
    if (typeof name !== 'string' || name === '') return fail('"name" must be some text')
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail('"color" must look like "#a1b2c3"')
    if (!CATEGORIES.includes(category as ItemCategory)) fail(`"category" must be one of ${CATEGORIES.join(', ')}`)
    if (!isWhole(mineTicks, 0)) return fail('"mineTicks" must be a whole number, 0 or more')
    if (!isWhole(weight, 0)) return fail('"weight" must be a whole number, 0 or more')
    if (places !== undefined && !isBuildingKind(places)) fail(`"places" ${String(places)} is not a building`)
    if (tool !== undefined && !TOOL_KINDS.includes(tool as ToolKind)) fail(`"tool" must be one of ${TOOL_KINDS.join(', ')}`)
    if (stack !== undefined && !isWhole(stack, 1)) fail('"stack" must be a whole number above 0')
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) fail('"tags" must be a list of words')
    if (crop !== undefined && typeof crop !== 'string') fail('"crop" must be the key of a crop')
    if (icon !== undefined && (typeof icon !== 'string' || !icon.endsWith('.png'))) fail('"icon" must be a .png path under res/')
    seenIds.add(id)
    seenKeys.add(key)
    return {
      id,
      key,
      name,
      color: Number.parseInt(color.slice(1), 16),
      category: category as ItemCategory,
      mineTicks,
      weight,
      ...(places !== undefined ? { places: places as BuildingKind } : {}),
      ...(tool !== undefined ? { tool: tool as ToolKind } : {}),
      ...(stack !== undefined ? { stack: stack as number } : {}),
      tags: tags as string[],
      ...(crop !== undefined ? { crop: crop as string } : {}),
      ...(icon !== undefined ? { icon: icon as string } : {}),
      ...(fuelDef ? { fuel: { heat: heat(fuelDef.heat, 'fuel.heat'), ticks: seconds(fuelDef.seconds, 'fuel.seconds') } } : {}),
      ...(cooksDef ? { cooks: { into: cooksDef.into as string, heat: heat(cooksDef.heat, 'cooks.heat'), ticks: seconds(cooksDef.seconds, 'cooks.seconds') } } : {}),
      ...(bucket !== undefined ? { bucket: bucket as string } : {}),
    }
  })
}

// The ores alone, which are what deposits are made of.
export const ORES: readonly ItemDef[] = ITEMS.filter((item) => item.category === 'ore')

const byId = new Map(ITEMS.map((item) => [item.id, item]))
const byKey = new Map(ITEMS.map((item) => [item.key, item]))

export function isItemId(value: unknown): value is ItemId {
  return typeof value === 'number' && byId.has(value)
}

export function getItem(id: ItemId): ItemDef {
  const item = byId.get(id)
  if (!item) throw new Error(`There is no item ${id}.`)
  return item
}

// How many of an item fit in one slot of an inventory whose stacks are `stack`.
export function stackLimit(id: ItemId, stack: number): number {
  return Math.min(stack, byId.get(id)?.stack ?? stack)
}

export function itemByKey(key: string): ItemDef | undefined {
  return byKey.get(key)
}

// An item's number by its key, for code that names a particular item. Throws for a key that is not an item.
export function itemId(key: string): ItemId {
  const item = byKey.get(key)
  if (!item) throw new Error(`There is no item called ${key}.`)
  return item.id
}
