import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  countOf,
  createEntity,
  FENCE_E,
  FENCE_W,
  fenceMask,
  GATE_AUTO,
  GATE_OPEN,
  GATE_SHUT,
  itemId,
  NO_ITEM,
  PUNCH_COOLDOWN_TICKS,
  solidIn,
  STATION_RECIPES,
  SUB,
  TPS,
  tilesIn,
} from '../packages/shared/src/index.ts'
import { differingChunks, run, TestClient } from './helpers.ts'

const center = (x: number, y: number): { x: number; y: number } => ({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })

function builder(code: string, items: Record<string, number> = {}): { room: GameRoom; client: TestClient } {
  const room = new GameRoom(code, 11, { dropsOnGround: false, animals: false, plants: false })
  const client = new TestClient(room, 'Builder')
  run(room, [client], 5)
  client.player.position = center(3, 5)
  Object.entries(items).forEach(([key, count], slot) => (client.player.inventory.slots[slot] = { item: itemId(key), count }))
  return { room, client }
}

test('wooden walls, doors and floors are made at the carpenter’s bench from planks', () => {
  const recipe = (key: string) => STATION_RECIPES.carpenter.find((one) => one.output === itemId(key))
  const wall = recipe('wood-wall')!
  assert.deepEqual([wall.inputs, wall.count, wall.ticks], [[[itemId('plank'), 2]], 1, 1.5 * TPS])
  const door = recipe('wood-door')!
  assert.deepEqual([door.inputs, door.count], [[[itemId('plank'), 3]], 1])
  const floor = recipe('wood-floor')!
  assert.deepEqual([floor.inputs, floor.count], [[[itemId('plank'), 1]], 4])
})

test('wooden walls join the walls and doors beside them (not fences) and stand in the way; a door lets players through, and a right click keeps it open or shut', () => {
  const { room, client } = builder('WALLS', { 'wood-wall': 2, 'wood-door': 1, fence: 1 })
  for (const [slot, x] of [[0, 2], [0, 3], [1, 4], [2, 5]] as const) client.command({ k: 'place', x, y: 2, slot })
  run(room, [client], 5)
  const kindAt = (x: number, y: number) => room.world.entityAt(x, y)?.kind
  assert.deepEqual([2, 3, 4, 5].map((x) => kindAt(x, 2)), ['wood-wall', 'wood-wall', 'wood-door', 'fence'])
  assert.equal(fenceMask(kindAt, 3, 2), FENCE_E | FENCE_W, 'the wall joins the wall and the door')
  assert.equal(fenceMask(kindAt, 4, 2), FENCE_W, 'the door joins the wall, not the fence')
  assert.equal(fenceMask(kindAt, 5, 2), 0, 'the fence joins neither')
  const solid = solidIn(room.world)
  assert.ok(solid(3, 2), 'a wall is in the way')
  assert.equal(solid(4, 2), false, 'players walk through a door')
  const door = room.world.entityAt(4, 2)!
  assert.ok(door.kind === 'wood-door' && door.mode === GATE_AUTO)
  client.command({ k: 'toggle', id: door.id })
  run(room, [client], 3)
  const first = (room.world.entityAt(4, 2) as typeof door).mode
  assert.ok(first === GATE_OPEN || first === GATE_SHUT, 'kept open or shut')
  client.command({ k: 'toggle', id: door.id })
  run(room, [client], 3)
  assert.equal((room.world.entityAt(4, 2) as typeof door).mode, first === GATE_OPEN ? GATE_SHUT : GATE_OPEN, 'and the other way')
  assert.deepEqual(differingChunks(room, client), [])
})

