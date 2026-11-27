import { dungeonBlocks, floorDiv, moveBox, pushOut, SUB, tileMiddle, type IsSolid } from '../../../packages/shared/src/index.ts'

// Finding the way, for anything the server walks about (animals, monsters): whether the straight way to a point is
// clear, a way round what is in it over the tiles near by, a step along either, and whether one can see a point.

// How far (tiles, each way) a way round is looked for, and how often (ticks) one being followed is looked for again.
export const PATH_REACH = 18
export const PATH_EVERY = 12

// A way round something (tile middles, in units, next first), what it leads to, and when it was found.
export type Path = { steps: Array<{ x: number; y: number }>; toX: number; toY: number; at: number }

// Whether nothing that blocks lies on the straight way from one point to another (looked at every half tile), for
// something `half` units across each way from its middle: every tile its body sweeps over on the way (from where it
// is), not only those its middle crosses. (Its middle missing a rock's or a building's corner is not enough: its body
// catches on it and, the way on nearly straight, its step to the side rounds to nothing, so it stands there; or it
// slides off, turns back into it, and is stuck there turning to and fro.)
export function straightClear(from: { x: number; y: number }, x: number, y: number, blocked: IsSolid, half = 0): boolean {
  const steps = Math.ceil(Math.hypot(x - from.x, y - from.y) / (SUB / 2))
  let lastX = from.x
  let lastY = from.y
  for (let i = 1; i <= steps; i++) {
    const px = Math.round(from.x + ((x - from.x) * i) / steps)
    const py = Math.round(from.y + ((y - from.y) * i) / steps)
    // The body here and where it was at the last point looked at, and everything between.
    for (let tileY = floorDiv(Math.min(py, lastY) - half, SUB); tileY <= floorDiv(Math.max(py, lastY) + half, SUB); tileY++) {
      for (let tileX = floorDiv(Math.min(px, lastX) - half, SUB); tileX <= floorDiv(Math.max(px, lastX) + half, SUB); tileX++) {
        if (blocked(tileX, tileY) !== false) return false
      }
    }
    lastX = px
    lastY = py
  }
  return true
}

// The tiles to walk through (their middles, next first) to reach a tile from a point, not cutting corners, over the
// tiles within PATH_REACH of it; none if there is no way within that.
export function findPath(from: { x: number; y: number }, toX: number, toY: number, blocked: IsSolid): Array<{ x: number; y: number }> {
  const fromX = floorDiv(from.x, SUB)
  const fromY = floorDiv(from.y, SUB)
  if (Math.abs(toX - fromX) > PATH_REACH || Math.abs(toY - fromY) > PATH_REACH) return []
  const span = PATH_REACH * 2 + 1
  const key = (x: number, y: number): number => (y - fromY + PATH_REACH) * span + (x - fromX + PATH_REACH)
  const inside = (x: number, y: number): boolean => Math.abs(x - fromX) <= PATH_REACH && Math.abs(y - fromY) <= PATH_REACH
  const open = (x: number, y: number): boolean => inside(x, y) && blocked(x, y) === false
  const came = new Map<number, number>([[key(fromX, fromY), -1]])
  const queue: Array<[number, number]> = [[fromX, fromY]]
  let found = false
  for (let i = 0; i < queue.length && !found; i++) {
    const [x, y] = queue[i]
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx
      const ny = y + dy
      if (came.has(key(nx, ny))) continue
      const target = nx === toX && ny === toY
      if (!target && !open(nx, ny)) continue
      // Diagonally only past two open tiles, so it never cuts a corner.
      if (dx !== 0 && dy !== 0 && (!open(x + dx, y) || !open(x, y + dy))) continue
      came.set(key(nx, ny), key(x, y))
      if (target) {
        found = true
        break
      }
      queue.push([nx, ny])
    }
  }
  if (!found) return []
  const steps: Array<{ x: number; y: number }> = []
  for (let at = key(toX, toY); at !== key(fromX, fromY); at = came.get(at)!) {
    const x = (at % span) - PATH_REACH + fromX
    const y = Math.floor(at / span) - PATH_REACH + fromY
    steps.unshift(tileMiddle(x, y))
  }
  return steps
}

// Something that walks: where its middle is (units), how far it reaches each way, and the way round it is following.
export type Walker = { x: number; y: number; path?: Path }

// A step straight towards a point, at `speed` units a tick, kept out of what blocks. Gives whether it was already
// within `near` of it (and so did not move).
export function stepToward(walker: Walker, halfSize: number, x: number, y: number, speed: number, near: number, blocked: IsSolid): boolean {
  const dx = x - walker.x
  const dy = y - walker.y
  const distance = Math.hypot(dx, dy)
  if (distance <= near) return true
  const step = Math.min(speed, distance)
  const from = pushOut(walker, blocked, halfSize)
  const to = moveBox(from, Math.round((dx / distance) * step), Math.round((dy / distance) * step), halfSize, blocked)
  walker.x = to.x
  walker.y = to.y
  return false
}

// Goes towards a point, round what is in the way, a step at `speed` units a tick (see `followTo`). Gives whether it is
// within `near` of the point.
export function pursue(walker: Walker, halfSize: number, x: number, y: number, speed: number, near: number, blocked: IsSolid, tick: number): boolean {
  return followTo(walker, x, y, near, blocked, tick, (tx, ty, within) => stepToward(walker, halfSize, tx, ty, speed, within, blocked), halfSize)
}

// Goes towards a point, round what is in the way: straight there while nothing blocks the way (of a body `half` units
// across each way), and otherwise along a way round (found again every PATH_EVERY ticks, or when the point moves to
// another tile). `step` takes one step towards a point, giving whether it was already within `near` of it (an animal's
// counts how long it has been stuck). Gives whether the walker is within `near` of the point.
export function followTo(
  walker: Walker,
  x: number,
  y: number,
  near: number,
  blocked: IsSolid,
  tick: number,
  step: (x: number, y: number, near: number) => boolean,
  half = 0,
): boolean {
  if (straightClear(walker, x, y, blocked, half)) {
    walker.path = undefined
    return step(x, y, near)
  }
  const toX = floorDiv(x, SUB)
  const toY = floorDiv(y, SUB)
  const path = walker.path
  if (!path || path.toX !== toX || path.toY !== toY || tick - path.at >= PATH_EVERY) {
    walker.path = { steps: findPath(walker, toX, toY, blocked), toX, toY, at: tick }
  }
  const steps = walker.path!.steps
  while (steps.length > 0 && Math.hypot(steps[0].x - walker.x, steps[0].y - walker.y) < 0.3 * SUB) steps.shift()
  // No way round found: straight at it after all.
  if (steps.length === 0) return step(x, y, near)
  step(steps[0].x, steps[0].y, 0)
  return Math.hypot(x - walker.x, y - walker.y) <= near
}

// Whether nothing of a dungeon's walls lies between two points (looked at every half tile): what a creature can see.
export function sightClear(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const steps = Math.ceil(distance / (SUB / 2))
  for (let i = 1; i < steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps
    const y = from.y + ((to.y - from.y) * i) / steps
    if (dungeonBlocks(floorDiv(Math.round(x), SUB), floorDiv(Math.round(y), SUB))) return false
  }
  return true
}
