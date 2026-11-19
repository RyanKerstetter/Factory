import cropsData from '../../../data/crops.json' with { type: 'json' }
import { getItem, itemByKey, type ItemId } from './items.ts'

// What grows in a garden plot, from data/crops.json. A seed is planted in a plot with a right click (an item names its
// crop with `crop`); the crop grows a step on each of the plot's random ticks (about 11 seconds each, on average), and
// is grown after `growTicks` of them. Breaking a grown crop gives `produceMin` to `produceMax` of its produce and
// `seedsMin` to `seedsMax` seeds; breaking one that is still growing gives its seed back. A crop's number is part of a
// plot's state, so a new one takes the next number.
export type CropDef = {
  id: number
  key: string
  name: string
  seed: ItemId
  growTicks: number
  produce: ItemId
  produceMin: number
  produceMax: number
  seedsMin: number
  seedsMax: number
}

const isWhole = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min

export const CROPS: readonly CropDef[] = parseCrops(cropsData)

function parseCrops(data: unknown): CropDef[] {
  if (!Array.isArray(data)) throw new Error('data/crops.json must be a list of crops.')
  return data.map((raw: Record<string, unknown>, index): CropDef => {
    const fail = (problem: string): never => {
      throw new Error(`data/crops.json, crop ${index + 1}: ${problem}`)
    }
    const item = (key: unknown): ItemId => {
      const found = typeof key === 'string' ? itemByKey(key) : undefined
      return found ? found.id : fail(`there is no item "${String(key)}"`)
    }
    const whole = (name: string, min: number): number => {
      const value = raw[name]
      return isWhole(value, min) ? value : fail(`"${name}" must be a whole number, ${min} or more`)
    }
    if (typeof raw.key !== 'string' || typeof raw.name !== 'string') fail('"key" and "name" must be text')
    const crop: CropDef = {
      id: whole('id', 1),
      key: raw.key as string,
      name: raw.name as string,
      seed: item(raw.seed),
      growTicks: whole('growTicks', 1),
      produce: item(raw.produce),
      produceMin: whole('produceMin', 0),
      produceMax: whole('produceMax', 0),
      seedsMin: whole('seedsMin', 0),
      seedsMax: whole('seedsMax', 0),
    }
    if (crop.produceMax < crop.produceMin || crop.seedsMax < crop.seedsMin) fail('a "...Max" is less than its "...Min"')
    if (getItem(crop.seed).crop !== crop.key) fail(`its seed (${getItem(crop.seed).key}) does not say "crop": "${crop.key}" in items.json`)
    return crop
  })
}

export function getCrop(id: number): CropDef | undefined {
  return CROPS.find((crop) => crop.id === id)
}

// The crop a seed grows into, if the item is a seed.
export function cropOfSeed(item: ItemId): CropDef | undefined {
  const key = getItem(item).crop
  return key === undefined ? undefined : CROPS.find((crop) => crop.key === key)
}
