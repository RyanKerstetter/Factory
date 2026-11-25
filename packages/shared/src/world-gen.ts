import { CHUNK_SIZE, SUB } from './constants.ts'
import { floorDiv } from './geometry.ts'
import { NO_ITEM, ORES, type ItemId } from './items.ts'
import { hashInts, valueNoise } from './rng.ts'
import { dungeonBlocks, isInDungeons } from './dungeon.ts'
import { biomeSiteAt, inLandmarkClearing, isSandAt, seaWithin, type BiomeKey, type BiomeSite, type Terrain } from './terrain.ts'
import { TileFacts } from './tile-facts.ts'
import { WORLD_GEN } from './world-gen-data.ts'

// What the world is made of, worked out from its seed wherever it is needed, the same on the server and on every
// client, with whole numbers only: the ore deposits (put away for now), and where plants first grow in each biome (see
// terrain.ts for the land, the sea and the biomes).

// ---- ore deposits

// Ore deposits are for later in the game: none are generated for now, so `oreAt` finds no ore anywhere. The deposits
// are still worked out by `depositOreAt`, ready to be turned back on by setting this.
export const ORE_DEPOSITS = false

// The world is divided into cells of DEPOSIT_CELL tiles. Each cell may hold one deposit: a rough disc of one ore,
// placed and sized by a hash of the seed and the cell. A tile is ore if it is in the deposit of its own cell or of
// one of the eight around it (a deposit can reach over a cell's edge). The cells round the spawn always hold the
// common ores, so a new game starts with something to mine.

const DEPOSIT_CELL = 24
const DEPOSIT_CHANCE = 45 // out of 100
const MIN_RADIUS = 3
const MAX_RADIUS = 6

type Deposit = { x: number; y: number; radius: number; ore: ItemId }

const TOTAL_WEIGHT = ORES.reduce((sum, item) => sum + item.weight, 0)

// The deposits always found next to the spawn, by offset from tile 0,0.
const STARTING_DEPOSITS: readonly Deposit[] = [
  { x: 7, y: -5, radius: 4, ore: 1 }, // iron
  { x: -8, y: 6, radius: 4, ore: 2 }, // copper
  { x: 9, y: 9, radius: 3, ore: 3 }, // tin
  { x: -9, y: -8, radius: 3, ore: 4 }, // gold
]

function pickOre(roll: number): ItemId {
  let left = roll % TOTAL_WEIGHT
  for (const item of ORES) {
    if (left < item.weight) return item.id
    left -= item.weight
  }
  return ORES[0].id
}

function depositOf(seed: number, cx: number, cy: number): Deposit | undefined {
  // The cells round the spawn hold the starting deposits and nothing else.
  if (cx >= -1 && cx <= 0 && cy >= -1 && cy <= 0) return undefined
  const roll = hashInts(seed, cx, cy, 1)
  if (roll % 100 >= DEPOSIT_CHANCE) return undefined
  const margin = MAX_RADIUS
  const span = DEPOSIT_CELL - margin * 2
  return {
    x: cx * DEPOSIT_CELL + margin + (hashInts(seed, cx, cy, 2) % span),
    y: cy * DEPOSIT_CELL + margin + (hashInts(seed, cx, cy, 3) % span),
    radius: MIN_RADIUS + (hashInts(seed, cx, cy, 4) % (MAX_RADIUS - MIN_RADIUS + 1)),
    ore: pickOre(hashInts(seed, cx, cy, 5)),
  }
}

// Whether a tile is inside a disc: within its radius, with a ragged edge made by a hash of the tile.
function inDisc(seed: number, disc: { x: number; y: number; radius: number }, x: number, y: number): boolean {
  const dx = x - disc.x
  const dy = y - disc.y
  const distance = dx * dx + dy * dy
  const r = disc.radius
  if (distance <= (r - 1) * (r - 1)) return true
  if (distance > r * r) return false
  return hashInts(seed, x, y, 7) % 3 !== 0
}

// The ore on a tile, or NO_ITEM: none while ORE_DEPOSITS is off.
export function oreAt(seed: number, x: number, y: number): ItemId {
  return ORE_DEPOSITS ? depositOreAt(seed, x, y) : NO_ITEM
}

