import assert from 'node:assert/strict'
import test from 'node:test'
import { GameRoom } from '../apps/server/src/game-room.ts'
import { STICK_EVERY, TWINE_EVERY } from '../apps/server/src/commands.ts'
import { Settings } from '../apps/client/src/settings.ts'
import {
  BUILDINGS,
  BUSH_SPEED_PERCENT,
  DROP_LIFETIME_TICKS,
  flintInChunk,
  HASH_INTERVAL,
  NATURAL_DROP_BORN,
  RECIPES,
  WEAPONS,
  TREE_STICK_REGROW,
  TREE_STICKS,
  countOf,
  DEFAULT_PLANT_GENERATION,
  KEY_RIGHT,
  PLAYER_SPEED,
  createEntity,
  FactoryWorld,
  hpOf,
  itemId,
  oreAt,
  overlapsSolid,
  plantAt,
  plantsInChunk,
  PLAYER_HALF_SIZE,
  PUNCH_COOLDOWN_TICKS,
  pushOut,
  SAPLING_STAGES,
  stepPlayer,
  SUB,
  type Entity,
  terrainOf,
  biomeAt,
  type Terrain,
  boundsOf,
  type Box,
} from '../packages/shared/src/index.ts'
import { differingChunks, run, TestClient } from './helpers.ts'

const center = (x: number, y: number): { x: number; y: number } => ({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })

// A plant of a kind in the server's world, and the player moved next to it (within reach).
function besidePlant(room: GameRoom, client: TestClient, kind: 'tree' | 'bush' | 'rock', skip: readonly number[] = []): Entity {
  const plant = room.world.chunkIds
    .flatMap((id) => [...room.world.chunk(id)!.entities])
    .find((entity) => entity.kind === kind && !skip.includes(entity.id))
  assert.ok(plant, `there is a ${kind} near the spawn`)
  client.player.position = center(plant.x, plant.y + 1)
  return plant
}

// Punches a plant until the server has taken it away, a punch every PUNCH_COOLDOWN_TICKS, with whatever is in `slot`
// (slot 0 is empty unless a test puts something there). Gives how many punches.
function punchDown(room: GameRoom, client: TestClient, id: number, slot = 0): number {
  let punches = 0
  while (room.world.entity(id) && punches < 50) {
    client.command({ k: 'punch', id, slot })
    run(room, [client], PUNCH_COOLDOWN_TICKS)
    punches++
  }
  run(room, [client], 5)
  return punches
}

// The chunks round the middle of a world's mountains.
function mountainChunks(terrain: Terrain, around = 2): Array<[number, number]> {
  const mountain = terrain.sites.find((site) => site.biome.key === 'mountain')!
  const chunks: Array<[number, number]> = []
  const cx = Math.floor(mountain.x / 32)
  const cy = Math.floor(mountain.y / 32)
  for (let y = cy - around; y <= cy + around; y++) for (let x = cx - around; x <= cx + around; x++) chunks.push([x, y])
  return chunks
}

test('the world grows no ore, keeps the spawn clear, and grows the same plants from the same seed', () => {
  const terrain = terrainOf(7)
  for (let y = -40; y <= 40; y += 3) for (let x = -40; x <= 40; x += 3) assert.equal(oreAt(7, x, y), 0)
  for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) assert.equal(plantAt(terrain, x, y), undefined)
  const plants = plantsInChunk(terrain, 1, 1)
  assert.ok(plants.some((plant) => plant.kind === 'tree') || plantsInChunk(terrain, 2, 1).some((plant) => plant.kind === 'tree'))
  assert.deepEqual(plantsInChunk(terrainOf(7), 1, 1), plants)
})

test('the forest grows trees, bushes, grass and flint and no rocks; the mountains grow rocks and nothing else', () => {
  const terrain = terrainOf(21)
  const forest = new Set<string>()
  for (let cy = -2; cy <= 2; cy++) {
    for (let cx = -2; cx <= 2; cx++) {
      for (const plant of plantsInChunk(terrain, cx, cy)) if (biomeAt(terrain, plant.x, plant.y)?.key === 'forest') forest.add(plant.kind)
    }
  }
  assert.deepEqual([...forest].sort(), ['bush', 'grass', 'tree'])
  const mountain = new Set<string>()
  for (const [cx, cy] of mountainChunks(terrain)) {
    for (const plant of plantsInChunk(terrain, cx, cy)) if (biomeAt(terrain, plant.x, plant.y)?.key === 'mountain') mountain.add(plant.kind)
  }
  assert.deepEqual([...mountain], ['rock'])
  let flint = 0
  for (const [cx, cy] of mountainChunks(terrain)) {
    for (const piece of flintInChunk(terrain, cx, cy)) if (biomeAt(terrain, Math.floor(piece.x / SUB), Math.floor(piece.y / SUB))?.key !== 'forest') flint++
  }
  assert.equal(flint, 0, 'no flint outside the forest')
})

