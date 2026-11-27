import { BUILDING_BOUNDS, BUILDINGS, isCampKind, isFloorKind, type BuildingKind } from './buildings.ts'
import { PLAYER_REACH, SUB } from './constants.ts'
import { distanceToTileSquared, isInsideWorld, type Direction } from './geometry.ts'
import { getItem, NO_ITEM, type ItemId } from './items.ts'
import type { Inventory } from './inventory.ts'
import { fenceBoxes, fenceMask, wallBoxes } from './fences.ts'
import { playerOverlapsTile, type Box, type IsSlow, type IsSolid } from './movement.ts'
import type { FactoryWorld } from './sim/factory-world.ts'
import { CAMP_BIOME, groundBlocks, oreAt, waterAt } from './world-gen.ts'
import { isInDungeons } from './dungeon.ts'
import { biomeAt, canGrowAt, isSandAt, type Terrain } from './terrain.ts'

// What a player asks to happen to the factory. A client sends it stamped with the tick it should run on; the server
// checks it on that tick and runs it, runs part of it ("take up to 50"), or turns it down, and logs what happened.
// Commands on the same tick run in order of (tick, player ID, sequence).
export type Command =
  | { k: 'build'; x: number; y: number; kind: BuildingKind; dir: Direction }
  | { k: 'remove'; id: number }
  // Take up to `max` of `item` out of a building into the player's inventory. `item` 0 is every kind, in item order.
  | { k: 'take'; id: number; item: ItemId; max: number }
  // Put up to `max` of `item` from the player's inventory into a building. `item` 0 is every kind, in item order.
  | { k: 'put'; id: number; item: ItemId; max: number; slot?: number }
  // Move up to `count` from one slot to another: of the player's inventory (`id` 0) or of a building's (its ID). Onto
  // an empty slot or a stack of its kind as far as it fits (the rest stays), or a whole stack swapped with another.
  | { k: 'slot'; from: { id: number; i: number }; to: { id: number; i: number }; count: number }
  // Drop up to `count` from a slot (as for `slot`) on the ground, towards the point x, y (in units), a little way off.
  | { k: 'drop'; from: { id: number; i: number }; count: number; x: number; y: number }
  // Hit a plant or a rock with whatever is in slot `slot` of the player's inventory (the picked hotbar slot): a tree
  // gives up a stick (or, with an axe, is chopped), a bush or rock is broken a little (and drops something), a sapling
  // is dug back up.
  | { k: 'punch'; id: number; slot: number }
  // Make a recipe (see recipes.ts) from what is in the player's inventory.
  | { k: 'craft'; recipe: number }
  // Start a work station (the stump, the workbench) on recipe `recipe` (its index in the station's list in
  // stations.json), putting the tool it needs in from the player's inventory; it makes it for as long as what is in it
  // is enough, while the player stays at it (see `use`). At an altar: start ritual `recipe` (see altar.ts).
  | { k: 'work'; id: number; recipe: number }
  // Use what is in slot `slot` on a tile: fill a bucket at a pond (fresh water) or the sea (salt water) or from a barrel,
  // pour one into a barrel, water farmland, or empty it on bare ground.
  | { k: 'apply'; x: number; y: number; slot: number }
  // Light a campfire (or put it out); seal a barrel (or open it).
  | { k: 'machine'; id: number; action: 'light' | 'douse' | 'seal' | 'unseal' }
  // The work station the player has open, or 0 when they close it: a station only works while someone is at it. `hand`:
  // their inventory is open with nothing else (its crafting book showing), which hand crafting only goes on while
  // (closing it calls off everything being made by hand).
  | { k: 'use'; id: number; hand?: true }
  // Pick a target dummy back up (Ctrl + right click), as the item that put it down.
  | { k: 'lift'; id: number }
  // Open a gate and keep it open, or shut it and keep it shut.
  | { k: 'toggle'; id: number }
  // Attack with what is in slot `slot` (-1: bare-handed), towards the point x, y (in units) (see weapons.ts). `seen` is
  // the server tick the page was drawing creatures at, so the attack is judged against where the player saw them.
  // `charged`: the attack button was held down (see `charge`) for the weapon's charged attack (see weapons.ts).
  // `at`: the number of the page's last movement input when the attack was made: the server makes the attack just after
  // it has played that input, before the next (so from where the player stood, before the step forward the attack takes
  // them: see the room's `step`).
  | { k: 'attack'; slot: number; x: number; y: number; seen?: number; charged?: 1; at?: number }
  // The attack button has gone down and is being held, to charge an attack: a charged attack is only let through
  // CHARGE_TICKS after this.
  | { k: 'charge'; slot: number }
  // Use whatever is in slot `slot` on an animal: put a rope on it (or take yours off), or milk a cow.
  | { k: 'interact'; animal: number; slot: number }
  // A rope on a raft's post, from slot `slot`, to pull it along (or take yours off, back into the inventory).
  | { k: 'raftRope'; raft: number; slot: number }
  // Tie an animal or a raft (one of them) to a fence on a rope: the rope it is led on by this player, or else one from
  // their things. A fence holds one.
  | { k: 'tie'; fence: number; animal?: number; raft?: number }
  // Untie what is tied to a fence, the rope back into the inventory.
  | { k: 'untie'; fence: number }
  // The host turns players hurting each other on or off; and item spawning (for testing: while it is on, every player
  // can take any item, as many as they like, out of nothing, from beside their inventory).
  | { k: 'pvp'; on: boolean }
  | { k: 'items'; on: boolean }
  // `count` of an item out of nothing, into the player's inventory (as much as fits), while item spawning is on.
  | { k: 'give'; item: number; count: number }
  // Back to the world spawn, or to the sleeping bag last slept in (from the menu: for a player stuck somewhere, a raft
  // lost out at sea). They keep their health and their things.
  | { k: 'respawn'; at: 'spawn' | 'bed' }
  // Eat one of the food in slot `slot` (the food slot, with F), for the health it gives back (`heals` in items.json),
  // at most once every EAT_COOLDOWN_TICKS.
  | { k: 'eat'; slot: number }
  // A chest: sort what is in it (stacks merged, in item order), or top up the stacks it has from the player's inventory
  // (each to a full stack, no further: nothing new goes in), or name it (`name`, up to CHEST_NAME_LENGTH; empty for none).
  // A waystone is named the same way.
  | { k: 'chest'; id: number; action: 'sort' | 'stash' }
  | { k: 'rename'; id: number; name: string }
  // Which hotbar slot the player has picked (-1: bare hands), so others see what they hold.
  | { k: 'hold'; slot: number }
  // Sleep in a sleeping bag: the player wakes up beside it when they are next knocked out.
  | { k: 'sleep'; id: number }
  // Put one of the item in slot `slot` of the player's inventory down on a tile, as what it places (an acorn is
  // planted as a sapling). A raft goes on the water with its middle at `at` (units, on tile x, y), wherever that is.
  | { k: 'place'; x: number; y: number; slot: number; at?: { x: number; y: number } }
  // Travel from the waystone `id` (in reach) to the waystone `to` (see waystones.ts).
  | { k: 'warp'; id: number; to: number }

