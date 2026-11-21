import {
  airTemperatureAt,
  biomeSiteAt,
  CHUNK_SIZE,
  dungeonPartAt,
  hashInts,
  inDungeonDark,
  NO_ITEM,
  oreAt,
  waterAt,
  type DungeonPart,
  type Terrain,
} from '../../../../packages/shared/src/index.ts'

// What the ground looks like, for both views: a picture of each chunk, a few pixels to a tile. Every tile is drawn as
// what it is, edge to edge (sea or land, forest or mountain, beach, pond, shelf or deep ocean, the dungeon's flagstones
// and ice walls), with nothing softened across the edges between tiles; within a tile the colour varies in patches
// (grass, rock and snow, from noise turned off the grid so no patch lines up with the tiles), and the snow lies where
// the air (and a slow wander of noise) makes it cold enough. The sea is pale on the shelf by the land and dark in the
// deep ocean beyond, with foam along the land's edge.

// Pixels a side per tile, in the 3D view's ground and the 2D one's.
export const PIXELS_PER_TILE_3D = 8
export const PIXELS_PER_TILE_2D = 8

// The sea is shallow (the shelf) out to about SHELF_TILES from land, give or take SHELF_WOBBLE, and deep beyond.
export const SHELF_TILES = 6
const SHELF_WOBBLE = 2.5
// How far from land the distance to it is worked out (further is all just "far").
const COAST_REACH = SHELF_TILES + 5
// How far round a chunk its other facts are worked out: enough that softening them comes out the same on both sides of
// a chunk's edge.
const FIELD_MARGIN = 4

// How far, in °C, the snow line wanders either way of where the air's temperature would put it.
const SNOW_LINE_WANDER = 14

// How wide the foam along the land's edge is drawn, in tiles.
const FOAM_WIDTH = 0.14
// How wide a pond's bank is drawn, in tiles.
const POND_BANK = 0.12


// ---- colours, as [r, g, b] 0 to 255
type Rgb = [number, number, number]
const rgb = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
const SEA_SHALLOW = rgb(0x4a93c0)
const SEA_DEEP = rgb(0x173d6e)
const FOAM = rgb(0x9fd2e6)
const SAND = rgb(0xd8c690)
const WET_SAND = rgb(0xb5a676)
const GRASS_DARK = rgb(0x5c8238)
const GRASS_LIGHT = rgb(0x7a9c44)
// A pond: its water in three close blues, with pale glints and now and then a lily pad; its bank a broken edge of
// earth in several browns, pebbles, and gaps of shallow water.
const POND = rgb(0x3a74b0)
const POND_DARK = rgb(0x336aa3)
const POND_LIGHT = rgb(0x437fba)
const POND_GLINT = rgb(0x8fc2e8)
const POND_SHALLOW = rgb(0x5a95c6)
const BANK_DARK = rgb(0x4a3626)
const BANK = rgb(0x6b5038)
const BANK_LIGHT = rgb(0x8a6c4a)
const PEBBLE = rgb(0x8d8b84)
const LILY = rgb(0x4f9a3a)
const LILY_DARK = rgb(0x3a7a2c)
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
export const CRYPT_WALL = 0x3b4c5e
export const CRYPT_VOID = 0x0b1118
export const CRYPT_WALL_FACE = 0xa9c2d8
export const CRYPT_WALL_FOOT = 0x5d7389

// What a tile of the ground is, for the 3D view's heights and walls.
export type GroundKind = { kind: 'sea' } | { kind: 'pond' } | { kind: 'land' } | { kind: 'dungeon'; part: DungeonPart }

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

