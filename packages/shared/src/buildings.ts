import buildingsData from '../../../data/buildings.json' with { type: 'json' }
import { failIn, fieldsOf, onlyFields, wholeField } from './data-check.ts'

// Everything that stands on a tile: the factory's buildings; what is found in the world (trees, bushes, rocks, grass,
// flint, and the saplings and berry sprouts planted from acorns and berries; on the meadow sunflowers, clay, copper rocks
// and beehives; in the desert cacti, sand and tin rocks; the cobwebs spiders spin); what players put up (fences, gates,
// the stations and machines, garden plots, feed boxes, sleeping bags, bee boxes); and the dungeon's ice door. Each
// takes one tile.
export type BuildingKind =
  | 'miner'
  | 'extractor'
  | 'belt'
  | 'chest'
  | 'tree'
  | 'bush'
  | 'sapling'
  | 'sprout'
  | 'rock'
  | 'grass'
  | 'fence'
  | 'gate'
  | 'stump'
  | 'plot'
  | 'feeder'
  | 'workbench'
  | 'campfire'
  | 'oven'
  | 'barrel'
  | 'rack'
  | 'loose'
  | 'bed'
  | 'door'
  | 'well'
  | 'altar'
  | 'pedestal'
  | 'waystone'
  | 'worker'
  | 'dummy'
  | 'sunflower'
  | 'seedling'
  | 'clay'
  | 'copper-rock'
  | 'tin-rock'
  | 'cactus'
  | 'sand'
  | 'cobweb'
  | 'hive'
  | 'beebox'

export type BuildingDef = {
  kind: BuildingKind
  // Its number in a chunk's hash, so a kind never hashes the same as another.
  code: number
  name: string
  // One line on what it does.
  description: string
  // Whether the way it faces matters (belts and extractors carry items that way).
  rotatable: boolean
  // Whether it has an inventory a player can open.
  hasInventory: boolean
  // Whether a player can put items into it by hand.
  acceptsDeposits: boolean
  // Whether players walk into it rather than over it.
  solid: boolean
  // Whether animals cannot walk through it (anything solid, and fences; a gate only while it is shut).
  blocksAnimals: boolean
  // Whether players walking through it are slowed (to BUSH_SPEED_PERCENT).
  slowsPlayers: boolean
  // A plant or a rock: it is found in the world rather than being built, and is punched to break it.
  natural: boolean
  // Something a player put down from an item (see `places` in items.json): hitting it with an axe takes it down, and
  // gives the item back, with whatever was in it. A fist does nothing to it.
  breakable: boolean
  // How much hitting it takes to break (see `resourceDamage` in weapons.ts for how much each hit does; 0 for the
  // factory's buildings, which are not hit). From data/buildings.json (see HP_FROM_DATA).
  maxHp: number
}

type Flags = Omit<BuildingDef, 'kind' | 'code' | 'name' | 'description'>
const FACTORY: Flags = {
  rotatable: false,
  hasInventory: false,
  acceptsDeposits: false,
  solid: false,
  blocksAnimals: false,
  slowsPlayers: false,
  natural: false,
  breakable: false,
  maxHp: 0,
}
const NATURAL: Flags = { ...FACTORY, natural: true, maxHp: 1 }
// Hit points are counted in a weapon's `harvest` (see weapons.json): an axe's is 3, so what a player put down with 6
// takes two hits with one, a tree of 30 ten, and a rock of 12 four with a pickaxe. Each kind's is in data/buildings.json.
const PLACED: Flags = { ...FACTORY, breakable: true, maxHp: 6 }
// A building a player puts down and uses: it has slots to open, takes items by hand, and stands in the way.
const MACHINE: Flags = { ...PLACED, hasInventory: true, acceptsDeposits: true, solid: true, blocksAnimals: true }

