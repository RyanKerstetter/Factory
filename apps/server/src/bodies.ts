import { pushApart, SUB, floorDiv, type PlayerPosition } from '../../../packages/shared/src/index.ts'

// Bodies blocking each other: every player, animal and monster takes up a round space (its `half` from its middle, in
// units), and none can stand on another. Once everything has moved on a tick, any two that overlap are pushed apart
// (see `pushApart`: the lighter one more), SEPARATE_PASSES times over, so a crowd (skeletons closing in, a herd of deer
// in a corner) settles out instead of piling up. Each body moves itself, so it is kept out of whatever it cannot walk
// into (a wall, a fence); one that cannot move at all (a boss) is `fixed`, and the other takes the whole push.
export type Body = {
  x: number
  y: number
  half: number
  mass: number
  fixed?: boolean
  // Moves the body by dx, dy (units) as far as it can go, and gives where it ends up.
  move: (dx: number, dy: number) => PlayerPosition
}

export const SEPARATE_PASSES = 3
// How heavy a body that never moves counts as.
const FIXED_MASS = 1_000_000

export function separateBodies(bodies: readonly Body[]): void {
  if (bodies.length < 2) return
  for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
    // Bodies by the tile they stand on, so each is only checked against those in the tiles round it.
    const cells = new Map<string, number[]>()
    const cellOf = (body: Body): [number, number] => [floorDiv(body.x, SUB), floorDiv(body.y, SUB)]
    bodies.forEach((body, i) => {
      const [cx, cy] = cellOf(body)
      const key = `${cx},${cy}`
      const list = cells.get(key)
      if (list) list.push(i)
      else cells.set(key, [i])
    })
    let moved = false
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]
      const [cx, cy] = cellOf(a)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (j <= i) continue
            const b = bodies[j]
            if (a.fixed && b.fixed) continue
            const push = pushApart(a, a.half, a.fixed ? FIXED_MASS : a.mass, b, b.half, b.fixed ? FIXED_MASS : b.mass)
            if (!push) continue
            moved = true
            if (!a.fixed) Object.assign(a, a.move(push.a.x, push.a.y))
            if (!b.fixed) Object.assign(b, b.move(push.b.x, push.b.y))
          }
        }
      }
    }
    if (!moved) return
  }
}
