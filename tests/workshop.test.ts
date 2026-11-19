import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  AMMO_SLOT,
  barrelPlan,
  BARREL_RECIPES,
  BUILDINGS,
  countOf,
  createEntity,
  CROPS,
  FactoryWorld,
  growthNeeded,
  itemId,
  LIQUID_TANNIN,
  LIQUID_WATER,
  PUNCH_COOLDOWN_TICKS,
  randomTick,
  RECIPES,
  STATION_RECIPES,
  SUB,
  TPS,
  waterAt,
  type Entity,
} from '../packages/shared/src/index.ts'
import { differingChunks, run, TestClient } from './helpers.ts'

const center = (x: number, y: number): { x: number; y: number } => ({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })

// A room with bare ground (unless `plants`), no animals, a player at the spawn with what was asked for.
function workshop(code: string, items: Record<string, number> = {}, plants = false): { room: GameRoom; client: TestClient } {
  const room = new GameRoom(code, 11, { dropsOnGround: false, animals: false, plants })
  const client = new TestClient(room, 'Maker')
  run(room, [client], 5)
  Object.entries(items).forEach(([key, count], slot) => (client.player.inventory.slots[slot] = { item: itemId(key), count }))
  return { room, client }
}

function place(room: GameRoom, client: TestClient, slot: number, x: number, y: number): Entity {
  client.command({ k: 'place', x, y, slot })
  run(room, [client], 5)
  const placed = room.world.entityAt(x, y)
  assert.ok(placed, 'it was put down')
  return placed
}

const at = (room: GameRoom, id: number): Record<string, unknown> & { inv: { slots: Array<{ item: number; count: number }> } } =>
  room.world.entity(id) as never

test('a workbench is crafted by hand from planks and stone, and makes buildings again and again while it has enough and you are at it', () => {
  const workbench = RECIPES.find((recipe) => recipe.output === itemId('workbench'))!
  assert.deepEqual(
    workbench.inputs.map(([item, count]) => [item, count]),
    [
      [itemId('plank'), 20],
      [itemId('stone'), 10],
    ],
  )
  assert.ok(!RECIPES.some((recipe) => recipe.output === itemId('fence')), 'fences are made at the workbench now')
  const { room, client } = workshop('BENCH', { plank: 40, stone: 10, rope: 3 })
  client.command({ k: 'craft', recipe: workbench.id })
  run(room, [client], 5)
  const slot = client.player.inventory.slots.findIndex((candidate) => candidate.item === itemId('workbench'))
  const bench = place(room, client, slot, 2, 2)
  const fence = STATION_RECIPES.workbench.find((recipe) => recipe.output === itemId('fence'))!
  const need = (key: string): number => fence.inputs.find(([item]) => item === itemId(key))![1]
  // Enough for one lot: it makes one, and stops.
  client.command({ k: 'put', id: bench.id, item: itemId('plank'), max: need('plank') })
  client.command({ k: 'put', id: bench.id, item: itemId('rope'), max: need('rope') })
  client.command({ k: 'work', id: bench.id, recipe: fence.index })
  run(room, [client], fence.ticks + 10)
  assert.equal(at(room, bench.id).inv.slots[3].count, fence.count, 'one lot of fences, then it stopped')
  assert.equal(at(room, bench.id).active, 0)
  // Enough for two more: it keeps going until it has made them.
  client.command({ k: 'put', id: bench.id, item: itemId('plank'), max: need('plank') * 2 })
  client.command({ k: 'put', id: bench.id, item: itemId('rope'), max: need('rope') * 2 })
  client.command({ k: 'work', id: bench.id, recipe: fence.index })
  run(room, [client], fence.ticks * 2 + 10)
  assert.equal(at(room, bench.id).inv.slots[3].count, fence.count * 3, 'again and again until it ran out')
  assert.deepEqual(differingChunks(room, client), [])
  // Walking off stops it.
  client.command({ k: 'put', id: bench.id, item: itemId('plank'), max: 2 })
  client.command({ k: 'take', id: bench.id, item: itemId('fence'), max: 100 })
  run(room, [client], 5)
  client.player.inventory.slots[10] = { item: itemId('rope'), count: 1 }
  client.command({ k: 'put', id: bench.id, item: itemId('rope'), max: 1 })
  client.command({ k: 'work', id: bench.id, recipe: fence.index, repeat: true })
  client.command({ k: 'use', id: 0 })
  run(room, [client], fence.ticks + 10)
  assert.equal(at(room, bench.id).inv.slots[3].count, 0, 'nothing while nobody was at it')
})

