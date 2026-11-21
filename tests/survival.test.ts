import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  animalDef,
  ARMOR_SLOT,
  ARMOR_SLOTS,
  createEntity,
  damageAfterArmor,
  EAT_COOLDOWN_TICKS,
  FOOD_SLOT,
  addItems,
  DUNGEON_LAYOUT,
  dungeonTile,
  getItem,
  isSeaAt,
  itemByKey,
  itemId,
  NO_ITEM,
  PLAYER_MAX_HEALTH,
  PLAYER_SPAWN,
  SUB,
  TPS,
  waterAt,
  type RequestMessage,
} from '../packages/shared/src/index.ts'
import { run, TestClient } from './helpers.ts'

const center = (x: number, y: number): { x: number; y: number } => ({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })

// Bare ground, no wild animals, a player at the spawn with what was asked for (slot by slot).
function arena(code: string, items: Record<string, number> = {}): { room: GameRoom; client: TestClient } {
  const room = new GameRoom(code, 11, { dropsOnGround: false, wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Survivor')
  run(room, [client], 5)
  Object.entries(items).forEach(([key, count], slot) => (client.player.inventory.slots[slot] = { item: itemId(key), count }))
  return { room, client }
}

const wear = (client: TestClient, key: string): void => {
  const part = getItem(itemId(key)).armor!.slot
  client.player.inventory.slots[ARMOR_SLOT + ARMOR_SLOTS.indexOf(part)] = { item: itemId(key), count: 1 }
}

test('armour takes a flat amount off each hit, but a hit always does at least 1', () => {
  assert.equal(damageAfterArmor(8, 6), 2)
  assert.equal(damageAfterArmor(3, 6), 1)
  const { room, client } = arena('ARMOR')
  const wolf = room.animals!.spawn(animalDef('wolf'), client.player.position.x + 3 * SUB, client.player.position.y)
  const bite = animalDef('wolf').hunt!.damage
  room.animals!.damage(wolf.id, 1, client.player.position, room.tick, {}, client.player.id)
  run(room, [client], 2 * TPS)
  const bare = PLAYER_MAX_HEALTH - client.player.health
  assert.ok(bare >= bite, 'bitten')
  // In leather armor (defense 2), the same bites do the least there is.
  const dressed = arena('ARMOR2')
  wear(dressed.client, 'leather-armor')
  const second = dressed.room.animals!.spawn(animalDef('wolf'), dressed.client.player.position.x + 3 * SUB, dressed.client.player.position.y)
  dressed.room.animals!.damage(second.id, 1, dressed.client.player.position, dressed.room.tick, {}, dressed.client.player.id)
  run(dressed.room, [dressed.client], 2 * TPS)
  const bites = PLAYER_MAX_HEALTH - dressed.client.player.health
  assert.ok(bites > 0 && bites < bare, `armour helps (${bites} against ${bare})`)
})

test('eating food gives back health, more for better food; not when unhurt, and not what is not food', () => {
  const { room, client } = arena('EAT', { berries: 3, 'cooked-steak': 2, stick: 4 })
  assert.ok(getItem(itemId('cooked-steak')).heals! > getItem(itemId('steak')).heals!, 'cooked beats raw')
  assert.ok(getItem(itemId('steak')).heals! > getItem(itemId('berries')).heals! || getItem(itemId('berries')).heals! >= 1)
  client.command({ k: 'eat', slot: 0 })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'fullHealth')
  client.player.health = 5
  client.command({ k: 'eat', slot: 1 })
  run(room, [client], 3)
  assert.equal(client.player.health, 5 + getItem(itemId('cooked-steak')).heals!)
  assert.equal(client.player.inventory.slots[1].count, 1)
  client.command({ k: 'eat', slot: 2 })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'notFood')
  // Not again until the cooldown is over; then never past full health.
  client.player.health = PLAYER_MAX_HEALTH - 1
  client.command({ k: 'eat', slot: 1 })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'eatTooSoon')
  run(room, [client], EAT_COOLDOWN_TICKS)
  client.command({ k: 'eat', slot: 1 })
  run(room, [client], 3)
  assert.equal(client.player.health, PLAYER_MAX_HEALTH)
})