test('bushes grow in patches: most bushes have another bush beside them', () => {
  let bushes = 0
  let together = 0
  for (let cy = -2; cy <= 2; cy++) {
    for (let cx = -2; cx <= 2; cx++) {
      for (const plant of plantsInChunk(terrainOf(3), cx, cy)) {
        if (plant.kind !== 'bush') continue
        bushes++
        const near = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]].some(([dx, dy]) => plantAt(terrainOf(3), plant.x + dx, plant.y + dy) === 'bush')
        if (near) together++
      }
    }
  }
  assert.ok(bushes > 20, `there are bushes (${bushes})`)
  assert.ok(together / bushes > 0.8, `${together} of ${bushes} bushes have a neighbour`)
})

test('the server grows plants near a player, and the page has the same ones', () => {
  const room = new GameRoom('PLANT1', 11)
  const client = new TestClient(room, 'Walker')
  run(room, [client], 5)
  const plants = room.world.chunkIds.flatMap((id) => [...room.world.chunk(id)!.entities])
  assert.ok(plants.length > 50, `plants were grown (${plants.length})`)
  assert.deepEqual(differingChunks(room, client), [])
})

test('punching a tree only knocks its sticks loose, one every STICK_EVERY punches, until it has none left', () => {
  const room = new GameRoom('PLANT2', 11, { dropsOnGround: false })
  const client = new TestClient(room, 'Lumberjack')
  run(room, [client], 5)
  const tree = besidePlant(room, client, 'tree')
  for (let i = 0; i < STICK_EVERY * TREE_STICKS; i++) {
    client.command({ k: 'punch', id: tree.id, slot: 0 })
    run(room, [client], PUNCH_COOLDOWN_TICKS)
  }
  run(room, [client], 5)
  assert.equal(countOf(client.player.inventory, itemId('stick')), TREE_STICKS)
  const after = room.world.entity(tree.id)
  assert.ok(after?.kind === 'tree', 'the tree still stands')
  assert.equal(after.hp, BUILDINGS.tree.maxHp, 'punching did not hurt it')
  assert.equal(after.sticks, 0)
  client.command({ k: 'punch', id: tree.id, slot: 0 })
  run(room, [client], 5)
  assert.equal(client.results.at(-1)?.why, 'bare')
  assert.deepEqual(differingChunks(room, client), [])
})

test('an axe chops a tree down, dropping its logs, acorns and the sticks still on it', () => {
  const room = new GameRoom('PLANT7', 11, { dropsOnGround: false })
  const client = new TestClient(room, 'Lumberjack')
  run(room, [client], 5)
  const tree = besidePlant(room, client, 'tree')
  client.player.inventory.slots[1] = { item: itemId('axe'), count: 1 }
  assert.equal(punchDown(room, client, tree.id, 1), Math.ceil(BUILDINGS.tree.maxHp / WEAPONS.get('axe')!.damage))
  const inventory = client.player.inventory
  assert.equal(countOf(inventory, itemId('stick')), TREE_STICKS)
  assert.ok(countOf(inventory, itemId('log')) >= 2 && countOf(inventory, itemId('log')) <= 4)
  assert.ok(countOf(inventory, itemId('acorn')) >= 1 && countOf(inventory, itemId('acorn')) <= 2)
  assert.equal(client.mirror.world.entity(tree.id), undefined, 'the page saw it fall')
  assert.deepEqual(differingChunks(room, client), [])
})

test('a tree grows its sticks back on its random ticks, the same way everywhere', () => {
  const regrow = (): number => {
    const world = new FactoryWorld()
    world.addEntity(createEntity(1, 'tree', 3, 3, 0, 0))
    const tree = world.entity(1)!
    if (tree.kind !== 'tree') throw new Error('not a tree')
    tree.sticks = 0
    for (let tick = 1; tick < 200_000; tick++) {
      world.stepInterior(tick, 42)
      if (tree.sticks === TREE_STICKS) return tick
    }
    return -1
  }
  const first = regrow()
  assert.ok(first > TREE_STICKS * TREE_STICK_REGROW * 20, `it took ${first} ticks`)
  assert.equal(regrow(), first)
})