test('a campfire burns fuel for heat (charcoal hotter than wood), cooks, and leaves charcoal from logs', () => {
  const { room, client } = workshop('FIRE', { campfire: 1, log: 20, steak: 2 })
  const fire = place(room, client, 0, 2, 2)
  client.command({ k: 'machine', id: fire.id, action: 'light' })
  run(room, [client], 5)
  assert.equal(client.results.at(-1)?.why, 'noFuel')
  client.command({ k: 'put', id: fire.id, item: itemId('log'), max: 20 })
  client.command({ k: 'put', id: fire.id, item: itemId('steak'), max: 2 })
  client.command({ k: 'machine', id: fire.id, action: 'light' })
  run(room, [client], 10 * TPS)
  assert.equal(at(room, fire.id).heat, 400, 'a wood fire gets to 400')
  run(room, [client], 20 * TPS)
  assert.ok(at(room, fire.id).inv.slots[2].count >= 1, 'it cooked a steak')
  assert.equal(at(room, fire.id).inv.slots[2].item, itemId('cooked-steak'))
  assert.deepEqual(differingChunks(room, client), [])
  run(room, [], 20 * 20 * TPS)
  const burnt = at(room, fire.id)
  assert.equal(burnt.lit, 0, 'it went out when the logs ran out')
  assert.ok(burnt.inv.slots[3].count >= 2 && burnt.inv.slots[3].count <= 10, `about a quarter of the logs left charcoal (${burnt.inv.slots[3].count})`)
  assert.ok(itemId('charcoal') && (burnt.heat as number) < 400, 'and it is cooling')
})

test('a drying rack dries a hide, much faster beside a lit campfire', () => {
  const time = (withFire: boolean): number => {
    const world = new FactoryWorld()
    const rack = createEntity(1, 'rack', 3, 3, 0, 0) as Entity & { inv: { slots: Array<{ item: number; count: number }> } }
    rack.inv.slots[0] = { item: itemId('hide'), count: 1 }
    world.addEntity(rack)
    if (withFire) {
      const fire = createEntity(2, 'campfire', 4, 3, 0, 0) as Entity & { inv: { slots: Array<{ item: number; count: number }> }; lit: number }
      fire.inv.slots[0] = { item: itemId('charcoal'), count: 50 }
      fire.lit = 1
      world.addEntity(fire)
    }
    for (let tick = 1; tick < 200 * TPS; tick++) {
      world.stepInterior(tick, 1)
      if ((world.entity(1) as typeof rack).inv.slots[1].count === 1) return tick
    }
    return -1
  }
  const cold = time(false)
  const warm = time(true)
  assert.ok(cold > 100 * TPS, `it dries in its own time (${cold / TPS} s)`)
  assert.ok(warm > 0 && warm < cold / 4, `much faster by the fire (${warm / TPS} s)`)
})

