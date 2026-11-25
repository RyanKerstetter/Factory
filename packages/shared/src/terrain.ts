import { hashInts, valueNoise } from './rng.ts'
import { DUNGEON_AIR, isInDungeons } from './dungeon.ts'
import { WORLD_GEN } from './world-gen-data.ts'
import { CHUNK_SIZE } from './constants.ts'
import { chunkId } from './geometry.ts'
import { TileFacts } from './tile-facts.ts'

// The land: a chain of biomes, one per step of progression, each an island of its own (a rough, bumpy disc) in a sea
// that goes on for ever. Each lies a short way over the sea from the one before it in the chain (`islands` in
// data/world-gen.json): their coasts wander in and out freely, but only a little on the sides that face each other, so
// the sea between can never close (see `wanderAt`); the only way over is by raft. The shallow sea (the shelf) reaches
// further out on the sides facing a neighbour and joins up across the gap (see `shelfWidthAt`), so it shows the way
// over. Islands not next to each other in the chain keep well clear of each other. The first two (the forest, the
// mountains) lie the way the seed picks; after them the chain curves round (the desert, the meadow: see TURN_DEGREES).
// The desert and the meadow are shrouded in fog (`fogged`): nobody sees them or sets foot on them until they have eaten a
// truesight flesh (see `isFoggedAt`).
//
// It is all worked out from the world's seed and its TerrainSettings, the same on the server and on every page: the
// sites are whole numbers, and each tile is tested with whole-number noise and Math.sqrt (which every JavaScript engine
// rounds the same), so a tile is land or sea, and in one biome or another, everywhere alike.

// ---- the biomes, in the order players move through them

export type BiomeKey = 'forest' | 'mountain' | 'meadow' | 'desert'

export type BiomeDef = {
  key: BiomeKey
  name: string
  // Its size against the world's biome radius (see WORLD_SIZES), in percent.
  radiusPercent: number
  // The air temperature, in °C: at the side it joins the biome before it (`edge`) and at its far side (`core`), and
  // smoothly between: `curve` above 1 keeps it near `edge` for longer and drops it faster towards the far side, so the
  // cold is deep in. The first biome is `edge` all over.
  temperature: { edge: number; core: number; curve: number }
  // What grows back by itself here (see GameRoom.spreadWild), and whether ponds form.
  regrows: ReadonlyArray<'grass' | 'bush'>
  ponds: boolean
  // Whether plants take root in its ground (grass, berries, saplings: planted or spreading); not in the mountains'
  // rock and snow. Its beaches never (see `canGrowAt`).
  soil: boolean
  // What its ground is: grass (with sand beaches along the sea, if it has soil), rock (and snow where it is cold), or
  // sand all over (see `isSandAt`).
  ground: 'grass' | 'rock' | 'sand'
  // Shrouded in fog until a player has eaten a truesight flesh: they cannot see it or set foot on it (see `isFoggedAt`).
  fogged: boolean
}

export const BIOMES: readonly BiomeDef[] = [
  { key: 'forest', name: 'Forest', radiusPercent: 100, temperature: { edge: 16, core: 16, curve: 1 }, regrows: ['grass', 'bush'], ponds: false, soil: true, ground: 'grass', fogged: false },
  { key: 'mountain', name: 'Mountains', radiusPercent: 95, temperature: { edge: 12, core: -58, curve: 2.2 }, regrows: [], ponds: false, soil: false, ground: 'rock', fogged: false },
  // The same size as the mountains.
  { key: 'desert', name: 'Desert', radiusPercent: 95, temperature: { edge: 16, core: 16, curve: 1 }, regrows: [], ponds: false, soil: false, ground: 'sand', fogged: true },
  { key: 'meadow', name: 'Meadow', radiusPercent: 95, temperature: { edge: 16, core: 16, curve: 1 }, regrows: ['grass'], ponds: false, soil: true, ground: 'grass', fogged: true },
]

