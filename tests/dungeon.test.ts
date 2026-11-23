import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import { BOSS_AIR, BOSS_COLD_EVERY, TRAP_ACTIVE, TRAP_DAMAGE, TRAP_DELAY, TRAP_RECHARGE } from '../apps/server/src/dungeons.ts'
import { Combat } from '../apps/server/src/combat.ts'
import { CAST_EVERY, CAST_TICKS, LichFight } from '../apps/server/src/frost-lich.ts'
import { Monsters, type Monster } from '../apps/server/src/monsters.ts'
import {
  airTemperatureAt,
  ANIMALS,
  BOSS_HALL_RADIUS,
  biomeAt,
  campSites,
  DUNGEON_LAYOUT,
  DUNGEON_TRAPS,
  dungeonBlocks,
  dungeonEntrance,
  dungeonSlotAt,
  dungeonTile,
  FactoryWorld,
  inBossHall,
  isInDungeons,
  itemId,
  MONSTERS,
  monsterDef,
  PLAYER_SPEED,
  Rng,
  SNOW_STARTS_AT,
  SUB,
  TPS,
  WEAPONS,
} from '../packages/shared/src/index.ts'
import { run, TestClient } from './helpers.ts'

const center = (x: number, y: number): { x: number; y: number } => ({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })
const tileOf = (position: { x: number; y: number }): { x: number; y: number } => ({ x: Math.floor(position.x / SUB), y: Math.floor(position.y / SUB) })

