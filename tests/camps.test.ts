import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import type { Monster } from '../apps/server/src/monsters.ts'
import {
  ALTAR_RECIPES,
  ARMOR_SLOT,
  CAMP_ROCKS,
  CAMPS,
  campRockSpots,
  campSites,
  countOf,
  EAT_COOLDOWN_TICKS,
  goblinCampSites,
  itemId,
  monsterDef,
  PLAYER_MAX_HEALTH,
  playerInventory,
  playerMaxHealth,
  setBonus,
  SUB,
  TPS,
  WEAPONS,
  weaponIn,
  terrainOf,
  itemByKey,
  tombSites,
} from '../packages/shared/src/index.ts'

const itemDef = (key: string): NonNullable<ReturnType<typeof itemByKey>> => itemByKey(key)!
const tombSitesOf = (seed: number): ReadonlyArray<{ x: number; y: number }> => tombSites(terrainOf(seed))
import { run, TestClient } from './helpers.ts'

// How many of a kind of monster (or of all of them) keep a kind of camp, at the fewest and the most (see camps.json).
const keepers = (camp: keyof typeof CAMPS, kind?: string): { min: number; max: number } => {
  const which = CAMPS[camp].monsters.filter((monster) => kind === undefined || monster.kind === kind)
  return { min: which.reduce((sum, monster) => sum + monster.min, 0), max: which.reduce((sum, monster) => sum + monster.max, 0) }
}

const center = (x: number, y: number): { x: number; y: number } => ({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })

// Bare ground (nothing grown), what was asked for in the player's slots, slot by slot.
function arena(code: string, items: Record<string, number> = {}, options: { drops?: boolean; camps?: boolean } = {}): { room: GameRoom; client: TestClient } {
  const room = new GameRoom(code, 11, { dropsOnGround: options.drops ?? false, wildAnimals: options.camps ?? false, plants: false, animals: true })
  const client = new TestClient(room, 'Fighter')
  run(room, [client], 5)
  Object.entries(items).forEach(([key, count], slot) => (client.player.inventory.slots[slot] = { item: itemId(key), count }))
  return { room, client }
}

// The frost lich, as something to hit that never moves or fights back outside its hall: a tile to the player's right.
function lichBeside(room: GameRoom, client: TestClient, hp?: number): Monster {
  const at = client.player.position
  return room.monsters!.spawn(monsterDef('frost-lich'), at.x + SUB, at.y, hp === undefined ? {} : { hp })
}

const chargedAttack = (room: GameRoom, client: TestClient, slot: number, at: { x: number; y: number }): void => {
  client.command({ k: 'charge', slot })
  run(room, [client], weaponIn(client.player.inventory, slot).charged!.charge)
  client.command({ k: 'attack', slot, x: at.x, y: at.y, charged: 1 })
}

const kill = (room: GameRoom, client: TestClient, which: (monster: Monster) => boolean): void => {
  for (const monster of room.monsters!.list().filter(which)) room.monsters!.damage(monster.id, 1_000_000, client.player.position, room.tick)
}