// The islands, from data/world-gen.json: how ragged every coast is (`bumpiness`, 0 near round to 100 deep bays and long
// points); the least sea between neighbours (`gap`, tiles) and how far their facing coasts wander (`facingBump`,
// tiles); and the shelf: how wide it is (`shelf`, tiles from land), how much wider on a side facing a neighbour
// (`shelfFacing`), and how wide (each side) the shallows joining two neighbours are at their narrowest (`shelfJoin`).
const ISLANDS = WORLD_GEN.islands
// The least sea, in tiles, between two biomes that are not next to each other in the chain.
const OCEAN_GAP = 24
// How far the bumpiest coast (bumpiness 100) reaches in and out of a biome's radius, in percent of the radius.
const MAX_BUMP_PERCENT = 45
// The coast facing a neighbour reaches out only `facingBump` within 30° of the line to the neighbour's middle, freely
// past 70°, and between the two in between (see `wanderAt`).
const COS_FACING = Math.cos((30 * Math.PI) / 180)
const COS_FREE = Math.cos((70 * Math.PI) / 180)

// ---- what a game picks when it is made

export type WorldSize = 'small' | 'medium' | 'large' | 'huge'
// The presets, and the radius of a biome (one at 100 percent) in each, in tiles.
export const WORLD_SIZES: Readonly<Record<WorldSize, { label: string; radius: number }>> = {
  small: { label: 'Small', radius: 70 },
  medium: { label: 'Medium', radius: 110 },
  large: { label: 'Large', radius: 160 },
  huge: { label: 'Extra large', radius: 220 },
}
export const WORLD_SIZE_KEYS = Object.keys(WORLD_SIZES) as WorldSize[]

export type TerrainSettings = { size: WorldSize }
export const DEFAULT_TERRAIN: Readonly<TerrainSettings> = { size: 'medium' }

// Settings put right: a size that is one of the presets (anything else, like the bumpiness older games chose, is
// dropped: every world is as bumpy now).
export function cleanTerrain(settings: Partial<TerrainSettings> | undefined): TerrainSettings {
  const size = settings?.size && settings.size in WORLD_SIZES ? settings.size : DEFAULT_TERRAIN.size
  return { size }
}

// ---- the layout

// A biome's place in a world: its middle (tiles), radius and how far its coast wanders in and out (tiles).
export type BiomeSite = { biome: BiomeDef; index: number; x: number; y: number; radius: number; bump: number }

export type Terrain = {
  readonly seed: number
  readonly settings: TerrainSettings
  readonly sites: readonly BiomeSite[]
  // The tiles any island can reach (outside it is all sea), each way.
  readonly reach: { left: number; right: number; top: number; bottom: number }
}

// The directions a biome can lie in from the one before it: sixteen, as whole numbers out of 1024.
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = Array.from({ length: 16 }, (_, i) => {
  const angle = (i * Math.PI) / 8
  return [Math.round(Math.cos(angle) * 1024), Math.round(Math.sin(angle) * 1024)] as const
})

// The islands after the second (the desert, the meadow) curve round: each lies TURN_DEGREES round from the way the chain
// was going (the line from the island two before it to the one before it), always turned to the same side (which side
// is the seed's: `curveSide`), with its middle as far from the one before's as the second island's is from the
// first's. The turn as whole numbers out of 4096, so every engine works out the same tiles.
export const TURN_DEGREES = 70
const TURN_COS = Math.round(Math.cos((TURN_DEGREES * Math.PI) / 180) * 4096)
const TURN_SIN = Math.round(Math.sin((TURN_DEGREES * Math.PI) / 180) * 4096)

// Which way the chain curves after the second island: 1 or -1 (clockwise or not, as the map shows it).
export function curveSide(seed: number): 1 | -1 {
  return hashInts(seed, 503) % 2 === 0 ? 1 : -1
}

const made = new Map<string, Terrain>()

// The terrain of a world (worked out once per seed and settings, then kept).
export function terrainOf(seed: number, settings?: Partial<TerrainSettings>): Terrain {
  const clean = cleanTerrain(settings)
  const key = `${seed}|${clean.size}`
  let terrain = made.get(key)
  if (!terrain) {
    const sites = layOut(seed, clean)
    const edge = (site: BiomeSite): number => site.radius + site.bump + 1
    terrain = {
      seed,
      settings: clean,
      sites,
      reach: {
        left: Math.min(...sites.map((site) => site.x - edge(site))),
        right: Math.max(...sites.map((site) => site.x + edge(site))),
        top: Math.min(...sites.map((site) => site.y - edge(site))),
        bottom: Math.max(...sites.map((site) => site.y + edge(site))),
      },
    }
    made.set(key, terrain)
  }
  return terrain
}