// Why a command can be turned down, in words a player reads.
export const REFUSALS = {
  outside: 'That is outside the world.',
  occupied: 'Something is already built there.',
  floored: 'There is already a floor there.',
  standing: 'You are standing there.',
  noOre: 'A miner has to stand on ore.',
  reach: 'That is too far away.',
  missing: 'That building is gone.',
  noInventory: 'That has no inventory.',
  noDeposit: 'That does not take items by hand.',
  nothing: 'There was nothing to move.',
  notPlant: 'Only plants and rocks can be punched for now.',
  needsPickaxe: 'You need a pickaxe to break rock.',
  needsAxe: 'You need an axe to take that down.',
  noAmmo: 'You have nothing to shoot.',
  needsTool: 'You need the right tool with you for that (see the recipe).',
  water: 'You cannot build on water.',
  raftWater: 'A raft goes on open water, clear of the shore and other rafts.',
  dungeon: 'Nothing can be built down here.',
  guarded: 'The skeletons guard the chest: defeat them all first.',
  sealed: 'The barrel is sealed.',
  inventoryFull: 'Your inventory is full.',
  unripe: 'It is still growing: it takes a tool to dig it up.',
  notHost: 'Only the host can change that.',
  noSpawning: 'The host has not turned item spawning on.',
  noBed: 'You have not slept in a sleeping bag that is still there.',
  barren: 'Nothing grows there.',
  cannotApply: 'There is nothing to use that on there.',
  noFuel: 'Put some fuel in first.',
  barrelFull: 'The barrel is full, or has something else in it.',
  barrelEmpty: 'There is nothing in the barrel to take.',
  noWork: 'Put a tool and something it works on in first.',
  ritualLacking: 'The pedestals and barrels round the altar do not hold everything that takes.',
  altarFull: 'There is no room on the altar for what that makes. Take what is on it off first.',
  noWaystone: 'That waystone is gone.',
  warping: 'You are already on your way.',
  animalGone: 'That animal is gone.',
  leadTaken: 'That is on someone else\'s rope, or tied up.',
  noMilk: 'That cow has no milk yet.',
  nothingToDo: 'Hold a rope to lead it.',
  raftGone: 'That raft is gone.',
  noRope: 'You need a rope to tie it up.',
  tieFar: 'That is too far from the fence to tie to it.',
  postTaken: 'Something is already tied to that fence.',
  notTied: 'Nothing is tied to that fence.',
  notEmpty: 'Something is already growing there.',
  notDryable: 'That does not dry on a drying rack.',
  rackFull: 'There is already a hide on the rack.',
  noRecipe: 'There is no such recipe.',
  lacking: 'You do not have what that needs.',
  full: 'There is no room for it.',
  notPlaceable: 'That cannot be put down.',
  notFood: 'That cannot be eaten.',
  fullHealth: 'You are not hurt.',
  wouldKill: 'Eating that now would kill you: you need more health.',
  fogged: 'That is lost in the fog: eat a truesight flesh to see your way there.',
  onlySand: 'A cactus only grows on sand.',
  campBiome: 'A camp only goes in its own land: a skeleton camp in the mountains, a goblin camp on the meadow, a mummy camp in the desert.',
  notBed: 'That is not a sleeping bag.',
  invalid: 'The server could not read that.',
  busy: 'It is making something else.',
  eatTooSoon: 'Not hungry yet.',
  tooSoon: 'Too quick.',
  natural: 'Punch it instead.',
  late: 'The command was too far ahead of the server.',
} as const
export type Refusal = keyof typeof REFUSALS

