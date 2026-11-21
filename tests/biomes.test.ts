import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  airTemperatureAt,
  ARMOR_SLOT,
  ARMOR_SLOTS,
  bodyTenths,
  COLD_AT,
  DUNGEON_AIR,
  getItem,
  playerInventory,
  wornArmor,
  animalDef,
  biomeAt,
  BODY_NORMAL,
  campSites,
  coldLevel,
  coldSpeedPercent,
  createEntity,
  DEADLY_COLD_AT,
  driftBody,
  DUNGEON_LAYOUT,
  dungeonBlocks,
  dungeonEntrance,
  dungeonSlotAt,
  dungeonTile,
  FactoryWorld,
  FREEZING_AT,
  FREEZING_SPEED_PERCENT,
  isInDungeons,
  isSeaAt,
  itemId,
  KEY_RIGHT,
  NO_ITEM,
  PLAYER_MAX_HEALTH,
  PLAYER_SPEED,
  SNOW_STARTS_AT,
  SUB,
  temperatureAt,
  terrainOf,
  tilesHitBy,
  TPS,
  warmthAround,
  waterAt,
  WEAPONS,
  WORLD_SIZE_KEYS,
  type Terrain,
} from '../packages/shared/src/index.ts'
import { BOSS_AIR, BOSS_COLD_EVERY } from '../apps/server/src/dungeons.ts'
import { run, TestClient } from './helpers.ts'

const center = (x: number, y: number): { x: number; y: number } => ({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })

// The tiles on the line from the forest's middle to the mountains'.
function crossing(terrain: Terrain): Array<{ x: number; y: number }> {
  const [forest, mountain] = terrain.sites
  const steps = Math.ceil(Math.hypot(mountain.x - forest.x, mountain.y - forest.y))
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: Math.round(forest.x + ((mountain.x - forest.x) * i) / steps),
    y: Math.round(forest.y + ((mountain.y - forest.y) * i) / steps),
  }))
}

// The tiles from where the mountains meet the forest on through their middle to their far side.
function intoTheMountains(terrain: Terrain): Array<{ x: number; y: number }> {
  const [forest, mountain] = terrain.sites
  const length = Math.hypot(mountain.x - forest.x, mountain.y - forest.y)
  const line = crossing(terrain)
  for (let i = 1; i <= mountain.radius; i++) {
    line.push({ x: Math.round(mountain.x + ((mountain.x - forest.x) * i) / length), y: Math.round(mountain.y + ((mountain.y - forest.y) * i) / length) })
  }
  return line.filter((tile) => biomeAt(terrain, tile.x, tile.y)?.key === 'mountain')
}

// A mountain tile at least that cold.
function mountainTile(terrain: Terrain, coldest: number): { x: number; y: number } {
  const found = intoTheMountains(terrain).find((tile) => temperatureAt(terrain, tile.x, tile.y) <= coldest && !waterAt(terrain, tile.x, tile.y))
  if (!found) throw new Error('no mountain that cold')
  return found
}

test('the forest is round the spawn, the mountains join it with no sea between, and the sea is all round them', () => {
  for (const size of WORLD_SIZE_KEYS) {
    for (const bumpiness of [0, 60, 100]) {
      for (const seed of [1, 7, 12345]) {
        const terrain = terrainOf(seed, { size, bumpiness })
        assert.equal(biomeAt(terrain, 0, 0)?.key, 'forest', `${size}/${bumpiness}/${seed}: spawn in the forest`)
        const line = crossing(terrain)
        assert.ok(line.every((tile) => !isSeaAt(terrain, tile.x, tile.y)), `${size}/${bumpiness}/${seed}: the biomes are joined`)
        assert.equal(biomeAt(terrain, line.at(-1)!.x, line.at(-1)!.y)?.key, 'mountain')
        // Far out, past every biome, is sea.
        const far = Math.max(...terrain.sites.map((site) => Math.abs(site.x) + Math.abs(site.y) + site.radius * 2))
        assert.ok(isSeaAt(terrain, far, far) && isSeaAt(terrain, -far, far))
        assert.ok(waterAt(terrain, far, far), 'the sea is water')
        // The dungeons' corner is clear of every biome.
        for (const site of terrain.sites) assert.ok(!isInDungeons(site.x - site.radius - site.bump, site.y - site.radius - site.bump))
      }
    }
  }
})

