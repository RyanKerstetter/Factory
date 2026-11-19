import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import { LocalPlayer } from '../apps/client/src/local-player.ts'
import {
  CHUNK_SIZE,
  chunkOfTile,
  countOf,
  EAST,
  KEY_RIGHT,
  PLAYER_SPAWN,
  ReliableReceiver,
  ReliableSender,
  SOUTH,
  stepPlayer,
  SUB,
  WEST,
  type ChestEntity,
} from '../packages/shared/src/index.ts'
import { differingChunks, run, TestClient } from './helpers.ts'

// A random number generator with a seed, so a failing run can be run again.
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

// The factory's tests build near the spawn with no plants in the way (the world grows none in these rooms).
const FACTORY = { plants: false }

// Starts a production line with no ore to mine (deposits are off for now): the player is given some iron and puts it
// into a chest at the start of the line, where an extractor pulls it out. Gives the source chest's tile.
function stockedChest(client: TestClient, x: number, y: number, count: number): void {
  client.player.inventory.slots[0] = { item: 1, count }
  client.command({ k: 'build', x, y, kind: 'chest', dir: EAST })
}

test('the reliable stream hands messages on in order, once, whatever the wire does', () => {
  const random = seeded(7)
  const wire: Array<{ s: number; n: number }> = []
  const sender = new ReliableSender<{ n: number }>((message) => wire.push(message), { resendMs: 0 })
  const receiver = new ReliableReceiver<{ n: number }>()
  const got: number[] = []
  for (let n = 1; n <= 200; n++) sender.send({ n })
  for (let round = 0; round < 200 && got.length < 200; round++) {
    const batch = wire.splice(0).sort(() => random() - 0.5)
    for (const message of batch) {
      if (random() < 0.3) continue
      for (const ready of receiver.receive(message)) got.push(ready.n)
    }
    sender.acknowledge(receiver.acknowledged)
    sender.resend(Number.POSITIVE_INFINITY)
  }
  assert.deepEqual(got, Array.from({ length: 200 }, (_, i) => i + 1))
})

test('a client building a production line sees the same factory as the server', () => {
  const room = new GameRoom('TEST01', 99, FACTORY)
  const client = new TestClient(room, 'Ada')
  run(room, [client], 2)
  stockedChest(client, 2, 0, 6)
  client.command({ k: 'build', x: 3, y: 0, kind: 'extractor', dir: EAST })
  client.command({ k: 'build', x: 4, y: 0, kind: 'belt', dir: EAST })
  client.command({ k: 'build', x: 5, y: 0, kind: 'chest', dir: EAST })
  run(room, [client], 5)
  const source = room.world.entityAt(2, 0)!
  client.command({ k: 'put', id: source.id, item: 1, max: 6 })
  run(room, [client], 200)
  assert.equal(client.results.filter((result) => result.ok).length, 5)
  assert.deepEqual(differingChunks(room, client), [])
  assert.equal(countOf((room.world.entityAt(5, 0) as ChestEntity).inv, 1), 6, 'all six went down the line')
  assert.equal(client.desyncReports, 0)
})

test('a client that simulates one side of a chunk edge gets the link results and stays in step', () => {
  const seed = 5
  const room = new GameRoom('TEST02', seed, FACTORY)
  const builder = new TestClient(room, 'Builder')
  run(room, [builder], 2)
  // A loop of belts over a chunk edge. A second player at the spawn simulates the chunks up to two away from it
  // (tiles -64 to 95), so this edge, at x = 96, is the edge of what it simulates: it sees only half the loop.
  const edge = CHUNK_SIZE * 3
  // Walk the builder out to the edge (the server checks reach).
  for (let i = 0; i < 1_000 && builder.player.position.x < (edge - 2) * SUB; i++) {
    room.receiveInputs(builder.player, [[i + 1, KEY_RIGHT]])
    run(room, [builder], 1)
  }
  const y = 0
  for (let x = edge - 3; x <= edge + 2; x++) builder.command({ k: 'build', x, y, kind: 'belt', dir: EAST })
  builder.command({ k: 'build', x: edge + 3, y, kind: 'belt', dir: SOUTH })
  builder.command({ k: 'build', x: edge + 3, y: y + 1, kind: 'belt', dir: WEST })
  for (let x = edge + 2; x >= edge - 3; x--) builder.command({ k: 'build', x, y: y + 1, kind: 'belt', dir: WEST })
  builder.command({ k: 'build', x: edge - 4, y: y + 1, kind: 'chest', dir: EAST })
  run(room, [builder], 10)
  assert.ok(builder.results.every((result) => result.ok), JSON.stringify(builder.results.filter((result) => !result.ok)))
  // Fill the loop's start with items straight on the server, as if a miner had put them there.
  const start = room.world.entityAt(edge - 3, y)
  assert.ok(start && start.kind === 'belt')
  start.lane.push({ item: 1, pos: 0, prev: 0 })
  // That change was made behind the log's back, so the builder is sent the chunk again.
  room.resendChunk(builder.player, chunkOfTile(edge - 3, y))
  const watcher = new TestClient(room, 'Watcher')
  assert.ok(watcher.player.chunks.has(chunkOfTile(edge - 1, y)) && !watcher.player.chunks.has(chunkOfTile(edge, y)))
  const clients = [builder, watcher]
  run(room, clients, 400)
  for (const client of clients) assert.deepEqual(differingChunks(room, client), [], `${client.player.name} is in step`)
  assert.equal(watcher.desyncReports, 0)
  // The item went out over the edge and came back: the watcher was told both crossings, and the builder, which
  // simulates both sides, was told neither.
  assert.equal(watcher.linkResults, 2)
  assert.equal(builder.linkResults, 0)
  const chest = watcher.mirror.world.entityAt(edge - 4, y + 1) as ChestEntity
  assert.equal(countOf(chest.inv, 1), 1, 'the item reached the chest in the copy of the watcher')
})