export function isWithinReach(player: { x: number; y: number }, x: number, y: number): boolean {
  return distanceToTileSquared(player.x, player.y, x, y) <= PLAYER_REACH * PLAYER_REACH
}

// Whether a building of a kind can go on a tile, as the world is: in the world and in reach, the tile free (nothing on
// it, not water, not in a dungeon), and not where the player stands if it is solid. A floor goes under what stands on
// its tile, so only needs no floor there already, and nothing that grows or was found there but a tuft of grass (which
// it covers: see the server's `place`). The server's word on the tick a command runs, or the page's guess (from the
// factory it has, which is a few ticks old).
function checkTile(world: FactoryWorld, terrain: Terrain | undefined, player: { x: number; y: number }, x: number, y: number, kind: BuildingKind): Refusal | undefined {
  if (!isInsideWorld(x, y)) return 'outside'
  if (!isWithinReach(player, x, y)) return 'reach'
  if (isFloorKind(kind)) {
    if (world.floorAt(x, y)) return 'floored'
    const on = world.entityAt(x, y)
    if (on && BUILDINGS[on.kind].natural && on.kind !== 'grass') return 'occupied'
  } else if (world.entityAt(x, y)) return 'occupied'
  if (isInDungeons(x, y)) return 'dungeon'
  if (terrain !== undefined && waterAt(terrain, x, y)) return 'water'
  // A plant only on ground it grows in: not sand, not the mountains' rock and snow (a sunflower seed needs no garden
  // plot, only soil); a cactus (planted young) only on sand.
  if (terrain !== undefined && (kind === 'grass' || kind === 'sprout' || kind === 'sapling' || kind === 'seedling') && !canGrowAt(terrain, x, y)) return 'barren'
  if (terrain !== undefined && (kind === 'cactus' || kind === 'young-cactus') && !isSandAt(terrain, x, y)) return 'onlySand'
  // A camp only in its own biome: a skeleton camp in the mountains, a goblin camp on the meadow, a mummy camp in the desert.
  if (terrain !== undefined && isCampKind(kind) && biomeAt(terrain, x, y)?.key !== CAMP_BIOME[kind]) return 'campBiome'
  if (BUILDINGS[kind].solid && playerOverlapsTile(player, x, y)) return 'standing'
  return undefined
}

