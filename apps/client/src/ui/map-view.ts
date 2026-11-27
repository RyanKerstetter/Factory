import {
  biomeAt,
  CHUNK_SIZE,
  chunkCoords,
  chunkId,
  dungeonEntrance,
  floorDiv,
  isFloorKind,
  grownCamps,
  isCampKind,
  chunkOfTile,
  isFoggedAt,
  isSeaAt,
  coastAround,
  isShelf,
  plantsInChunk,
  waterAt,
  ZOOM_MIN as ZOOM_OUT_MOST,
  type BuildingKind,
  type Terrain,
} from '../../../../packages/shared/src/index.ts'
import { groundSpan } from '../camera.ts'
import { snowOnTile } from '../snow.ts'
import { element } from './dom.ts'

// The map (M): the world as far as this player has explored it, PX pixels to a tile, with everyone playing on it. The
// world goes on every way, so the map does too: what is explored is kept a REGION-tile square at a time, made as the
// player first comes near it, and kept in this browser for each world and player name (localStorage), so it is still
// there next time. Ground is explored in cells of CELL tiles: every cell any of which is on the screen round the player
// (REVEAL: as much as a 16:9 screen shows, zoomed all the way out); it is painted as it is
// explored (sea, shelf, beach, forest, ponds, rock and snow), with what stands on it (trees, bushes, rocks, and what
// players have built, each a little picture PX pixels a side), and the camps and the way into the dungeon show once
// found. What stands on ground the page has loaded is drawn as it is now (`things`); elsewhere, as the seed grew it.
// The far islands (the meadow, the desert) show only as fog, with nothing on them, until the player has truesight.
// It shows round the player, and dragging it with the left button looks around, as far as you like (a double click, or
// opening it again, brings it back to the player). The mouse wheel (or its + and - buttons) zooms it in and out, from
// ZOOM_MIN to ZOOM_MAX times its own size, about the mouse; the zoom is kept while the page is open.

const CELL = 4
// Pixels a side per tile in the map's picture.
const PX = 4
// How far the map zooms out and in (times PX pixels a tile), and how much each notch of the wheel or press of a button.
const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_STEP = 1.25
// How often the explored ground the page has loaded is drawn again, so a felled tree or a new fence shows.
const REFRESH_MS = 2_000
const REVEAL = groundSpan(16 / 9, ZOOM_OUT_MOST)
// How big a square of the explored ground is kept as one (tiles; a whole number of cells), and the bytes of its
// explored cells, a bit each.
const REGION = 64
const REGION_CELLS = REGION / CELL
const REGION_BYTES = (REGION_CELLS * REGION_CELLS) / 8
const SAVE_EVERY_MS = 4_000
const STORAGE_PREFIX = 'factory-game.map:'

