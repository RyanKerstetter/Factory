import {
  COAST_REACH,
  coastAround,
  isShelf,
  airTemperatureAt,
  biomeSiteAt,
  CHUNK_SIZE,
  dungeonMarkAt,
  dungeonPartAt,
  dungeonTrapAt,
  DUNGEON_TRAPS,
  hashInts,
  inDungeonDark,
  NO_ITEM,
  oreAt,
  waterAt,
  type DungeonPart,
  type Terrain,
} from '../../../../packages/shared/src/index.ts'
import { organicNoise } from '../noise.ts'
import { isSnowAt } from '../snow.ts'

// What the ground looks like: a picture of each chunk, a few pixels to a tile. Every tile is drawn as
// what it is, edge to edge (sea or land, forest or mountain, beach, pond, shelf or deep ocean, the dungeon's flagstones
// and ice walls), with nothing softened across the edges between tiles; within a tile the colour varies in patches
// (grass, rock and snow, from noise turned off the grid so no patch lines up with the tiles), and the snow lies where
// the air (and a slow wander of noise) makes it cold enough. The sea is pale on the shelf by the land and dark in the
// deep ocean beyond, with foam along the land's edge. The meadow is a brighter grass than the forest's, with a few
// flowers in it; the desert is sand all over, in drifts. For a player without truesight, the far islands (`fogged`) are
// painted as fog, all one level, rivers and all (the fog itself stands over them: see fog.ts; the sea under it is
// changed as it is drawn: see ground.ts).

// Pixels a side per tile of the ground's picture.
export const PIXELS_PER_TILE_3D = 8

// The sea is shallow on the shelf and deep beyond: which is which comes from the shared coast.ts (`isShelf`), which the
// map and the rafts use too, so they all agree.
// How far round a chunk what each tile is gets worked out: the 3D view's banks, walls and surf look one tile past the
// chunk's edge.
const FIELD_MARGIN = 1

// ---- colours, as [r, g, b] 0 to 255
type Rgb = [number, number, number]
const rgb = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
// (The shelf's colour, for the sea under the fog too: see ground.ts.)
export const SEA_SHELF_COLOR = 0x4a93c0
const SEA_SHALLOW = rgb(SEA_SHELF_COLOR)
const SEA_DEEP = rgb(0x173d6e)
const SAND = rgb(0xd8c690)
const WET_SAND = rgb(0xb5a676)
const GRASS_DARK = rgb(0x5c8238)
const GRASS_LIGHT = rgb(0x7a9c44)
const MEADOW_DARK = rgb(0x6f9a3e)
const MEADOW_LIGHT = rgb(0x92b552)
const FLOWER_WHITE = rgb(0xf2efe4)
const FLOWER_YELLOW = rgb(0xf2cc3a)
const DESERT_SAND = rgb(0xe3cd94)
const DESERT_DUNE = rgb(0xcbb077)
// The ground of a far island under its fog: the colours of the fog's lowest sheet (see fog.ts), so where the fog thins
// or parts round the player nothing of the island shows.
const FOG = rgb(0xc3ccd4)
const FOG_LIGHT = rgb(0xf3f5f7)
// A pond: one flat blue (it lies a little below the ground, its banks drawn by the 3D view: see ground.ts).
export const POND_COLOR = 0x3a74b0
const POND = rgb(POND_COLOR)
const ORE = rgb(0x7b7568)
const ROCK = rgb(0x8b8f96)
const ROCK_DARK = rgb(0x676c75)
const SNOW = rgb(0xf0f5ff)
const SNOW_SHADE = rgb(0xcfdcef)
// The ice crypt: frosted flagstones, the grout between them, the tops of its ice walls, the solid ice beyond, and the
// walls' faces (for the 3D view's blocks).
const CRYPT_FLOOR = rgb(0x9cb2c4)
const CRYPT_FLOOR_DARK = rgb(0x7f95a8)
const CRYPT_GROUT = rgb(0x56687a)
const CRYPT_FROST = rgb(0xdbe8f4)
const CRYPT_LINE = rgb(0x5aa8e8)
const CRYPT_LINE_GLOW = rgb(0xc8ecff)
export const CRYPT_WALL = 0x3b4c5e
export const CRYPT_VOID = 0x0b1118
export const CRYPT_WALL_FACE = 0xa9c2d8
export const CRYPT_WALL_FOOT = 0x5d7389
const CRYPT_VOID_RGB = rgb(CRYPT_VOID)
const CRYPT_WALL_RGB = rgb(CRYPT_WALL)
const CRYPT_WALL_FACE_RGB = rgb(CRYPT_WALL_FACE)