test('each camp is kept by a building in the world, with its rocks by it: broken (for leather), the camp is gone and nothing comes back to it; its rocks come back as its monsters do', () => {
  const room = new GameRoom('CAMPS', 7, { terrain: { radius: 70 }, dropsOnGround: false })
  const client = new TestClient(room, 'Raider')
  const [camp, other] = campSites(room.terrain)
  const tent = room.world.entityAt(camp.x, camp.y)!
  assert.equal(tent.kind, 'skeleton-camp')
  const spots = campRockSpots(room.seed, camp.x, camp.y, CAMP_ROCKS['skeleton-camp'].count)
  assert.equal(spots.length, CAMPS['skeleton-camp'].rocks.count)
  for (const spot of spots) assert.equal(room.world.entityAt(spot.x, spot.y)?.kind, 'rock', 'a rock by the tent')
  // It stands in the way.
  const solid = (room as unknown as { solid: (x: number, y: number) => unknown }).solid(camp.x, camp.y)
  assert.ok(solid !== false, 'solid')

  // A rock broken comes back when the camp's skeletons do.
  client.player.position = center(camp.x + 24, camp.y)
  client.player.health = 100_000
  run(room, [client], 2 * TPS)
  const guards = (): Monster[] => room.monsters!.list().filter((monster) => monster.post?.camp === tent.id)
  assert.ok(guards().length > 0, 'the camp is kept')
  room.world.removeEntity(room.world.entityAt(spots[0].x, spots[0].y)!.id)
  kill(room, client, (monster) => monster.post?.camp === tent.id)
  run(room, [client], 2 * TPS)
  assert.equal(room.world.entityAt(spots[0].x, spots[0].y), undefined, 'not back at once')
  run(room, [client], CAMPS['skeleton-camp'].respawn + 2 * TPS)
  assert.ok(guards().length > 0, 'the skeletons are back')
  assert.equal(room.world.entityAt(spots[0].x, spots[0].y)?.kind, 'rock', 'and the rock with them')

  // Brought down with an axe: leather, and the camp is gone for good.
  kill(room, client, (monster) => monster.post?.camp === tent.id)
  client.player.inventory.slots[0] = { item: itemId('axe'), count: 1 }
  client.player.position = center(camp.x, camp.y - 1)
  for (let i = 0; i < 40 && room.world.entity(tent.id); i++) {
    client.command({ k: 'attack', slot: 0, x: center(camp.x, camp.y).x, y: center(camp.x, camp.y).y })
    run(room, [client], WEAPONS.get('axe')!.cooldown + 1)
  }
  assert.equal(room.world.entity(tent.id), undefined, 'broken')
  const leather = countOf(client.player.inventory, itemId('leather'))
  assert.ok(leather >= 2 && leather <= 4, `${leather} leather`)
  kill(room, client, (monster) => monster.post?.camp === tent.id)
  client.player.position = center(camp.x + 24, camp.y)
  run(room, [client], CAMPS['skeleton-camp'].respawn + 4 * TPS)
  assert.equal(guards().length, 0, 'nothing comes back to it')
  assert.ok(!room.monsters!.campMiddles().some((middle) => Math.abs(middle.x - center(camp.x, camp.y + 2).x) < SUB && Math.abs(middle.y - center(camp.x, camp.y + 2).y) < SUB), 'the camp is gone')
  // Another camp is not.
  if (other) assert.equal(room.world.entityAt(other.x, other.y)?.kind, 'skeleton-camp')
})

test("goblins' camps keep goblins, an archer and a shaman round a lean-to, with the meadow's tin by it", () => {
  const seed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((candidate) => goblinCampSites(terrainOf(candidate)).length > 0)!
  const room = new GameRoom('GOBLINS', seed, { dropsOnGround: false })
  const client = new TestClient(room, 'Wanderer')
  const camp = goblinCampSites(room.terrain)[0]
  const keeper = room.world.entityAt(camp.x, camp.y)!
  assert.equal(keeper.kind, 'goblin-camp')
  for (const spot of campRockSpots(room.seed, camp.x, camp.y, CAMPS['goblin-camp'].rocks.count)) assert.equal(room.world.entityAt(spot.x, spot.y)?.kind, 'tin-rock')
  client.player.position = center(camp.x + 20, camp.y)
  client.player.health = 100_000
  run(room, [client], 2 * TPS)
  const kinds = room.monsters!.list().filter((monster) => monster.post?.camp === keeper.id).map((monster) => monster.def.kind)
  const all = keepers('goblin-camp')
  assert.ok(kinds.length >= all.min && kinds.length <= all.max, `${kinds.length} goblins`)
  for (const kind of ['goblin-archer', 'goblin-shaman']) {
    const some = kinds.filter((which) => which === kind).length
    assert.ok(some >= keepers('goblin-camp', kind).min && some <= keepers('goblin-camp', kind).max, `${some} ${kind}`)
  }
  assert.equal(monsterDef('goblin-archer').attack.kind, 'bow')
  const hex = monsterDef('goblin-shaman').attack
  assert.ok(hex.kind === 'lob' && hex.item === itemId('hex-bolt'), 'a shaman lobs hexes')
})

