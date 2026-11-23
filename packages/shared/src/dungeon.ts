// The dungeon: an ice crypt deep in the mountains' snow (its way in is a landmark of the terrain, see `dungeonEntrance`
// in terrain.ts), fought through room by room to the frost lich's hall. It is instanced: whoever goes in gets a copy of
// their own (or joins the copy someone is already in), so each copy is fought through from the start, and is cleared
// away once nobody is in it.
//
// The copies are laid out side by side in a far corner of the world, further out at sea than anyone could sail
// (DUNGEON_ORIGIN, near the world's edge: see WORLD_RADIUS_CHUNKS; a grid of
// DUNGEON_GRID by DUNGEON_GRID slots DUNGEON_SPACING tiles apart, each copy in the middle of its slot, far enough from
// the next that a page in one is never sent what is in another), where nobody can walk to: players only get there
// through the way in, and back through the stairs out. Each copy is the same layout, below. Like the rest of the
// ground, it is worked out from the tile alone, the same on the server and every page: its floor can be walked on, and
// its walls (and the solid rock round them) cannot.

// The layout, drawn by hand (edit it to change the dungeon). From the stairs at the bottom, the way goes through every
// room in turn: the guard room, the archery, the crypt, then through the door to the frost lich's rooms. Each room's
// guards stand in it, and the rooms are far enough apart that no guard notices a player in another room (a skeleton
// notices within its `aggroRadius`, see monsters.json; tests/dungeon.test.ts checks it).
//
//   '#' rock                     '.' floor
//   'S' where a player arrives   'E' the stairs out
//   'k' a skeleton               'a' a skeleton archer
//   'x' spikes in the floor      '<' '>' '^' 'v' spikes in a wall, shooting that way across the floor beside it
//   'D' the door to the frost lich's rooms: shut until every guard in the copy is dead (see dungeons.ts)
//   ',' the waiting room          '=' the line across the mouth of the lich's hall: whoever crosses it starts the fight
//
// The lich's hall itself, above all this, is a great round chamber made by `bossHall`, with the lich ('M') in its
// middle, its chest ('C') against the wall at the top, and beside the chest, set into that wall, a second way out ('X'),
// so nobody has to walk all the way back: sealed with ice until the lich falls (see dungeons.ts). Rows shorter than the longest are filled out with rock.
export const BOSS_HALL_RADIUS = 11.4
const BELOW_HALL = [
  '############################===###########################',
  '############################,,,###########################',
  '#########################,,,,,,,,,########################',
  '#########################,,,,,,,,,########################',
  '#########################,,,,,,,,,########################',
  '#########################,,,,,,,,,########################',
  '#########################,,,,,,,,,########################',
  '#############################D############################',
  '############################...###########################',
  '############################...###########################',
  '############################...###########################',
  '####################...................###################',
  '####################.....a.......a.....###################',
  '####################........xxx........###################',
  '####################.##.............##.###################',
  '####################.##....k........##.###################',
  '####################...........k.......###################',
  '####################...................###################',
  '####################...................###################',
  '####################...................###################',
  '#######################...################################',
  '#######################...################################',
  '#######################...################################',
  '#######################...################################',
  '#######################xxx################################',
  '#######################...################################',
  '#######################...################################',
  '######################>...################################',
  '#######################...################################',
  '#######################...################################',
  '#######################...################################',
  '#################...................######################',
  '#################....a........a.....######################',
  '#################...................######################',
  '#################........k..........######################',
  '#################...................######################',
  '#################.xx................######################',
  '#################...................######################',
  '###############################...########################',
  '###############################...########################',
  '###############################...########################',
  '###############################...########################',
  '###############################...########################',
  '###############################...########################',
  '###############################...########################',
  '###############################...########################',
  '##########################...................#############',
  '##########################...................#############',
  '##########################....k.......k......#############',
  '##########################...................#############',
  '##########################...................#############',
  '##########################........k..........#############',
  '##########################................xx.#############',
  '##########################................xx.#############',
  '#########################################...##############',
  '#########################################xxx##############',
  '#########################################...##############',
  '#########################################...##############',
  '#######################################........###########',
  '#######################################...S....###########',
  '#######################################........###########',
  '#######################################...E....###########',
  '##########################################################',
]

