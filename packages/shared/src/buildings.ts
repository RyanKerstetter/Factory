// Everything that stands on a tile: the factory's buildings; what is found in the world (trees, bushes, rocks, grass,
// flint, and the saplings and berry sprouts planted from acorns and berries); what players put up (fences, gates, the
// stations and machines, garden plots, feed boxes, sleeping bags); and the dungeon's ice door. Each takes one tile.
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
  // factory's buildings, which are not hit).
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
// Hit points are counted in a weapon's `harvest` (see weapons.json): an axe's is 3, so what a player put down takes two
// hits with one, a tree ten, and a rock four with a pickaxe.
const PLACED: Flags = { ...FACTORY, breakable: true, maxHp: 6 }
// A building a player puts down and uses: it has slots to open, takes items by hand, and stands in the way.
const MACHINE: Flags = { ...PLACED, hasInventory: true, acceptsDeposits: true, solid: true, blocksAnimals: true }

export const BUILDINGS: Readonly<Record<BuildingKind, BuildingDef>> = {
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
    description: 'Punch it for sticks (it grows them back slowly); chop it down with an axe for logs and acorns.',
    solid: true,
    blocksAnimals: true,
    maxHp: 30,
  },
  bush: {
    ...NATURAL,
    kind: 'bush',
    code: 6,
    name: 'Bush',
    description: 'Break it for fiber and berries. Walking through it is slow.',
    slowsPlayers: true,
    maxHp: 10,
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
    maxHp: 12,
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
    maxHp: 3,
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
  // Most things put down: the stations, fires, chests, feed boxes, the well; and rocks.
  block: [0.1, 0.1, 0.9, 0.9],
  // Small round things: a barrel.
  small: [0.17, 0.17, 0.83, 0.83],
  // A tree's trunk: wide enough that the gap between two trees side by side (0.56 tiles) is narrower than a player
  // (0.6), with room to spare, so nobody slips between them.
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
  barrel: [FOOTPRINT.small],
  rack: [FOOTPRINT.frame],
  feeder: [FOOTPRINT.block],
}
