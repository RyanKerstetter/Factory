import type { BuildingKind } from './buildings.ts'
import { GATE_OPEN_RADIUS, SUB } from './constants.ts'
import type { Box } from './movement.ts'

// Fences and gates, and wooden walls and doors, which work alike. A fence joins up with the fences and gates beside it
// (north, east, south, west), and what is solid of it is only its post and the rails out towards those it joins, so
// walking along a fence or round its end is tight to what is drawn. A gate is a rail right across its tile while it is
// shut. A wooden wall joins the walls and doors beside it the same way, thicker; a door is a gate in a wall.

// Which sides a fence joins, added together.
export const FENCE_N = 1
export const FENCE_E = 2
export const FENCE_S = 4
export const FENCE_W = 8

export function joinsFences(kind: BuildingKind | undefined): boolean {
  return kind === 'fence' || kind === 'gate'
}

export function joinsWalls(kind: BuildingKind | undefined): boolean {
  return kind === 'wood-wall' || kind === 'wood-door'
}

// What opens to let players through: a gate, or a wooden door.
export function isGateKind(kind: BuildingKind | undefined): kind is 'gate' | 'wood-door' {
  return kind === 'gate' || kind === 'wood-door'
}

// Which sides the fence or gate (or wooden wall or door) on a tile joins, from what is on the tiles round it: fences
// and gates join each other, and walls and doors each other.
export function fenceMask(kindAt: (x: number, y: number) => BuildingKind | undefined, x: number, y: number): number {
  const joins = joinsWalls(kindAt(x, y)) ? joinsWalls : joinsFences
  return (
    (joins(kindAt(x, y - 1)) ? FENCE_N : 0) |
    (joins(kindAt(x + 1, y)) ? FENCE_E : 0) |
    (joins(kindAt(x, y + 1)) ? FENCE_S : 0) |
    (joins(kindAt(x - 1, y)) ? FENCE_W : 0)
  )
}

// Fences are measured in 32nds of a tile; this many units to one.
const PX = SUB / 32
const box = (x0: number, y0: number, x1: number, y1: number): Box => [x0 * PX, y0 * PX, x1 * PX, y1 * PX]
// One even band through the middle of the tile, as thick as the post: the post and every rail line up flush, so
// nothing sticks out of the side of a fence for a player sliding along it to catch on.
const BAND_LOW = 11
const BAND_HIGH = 21
const POST = box(BAND_LOW, BAND_LOW, BAND_HIGH, BAND_HIGH)
const RAILS: ReadonlyArray<readonly [number, Box]> = [
  [FENCE_N, box(BAND_LOW, 0, BAND_HIGH, BAND_LOW)],
  [FENCE_E, box(BAND_HIGH, BAND_LOW, 32, BAND_HIGH)],
  [FENCE_S, box(BAND_LOW, BAND_HIGH, BAND_HIGH, 32)],
  [FENCE_W, box(0, BAND_LOW, BAND_LOW, BAND_HIGH)],
]
const FENCE_BOXES: ReadonlyArray<readonly Box[]> = Array.from({ length: 16 }, (_, mask) => [
  POST,
  ...RAILS.filter(([side]) => mask & side).map(([, rail]) => rail),
])

// What of a fence is solid, by the sides it joins.
export function fenceBoxes(mask: number): readonly Box[] {
  return FENCE_BOXES[mask & 15]
}

// A wooden wall: the same, in its own band, three quarters of a tile thick, as thick as it is drawn (see `woodWall` in
// the 3D models; a floor beside it reaches over the eighth of a tile left on each side).
const WALL_LOW = 4
const WALL_HIGH = 28
const WALL_BOXES: ReadonlyArray<readonly Box[]> = Array.from({ length: 16 }, (_, mask) => [
  box(WALL_LOW, WALL_LOW, WALL_HIGH, WALL_HIGH),
  ...(mask & FENCE_N ? [box(WALL_LOW, 0, WALL_HIGH, WALL_LOW)] : []),
  ...(mask & FENCE_E ? [box(WALL_HIGH, WALL_LOW, 32, WALL_HIGH)] : []),
  ...(mask & FENCE_S ? [box(WALL_LOW, WALL_HIGH, WALL_HIGH, 32)] : []),
  ...(mask & FENCE_W ? [box(0, WALL_LOW, WALL_LOW, WALL_HIGH)] : []),
])
export function wallBoxes(mask: number): readonly Box[] {
  return WALL_BOXES[mask & 15]
}

// Whether a gate runs east to west: unless it only joins fences to the north or south.
export function gateRunsAcross(mask: number): boolean {
  return (mask & (FENCE_E | FENCE_W)) !== 0 || (mask & (FENCE_N | FENCE_S)) === 0
}

const GATE_ACROSS: readonly Box[] = [box(0, BAND_LOW, 32, BAND_HIGH)]
const GATE_DOWN: readonly Box[] = [box(BAND_LOW, 0, BAND_HIGH, 32)]

const DOOR_ACROSS: readonly Box[] = [box(0, WALL_LOW, 32, WALL_HIGH)]
const DOOR_DOWN: readonly Box[] = [box(WALL_LOW, 0, WALL_HIGH, 32)]

// What of a shut gate (or wooden door) is solid (to animals: players walk through them).
export function gateBoxes(mask: number, kind: 'gate' | 'wood-door' = 'gate'): readonly Box[] {
  if (kind === 'wood-door') return gateRunsAcross(mask) ? DOOR_ACROSS : DOOR_DOWN
  return gateRunsAcross(mask) ? GATE_ACROSS : GATE_DOWN
}

// A gate's mode. By itself (GATE_AUTO) it opens while a player is at it. A right click opens it (GATE_OPEN) or shuts it
// (GATE_SHUT) and it stays so; a shut one goes back to opening by itself when a player walks over it.
export const GATE_AUTO = 0
export const GATE_OPEN = 1
export const GATE_SHUT = 2

// Whether a gate is open, in its mode, with these players about (positions in units).
export function gateIsOpen(gate: { x: number; y: number; mode: number }, players: ReadonlyArray<{ x: number; y: number }>): boolean {
  if (gate.mode === GATE_OPEN) return true
  if (gate.mode === GATE_SHUT) return false
  const x = gate.x * SUB + SUB / 2
  const y = gate.y * SUB + SUB / 2
  return players.some((player) => Math.hypot(player.x - x, player.y - y) <= GATE_OPEN_RADIUS)
}