test('a skeleton camp is made at an altar, and put down (only in the mountains) it keeps skeletons, with its stones by it', () => {
  const ritual = ALTAR_RECIPES.find((recipe) => recipe.output === itemId('skeleton-camp'))!
  assert.deepEqual(
    new Map(ritual.inputs),
    new Map([
      [itemId('leather'), 12],
      [itemId('lich-core'), 1],
      [itemId('essence'), 30],
      [itemId('bone'), 20],
    ]),
  )
  const { room, client } = arena('MADE', { 'skeleton-camp': 1 }, { camps: true })
  // Not in the forest.
  const home = { x: Math.floor(client.player.position.x / SUB) + 2, y: Math.floor(client.player.position.y / SUB) }
  client.command({ k: 'place', x: home.x, y: home.y, slot: 0 })
  run(room, [client], 3)
  assert.equal(client.results.at(-1)?.why, 'campBiome')
  // In the mountains.
  const mountains = room.terrain.sites[1]
  const at = { x: mountains.x, y: mountains.y }
  client.player.position = center(at.x - 2, at.y)
  run(room, [client], 3)
  client.command({ k: 'place', x: at.x, y: at.y, slot: 0 })
  run(room, [client], 3)
  const tent = room.world.entityAt(at.x, at.y)!
  assert.equal(tent.kind, 'skeleton-camp')
  client.player.position = center(at.x + 24, at.y)
  client.player.health = 100_000
  run(room, [client], 2 * TPS)
  const guards = room.monsters!.list().filter((monster) => monster.post?.camp === tent.id)
  assert.ok(guards.length >= keepers('skeleton-camp').min && guards.length <= keepers('skeleton-camp').max, `${guards.length} skeletons`)
  for (const spot of campRockSpots(room.seed, at.x, at.y, CAMPS['skeleton-camp'].rocks.count)) assert.equal(room.world.entityAt(spot.x, spot.y)?.kind, 'rock')
})

test('a goblin camp and a mummy camp are items too, each put down only in its own land', () => {
  assert.equal(itemDef('goblin-camp').places, 'goblin-camp')
  assert.equal(itemDef('mummy-camp').places, 'tomb')
  const { room, client } = arena('LANDS', { 'goblin-camp': 1, 'mummy-camp': 1 })
  const [, mountains, meadow, desert] = room.terrain.sites
  const tryAt = (slot: number, site: { x: number; y: number }): string | undefined => {
    client.player.position = center(site.x - 2, site.y)
    run(room, [client], 3)
    client.command({ k: 'place', x: site.x, y: site.y, slot })
    run(room, [client], 3)
    return client.results.at(-1)?.why
  }
  // (Truesight, to set foot on the far islands.)
  client.player.truesight = true
  assert.equal(tryAt(0, mountains), 'campBiome', 'no goblin camp in the mountains')
  assert.equal(tryAt(1, meadow), 'campBiome', 'no mummy camp on the meadow')
  assert.equal(tryAt(0, meadow), undefined)
  assert.equal(room.world.entityAt(meadow.x, meadow.y)?.kind, 'goblin-camp')
  assert.equal(tryAt(1, desert), undefined)
  assert.equal(room.world.entityAt(desert.x, desert.y)?.kind, 'tomb')
})

test('dust elementals keep the tombs with the mummies, and loose twisters that blow through a player and on past where they were aimed for a second', () => {
  const room = new GameRoom('DUST', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((seed) => tombSitesOf(seed).length > 0)!, { dropsOnGround: false })
  const client = new TestClient(room, 'Wanderer')
  const tomb = tombSitesOf(room.seed)[0]
  const keeper = room.world.entityAt(tomb.x, tomb.y)!
  client.player.position = center(tomb.x + 20, tomb.y)
  client.player.health = 100_000
  run(room, [client], 2 * TPS)
  const kinds = room.monsters!.list().filter((monster) => monster.post?.camp === keeper.id).map((monster) => monster.def.kind)
  const elementals = kinds.filter((kind) => kind === 'dust-elemental').length
  assert.ok(elementals >= keepers('tomb', 'dust-elemental').min && elementals <= keepers('tomb', 'dust-elemental').max, `${elementals} dust elementals`)
  assert.ok(kinds.filter((kind) => kind === 'mummy').length >= keepers('tomb', 'mummy').min)
  // A twister: on through the player (hurting them once), and on past for a second.
  const twister = monsterDef('dust-elemental').attack
  assert.ok(twister.kind === 'twister')
  const { room: arena_, client: visitor } = arena('TWISTER')
  const at = visitor.player.position
  const before = visitor.player.health
  arena_.combat.twister(twister.item, at.x - 4 * SUB, at.y, 0, twister.speed, twister.damage, Math.ceil((4 * SUB) / twister.speed) + twister.linger, twister.width)
  run(arena_, [visitor], Math.ceil((4 * SUB) / twister.speed) + 2)
  assert.equal(before - visitor.player.health, Math.max(1, twister.damage), 'hurt once, as it went through')
  assert.ok(arena_.combat.inChunks(visitor.player.chunks, arena_.tick).some(([, item, , , stopped]) => item === twister.item && stopped === 0), 'still blowing, past them')
  run(arena_, [visitor], twister.linger)
  assert.equal(before - visitor.player.health, Math.max(1, twister.damage), 'and only once')
  assert.ok(!arena_.combat.inChunks(visitor.player.chunks, arena_.tick).some(([, item, , , stopped]) => item === twister.item && stopped === 0), 'then gone')
})