test('the factory stays in step over a lossy, shuffling wire', () => {
  const seed = 3
  const random = seeded(11)
  const room = new GameRoom('TEST03', seed, FACTORY)
  const client = new TestClient(room, 'Lossy', { loss: 0.25, shuffle: true, random })
  run(room, [client], 5)
  stockedChest(client, 2, 0, 20)
  client.command({ k: 'build', x: 3, y: 0, kind: 'extractor', dir: EAST })
  for (let x = 4; x < 8; x++) client.command({ k: 'build', x, y: 0, kind: 'belt', dir: EAST })
  client.command({ k: 'build', x: 8, y: 0, kind: 'chest', dir: EAST })
  run(room, [client], 60)
  client.command({ k: 'put', id: room.world.entityAt(2, 0)!.id, item: 1, max: 20 })
  run(room, [client], 600)
  assert.equal(client.results.filter((result) => result.ok).length, 8, 'every command went through')
  assert.ok(client.mirror.simTick > room.tick - 30, `the client kept up (${client.mirror.simTick} of ${room.tick})`)
  assert.deepEqual(differingChunks(room, client), [])
  assert.equal(client.desyncReports, 0)
})

test('take and put move items between a chest and the player, clamped to what there is', () => {
  const room = new GameRoom('TEST04', 1, FACTORY)
  const client = new TestClient(room, 'Hands')
  run(room, [client], 2)
  client.command({ k: 'build', x: 2, y: 0, kind: 'chest', dir: EAST })
  run(room, [client], 5)
  const chest = room.world.entityAt(2, 0) as ChestEntity
  // Give the chest some ore through the same path a command would.
  chest.inv.slots[0] = { item: 1, count: 30 }
  room.resendChunk(client.player, chunkOfTile(2, 0))
  run(room, [client], 5)
  client.command({ k: 'take', id: chest.id, item: 1, max: 50 })
  run(room, [client], 5)
  const take = client.results.at(-1)!
  assert.equal(take.ok, true)
  assert.equal(take.moved, 30)
  assert.equal(countOf(client.inventory!, 1), 30)
  client.command({ k: 'put', id: chest.id, item: 1, max: 10 })
  run(room, [client], 5)
  assert.equal(client.results.at(-1)!.moved, 10)
  assert.equal(countOf((client.mirror.world.entity(chest.id) as ChestEntity).inv, 1), 10)
  assert.equal(countOf(client.inventory!, 1), 20)
  assert.deepEqual(differingChunks(room, client), [])
})

test('a client whose copy goes wrong reports it and is sent the chunk again', () => {
  const room = new GameRoom('TEST05', 1, FACTORY)
  const client = new TestClient(room, 'Drift')
  run(room, [client], 2)
  client.command({ k: 'build', x: 1, y: 1, kind: 'chest', dir: EAST })
  run(room, [client], 5)
  const local = client.mirror.world.entityAt(1, 1) as ChestEntity
  local.inv.slots[0] = { item: 2, count: 5 }
  run(room, [client], 70)
  assert.equal(client.desyncReports, 1)
  assert.deepEqual(differingChunks(room, client), [])
  assert.equal(countOf((client.mirror.world.entityAt(1, 1) as ChestEntity).inv, 2), 0)
})

test('replaying unanswered inputs on the server position lands where the prediction was', () => {
  const local = new LocalPlayer()
  const server = { ...PLAYER_SPAWN }
  const inputs: Array<[number, number]> = []
  for (let i = 0; i < 10; i++) inputs.push(...local.step(KEY_RIGHT).slice(-1))
  // The server has played the first six.
  let position = server
  for (const [, keys] of inputs.slice(0, 6)) position = stepPlayer(position, keys)
  const predicted = { ...local.position }
  local.reconcile(position, 6)
  assert.deepEqual(local.position, predicted)
})