// Bare ground with no wild animals or camps, and a player at the spawn.
function arena(code: string): { room: GameRoom; client: TestClient } {
  const room = new GameRoom(code, 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Fighter')
  run(room, [client], 5)
  return { room, client }
}

// A small world with the dungeon in it, and a player taken into a copy (its slot).
function inDungeon(code: string, name = 'Delver'): { room: GameRoom; client: TestClient; slot: number } {
  const room = new GameRoom(code, 7, { terrain: { size: 'small' } })
  const client = new TestClient(room, name)
  const entrance = dungeonEntrance(room.terrain)!
  client.player.position = center(entrance.x, entrance.y)
  run(room, [client], 3)
  const slot = dungeonSlotAt(tileOf(client.player.position).x, tileOf(client.player.position).y)!
  assert.notEqual(slot, undefined, 'taken into a copy')
  return { room, client, slot }
}

// A floor tile of copy 0 with a wall one tile thick to its north, and floor beyond.
function thinWall(): { x: number; y: number } {
  for (let y = 3; y < DUNGEON_LAYOUT.height; y++) {
    for (let x = 0; x < DUNGEON_LAYOUT.width; x++) {
      const tile = dungeonTile(0, { x, y })
      if (!dungeonBlocks(tile.x, tile.y) && dungeonBlocks(tile.x, tile.y - 1) && !dungeonBlocks(tile.x, tile.y - 2)) return tile
    }
  }
  throw new Error('no thin wall in the layout')
}

const killAll = (room: GameRoom, test: (monster: Monster) => boolean): void => {
  for (const monster of room.monsters!.list()) if (test(monster)) room.monsters!.damage(monster.id, 1_000_000, monster, room.tick, { knockback: 0, stun: 0 }, 0)
}

test('monsters are not animals: none is in animals.json, and they have no breeding, hunger, growth or stats', () => {
  const raw = JSON.parse(readFileSync('data/monsters.json', 'utf-8')) as Record<string, Record<string, unknown>>
  for (const [kind, def] of Object.entries(raw)) {
    for (const field of ['life', 'stats', 'herd', 'foods', 'grazes', 'temper', 'population']) assert.equal(def[field], undefined, `${kind} has no ${field}`)
    assert.ok(!ANIMALS.some((animal) => animal.kind === kind), `${kind} is not an animal`)
  }
  assert.deepEqual(MONSTERS.map((def) => def.kind).sort(), ['frost-lich', 'frost-wisp', 'skeleton', 'skeleton-archer'])
})

test('close in, a skeleton winds up a swing (the pages are told which way), is not knocked back while it does, swings, and stands a moment before going again', () => {
  const { room, client } = arena('SWING')
  client.player.inventory.slots[0] = { item: itemId('club'), count: 1 }
  client.player.health = 100_000
  const at = client.player.position
  const skeleton = room.monsters!.spawn(monsterDef('skeleton'), at.x + Math.round(1.1 * SUB), at.y)
  room.monsters!.provoke(skeleton.id, client.player.id, room.tick)
  let ticks = 0
  while (skeleton.act?.k !== 'swing' && ticks++ < 3 * TPS) {
    client.player.position = { ...at }
    run(room, [client], 1)
  }
  assert.equal(skeleton.act?.k, 'swing', 'it winds up')
  assert.equal(room.monsters!.info(skeleton).act?.k, 'swing', 'and the pages hear of it')
  // Hit while it winds up: hurt, but not knocked back.
  const where = { x: skeleton.x, y: skeleton.y }
  const hp = skeleton.hp
  client.command({ k: 'attack', slot: 0, x: skeleton.x, y: skeleton.y })
  run(room, [client], 3)
  assert.ok(skeleton.hp < hp, 'hurt')
  assert.deepEqual({ x: skeleton.x, y: skeleton.y }, where, 'not knocked back')
  const attack = monsterDef('skeleton').attack
  assert.equal(attack.kind, 'blade')
  if (attack.kind !== 'blade') return
  const before = client.player.health
  // Past the moment's grace after a hit (none here yet, but to be sure).
  client.player.graceUntil = 0
  ticks = 0
  while (skeleton.act?.k === 'swing' && ticks++ < 2 * TPS) {
    client.player.position = { ...at }
    run(room, [client], 1)
  }
  assert.equal(before - client.player.health, attack.swing.damage, 'the swing lands')
  assert.equal(skeleton.act?.k, 'recover', 'and it stands a moment')
  // Not again until it has recovered and cooled down.
  for (let i = 0; i < attack.recover + attack.cooldown - 2; i++) {
    client.player.position = { ...at }
    run(room, [client], 1)
    assert.notEqual(skeleton.act?.k, 'swing', 'no windup straight away')
  }
})

test('from further off, a skeleton winds up a charge at where the player was, then dashes through them; one who keeps moving gets out of the way', () => {
  const attack = monsterDef('skeleton').attack
  assert.ok(attack.kind === 'blade')
  const charge = attack.charge
  assert.ok(charge.windup >= TPS - 1, 'a second of windup')
  // Standing still: it charges straight through them.
  const still = arena('CHARGE')
  still.client.player.health = 100_000
  const at = { ...still.client.player.position }
  const skeleton = still.room.monsters!.spawn(monsterDef('skeleton'), at.x + 4 * SUB, at.y)
  still.room.monsters!.provoke(skeleton.id, still.client.player.id, still.room.tick)
  let ticks = 0
  while (skeleton.act?.k !== 'charge' && ticks++ < 2 * TPS) {
    still.client.player.position = { ...at }
    run(still.room, [still.client], 1)
  }
  assert.equal(skeleton.act?.k, 'charge', 'it winds up a charge from four tiles off')
  assert.equal(still.room.monsters!.info(skeleton).act?.k, 'charge', 'and the pages hear of it')
  const before = still.client.player.health
  ticks = 0
  while ((skeleton.act?.k as string | undefined) !== 'recover' && ticks++ < 3 * TPS) {
    if (skeleton.act?.k === 'charge') still.client.player.position = { ...at }
    run(still.room, [still.client], 1)
  }
  assert.equal(before - still.client.player.health, charge.damage, 'the dash goes through them')
  assert.ok(skeleton.x < at.x, `and out the other side (${((skeleton.x - at.x) / SUB).toFixed(1)} tiles)`)

  // Walking across its path all through the windup: it dashes where they were, behind them.
  const moving = arena('DODGE')
  moving.client.player.health = 100_000
  const start = { ...moving.client.player.position }
  const runner = moving.room.monsters!.spawn(monsterDef('skeleton'), start.x + 4 * SUB, start.y)
  moving.room.monsters!.provoke(runner.id, moving.client.player.id, moving.room.tick)
  ticks = 0
  while (runner.act?.k !== 'charge' && ticks++ < 2 * TPS) {
    moving.client.player.position = { ...start }
    run(moving.room, [moving.client], 1)
  }
  assert.equal(runner.act?.k, 'charge')
  const health = moving.client.player.health
  ticks = 0
  while ((runner.act?.k as string | undefined) !== 'recover' && ticks++ < 3 * TPS) {
    // Walking south, about as fast as a player walks.
    moving.client.player.position = { x: moving.client.player.position.x, y: moving.client.player.position.y + 45 }
    run(moving.room, [moving.client], 1)
  }
  assert.equal(moving.client.player.health, health, 'missed')
})

test('hit when it is not attacking, a monster is knocked back and stunned for a moment, and goes for whoever hit it', () => {
  const { room, client } = arena('STAGGER')
  client.player.inventory.slots[0] = { item: itemId('club'), count: 1 }
  const at = client.player.position
  const skeleton = room.monsters!.spawn(monsterDef('skeleton'), at.x + SUB, at.y)
  // Out of the way of its own attacks: it has only just noticed.
  skeleton.readyAt = room.tick + 10 * TPS
  const startX = skeleton.x
  client.command({ k: 'attack', slot: 0, x: skeleton.x, y: skeleton.y })
  run(room, [client], 2)
  assert.ok(skeleton.stunnedUntil > room.tick, 'stunned')
  assert.equal(skeleton.target, client.player.id, 'after whoever hit it')
  run(room, [client], 4)
  assert.ok(skeleton.x - startX > SUB / 4, `knocked back (${((skeleton.x - startX) / SUB).toFixed(2)} tiles)`)
})

test('a skeleton archer comes into range, aims, and looses a fast arrow that flies through other skeletons', () => {
  const { room, client } = arena('ARCHER')
  client.player.health = 100_000
  const at = client.player.position
  const def = monsterDef('skeleton-archer')
  const shoot = def.attack
  assert.equal(shoot.kind, 'bow')
  if (shoot.kind !== 'bow') return
  assert.ok(shoot.range >= 7 * SUB && shoot.speed * TPS <= 16 * SUB && shoot.aim <= TPS, 'far, quick to aim, but a slow enough arrow to step out of')
  assert.ok(shoot.lead > 0, 'aimed a little behind the player')
  const archer = room.monsters!.spawn(def, at.x + 11 * SUB, at.y)
  const between = room.monsters!.spawn(monsterDef('skeleton'), at.x + 3 * SUB, at.y)
  room.monsters!.provoke(archer.id, client.player.id, room.tick)
  let aimedAt = 0
  let shotAt = 0
  for (let i = 0; i < 6 * TPS && shotAt === 0; i++) {
    client.player.position = { ...at }
    Object.assign(between, { x: at.x + 3 * SUB, y: at.y, target: 0, act: undefined })
    run(room, [client], 1)
    if (aimedAt === 0 && archer.act?.k === 'aim') {
      aimedAt = room.tick
      assert.ok(Math.hypot(archer.x - at.x, archer.y - at.y) <= shoot.range, 'it comes into range first')
    }
    if (room.combat.inChunks(client.player.chunks, room.tick).some(([, item]) => item === itemId('arrow'))) shotAt = room.tick
  }
  assert.ok(aimedAt > 0 && shotAt - aimedAt >= shoot.aim - 1, `it aims for ${shotAt - aimedAt} ticks`)
  const healthBefore = client.player.health
  const betweenHp = between.hp
  for (let i = 0; i < TPS; i++) {
    client.player.position = { ...at }
    Object.assign(between, { x: at.x + 3 * SUB, y: at.y })
    run(room, [client], 1)
  }
  assert.ok(client.player.health < healthBefore, 'the arrow reaches the player')
  assert.equal(between.hp, betweenHp, 'through the skeleton in the way')
})

test('a skeleton that sees a player goes for them and calls the others near it; one behind a wall does not notice', () => {
  const { room, client } = arena('SKEL')
  const skeleton = monsterDef('skeleton')
  const at = client.player.position
  const a = room.monsters!.spawn(skeleton, at.x + 5 * SUB, at.y)
  const b = room.monsters!.spawn(skeleton, at.x + 12 * SUB, at.y)
  const far = room.monsters!.spawn(skeleton, at.x + 40 * SUB, at.y)
  run(room, [client], 8)
  assert.equal(a.target, client.player.id, 'the near one comes')
  assert.equal(b.target, client.player.id, 'and calls the one near it')
  assert.equal(far.target, 0, 'but not one far off')
  // In the crypt, a player behind a wall is not seen: a skeleton just the far side of a wall from them.
  const crypt = new GameRoom('SKEL2', 11, { wildAnimals: false, plants: false, animals: true })
  const delver = new TestClient(crypt, 'Delver')
  const front = thinWall()
  delver.player.position = center(front.x, front.y)
  run(crypt, [delver], 3)
  const behind = { x: front.x, y: front.y - 2 }
  assert.ok(Math.hypot(front.x - behind.x, front.y - behind.y) <= skeleton.aggroRadius / SUB, 'near enough to notice')
  const hidden = crypt.monsters!.spawn(skeleton, center(behind.x, behind.y).x, center(behind.x, behind.y).y, { dungeon: 0 })
  run(crypt, [delver], 8)
  assert.equal(hidden.target, 0, 'the wall hides the player')
})

test('a swing reaches through a wall (only what flies is stopped by one)', () => {
  const { room, client } = arena('WALLHIT')
  client.player.inventory.slots[0] = { item: itemId('flint-spear'), count: 1 }
  const found = thinWall()
  client.player.position = center(found.x, found.y)
  run(room, [client], 3)
  const skeleton = room.monsters!.spawn(monsterDef('skeleton'), center(found.x, found.y - 2).x, center(found.x, found.y - 2).y, { dungeon: 0 })
  skeleton.stunnedUntil = Number.MAX_SAFE_INTEGER
  const spear = WEAPONS.get('flint-spear')!
  assert.ok(spear.range + monsterDef('skeleton').halfSize >= 2 * SUB, 'it would reach')
  const hp = skeleton.hp
  client.command({ k: 'attack', slot: 0, x: skeleton.x, y: skeleton.y })
  run(room, [client], 3)
  assert.ok(skeleton.hp < hp, 'hit behind the wall')
})

test('skeleton camps keep four or five, one or two of them archers; they patrol round the camp, all come when one is alerted, drop bones and essence, and come back a while after they are killed', () => {
  const room = new GameRoom('BONES', 7, { terrain: { size: 'small' } })
  const client = new TestClient(room, 'Raider')
  const camps = campSites(room.terrain)
  assert.ok(camps.length > 0, 'the mountains have camps')
  const camp = camps[0]
  assert.ok(biomeAt(room.terrain, camp.x, camp.y)?.key === 'mountain')
  // Near enough for the camp to matter, but out of sight of it.
  client.player.position = center(camp.x + 24, camp.y)
  run(room, [client], 2 * TPS)
  const guards = (): Monster[] => room.monsters!.list().filter((monster) => monster.post?.camp === 0)
  const first = guards()
  assert.ok(first.length >= 4 && first.length <= 5, `the camp is kept (${first.length})`)
  const archers = first.filter((guard) => guard.def.kind === 'skeleton-archer').length
  assert.ok(archers >= 1 && archers <= 2, `one or two archers (${archers})`)
  const middle = center(camp.x, camp.y)
  const from = (guard: Monster): number => Math.hypot(guard.x - middle.x, guard.y - middle.y) / SUB
  assert.ok(first.every((guard) => from(guard) < 6), 'round the fire at first')
  // Left alone, they walk about the camp, further out than where they started, and keep within their patrol.
  let furthest = 0
  for (let i = 0; i < 40; i++) {
    run(room, [client], TPS)
    for (const guard of guards()) furthest = Math.max(furthest, from(guard))
  }
  assert.ok(furthest > 4, `they patrol (out to ${furthest.toFixed(1)} tiles)`)
  assert.ok(guards().every((guard) => from(guard) < 13), 'within their patrol')
  // One alerted: the whole camp comes, wherever each is.
  const [one, ...rest] = guards()
  room.monsters!.damage(one.id, 1, client.player.position, room.tick, { knockback: 0, stun: 0 }, client.player.id)
  assert.ok(rest.every((guard) => guard.target === client.player.id), 'the whole camp is alerted')
  const plain = first.find((guard) => guard.def.kind === 'skeleton')!
  const drops = room.monsters!.damage(plain.id, 1_000_000, client.player.position, room.tick, { knockback: 0, stun: 0 }, client.player.id)!
  assert.deepEqual(drops.map(([key]) => key).sort(), ['bone', 'essence'])
  killAll(room, (monster) => monster.post?.camp === 0)
  run(room, [client], 2 * TPS)
  assert.equal(guards().length, 0, 'not back at once')
  run(room, [client], 150 * TPS)
  assert.equal(guards().length, first.length, 'back after a while')
})

test("the dungeon's rooms: no guard is near enough to notice a player in another room, and the way from the stairs to the door goes through every room", () => {
  const posts = [
    ...DUNGEON_LAYOUT.guards.map((at) => ({ at, aggro: monsterDef('skeleton').aggroRadius / SUB })),
    ...DUNGEON_LAYOUT.archers.map((at) => ({ at, aggro: monsterDef('skeleton-archer').aggroRadius / SUB })),
  ]
  const floor = (x: number, y: number): boolean => {
    const tile = dungeonTile(0, { x, y })
    return !dungeonBlocks(tile.x, tile.y)
  }
  // Guards near together (closer than ROOM_SPAN) are in one room.
  const ROOM_SPAN = 14
  const room = posts.map((_, i) => i)
  const find = (i: number): number => (room[i] === i ? i : (room[i] = find(room[i])))
  for (let i = 0; i < posts.length; i++) {
    for (let j = i + 1; j < posts.length; j++) {
      if (Math.hypot(posts[i].at.x - posts[j].at.x, posts[i].at.y - posts[j].at.y) < ROOM_SPAN) room[find(i)] = find(j)
    }
  }
  const rooms = new Set(posts.map((_, i) => find(i)))
  assert.equal(rooms.size, 3, 'three rooms of guards')
  for (let i = 0; i < posts.length; i++) {
    for (let j = i + 1; j < posts.length; j++) {
      if (find(i) === find(j)) continue
      const distance = Math.hypot(posts[i].at.x - posts[j].at.x, posts[i].at.y - posts[j].at.y)
      assert.ok(distance > posts[i].aggro + posts[j].aggro, `guards ${i} and ${j}, in different rooms, are ${distance.toFixed(1)} tiles apart`)
    }
  }
  // The shortest way from the stairs to the door passes within notice of every room's guards.
  const { start, door } = DUNGEON_LAYOUT
  const came = new Map<string, string>([[`${start.x},${start.y}`, '']])
  const queue = [start]
  while (queue.length > 0) {
    const at = queue.shift()!
    if (at.x === door.x && at.y === door.y) break
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: at.x + dx, y: at.y + dy }
      const key = `${next.x},${next.y}`
      if (came.has(key) || !floor(next.x, next.y)) continue
      came.set(key, `${at.x},${at.y}`)
      queue.push(next)
    }
  }
  const way: Array<{ x: number; y: number }> = []
  for (let key = `${door.x},${door.y}`; key; key = came.get(key)!) {
    const [x, y] = key.split(',').map(Number)
    way.push({ x, y })
  }
  assert.ok(way.length > 1 && came.has(`${door.x},${door.y}`), 'the door can be reached')
  for (const id of rooms) {
    const guards = posts.filter((_, i) => find(i) === id)
    assert.ok(way.some((tile) => guards.some((guard) => Math.hypot(tile.x - guard.at.x, tile.y - guard.at.y) <= guard.aggro)), 'the way goes through the room')
  }
})

