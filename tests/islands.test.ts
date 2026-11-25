import assert from 'node:assert/strict'
import test from 'node:test'
import type { AnimalContext } from '../apps/server/src/animals.ts'
import { DEPTH_BORDER, DEPTH_SIDE, FOG_BELOW, FOG_REACH, fogDepth, fogDepthAt } from '../apps/client/src/render3d/fog-depth.ts'
import { GameRoom } from '../apps/server/src/game-room.ts'
import {
  ALTAR_RECIPES,
  animalDef,
  BEES,
  biomeAt,
  biomeSiteAt,
  BUILDINGS,
  CHUNK_SIZE,
  CAMPFIRE_COOK,
  CAMPFIRE_COOKED,
  CAMPFIRE_FUEL,
  countOf,
  createEntity,
  floorDiv,
  GOBLIN_CLEARING,
  goblinCampSites,
  TOMB_CLEARING,
  tombSites,
  isFoggedAt,
  isFood,
  isSandAt,
  isSeaAt,
  isSmoking,
  itemId,
  LIQUIDS,
  monsterDef,
  PLAYER_MAX_HEALTH,
  PLAYER_SPEED,
  PUNCH_COOLDOWN_TICKS,
  shelfWidthAt,
  SUB,
  terrainOf,
  tileMiddle,
  TPS,
  TURN_DEGREES,
  waterAt,
  WORLD_GEN,
  WORLD_SIZE_KEYS,
  type BiomeSite,
  type CampfireEntity,
  type Entity,
  type HiveEntity,
  type IsSolid,
  type Terrain,
} from '../packages/shared/src/index.ts'
import { differingChunks, run, TestClient } from './helpers.ts'

// The desert and the meadow: two islands more, curving round from the first two, under fog until a player eats a
// truesight flesh; and what lives on them.

// A room with nothing grown (but the islands' land and water), its animals and monsters run but none turning up by
// themselves, and what is given put down before the player joins (so their page has it from the start). The player
// starts at tile 0, 0, in the forest.
function bare(code: string, things: Entity[] = []): { room: GameRoom; client: TestClient } {
  const room = new GameRoom(code, 11, { dropsOnGround: false, plants: false, animals: true, wildAnimals: false })
  for (const thing of things) room.world.addEntity(thing)
  const client = new TestClient(room, 'Visitor')
  run(room, [client], 5)
  return { room, client }
}

function give(client: TestClient, items: Record<string, number>): void {
  Object.entries(items).forEach(([key, count], slot) => (client.player.inventory.slots[slot] = { item: itemId(key), count }))
}

function hive(id: number, x: number, y: number, set: Partial<HiveEntity> = {}, kind: 'hive' | 'beebox' = 'beebox'): HiveEntity {
  return Object.assign(createEntity(id, kind, x, y, 0, 0) as HiveEntity, set)
}

function hiveIn(room: GameRoom, id: number): HiveEntity | undefined {
  const entity = room.world.entity(id)
  return entity?.kind === 'hive' || entity?.kind === 'beebox' ? entity : undefined
}

// Tiles of a biome, in an order, from its middle out.
function tilesOf(terrain: Terrain, site: BiomeSite, accept: (x: number, y: number) => boolean): Array<{ x: number; y: number }> {
  const found: Array<{ x: number; y: number }> = []
  for (let y = site.y - site.radius; y <= site.y + site.radius; y += 1) {
    for (let x = site.x - site.radius; x <= site.x + site.radius; x += 1) {
      if (biomeSiteAt(terrain, x, y) === site && accept(x, y)) found.push({ x, y })
    }
  }
  return found
}

