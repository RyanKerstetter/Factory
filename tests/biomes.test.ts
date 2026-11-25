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
  coldLevel,
  coldSpeedPercent,
  createEntity,
  DEADLY_COLD_AT,
  driftBody,
  DUNGEON_LAYOUT,
  dungeonEntrance,
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
  terrainOf,
  tilesHitBy,
  basicArea,
  TPS,
  warmthAround,
  waterAt,
  WEAPONS,
  WORLD_SIZE_KEYS,
  shelfWidthAt,
  coastAround,
  COAST_REACH,
  isShelf,
  wanderAt,
  type Terrain,
} from '../packages/shared/src/index.ts'
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
  const found = intoTheMountains(terrain).find((tile) => airTemperatureAt(terrain, tile.x, tile.y) <= coldest && !waterAt(terrain, tile.x, tile.y))
  if (!found) throw new Error('no mountain that cold')
  return found
}

test('the forest is round the spawn, the mountains are an island of their own a short way over the sea, and the sea is all round them', () => {
  for (const size of WORLD_SIZE_KEYS) {
    for (const seed of [1, 7, 12345]) {
      const terrain = terrainOf(seed, { size })
      assert.equal(biomeAt(terrain, 0, 0)?.key, 'forest', `${size}/${seed}: spawn in the forest`)
      // From the forest to the mountains: forest, then sea (a short way: more where a bay faces the other island), then
      // mountain, with no forest past the sea or mountain before it.
      const line = crossing(terrain)
      const kinds = line.map((tile) => biomeAt(terrain, tile.x, tile.y)?.key ?? 'sea')
      const firstSea = kinds.indexOf('sea')
      const lastSea = kinds.lastIndexOf('sea')
      assert.ok(kinds.slice(0, firstSea).every((kind) => kind === 'forest'), `${size}/${seed}: forest up to the sea`)
      assert.ok(kinds.slice(lastSea + 1).every((kind) => kind === 'mountain'), `${size}/${seed}: mountain after it`)
      const across = lastSea - firstSea + 1
      assert.ok(across >= 4 && across <= 70, `${size}/${seed}: ${across} tiles of sea between`)
      // Far out, past every biome, is sea.
      const far = Math.max(...terrain.sites.map((site) => Math.abs(site.x) + Math.abs(site.y) + site.radius * 2))
      assert.ok(isSeaAt(terrain, far, far) && isSeaAt(terrain, -far, far))
      assert.ok(waterAt(terrain, far, far), 'the sea is water')
      // The dungeons' corner is clear of every biome.
      for (const site of terrain.sites) assert.ok(!isInDungeons(site.x - site.radius - site.bump, site.y - site.radius - site.bump))
    }
  }
})

test('the two islands can never touch: their coasts, wandering out as far as they can every way round, stay apart', () => {
  for (const size of WORLD_SIZE_KEYS) {
    const terrain = terrainOf(3, { size })
    const [a, b] = terrain.sites
    const outline = (site: typeof a): Array<{ x: number; y: number }> =>
      Array.from({ length: 720 }, (_, i) => {
        const angle = (i / 720) * Math.PI * 2
        const probe = { x: site.x + Math.cos(angle) * site.radius, y: site.y + Math.sin(angle) * site.radius }
        // The furthest the coast can reach that way (its wander, and a tile for rounding).
        const reach = site.radius + wanderAt(terrain, site, probe.x, probe.y) + 1
        return { x: site.x + Math.cos(angle) * reach, y: site.y + Math.sin(angle) * reach }
      })
    const outer = outline(b)
    let least = Infinity
    for (const p of outline(a)) for (const q of outer) least = Math.min(least, Math.hypot(p.x - q.x, p.y - q.y))
    assert.ok(least >= 2, `${size}: at least ${least.toFixed(1)} tiles of sea between them however their coasts wander`)
    // And the coast does wander freely away from the other island.
    assert.equal(wanderAt(terrain, a, a.x - (b.x - a.x), a.y - (b.y - a.y)), a.bump)
  }
})

