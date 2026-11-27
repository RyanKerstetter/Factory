import worldGenData from '../../../data/world-gen.json' with { type: 'json' }
import { failIn, fieldsOf, numberField, onlyFields, wholeField, type Fail, type Fields } from './data-check.ts'

// How the world grows, from data/world-gen.json (where to tweak it). Distances are in tiles, chances in percent, rates
// per 1000 tiles. Changing any of it changes how untouched ground grows in old saves too (the server warns of each chunk
// that comes out differently than when it was saved).
//
// - `plants`: how much grows (see PlantGeneration in world-gen.ts for each field). A save keeps the numbers it was made
//   with, so these are for new worlds.
// - `cells`: how big the squares are that the forest's thickness (`forest`), and the patches of bushes, rocks and grass,
//   are laid out over: each patch square may hold one patch (by its chance in `plants`).
// - `ponds`: each `cell` square of the forest may hold one pond, `chance` percent of the time, `minRadius` to
//   `maxRadius` across; none within `spawnClearing` of the spawn, nor within `shore` of the sea.
// - `camps`: the skeletons' camps, one in each `cell` square of the mountains, `chance` percent of the time, where the
//   air is from `warmest` down to `coldest` °C, at least `apartFromDungeon` from the way into the dungeon, with nothing
//   growing within `clearing` of the fire. (What keeps each kind of camp, how fast they come back, and its rocks are
//   in data/camps.json.)
// - `dungeon`: the way into the dungeon, `share` of the way into the mountains, nothing growing within `clearing`.
// - `islands`: each biome is an island (see terrain.ts): how ragged the coasts are (`bumpiness`, 0 to 100); the least sea
//   between two islands next to each other (`gap`) and how far their coasts facing each other wander in and out
//   (`facingBump`: the islands are placed so these never close the gap); how far out the shallow shelf reaches from
//   land (`shelf`), how much further on a side facing the next island (`shelfFacing`), and how wide, each side of the
//   line between them, the shallows joining two islands are (`shelfJoin`, give or take a quarter).
// - `meadow`: what grows on the meadow (see `plantAt` in world-gen.ts): `rivers` rivers, `riverWidth` tiles wide,
//   running from inland down to the sea, with clay on `clayChance` percent of the tiles along their banks; patches of
//   sunflowers (one in each `sunflowerCell` square, `sunflowerChance` percent of the time, `sunflowersMin` to
//   `sunflowersMax` of them) and of grass the same way; and a beehive in each `hiveCell` square, `hiveChance` percent
//   of the time. (No rocks: its only stone is the goblins' camps' tin.)
// - `desert`: what is on the desert (all of it sand): cacti (`cactusScatter` per 1000 tiles) and pockets of sand to
//   break (patches, as on the meadow). (Its copper is only at the mummies' tombs.)
// - `goblinCamps`: the goblins' camps on the meadow (clear of its rivers): one in each `cell` square, `chance` percent
//   of the time, nothing growing within `clearing` of the lean-to.
// - `tombs`: the mummies' tombs in the desert, found the same way.

export type WorldGenData = {
  plants: {
    treeScatter: number
    forestCover: number
    forestDensity: number
    bushPatchChance: number
    bushesPerPatchMin: number
    bushesPerPatchMax: number
    rockPatchChance: number
    rocksPerPatchMin: number
    rocksPerPatchMax: number
    grassPatchChance: number
    grassPerPatchMin: number
    grassPerPatchMax: number
    flintScatter: number
    spawnClearing: number
  }
  cells: { forest: number; bushPatch: number; rockPatch: number; grassPatch: number }
  ponds: { cell: number; chance: number; minRadius: number; maxRadius: number; spawnClearing: number; shore: number }
  camps: {
    cell: number
    chance: number
    warmest: number
    coldest: number
    apartFromDungeon: number
    clearing: number
  }
  dungeon: { share: number; clearing: number }
  islands: { bumpiness: number; gap: number; facingBump: number; shelf: number; shelfFacing: number; shelfJoin: number }
  meadow: {
    rivers: number
    riverWidth: number
    clayChance: number
    sunflowerCell: number
    sunflowerChance: number
    sunflowersMin: number
    sunflowersMax: number
    grassCell: number
    grassChance: number
    grassMin: number
    grassMax: number
    hiveCell: number
    hiveChance: number
  }
  desert: { cactusScatter: number; sandCell: number; sandChance: number; sandMin: number; sandMax: number }
  goblinCamps: { cell: number; chance: number; clearing: number }
  tombs: { cell: number; chance: number; clearing: number }
}