test('the desert and the meadow curve round from the first two islands, 70° each time to the same side, as far apart and as big as the mountains, under fog', () => {
  const turnOf = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
    let turn = Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x)
    while (turn > Math.PI) turn -= Math.PI * 2
    while (turn <= -Math.PI) turn += Math.PI * 2
    return (turn * 180) / Math.PI
  }
  const sides = new Set<number>()
  for (const size of WORLD_SIZE_KEYS) {
    for (const seed of [1, 7, 11, 42, 1234, 99_999]) {
      const terrain = terrainOf(seed, { size })
      assert.deepEqual(terrain.sites.map((site) => site.biome.key), ['forest', 'mountain', 'desert', 'meadow'])
      const [forest, mountain, desert, meadow] = terrain.sites
      const step = (a: BiomeSite, b: BiomeSite): { x: number; y: number } => ({ x: b.x - a.x, y: b.y - a.y })
      const first = step(forest, mountain)
      const second = step(mountain, desert)
      const third = step(desert, meadow)
      const length = Math.hypot(first.x, first.y)
      assert.ok(Math.abs(Math.hypot(second.x, second.y) - length) < 1.5, `${size} ${seed}: the desert as far from the mountains as they are from the forest`)
      assert.ok(Math.abs(Math.hypot(third.x, third.y) - length) < 1.5, `${size} ${seed}: the meadow as far from the desert`)
      const turns = [turnOf(first, second), turnOf(second, third)]
      for (const turn of turns) assert.ok(Math.abs(Math.abs(turn) - TURN_DEGREES) < 1.5, `${size} ${seed}: turned ${turn}°`)
      assert.equal(Math.sign(turns[0]), Math.sign(turns[1]), `${size} ${seed}: both the same way`)
      sides.add(Math.sign(turns[0]))
      assert.equal(meadow.radius, mountain.radius)
      assert.equal(desert.radius, mountain.radius)
      assert.deepEqual(terrain.sites.map((site) => site.biome.fogged), [false, false, true, true])
      // Islands not next to each other keep well clear.
      for (const [a, b] of [[forest, desert], [forest, meadow], [mountain, meadow]] as const) {
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.radius + a.bump + b.radius + b.bump + 24, `${size} ${seed}: ${a.biome.key} and ${b.biome.key} well apart`)
      }
      // Next to each other: sea between, a short way over the shallows (a raft's crossing).
      for (const [a, b] of [[mountain, desert], [desert, meadow]] as const) {
        const sea = new Set<string>()
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2)
        for (let i = 0; i <= steps; i++) {
          const x = Math.floor(a.x + ((b.x - a.x) * i) / steps)
          const y = Math.floor(a.y + ((b.y - a.y) * i) / steps)
          if (isSeaAt(terrain, x, y)) {
            sea.add(`${x},${y}`)
            assert.equal(shelfWidthAt(terrain, x, y), Infinity, 'the shallows run all the way across')
          }
        }
        assert.ok(sea.size >= 2, `${size} ${seed}: sea from ${a.biome.key} to ${b.biome.key}`)
      }
      // The fog is the far islands', all of them, and nowhere else.
      assert.ok(isFoggedAt(terrain, meadow.x, meadow.y) && isFoggedAt(terrain, desert.x, desert.y))
      assert.ok(!isFoggedAt(terrain, forest.x, forest.y) && !isFoggedAt(terrain, mountain.x, mountain.y))
    }
  }
  assert.equal(sides.size, 2, 'some worlds curve one way, some the other')
})