test('the land is the same from the same seed and settings, and bigger presets make bigger biomes', () => {
  assert.deepEqual(terrainOf(5, { size: 'large', bumpiness: 40 }).sites, terrainOf(5, { size: 'large', bumpiness: 40 }).sites)
  const radius = (size: (typeof WORLD_SIZE_KEYS)[number]): number => terrainOf(5, { size }).sites[0].radius
  assert.ok(radius('small') < radius('medium') && radius('medium') < radius('large') && radius('large') < radius('huge'))
  // Bumpiness 0 is a plain disc: a tile just inside the radius is land, just outside is sea.
  const round = terrainOf(5, { size: 'medium', bumpiness: 0 })
  const forest = round.sites[0]
  const away = { x: -(round.sites[1].x - forest.x), y: -(round.sites[1].y - forest.y) }
  const length = Math.hypot(away.x, away.y)
  const at = (d: number): [number, number] => [Math.round((away.x / length) * d), Math.round((away.y / length) * d)]
  assert.ok(!isSeaAt(round, ...at(forest.radius - 2)))
  assert.ok(isSeaAt(round, ...at(forest.radius + 2)))
})

test('ponds never run into the sea', () => {
  for (const seed of [1, 7, 21, 99]) {
    const terrain = terrainOf(seed, { size: 'small', bumpiness: 100 })
    const forest = terrain.sites[0]
    const reach = forest.radius + forest.bump + 2
    let ponds = 0
    for (let y = forest.y - reach; y <= forest.y + reach; y++) {
      for (let x = forest.x - reach; x <= forest.x + reach; x++) {
        if (isSeaAt(terrain, x, y) || !waterAt(terrain, x, y)) continue
        ponds++
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) assert.ok(!isSeaAt(terrain, x + dx, y + dy), `seed ${seed}: pond at ${x},${y} is by the sea`)
      }
    }
    assert.ok(ponds > 0, `seed ${seed} still has ponds`)
  }
})

test('the forest is mild; the mountains get colder the further in, with most of them out of the snow', () => {
  const terrain = terrainOf(7)
  assert.ok(temperatureAt(terrain, 0, 0) > 10)
  const temperatures = intoTheMountains(terrain).map((tile) => airTemperatureAt(terrain, tile.x, tile.y))
  for (let i = 1; i < temperatures.length; i++) assert.ok(temperatures[i] <= temperatures[i - 1] + 1e-9, 'never warmer further in')
  assert.ok(temperatures[0] > 0, `the mountains' edge is not freezing (${temperatures[0]})`)
  assert.ok(temperatures.at(-1)! < DEADLY_COLD_AT, `their heart is deadly cold (${temperatures.at(-1)})`)
  const snowy = temperatures.filter((degrees) => degrees <= SNOW_STARTS_AT).length
  assert.ok(snowy < temperatures.length * 0.55, `less than half the way in is snowy (${snowy} of ${temperatures.length})`)
})

test('a body cools fast in the deep cold, slows the player more and more, and warms up by a campfire', () => {
  const terrain = terrainOf(7)
  const world = new FactoryWorld()
  const cold = mountainTile(terrain, -30)
  const spot = center(cold.x, cold.y)
  const { target } = warmthAround(terrain, world, spot)
  assert.ok(target < -28)
  let body = BODY_NORMAL
  for (let i = 0; i < 1 * TPS; i++) body = driftBody(body, target)
  assert.ok(body > COLD_AT, `a moment in the cold is safe (${body.toFixed(1)} after 1 s)`)
  for (let i = 0; i < 4 * TPS; i++) body = driftBody(body, target)
  assert.ok(body < FREEZING_AT, `but the cold gets in fast (${body.toFixed(1)} after 5 s)`)
  for (let i = 0; i < 15 * TPS; i++) body = driftBody(body, target)
  assert.equal(coldLevel(body), 'deadly', `and a long stay is deadly (${body.toFixed(1)})`)
  // Slower and slower as the body cools.
  assert.equal(coldSpeedPercent(bodyTenths(5)), 100)
  assert.ok(coldSpeedPercent(bodyTenths(-5)) < 100 && coldSpeedPercent(bodyTenths(-5)) > coldSpeedPercent(bodyTenths(-15)))
  assert.equal(coldSpeedPercent(bodyTenths(-40)), FREEZING_SPEED_PERCENT)
  // A lit campfire beside the player.
  world.addEntity({ ...createEntity(1, 'campfire', cold.x + 1, cold.y, 0, NO_ITEM), lit: 1 } as never)
  const fire = warmthAround(terrain, world, spot)
  assert.ok(fire.byFire && fire.target > 10)
  for (let i = 0; i < 15 * TPS; i++) body = driftBody(body, fire.target)
  assert.equal(coldLevel(body), 'warm', `warmed by the fire (${body.toFixed(1)})`)
})