function layOut(seed: number, settings: TerrainSettings): BiomeSite[] {
  const base = WORLD_SIZES[settings.size].radius
  const sites: BiomeSite[] = []
  let heading = hashInts(seed, 501) % DIRECTIONS.length
  for (let index = 0; index < BIOMES.length; index++) {
    const biome = BIOMES[index]
    const radius = Math.max(16, Math.round((base * biome.radiusPercent) / 100))
    const bump = Math.floor((radius * ISLANDS.bumpiness * MAX_BUMP_PERCENT) / 10_000)
    if (index === 0) {
      // The first biome is round the spawn.
      sites.push({ biome, index, x: 0, y: 0, radius, bump })
      continue
    }
    const before = sites[index - 1]
    if (index >= 2) {
      // Curving round (see TURN_DEGREES): the way the chain was going, turned, as long a step as the first.
      const twoBack = sites[index - 2]
      const dx = before.x - twoBack.x
      const dy = before.y - twoBack.y
      const side = curveSide(seed)
      const rx = dx * TURN_COS - side * dy * TURN_SIN
      const ry = side * dx * TURN_SIN + dy * TURN_COS
      const step = Math.sqrt((sites[1].x - sites[0].x) ** 2 + (sites[1].y - sites[0].y) ** 2)
      const length = Math.sqrt(rx * rx + ry * ry)
      sites.push({ biome, index, x: before.x + Math.round((rx * step) / length), y: before.y + Math.round((ry * step) / length), radius, bump })
      continue
    }
    // Far enough apart that their facing coasts, wandering out as far as they can, still leave `gap` of sea between.
    const apart = before.radius + radius + ISLANDS.gap + facingBump(before.bump) + facingBump(bump)
    // Turn a little from the way the chain was going, trying the turns in an order of the seed's, and take the first
    // that keeps clear of every biome that is not next to this one.
    const turns = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8]
    const start = hashInts(seed, index, 502) % 3
    let placed: BiomeSite | undefined
    for (let n = 0; n < turns.length && !placed; n++) {
      const turn = turns[(n + start) % turns.length]
      const direction = (((heading + turn) % DIRECTIONS.length) + DIRECTIONS.length) % DIRECTIONS.length
      const [dx, dy] = DIRECTIONS[direction]
      const x = before.x + Math.round((dx * apart) / 1024)
      const y = before.y + Math.round((dy * apart) / 1024)
      const clear = sites.slice(0, index - 1).every((other) => {
        const least = other.radius + other.bump + radius + bump + OCEAN_GAP
        return (other.x - x) ** 2 + (other.y - y) ** 2 >= least * least
      })
      if (clear || n === turns.length - 1) {
        placed = { biome, index, x, y, radius, bump }
        heading = direction
      }
    }
    sites.push(placed!)
  }
  return sites
}

// ---- tiles

// How far a coast facing a neighbour wanders, at most, for a site whose coast wanders `bump` elsewhere.
function facingBump(bump: number): number {
  return Math.min(bump, ISLANDS.facingBump)
}

// The sites next to a site in the chain (the islands it lies by).
function neighboursOf(terrain: Terrain, site: BiomeSite): BiomeSite[] {
  return [terrain.sites[site.index - 1], terrain.sites[site.index + 1]].filter((other) => other !== undefined)
}

// How far out past its radius a site's coast can reach at a point (tiles): its `bump`, but on a side facing a neighbour
// (within 30° of the line to its middle: COS_FACING) only `facingBump`, easing from one to the other out to 70°
// (COS_FREE). Its bays are not held in, only its points: so the coasts facing each other wiggle and bend like any
// other, but can never reach across the gap between them.
export function wanderAt(terrain: Terrain, site: BiomeSite, x: number, y: number): number {
  const dx = x - site.x
  const dy = y - site.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  let wander = site.bump
  if (distance === 0) return wander
  for (const other of neighboursOf(terrain, site)) {
    const ox = other.x - site.x
    const oy = other.y - site.y
    const cos = (dx * ox + dy * oy) / (distance * Math.sqrt(ox * ox + oy * oy))
    const facing = Math.max(0, Math.min(1, (cos - COS_FREE) / (COS_FACING - COS_FREE)))
    wander = Math.min(wander, site.bump + (facingBump(site.bump) - site.bump) * facing)
  }
  return wander
}