test('the meadow grows grass, sunflowers, beehives and rocks (a few copper), with rivers running to the sea and clay on their banks, and has the goblins\' camps, clear of the rivers; the desert is sand, with cacti, pockets of sand and tin rocks', () => {
  const room = new GameRoom('ISLES', 11, { wildAnimals: false })
  const terrain = room.terrain
  const [, , desert, meadow] = terrain.sites
  const kinds = new Map<string, Entity[]>()
  for (const chunk of room.world.chunkIds) {
    for (const entity of room.world.chunk(chunk)!.entities) {
      const key = `${biomeSiteAt(terrain, entity.x, entity.y)?.biome.key}:${entity.kind}`
      kinds.set(key, [...(kinds.get(key) ?? []), entity])
    }
  }
  const of = (key: string): Entity[] => kinds.get(key) ?? []
  for (const key of ['meadow:grass', 'meadow:sunflower', 'meadow:hive', 'meadow:rock', 'meadow:copper-rock', 'meadow:clay', 'desert:cactus', 'desert:sand', 'desert:tin-rock']) {
    assert.ok(of(key).length > 0, `${key}: ${of(key).length}`)
  }
  for (const [key] of kinds) {
    const [biome, kind] = key.split(':')
    if (biome === 'meadow') assert.ok(['grass', 'sunflower', 'hive', 'rock', 'copper-rock', 'clay'].includes(kind), `nothing else on the meadow (${kind})`)
    if (biome === 'desert') assert.ok(['cactus', 'sand', 'tin-rock'].includes(kind), `nothing else in the desert (${kind})`)
    if (biome === 'forest' || biome === 'mountain') assert.ok(!['sunflower', 'hive', 'copper-rock', 'clay', 'cactus', 'sand', 'tin-rock'].includes(kind), `no ${kind} in the ${biome}`)
  }
  assert.ok(of('meadow:copper-rock').length < of('meadow:rock').length, 'a few of the rocks are copper')
  for (const wild of of('meadow:hive') as HiveEntity[]) assert.deepEqual([wild.queen, wild.bees, wild.honey], [1, BEES.workers, 0], 'a wild hive has its colony')
  // Rivers: fresh water on the meadow, reaching the sea, and every clay on a river's bank.
  const river = tilesOf(terrain, meadow, (x, y) => waterAt(terrain, x, y))
  assert.ok(river.length > 50, `${river.length} tiles of river`)
  assert.ok(river.some(({ x, y }) => isSeaAt(terrain, x + 1, y) || isSeaAt(terrain, x - 1, y) || isSeaAt(terrain, x, y + 1) || isSeaAt(terrain, x, y - 1)), 'a river runs into the sea')
  const riverAt = (x: number, y: number): boolean => waterAt(terrain, x, y) && !isSeaAt(terrain, x, y)
  for (const lump of of('meadow:clay')) {
    assert.ok(riverAt(lump.x + 1, lump.y) || riverAt(lump.x - 1, lump.y) || riverAt(lump.x, lump.y + 1) || riverAt(lump.x, lump.y - 1), 'clay by a river')
  }
  // The desert: sand all over, a cactus only on it.
  assert.ok(isSandAt(terrain, desert.x, desert.y) && biomeAt(terrain, desert.x, desert.y)?.ground === 'sand')
  for (const cactus of of('desert:cactus')) assert.ok(isSandAt(terrain, cactus.x, cactus.y))
  // The goblins' camps on the meadow, with no river at the fire nor running through the clearing round it.
  const camps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap((seed) => goblinCampSites(terrainOf(seed)).map((camp) => ({ seed, camp })))
  assert.ok(camps.length > 0, 'goblins camp on the meadow')
  for (const { seed, camp } of camps) {
    const world = terrainOf(seed)
    assert.equal(biomeAt(world, camp.x, camp.y)?.key, 'meadow')
    for (let dy = -GOBLIN_CLEARING; dy <= GOBLIN_CLEARING; dy++) {
      for (let dx = -GOBLIN_CLEARING; dx <= GOBLIN_CLEARING; dx++) assert.ok(!waterAt(world, camp.x + dx, camp.y + dy), `seed ${seed}: no water in the camp at ${camp.x}, ${camp.y}`)
    }
  }
  // Cows on the meadow, spiders in the desert.
  assert.ok(animalDef('cow').biomes.includes('meadow') && animalDef('cow').population > 0)
  assert.ok(animalDef('spider').biomes.includes('desert') && animalDef('spider').solitary)
})

test('a truesight flesh comes from the altar; eaten it hurts 99, is not eaten if that would kill, and lifts the fog for good: a player without it cannot set foot on the far islands or travel there', () => {
  const ritual = ALTAR_RECIPES.find((recipe) => recipe.output === itemId('truesight-flesh'))!
  assert.deepEqual(
    new Map(ritual.inputs.map(([item, count]) => [item, count])),
    new Map([
      [itemId('lich-core'), 1],
      [itemId('essence'), 20],
      [itemId('bone'), 20],
      [itemId('steak'), 20],
      [itemId('raw-chicken'), 20],
    ]),
  )
  assert.deepEqual(ritual.liquids, [[LIQUIDS.indexOf('blood'), 16]])
  assert.ok(isFood(itemId('truesight-flesh')), 'it goes in the food slot, to be eaten with F')

  const terrain = terrainOf(11)
  const meadow = terrain.sites.find((site) => site.biome.key === 'meadow')!
  const spot = tilesOf(terrain, meadow, (x, y) => !waterAt(terrain, x, y))[0]
  const { room, client } = bare('SIGHT', [createEntity(900_001, 'waystone', 2, 0, 0, 0), createEntity(900_002, 'waystone', spot.x, spot.y, 0, 0)])
  // The fog is as solid as a wall to them, until they have truesight.
  const solidFor = (player: { truesight?: boolean }): IsSolid => (room as unknown as { solidFor(player: { truesight?: boolean }): IsSolid }).solidFor(player)
  const land = tilesOf(terrain, meadow, (x, y) => !waterAt(terrain, x, y) && !room.world.entityAt(x, y))[5]
  assert.equal(solidFor({})(land.x, land.y), true, 'fog without truesight')
  assert.equal(solidFor({ truesight: true })(land.x, land.y), false, 'open ground with it')
  assert.equal(solidFor({})(0, 0), false, 'the forest is open to everyone')
  // A waystone in the fog cannot be travelled to without truesight.
  client.command({ k: 'warp', id: 900_001, to: 900_002 })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'fogged')

  give(client, { 'truesight-flesh': 2 })
  client.player.health = 99
  client.command({ k: 'eat', slot: 0 })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'wouldKill')
  assert.equal(client.player.health, 99)
  assert.equal(countOf(client.player.inventory, itemId('truesight-flesh')), 2, 'not eaten')
  client.player.health = PLAYER_MAX_HEALTH
  client.command({ k: 'eat', slot: 0 })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.ok, true)
  assert.equal(client.player.health, 1, 'it hurts 99')
  assert.equal(countOf(client.player.inventory, itemId('truesight-flesh')), 1)
  assert.equal(client.player.truesight, true)
  assert.ok(client.sight, 'the page is told: the fog lifts')

  client.command({ k: 'warp', id: 900_001, to: 900_002 })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.ok, true, 'now it can travel there')

  // Kept in the save, and the page told again on coming back.
  const saved = room.exportSave()
  assert.equal(saved.players.visitor.truesight, true)
  const again = GameRoom.fromSave(saved, { dropsOnGround: false, plants: false, animals: false })
  const back = new TestClient(again, 'Visitor')
  run(again, [back], 3)
  assert.equal(back.player.truesight, true)
  assert.ok(back.sight)
})

