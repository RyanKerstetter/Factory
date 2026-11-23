import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  addItems,
  putIn,
  STATION_LAYOUT,
  animalDef,
  createEntity,
  EAT_COOLDOWN_TICKS,
  FOOD_SLOT,
  itemId,
  KEY_DOWN,
  NO_ITEM,
  playerInventory,
  stackLimit,
  STATION_RECIPES,
  SUB,
  TPS,
  type Entity,
} from '../packages/shared/src/index.ts'
import { run, TestClient } from './helpers.ts'

const center = (x: number, y: number): { x: number; y: number } => ({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })

function arena(code: string, items: Record<string, number> = {}): { room: GameRoom; client: TestClient } {
  const room = new GameRoom(code, 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Tester')
  run(room, [client], 5)
  Object.entries(items).forEach(([key, count], slot) => (client.player.inventory.slots[slot] = { item: itemId(key), count }))
  return { room, client }
}

test('what an animal drops, and what a player throws down, never lands on the far side of a fence', () => {
  const { room, client } = arena('PEN', { stick: 30 })
  // A pen of fences round a chicken; it lays, and its eggs stay in the pen.
  for (let x = 2; x <= 6; x++) for (const y of [2, 6]) room.world.addEntity(createEntity(1000 + x * 10 + y, 'fence', x, y, 0, NO_ITEM))
  for (let y = 3; y <= 5; y++) for (const x of [2, 6]) room.world.addEntity(createEntity(2000 + x * 10 + y, 'fence', x, y, 0, NO_ITEM))
  const hen = room.animals!.spawn(animalDef('chicken'), center(4, 4).x, center(4, 4).y, { sex: 'f' })
  for (let i = 0; i < 40; i++) {
    hen.x = center(3, 3).x
    hen.y = center(3, 3).y
    hen.nextLayAt = room.tick + 1
    run(room, [client], 2)
  }
  const eggs = room.world.allDrops().filter((drop) => drop.item === itemId('egg'))
  assert.ok(eggs.length > 10, `she laid (${eggs.length})`)
  for (const egg of eggs) {
    const x = egg.x / SUB
    const y = egg.y / SUB
    assert.ok(x > 2 && x < 7 && y > 2 && y < 7, `an egg at ${x.toFixed(2)}, ${y.toFixed(2)} stayed in the pen`)
  }
  // Thrown at a fence from just inside it: it stops at the fence.
  client.player.position = center(5, 4)
  client.command({ k: 'drop', from: { id: 0, i: 0 }, count: 1, x: center(12, 4).x, y: center(12, 4).y })
  run(room, [client], 3)
  const stick = room.world.allDrops().find((drop) => drop.item === itemId('stick'))
  assert.ok(stick && stick.x / SUB < 7, 'the stick did not go over the fence')
})

test('a wolf finds its way round a wall to a player behind it, rather than getting stuck on it', () => {
  const { room, client } = arena('PATH')
  // A wall of rocks (solid) between the wolf and the player, with ends to go round.
  for (let y = -4; y <= 4; y++) room.world.addEntity(createEntity(3000 + y, 'rock', 4, y, 0, NO_ITEM))
  client.player.position = center(1, 0)
  const wolf = room.animals!.spawn(animalDef('wolf'), center(7, 0).x, center(7, 0).y)
  room.animals!.damage(wolf.id, 1, client.player.position, room.tick, {}, client.player.id)
  run(room, [client], 5 * TPS)
  assert.ok(wolf.x < center(4, 0).x, `it got round (${(wolf.x / SUB).toFixed(1)}, ${(wolf.y / SUB).toFixed(1)})`)
})

test('a wolf that gives up runs home fast, and turns on whoever hits it on the way', () => {
  const { room, client } = arena('HOME', { bow: 1, arrow: 10 })
  const wolf = room.animals!.spawn(animalDef('wolf'), center(0, 0).x, center(0, 0).y)
  const leash = animalDef('wolf').hunt!.leash
  wolf.x = wolf.homeX + leash + 2 * SUB
  client.player.position = { x: wolf.x + 2 * SUB, y: wolf.y }
  room.animals!.damage(wolf.id, 1, client.player.position, room.tick, {}, client.player.id)
  run(room, [client], 8)
  assert.equal(wolf.target, 0, 'too far from home: it gives up')
  const from = wolf.x
  run(room, [client], TPS)
  const ran = (from - wolf.x) / SUB
  assert.ok(ran > (animalDef('wolf').speed * animalDef('wolf').hunt!.pace * TPS) / SUB, `it runs home faster than it hunts (${ran.toFixed(1)} tiles in a second)`)
  room.animals!.damage(wolf.id, 1, client.player.position, room.tick, {}, client.player.id)
  assert.equal(wolf.target, client.player.id, 'hit on the way, it turns')
})

test('a wolf bites only from close up', () => {
  const { room, client } = arena('BITE')
  const wolf = room.animals!.spawn(animalDef('wolf'), center(8, 0).x, center(8, 0).y)
  room.animals!.damage(wolf.id, 1, client.player.position, room.tick, {}, client.player.id)
  let closest = Number.POSITIVE_INFINITY
  const health = client.player.health
  for (let i = 0; i < 3 * TPS && client.player.health === health; i++) {
    run(room, [client], 1)
    closest = Math.hypot(wolf.x - client.player.position.x, wolf.y - client.player.position.y) / SUB
  }
  assert.ok(client.player.health < health, 'it bit')
  assert.ok(closest < 0.9, `from close up (${closest.toFixed(2)} tiles between their middles)`)
})

test('pressing Craft while the workbench makes something else does not stop it', () => {
  const room = new GameRoom('BUSY', 11, { dropsOnGround: false, animals: false, plants: false })
  const client = new TestClient(room, 'Maker')
  run(room, [client], 5)
  const bench = createEntity(500, 'workbench', 1, 0, 0, NO_ITEM) as Entity & { kind: 'workbench' }
  room.world.addEntity(bench)
  const recipes = STATION_RECIPES.workbench
  // Two recipes with no tool, made from plain items (not "any of a kind").
  const plain = (i: number): boolean => !recipes[i].tool && recipes[i].inputs.every(([match]) => typeof match === 'number')
  const first = recipes.findIndex((_, i) => plain(i))
  const second = recipes.findIndex((_, i) => i !== first && plain(i))
  // Into its input slots only, a kind to a slot (not spilling into its tool or output slot).
  const needs = new Map<number, number>()
  for (const [item, count] of [...recipes[first].inputs, ...recipes[second].inputs]) needs.set(item as number, (needs.get(item as number) ?? 0) + count * 2)
  ;[...needs].forEach(([item, count], i) => putIn(bench.inv, STATION_LAYOUT.workbench.inputs[i], item, count))
  client.command({ k: 'work', id: bench.id, recipe: first })
  run(room, [client], 3)
  assert.equal((room.world.entity(bench.id) as typeof bench).recipe, first + 1)
  client.command({ k: 'work', id: bench.id, recipe: second })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'busy')
  assert.equal((room.world.entity(bench.id) as typeof bench).recipe, first + 1, 'still on the first')
})