// Whether one of the factory's buildings can be built on a tile (a miner only on ore).
export function checkBuild(
  world: FactoryWorld,
  terrain: Terrain,
  player: { x: number; y: number },
  x: number,
  y: number,
  kind: BuildingKind,
): Refusal | undefined {
  const refused = checkTile(world, terrain, player, x, y, kind)
  if (refused) return refused
  if (kind === 'miner' && oreAt(terrain.seed, x, y) === NO_ITEM) return 'noOre'
  return undefined
}

// The boxes a solid building stands in the way with in its tile (see BUILDING_BOUNDS), in units; undefined: all of it.
const boundsInUnits = new Map<BuildingKind, readonly Box[]>()
export function boundsOf(kind: BuildingKind): readonly Box[] | undefined {
  const fractions = BUILDING_BOUNDS[kind]
  if (!fractions) return undefined
  let boxes = boundsInUnits.get(kind)
  if (!boxes) {
    boxes = fractions.map((box) => box.map((edge) => Math.round(edge * SUB)) as unknown as Box)
    boundsInUnits.set(kind, boxes)
  }
  return boxes
}

// What players cannot walk into, as a world has it: water and a dungeon's walls (once the world's terrain is known),
// the tiles with a solid building (a tree, a miner, a chest), and a fence's post and rails.
export function solidIn(world: FactoryWorld, terrain: () => Terrain | undefined = () => undefined): IsSolid {
  const kindAt = (x: number, y: number): BuildingKind | undefined => world.entityAt(x, y)?.kind
  return (x, y) => {
    const land = terrain()
    if (land && groundBlocks(land, x, y)) return true
    const entity = world.entityAt(x, y)
    if (!entity || !BUILDINGS[entity.kind].solid) return false
    if (entity.kind === 'fence') return fenceBoxes(fenceMask(kindAt, x, y))
    if (entity.kind === 'wood-wall') return wallBoxes(fenceMask(kindAt, x, y))
    return boundsOf(entity.kind) ?? true
  }
}

// The tiles that slow players walking through them, as a world has them: those with a bush.
export function slowIn(world: FactoryWorld): IsSlow {
  return (x, y) => {
    const entity = world.entityAt(x, y)
    return entity !== undefined && BUILDINGS[entity.kind].slowsPlayers
  }
}

// Whether the item in a slot of the player's inventory can be put down on a tile, and if so as what: a building (an
// acorn is planted as a sapling, a fence item put up as a fence), or a seed sown in the farmland there (`sow` is the
// plot's ID).
export function checkPlace(
  world: FactoryWorld,
  player: { x: number; y: number },
  inventory: Inventory,
  slot: number,
  x: number,
  y: number,
  terrain?: Terrain,
): { ok: true; kind: BuildingKind } | { ok: true; sow: number } | { ok: false; why: Refusal } {
  const held = inventory.slots[slot]
  if (!held || held.count === 0) return { ok: false, why: 'nothing' }
  const item = getItem(held.item)
  const there = world.entityAt(x, y)
  if (item.crop !== undefined && there?.kind === 'plot') {
    if (!isWithinReach(player, x, y)) return { ok: false, why: 'reach' }
    if (there.crop !== 0) return { ok: false, why: 'notEmpty' }
    return { ok: true, sow: there.id }
  }
  const kind = item.places
  if (!kind) return { ok: false, why: 'notPlaceable' }
  const refused = checkTile(world, terrain, player, x, y, kind)
  return refused ? { ok: false, why: refused } : { ok: true, kind }
}