test('the fog is drawn as deep on each side of the edge between two chunks (the picture of it for each chunk overlaps the next), so no seam shows there; it is FOG_REACH deep over the island and fades out FOG_REACH tiles out to sea', () => {
  const terrain = terrainOf(11)
  const meadow = terrain.sites.find((site) => site.biome.fogged)!
  let coast = meadow.y
  while (isFoggedAt(terrain, meadow.x, coast)) coast++
  const cx = floorDiv(meadow.x, CHUNK_SIZE)
  const cy = floorDiv(coast, CHUNK_SIZE)
  // Where the depths of two neighbouring chunks overlap (the last 2 * DEPTH_BORDER columns or rows of one, the first of
  // the other), they are the same; a chunk the fog does not reach has none, so its neighbour's are all as low as they go.
  let compared = 0
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const here = fogDepth(terrain, cx + dx, cy + dy)
      const east = fogDepth(terrain, cx + dx + 1, cy + dy)
      const south = fogDepth(terrain, cx + dx, cy + dy + 1)
      for (let along = 0; along < DEPTH_SIDE; along++) {
        for (let i = 0; i < 2 * DEPTH_BORDER; i++) {
          const pairs: Array<[number | undefined, number | undefined]> = [
            [here?.[along * DEPTH_SIDE + CHUNK_SIZE + i], east?.[along * DEPTH_SIDE + i]],
            [here?.[(CHUNK_SIZE + i) * DEPTH_SIDE + along], south?.[i * DEPTH_SIDE + along]],
          ]
          for (const [a, b] of pairs) {
            if (a === undefined && b === undefined) continue
            assert.equal(a ?? -FOG_BELOW, b ?? -FOG_BELOW, `chunk ${cx + dx}, ${cy + dy}`)
            compared++
          }
        }
      }
    }
  }
  assert.ok(compared > 0, 'the fog reaches the chunks round the coast')
  // On the island, at its coast, and out to sea (in the chunk's own tiles, from its top left corner).
  const depthAt = (x: number, y: number): number => {
    const depth = fogDepth(terrain, floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE))
    return depth ? fogDepthAt(depth, x - floorDiv(x, CHUNK_SIZE) * CHUNK_SIZE + 0.5, y - floorDiv(y, CHUNK_SIZE) * CHUNK_SIZE + 0.5) : -FOG_BELOW
  }
  assert.equal(depthAt(meadow.x, coast - 1), FOG_REACH)
  assert.equal(depthAt(meadow.x, coast + FOG_REACH - 1), 0)
  assert.equal(depthAt(meadow.x, coast + FOG_REACH + FOG_BELOW + 5), -FOG_BELOW)
})

test('what the meadow and the desert are broken for: copper, tin and clay only to a pickaxe; sand, cacti, sunflowers and cobwebs to anything', () => {
  const things = [
    createEntity(900_011, 'copper-rock', 1, 0, 0, 0),
    createEntity(900_012, 'tin-rock', 1, 1, 0, 0),
    createEntity(900_013, 'clay', 1, -1, 0, 0),
    createEntity(900_014, 'sand', -1, 0, 0, 0),
    createEntity(900_015, 'cactus', -1, 1, 0, 0),
    createEntity(900_016, 'sunflower', -1, -1, 0, 0),
    createEntity(900_017, 'cobweb', 0, 1, 0, 0),
  ]
  const { room, client } = bare('BREAK', things)
  give(client, { pickaxe: 1 })
  // Bare hands (an empty slot): nothing from the rocks or the clay.
  const punch = (id: number, slot: number): void => {
    client.command({ k: 'punch', id, slot })
    run(room, [client], PUNCH_COOLDOWN_TICKS + 1)
  }
  for (const id of [900_011, 900_012, 900_013]) {
    punch(id, 5)
    assert.equal(client.results.at(-1)?.why, 'needsPickaxe')
  }
  for (const id of [900_011, 900_012, 900_013]) for (let i = 0; i < 12 && room.world.entity(id); i++) punch(id, 0)
  for (const id of [900_014, 900_015, 900_016, 900_017]) for (let i = 0; i < 12 && room.world.entity(id); i++) punch(id, 5)
  for (const thing of things) assert.equal(room.world.entity(thing.id), undefined, `${thing.kind} broken`)
  for (const [key, least, most] of [
    ['copper-nugget', 1, 3],
    ['tin-nugget', 1, 3],
    ['clay', 2, 4],
    ['sand', 1, 2],
    ['cactus', 1, 1],
    ['sunflower-seed', 1, 3],
    ['string', 1, 1],
  ] as const) {
    const have = countOf(client.player.inventory, itemId(key))
    assert.ok(have >= least && have <= most, `${have} ${key}`)
  }
  assert.deepEqual(differingChunks(room, client), [])
})

