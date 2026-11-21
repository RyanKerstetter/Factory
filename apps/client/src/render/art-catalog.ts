import { ANIMALS, BUILDINGS, CROPS, gateRunsAcross, getCrop, growthNeeded, hashInts, ITEMS, ORES, type ItemId } from '../../../../packages/shared/src/index.ts'
import * as draw from './placeholders.ts'
import type { BuildingView } from './world-renderer.ts'

// Every picture the game draws, by name, and where its file goes under res/. To replace a placeholder with real art,
// save a PNG at its path: the game draws the file wherever there is one, and the placeholder only where there is not.
// No code changes are needed (the dev server picks a new file up on reload; a hosted build needs rebuilding).
//
// - Buildings fill one tile, whatever size the picture is (square pixel art at 32 or 64 pixels looks best). Those
//   that face a way are drawn facing east (right), and turned to face the others.
// - Rocks fill their tile, seen from above.
// - Plants are seen from above. A tree is drawn 1.6 tiles across, its canopy spreading over the tiles round it; a
//   bush fills its tile; a sapling is drawn small and grows as it does, and a berry sprout is a small bush.
// - A fence is drawn from one of 16 pictures, buildings/fence/fence-<n>.png, by which sides it joins its neighbours on
//   (n is north 1 + east 2 + south 4 + west 8 for the sides it joins). A gate is buildings/gate/gate-<h|v>-<open|shut>.png,
//   h when it runs east to west.
// - A crop in a garden plot is buildings/crops/<crop>/<crop>-<sprout|mid|full>.png, drawn a tile wide and as tall as
//   the picture is for its width, standing in the plot.
// - Animals are entities/<kind>.png, drawn facing left (ANIMAL_ART_FACES_LEFT) and turned to face the way they walk.
// - A belt or extractor that turns a corner is drawn from its `-curve` picture: fed from the top, carrying out to the
//   right. A corner the other way is the same picture flipped.
// - Items are drawn a quarter of a tile across on belts, and larger in the inventory. An item's picture is its `icon`
//   in data/items.json (an ore's is icons/ores/<ore>.png).
// - Ground tiles fill one tile and repeat.
export type ArtEntry = {
  // The path under res/.
  file: string
  placeholder: draw.Painter
}

// Whether the animal pictures face left (they are flipped to face right when the animal walks that way).
export const ANIMAL_ART_FACES_LEFT = true

const entries: Record<string, ArtEntry> = {
  'tile/ground': { file: 'tiles/ground.png', placeholder: draw.ground },
  'tile/water': { file: 'tiles/water.png', placeholder: draw.water },
  'building/workbench': { file: 'icons/buildings/workbench.png', placeholder: draw.workbench },
  'building/campfire': { file: 'buildings/campfire.png', placeholder: draw.campfire(false) },
  'building/campfire-lit': { file: 'buildings/campfire-lit.png', placeholder: draw.campfire(true) },
  'building/barrel': { file: 'buildings/barrel.png', placeholder: draw.barrel },
  'building/rack': { file: 'buildings/drying-rack.png', placeholder: draw.rack },
  'building/miner': { file: 'buildings/miner.png', placeholder: draw.miner },
  'building/extractor': { file: 'buildings/extractor.png', placeholder: draw.extractor },
  'building/extractor-curve': { file: 'buildings/extractor-curve.png', placeholder: draw.extractorCurve },
  'building/belt': { file: 'buildings/belt.png', placeholder: draw.belt },
  'building/belt-curve': { file: 'buildings/belt-curve.png', placeholder: draw.beltCurve },
  'building/chest': { file: 'icons/buildings/chest.png', placeholder: draw.chest },
  'building/stump': { file: 'icons/buildings/stump.png', placeholder: draw.log },
  'building/plot': { file: 'buildings/plot.png', placeholder: draw.plot },
  'building/feeder': { file: 'buildings/feed-box.png', placeholder: draw.feeder },
  'building/bed': { file: 'icons/buildings/bed.png', placeholder: draw.bed },
  'building/door': { file: 'buildings/ice-door.png', placeholder: draw.item(0x9fd6ff) },
  'plant/tree': { file: 'plants/tree.png', placeholder: draw.tree },
  'plant/bush': { file: 'plants/bush.png', placeholder: draw.bush },
  'plant/sapling': { file: 'buildings/sapling.png', placeholder: draw.sapling },
  'plant/sprout': { file: 'plants/berry-sprout.png', placeholder: draw.berrySprout },
  'plant/grass': { file: 'buildings/grass-tuft.png', placeholder: draw.grass },
  player: { file: 'player/player.png', placeholder: draw.player },
}

// The placeholders of items that have their own (anything else is a gem in its colour).
const ITEM_PLACEHOLDERS: Readonly<Record<string, draw.Painter>> = {
  log: draw.log,
  stick: draw.stick,
  acorn: draw.acorn,
  twine: draw.twine,
  berries: draw.berries,
  flint: draw.flint,
  stone: draw.stone,
  pickaxe: draw.pickaxe,
  axe: draw.axe,
  knife: draw.knife,
  steak: draw.steak,
  'raw-chicken': draw.rawChicken,
  milk: draw.milk,
  'garden-plot': draw.plot,
  'feed-box': draw.feeder,
  fence: draw.fence(2 | 8),
  gate: draw.gate(true, false),
  campfire: draw.campfire(false),
  barrel: draw.barrel,
  'drying-rack': draw.rack,
  bucket: draw.bucket(undefined),
  'water-bucket': draw.bucket('#4d8fd1'),
  'tannin-bucket': draw.bucket('#7a4a22'),
  bark: draw.bark,
  compost: draw.compost,
  'dried-hide': draw.hide('#a87a4f'),
}