// What a tile of the ground is, for the 3D view's heights and walls.
// Land says whether it is the mountains' rock (for the colour of the bank where it meets water).
// (`fogged`: a far island's, under its fog.)
export type GroundKind = Readonly<{ kind: 'sea' } | { kind: 'pond' } | { kind: 'land'; rocky: boolean; fogged?: boolean } | { kind: 'dungeon'; part: DungeonPart }>
// One of each, shared by every tile (a chunk has a thousand tiles, and is painted as the player walks).
const SEA_TILE: GroundKind = { kind: 'sea' }
const POND_TILE: GroundKind = { kind: 'pond' }
const LAND_TILE: GroundKind = { kind: 'land', rocky: false }
const ROCK_TILE: GroundKind = { kind: 'land', rocky: true }
const FOGGED_TILE: GroundKind = { kind: 'land', rocky: false, fogged: true }
const DUNGEON_TILES = new Map<DungeonPart, GroundKind>()
const dungeonTile = (part: DungeonPart): GroundKind => {
  let tile = DUNGEON_TILES.get(part)
  if (!tile) {
    tile = { kind: 'dungeon', part }
    DUNGEON_TILES.set(part, tile)
  }
  return tile
}

// The facts of a chunk's tiles and a margin round them, and its picture.
export type GroundChunk = {
  // What each tile is (for tiles in the chunk and one round it).
  tileAt(x: number, y: number): GroundKind
  // The picture: `size` by `size` pixels of RGBA, the chunk's top left tile first.
  pixels: Uint8ClampedArray
  size: number
  // How far a tile is from the land, in tiles (0 for land; for tiles in the chunk and a few round it).
  seaDistance(x: number, y: number): number
}