// The ore the deposits would put on a tile, whether or not deposits are on.
export function depositOreAt(seed: number, x: number, y: number): ItemId {
  for (const deposit of STARTING_DEPOSITS) {
    if (inDisc(seed, deposit, x, y)) return deposit.ore
  }
  const cx = floorDiv(x, DEPOSIT_CELL)
  const cy = floorDiv(y, DEPOSIT_CELL)
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const deposit = depositOf(seed, cx + ox, cy + oy)
      if (deposit && inDisc(seed, deposit, x, y)) return deposit.ore
    }
  }
  return NO_ITEM
}

// ---- plants

// Where trees, bushes and rocks are when the world is made, and the flint lying about: in the forest, trees, bushes,
// grass and flint; in the mountains, rocks; in the desert, cacti, pockets of sand and the odd tin rock; on the meadow,
// grass, sunflowers, beehives, small patches of rocks (a few of them copper) and clay along its rivers. Nothing round
// the mummies' tombs or the goblins' camps. The server puts
// them in a chunk the first time a player comes near it, as buildings (and items on the ground) like any other (they
// are punched, and change), so after that the chunk is what it says.
export type PlantKind = 'tree' | 'bush' | 'rock' | 'grass' | 'sunflower' | 'clay' | 'copper-rock' | 'tin-rock' | 'cactus' | 'sand' | 'hive'

// How much grows, all in one place. A game can be given its own (GameRoomOptions.plantGeneration); every other world
// uses these. Rates are whole numbers so the world comes out the same everywhere.
export type PlantGeneration = {
  // Trees in open ground, per 1000 tiles.
  treeScatter: number
  // Roughly how much of the world is forest, in percent.
  forestCover: number
  // Trees at the heart of the thickest forest, per 1000 tiles (thinning out to `treeScatter` at a forest's edge).
  forestDensity: number
  // The chance, in percent, that a PATCH_CELL square of the world has a patch of bushes in it.
  bushPatchChance: number
  // How many bushes a patch has (from min to max, both included; at most 9, since a patch is a 3x3 cluster).
  bushesPerPatchMin: number
  bushesPerPatchMax: number
  // The chance, in percent, that a ROCK_CELL square of the mountains has a group of rocks in it, and how many rocks a
  // group has (like bush patches).
  rockPatchChance: number
  rocksPerPatchMin: number
  rocksPerPatchMax: number
  // The same for clumps of grass, in cells of GRASS_CELL tiles (smaller, so there are more of them).
  grassPatchChance: number
  grassPerPatchMin: number
  grassPerPatchMax: number
  // Pieces of flint lying on the ground, per 1000 tiles.
  flintScatter: number
  // Nothing grows within this many tiles of 0,0, so a new player has room to stand.
  spawnClearing: number
}

// From "plants" in data/world-gen.json (where to tweak them).
export const DEFAULT_PLANT_GENERATION: Readonly<PlantGeneration> = { ...WORLD_GEN.plants }

// How thick the forest is varies smoothly over FOREST_CELL tiles, from a value at each cell corner (0 to 999) blended
// between them.
const FOREST_CELL = WORLD_GEN.cells.forest

// Bushes grow in patches, and rocks lie in groups: each cell of PATCH_CELL tiles may hold one of each, a small cluster
// on the 3x3 tiles around its centre (the centre always, and the rest on some of the eight around it).
const PATCH_CELL = WORLD_GEN.cells.bushPatch
const GRASS_CELL = WORLD_GEN.cells.grassPatch
// Rocks lie in smaller cells than bushes, so the mountains are thick with them.
const ROCK_CELL = WORLD_GEN.cells.rockPatch
const PATCH_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
]

function treeChance(seed: number, x: number, y: number, rates: PlantGeneration): boolean {
  // The blend of four corners is seldom near 0 or 999, so the forest's threshold is pulled in from the ends.
  const thick = 1000 - Math.max(0, Math.min(100, rates.forestCover)) * 5 - 250
  const forest = valueNoise(seed, 31, x, y, FOREST_CELL)
  const chance = forest > thick ? rates.treeScatter + Math.floor(((forest - thick) * rates.forestDensity) / Math.max(1, 1000 - thick)) : rates.treeScatter
  return hashInts(seed, x, y, 32) % 1000 < chance
}