// The hall: a disc of floor BOSS_HALL_RADIUS tiles round its middle, which is over the middle of the line ('='), its
// bottom open onto the line.
function bossHall(): string[] {
  const width = BELOW_HALL[0].length
  const middleX = BELOW_HALL[0].indexOf('=') + 1
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
  const set = (x: number, y: number, mark: string): void => {
    hall[y] = hall[y].slice(0, x) + mark + hall[y].slice(x + 1)
  }
  set(middleX, Math.round(middleY), 'M')
  // The chest against the wall at the very top of the hall, and the way out cut into the wall beside it (a notch of
  // floor in the rock, the stairs going up into it).
  const top = hall.findIndex((row) => row[middleX] === '.')
  set(middleX, top, 'C')
  set(middleX - 1, top - 1, 'X')
  for (let x = middleX - 1; x <= middleX + 1; x++) set(x, rows - 1, '.')
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

// Spikes in a wall, by the way they shoot.
const WALL_SPIKES: Readonly<Record<string, Point>> = { '<': { x: -1, y: 0 }, '>': { x: 1, y: 0 }, '^': { x: 0, y: -1 }, v: { x: 0, y: 1 } }
// How far across the floor spikes from a wall reach, in tiles.
const WALL_SPIKE_REACH = 3

function isRock(mark: string): boolean {
  return mark === '#' || WALL_SPIKES[mark] !== undefined
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
    if (!isRock(cell(x, y))) {
      PARTS.push('floor')
      continue
    }
    let wall = false
    for (let oy = -1; oy <= 1 && !wall; oy++) {
      for (let ox = -1; ox <= 1 && !wall; ox++) {
        if (x + ox >= 0 && y + oy >= 0 && x + ox < WIDTH && y + oy < HEIGHT && !isRock(cell(x + ox, y + oy))) wall = true
      }
    }
    PARTS.push(wall ? 'wall' : 'void')
  }
}

// Where things are in a copy, in tiles from its top left corner. `line` is the row of the line across the mouth of the
// lich's hall.
export const DUNGEON_LAYOUT: Readonly<{
  width: number
  height: number
  start: Point
  exit: Point
  hallExit: Point
  chest: Point
  boss: Point
  door: Point
  line: number
  guards: readonly Point[]
  archers: readonly Point[]
}> = {
  width: WIDTH,
  height: HEIGHT,
  start: find('S')[0],
  exit: find('E')[0],
  hallExit: find('X')[0],
  chest: find('C')[0],
  boss: find('M')[0],
  door: find('D')[0],
  line: find('=')[0].y,
  guards: find('k'),
  archers: find('a'),
}

// The spike traps (see dungeons.ts): each one some tiles of floor (in a copy, from its top left corner), all of which
// go off together when a player steps on any of them; spikes in a wall (`wall`, those tiles, and `dir` the way they
// shoot) cover the floor beside it, up to WALL_SPIKE_REACH tiles across. Spikes in the floor next to each other are one
// trap, and so are spikes side by side in a wall shooting the same way.
export type DungeonTrap = { tiles: readonly Point[]; wall?: { tiles: readonly Point[]; dir: Point } }
export const DUNGEON_TRAPS: readonly DungeonTrap[] = findTraps()
// Which trap each tile of the layout is part of (its floor, or the wall it shoots from), by its index; -1 for none.
const TRAP_AT = new Int16Array(WIDTH * HEIGHT).fill(-1)
DUNGEON_TRAPS.forEach((trap, index) => {
  for (const tile of [...trap.tiles, ...(trap.wall?.tiles ?? [])]) TRAP_AT[tile.y * WIDTH + tile.x] = index
})

