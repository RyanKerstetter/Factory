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
  STATION_LAYOUT,
  stepPlayer,
  PLAYER_MAX_HEALTH,
  PLAYER_SPAWN,
  SUB,
  TPS,
  WEAPONS,
  CHARGE_TICKS,
  KEY_CHARGE,
  KEY_LEFT,
  LUNGE_TICKS,
  PUSH_MAX,
  lungeOf,
  weaponIn,
  pushOf,
  withPush,
  HURT_GRACE_TICKS,
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

const attack = (client: TestClient, slot: number, at: { x: number; y: number }): void => {
  client.command({ k: 'attack', slot, x: at.x, y: at.y })
}
// What a hit does to a creature with some armour (never nothing).
const after = (damage: number, armor: number): number => Math.max(1, damage - armor)

test('a basic attack hits what is in front of the player, not behind, and chops the tree in front with an axe', () => {
  const { room, client } = arena('MELEE', { axe: 1 })
  const ahead = room.animals!.spawn(animalDef('cow'), center(1, 0).x, center(1, 0).y)
  const behind = room.animals!.spawn(animalDef('cow'), center(-1, 0).x, center(-1, 0).y)
  room.world.addEntity(createEntity(900, 'tree', 1, 1, 0, 0))
  attack(client, 0, center(2, 0.5))
  run(room, [client], 3)
  const axe = WEAPONS.get('axe')!
  assert.equal(ahead.hp, animalDef('cow').hp - after(axe.damage, animalDef('cow').armor))
  assert.equal(behind.hp, animalDef('cow').hp, 'the one behind is untouched')
  assert.equal((room.world.entity(900) as { hp: number }).hp, BUILDINGS.tree.maxHp - axe.harvest, 'the tree in the swing was chopped')
})

test('every weapon shares one cooldown, and attacking slows the player', () => {
  const { room, client } = arena('COOL', { club: 1, knife: 1 })
  attack(client, 0, center(2, 0))
  attack(client, 1, center(2, 0))
  run(room, [client], 3)
  assert.deepEqual(client.results.map((result) => result.why ?? 'ok'), ['ok', 'tooSoon'])
  const free = stepPlayer({ x: 0, y: 0 }, KEY_RIGHT)
  const slowed = stepPlayer({ x: 0, y: 0 }, KEY_RIGHT | KEY_SLOW)
  assert.equal(free.x, PLAYER_SPEED)
  assert.ok(slowed.x < free.x && slowed.x > free.x / 2)
})

test('a bow shoots an arrow after a short windup, no charging: it hits the animal it flies at; one that misses lands to be picked up', () => {
  const { room, client } = arena('BOW', { bow: 1, arrow: 3 })
  const target = room.animals!.spawn(animalDef('cow'), center(5, 0).x, center(5, 0).y)
  target.stunnedUntil = Number.MAX_SAFE_INTEGER
  const bow = WEAPONS.get('bow')!
  attack(client, 0, center(5, 0))
  run(room, [client], 3)
  assert.equal(countOf(client.player.inventory, itemId('arrow')), 2, 'the arrow is taken at once')
  assert.equal(target.hp, animalDef('cow').hp, 'but does not fly until the bow is drawn')
  run(room, [client], bow.windup + 20)
  assert.equal(target.hp, animalDef('cow').hp - after(bow.damage, animalDef('cow').armor))
  run(room, [client], bow.cooldown)
  attack(client, 0, center(0, -10))
  run(room, [client], 60)
  assert.ok(room.world.allDrops().some((drop) => drop.item === itemId('arrow')), 'the missed arrow lies on the ground')
})

test('there are no right-click attacks: every hit a player lands knocks a creature back and stuns it for a moment', () => {
  const { room, client } = arena('KNOCK', { club: 1 })
  const cow = room.animals!.spawn(animalDef('cow'), center(1, 0).x, center(1, 0).y)
  const startX = cow.x
  attack(client, 0, center(3, 0))
  run(room, [client], 2)
  assert.ok(cow.stunnedUntil > room.tick, 'stunned')
  run(room, [client], 6)
  assert.ok(cow.x - startX > SUB / 4, `knocked back (${(cow.x - startX) / SUB} tiles)`)
})

