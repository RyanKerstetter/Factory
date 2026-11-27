// The render benchmark: the game's own 3D view (see three-view.ts) drawing scenes that stress it in different ways, each
// timed over many frames. Open /render-bench.html on the dev server (`npm run dev`) on the computer to be measured;
// `?scene=forest` runs one scene, `?zoom=0.6` sets the zoom (ZOOM_MIN, the furthest out, shows the most), `?frames=300`
// times more frames. It shows, per scene: frames a second, the page's work a frame (working out the scene, and
// drawing it; the graphics card's own time comes after), and the draw calls and triangles a frame.
//
// The scenes are real ground with what the world grows on it (see plantsInChunk), a player's base, and a player on a
// raft in the fog over a far island (for someone without truesight).
import {
  CHUNK_SIZE,
  DEFAULT_ZOOM,
  floorDiv,
  isFoggedAt,
  plantsInChunk,
  terrainOf,
  type Terrain,
} from '../../../packages/shared/src/index.ts'
import type { BuildingView, PlayerView, RaftView, WorldFrame } from './render3d/frame.ts'
import { createThreeView } from './render3d/three-view.ts'

// `fog`: drawn for a player without truesight, who is at the middle on a raft.
type Scene = { name: string; x: number; y: number; buildings: BuildingView[]; fog?: boolean }

const params = new URLSearchParams(location.search)
const frames = Number(params.get('frames') ?? 180)
const warm = 40
const zoom = Number(params.get('zoom') ?? DEFAULT_ZOOM)
const terrain = terrainOf(Number(params.get('seed') ?? 11))

// What the world grows over the chunks round a point (as the game shows them: see GameRoom's generatedIn).
function grown(terrain: Terrain, x: number, y: number): BuildingView[] {
  const found: BuildingView[] = []
  const cx = floorDiv(x, CHUNK_SIZE)
  const cy = floorDiv(y, CHUNK_SIZE)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (const plant of plantsInChunk(terrain, cx + dx, cy + dy)) found.push({ id: found.length + 1, kind: plant.kind, x: plant.x, y: plant.y, dir: 0 })
    }
  }
  return found
}

// A player's base: a fenced yard of work stations, fires, barrels and chests.
function base(x: number, y: number): BuildingView[] {
  const found: BuildingView[] = []
  const add = (view: Omit<BuildingView, 'id' | 'dir'>): void => void found.push({ id: found.length + 1, dir: 0, ...view })
  for (let i = -12; i <= 12; i++) {
    for (const [fx, fy] of [[x + i, y - 12], [x + i, y + 12], [x - 12, y + i], [x + 12, y + i]]) add({ kind: 'fence', x: fx, y: fy, connect: 15 })
  }
  for (let row = -10; row <= 10; row += 2) {
    for (let col = -10; col <= 10; col += 4) {
      add({ kind: 'campfire', x: x + col, y: y + row, lit: true })
      add({ kind: 'workbench', x: x + col + 1, y: y + row })
      add({ kind: 'barrel', x: x + col + 2, y: y + row, barrel: { sealed: false, liquid: 'water', fill: 0.6, composting: false } })
      add({ kind: 'chest', x: x + col + 3, y: y + row })
    }
  }
  return found
}

function scenes(): Scene[] {
  const list: Scene[] = []
  for (const site of terrain.sites) {
    // Partway out from the middle (where the spawn is cleared), into what grows.
    const x = Math.round(site.x + site.radius * 0.35)
    const y = Math.round(site.y)
    list.push({ name: site.biome.key, x, y, buildings: grown(terrain, x, y) })
  }
  const home = terrain.sites[0]
  list.push({ name: 'base', x: home.x, y: home.y, buildings: base(home.x, home.y) })
  // Off the first far island's coast (the desert's) to the south, a few tiles into its fog, and on the sea at its edge looking at it, on the edge
  // between two chunks (where a seam would show). What is under the fog is not drawn (see game.ts).
  const island = terrain.sites.find((site) => site.biome.fogged)
  if (island) {
    const edge = Math.round(island.x / CHUNK_SIZE) * CHUNK_SIZE
    for (const [name, x, out] of [['fog', island.x, 4], ['fog-wall', edge, 9]] as const) {
      let y = island.y
      while (isFoggedAt(terrain, x, y)) y++
      const buildings = grown(terrain, x, y + out).filter((building) => !isFoggedAt(terrain, building.x, building.y))
      list.push({ name, x, y: y + out, buildings, fog: true })
    }
  }
  const wanted = params.get('scene')
  return wanted ? list.filter((scene) => scene.name === wanted) : list
}

function frameOf(scene: Scene, now: number): WorldFrame {
  const you: PlayerView = { id: 1, name: 'You', x: scene.x + 0.5, y: scene.y + 0.5, facing: Math.PI, local: true }
  const raft: RaftView = { id: 1, x: scene.x + 0.5, y: scene.y + 0.5, angle: 0 }
  return {
    terrain,
    fogLifted: !scene.fog,
    buildings: scene.buildings,
    removingIds: new Set(),
    shaking: new Map(),
    now,
    alpha: 0,
    players: scene.fog ? [you] : [],
    drops: [],
    animals: [],
    monsters: [],
    traps: [],
    rafts: scene.fog ? [raft] : [],
    attacks: { marks: [], swishes: [], shots: [], sparks: [], numbers: [], puffs: [] },
    overlay: { pending: [], removing: [], bars: [] },
    rituals: [],
    warps: [],
    warpFlashes: [],
  }
}

type Sample = { frameMs: number; drawMs: number; renderMs: number; calls: number; triangles: number }

async function run(): Promise<void> {
  const out = document.getElementById('out')!
  const view = await createThreeView(document.getElementById('stage')!)
  const list = scenes()
  // (The first line says how big the view is once it has looked at the first scene.)
  const lines = ['', '', 'scene        fps   draw ms  render ms  calls  triangles  buildings']
  let index = 0
  let frame = 0
  let last = performance.now()
  let samples: Sample[] = []
  let drawMs = 0
  view.start(() => {
    const scene = list[index]
    if (!scene) return
    const now = performance.now()
    const stats = view.stats()
    if (frame > warm) samples.push({ frameMs: now - last, drawMs, renderMs: stats.renderMs, calls: stats.calls, triangles: stats.triangles })
    last = now
    frame++
    if (frame > warm + frames) {
      const mean = (pick: (sample: Sample) => number): number => samples.reduce((sum, sample) => sum + pick(sample), 0) / samples.length
      lines.push(
        `${scene.name.padEnd(10)} ${(1000 / mean((s) => s.frameMs)).toFixed(0).padStart(5)} ${mean((s) => s.drawMs).toFixed(2).padStart(9)} ${mean((s) => s.renderMs).toFixed(2).padStart(10)} ${mean((s) => s.calls).toFixed(0).padStart(6)} ${(mean((s) => s.triangles) / 1000).toFixed(0).padStart(9)}k ${String(scene.buildings.length).padStart(10)}`,
      )
      out.textContent = lines.join('\n')
      index++
      frame = 0
      samples = []
      if (index >= list.length) {
        lines.push('', 'done')
        out.textContent = lines.join('\n')
        document.title = 'done'
      }
      return
    }
    view.look({ x: scene.x, y: scene.y }, zoom)
    if (index === 0 && frame === 1) {
      lines[0] = `zoom ${zoom}, ${frames} frames a scene, ${view.describe()}`
      out.textContent = lines.join('\n')
    }
    const before = performance.now()
    view.draw(frameOf(scene, now))
    drawMs = performance.now() - before
  })
}

void run()
