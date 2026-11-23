import cropsData from '../../../data/crops.json' with { type: 'json' }
import { failIn, fieldsOf, onlyFields, textField, wholeField } from './data-check.ts'
import { getItem, itemFromKey, type ItemId } from './items.ts'

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

export const CROPS: readonly CropDef[] = parseCrops(cropsData)

function parseCrops(data: unknown): CropDef[] {
  if (!Array.isArray(data)) throw new Error('data/crops.json must be a list of crops.')
  return data.map((entry: unknown, index): CropDef => {
    const fail = failIn(`data/crops.json, crop ${index + 1}`)
    const raw = fieldsOf(entry, 'it', fail)
    onlyFields(raw, ['id', 'key', 'name', 'seed', 'growTicks', 'produce', 'produceMin', 'produceMax', 'seedsMin', 'seedsMax'], fail)
    const crop: CropDef = {
      id: wholeField(raw, 'id', fail, 1),
      key: textField(raw, 'key', fail),
      name: textField(raw, 'name', fail),
      seed: itemFromKey(raw.seed, fail),
      growTicks: wholeField(raw, 'growTicks', fail, 1),
      produce: itemFromKey(raw.produce, fail),
      produceMin: wholeField(raw, 'produceMin', fail),
      produceMax: wholeField(raw, 'produceMax', fail),
      seedsMin: wholeField(raw, 'seedsMin', fail),
      seedsMax: wholeField(raw, 'seedsMax', fail),
    }
    if (crop.produceMax < crop.produceMin || crop.seedsMax < crop.seedsMin) fail('a "...Max" is less than its "...Min"')
    if (getItem(crop.seed).crop !== crop.key) fail(`its seed (${getItem(crop.seed).key}) does not say "crop": "${crop.key}" in items.json`)
    return crop
  })
}

const byId = new Map(CROPS.map((crop) => [crop.id, crop]))
const byKey = new Map(CROPS.map((crop) => [crop.key, crop]))

export function getCrop(id: number): CropDef | undefined {
  return byId.get(id)
}

// The crop a seed grows into, if the item is a seed.
export function cropOfSeed(item: ItemId): CropDef | undefined {
  const key = getItem(item).crop
  return key === undefined ? undefined : byKey.get(key)
}