type Rgb = readonly [number, number, number]
const SEA_DEEP: Rgb = [0x17, 0x3d, 0x6e]
const SEA_SHELF: Rgb = [0x4a, 0x93, 0xc0]
const SAND: Rgb = [0xd8, 0xc6, 0x90]
const GRASS: Rgb = [0x6a, 0x8f, 0x3e]
const POND: Rgb = [0x3a, 0x74, 0xb0]
const ROCK: Rgb = [0x8b, 0x8f, 0x96]
const SNOW: Rgb = [0xe8, 0xef, 0xf8]
const MEADOW: Rgb = [0x7f, 0xa8, 0x48]
// The fog over the far islands, for a player without truesight.
const FOG: Rgb = [0xc4, 0xc8, 0xcc]
// What stands on the ground, as a little picture: each row of PX letters, '.' the ground showing through.
const LEAF: Rgb = [0x2f, 0x5a, 0x24]
const LEAF_LIGHT: Rgb = [0x44, 0x75, 0x30]
const TRUNK: Rgb = [0x5a, 0x3e, 0x26]
const BUSH: Rgb = [0x3f, 0x7a, 0x34]
const BERRY: Rgb = [0xc8, 0x32, 0x4f]
const STONE: Rgb = [0x6a, 0x6e, 0x76]
const STONE_LIGHT: Rgb = [0xa4, 0xa8, 0xae]
const WOOD: Rgb = [0x9a, 0x6e, 0x42]
const WOOD_DARK: Rgb = [0x6b, 0x4a, 0x2c]
const SOIL: Rgb = [0x4e, 0x36, 0x24]
const SPROUT: Rgb = [0x7c, 0xb0, 0x4a]
const FIRE: Rgb = [0xf0, 0x8a, 0x2c]
const BONE: Rgb = [0xe6, 0xdf, 0xc8]
const HAY: Rgb = [0xd8, 0xc2, 0x7a]
const BLOOD: Rgb = [0x7a, 0x0f, 0x1a]
const DARK_STONE: Rgb = [0x2c, 0x28, 0x30]
const WAYSTONE: Rgb = [0x87, 0x8c, 0xa7]
const ESSENCE: Rgb = [0x8f, 0xd6, 0xff]
const PETAL: Rgb = [0xf2, 0xc4, 0x1c]
const SEED: Rgb = [0x5a, 0x3a, 0x1c]
const STEM: Rgb = [0x4f, 0x8a, 0x3a]
const CLAY: Rgb = [0xa4, 0x9a, 0x9a]
const CLAY_DARK: Rgb = [0x84, 0x7d, 0x7d]
const COPPER: Rgb = [0xd2, 0x7a, 0x3c]
const TIN: Rgb = [0xdc, 0xdf, 0xd4]
const CACTUS: Rgb = [0x3c, 0x7a, 0x3a]
const SAND_DARK: Rgb = [0xc0, 0xa4, 0x68]
const WEB: Rgb = [0xee, 0xee, 0xe8]
const HONEY: Rgb = [0xe8, 0xa8, 0x2c]
const COMB: Rgb = [0xb8, 0x7a, 0x1c]
type Glyph = { rows: readonly string[]; colors: Readonly<Record<string, Rgb>> }
const GLYPHS: Partial<Record<BuildingKind, Glyph>> = {
  tree: { rows: ['.ll.', 'lLLL', 'LLLL', '.tt.'], colors: { l: LEAF_LIGHT, L: LEAF, t: TRUNK } },
  bush: { rows: ['....', '.bb.', 'brrb', '.bb.'], colors: { b: BUSH, r: BERRY } },
  rock: { rows: ['....', '.ss.', 'sSSS', 'SSSS'], colors: { s: STONE_LIGHT, S: STONE } },
  sapling: { rows: ['....', '.g..', '.gg.', '....'], colors: { g: SPROUT } },
  sprout: { rows: ['....', '.g..', '.gg.', '....'], colors: { g: SPROUT } },
  fence: { rows: ['....', 'wwww', 'w..w', '....'], colors: { w: WOOD } },
  gate: { rows: ['....', 'wddw', 'w..w', '....'], colors: { w: WOOD, d: WOOD_DARK } },
  plot: { rows: ['dddd', 'dgdg', 'dddd', 'dgdg'], colors: { d: SOIL, g: SPROUT } },
  campfire: { rows: ['....', '.ff.', 'sffs', 'ssss'], colors: { f: FIRE, s: STONE } },
  oven: { rows: ['.ss.', 'ssss', 'sffs', 'ssss'], colors: { f: FIRE, s: STONE } },
  well: { rows: ['wwww', '.ss.', 'sPPs', '.ss.'], colors: { w: WOOD, s: STONE, P: POND } },
  altar: { rows: ['b..b', 'bRRb', 'sRRs', 'ssss'], colors: { b: BONE, R: BLOOD, s: DARK_STONE } },
  pedestal: { rows: ['ssss', '.s..', '.s..', 'ssss'], colors: { s: STONE } },
  waystone: { rows: ['.ss.', 'sees', 'ssss', 'dddd'], colors: { s: WAYSTONE, e: ESSENCE, d: DARK_STONE } },
  dummy: { rows: ['.hh.', 'hhhh', '.hh.', '.ww.'], colors: { h: HAY, w: WOOD } },
  worker: { rows: ['.bb.', '.eb.', 'bbbb', '.bb.'], colors: { b: BONE, e: ESSENCE } },
  sunflower: { rows: ['.pp.', 'pssp', '.pp.', '.g..'], colors: { p: PETAL, s: SEED, g: STEM } },
  seedling: { rows: ['....', '.g..', '.gg.', '....'], colors: { g: SPROUT } },
  clay: { rows: ['....', '.cc.', 'cCCc', 'CCCC'], colors: { c: CLAY, C: CLAY_DARK } },
  'copper-rock': { rows: ['....', '.so.', 'sSoS', 'SoSS'], colors: { s: STONE_LIGHT, S: STONE, o: COPPER } },
  'tin-rock': { rows: ['....', '.so.', 'sSoS', 'SoSS'], colors: { s: STONE_LIGHT, S: STONE, o: TIN } },
  cactus: { rows: ['.c..', 'cc.c', '.ccc', '.c..'], colors: { c: CACTUS } },
  'young-cactus': { rows: ['....', '.c..', '.cc.', '....'], colors: { c: CACTUS } },
  sand: { rows: ['....', '.dd.', 'dddd', '....'], colors: { d: SAND_DARK } },
  cobweb: { rows: ['w..w', '.ww.', '.ww.', 'w..w'], colors: { w: WEB } },
  hive: { rows: ['.hh.', 'hcch', 'hcch', '.hh.'], colors: { h: HONEY, c: COMB } },
  'beebox': { rows: ['wwww', 'whhw', 'whhw', 'wwww'], colors: { w: WOOD, h: HONEY } },
  'wood-wall': { rows: ['dddd', 'dddd', 'dddd', 'dddd'], colors: { d: WOOD_DARK } },
  'wood-door': { rows: ['dddd', 'wwww', 'wwww', 'dddd'], colors: { d: WOOD_DARK, w: WOOD } },
  'wood-floor': { rows: ['wwww', 'dddd', 'wwww', 'dddd'], colors: { w: WOOD, d: WOOD_DARK } },
  'stone-floor': { rows: ['sSss', 'ssSs', 'Ssss', 'ssSs'], colors: { s: STONE_LIGHT, S: STONE } },
}
// Anything else a player put down (a chest, the stations, a barrel...): a block of wood.
const BUILT: Glyph = { rows: ['dddd', 'dwwd', 'dwwd', 'dddd'], colors: { d: WOOD_DARK, w: WOOD } }
// Not drawn: grass (it would cover the forest), flint, the dungeon's door.
const UNDRAWN = new Set<BuildingKind>(['grass', 'loose', 'door'])