// A kind of patch: how often a cell has one, how many tiles it covers, and the hash salts that keep one kind's patches
// apart from another's.
type PatchKind = { chance: number; min: number; max: number; salt: number; cell: number }

const bushPatches = (rates: PlantGeneration): PatchKind => ({
  chance: rates.bushPatchChance,
  min: rates.bushesPerPatchMin,
  max: rates.bushesPerPatchMax,
  salt: 40,
  cell: PATCH_CELL,
})
const rockPatches = (rates: PlantGeneration): PatchKind => ({
  chance: rates.rockPatchChance,
  min: rates.rocksPerPatchMin,
  max: rates.rocksPerPatchMax,
  salt: 80,
  cell: ROCK_CELL,
})
const grassPatches = (rates: PlantGeneration): PatchKind => ({
  chance: rates.grassPatchChance,
  min: rates.grassPerPatchMin,
  max: rates.grassPerPatchMax,
  salt: 120,
  cell: GRASS_CELL,
})

// The tiles of a cell's patch of a kind, if it has one. The patch keeps a tile in from the cell's edge, so all of it is
// inside the cell.
function patchOf(seed: number, cx: number, cy: number, kind: PatchKind): Array<readonly [number, number]> | undefined {
  if (hashInts(seed, cx, cy, kind.salt + 1) % 100 >= kind.chance) return undefined
  const span = kind.cell - 2
  const x = cx * kind.cell + 1 + (hashInts(seed, cx, cy, kind.salt + 2) % span)
  const y = cy * kind.cell + 1 + (hashInts(seed, cx, cy, kind.salt + 3) % span)
  const min = Math.max(1, Math.min(9, kind.min))
  const max = Math.max(min, Math.min(9, kind.max))
  const count = min + (hashInts(seed, cx, cy, kind.salt + 4) % (max - min + 1))
  // The neighbours in an order of their own for this patch; the patch takes the first count - 1 of them.
  const neighbours = PATCH_NEIGHBOURS.map((offset, i) => ({ offset, key: hashInts(seed, cx, cy, kind.salt + 10 + i) }))
    .sort((a, b) => a.key - b.key)
    .slice(0, count - 1)
  return [[x, y], ...neighbours.map(({ offset: [ox, oy] }) => [x + ox, y + oy] as const)]
}

function inPatch(seed: number, x: number, y: number, kind: PatchKind): boolean {
  const patch = patchOf(seed, floorDiv(x, kind.cell), floorDiv(y, kind.cell), kind)
  return patch !== undefined && patch.some(([px, py]) => px === x && py === y)
}

// The meadow's and the desert's patches (see `meadow` and `desert` in data/world-gen.json).
const MEADOW = WORLD_GEN.meadow
const DESERT = WORLD_GEN.desert
const MEADOW_ROCKS: PatchKind = { chance: MEADOW.rockChance, min: MEADOW.rocksMin, max: MEADOW.rocksMax, salt: 300, cell: MEADOW.rockCell }
const SUNFLOWERS: PatchKind = { chance: MEADOW.sunflowerChance, min: MEADOW.sunflowersMin, max: MEADOW.sunflowersMax, salt: 340, cell: MEADOW.sunflowerCell }
const MEADOW_GRASS: PatchKind = { chance: MEADOW.grassChance, min: MEADOW.grassMin, max: MEADOW.grassMax, salt: 380, cell: MEADOW.grassCell }
const SAND_POCKETS: PatchKind = { chance: DESERT.sandChance, min: DESERT.sandMin, max: DESERT.sandMax, salt: 420, cell: DESERT.sandCell }

