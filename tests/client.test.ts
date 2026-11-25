import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { diffChunkSnapshots } from '../apps/client/src/desync-diff.ts'
import { Prediction } from '../apps/client/src/prediction.ts'
import {
  countOf,
  createEntity,
  createInventory,
  addItems,
  entityToState,
  FactoryWorld,
  ITEMS,
  type ChestEntity,
} from '../packages/shared/src/index.ts'

test('every item has a picture under res/, but the few drawn as stand-ins', () => {
  // As ui/icons.ts finds them: an item's own `icon`, or icons/items/<key>.png (an ore's icons/ores/<key>.png). The
  // factory's ores (put away for now) have none, and nor do some of the meadow's and the desert's things yet.
  const standIns = new Set(['garden-plot', 'feed-box', 'ice-shard', 'icicle', 'sunflower-seed', 'cactus', 'string'])
  for (const item of ITEMS) {
    const file = item.icon ?? (item.category === 'ore' ? `icons/ores/${item.key}.png` : `icons/items/${item.key}.png`)
    if (!standIns.has(item.key) && item.category !== 'ore') assert.ok(existsSync(`res/${file}`), `${item.key}: res/${file}`)
  }
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