test('a player who stays in the deep cold is slowed, and then hurt', () => {
  const room = new GameRoom('COLD', 7, { wildAnimals: false })
  const client = new TestClient(room, 'Explorer')
  const deadly = mountainTile(room.terrain, -34)
  client.player.position = center(deadly.x, deadly.y)
  run(room, [client], 1 * TPS)
  assert.equal(client.player.health, PLAYER_MAX_HEALTH, 'not at once')
  run(room, [client], 15 * TPS)
  assert.ok(client.player.body < FREEZING_AT)
  const before = client.player.position.x
  room.receiveInputs(client.player, [[1, KEY_RIGHT]])
  run(room, [client], 1)
  const moved = client.player.position.x - before
  assert.ok(moved > 0 && moved < Math.floor((PLAYER_SPEED * 80) / 100), `slowed (${moved} of ${PLAYER_SPEED})`)
  run(room, [client], 15 * TPS)
  assert.ok(client.player.health < PLAYER_MAX_HEALTH, 'the cold hurts')
})

test('the ice crypt is colder than the snow outside it, and the wolf helmet with leather keeps a player from slowing in it', () => {
  const terrain = terrainOf(7, { size: 'small' })
  const entrance = dungeonEntrance(terrain)!
  const outside = airTemperatureAt(terrain, entrance.x, entrance.y)
  assert.ok(outside < DEADLY_COLD_AT, `deadly cold at the way in (${outside.toFixed(1)})`)
  assert.ok(DUNGEON_AIR < outside, 'colder still inside')
  const world = new FactoryWorld()
  const inside = center(dungeonTile(0, DUNGEON_LAYOUT.start).x, dungeonTile(0, DUNGEON_LAYOUT.start).y)
  const dressed = (keys: string[]): number => {
    const inventory = playerInventory()
    keys.forEach((key) => {
      const part = getItem(itemId(key)).armor!.slot
      inventory.slots[ARMOR_SLOT + ARMOR_SLOTS.indexOf(part)] = { item: itemId(key), count: 1 }
    })
    return warmthAround(terrain, world, inside, wornArmor(inventory).warmth).target
  }
  assert.ok(dressed(['wolf-helmet', 'leather-armor', 'leather-boots']) >= COLD_AT, 'the wolf helmet set: not slowed')
  assert.ok(dressed(['leather-armor', 'leather-boots']) < FREEZING_AT, 'leather alone: not enough')
  assert.ok(getItem(itemId('wolf-helmet')).armor!.warmth > Math.max(...['leather-armor', 'leather-boots'].map((key) => getItem(itemId(key)).armor!.warmth)))
})

test('a pickaxe strikes a small spot ahead, not a sweep', () => {
  const world = new FactoryWorld()
  world.addEntity(createEntity(1, 'rock', 1, 0, 0, NO_ITEM))
  world.addEntity(createEntity(2, 'rock', 0, 1, 0, NO_ITEM))
  world.addEntity(createEntity(3, 'rock', 1, 1, 0, NO_ITEM))
  const pickaxe = WEAPONS.get('pickaxe')!
  assert.equal(pickaxe.basic, 'strike')
  const hit = tilesHitBy(world, pickaxe, center(0, 0), 0).map((entity) => entity.id)
  assert.deepEqual(hit, [1], 'only the rock straight ahead')
  // An axe's swing takes in more.
  assert.ok(tilesHitBy(world, WEAPONS.get('axe')!, center(0, 0), Math.PI / 4).length > 1)
})

