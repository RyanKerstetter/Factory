import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  countOf,
  createEntity,
  fencePost,
  floorDiv,
  LEAD_LENGTH,
  ROPE_HELD,
  RAFT_SIZE,
  STATION_RECIPES,
  fromRaft,
  itemId,
  KEY_LEFT,
  KEY_RIGHT,
  overlapsSolid,
  PLAYER_SPAWN,
  PLAYER_SPEED,
  RAFT_DECK,
  RAFT_HALF,
  raftFits,
  raftOnTile,
  solidIn,
  SUB,
  TPS,
  waterAt,
  type RaftPose,
} from '../packages/shared/src/index.ts'
import { run, TestClient } from './helpers.ts'

// A room with a raft and an oar in the first two slots of a player's inventory, and somewhere on the water near the
// spawn where a raft fits with land straight to its left (west), right against it: the raft's tile, and where a player
// stands on that land, just clear of the water, level with the raft's middle.
function shore(): { room: GameRoom; client: TestClient; tile: { x: number; y: number }; pose: RaftPose; land: { x: number; y: number } } {
  const room = new GameRoom('RAFT', 11, { dropsOnGround: false, wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Sailor')
  run(room, [client], 5)
  client.player.inventory.slots[0] = { item: itemId('raft'), count: 1 }
  client.player.inventory.slots[1] = { item: itemId('oar'), count: 1 }
  const isWater = (x: number, y: number): boolean => waterAt(room.terrain, x, y)
  const solid = solidIn(room.world, () => room.terrain)
  const sx = floorDiv(PLAYER_SPAWN.x, SUB)
  const sy = floorDiv(PLAYER_SPAWN.y, SUB)
  for (let r = 3; r < 120; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (const dx of [-r, r]) {
        const tile = { x: sx + dx, y: sy + dy }
        const pose = raftOnTile(tile.x, tile.y)
        if (!raftFits(pose, isWater, [])) continue
        // The raft pushed west as far as it floats: right against the shore (open sea to the west: not here).
        const against = { ...pose }
        while (against.x >= pose.x - 3 * SUB && raftFits({ ...against, x: against.x - 4 }, isWater, [])) against.x -= 4
        if (against.x < pose.x - 3 * SUB) continue
        const land = { x: against.x - RAFT_HALF - 80, y: against.y }
        if (isWater(floorDiv(land.x, SUB), floorDiv(land.y, SUB)) || overlapsSolid(land, solid)) continue
        return { room, client, tile, pose: against, land }
      }
    }
  }
  throw new Error('no shore found near the spawn')
}

const keys = (room: GameRoom, client: TestClient, pressed: number, ticks: number, from: { seq: number }): void => {
  for (let i = 0; i < ticks; i++) {
    room.receiveInputs(client.player, [[++from.seq, pressed]])
    run(room, [client], 1)
  }
}

test('a raft goes down on water only, on the rope of who put it down; pulled in to the shore, it is stepped onto and ridden as it is rowed', () => {
  const { room, client, tile, pose, land } = shore()
  // Not on land.
  client.player.position = { x: land.x, y: land.y }
  client.command({ k: 'place', x: floorDiv(land.x, SUB), y: floorDiv(land.y, SUB), slot: 0 })
  run(room, [client], 2)
  assert.equal(room.rafts.list().length, 0, 'a raft does not go on land')
  client.command({ k: 'place', x: tile.x, y: tile.y, slot: 0 })
  run(room, [client], 2)
  assert.equal(room.rafts.list().length, 1, 'a raft goes on water')
  assert.equal(client.player.inventory.slots[0].count, 0, 'the raft is used up')
  // Where it was put down (its middle on the tile's), on the player's rope.
  const raft = room.rafts.list()[0]
  const placedAt = raftOnTile(tile.x, tile.y)
  assert.deepEqual({ x: raft.x, y: raft.y }, { x: placedAt.x, y: placedAt.y })
  assert.equal(raft.leader, client.player.id, 'on their rope')
  // Walking away inland, the rope pulls it in, right up against the shore.
  const seq = { seq: 0 }
  keys(room, client, KEY_LEFT, 40, seq)
  assert.ok(Math.abs(raft.x - pose.x) <= 8 && Math.abs(raft.y - pose.y) <= 8, `pulled in against the shore (${raft.x - pose.x}, ${raft.y - pose.y} off)`)
  // Walking back, they step onto it, a step like any other (no jump).
  let before = { ...client.player.position }
  let boardedAfter = 0
  for (let n = 0; n < 80 && !client.player.aboard; n++) {
    before = { ...client.player.position }
    keys(room, client, KEY_RIGHT, 1, seq)
    boardedAfter = n
  }
  assert.ok(client.player.aboard, `walking onto the raft boards it (after ${boardedAfter} steps)`)
  assert.equal(client.player.aboard.raft, raft.id)
  const stepped = Math.hypot(client.player.position.x - before.x, client.player.position.y - before.y)
  assert.ok(stepped <= PLAYER_SPEED + 1, `stepping aboard moves them one step (${stepped} units)`)
  // And on in, a step at a time.
  before = { ...client.player.position }
  keys(room, client, KEY_RIGHT, 1, seq)
  assert.ok(Math.abs(client.player.position.x - before.x - PLAYER_SPEED) <= 1, 'on in at walking pace')

  // Walking on across it never takes them off into the water.
  keys(room, client, KEY_RIGHT, 30, seq)
  assert.ok(client.player.aboard, 'still aboard')
  assert.ok(client.player.aboard.x <= RAFT_DECK, 'at the far edge of its deck, no further')

  // Back to the middle, and an oar's stroke aimed east pushes the raft east, with them on it.
  client.player.aboard = { raft: raft.id, x: 0, y: 0 }
  const startX = raft.x
  client.command({ k: 'attack', slot: 1, x: client.player.position.x + 4 * SUB, y: client.player.position.y })
  run(room, [client], 30)
  assert.ok(raft.x > startX + SUB / 2, `the raft moved east (${raft.x - startX} units)`)
  assert.ok(Math.abs(raft.angle) < 0.01, 'pulled through its middle, it does not turn')
  const carried = fromRaft(raft, client.player.aboard!)
  assert.deepEqual(client.player.position, carried, 'the player goes with it')
  // The water slows it to a stop.
  run(room, [client], 400)
  assert.equal(raft.vx, 0, 'it comes to a stop')
})

test('a raft rowed from its edge turns (and the water slows its turning); it stops at the shore; a player steps off it onto land', () => {
  const { room, client, tile, pose, land } = shore()
  client.player.position = { x: land.x, y: land.y }
  client.command({ k: 'place', x: tile.x, y: tile.y, slot: 0 })
  run(room, [client], 2)
  const raft = room.rafts.list()[0]
  // Aboard at its south edge, rowing east: off its middle, so it turns.
  client.player.aboard = { raft: raft.id, x: 0, y: RAFT_DECK }
  run(room, [client], 1)
  client.command({ k: 'attack', slot: 1, x: client.player.position.x + 4 * SUB, y: client.player.position.y })
  run(room, [client], 10)
  assert.ok(Math.abs(raft.angle) > 0.02, `it turns (${raft.angle})`)
  const turning = Math.abs(raft.spin)
  run(room, [client], 20)
  assert.ok(Math.abs(raft.spin) < turning, 'its turning slows')
  assert.deepEqual(client.player.position, fromRaft(raft, client.player.aboard!), 'the player turns with it')

  // Rowed back west into the shore, over and over: it never goes onto the land.
  const isWater = (x: number, y: number): boolean => waterAt(room.terrain, x, y)
  client.player.aboard = { raft: raft.id, x: 0, y: 0 }
  // Square again, a little out from where it was put down.
  Object.assign(raft, { x: pose.x + 2 * SUB, y: pose.y, angle: 0, vx: 0, vy: 0, spin: 0 })
  assert.ok(raftFits(raft, isWater, []), 'out on the water')
  for (let stroke = 0; stroke < 6; stroke++) {
    client.command({ k: 'attack', slot: 1, x: client.player.position.x - 4 * SUB, y: client.player.position.y })
    for (let t = 0; t < 20; t++) {
      run(room, [client], 1)
      assert.ok(raftFits(raft, isWater, []), 'it stays on the water')
    }
  }
  assert.ok(raft.x < pose.x + SUB / 2, 'it is back at the shore')

  // Back flush against the shore where the player came aboard, walking west, they step off onto the land.
  Object.assign(raft, pose, { vx: 0, vy: 0, spin: 0 })
  run(room, [client], 1)
  const seq = { seq: 0 }
  // A step at a time, out over the edge and off, never a jump.
  for (let n = 0; n < 20; n++) {
    const before = { ...client.player.position }
    keys(room, client, KEY_LEFT, 1, seq)
    const stepped = Math.hypot(client.player.position.x - before.x, client.player.position.y - before.y)
    assert.ok(stepped <= PLAYER_SPEED + 1, `a step of ${stepped} units`)
  }
  assert.equal(client.player.aboard, undefined, 'stepped off')
  assert.ok(!isWater(floorDiv(client.player.position.x, SUB), floorDiv(client.player.position.y, SUB)), 'onto land')
})

test('rafts are saved, and so is who is aboard', () => {
  const { room, client, tile, land } = shore()
  client.player.position = { x: land.x, y: land.y }
  client.command({ k: 'place', x: tile.x, y: tile.y, slot: 0 })
  run(room, [client], 2)
  const raft = room.rafts.list()[0]
  client.player.aboard = { raft: raft.id, x: 20, y: -30 }
  run(room, [client], 1)
  const save = room.exportSave(0)
  const loaded = GameRoom.fromSave(save)
  assert.equal(loaded.rafts.list().length, 1)
  const back = new TestClient(loaded, 'Sailor')
  assert.deepEqual(back.player.aboard, { raft: raft.id, x: 20, y: -30 }, 'back aboard where they were')
})

test('out in the deep sea, far from land, a raft is much slower than in the shallows', () => {
  const { room, pose } = shore()
  const isWater = (x: number, y: number): boolean => waterAt(room.terrain, x, y)
  // A spot of deep sea: straight out from the spawn until the sea is deep.
  let deepPose: RaftPose | undefined
  for (let r = 10; r < 400 && !deepPose; r++) {
    const candidate = raftOnTile(floorDiv(PLAYER_SPAWN.x, SUB) + r, floorDiv(PLAYER_SPAWN.y, SUB))
    if (room.rafts.isDeep(candidate) && raftFits(candidate, isWater, [])) deepPose = { ...candidate, x: candidate.x + 20 * SUB }
  }
  assert.ok(deepPose && room.rafts.isDeep(deepPose), 'there is deep sea out there')
  assert.ok(!room.rafts.isDeep(pose), 'by the shore is not deep')
  const shallow = room.rafts.add({ ...pose, x: pose.x + SUB })
  const deep = room.rafts.add(deepPose!)
  const distance = (raft: typeof shallow): number => {
    const start = { x: raft.x, y: raft.y }
    room.rafts.row(raft.id, raft, -Math.PI / 2)
    for (let t = 0; t < 60; t++) room.rafts.step(isWater)
    return Math.hypot(raft.x - start.x, raft.y - start.y)
  }
  const near = distance(shallow)
  const far = distance(deep)
  assert.ok(far < near * 0.4, `a stroke takes it much less far in the deep (${Math.round(far)} against ${Math.round(near)} units)`)
})

test('a raft and an oar are made at the stump (and so at the workbench too)', () => {
  assert.ok(STATION_RECIPES.stump.some((recipe) => recipe.output === itemId('raft')))
  assert.ok(STATION_RECIPES.stump.some((recipe) => recipe.output === itemId('oar')))
  assert.ok(STATION_RECIPES.workbench.some((recipe) => recipe.output === itemId('raft')))
})

test('a player aboard one raft walks across onto another right beside it', () => {
  const { room, client, pose } = shore()
  const isWater = (x: number, y: number): boolean => waterAt(room.terrain, x, y)
  const first = room.rafts.add(pose)
  // The second just east of it, a little gap between.
  let second
  for (let dy = 0; dy < 6 * SUB && !second; dy += SUB / 4) {
    for (const y of [pose.y + dy, pose.y - dy]) {
      const there = { x: pose.x + RAFT_SIZE + 12, y, angle: 0 }
      const firstThere = { ...pose, y }
      if (raftFits(there, isWater, []) && raftFits(firstThere, isWater, [])) {
        Object.assign(first, firstThere)
        second = room.rafts.add(there)
        break
      }
    }
  }
  assert.ok(second, 'room for two rafts side by side')
  client.player.aboard = { raft: first.id, x: 0, y: 0 }
  run(room, [client], 1)
  keys(room, client, KEY_RIGHT, 20, { seq: 0 })
  assert.equal(client.player.aboard?.raft, second.id, 'aboard the second raft')
  assert.deepEqual(client.player.position, fromRaft(second, client.player.aboard!))
})

test('a rope on a raft pulls it in after the player; tied to a fence, it is held there; untied, the rope comes back', () => {
  const { room, client, pose, land } = shore()
  const isWater = (x: number, y: number): boolean => waterAt(room.terrain, x, y)
  client.player.inventory.slots[2] = { item: itemId('rope'), count: 2 }
  client.player.position = { ...land }
  // Out on the water, a few tiles from the shore.
  let out = { ...pose }
  while (out.x < pose.x + 3 * SUB && raftFits({ ...out, x: out.x + 8 }, isWater, [])) out = { ...out, x: out.x + 8 }
  assert.ok(out.x - pose.x > 2 * SUB, 'open water out from the shore')
  const raft = room.rafts.add(out)
  client.command({ k: 'raftRope', raft: raft.id, slot: 2 })
  run(room, [client], 3)
  assert.equal(raft.leader, client.player.id, 'on the player\'s rope')
  assert.equal(countOf(client.player.inventory, itemId('rope')), 1)
  run(room, [client], 2)
  assert.ok(out.x - raft.x < SUB / 2, 'not yanked in at once')
  run(room, [client], 2 * TPS)
  assert.ok(raft.x < out.x, 'pulled in')
  assert.ok(Math.hypot(raft.x - land.x, raft.y - land.y) <= LEAD_LENGTH + SUB / 4, 'to within a rope of the player')

  // A fence on the land by the player: right clicked, then the raft, it is tied there on the player's rope.
  const fence = createEntity(90_001, 'fence', floorDiv(land.x, SUB) - 1, floorDiv(land.y, SUB), 0, 0)
  room.world.addEntity(fence)
  client.command({ k: 'tie', fence: fence.id, raft: raft.id })
  run(room, [client], 3)
  assert.equal(raft.post, fence.id)
  assert.equal(raft.leader, 0)
  assert.equal(countOf(client.player.inventory, itemId('rope')), 1, 'the rope it was led on, moved to the fence')
  // Rowed hard away, it is held.
  for (let i = 0; i < 10; i++) room.rafts.row(raft.id, raft, 0)
  run(room, [client], 90)
  const post = fencePost(fence)
  assert.ok(Math.hypot(raft.x - post.x, raft.y - post.y) <= ROPE_HELD + 2, 'held by the fence')
  // A fence holds one thing.
  client.command({ k: 'tie', fence: fence.id, raft: raft.id })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'postTaken')
  // Saved tied.
  const loaded = GameRoom.fromSave(room.exportSave(0))
  assert.equal(loaded.rafts.get(raft.id)?.post, fence.id)
  // Untied at the fence, the rope back.
  client.command({ k: 'untie', fence: fence.id })
  run(room, [client], 3)
  assert.equal(raft.post, 0)
  assert.equal(countOf(client.player.inventory, itemId('rope')), 2)
})
