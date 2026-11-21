// The dungeon: an ice crypt deep in the mountains' snow (its way in is a landmark of the terrain, see `dungeonEntrance` in
// terrain.ts), where skeletons guard a chest. It is instanced: whoever goes in gets a copy of their own (or joins the
// copy someone is already in), so each copy is fought through from the start, and is cleared away once nobody is in it.
//
// The copies are laid out side by side in a corner of the world far out at sea (DUNGEON_ORIGIN, a grid of
// DUNGEON_GRID by DUNGEON_GRID slots DUNGEON_SPACING tiles apart, each copy in the middle of its slot, far enough from
// the next that a page in one is never sent what is in another), where nobody can walk to: players only get there
// through the way in, and back through the stairs out. Each copy is the same layout, below. Like the rest of the
// ground, it is worked out from the tile alone, the same on the server and every page: its floor can be walked on, and
// its walls (and the solid rock round them) cannot.

// The layout. '.' is floor, '#' rock, 'S' where a player arrives, 'E' the stairs out, 'k' a skeleton, 'a' a skeleton archer, and at the top the
// boss's hall (see `bossHall`): a great round chamber with the frost lich ('M') in its middle, its chest ('C') at the
// back, and one doorway in ('D'), which an ice door seals once a player walks into the hall (see dungeons.ts). Rows
// shorter than the longest are filled out with rock.
// The frost lich's wave of cold air (see dungeons.ts on the server): how fast it rolls out, and how far (tiles).
export const WAVE_SPEED = 9
export const WAVE_RADIUS = 6.5

const BOSS_HALL_RADIUS = 11.4
const BELOW_HALL = [
  '##############D#################',
  '############.....###############',
  '####.......................#####',
  '###.....k....a.....k........####',
  '###.........................####',
  '####.......................#####',
  '######...#########....##########',
  '######...#########....##########',
  '#####.....#######......#########',
  '#####..a..#######...k..#########',
  '#####.....#######......#########',
  '######...########......#########',
  '######.S.#######################',
  '######.E.#######################',
  '################################',
]

// The hall: a disc of floor BOSS_HALL_RADIUS tiles round its middle, above the doorway (whose column is the middle's).
function bossHall(): string[] {
  const width = BELOW_HALL[0].length
  const middleX = BELOW_HALL[0].indexOf('D')
  const radius = BOSS_HALL_RADIUS
  const rows = Math.ceil(radius * 2) + 2
  const middleY = rows - 1 - radius
  const hall: string[] = []
  for (let y = 0; y < rows; y++) {
    let row = ''
    for (let x = 0; x < width; x++) {
      const inside = (x - middleX) ** 2 + (y - middleY) ** 2 <= radius * radius && y > 0
      row += inside ? '.' : '#'
    }
    hall.push(row)
  }
  // The lich in the middle, its chest at the back.
  const set = (x: number, y: number, mark: string): void => {
    hall[y] = hall[y].slice(0, x) + mark + hall[y].slice(x + 1)
  }
  set(middleX, Math.round(middleY), 'M')
  set(middleX, Math.round(middleY - radius + 2), 'C')
  // Its bottom row opens onto the doorway.
  set(middleX, rows - 1, '.')
  return hall
}

const LAYOUT = [...bossHall(), ...BELOW_HALL]

export type DungeonPart = 'floor' | 'wall' | 'void'
type Point = { x: number; y: number }

const WIDTH = Math.max(...LAYOUT.map((row) => row.length))
const HEIGHT = LAYOUT.length

function cell(x: number, y: number): string {
  return LAYOUT[y]?.[x] ?? '#'
}

function find(mark: string): Point[] {
  const found: Point[] = []
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) if (cell(x, y) === mark) found.push({ x, y })
  return found
}

// Each tile of the layout: floor; rock beside floor (a wall, drawn as one); or rock further in (solid, and dark).
const PARTS: DungeonPart[] = []
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    if (cell(x, y) !== '#') {
      PARTS.push('floor')
      continue
    }
    let wall = false
    for (let oy = -1; oy <= 1 && !wall; oy++) for (let ox = -1; ox <= 1 && !wall; ox++) if (cell(x + ox, y + oy) !== '#' && x + ox >= 0 && y + oy >= 0 && x + ox < WIDTH && y + oy < HEIGHT) wall = true
    PARTS.push(wall ? 'wall' : 'void')
  }
}

