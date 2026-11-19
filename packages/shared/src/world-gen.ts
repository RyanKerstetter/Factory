import { CHUNK_SIZE, SUB } from './constants.ts'
import { floorDiv } from './geometry.ts'
import { NO_ITEM, ORES, type ItemId } from './items.ts'
import { hashInts } from './rng.ts'

// What the world is made of, worked out from its seed wherever it is needed, the same on the server and on every
// client, with whole numbers only: the ore deposits (put away for now) and where plants first grow.

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

// Where trees, bushes and rocks are when the world is made, and the flint lying about. The server puts them in a chunk
// the first time a player comes near it, as buildings (and items on the ground) like any other (they are punched, and
// change), so after that the chunk is what it says.
export type PlantKind = 'tree' | 'bush' | 'rock' | 'grass'

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
  // The chance, in percent, that a PATCH_CELL square of the world has a group of rocks in it, and how many rocks a
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

export const DEFAULT_PLANT_GENERATION: Readonly<PlantGeneration> = {
  treeScatter: 2,
  forestCover: 20,
  forestDensity: 40,
  bushPatchChance: 8,
  bushesPerPatchMin: 1,
  bushesPerPatchMax: 5,
  rockPatchChance: 6,
  rocksPerPatchMin: 2,
  rocksPerPatchMax: 5,
  grassPatchChance: 30,
  grassPerPatchMin: 3,
  grassPerPatchMax: 8,
  flintScatter: 3,
  spawnClearing: 5,
}

// How thick the forest is varies smoothly over FOREST_CELL tiles, from a value at each cell corner (0 to 999) blended
// between them.
const FOREST_CELL = 24

// Bushes grow in patches, and rocks lie in groups: each cell of PATCH_CELL tiles may hold one of each, a small cluster
// on the 3x3 tiles around its centre (the centre always, and the rest on some of the eight around it).
const PATCH_CELL = 16
const GRASS_CELL = 8
const PATCH_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
]

function forestAt(seed: number, x: number, y: number): number {
  const cx = floorDiv(x, FOREST_CELL)
  const cy = floorDiv(y, FOREST_CELL)
  const fx = x - cx * FOREST_CELL
  const fy = y - cy * FOREST_CELL
  const corner = (ox: number, oy: number): number => hashInts(seed, cx + ox, cy + oy, 31) % 1000
  const top = corner(0, 0) * (FOREST_CELL - fx) + corner(1, 0) * fx
  const bottom = corner(0, 1) * (FOREST_CELL - fx) + corner(1, 1) * fx
  return Math.floor((top * (FOREST_CELL - fy) + bottom * fy) / (FOREST_CELL * FOREST_CELL))
}

function treeChance(seed: number, x: number, y: number, rates: PlantGeneration): boolean {
  // The blend of four corners is seldom near 0 or 999, so the forest's threshold is pulled in from the ends.
  const thick = 1000 - Math.max(0, Math.min(100, rates.forestCover)) * 5 - 250
  const forest = forestAt(seed, x, y)
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
  cell: PATCH_CELL,
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

// The plant that first grows on a tile, if any. A tree keeps clear of the trees that might grow just before it (above
// it, and to its left), so even thick forest has room to walk between the trunks.
export function plantAt(seed: number, x: number, y: number, rates: PlantGeneration = DEFAULT_PLANT_GENERATION): PlantKind | undefined {
  if (Math.abs(x) <= rates.spawnClearing && Math.abs(y) <= rates.spawnClearing) return undefined
  if (waterAt(seed, x, y)) return undefined
  if (inPatch(seed, x, y, bushPatches(rates))) return 'bush'
  if (inPatch(seed, x, y, rockPatches(rates))) return 'rock'
  if (inPatch(seed, x, y, grassPatches(rates))) return 'grass'
  if (!treeChance(seed, x, y, rates)) return undefined
  for (const [ox, oy] of [[-1, -1], [0, -1], [1, -1], [-1, 0]]) if (treeChance(seed, x + ox, y + oy, rates)) return undefined
  return 'tree'
}

// The plants that first grow in a chunk, row by row.
export function plantsInChunk(
  seed: number,
  cx: number,
  cy: number,
  rates: PlantGeneration = DEFAULT_PLANT_GENERATION,
): Array<{ x: number; y: number; kind: PlantKind }> {
  const found: Array<{ x: number; y: number; kind: PlantKind }> = []
  for (let y = cy * CHUNK_SIZE; y < (cy + 1) * CHUNK_SIZE; y++) {
    for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x++) {
      const kind = plantAt(seed, x, y, rates)
      if (kind) found.push({ x, y, kind })
    }
  }
  return found
}

// ---- ponds

// Ponds: each cell of POND_CELL tiles may hold one, a rough disc of water (POND_MIN_RADIUS to POND_MAX_RADIUS), POND_CHANCE
// percent of the time; none near the spawn. Water is part of the ground, worked out from the seed like ore: players and
// animals cannot walk into it, nothing grows or is built on it, and a bucket is filled from it.
const POND_CELL = 28
const POND_CHANCE = 22
const POND_MIN_RADIUS = 2
const POND_MAX_RADIUS = 4
const POND_CLEARING = 12

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

export function waterAt(seed: number, x: number, y: number): boolean {
  const pond = pondOf(seed, floorDiv(x, POND_CELL), floorDiv(y, POND_CELL))
  return pond !== undefined && inDisc(seed, pond, x, y)
}

// The flint lying on the ground in a chunk when the world is made, as positions in units (anywhere in a tile, kept a
// little in from its edges), on tiles where nothing else is. Unlike what a punch drops, it never goes away by itself.
export function flintInChunk(
  seed: number,
  cx: number,
  cy: number,
  rates: PlantGeneration = DEFAULT_PLANT_GENERATION,
): Array<{ x: number; y: number }> {
  const found: Array<{ x: number; y: number }> = []
  const margin = SUB / 8
  for (let y = cy * CHUNK_SIZE; y < (cy + 1) * CHUNK_SIZE; y++) {
    for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x++) {
      if (hashInts(seed, x, y, 71) % 1000 >= rates.flintScatter) continue
      if (plantAt(seed, x, y, rates) || waterAt(seed, x, y)) continue
      found.push({
        x: x * SUB + margin + (hashInts(seed, x, y, 72) % (SUB - 2 * margin)),
        y: y * SUB + margin + (hashInts(seed, x, y, 73) % (SUB - 2 * margin)),
      })
    }
  }
  return found
}