// A square of explored ground: which of its cells are explored, and its picture (painted into `image`, then put on
// `picture` when `changed`).
type Region = {
  rx: number
  ry: number
  explored: Uint8Array
  picture: HTMLCanvasElement
  paint: CanvasRenderingContext2D
  image: ImageData
  changed: boolean
}

// Everyone on the map: where they are (tiles) and which way they face (radians), and who they are.
export type MapFrame = {
  terrain: Terrain
  // What the explored ground is kept under (the world, and the player).
  key: string
  me: { x: number; y: number; facing: number }
  others: ReadonlyArray<{ x: number; y: number; name: string }>
  // In the dungeon (which is not on the map).
  away: boolean
  // What stands in each chunk the page has loaded (by chunk ID), as it is now; the rest is drawn as the seed grew it.
  loadedChunks: readonly number[]
  things: (chunk: number) => ReadonlyArray<{ x: number; y: number; kind: BuildingKind }>
  // Whether the player has truesight: the far islands show as they are, not as fog.
  fogLifted: boolean
}

export type MapView = {
  readonly isOpen: boolean
  toggle(): void
  close(): void
  update(frame: MapFrame): void
  dispose(): void
}

export function createMapView(container: HTMLElement): MapView {
  const canvas = element('canvas', 'map-canvas')
  const note = element('p', 'map-note')
  const zoomOut = element('button', 'map-zoom-button', '−')
  const zoomIn = element('button', 'map-zoom-button', '+')
  const zoomText = element('span', 'map-zoom-text')
  zoomOut.type = zoomIn.type = 'button'
  zoomOut.title = 'Zoom out'
  zoomIn.title = 'Zoom in'
  const zoomBar = element('div', 'map-zoom', zoomOut, zoomText, zoomIn)
  const root = element('div', 'map-overlay', element('div', 'map-card', element('h2', 'map-title', 'Map'), canvas, element('div', 'map-foot', note, zoomBar)))
  root.hidden = true
  container.append(root)
  const context = canvas.getContext('2d')!

  // The explored ground, a REGION-tile square at a time, made as the player first comes near one (by "rx,ry").
  const regions = new Map<string, Region>()
  // What the seed grew in each chunk, and what stands in the loaded ones now: by tile, x + y * CHUNK_SIZE.
  const grown = new Map<number, Map<number, BuildingKind>>()
  const live = new Map<number, Map<number, BuildingKind>>()
  // Which tiles of each chunk are on the shelf (1) rather than deep sea or land: worked out by the same coast.ts the
  // ground's picture uses, so the map shows the shallows exactly where the world does.
  const shelves = new Map<number, Uint8Array>()
  const shelfAt = (x: number, y: number): boolean => {
    const cx = floorDiv(x, CHUNK_SIZE)
    const cy = floorDiv(y, CHUNK_SIZE)
    const id = chunkId(cx, cy)
    let tiles = shelves.get(id)
    if (!tiles) {
      tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE)
      const coast = coastAround(terrain!, cx * CHUNK_SIZE, cy * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE)
      for (let ty = 0; ty < CHUNK_SIZE; ty++) {
        for (let tx = 0; tx < CHUNK_SIZE; tx++) tiles[ty * CHUNK_SIZE + tx] = isShelf(terrain!, coast, cx * CHUNK_SIZE + tx, cy * CHUNK_SIZE + ty) ? 1 : 0
      }
      shelves.set(id, tiles)
    }
    return tiles[(y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)] === 1
  }
  let refreshedAt = 0
  let terrain: Terrain | undefined
  let key = ''
  let dirty = false
  let savedAt = 0
  // The way into the dungeon, and the camps as the seed grew them (each camp's mark is where what keeps it stands: as it
  // is now on ground the page has loaded, see `marks`).
  let landmarks: Array<{ x: number; y: number; kind: 'camp' | 'goblins' | 'tomb' | 'dungeon' }> = []
  let seedCamps: ReadonlyArray<{ x: number; y: number; kind: BuildingKind }> = []
  let fogLifted = false
  // How far the view has been dragged from round the player (tiles), the drag going on, and how far it is zoomed
  // (times PX pixels a tile).
  let pan = { x: 0, y: 0 }
  let zoom = 1
  let dragging: { id: number; x: number; y: number } | undefined

  const regionAt = (rx: number, ry: number, make: boolean): Region | undefined => {
    const name = `${rx},${ry}`
    let region = regions.get(name)
    if (!region && make) {
      const picture = document.createElement('canvas')
      picture.width = REGION * PX
      picture.height = REGION * PX
      const paint = picture.getContext('2d')!
      region = { rx, ry, explored: new Uint8Array(REGION_BYTES), picture, paint, image: paint.createImageData(REGION * PX, REGION * PX), changed: false }
      regions.set(name, region)
    }
    return region
  }
  // Whether a cell (by its place in its region, 0 to REGION_CELLS - 1 each way) is explored.
  const isCellExplored = (region: Region, cx: number, cy: number): boolean => {
    const index = cy * REGION_CELLS + cx
    return (region.explored[index >> 3] & (1 << (index & 7))) !== 0
  }

  const save = (): void => {
    if (!key || !dirty) return
    dirty = false
    try {
      const kept: Record<string, string> = {}
      for (const [name, region] of regions) {
        let text = ''
        for (let i = 0; i < region.explored.length; i++) text += String.fromCharCode(region.explored[i])
        kept[name] = btoa(text)
      }
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(kept))
    } catch {
      // Storage off or full: the map is kept for this visit only.
    }
  }

  // What stands on a tile: as it is now in a loaded chunk, else as the seed grew it.
  const thingAt = (x: number, y: number): BuildingKind | undefined => {
    const cx = floorDiv(x, CHUNK_SIZE)
    const cy = floorDiv(y, CHUNK_SIZE)
    const id = chunkId(cx, cy)
    const tile = x - cx * CHUNK_SIZE + (y - cy * CHUNK_SIZE) * CHUNK_SIZE
    const now = live.get(id)
    if (now) return now.get(tile)
    let seeded = grown.get(id)
    if (!seeded) {
      seeded = new Map()
      for (const plant of plantsInChunk(terrain!, cx, cy)) seeded.set(plant.x - cx * CHUNK_SIZE + (plant.y - cy * CHUNK_SIZE) * CHUNK_SIZE, plant.kind)
      grown.set(id, seeded)
    }
    return seeded.get(tile)
  }

  // Paints a cell's tiles onto its region's picture: the ground, and what stands on it.
  const paintCell = (region: Region, cx: number, cy: number): void => {
    if (!terrain) return
    const data = region.image.data
    const stride = region.image.width
    for (let ty = 0; ty < CELL; ty++) {
      for (let tx = 0; tx < CELL; tx++) {
        const lx = cx * CELL + tx
        const ly = cy * CELL + ty
        const x = region.rx * REGION + lx
        const y = region.ry * REGION + ly
        const fogged = !fogLifted && isFoggedAt(terrain, x, y)
        const ground = fogged ? FOG : tileColor(terrain, x, y, shelfAt)
        const kind = fogged ? undefined : thingAt(x, y)
        const glyph = kind === undefined || UNDRAWN.has(kind) ? undefined : (GLYPHS[kind] ?? BUILT)
        for (let py = 0; py < PX; py++) {
          for (let px = 0; px < PX; px++) {
            const letter = glyph?.rows[py][px]
            const color = glyph && letter && letter !== '.' ? glyph.colors[letter] : ground
            const at = ((ly * PX + py) * stride + lx * PX + px) * 4
            data[at] = color[0]
            data[at + 1] = color[1]
            data[at + 2] = color[2]
            data[at + 3] = 255
          }
        }
      }
    }
    region.changed = true
  }

  // Puts what has been painted onto the regions' pictures.
  const flush = (): void => {
    for (const region of regions.values()) {
      if (!region.changed) continue
      region.paint.putImageData(region.image, 0, 0)
      region.changed = false
    }
  }

  // What stands in the loaded chunks now, and their explored cells painted again with it.
  const refresh = (frame: MapFrame): void => {
    live.clear()
    for (const id of frame.loadedChunks) {
      const tiles = new Map<number, BuildingKind>()
      const { cx, cy } = chunkCoords(id)
      for (const thing of frame.things(id)) {
        const tile = thing.x - cx * CHUNK_SIZE + (thing.y - cy * CHUNK_SIZE) * CHUNK_SIZE
        // A floor shows only where nothing stands on it.
        if (isFloorKind(thing.kind) && tiles.has(tile)) continue
        tiles.set(tile, thing.kind)
      }
      live.set(id, tiles)
    }
    for (const id of frame.loadedChunks) {
      const { cx, cy } = chunkCoords(id)
      for (let y = cy * CHUNK_SIZE; y < (cy + 1) * CHUNK_SIZE; y += CELL) {
        for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x += CELL) {
          const region = regionAt(floorDiv(x, REGION), floorDiv(y, REGION), false)
          if (!region) continue
          const lx = (x - region.rx * REGION) / CELL
          const ly = (y - region.ry * REGION) / CELL
          if (isCellExplored(region, lx, ly)) paintCell(region, lx, ly)
        }
      }
    }
    flush()
  }

  const start = (next: Terrain, nextKey: string, lifted: boolean): void => {
    terrain = next
    key = nextKey
    fogLifted = lifted
    regions.clear()
    shelves.clear()
    grown.clear()
    live.clear()
    try {
      const text = localStorage.getItem(STORAGE_PREFIX + key)
      // Kept by region (an older map, kept as one block for a world with edges, is dropped).
      const kept = text?.startsWith('{') ? (JSON.parse(text) as Record<string, string>) : {}
      for (const [name, bits] of Object.entries(kept)) {
        const [rx, ry] = name.split(',').map(Number)
        const bytes = atob(bits)
        if (!Number.isInteger(rx) || !Number.isInteger(ry) || bytes.length !== REGION_BYTES) continue
        const region = regionAt(rx, ry, true)!
        for (let i = 0; i < bytes.length; i++) region.explored[i] = bytes.charCodeAt(i)
        for (let cy = 0; cy < REGION_CELLS; cy++) for (let cx = 0; cx < REGION_CELLS; cx++) if (isCellExplored(region, cx, cy)) paintCell(region, cx, cy)
      }
    } catch {
      // Nothing kept: it starts unexplored.
    }
    flush()
    const entrance = dungeonEntrance(next)
    landmarks = entrance ? [{ ...entrance, kind: 'dungeon' as const }] : []
    seedCamps = grownCamps(next)
  }

  // Every mark on the map: the way into the dungeon, and each camp (its tent, lean-to or tomb) as the seed grew it, or,
  // on ground the page has loaded, as it stands now (one broken is gone; one put down is there). The goblins' camps and
  // the mummies' tombs are under the fog until the player has truesight.
  const CAMP_MARK = { 'skeleton-camp': 'camp', 'goblin-camp': 'goblins', tomb: 'tomb' } as const
  const marks = (): Array<{ x: number; y: number; kind: 'camp' | 'goblins' | 'tomb' | 'dungeon' }> => {
    const found = [...landmarks]
    const camp = (x: number, y: number, kind: BuildingKind): void => {
      if (!isCampKind(kind) || (kind !== 'skeleton-camp' && !fogLifted)) return
      found.push({ x, y, kind: CAMP_MARK[kind] })
    }
    for (const grown of seedCamps) if (!live.has(chunkOfTile(grown.x, grown.y))) camp(grown.x, grown.y, grown.kind)
    for (const [id, tiles] of live) {
      const { cx, cy } = chunkCoords(id)
      for (const [tile, kind] of tiles) camp(cx * CHUNK_SIZE + (tile % CHUNK_SIZE), cy * CHUNK_SIZE + Math.floor(tile / CHUNK_SIZE), kind)
    }
    return found
  }

  // Explores the cells round a point (tiles): every one any of which a screen centred there shows (see REVEAL).
  const reveal = (x: number, y: number): void => {
    for (let cy = Math.floor((y - REVEAL.y) / CELL); cy <= Math.floor((y + REVEAL.y) / CELL); cy++) {
      for (let cx = Math.floor((x - REVEAL.x) / CELL); cx <= Math.floor((x + REVEAL.x) / CELL); cx++) {
        const region = regionAt(floorDiv(cx, REGION_CELLS), floorDiv(cy, REGION_CELLS), true)!
        const lx = cx - region.rx * REGION_CELLS
        const ly = cy - region.ry * REGION_CELLS
        if (isCellExplored(region, lx, ly)) continue
        const index = ly * REGION_CELLS + lx
        region.explored[index >> 3] |= 1 << (index & 7)
        paintCell(region, lx, ly)
        dirty = true
      }
    }
  }

  const isExplored = (x: number, y: number): boolean => {
    const region = regionAt(floorDiv(x, REGION), floorDiv(y, REGION), false)
    return region !== undefined && isCellExplored(region, Math.floor((x - region.rx * REGION) / CELL), Math.floor((y - region.ry * REGION) / CELL))
  }

  const draw = (frame: MapFrame): void => {
    canvas.width = Math.max(200, Math.round(container.clientWidth * 0.8))
    canvas.height = Math.max(200, Math.round(container.clientHeight * 0.75))
    // PX pixels a tile, so what stands on the ground can be made out; round the player, or wherever it is dragged to
    // (the world goes on every way, so there are no edges to stop at).
    const scale = PX * zoom
    const ox = (frame.me.x + pan.x) * scale - canvas.width / 2
    const oy = (frame.me.y + pan.y) * scale - canvas.height / 2
    // Zoomed out, the pictures are smoothed rather than losing whole rows of pixels.
    context.imageSmoothingEnabled = zoom < 1
    zoomText.textContent = `${Math.round(zoom * 100)}%`
    zoomOut.disabled = zoom <= ZOOM_MIN
    zoomIn.disabled = zoom >= ZOOM_MAX
    // Unexplored: dark fog; explored: the ground.
    context.fillStyle = '#0d1218'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const span = REGION * scale
    for (let ry = Math.floor(oy / span); ry <= Math.floor((oy + canvas.height) / span); ry++) {
      for (let rx = Math.floor(ox / span); rx <= Math.floor((ox + canvas.width) / span); rx++) {
        const region = regionAt(rx, ry, false)
        if (region) context.drawImage(region.picture, Math.floor(rx * span - ox), Math.floor(ry * span - oy), Math.ceil(span) + 1, Math.ceil(span) + 1)
      }
    }
    const at = (x: number, y: number): [number, number] => [x * scale - ox, y * scale - oy]
    for (const mark of marks()) {
      if (!isExplored(mark.x, mark.y)) continue
      const [px, py] = at(mark.x + 0.5, mark.y + 0.5)
      context.fillStyle = mark.kind === 'camp' ? '#d9483b' : mark.kind === 'goblins' ? '#7fae3a' : mark.kind === 'tomb' ? '#d9b56a' : '#9fd6ff'
      context.strokeStyle = '#0d1218'
      context.lineWidth = 2
      context.beginPath()
      if (mark.kind !== 'dungeon') context.arc(px, py, 5, 0, Math.PI * 2)
      else context.rect(px - 5, py - 5, 10, 10)
      context.fill()
      context.stroke()
    }
    context.font = '12px sans-serif'
    context.textAlign = 'center'
    for (const other of frame.others) {
      const [px, py] = at(other.x, other.y)
      context.fillStyle = '#ffd25a'
      context.beginPath()
      context.arc(px, py, 5, 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = '#0d1218'
      context.stroke()
      context.fillStyle = '#ffffff'
      context.fillText(other.name, px, py - 9)
    }
    if (!frame.away) {
      // You: an arrow the way you face.
      const [px, py] = at(frame.me.x, frame.me.y)
      context.save()
      context.translate(px, py)
      context.rotate(frame.me.facing)
      context.fillStyle = '#ffffff'
      context.strokeStyle = '#0d1218'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(9, 0)
      context.lineTo(-6, 6)
      context.lineTo(-3, 0)
      context.lineTo(-6, -6)
      context.closePath()
      context.fill()
      context.stroke()
      context.restore()
    }
    note.textContent = frame.away ? 'You are in the ice crypt, off the map.' : 'Explore to fill in the map. Drag to look around, scroll to zoom. M to close.'
  }

  // Dragging the map with the left button looks around it.
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY }
    canvas.setPointerCapture(event.pointerId)
    canvas.classList.add('is-panning')
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== dragging.id) return
    // The canvas may be drawn bigger or smaller than its pixels.
    const ratio = canvas.width / Math.max(1, canvas.clientWidth)
    const scale = PX * zoom
    pan = { x: pan.x - ((event.clientX - dragging.x) * ratio) / scale, y: pan.y - ((event.clientY - dragging.y) * ratio) / scale }
    dragging = { ...dragging, x: event.clientX, y: event.clientY }
    if (last) draw(last)
  })
  const endDrag = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== dragging.id) return
    dragging = undefined
    canvas.classList.remove('is-panning')
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  // Zooms by `factor`, keeping the spot under `at` (canvas pixels; the middle if not given) where it is.
  const zoomBy = (factor: number, at?: { x: number; y: number }): void => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor))
    if (next === zoom) return
    const px = (at?.x ?? canvas.width / 2) - canvas.width / 2
    const py = (at?.y ?? canvas.height / 2) - canvas.height / 2
    // The tile under the point stays under it: pan + p / (PX * zoom) is the same before and after.
    pan = { x: pan.x + px / (PX * zoom) - px / (PX * next), y: pan.y + py / (PX * zoom) - py / (PX * next) }
    zoom = next
    if (last) draw(last)
  }
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.deltaY === 0) return
      const rect = canvas.getBoundingClientRect()
      const ratio = canvas.width / Math.max(1, rect.width)
      // A notch (about 100 pixels) a step; a trackpad's small scrolls a little at a time.
      // (Some browsers count in lines, about 33 pixels each, or pages.)
      const pixels = event.deltaY * (event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1)
      const notches = Math.max(-3, Math.min(3, -pixels / 100))
      zoomBy(ZOOM_STEP ** notches, { x: (event.clientX - rect.left) * ratio, y: (event.clientY - rect.top) * ratio })
    },
    { passive: false },
  )
  for (const [button, factor] of [[zoomIn, ZOOM_STEP], [zoomOut, 1 / ZOOM_STEP]] as const) {
    button.addEventListener('pointerdown', (event) => event.stopPropagation())
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      zoomBy(factor)
    })
  }
  canvas.addEventListener('dblclick', () => {
    pan = { x: 0, y: 0 }
    if (last) draw(last)
  })

  let open = false
  let last: MapFrame | undefined
  return {
    get isOpen() {
      return open
    },
    toggle() {
      open = !open
      root.hidden = !open
      pan = { x: 0, y: 0 }
      if (open && last) {
        refresh(last)
        draw(last)
      }
    },
    close() {
      open = false
      root.hidden = true
    },
    update(frame) {
      last = frame
      if (frame.terrain !== terrain || frame.key !== key || frame.fogLifted !== fogLifted) {
        save()
        start(frame.terrain, frame.key, frame.fogLifted)
      }
      const now = performance.now()
      if (now - refreshedAt > REFRESH_MS) {
        refreshedAt = now
        refresh(frame)
      }
      if (!frame.away) reveal(frame.me.x, frame.me.y)
      flush()
      if (dirty && now - savedAt > SAVE_EVERY_MS) {
        savedAt = now
        save()
      }
      if (open) draw(frame)
    },
    dispose() {
      save()
      root.remove()
    },
  }
}

// The colour of a tile on the map (`shelfAt`: whether a sea tile is on the shelf, as the ground is drawn).
function tileColor(terrain: Terrain, x: number, y: number, shelfAt: (x: number, y: number) => boolean): Rgb {
  if (isSeaAt(terrain, x, y)) return shelfAt(x, y) ? SEA_SHELF : SEA_DEEP
  if (waterAt(terrain, x, y)) return POND
  const biome = biomeAt(terrain, x, y)
  // Snow where the ground's picture has it (see ground-colors.ts), its line as bumpy.
  if (biome?.key === 'mountain') return snowOnTile(terrain, x, y) ? SNOW : ROCK
  if (biome?.ground === 'sand') return SAND
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isSeaAt(terrain, x + dx, y + dy)) return SAND
  return biome?.key === 'meadow' ? MEADOW : GRASS
}