test('the monsters round a camp walk their rounds: none caught on a corner turning to and fro, or standing stuck short of where it is going', () => {
  for (const seed of [1, 3]) {
    const room = new GameRoom('ROUNDS', seed, { dropsOnGround: false })
    const sites = [...campSites(room.terrain), ...goblinCampSites(room.terrain), ...tombSites(room.terrain)].slice(0, 6)
    // Somebody near each camp (camps keep their monsters only while someone is about), but not near enough to be seen.
    const clients = sites.map((_, i) => {
      const client = new TestClient(room, `Watcher${i}`)
      client.player.health = 1_000_000
      client.player.truesight = true
      return client
    })
    const stand = (): void => sites.forEach((site, i) => (clients[i].player.position = center(site.x + 20, site.y)))
    stand()
    run(room, clients, 2 * TPS)
    const last = new Map<number, { x: number; y: number; dx: number; dy: number; turns: number[] }>()
    const since = new Map<number, { spot: string; at: number }>()
    for (let t = 0; t < 45 * TPS; t++) {
      stand()
      run(room, clients, 1)
      for (const monster of room.monsters!.list()) {
        if (monster.post === undefined) continue
        const was = last.get(monster.id)
        const dx = was ? monster.x - was.x : 0
        const dy = was ? monster.y - was.y : 0
        const turns = was?.turns ?? []
        // A step back the way it came.
        if (was && (dx || dy) && (was.dx || was.dy) && dx * was.dx + dy * was.dy < 0) turns.push(room.tick)
        while (turns.length > 0 && room.tick - turns[0] > TPS) turns.shift()
        assert.ok(turns.length <= 8, `seed ${seed}: a ${monster.def.kind} at ${(monster.x / SUB).toFixed(1)},${(monster.y / SUB).toFixed(1)} turns to and fro`)
        last.set(monster.id, { x: monster.x, y: monster.y, dx: dx || was?.dx || 0, dy: dy || was?.dy || 0, turns })
        // On its way to one spot (not waiting there, nor after anyone) for more than 20 seconds: stuck.
        const spot = monster.patrol && monster.patrol.waitUntil === undefined && monster.target === 0 ? `${monster.patrol.x},${monster.patrol.y}` : ''
        const going = since.get(monster.id)
        if (spot === '') since.delete(monster.id)
        else if (going?.spot !== spot) since.set(monster.id, { spot, at: room.tick })
        else assert.ok(room.tick - going.at <= 20 * TPS, `seed ${seed}: a ${monster.def.kind} at ${(monster.x / SUB).toFixed(1)},${(monster.y / SUB).toFixed(1)} stuck short of its spot`)
      }
    }
  }
})