test('the shallow shelf joins the two islands, so it shows the way over; the open sea elsewhere is deep', () => {
  for (const seed of [1, 7, 12345]) {
    const terrain = terrainOf(seed, { size: 'medium' })
    const line = crossing(terrain)
    for (const tile of line) {
      if (isSeaAt(terrain, tile.x, tile.y)) assert.equal(shelfWidthAt(terrain, tile.x, tile.y), Infinity, `${seed}: shallow all the way over`)
    }
    // Facing the other island the shelf reaches further than on the far side.
    const [a, b] = terrain.sites
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const towards = (d: number): [number, number] => [Math.round(a.x + ((b.x - a.x) / length) * d), Math.round(a.y + ((b.y - a.y) / length) * d)]
    const away = (d: number): [number, number] => [Math.round(a.x - ((b.x - a.x) / length) * d), Math.round(a.y - ((b.y - a.y) / length) * d)]
    // Off to the side of the join (a quarter turn round), and straight away from it.
    const side: [number, number] = [Math.round(a.x - ((b.y - a.y) / length) * (a.radius + 30)), Math.round(a.y + ((b.x - a.x) / length) * (a.radius + 30))]
    assert.equal(shelfWidthAt(terrain, ...towards(a.radius + 3)), Infinity)
    assert.ok(shelfWidthAt(terrain, ...away(a.radius + 30)) < 8)
    assert.ok(shelfWidthAt(terrain, ...side) < 8)
  }
})

test('the land is the same from the same seed and size, and bigger presets make bigger biomes', () => {
  assert.deepEqual(terrainOf(5, { size: 'large' }).sites, terrainOf(5, { size: 'large' }).sites)
  const radius = (size: (typeof WORLD_SIZE_KEYS)[number]): number => terrainOf(5, { size }).sites[0].radius
  assert.ok(radius('small') < radius('medium') && radius('medium') < radius('large') && radius('large') < radius('huge'))
})

test('the forest has no ponds (no biome has them now), and where a biome has them, they never run into the sea', () => {
  for (const seed of [1, 7, 21]) {
    const terrain = terrainOf(seed, { size: 'small' })
    const forest = terrain.sites[0]
    for (let y = forest.y - forest.radius; y <= forest.y + forest.radius; y += 2) {
      for (let x = forest.x - forest.radius; x <= forest.x + forest.radius; x += 2) {
        assert.ok(isSeaAt(terrain, x, y) || !waterAt(terrain, x, y), `seed ${seed}: no pond at ${x},${y}`)
      }
    }
  }
  // The same land with ponds turned on for the forest (as another biome may have them).
  for (const seed of [1, 7, 21, 99]) {
    const plain = terrainOf(seed, { size: 'small' })
    const terrain = { ...plain, sites: plain.sites.map((site) => ({ ...site, biome: { ...site.biome, ponds: true } })) }
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
  assert.ok(airTemperatureAt(terrain, 0, 0) > 10)
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
  const hit = tilesHitBy(world, basicArea(pickaxe)!, center(0, 0), 0).map((entity) => entity.id)
  assert.deepEqual(hit, [1], 'only the rock straight ahead')
  // An axe's swing takes in more.
  assert.ok(tilesHitBy(world, basicArea(WEAPONS.get('axe')!)!, center(0, 0), Math.PI / 4).length > 1)
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
  // One pack (as a pack that turns up by itself is).
  for (const member of pack) member.pack = pack[0].id
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
  // (Plenty of health, so three wolves biting do not knock the player out, and back to full health, in the time.)
  client.player.health = 100_000
  run(room, [client], 3 * TPS)
  assert.ok(client.player.health < 100_000, 'they bite')
})

test('a wolf hurt from afar calls its pack; they never give up the player, however far they get', () => {
  const room = new GameRoom('WOLF2', 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Archer')
  run(room, [client], 2)
  const a = room.animals!.spawn(animalDef('wolf'), center(20, 0).x, center(20, 0).y)
  const b = room.animals!.spawn(animalDef('wolf'), center(24, 3).x, center(24, 3).y)
  room.animals!.damage(a.id, 1, client.player.position, room.tick, {}, client.player.id)
  assert.equal(a.target, client.player.id)
  assert.equal(b.target, client.player.id)
  // Off and away: they keep after them.
  client.player.position = center(-80, 0)
  run(room, [client], WATCH_TICKS * 4)
  assert.equal(a.target, client.player.id)
  assert.equal(b.target, client.player.id)
})

// How long animals take to notice a player.
const WATCH_TICKS = 8


test('whether a tile is on the shelf is the same however it is worked out (the ground, the map and the rafts all agree)', () => {
  const terrain = terrainOf(7, { size: 'medium' })
  const [a, b] = terrain.sites
  // A stretch of coast facing the other island, and some open sea off the far side.
  const spots = [
    { x: Math.round(a.x + (b.x - a.x) * 0.45), y: Math.round(a.y + (b.y - a.y) * 0.45) },
    { x: a.x - a.radius - 4, y: a.y },
    { x: a.x, y: a.y + a.radius + 3 },
  ]
  for (const spot of spots) {
    const chunk = coastAround(terrain, Math.floor(spot.x / 32) * 32, Math.floor(spot.y / 32) * 32, 32, 32)
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const x = spot.x + dx
        const y = spot.y + dy
        const one = isShelf(terrain, coastAround(terrain, x, y, 1, 1), x, y)
        const odd = isShelf(terrain, coastAround(terrain, x - 5, y - 9, 17, 23), x, y)
        assert.equal(one, odd, `${x},${y}`)
        if (x >= chunk.x0 + COAST_REACH && x < chunk.x0 + COAST_REACH + 32 && y >= chunk.y0 + COAST_REACH && y < chunk.y0 + COAST_REACH + 32) {
          assert.equal(isShelf(terrain, chunk, x, y), one, `${x},${y} as a chunk`)
        }
      }
    }
  }
})

