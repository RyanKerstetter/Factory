import assert from 'node:assert/strict'
import test from 'node:test'
import buildingsData from '../data/buildings.json' with { type: 'json' }
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  ALTAR_GLOW_TICKS,
  ALTAR_RECIPES,
  BUILDINGS,
  countOf,
  HP_FROM_DATA,
  itemId,
  KEY_RIGHT,
  STATION_LAYOUT,
  STATION_RECIPES,
  SUB,
  WARP_TICKS,
  type Entity,
} from '../packages/shared/src/index.ts'
import { differingChunks, run, TestClient } from './helpers.ts'

function room(code: string, items: Record<string, number>): { room: GameRoom; client: TestClient } {
  const made = new GameRoom(code, 11, { dropsOnGround: false, animals: false, plants: false })
  const client = new TestClient(made, 'Traveller')
  run(made, [client], 5)
  Object.entries(items).forEach(([key, count], slot) => (client.player.inventory.slots[slot] = { item: itemId(key), count }))
  return { room: made, client }
}

function tileOf(client: TestClient): { x: number; y: number } {
  return { x: Math.floor(client.player.position.x / SUB), y: Math.floor(client.player.position.y / SUB) }
}

function place(made: GameRoom, client: TestClient, slot: number, x: number, y: number): Entity {
  client.command({ k: 'place', x, y, slot })
  run(made, [client], 5)
  const placed = made.world.entityAt(x, y)
  assert.ok(placed, 'it was put down')
  return placed
}

test('every building that is hit has its hits in data/buildings.json, and they are what the game uses', () => {
  const data = buildingsData as Record<string, { hp: number }>
  assert.deepEqual(new Set(Object.keys(data)), new Set(HP_FROM_DATA))
  for (const kind of HP_FROM_DATA) assert.equal(BUILDINGS[kind].maxHp, data[kind].hp, kind)
  assert.ok(HP_FROM_DATA.includes('waystone') && HP_FROM_DATA.includes('worker'))
})

test('a tool Craft put in a station goes back to the player when they leave it; one put in by hand stays; with no room it stays', () => {
  const planks = STATION_RECIPES.stump.find((recipe) => recipe.output === itemId('plank'))!
  const toolSlot = STATION_LAYOUT.stump.tool
  const toolIn = (made: GameRoom, id: number): number => {
    const stump = made.world.entity(id)
    return stump && 'inv' in stump ? stump.inv.slots[toolSlot].count : -1
  }

  // Craft lends the axe; closing the stump brings it back.
  {
    const { room: made, client } = room('LEND', { stump: 1, axe: 1, log: 2 })
    const spot = tileOf(client)
    const stump = place(made, client, 0, spot.x + 2, spot.y)
    client.command({ k: 'use', id: stump.id })
    client.command({ k: 'put', id: stump.id, item: itemId('log'), max: 2 })
    client.command({ k: 'work', id: stump.id, recipe: planks.index })
    run(made, [client], 5)
    assert.equal(toolIn(made, stump.id), 1, 'the axe went in')
    assert.equal(countOf(client.player.inventory, itemId('axe')), 0)
    run(made, [client], planks.ticks * 2 + 5)
    assert.equal(toolIn(made, stump.id), 1, 'it stays while they are at the stump')
    client.command({ k: 'use', id: 0 })
    run(made, [client], 3)
    assert.equal(toolIn(made, stump.id), 0, 'gone from the stump')
    assert.equal(countOf(client.player.inventory, itemId('axe')), 1, 'back in their things')
    assert.deepEqual(differingChunks(made, client), [])
  }

  // Put in by hand: it stays.
  {
    const { room: made, client } = room('HANDTOOL', { stump: 1, axe: 1, log: 2 })
    const spot = tileOf(client)
    const stump = place(made, client, 0, spot.x + 2, spot.y)
    client.command({ k: 'use', id: stump.id })
    client.command({ k: 'put', id: stump.id, item: itemId('axe'), max: 1 })
    client.command({ k: 'put', id: stump.id, item: itemId('log'), max: 2 })
    client.command({ k: 'work', id: stump.id, recipe: planks.index })
    run(made, [client], 5)
    client.command({ k: 'use', id: 0 })
    run(made, [client], 3)
    assert.equal(toolIn(made, stump.id), 1, 'the axe stayed in the stump')
    assert.equal(countOf(client.player.inventory, itemId('axe')), 0)
  }

  // No room for it: it stays.
  {
    const { room: made, client } = room('FULLTOOL', { stump: 1, axe: 1, log: 2 })
    const spot = tileOf(client)
    const stump = place(made, client, 0, spot.x + 2, spot.y)
    client.command({ k: 'use', id: stump.id })
    client.command({ k: 'put', id: stump.id, item: itemId('log'), max: 2 })
    client.command({ k: 'work', id: stump.id, recipe: planks.index })
    run(made, [client], 5)
    client.player.inventory.slots.forEach((slot) => {
      slot.item = itemId('stone')
      slot.count = 100
    })
    client.command({ k: 'use', id: 0 })
    run(made, [client], 3)
    assert.equal(toolIn(made, stump.id), 1, 'the axe stayed in the stump')
  }
})

