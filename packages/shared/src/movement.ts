import { BUSH_SPEED_PERCENT, PLAYER_HALF_SIZE, PLAYER_SPEED, PLAYER_SPEED_DIAGONAL, SUB, WORLD_MAX_TILE, WORLD_MIN_TILE } from './constants.ts'
import { floorDiv } from './geometry.ts'

// Player movement: one input a tick, which is the movement keys held, as bits. It is whole numbers only, so the
// page's prediction of its own player and the server's are the same for the same inputs, and replaying the inputs
// the server has not answered yet on top of where the server put the player lands where the page had it.
export const KEY_UP = 1
export const KEY_DOWN = 2
export const KEY_LEFT = 4
export const KEY_RIGHT = 8
// Held for ATTACK_SLOW_TICKS after an attack (its windup too): the player moves at ATTACK_SPEED_PERCENT of its speed.
export const KEY_SLOW = 16
export const ATTACK_SLOW_TICKS = 9
export const ATTACK_SPEED_PERCENT = 70
// Held while the attack button is held down to charge an attack (see weapons.ts): the player moves at
// CHARGE_SPEED_PERCENT of its speed.
export const KEY_CHARGE = 32
export const CHARGE_SPEED_PERCENT = 45

// A push: the player is moved along an angle this tick instead of walking (the keys are not played): a melee attack's
// step forward, a knife's dash (see `lungeOf` in weapons.ts). It goes in the input with the keys, so the page and the
// server move the player the same, on the same input. Its angle is one of PUSH_ANGLES (bits 6 to 11), and how far it
// goes this tick PUSH_STEP units for each of its level (bits 12 to 15, 1 to 15; 0 is no push). The server only lets a
// player push so far in a while (see the room's push allowance), so a page cannot fly about.
const PUSH_ANGLE_SHIFT = 6
const PUSH_ANGLES = 64
const PUSH_LEVEL_SHIFT = 12
const PUSH_LEVELS = 16
export const PUSH_STEP = 9
const PUSH_BITS = ((PUSH_ANGLES - 1) << PUSH_ANGLE_SHIFT) | ((PUSH_LEVELS - 1) << PUSH_LEVEL_SHIFT)
// The furthest one tick's push goes, in units.
export const PUSH_MAX = (PUSH_LEVELS - 1) * PUSH_STEP
export const ALL_KEYS = KEY_UP | KEY_DOWN | KEY_LEFT | KEY_RIGHT | KEY_SLOW | KEY_CHARGE | PUSH_BITS

// Keys with a push along `angle` (radians) of `speed` units (rounded to a whole PUSH_STEP, at least one, at most
// PUSH_MAX) added.
export function withPush(keys: number, angle: number, speed: number): number {
  const level = Math.max(1, Math.min(PUSH_LEVELS - 1, Math.round(speed / PUSH_STEP)))
  const turn = ((Math.round((angle / (Math.PI * 2)) * PUSH_ANGLES) % PUSH_ANGLES) + PUSH_ANGLES) % PUSH_ANGLES
  return (keys & ~PUSH_BITS) | (turn << PUSH_ANGLE_SHIFT) | (level << PUSH_LEVEL_SHIFT)
}

// The push in some keys: how far it moves the player this tick along x and y (units), and how far that is; undefined
// for none.
export function pushOf(keys: number): { dx: number; dy: number; length: number } | undefined {
  const level = (keys >> PUSH_LEVEL_SHIFT) & (PUSH_LEVELS - 1)
  if (level === 0) return undefined
  const angle = (((keys >> PUSH_ANGLE_SHIFT) & (PUSH_ANGLES - 1)) / PUSH_ANGLES) * Math.PI * 2
  const length = level * PUSH_STEP
  return { dx: Math.round(Math.cos(angle) * length), dy: Math.round(Math.sin(angle) * length), length }
}

// Keys with any push taken out.
export function withoutPush(keys: number): number {
  return keys & ~PUSH_BITS
}

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

const MIN_UNITS = WORLD_MIN_TILE * SUB
const MAX_UNITS = (WORLD_MAX_TILE + 1) * SUB - 1

// Calls `each` with every solid box in the tiles from tx0, ty0 to tx1, ty1, in world units: left, top, right, bottom
// (the right and bottom edges not included). As numbers, not arrays: everything that walks calls this many times a tick,
// and it allocates nothing.
type EachBox = (left: number, top: number, right: number, bottom: number) => void
function eachBox(solid: IsSolid, tx0: number, ty0: number, tx1: number, ty1: number, each: EachBox): void {
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const found = solid(tx, ty)
      if (found === false) continue
      const ox = tx * SUB
      const oy = ty * SUB
      if (found === true) {
        each(ox, oy, ox + SUB, oy + SUB)
        continue
      }
      for (let i = 0; i < found.length; i++) {
        const box = found[i]
        each(ox + box[0], oy + box[1], ox + box[2], oy + box[3])
      }
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
  // Pushed (a lunge, a dash): moved along the push instead of walking, stopping against anything solid.
  const push = pushOf(keys)
  if (push) return solid ? moveBox(position, push.dx, push.dy, PLAYER_HALF_SIZE, solid) : { x: clampUnits(position.x + push.dx), y: clampUnits(position.y + push.dy) }
  const { dx, dy } = keysDirection(keys)
  if (dx === 0 && dy === 0) return position
  const speed = walkSpeed(keys, speedPercent, slow !== undefined && slow(floorDiv(position.x, SUB), floorDiv(position.y, SUB)))
  let x = clampUnits(position.x + dx * speed)
  if (solid && x !== position.x) x = stopAlong(position.x, x, position.y, solid, false)
  let y = clampUnits(position.y + dy * speed)
  if (solid && y !== position.y) y = stopAlong(position.y, y, x, solid, true)
  // Walking straight into the very edge of something (the corner of a stump beside a workbench): slip round it.
  if (solid && dy === 0 && dx !== 0 && x === position.x) return { x, y: slipAround(position.x, position.y, dx * speed, speed, solid, false) }
  if (solid && dx === 0 && dy !== 0 && y === position.y) return { x: slipAround(position.y, position.x, dy * speed, speed, solid, true), y }
  return { x, y }
}