test('a sleeping bag, made of 3 leather, is where a player sleeps and wakes up when knocked out; gone, they wake at the spawn', () => {
  const recipe = (getItem(itemId('sleeping-bag')).places === 'bed')
  assert.ok(recipe, 'a sleeping bag puts down a bed')
  const { room, client } = arena('BED', { 'sleeping-bag': 1 })
  client.command({ k: 'place', x: 2, y: 0, slot: 0 })
  run(room, [client], 3)
  const bed = room.world.entityAt(2, 0)!
  assert.equal(bed.kind, 'bed')
  client.command({ k: 'sleep', id: bed.id })
  run(room, [client], 3)
  assert.ok(client.results.at(-1)?.ok)
  // Knocked out far away: back at the bag.
  client.player.position = center(30, 30)
  client.player.health = 1
  const wolf = room.animals!.spawn(animalDef('wolf'), center(32, 30).x, center(32, 30).y)
  room.animals!.damage(wolf.id, 1, client.player.position, room.tick, {}, client.player.id)
  run(room, [client], 2 * TPS)
  assert.deepEqual(client.player.position, center(2, 0), 'woke up at the sleeping bag')
  // The bag taken away: the spawn again.
  room.world.removeEntity(bed.id)
  room.animals!.all.delete(wolf.id)
  client.player.position = center(30, 30)
  client.player.health = 1
  const again = room.animals!.spawn(animalDef('wolf'), center(32, 30).x, center(32, 30).y)
  room.animals!.damage(again.id, 1, client.player.position, room.tick, {}, client.player.id)
  run(room, [client], 2 * TPS)
  assert.ok(Math.hypot(client.player.position.x - PLAYER_SPAWN.x, client.player.position.y - PLAYER_SPAWN.y) < 2 * SUB, 'woke up at the spawn')
})

test('a request the server cannot read is answered as refused, and does not hold up the ones after it', () => {
  const { room, client } = arena('BADREQ', { stick: 5 })
  // As the hosted server puts it in place of a request that failed its checks (see index.ts).
  const answered = room.receiveRequest(client.player, { s: 1, r: { k: 'bad' } } as RequestMessage)
  assert.equal(answered, 1, 'acknowledged, so the stream goes on')
  room.receiveRequest(client.player, { s: 2, r: { k: 'cmd', tick: room.tick + 1, c: { k: 'move', from: 0, to: 5 } } } as RequestMessage)
  room.step()
  room.step()
  assert.equal(client.player.inventory.slots[5].count, 5, 'the next command ran')
})

test('deer drop meat and hides; wolves drop hides and fangs; the items they used to drop are gone', () => {
  const drops = (kind: string): string[] => animalDef(kind).drops.map((drop) => getItem(drop.item).key).sort()
  assert.deepEqual(drops('deer'), ['hide', 'steak'])
  assert.deepEqual(drops('wolf'), ['fang', 'hide'])
  for (const gone of ['venison', 'cooked-venison', 'wolf-pelt', 'cooked-egg']) assert.equal(itemByKey(gone), undefined, `${gone} is gone`)
  assert.equal(getItem(itemId('egg')).cooks, undefined, 'eggs no longer cook into anything')
})

test('a skeleton that sees a player goes for them alone; hurt, it calls the others; and a wall hides a player from it', () => {
  const { room, client } = arena('SKEL')
  const skeleton = animalDef('skeleton')
  const a = room.animals!.spawn(skeleton, client.player.position.x + 5 * SUB, client.player.position.y)
  const b = room.animals!.spawn(skeleton, client.player.position.x + 9 * SUB, client.player.position.y + 2 * SUB)
  run(room, [client], 8)
  assert.equal(a.target, client.player.id, 'the near one comes')
  assert.equal(b.target, 0, 'alone')
  room.animals!.damage(a.id, 1, client.player.position, room.tick, {}, client.player.id)
  assert.equal(b.target, client.player.id, 'hurt, it calls the others')
  // In the crypt, a player behind a wall is not seen.
  const crypt = new GameRoom('SKEL2', 11, { wildAnimals: false, plants: false, animals: true })
  const delver = new TestClient(crypt, 'Delver')
  // The player in the great hall; a skeleton in the side room below it, near, but with rock between them.
  // (Rows counted from the doorway out of the lich's hall, which is row 8 of the part below it.)
  const below = DUNGEON_LAYOUT.door.y - 8
  const hall = dungeonTile(0, { x: 13, y: below + 12 })
  const room2 = dungeonTile(0, { x: 18, y: below + 16 })
  assert.ok(Math.hypot(hall.x - room2.x, hall.y - room2.y) < animalDef('skeleton').hunt!.aggroRadius / SUB, 'near enough to notice')
  delver.player.position = center(hall.x, hall.y)
  run(crypt, [delver], 3)
  const behind = crypt.animals!.spawn(skeleton, center(room2.x, room2.y).x, center(room2.x, room2.y).y)
  run(crypt, [delver], 8)
  assert.equal(behind.target, 0, 'the wall hides the player')
})

