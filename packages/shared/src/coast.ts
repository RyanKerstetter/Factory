import { inDungeonDark } from './dungeon.ts'
import { organicNoise } from './noise.ts'
import { biomeSiteAt, SHELF_MOST, shelfWidthAt, type Terrain } from './terrain.ts'

// The coast: how far each sea tile is from land, and so whether it is on the shallow shelf or out in the deep sea. One
// working-out, used by everything that cares (the ground's picture, the map, and how fast a raft goes), so they always
// agree to the tile.
//
// A sea tile is on the shelf when it is no further from land (a chamfer distance: 1 a step across, 1.4 a step
// diagonally) than `shelfWidthAt` there, give or take SHELF_WOBBLE (smooth noise, so the shelf's edge wanders). The
// distance is worked out over an area and COAST_REACH round it; that is as far as the shelf ever reaches, so the answer
// for a tile is the same whatever area it was worked out in.

const SHELF_WOBBLE = 2.5
// How far from land the distance to it is worked out (further is all just "far").
export const COAST_REACH = Math.ceil(SHELF_MOST + SHELF_WOBBLE) + 1

// An area's coast: for its tiles and COAST_REACH round them, which are land (or the dark rock round the dungeons) and
// how far each is from land.
export type Coast = {
  // The area worked out, margin and all: its top left tile and size.
  readonly x0: number
  readonly y0: number
  readonly width: number
  readonly height: number
  readonly land: Uint8Array
  readonly distance: Float32Array
  // Where a tile is in `land` and `distance` (it must be in the area).
  index(x: number, y: number): number
}

// The coast of the tiles from (left, top), `width` by `height` of them.
export function coastAround(terrain: Terrain, left: number, top: number, width: number, height: number): Coast {
  const m = COAST_REACH
  const x0 = left - m
  const y0 = top - m
  const w = width + 2 * m
  const h = height + 2 * m
  const index = (x: number, y: number): number => (y - y0) * w + (x - x0)
  const land = new Uint8Array(w * h)
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) land[index(x, y)] = inDungeonDark(x, y) || biomeSiteAt(terrain, x, y) ? 1 : 0
  }
  return { x0, y0, width: w, height: h, land, distance: chamferDistance(land, w, h, m), index }
}

// Whether a tile (in the coast's area, not its margin) is shallow sea on the shelf. Land is not.
export function isShelf(terrain: Terrain, coast: Coast, x: number, y: number): boolean {
  const i = coast.index(x, y)
  if (coast.land[i]) return false
  const width = shelfWidthAt(terrain, x, y)
  if (width === Infinity) return true
  return coast.distance[i] <= width + (organicNoise(terrain.seed + 5, x, y, 8) - 0.5) * 2 * SHELF_WOBBLE
}

// How far each tile is from land (0 on land), in tiles, out to `reach` (further is reach + 1): two passes of a chamfer
// (1 a step across, 1.4 diagonally).
function chamferDistance(land: Uint8Array, w: number, h: number, reach: number): Float32Array {
  const far = (reach + 1) * 10
  const distance = new Uint16Array(w * h)
  for (let i = 0; i < w * h; i++) distance[i] = land[i] ? 0 : far
  const relax = (i: number, j: number, cost: number): void => {
    if (distance[j] + cost < distance[i]) distance[i] = distance[j] + cost
  }
  for (let y = 0; y < h; y++) {
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
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (x < w - 1) relax(i, i + 1, 10)
      if (y < h - 1) {
        relax(i, i + w, 10)
        if (x < w - 1) relax(i, i + w + 1, 14)
        if (x > 0) relax(i, i + w - 1, 14)
      }
    }
  }
  const tiles = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) tiles[i] = distance[i] / 10
  return tiles
}