test('the dungeon: deep in the snow, a copy each, its guards in their rooms, and the stairs back out; a copy nobody is in is cleared away', () => {
  const { room, client, slot } = inDungeon('CRYPT')
  const entrance = dungeonEntrance(room.terrain)!
  assert.ok(airTemperatureAt(room.terrain, entrance.x, entrance.y) <= SNOW_STARTS_AT - 10, 'deep in the snow')
  const start = dungeonTile(slot, DUNGEON_LAYOUT.start)
  assert.deepEqual(client.player.position, center(start.x, start.y))
  run(room, [client], 2)
  const monsters = room.monsters!.list().filter((monster) => monster.dungeon === slot)
  assert.equal(monsters.filter((monster) => monster.def.kind === 'skeleton').length, DUNGEON_LAYOUT.guards.length)
  assert.equal(monsters.filter((monster) => monster.def.kind === 'skeleton-archer').length, DUNGEON_LAYOUT.archers.length)
  assert.ok(monsters.some((monster) => monster.def.kind === 'frost-lich'), 'the frost lich is in its hall')
  // A friend who comes in now joins the same copy.
  const friend = new TestClient(room, 'Friend')
  friend.player.position = center(entrance.x, entrance.y)
  run(room, [client, friend], 2)
  assert.equal(dungeonSlotAt(tileOf(friend.player.position).x, tileOf(friend.player.position).y), slot)
  // The stairs out, for both; the copy is cleared away once nobody is in it.
  const exit = dungeonTile(slot, DUNGEON_LAYOUT.exit)
  client.player.position = center(exit.x, exit.y)
  friend.player.position = center(exit.x, exit.y)
  run(room, [client, friend], 2)
  assert.ok(!isInDungeons(tileOf(client.player.position).x, tileOf(client.player.position).y), 'back outside')
  run(room, [client, friend], 25 * TPS)
  assert.equal(room.dungeons.openCount, 0, 'cleared away')
  assert.equal(room.monsters!.list().filter((monster) => monster.dungeon === slot).length, 0)
})

