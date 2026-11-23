import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import { checkSave, type WorldSave } from '../apps/server/src/save.ts'
import { fromBytes, SaveFolder, toBytes } from '../apps/server/src/save-folder.ts'
import { animalDef, countOf, isSeaAt, itemId, PLAYER_SPAWN, SUB } from '../packages/shared/src/index.ts'
import { run, TestClient } from './helpers.ts'

const center = (x: number, y: number): { x: number; y: number } => ({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })

// A JSON round trip, as through a file.
const throughFile = (save: WorldSave): WorldSave => JSON.parse(JSON.stringify(save)) as WorldSave

test('a world saved and loaded again is the same, chunk by chunk, with its animals', () => {
  const room = new GameRoom('SAVE01', 77, { name: 'Home', wildAnimals: false })
  const client = new TestClient(room, 'Ada')
  run(room, [client], 5)
  client.player.inventory.slots[0] = { item: itemId('fence'), count: 2 }
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  room.animals!.spawn(animalDef('cow'), center(3, 3).x, center(3, 3).y, { sex: 'f' })
  run(room, [client], 30)
  const save = throughFile(room.exportSave())
  assert.equal(save.name, 'Home')
  const loaded = GameRoom.fromSave(save, { wildAnimals: false })
  assert.equal(loaded.name, 'Home')
  assert.equal(loaded.seed, 77)
  assert.equal(loaded.tick, room.tick)
  assert.deepEqual([...loaded.world.chunkIds], [...room.world.chunkIds])
  for (const chunk of room.world.chunkIds) assert.equal(loaded.world.hashChunk(chunk), room.world.hashChunk(chunk), `chunk ${chunk}`)
  assert.equal(loaded.world.entityAt(2, 2)?.kind, 'fence')
  const cows = (r: GameRoom) => r.animals!.list().map((animal) => [animal.def.kind, animal.x, animal.y, animal.sex, animal.stats])
  assert.deepEqual(cows(loaded), cows(room))
})

test('a player is linked to what they had by their name: they come back where they were, with their things', () => {
  const room = new GameRoom('SAVE02', 5, { name: 'Linked', wildAnimals: false })
  const ada = new TestClient(room, 'Ada')
  run(room, [ada], 5)
  ada.player.inventory.slots[3] = { item: itemId('flint'), count: 7 }
  ada.player.position = center(4, -2)
  room.leave(ada.player)
  // Back in the same running world.
  const again = new TestClient(room, 'ada')
  run(room, [again], 5)
  assert.equal(countOf(again.player.inventory, itemId('flint')), 7)
  assert.deepEqual(again.player.position, center(4, -2))
  // And in the world loaded from a save after a restart.
  again.player.inventory.slots[4] = { item: itemId('stick'), count: 3 }
  const loaded = GameRoom.fromSave(throughFile(room.exportSave()), { wildAnimals: false })
  const back = new TestClient(loaded, 'ADA')
  run(loaded, [back], 5)
  assert.equal(countOf(back.player.inventory, itemId('flint')), 7)
  assert.equal(countOf(back.player.inventory, itemId('stick')), 3)
  const stranger = new TestClient(loaded, 'Bob')
  assert.equal(countOf(stranger.player.inventory, itemId('flint')), 0, 'someone new starts with nothing')
})

test('two players in one game cannot share a name, in any case', () => {
  const room = new GameRoom('SAVE03', 5)
  new TestClient(room, 'Ada')
  assert.ok(room.hasPlayerNamed('ADA'))
  assert.ok(!room.hasPlayerNamed('Bob'))
})

test('item numbers in a save are put right by key when the items have changed since', () => {
  const room = new GameRoom('SAVE04', 5, { wildAnimals: false })
  const client = new TestClient(room, 'Ada')
  run(room, [client], 5)
  client.player.inventory.slots[0] = { item: itemId('stump'), count: 1 }
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const stump = room.world.entityAt(2, 2) as { inv: { slots: Array<{ item: number; count: number }> } }
  stump.inv.slots[1] = { item: itemId('log'), count: 4 }
  const save = throughFile(room.exportSave())
  // As if the save were made when logs were item 999, and an item no longer in the game was in the stump.
  const oldLog = 999
  save.items[oldLog] = 'log'
  save.items[itemId('log')] = 'gone-item'
  const chunk = save.chunks.find((candidate) => candidate.entities.some((entity) => entity.kind === 'stump'))!
  const state = chunk.entities.find((entity) => entity.kind === 'stump') as { inv: number[] }
  state.inv[2] = oldLog
  state.inv[4] = itemId('log')
  state.inv[5] = 2
  const loaded = GameRoom.fromSave(save)
  const slots = (loaded.world.entityAt(2, 2) as unknown as typeof stump).inv.slots
  assert.deepEqual(slots[1], { item: itemId('log'), count: 4 }, 'the log came back as a log')
  assert.equal(slots[2].count, 0, 'the item that is gone left its slot empty')
})

