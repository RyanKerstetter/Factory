import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  checkBuild,
  createInventory,
  EAST,
  FactoryWorld,
  KEY_DOWN,
  KEY_LEFT,
  KEY_RIGHT,
  moveSlot,
  PLAYER_HALF_SIZE,
  PLAYER_SPAWN,
  stepPlayer,
  SUB,
  type PlayerPosition,
} from '../packages/shared/src/index.ts'
import { run, TestClient } from './helpers.ts'

const walk = (from: PlayerPosition, keys: number, ticks: number, solid: (x: number, y: number) => boolean): PlayerPosition => {
  let position = from
  for (let i = 0; i < ticks; i++) position = stepPlayer(position, keys, solid)
  return position
}

test('a player stops flush against a solid tile', () => {
  const solid = (x: number, y: number): boolean => x === 2 && y === 0
  const stopped = walk(PLAYER_SPAWN, KEY_RIGHT, 30, solid)
  assert.equal(stopped.x, 2 * SUB - 1 - PLAYER_HALF_SIZE)
  assert.equal(stopped.y, PLAYER_SPAWN.y)
  const back = walk(PLAYER_SPAWN, KEY_LEFT, 30, (x) => x === -2)
  assert.equal(back.x, -1 * SUB + PLAYER_HALF_SIZE)
})

test('a player walking into a wall at an angle slides along it', () => {
  const wall = (x: number): boolean => x === 2
  const moved = walk(PLAYER_SPAWN, KEY_RIGHT | KEY_DOWN, 30, wall)
  assert.equal(moved.x, 2 * SUB - 1 - PLAYER_HALF_SIZE)
  assert.ok(moved.y > PLAYER_SPAWN.y + 4 * SUB)
})

test('a player something was built on can walk out of it', () => {
  const under = (x: number, y: number): boolean => x === 0 && y === 0
  const moved = walk(PLAYER_SPAWN, KEY_RIGHT, 10, under)
  assert.ok(moved.x > 2 * SUB)
})

test('a solid building cannot be built where its builder stands; a belt can', () => {
  const world = new FactoryWorld()
  assert.equal(checkBuild(world, 1, PLAYER_SPAWN, 0, 0, 'chest'), 'standing')
  assert.equal(checkBuild(world, 1, PLAYER_SPAWN, 0, 0, 'belt'), undefined)
  assert.equal(checkBuild(world, 1, PLAYER_SPAWN, 1, 0, 'chest'), undefined)
})

test('moving a stack swaps it with another kind and merges it with its own', () => {
  const inventory = createInventory(4)
  inventory.slots[0] = { item: 1, count: 30 }
  inventory.slots[1] = { item: 2, count: 5 }
  inventory.slots[2] = { item: 1, count: 40 }
  assert.ok(moveSlot(inventory, 0, 1))
  assert.deepEqual(inventory.slots.slice(0, 2), [{ item: 2, count: 5 }, { item: 1, count: 30 }])
  assert.ok(moveSlot(inventory, 1, 2))
  assert.deepEqual(inventory.slots.slice(1, 3), [{ item: 1, count: 20 }, { item: 1, count: 50 }])
  assert.ok(moveSlot(inventory, 0, 3))
  assert.deepEqual(inventory.slots[0], { item: 0, count: 0 })
  assert.deepEqual(inventory.slots[3], { item: 2, count: 5 })
  assert.equal(moveSlot(inventory, 0, 1), false)
})

test('the server stops a player at a chest, and the page agrees', () => {
  const room = new GameRoom('TEST', 1)
  const client = new TestClient(room, 'Walker')
  run(room, [client], 2)
  client.command({ k: 'build', x: 2, y: 0, kind: 'chest', dir: EAST })
  run(room, [client], 5)
  for (let seq = 1; seq <= 30; seq++) {
    room.receiveInputs(client.player, [[seq, KEY_RIGHT]])
    run(room, [client], 1)
  }
  assert.equal(client.player.position.x, 2 * SUB - 1 - PLAYER_HALF_SIZE)
})

test('the move command rearranges the player inventory on the server', () => {
  const room = new GameRoom('TEST', 1)
  const client = new TestClient(room, 'Packer')
  run(room, [client], 2)
  client.player.inventory.slots[0] = { item: 3, count: 12 }
  client.command({ k: 'move', from: 0, to: 5 })
  run(room, [client], 5)
  assert.deepEqual(client.player.inventory.slots[5], { item: 3, count: 12 })
  assert.deepEqual(client.inventory?.slots[5], { item: 3, count: 12 })
  assert.equal(client.results.at(-1)?.ok, true)
})