// How far inside a site's coast a tile is, in tiles (below 0 is outside it). The coast wanders in and out by up to
// `bump` (out no further than `wanderAt`): broad bays and points, with smaller wiggles on them.
function depthIn(terrain: Terrain, site: BiomeSite, x: number, y: number): number {
  const distance = Math.sqrt((x - site.x) ** 2 + (y - site.y) ** 2)
  if (site.bump === 0) return site.radius - distance
  const salt = 600 + site.index * 10
  const broad = valueNoise(terrain.seed, salt, x, y, Math.max(12, Math.floor(site.radius / 3)))
  const fine = valueNoise(terrain.seed, salt + 1, x, y, 7)
  // -1500 .. +1497, mostly near the middle.
  const wobble = (broad - 500) * 2 + (fine - 500)
  const out = Math.trunc((site.bump * wobble) / 1500)
  return site.radius + (out > 0 ? Math.min(out, wanderAt(terrain, site, x, y)) : out) - distance
}

// The biome a tile is in, or undefined for the sea. The islands never overlap (see `wanderAt`); were two ever to, the
// tile would be the one it is deeper inside.
//
// Everything asks this (walking, water, sand, fog, what grows, the ground's picture), many times a tick, and working it
// out takes noise at every island near: so it is kept (see TileFacts: the site's index plus one, 0 for the sea). Only
// chunks within reach of an island are kept (anywhere else is sea at once), a few hundred kilobytes at most.
export function biomeSiteAt(terrain: Terrain, x: number, y: number): BiomeSite | undefined {
  const box = terrain.reach
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return undefined
  const index = SITES.at(terrain, x, y)
  return index === 0 ? undefined : terrain.sites[index - 1]
}
const SITES = new TileFacts<Terrain>((terrain, x, y) => (workOutSiteAt(terrain, x, y)?.index ?? -1) + 1)

// What `biomeSiteAt` keeps: worked out from the noise.
function workOutSiteAt(terrain: Terrain, x: number, y: number): BiomeSite | undefined {
  let best: BiomeSite | undefined
  let bestDepth = Number.NEGATIVE_INFINITY
  for (const site of terrain.sites) {
    // Far outside its widest coast: not this one.
    const reach = site.radius + site.bump + 1
    if (Math.abs(x - site.x) > reach || Math.abs(y - site.y) > reach) continue
    const depth = depthIn(terrain, site, x, y)
    if (depth > bestDepth) {
      best = site
      bestDepth = depth
    }
  }
  return best && bestDepth > 0 ? best : undefined
}

// ---- the shelf: the shallow sea by the land

// How far out from land the shelf reaches at a sea tile (tiles; Infinity where it is shallow however far the land is):
// `shelf`, more on a side facing a neighbouring island (by up to `shelfFacing`, the more the more squarely it faces it),
// and all the way across between neighbours: an ellipse round the two islands' middles, `shelfJoin` wide each side
// of the line between them at its narrowest (give or take a little, so its edges wander), so the shallows run from one
// island to the other and show the way over.
export function shelfWidthAt(terrain: Terrain, x: number, y: number): number {
  for (let i = 1; i < terrain.sites.length; i++) {
    const a = terrain.sites[i - 1]
    const b = terrain.sites[i]
    const apart = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
    const join = ISLANDS.shelfJoin * (0.75 + valueNoise(terrain.seed, 640, x, y, 9) / 2000)
    // The sum of the distances to the two middles that makes an ellipse `join` wide each side at its middle.
    const most = Math.sqrt(apart * apart + 4 * join * join)
    if (Math.sqrt((x - a.x) ** 2 + (y - a.y) ** 2) + Math.sqrt((x - b.x) ** 2 + (y - b.y) ** 2) <= most) return Infinity
  }
  // Off the coast of the island nearest (by how far out from its radius), wider the more squarely it faces a neighbour.
  let nearest: BiomeSite | undefined
  let nearestGap = Infinity
  for (const site of terrain.sites) {
    const gap = Math.sqrt((x - site.x) ** 2 + (y - site.y) ** 2) - site.radius
    if (gap < nearestGap) {
      nearest = site
      nearestGap = gap
    }
  }
  let width = ISLANDS.shelf
  if (!nearest) return width
  const dx = x - nearest.x
  const dy = y - nearest.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  for (const other of neighboursOf(terrain, nearest)) {
    if (distance === 0) break
    const ox = other.x - nearest.x
    const oy = other.y - nearest.y
    const cos = (ox * dx + oy * dy) / (distance * Math.sqrt(ox * ox + oy * oy))
    if (cos > 0) width = Math.max(width, ISLANDS.shelf + ISLANDS.shelfFacing * cos * cos)
  }
  return width
}