const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  door: {
    ...FACTORY,
    kind: 'door',
    code: 22,
    name: 'Ice door',
    description: 'Seals the frost lich in with whoever came for it, until it falls.',
    solid: true,
    blocksAnimals: true,
  },
  bed: {
    ...PLACED,
    kind: 'bed',
    code: 21,
    name: 'Sleeping bag',
    description: 'Sleep in it to wake up here when you are knocked out.',
  },
  well: {
    ...PLACED,
    kind: 'well',
    code: 24,
    name: 'Well',
    description: 'Fresh water, like a pond: right click it with an empty bucket to fill it.',
    solid: true,
    blocksAnimals: true,
  },
  altar: {
    ...MACHINE,
    kind: 'altar',
    code: 25,
    name: 'Altar',
    description: 'Performs rituals with what is on the pedestals and in the barrels round it (two tiles each way): pick one and press Craft.',
  },
  pedestal: {
    ...MACHINE,
    kind: 'pedestal',
    code: 26,
    name: 'Pedestal',
    description: 'Holds one stack of anything, on show. An altar near it draws on what is on it.',
  },
  waystone: {
    ...PLACED,
    kind: 'waystone',
    code: 27,
    name: 'Waystone',
    description: 'Give it a name, then right click it to travel to any other waystone.',
    solid: true,
    blocksAnimals: true,
  },
  worker: {
    ...PLACED,
    kind: 'worker',
    code: 28,
    name: 'Worker skeleton',
    description: 'A skeleton bound to work, waiting for its orders.',
    solid: true,
    blocksAnimals: true,
  },
  dummy: {
    ...PLACED,
    kind: 'dummy',
    code: 29,
    name: 'Target dummy',
    description: 'Hit it to see how hard you hit: it never breaks. Ctrl + right click it to pick it back up.',
    solid: true,
    blocksAnimals: true,
  },
  sunflower: {
    ...NATURAL,
    kind: 'sunflower',
    code: 30,
    name: 'Sunflower',
    description: 'Bees gather from it. Break it for its seeds, which grow without a garden plot.',
  },
  seedling: {
    ...NATURAL,
    kind: 'seedling',
    code: 31,
    name: 'Sunflower seedling',
    description: 'A sunflower planted from a seed. It grows into a sunflower in time; punch it to dig the seed back up.',
  },
  clay: {
    ...NATURAL,
    kind: 'clay',
    code: 32,
    name: 'Clay',
    description: 'A lump of clay by a river. Break it with a pickaxe for clay.',
    solid: true,
    blocksAnimals: true,
  },
  'copper-rock': {
    ...NATURAL,
    kind: 'copper-rock',
    code: 33,
    name: 'Copper rock',
    description: 'A rock with copper in it. Break it with a pickaxe for copper nuggets.',
    solid: true,
    blocksAnimals: true,
  },
  'tin-rock': {
    ...NATURAL,
    kind: 'tin-rock',
    code: 34,
    name: 'Tin rock',
    description: 'A rock with tin in it. Break it with a pickaxe for tin nuggets.',
    solid: true,
    blocksAnimals: true,
  },
  cactus: {
    ...NATURAL,
    kind: 'cactus',
    code: 35,
    name: 'Cactus',
    description: 'Break it for a cactus to plant again: it only grows on sand.',
    solid: true,
    blocksAnimals: true,
  },
  sand: {
    ...NATURAL,
    kind: 'sand',
    code: 36,
    name: 'Sand',
    description: 'A pocket of loose sand: break it, even with your fists, for sand.',
  },
  cobweb: {
    ...NATURAL,
    kind: 'cobweb',
    code: 37,
    name: 'Cobweb',
    description: 'Spun by a spider. Break it for string.',
  },
  hive: {
    ...NATURAL,
    kind: 'hive',
    code: 38,
    name: 'Beehive',
    description: 'Bees live in it and make honey from sunflowers nearby. Punch it for a honeycomb (one a punch, while it has honey), which angers them.',
    solid: true,
    blocksAnimals: true,
  },
  beebox: {
    ...PLACED,
    kind: 'beebox',
    code: 39,
    name: 'Bee box',
    description: 'A hive for bees to move into, like a wild one: punch it for a honeycomb, which angers them.',
    solid: true,
    blocksAnimals: true,
  },
  miner: {
    ...FACTORY,
    kind: 'miner',
    code: 1,
    name: 'Miner',
    description: 'Digs ore out of the deposit it stands on into its own store.',
    hasInventory: true,
    solid: true,
    blocksAnimals: true,
  },
  extractor: {
    ...FACTORY,
    kind: 'extractor',
    code: 2,
    name: 'Extractor',
    description: 'A belt that pulls items out of the inventory behind it.',
    rotatable: true,
  },
  belt: {
    ...FACTORY,
    kind: 'belt',
    code: 3,
    name: 'Belt',
    description: 'Carries items forward, into the next belt or an inventory.',
    rotatable: true,
  },
  chest: {
    ...MACHINE,
    kind: 'chest',
    code: 4,
    name: 'Chest',
    description: 'Stores items. Belts facing into it fill it.',
  },
  tree: {
    ...NATURAL,
    kind: 'tree',
    code: 5,
    name: 'Tree',
    description: 'Punch it for sticks; chop it down with an axe for logs and acorns.',
    solid: true,
    blocksAnimals: true,
  },
  bush: {
    ...NATURAL,
    kind: 'bush',
    code: 6,
    name: 'Bush',
    description: 'Break it for fiber and berries. Walking through it is slow.',
    slowsPlayers: true,
  },
  sapling: {
    ...NATURAL,
    kind: 'sapling',
    code: 7,
    name: 'Sapling',
    description: 'A young tree planted from an acorn. It grows into a tree in time; punch it to dig the acorn back up.',
  },
  sprout: {
    ...NATURAL,
    kind: 'sprout',
    code: 8,
    name: 'Berry sprout',
    description: 'A young bush planted from berries. It grows into a bush in time; punch it to dig the berries back up.',
  },
  rock: {
    ...NATURAL,
    kind: 'rock',
    code: 9,
    name: 'Rock',
    description: 'A chunk of rock. Break it with a pickaxe for stone and flint.',
    solid: true,
    blocksAnimals: true,
  },
  loose: {
    ...NATURAL,
    kind: 'loose',
    code: 20,
    name: 'Loose item',
    description: 'Something lying in the ground (a piece of flint): hit it to knock it loose.',
  },
  grass: {
    ...NATURAL,
    kind: 'grass',
    code: 10,
    name: 'Grass',
    description: 'A tuft of grass, which animals graze on. Pull it up for a chance of a seed, or cut it with a knife for hay.',
  },
  fence: {
    ...PLACED,
    kind: 'fence',
    code: 11,
    name: 'Fence',
    description: 'Keeps animals in (and players out). Joins up with the fences and gates beside it.',
    solid: true,
    blocksAnimals: true,
  },
  gate: {
    ...PLACED,
    kind: 'gate',
    code: 12,
    name: 'Fence gate',
    description: 'Opens when a player comes through it; right click to keep it open or shut. Animals only get through while it is open.',
    blocksAnimals: true,
  },
  stump: {
    ...MACHINE,
    kind: 'stump',
    code: 13,
    name: 'Stump',
    description: 'Pick a recipe at the side and press Craft: its tool goes in, and it works while you stay at it.',
  },
  plot: {
    ...PLACED,
    kind: 'plot',
    code: 14,
    name: 'Garden plot',
    description: 'Plant a seed in it with a right click. Break the crop when it is grown for the harvest and more seeds.',
  },
  workbench: {
    ...MACHINE,
    kind: 'workbench',
    code: 16,
    name: 'Workbench',
    description: 'Pick a recipe at the side, put what it takes in, and press Craft. It works while you stay at it.',
  },
  campfire: {
    ...MACHINE,
    kind: 'campfire',
    code: 17,
    name: 'Campfire',
    description: 'Burns fuel for heat, which cooks food and warms what is beside it. Logs sometimes leave charcoal, which burns hotter.',
  },
  oven: {
    ...MACHINE,
    kind: 'oven',
    code: 23,
    name: 'Makeshift oven',
    description: 'A stone oven: burns fuel like a campfire, but cooks twice as fast, and bakes dough into bread, which a campfire cannot.',
  },
  barrel: {
    ...MACHINE,
    kind: 'barrel',
    code: 18,
    name: 'Barrel',
    description: 'Holds eight buckets of liquid. It composts, boils bark and water into tannin and salt water into salt, and tans hides into leather.',
  },
  rack: {
    ...MACHINE,
    kind: 'rack',
    code: 19,
    name: 'Drying rack',
    description: 'Dries a hide, one at a time; quicker the hotter it is beside a campfire.',
  },
  feeder: {
    ...MACHINE,
    kind: 'feeder',
    code: 15,
    name: 'Feed box',
    description: 'Animals nearby eat what they like from it, which leaves them well fed and ready to breed.',
  },
}