test('the food slot takes only food, fills with more of what it holds, and is eaten from on a cooldown', () => {
  const inventory = playerInventory()
  assert.equal(inventory.slots[FOOD_SLOT].only, 'food')
  inventory.slots[FOOD_SLOT] = { ...inventory.slots[FOOD_SLOT], item: itemId('cooked-steak'), count: 1 }
  addItems(inventory, itemId('cooked-steak'), 3)
  assert.equal(inventory.slots[FOOD_SLOT].count, 4, 'more steak goes onto it')
  addItems(inventory, itemId('berries'), 3)
  assert.equal(inventory.slots[FOOD_SLOT].count, 4, 'other food does not')
  const { room, client } = arena('FOOD')
  client.player.inventory.slots[FOOD_SLOT] = { ...client.player.inventory.slots[FOOD_SLOT], item: itemId('cooked-chicken'), count: 3 }
  client.player.health = 4
  client.command({ k: 'eat', slot: FOOD_SLOT })
  run(room, [client], 3)
  client.command({ k: 'eat', slot: FOOD_SLOT })
  run(room, [client], 3)
  assert.equal(client.player.inventory.slots[FOOD_SLOT].count, 2, 'once, then the cooldown')
  run(room, [client], EAT_COOLDOWN_TICKS)
  client.command({ k: 'eat', slot: FOOD_SLOT })
  run(room, [client], 3)
  assert.equal(client.player.inventory.slots[FOOD_SLOT].count, 1)
})

test('holding something that is not a weapon or a tool, there is no attack', () => {
  const { room, client } = arena('NOFIST', { log: 5 })
  const deer = room.animals!.spawn(animalDef('deer'), client.player.position.x + SUB / 2, client.player.position.y)
  const hp = deer.hp
  client.command({ k: 'attack', slot: 0, x: deer.x, y: deer.y})
  run(room, [client], 3)
  assert.equal(deer.hp, hp)
})