test('a sunflower seed grows into a sunflower on bare ground with soil (no garden plot); a cactus is only put down on sand', () => {
  const { room, client } = bare('SOWING')
  give(client, { 'sunflower-seed': 2, cactus: 2 })
  client.command({ k: 'place', x: 2, y: 0, slot: 0 })
  run(room, [client], 3)
  const seedling = room.world.entityAt(2, 0)
  assert.equal(seedling?.kind, 'seedling', 'planted straight in the ground')
  client.command({ k: 'place', x: 2, y: 1, slot: 1 })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'onlySand', 'no cactus on grass')
  // A beach, due east of the forest's middle: sand.
  const forest = room.terrain.sites[0]
  let x = forest.x
  while (!isSeaAt(room.terrain, x + 1, forest.y)) x++
  client.player.position = tileMiddle(x - 1, forest.y)
  run(room, [client], 3)
  client.command({ k: 'place', x, y: forest.y, slot: 1 })
  run(room, [client], 3)
  assert.equal(room.world.entityAt(x, forest.y)?.kind, 'cactus', 'a cactus on the sand')
  client.player.position = tileMiddle(0, 0)
  run(room, [client], 3)
  for (let i = 0; i < 300 && room.world.entity(seedling!.id)?.kind !== 'sunflower'; i++) run(room, [client], 100)
  assert.equal(room.world.entity(seedling!.id)?.kind, 'sunflower', 'it grew')
  assert.deepEqual(differingChunks(room, client), [])
})

test('leaves put in a fire are cooked into smoke: they burn away and make nothing, and the fire smokes while it cooks them', () => {
  const fire = createEntity(900_021, 'campfire', 2, 0, 0, 0) as CampfireEntity
  const { room, client } = bare('SMOKE', [fire])
  give(client, { log: 4, leaves: 3 })
  client.command({ k: 'put', id: fire.id, item: itemId('leaves'), max: 3, slot: 1 })
  client.command({ k: 'put', id: fire.id, item: itemId('log'), max: 4, slot: 0 })
  run(room, [client], 3)
  const lit = (): CampfireEntity => room.world.entity(fire.id) as CampfireEntity
  assert.deepEqual([lit().inv.slots[CAMPFIRE_COOK].item, lit().inv.slots[CAMPFIRE_COOK].count], [itemId('leaves'), 3], 'leaves go to be cooked')
  assert.equal(lit().inv.slots[CAMPFIRE_FUEL].item, itemId('log'))
  client.command({ k: 'machine', id: fire.id, action: 'light' })
  run(room, [client], 3)
  for (let i = 0; i < 100 && !isSmoking(lit()); i++) run(room, [client], 5)
  assert.ok(isSmoking(lit()), 'it smokes once hot enough')
  for (let i = 0; i < 200 && lit().inv.slots[CAMPFIRE_COOK].count > 0; i++) run(room, [client], 10)
  assert.equal(lit().inv.slots[CAMPFIRE_COOK].count, 0, 'the leaves burnt away')
  assert.equal(lit().inv.slots[CAMPFIRE_COOKED].count, 0, 'into nothing')
  assert.equal(isSmoking(lit()), false, 'and the smoke stops')
  assert.deepEqual(differingChunks(room, client), [])
})