test('a rope on an animal goes back in its leader’s things in the save', () => {
  const room = new GameRoom('SAVE05', 5, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Ada')
  run(room, [client], 5)
  client.player.inventory.slots[0] = { item: itemId('rope'), count: 1 }
  const cow = room.animals!.spawn(animalDef('cow'), center(1, 0).x, center(1, 0).y)
  client.command({ k: 'interact', animal: cow.id, slot: 0 })
  run(room, [client], 5)
  assert.equal(cow.leader, client.player.id)
  const save = room.exportSave()
  assert.ok(save.players.ada.inventory.some((slot) => slot?.[0] === 'rope'))
})

test('the saves folder keeps a file per world, lists them newest first, and turns away what is not a save', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'factory-saves-'))
  try {
    const folder = new SaveFolder(dir)
    const first = new GameRoom('AAAAAA', 1, { name: 'First' }).exportSave(1_000)
    const second = new GameRoom('BBBBBB', 2, { name: 'Second' }).exportSave(2_000)
    await folder.write(first)
    await folder.write(second)
    assert.deepEqual((await folder.list()).map((save) => save.name), ['Second', 'First'])
    assert.equal((await folder.read('AAAAAA'))?.seed, 1)
    assert.equal(await folder.read('NOPE'), undefined)
    assert.ok(!checkSave({ hello: 'world' }).ok)
    assert.ok(!checkSave({ ...first, version: 99 }).ok, 'a save from a newer game is turned away')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a save keeps only what differs from what the seed grows: it is small, and what was felled stays felled', () => {
  const room = new GameRoom('SAVE06', 12345, { name: 'Small', wildAnimals: false })
  const client = new TestClient(room, 'Ada')
  for (let cy = -2; cy <= 2; cy++) {
    for (let cx = -2; cx <= 2; cx++) {
      client.player.position = { x: (cx * 32 + 16) * SUB, y: (cy * 32 + 16) * SUB }
      run(room, [client], 3)
    }
  }
  // And over on the mountains' island, where the rocks are.
  const mountain = room.terrain.sites[1]
  client.player.position = { x: mountain.x * SUB, y: mountain.y * SUB }
  run(room, [client], 3)
  const entities = room.world.chunkIds.flatMap((id) => [...room.world.chunk(id)!.entities])
  const felled = entities.find((entity) => entity.kind === 'tree')!
  const hurt = entities.find((entity) => entity.kind === 'rock')!
  room.world.removeEntity(felled.id)
  ;(hurt as { hp: number }).hp = 3
  const save = throughFile(room.exportSave())
  const whole = save.chunks.reduce((sum, chunk) => sum + chunk.entities.length, 0)
  assert.ok(whole < entities.length / 20, `only what changed is saved whole (${whole} of ${entities.length})`)
  assert.ok(toBytes(save).length < 20_000, `the file is small (${toBytes(save).length} bytes)`)
  const loaded = GameRoom.fromSave(save)
  assert.equal(loaded.world.entity(felled.id), undefined, 'the felled tree stays felled')
  assert.equal((loaded.world.entity(hurt.id) as { hp: number }).hp, 3, 'the hurt rock stays hurt')
  for (const chunk of room.world.chunkIds) assert.equal(loaded.world.hashChunk(chunk), room.world.hashChunk(chunk))
  assert.deepEqual(loaded.loadWarnings, [])
})

test('a version 1 save (every chunk whole, not gzipped) still loads', () => {
  const room = new GameRoom('SAVE07', 9, { name: 'Old', wildAnimals: false })
  const client = new TestClient(room, 'Ada')
  run(room, [client], 5)
  const { generated: _generated, generation: _generation, ...rest } = room.exportSave()
  const old: WorldSave = {
    ...rest,
    version: 1,
    chunks: room.world.chunkIds.map((chunk) => {
      const { entities, drops } = room.world.snapshotChunk(chunk)
      return { chunk, entities, drops }
    }),
  }
  const loaded = GameRoom.fromSave(fromBytes(Buffer.from(JSON.stringify(old))) as WorldSave)
  for (const chunk of room.world.chunkIds) assert.equal(loaded.world.hashChunk(chunk), room.world.hashChunk(chunk))
})

test('a player who logged off aboard a raft that is gone when they come back wakes at their sleeping bag (or the spawn), not out at sea', () => {
  const room = new GameRoom('RAFTGONE', 77, { wildAnimals: false })
  const sailor = new TestClient(room, 'Sailor')
  run(room, [sailor], 5)
  // Open sea a few tiles east of the forest's coast.
  const forest = room.terrain.sites[0]
  let x = forest.x
  while (!isSeaAt(room.terrain, x, forest.y) || !isSeaAt(room.terrain, x + 6, forest.y)) x++
  const at = center(x + 4, forest.y)
  const raft = room.rafts.add({ x: at.x, y: at.y, angle: 0 })
  sailor.player.position = { ...at }
  sailor.player.aboard = { raft: raft.id, x: 0, y: 0 }
  run(room, [sailor], 2)
  room.leave(sailor.player)
  // The raft still there: back on it.
  const again = new TestClient(room, 'Sailor')
  run(room, [again], 2)
  assert.equal(again.player.aboard?.raft, raft.id, 'back aboard')
  room.leave(again.player)
  // Gone (as from a save without it): the spawn, with no sleeping bag.
  const save = throughFile(room.exportSave())
  delete save.rafts
  const loaded = GameRoom.fromSave(save, { wildAnimals: false })
  const back = new TestClient(loaded, 'Sailor')
  run(loaded, [back], 2)
  assert.equal(back.player.aboard, undefined)
  assert.ok(!isSeaAt(loaded.terrain, Math.floor(back.player.position.x / SUB), Math.floor(back.player.position.y / SUB)), 'on land')
  assert.ok(Math.hypot(back.player.position.x - PLAYER_SPAWN.x, back.player.position.y - PLAYER_SPAWN.y) < SUB, 'at the spawn')
})