// Works out a chunk's ground, `perTile` pixels to a tile side; `fogged`: the far islands under their fog.
export function groundChunk(terrain: Terrain, cx: number, cy: number, perTile: number, fogged = false): GroundChunk {
  const seed = terrain.seed
  const left = cx * CHUNK_SIZE
  const top = cy * CHUNK_SIZE
  // ---- facts at the middles of tiles: land or sea over the chunk and a margin, and how far from land (coast.ts)
  const coastal = coastAround(terrain, left, top, CHUNK_SIZE, CHUNK_SIZE)
  const { x0, y0, land, index } = coastal
  const w = coastal.width
  const coast = coastal.distance
  // What each tile is, over the chunk and FIELD_MARGIN tiles round it, and how the chunk's own land is painted.
  const fm = FIELD_MARGIN
  const n = CHUNK_SIZE + 2 * fm
  const near = (x: number, y: number): number => (y - top + fm) * n + (x - left + fm)
  const ore = new Uint8Array(n * n)
  // 1: the meadow's grass, 2: the desert's sand, 3: fog.
  const look = new Uint8Array(n * n)
  const kinds = new Array<GroundKind>(n * n)
  for (let y = top - fm; y < top + CHUNK_SIZE + fm; y++) {
    for (let x = left - fm; x < left + CHUNK_SIZE + fm; x++) {
      const i = near(x, y)
      if (inDungeonDark(x, y)) {
        kinds[i] = dungeonTile(dungeonPartAt(x, y) ?? 'void')
        continue
      }
      const site = land[index(x, y)] ? biomeSiteAt(terrain, x, y) : undefined
      if (!site) {
        kinds[i] = SEA_TILE
        continue
      }
      if (fogged && site.biome.fogged) {
        look[i] = 3
        kinds[i] = FOGGED_TILE
        continue
      }
      look[i] = site.biome.key === 'meadow' ? 1 : site.biome.ground === 'sand' ? 2 : 0
      kinds[i] = waterAt(terrain, x, y) ? POND_TILE : site.biome.key === 'mountain' ? ROCK_TILE : LAND_TILE
      ore[i] = oreAt(seed, x, y) !== NO_ITEM ? 1 : 0
    }
  }
  // ---- smooth noise, on the corners of tiles (the pixels blend between them)
  const c = CHUNK_SIZE + 1
  const corner = (x: number, y: number): number => (y - top) * c + (x - left)
  const grassPatch = new Float32Array(c * c)
  const rockPatch = new Float32Array(c * c)
  const jitter = new Float32Array(c * c)
  for (let y = top; y <= top + CHUNK_SIZE; y++) {
    for (let x = left; x <= left + CHUNK_SIZE; x++) {
      const i = corner(x, y)
      grassPatch[i] = organicNoise(seed, x, y, 7)
      rockPatch[i] = organicNoise(seed + 2, x, y, 5)
      jitter[i] = organicNoise(seed + 9, x, y, 2.3)
    }
  }

  const size = CHUNK_SIZE * perTile
  const pixels = new Uint8ClampedArray(size * size * 4)
  const color: Rgb = [0, 0, 0]
  const put = (px: number, py: number): void => {
    const out = (py * size + px) * 4
    pixels[out] = color[0]
    pixels[out + 1] = color[1]
    pixels[out + 2] = color[2]
    pixels[out + 3] = 255
  }
  // A pixel's speckle: its own random brightness, from 0 to 1 (px, py from the chunk's top left pixel).
  const grain = (px: number, py: number): number => (hashInts(seed, left * perTile + px, top * perTile + py, 13) % 1000) / 1000
  // A tile at a time: what it is worked out once, then its pixels, each only its grain and patch.
  for (let ty = top; ty < top + CHUNK_SIZE; ty++) {
    for (let tx = left; tx < left + CHUNK_SIZE; tx++) {
      const kind = kinds[near(tx, ty)]
      const x0 = (tx - left) * perTile
      const y0 = (ty - top) * perTile
      // The tile's corners, for the value of a field at a point of the tile (see `across`).
      const c00 = corner(tx, ty)
      const c10 = corner(tx + 1, ty)
      const c01 = corner(tx, ty + 1)
      const c11 = corner(tx + 1, ty + 1)
      if (kind.kind === 'dungeon') {
        const stone = hashInts(seed, tx, ty, 41) % 1000
        const trap = kind.part === 'floor' ? dungeonTrapAt(tx, ty) : undefined
        const mark: CryptMark = trap !== undefined && !DUNGEON_TRAPS[trap].wall ? 'spikes' : (dungeonMarkAt(tx, ty) ?? 'none')
        for (let py = 0; py < perTile; py++) {
          for (let px = 0; px < perTile; px++) {
            paintCrypt(kind.part, (px + 0.5) / perTile, (py + 0.5) / perTile, stone, grain(x0 + px, y0 + py), mark, color)
            put(x0 + px, y0 + py)
          }
        }
        continue
      }
      const isLand = land[index(tx, ty)] === 1
      const landW = land[index(tx - 1, ty)] === 1
      const landE = land[index(tx + 1, ty)] === 1
      const landN = land[index(tx, ty - 1)] === 1
      const landS = land[index(tx, ty + 1)] === 1
      if (!isLand) {
        // The sea: one flat pale colour over the shelf by the land, one flat dark colour over the deep, the line between
        // them a tile edge.
        const shelf = isShelf(terrain, coastal, tx, ty)
        mixInto(color, shelf ? SEA_SHALLOW : SEA_DEEP, SEA_DEEP, 0)
        for (let py = 0; py < perTile; py++) for (let px = 0; px < perTile; px++) put(x0 + px, y0 + py)
        continue
      }
      const rocky = kind.kind === 'land' && kind.rocky
      const shore = !landW || !landE || !landN || !landS
      const kindOfGround = look[near(tx, ty)]
      const isPond = kind.kind === 'pond'
      // Snow lies on the mountains where the air is cold enough.
      const snowy = rocky && isSnowAt(seed, airTemperatureAt(terrain, tx + 0.5, ty + 0.5), tx + 0.5, ty + 0.5)
      for (let py = 0; py < perTile; py++) {
        for (let px = 0; px < perTile; px++) {
          const fx = (px + 0.5) / perTile
          const fy = (py + 0.5) / perTile
          const speckle = grain(x0 + px, y0 + py)
          if (kindOfGround === 3) {
            // Fog, in soft patches.
            mixInto(color, FOG, FOG_LIGHT, across(grassPatch, c00, c10, c01, c11, fx, fy) * 0.7 + speckle * 0.3)
          } else if (isPond) {
            mixInto(color, POND, POND, 0)
          } else if (kindOfGround === 2) {
            // The desert: sand in drifts, a little darker in their hollows.
            mixInto(color, DESERT_DUNE, DESERT_SAND, across(rockPatch, c00, c10, c01, c11, fx, fy) * 0.65 + speckle * 0.35)
          } else if (rocky) {
            // Rock, or snow where it is cold enough: a whole tile one or the other, never a mix, so the snow line runs
            // along the tiles' edges, wandering in big tongues and bays and bumpy along its length (see isSnowAt).
            const patch = across(rockPatch, c00, c10, c01, c11, fx, fy)
            if (snowy) mixInto(color, SNOW_SHADE, SNOW, 0.85 + speckle * 0.15)
            else mixInto(color, ROCK_DARK, ROCK, patch * 0.6 + speckle * 0.4)
          } else if (shore) {
            // A beach: the forest's tiles along the sea are sand.
            mixInto(color, WET_SAND, SAND, 0.6 + speckle * 0.4)
          } else if (kindOfGround === 1) {
            // The meadow: brighter grass, and a flower here and there.
            mixInto(color, MEADOW_DARK, MEADOW_LIGHT, across(grassPatch, c00, c10, c01, c11, fx, fy) * 0.75 + speckle * 0.25)
            if (speckle > 0.997) mixInto(color, FLOWER_YELLOW, FLOWER_YELLOW, 0)
            else if (speckle < 0.003) mixInto(color, FLOWER_WHITE, FLOWER_WHITE, 0)
          } else {
            mixInto(color, GRASS_DARK, GRASS_LIGHT, across(grassPatch, c00, c10, c01, c11, fx, fy) * 0.75 + speckle * 0.25)
            if (ore[near(tx, ty)]) mixInto(color, color, ORE, 0.85)
          }
          put(x0 + px, y0 + py)
        }
      }
    }
  }
  return {
    tileAt: (x, y) => kinds[near(x, y)] ?? { kind: 'sea' },
    pixels,
    size,
    seaDistance: (x, y) => (x < x0 || y < y0 || x >= x0 + w || y >= y0 + w ? COAST_REACH : coast[index(x, y)]),
  }
}

