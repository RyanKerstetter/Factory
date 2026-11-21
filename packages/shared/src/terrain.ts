import { TPS } from './constants.ts'
import { floorDiv } from './geometry.ts'
import { hashInts } from './rng.ts'
import { DUNGEON_AIR, isInDungeons } from './dungeon.ts'

// The land: a chain of biomes, one per step of progression, each a rough, bumpy disc, in a sea that fills the rest of
// the world. A biome overlaps the biome before it and the one after it in the chain (so they join side by side, with
// no bridge), and keeps well clear of every other one, so the only way between biomes that are not next to each other
// in the progression is through the ones between them (or over the sea, later).
//
// It is all worked out from the world's seed and its TerrainSettings, the same on the server and on every page: the
// sites are whole numbers, and each tile is tested with whole-number noise and Math.sqrt (which every JavaScript engine
// rounds the same), so a tile is land or sea, and in one biome or another, everywhere alike.

// ---- the biomes, in the order players move through them

export type BiomeKey = 'forest' | 'mountain'

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
}

export const BIOMES: readonly BiomeDef[] = [
  { key: 'forest', name: 'Forest', radiusPercent: 100, temperature: { edge: 16, core: 16, curve: 1 }, regrows: ['grass', 'bush'], ponds: true },
  { key: 'mountain', name: 'Mountains', radiusPercent: 95, temperature: { edge: 12, core: -58, curve: 2.2 }, regrows: [], ponds: false },
]

export function biomeDef(key: BiomeKey): BiomeDef {
  return BIOMES.find((biome) => biome.key === key)!
}

// How far two biomes next to each other in the chain cut into each other: the distance between their middles is the
// sum of their radii, less this percentage of the smaller radius. Higher joins them along a wider front.
export const BIOME_OVERLAP_PERCENT = 28
// The least sea, in tiles, between two biomes that are not next to each other in the chain.
const OCEAN_GAP = 24
// How far the bumpiest coast (bumpiness 100) reaches in and out of a biome's radius, in percent of the radius.
const MAX_BUMP_PERCENT = 45

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

// `bumpiness`: how ragged the coasts are, 0 (near round) to 100 (deep bays and long points).
export type TerrainSettings = { size: WorldSize; bumpiness: number }
export const DEFAULT_TERRAIN: Readonly<TerrainSettings> = { size: 'medium', bumpiness: 60 }

// Settings put right: a size that is one of the presets, and a whole-number bumpiness from 0 to 100.
export function cleanTerrain(settings: Partial<TerrainSettings> | undefined): TerrainSettings {
  const size = settings?.size && settings.size in WORLD_SIZES ? settings.size : DEFAULT_TERRAIN.size
  const raw = typeof settings?.bumpiness === 'number' && Number.isFinite(settings.bumpiness) ? settings.bumpiness : DEFAULT_TERRAIN.bumpiness
  return { size, bumpiness: Math.max(0, Math.min(100, Math.round(raw))) }
}

// ---- the layout

// A biome's place in a world: its middle (tiles), radius and how far its coast wanders in and out (tiles).
export type BiomeSite = { biome: BiomeDef; index: number; x: number; y: number; radius: number; bump: number }

export type Terrain = {
  readonly seed: number
  readonly settings: TerrainSettings
  readonly sites: readonly BiomeSite[]
}

// The directions a biome can lie in from the one before it: sixteen, as whole numbers out of 1024.
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = Array.from({ length: 16 }, (_, i) => {
  const angle = (i * Math.PI) / 8
  return [Math.round(Math.cos(angle) * 1024), Math.round(Math.sin(angle) * 1024)] as const
})

const made = new Map<string, Terrain>()