test('a wolf that gives up a chase at the edge of its ground does not take it up again and again', () => {
  const { room, client } = arena('CALM')
  const wolf = room.animals!.spawn(animalDef('wolf'), center(10, 0).x, center(10, 0).y)
  const leash = animalDef('wolf').hunt!.leash
  // The player stands just past the leash from the wolf's home, and the wolf beside them (as if it chased them there).
  client.player.position = { x: wolf.homeX - leash - SUB, y: wolf.homeY }
  wolf.x = client.player.position.x + 2 * SUB
  room.animals!.damage(wolf.id, 1, client.player.position, room.tick, {}, client.player.id)
  let changes = 0
  let last = wolf.target
  for (let i = 0; i < 8 * TPS; i++) {
    run(room, [client], 1)
    if (wolf.target !== last) changes++
    last = wolf.target
  }
  assert.ok(changes <= 1, `it gave up once and stayed calm (${changes} changes)`)
})

test('a deer on a rope runs, and drags whoever holds it', () => {
  const { room, client } = arena('ROPE', { rope: 1 })
  const deer = room.animals!.spawn(animalDef('deer'), client.player.position.x + 2 * SUB, client.player.position.y)
  deer.leader = client.player.id
  const before = { ...client.player.position }
  run(room, [client], 2 * TPS)
  const dragged = Math.hypot(client.player.position.x - before.x, client.player.position.y - before.y)
  assert.ok(dragged > 3 * SUB, `the player was dragged (${(dragged / SUB).toFixed(1)} tiles)`)
  assert.ok(animalDef('deer').mass > 1, 'a deer outweighs a player on a rope')
})

test('grass stops spreading once its patch is 15 tufts big', () => {
  const room = new GameRoom('GRASS', 11, { wildAnimals: false, animals: false })
  const client = new TestClient(room, 'Gardener')
  // Clear the chunk round the player of its own plants, then plant one tuft and let it spread a long while.
  run(room, [client], 2)
  const everything = () => [...room.world.chunkIds].flatMap((chunk) => [...(room.world.chunk(chunk)?.entities ?? [])])
  for (const entity of everything()) if (Math.abs(entity.x) < 40 && Math.abs(entity.y) < 40) room.world.removeEntity(entity.id)
  room.world.addEntity(createEntity(99_999, 'grass', 8, 8, 0, NO_ITEM))
  run(room, [client], 400 * TPS / 10)
  const grass = everything().filter((entity) => entity.kind === 'grass' && Math.abs(entity.x - 8) < 12 && Math.abs(entity.y - 8) < 12)
  assert.ok(grass.length > 3, `it spread (${grass.length})`)
  assert.ok(grass.length <= 16, `but no further than a patch of 15 (${grass.length})`)
})

test('an arrow that comes down over the sea sinks', () => {
  const room = new GameRoom('SINK', 7, { wildAnimals: false, plants: false, animals: true, terrain: { size: 'small', bumpiness: 0 } })
  const client = new TestClient(room, 'Archer')
  // The shore due west of the forest.
  const forest = room.terrain.sites[0]
  let x = forest.x
  while (!isSeaAt(room.terrain, x - 1, forest.y)) x--
  client.player.position = center(x + 1, forest.y)
  run(room, [client], 3)
  client.player.inventory.slots[0] = { item: itemId('bow'), count: 1 }
  client.player.inventory.slots[1] = { item: itemId('arrow'), count: 5 }
  client.command({ k: 'attack', special: false, slot: 0, x: client.player.position.x - 20 * SUB, y: client.player.position.y, charge: 30 })
  run(room, [client], 3 * TPS)
  assert.equal(client.player.inventory.slots[1].count, 4, 'shot')
  const lying = room.world.allDrops().filter((drop) => drop.item === itemId('arrow'))
  assert.ok(lying.every((drop) => !waterAt(room.terrain, Math.floor(drop.x / SUB), Math.floor(drop.y / SUB))), 'nothing lies on the water')
  assert.equal(lying.length, 0, 'the arrow sank')
})