// A pixel of the ice crypt: frosted flagstones with grout between them, ice walls, and solid ice beyond.
// What is marked on a flagstone: spikes hidden under it (three rows of small dark holes, easy to miss unless you know
// to look), the glowing line across the mouth of the frost lich's hall, the waiting room's smoother stone, or nothing.
type CryptMark = 'spikes' | 'line' | 'waiting' | 'none'

function paintCrypt(part: DungeonPart, fx: number, fy: number, stone: number, speckle: number, mark: CryptMark, out: Rgb): void {
  if (part === 'void') return void mixInto(out, CRYPT_VOID_RGB, CRYPT_VOID_RGB, 0)
  if (part === 'wall') return void mixInto(out, CRYPT_WALL_RGB, CRYPT_WALL_FACE_RGB, speckle * 0.15)
  if (Math.min(fx, fy, 1 - fx, 1 - fy) < 0.06) return void mixInto(out, CRYPT_GROUT, CRYPT_GROUT, 0)
  if (mark === 'line') {
    // A band of pale blue light across the tile, notched like runes.
    const band = Math.abs(fy - 0.5) < 0.19
    const notch = Math.abs(fy - 0.5) < 0.07 && Math.floor(fx * 8) % 3 === 1
    if (band) return void mixInto(out, CRYPT_LINE, CRYPT_LINE_GLOW, notch ? 0 : 0.6 + speckle * 0.4)
  }
  mixInto(out, CRYPT_FLOOR_DARK, CRYPT_FLOOR, mark === 'waiting' ? 0.7 : stone / 1000)
  if (mark === 'spikes') {
    const hole = (at: number): boolean => Math.abs(at - 0.2) < 0.07 || Math.abs(at - 0.5) < 0.07 || Math.abs(at - 0.8) < 0.07
    if (hole(fx) && hole(fy)) return void mixInto(out, out, CRYPT_GROUT, 0.55)
  }
  // Frost on the stones in small, sharp-edged patches.
  if (speckle > 0.8) mixInto(out, out, CRYPT_FROST, 0.5)
}

// The value of a field kept on the corners of tiles (at c00, c10, c01, c11: top left, top right, bottom left, bottom
// right) at a point of the tile (fx, fy from 0 to 1).
function across(field: Float32Array, c00: number, c10: number, c01: number, c11: number, fx: number, fy: number): number {
  return field[c00] + (field[c10] - field[c00]) * fx + (field[c01] + (field[c11] - field[c01]) * fx - (field[c00] + (field[c10] - field[c00]) * fx)) * fy
}

// Sets `out` to `t` of the way from `a` to `b` (out may be a or b).
function mixInto(out: Rgb, a: Rgb, b: Rgb, t: number): void {
  const k = Math.max(0, Math.min(1, t))
  const r = a[0] + (b[0] - a[0]) * k
  const g = a[1] + (b[1] - a[1]) * k
  const bl = a[2] + (b[2] - a[2]) * k
  out[0] = r
  out[1] = g
  out[2] = bl
}