// The terrain of a world (worked out once per seed and settings, then kept).
export function terrainOf(seed: number, settings?: Partial<TerrainSettings>): Terrain {
  const clean = cleanTerrain(settings)
  const key = `${seed}|${clean.size}|${clean.bumpiness}`
  let terrain = made.get(key)
  if (!terrain) {
    terrain = { seed, settings: clean, sites: layOut(seed, clean) }
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
    const bump = Math.floor((radius * settings.bumpiness * MAX_BUMP_PERCENT) / 10_000)
    if (index === 0) {
      // The first biome is round the spawn.
      sites.push({ biome, index, x: 0, y: 0, radius, bump })
      continue
    }
    const before = sites[index - 1]
    const apart = before.radius + radius - Math.floor((Math.min(before.radius, radius) * BIOME_OVERLAP_PERCENT) / 100)
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

// Smooth noise, 0 to 999, from values at the corners of a grid of `cell` tiles blended between them (whole numbers).
function valueNoise(seed: number, salt: number, x: number, y: number, cell: number): number {
  const cx = floorDiv(x, cell)
  const cy = floorDiv(y, cell)
  const fx = x - cx * cell
  const fy = y - cy * cell
  const corner = (ox: number, oy: number): number => hashInts(seed, cx + ox, cy + oy, salt) % 1000
  const top = corner(0, 0) * (cell - fx) + corner(1, 0) * fx
  const bottom = corner(0, 1) * (cell - fx) + corner(1, 1) * fx
  return Math.floor((top * (cell - fy) + bottom * fy) / (cell * cell))
}

// How far inside a site's coast a tile is, in tiles (below 0 is outside it). The coast wanders in and out by up to
// `bump`: broad bays and points, with smaller wiggles on them.
function depthIn(terrain: Terrain, site: BiomeSite, x: number, y: number): number {
  const distance = Math.sqrt((x - site.x) ** 2 + (y - site.y) ** 2)
  if (site.bump === 0) return site.radius - distance
  const salt = 600 + site.index * 10
  const broad = valueNoise(terrain.seed, salt, x, y, Math.max(12, Math.floor(site.radius / 3)))
  const fine = valueNoise(terrain.seed, salt + 1, x, y, 7)
  // -1500 .. +1497, mostly near the middle.
  const wobble = (broad - 500) * 2 + (fine - 500)
  return site.radius + Math.trunc((site.bump * wobble) / 1500) - distance
}

// The biome a tile is in, or undefined for the sea. Where two overlap, the tile is the one it is deeper inside; and
// the middle of where two neighbours' plain circles overlap is always land, so however ragged their coasts are, they
// are joined.
export function biomeSiteAt(terrain: Terrain, x: number, y: number): BiomeSite | undefined {
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
  if (best && bestDepth > 0) return best
  // Between two neighbours: where their plain circles overlap, and a broad band along the line from one's middle to the
  // other's, is always land, so no bay can cut them apart.
  for (let i = 1; i < terrain.sites.length; i++) {
    const a = terrain.sites[i - 1]
    const b = terrain.sites[i]
    const toA = (x - a.x) ** 2 + (y - a.y) ** 2
    const toB = (x - b.x) ** 2 + (y - b.y) ** 2
    const nearer = Math.sqrt(toA) * b.radius <= Math.sqrt(toB) * a.radius ? a : b
    if (toA <= (a.radius - 2) ** 2 && toB <= (b.radius - 2) ** 2) return nearer
    const band = Math.max(4, Math.floor((Math.min(a.radius, b.radius) * JOIN_BAND_PERCENT) / 100))
    if (distanceToSegment(x, y, a, b) <= band) return nearer
  }
  return undefined
}

// How wide the band of land along the line between neighbours' middles is, each side, in percent of the smaller radius.
const JOIN_BAND_PERCENT = 15

function distanceToSegment(x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const along = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.sqrt((x - a.x - along * dx) ** 2 + (y - a.y - along * dy) ** 2)
}

export function biomeAt(terrain: Terrain, x: number, y: number): BiomeDef | undefined {
  return biomeSiteAt(terrain, x, y)?.biome
}

export function isSeaAt(terrain: Terrain, x: number, y: number): boolean {
  return biomeSiteAt(terrain, x, y) === undefined
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

// The air temperature on a tile, in whole °C (see airTemperatureAt).
export function temperatureAt(terrain: Terrain, x: number, y: number): number {
  return Math.round(airTemperatureAt(terrain, x, y))
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

// ---- landmarks: the skeletons' camps and the way into the dungeon, in the mountains

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
// is well clear of the sea.
const DUNGEON_SHARE = 0.84
// The skeletons' camps: one in each CAMP_CELL square of the mountains, CAMP_CHANCE percent of the time, where the air is
// from CAMP_WARMEST down to CAMP_COLDEST °C, well clear of the sea and at least CAMP_APART tiles from the way into the
// dungeon.
const CAMP_CELL = 34
const CAMP_CHANCE = 60
const CAMP_WARMEST = 6
const CAMP_COLDEST = -24
const CAMP_APART = 30
// Nothing grows within these many tiles of a camp's middle, or of the way into the dungeon.
export const CAMP_CLEARING = 4
export const ENTRANCE_CLEARING = 3

export type Landmarks = { entrance: { x: number; y: number } | undefined; camps: ReadonlyArray<{ x: number; y: number }> }
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

// ---- the cold

// A player's body warms and cools towards the temperature round them (see cold.ts): the air's, plus the warmth of the
// armour they wear, or, by a lit campfire (within CAMPFIRE_WARMTH_RADIUS tiles), that CAMPFIRE_WARMTH degrees warmer
// and never less than CAMPFIRE_COMFORT.
// It starts at BODY_NORMAL and never goes above BODY_MAX. It cools by BODY_COOLING degrees a second, plus
// BODY_COOLING_GAP percent of how much colder the air is than the body (so bitter cold bites faster), and warms
// likewise by BODY_WARMING and BODY_WARMING_GAP percent.
// Below COLD_AT a player is cold, and slows down more and more the colder their body is, to FREEZING_SPEED_PERCENT
// at DEADLY_COLD_AT; below DEADLY_COLD_AT they lose COLD_DAMAGE health every COLD_DAMAGE_EVERY ticks.
export const COLD_AT = 0
export const FREEZING_AT = -10
export const DEADLY_COLD_AT = -25
export const FREEZING_SPEED_PERCENT = 45
export const COLD_DAMAGE = 1
export const COLD_DAMAGE_EVERY = 2 * TPS
export const BODY_NORMAL = 16
export const BODY_MAX = 20
export const BODY_COOLING = 2
export const BODY_COOLING_GAP = 14
export const BODY_WARMING = 1.5
export const BODY_WARMING_GAP = 12
export const CAMPFIRE_WARMTH = 30
export const CAMPFIRE_COMFORT = 18
export const CAMPFIRE_WARMTH_RADIUS = 3
// The snow is heaviest at SNOW_FULL_AT and below, and starts at SNOW_STARTS_AT (the air's temperature, not the
// player's: a campfire warms you, but does not keep the snow out of your eyes). The ground is snowy from about there in.
export const SNOW_STARTS_AT = -4
export const SNOW_FULL_AT = -45

export type ColdLevel = 'warm' | 'cold' | 'freezing' | 'deadly'

// How the cold is treating a player, by their body's temperature.
export function coldLevel(body: number): ColdLevel {
  if (body < DEADLY_COLD_AT) return 'deadly'
  if (body < FREEZING_AT) return 'freezing'
  if (body < COLD_AT) return 'cold'
  return 'warm'
}

// How heavy the snow is at an air temperature, 0 (none) to 1 (a whiteout).
export function snowAt(temperature: number): number {
  return Math.max(0, Math.min(1, (SNOW_STARTS_AT - temperature) / (SNOW_STARTS_AT - SNOW_FULL_AT)))
}
