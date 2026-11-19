import test from 'node:test'
import assert from 'node:assert/strict'
import { createEntity, FactoryWorld, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, solidIn, stepPlayer, SUB } from '../packages/shared/src/index.ts'
test('a player pushed into the side of a fence, anywhere along it (between tiles too), still slides along it', () => {
  const world = new FactoryWorld()
  for (let x = 0; x < 8; x++) world.addEntity(createEntity(x + 1, 'fence', x, 0, 0, 0))
  for (let y = 1; y < 8; y++) world.addEntity(createEntity(y + 20, 'fence', 0, y, 0, 0))
  const solid = solidIn(world)
  // Push down into the row from above at every x, then slide right; and push left into the column, then slide down.
  for (let sx = 0; sx < 6 * SUB; sx += 17) {
    let p = { x: SUB + sx, y: -SUB }
    for (let i = 0; i < 20; i++) p = stepPlayer(p, KEY_DOWN | KEY_RIGHT, solid)
    const start = p.x
    for (let i = 0; i < 10; i++) p = stepPlayer(p, KEY_DOWN | KEY_RIGHT, solid)
    assert.ok(p.x > start || p.x >= 8 * SUB, `stuck sliding right at ${start}`)
  }
  for (let sy = 0; sy < 5 * SUB; sy += 17) {
    let p = { x: 2 * SUB, y: 2 * SUB + sy }
    for (let i = 0; i < 20; i++) p = stepPlayer(p, KEY_LEFT | KEY_DOWN, solid)
    const start = p.y
    for (let i = 0; i < 6; i++) p = stepPlayer(p, KEY_LEFT | KEY_DOWN, solid)
    assert.ok(p.y > start, `stuck sliding down at ${start}`)
    p = { x: 2 * SUB, y: 7 * SUB - sy }
    for (let i = 0; i < 20; i++) p = stepPlayer(p, KEY_LEFT | KEY_UP, solid)
    const top = p.y
    for (let i = 0; i < 6; i++) p = stepPlayer(p, KEY_LEFT | KEY_UP, solid)
    assert.ok(p.y < top || p.y < SUB, `stuck sliding up at ${top}`)
  }
})