test('bees gather from sunflowers near their hive for honey (none without them); a punch knocks out a honeycomb and sends them after you; a bucket does nothing; a honeycomb cooks into honey in a barrel', () => {
  const sunflowers = [createEntity(900_031, 'sunflower', 6, 0, 0, 0), createEntity(900_032, 'sunflower', 7, 1, 0, 0)]
  const barrel = createEntity(900_034, 'barrel', -2, 0, 0, 0)
  const fire = createEntity(900_035, 'campfire', -2, 1, 0, 0) as CampfireEntity
  fire.lit = 1
  fire.inv.slots[CAMPFIRE_FUEL] = { item: itemId('log'), count: 10 }
  const { room, client } = bare('HONEY', [hive(900_030, 3, 0, { queen: 1, bees: 3 }), hive(900_033, 0, 22, { queen: 1, bees: 3 }), ...sunflowers, barrel, fire])
  for (let i = 0; i < 120 && hiveIn(room, 900_030)!.honey < 2; i++) run(room, [client], TPS)
  assert.ok(hiveIn(room, 900_030)!.honey >= 2, `honey (${hiveIn(room, 900_030)!.honey})`)
  assert.equal(hiveIn(room, 900_033)!.honey, 0, 'no honey without sunflowers near')
  // A bucket on a hive does nothing.
  give(client, { bucket: 1 })
  const honey = hiveIn(room, 900_030)!.honey
  client.command({ k: 'apply', x: 3, y: 0, slot: 0 })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.ok, false)
  assert.equal(countOf(client.player.inventory, itemId('bucket')), 1)
  assert.equal(room.bees!.list().filter((bee) => bee.target !== 0).length, 0, 'and angers nobody')
  // A punch: a honeycomb, out of its honey, and the hive no worse; its bees come after them and sting.
  client.player.health = 1_000
  const before = hiveIn(room, 900_030)!
  client.command({ k: 'punch', id: 900_030, slot: 5 })
  run(room, [client], 3)
  assert.equal(countOf(client.player.inventory, itemId('honeycomb')), 1)
  assert.equal(hiveIn(room, 900_030)!.honey, honey - 1)
  assert.equal(hiveIn(room, 900_030)!.hp, before.hp, 'punching does not hurt it')
  assert.equal(room.bees!.list().filter((bee) => !bee.bee.queen && bee.target === client.player.id).length, 3, 'every worker of that hive comes after them')
  for (let i = 0; i < 10 * TPS && client.player.health === 1_000; i++) run(room, [client], 1)
  assert.ok(client.player.health < 1_000, 'and stings')
  // Cooked in a barrel by a fire: honey, drawn off with the bucket.
  client.command({ k: 'put', id: barrel.id, item: itemId('honeycomb'), max: 1 })
  run(room, [client], 3)
  for (let i = 0; i < 60 && (room.world.entity(barrel.id) as { amount: number }).amount === 0; i++) run(room, [client], TPS)
  assert.equal((room.world.entity(barrel.id) as { amount: number; liquid: number }).liquid, LIQUIDS.indexOf('honey'))
  client.command({ k: 'apply', x: -2, y: 0, slot: 0 })
  run(room, [client], 3)
  assert.equal(countOf(client.player.inventory, itemId('honey-bucket')), 1)
})

test('angry bees calm down in the smoke of a fire cooking leaves, and go home', () => {
  const fire = createEntity(900_041, 'campfire', 1, 1, 0, 0) as CampfireEntity
  fire.lit = 1
  fire.inv.slots[CAMPFIRE_FUEL] = { item: itemId('log'), count: 5 }
  fire.inv.slots[CAMPFIRE_COOK] = { item: itemId('leaves'), count: 20 }
  const { room, client } = bare('CALM', [hive(900_040, 6, 0, { queen: 1, bees: 3 }), fire])
  for (let i = 0; i < 100 && !isSmoking(room.world.entity(fire.id) as CampfireEntity); i++) run(room, [client], 5)
  client.player.health = 1_000
  client.command({ k: 'punch', id: 900_040, slot: 5 })
  run(room, [client], 3)
  const out = (): number => room.bees!.list().length
  assert.equal(out(), 3, 'out, after the player by the fire')
  for (let i = 0; i < 30 * TPS && out() > 0; i++) run(room, [client], 1)
  assert.equal(out(), 0, 'calmed, and back in their hive')
  assert.equal(hiveIn(room, 900_040)!.bees, 3)
})

