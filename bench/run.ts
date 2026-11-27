// Performance benchmarks: how long the server takes a tick, and the page its share, in situations that stress
// different parts of the game. Run with `npm run bench` (all of them) or `npm run bench -- <name> ...` (some).
//
// Each scenario prints the time per tick (mean, 95th percentile, worst) or per operation, so a change can be compared
// before and after. The budget is a tick every 33 ms on the server (TPS = 30) for every room it runs, and a frame every
// 16 ms on the page; on a slow computer everything takes several times longer than here, so the aim is for each
// number to be a small fraction of that. `npm run bench -- --json` prints the results as JSON (for comparing runs).
//
// It runs bundled (by esbuild, as the server is built: see apps/server/package.json), not through tsx, which slows some
// code down several times over and would hide what is really slow.
//
// To see where the time goes: `npm run bench:profile -- <name>` writes a CPU profile to bench/profiles, and
// `npx tsx bench/profile-summary.ts bench/profiles/<file>.cpuprofile` lists what took the time.
import { GameRoom } from '../apps/server/src/game-room.ts'
import { groundChunk } from '../apps/client/src/render3d/ground-colors.ts'
import {
  animalDef,
  biomeSiteAt,
  CHUNK_SIZE,
  createEntity,
  DUNGEON_ORIGIN,
  EAST,
  entityToState,
  FactoryWorld,
  floorDiv,
  isFoggedAt,
  itemId,
  linkSpecsFor,
  linkToState,
  terrainOf,
  tileMiddle,
  waterAt,
  type Entity,
  type FeederEntity,
  WORLD_SIZES,
  type WorldSize,
} from '../packages/shared/src/index.ts'
import { applyWorldEvent } from '../packages/shared/src/sim/world-events.ts'
import { TestClient } from '../tests/helpers.ts'

type Result = { name: string; unit: string; mean: number; p95: number; max: number; samples: number; note?: string }
const results: Result[] = []

function summarise(name: string, unit: string, samples: number[], note?: string): void {
  const sorted = [...samples].sort((a, b) => a - b)
  const mean = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length)
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0
  results.push({ name, unit, mean, p95, max: sorted.at(-1) ?? 0, samples: samples.length, ...(note ? { note } : {}) })
}

function time(run: () => void): number {
  const start = performance.now()
  run()
  return performance.now() - start
}

// Runs a room `ticks` ticks with its clients, timing the server's step and the clients' share apart. The first
// `warm` ticks are not counted (the JIT, and chunks first sent).
function runTicks(name: string, room: GameRoom, clients: TestClient[], ticks: number, warm = 60): void {
  const server: number[] = []
  const pages: number[] = []
  for (let i = 0; i < warm + ticks; i++) {
    const s = time(() => room.step())
    const c = time(() => {
      for (const client of clients) {
        client.deliver()
        client.catchUp()
      }
    })
    if (i >= warm) {
      server.push(s)
      pages.push(c / Math.max(1, clients.length))
    }
  }
  summarise(`${name}: server tick`, 'ms', server, `${room.animals?.list().length ?? 0} animals, ${room.monsters?.list().length ?? 0} monsters, ${room.world.chunkIds.length} chunks`)
  if (clients.length > 0) summarise(`${name}: page (each)`, 'ms', pages)
}

