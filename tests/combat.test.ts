import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  animalDef,
  BUILDINGS,
  CHUNK_SIZE,
  countOf,
  createEntity,
  itemId,
  KEY_RIGHT,
  KEY_SLOW,
  PLAYER_SPEED,
  STATION_RECIPES,
  stepPlayer,
  SUB,
  TPS,
  WEAPONS,
  type Entity,
} from '../packages/shared/src/index.ts'
import { differingChunks, run, TestClient } from './helpers.ts'

const center = (x: number, y: number): { x: number; y: number } => ({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })

// Bare ground, no wild animals, a player at the spawn with what was asked for (slot by slot).
function arena(code: string, items: Record<string, number> = {}): { room: GameRoom; client: TestClient } {
  const room = new GameRoom(code, 11, { dropsOnGround: false, wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Fighter')
  run(room, [client], 5)
  Object.entries(items).forEach(([key, count], slot) => (client.player.inventory.slots[slot] = { item: itemId(key), count }))
  return { room, client }
}

const attack = (client: TestClient, special: boolean, slot: number, at: { x: number; y: number }, charge = 0): void => {
  client.command({ k: 'attack', special, slot, x: at.x, y: at.y, charge })
}

test('a basic attack hits what is in front of the player, not behind, and chops the tree in front with an axe', () => {
  const { room, client } = arena('MELEE', { axe: 1 })
  const ahead = room.animals!.spawn(animalDef('cow'), center(1, 0).x, center(1, 0).y)
  const behind = room.animals!.spawn(animalDef('cow'), center(-1, 0).x, center(-1, 0).y)
  room.world.addEntity(createEntity(900, 'tree', 1, 1, 0, 0))
  attack(client, false, 0, center(2, 0.5))
  run(room, [client], 3)
  const axe = WEAPONS.get('axe')!
  assert.equal(ahead.hp, animalDef('cow').hp - axe.damage)
  assert.equal(behind.hp, animalDef('cow').hp, 'the one behind is untouched')
  assert.equal((room.world.entity(900) as { hp: number }).hp, 30 - axe.damage, 'the tree in the swing was chopped')
})

test('every weapon shares one cooldown, and charging slows the player', () => {
  const { room, client } = arena('COOL', { club: 1, knife: 1 })
  attack(client, false, 0, center(2, 0))
  attack(client, false, 1, center(2, 0))
  run(room, [client], 3)
  assert.deepEqual(client.results.map((result) => result.why ?? 'ok'), ['ok', 'tooSoon'])
  const free = stepPlayer({ x: 0, y: 0 }, KEY_RIGHT)
  const slowed = stepPlayer({ x: 0, y: 0 }, KEY_RIGHT | KEY_SLOW)
  assert.equal(free.x, PLAYER_SPEED)
  assert.ok(slowed.x < free.x / 2 + 1)
})

test('a bow shoots an arrow that hits the animal it flies at; one that misses lands to be picked up', () => {
  const { room, client } = arena('BOW', { bow: 1, arrow: 3 })
  const target = room.animals!.spawn(animalDef('cow'), center(5, 0).x, center(5, 0).y)
  const bow = WEAPONS.get('bow')!
  attack(client, false, 0, center(5, 0), bow.charge)
  run(room, [client], 20)
  assert.equal(target.hp, animalDef('cow').hp - bow.damage)
  assert.equal(countOf(client.player.inventory, itemId('arrow')), 2)
  attack(client, false, 0, center(0, -10), bow.charge)
  run(room, [client], 60)
  assert.ok(room.world.allDrops().some((drop) => drop.item === itemId('arrow')), 'the missed arrow lies on the ground')
})

test('specials: a sling bash knocks back, a club stuns, a spear is thrown and lands, a volley shoots three and hops back; bare hands have none', () => {
  const { room, client } = arena('SPECIAL', { club: 1, 'wood-spear': 2, bow: 1, arrow: 5, sling: 1 })
  const cow = room.animals!.spawn(animalDef('cow'), center(1, 0).x, center(1, 0).y)
  attack(client, true, -1, center(3, 0), 30)
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'nothing', 'bare hands have no special attack')
  const startX = cow.x
  attack(client, true, 4, center(3, 0), WEAPONS.get('sling')!.special!.windup)
  run(room, [client], 10)
  assert.ok(cow.x - startX > SUB / 2, `the bash knocked it back (${(cow.x - startX) / SUB} tiles)`)
  run(room, [client], WEAPONS.get('sling')!.special!.cooldown)
  // Back in front of the player, done sliding and running.
  Object.assign(cow, { x: center(1, 0).x, y: center(1, 0).y, vx: 0, vy: 0, fleeUntil: 0, goal: { k: 'idle' } })
  attack(client, true, 0, center(3, 0), WEAPONS.get('club')!.special!.windup)
  run(room, [client], 3)
  assert.ok(cow.stunnedUntil > room.tick, 'the club stunned it')
  run(room, [client], WEAPONS.get('club')!.special!.cooldown)
  attack(client, true, 1, center(0, -8), WEAPONS.get('wood-spear')!.special!.charge)
  run(room, [client], 60)
  assert.equal(countOf(client.player.inventory, itemId('wood-spear')), 1)
  assert.ok(room.world.allDrops().some((drop) => drop.item === itemId('wood-spear')), 'the spear landed to be picked up')
  run(room, [client], WEAPONS.get('wood-spear')!.special!.cooldown)
  const before = client.player.position.x
  attack(client, true, 2, center(5, 0))
  run(room, [client], 3)
  assert.equal(countOf(client.player.inventory, itemId('arrow')), 2, 'three arrows at once')
  assert.ok(client.player.position.x < before - SUB, 'and a hop backwards')
})

test('an animal that is hit runs away from whoever hit it', () => {
  const { room, client } = arena('FLEE')
  const chicken = room.animals!.spawn(animalDef('chicken'), center(1, 0).x, center(1, 0).y)
  attack(client, false, -1, center(2, 0))
  run(room, [client], 2 * TPS)
  assert.ok(chicken.x > center(3, 0).x, `it ran off (${chicken.x / SUB})`)
})

test('a hungry animal goes for the nearest grass in reach, every time', () => {
  const room = new GameRoom('HUNGRY', 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Watcher')
  run(room, [client], 5)
  room.world.addEntity(createEntity(800, 'grass', 9, 0, 0, 0))
  const cow = room.animals!.spawn(animalDef('cow'), center(0, 0).x, center(0, 0).y)
  cow.hunger = animalDef('cow').life.hungryAt
  run(room, [client], 5)
  assert.equal(room.animals!.info(cow).doing, 'going to grass')
})

test('a spear needs a knife on the player at the workbench, and is not used up', () => {
  const { room, client } = arena('SPEARS', { workbench: 1, log: 2 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const bench = room.world.entityAt(2, 2)!
  const spear = STATION_RECIPES.workbench.find((recipe) => recipe.output === itemId('wood-spear'))!
  client.command({ k: 'put', id: bench.id, item: itemId('log'), max: 2 })
  client.command({ k: 'work', id: bench.id, recipe: spear.index })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'needsTool')
  client.player.inventory.slots[5] = { item: itemId('knife'), count: 1 }
  client.command({ k: 'work', id: bench.id, recipe: spear.index })
  run(room, [client], spear.ticks + 5)
  assert.equal((room.world.entity(bench.id) as { inv: { slots: Array<{ item: number }> } }).inv.slots[3].item, itemId('wood-spear'))
  assert.equal(countOf(client.player.inventory, itemId('knife')), 1)
})

test('a campfire warms a barrel over a chunk edge, and pages agree', () => {
  const { room, client } = arena('EDGE')
  // A fire on the last column of chunk 0 and a barrel on the first of chunk 1.
  const fire = createEntity(901, 'campfire', CHUNK_SIZE - 1, 3, 0, 0) as Entity & Record<string, number> & { inv: { slots: Array<{ item: number; count: number }> } }
  fire.inv.slots[0] = { item: itemId('charcoal'), count: 20 }
  fire.lit = 1
  room.world.addEntity(fire)
  room.world.addEntity(createEntity(902, 'barrel', CHUNK_SIZE, 3, 0, 0))
  client.player.position = center(CHUNK_SIZE, 3)
  run(room, [client], 5)
  room.resendChunk(client.player, 0)
  room.resendChunk(client.player, room.world.chunkOfEntity(902)!)
  run(room, [client], 30 * TPS)
  const barrel = room.world.entity(902) as unknown as { heat: number; border: number }
  assert.ok(barrel.border >= 700, `heat crossed the edge (${barrel.border})`)
  assert.ok(barrel.heat >= 700)
  assert.deepEqual(differingChunks(room, client), [])
})

test('a basic attack hits every plant and rock in its swing, not just the nearest', () => {
  const { room, client } = arena('MULTI', { axe: 1 })
  room.world.addEntity(createEntity(910, 'bush', 1, 0, 0, 0))
  room.world.addEntity(createEntity(911, 'bush', 1, 1, 0, 0))
  attack(client, false, 0, center(2, 0.5))
  run(room, [client], 3)
  const axe = WEAPONS.get('axe')!
  for (const id of [910, 911]) assert.equal((room.world.entity(id) as { hp: number }).hp, 10 - axe.damage, `bush ${id} was hit`)
})

test('every placed building comes down to an axe, and heals once it has gone a while without being hit', () => {
  const { room, client } = arena('HEAL', { axe: 1 })
  const kinds = ['fence', 'gate', 'stump', 'plot', 'feeder', 'workbench', 'campfire', 'barrel', 'rack', 'chest'] as const
  // Three tiles apart, so each swing reaches one.
  kinds.forEach((kind, i) => room.world.addEntity(createEntity(920 + i, kind, 1, i * 3 - 12, 0, 0)))
  for (const [i, kind] of kinds.entries()) {
    client.player.position = center(0, i * 3 - 12)
    attack(client, false, 0, center(1, i * 3 - 12))
    run(room, [client], WEAPONS.get('axe')!.cooldown + 1)
    const hp = (room.world.entity(920 + i) as { hp: number } | undefined)?.hp
    assert.ok(hp === undefined || hp < BUILDINGS[kind].maxHp, `the ${kind} took the axe`)
  }
  // Hit the fence again, and time its healing from that.
  run(room, [client], 6 * TPS)
  client.player.position = center(0, -12)
  attack(client, false, 0, center(1, -12))
  run(room, [client], 3)
  const fence = room.world.entity(920) as { hp: number }
  assert.ok(fence.hp < BUILDINGS.fence.maxHp)
  run(room, [client], 5 * TPS)
  assert.ok(fence.hp < BUILDINGS.fence.maxHp, 'not straight away')
  run(room, [client], 4 * TPS)
  assert.equal(fence.hp, BUILDINGS.fence.maxHp, 'healed after six seconds without a hit')
})

test('an attack is judged against where the player saw the animals, up to half a second back', () => {
  const { room, client } = arena('REWIND')
  const chicken = room.animals!.spawn(animalDef('chicken'), center(1, 0).x, center(1, 0).y)
  // Kept from wandering off by itself, so only the test moves it.
  chicken.stunnedUntil = Number.MAX_SAFE_INTEGER
  run(room, [client], 2)
  // It moves out of the punch before the punch gets to the server.
  chicken.y = center(1, 3).y
  run(room, [client], 2)
  const hp = animalDef('chicken').hp
  client.command({ k: 'attack', special: false, slot: -1, x: center(3, 0).x, y: center(3, 0).y, charge: 0 })
  run(room, [client], 3)
  assert.equal(chicken.hp, hp, 'judged where it is now, it is missed')
  run(room, [client], TPS)
  client.command({ k: 'attack', special: false, slot: -1, x: center(3, 0).x, y: center(3, 0).y, charge: 0, seen: room.tick - 2 })
  run(room, [client], 3)
  assert.equal(chicken.hp, hp, 'it has been in its new place for a while, so where the player saw it, it is not')
  // Past the cooldown, it comes back in front of the player, is seen there, and moves away again.
  run(room, [client], TPS)
  chicken.y = center(1, 0).y
  run(room, [client], 2)
  const sawIt = room.tick
  chicken.y = center(1, 3).y
  run(room, [client], 2)
  client.command({ k: 'attack', special: false, slot: -1, x: center(3, 0).x, y: center(3, 0).y, charge: 0, seen: sawIt })
  run(room, [client], 3)
  assert.equal(chicken.hp, hp - 1, 'judged where the player saw it, it is hit')
})
