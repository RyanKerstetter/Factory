import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  checkBuild,
  terrainOf,
  createInventory,
  EAST,
  FactoryWorld,
  KEY_DOWN,
  KEY_LEFT,
  KEY_RIGHT,
  moveBetween,
  PLAYER_SLOTS,
  TRASH_SLOT,
  stackLimit,
  itemId,
  plainLimit,
  PLAYER_HALF_SIZE,
  PLAYER_SPAWN,
  stepPlayer,
  SUB,
  type PlayerPosition,
  boundsOf,
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

test('a player walking straight into the very edge of something slips round it, but not round the middle of it', () => {
  const block = (x: number, y: number): boolean => x === 2 && y === 0
  // Only the top 20 units of the player catch the block's bottom edge: it slides down past it.
  const edge = walk({ x: SUB / 2, y: SUB + PLAYER_HALF_SIZE - 20 }, KEY_RIGHT, 40, block)
  assert.ok(edge.x > 3 * SUB, `it got past (${edge.x})`)
  // Square on, it stops dead.
  const middle = walk({ x: SUB / 2, y: SUB / 2 }, KEY_RIGHT, 40, block)
  assert.equal(middle.x, 2 * SUB - 1 - PLAYER_HALF_SIZE)
  assert.equal(middle.y, SUB / 2)
})

test('the stations and fires stand in the way with the same box, so walking along a row of them catches on nothing', () => {
  const kinds = ['stump', 'workbench', 'campfire', 'oven', 'chest', 'feeder', 'well'] as const
  const first = JSON.stringify(boundsOf(kinds[0]))
  for (const kind of kinds) assert.equal(JSON.stringify(boundsOf(kind)), first, kind)
})

test('a player something was built on can walk out of it', () => {
  const under = (x: number, y: number): boolean => x === 0 && y === 0
  const moved = walk(PLAYER_SPAWN, KEY_RIGHT, 10, under)
  assert.ok(moved.x > 2 * SUB)
})

test('a solid building cannot be built where its builder stands; a belt can', () => {
  const world = new FactoryWorld()
  assert.equal(checkBuild(world, terrainOf(1), PLAYER_SPAWN, 0, 0, 'chest'), 'standing')
  assert.equal(checkBuild(world, terrainOf(1), PLAYER_SPAWN, 0, 0, 'belt'), undefined)
  assert.equal(checkBuild(world, terrainOf(1), PLAYER_SPAWN, 1, 0, 'chest'), undefined)
})

// Any two kinds of item, and a third.
const STONE = itemId('stone')
const LOG = itemId('log')
const FLINT = itemId('flint')

test('moving a stack swaps it with another kind and merges it with its own', () => {
  const inventory = createInventory(4)
  const moveSlot = (from: number, to: number): boolean =>
    moveBetween(inventory, from, plainLimit(inventory), inventory, to, plainLimit(inventory), Number.MAX_SAFE_INTEGER)
  inventory.slots[0] = { item: STONE, count: 30 }
  inventory.slots[1] = { item: LOG, count: 5 }
  inventory.slots[2] = { item: STONE, count: 40 }
  assert.ok(moveSlot(0, 1))
  assert.deepEqual(inventory.slots.slice(0, 2), [{ item: LOG, count: 5 }, { item: STONE, count: 30 }])
  assert.ok(moveSlot(1, 2))
  assert.deepEqual(inventory.slots.slice(1, 3), [{ item: STONE, count: 20 }, { item: STONE, count: 50 }])
  assert.ok(moveSlot(0, 3))
  assert.deepEqual(inventory.slots[0], { item: 0, count: 0 })
  assert.deepEqual(inventory.slots[3], { item: LOG, count: 5 })
  assert.equal(moveSlot(0, 1), false)
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
  // Stopped at the chest's side (see BUILDING_BOUNDS), not its tile's edge.
  assert.equal(client.player.position.x, 2 * SUB + boundsOf('chest')![0][0] - 1 - PLAYER_HALF_SIZE)
})

test('the slot command rearranges the player inventory on the server', () => {
  const room = new GameRoom('TEST', 1)
  const client = new TestClient(room, 'Packer')
  run(room, [client], 2)
  client.player.inventory.slots[0] = { item: FLINT, count: 12 }
  client.command({ k: 'slot', from: { id: 0, i: 0 }, to: { id: 0, i: 5 }, count: 12 })
  run(room, [client], 5)
  assert.deepEqual(client.player.inventory.slots[5], { item: FLINT, count: 12 })
  assert.deepEqual(client.inventory?.slots[5], { item: FLINT, count: 12 })
  assert.equal(client.results.at(-1)?.ok, true)
})

test('stack after stack of one kind dragged onto the trash keeps being thrown away (it keeps the last), as does another kind', () => {
  const inventory = createInventory(PLAYER_SLOTS)
  inventory.slots[TRASH_SLOT].only = 'trash'
  const limit = plainLimit(inventory)
  const stack = stackLimit(itemId('stone'), inventory.stack)
  const trash = (from: number): boolean => moveBetween(inventory, from, limit, inventory, TRASH_SLOT, limit, Number.MAX_SAFE_INTEGER)
  for (let i = 0; i < 3; i++) inventory.slots[i] = { item: itemId('stone'), count: stack }
  assert.ok(trash(0))
  assert.ok(trash(1), 'a second full stack of it')
  assert.ok(trash(2), 'and a third')
  assert.deepEqual(inventory.slots[TRASH_SLOT], { item: itemId('stone'), count: stack, only: 'trash' })
  assert.equal(inventory.slots[2].count, 0)
  inventory.slots[0] = { item: itemId('stone'), count: 5 }
  assert.ok(trash(0), 'a few more of it')
  assert.equal(inventory.slots[TRASH_SLOT].count, stack)
  inventory.slots[0] = { item: itemId('stick'), count: 2 }
  assert.ok(trash(0), 'another kind')
  assert.deepEqual(inventory.slots[TRASH_SLOT], { item: itemId('stick'), count: 2, only: 'trash' })
})