// Works out a chunk's ground, `perTile` pixels to a tile side.
export function groundChunk(terrain: Terrain, cx: number, cy: number, perTile: number): GroundChunk {
  const seed = terrain.seed
  const left = cx * CHUNK_SIZE
  const top = cy * CHUNK_SIZE
  // ---- facts at the middles of tiles: land or sea over the chunk and a margin (for the distance to land)
  const m = COAST_REACH
  const x0 = left - m
  const y0 = top - m
  const w = CHUNK_SIZE + 2 * m
  const index = (x: number, y: number): number => (y - y0) * w + (x - x0)
  const land = new Uint8Array(w * w)
  const dark = new Uint8Array(w * w)
  for (let y = y0; y < y0 + w; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = index(x, y)
      dark[i] = inDungeonDark(x, y) ? 1 : 0
      land[i] = dark[i] || biomeSiteAt(terrain, x, y) ? 1 : 0
    }
  }
  const coast = chamferDistance(land, w, m)
  // The rest for the chunk and FIELD_MARGIN tiles round it: enough for the blending of temperature to come out the
  // same as the next chunk's along their edge, so there is no seam between them.
  const fm = FIELD_MARGIN
  const n = CHUNK_SIZE + 2 * fm
  const near = (x: number, y: number): number => (y - top + fm) * n + (x - left + fm)
  const mountain = new Float32Array(n * n)
  const pond = new Float32Array(n * n)
  const temperature = new Float32Array(n * n)
  const ore = new Uint8Array(n * n)
  const kinds: GroundKind[] = []
  for (let y = top - fm; y < top + CHUNK_SIZE + fm; y++) {
    for (let x = left - fm; x < left + CHUNK_SIZE + fm; x++) {
      const i = near(x, y)
      if (dark[index(x, y)]) {
        kinds[i] = { kind: 'dungeon', part: dungeonPartAt(x, y) ?? 'void' }
        continue
      }
      const site = land[index(x, y)] ? biomeSiteAt(terrain, x, y) : undefined
      // The sea, for blending, takes the temperature of the air over it (so the mountains' snow does not stop short
      // of the water).
      temperature[i] = airTemperatureAt(terrain, x + 0.5, y + 0.5)
      if (!site) {
        kinds[i] = { kind: 'sea' }
        // Next to the mountains, the sea blends as mountain, so the rock runs right down to the water.
        mountain[i] = -1
        continue
      }
      mountain[i] = site.biome.key === 'mountain' ? 1 : 0
      const water = waterAt(terrain, x, y)
      pond[i] = water ? 1 : 0
      kinds[i] = { kind: water ? 'pond' : 'land' }
      ore[i] = oreAt(seed, x, y) !== NO_ITEM ? 1 : 0
    }
  }
  // A sea tile blends as whatever land is beside it (mountain if any is), so the coast is one biome's colour.
  for (let y = top - fm; y < top + CHUNK_SIZE + fm; y++) {
    for (let x = left - fm; x < left + CHUNK_SIZE + fm; x++) {
      const i = near(x, y)
      if (mountain[i] !== -1) continue
      let beside = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const inside = x + dx >= left - fm && x + dx < left + CHUNK_SIZE + fm && y + dy >= top - fm && y + dy < top + CHUNK_SIZE + fm
        if (inside && mountain[near(x + dx, y + dy)] === 1) beside = 1
        // Beyond the margin, ask the terrain.
        if (!inside && biomeSiteAt(terrain, x + dx, y + dy)?.biome.key === 'mountain') beside = 1
      }
      mountain[i] = beside
    }
  }
  // Softened likewise: the line between forest and mountain, and the ponds' edges.
  // ---- smooth noise, on the corners of tiles (the pixels blend between them)
  const c = CHUNK_SIZE + 1
  const corner = (x: number, y: number): number => (y - top) * c + (x - left)
  const grassPatch = new Float32Array(c * c)
  const rockPatch = new Float32Array(c * c)
  const wobble = new Float32Array(c * c)
  const jitter = new Float32Array(c * c)
  // Big, slow swells, so the snow line wanders in tongues and bays across the mountains rather than running straight
  // across them (the air's temperature changes in straight bands from the forest to the far side).
  const drift = new Float32Array(c * c)
  for (let y = top; y <= top + CHUNK_SIZE; y++) {
    for (let x = left; x <= left + CHUNK_SIZE; x++) {
      const i = corner(x, y)
      grassPatch[i] = organicNoise(seed, x, y, 7)
      rockPatch[i] = organicNoise(seed + 2, x, y, 5)
      wobble[i] = organicNoise(seed + 5, x, y, 8)
      jitter[i] = organicNoise(seed + 9, x, y, 2.3)
      drift[i] = organicNoise(seed + 17, x, y, 11) * 0.65 + organicNoise(seed + 19, x, y, 4.5) * 0.35
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
  // A tile at a time: what it is worked out once, then its pixels, each only its grain and patch.
  for (let ty = top; ty < top + CHUNK_SIZE; ty++) {
    for (let tx = left; tx < left + CHUNK_SIZE; tx++) {
      const kind = kinds[near(tx, ty)]
      const x0 = (tx - left) * perTile
      const y0 = (ty - top) * perTile
      const grain = (px: number, py: number): number => (hashInts(seed, left * perTile + px, top * perTile + py, 13) % 1000) / 1000
      // The value of a field on the tile's corners at a point of the tile (fx, fy from 0 to 1).
      const c00 = corner(tx, ty)
      const c10 = corner(tx + 1, ty)
      const c01 = corner(tx, ty + 1)
      const c11 = corner(tx + 1, ty + 1)
      const across = (field: Float32Array, fx: number, fy: number): number =>
        field[c00] + (field[c10] - field[c00]) * fx + (field[c01] + (field[c11] - field[c01]) * fx - (field[c00] + (field[c10] - field[c00]) * fx)) * fy
      if (kind.kind === 'dungeon') {
        const stone = hashInts(seed, tx, ty, 41) % 1000
        for (let py = 0; py < perTile; py++) {
          for (let px = 0; px < perTile; px++) {
            paintCrypt(kind.part, (px + 0.5) / perTile, (py + 0.5) / perTile, stone, grain(x0 + px, y0 + py), color)
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
      // Whether a pixel of the tile is within `width` (tiles) of an edge it shares with a tile `other` says is so.
      const atEdge = (fx: number, fy: number, width: number, w: boolean, e: boolean, n: boolean, south: boolean): boolean =>
        (w && fx < width) || (e && fx > 1 - width) || (n && fy < width) || (south && fy > 1 - width)
      if (!isLand) {
        // The sea: one pale colour over the shelf by the land, one dark colour over the deep, the line between them a
        // tile edge; foam along the edge of the land.
        const shelf = coast[index(tx, ty)] <= SHELF_TILES + (wobble[c00] - 0.5) * 2 * SHELF_WOBBLE
        for (let py = 0; py < perTile; py++) {
          for (let px = 0; px < perTile; px++) {
            const fx = (px + 0.5) / perTile
            const fy = (py + 0.5) / perTile
            const foam = atEdge(fx, fy, FOAM_WIDTH, landW, landE, landN, landS)
            mixInto(color, foam ? FOAM : shelf ? SEA_SHALLOW : SEA_DEEP, SEA_DEEP, 0)
            put(x0 + px, y0 + py)
          }
        }
        continue
      }
      const rocky = mountain[near(tx, ty)] === 1
      const shore = !landW || !landE || !landN || !landS
      const isPond = pond[near(tx, ty)] === 1
      const pondW = pond[near(tx - 1, ty)] !== 1
      const pondE = pond[near(tx + 1, ty)] !== 1
      const pondN = pond[near(tx, ty - 1)] !== 1
      const pondS = pond[near(tx, ty + 1)] !== 1
      // The air's temperature at the tile's corners (for where the snow lies).
      const t00 = temperature[near(tx, ty)]
      // A lily pad on some pond tiles: where (its top left pixel), if this one has one.
      const lily = isPond && hashInts(seed, tx, ty, 77) % 100 < 14 ? { x: 2 + (hashInts(seed, tx, ty, 78) % (perTile - 5)), y: 2 + (hashInts(seed, tx, ty, 79) % (perTile - 5)) } : undefined
      for (let py = 0; py < perTile; py++) {
        for (let px = 0; px < perTile; px++) {
          const fx = (px + 0.5) / perTile
          const fy = (py + 0.5) / perTile
          const speckle = grain(x0 + px, y0 + py)
          if (isPond) {
            // A pond: its own tiles, exactly, all of one depth. Its edge where it meets land: a single pixel of earth in
            // several browns and pebbles, broken here and there by shallow water. Within: close blues in patches and
            // grain, short pale glints along the water, and a lily pad now and then.
            const gx = left * perTile + x0 + px
            const gy = top * perTile + y0 + py
            if (atEdge(fx, fy, POND_BANK, pondW, pondE, pondN, pondS)) {
              const pick = hashInts(seed, gx, gy, 71) % 100
              mixInto(color, pick < 28 ? POND_SHALLOW : pick < 52 ? BANK_DARK : pick < 76 ? BANK : pick < 91 ? BANK_LIGHT : PEBBLE, POND, 0)
            } else if (lily && px >= lily.x && px <= lily.x + 2 && py >= lily.y && py <= lily.y + 1) {
              mixInto(color, px === lily.x + 2 && py === lily.y ? POND : (px + py) % 3 === 0 ? LILY_DARK : LILY, POND, 0)
            } else if (hashInts(seed, Math.floor(gx / 3), gy, 73) % 100 < 3) {
              mixInto(color, POND_GLINT, POND, 0)
            } else {
              const tone = across(grassPatch, fx, fy) * 0.5 + speckle * 0.5
              mixInto(color, tone < 0.34 ? POND_DARK : tone < 0.7 ? POND : POND_LIGHT, POND, 0)
            }
          } else if (rocky) {
            // Rock, or snow where it is cold enough: one or the other, a hard edge between them.
            const patch = across(rockPatch, fx, fy)
            const snowy = snowCover(t00 + (across(drift, fx, fy) - 0.5) * SNOW_LINE_WANDER, patch) >= 0.5
            if (snowy) mixInto(color, SNOW_SHADE, SNOW, 0.55 + speckle * 0.45)
            else mixInto(color, ROCK_DARK, ROCK, patch * 0.6 + speckle * 0.4)
          } else if (shore) {
            // A beach: the forest's tiles along the sea are sand.
            mixInto(color, WET_SAND, SAND, 0.6 + speckle * 0.4)
          } else {
            mixInto(color, GRASS_DARK, GRASS_LIGHT, across(grassPatch, fx, fy) * 0.75 + speckle * 0.25)
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
function paintCrypt(part: DungeonPart, fx: number, fy: number, stone: number, speckle: number, out: Rgb): void {
  if (part === 'void') return void mixInto(out, rgb(CRYPT_VOID), rgb(CRYPT_VOID), 0)
  if (part === 'wall') return void mixInto(out, rgb(CRYPT_WALL), rgb(CRYPT_WALL_FACE), speckle * 0.15)
  if (Math.min(fx, fy, 1 - fx, 1 - fy) < 0.06) return void mixInto(out, CRYPT_GROUT, CRYPT_GROUT, 0)
  mixInto(out, CRYPT_FLOOR_DARK, CRYPT_FLOOR, stone / 1000)
  // Frost on the stones in small, sharp-edged patches.
  if (speckle > 0.8) mixInto(out, out, CRYPT_FROST, 0.5)
}

// The distance from each place on a grid to the nearest land (1 in `land`), in tiles, out to `reach`: two passes of a
// chamfer distance (10 straight, 14 diagonal).
function chamferDistance(land: Uint8Array, w: number, reach: number): Float32Array {
  const far = (reach + 1) * 10
  const distance = new Uint16Array(w * w)
  for (let i = 0; i < w * w; i++) distance[i] = land[i] ? 0 : far
  const relax = (i: number, j: number, cost: number): void => {
    if (distance[j] + cost < distance[i]) distance[i] = distance[j] + cost
  }
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (x > 0) relax(i, i - 1, 10)
      if (y > 0) {
        relax(i, i - w, 10)
        if (x > 0) relax(i, i - w - 1, 14)
        if (x < w - 1) relax(i, i - w + 1, 14)
      }
    }
  }
  for (let y = w - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (x < w - 1) relax(i, i + 1, 10)
      if (y < w - 1) {
        relax(i, i + w, 10)
        if (x < w - 1) relax(i, i + w + 1, 14)
        if (x > 0) relax(i, i + w - 1, 14)
      }
    }
  }
  const tiles = new Float32Array(w * w)
  for (let i = 0; i < w * w; i++) tiles[i] = distance[i] / 10
  return tiles
}

// How much of a mountain spot is under snow, 0 to 1: none where the air is above freezing, patches as it cools, all of
// it in the deep cold. `patch` is a smooth noise 0 to 1 that makes the patches.
export function snowCover(temperature: number, patch: number): number {
  return Math.max(0, Math.min(1, (-1 - temperature) / 12 + (patch - 0.5) * 0.9))
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

// Smooth noise, 0 to 1, without the grid in it: two layers of value noise, each on a grid turned a different way, so
// where it is cut at a threshold (the snow line, the coast's wobble) the edge wanders freely instead of running along
// the grid's lines. `scale` is about the size of its features, in tiles.
export function organicNoise(seed: number, x: number, y: number, scale: number): number {
  const a = smoothNoise(seed, (x * 0.8 + y * 0.6) / scale, (y * 0.8 - x * 0.6) / scale)
  const b = smoothNoise(seed + 101, (x * 0.28 - y * 0.96) / (scale * 0.8), (y * 0.28 + x * 0.96) / (scale * 0.8))
  // Pulled back out towards 0 and 1 (an average of two is bunched round the middle).
  return Math.max(0, Math.min(1, 0.5 + ((a + b) / 2 - 0.5) * 1.6))
}

// Noise from 0 to 1 that changes smoothly: a value for each whole point, blended between them.
export function smoothNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const at = (px: number, py: number): number => (hashInts(seed, px, py, 29) % 1000) / 1000
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx
  return top + (bottom - top) * sy
}