test('a bucket fills at a pond and empties into a barrel; bark and water, sealed and boiled, make tannin; a full barrel of it tans a hide', () => {
  const seed = 11
  let pond: { x: number; y: number } | undefined
  for (let r = 0; r < 200 && !pond; r++) {
    for (let x = -r; x <= r && !pond; x++) for (const y of [-r, r]) if (!pond && waterAt(seed, x, y)) pond = { x, y }
  }
  assert.ok(pond, 'there is a pond')
  const { room, client } = workshop('BARREL', { barrel: 1, bucket: 1, bark: 1, campfire: 1, charcoal: 20 })
  client.player.position = center(pond.x, pond.y + 3)
  run(room, [client], 1)
  // Find a dry spot beside the player for the barrel, and one beside that for the fire.
  const spot = { x: pond.x + 0, y: pond.y + 5 }
  while (waterAt(seed, spot.x, spot.y) || waterAt(seed, spot.x + 1, spot.y)) spot.y++
  client.player.position = center(spot.x, spot.y + 2)
  const barrel = place(room, client, 0, spot.x, spot.y)
  client.player.position = center(pond.x, pond.y + 2)
  const fill = (): void => {
    client.command({ k: 'apply', x: pond!.x, y: pond!.y, slot: 1 })
    client.command({ k: 'apply', x: spot.x, y: spot.y, slot: 1 })
    run(room, [client], 3)
  }
  fill()
  fill()
  assert.equal(at(room, barrel.id).amount, 2)
  assert.equal(at(room, barrel.id).liquid, LIQUID_WATER)
  client.command({ k: 'put', id: barrel.id, item: itemId('bark'), max: 1 })
  client.command({ k: 'machine', id: barrel.id, action: 'seal' })
  run(room, [client], 5)
  const plan = barrelPlan(at(room, barrel.id) as never)
  assert.ok(!plan.ready && plan.reason.startsWith('Not started'), `with too little bark it does not start: ${plan.reason}`)
  assert.ok(!client.results.some((result) => !result.ok && result.why !== 'tooSoon'), 'and nobody is told off for it')
  client.command({ k: 'put', id: barrel.id, item: itemId('bark'), max: 1 })
  run(room, [client], 5)
  assert.equal(client.results.at(-1)?.why, 'sealed', 'a sealed barrel takes nothing')
  client.command({ k: 'machine', id: barrel.id, action: 'unseal' })
  client.player.inventory.slots[2] = { item: itemId('bark'), count: 1 }
  client.command({ k: 'put', id: barrel.id, item: itemId('bark'), max: 1 })
  client.command({ k: 'machine', id: barrel.id, action: 'seal' })
  const fire = place(room, client, 3, spot.x + 1, spot.y)
  client.command({ k: 'put', id: fire.id, item: itemId('charcoal'), max: 20 })
  client.command({ k: 'machine', id: fire.id, action: 'light' })
  run(room, [client], BARREL_RECIPES[1].heat / 2 + BARREL_RECIPES[1].ticks + 30)
  assert.equal(at(room, barrel.id).liquid, LIQUID_TANNIN, 'the water boiled into tannin')
  assert.equal(at(room, barrel.id).amount, 2)
  assert.deepEqual(differingChunks(room, client), [])
  // Leather: a bucket of tannin for each dried hide, all at once; too little tannin for them all, and it does not start.
  const world = new FactoryWorld()
  const vat = createEntity(1, 'barrel', 0, 0, 0, 0) as Entity & Record<string, number> & { inv: { slots: Array<{ item: number; count: number }> } }
  Object.assign(vat, { liquid: LIQUID_TANNIN, amount: 2, sealed: 1 })
  vat.inv.slots[0] = { item: itemId('dried-hide'), count: 3 }
  world.addEntity(vat)
  const leather = BARREL_RECIPES.find((recipe) => recipe.output === itemId('leather'))!
  for (let tick = 1; tick <= leather.ticks + 1; tick++) world.stepInterior(tick, 1)
  assert.equal(vat.inv.slots[3].count, 0, 'three hides and two buckets: nothing')
  vat.amount = 4
  for (let tick = 1; tick <= leather.ticks / 2; tick++) world.stepInterior(tick, 1)
  // Opened, another hide put in, and sealed again: it starts again.
  vat.inv.slots[0].count = 4
  for (let tick = 1; tick <= leather.ticks / 2 + 2; tick++) world.stepInterior(tick, 1)
  assert.equal(vat.inv.slots[3].count, 0, 'more hides start it again')
  for (let tick = 1; tick <= leather.ticks; tick++) world.stepInterior(tick, 1)
  assert.equal(vat.inv.slots[3].item, itemId('leather'))
  assert.equal(vat.inv.slots[3].count, 4, 'four hides, four leather')
  assert.equal(vat.amount, 0, 'a bucket of tannin each')
})

test('organic things rot to compost in an open, dry barrel; water makes a plot grow faster, and dries out', () => {
  const world = new FactoryWorld()
  const vat = createEntity(1, 'barrel', 0, 0, 0, 0) as Entity & Record<string, number> & { inv: { slots: Array<{ item: number; count: number }> } }
  vat.inv.slots[0] = { item: itemId('leaves'), count: BARREL_RECIPES[2].solids[0][1] - 2 }
  vat.inv.slots[1] = { item: itemId('acorn'), count: 2 }
  vat.sealed = 1
  world.addEntity(vat)
  for (let tick = 1; tick <= BARREL_RECIPES[2].ticks + 1; tick++) world.stepInterior(tick, 1)
  assert.equal(vat.inv.slots[3].item, itemId('compost'))
  assert.equal(vat.inv.slots[0].count + vat.inv.slots[1].count, 0)

  const wheat = CROPS[0]
  const grow = (water: number, fertility: number): number => {
    const plot = createEntity(1, 'plot', 0, 0, 0, 0) as Entity & Record<string, number>
    Object.assign(plot, { crop: wheat.id, water, fertility })
    let ticks = 0
    while (plot.growth < growthNeeded(wheat.growTicks) && ticks < 1000) {
      randomTick(plot)
      ticks++
    }
    return ticks
  }
  assert.ok(grow(100, 0) < grow(0, 0), 'faster watered')
  const plot = createEntity(1, 'plot', 0, 0, 0, 0) as Entity & Record<string, number>
  Object.assign(plot, { water: 100 })
  for (let i = 0; i < 40; i++) randomTick(plot)
  assert.equal(plot.water, 0, 'and it dries out')

  const { room, client } = workshop('SOIL', { 'garden-plot': 1, compost: 2, 'water-bucket': 1 })
  const bed = place(room, client, 0, 2, 2)
  client.command({ k: 'apply', x: 2, y: 2, slot: 1 })
  client.command({ k: 'apply', x: 2, y: 2, slot: 2 })
  run(room, [client], 5)
  assert.equal(client.results.at(-2)?.why, 'cannotApply', 'compost does not fertilise any more')
  assert.equal(at(room, bed.id).water, 100)
  assert.equal(client.player.inventory.slots[2].item, itemId('bucket'), 'the bucket is empty again')
})