test('the frost lich leaves every player who hurt it one of its weapons, bound to them (even one who has gone): nobody else can pick it up; and one lich core', () => {
  const { room, client: a } = arena('REWARD', { club: 1 }, { drops: true })
  const b = new TestClient(room, 'Second')
  const thief = new TestClient(room, 'Thief')
  const all = [a, b, thief]
  b.player.inventory.slots[0] = { item: itemId('club'), count: 1 }
  run(room, all, 3)
  const lich = lichBeside(room, a, 20)
  a.command({ k: 'attack', slot: 0, x: lich.x, y: lich.y })
  run(room, all, 3)
  assert.ok(lich.hp < 20 && lich.hp > 0, 'hurt by the first')
  // The first leaves (as if fallen); the second finishes it.
  const away = center(60, 60)
  a.player.position = { ...away }
  b.player.position = { x: lich.x - SUB, y: lich.y }
  b.command({ k: 'attack', slot: 0, x: lich.x, y: lich.y })
  run(room, all, 3)
  assert.equal(room.monsters!.get(lich.id), undefined, 'killed')
  const rewards = new Set(monsterDef('frost-lich').rewards)
  assert.deepEqual([...rewards].sort(), [itemId('bone-longbow'), itemId('permafrost'), itemId('skewer')].sort())
  const lying = (): Array<{ id: number; item: number; x: number; y: number }> => room.world.allDrops().filter((drop) => rewards.has(drop.item))
  assert.equal(lying().length, 2, 'one for each who hurt it')
  assert.equal(room.world.allDrops().filter((drop) => drop.item === itemId('lich-core')).length, 1, 'one lich core')
  const had = (client: TestClient): number => [...rewards].reduce((sum, item) => sum + countOf(client.player.inventory, item), 0)
  // Someone else standing on them picks up neither.
  for (const drop of lying()) {
    thief.player.position = { x: drop.x, y: drop.y }
    run(room, all, TPS)
  }
  assert.equal(had(thief), 0, 'nothing for one who did not fight')
  assert.equal(lying().length, 2)
  for (const drop of lying()) {
    b.player.position = { x: drop.x, y: drop.y }
    run(room, all, TPS)
  }
  assert.equal(had(b), 1, 'the second picks up theirs')
  assert.equal(lying().length, 1, "the first's still lies there")
  // It stays, however long, until the first comes back for it.
  run(room, all, 10 * TPS)
  const left = lying()[0]
  a.player.position = { x: left.x, y: left.y }
  run(room, all, TPS)
  assert.equal(had(a), 1, 'the first picks up theirs')
})

test('the new weapons: a bone longbow, a skewer that dashes through what it hits, and a staff that casts icicles and calls an ice spear down from above', () => {
  const bow = WEAPONS.get('bone-longbow')!
  assert.ok(bow.basic === 'shot' && bow.ammo === itemId('arrow') && bow.charged?.kind === 'shot', 'a bow: a shot, and a charged shot')
  const skewer = WEAPONS.get('skewer')!
  assert.ok(skewer.basic === WEAPONS.get('flint-spear')!.basic && skewer.charged?.kind === 'dash', 'a spear that dashes')
  const staff = WEAPONS.get('permafrost')!
  assert.ok(staff.basic === 'cast' && staff.charged?.kind === 'blast')
  const armor = monsterDef('frost-lich').armor

  // The staff's icicle: it flies at what it is aimed at, using nothing up.
  {
    const { room, client } = arena('STAFF', { permafrost: 1 })
    const lich = lichBeside(room, client)
    const hp = lich.hp
    client.command({ k: 'attack', slot: 0, x: lich.x + 2 * SUB, y: lich.y })
    run(room, [client], staff.windup + 10)
    assert.equal(hp - lich.hp, staff.damage - armor, 'the icicle hits')
    assert.equal(countOf(client.player.inventory, itemId('permafrost')), 1)
    assert.equal(room.world.allDrops().length, 0, 'nothing lands')
    // Charged: an ice spear comes down where it is aimed, after a moment, on everything round it.
    run(room, [client], staff.cooldown + 2)
    const before = lich.hp
    chargedAttack(room, client, 0, { x: lich.x, y: lich.y })
    run(room, [client], 2)
    assert.equal(lich.hp, before, 'not yet')
    run(room, [client], staff.charged!.delay! + 2)
    assert.equal(before - lich.hp, staff.charged!.damage - armor, 'it comes down')
  }
  // The skewer's dash: the player runs through, hurting what is in the way.
  {
    const { room, client } = arena('SKEWER', { skewer: 1 })
    const lich = lichBeside(room, client)
    const hp = lich.hp
    chargedAttack(room, client, 0, { x: lich.x + SUB, y: lich.y })
    run(room, [client], 3)
    assert.equal(hp - lich.hp, skewer.charged!.damage - armor)
    assert.ok((client.player.dashingUntil ?? 0) > room.tick, 'dashing through')
  }
})

