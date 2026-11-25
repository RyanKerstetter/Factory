import dropsData from '../../../data/drops.json' with { type: 'json' }
import { failIn, fieldsOf, numberField, onlyFields, wholeField, type Fail } from './data-check.ts'
import { itemFromKey, type ItemId } from './items.ts'

// What plants and rocks drop, from data/drops.json (where to tweak it; the animals' and monsters' drops are in their
// own files). Each list is of items, each `min` to `max` of it (both included), `chance` percent of the time (always,
// left out). How many is a hash of the seed and the plant, so the same one always drops the same; a `chance` is rolled
// on every hit.
//
// - `tree`: `felled` when an axe brings it down; every
//   `punchesPerBranch` punches (or knife hits) knock a `branch` loose (`branchWithKnife` with a knife), as long as it
//   is punched.
// - `bush`, `rock`: `broken` when it is gone; and so on the meadow and in the desert `clay`, `copper-rock`, `tin-rock`,
//   `sand`, `cactus` and a `sunflower` (a sunflower seedling `dug` back up gives the sunflower's `dug`), and a spider's
//   `cobweb`.
// - `grass`: `pulled` by hand, `cut` with a knife.
// - `sapling`, `sprout`: `dug` back up.

export type DropEntry = { item: ItemId; min: number; max: number; chance: number }
export type DropList = readonly DropEntry[]

export type DropTables = {
  tree: { felled: DropList; punchesPerBranch: number; branch: DropList; branchWithKnife: DropList }
  bush: { broken: DropList }
  rock: { broken: DropList }
  grass: { pulled: DropList; cut: DropList }
  sapling: { dug: DropList }
  sprout: { dug: DropList }
  clay: { broken: DropList }
  'copper-rock': { broken: DropList }
  'tin-rock': { broken: DropList }
  sand: { broken: DropList }
  cactus: { broken: DropList }
  sunflower: { broken: DropList; dug: DropList }
  cobweb: { broken: DropList }
}

const SHAPE: Readonly<Record<keyof DropTables, readonly string[]>> = {
  tree: ['felled', 'punchesPerBranch', 'branch', 'branchWithKnife'],
  bush: ['broken'],
  rock: ['broken'],
  grass: ['pulled', 'cut'],
  sapling: ['dug'],
  sprout: ['dug'],
  clay: ['broken'],
  'copper-rock': ['broken'],
  'tin-rock': ['broken'],
  sand: ['broken'],
  cactus: ['broken'],
  sunflower: ['broken', 'dug'],
  cobweb: ['broken'],
}

export const DROP_TABLES: Readonly<DropTables> = parseDrops(dropsData)

function parseDrops(data: unknown): DropTables {
  const top = fieldsOf(data, 'data/drops.json', failIn('data/drops.json'))
  onlyFields(top, Object.keys(SHAPE), failIn('data/drops.json'))
  const tables: Record<string, Record<string, unknown>> = {}
  for (const [what, fields] of Object.entries(SHAPE)) {
    const fail: Fail = failIn(`data/drops.json, ${what}`)
    const raw = fieldsOf(top[what], 'it', fail)
    onlyFields(raw, fields, fail)
    const table: Record<string, unknown> = {}
    for (const field of fields) {
      if (field === 'punchesPerBranch') table[field] = wholeField(raw, field, fail, 1)
      else table[field] = listOf(raw[field], `"${field}"`, fail)
    }
    tables[what] = table
  }
  return tables as unknown as DropTables
}

function listOf(value: unknown, what: string, fail: Fail): DropList {
  if (!Array.isArray(value)) fail(`${what} must be a list of drops`)
  return (value as unknown[]).map((entry) => {
    const drop = fieldsOf(entry, `each of ${what}`, fail)
    onlyFields(drop, ['item', 'min', 'max', 'chance'], fail, `${what}: `)
    const min = wholeField(drop, 'min', fail)
    const max = wholeField(drop, 'max', fail)
    if (max < min) fail(`${what}: "max" must not be less than "min"`)
    return { item: itemFromKey(drop.item, fail), min, max, chance: numberField(drop, 'chance', fail, 0, 100) }
  })
}