test('a wooden floor lies under what stands on its tile: one to a tile, over a tuft of grass, not under a rock; an axe takes up what is on it first, then the floor', () => {
  const { room, client } = builder('FLOOR', { 'wood-floor': 4, chest: 1, axe: 1 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const floor = room.world.floorAt(2, 2)
  assert.equal(floor?.kind, 'wood-floor')
  assert.equal(room.world.entityAt(2, 2), undefined, 'the tile is still free')
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  assert.equal(client.results.at(-1)?.why, 'floored', 'one floor to a tile')
  client.command({ k: 'place', x: 2, y: 2, slot: 1 })
  run(room, [client], 5)
  const chest = room.world.entityAt(2, 2)
  assert.equal(chest?.kind, 'chest', 'a chest stands on the floor')
  assert.equal(room.world.floorAt(2, 2)?.id, floor!.id)
  // Over a tuft of grass, which it covers; not under a rock.
  room.world.addEntity(createEntity(9001, 'grass', 3, 2, 0, NO_ITEM))
  room.world.addEntity(createEntity(9002, 'rock', 4, 2, 0, NO_ITEM))
  client.command({ k: 'place', x: 3, y: 2, slot: 0 })
  client.command({ k: 'place', x: 4, y: 2, slot: 0 })
  run(room, [client], 5)
  assert.equal(room.world.floorAt(3, 2)?.kind, 'wood-floor')
  assert.equal(room.world.entityAt(3, 2), undefined, 'the grass is covered')
  assert.equal(room.world.floorAt(4, 2), undefined)
  assert.equal(client.results.at(-1)?.why, 'occupied', 'not under a rock')
  // A swing at the tile hits the chest, not the floor under it; once it is gone, the floor.
  const swing = () => tilesIn(room.world, center(2, 3), -Math.PI / 2, 1.5 * SUB, Math.PI / 3).map((entity) => entity.id)
  assert.ok(swing().includes(chest!.id) && !swing().includes(floor!.id))
  room.world.removeEntity(chest!.id)
  assert.ok(swing().includes(floor!.id))
  const floors = countOf(client.player.inventory, itemId('wood-floor'))
  for (let i = 0; i < 4 && room.world.floorAt(2, 2); i++) {
    client.command({ k: 'punch', id: floor!.id, slot: 2 })
    run(room, [client], PUNCH_COOLDOWN_TICKS + 1)
  }
  assert.equal(room.world.floorAt(2, 2), undefined, 'taken up with an axe')
  assert.equal(countOf(client.player.inventory, itemId('wood-floor')), floors + 1, 'and given back')
  assert.deepEqual(differingChunks(room, client), [])
  // Saved and loaded, the floor is still there.
  const loaded = GameRoom.fromSave(JSON.parse(JSON.stringify(room.exportSave())), { wildAnimals: false })
  assert.equal(loaded.world.floorAt(3, 2)?.kind, 'wood-floor')
  for (const chunk of room.world.chunkIds) assert.equal(loaded.world.hashChunk(chunk), room.world.hashChunk(chunk), `chunk ${chunk}`)
})

test('a stone floor is made at the carpenter’s bench, four from a stone, lies under what stands on its tile like a wooden one, and comes up only to a pickaxe', () => {
  const recipe = STATION_RECIPES.carpenter.find((one) => one.output === itemId('stone-floor'))!
  assert.deepEqual([recipe.inputs, recipe.count], [[[itemId('stone'), 1]], 4])
  const { room, client } = builder('STONEFLOOR', { 'stone-floor': 2, axe: 1, pickaxe: 1, chest: 1 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  client.command({ k: 'place', x: 2, y: 2, slot: 3 })
  run(room, [client], 5)
  const floor = room.world.floorAt(2, 2)
  assert.equal(floor?.kind, 'stone-floor')
  assert.equal(room.world.entityAt(2, 2)?.kind, 'chest', 'a chest stands on it')
  room.world.removeEntity(room.world.entityAt(2, 2)!.id)
  client.command({ k: 'punch', id: floor!.id, slot: 1 })
  run(room, [client], PUNCH_COOLDOWN_TICKS + 1)
  assert.equal(client.results.at(-1)?.why, 'needsPickaxe', 'not to an axe')
  for (let i = 0; i < 4 && room.world.floorAt(2, 2); i++) {
    client.command({ k: 'punch', id: floor!.id, slot: 2 })
    run(room, [client], PUNCH_COOLDOWN_TICKS + 1)
  }
  assert.equal(room.world.floorAt(2, 2), undefined, 'taken up with a pickaxe')
  assert.equal(countOf(client.player.inventory, itemId('stone-floor')), 2, 'and given back')
})

test('the carpenter’s bench is made at the stump from 10 planks, and is where fences, gates, walls, doors, floors, tables and chairs are made (and nowhere else)', () => {
  const bench = STATION_RECIPES.stump.find((one) => one.output === itemId('carpenters-bench'))!
  assert.deepEqual([bench.inputs, bench.count], [[[itemId('plank'), 10]], 1])
  const moved = ['fence', 'gate', 'wood-wall', 'wood-door', 'wood-floor', 'stone-floor', 'table', 'chair', 'low-table', 'round-table']
  for (const key of moved) {
    assert.ok(STATION_RECIPES.carpenter.some((one) => one.output === itemId(key)), `${key} at the carpenter’s bench`)
    assert.ok(!STATION_RECIPES.stump.some((one) => one.output === itemId(key)) && !STATION_RECIPES.workbench.some((one) => one.output === itemId(key)), `${key} not at the stump or the workbench`)
  }
  // Put down, it makes a table.
  const { room, client } = builder('CARPENTER', { 'carpenters-bench': 1, plank: 8 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const placed = room.world.entityAt(2, 2)!
  assert.equal(placed.kind, 'carpenter')
  const table = STATION_RECIPES.carpenter.find((one) => one.output === itemId('table'))!
  client.command({ k: 'put', id: placed.id, item: itemId('plank'), max: 4 })
  client.command({ k: 'work', id: placed.id, recipe: table.index })
  run(room, [client], table.ticks + 10)
  client.command({ k: 'take', id: placed.id, item: itemId('table'), max: 1 })
  run(room, [client], 5)
  assert.equal(countOf(client.player.inventory, itemId('table')), 1, 'a table')
  assert.deepEqual(differingChunks(room, client), [])
})