test('a bush drops twine as it is broken and berries when it is gone; an axe breaks it twice as fast', () => {
  const room = new GameRoom('PLANT3', 11, { dropsOnGround: false })
  const client = new TestClient(room, 'Forager')
  run(room, [client], 5)
  const max = BUILDINGS.bush.maxHp
  const bush = besidePlant(room, client, 'bush')
  assert.equal(punchDown(room, client, bush.id), max)
  assert.equal(countOf(client.player.inventory, itemId('twine')), Math.floor((max - 1) / TWINE_EVERY))
  assert.ok(countOf(client.player.inventory, itemId('berries')) >= 2)
  const other = besidePlant(room, client, 'bush', [bush.id])
  client.player.inventory.slots[1] = { item: itemId('axe'), count: 1 }
  assert.equal(punchDown(room, client, other.id, 1), Math.ceil(max / WEAPONS.get('axe')!.damage))
  assert.deepEqual(differingChunks(room, client), [])
})

test('a rock cannot be broken by hand; a pickaxe breaks it into stone and flint', () => {
  const room = new GameRoom('ROCK1', 11, { dropsOnGround: false, wildAnimals: false })
  const client = new TestClient(room, 'Mason')
  // Rocks are in the mountains: go to their warm edge, where the forest meets them.
  const [forest, mountain] = room.terrain.sites
  client.player.position = center(Math.round((forest.x + mountain.x) / 2), Math.round((forest.y + mountain.y) / 2))
  run(room, [client], 5)
  const rock = besidePlant(room, client, 'rock')
  client.command({ k: 'punch', id: rock.id, slot: 0 })
  run(room, [client], 5)
  assert.equal(client.results.at(-1)?.why, 'needsPickaxe')
  assert.equal(hpOf(room.world.entity(rock.id)!), BUILDINGS.rock.maxHp)
  client.player.inventory.slots[1] = { item: itemId('pickaxe'), count: 1 }
  assert.equal(punchDown(room, client, rock.id, 1), Math.ceil(BUILDINGS.rock.maxHp / WEAPONS.get('pickaxe')!.damage))
  const stone = countOf(client.player.inventory, itemId('stone'))
  const flint = countOf(client.player.inventory, itemId('flint'))
  assert.ok(stone >= 2 && stone <= 4, `${stone} stone`)
  assert.ok(flint >= 1 && flint <= 2, `${flint} flint`)
  assert.equal(client.mirror.world.entity(rock.id), undefined)
  assert.deepEqual(differingChunks(room, client), [])
})

test('rocks lie in groups', () => {
  let rocks = 0
  let together = 0
  const terrain = terrainOf(3)
  for (const [cx, cy] of mountainChunks(terrain)) {
    for (const plant of plantsInChunk(terrain, cx, cy)) {
      if (plant.kind !== 'rock') continue
      rocks++
      const near = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]].some(([dx, dy]) => plantAt(terrain, plant.x + dx, plant.y + dy) === 'rock')
      if (near) together++
    }
  }
  assert.ok(rocks > 20, `there are rocks (${rocks})`)
  assert.ok(together / rocks > 0.8, `${together} of ${rocks} rocks have a neighbour`)
})

test('a stick, twine and flint craft a tool; tools do not stack; a recipe without its inputs is turned down', () => {
  const room = new GameRoom('CRAFT', 11)
  const client = new TestClient(room, 'Smith')
  run(room, [client], 5)
  const inventory = client.player.inventory
  const axe = RECIPES.find((recipe) => recipe.output === itemId('axe'))!
  // Enough for two axes and one of each left over.
  axe.inputs.forEach(([item, count], slot) => (inventory.slots[slot] = { item, count: count * 2 + 1 }))
  client.command({ k: 'craft', recipe: axe.id })
  client.command({ k: 'craft', recipe: axe.id })
  run(room, [client], 5)
  const after = client.player.inventory
  assert.equal(countOf(after, itemId('axe')), 2)
  assert.equal(after.slots.filter((slot) => slot.item === itemId('axe')).length, 2, 'each axe has a slot of its own')
  for (const [item] of axe.inputs) assert.equal(countOf(after, item), 1)
  after.slots[0] = { item: 0, count: 0 }
  client.command({ k: 'craft', recipe: axe.id })
  run(room, [client], 5)
  assert.deepEqual(client.results.map((result) => result.why ?? 'ok'), ['ok', 'ok', 'lacking'])
  assert.equal(countOf(client.inventory!, itemId('axe')), 2, 'the page was told')
})

