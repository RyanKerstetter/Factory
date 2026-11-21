import { BUSH_SPEED_PERCENT, PLAYER_HALF_SIZE, PLAYER_SPEED, PLAYER_SPEED_DIAGONAL, SUB, WORLD_MAX_TILE, WORLD_MIN_TILE } from './constants.ts'
import { floorDiv } from './geometry.ts'

// Player movement: one input a tick, which is the movement keys held, as bits. It is whole numbers only, so the
// page's prediction of its own player and the server's are the same for the same inputs, and replaying the inputs
// the server has not answered yet on top of where the server put the player lands where the page had it.
export const KEY_UP = 1
export const KEY_DOWN = 2
export const KEY_LEFT = 4
export const KEY_RIGHT = 8
// Held while charging a shot or a throw, and for ATTACK_SLOW_TICKS after any attack: the player moves at
// CHARGE_SPEED_PERCENT of its speed.
export const KEY_SLOW = 16
export const ATTACK_SLOW_TICKS = 15
export const ALL_KEYS = KEY_UP | KEY_DOWN | KEY_LEFT | KEY_RIGHT | KEY_SLOW
export const CHARGE_SPEED_PERCENT = 45

export type PlayerPosition = { x: number; y: number }

// A solid part of a tile, in units from the tile's top left corner: [left, top, right, bottom), so [0, 0, SUB, SUB] is
// the whole tile.
export type Box = readonly [number, number, number, number]
// What on a tile cannot be walked into: nothing (false), all of it (true), or only some boxes (a fence's post and
// rails).
export type Solid = boolean | readonly Box[]
export type IsSolid = (x: number, y: number) => Solid
// Whether a tile slows whoever walks over it (a bush).
export type IsSlow = (x: number, y: number) => boolean

const WHOLE_TILE: readonly Box[] = [[0, 0, SUB, SUB]]

const MIN_UNITS = WORLD_MIN_TILE * SUB
const MAX_UNITS = (WORLD_MAX_TILE + 1) * SUB - 1

// Whether anything on a tile is solid at all.
export function isSolidAt(solid: IsSolid, x: number, y: number): boolean {
  const found = solid(x, y)
  return found === true || (Array.isArray(found) && found.length > 0)
}

// Calls `each` with every solid box in the tiles from tx0, ty0 to tx1, ty1, in world units: [left, top, right, bottom).
function eachBox(solid: IsSolid, tx0: number, ty0: number, tx1: number, ty1: number, each: (box: Box) => void): void {
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const found = solid(tx, ty)
      if (found === false) continue
      for (const [x0, y0, x1, y1] of found === true ? WHOLE_TILE : found) each([tx * SUB + x0, ty * SUB + y0, tx * SUB + x1, ty * SUB + y1])
    }
  }
}

// Which way the keys point, each -1, 0 or 1 (y grows downwards).
export function keysDirection(keys: number): { dx: number; dy: number } {
  return {
    dx: (keys & KEY_RIGHT ? 1 : 0) - (keys & KEY_LEFT ? 1 : 0),
    dy: (keys & KEY_DOWN ? 1 : 0) - (keys & KEY_UP ? 1 : 0),
  }
}

// Plays one tick of keys. With `solid`, a player found inside something solid (a tree that has just grown where it
// stands, say) is first pushed out to the nearest place it fits; then it moves, stopping against anything solid: along
// x and then along y, so it slides along a wall it walks into at an angle. Only what the player is not already over can
// stop it, so a player boxed in where it cannot be pushed out can still walk out. With `slow`, a player whose middle is
// over a tile it says is slow (a bush) moves at BUSH_SPEED_PERCENT of its speed. `speedPercent` slows it further (a
// player freezing in the cold: see cold.ts).
export function stepPlayer(start: PlayerPosition, keys: number, solid?: IsSolid, slow?: IsSlow, speedPercent = 100): PlayerPosition {
  const position = solid ? pushOut(start, solid) : start
  const { dx, dy } = keysDirection(keys)
  if (dx === 0 && dy === 0) return position
  let speed = dx !== 0 && dy !== 0 ? PLAYER_SPEED_DIAGONAL : PLAYER_SPEED
  if (speedPercent !== 100) speed = Math.floor((speed * speedPercent) / 100)
  if (slow && slow(floorDiv(position.x, SUB), floorDiv(position.y, SUB))) speed = Math.floor((speed * BUSH_SPEED_PERCENT) / 100)
  if (keys & KEY_SLOW) speed = Math.floor((speed * CHARGE_SPEED_PERCENT) / 100)
  let x = clampUnits(position.x + dx * speed)
  if (solid && x !== position.x) x = stopAlong(position.x, x, position.y, solid, false)
  let y = clampUnits(position.y + dy * speed)
  if (solid && y !== position.y) y = stopAlong(position.y, y, x, solid, true)
  return { x, y }
}

// Moves a square `half` units from its middle to each side by dx, dy, stopping against anything solid it was not over
// before: along x and then along y, so it slides along a wall it meets at an angle. What animals move with.
export function moveBox(start: PlayerPosition, dx: number, dy: number, half: number, solid: IsSolid): PlayerPosition {
  let x = clampUnits(start.x + dx)
  if (x !== start.x) x = stopAlong(start.x, x, start.y, solid, false, half)
  let y = clampUnits(start.y + dy)
  if (y !== start.y) y = stopAlong(start.y, y, x, solid, true, half)
  return { x, y }
}