// The meadow: nothing on its beaches; clay on some of the tiles along a river; a beehive now and then (one in some
// `hiveCell` squares); small patches of rocks, a few of them copper; patches of sunflowers and of grass.
function meadowPlantAt(terrain: Terrain, site: BiomeSite, x: number, y: number): PlantKind | undefined {
  const seed = terrain.seed
  if (isSandAt(terrain, x, y)) return undefined
  if (riverAt(terrain, site, x + 1, y) || riverAt(terrain, site, x - 1, y) || riverAt(terrain, site, x, y + 1) || riverAt(terrain, site, x, y - 1)) {
    return hashInts(seed, x, y, 390) % 100 < MEADOW.clayChance ? 'clay' : undefined
  }
  const cell = MEADOW.hiveCell
  const cx = floorDiv(x, cell)
  const cy = floorDiv(y, cell)
  if (hashInts(seed, cx, cy, 395) % 100 < MEADOW.hiveChance) {
    const hiveX = cx * cell + 2 + (hashInts(seed, cx, cy, 396) % (cell - 4))
    const hiveY = cy * cell + 2 + (hashInts(seed, cx, cy, 397) % (cell - 4))
    if (x === hiveX && y === hiveY) return 'hive'
  }
  if (inPatch(seed, x, y, MEADOW_ROCKS)) return hashInts(seed, x, y, 391) % 100 < MEADOW.copperChance ? 'copper-rock' : 'rock'
  if (inPatch(seed, x, y, SUNFLOWERS)) return 'sunflower'
  if (inPatch(seed, x, y, MEADOW_GRASS)) return 'grass'
  return undefined
}

// The desert (all of it sand): pockets of sand to break, the odd tin rock, and cacti.
function desertPlantAt(terrain: Terrain, x: number, y: number): PlantKind | undefined {
  const seed = terrain.seed
  if (inPatch(seed, x, y, SAND_POCKETS)) return 'sand'
  if (hashInts(seed, x, y, 430) % 1000 < DESERT.tinScatter) return 'tin-rock'
  if (hashInts(seed, x, y, 431) % 1000 < DESERT.cactusScatter) return 'cactus'
  return undefined
}

// The plant that first grows on a tile, if any. A tree keeps clear of the trees that might grow just before it (above
// it, and to its left), so even thick forest has room to walk between the trunks.
export function plantAt(terrain: Terrain, x: number, y: number, rates: PlantGeneration = DEFAULT_PLANT_GENERATION): PlantKind | undefined {
  if (Math.abs(x) <= rates.spawnClearing && Math.abs(y) <= rates.spawnClearing) return undefined
  const site = biomeSiteAt(terrain, x, y)
  if (!site || pondAt(terrain, site, x, y) || riverAt(terrain, site, x, y)) return undefined
  const biome = site.biome
  if (biome.key === 'mountain' && inLandmarkClearing(terrain, x, y)) return undefined
  if (biome.key === 'meadow' && inClearing(terrain, GOBLIN_CAMPS, x, y)) return undefined
  if (biome.key === 'desert' && inClearing(terrain, TOMBS, x, y)) return undefined
  const seed = terrain.seed
  if (biome.key === 'mountain') return inPatch(seed, x, y, rockPatches(rates)) ? 'rock' : undefined
  if (biome.key === 'meadow') return meadowPlantAt(terrain, site, x, y)
  if (biome.key === 'desert') return desertPlantAt(terrain, x, y)
  // Nothing grows on the beach (see `canGrowAt`).
  if (isSandAt(terrain, x, y)) return undefined
  if (inPatch(seed, x, y, bushPatches(rates))) return 'bush'
  if (inPatch(seed, x, y, grassPatches(rates))) return 'grass'
  if (!treeChance(seed, x, y, rates)) return undefined
  for (const [ox, oy] of [[-1, -1], [0, -1], [1, -1], [-1, 0]]) if (treeChance(seed, x + ox, y + oy, rates)) return undefined
  return 'tree'
}

// The plants that first grow in a chunk, row by row.
export function plantsInChunk(
  terrain: Terrain,
  cx: number,
  cy: number,
  rates: PlantGeneration = DEFAULT_PLANT_GENERATION,
): Array<{ x: number; y: number; kind: PlantKind }> {
  const found: Array<{ x: number; y: number; kind: PlantKind }> = []
  for (let y = cy * CHUNK_SIZE; y < (cy + 1) * CHUNK_SIZE; y++) {
    for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x++) {
      const kind = plantAt(terrain, x, y, rates)
      if (kind) found.push({ x, y, kind })
    }
  }
  return found
}

// ---- ponds

