// Everything that stands on a tile: the factory's buildings; what is found in the world (trees, bushes, rocks, grass,
// and the saplings and berry sprouts planted from acorns and berries); and what players put up (fences, gates, the
// chopping stump, garden plots, feed boxes). Each takes one tile.
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
  | 'barrel'
  | 'rack'
  | 'loose'

export type BuildingDef = {
  kind: BuildingKind
  // Its number in a chunk's hash, so a kind never hashes the same as another.
  code: number
  name: string
  // One line on what it does, for the build bar.
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
  // How much hitting it takes to break (see `hitDamage` in tools.ts for how much each hit does; 0 for buildings).
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
// Hit points are counted in weapon damage (see weapons.json): an axe does 3, so what a player put down takes two hits
// with one, a tree ten, and a rock four with a pickaxe.
const PLACED: Flags = { ...FACTORY, breakable: true, maxHp: 6 }
// A building a player puts down and uses: it has slots to open, takes items by hand, and stands in the way.
const MACHINE: Flags = { ...PLACED, hasInventory: true, acceptsDeposits: true, solid: true, blocksAnimals: true }

export const BUILDINGS: Readonly<Record<BuildingKind, BuildingDef>> = {
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
    description: 'Punch it for twine; when it is gone it drops berries. Walking through it is slow.',
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
    description: 'Something lying in the ground (a piece of flint, a thrown spear): hit it to knock it loose.',
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
    ...PLACED,
    kind: 'stump',
    code: 13,
    name: 'Stump',
    description: 'Put a tool and what it works on in, and press Craft. It works while you stay at it.',
    hasInventory: true,
    acceptsDeposits: true,
    solid: true,
    blocksAnimals: true,
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
  barrel: {
    ...MACHINE,
    kind: 'barrel',
    code: 18,
    name: 'Barrel',
    description: 'Holds eight buckets of liquid. Sealed, it composts, boils bark into tannin, or tans hides into leather.',
  },
  rack: {
    ...MACHINE,
    kind: 'rack',
    code: 19,
    name: 'Drying rack',
    description: 'Dries a hide, one at a time; quicker the hotter it is beside a campfire.',
  },
  feeder: {
    ...PLACED,
    kind: 'feeder',
    code: 15,
    name: 'Feed box',
    description: 'Animals nearby eat what they like from it, which leaves them well fed and ready to breed.',
    hasInventory: true,
    acceptsDeposits: true,
    solid: true,
    blocksAnimals: true,
  },
}

// The factory's buildings, which are what a `build` command can make. The factory is put away for now (nothing in the
// game builds them), but the simulation and the server still run them, ready for later.
export const BUILDING_KINDS: readonly BuildingKind[] = ['miner', 'extractor', 'belt', 'chest']

export function isBuildingKind(value: unknown): value is BuildingKind {
  return typeof value === 'string' && Object.hasOwn(BUILDINGS, value)
}