test('the way out at the back of the lich\'s hall is sealed with ice until the lich falls, and then takes a player back outside', () => {
  const { room, client, slot } = inDungeon('HALLEXIT')
  run(room, [client], 2)
  const exit = dungeonTile(slot, DUNGEON_LAYOUT.hallExit)
  assert.ok(inBossHall(slot, exit.x, exit.y), 'it is in the hall')
  assert.equal(room.world.entityAt(exit.x, exit.y)?.kind, 'door', 'sealed while the lich stands')
  killAll(room, (monster) => monster.dungeon === slot)
  run(room, [client], 2)
  assert.equal(room.world.entityAt(exit.x, exit.y), undefined, 'open once it has fallen')
  client.player.position = center(exit.x, exit.y)
  run(room, [client], 2)
  assert.ok(!isInDungeons(tileOf(client.player.position).x, tileOf(client.player.position).y), 'back outside')
})

test('spike traps: stepping on one sets it off; its spikes come up a moment later, for a second, hurting whoever is on them once; then it recharges', () => {
  const { room, client, slot } = inDungeon('SPIKES')
  killAll(room, (monster) => monster.dungeon === slot && !monster.def.boss)
  const index = DUNGEON_TRAPS.findIndex((trap) => !trap.wall && trap.tiles.length >= 3)
  assert.ok(index >= 0, 'spikes across a corridor')
  const on = dungeonTile(slot, DUNGEON_TRAPS[index].tiles[1])
  const off = { x: on.x, y: on.y + 2 }
  assert.ok(!dungeonBlocks(off.x, off.y))
  client.player.health = 100_000
  const stand = (tile: { x: number; y: number }, ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      client.player.position = center(tile.x, tile.y)
      run(room, [client], 1)
    }
  }
  stand(on, TRAP_DELAY - 1)
  assert.equal(client.player.health, 100_000, 'not straight away')
  stand(on, 3)
  assert.equal(100_000 - client.player.health, TRAP_DAMAGE, 'then the spikes, once')
  stand(on, TRAP_ACTIVE)
  assert.equal(100_000 - client.player.health, TRAP_DAMAGE, 'only once while they are up')
  // While it recharges, walking over it is safe.
  stand(off, 5)
  stand(on, TRAP_DELAY + 5)
  assert.equal(100_000 - client.player.health, TRAP_DAMAGE, 'safe while it recharges')
  stand(off, TRAP_RECHARGE)
  stand(on, TRAP_DELAY + 3)
  assert.equal(100_000 - client.player.health, 2 * TRAP_DAMAGE, 'set off again once it has recharged')
})

