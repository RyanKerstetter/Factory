import assert from 'node:assert/strict'
import test from 'node:test'
import { isAdult } from '../apps/server/src/animals.ts'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  animalDef,
  countOf,
  createEntity,
  CROPS,
  cropIsGrown,
  itemId,
  KEY_RIGHT,
  LEAD_LENGTH,
  PUNCH_COOLDOWN_TICKS,
  ropePull,
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
  const { room, client } = farm('STUMP', { stump: 1, axe: 1, log: 3, stone: 2 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const stump = room.world.entityAt(2, 2)!
  assert.equal(stump.kind, 'stump')
  client.command({ k: 'work', id: stump.id })
  client.command({ k: 'put', id: stump.id, item: itemId('axe'), max: 1 })
  client.command({ k: 'put', id: stump.id, item: itemId('log'), max: 3 })
  client.command({ k: 'put', id: stump.id, item: itemId('stone'), max: 2 })
  client.command({ k: 'work', id: stump.id })
  run(room, [client], 5)
  assert.deepEqual(client.results.slice(1).map((result) => result.why ?? 'ok'), ['noWork', 'ok', 'ok', 'nothing', 'ok'])
  run(room, [client], 3 * 2 * TPS + 10)
  const done = room.world.entity(stump.id)
  assert.ok(done?.kind === 'stump')
  assert.deepEqual(
    done.inv.slots.map((slot) => [slot.item, slot.count]),
    [
      [itemId('axe'), 1],
      [0, 0],
      [itemId('plank'), 6],
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
  const { room } = farm('GRAZE')
  const tuft = entitiesOf(room, 'grass')[0]
  const cow = room.animals!.spawn(animalDef('cow'), tuft.x * SUB + 3 * SUB, tuft.y * SUB + SUB / 2)
  cow.hunger = 900
  for (let i = 0; i < 40 && cow.hunger >= 800; i++) run(room, [], 30)
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
  let baby = undefined as ReturnType<typeof room.animals.spawn> | undefined
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

test('a stretched rope pulls the lighter one more: a cow drags a player harder than a chicken does', () => {
  const player = { x: 0, y: 0 }
  const animal = { x: LEAD_LENGTH + SUB, y: 0 }
  const cow = ropePull(player, animal, animalDef('cow').mass)!
  const chicken = ropePull(player, animal, animalDef('chicken').mass)!
  assert.ok(cow.player.dx > chicken.player.dx && cow.player.dx > 0)
  assert.ok(chicken.animal.dx < cow.animal.dx && chicken.animal.dx < 0)
  assert.equal(ropePull(player, { x: LEAD_LENGTH, y: 0 }, 1), undefined, 'a slack rope does not pull')
})

test('a knife kills an animal in half the hits; a grown one drops its meat and the rest, a baby nothing', () => {
  const { room, client } = farm('KILL', { knife: 1 })
  const def = animalDef('chicken')
  const chicken = room.animals!.spawn(def, center(2, 1).x, center(2, 1).y)
  let hits = 0
  while (room.animals!.get(chicken.id) && hits < 10) {
    client.command({ k: 'strike', animal: chicken.id, slot: 0 })
    run(room, [client], PUNCH_COOLDOWN_TICKS)
    hits++
  }
  assert.equal(hits, Math.ceil(def.hp / 2))
  assert.ok(countOf(client.player.inventory, itemId('raw-chicken')) >= 1)
  const feathers = countOf(client.player.inventory, itemId('feather'))
  assert.ok(feathers >= 1 && feathers <= 3)
  const chick = room.animals!.spawn(def, center(2, 1).x, center(2, 1).y, { baby: true })
  const before = countOf(client.player.inventory, itemId('feather'))
  while (room.animals!.get(chick.id)) {
    client.command({ k: 'strike', animal: chick.id, slot: 0 })
    run(room, [client], PUNCH_COOLDOWN_TICKS)
  }
  assert.equal(countOf(client.player.inventory, itemId('feather')), before, 'a chick drops nothing')
})

test('a cow is milked with a right click holding a bucket, which is kept; a hen lays eggs on the ground', () => {
  const { room, client } = farm('MILK')
  const cow = room.animals!.spawn(animalDef('cow'), center(2, 1).x, center(2, 1).y, { sex: 'f' })
  cow.milk = 2
  client.player.inventory.slots[0] = { item: itemId('bucket'), count: 1 }
  client.command({ k: 'interact', animal: cow.id, slot: 0 })
  client.command({ k: 'interact', animal: cow.id, slot: 0 })
  run(room, [client], 5)
  assert.equal(countOf(client.player.inventory, itemId('milk')), 2)
  assert.equal(countOf(client.player.inventory, itemId('bucket')), 1, 'the bucket is kept')
  assert.deepEqual(client.results.map((result) => result.why ?? 'ok'), ['ok', 'noMilk'])
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

test('a stump only works while someone is at it, and makes rope from twine with no tool', () => {
  const { room, client } = farm('ATIT', { stump: 1, twine: 9 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const stump = room.world.entityAt(2, 2)!
  client.command({ k: 'put', id: stump.id, item: itemId('twine'), max: 9 })
  client.command({ k: 'work', id: stump.id })
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
  client.command({ k: 'work', id: stump.id })
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