const scenarios: Record<string, () => void> = {
  // Making a world: the islands grown whole, and stocked.
  worldgen() {
    for (const size of ['medium', 'huge'] as WorldSize[]) {
      const samples: number[] = []
      for (let i = 0; i < 3; i++) samples.push(time(() => new GameRoom(`GEN${i}`, 1000 + i, { terrain: { radius: WORLD_SIZES[size].radius } })))
      summarise(`worldgen ${size}`, 'ms', samples)
    }
  },
  // A world with one player standing at the spawn, its animals about.
  idle() {
    const room = new GameRoom('IDLE', 11)
    const client = new TestClient(room, 'Idle')
    runTicks('idle (1 player)', room, [client], 600)
  },
  // Four players, one on each island (the far ones with truesight): camps, bees, spiders, wolves all running.
  explore() {
    const room = new GameRoom('EXPLORE', 11)
    const clients = room.terrain.sites.map((site, i) => {
      const client = new TestClient(room, `Explorer${i}`)
      client.player.position = tileMiddle(site.x + 6, site.y + 6)
      client.player.truesight = true
      client.player.health = 1_000_000
      return client
    })
    runTicks('explore (4 players, 4 islands)', room, clients, 600, 120)
  },
  // A big farm: 200 cows penned by feed troughs, near a player.
  farm() {
    const room = new GameRoom('FARM', 11, { plants: false, animals: true, wildAnimals: false })
    const client = new TestClient(room, 'Farmer')
    const cow = animalDef('cow')
    let id = 5_000_000
    for (let i = 0; i < 10; i++) {
      const feeder = createEntity(id++, 'feeder', -10 + i * 2, 12, 0, 0) as FeederEntity
      feeder.inv.slots[0] = { item: itemId('wheat'), count: 50 }
      room.world.addEntity(feeder)
    }
    for (let i = 0; i < 200; i++) room.animals!.spawn(cow, tileMiddle(-12 + (i % 20), 2 + Math.floor(i / 20)).x, tileMiddle(0, 2 + Math.floor(i / 20)).y)
    runTicks('farm (200 cows)', room, [client], 600)
  },
  // Eight players together, as on a server with friends.
  crowd() {
    const room = new GameRoom('CROWD', 11)
    const clients = Array.from({ length: 8 }, (_, i) => {
      const client = new TestClient(room, `Friend${i}`)
      client.player.position = tileMiddle((i % 4) * 3, Math.floor(i / 4) * 3)
      return client
    })
    runTicks('crowd (8 players together)', room, clients, 600)
  },
  // Saving a world that has been played a little.
  save() {
    const room = new GameRoom('SAVE', 11)
    const client = new TestClient(room, 'Saver')
    for (let i = 0; i < 120; i++) {
      room.step()
      client.deliver()
      client.catchUp()
    }
    const samples: number[] = []
    for (let i = 0; i < 10; i++) samples.push(time(() => JSON.stringify(room.exportSave())))
    summarise('save (export + JSON)', 'ms', samples)
  },
  // What the page and the server ask the terrain all the time: which biome a tile is in, and whether it is water.
  terrain() {
    const terrain = terrainOf(11)
    const site = terrain.sites[2]
    const samples: number[] = []
    for (let round = 0; round < 5; round++) {
      samples.push(
        time(() => {
          for (let y = site.y - 50; y < site.y + 50; y++) for (let x = site.x - 50; x < site.x + 50; x++) {
            biomeSiteAt(terrain, x, y)
            waterAt(terrain, x, y)
            isFoggedAt(terrain, x, y)
          }
        }) / 10,
      )
    }
    summarise('terrain: 1000 tiles (biome, water, fog)', 'ms', samples)
  },
  // The page painting the ground of the chunks coming into view: on each island's coast, and in the ice crypt.
  ground() {
    const terrain = terrainOf(11)
    const chunks: Array<{ cx: number; cy: number; fogged: boolean }> = []
    for (const site of terrain.sites) {
      const cx = floorDiv(site.x + site.radius, CHUNK_SIZE)
      const cy = floorDiv(site.y, CHUNK_SIZE)
      for (let i = 0; i < 6; i++) chunks.push({ cx: cx + (i % 3) - 1, cy: cy + Math.floor(i / 3), fogged: site.biome.fogged })
    }
    for (let i = 0; i < 4; i++) chunks.push({ cx: floorDiv(DUNGEON_ORIGIN.x, CHUNK_SIZE) + i, cy: floorDiv(DUNGEON_ORIGIN.y, CHUNK_SIZE), fogged: false })
    // Once over, for the JIT, and then timed.
    for (const { cx, cy, fogged } of chunks.slice(0, 6)) groundChunk(terrain, cx, cy, 8, fogged)
    const samples = chunks.map(({ cx, cy, fogged }) => time(() => groundChunk(terrain, cx, cy, 8, fogged)))
    summarise('ground: one chunk painted', 'ms', samples, `${chunks.length} chunks`)
  },
  // A big factory, as the simulation runs it (on the server and on every page near it): 100 lines, each a miner, an
  // extractor, 30 belts and a chest, all running.
  factory() {
    const world = new FactoryWorld()
    let nextId = 1
    let nextLink = 1
    const put = (entity: Entity): void => {
      applyWorldEvent(world, { t: 'add', e: entityToState(entity) })
      for (const spec of linkSpecsFor(world.entity(entity.id)!, (x, y) => world.entityAt(x, y))) {
        const link = { id: nextLink++, from: spec.from.id, to: spec.to.id, fromChunk: world.chunkOfEntity(spec.from.id)!, toChunk: world.chunkOfEntity(spec.to.id)!, entry: spec.entry, blocked: false }
        applyWorldEvent(world, { t: 'link+', l: linkToState(link) })
      }
    }
    const ore = itemId('stone')
    for (let line = 0; line < 100; line++) {
      const y = line * 2
      put(createEntity(nextId++, 'miner', 0, y, EAST, ore))
      put(createEntity(nextId++, 'extractor', 1, y, EAST, 0))
      for (let x = 2; x < 32; x++) put(createEntity(nextId++, 'belt', x, y, EAST, 0))
      put(createEntity(nextId++, 'chest', 32, y, EAST, 0))
    }
    const samples: number[] = []
    for (let tick = 0; tick < 900; tick++) {
      const spent = time(() => {
        world.stepInterior(tick, 1)
        world.exchange()
      })
      if (tick >= 300) samples.push(spent)
    }
    summarise('factory (100 lines, 3300 buildings): sim tick', 'ms', samples, `${world.linkIds.length} links`)
  },
}

const args = process.argv.slice(2)
const json = args.includes('--json')
const wanted = args.filter((arg) => !arg.startsWith('--'))
const names = wanted.length > 0 ? wanted : Object.keys(scenarios)
for (const name of names) {
  const scenario = scenarios[name]
  if (!scenario) {
    console.error(`No scenario "${name}" (there are ${Object.keys(scenarios).join(', ')}).`)
    process.exit(1)
  }
  scenario()
}
if (json) console.log(JSON.stringify(results, null, 2))
else {
  const pad = (text: string, width: number): string => text.padEnd(width)
  const number = (value: number): string => value.toFixed(value < 10 ? 3 : 1).padStart(9)
  console.log(`${pad('scenario', 46)}${'mean'.padStart(9)}${'p95'.padStart(9)}${'max'.padStart(9)}  unit`)
  for (const result of results) {
    console.log(`${pad(result.name, 46)}${number(result.mean)}${number(result.p95)}${number(result.max)}  ${result.unit}${result.note ? `   (${result.note})` : ''}`)
  }
}