test('a monster stepping on a spike trap sets it off and is hurt by it too', () => {
  const { room, client, slot } = inDungeon('SPIKEBONES')
  killAll(room, (monster) => monster.dungeon === slot && !monster.def.boss)
  const index = DUNGEON_TRAPS.findIndex((trap) => !trap.wall && trap.tiles.length >= 3)
  const on = dungeonTile(slot, DUNGEON_TRAPS[index].tiles[1])
  client.player.health = 100_000
  const skeleton = room.monsters!.spawn(monsterDef('skeleton'), center(on.x, on.y).x, center(on.x, on.y).y, { dungeon: slot })
  const whole = skeleton.hp
  for (let i = 0; i < TRAP_DELAY + 3; i++) {
    Object.assign(skeleton, center(on.x, on.y))
    run(room, [client], 1)
  }
  assert.ok(skeleton.hp < whole, `the skeleton is hurt (${skeleton.hp} of ${whole})`)
  assert.equal(client.player.health, 100_000, 'the player, elsewhere, is not')
})

test("the door to the frost lich's rooms stays shut until every guard is dead; crossing the line starts the fight, shuts the door behind everyone in the lich's rooms, and the lich's health grows with them", () => {
  const { room, client, slot } = inDungeon('LICH')
  const friend = new TestClient(room, 'Friend')
  const late = new TestClient(room, 'Late')
  const entrance = dungeonEntrance(room.terrain)!
  friend.player.position = center(entrance.x, entrance.y)
  late.player.position = center(entrance.x, entrance.y)
  const all = [client, friend, late]
  run(room, all, 3)
  const door = dungeonTile(slot, DUNGEON_LAYOUT.door)
  assert.equal(room.world.entityAt(door.x, door.y)?.kind, 'door', 'shut while the guards stand')
  killAll(room, (monster) => monster.dungeon === slot && !monster.def.boss)
  run(room, all, 2)
  assert.equal(room.dungeons.guardsLeft(slot, room.monsters), 0)
  assert.equal(room.world.entityAt(door.x, door.y), undefined, 'open once they are all dead')
  // Two wait in the waiting room; one is still out in the crypt.
  const waiting = dungeonTile(slot, { x: DUNGEON_LAYOUT.door.x, y: DUNGEON_LAYOUT.door.y - 3 })
  client.player.position = center(waiting.x - 1, waiting.y)
  friend.player.position = center(waiting.x + 1, waiting.y)
  late.player.position = center(door.x, door.y + 4)
  for (const player of all) player.player.health = 100_000
  run(room, all, 5)
  assert.ok(!room.dungeons.fighting(slot), 'waiting is not fighting')
  // Over the line.
  const line = dungeonTile(slot, { x: DUNGEON_LAYOUT.door.x, y: DUNGEON_LAYOUT.line - 1 })
  client.player.position = center(line.x, line.y)
  run(room, all, 2)
  assert.ok(room.dungeons.fighting(slot), 'the fight is on')
  assert.equal(room.world.entityAt(door.x, door.y)?.kind, 'door', 'and the door shut')
  const lich = room.monsters!.list().find((monster) => monster.dungeon === slot && monster.def.boss)!
  assert.equal(lich.maxHp, Math.round(monsterDef('frost-lich').hp * 1.8), 'two players: 1.8 times its health')
  assert.equal(room.dungeons.airAt(line.x, line.y), BOSS_AIR, 'cold enough that only the warmest armour keeps a player moving')
  // The one in the waiting room can still go in; the one outside cannot.
  friend.player.position = center(line.x + 1, line.y)
  run(room, all, 2)
  assert.ok(inBossHall(slot, tileOf(friend.player.position).x, tileOf(friend.player.position).y))
  run(room, all, BOSS_COLD_EVERY * 2)
  assert.ok(room.dungeons.airAt(line.x, line.y)! <= BOSS_AIR - 2, 'colder as it goes on')
  // The lich never moves, whatever hits it.
  const where = { x: lich.x, y: lich.y }
  room.monsters!.damage(lich.id, 10, { x: lich.x - SUB, y: lich.y }, room.tick, { knockback: 3 * SUB, stun: TPS }, client.player.id)
  run(room, all, 10)
  assert.deepEqual({ x: lich.x, y: lich.y }, where)
  // Everyone out of the lich's rooms: given up, the lich whole again, and the door open.
  const outside = dungeonTile(slot, DUNGEON_LAYOUT.start)
  client.player.position = center(outside.x, outside.y)
  friend.player.position = center(outside.x, outside.y)
  run(room, all, 4 * TPS)
  assert.ok(!room.dungeons.fighting(slot), 'given up')
  assert.equal(lich.hp, monsterDef('frost-lich').hp, 'whole again, at its own health')
  assert.equal(room.world.entityAt(door.x, door.y), undefined, 'the door open again')
})