// Water: the sea round the biomes (see terrain.ts), and ponds in the biomes that have them (`ponds` in BIOMES: none
// now; the forest had them, and fresh water there now comes from a well). Each cell of
// POND_CELL tiles may hold one pond, a rough disc of water (POND_MIN_RADIUS to POND_MAX_RADIUS), POND_CHANCE percent of
// the time; none near the spawn, and none within POND_SHORE tiles of the sea (so a pond never runs into it). Water is
// part of the ground, worked out from the seed like ore: players and animals cannot walk into it, nothing grows or is
// built on it, and a bucket is filled from it.
// All from "ponds" in data/world-gen.json.
const POND_CELL = WORLD_GEN.ponds.cell
const POND_CHANCE = WORLD_GEN.ponds.chance
const POND_MIN_RADIUS = WORLD_GEN.ponds.minRadius
const POND_MAX_RADIUS = WORLD_GEN.ponds.maxRadius
const POND_CLEARING = WORLD_GEN.ponds.spawnClearing
const POND_SHORE = WORLD_GEN.ponds.shore

function pondOf(seed: number, cx: number, cy: number): { x: number; y: number; radius: number } | undefined {
  if (hashInts(seed, cx, cy, 201) % 100 >= POND_CHANCE) return undefined
  const span = POND_CELL - POND_MAX_RADIUS * 2
  const pond = {
    x: cx * POND_CELL + POND_MAX_RADIUS + (hashInts(seed, cx, cy, 202) % span),
    y: cy * POND_CELL + POND_MAX_RADIUS + (hashInts(seed, cx, cy, 203) % span),
    radius: POND_MIN_RADIUS + (hashInts(seed, cx, cy, 204) % (POND_MAX_RADIUS - POND_MIN_RADIUS + 1)),
  }
  return Math.abs(pond.x) <= POND_CLEARING && Math.abs(pond.y) <= POND_CLEARING ? undefined : pond
}

// Whether a tile is water: the sea (anywhere off the land), a pond, or a river. Never in the dungeons. Kept (see
// TileFacts) within reach of the islands: everything that walks asks it of the tiles round it every step. Beyond, it is
// the open sea (or the dungeons), and nothing is kept.
export function waterAt(terrain: Terrain, x: number, y: number): boolean {
  const box = terrain.reach
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return !isInDungeons(x, y)
  return WATER.at(terrain, x, y) === 1
}
const WATER = new TileFacts<Terrain>((terrain, x, y) => {
  if (isInDungeons(x, y)) return 0
  const site = biomeSiteAt(terrain, x, y)
  return site === undefined || pondAt(terrain, site, x, y) || riverAt(terrain, site, x, y) ? 1 : 0
})

// ---- the goblins' camps and the mummies' tombs

// The goblins' camps on the meadow and the mummies' tombs in the desert (see `goblinCamps` and `tombs` in
// data/world-gen.json), found the same way: one in each `cell` square of the island, `chance` percent of the time, on
// a tile of it well clear of the sea and with no river within `clearing` + 1 of it, nothing growing within `clearing`
// of the middle. Worked out once per world, from its terrain alone, so every page has them where the server does.
// (`salt`: so each kind falls in its own places.)
type Haunts = { biome: BiomeKey; cell: number; chance: number; clearing: number; salt: number; made: WeakMap<Terrain, ReadonlyArray<{ x: number; y: number }>> }
const GOBLIN_CAMPS: Haunts = { biome: 'meadow', ...WORLD_GEN.goblinCamps, salt: 731, made: new WeakMap() }
const TOMBS: Haunts = { biome: 'desert', ...WORLD_GEN.tombs, salt: 751, made: new WeakMap() }
export const GOBLIN_CLEARING = GOBLIN_CAMPS.clearing
export const TOMB_CLEARING = TOMBS.clearing

// The middle tile of each goblins' camp.
export function goblinCampSites(terrain: Terrain): ReadonlyArray<{ x: number; y: number }> {
  return hauntsOf(terrain, GOBLIN_CAMPS)
}

// The middle tile of each mummies' tomb.
export function tombSites(terrain: Terrain): ReadonlyArray<{ x: number; y: number }> {
  return hauntsOf(terrain, TOMBS)
}

// Whether a tile is in the clearing round a camp or tomb of a kind, where nothing grows.
function inClearing(terrain: Terrain, haunts: Haunts, x: number, y: number): boolean {
  return hauntsOf(terrain, haunts).some((at) => (x - at.x) ** 2 + (y - at.y) ** 2 <= haunts.clearing * haunts.clearing)
}