test('an animal that is hit runs away from whoever hit it', () => {
  const { room, client } = arena('FLEE')
  const chicken = room.animals!.spawn(animalDef('chicken'), center(1, 0).x, center(1, 0).y)
  attack(client, -1, center(2, 0))
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

test('a spear needs a knife: Craft puts the player’s knife into the workbench’s tool slot, and it is not used up', () => {
  const { room, client } = arena('SPEARS', { workbench: 1, log: 2 })
  client.command({ k: 'place', x: 2, y: 2, slot: 0 })
  run(room, [client], 5)
  const bench = room.world.entityAt(2, 2)!
  const spear = STATION_RECIPES.workbench.find((recipe) => recipe.output === itemId('wood-spear'))!
  client.command({ k: 'put', id: bench.id, item: itemId('log'), max: 2 })
  client.command({ k: 'work', id: bench.id, recipe: spear.index })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'needsTool', 'no knife anywhere')
  // A knife on the player is enough: it goes into the workbench's tool slot.
  client.player.inventory.slots[5] = { item: itemId('knife'), count: 1 }
  client.command({ k: 'work', id: bench.id, recipe: spear.index })
  run(room, [client], spear.ticks + 5)
  assert.equal(client.results.at(-1)?.ok, true)
  const slots = (room.world.entity(bench.id) as { inv: { slots: Array<{ item: number; count: number }> } }).inv.slots
  assert.equal(slots[STATION_LAYOUT.workbench.output].item, itemId('wood-spear'))
  assert.equal(slots[STATION_LAYOUT.workbench.tool].item, itemId('knife'), 'the knife is in the tool slot, still there')
  assert.equal(countOf(client.player.inventory, itemId('knife')), 0)
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
  attack(client, 0, center(2, 0.5))
  run(room, [client], 3)
  const axe = WEAPONS.get('axe')!
  for (const id of [910, 911]) assert.equal((room.world.entity(id) as { hp: number }).hp, 10 - axe.harvest, `bush ${id} was hit`)
})

test('every placed building comes down to an axe, and heals once it has gone a while without being hit', () => {
  const { room, client } = arena('HEAL', { axe: 1 })
  const kinds = ['fence', 'gate', 'stump', 'plot', 'feeder', 'workbench', 'campfire', 'barrel', 'rack', 'chest'] as const
  // Three tiles apart, so each swing reaches one.
  kinds.forEach((kind, i) => room.world.addEntity(createEntity(920 + i, kind, 1, i * 3 - 12, 0, 0)))
  for (const [i, kind] of kinds.entries()) {
    client.player.position = center(0, i * 3 - 12)
    attack(client, 0, center(1, i * 3 - 12))
    run(room, [client], WEAPONS.get('axe')!.cooldown + 1)
    const hp = (room.world.entity(920 + i) as { hp: number } | undefined)?.hp
    assert.ok(hp === undefined || hp < BUILDINGS[kind].maxHp, `the ${kind} took the axe`)
  }
  // Hit the fence again, and time its healing from that.
  run(room, [client], 6 * TPS)
  client.player.position = center(0, -12)
  attack(client, 0, center(1, -12))
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
  client.command({ k: 'attack', slot: -1, x: center(3, 0).x, y: center(3, 0).y })
  run(room, [client], 3)
  assert.equal(chicken.hp, hp, 'judged where it is now, it is missed')
  run(room, [client], TPS)
  client.command({ k: 'attack', slot: -1, x: center(3, 0).x, y: center(3, 0).y, seen: room.tick - 2 })
  run(room, [client], 3)
  assert.equal(chicken.hp, hp, 'it has been in its new place for a while, so where the player saw it, it is not')
  // Past the cooldown, it comes back in front of the player, is seen there, and moves away again.
  run(room, [client], TPS)
  chicken.y = center(1, 0).y
  run(room, [client], 2)
  const sawIt = room.tick
  chicken.y = center(1, 3).y
  run(room, [client], 2)
  client.command({ k: 'attack', slot: -1, x: center(3, 0).x, y: center(3, 0).y, seen: sawIt })
  run(room, [client], 3)
  assert.equal(chicken.hp, hp - after(WEAPONS.get('hand')!.damage, animalDef('chicken').armor), 'judged where the player saw it, it is hit')
})

test('with PvP on, players hurt each other, and one knocked out wakes up at the spawn healed; only the host turns it off', () => {
  const room = new GameRoom('PVP', 11, { dropsOnGround: false, wildAnimals: false, plants: false, animals: false })
  const host = new TestClient(room, 'Host')
  const guest = new TestClient(room, 'Guest')
  run(room, [host, guest], 5)
  guest.player.position = { x: host.player.position.x + SUB, y: host.player.position.y }
  const punch = (client: TestClient, at: { x: number; y: number }): void => {
    client.command({ k: 'attack', slot: -1, x: at.x, y: at.y })
  }
  punch(host, guest.player.position)
  run(room, [host, guest], 3)
  assert.equal(guest.player.health, PLAYER_MAX_HEALTH - WEAPONS.get('hand')!.damage, 'a punch hurts')
  // Down to nothing: back at the spawn, healed.
  guest.player.health = 1
  run(room, [host, guest], TPS)
  punch(host, guest.player.position)
  run(room, [host, guest], 3)
  assert.equal(guest.player.health, PLAYER_MAX_HEALTH)
  // At the spawn (nudged off the host, who stands there too).
  assert.ok(Math.hypot(guest.player.position.x - PLAYER_SPAWN.x, guest.player.position.y - PLAYER_SPAWN.y) < SUB, 'back at the spawn')
  // Only the host changes it.
  guest.command({ k: 'pvp', on: false })
  run(room, [host, guest], 3)
  assert.equal(guest.results.at(-1)?.why, 'notHost')
  host.command({ k: 'pvp', on: false })
  run(room, [host, guest], TPS)
  guest.player.position = { x: host.player.position.x + SUB, y: host.player.position.y }
  run(room, [host, guest], 2)
  punch(host, guest.player.position)
  run(room, [host, guest], 3)
  assert.equal(guest.player.health, PLAYER_MAX_HEALTH, 'with PvP off, nothing')
})

// A charged attack: the button held down (`charge`), long enough, then let go towards a point.
const chargedAttack = (room: GameRoom, client: TestClient, slot: number, at: { x: number; y: number }, held?: number): void => {
  client.command({ k: 'charge', slot })
  run(room, [client], held ?? weaponIn(client.player.inventory, slot).charged?.charge ?? CHARGE_TICKS)
  client.command({ k: 'attack', slot, x: at.x, y: at.y, charged: 1 })
}

test('a player who was just hurt is not hurt again for a moment: no being hit over and over at once', () => {
  const room = new GameRoom('GRACE', 11, { dropsOnGround: false, wildAnimals: false, plants: false, animals: false })
  const a = new TestClient(room, 'Host')
  const b = new TestClient(room, 'Guest')
  run(room, [a, b], 5)
  b.player.position = { x: a.player.position.x + SUB, y: a.player.position.y }
  const punch = (): void => {
    a.command({ k: 'attack', slot: -1, x: b.player.position.x, y: b.player.position.y })
  }
  const fist = WEAPONS.get('hand')!
  punch()
  run(room, [a, b], fist.cooldown + 1)
  b.player.position = { x: a.player.position.x + SUB, y: a.player.position.y }
  punch()
  run(room, [a, b], 2)
  assert.equal(b.player.health, PLAYER_MAX_HEALTH - fist.damage, 'the second punch, inside the grace, does nothing')
  run(room, [a, b], HURT_GRACE_TICKS)
  b.player.position = { x: a.player.position.x + SUB, y: a.player.position.y }
  punch()
  run(room, [a, b], 2)
  assert.equal(b.player.health, PLAYER_MAX_HEALTH - 2 * fist.damage, 'after it, a punch hurts again')
})

test('a charged attack needs the button held down for half a second; the tools have none, and hit standing still', () => {
  const { room, client } = arena('SPIN', { club: 1, axe: 1 })
  // Not held long enough: refused.
  chargedAttack(room, client, 0, center(2, 0), CHARGE_TICKS - 5)
  run(room, [client], 2)
  assert.equal(client.results.at(-1)?.why, 'tooSoon')
  // The knife, axe and pickaxe: no charged attack (held down, they just go on hitting), and no step forward.
  for (const key of ['knife', 'axe', 'pickaxe']) {
    const tool = WEAPONS.get(key)!
    assert.equal(tool.charged, undefined, `${key}: nothing charged`)
    assert.equal(lungeOf(tool, false), undefined, `${key}: no step`)
  }
  const cow = animalDef('cow')
  const ahead = room.animals!.spawn(cow, client.player.position.x + SUB, client.player.position.y)
  ahead.vx = ahead.vy = 0
  const from = { ...client.player.position }
  run(room, [client], 30)
  client.command({ k: 'attack', slot: 1, x: from.x + 4 * SUB, y: from.y })
  run(room, [client], 10)
  assert.deepEqual(client.player.position, from, 'the axe does not move the player')
  assert.ok(ahead.hp < cow.hp, 'but it still hurts')
})

test('a spear held down is thrown: it sticks in the ground where it comes down, and a hit knocks it loose to be picked up again', () => {
  const { room, client } = arena('THROW', { 'wood-spear': 2 })
  const spear = WEAPONS.get('wood-spear')!.charged!
  assert.equal(spear.kind, 'throw')
  const from = { ...client.player.position }
  chargedAttack(room, client, 0, { x: from.x + 10 * SUB, y: from.y })
  run(room, [client], 2)
  assert.equal(countOf(client.player.inventory, itemId('wood-spear')), 1, 'one of the two thrown')
  run(room, [client], Math.ceil(spear.range / spear.speed) + 5)
  const stuck = [...room.world.chunkIds].flatMap((id) => room.world.chunk(id)!.entities).find((entity) => entity.kind === 'loose' && entity.item === itemId('wood-spear'))
  assert.ok(stuck, 'it stands in the ground')
  const out = Math.abs(stuck!.x * SUB + SUB / 2 - from.x) / SUB
  assert.ok(Math.abs(out - spear.range / SUB) <= 1.5, `about its range away (${out.toFixed(1)} tiles)`)
  assert.deepEqual(differingChunks(room, client), [], 'the pages see it too')
  // Walk up to it and hit it: back in hand.
  client.player.position = center(stuck!.x - 1, stuck!.y)
  run(room, [client], WEAPONS.get('wood-spear')!.cooldown)
  attack(client, -1, center(stuck!.x, stuck!.y))
  run(room, [client], 5)
  assert.equal(room.world.entity(stuck!.id), undefined, 'knocked loose')
  assert.equal(countOf(client.player.inventory, itemId('wood-spear')), 2, 'and picked up again')
})

test('a bow drawn while the button is held shoots at once, harder and faster', () => {
  const { room, client } = arena('DRAW', { bow: 1, arrow: 5 })
  const bow = WEAPONS.get('bow')!
  assert.ok(bow.charged!.damage > bow.damage && bow.charged!.speed > bow.speed)
  const cow = animalDef('cow')
  const target = room.animals!.spawn(cow, client.player.position.x + 8 * SUB, client.player.position.y)
  chargedAttack(room, client, 0, { x: target.x, y: target.y })
  run(room, [client], 2)
  assert.ok(room.combat.inChunks(client.player.chunks, room.tick).some(([, item]) => item === itemId('arrow')), 'it flies at once, no windup')
  run(room, [client], 10)
  assert.equal(target.hp, cow.hp - after(bow.charged!.damage, cow.armor))
})

test('melee attacks step the player forward, a pushed input moves the same on the page and the server, and the server only lets a player push so far', () => {
  // A push moves along its angle, not where the keys say.
  const pushed = stepPlayer({ x: 0, y: 0 }, withPush(KEY_LEFT, 0, WEAPONS.get('club')!.lunge / LUNGE_TICKS))
  assert.ok(pushed.x > 0 && pushed.y === 0, 'forward, though the player held left')
  assert.ok(Math.abs(pushOf(withPush(0, Math.PI / 2, PUSH_MAX))!.dy - PUSH_MAX) <= 1)
  // Charging slows the player down.
  assert.ok(stepPlayer({ x: 0, y: 0 }, KEY_RIGHT | KEY_CHARGE).x < stepPlayer({ x: 0, y: 0 }, KEY_RIGHT | KEY_SLOW).x)
  // The server plays pushes, up to the allowance.
  const { room, client } = arena('PUSH')
  const start = { ...client.player.position }
  const inputs: Array<[number, number]> = []
  for (let seq = 1; seq <= 60; seq++) inputs.push([seq, withPush(0, 0, PUSH_MAX)])
  for (const input of inputs) {
    room.receiveInputs(client.player, [input])
    run(room, [client], 1)
  }
  const went = (client.player.position.x - start.x) / SUB
  assert.ok(went > 3, `it moves (${went.toFixed(1)} tiles)`)
  assert.ok(went < (60 * PUSH_MAX) / SUB / 2, `but nowhere near as far as sixty full pushes (${went.toFixed(1)} tiles)`)
})