// Moving a square from `from` to `to` along one axis (y if `vertical`), with `across` its middle on the other: where it
// stops, which is `to` unless something solid it was not over before is in the way. The square covers from its middle
// - half to its middle + half, both included.
function stopAlong(from: number, to: number, across: number, solid: IsSolid, vertical: boolean, half = PLAYER_HALF_SIZE): number {
  const acrossLow = across - half
  const acrossHigh = across + half
  const low = Math.min(from, to) - half
  const high = Math.max(from, to) + half
  const t0 = floorDiv(low, SUB)
  const t1 = floorDiv(high, SUB)
  const a0 = floorDiv(acrossLow, SUB)
  const a1 = floorDiv(acrossHigh, SUB)
  let stop = to
  const each = (box: Box): void => {
    // Along is the axis it moves on, across the other.
    const [along0, across0, along1, across1] = vertical ? [box[1], box[0], box[3], box[2]] : box
    if (acrossLow >= across1 || acrossHigh < across0) return
    // Already over it: it does not stop it.
    if (from - half < along1 && from + half >= along0) return
    if (to > from && along0 > from + half && stop + half >= along0) stop = along0 - 1 - half
    if (to < from && along1 <= from - half && stop - half < along1) stop = along1 + half
  }
  if (vertical) eachBox(solid, a0, t0, a1, t1, each)
  else eachBox(solid, t0, a0, t1, a1, each)
  return stop
}

// Whether a player (or a square `half` units to each side) standing at `position` is over anything solid.
export function overlapsSolid(position: PlayerPosition, solid: IsSolid, half = PLAYER_HALF_SIZE): boolean {
  return overlapping(position, solid, half).length > 0
}

// The solid boxes a square standing at `position` is over.
function overlapping(position: PlayerPosition, solid: IsSolid, half: number): Box[] {
  const x0 = position.x - half
  const x1 = position.x + half
  const y0 = position.y - half
  const y1 = position.y + half
  const found: Box[] = []
  eachBox(solid, floorDiv(x0, SUB), floorDiv(y0, SUB), floorDiv(x1, SUB), floorDiv(y1, SUB), (box) => {
    if (x0 < box[2] && x1 >= box[0] && y0 < box[3] && y1 >= box[1]) found.push(box)
  })
  return found
}

// How far a player is pushed when it has to look further than the edges of what it is stuck in, in tiles.
const PUSH_SEARCH = 3

// Where a player inside something solid is pushed to: the nearest place, by moving straight out past an edge of a
// solid box it is over, where it is clear of everything solid. If there is none (it is boxed in), the middle of the
// nearest clear tile within PUSH_SEARCH; if there is none of those either, it stays. Whole numbers and a fixed order,
// so the server and the page push it the same way.
export function pushOut(position: PlayerPosition, solid: IsSolid, half = PLAYER_HALF_SIZE): PlayerPosition {
  const over = overlapping(position, solid, half)
  if (over.length === 0) return position
  const { x, y } = position
  const candidates: PlayerPosition[] = []
  for (const [x0, y0, x1, y1] of over) {
    candidates.push({ x: x0 - 1 - half, y }, { x: x1 + half, y }, { x, y: y0 - 1 - half }, { x, y: y1 + half })
  }
  const tileX = floorDiv(x, SUB)
  const tileY = floorDiv(y, SUB)
  for (let ty = tileY - PUSH_SEARCH; ty <= tileY + PUSH_SEARCH; ty++) {
    for (let tx = tileX - PUSH_SEARCH; tx <= tileX + PUSH_SEARCH; tx++) candidates.push({ x: tx * SUB + SUB / 2, y: ty * SUB + SUB / 2 })
  }
  let best: PlayerPosition | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (candidate.x < MIN_UNITS || candidate.x > MAX_UNITS || candidate.y < MIN_UNITS || candidate.y > MAX_UNITS) continue
    const distance = (candidate.x - x) ** 2 + (candidate.y - y) ** 2
    if (distance >= bestDistance || overlapsSolid(candidate, solid, half)) continue
    best = candidate
    bestDistance = distance
  }
  return best ?? position
}

// Whether a player standing at `position` is over the tile at x, y.
export function playerOverlapsTile(position: PlayerPosition, x: number, y: number): boolean {
  return (
    floorDiv(position.x - PLAYER_HALF_SIZE, SUB) <= x &&
    floorDiv(position.x + PLAYER_HALF_SIZE, SUB) >= x &&
    floorDiv(position.y - PLAYER_HALF_SIZE, SUB) <= y &&
    floorDiv(position.y + PLAYER_HALF_SIZE, SUB) >= y
  )
}

// Two round things on top of each other (an animal and a player, or two animals) are pushed apart: each by its share of
// how far they overlap, the lighter one more, at most PUSH_PER_TICK a tick so it is a nudge, not a jump. `half` is how
// far each reaches from its middle. Gives how far each moves, or undefined if they do not overlap.
export const PUSH_PER_TICK = 12
export function pushApart(
  a: PlayerPosition,
  aHalf: number,
  aMass: number,
  b: PlayerPosition,
  bHalf: number,
  bMass: number,
): { a: PlayerPosition; b: PlayerPosition } | undefined {
  let dx = b.x - a.x
  let dy = b.y - a.y
  let distance = Math.hypot(dx, dy)
  const overlap = aHalf + bHalf - distance
  if (overlap <= 0) return undefined
  // Right on top of each other: apart along x.
  if (distance === 0) {
    dx = 1
    dy = 0
    distance = 1
  }
  const total = aMass + bMass
  const aShare = Math.min(PUSH_PER_TICK, (overlap * bMass) / total)
  const bShare = Math.min(PUSH_PER_TICK, (overlap * aMass) / total)
  const ux = dx / distance
  const uy = dy / distance
  return {
    a: { x: -Math.round(ux * aShare), y: -Math.round(uy * aShare) },
    b: { x: Math.round(ux * bShare), y: Math.round(uy * bShare) },
  }
}

function clampUnits(units: number): number {
  return Math.min(MAX_UNITS, Math.max(MIN_UNITS, units))
}
