import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { bake, unbake } from '../apps/client/src/render3d/bake.ts'
import * as models from '../apps/client/src/render3d/models.ts'
import { chunkOfTile, createEntity, entityToState, FactoryWorld, NO_ITEM, type Entity } from '../packages/shared/src/index.ts'
import { applyWorldEvent } from '../packages/shared/src/sim/world-events.ts'

// ---- the buildings by kind (FactoryWorld.ofKind), which what wants every waystone, altar or hive uses

const place = (world: FactoryWorld, entity: Entity): void => applyWorldEvent(world, { t: 'add', e: entityToState(entity) })

test('a world finds its buildings by kind, in ID order, as they come, go and change kind', () => {
  const world = new FactoryWorld()
  place(world, createEntity(7, 'altar', 40, 3, 0, NO_ITEM))
  place(world, createEntity(2, 'altar', 1, 1, 0, NO_ITEM))
  place(world, createEntity(5, 'tree', 2, 2, 0, NO_ITEM))
  place(world, createEntity(3, 'sapling', 3, 3, 0, NO_ITEM))
  assert.deepEqual(world.ofKind('altar').map((altar) => altar.id), [2, 7], 'in ID order, across chunks')
  assert.equal(world.countOf('tree'), 1)
  const before = world.changesOf('tree')
  // A sapling grown into a tree: the same ID, a new kind.
  applyWorldEvent(world, { t: 'set', e: entityToState(createEntity(3, 'tree', 3, 3, 0, NO_ITEM)) })
  assert.deepEqual(world.ofKind('tree').map((tree) => tree.id), [3, 5])
  assert.equal(world.countOf('sapling'), 0)
  assert.ok(world.changesOf('tree') > before, 'what was worked out from the trees knows to work it out again')
  const altars = world.changesOf('altar')
  applyWorldEvent(world, { t: 'remove', id: 2 })
  assert.deepEqual(world.ofKind('altar').map((altar) => altar.id), [7])
  assert.ok(world.changesOf('altar') > altars)
  // A chunk let go of, and one put in from a snapshot, take their buildings with them.
  const far = chunkOfTile(40, 3)
  const snapshot = structuredClone(world.snapshotChunk(far))
  world.dropChunk(far)
  assert.deepEqual(world.ofKind('altar'), [])
  world.loadChunk(snapshot)
  assert.deepEqual(world.ofKind('altar').map((altar) => altar.id), [7])
  assert.equal(world.ofKind('altar')[0], world.entity(7), 'the building itself, not a copy')
})

test('the list of a kind stays the same object until that kind changes', () => {
  const world = new FactoryWorld()
  place(world, createEntity(1, 'waystone', 0, 0, 0, NO_ITEM))
  const list = world.ofKind('waystone')
  place(world, createEntity(2, 'tree', 1, 0, 0, NO_ITEM))
  assert.equal(world.ofKind('waystone'), list, 'another kind coming does not make it again')
  place(world, createEntity(3, 'waystone', 2, 0, 0, NO_ITEM))
  assert.notEqual(world.ofKind('waystone'), list)
  assert.equal(list.length, 1, 'and one handed out before is left as it was')
})

// ---- baking models (see bake.ts): fewer meshes, the same look

const meshesIn = (model: THREE.Object3D): THREE.Mesh[] => {
  const found: THREE.Mesh[] = []
  model.traverse((part) => {
    if (part instanceof THREE.Mesh) found.push(part)
  })
  return found
}
const boundsOf = (model: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(model, true)

test('baking a model makes it far fewer meshes, exactly where its parts were, in their colours', () => {
  for (const [name, model] of [
    ['tree', models.tree(3, 4)],
    ['grass', models.grass(1, 1)],
    ['workbench', models.workbench()],
    ['fence', models.fence(15, false)],
    ['cactus', models.cactus(2, 2)],
  ] as const) {
    const before = boundsOf(model)
    const colors = new Set(meshesIn(model).map((mesh) => (mesh.material as THREE.MeshStandardMaterial).color.getHexString()))
    const parts = meshesIn(model).length
    bake(model)
    const after = meshesIn(model)
    assert.equal(after.length, 1, `${name}: ${parts} meshes into one`)
    assert.ok(before.min.distanceTo(boundsOf(model).min) < 1e-6 && before.max.distanceTo(boundsOf(model).max) < 1e-6, `${name}: where it was`)
    // Every colour its parts had is on the corners of the baked mesh.
    const corner = after[0].geometry.getAttribute('color')
    const baked = new Set<string>()
    for (let i = 0; i < corner.count; i++) baked.add(new THREE.Color(corner.getX(i), corner.getY(i), corner.getZ(i)).getHexString())
    assert.deepEqual([...colors].filter((color) => !baked.has(color)), [], `${name}: its colours`)
  }
})

test('baking leaves what the view moves by name (flames) as it was, and unbaking frees only what baking made', () => {
  const fire = models.campfire(true)
  const flames = meshesIn(fire).filter((mesh) => mesh.name === 'flame')
  assert.ok(flames.length > 0)
  bake(fire)
  assert.deepEqual(
    meshesIn(fire).filter((mesh) => mesh.name === 'flame'),
    flames,
    'every flame still there, itself',
  )
  const made = meshesIn(fire).filter((mesh) => mesh.geometry.userData.baked)
  assert.ok(made.length > 0)
  let freed = 0
  for (const mesh of meshesIn(fire)) mesh.geometry.addEventListener('dispose', () => freed++)
  unbake(fire)
  assert.equal(freed, made.length, 'the shared shapes of the flames are not freed')
})
