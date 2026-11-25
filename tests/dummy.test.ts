import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import { BUILDINGS, countOf, HP_FROM_DATA, itemId, RACK_INPUT, RACK_OUTPUT, STATION_RECIPES, SUB, WEAPONS, type Entity } from '../packages/shared/src/index.ts'
import { differingChunks, run, TestClient } from './helpers.ts'

function room(code: string, items: Record<string, number>): { room: GameRoom; client: TestClient; hits: Array<[number, number]> } {
  const made = new GameRoom(code, 11, { dropsOnGround: false, animals: false, plants: false })
  const client = new TestClient(made, 'Trainee')
  run(made, [client], 5)
  Object.entries(items).forEach(([key, count], slot) => (client.player.inventory.slots[slot] = { item: itemId(key), count }))
  // Every hit a dummy is told of, as the server sends it to the pages.
  const hits: Array<[number, number]> = []
  const told = (made as unknown as { dummyHit: (id: number, amount: number) => void }).dummyHit.bind(made)
  ;(made as unknown as { dummyHit: (id: number, amount: number) => void }).dummyHit = (id, amount) => {
    hits.push([id, amount])
    told(id, amount)
  }
  return { room: made, client, hits }
}

function tileOf(client: TestClient): { x: number; y: number } {
  return { x: Math.floor(client.player.position.x / SUB), y: Math.floor(client.player.position.y / SUB) }
}

test('the workbench makes a target dummy from fiber, planks and rope; hit, it shows the damage and never breaks; Ctrl + right click picks it up', () => {
  const recipe = STATION_RECIPES.workbench.find((candidate) => candidate.output === itemId('target-dummy'))!
  assert.deepEqual(new Set(recipe.inputs.map(([item]) => item)), new Set(['fiber', 'plank', 'rope'].map(itemId)))
  assert.ok(!HP_FROM_DATA.includes('dummy'), 'it has no hits to lose')

  const { room: made, client, hits } = room('DUMMY', { 'target-dummy': 1, axe: 1 })
  const spot = tileOf(client)
  client.command({ k: 'place', x: spot.x + 1, y: spot.y, slot: 0 })
  run(made, [client], 3)
  const dummy = made.world.entityAt(spot.x + 1, spot.y)
  assert.equal(dummy?.kind, 'dummy')
  const axe = WEAPONS.get('axe')!
  for (let i = 0; i < 20; i++) {
    client.command({ k: 'attack', slot: 1, x: (spot.x + 1.5) * SUB, y: (spot.y + 0.5) * SUB })
    run(made, [client], axe.cooldown + 2)
  }
  assert.equal(made.world.entity(dummy!.id)?.kind, 'dummy', 'twenty axe blows later it still stands')
  assert.equal(hits.length, 20)
  assert.ok(hits.every(([id, amount]) => id === dummy!.id && amount === axe.damage), 'each hit was told, as hard as an axe hits')

  client.command({ k: 'lift', id: dummy!.id })
  run(made, [client], 3)
  assert.equal(made.world.entity(dummy!.id), undefined)
  assert.equal(countOf(client.player.inventory, itemId('target-dummy')), 1, 'back in their things')
  assert.deepEqual(differingChunks(made, client), [])
})

test('a hide is hung on a drying rack with a right click, one at a time, and the dried hide punched off it', () => {
  const { room: made, client } = room('RACKQ', { 'drying-rack': 1, hide: 2, log: 1 })
  const spot = tileOf(client)
  client.command({ k: 'place', x: spot.x + 1, y: spot.y, slot: 0 })
  run(made, [client], 3)
  const rack = made.world.entityAt(spot.x + 1, spot.y)!
  const onRack = (): { item: number; count: number }[] => (made.world.entity(rack.id) as Entity & { inv: { slots: { item: number; count: number }[] } }).inv.slots
  // What a right click sends: anything that does not dry is turned down.
  client.command({ k: 'put', id: rack.id, item: itemId('log'), max: 1, slot: 2 })
  run(made, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'notDryable')
  client.command({ k: 'put', id: rack.id, item: itemId('hide'), max: 1, slot: 1 })
  run(made, [client], 3)
  assert.equal(onRack()[RACK_INPUT].count, 1, 'one hide on the rack')
  assert.equal(countOf(client.player.inventory, itemId('hide')), 1)
  client.command({ k: 'put', id: rack.id, item: itemId('hide'), max: 1, slot: 1 })
  run(made, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'rackFull', 'not a second')
  // Punched while it dries, it is like anything else put down: it takes an axe.
  const middle = { x: (spot.x + 1) * SUB + SUB / 2, y: spot.y * SUB + SUB / 2 }
  client.command({ k: 'attack', slot: -1, x: middle.x, y: middle.y })
  run(made, [client], 3)
  assert.equal(onRack()[RACK_INPUT].count, 1, 'still drying')
  for (let i = 0; i < 400 && onRack()[RACK_OUTPUT].count === 0; i++) run(made, [client], 30)
  assert.deepEqual([onRack()[RACK_OUTPUT].item, onRack()[RACK_OUTPUT].count], [itemId('dried-hide'), 1], 'it dried')
  client.command({ k: 'put', id: rack.id, item: itemId('hide'), max: 1, slot: 1 })
  run(made, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'rackFull', 'nor while the dried one is still on it')
  // Punched (holding the log: anything not a weapon punches), the dried hide comes off, and the rack stays, unhurt.
  client.command({ k: 'attack', slot: 2, x: middle.x, y: middle.y })
  run(made, [client], 3)
  assert.equal(countOf(client.player.inventory, itemId('dried-hide')), 1, 'the dried hide is theirs')
  assert.equal(onRack()[RACK_OUTPUT].count, 0)
  assert.equal(made.world.entity(rack.id)?.kind, 'rack', 'the rack is still there')
  assert.equal((made.world.entity(rack.id) as { hp: number }).hp, BUILDINGS.rack.maxHp, 'unhurt')
  // Now empty, it takes the next hide.
  client.command({ k: 'put', id: rack.id, item: itemId('hide'), max: 1, slot: 1 })
  run(made, [client], 3)
  assert.equal(onRack()[RACK_INPUT].count, 1)
  assert.deepEqual(differingChunks(made, client), [])
})
