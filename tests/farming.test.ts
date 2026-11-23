import assert from 'node:assert/strict'
import test from 'node:test'
import { isAdult, type Animal } from '../apps/server/src/animals.ts'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  STATION_LAYOUT,
  animalDef,
  countOf,
  createEntity,
  CROPS,
  cropIsGrown,
  itemId,
  KEY_RIGHT,
  LEAD_LENGTH,
  PUNCH_COOLDOWN_TICKS,
  ropeForce,
  ropeStep,
  ROPE_HELD,
  ROPE_MAX_SPEED,
  LEAD_BREAK,
  PLAYER_MASS,
  PLAYER_SPEED,
  SUB,
  TPS,
  FactoryWorld,
  FENCE_E,
  fenceMask,
  GATE_AUTO,
  GATE_OPEN,
  GATE_SHUT,
  KEY_DOWN,
  PLAYER_HALF_SIZE,
  solidIn,
  stepPlayer,
  type Entity,
  WEAPONS,
  STATION_RECIPES,
  RECIPES,
  biomeSiteAt,
  islandChunks,
  isSandAt,
  canGrowAt,
  isSeaAt,
  ANIMALS,
  chunkOfTile,
  chunkDistance,
  SUBSCRIBE_RADIUS,
} from '../packages/shared/src/index.ts'
import { differingChunks, run, TestClient } from './helpers.ts'

const center = (x: number, y: number): { x: number; y: number } => ({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })

function entitiesOf(room: GameRoom, kind: string): Entity[] {
  return room.world.chunkIds.flatMap((id) => [...room.world.chunk(id)!.entities]).filter((entity) => entity.kind === kind)
}

// A room with no wild animals turning up, a player at the spawn, and what was asked for in its inventory.
// With `plants: false`, the ground is bare (nothing in the way).
function farm(code: string, items: Record<string, number> = {}, options: { animals?: boolean; plants?: boolean } = {}): { room: GameRoom; client: TestClient } {
  const room = new GameRoom(code, 11, { dropsOnGround: false, wildAnimals: false, animals: options.animals ?? true, plants: options.plants ?? true })
  const client = new TestClient(room, 'Farmer')
  run(room, [client], 5)
  Object.entries(items).forEach(([key, count], slot) => (client.player.inventory.slots[slot] = { item: itemId(key), count }))
  return { room, client }
}

test('grass grows in clumps; pulled up by hand it sometimes gives a wheat seed, and cut with a knife it gives hay', () => {
  const { room, client } = farm('GRASS', {}, { animals: false })
  const tufts = entitiesOf(room, 'grass')
  assert.ok(tufts.length > 100, `there is grass (${tufts.length})`)
  let pulled = 0
  for (const tuft of tufts.slice(0, 40)) {
    client.player.position = center(tuft.x, tuft.y)
    client.command({ k: 'punch', id: tuft.id, slot: 0 })
    run(room, [client], PUNCH_COOLDOWN_TICKS)
    pulled++
  }
  run(room, [client], 5)
  const seeds = countOf(client.player.inventory, itemId('wheat-seed'))
  assert.ok(seeds > 0 && seeds < pulled, `${seeds} seeds from ${pulled} tufts`)
  client.player.inventory.slots[5] = { item: itemId('knife'), count: 1 }
  for (const tuft of tufts.slice(40, 45)) {
    client.player.position = center(tuft.x, tuft.y)
    client.command({ k: 'punch', id: tuft.id, slot: 5 })
    run(room, [client], PUNCH_COOLDOWN_TICKS)
  }
  run(room, [client], 5)
  assert.equal(countOf(client.player.inventory, itemId('hay')), 5)
  assert.deepEqual(differingChunks(room, client), [])
})

test('a seed sown in a garden plot grows, and breaking it when grown gives the crop and more seeds; the plot stays', () => {
  const { room, client } = farm('PLOT', { 'garden-plot': 1, 'wheat-seed': 2 })
  const wheat = CROPS.find((crop) => crop.key === 'wheat')!
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const plot = room.world.entityAt(2, 2)!
  assert.equal(plot.kind, 'plot')
  client.command({ k: 'place', x: 2, y: 2, slot: 1 })
  client.command({ k: 'place', x: 2, y: 2, slot: 1 })
  run(room, [client], 5)
  assert.deepEqual(client.results.slice(-2).map((result) => result.why ?? 'ok'), ['ok', 'notEmpty'])
  for (let i = 0; i < 300 && !cropIsGrown(room.world.entity(plot.id) as never); i++) run(room, [client], 100)
  assert.ok(cropIsGrown(room.world.entity(plot.id) as never), 'it grew')
  assert.deepEqual(differingChunks(room, client), [], 'the page grew it the same')
  client.command({ k: 'punch', id: plot.id, slot: 3 })
  run(room, [client], PUNCH_COOLDOWN_TICKS)
  const inventory = client.player.inventory
  const produce = countOf(inventory, itemId('wheat'))
  const seeds = countOf(inventory, itemId('wheat-seed')) - 1
  assert.ok(produce >= wheat.produceMin && produce <= wheat.produceMax, `${produce} wheat`)
  assert.ok(seeds >= wheat.seedsMin && seeds <= wheat.seedsMax, `${seeds} seeds back`)
  const after = room.world.entity(plot.id)
  assert.ok(after?.kind === 'plot' && after.crop === 0, 'the plot is still there, empty')
  // An empty plot does not come up by hand; an axe takes it down and gives it back.
  client.command({ k: 'punch', id: plot.id, slot: 3 })
  run(room, [client], PUNCH_COOLDOWN_TICKS)
  assert.equal(client.results.at(-1)?.why, 'needsAxe')
  client.player.inventory.slots[4] = { item: itemId('axe'), count: 1 }
  client.command({ k: 'punch', id: plot.id, slot: 4 })
  run(room, [client], PUNCH_COOLDOWN_TICKS)
  assert.equal(room.world.entity(plot.id), undefined, 'one hit with an axe')
  assert.equal(countOf(client.player.inventory, itemId('garden-plot')), 1)
  assert.deepEqual(differingChunks(room, client), [])
})