test('a knife strips bark off a tree without hurting it, and trees drop leaves', () => {
  const room = new GameRoom('BARK', 11, { dropsOnGround: false, animals: false })
  const client = new TestClient(room, 'Stripper')
  run(room, [client], 5)
  const tree = room.world.chunkIds.flatMap((id) => [...room.world.chunk(id)!.entities]).find((entity) => entity.kind === 'tree')!
  client.player.position = center(tree.x, tree.y + 1)
  client.player.inventory.slots[0] = { item: itemId('knife'), count: 1 }
  for (let i = 0; i < 6; i++) {
    client.command({ k: 'punch', id: tree.id, slot: 0 })
    run(room, [client], PUNCH_COOLDOWN_TICKS)
  }
  assert.equal(countOf(client.player.inventory, itemId('bark')), 1)
  assert.equal(countOf(client.player.inventory, itemId('stick')), 0)
  assert.equal(countOf(client.player.inventory, itemId('leaves')), 1)
  assert.equal((room.world.entity(tree.id) as { hp: number }).hp, BUILDINGS.tree.maxHp, 'unhurt')
})

test('a field of grown crops can be harvested without waiting between plots', () => {
  const { room, client } = workshop('FIELD')
  const wheat = CROPS[0]
  const plots: Entity[] = []
  for (let x = 2; x < 6; x++) {
    const plot = createEntity(70_000 + x, 'plot', x, 2, 0, 0) as Entity & Record<string, number>
    Object.assign(plot, { crop: wheat.id, growth: growthNeeded(wheat.growTicks) })
    room.world.addEntity(plot)
    plots.push(plot)
  }
  for (const plot of plots) client.command({ k: 'punch', id: plot.id, slot: 5 })
  run(room, [client], 3)
  assert.deepEqual(client.results.map((result) => result.why ?? 'ok'), ['ok', 'ok', 'ok', 'ok'])
  assert.ok(countOf(client.player.inventory, itemId('wheat')) >= 4)
})

test('stacks move between any two slots: onto their kind up to a stack (the rest stays), swapped with another kind, halved; and dropped on the ground', () => {
  const room = new GameRoom('SLOTS', 11, { animals: false, plants: false })
  const client = new TestClient(room, 'Sorter')
  run(room, [client], 5)
  const slots = client.player.inventory.slots
  Object.assign(slots[0], { item: itemId('chest'), count: 1 })
  Object.assign(slots[1], { item: itemId('log'), count: 30 })
  Object.assign(slots[2], { item: itemId('log'), count: 40 })
  Object.assign(slots[3], { item: itemId('stone'), count: 5 })
  const chest = place(room, client, 0, 2, 2)
  // Onto its kind: as many as fit (a stack is 50), the rest stays where it came from.
  client.command({ k: 'slot', from: { id: 0, i: 1 }, to: { id: 0, i: 2 }, count: 30 })
  run(room, [client], 3)
  assert.deepEqual([slots[1].count, slots[2].count], [20, 50])
  // Into a chest's slot, then swapped with another kind there.
  client.command({ k: 'slot', from: { id: 0, i: 3 }, to: { id: chest.id, i: 4 }, count: 5 })
  client.command({ k: 'slot', from: { id: 0, i: 1 }, to: { id: chest.id, i: 4 }, count: 20 })
  run(room, [client], 3)
  assert.deepEqual(at(room, chest.id).inv.slots[4], { item: itemId('log'), count: 20 })
  assert.deepEqual({ item: slots[1].item, count: slots[1].count }, { item: itemId('stone'), count: 5 })
  // Half a stack (what Ctrl-dragging sends).
  client.command({ k: 'slot', from: { id: 0, i: 2 }, to: { id: 0, i: 5 }, count: 25 })
  run(room, [client], 3)
  assert.deepEqual([slots[2].count, slots[5].count], [25, 25])
  // Arrows only go in the ammunition slot, logs do not.
  client.command({ k: 'slot', from: { id: 0, i: 5 }, to: { id: 0, i: AMMO_SLOT }, count: 25 })
  run(room, [client], 3)
  assert.equal(slots[AMMO_SLOT].count, 0, 'logs are not ammunition')
  // Dropped: off the player, onto the ground a little way off, and not picked straight back up.
  client.command({ k: 'drop', from: { id: 0, i: 5 }, count: 25, x: client.player.position.x + SUB * 3, y: client.player.position.y })
  run(room, [client], 40)
  assert.equal(slots[5].count, 0)
  assert.ok(room.world.allDrops().some((drop) => drop.item === itemId('log') && drop.count === 25), 'the logs lie on the ground')
  assert.deepEqual(differingChunks(room, client), [])
})
