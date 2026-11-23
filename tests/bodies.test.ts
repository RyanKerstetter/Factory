import assert from 'node:assert/strict'
import test from 'node:test'
import { separateBodies, type Body } from '../apps/server/src/bodies.ts'

// Bodies that can only be where x and y are at least `wall` (a corner at wall, wall).
function crowd(count: number, at: { x: number; y: number }, half: number, wall = -Infinity): Body[] {
  return Array.from({ length: count }, (_, i): Body => {
    const body: Body = {
      x: at.x + i,
      y: at.y,
      half,
      mass: 1,
      move: (dx, dy) => ({ x: Math.max(wall + half, body.x + dx), y: Math.max(wall + half, body.y + dy) }),
    }
    return body
  })
}

const worstOverlap = (bodies: readonly Body[]): number => {
  let worst = 0
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]
      const b = bodies[j]
      worst = Math.max(worst, a.half + b.half - Math.hypot(a.x - b.x, a.y - b.y))
    }
  }
  return worst
}

test('bodies piled on one spot (skeletons closing in) are pushed apart within a few ticks, not left standing on each other', () => {
  const bodies = crowd(6, { x: 5000, y: 5000 }, 77)
  for (let tick = 0; tick < 10; tick++) separateBodies(bodies)
  assert.ok(worstOverlap(bodies) <= 4, `still overlapping by ${worstOverlap(bodies)} units`)
})

test('a herd crowded into a corner spreads out along the walls instead of stacking', () => {
  const bodies = crowd(5, { x: 100, y: 100 }, 60, 0)
  for (let tick = 0; tick < 30; tick++) separateBodies(bodies)
  assert.ok(worstOverlap(bodies) <= 4, `still overlapping by ${worstOverlap(bodies)} units`)
  for (const body of bodies) assert.ok(body.x >= 60 && body.y >= 60, 'kept out of the walls')
})

test('a fixed body (the frost lich) never moves; whoever is on it takes the whole push', () => {
  const lich: Body = { x: 1000, y: 1000, half: 100, mass: 1, fixed: true, move: () => assert.fail('the lich was moved') }
  const player: Body = { x: 1010, y: 1000, half: 77, mass: 1, move: (dx, dy) => ({ x: player.x + dx, y: player.y + dy }) }
  for (let tick = 0; tick < 10; tick++) separateBodies([lich, player])
  assert.deepEqual([lich.x, lich.y], [1000, 1000])
  assert.ok(player.x - lich.x >= 177 - 1)
})