// The kinds whose hits are in data/buildings.json: everything that is hit (natural or breakable) and keeps its hits,
// which is all of them but saplings, berry sprouts, sunflower seedlings and loose flint (one hit each, always) and the
// target dummy (which never breaks).
const ONE_HIT: readonly BuildingKind[] = ['sapling', 'sprout', 'seedling', 'loose']
const UNBREAKABLE: readonly BuildingKind[] = ['dummy']
export const HP_FROM_DATA: readonly BuildingKind[] = (Object.keys(BUILDING_DEFS) as BuildingKind[]).filter(
  (kind) => (BUILDING_DEFS[kind].natural || BUILDING_DEFS[kind].breakable) && !ONE_HIT.includes(kind) && !UNBREAKABLE.includes(kind),
)

// data/buildings.json: `{ "tree": { "hp": 30 }, ... }`, every kind in HP_FROM_DATA and no other.
function readHp(data: unknown): void {
  const all = fieldsOf(data, 'data/buildings.json', failIn('data/buildings.json'))
  for (const [kind, entry] of Object.entries(all)) {
    const fail = failIn(`data/buildings.json, ${kind}`)
    if (!HP_FROM_DATA.includes(kind as BuildingKind)) fail(`not a building whose hits are kept here (those are ${HP_FROM_DATA.join(', ')})`)
    const fields = fieldsOf(entry, 'it', fail)
    onlyFields(fields, ['hp'], fail)
    BUILDING_DEFS[kind as BuildingKind].maxHp = wholeField(fields, 'hp', fail, 1)
  }
  const missing = HP_FROM_DATA.find((kind) => !Object.hasOwn(all, kind))
  if (missing) throw new Error(`data/buildings.json: ${missing} has no "hp"`)
}
readHp(buildingsData)