// A lich in slot 0's hall with its fight, and a player somewhere, outside any room: for its spells alone.
function lichFight(seed = 5): { monsters: Monsters; lich: Monster; fight: LichFight; combat: Combat; hurt: number[] } {
  const monsters = new Monsters(seed, false)
  const middle = center(dungeonTile(0, DUNGEON_LAYOUT.boss).x, dungeonTile(0, DUNGEON_LAYOUT.boss).y)
  const lich = monsters.spawn(monsterDef('frost-lich'), middle.x, middle.y, { dungeon: 0 })
  const hurt: number[] = []
  const combat = new Combat(new FactoryWorld(), [], { near: () => [], hurt: () => undefined, everyone: () => [], position: () => undefined })
  return { monsters, lich, fight: new LichFight(0, new Rng(seed)), combat, hurt }
}

test('the frost lich casts on a fixed beat, showing its cast first: a close spell when more players are close, a far one when more are far', () => {
  for (const [where, close] of [[2, true], [9, false]] as const) {
    const { monsters, lich, fight, combat, hurt } = lichFight()
    const players = [{ id: 1, position: { x: lich.x + where * SUB, y: lich.y } }]
    const spells: string[] = []
    const castsAt: number[] = []
    for (let tick = 0; tick < 6 * CAST_EVERY; tick++) {
      fight.step({ tick, slot: 0, monsters, combat, hurtPlayer: (_, damage) => hurt.push(damage), spell: () => undefined }, lich, players)
      if (lich.casting && castsAt.at(-1) !== lich.casting.at) {
        castsAt.push(lich.casting.at)
        spells.push(lich.casting.spell)
        assert.equal(lich.casting.ticks, CAST_TICKS)
      }
    }
    assert.ok(castsAt.length >= 5, 'it keeps casting')
    for (let i = 1; i < castsAt.length; i++) assert.equal(castsAt[i] - castsAt[i - 1], CAST_EVERY, 'on a fixed beat')
    const kinds = close ? ['blizzard', 'wisps'] : ['icicles', 'shards']
    assert.ok(spells.every((spell) => spell === 'summon' || kinds.includes(spell)), `${close ? 'close' : 'far'}: ${spells.join(', ')}`)
  }
})