test('flint lies in the ground from the start, the same from the same seed, and a hit knocks it loose', () => {
  assert.deepEqual(flintInChunk(terrainOf(5), 1, 1), flintInChunk(terrainOf(5), 1, 1))
  const room = new GameRoom('FLINT', 11)
  const client = new TestClient(room, 'Finder')
  run(room, [client], 5)
  const pieces = room.world.chunkIds.flatMap((chunk) => room.world.chunk(chunk)!.entities).filter((entity) => entity.kind === 'loose')
  assert.ok(pieces.length > 20, `there is flint about (${pieces.length})`)
  assert.ok(pieces.every((piece) => piece.kind === 'loose' && piece.item === itemId('flint')))
  assert.deepEqual(differingChunks(room, client), [], 'the page has the same flint')
  // A punch knocks one loose, as a piece of flint to pick up.
  const piece = pieces[0]
  client.player.position = { x: piece.x * SUB - SUB / 2, y: piece.y * SUB + SUB / 2 }
  client.command({ k: 'punch', id: piece.id, slot: -1 })
  run(room, [client], 3)
  assert.equal(room.world.entity(piece.id), undefined, 'it was knocked loose')
  assert.ok(room.world.allDrops().some((drop) => drop.item === itemId('flint')), 'and lies there to be picked up')
})

test('a punch too soon after the last does nothing', () => {
  const room = new GameRoom('PLANT4', 11)
  const client = new TestClient(room, 'Quick')
  run(room, [client], 5)
  const bush = besidePlant(room, client, 'bush')
  client.command({ k: 'punch', id: bush.id, slot: 0 })
  client.command({ k: 'punch', id: bush.id, slot: 0 })
  run(room, [client], 5)
  assert.deepEqual(
    client.results.map((result) => result.why ?? 'ok'),
    ['ok', 'tooSoon'],
  )
  assert.equal((room.world.entity(bush.id) as { hp: number }).hp, BUILDINGS.bush.maxHp - 1)
})

test('an acorn is planted as a sapling, and grows into a tree on its random ticks', () => {
  const room = new GameRoom('PLANT5', 11)
  const client = new TestClient(room, 'Gardener')
  run(room, [client], 5)
  client.player.inventory.slots[2] = { item: itemId('acorn'), count: 3 }
  client.command({ k: 'place', x: 2, y: 2, slot: 2 })
  run(room, [client], 5)
  const sapling = room.world.entityAt(2, 2)
  assert.equal(sapling?.kind, 'sapling')
  assert.equal(client.player.inventory.slots[2].count, 2)
  assert.equal(client.mirror.world.entityAt(2, 2)?.kind, 'sapling')
  // A non-plantable item, or a taken tile, is turned down.
  client.player.inventory.slots[3] = { item: itemId('log'), count: 1 }
  client.command({ k: 'place', x: 3, y: 2, slot: 3 })
  client.command({ k: 'place', x: 2, y: 2, slot: 2 })
  run(room, [client], 5)
  assert.deepEqual(client.results.slice(-2).map((result) => result.why), ['notPlaceable', 'occupied'])
  // Growing takes random ticks; give it up to about five minutes of game time, checking the page keeps in step.
  for (let i = 0; i < 100 && room.world.entityAt(2, 2)?.kind !== 'tree'; i++) run(room, [client], 100)
  assert.equal(room.world.entityAt(2, 2)?.kind, 'tree')
  assert.equal(client.mirror.world.entityAt(2, 2)?.kind, 'tree')
  assert.deepEqual(differingChunks(room, client), [])
})

test('random ticks are the same for the same seed, tick and chunk, and saplings take SAPLING_STAGES of them', () => {
  const grow = (): number => {
    const world = new FactoryWorld()
    world.addEntity(createEntity(1, 'sapling', 3, 3, 0, 0))
    for (let tick = 1; tick < 100_000; tick++) {
      world.stepInterior(tick, 42)
      if (world.entity(1)!.kind === 'tree') return tick
    }
    return -1
  }
  const first = grow()
  assert.ok(first > 0)
  assert.equal(grow(), first)
  // A tile is picked about every 1024 / 3 ticks, so SAPLING_STAGES picks take roughly that many times as long.
  assert.ok(first > SAPLING_STAGES * 20, `it took ${first} ticks`)
})