// Where things are in a copy, in tiles from its top left corner.
export const DUNGEON_LAYOUT: Readonly<{ width: number; height: number; start: Point; exit: Point; chest: Point; guards: readonly Point[]; archers: readonly Point[]; boss: Point; door: Point }> = {
  width: WIDTH,
  height: HEIGHT,
  start: find('S')[0],
  exit: find('E')[0],
  chest: find('C')[0],
  guards: find('k'),
  archers: find('a'),
  boss: find('M')[0],
  door: find('D')[0],
}

// Whether a tile of a copy is in its boss's hall (the floor above the doorway).
export function inBossHall(slot: number, x: number, y: number): boolean {
  const corner = dungeonCorner(slot)
  const lx = x - corner.x
  const ly = y - corner.y
  return lx >= 0 && lx < WIDTH && ly >= 0 && ly < DUNGEON_LAYOUT.door.y && cell(lx, ly) !== '#'
}

// Where the copies are: the top left tile of slot 0, how far apart the slots are, and how many there are each way.
export const DUNGEON_ORIGIN: Readonly<Point> = { x: -1000, y: -1000 }
export const DUNGEON_SPACING = 128
export const DUNGEON_GRID = 3
const MARGIN = Math.floor((DUNGEON_SPACING - Math.max(WIDTH, HEIGHT)) / 2)
// How far round the dungeons' corner the ground is drawn as solid rock, so the sea is never seen from inside.
export const DUNGEON_DARK_PAD = 48
export const DUNGEON_SLOTS = DUNGEON_GRID * DUNGEON_GRID
// The air inside, in °C: a crypt of ice, colder even than the mountains' heart outside.
export const DUNGEON_AIR = -40

// The slot a tile is in, if it is in the dungeons' corner of the world.
export function dungeonSlotAt(x: number, y: number): number | undefined {
  const sx = Math.floor((x - DUNGEON_ORIGIN.x) / DUNGEON_SPACING)
  const sy = Math.floor((y - DUNGEON_ORIGIN.y) / DUNGEON_SPACING)
  if (sx < 0 || sy < 0 || sx >= DUNGEON_GRID || sy >= DUNGEON_GRID) return undefined
  return sy * DUNGEON_GRID + sx
}

export function isInDungeons(x: number, y: number): boolean {
  return dungeonSlotAt(x, y) !== undefined
}

// The top left tile of a slot's copy.
export function dungeonCorner(slot: number): Point {
  return {
    x: DUNGEON_ORIGIN.x + (slot % DUNGEON_GRID) * DUNGEON_SPACING + MARGIN,
    y: DUNGEON_ORIGIN.y + Math.floor(slot / DUNGEON_GRID) * DUNGEON_SPACING + MARGIN,
  }
}

// Whether a tile is drawn as the dungeons' rock: in their corner, or within DUNGEON_DARK_PAD tiles of it.
export function inDungeonDark(x: number, y: number): boolean {
  const span = DUNGEON_GRID * DUNGEON_SPACING
  return (
    x >= DUNGEON_ORIGIN.x - DUNGEON_DARK_PAD &&
    y >= DUNGEON_ORIGIN.y - DUNGEON_DARK_PAD &&
    x < DUNGEON_ORIGIN.x + span + DUNGEON_DARK_PAD &&
    y < DUNGEON_ORIGIN.y + span + DUNGEON_DARK_PAD
  )
}

// What a tile of the dungeons' corner is (undefined outside it): floor, wall, or solid rock (all of a slot outside its
// copy's layout is rock).
export function dungeonPartAt(x: number, y: number): DungeonPart | undefined {
  const slot = dungeonSlotAt(x, y)
  if (slot === undefined) return undefined
  const corner = dungeonCorner(slot)
  const lx = x - corner.x
  const ly = y - corner.y
  if (lx < 0 || ly < 0 || lx >= WIDTH || ly >= HEIGHT) return 'void'
  return PARTS[ly * WIDTH + lx]
}

// Whether a tile of the dungeons cannot be walked into (wall or rock). False outside them.
export function dungeonBlocks(x: number, y: number): boolean {
  const part = dungeonPartAt(x, y)
  return part !== undefined && part !== 'floor'
}

// A point of a slot's layout, as a world tile.
export function dungeonTile(slot: number, at: Point): Point {
  const corner = dungeonCorner(slot)
  return { x: corner.x + at.x, y: corner.y + at.y }
}