test('everyone is told what each player holds and wears, and sees their attacks', () => {
  const { room, client } = arena('GEAR', { axe: 1 })
  const other = new TestClient(room, 'Watcher')
  const seen: Array<{ k: string }> = []
  const receive = other.mirror.receiveLog.bind(other.mirror)
  other.mirror.receiveLog = (message) => {
    seen.push(...(message.ev as Array<{ k: string }>))
    receive(message)
  }
  client.command({ k: 'hold', slot: 0 })
  run(room, [client, other], 3)
  const gear = seen.filter((event) => event.k === 'gear') as unknown as Array<{ id: number; held: number }>
  assert.ok(gear.some((event) => event.id === client.player.id && event.held === itemId('axe')), 'the axe in hand')
  client.command({ k: 'attack', slot: 0, x: client.player.position.x + SUB, y: client.player.position.y})
  run(room, [client, other], 3)
  assert.ok(seen.some((event) => event.k === 'swung'), 'the swing')
})

test('a chest sorts, tops up the stacks it has (and no more), and takes a name', () => {
  const room = new GameRoom('CHEST2', 11, { dropsOnGround: false, animals: false, plants: false })
  const client = new TestClient(room, 'Keeper')
  run(room, [client], 5)
  const chest = createEntity(600, 'chest', 1, 0, 0, NO_ITEM) as Entity & { kind: 'chest' }
  chest.inv.slots[3] = { item: itemId('stone'), count: 4 }
  chest.inv.slots[0] = { item: itemId('log'), count: 5 }
  chest.inv.slots[7] = { item: itemId('stone'), count: 3 }
  room.world.addEntity(chest)
  const at = (): Entity & { kind: 'chest' } => room.world.entity(chest.id) as Entity & { kind: 'chest' }
  client.command({ k: 'chest', id: chest.id, action: 'sort' })
  run(room, [client], 3)
  const sorted = at().inv.slots.filter((slot) => slot.count > 0)
  assert.equal(sorted.length, 2, 'the stones are one stack')
  assert.ok(sorted[0].item < sorted[1].item, 'in item order')
  // Top up: 50 logs in the inventory (not the hotbar) and some sticks; the log stack fills to a full stack, no further,
  // and the sticks stay.
  client.player.inventory.slots[12] = { ...client.player.inventory.slots[12], item: itemId('log'), count: 50 }
  client.player.inventory.slots[13] = { ...client.player.inventory.slots[13], item: itemId('stick'), count: 9 }
  client.command({ k: 'chest', id: chest.id, action: 'stash' })
  run(room, [client], 3)
  const logs = at().inv.slots.filter((slot) => slot.item === itemId('log'))
  assert.equal(logs.length, 1, 'no new stack')
  assert.equal(logs[0].count, Math.min(50 + 5, stackLimit(itemId('log'), at().inv.stack)))
  assert.equal(client.player.inventory.slots[13].count, 9, 'nothing it did not have')
  client.command({ k: 'rename', id: chest.id, name: '  Wood  store ' })
  run(room, [client], 3)
  assert.equal(at().name, 'Wood store')
})

test('the stump makes a spear with a knife, and planks need an axe in the workbench too', () => {
  const stumpSpear = STATION_RECIPES.stump.find((recipe) => recipe.output === itemId('wood-spear'))
  assert.ok(stumpSpear && stumpSpear.tool === 'knife' && stumpSpear.inputs[0][0] === itemId('log'))
  const planks = STATION_RECIPES.workbench.find((recipe) => recipe.output === itemId('plank'))
  assert.equal(planks?.tool, 'axe')
})

test('a player cannot slip between two trees side by side', () => {
  const { room, client } = arena('TREES')
  // A row of trees across the way, and the player walking straight at the gap between two of them.
  for (let x = -3; x <= 3; x++) room.world.addEntity(createEntity(3000 + x, 'tree', x, 3, 0, NO_ITEM))
  client.player.position = { x: SUB, y: center(0, 1).y }
  for (let n = 1; n <= 3 * TPS; n++) {
    room.receiveInputs(client.player, [[n, KEY_DOWN]])
    run(room, [client], 1)
  }
  assert.ok(client.player.position.y < 3 * SUB, `stopped by the trees (at ${(client.player.position.y / SUB).toFixed(2)})`)
})

test('a drying rack is solid from post to post: nobody walks through it under the hide', async () => {
  const { boundsOf, stepPlayer, KEY_DOWN, SUB: UNIT } = await import('../packages/shared/src/index.ts')
  const solid = (x: number, y: number) => (x === 0 && y === 0 ? (boundsOf('rack') ?? true) : false)
  // Starting north of the rack, in the middle between its posts, walking south.
  let at = { x: UNIT / 2, y: -UNIT / 2 }
  for (let i = 0; i < 60; i++) at = stepPlayer(at, KEY_DOWN, solid)
  assert.ok(at.y < 0.42 * UNIT, `walked to ${at.y / UNIT} tiles, through the rack`)
})
