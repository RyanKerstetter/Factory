import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  AMMO_SLOT,
  FOOD_SLOT,
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
  WATERED_SECONDS,
  WATER_FALL_EVERY,
  terrainOf,
  isSeaAt,
  type Entity,
  BARREL_OUTPUT,
  BARREL_SOLIDS,
  STATION_LAYOUT,
  oneKindEach,
  stepEntity,
  type BarrelEntity,
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

test('a workbench is made at the stump from planks and stone, and makes buildings again and again while it has enough and you are at it', () => {
  const workbench = STATION_RECIPES.stump.find((recipe) => recipe.output === itemId('workbench'))!
  assert.deepEqual(
    workbench.inputs.map(([item, count]) => [item, count]),
    [
      [itemId('plank'), 20],
      [itemId('stone'), 10],
    ],
  )
  assert.ok(!RECIPES.some((recipe) => recipe.output === itemId('fence')), 'fences are made at the workbench now')
  const { room, client } = workshop('BENCH', { plank: 40, stone: 10, rope: 3, stump: 1 })
  const stumpSlot = client.player.inventory.slots.findIndex((candidate) => candidate.item === itemId('stump'))
  const stump = place(room, client, stumpSlot, -2, 2)
  client.command({ k: 'put', id: stump.id, item: itemId('plank'), max: 20 })
  client.command({ k: 'put', id: stump.id, item: itemId('stone'), max: 10 })
  client.command({ k: 'work', id: stump.id, recipe: workbench.index })
  run(room, [client], workbench.ticks + 10)
  client.command({ k: 'take', id: stump.id, item: itemId('workbench'), max: 1 })
  run(room, [client], 5)
  const slot = client.player.inventory.slots.findIndex((candidate) => candidate.item === itemId('workbench'))
  assert.ok(slot >= 0, 'the stump made it')
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
  client.command({ k: 'work', id: bench.id, recipe: fence.index })
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

test('a bucket fills at a well and empties into a barrel; bark and water, sealed and boiled, make tannin; a full barrel of it tans a hide', () => {
  const { room, client } = workshop('BARREL', { barrel: 1, bucket: 1, bark: 1, campfire: 1, charcoal: 20, well: 1 })
  // The well, and beside it a spot for the barrel, and one beside that for the fire.
  const well = place(room, client, 5, 2, 0)
  const spot = { x: 2, y: 3 }
  const barrel = place(room, client, 0, spot.x, spot.y)
  const fill = (): void => {
    client.command({ k: 'apply', x: well.x, y: well.y, slot: 1 })
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
  assert.equal(vat.inv.slots[BARREL_OUTPUT].count, 0, 'three hides and two buckets: nothing')
  vat.amount = 4
  for (let tick = 1; tick <= leather.ticks / 2; tick++) world.stepInterior(tick, 1)
  // Opened, another hide put in, and sealed again: it starts again.
  vat.inv.slots[0].count = 4
  for (let tick = 1; tick <= leather.ticks / 2 + 2; tick++) world.stepInterior(tick, 1)
  assert.equal(vat.inv.slots[BARREL_OUTPUT].count, 0, 'more hides start it again')
  for (let tick = 1; tick <= leather.ticks; tick++) world.stepInterior(tick, 1)
  assert.equal(vat.inv.slots[BARREL_OUTPUT].item, itemId('leather'))
  assert.equal(vat.inv.slots[BARREL_OUTPUT].count, 4, 'four hides, four leather')
  assert.equal(vat.amount, 0, 'a bucket of tannin each')
})

test('organic things rot to compost in an open, dry barrel; water makes a plot grow faster, and dries out', () => {
  const world = new FactoryWorld()
  const vat = createEntity(1, 'barrel', 0, 0, 0, 0) as Entity & Record<string, number> & { inv: { slots: Array<{ item: number; count: number }> } }
  // One slot of solids: a stack of one organic thing.
  assert.deepEqual(BARREL_SOLIDS, [0])
  vat.inv.slots[0] = { item: itemId('leaves'), count: BARREL_RECIPES[2].solids[0][1] }
  vat.sealed = 1
  world.addEntity(vat)
  for (let tick = 1; tick <= BARREL_RECIPES[2].ticks + 1; tick++) world.stepInterior(tick, 1)
  assert.equal(vat.inv.slots[BARREL_OUTPUT].item, itemId('compost'))
  assert.equal(vat.inv.slots[0].count, 0)

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
  // Watering lasts a set time, on the clock (not by chance).
  const plot = createEntity(1, 'plot', 0, 0, 0, 0) as Entity & Record<string, number>
  Object.assign(plot, { water: 100 })
  for (let i = 0; i < 40; i++) randomTick(plot)
  assert.equal(plot.water, 100, 'random ticks do not dry it')
  const dry = new FactoryWorld()
  dry.addEntity(plot)
  for (let tick = 1; tick <= (WATERED_SECONDS * TPS) / 2; tick++) dry.stepInterior(tick, 1)
  assert.ok(Math.abs(plot.water - 50) <= 1, `half dry half way (${plot.water})`)
  for (let tick = (WATERED_SECONDS * TPS) / 2 + 1; tick <= WATERED_SECONDS * TPS + WATER_FALL_EVERY; tick++) dry.stepInterior(tick, 1)
  assert.equal(plot.water, 0, 'and dry once its time is up')

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

test('the workbench includes the stump: everything the stump makes, the workbench makes too, after its own recipes', () => {
  const bench = STATION_RECIPES.workbench
  for (const recipe of STATION_RECIPES.stump) assert.ok(bench.some((mine) => mine.output === recipe.output), `the workbench makes ${recipe.output}`)
  // Its own recipes keep their places; the stump's come after, numbered on.
  bench.forEach((recipe, i) => assert.equal(recipe.index, i))
  assert.equal(new Set(bench.map((recipe) => recipe.output)).size, bench.length)
})

test('an empty bucket fills with salt water at the sea (fresh water at a pond); salt water boiled in an open barrel leaves salt', () => {
  const terrain = terrainOf(11)
  // The first sea east of the spawn, and the land just before it.
  let shore = 0
  while (!isSeaAt(terrain, shore + 1, 0)) shore++
  const { room, client } = workshop('SALT', { barrel: 1, bucket: 1, campfire: 1, charcoal: 20 })
  client.player.position = center(shore - 1, 0)
  run(room, [client], 1)
  const barrel = place(room, client, 0, shore - 2, 1)
  const fire = place(room, client, 2, shore - 3, 1)
  const fill = (): void => {
    client.command({ k: 'apply', x: shore + 1, y: 0, slot: 1 })
    run(room, [client], 3)
    assert.equal(client.player.inventory.slots[1].item, itemId('salt-water-bucket'), 'the sea fills it with salt water')
    client.command({ k: 'apply', x: barrel.x, y: barrel.y, slot: 1 })
    run(room, [client], 3)
  }
  fill()
  fill()
  const salty = at(room, barrel.id)
  assert.equal(salty.amount, 2)
  assert.notEqual(salty.liquid, LIQUID_WATER, 'salt water is not fresh water')
  client.command({ k: 'put', id: fire.id, item: itemId('charcoal'), max: 20 })
  client.command({ k: 'machine', id: fire.id, action: 'light' })
  const recipe = BARREL_RECIPES.find((one) => one.output === itemId('salt'))!
  run(room, [client], recipe.heat / 2 + 2 * recipe.ticks + 60)
  const boiled = at(room, barrel.id)
  assert.equal(boiled.inv.slots[BARREL_OUTPUT].item, itemId('salt'))
  assert.equal(boiled.inv.slots[BARREL_OUTPUT].count, 2, 'a salt for each bucket boiled away')
  assert.equal(boiled.amount, 0)
  assert.deepEqual(differingChunks(room, client), [])
})

test('an egg fries on a campfire', () => {
  const { room, client } = workshop('EGG', { campfire: 1, log: 5, egg: 1 })
  const fire = place(room, client, 0, 2, 2)
  client.command({ k: 'put', id: fire.id, item: itemId('log'), max: 5 })
  client.command({ k: 'put', id: fire.id, item: itemId('egg'), max: 1 })
  client.command({ k: 'machine', id: fire.id, action: 'light' })
  run(room, [client], 20 * TPS)
  assert.equal(at(room, fire.id).inv.slots[2].item, itemId('fried-egg'))
})

// A station recipe's place in its list, by what it makes.
const stationRecipe = (kind: 'stump' | 'workbench', output: string): number => STATION_RECIPES[kind].findIndex((recipe) => recipe.output === itemId(output))

test('the workbench (not the stump) makes a mortar and pestle from stone with a pickaxe, and with it grinds wheat into flour; and makes the oven', () => {
  for (const key of ['mortar', 'flour', 'oven']) assert.equal(stationRecipe('stump', key), -1, `no ${key} at the stump`)
  assert.ok(stationRecipe('workbench', 'oven') >= 0, 'the oven at the workbench')
  const { room, client } = workshop('MORTAR', { workbench: 1, pickaxe: 1, stone: 4, wheat: 3 })
  const stump = place(room, client, 0, 2, 2)
  const out = STATION_LAYOUT.workbench.output
  const stumpRecipe = (key: string): number => stationRecipe('workbench', key)
  client.command({ k: 'put', id: stump.id, item: itemId('stone'), max: 4 })
  client.command({ k: 'work', id: stump.id, recipe: stumpRecipe('mortar') })
  run(room, [client], 4 * TPS + 10)
  assert.equal(at(room, stump.id).inv.slots[out].item, itemId('mortar'), 'a mortar and pestle')
  client.command({ k: 'take', id: stump.id, item: itemId('mortar'), max: 1 })
  client.command({ k: 'put', id: stump.id, item: itemId('wheat'), max: 3 })
  client.command({ k: 'work', id: stump.id, recipe: stumpRecipe('flour') })
  run(room, [client], 3 * 2 * TPS + 10)
  const done = at(room, stump.id)
  assert.equal(done.inv.slots[STATION_LAYOUT.workbench.tool].item, itemId('mortar'), 'the mortar went in as the tool')
  assert.equal(countOf(client.player.inventory, itemId('pickaxe')), 1, 'and the pickaxe came back out')
  assert.deepEqual([done.inv.slots[out].item, done.inv.slots[out].count], [itemId('flour'), 3])
  assert.deepEqual(differingChunks(room, client), [])
})

test('flour and water mix into dough in an open barrel: four flour and a bucket for each', () => {
  const barrel = createEntity(1, 'barrel', 0, 0, 0, 0) as BarrelEntity
  barrel.liquid = LIQUID_WATER
  barrel.amount = 2
  barrel.inv.slots[BARREL_SOLIDS[0]] = { item: itemId('flour'), count: 10 }
  assert.equal(barrelPlan(barrel).ready, true, 'it does not have to be sealed')
  const recipe = BARREL_RECIPES.find((one) => one.output === itemId('dough'))!
  for (let i = 0; i < 3 * recipe.ticks; i++) stepEntity(barrel)
  assert.deepEqual([barrel.inv.slots[BARREL_OUTPUT].item, barrel.inv.slots[BARREL_OUTPUT].count], [itemId('dough'), 2])
  assert.equal(barrel.inv.slots[BARREL_SOLIDS[0]].count, 2, 'four flour went into each')
  assert.equal(barrel.amount, 0, 'and a bucket of water')
})

test('an oven bakes dough into bread, and cooks twice as fast as a campfire; a campfire will not take dough', () => {
  const { room, client } = workshop('OVEN', { oven: 1, campfire: 1, charcoal: 10, dough: 1, steak: 1 })
  const oven = place(room, client, 0, 2, 2)
  const fire = place(room, client, 1, 5, 2)
  client.command({ k: 'put', id: fire.id, item: itemId('dough'), max: 1 })
  run(room, [client], 3)
  assert.equal(countOf(client.player.inventory, itemId('dough')), 1, 'the campfire did not take the dough')
  client.command({ k: 'put', id: oven.id, item: itemId('charcoal'), max: 10 })
  client.command({ k: 'put', id: oven.id, item: itemId('dough'), max: 1 })
  client.command({ k: 'machine', id: oven.id, action: 'light' })
  run(room, [client], 20 * TPS)
  assert.equal(at(room, oven.id).inv.slots[2].item, itemId('bread'), 'bread')
  // A steak: 8 s at 200 on a campfire, so well under that in a hot oven.
  client.command({ k: 'take', id: oven.id, item: itemId('bread'), max: 1 })
  client.command({ k: 'put', id: oven.id, item: itemId('steak'), max: 1 })
  run(room, [client], 4 * TPS)
  assert.equal(at(room, oven.id).inv.slots[2].item, itemId('cooked-steak'))
  assert.deepEqual(differingChunks(room, client), [])
})

test('a breakfast sandwich is made at the stump from bread, salt, any cooked meat and a fried egg, all four in at once', () => {
  const { room, client } = workshop('SANDWICH', { stump: 1, bread: 2, salt: 2, 'cooked-chicken': 1, 'cooked-steak': 1, 'fried-egg': 2 })
  const stump = place(room, client, 0, 2, 2)
  const index = stationRecipe('stump', 'breakfast-sandwich')
  for (const key of ['bread', 'salt', 'cooked-chicken', 'fried-egg']) client.command({ k: 'put', id: stump.id, item: itemId(key), max: 1 })
  client.command({ k: 'work', id: stump.id, recipe: index })
  run(room, [client], 3 * TPS + 10)
  const out = at(room, stump.id).inv.slots[STATION_LAYOUT.stump.output]
  assert.deepEqual([out.item, out.count], [itemId('breakfast-sandwich'), 1], 'with chicken')
  for (const key of ['bread', 'salt', 'cooked-steak', 'fried-egg']) client.command({ k: 'put', id: stump.id, item: itemId(key), max: 1 })
  client.command({ k: 'work', id: stump.id, recipe: index })
  run(room, [client], 3 * TPS + 10)
  assert.equal(at(room, stump.id).inv.slots[STATION_LAYOUT.stump.output].count, 2, 'and with steak')
  assert.deepEqual(differingChunks(room, client), [])
})

test('a well, made at the workbench from stone, rope, a bucket and planks with no tool, fills an empty bucket with fresh water', () => {
  const recipe = STATION_RECIPES.workbench.find((candidate) => candidate.output === itemId('well'))!
  assert.ok(recipe, 'the workbench makes a well')
  assert.equal(recipe.tool, undefined, 'with no tool')
  assert.deepEqual(new Set(recipe.inputs.map(([item]) => item)), new Set(['stone', 'rope', 'bucket', 'plank'].map(itemId)))
  const { room, client } = workshop('WELL', { well: 1, bucket: 1 })
  const tile = { x: Math.floor(client.player.position.x / 256) + 2, y: Math.floor(client.player.position.y / 256) }
  const well = place(room, client, 0, tile.x, tile.y)
  assert.equal(well.kind, 'well')
  client.command({ k: 'apply', x: tile.x, y: tile.y, slot: 1 })
  run(room, [client], 3)
  assert.equal(client.player.inventory.slots[1].item, itemId('water-bucket'))
  // A full bucket does nothing there.
  client.command({ k: 'apply', x: tile.x, y: tile.y, slot: 1 })
  run(room, [client], 3)
  assert.equal(client.player.inventory.slots[1].item, itemId('water-bucket'))
})

test('a station makes what it includes faster by its speed, but its own recipes take their own time; hand recipes are the "player" station', () => {
  const at = (kind: 'stump' | 'workbench', key: string): number => STATION_RECIPES[kind].find((recipe) => recipe.output === itemId(key))!.ticks
  const hand = RECIPES.find((recipe) => recipe.output === itemId('knife'))!
  assert.equal(hand.ticks, 4 * TPS, 'the knife: 4 s at the player speed of 1')
  assert.equal(at('stump', 'knife'), 2 * TPS, 'at the stump (speed 2): half that')
  assert.equal(at('workbench', 'knife'), Math.round((4 * TPS) / 3), 'at the workbench (speed 3): a third')
  assert.equal(at('stump', 'plank'), 2 * TPS, 'the stump’s own planks take their own 2 s')
  assert.equal(at('workbench', 'plank'), Math.round((2 * TPS * 2) / 3), 'and 2 s × 2 / 3 at the workbench')
  assert.equal(at('stump', 'fence'), 2 * TPS, 'the stump’s own fences take their own 2 s')
  assert.equal(at('workbench', 'fence'), Math.round((2 * TPS * 2) / 3), 'and 2 s × 2 / 3 at the workbench')
  // Nothing is declared twice: each output once in each station's list.
  for (const kind of ['stump', 'workbench'] as const) {
    const outputs = STATION_RECIPES[kind].map((recipe) => recipe.output)
    assert.equal(new Set(outputs).size, outputs.length, `${kind} has each output once`)
  }
})

test('putting a kind into a chest takes it from the ordinary slots, never the food (or ammunition, armour, trash) slot, unless that is the slot clicked', () => {
  const room = new GameRoom('PUTFOOD', 11, { animals: false, plants: false })
  const client = new TestClient(room, 'Stasher')
  run(room, [client], 5)
  const slots = client.player.inventory.slots
  Object.assign(slots[0], { item: itemId('chest'), count: 1 })
  Object.assign(slots[1], { item: itemId('berries'), count: 6 })
  Object.assign(slots[FOOD_SLOT], { item: itemId('berries'), count: 4 })
  const chest = place(room, client, 0, 2, 2)
  // A click on the berries in the inventory: all of that kind, but the food slot is left alone.
  client.command({ k: 'put', id: chest.id, item: itemId('berries'), max: 100, slot: 1 })
  run(room, [client], 3)
  assert.equal(slots[1].count, 0)
  assert.equal(slots[FOOD_SLOT].count, 4, 'the food slot keeps its berries')
  assert.equal(at(room, chest.id).inv.slots.reduce((sum, slot) => sum + (slot.item === itemId('berries') ? slot.count : 0), 0), 6)
  // Store all leaves it too.
  client.command({ k: 'put', id: chest.id, item: 0, max: 100_000 })
  run(room, [client], 3)
  assert.equal(slots[FOOD_SLOT].count, 4)
  // A click on the food slot itself puts those in.
  client.command({ k: 'put', id: chest.id, item: itemId('berries'), max: 4, slot: FOOD_SLOT })
  run(room, [client], 3)
  assert.equal(slots[FOOD_SLOT].count, 0)
  assert.equal(at(room, chest.id).inv.slots.reduce((sum, slot) => sum + (slot.item === itemId('berries') ? slot.count : 0), 0), 10)
})

test('a recipe that takes any of a kind (a breakfast sandwich, any cooked meat) puts in one kind only, so its other ingredients still fit', () => {
  const sandwich = STATION_RECIPES.stump.find((recipe) => recipe.output === itemId('breakfast-sandwich'))!
  // Two of each meat: both kinds would take two of the stump's four input slots, and the egg would not fit.
  const { room, client } = workshop('SANDWICH', { stump: 1, bread: 4, salt: 4, 'cooked-steak': 2, 'cooked-chicken': 3, 'fried-egg': 4 })
  const stump = place(room, client, 0, 2, 2)
  const inputs = oneKindEach('stump', at(room, stump.id).inv as never, client.player.inventory, sandwich.inputs)
  assert.deepEqual(
    inputs.map(([item]) => item),
    [itemId('bread'), itemId('salt'), itemId('cooked-chicken'), itemId('fried-egg')],
    'the meat the player has most of',
  )
  // As the page does for "Craft all": as many as each (one kind) allows, put in, then work.
  const more = Math.min(...inputs.map(([item, need]) => Math.floor(countOf(client.player.inventory, item as number) / need)))
  assert.equal(more, 3)
  for (const [item, need] of inputs) client.command({ k: 'put', id: stump.id, item: item as number, max: need * more })
  client.command({ k: 'work', id: stump.id, recipe: sandwich.index })
  run(room, [client], 3 * sandwich.ticks + 10)
  assert.ok(client.results.every((result) => result.ok), `all went in (${client.results.map((result) => result.why ?? 'ok').join(', ')})`)
  assert.equal(at(room, stump.id).inv.slots[STATION_LAYOUT.stump.output].count, 3, 'three sandwiches')
  // With some of a kind already in the stump, that kind is kept on (if the player has it).
  const left = oneKindEach('stump', { slots: [{ item: 0, count: 0 }, { item: itemId('cooked-steak'), count: 1 }, { item: 0, count: 0 }, { item: 0, count: 0 }, { item: 0, count: 0 }, { item: 0, count: 0 }] } as never, client.player.inventory, sandwich.inputs)
  assert.equal(left[2][0], itemId('cooked-steak'), 'the steak already in it')
})