test('the altar turns bread into essence, and a worker skeleton can be put down', () => {
  const essence = ALTAR_RECIPES.find((recipe) => recipe.output === itemId('essence'))!
  assert.deepEqual(essence.inputs, [[itemId('bread'), 1]])
  assert.deepEqual(essence.liquids, [])

  const { room: made, client } = room('BREAD', { altar: 1, pedestal: 1, bread: 1, 'worker-skeleton': 1 })
  const spot = tileOf(client)
  const altar = place(made, client, 0, spot.x + 3, spot.y)
  const pedestal = place(made, client, 1, spot.x + 3, spot.y + 1)
  client.command({ k: 'put', id: pedestal.id, item: itemId('bread'), max: 1 })
  run(made, [client], 3)
  client.command({ k: 'work', id: altar.id, recipe: essence.index })
  run(made, [client], essence.ticks + 5)
  const done = made.world.entity(altar.id)
  assert.ok(done?.kind === 'altar')
  assert.deepEqual([done.inv.slots[0].item, done.inv.slots[0].count], [itemId('essence'), 1])
  assert.equal(place(made, client, 3, spot.x + 3, spot.y - 2).kind, 'worker')
  assert.deepEqual(differingChunks(made, client), [])
})

test('the workbench makes a waystone; a named waystone sends a player to another after it charges, held still the while', () => {
  const recipe = STATION_RECIPES.workbench.find((candidate) => candidate.output === itemId('waystone'))!
  assert.deepEqual(
    new Map(recipe.inputs.map(([match, count]) => [match, count])),
    new Map([[itemId('lich-core'), 1], [itemId('stone'), 10], [itemId('essence'), 15]]),
  )
  const { room: made, client } = room('WARP', { waystone: 2 })
  const start = tileOf(client)
  const home = place(made, client, 0, start.x + 2, start.y)
  client.command({ k: 'rename', id: home.id, name: '  Home   base ' })
  run(made, [client], 3)
  assert.equal((made.world.entity(home.id) as { name?: string }).name, 'Home base')
  // The other, far off.
  client.player.position = { x: client.player.position.x + 40 * SUB, y: client.player.position.y }
  run(made, [client], 10)
  const far = tileOf(client)
  const away = place(made, client, 0, far.x + 2, far.y)
  // Back home, and off to the other.
  client.player.position = { x: (start.x + 0.5) * SUB, y: (start.y + 0.5) * SUB }
  run(made, [client], 10)
  client.command({ k: 'warp', id: home.id, to: home.id })
  client.command({ k: 'warp', id: away.id, to: home.id })
  run(made, [client], 3)
  assert.deepEqual(client.results.slice(-2).map((result) => result.why), ['noWaystone', 'reach'])
  client.command({ k: 'warp', id: home.id, to: away.id })
  run(made, [client], 2)
  assert.equal(client.results.at(-1)?.ok, true)
  const before = { ...client.player.position }
  for (let i = 0; i < WARP_TICKS - 10; i++) {
    made.receiveInputs(client.player, [[1000 + i, KEY_RIGHT]])
    run(made, [client], 1)
  }
  assert.deepEqual(client.player.position, before, 'it did not move while the stone charged')
  run(made, [client], 15)
  const arrived = tileOf(client)
  assert.deepEqual(arrived, { x: away.x, y: away.y + 1 }, 'it arrived in front of the other waystone')
  assert.deepEqual(differingChunks(made, client), [])
})

test('an altar does its ritual again while the pedestals hold what it takes, stacking what it makes; with something else on it, it will not start', () => {
  const essence = ALTAR_RECIPES.find((recipe) => recipe.output === itemId('essence'))!
  const { room: made, client } = room('AGAIN', { altar: 1, pedestal: 1, bread: 3, bone: 1 })
  const spot = tileOf(client)
  const altar = place(made, client, 0, spot.x + 3, spot.y)
  const pedestal = place(made, client, 1, spot.x + 3, spot.y + 1)
  // Something else on the altar: it will not start.
  client.command({ k: 'put', id: altar.id, item: itemId('bone'), max: 1 })
  client.command({ k: 'put', id: pedestal.id, item: itemId('bread'), max: 3 })
  client.command({ k: 'work', id: altar.id, recipe: essence.index })
  run(made, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'altarFull')
  client.command({ k: 'take', id: altar.id, item: itemId('bone'), max: 1 })
  run(made, [client], 3)
  // Essence already on it is fine; three loaves make three, from one press of Craft.
  client.command({ k: 'work', id: altar.id, recipe: essence.index })
  run(made, [client], 4 * (essence.ticks + ALTAR_GLOW_TICKS + 5))
  const done = made.world.entity(altar.id)
  assert.ok(done?.kind === 'altar')
  assert.deepEqual([done.inv.slots[0].item, done.inv.slots[0].count], [itemId('essence'), 3])
  assert.equal(done.recipe, 0, 'it stopped when the bread ran out')
  const bare = made.world.entity(pedestal.id)
  assert.ok(bare && 'inv' in bare && bare.inv.slots[0].count === 0)
  assert.deepEqual(differingChunks(made, client), [])
})

test('a player travels by a waystone only from within WAYSTONE_REACH (3 tiles) of it', () => {
  const { room: made, client } = room('WAYREACH', { waystone: 2 })
  const spot = tileOf(client)
  const first = place(made, client, 0, spot.x + 2, spot.y)
  const second = place(made, client, 0, spot.x - 3, spot.y + 2)
  // Five tiles off: out of reach.
  client.player.position = { x: (first.x + 5) * SUB + SUB / 2, y: first.y * SUB + SUB / 2 }
  client.command({ k: 'warp', id: first.id, to: second.id })
  run(made, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'reach')
  // Two tiles off: it charges.
  client.player.position = { x: (first.x + 2) * SUB + SUB / 2, y: first.y * SUB + SUB / 2 }
  client.command({ k: 'warp', id: first.id, to: second.id })
  run(made, [client], 3)
  assert.equal(client.results.at(-1)?.ok, true)
})
