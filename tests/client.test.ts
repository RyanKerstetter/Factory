import assert from 'node:assert/strict'
import test from 'node:test'
import { ART_CATALOG, buildingArt, itemArt, oreTileArt, animalArt, cropArt } from '../apps/client/src/render/art-catalog.ts'
import { ORES } from '../packages/shared/src/index.ts'
import { beltLocalPoint, beltPoint } from '../apps/client/src/render/belt-path.ts'
import { diffChunkSnapshots } from '../apps/client/src/desync-diff.ts'
import { Prediction } from '../apps/client/src/prediction.ts'
import {
  BELT_LENGTH,
  BUILDING_KINDS,
  countOf,
  createEntity,
  createInventory,
  addItems,
  entityToState,
  FactoryWorld,
  ITEMS,
  ANIMALS,
  BUILDINGS,
  CROPS,
  type BuildingKind,
  NORTH,
  SOUTH,
  type ChestEntity,
} from '../packages/shared/src/index.ts'

test('every building, item and ore has a picture in the art catalog', () => {
  for (const kind of Object.keys(BUILDINGS) as BuildingKind[]) assert.ok(ART_CATALOG[buildingArt({ kind, x: 3, y: 4, item: 1 })], kind)
  for (let connect = 0; connect < 16; connect++) {
    assert.ok(ART_CATALOG[buildingArt({ kind: 'fence', x: 0, y: 0, connect })])
    assert.ok(ART_CATALOG[buildingArt({ kind: 'gate', x: 0, y: 0, connect, open: connect % 2 === 0 })])
  }
  assert.ok(ART_CATALOG[buildingArt({ kind: 'belt', x: 0, y: 0, shape: 'left' })])
  assert.ok(ART_CATALOG[buildingArt({ kind: 'extractor', x: 0, y: 0, shape: 'right' })])
  for (const crop of CROPS) for (let growth = 0; growth <= crop.growTicks; growth++) assert.ok(ART_CATALOG[cropArt(crop.id, growth)!], crop.key)
  for (const animal of ANIMALS) assert.ok(ART_CATALOG[animalArt(animal.kind)], animal.kind)
  for (const item of ITEMS) assert.ok(ART_CATALOG[itemArt(item.id)], item.key)
  for (const item of ORES) assert.ok(ART_CATALOG[oreTileArt(item.id)], item.key)
  assert.equal(ART_CATALOG[itemArt(1)].file, 'icons/ores/iron.png', 'the ore icons in res/ are the items')
  // The stump, the workbench and the chest are drawn in the world from their icons; otherwise no two pictures share a
  // file.
  const files = Object.entries(ART_CATALOG)
    .filter(([name]) => name !== 'building/stump' && name !== 'building/workbench' && name !== 'building/chest')
    .map(([, entry]) => entry.file)
  assert.equal(new Set(files).size, files.length, 'no two pictures share a file')
})

test('items run along a belt from its back edge to its front edge, and round a corner from side to front', () => {
  assert.deepEqual(beltLocalPoint('straight', 0), { x: -0.5, y: 0 })
  assert.deepEqual(beltLocalPoint('straight', BELT_LENGTH), { x: 0.5, y: 0 })
  const start = beltLocalPoint('left', 0)
  const end = beltLocalPoint('left', BELT_LENGTH)
  assert.ok(Math.abs(start.x) < 1e-9 && Math.abs(start.y + 0.5) < 1e-9, 'a left corner starts at the top edge')
  assert.ok(Math.abs(end.x - 0.5) < 1e-9 && Math.abs(end.y) < 1e-9, 'and ends at the front edge')
  // A belt facing south at 3,4: its back edge is the top of the tile, its front the bottom.
  assert.deepEqual(beltPoint({ x: 3, y: 4, dir: SOUTH, shape: 'straight' }, 0), { x: 3.5, y: 4 })
  assert.deepEqual(beltPoint({ x: 3, y: 4, dir: SOUTH, shape: 'straight' }, BELT_LENGTH), { x: 3.5, y: 5 })
  const north = beltPoint({ x: 0, y: 0, dir: NORTH, shape: 'straight' }, BELT_LENGTH)
  assert.ok(Math.abs(north.x - 0.5) < 1e-9 && Math.abs(north.y) < 1e-9)
})

test('the desync diff names what differs', () => {
  const world = new FactoryWorld()
  world.addEntity(createEntity(1, 'chest', 0, 0, 0, 0))
  const before = structuredClone(world.snapshotChunk(world.chunkIds[0]))
  addItems((world.entity(1) as ChestEntity).inv, 2, 5)
  const lines = diffChunkSnapshots(before, world.snapshotChunk(world.chunkIds[0]))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /building 1 \(chest at 0,0\) inv/)
  assert.deepEqual(diffChunkSnapshots(before, before), [])
  assert.ok(entityToState(world.entity(1)!))
})

test('the prediction shows a take as done until its result comes, without touching the world', () => {
  const world = new FactoryWorld()
  world.addEntity(createEntity(1, 'chest', 0, 0, 0, 0))
  addItems((world.entity(1) as ChestEntity).inv, 1, 30)
  const prediction = new Prediction()
  prediction.add(7, { k: 'take', id: 1, item: 1, max: 20 }, 0)
  const predicted = prediction.predictInventories(createInventory(4), world)
  assert.equal(countOf(predicted.player, 1), 20)
  assert.equal(countOf(predicted.buildings.get(1)!, 1), 10)
  assert.equal(countOf((world.entity(1) as ChestEntity).inv, 1), 30, 'the factory itself is untouched')
  prediction.settle(7)
  assert.equal(countOf(prediction.predictInventories(createInventory(4), world).player, 1), 0)
})