export const BUILDINGS: Readonly<Record<BuildingKind, BuildingDef>> = BUILDING_DEFS

// The fires: the campfire and the oven, which burn fuel alike (see machines.ts), warm players, and heat what is beside
// them.
export type FireKind = 'campfire' | 'oven'
export function isFireKind(kind: string): kind is FireKind {
  return kind === 'campfire' || kind === 'oven'
}

// The factory's buildings, which are what a `build` command can make. The factory is put away for now (nothing in the
// game builds them), but the simulation and the server still run them, ready for later.
export const BUILDING_KINDS: readonly BuildingKind[] = ['miner', 'extractor', 'belt', 'chest']

export function isBuildingKind(value: unknown): value is BuildingKind {
  return typeof value === 'string' && Object.hasOwn(BUILDINGS, value)
}

// The standard sizes a solid building stands in the way with, in fractions of its tile ([left, top, right, bottom]).
// Every building uses one of these rather than a size of its own, so two side by side line up exactly, with no small
// lip between them to catch on (a stump a hair wider than the workbench beside it). Pick the nearest one to the model
// and fit the model to it. (Players also slip round a corner they only just catch: CORNER_SLIP in movement.ts.)
export const FOOTPRINT = {
  // Most things put down: the stations, fires, chests, feed boxes, the well, the altar; and rocks (copper and tin too) and clay.
  block: [0.1, 0.1, 0.9, 0.9],
  // Small round things: a barrel, a pedestal, a beehive.
  small: [0.17, 0.17, 0.83, 0.83],
  // A tree's trunk (and a cactus): wide enough that the gap between two trees side by side (0.56 tiles) is narrower than
  // a player (0.6), with room to spare, so nobody slips between them.
  trunk: [0.28, 0.28, 0.72, 0.72],
  // A thin frame across the tile, post to post (the drying rack: nobody walks through under the hide).
  frame: [0.07, 0.42, 0.93, 0.58],
} as const satisfies Record<string, readonly [number, number, number, number]>

// What part of its tile a solid building stands in the way with: its trunk, its body, its frame, rather than the whole
// tile, so a player can walk up close round it. A solid building not listed here fills its tile.
export const BUILDING_BOUNDS: Partial<Record<BuildingKind, ReadonlyArray<readonly [number, number, number, number]>>> = {
  tree: [FOOTPRINT.trunk],
  rock: [FOOTPRINT.block],
  chest: [FOOTPRINT.block],
  stump: [FOOTPRINT.block],
  workbench: [FOOTPRINT.block],
  campfire: [FOOTPRINT.block],
  oven: [FOOTPRINT.block],
  well: [FOOTPRINT.block],
  altar: [FOOTPRINT.block],
  pedestal: [FOOTPRINT.small],
  waystone: [FOOTPRINT.block],
  worker: [FOOTPRINT.small],
  dummy: [FOOTPRINT.small],
  clay: [FOOTPRINT.block],
  'copper-rock': [FOOTPRINT.block],
  'tin-rock': [FOOTPRINT.block],
  cactus: [FOOTPRINT.trunk],
  hive: [FOOTPRINT.small],
  beebox: [FOOTPRINT.small],
  barrel: [FOOTPRINT.small],
  rack: [FOOTPRINT.frame],
  feeder: [FOOTPRINT.block],
}