test('with every worker killed the queen leaves, and moves into the nearest hive with no queen; a hive destroyed, its workers follow her into one', () => {
  const { room, client } = bare('SWARM', [
    hive(900_050, 4, 0, { queen: 1, bees: 2 }),
    hive(900_051, 4, 10),
    hive(900_052, -6, 0, { queen: 1, bees: 4, hp: 1 }, 'hive'),
    hive(900_053, -8, 6),
  ])
  give(client, { axe: 1 })
  client.player.health = 100_000
  client.command({ k: 'punch', id: 900_050, slot: 5 })
  run(room, [client], 3)
  for (const bee of room.bees!.list()) room.monsters!.damage(bee.id, 999, client.player.position, room.tick, {}, client.player.id)
  run(room, [client], 2)
  assert.deepEqual([hiveIn(room, 900_050)!.queen, hiveIn(room, 900_050)!.bees], [0, 0], 'the queen left her empty hive')
  for (let i = 0; i < 40 * TPS && hiveIn(room, 900_051)!.queen === 0; i++) run(room, [client], 1)
  assert.equal(hiveIn(room, 900_051)!.queen, 1, 'and moved into the empty one nearest her')

  // A wild hive broken: its workers come out after whoever broke it, its queen flies off.
  client.command({ k: 'punch', id: 900_052, slot: 0 })
  run(room, [client], 3)
  assert.equal(room.world.entity(900_052), undefined, 'broken')
  assert.equal(room.bees!.list().filter((bee) => bee.bee.queen).length, 1)
  assert.equal(room.bees!.list().filter((bee) => !bee.bee.queen && bee.target === client.player.id).length, 4)
  // Out of their reach, they calm down and follow her into the nearest empty hive (the bee box).
  client.player.position = tileMiddle(-6, -40)
  for (let i = 0; i < 60 * TPS && hiveIn(room, 900_053)!.bees < 4; i++) run(room, [client], 1)
  assert.deepEqual([hiveIn(room, 900_053)!.queen, hiveIn(room, 900_053)!.bees], [1, 4], 'the swarm moved in')
  assert.equal(room.bees!.list().length, 0)
})

test('spiders live alone, spin cobwebs round themselves (no more than `most` each standing at once, however far they wander), and eat meat from a feed box, which is how they are bred', () => {
  const { room, client } = bare('SPIDERS', [createEntity(900_061, 'feeder', 6, 0, 0, 0)])
  const def = animalDef('spider')
  const context = (room as unknown as { animalContext(tick: number): AnimalContext }).animalContext(room.tick)
  assert.equal(room.animals!.spawnHerd(context, def, tileMiddle(10, 10).x, tileMiddle(10, 10).y), 1, 'one at a time')
  for (const spider of room.animals!.list()) room.animals!.remove(spider.id)
  // Cobwebs: spun now and then (here, often), on free ground round it, and never more than `most` of its own standing.
  const { most, radius } = def.webs!
  const spinner = room.animals!.spawn(def, tileMiddle(3, 6).x, tileMiddle(3, 6).y)
  const cobwebs = (): Entity[] => {
    const found: Entity[] = []
    for (const chunk of room.world.chunkIds) for (const entity of room.world.chunk(chunk)!.entities) if (entity.kind === 'cobweb') found.push(entity)
    return found
  }
  const spinAWhile = (): void => {
    for (let i = 0; i < most * 3; i++) {
      spinner.nextWebAt = room.tick + 1
      run(room, [client], 2)
    }
  }
  spinAWhile()
  assert.equal(cobwebs().length, most, 'as many as it may spin')
  const near = (web: Entity): boolean => Math.abs(web.x - Math.floor(spinner.x / SUB)) <= radius + 1 && Math.abs(web.y - Math.floor(spinner.y / SUB)) <= radius + 1
  assert.ok(cobwebs().every(near), 'round it')
  // Gone somewhere else, it spins no more there while those still stand.
  spinner.x = tileMiddle(4, -10).x
  spinner.y = tileMiddle(4, -10).y
  spinAWhile()
  assert.equal(cobwebs().length, most, 'none more, however far it wanders')
  assert.equal(room.animals!.toSave().animals.find((animal) => animal.id === spinner.id)?.webs?.length, most, 'saved, with what it has spun')
  // One broken, it spins another, where it is now.
  room.world.removeEntity(cobwebs()[0].id)
  spinAWhile()
  assert.equal(cobwebs().length, most)
  assert.equal(cobwebs().filter(near).length, 1, 'the new one round where it is now')
  assert.ok(BUILDINGS.cobweb.natural)
  room.animals!.remove(spinner.id)
  for (const web of cobwebs()) room.world.removeEntity(web.id)
  // Fed meat from a box, a pair breeds.
  const pair = [room.animals!.spawn(def, tileMiddle(3, 0).x, tileMiddle(3, 0).y, { sex: 'f' }), room.animals!.spawn(def, tileMiddle(3, 2).x, tileMiddle(3, 2).y, { sex: 'm' })]
  for (const spider of pair) spider.hunger = 900
  give(client, { steak: 10 })
  client.command({ k: 'put', id: 900_061, item: itemId('steak'), max: 10 })
  run(room, [client], 3)
  for (let i = 0; i < 180 && room.animals!.list().length < 3; i++) run(room, [client], TPS)
  assert.ok(pair.every((spider) => !spider.wild), 'fed: no longer wild')
  assert.equal(room.animals!.list().length, 3, 'a baby')
})