test('the chopping stump makes planks from logs with an axe, and keeps going while there are logs', () => {
  const { room, client } = farm('STUMP', { stump: 1, axe: 1, log: 3, acorn: 2 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const stump = room.world.entityAt(2, 2)!
  assert.equal(stump.kind, 'stump')
  const planks = STATION_RECIPES.stump.find((recipe) => recipe.output === itemId('plank'))!
  client.command({ k: 'work', id: stump.id, recipe: planks.index })
  client.command({ k: 'put', id: stump.id, item: itemId('log'), max: 3 })
  client.command({ k: 'put', id: stump.id, item: itemId('acorn'), max: 2 })
  client.command({ k: 'work', id: stump.id, recipe: planks.index })
  run(room, [client], 5)
  assert.deepEqual(client.results.slice(1).map((result) => result.why ?? 'ok'), ['noWork', 'ok', 'nothing', 'ok'])
  assert.equal(countOf(client.player.inventory, itemId('axe')), 0, 'the axe went into its tool slot')
  run(room, [client], 3 * 2 * TPS + 10)
  const done = room.world.entity(stump.id)
  assert.ok(done?.kind === 'stump')
  assert.deepEqual(
    done.inv.slots.map((slot) => [slot.item, slot.count]),
    [
      [itemId('axe'), 1],
      [0, 0],
      [itemId('plank'), 6],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  )
  assert.equal(done.active, 0, 'it stopped when the logs ran out')
  assert.deepEqual(differingChunks(room, client), [], 'the page worked them out the same')
  client.command({ k: 'take', id: stump.id, item: itemId('plank'), max: 100 })
  run(room, [client], 5)
  assert.equal(countOf(client.player.inventory, itemId('plank')), 6)
})

test('animals cannot walk through fences, nor through a gate while nobody is at it', () => {
  const { room, client } = farm('FENCE')
  // A pen from -4 to 4 with a gate in it, and the player well away from it.
  for (let i = -4; i <= 4; i++) {
    for (const [x, y] of [[i, -4], [i, 4], [-4, i], [4, i]]) {
      if (room.world.entityAt(x, y)) continue
      room.world.addEntity(createEntity(50_000 + (x + 10) * 30 + (y + 10), x === 0 && y === 4 ? 'gate' : 'fence', x, y, 0, 0))
    }
  }
  client.player.position = center(30, 30)
  const cow = room.animals!.spawn(animalDef('cow'), SUB / 2, SUB / 2)
  const chicken = room.animals!.spawn(animalDef('chicken'), SUB / 2, SUB / 2)
  for (const animal of [cow, chicken]) animal.hunger = 1000
  for (let tick = 0; tick < 60 * TPS; tick++) {
    room.step()
    for (const animal of [cow, chicken]) {
      // Fences are solid only along their rails, through the middles of their tiles: from -3.375 to 4.375 is inside.
      const inside = (units: number): boolean => units / SUB > -3.375 && units / SUB < 4.375
      assert.ok(inside(animal.x) && inside(animal.y), `the ${animal.def.kind} stayed in (${animal.x / SUB}, ${animal.y / SUB})`)
    }
  }
})

test('a hungry animal finds grass and grazes it away', () => {
  const { room, client } = farm('GRAZE')
  const tuft = entitiesOf(room, 'grass')[0]
  const cow = room.animals!.spawn(animalDef('cow'), tuft.x * SUB + 3 * SUB, tuft.y * SUB + SUB / 2)
  cow.hunger = 900
  // A player nearby, so the animals there are run (see `isActive`).
  client.player.position = { x: tuft.x * SUB, y: (tuft.y + 6) * SUB }
  for (let i = 0; i < 40 && cow.hunger >= 800; i++) run(room, [client], 30)
  assert.ok(cow.hunger < 800, `it ate (hunger ${cow.hunger})`)
})

test('well-fed animals of both sexes breed; the baby gets about the average of their stats and grows up', () => {
  const { room, client } = farm('BREED', { 'feed-box': 1, wheat: 10 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const feeder = room.world.entityAt(2, 2)!
  client.command({ k: 'put', id: feeder.id, item: itemId('wheat'), max: 10 })
  run(room, [client], 5)
  const def = animalDef('cow')
  const growth = def.stats.findIndex((stat) => stat.key === 'growth')
  const meat = def.stats.findIndex((stat) => stat.key === 'meat')
  const statsOf = (meatValue: number): number[] => def.stats.map((stat, i) => (i === meat ? meatValue : i === growth ? 60 : stat.base))
  const mother = room.animals!.spawn(def, center(4, 4).x, center(4, 4).y, { sex: 'f', stats: statsOf(6) })
  const father = room.animals!.spawn(def, center(0, 4).x, center(0, 4).y, { sex: 'm', stats: statsOf(2) })
  mother.hunger = father.hunger = 500
  let baby: Animal | undefined
  for (let i = 0; i < 100 && !baby; i++) {
    run(room, [client], 30)
    baby = room.animals!.list().find((animal) => animal !== mother && animal !== father)
  }
  assert.ok(baby, 'a baby was born')
  assert.ok(!isAdult(baby), 'it is a baby')
  assert.ok(baby.stats[meat] >= 3.7 && baby.stats[meat] <= 4.3, `its meat stat ${baby.stats[meat]} is about the average of 6 and 2`)
  const fed = room.world.entity(feeder.id)
  assert.ok(fed?.kind === 'feeder' && countOf(fed.inv, itemId('wheat')) === 8, 'each parent ate from the feed box')
  assert.ok(client.animals.get(baby.id), 'the page was told about it')
  run(room, [client], baby.stats[growth] * TPS + 30)
  assert.ok(isAdult(baby), 'it grew up')
  assert.equal(client.animals.get(baby.id)?.growth, 100)
})

test('a rope leads an animal: it follows the player, and its rope can be taken off again', () => {
  const { room, client } = farm('ROPE', { rope: 1 }, { plants: false })
  const cow = room.animals!.spawn(animalDef('cow'), center(2, 0).x, center(2, 0).y)
  client.command({ k: 'interact', animal: cow.id, slot: 0 })
  run(room, [client], 5)
  assert.equal(cow.leader, client.player.id)
  assert.equal(countOf(client.player.inventory, itemId('rope')), 0)
  const startX = cow.x
  // Walk right for three seconds, an input a tick.
  for (let n = 1; n <= 90; n++) {
    room.receiveInputs(client.player, [[n, KEY_RIGHT]])
    run(room, [client], 1)
  }
  assert.ok(cow.x - startX > 4 * SUB, `the cow was pulled along (${(cow.x - startX) / SUB} tiles)`)
  assert.ok(Math.hypot(cow.x - client.player.position.x, cow.y - client.player.position.y) < LEAD_LENGTH + SUB, 'and kept close')
  run(room, [client], 70)
  client.command({ k: 'interact', animal: cow.id, slot: 0 })
  run(room, [client], 5)
  assert.equal(cow.leader, 0)
  assert.equal(countOf(client.player.inventory, itemId('rope')), 1)
})

test('a rope is a spring: slack up to its length, then pulling both ends together as hard, the lighter one sped up more', () => {
  const player = { x: 0, y: 0 }
  const animal = { x: LEAD_LENGTH + SUB, y: 0 }
  assert.deepEqual(ropeForce(player, { x: LEAD_LENGTH, y: 0 }), { x: 0, y: 0 }, 'slack')
  const onPlayer = ropeForce(player, animal)
  const onAnimal = ropeForce(animal, player)
  assert.ok(onPlayer.x > 0 && Math.abs(onPlayer.x + onAnimal.x) < 1e-9, 'as hard both ways')
  const still = { x: 0, y: 0 }
  const deer = ropeStep(still, onAnimal, animalDef('deer').mass)
  const cow = ropeStep(still, onAnimal, animalDef('cow').mass)
  assert.ok(Math.abs(deer.x) < Math.abs(cow.x), 'a deer, heavier, is sped up less than a cow')
  assert.ok(ropeStep(still, onPlayer, PLAYER_MASS).x > Math.abs(deer.x), 'and a player more than a deer')
})

test('on a rope, a running deer drags a standing player along faster than they walk, and anything put on from far off is drawn in without jumping or sliding on past', () => {
  // Two ends on a rope, a tick at a time, as the server does it: each moves by its rope speed (and `run`, its own).
  const together = (start: number, mass: number, run: number, ticks: number) => {
    const a = { x: 0, y: 0 }
    const b = { x: start, y: 0 }
    let va = { x: 0, y: 0 }
    let vb = { x: 0, y: 0 }
    let fastest = 0
    let nearest = Number.POSITIVE_INFINITY
    for (let tick = 0; tick < ticks; tick++) {
      b.x += run
      const force = ropeForce(b, a)
      vb = ropeStep(vb, force, mass)
      va = ropeStep(va, { x: -force.x, y: -force.y }, PLAYER_MASS)
      b.x += Math.round(vb.x)
      a.x += Math.round(va.x)
      fastest = Math.max(fastest, Math.abs(Math.round(va.x)), Math.abs(Math.round(vb.x)))
      nearest = Math.min(nearest, b.x - a.x)
    }
    return { a, va, b, fastest, nearest }
  }
  const deer = animalDef('deer')
  const fleeing = Math.round(deer.speed * deer.fleePace)
  const dragged = together(LEAD_LENGTH, deer.mass, fleeing, 4 * TPS)
  assert.ok(dragged.va.x > PLAYER_SPEED, `dragged along at ${dragged.va.x.toFixed(0)} units a tick, walking is ${PLAYER_SPEED}`)
  assert.ok(dragged.b.x - dragged.a.x < LEAD_BREAK, 'without the rope snapping')
  for (const kind of ['chicken', 'cow', 'deer']) {
    const drawn = together(8 * SUB, animalDef(kind).mass, 0, 3 * TPS)
    assert.ok(drawn.fastest <= ROPE_MAX_SPEED, `${kind}: never faster than ROPE_MAX_SPEED`)
    assert.ok(drawn.nearest > LEAD_LENGTH - SUB, `${kind}: not on past the other (${(drawn.nearest / SUB).toFixed(2)} tiles)`)
    assert.ok(drawn.b.x - drawn.a.x <= LEAD_LENGTH + 2, `${kind}: drawn in to the rope's length`)
  }
})

test('a knife kills an animal in a hit or two; a grown one drops its meat and the rest, a baby nothing', () => {
  const { room, client } = farm('KILL', { knife: 1 })
  const def = animalDef('chicken')
  const chicken = room.animals!.spawn(def, center(2, 1).x, center(2, 1).y)
  // Attacks it with the knife from beside it, wherever it has run to, until it falls.
  const attack = (id: number): void => {
    const animal = room.animals!.get(id)!
    client.player.position = { x: animal.x - SUB / 2, y: animal.y }
    client.command({ k: 'attack', slot: 0, x: animal.x, y: animal.y })
    run(room, [client], WEAPONS.get('knife')!.cooldown + 1)
  }
  let hits = 0
  while (room.animals!.get(chicken.id) && hits < 10) {
    attack(chicken.id)
    hits++
  }
  assert.equal(hits, Math.ceil(def.hp / Math.max(1, WEAPONS.get('knife')!.damage - def.armor)))
  assert.ok(countOf(client.player.inventory, itemId('raw-chicken')) >= 1)
  const feathers = countOf(client.player.inventory, itemId('feather'))
  assert.ok(feathers >= 1 && feathers <= 3)
  const chick = room.animals!.spawn(def, center(2, 1).x, center(2, 1).y, { baby: true })
  const before = countOf(client.player.inventory, itemId('feather'))
  while (room.animals!.get(chick.id)) attack(chick.id)
  assert.equal(countOf(client.player.inventory, itemId('feather')), before, 'a chick drops nothing')
})

test('a cow is milked with a right click holding a bucket, which it fills, one bucket a time; a hen lays eggs on the ground', () => {
  const { room, client } = farm('MILK')
  const cow = room.animals!.spawn(animalDef('cow'), center(2, 1).x, center(2, 1).y, { sex: 'f' })
  cow.milk = 2
  client.player.inventory.slots[0] = { item: itemId('bucket'), count: 1 }
  client.command({ k: 'interact', animal: cow.id, slot: 0 })
  client.command({ k: 'interact', animal: cow.id, slot: 0 })
  run(room, [client], 5)
  assert.equal(countOf(client.player.inventory, itemId('milk')), 1, 'the bucket is filled')
  assert.equal(countOf(client.player.inventory, itemId('bucket')), 0, 'no bucket comes from nowhere')
  assert.equal(cow.milk, 1, 'she keeps the rest for another bucket')
  assert.deepEqual(client.results.map((result) => result.why ?? 'ok'), ['ok', 'nothingToDo'], 'a full bucket cannot be filled')
  // Poured into a barrel, the milk leaves the bucket empty; drawn out again, it fills it, with no bucket to spare;
  // dumped on the ground, the bucket is left empty.
  client.player.inventory.slots[1] = { item: itemId('barrel'), count: 1 }
  client.command({ k: 'place', x: 1, y: -2, slot: 1 })
  client.command({ k: 'apply', x: 1, y: -2, slot: 0 })
  run(room, [client], 3)
  assert.equal(client.player.inventory.slots[0].item, itemId('bucket'), 'poured out')
  client.command({ k: 'apply', x: 1, y: -2, slot: 0 })
  run(room, [client], 3)
  assert.equal(client.player.inventory.slots[0].item, itemId('milk'), 'drawn out')
  assert.equal(countOf(client.player.inventory, itemId('bucket')), 0)
  client.command({ k: 'apply', x: -1, y: -2, slot: 0 })
  run(room, [client], 3)
  assert.equal(client.player.inventory.slots[0].item, itemId('bucket'), 'dumped')
  assert.deepEqual(client.results.slice(2).map((result) => result.why ?? 'ok'), ['ok', 'ok', 'ok', 'ok'])
  const chickens = animalDef('chicken')
  const eggTime = chickens.stats.findIndex((stat) => stat.key === 'eggTime')
  const hen = room.animals!.spawn(chickens, center(-3, -3).x, center(-3, -3).y, { sex: 'f' })
  hen.stats[eggTime] = 30
  client.player.position = center(20, 20)
  run(room, [client], 30 * TPS * 2 + 10)
  assert.ok(room.world.allDrops().some((drop) => drop.item === itemId('egg')), 'an egg was laid')
})

test('wild herds turn up by themselves, near players, and pages are told what they are', () => {
  const room = new GameRoom('WILD', 11)
  const client = new TestClient(room, 'Watcher')
  run(room, [client], 50 * TPS)
  assert.ok(room.animals!.all.size > 0, 'animals spawned')
  const near = room.animals!.inChunks(client.player.chunks)
  assert.ok(near.length > 0, 'some near the player')
  for (const animal of near) {
    const info = client.animals.get(animal.id)
    assert.ok(info, 'the page knows of it')
    assert.equal(info.kind, animal.def.kind)
    assert.deepEqual(info.stats, animal.stats)
  }
})

test('a fence is solid only where it is drawn: a lone post can be passed close by, and it joins its neighbours', () => {
  const world = new FactoryWorld()
  world.addEntity(createEntity(1, 'fence', 3, 0, 0, 0))
  const solid = solidIn(world)
  const walkDown = (x: number): number => {
    let position = { x, y: -2 * SUB }
    for (let i = 0; i < 30; i++) position = stepPlayer(position, KEY_DOWN, solid)
    return position.y
  }
  assert.ok(walkDown(3 * SUB + 5) > 2 * SUB, 'past the side of the tile, clear of the post')
  assert.ok(walkDown(3 * SUB + SUB / 2) < SUB / 2, 'not through the post')
  world.addEntity(createEntity(2, 'fence', 4, 0, 0, 0))
  assert.deepEqual(fenceMask((x, y) => world.entityAt(x, y)?.kind, 3, 0), FENCE_E)
  assert.ok(walkDown(4 * SUB - 10) < SUB / 2, 'not through the rails between two fences')
})

test('what a player put down only comes down to an axe', () => {
  const { room, client } = farm('AXE', { fence: 1, axe: 1 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const fence = room.world.entityAt(2, 2)!
  client.command({ k: 'punch', id: fence.id, slot: 5 })
  run(room, [client], PUNCH_COOLDOWN_TICKS)
  assert.equal(client.results.at(-1)?.why, 'needsAxe')
  for (let i = 0; i < 5 && room.world.entity(fence.id); i++) {
    client.command({ k: 'punch', id: fence.id, slot: 1 })
    run(room, [client], PUNCH_COOLDOWN_TICKS)
  }
  assert.equal(room.world.entity(fence.id), undefined)
  assert.equal(countOf(client.player.inventory, itemId('fence')), 1)
})

test('a stump only works while someone is at it, and makes rope from fiber with no tool', () => {
  const { room, client } = farm('ATIT', { stump: 1, fiber: 9 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const stump = room.world.entityAt(2, 2)!
  const rope = STATION_RECIPES.stump.find((recipe) => recipe.output === itemId('rope'))!
  client.command({ k: 'put', id: stump.id, item: itemId('fiber'), max: 9 })
  client.command({ k: 'work', id: stump.id, recipe: rope.index })
  run(room, [client], 2 * TPS + 10)
  const at = (): Entity => room.world.entity(stump.id)!
  assert.ok(at().kind === 'stump')
  const outputOf = (): number => (at() as { inv: { slots: Array<{ count: number }> } }).inv.slots[2].count
  assert.equal(outputOf(), 1, 'one rope while the player was at it')
  // Walking off (closing it) stops it, keeping how far it had got.
  client.command({ k: 'use', id: 0 })
  run(room, [client], 3 * TPS)
  assert.equal((at() as { active: number }).active, 0)
  assert.equal(outputOf(), 1, 'nothing more while nobody was at it')
  client.command({ k: 'work', id: stump.id, recipe: rope.index })
  run(room, [client], 4 * TPS + 10)
  assert.equal(outputOf(), 3, 'and it carries on when they come back')
  assert.deepEqual(differingChunks(room, client), [])
})

test('a right click opens or shuts a gate for good; a shut one opens by itself again once a player walks over it', () => {
  const { room, client } = farm('GATE', { gate: 1 })
  client.command({ k: 'place', x: 3, y: 0, slot: 0 })
  run(room, [client], 5)
  const gate = room.world.entityAt(3, 0)!
  const mode = (): number => (room.world.entity(gate.id) as { mode: number }).mode
  assert.equal(mode(), GATE_AUTO)
  client.command({ k: 'toggle', id: gate.id })
  run(room, [client], 5)
  assert.equal(mode(), GATE_OPEN, 'shut while the player is away, so a click opens it')
  client.command({ k: 'toggle', id: gate.id })
  run(room, [client], 5)
  assert.equal(mode(), GATE_SHUT)
  client.player.position = center(3, 0)
  run(room, [client], 3)
  assert.equal(mode(), GATE_AUTO)
  assert.deepEqual(differingChunks(room, client), [])
})

test('an animal is tied to a fence (the fence right clicked, then it): held there, saved tied, and untied at the fence', () => {
  const { room, client } = farm('TIE', { rope: 1 }, { plants: false })
  const fence = createEntity(61_000, 'fence', 1, 0, 0, 0)
  room.world.addEntity(fence)
  const post = center(1, 0)
  // On the player's rope first: tying it moves that rope to the fence (no other rope needed).
  const cow = room.animals!.spawn(animalDef('cow'), center(3, 1).x, center(3, 1).y)
  client.command({ k: 'interact', animal: cow.id, slot: 0 })
  run(room, [client], 3)
  assert.equal(cow.leader, client.player.id)
  client.command({ k: 'tie', fence: fence.id, animal: cow.id })
  run(room, [client], 3)
  assert.equal(cow.post, fence.id)
  assert.equal(cow.leader, 0)
  assert.equal(countOf(client.player.inventory, itemId('rope')), 0)
  // A second animal: no rope left, and the fence holds one anyway.
  const chicken = room.animals!.spawn(animalDef('chicken'), center(2, 2).x, center(2, 2).y)
  client.command({ k: 'tie', fence: fence.id, animal: chicken.id })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'postTaken')
  assert.equal(chicken.post, 0)
  // Dragged off, it is pulled back to the fence.
  cow.x = post.x + 7 * SUB
  run(room, [client], 3)
  assert.ok(Math.hypot(cow.x - post.x, cow.y - post.y) <= ROPE_HELD + 2, `held by the fence (${Math.round(Math.hypot(cow.x - post.x, cow.y - post.y))})`)
  // It stays where it is tied as time goes by, drawn in to the rope's length.
  run(room, [client], 300)
  assert.ok(Math.hypot(cow.x - post.x, cow.y - post.y) <= LEAD_LENGTH + SUB / 4, 'still by the fence')
  // Saved tied.
  const loaded = GameRoom.fromSave(room.exportSave(0))
  assert.equal(loaded.animals!.list().find((animal) => animal.id === cow.id)?.post, fence.id)
  // Untied at the fence: the rope comes back.
  client.command({ k: 'untie', fence: fence.id })
  run(room, [client], 3)
  assert.equal(cow.post, 0)
  assert.equal(countOf(client.player.inventory, itemId('rope')), 1)
  // With a rope in the inventory (not on the animal), it is tied with that.
  client.command({ k: 'tie', fence: fence.id, animal: chicken.id })
  run(room, [client], 3)
  assert.equal(chicken.post, fence.id)
  assert.equal(countOf(client.player.inventory, itemId('rope')), 0)
  // The fence taken down, the rope falls off.
  room.world.removeEntity(fence.id)
  run(room, [client], 3)
  assert.equal(chicken.post, 0)
})

test('an animal on a rope still cannot go through a shut gate', () => {
  const { room, client } = farm('LEADGATE', { rope: 1, gate: 1 }, { plants: false })
  // A wall of fences across x = 3, with a gate in it at 3, 0, shut.
  for (let y = -6; y <= 6; y++) if (y !== 0) room.world.addEntity(createEntity(60_000 + y, 'fence', 3, y, 0, 0))
  client.command({ k: 'place', x: 3, y: 0, slot: 1 })
  run(room, [client], 5)
  const gate = room.world.entityAt(3, 0)!
  client.command({ k: 'toggle', id: gate.id })
  client.command({ k: 'toggle', id: gate.id })
  const cow = room.animals!.spawn(animalDef('cow'), center(1, 0).x, center(1, 0).y)
  client.command({ k: 'interact', animal: cow.id, slot: 0 })
  run(room, [client], 5)
  assert.equal((room.world.entity(gate.id) as { mode: number }).mode, GATE_SHUT)
  // The player walks through (players walk through gates) and on; the cow is held at the gate. The player walking over
  // the gate sets it opening by itself again, but it is shut again once the player is past it.
  for (let n = 1; n <= 60; n++) {
    room.receiveInputs(client.player, [[n, KEY_RIGHT]])
    run(room, [client], 1)
  }
  assert.ok(cow.x < 3 * SUB + SUB / 2, `the cow is still on its side (${cow.x / SUB})`)
})

test('animals and players on top of each other are pushed apart', () => {
  const { room, client } = farm('CROWD', {}, { plants: false })
  const cow = room.animals!.spawn(animalDef('cow'), center(3, 3).x, center(3, 3).y)
  const other = room.animals!.spawn(animalDef('cow'), center(3, 3).x, center(3, 3).y)
  client.player.position = center(-3, -3)
  const second = new TestClient(room, 'Second')
  second.player.position = { ...client.player.position }
  run(room, [client, second], 30)
  assert.ok(Math.hypot(cow.x - other.x, cow.y - other.y) >= animalDef('cow').halfSize * 2 - 2, 'the cows moved apart')
  const players = Math.hypot(client.player.position.x - second.player.position.x, client.player.position.y - second.player.position.y)
  assert.ok(players >= PLAYER_HALF_SIZE * 2 - 2, `the players moved apart (${players})`)
  client.player.position = { x: cow.x, y: cow.y }
  run(room, [client, second], 30)
  assert.ok(Math.hypot(cow.x - client.player.position.x, cow.y - client.player.position.y) >= PLAYER_HALF_SIZE + animalDef('cow').halfSize - 2)
})

test('a station swaps in the tool its recipe needs: with a knife in the stump, picking planks puts the axe in and gives the knife back', () => {
  const { room, client } = farm('SWAP', { stump: 1, knife: 1, axe: 1, log: 4 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const stump = room.world.entityAt(2, 2)!
  client.command({ k: 'put', id: stump.id, item: itemId('knife'), max: 1 })
  client.command({ k: 'put', id: stump.id, item: itemId('log'), max: 2 })
  run(room, [client], 3)
  const planks = STATION_RECIPES.stump.find((recipe) => recipe.output === itemId('plank'))!
  client.command({ k: 'work', id: stump.id, recipe: planks.index })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.ok, true)
  const inv = (room.world.entity(stump.id) as { inv: { slots: Array<{ item: number; count: number }> } }).inv
  assert.equal(inv.slots[STATION_LAYOUT.stump.tool].item, itemId('axe'), 'the axe in its tool slot')
  assert.equal(countOf(client.player.inventory, itemId('knife')), 1, 'the knife back with the player')
  run(room, [client], planks.ticks + 5)
  assert.ok(inv.slots[2].item === itemId('plank') || (room.world.entity(stump.id) as typeof stump & { inv: typeof inv }).inv.slots[2].item === itemId('plank'), 'planks, not a spear')
  // The workbench and the club come from the stump now; the workbench, campfire and sleeping bag are not made by hand.
  for (const key of ['workbench', 'campfire', 'sleeping-bag', 'club']) assert.ok(STATION_RECIPES.stump.some((recipe) => recipe.output === itemId(key)), `${key} at the stump`)
  for (const key of ['workbench', 'campfire', 'sleeping-bag']) assert.ok(!RECIPES.some((recipe) => recipe.output === itemId(key)), `${key} not by hand`)
})

// Whether a chunk was grown but nothing grew in it (a strip of coast), so the world does not hold it.
const generatedEmpty = (room: GameRoom, chunk: number): boolean =>
  (room as unknown as { generated: Map<number, { plants: number; flint: number }> }).generated.get(chunk)?.plants === 0

test('a new world is grown whole and stocked: each island has about its population of each kind that lives there', () => {
  const room = new GameRoom('STOCKED', 11)
  for (const chunk of islandChunks(room.terrain)) assert.ok(room.world.hasChunk(chunk) || generatedEmpty(room, chunk), `chunk ${chunk} grown`)
  for (const site of room.terrain.sites) {
    const area = Math.PI * site.radius * site.radius
    for (const def of ANIMALS.filter((kind) => kind.population > 0 && kind.biomes.includes(site.biome.key))) {
      const wanted = Math.round((def.population * area) / 10_000)
      const have = room.animals!.list().filter((animal) => animal.def === def && biomeSiteAt(room.terrain, Math.floor(animal.x / SUB), Math.floor(animal.y / SUB)) === site).length
      assert.ok(have >= wanted * 0.7 && have <= wanted + def.herd[1], `${site.biome.key}: ${have} ${def.kind}, about ${wanted}`)
    }
  }
})

test('a kind killed off comes back on the island a player is on, well away from them', () => {
  const room = new GameRoom('COMEBACK', 11)
  const client = new TestClient(room, 'Hunter')
  run(room, [client], 2)
  const animals = room.animals!
  for (const chicken of animals.list().filter((animal) => animal.def.kind === 'chicken')) animals.remove(chicken.id)
  const context = (room as unknown as { animalContext(tick: number): unknown }).animalContext(room.tick)
  for (let i = 0; i < 20; i++) animals.populate(context as never)
  const chickens = animals.list().filter((animal) => animal.def.kind === 'chicken')
  assert.ok(chickens.length > 0, 'chickens are back')
  for (const chicken of chickens) {
    const away = Math.hypot(chicken.x - client.player.position.x, chicken.y - client.player.position.y) / SUB
    assert.ok(away >= 38, `out of sight (${away.toFixed(0)} tiles off)`)
  }
})

test('animals far from every player wait as they are, but those on a farm (by something built) go on', () => {
  const room = new GameRoom('ASLEEP', 11, { wildAnimals: false })
  const client = new TestClient(room, 'Farmer')
  run(room, [client], 2)
  // The middle of the mountains' island, well away from the player (more than ACTIVE_RADIUS chunks).
  const mountains = room.terrain.sites[1]
  const far = { x: mountains.x, y: mountains.y }
  const playerChunk = chunkOfTile(Math.floor(client.player.position.x / SUB), Math.floor(client.player.position.y / SUB))
  assert.ok(chunkDistance(chunkOfTile(far.x, far.y), playerChunk) > SUBSCRIBE_RADIUS + 1, 'far off')
  const cow = room.animals!.spawn(animalDef('cow'), center(far.x, far.y).x, center(far.x, far.y).y)
  const before = { x: cow.x, y: cow.y, age: cow.age }
  run(room, [client], 5 * TPS)
  assert.deepEqual({ x: cow.x, y: cow.y, age: cow.age }, before, 'it waits')
  // A feed box put down by it (as a farm would have): it goes on.
  room.world.addEntity(createEntity(88_001, 'feeder', far.x + 3, far.y, 0, 0))
  run(room, [client], 3 * TPS)
  assert.ok(cow.age > before.age, 'now it is run')
})

test('a crowded farm still breeds: there is no limit on how many of a kind can be together', () => {
  const { room, client } = farm('CROWDED')
  const def = animalDef('cow')
  const cows: Animal[] = []
  for (let i = 0; i < 20; i++) {
    const cow = room.animals!.spawn(def, center(2 + (i % 5), 2 + Math.floor(i / 5)).x, center(2 + (i % 5), 2 + Math.floor(i / 5)).y, { sex: i % 2 === 0 ? 'f' : 'm' })
    cows.push(cow)
  }
  const feed = (): void => {
    for (const cow of cows) {
      cow.age = 1_000_000
      cow.fedUntil = room.tick + 60 * TPS
    }
  }
  feed()
  for (let i = 0; i < 40 && room.animals!.list().length === 20; i++) {
    feed()
    run(room, [client], 30)
  }
  assert.ok(room.animals!.list().length > 20, `a calf was born among ${cows.length} cows (${room.animals!.list().length} now)`)
})

test('pulled grass gives grass seed too, which plants grass; planted by a pen, it spreads there (wild grass keeps clear of what is built)', () => {
  const { room, client } = farm('LAWN', {}, { animals: false })
  // Pulling: some grass seed.
  const tufts = entitiesOf(room, 'grass')
  for (const tuft of tufts.slice(0, 30)) {
    client.player.position = center(tuft.x, tuft.y)
    client.command({ k: 'punch', id: tuft.id, slot: 0 })
    run(room, [client], PUNCH_COOLDOWN_TICKS)
  }
  run(room, [client], 5)
  assert.ok(countOf(client.player.inventory, itemId('grass-seed')) > 0, 'grass seed')
  // A pen out in the forest, cleared, a fence by it, and grass planted in it.
  const forest = room.terrain.sites[0]
  const pen = { x: forest.x + 20, y: forest.y + 20 }
  for (let y = pen.y - 6; y <= pen.y + 6; y++) for (let x = pen.x - 6; x <= pen.x + 6; x++) {
    const there = room.world.entityAt(x, y)
    if (there) room.world.removeEntity(there.id)
  }
  room.world.addEntity(createEntity(77_001, 'fence', pen.x - 2, pen.y, 0, 0))
  client.player.position = center(pen.x, pen.y + 2)
  client.player.inventory.slots[3] = { item: itemId('grass-seed'), count: 1 }
  client.command({ k: 'place', x: pen.x, y: pen.y, slot: 3 })
  run(room, [client], 3)
  assert.equal(room.world.entityAt(pen.x, pen.y)?.kind, 'grass', 'planted')
  const around = (): number => {
    let count = 0
    for (let y = pen.y - 3; y <= pen.y + 3; y++) for (let x = pen.x - 3; x <= pen.x + 3; x++) if (room.world.entityAt(x, y)?.kind === 'grass') count++
    return count
  }
  run(room, [client], 10 * 15 * TPS)
  assert.ok(around() > 1, `it spread by the fence (${around()} tufts)`)
})

test('a hungry chicken goes to its seed box over grass nearer to it, and does not stay stuck on grass it cannot get to', () => {
  const { room, client } = farm('COOP', { 'feed-box': 1, 'wheat-seed': 10 }, { plants: false })
  client.command({ k: 'place', x: 6, y: 0, slot: 0 })
  run(room, [client], 3)
  const box = room.world.entityAt(6, 0)!
  client.command({ k: 'put', id: box.id, item: itemId('wheat-seed'), max: 10 })
  run(room, [client], 3)
  room.world.addEntity(createEntity(77_101, 'grass', 2, 3, 0, 0))
  const chicken = room.animals!.spawn(animalDef('chicken'), center(3, 3).x, center(3, 3).y)
  chicken.hunger = 900
  for (let i = 0; i < 60 && chicken.fedUntil <= room.tick; i++) run(room, [client], 10)
  assert.ok(chicken.fedUntil > room.tick, 'it ate from the seed box')
  assert.ok(room.world.entityAt(2, 3)?.kind === 'grass', 'and left the nearer grass')
})

test('grass seed, berries and acorns are not planted on sand or the mountains, and nothing spreads onto them', () => {
  const { room, client } = farm('BARREN', { 'grass-seed': 3, berries: 3, acorn: 3 }, { animals: false })
  const forest = room.terrain.sites[0]
  // A beach tile due east of the forest's middle, and a mountain tile.
  let x = forest.x
  while (!isSeaAt(room.terrain, x + 1, forest.y)) x++
  const sand = { x, y: forest.y }
  assert.ok(isSandAt(room.terrain, sand.x, sand.y) && !canGrowAt(room.terrain, sand.x, sand.y), 'sand')
  const mountains = room.terrain.sites[1]
  const rock = { x: mountains.x, y: mountains.y }
  assert.ok(!canGrowAt(room.terrain, rock.x, rock.y), 'the mountains')
  for (const at of [sand, rock]) {
    const there = room.world.entityAt(at.x, at.y)
    if (there) room.world.removeEntity(there.id)
    client.player.position = center(at.x, at.y + 1)
    for (const slot of [0, 1, 2]) {
      client.command({ k: 'place', x: at.x, y: at.y, slot })
      run(room, [client], 2)
      assert.equal(client.results.at(-1)?.why, 'barren', `refused at ${at.x},${at.y}`)
    }
    assert.equal(room.world.entityAt(at.x, at.y), undefined)
  }
  // On the forest's grass, fine.
  const lawn = { x: sand.x - 6, y: sand.y }
  const there = room.world.entityAt(lawn.x, lawn.y)
  if (there) room.world.removeEntity(there.id)
  client.player.position = center(lawn.x, lawn.y + 1)
  client.command({ k: 'place', x: lawn.x, y: lawn.y, slot: 0 })
  run(room, [client], 2)
  assert.equal(room.world.entityAt(lawn.x, lawn.y)?.kind, 'grass')
})

test('a well-fed animal does not graze, and with a feed box of its food in reach a hungry one goes to that, not the grass planted beside it', () => {
  const { room, client } = farm('FEDCOOP', { 'feed-box': 1, 'wheat-seed': 10 }, { plants: false })
  client.command({ k: 'place', x: 6, y: 0, slot: 0 })
  run(room, [client], 3)
  const box = room.world.entityAt(6, 0)!
  client.command({ k: 'put', id: box.id, item: itemId('wheat-seed'), max: 10 })
  run(room, [client], 3)
  room.world.addEntity(createEntity(77_201, 'grass', 2, 3, 0, 0))
  const chicken = room.animals!.spawn(animalDef('chicken'), center(3, 3).x, center(3, 3).y)
  // Just eaten, well fed, and getting hungry again (as it does while well fed): it leaves the grass be.
  const life = animalDef('chicken').life
  chicken.fedUntil = room.tick + 30 * TPS
  chicken.hunger = life.hungryAt
  run(room, [client], 20 * TPS)
  assert.equal(room.world.entityAt(2, 3)?.kind, 'grass', 'not grazed while well fed')
  // No longer well fed: to the box, still not the grass.
  for (let i = 0; i < 60 && chicken.fedUntil <= room.tick + 25 * TPS; i++) run(room, [client], 10)
  assert.ok(chicken.fedUntil > room.tick + 25 * TPS, 'it ate from the box')
  assert.equal(room.world.entityAt(2, 3)?.kind, 'grass', 'and the grass is still there')
})

test('nothing is grown on the beaches when the world is made', () => {
  const room = new GameRoom('BEACH', 11, { wildAnimals: false })
  for (const chunk of room.world.chunkIds) {
    for (const entity of room.world.chunk(chunk)!.entities) {
      if (entity.kind === 'loose') continue
      assert.ok(!isSandAt(room.terrain, entity.x, entity.y), `${entity.kind} on the sand at ${entity.x},${entity.y}`)
    }
  }
})