function findTraps(): DungeonTrap[] {
  const traps: DungeonTrap[] = []
  const done = new Set<number>()
  // Tiles of the same mark joined side by side.
  const group = (x: number, y: number, mark: string): Point[] => {
    const tiles: Point[] = []
    const queue: Point[] = [{ x, y }]
    done.add(y * WIDTH + x)
    while (queue.length > 0) {
      const at = queue.shift()!
      tiles.push(at)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = at.x + dx
        const ny = at.y + dy
        if (cell(nx, ny) !== mark || done.has(ny * WIDTH + nx)) continue
        done.add(ny * WIDTH + nx)
        queue.push({ x: nx, y: ny })
      }
    }
    return tiles.sort((a, b) => a.y - b.y || a.x - b.x)
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const mark = cell(x, y)
      if (done.has(y * WIDTH + x)) continue
      if (mark === 'x') traps.push({ tiles: group(x, y, mark) })
      const dir = WALL_SPIKES[mark]
      if (!dir) continue
      const wall = group(x, y, mark)
      const tiles: Point[] = []
      for (const from of wall) {
        for (let step = 1; step <= WALL_SPIKE_REACH; step++) {
          const tx = from.x + dir.x * step
          const ty = from.y + dir.y * step
          if (isRock(cell(tx, ty))) break
          tiles.push({ x: tx, y: ty })
        }
      }
      traps.push({ tiles, wall: { tiles: wall, dir } })
    }
  }
  return traps
}

// Where a tile is in its copy (from the copy's top left corner), if it is in one.
function local(x: number, y: number): (Point & { slot: number }) | undefined {
  const slot = dungeonSlotAt(x, y)
  if (slot === undefined) return undefined
  const corner = dungeonCorner(slot)
  const lx = x - corner.x
  const ly = y - corner.y
  return lx >= 0 && ly >= 0 && lx < WIDTH && ly < HEIGHT ? { x: lx, y: ly, slot } : undefined
}

// The trap a tile is part of (its floor, or the wall its spikes shoot from), by its index in DUNGEON_TRAPS.
export function dungeonTrapAt(x: number, y: number): number | undefined {
  const at = local(x, y)
  const index = at ? TRAP_AT[at.y * WIDTH + at.x] : -1
  return index >= 0 ? index : undefined
}

// What is marked on a tile of floor, for drawing it: the line across the hall's mouth, the waiting room, or nothing.
export function dungeonMarkAt(x: number, y: number): 'line' | 'waiting' | undefined {
  const at = local(x, y)
  const mark = at ? cell(at.x, at.y) : '#'
  return mark === '=' ? 'line' : mark === ',' ? 'waiting' : undefined
}

// Whether a tile of a copy is in its lich's hall (the floor above the line), or anywhere in the lich's rooms (the hall,
// the line, and the waiting room).
export function inBossHall(slot: number, x: number, y: number): boolean {
  const corner = dungeonCorner(slot)
  const lx = x - corner.x
  const ly = y - corner.y
  return lx >= 0 && lx < WIDTH && ly >= 0 && ly < DUNGEON_LAYOUT.line && !isRock(cell(lx, ly))
}
export function inBossRooms(slot: number, x: number, y: number): boolean {
  const corner = dungeonCorner(slot)
  const mark = cell(x - corner.x, y - corner.y)
  return mark === '=' || mark === ',' || inBossHall(slot, x, y)
}

// Where the copies are: the top left tile of slot 0, how far apart the slots are, and how many there are each way.
export const DUNGEON_ORIGIN: Readonly<Point> = { x: -31_000, y: -31_000 }
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

// The top left tile of a slot's copy (worked out once a slot: walking and drawing ask for it all the time).
const CORNERS: ReadonlyArray<Readonly<Point>> = Array.from({ length: DUNGEON_SLOTS }, (_, slot) => ({
  x: DUNGEON_ORIGIN.x + (slot % DUNGEON_GRID) * DUNGEON_SPACING + MARGIN,
  y: DUNGEON_ORIGIN.y + Math.floor(slot / DUNGEON_GRID) * DUNGEON_SPACING + MARGIN,
}))
export function dungeonCorner(slot: number): Readonly<Point> {
  return CORNERS[slot]
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