test("the lich's blizzard hurts whoever stands in it, armour or not; its wisps come on a ring halfway out, away from the players, and go after them slower than one runs", () => {
  const { monsters, lich, fight, combat } = lichFight(9)
  const near = { id: 1, position: { x: lich.x + 2 * SUB, y: lich.y } }
  let blizzard = 0
  let wispSeen: Monster | undefined
  const pierced: boolean[] = []
  for (let tick = 0; tick < 12 * CAST_EVERY && (!blizzard || !wispSeen); tick++) {
    fight.step(
      {
        tick,
        slot: 0,
        monsters,
        combat,
        hurtPlayer: (_, __, ___, ____, pierce) => {
          blizzard++
          pierced.push(pierce === true)
        },
        spell: () => undefined,
      },
      lich,
      [near],
    )
    const wisp = monsters.list().find((monster) => monster.def.kind === 'frost-wisp')
    if (wisp && !wispSeen) {
      wispSeen = wisp
      const out = Math.hypot(wisp.x - lich.x, wisp.y - lich.y) / SUB
      assert.ok(Math.abs(out - BOSS_HALL_RADIUS / 2) < 0.6, `halfway out (${out.toFixed(2)} tiles)`)
      assert.ok(Math.hypot(wisp.x - near.position.x, wisp.y - near.position.y) >= 3 * SUB - 1, 'not near the player')
    }
  }
  assert.ok(blizzard > 0 && pierced.every(Boolean), 'the blizzard hurt the player, through any armour')
  assert.ok(wispSeen, 'wisps came')
  assert.ok(monsterDef('frost-wisp').speed < PLAYER_SPEED, 'slower than a player')
})