// The widest the shelf is anywhere but between neighbours (see `shelfWidthAt`).
export const SHELF_MOST = ISLANDS.shelf + ISLANDS.shelfFacing

export function biomeAt(terrain: Terrain, x: number, y: number): BiomeDef | undefined {
  return biomeSiteAt(terrain, x, y)?.biome
}

export function isSeaAt(terrain: Terrain, x: number, y: number): boolean {
  return biomeSiteAt(terrain, x, y) === undefined
}

// Whether a tile is sand: all of a desert, or a beach, the land right along the sea (a tile beside it, not corner to
// corner) in a biome with soil (the mountains' shore is rock). As the ground is drawn (ground-colors.ts) and walked on
// (sounds.ts); a cactus only grows on it.
export function isSandAt(terrain: Terrain, x: number, y: number): boolean {
  const site = biomeSiteAt(terrain, x, y)
  if (!site) return false
  if (site.biome.ground === 'sand') return true
  if (!site.biome.soil) return false
  return isSeaAt(terrain, x + 1, y) || isSeaAt(terrain, x - 1, y) || isSeaAt(terrain, x, y + 1) || isSeaAt(terrain, x, y - 1)
}

// Whether a tile is under the fog that shrouds the far islands (a biome that is `fogged`): all of one, its rivers too.
// A player who has not eaten a truesight flesh cannot set foot there, and sees only fog.
export function isFoggedAt(terrain: Terrain, x: number, y: number): boolean {
  return biomeSiteAt(terrain, x, y)?.biome.fogged === true
}

// Whether plants can take root on a tile (grass, a berry bush, a sapling, planted or spreading there): land in a
// biome with soil, and not its sand.
export function canGrowAt(terrain: Terrain, x: number, y: number): boolean {
  const site = biomeSiteAt(terrain, x, y)
  return site !== undefined && site.biome.soil && !isSandAt(terrain, x, y)
}

// Every chunk with land in it, of any island (looked for every ISLAND_PROBE tiles), in order: what a world grows whole
// when it is made.
const ISLAND_PROBE = 2
export function islandChunks(terrain: Terrain): number[] {
  const chunks = new Set<number>()
  for (const site of terrain.sites) {
    const reach = site.radius + site.bump + CHUNK_SIZE
    for (let cy = Math.floor((site.y - reach) / CHUNK_SIZE); cy <= Math.floor((site.y + reach) / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor((site.x - reach) / CHUNK_SIZE); cx <= Math.floor((site.x + reach) / CHUNK_SIZE); cx++) {
        let land = false
        for (let y = 0; y < CHUNK_SIZE && !land; y += ISLAND_PROBE) {
          for (let x = 0; x < CHUNK_SIZE && !land; x += ISLAND_PROBE) land = biomeSiteAt(terrain, cx * CHUNK_SIZE + x, cy * CHUNK_SIZE + y) !== undefined
        }
        if (land) chunks.add(chunkId(cx, cy))
      }
    }
  }
  return [...chunks].sort((a, b) => a - b)
}

// ---- temperature

// The air temperature at a point (in tiles; a fraction of a tile is fine), in °C, not rounded: what the ground's snow is
// drawn from, so it fades smoothly. In a biome after the first, it goes from its `edge` temperature where it meets the
// biome before it to its `core` temperature at its far side, along the line from the one to the other (bent by its
// `curve`); the sea takes the temperature of the biome nearest, and the dungeons are DUNGEON_AIR.
export function airTemperatureAt(terrain: Terrain, x: number, y: number): number {
  const tileX = Math.floor(x)
  const tileY = Math.floor(y)
  if (isInDungeons(tileX, tileY)) return DUNGEON_AIR
  const site = biomeSiteAt(terrain, tileX, tileY) ?? nearestSite(terrain, x, y)
  const { edge, core, curve } = site.biome.temperature
  if (site.index === 0 || edge === core) return edge
  return edge + (core - edge) * Math.pow(depthShare(terrain, site, x, y), curve)
}