test('a deer by the shore, with a player on the land side, runs off along the shore rather than into the water', () => {
  const room = new GameRoom('SHOREDEER', 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Hunter')
  run(room, [client], 2)
  // The coast due west of the forest's middle, on the line through it.
  const forest = room.terrain.sites[0]
  let shore = forest.x
  while (!isSeaAt(room.terrain, shore - 1, forest.y) || !isSeaAt(room.terrain, shore - 2, forest.y)) shore--
  // Land for a stretch along the coast both ways (so there is somewhere to run).
  client.player.position = center(shore + 7, forest.y)
  run(room, [client], 10)
  const deer = room.animals!.spawn(animalDef('deer'), center(shore + 1, forest.y).x, center(shore + 1, forest.y).y)
  const start = Math.hypot(deer.x - client.player.position.x, deer.y - client.player.position.y)
  run(room, [client], 3 * TPS)
  const now = Math.hypot(deer.x - client.player.position.x, deer.y - client.player.position.y)
  assert.ok(now > start + 4 * SUB, `it got away along the shore (${(start / SUB).toFixed(1)} to ${(now / SUB).toFixed(1)} tiles)`)
  assert.ok(!waterAt(room.terrain, Math.floor(deer.x / SUB), Math.floor(deer.y / SUB)), 'on the land')
})

test('wolf packs keep apart: a new pack does not turn up near another, and a wolf walks off away from another pack', () => {
  const room = new GameRoom('PACKS', 11, { wildAnimals: false, plants: false, animals: true })
  const client = new TestClient(room, 'Ranger')
  run(room, [client], 2)
  const wolf = animalDef('wolf')
  const territory = wolf.hunt!.territory
  const animals = room.animals!
  const context = (room as unknown as { animalContext(tick: number): unknown }).animalContext(room.tick)
  const first = animals.spawnHerd(context as never, wolf, center(20, 0).x, center(20, 0).y)
  assert.ok(first > 0, 'the first pack')
  const pack = animals.list().filter((animal) => animal.def === wolf)
  assert.ok(pack.every((one) => one.pack !== 0 && one.pack === pack[0].pack), 'one pack')
  assert.equal(animals.spawnHerd(context as never, wolf, center(20, 0).x + territory / 2, center(20, 0).y), 0, 'none near it')
  assert.ok(animals.spawnHerd(context as never, wolf, center(20, 0).x + territory + 3 * SUB, center(20, 0).y) > 0, 'one far enough off')
  // A wolf of another pack put right by the first: it walks off away from them.
  const stray = animals.spawn(wolf, center(26, 0).x, center(26, 0).y)
  stray.pack = stray.id
  const near = (): number => Math.min(...pack.map((one) => Math.hypot(one.x - stray.x, one.y - stray.y)))
  const before = near()
  run(room, [client], 8 * TPS)
  assert.ok(near() > before + 2 * SUB, `it kept away (${(before / SUB).toFixed(1)} to ${(near() / SUB).toFixed(1)} tiles)`)
})