test('deer run from a player who comes near, faster than a player can run', () => {
  const room = new GameRoom('DEER', 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Hunter')
  run(room, [client], 2)
  const deer = room.animals!.spawn(animalDef('deer'), center(5, 0).x, center(5, 0).y)
  const herd = room.animals!.spawn(animalDef('deer'), center(8, 1).x, center(8, 1).y)
  run(room, [client], TPS)
  const away = Math.hypot(deer.x - client.player.position.x, deer.y - client.player.position.y) / SUB
  assert.ok(away > 9, `it ran (${away.toFixed(1)} tiles away)`)
  assert.ok(herd.fleeUntil > room.tick || Math.hypot(herd.x - center(8, 1).x, herd.y - center(8, 1).y) > 2 * SUB, 'and its herd with it')
  assert.ok(animalDef('deer').speed * animalDef('deer').fleePace > PLAYER_SPEED, 'faster than a player')
  // They are bred with berries.
  assert.ok(animalDef('deer').foods.has(itemId('berries')))
})

test('wolves leave a player alone at a distance, but go for one who comes close, all together, from all sides', () => {
  const wolf = animalDef('wolf')
  assert.ok(Math.round(wolf.speed * wolf.hunt!.pace) > PLAYER_SPEED, 'a wolf outruns a player')
  const room = new GameRoom('WOLF', 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Prey')
  run(room, [client], 2)
  const pack = [room.animals!.spawn(wolf, center(14, 0).x, center(14, 0).y)]
  pack.push(room.animals!.spawn(wolf, center(18, 4).x, center(18, 4).y))
  pack.push(room.animals!.spawn(wolf, center(22, 0).x, center(22, 0).y))
  const loner = room.animals!.spawn(wolf, center(-60, 0).x, center(-60, 0).y)
  run(room, [client], 2 * TPS)
  assert.ok(pack.every((member) => member.target === 0), 'not close enough to bother them')
  // Walk up to the nearest one: the whole pack comes, but not the wolf far off.
  client.player.position = { x: pack[0].x - 4 * SUB, y: pack[0].y }
  run(room, [client], WATCH_TICKS)
  assert.ok(pack.every((member) => member.target === client.player.id), 'the pack hunts together')
  assert.equal(loner.target, 0)
  assert.ok(room.animals!.info(pack[0]).angry, 'and shows it')
  // They spread out round the player rather than coming in a line.
  run(room, [client], TPS)
  const prey = client.player.position
  const angles = pack.map((member) => Math.atan2(member.y - prey.y, member.x - prey.x)).sort((a, b) => a - b)
  const spread = angles.at(-1)! - angles[0]
  assert.ok(spread > 1.5, `they flank (spread over ${spread.toFixed(2)} radians)`)
  run(room, [client], 3 * TPS)
  assert.ok(client.player.health < PLAYER_MAX_HEALTH, 'they bite')
})

test('a wolf hurt from afar calls its pack; they give up a player who gets far enough from their ground', () => {
  const room = new GameRoom('WOLF2', 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Archer')
  run(room, [client], 2)
  const a = room.animals!.spawn(animalDef('wolf'), center(20, 0).x, center(20, 0).y)
  const b = room.animals!.spawn(animalDef('wolf'), center(24, 3).x, center(24, 3).y)
  room.animals!.damage(a.id, 1, client.player.position, room.tick, {}, client.player.id)
  assert.equal(a.target, client.player.id)
  assert.equal(b.target, client.player.id)
  // Off and away, well past how far they follow.
  client.player.position = center(-80, 0)
  run(room, [client], WATCH_TICKS)
  assert.equal(a.target, 0)
  assert.equal(b.target, 0)
})

test('skeletons keep camps in the mountains, drop bones and essence, and come back a while after they are killed', () => {
  const room = new GameRoom('BONES', 7, { terrain: { size: 'small' } })
  const client = new TestClient(room, 'Raider')
  const camps = campSites(room.terrain)
  assert.ok(camps.length > 0, 'the mountains have camps')
  const camp = camps[0]
  assert.ok(biomeAt(room.terrain, camp.x, camp.y)?.key === 'mountain')
  // Near enough for the camp to matter, but out of sight of it.
  client.player.position = center(camp.x + 24, camp.y)
  run(room, [client], 2 * TPS)
  const guards = () => room.animals!.list().filter((animal) => animal.def.kind.startsWith('skeleton') && animal.post?.camp === 0)
  const first = guards()
  assert.ok(first.length >= 3, `the camp is kept (${first.length})`)
  assert.ok(first.every((guard) => Math.hypot(guard.x - center(camp.x, camp.y).x, guard.y - center(camp.x, camp.y).y) < 4 * SUB))
  assert.equal(first.filter((guard) => guard.def.kind === 'skeleton-archer').length, first.filter((guard) => guard.post!.slot % 3 === 1).length, 'every third an archer')
  const plain = first.find((guard) => guard.def.kind === 'skeleton')!
  const drops = room.animals!.damage(plain.id, 99, client.player.position, room.tick, {}, client.player.id)!
  assert.deepEqual(drops.map(([key]) => key).sort(), ['bone', 'essence'])
  for (const guard of first.filter((guard) => guard !== plain)) room.animals!.damage(guard.id, 99, client.player.position, room.tick, {}, client.player.id)
  run(room, [client], 2 * TPS)
  assert.equal(guards().length, 0, 'not back at once')
  run(room, [client], 150 * TPS)
  assert.equal(guards().length, first.length, 'back after a while')
})

test('the dungeon: deep in the snow, a copy each, its chest shut till its lich falls, and the stairs back out', () => {
  const room = new GameRoom('CRYPT', 7, { terrain: { size: 'small' } })
  const entrance = dungeonEntrance(room.terrain)!
  assert.ok(entrance, 'the mountains have a way in')
  assert.ok(airTemperatureAt(room.terrain, entrance.x, entrance.y) <= SNOW_STARTS_AT - 10, 'deep in the snow')
  const client = new TestClient(room, 'Delver')
  client.player.position = center(entrance.x, entrance.y)
  run(room, [client], 3)
  const slot = dungeonSlotAt(Math.floor(client.player.position.x / SUB), Math.floor(client.player.position.y / SUB))
  assert.notEqual(slot, undefined, 'taken into a copy')
  const start = dungeonTile(slot!, DUNGEON_LAYOUT.start)
  assert.deepEqual(client.player.position, center(start.x, start.y))
  assert.ok(dungeonBlocks(start.x - 2, start.y), 'walled in')
  run(room, [client], 2)
  const monsters = room.animals!.list().filter((animal) => animal.dungeon === slot)
  assert.equal(monsters.filter((animal) => animal.def.kind === 'skeleton').length, DUNGEON_LAYOUT.guards.length)
  assert.equal(monsters.filter((animal) => animal.def.kind === 'skeleton-archer').length, DUNGEON_LAYOUT.archers.length)
  const lich = monsters.find((animal) => animal.def.kind === 'frost-lich')!
  assert.ok(lich, 'the frost lich is in its hall')
  const chestTile = dungeonTile(slot!, DUNGEON_LAYOUT.chest)
  const chest = room.world.entityAt(chestTile.x, chestTile.y)!
  assert.equal(chest.kind, 'chest')
  // Next to the chest, with the lich standing: shut.
  client.player.position = center(chestTile.x, chestTile.y + 1)
  client.command({ k: 'take', id: chest.id, item: NO_ITEM, max: 999 })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'guarded')
  room.animals!.damage(lich.id, 999, client.player.position, room.tick, {}, client.player.id)
  run(room, [client], 2)
  client.command({ k: 'take', id: chest.id, item: NO_ITEM, max: 999 })
  run(room, [client], 3)
  assert.ok(client.results.at(-1)?.ok, 'open once it falls')
  assert.ok(client.player.inventory.slots.some((held) => held.item === itemId('essence') && held.count > 0))
  // A friend who comes in now joins the same copy.
  const friend = new TestClient(room, 'Friend')
  friend.player.position = center(entrance.x, entrance.y)
  run(room, [client, friend], 2)
  assert.equal(dungeonSlotAt(Math.floor(friend.player.position.x / SUB), Math.floor(friend.player.position.y / SUB)), slot)
  // The stairs out, for both; the copy is cleared away once nobody is in it.
  const exit = dungeonTile(slot!, DUNGEON_LAYOUT.exit)
  client.player.position = center(exit.x, exit.y)
  friend.player.position = center(exit.x, exit.y)
  run(room, [client, friend], 2)
  assert.ok(!isInDungeons(Math.floor(client.player.position.x / SUB), Math.floor(client.player.position.y / SUB)), 'back outside')
  assert.equal(room.dungeons.openCount, 1)
  run(room, [client, friend], 25 * TPS)
  assert.equal(room.dungeons.openCount, 0, 'cleared away')
  assert.equal(room.world.entity(chest.id), undefined)
})

test('the frost lich: the door seals behind whoever walks in, it casts ice, the hall gets colder, and a fight given up resets', () => {
  const room = new GameRoom('LICH', 7, { terrain: { size: 'small' } })
  const entrance = dungeonEntrance(room.terrain)!
  const client = new TestClient(room, 'Challenger')
  client.player.position = center(entrance.x, entrance.y)
  run(room, [client], 3)
  const slot = dungeonSlotAt(Math.floor(client.player.position.x / SUB), Math.floor(client.player.position.y / SUB))!
  const door = dungeonTile(slot, DUNGEON_LAYOUT.door)
  assert.equal(room.world.entityAt(door.x, door.y), undefined, 'the doorway is open')
  // Into the hall.
  client.player.position = center(door.x, door.y - 2)
  run(room, [client], 2)
  assert.equal(room.world.entityAt(door.x, door.y)?.kind, 'door', 'sealed behind them')
  assert.ok(room.dungeons.fighting(slot))
  const lich = room.animals!.list().find((animal) => animal.def.kind === 'frost-lich')!
  assert.equal(lich.target, client.player.id, 'the lich wakes')
  const hall = (): number => room.dungeons.airAt(door.x, door.y - 2)!
  assert.equal(hall(), BOSS_AIR, 'cold enough that only the warmest armour keeps a player moving')
  // It casts: shards and icicles fly.
  client.player.health = 1000
  const items = new Set<number>()
  for (let i = 0; i < 6 * TPS; i++) {
    run(room, [client], 1)
    for (const [, item] of room.combat.inChunks(client.player.chunks, room.tick)) items.add(item)
  }
  assert.ok(items.has(itemId('ice-shard')), 'it casts a ring of shards')
  assert.ok(items.has(itemId('icicle')), 'and drops icicles')
  run(room, [client], BOSS_COLD_EVERY * 2)
  assert.ok(hall() <= BOSS_AIR - 2, `colder as it goes on (${hall()})`)
  assert.ok(client.player.health < 1000, 'and they hurt')
  // Everyone out of the hall: given up, the door opens and the lich is whole.
  room.animals!.damage(lich.id, 30, client.player.position, room.tick, {}, client.player.id)
  client.player.position = center(door.x, door.y + 2)
  run(room, [client], 4 * TPS)
  assert.equal(room.world.entityAt(door.x, door.y), undefined, 'the door opens again')
  assert.equal(lich.hp, lich.def.hp, 'whole again')
  assert.equal(lich.target, 0)
})

// How long animals take to notice a player.
const WATCH_TICKS = 8

test('the frost lich never moves from the middle of its hall, and a wave of cold air throws back whoever comes close', () => {
  const room = new GameRoom('LICHWAVE', 7, { terrain: { size: 'small' } })
  const entrance = dungeonEntrance(room.terrain)!
  const client = new TestClient(room, 'Challenger')
  client.player.position = center(entrance.x, entrance.y)
  run(room, [client], 3)
  const slot = dungeonSlotAt(Math.floor(client.player.position.x / SUB), Math.floor(client.player.position.y / SUB))!
  const door = dungeonTile(slot, DUNGEON_LAYOUT.door)
  client.player.position = center(door.x, door.y - 2)
  run(room, [client], 2)
  assert.ok(room.dungeons.fighting(slot))
  const lich = room.animals!.list().find((animal) => animal.def.kind === 'frost-lich')!
  assert.equal(lich.hp, 400, 'it has a lot of health')
  const home = { x: lich.x, y: lich.y }
  // Hit hard, with a knockback: it does not budge.
  room.animals!.damage(lich.id, 10, client.player.position, room.tick, { knockback: 3 * SUB }, client.player.id)
  // Right up against it.
  client.player.health = 100_000
  client.player.position = { x: lich.x, y: lich.y + 2 * SUB }
  let furthest = 0
  for (let i = 0; i < 3 * TPS; i++) {
    run(room, [client], 1)
    furthest = Math.max(furthest, Math.hypot(client.player.position.x - lich.x, client.player.position.y - lich.y) / SUB)
  }
  assert.deepEqual({ x: lich.x, y: lich.y }, home, 'it stands where it was put')
  assert.ok(client.player.health < 100_000, 'the wave hurts')
  assert.ok(furthest > 3.5, `and throws the player back (${furthest.toFixed(2)} tiles)`)
})

test('a dash whose attack arrives after its inputs were played is caught up at once, the way the page sent', () => {
  const room = new GameRoom('DASH', 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Dasher')
  run(room, [client], 5)
  client.player.inventory.slots[0] = { item: itemId('knife'), count: 1 }
  for (let n = 1; n <= 10; n++) {
    room.receiveInputs(client.player, [[n, 0]])
    run(room, [client], 1)
  }
  const start = { ...client.player.position }
  // Made after input 5, east (whatever the server makes of where the mouse was).
  client.command({ k: 'attack', special: true, slot: 0, x: start.x, y: start.y + 5 * SUB, charge: 30, input: 5, dir: 0 })
  run(room, [client], 3)
  assert.ok(client.player.dashedBy > 0, 'the page is told it has dashed')
  assert.equal(client.player.position.x - start.x, 5 * Math.round((WEAPONS.get('knife')!.special!.dash) / 5), 'the whole dash east, at once')
  assert.equal(client.player.position.y, start.y, 'along the way the page sent, not towards the mouse')
})

test('a skeleton archer comes into range, aims for a second, and looses an arrow that flies through other skeletons', () => {
  const room = new GameRoom('ARCHER', 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Target')
  run(room, [client], 5)
  client.player.health = 1000
  const at = client.player.position
  const archer = room.animals!.spawn(animalDef('skeleton-archer'), at.x + 9 * SUB, at.y)
  archer.wild = false
  // A skeleton standing between them (it is not hit).
  const between = room.animals!.spawn(animalDef('skeleton'), at.x + 3 * SUB, at.y)
  between.wild = false
  room.animals!.provoke(archer.id, client.player.id, room.tick)
  const shoot = animalDef('skeleton-archer').hunt!.shoot!
  let aimedAt = 0
  let shotAt = 0
  for (let i = 0; i < 6 * TPS && shotAt === 0; i++) {
    // Keep the player and the skeleton where they are.
    client.player.position = { ...at }
    between.x = at.x + 3 * SUB
    between.y = at.y
    run(room, [client], 1)
    if (aimedAt === 0 && archer.aimUntil !== 0) {
      aimedAt = room.tick
      assert.ok(Math.hypot(archer.x - at.x, archer.y - at.y) <= shoot.range, 'it comes into range first')
    }
    if (room.combat.inChunks(client.player.chunks, room.tick).some(([, item]) => item === itemId('arrow'))) shotAt = room.tick
  }
  assert.ok(aimedAt > 0, 'it aims')
  assert.ok(shotAt - aimedAt >= shoot.aim - 1, `for a second (${shotAt - aimedAt} ticks)`)
  const healthBefore = client.player.health
  for (let i = 0; i < TPS; i++) {
    client.player.position = { ...at }
    between.x = at.x + 3 * SUB
    between.y = at.y
    run(room, [client], 1)
  }
  assert.ok(client.player.health < healthBefore, 'the arrow reaches the player')
  assert.equal(between.hp, animalDef('skeleton').hp, 'through the skeleton in the way')
})

test('a knife lunge dashes far and hurts everything along the way', () => {
  const room = new GameRoom('LUNGE', 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Lunger')
  run(room, [client], 5)
  client.player.inventory.slots[0] = { item: itemId('knife'), count: 1 }
  const at = client.player.position
  const near = room.animals!.spawn(animalDef('cow'), at.x + 1 * SUB, at.y)
  const far = room.animals!.spawn(animalDef('cow'), at.x + 3.2 * SUB, at.y)
  near.wild = far.wild = false
  client.command({ k: 'attack', special: true, slot: 0, x: at.x + 5 * SUB, y: at.y, charge: 30, input: 0, dir: 0 })
  run(room, [client], 10)
  assert.ok(near.hp < animalDef('cow').hp, 'the one it starts by')
  assert.ok(far.hp < animalDef('cow').hp, 'and the one it goes through, further on')
  assert.ok(WEAPONS.get('knife')!.special!.dash >= 3 * SUB, 'a long dash')
})