test('armour sets: leather armour, boots and a wolf helmet hit 3 harder with everything; the bone armour gives 25 more health and heals 2 for every hurt done; each piece is made at an altar', () => {
  const worn = (...keys: string[]): ReturnType<typeof playerInventory> => {
    const inventory = playerInventory()
    keys.forEach((key, i) => (inventory.slots[ARMOR_SLOT + i] = { item: itemId(key), count: 1 }))
    return inventory
  }
  assert.equal(setBonus(worn('wolf-helmet', 'leather-armor', 'leather-boots')).attack, 3)
  assert.equal(setBonus(worn('wolf-helmet', 'leather-armor')).attack, 0, 'only the whole set')
  const bone = worn('bone-helmet', 'bone-chestplate', 'bone-greaves')
  assert.deepEqual(setBonus(bone), { attack: 0, health: 25, healOnHit: 2 })
  assert.equal(playerMaxHealth(bone, false), PLAYER_MAX_HEALTH + 25)
  for (const piece of ['bone-helmet', 'bone-chestplate', 'bone-greaves']) {
    const ritual = ALTAR_RECIPES.find((recipe) => recipe.output === itemId(piece))!
    const inputs = new Map(ritual.inputs)
    assert.ok(inputs.get(itemId('bone'))! > 0 && inputs.get(itemId('leather'))! > 0 && inputs.get(itemId('lich-core')) === 1, piece)
    assert.ok(ritual.liquids.length === 1, `${piece}: blood`)
  }

  // Hitting harder with the leather set on.
  const { room, client } = arena('SETS', { club: 1 })
  const lich = lichBeside(room, client)
  const club = WEAPONS.get('club')!
  const swing = (): number => {
    const before = lich.hp
    client.command({ k: 'attack', slot: 0, x: lich.x, y: lich.y })
    run(room, [client], club.cooldown + 2)
    return before - lich.hp
  }
  const plain = swing()
  client.player.inventory.slots[ARMOR_SLOT] = { item: itemId('wolf-helmet'), count: 1 }
  client.player.inventory.slots[ARMOR_SLOT + 1] = { item: itemId('leather-armor'), count: 1 }
  client.player.inventory.slots[ARMOR_SLOT + 2] = { item: itemId('leather-boots'), count: 1 }
  assert.equal(swing(), plain + 3)
  // Healed by every hurt done in the bone set.
  client.player.inventory.slots[ARMOR_SLOT] = { item: itemId('bone-helmet'), count: 1 }
  client.player.inventory.slots[ARMOR_SLOT + 1] = { item: itemId('bone-chestplate'), count: 1 }
  client.player.inventory.slots[ARMOR_SLOT + 2] = { item: itemId('bone-greaves'), count: 1 }
  client.player.health = 50
  swing()
  assert.equal(client.player.health, 52)
  // Taken off, no more health than without it.
  client.player.health = PLAYER_MAX_HEALTH + 25
  run(room, [client], 2)
  client.player.inventory.slots[ARMOR_SLOT + 2] = { item: 0, count: 0 }
  run(room, [client], 2)
  assert.equal(client.player.health, PLAYER_MAX_HEALTH)
})

test('a truesight flesh gives 25 more health for good, but eaten it still leaves the player at 1', () => {
  const { room, client } = arena('FLESH', { 'truesight-flesh': 1, 'cooked-meat': 5 })
  assert.equal(client.player.health, PLAYER_MAX_HEALTH)
  client.command({ k: 'eat', slot: 0 })
  run(room, [client], 3)
  assert.equal(client.player.health, 1)
  assert.equal(playerMaxHealth(client.player.inventory, client.player.truesight), PLAYER_MAX_HEALTH + 25)
  client.player.health = PLAYER_MAX_HEALTH + 10
  run(room, [client], EAT_COOLDOWN_TICKS)
  client.command({ k: 'eat', slot: 1 })
  run(room, [client], 3)
  assert.equal(client.player.health, PLAYER_MAX_HEALTH + 25, 'healed up to the new most')
})

test('item spawning: only the host turns it on; then anyone can take any item, as many as they like', () => {
  const { room, client: host } = arena('SPAWN')
  const guest = new TestClient(room, 'Guest')
  run(room, [host, guest], 3)
  guest.command({ k: 'give', item: itemId('bone'), count: 50 })
  run(room, [host, guest], 3)
  assert.equal(guest.results.at(-1)?.why, 'noSpawning')
  guest.command({ k: 'items', on: true })
  run(room, [host, guest], 3)
  assert.equal(guest.results.at(-1)?.why, 'notHost')
  host.command({ k: 'items', on: true })
  run(room, [host, guest], 3)
  guest.command({ k: 'give', item: itemId('bone'), count: 50 })
  guest.command({ k: 'give', item: itemId('skewer'), count: 1 })
  run(room, [host, guest], 3)
  assert.equal(countOf(guest.player.inventory, itemId('bone')), 50)
  assert.equal(countOf(guest.player.inventory, itemId('skewer')), 1)
  // Kept with the world.
  assert.equal(GameRoom.fromSave(room.exportSave()).exportSave().itemSpawning, true)
})