// How far a player walks in a tick along each axis it moves on (units), for its keys: slower going diagonally, at
// `speedPercent` (the cold), through a bush (`slowed`), just after an attack and while charging one.
function walkSpeed(keys: number, speedPercent: number, slowed: boolean): number {
  const { dx, dy } = keysDirection(keys)
  let speed = dx !== 0 && dy !== 0 ? PLAYER_SPEED_DIAGONAL : PLAYER_SPEED
  if (speedPercent !== 100) speed = Math.floor((speed * speedPercent) / 100)
  if (slowed) speed = Math.floor((speed * BUSH_SPEED_PERCENT) / 100)
  if (keys & KEY_SLOW) speed = Math.floor((speed * ATTACK_SPEED_PERCENT) / 100)
  if (keys & KEY_CHARGE) speed = Math.floor((speed * CHARGE_SPEED_PERCENT) / 100)
  return speed
}

// How far a tick of keys moves a player, along x and y (units), with nothing in the way: its push if it has one, else
// its walk (see `stepPlayer`). What a player on a raft moves by.
export function walkDelta(keys: number, speedPercent = 100): { dx: number; dy: number } {
  const push = pushOf(keys)
  if (push) return { dx: push.dx, dy: push.dy }
  const { dx, dy } = keysDirection(keys)
  if (dx === 0 && dy === 0) return { dx: 0, dy: 0 }
  const speed = walkSpeed(keys, speedPercent, false)
  return { dx: dx * speed, dy: dy * speed }
}

// How near the edge of what it walks into (units) a player is slid round it rather than stopped.
export const CORNER_SLIP = 64

// A player walking straight along one axis (y if `vertical`), stopped dead by something it only just catches the edge
// of: where it goes across instead, to slip round the edge. `along`/`across` are where it is, `move` how far it tried to
// go along, `speed` how far it moves across at most this tick. If moving across by up to CORNER_SLIP (the way that is
// less far, the lower way on a tie) would leave its way clear, it moves that way; otherwise it stays where it is.
function slipAround(along: number, across: number, move: number, speed: number, solid: IsSolid, vertical: boolean): number {
  const STEP = 4
  for (let offset = STEP; offset <= CORNER_SLIP; offset += STEP) {
    for (const side of [-1, 1]) {
      const to = clampUnits(across + side * offset)
      // Its way along must be clear from there, and its way across to there too.
      if (stopAlong(along, clampUnits(along + move), to, solid, vertical) === along) continue
      const nudge = clampUnits(across + side * Math.min(offset, speed))
      if (stopAlong(across, nudge, along, solid, !vertical) !== nudge) continue
      return nudge
    }
  }
  return across
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
  const each: EachBox = (left, top, right, bottom) => {
    // Along is the axis it moves on, across the other.
    const along0 = vertical ? top : left
    const along1 = vertical ? bottom : right
    const across0 = vertical ? left : top
    const across1 = vertical ? right : bottom
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
  const x0 = position.x - half
  const x1 = position.x + half
  const y0 = position.y - half
  const y1 = position.y + half
  let over = false
  eachBox(solid, floorDiv(x0, SUB), floorDiv(y0, SUB), floorDiv(x1, SUB), floorDiv(y1, SUB), (left, top, right, bottom) => {
    if (!over && x0 < right && x1 >= left && y0 < bottom && y1 >= top) over = true
  })
  return over
}

// The solid boxes a square standing at `position` is over.
function overlapping(position: PlayerPosition, solid: IsSolid, half: number): Box[] {
  const x0 = position.x - half
  const x1 = position.x + half
  const y0 = position.y - half
  const y1 = position.y + half
  const found: Box[] = []
  eachBox(solid, floorDiv(x0, SUB), floorDiv(y0, SUB), floorDiv(x1, SUB), floorDiv(y1, SUB), (left, top, right, bottom) => {
    if (x0 < right && x1 >= left && y0 < bottom && y1 >= top) found.push([left, top, right, bottom])
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
// how far they overlap, the lighter one more, at most PUSH_PER_TICK a tick (a firm shove: more than anything walks in a
// tick, so nothing can push its way onto another). `half` is how far each reaches from its middle. Gives how far each
// moves, or undefined if they do not overlap.
export const PUSH_PER_TICK = 48
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