// How far into a biome after the first a point is, 0 (where it meets the biome before it) to 1 (its far side), along
// the line from the middle of the biome before it through its own.
function depthShare(terrain: Terrain, site: BiomeSite, x: number, y: number): number {
  const { meet, far, ux, uy, before } = axisOf(terrain, site)
  const along = (x - before.x) * ux + (y - before.y) * uy
  return Math.max(0, Math.min(1, (along - meet) / Math.max(1, far - meet)))
}

// The line a biome after the first is measured along: from the middle of the biome before it (`before`), one tile long
// each way (ux, uy); where the two meet on it, and its far side, in tiles along it.
function axisOf(terrain: Terrain, site: BiomeSite): { before: BiomeSite; ux: number; uy: number; meet: number; far: number } {
  const before = terrain.sites[site.index - 1]
  const length = Math.sqrt((site.x - before.x) ** 2 + (site.y - before.y) ** 2)
  return {
    before,
    ux: (site.x - before.x) / length,
    uy: (site.y - before.y) / length,
    meet: (length * length + before.radius * before.radius - site.radius * site.radius) / (2 * length),
    far: length + site.radius,
  }
}

// The tile `share` of the way into a biome after the first (see depthShare), on the line through the middles.
function pointAtShare(terrain: Terrain, site: BiomeSite, share: number): { x: number; y: number } {
  const { meet, far, ux, uy, before } = axisOf(terrain, site)
  const along = meet + (far - meet) * share
  return { x: Math.round(before.x + ux * along), y: Math.round(before.y + uy * along) }
}

function nearestSite(terrain: Terrain, x: number, y: number): BiomeSite {
  let best = terrain.sites[0]
  let bestGap = Number.POSITIVE_INFINITY
  for (const site of terrain.sites) {
    const gap = Math.sqrt((x - site.x) ** 2 + (y - site.y) ** 2) - site.radius
    if (gap < bestGap) {
      best = site
      bestGap = gap
    }
  }
  return best
}

// ---- landmarks: the skeletons' camps and the way into the dungeon, in the mountains (the goblins' camps, on the meadow,
// are world-gen.ts's, as they keep clear of its rivers)

// Whether there is sea within `distance` tiles of a tile (looked for on two rings round it, so a narrow inlet could slip
// between the points looked at; near enough for keeping things off the shore).
export function seaWithin(terrain: Terrain, x: number, y: number, distance: number): boolean {
  for (const ring of [distance, Math.ceil(distance / 2)]) {
    const points = Math.max(8, Math.ceil(ring * 4))
    for (let i = 0; i < points; i++) {
      const angle = (i * Math.PI * 2) / points
      if (!biomeSiteAt(terrain, x + Math.round(Math.cos(angle) * ring), y + Math.round(Math.sin(angle) * ring))) return true
    }
  }
  return false
}

// The way into the dungeon: deep in the mountains' snow, DUNGEON_SHARE of the way in, on the nearest tile to there that
// is well clear of the sea. The skeletons' camps: one in each CAMP_CELL square of the mountains, CAMP_CHANCE percent of
// the time, where the air is from CAMP_WARMEST down to CAMP_COLDEST °C, well clear of the sea and at least CAMP_APART
// tiles from the way into the dungeon. All from data/world-gen.json.
const DUNGEON_SHARE = WORLD_GEN.dungeon.share
const CAMP_CELL = WORLD_GEN.camps.cell
const CAMP_CHANCE = WORLD_GEN.camps.chance
const CAMP_WARMEST = WORLD_GEN.camps.warmest
const CAMP_COLDEST = WORLD_GEN.camps.coldest
const CAMP_APART = WORLD_GEN.camps.apartFromDungeon
// Nothing grows within these many tiles of a camp's middle, or of the way into the dungeon.
export const CAMP_CLEARING = WORLD_GEN.camps.clearing
export const ENTRANCE_CLEARING = WORLD_GEN.dungeon.clearing
export type Landmarks = {
  entrance: { x: number; y: number } | undefined
  camps: ReadonlyArray<{ x: number; y: number }>
}
const landmarksMade = new WeakMap<Terrain, Landmarks>()

