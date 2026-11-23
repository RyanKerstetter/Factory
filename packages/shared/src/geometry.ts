import { CHUNK_SIZE, SUB, WORLD_MAX_TILE, WORLD_MIN_TILE } from './constants.ts'

// The four ways a building can face. Screen y grows downwards, so turning clockwise goes east, south, west, north.
export type Direction = 0 | 1 | 2 | 3
export const EAST: Direction = 0
export const SOUTH: Direction = 1
export const WEST: Direction = 2
export const NORTH: Direction = 3
export const DIR_X: readonly number[] = [1, 0, -1, 0]
export const DIR_Y: readonly number[] = [0, 1, 0, -1]
export function opposite(dir: Direction): Direction {
  return ((dir + 2) & 3) as Direction
}

export function rotateCW(dir: Direction): Direction {
  return ((dir + 1) & 3) as Direction
}

export function rotateCCW(dir: Direction): Direction {
  return ((dir + 3) & 3) as Direction
}

// Division rounded down (towards minus infinity), for tile and chunk coordinates that can be negative.
export function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor)
}

export function isInsideWorld(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= WORLD_MIN_TILE && x <= WORLD_MAX_TILE && y >= WORLD_MIN_TILE && y <= WORLD_MAX_TILE
}

// A chunk's ID: one whole number for its two coordinates, which sort row by row, top to bottom. Every list of
// chunks is walked in order of these, never in the order of a hash map.
const CHUNK_OFFSET = 1024
const CHUNK_SPAN = 2048

export function chunkId(cx: number, cy: number): number {
  return (cy + CHUNK_OFFSET) * CHUNK_SPAN + (cx + CHUNK_OFFSET)
}

export function chunkCoords(id: number): { cx: number; cy: number } {
  return { cx: (id % CHUNK_SPAN) - CHUNK_OFFSET, cy: Math.floor(id / CHUNK_SPAN) - CHUNK_OFFSET }
}

export function chunkOfTile(x: number, y: number): number {
  return chunkId(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE))
}

// The tile a fixed-point position is on.
export function tileOfUnits(units: number): number {
  return floorDiv(units, SUB)
}

// The middle of a tile, in units.
export function tileMiddle(x: number, y: number): { x: number; y: number } {
  return { x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 }
}

// A tile's place inside its chunk, 0 to CHUNK_SIZE² - 1, row by row.
export function localTileIndex(x: number, y: number): number {
  const lx = x - floorDiv(x, CHUNK_SIZE) * CHUNK_SIZE
  const ly = y - floorDiv(y, CHUNK_SIZE) * CHUNK_SIZE
  return ly * CHUNK_SIZE + lx
}

// The chunks within `radius` of a chunk in both directions (a square), in ID order, left out where they are past
// the edge of the world.
export function chunksAround(id: number, radius: number): number[] {
  const { cx, cy } = chunkCoords(id)
  const found: number[] = []
  const min = floorDiv(WORLD_MIN_TILE, CHUNK_SIZE)
  const max = floorDiv(WORLD_MAX_TILE, CHUNK_SIZE)
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x >= min && x <= max && y >= min && y <= max) found.push(chunkId(x, y))
    }
  }
  return found
}

// How many chunks apart two chunks are, the larger of the two directions.
export function chunkDistance(a: number, b: number): number {
  const ca = chunkCoords(a)
  const cb = chunkCoords(b)
  return Math.max(Math.abs(ca.cx - cb.cx), Math.abs(ca.cy - cb.cy))
}

// The square of the distance in units between a fixed-point position and the middle of a tile.
export function distanceToTileSquared(px: number, py: number, x: number, y: number): number {
  const dx = x * SUB + SUB / 2 - px
  const dy = y * SUB + SUB / 2 - py
  return dx * dx + dy * dy
}