test('a player inside something solid is pushed out to the nearest clear place', () => {
  const tree = (x: number, y: number): boolean => x === 0 && y === 0
  // Standing a little right of the middle of the tile: pushed out to the right, the nearest edge.
  const pushed = pushOut({ x: SUB / 2 + 20, y: SUB / 2 }, tree)
  assert.equal(pushed.x, SUB + PLAYER_HALF_SIZE)
  assert.equal(pushed.y, SUB / 2)
  assert.ok(!overlapsSolid(pushed, tree))
  // Standing still is enough: stepping with no keys pushes too.
  assert.ok(!overlapsSolid(stepPlayer(center(0, 0), 0, tree), tree))
  // Boxed in on every side but one tile away: taken to the middle of the nearest clear tile.
  const walls = (x: number, y: number): boolean => !(x === 2 && y === 0)
  assert.deepEqual(pushOut(center(0, 0), walls), center(2, 0))
})

test('a tree that grows on a player pushes the player out, on the server and on the page alike', () => {
  const room = new GameRoom('PLANT6', 11)
  const client = new TestClient(room, 'Sleeper')
  run(room, [client], 5)
  // A sapling right under the player, grown on the spot.
  client.player.inventory.slots[0] = { item: itemId('acorn'), count: 1 }
  client.command({ k: 'place', x: 0, y: 0, slot: 0 })
  run(room, [client], 5)
  const sapling = room.world.entityAt(0, 0)!
  assert.equal(sapling.kind, 'sapling')
  for (let i = 0; i < 100 && room.world.entityAt(0, 0)?.kind !== 'tree'; i++) {
    room.receiveInputs(client.player, Array.from({ length: 100 }, (_, n): [number, number] => [i * 100 + n + 1, 0]))
    run(room, [client], 100)
  }
  assert.equal(room.world.entityAt(0, 0)?.kind, 'tree')
  room.receiveInputs(client.player, [[1_000_000, 0]])
  run(room, [client], 2)
  // Clear of its trunk (what of a tree's tile stands in the way: see BUILDING_BOUNDS).
  const solid = (x: number, y: number): readonly Box[] | false => (room.world.entityAt(x, y)?.kind === 'tree' ? boundsOf('tree')! : false)
  assert.ok(!overlapsSolid(client.player.position, solid), 'the player is clear of the tree')
})

test('binding a key takes it from whatever had it, and Escape cannot be bound', () => {
  const settings = new Settings()
  assert.equal(settings.actionOf('KeyE'), 'inventory')
  settings.bind('up', 0, 'KeyE')
  assert.equal(settings.actionOf('KeyE'), 'up')
  assert.deepEqual(settings.binding('inventory'), [null, 'Tab'])
  settings.bind('debug', 0, 'Escape')
  assert.equal(settings.actionOf('Escape'), undefined)
  settings.resetControls()
  assert.equal(settings.actionOf('KeyE'), 'inventory')
  assert.equal(settings.keyLabel('hotbar1'), '1')
})

test('what a punch knocks loose lands on the ground round the plant, the page sees it, and walking over it picks it up', () => {
  const room = new GameRoom('DROP1', 11)
  const client = new TestClient(room, 'Picker')
  run(room, [client], 5)
  const bush = besidePlant(room, client, 'bush')
  // Stand well away, so nothing is picked up while it lands.
  client.player.position = center(bush.x, bush.y + 3)
  punchDown(room, client, bush.id)
  // What the bush dropped (not the flint that was lying about already).
  const drops = room.world.chunkIds.flatMap((id) => room.world.dropsInChunk(id)).filter((drop) => drop.born !== NATURAL_DROP_BORN)
  assert.equal(countOf(client.player.inventory, itemId('twine')), 0, 'nothing went straight into the inventory')
  assert.ok(drops.some((drop) => drop.item === itemId('twine')) && drops.some((drop) => drop.item === itemId('berries')))
  for (const drop of drops) {
    const distance = Math.hypot(drop.x - (bush.x * SUB + SUB / 2), drop.y - (bush.y * SUB + SUB / 2)) / SUB
    assert.ok(distance >= 0.4 && distance <= 1.1, `an item landed ${distance.toFixed(2)} tiles away`)
  }
  assert.deepEqual(differingChunks(room, client), [], 'the page has the same items on the ground')
  // Walk over each one.
  for (const drop of drops) {
    client.player.position = { x: drop.x, y: drop.y }
    run(room, [client], 2)
  }
  run(room, [client], 5)
  const twine = Math.floor((BUILDINGS.bush.maxHp - 1) / TWINE_EVERY)
  assert.equal(countOf(client.player.inventory, itemId('twine')), twine)
  assert.ok(countOf(client.player.inventory, itemId('berries')) >= 2)
  assert.equal(room.world.allDrops().filter((drop) => drop.item !== itemId('flint')).length, 0)
  assert.equal(client.mirror.world.allDrops().filter((drop) => drop.item !== itemId('flint')).length, 0)
  assert.equal(countOf(client.inventory!, itemId('twine')), twine, 'the page was told what it picked up')
  assert.deepEqual(differingChunks(room, client), [])
})