// A world's landmarks (worked out once, from its terrain alone, so every page has them where the server does).
export function landmarksOf(terrain: Terrain): Landmarks {
  let found = landmarksMade.get(terrain)
  if (!found) {
    found = findLandmarks(terrain)
    landmarksMade.set(terrain, found)
  }
  return found
}

// The tile of the way into the dungeon; undefined in a world with no mountains.
export function dungeonEntrance(terrain: Terrain): { x: number; y: number } | undefined {
  return landmarksOf(terrain).entrance
}

// The middle tile of each skeletons' camp.
export function campSites(terrain: Terrain): ReadonlyArray<{ x: number; y: number }> {
  return landmarksOf(terrain).camps
}

// Whether a tile is in the clearing round a camp or the way into the dungeon, where nothing grows.
export function inLandmarkClearing(terrain: Terrain, x: number, y: number): boolean {
  const { entrance, camps } = landmarksOf(terrain)
  if (entrance && Math.abs(x - entrance.x) <= ENTRANCE_CLEARING && Math.abs(y - entrance.y) <= ENTRANCE_CLEARING) return true
  return camps.some((camp) => (x - camp.x) ** 2 + (y - camp.y) ** 2 <= CAMP_CLEARING * CAMP_CLEARING)
}

function findLandmarks(terrain: Terrain): Landmarks {
  const site = terrain.sites.find((candidate) => candidate.biome.key === 'mountain' && candidate.index > 0)
  if (!site) return { entrance: undefined, camps: [] }
  const goodSpot = (x: number, y: number, clear: number): boolean => biomeSiteAt(terrain, x, y) === site && !seaWithin(terrain, x, y, clear)
  // The way in: the nearest good tile to the point DUNGEON_SHARE of the way in, looking outwards a ring at a time.
  let entrance: { x: number; y: number } | undefined
  const aim = pointAtShare(terrain, site, DUNGEON_SHARE)
  for (let ring = 0; ring <= 40 && !entrance; ring++) {
    for (let dy = -ring; dy <= ring && !entrance; dy++) {
      for (let dx = -ring; dx <= ring && !entrance; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring && goodSpot(aim.x + dx, aim.y + dy, 7)) entrance = { x: aim.x + dx, y: aim.y + dy }
      }
    }
  }
  const camps: Array<{ x: number; y: number }> = []
  const cells = Math.ceil((site.radius + site.bump) / CAMP_CELL)
  const middleX = Math.floor(site.x / CAMP_CELL)
  const middleY = Math.floor(site.y / CAMP_CELL)
  for (let gy = middleY - cells; gy <= middleY + cells; gy++) {
    for (let gx = middleX - cells; gx <= middleX + cells; gx++) {
      if (hashInts(terrain.seed, gx, gy, 711) % 100 >= CAMP_CHANCE) continue
      const x = gx * CAMP_CELL + 6 + (hashInts(terrain.seed, gx, gy, 712) % (CAMP_CELL - 12))
      const y = gy * CAMP_CELL + 6 + (hashInts(terrain.seed, gx, gy, 713) % (CAMP_CELL - 12))
      if (biomeSiteAt(terrain, x, y) !== site) continue
      const air = airTemperatureAt(terrain, x, y)
      if (air > CAMP_WARMEST || air < CAMP_COLDEST) continue
      if (entrance && Math.hypot(x - entrance.x, y - entrance.y) < CAMP_APART) continue
      if (!goodSpot(x, y, 6)) continue
      camps.push({ x, y })
    }
  }
  return { entrance, camps }
}

// ---- the snow

// The snow is heaviest at SNOW_FULL_AT and below, and starts at SNOW_STARTS_AT (the air's temperature, not the
// player's: a campfire warms you, but does not keep the snow out of your eyes). The ground is snowy from about there in.
export const SNOW_STARTS_AT = -4
export const SNOW_FULL_AT = -45

// How heavy the snow is at an air temperature, 0 (none) to 1 (a whiteout).
export function snowAt(temperature: number): number {
  return Math.max(0, Math.min(1, (SNOW_STARTS_AT - temperature) / (SNOW_STARTS_AT - SNOW_FULL_AT)))
}