test('a frozen wisp drifts after the nearest player, bursts against them, and is gone after fifteen seconds if it never reaches one', () => {
  const { room, client } = arena('WISP')
  client.player.health = 100_000
  const at = client.player.position
  const wisp = room.monsters!.spawn(monsterDef('frost-wisp'), at.x + 4 * SUB, at.y)
  for (let i = 0; i < 3 * TPS && room.monsters!.get(wisp.id); i++) {
    client.player.position = { ...at }
    run(room, [client], 1)
  }
  assert.equal(room.monsters!.get(wisp.id), undefined, 'it burst')
  assert.ok(client.player.health < 100_000, 'against the player')
  const lonely = room.monsters!.spawn(monsterDef('frost-wisp'), at.x + 80 * SUB, at.y)
  run(room, [client], 15 * TPS + 2)
  assert.equal(room.monsters!.get(lonely.id), undefined, 'gone after its fifteen seconds')
})

test('now and then the lich calls up three archers for each player round the edge of its hall, and not again until they are dead and it has cast ten times since', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { monsters, lich, fight, combat } = lichFight(seed)
    const players = [{ id: 1, position: { x: lich.x + 4 * SUB, y: lich.y } }]
    let casts = 0
    const summons: number[] = []
    let checked = false
    for (let tick = 0; tick < 80 * CAST_EVERY; tick++) {
      const before = lich.casting?.at
      fight.step({ tick, slot: 0, monsters, combat, hurtPlayer: () => undefined, spell: () => undefined }, lich, players)
      if (lich.casting && lich.casting.at !== before) {
        casts++
        if (lich.casting.spell === 'summon') summons.push(casts)
      }
      const archers = monsters.list().filter((monster) => monster.def.kind === 'skeleton-archer')
      if (archers.length > 0 && !checked) {
        checked = true
        assert.equal(archers.length, 3, 'three for the one player')
        assert.ok(archers.every((archer) => archer.target === 1), 'set on the player')
        assert.ok(archers.every((archer) => Math.hypot(archer.x - lich.x, archer.y - lich.y) > (BOSS_HALL_RADIUS - 3) * SUB), 'round the edge')
      }
      // The archers are killed a while after they come.
      if (archers.length > 0 && tick % (4 * CAST_EVERY) === 0) for (const archer of archers) monsters.damage(archer.id, 1_000_000, archer, tick, { knockback: 0, stun: 0 }, 1)
    }
    if (summons.length < 2) continue
    for (let i = 1; i < summons.length; i++) assert.ok(summons[i] - summons[i - 1] >= 10, `ten casts apart at least (${summons.join(', ')})`)
    return
  }
  assert.fail('no seed saw two summonings in eighty casts')
})

test("hitting any one guard wakes every guard in its room, in every room", () => {
  const { room, client, slot } = inDungeon('WAKEROOM')
  const guards = room.monsters!.list().filter((monster) => monster.dungeon === slot && !monster.def.boss)
  // Guards near together (closer than 14 tiles, as in the test above) are in one room.
  const rooms: Monster[][] = []
  for (const guard of guards) {
    const near = rooms.find((list) => list.some((other) => Math.hypot(other.x - guard.x, other.y - guard.y) < 14 * SUB))
    if (near) near.push(guard)
    else rooms.push([guard])
  }
  assert.equal(rooms.length, 3, 'three rooms of guards')
  for (const list of rooms) {
    for (const hit of list) {
      for (const guard of list) guard.target = 0
      room.monsters!.damage(hit.id, 1, hit, room.tick, { knockback: 0, stun: 0 }, client.player.id)
      for (const guard of list) assert.equal(guard.target, client.player.id, `hitting the ${hit.def.kind} at ${hit.x},${hit.y} wakes the ${guard.def.kind} at ${guard.x},${guard.y}`)
    }
  }
})

test('a skeleton does not always open with a charge: sometimes it closes in to swing instead', () => {
  const { room, client } = arena('OPENING')
  client.player.health = 1_000_000
  const openings = new Set<string>()
  for (let trial = 0; trial < 20 && openings.size < 2; trial++) {
    const at = client.player.position
    const skeleton = room.monsters!.spawn(monsterDef('skeleton'), at.x + 4 * SUB, at.y)
    room.monsters!.provoke(skeleton.id, client.player.id, room.tick)
    for (let tick = 0; tick < 3 * TPS && !skeleton.act; tick++) {
      client.player.position = { ...at }
      run(room, [client], 1)
    }
    if (skeleton.act) openings.add(skeleton.act.k)
    room.monsters!.remove(skeleton.id)
  }
  assert.deepEqual([...openings].sort(), ['charge', 'swing'], 'both openings, from the same start')
})