const PLANT_FIELDS = [
  'treeScatter',
  'forestCover',
  'forestDensity',
  'bushPatchChance',
  'bushesPerPatchMin',
  'bushesPerPatchMax',
  'rockPatchChance',
  'rocksPerPatchMin',
  'rocksPerPatchMax',
  'grassPatchChance',
  'grassPerPatchMin',
  'grassPerPatchMax',
  'flintScatter',
  'spawnClearing',
] as const

// How many spots by a camp's building its rocks can lie on (see `campRockSpots` in world-gen.ts).
export const CAMP_ROCK_SPOTS = 8

export const WORLD_GEN: Readonly<WorldGenData> = parseWorldGen(worldGenData)

function parseWorldGen(data: unknown): WorldGenData {
  const fail: Fail = failIn('data/world-gen.json')
  const raw = fieldsOf(data, 'it', fail)
  onlyFields(raw, ['plants', 'cells', 'ponds', 'camps', 'dungeon', 'islands', 'meadow', 'desert', 'goblinCamps', 'tombs'], fail)
  const part = (name: string, fields: readonly string[]): Fields => {
    const fields_ = fieldsOf(raw[name], `"${name}"`, fail)
    onlyFields(fields_, fields, fail, `"${name}": `)
    return fields_
  }
  const whole = (fields: Fields, name: string, min = 0): number => wholeField(fields, name, fail, min)
  const plantsRaw = part('plants', PLANT_FIELDS)
  const plants = Object.fromEntries(PLANT_FIELDS.map((name) => [name, whole(plantsRaw, name)])) as WorldGenData['plants']
  const between = (min: number, max: number, what: string): void => {
    if (min > max) fail(`${what}: the least must not be more than the most`)
  }
  between(plants.bushesPerPatchMin, plants.bushesPerPatchMax, '"plants" bushes per patch')
  between(plants.rocksPerPatchMin, plants.rocksPerPatchMax, '"plants" rocks per patch')
  between(plants.grassPerPatchMin, plants.grassPerPatchMax, '"plants" grass per patch')
  if (Math.max(plants.bushesPerPatchMax, plants.rocksPerPatchMax, plants.grassPerPatchMax) > 9) fail('"plants": a patch is at most 9 (a 3x3 cluster)')
  const cellsRaw = part('cells', ['forest', 'bushPatch', 'rockPatch', 'grassPatch'])
  const cells = {
    forest: whole(cellsRaw, 'forest', 2),
    bushPatch: whole(cellsRaw, 'bushPatch', 5),
    rockPatch: whole(cellsRaw, 'rockPatch', 5),
    grassPatch: whole(cellsRaw, 'grassPatch', 5),
  }
  const pondsRaw = part('ponds', ['cell', 'chance', 'minRadius', 'maxRadius', 'spawnClearing', 'shore'])
  const ponds = {
    cell: whole(pondsRaw, 'cell', 1),
    chance: whole(pondsRaw, 'chance'),
    minRadius: whole(pondsRaw, 'minRadius', 1),
    maxRadius: whole(pondsRaw, 'maxRadius', 1),
    spawnClearing: whole(pondsRaw, 'spawnClearing'),
    shore: whole(pondsRaw, 'shore'),
  }
  between(ponds.minRadius, ponds.maxRadius, '"ponds" radius')
  if (ponds.cell <= ponds.maxRadius * 2) fail('"ponds": "cell" must be more than twice "maxRadius"')
  const campFields = ['cell', 'chance', 'warmest', 'coldest', 'apartFromDungeon', 'clearing']
  const campsRaw = part('camps', campFields)
  const camps = {
    cell: whole(campsRaw, 'cell', 13),
    chance: whole(campsRaw, 'chance'),
    warmest: numberField(campsRaw, 'warmest', fail, -Infinity),
    coldest: numberField(campsRaw, 'coldest', fail, -Infinity),
    apartFromDungeon: numberField(campsRaw, 'apartFromDungeon', fail),
    clearing: numberField(campsRaw, 'clearing', fail),
  }
  const dungeonRaw = part('dungeon', ['share', 'clearing'])
  const dungeon = { share: numberField(dungeonRaw, 'share', fail), clearing: numberField(dungeonRaw, 'clearing', fail) }
  if (dungeon.share > 1) fail('"dungeon": "share" must be from 0 to 1')
  const islandFields = ['bumpiness', 'gap', 'facingBump', 'shelf', 'shelfFacing', 'shelfJoin'] as const
  const islandsRaw = part('islands', islandFields)
  const islands = Object.fromEntries(islandFields.map((name) => [name, whole(islandsRaw, name)])) as WorldGenData['islands']
  if (islands.bumpiness > 100) fail('"islands": "bumpiness" is from 0 to 100')
  if (islands.gap < 2) fail('"islands": "gap" must be at least 2, so the islands never join')
  // Every field of these is a whole number; a cell is big enough to hold a patch (3 x 3) a tile in from its edges.
  const wholes = <K extends string>(name: string, fields: readonly K[], cells: readonly K[]): Record<K, number> => {
    const raw = part(name, fields)
    const out = Object.fromEntries(fields.map((field) => [field, whole(raw, field, cells.includes(field) ? 5 : 0)])) as Record<K, number>
    return out
  }
  const meadowFields = [
    'rivers', 'riverWidth', 'clayChance', 'sunflowerCell', 'sunflowerChance',
    'sunflowersMin', 'sunflowersMax', 'grassCell', 'grassChance', 'grassMin', 'grassMax', 'hiveCell', 'hiveChance',
  ] as const
  const meadow = wholes('meadow', meadowFields, ['sunflowerCell', 'grassCell', 'hiveCell'])
  if (meadow.riverWidth < 1) fail('"meadow": "riverWidth" must be at least 1')
  between(meadow.sunflowersMin, meadow.sunflowersMax, '"meadow" sunflowers')
  between(meadow.grassMin, meadow.grassMax, '"meadow" grass')
  if (Math.max(meadow.sunflowersMax, meadow.grassMax) > 9) fail('"meadow": a patch is at most 9 (a 3x3 cluster)')
  const desert = wholes('desert', ['cactusScatter', 'sandCell', 'sandChance', 'sandMin', 'sandMax'] as const, ['sandCell'])
  between(desert.sandMin, desert.sandMax, '"desert" sand')
  if (desert.sandMax > 9) fail('"desert": a patch is at most 9 (a 3x3 cluster)')
  // Where the goblins' camps and the mummies' tombs grow.
  const haunt = (name: string): { cell: number; chance: number; clearing: number } => {
    const haunts = part(name, ['cell', 'chance', 'clearing'])
    return { cell: whole(haunts, 'cell', 13), chance: whole(haunts, 'chance'), clearing: numberField(haunts, 'clearing', fail) }
  }
  const goblinCamps = haunt('goblinCamps')
  const tombs = haunt('tombs')
  return { plants, cells, ponds, camps, dungeon, islands, meadow, desert, goblinCamps, tombs }
}