test('items on the ground are not picked up the moment they land, and a full inventory leaves them be', () => {
  const room = new GameRoom('DROP2', 11)
  const client = new TestClient(room, 'Full')
  run(room, [client], 5)
  const bush = besidePlant(room, client, 'bush')
  for (let slot = 0; slot < client.player.inventory.slots.length; slot++) client.player.inventory.slots[slot] = { item: itemId('log'), count: 50 }
  punchDown(room, client, bush.id)
  run(room, [client], 30)
  assert.ok(room.world.allDrops().some((drop) => drop.item === itemId('berries')), 'everything is still on the ground')
})

test('berries are planted as a sprout, which grows into a bush; walking through a bush is slower', () => {
  const room = new GameRoom('BERRY', 11)
  const client = new TestClient(room, 'Gardener')
  run(room, [client], 5)
  client.player.inventory.slots[1] = { item: itemId('berries'), count: 2 }
  client.command({ k: 'place', x: 2, y: 3, slot: 1 })
  run(room, [client], 5)
  assert.equal(room.world.entityAt(2, 3)?.kind, 'sprout')
  for (let i = 0; i < 100 && room.world.entityAt(2, 3)?.kind !== 'bush'; i++) run(room, [client], 100)
  assert.equal(room.world.entityAt(2, 3)?.kind, 'bush')
  assert.deepEqual(differingChunks(room, client), [])
  const bushes = (x: number, y: number): boolean => x === 2 && y === 3
  const inBush = stepPlayer(center(2, 3), KEY_RIGHT, undefined, bushes)
  const outside = stepPlayer(center(5, 3), KEY_RIGHT, undefined, bushes)
  assert.equal(inBush.x - center(2, 3).x, Math.floor((PLAYER_SPEED * BUSH_SPEED_PERCENT) / 100))
  assert.equal(outside.x - center(5, 3).x, PLAYER_SPEED)
})

test('much less grows than before, and a game can be given its own rates', () => {
  let trees = 0
  let bushes = 0
  let lush = 0
  const rich = { ...DEFAULT_PLANT_GENERATION, treeScatter: 40, bushPatchChance: 60 }
  for (let cy = -3; cy <= 3; cy++) {
    for (let cx = -3; cx <= 3; cx++) {
      // Grass is ground cover, not counted here.
      for (const plant of plantsInChunk(terrainOf(5), cx, cy)) if (plant.kind !== 'grass') plant.kind === 'tree' ? trees++ : bushes++
      lush += plantsInChunk(terrainOf(5), cx, cy, rich).filter((plant) => plant.kind !== 'grass').length
    }
  }
  const tiles = 49 * 32 * 32
  assert.ok((trees + bushes) / tiles < 0.02, `${trees} trees and ${bushes} bushes in ${tiles} tiles`)
  assert.ok(lush > (trees + bushes) * 3, 'richer rates grow more')
})

test('the sound settings keep a volume for each kind of sound, and mute', () => {
  const settings = new Settings()
  settings.setVolume('footsteps', 0.25)
  settings.setVolume('master', 2)
  settings.setMuted(true)
  assert.equal(settings.volumes.footsteps, 0.25)
  assert.equal(settings.volumes.master, 1)
  assert.equal(settings.muted, true)
  settings.resetAudio()
  assert.equal(settings.muted, false)
  assert.equal(settings.volumes.footsteps, 0.8)
})