function hauntsOf(terrain: Terrain, haunts: Haunts): ReadonlyArray<{ x: number; y: number }> {
  let found = haunts.made.get(terrain)
  if (!found) {
    found = findHaunts(terrain, haunts)
    haunts.made.set(terrain, found)
  }
  return found
}

function findHaunts(terrain: Terrain, haunts: Haunts): Array<{ x: number; y: number }> {
  const site = terrain.sites.find((candidate) => candidate.biome.key === haunts.biome)
  if (!site) return []
  const { cell, salt } = haunts
  const found: Array<{ x: number; y: number }> = []
  const cells = Math.ceil((site.radius + site.bump) / cell)
  const middleX = Math.floor(site.x / cell)
  const middleY = Math.floor(site.y / cell)
  const clear = Math.ceil(haunts.clearing) + 1
  const riverNear = (x: number, y: number): boolean => {
    for (let dy = -clear; dy <= clear; dy++) for (let dx = -clear; dx <= clear; dx++) if (riverAt(terrain, site, x + dx, y + dy)) return true
    return false
  }
  for (let gy = middleY - cells; gy <= middleY + cells; gy++) {
    for (let gx = middleX - cells; gx <= middleX + cells; gx++) {
      if (hashInts(terrain.seed, gx, gy, salt) % 100 >= haunts.chance) continue
      const x = gx * cell + 6 + (hashInts(terrain.seed, gx, gy, salt + 1) % (cell - 12))
      const y = gy * cell + 6 + (hashInts(terrain.seed, gx, gy, salt + 2) % (cell - 12))
      if (biomeSiteAt(terrain, x, y) !== site || seaWithin(terrain, x, y, 6) || riverNear(x, y)) continue
      found.push({ x, y })
    }
  }
  return found
}

// ---- rivers

// The meadow's rivers (`rivers` and `riverWidth` in data/world-gen.json): each starts inland, a fifth to a third of the
// way out from the middle, and winds down to the sea, its way turning a little this way and that but kept heading out
// (within RIVER_WANDER of the way it set off), `riverWidth` tiles wide. They set off evenly round the island, so they
// never meet, and since each starts inland the land is still one piece (round their heads). Worked out once for a world
// with whole numbers only (a step is a tile, along one of RIVER_DIRS directions), so they come out the same everywhere,
// and kept as the set of their tiles. A river is water, as a pond is: nobody walks into it, nothing grows or is built
// on it, a bucket fills with fresh water there, and a raft floats on it.
const RIVER_DIRS = 64
const RIVER_WANDER = 6
const RIVER_DIR: ReadonlyArray<readonly [number, number]> = Array.from({ length: RIVER_DIRS }, (_, i) => {
  const angle = (i * Math.PI * 2) / RIVER_DIRS
  return [Math.round(Math.cos(angle) * 1024), Math.round(Math.sin(angle) * 1024)] as const
})
const riversMade = new WeakMap<Terrain, ReadonlySet<number>>()

// A tile as one number (the world is well within 40,000 tiles each way).
function tileKey(x: number, y: number): number {
  return (x + 40_000) * 80_000 + (y + 40_000)
}

// Whether a tile of land (in `site`) is a river.
function riverAt(terrain: Terrain, site: BiomeSite, x: number, y: number): boolean {
  return site.biome.key === 'meadow' && riverTiles(terrain).has(tileKey(x, y))
}

// Every river tile of a world.
function riverTiles(terrain: Terrain): ReadonlySet<number> {
  let tiles = riversMade.get(terrain)
  if (!tiles) {
    tiles = layRivers(terrain)
    riversMade.set(terrain, tiles)
  }
  return tiles
}