// Rocks come in ROCK_VARIANTS pictures, res/buildings/rocks/rock1.png and on; each rock is drawn with one of them,
// picked by its tile (see `buildingArt`), so the same rock always looks the same on every page.
export const ROCK_VARIANTS = 6
for (let n = 1; n <= ROCK_VARIANTS; n++) {
  entries[`plant/rock/${n}`] = { file: `buildings/rocks/rock${n}.png`, placeholder: draw.rock }
}
for (let mask = 0; mask < 16; mask++) {
  entries[`building/fence/${mask}`] = { file: `buildings/fence/fence-${mask}.png`, placeholder: draw.fence(mask) }
}
for (const axis of ['h', 'v'] as const) {
  for (const state of ['open', 'shut'] as const) {
    entries[`building/gate/${axis}-${state}`] = { file: `buildings/gate/gate-${axis}-${state}.png`, placeholder: draw.gate(axis === 'h', state === 'open') }
  }
}
// The pictures a crop is drawn with in 2D, as it grows (the 3D view has CROP_GROWTH_STAGES models: see cropStage).
export const CROP_STAGES = ['sprout', 'mid', 'full'] as const
for (const crop of CROPS) {
  for (const stage of CROP_STAGES) {
    entries[`crop/${crop.key}/${stage}`] = { file: `buildings/crops/${crop.key}/${crop.key}-${stage}.png`, placeholder: draw.crop(stage) }
  }
}
// The colours of the animals' placeholders.
const ANIMAL_COLORS: Readonly<Record<string, number>> = { cow: 0x8a5a3a, chicken: 0xe8e0cf, deer: 0x9a6a40, wolf: 0x7d828c, skeleton: 0xe6dfc8, 'skeleton-archer': 0xd8d0b8, 'frost-lich': 0x22314e }
for (const def of ANIMALS) {
  entries[animalArt(def.kind)] = { file: `entities/${def.kind}.png`, placeholder: draw.animal(ANIMAL_COLORS[def.kind] ?? 0xb0a080) }
}

for (const def of ITEMS) {
  const file = def.icon ?? (def.category === 'ore' ? `icons/ores/${def.key}.png` : `icons/items/${def.key}.png`)
  entries[itemArt(def.id)] = { file, placeholder: ITEM_PLACEHOLDERS[def.key] ?? draw.item(def.color) }
}
for (const def of ORES) {
  entries[oreTileArt(def.id)] = { file: `tiles/ore-${def.key}.png`, placeholder: draw.oreTile(def.color) }
}

export const ART_CATALOG: Readonly<Record<string, ArtEntry>> = entries

export function itemArt(item: ItemId): string {
  return `item/${ITEMS.find((def) => def.id === item)?.key ?? 'unknown'}`
}

export function oreTileArt(item: ItemId): string {
  return `tile/ore/${ITEMS.find((def) => def.id === item)?.key ?? 'unknown'}`
}

export function animalArt(kind: string): string {
  return `animal/${kind}`
}

// The picture of a crop that has grown `growth` of the `growTicks` it takes, and its stage (0 to stages - 1; the last
// only once it is fully grown) after the picture's name: `crop/<crop>/<picture>/<stage>`.
export function cropArt(cropId: number, growth: number, stages = 6): string | undefined {
  const crop = getCrop(cropId)
  if (!crop) return undefined
  const needed = growthNeeded(crop.growTicks)
  const stage = growth >= needed ? stages - 1 : Math.min(stages - 2, Math.floor((growth / needed) * (stages - 1)))
  const picture = growth >= needed ? 'full' : growth * 2 >= needed ? 'mid' : 'sprout'
  return `crop/${crop.key}/${picture}/${stage}`
}

// The 2D picture's name from a crop's art (without its stage).
export function cropPicture(art: string): string {
  return art.split('/').slice(0, 3).join('/')
}

// The picture of a building or plant: a rock's is picked by its tile, a fence's by the neighbours it joins, a gate's
// by which way it runs and whether it is open.
export function buildingArt(building: Pick<BuildingView, 'kind' | 'x' | 'y' | 'shape' | 'connect' | 'open' | 'lit' | 'item'>): string {
  const { kind } = building
  // Something stuck in the ground is drawn as its item.
  if (kind === 'loose') return itemArt(building.item ?? 0)
  if (kind === 'campfire') return building.lit ? 'building/campfire-lit' : 'building/campfire'
  if (kind === 'rock') return `plant/rock/${1 + (hashInts(building.x, building.y, 97) % ROCK_VARIANTS)}`
  if (kind === 'fence') return `building/fence/${building.connect ?? 0}`
  if (kind === 'gate') {
    // East to west unless it only joins fences to the north or south.
    return `building/gate/${gateRunsAcross(building.connect ?? 0) ? 'h' : 'v'}-${building.open ? 'open' : 'shut'}`
  }
  if (BUILDINGS[kind].natural) return `plant/${kind}`
  const curved = (building.shape ?? 'straight') !== 'straight'
  return curved && (kind === 'belt' || kind === 'extractor') ? `building/${kind}-curve` : `building/${kind}`
}