test('mummies keep tombs in the desert: slower than a player, tougher than a goblin, and hit a player by walking up to them', () => {
  const tombs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap((seed) => tombSites(terrainOf(seed)).map((tomb) => ({ seed, tomb })))
  assert.ok(tombs.length > 0, 'tombs in the desert')
  for (const { seed, tomb } of tombs) assert.equal(biomeAt(terrainOf(seed), tomb.x, tomb.y)?.key, 'desert')
  const seed = tombs[0].seed
  const room = new GameRoom('TOMBS', seed, { dropsOnGround: false, wildAnimals: true })
  const client = new TestClient(room, 'Wanderer')
  const tomb = tombSites(room.terrain)[0]
  client.player.position = tileMiddle(tomb.x + 20, tomb.y)
  client.player.health = 100_000
  run(room, [client], 2 * TPS)
  const middle = tileMiddle(tomb.x, tomb.y)
  const mummies = room.monsters!.list().filter((monster) => monster.def.kind === 'mummy' && Math.hypot(monster.homeX - middle.x, monster.homeY - middle.y) < SUB)
  assert.ok(mummies.length >= WORLD_GEN.tombs.mummiesMin && mummies.length <= WORLD_GEN.tombs.mummiesMax, `${mummies.length} mummies at the tomb`)
  // Nothing grows round a tomb.
  for (const chunk of room.world.chunkIds) {
    for (const entity of room.world.chunk(chunk)!.entities) assert.ok(Math.hypot(entity.x - tomb.x, entity.y - tomb.y) > TOMB_CLEARING, `${entity.kind} in the tomb's clearing`)
  }

  const mummy = monsterDef('mummy')
  const goblin = monsterDef('goblin')
  assert.ok(mummy.speed < PLAYER_SPEED, 'slower than a player')
  assert.ok(mummy.hp > goblin.hp && mummy.armor > goblin.armor, 'tougher than a goblin')
  assert.ok(mummy.attack.kind === 'melee' && goblin.attack.kind === 'melee' && mummy.attack.damage > goblin.attack.damage, 'and hits harder')
  assert.deepEqual(mummy.drops, [], 'drops nothing yet')
  const { room: arena, client: visitor } = bare('MUMMY')
  const at = visitor.player.position
  const one = arena.monsters!.spawn(mummy, at.x + SUB, at.y)
  arena.monsters!.provoke(one.id, visitor.player.id, arena.tick)
  for (let i = 0; i < 3 * TPS && visitor.player.health === PLAYER_MAX_HEALTH; i++) run(arena, [visitor], 1)
  assert.ok(visitor.player.health < PLAYER_MAX_HEALTH, 'hit')
  assert.ok(PLAYER_MAX_HEALTH - visitor.player.health <= mummy.attack.damage, 'once, for its damage')
})

test('goblins keep camps on the meadow, and hit a player by walking up to them', () => {
  const seed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((candidate) => goblinCampSites(terrainOf(candidate)).length > 0)!
  const room = new GameRoom('GOBLINS', seed, { dropsOnGround: false, wildAnimals: true })
  const client = new TestClient(room, 'Wanderer')
  const camp = goblinCampSites(room.terrain)[0]
  client.player.position = tileMiddle(camp.x + 20, camp.y)
  client.player.health = 100_000
  run(room, [client], 2 * TPS)
  const goblins = room.monsters!.list().filter((monster) => monster.def.kind === 'goblin' && Math.hypot(monster.homeX - tileMiddle(camp.x, camp.y).x, monster.homeY - tileMiddle(camp.x, camp.y).y) < SUB)
  assert.ok(goblins.length >= WORLD_GEN.goblinCamps.goblinsMin && goblins.length <= WORLD_GEN.goblinCamps.goblinsMax, `${goblins.length} goblins at the camp`)

  const { room: arena, client: visitor } = bare('GOBLIN')
  const at = visitor.player.position
  const goblin = arena.monsters!.spawn(monsterDef('goblin'), at.x + SUB, at.y)
  arena.monsters!.provoke(goblin.id, visitor.player.id, arena.tick)
  for (let i = 0; i < 3 * TPS && visitor.player.health === PLAYER_MAX_HEALTH; i++) run(arena, [visitor], 1)
  assert.ok(visitor.player.health < PLAYER_MAX_HEALTH, 'hit')
  const attack = monsterDef('goblin').attack
  assert.ok(attack.kind === 'melee' && PLAYER_MAX_HEALTH - visitor.player.health <= attack.damage, 'once, for its damage')
})