function layRivers(terrain: Terrain): Set<number> {
  const tiles = new Set<number>()
  const seed = terrain.seed
  const half = MEADOW.riverWidth * 512
  for (const site of terrain.sites) {
    if (site.biome.key !== 'meadow') continue
    const count = MEADOW.rivers
    const first = hashInts(seed, site.index, 810) % RIVER_DIRS
    for (let river = 0; river < count; river++) {
      const out = (first + Math.floor((river * RIVER_DIRS) / Math.max(1, count))) % RIVER_DIRS
      const start = Math.floor((site.radius * (20 + (hashInts(seed, site.index, river, 811) % 14))) / 100)
      // Where it is, in 1024ths of a tile, and which way it goes.
      let px = site.x * 1024 + 512 + RIVER_DIR[out][0] * start
      let py = site.y * 1024 + 512 + RIVER_DIR[out][1] * start
      let heading = out
      for (let step = 0; step < site.radius * 3; step++) {
        const tx = Math.floor(px / 1024)
        const ty = Math.floor(py / 1024)
        if (biomeSiteAt(terrain, tx, ty) !== site) break
        // The tiles whose middles are within half its width of where it is.
        const reach = Math.ceil(MEADOW.riverWidth / 2) + 1
        for (let y = ty - reach; y <= ty + reach; y++) {
          for (let x = tx - reach; x <= tx + reach; x++) {
            const dx = x * 1024 + 512 - px
            const dy = y * 1024 + 512 - py
            if (dx * dx + dy * dy <= half * half && biomeSiteAt(terrain, x, y) === site) tiles.add(tileKey(x, y))
          }
        }
        // A turn now and then, kept heading out.
        const roll = hashInts(seed, site.index, river, step, 812) % 6
        if (roll === 0) heading--
        else if (roll === 1) heading++
        const off = ((heading - out + RIVER_DIRS * 2 + RIVER_DIRS / 2) % RIVER_DIRS) - RIVER_DIRS / 2
        if (off > RIVER_WANDER) heading--
        else if (off < -RIVER_WANDER) heading++
        heading = ((heading % RIVER_DIRS) + RIVER_DIRS) % RIVER_DIRS
        px += RIVER_DIR[heading][0]
        py += RIVER_DIR[heading][1]
      }
    }
  }
  return tiles
}

// Whether a tile of land (in `site`) is a pond.
function pondAt(terrain: Terrain, site: BiomeSite, x: number, y: number): boolean {
  if (!site.biome.ponds) return false
  const cx = floorDiv(x, POND_CELL)
  const cy = floorDiv(y, POND_CELL)
  const pond = pondOf(terrain.seed, cx, cy)
  return pond !== undefined && inDisc(terrain.seed, pond, x, y) && pondClearOfSea(terrain, cx, cy, pond)
}

// Whether a pond is far enough from the sea to be there (worked out once a pond, and kept).
const pondsChecked = new WeakMap<Terrain, Map<string, boolean>>()
function pondClearOfSea(terrain: Terrain, cx: number, cy: number, pond: { x: number; y: number; radius: number }): boolean {
  let checked = pondsChecked.get(terrain)
  if (!checked) pondsChecked.set(terrain, (checked = new Map()))
  const key = `${cx},${cy}`
  let clear = checked.get(key)
  if (clear === undefined) {
    clear = !seaWithin(terrain, pond.x, pond.y, pond.radius + POND_SHORE) && !seaWithin(terrain, pond.x, pond.y, pond.radius + 1)
    checked.set(key, clear)
  }
  return clear
}

// Whether the ground itself stops anyone walking onto a tile: water, or a dungeon's walls.
export function groundBlocks(terrain: Terrain, x: number, y: number): boolean {
  return dungeonBlocks(x, y) || waterAt(terrain, x, y)
}

// The flint lying on the ground in the forest in a chunk when the world is made, as positions in units (anywhere in a tile, kept a
// little in from its edges), on tiles where nothing else is. Unlike what a punch drops, it never goes away by itself.
export function flintInChunk(
  terrain: Terrain,
  cx: number,
  cy: number,
  rates: PlantGeneration = DEFAULT_PLANT_GENERATION,
): Array<{ x: number; y: number }> {
  const found: Array<{ x: number; y: number }> = []
  const margin = SUB / 8
  const seed = terrain.seed
  for (let y = cy * CHUNK_SIZE; y < (cy + 1) * CHUNK_SIZE; y++) {
    for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x++) {
      if (hashInts(seed, x, y, 71) % 1000 >= rates.flintScatter) continue
      if (biomeSiteAt(terrain, x, y)?.biome.key !== 'forest') continue
      if (plantAt(terrain, x, y, rates) || waterAt(terrain, x, y)) continue
      found.push({
        x: x * SUB + margin + (hashInts(seed, x, y, 72) % (SUB - 2 * margin)),
        y: y * SUB + margin + (hashInts(seed, x, y, 73) % (SUB - 2 * margin)),
      })
    }
  }
  return found
}
