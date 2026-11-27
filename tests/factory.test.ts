import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BELT_LENGTH,
  BELT_SPEED,
  CHUNK_SIZE,
  chunkOfTile,
  countOf,
  createEntity,
  EAST,
  entityToState,
  FactoryWorld,
  mineTicksOf,
  insertIntoLane,
  itemId,
  laneHasRoomAt,
  linkSpecsFor,
  linkToState,
  NORTH,
  SOUTH,
  stepLane,
  SUB,
  type BeltEntity,
  type Entity,
  type LaneItem,
  type MinerEntity,
  type ChestEntity,
} from '../packages/shared/src/index.ts'
import { applyWorldEvent } from '../packages/shared/src/sim/world-events.ts'

// A world built by hand, with links worked out the way the server works them out.
function buildWorld(entities: Entity[]): FactoryWorld {
  const world = new FactoryWorld()
  let nextLink = 1
  for (const entity of entities) {
    applyWorldEvent(world, { t: 'add', e: entityToState(entity) })
    for (const spec of linkSpecsFor(world.entity(entity.id)!, (x, y) => world.entityAt(x, y))) {
      applyWorldEvent(world, {
        t: 'link+',
        l: linkToState({
          id: nextLink++,
          from: spec.from.id,
          to: spec.to.id,
          fromChunk: world.chunkOfEntity(spec.from.id)!,
          toChunk: world.chunkOfEntity(spec.to.id)!,
          entry: spec.entry,
          blocked: false,
        }),
      })
    }
  }
  return world
}

function tick(world: FactoryWorld, times = 1): void {
  for (let i = 0; i < times; i++) {
    world.stepInterior(i, 1)
    world.exchange()
  }
}

test('items on a belt move at belt speed and stop at the end', () => {
  const lane: LaneItem[] = []
  insertIntoLane(lane, 1, 0, 0)
  stepLane(lane)
  assert.equal(lane[0].pos, BELT_SPEED)
  for (let i = 0; i < 40; i++) stepLane(lane)
  assert.equal(lane[0].pos, BELT_LENGTH)
})

test('a belt holds at most four items, a gap apart', () => {
  const lane: LaneItem[] = []
  for (let i = 0; i < 60; i++) {
    if (laneHasRoomAt(lane, 0)) insertIntoLane(lane, 1, 0, 0)
    stepLane(lane)
  }
  assert.equal(lane.length, 4)
  assert.deepEqual(lane.map((item) => item.pos), [256, 192, 128, 64])
  assert.equal(laneHasRoomAt(lane, 0), false)
})

test('a miner on ore fills its store, an extractor pulls it onto belts, and a belt fills a chest', () => {
  // The simulation does not look at the ground: a miner digs whatever it was made with (the factory's ores are gone: any
  // item does).
  const start = { x: 0, y: 0 }
  const ore = itemId('stone')
  const world = buildWorld([
    createEntity(1, 'miner', start.x, start.y, EAST, ore),
    createEntity(2, 'extractor', start.x + 1, start.y, EAST, 0),
    createEntity(3, 'belt', start.x + 2, start.y, EAST, 0),
    createEntity(4, 'belt', start.x + 3, start.y, EAST, 0),
    createEntity(5, 'chest', start.x + 4, start.y, EAST, 0),
  ])
  assert.equal(world.linkIds.length, 4, 'miner → extractor → belt → belt → chest')
  const mineTicks = mineTicksOf(ore)
  tick(world, mineTicks * 5 + 200)
  const chest = world.entity(5) as ChestEntity
  const miner = world.entity(1) as MinerEntity
  assert.ok(countOf(chest.inv, ore) >= 4, `the chest has ${countOf(chest.inv, ore)}`)
  assert.equal(countOf(miner.inv, ore), 0, 'everything mined was carried off')
})

test('a belt fed from one side only turns the corner, and from behind as well it is straight', () => {
  const world = buildWorld([
    createEntity(1, 'belt', 0, 0, EAST, 0),
    createEntity(2, 'belt', 1, 0, SOUTH, 0),
  ])
  const corner = world.entity(2) as BeltEntity
  // Going east into a belt facing south comes in from its right (west is on the right of a belt facing south).
  assert.equal(corner.shape, 'right')
  applyWorldEvent(world, { t: 'add', e: entityToState(createEntity(3, 'belt', 1, -1, SOUTH, 0)) })
  for (const spec of linkSpecsFor(world.entity(3)!, (x, y) => world.entityAt(x, y))) {
    applyWorldEvent(world, { t: 'link+', l: linkToState({ id: 9, from: spec.from.id, to: spec.to.id, fromChunk: 0, toChunk: 0, entry: spec.entry, blocked: false }) })
  }
  assert.equal(corner.shape, 'straight')
})

test('belts facing each other are not linked', () => {
  const world = buildWorld([
    createEntity(1, 'belt', 0, 0, EAST, 0),
    createEntity(2, 'belt', 1, 0, 2, 0),
  ])
  assert.equal(world.linkIds.length, 0)
})

test('items cross a chunk edge without stopping', () => {
  const edge = CHUNK_SIZE - 1
  const world = buildWorld([
    createEntity(1, 'belt', edge, 0, EAST, 0),
    createEntity(2, 'belt', edge + 1, 0, EAST, 0),
  ])
  assert.notEqual(chunkOfTile(edge, 0), chunkOfTile(edge + 1, 0))
  const first = world.entity(1) as BeltEntity
  insertIntoLane(first.lane, 1, 0, 0)
  tick(world, BELT_LENGTH / BELT_SPEED)
  const second = world.entity(2) as BeltEntity
  assert.equal(first.lane.length, 0)
  assert.equal(second.lane.length, 1)
  assert.equal(second.lane[0].pos, 0)
  tick(world)
  assert.equal(second.lane[0].pos, BELT_SPEED)
})

test('a snapshot loaded into another world hashes the same', () => {
  const world = buildWorld([
    createEntity(1, 'belt', 3, 3, NORTH, 0),
    createEntity(2, 'chest', 3, 2, EAST, 0),
  ])
  insertIntoLane((world.entity(1) as BeltEntity).lane, itemId('log'), 0, 0)
  tick(world, 5)
  const chunk = chunkOfTile(3, 3)
  const copy = new FactoryWorld()
  copy.loadChunk(structuredClone(world.snapshotChunk(chunk)))
  assert.equal(copy.hashChunk(chunk), world.hashChunk(chunk))
  tick(world, 30)
  tick(copy, 30)
  assert.equal(copy.hashChunk(chunk), world.hashChunk(chunk))
  assert.equal(SUB, 256)
})
