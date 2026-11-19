import { BUILDINGS, type BuildingKind } from './buildings.ts'
import { PLAYER_REACH } from './constants.ts'
import { distanceToTileSquared, isInsideWorld, type Direction } from './geometry.ts'
import { getItem, NO_ITEM, type ItemId } from './items.ts'
import type { Inventory } from './inventory.ts'
import { fenceBoxes, fenceMask } from './fences.ts'
import { playerOverlapsTile, type IsSlow, type IsSolid } from './movement.ts'
import type { FactoryWorld } from './sim/factory-world.ts'
import { oreAt, waterAt } from './world-gen.ts'

// What a player asks to happen to the factory. A client sends it stamped with the tick it should run on; the server
// checks it on that tick and runs it, runs part of it ("take up to 50"), or turns it down, and logs what happened.
// Commands on the same tick run in order of (tick, player ID, sequence).
export type Command =
  | { k: 'build'; x: number; y: number; kind: BuildingKind; dir: Direction }
  | { k: 'remove'; id: number }
  // Take up to `max` of `item` out of a building into the player's inventory. `item` 0 is every kind, in item order.
  | { k: 'take'; id: number; item: ItemId; max: number }
  // Put up to `max` of `item` from the player's inventory into a building. `item` 0 is every kind, in item order.
  | { k: 'put'; id: number; item: ItemId; max: number }
  // Move the stack in slot `from` of the player's inventory to slot `to`: onto a stack of the same kind as far as it
  // fits, or swapping places with whatever is there.
  | { k: 'move'; from: number; to: number }
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
  // Start a work station: the stump on whatever it can make from what is in it; the workbench on recipe `recipe` (its
  // index in stations.json), once or, with `repeat`, for as long as it can. It works while the player stays at it (see
  // `use`).
  | { k: 'work'; id: number; recipe?: number; repeat?: boolean }
  // Use what is in slot `slot` on a tile: fill a bucket at a pond or from a barrel, pour one into a barrel, water a
  // garden plot, or put compost on one.
  | { k: 'apply'; x: number; y: number; slot: number }
  // Light a campfire (or put it out); seal a barrel (or open it).
  | { k: 'machine'; id: number; action: 'light' | 'douse' | 'seal' | 'unseal' }
  // The work station the player has open, or 0 when they close it: a station only works while someone is at it.
  | { k: 'use'; id: number }
  // Open a gate and keep it open, or shut it and keep it shut.
  | { k: 'toggle'; id: number }
  // Hit an animal with whatever is in slot `slot`.
  | { k: 'strike'; animal: number; slot: number }
  // Attack with what is in slot `slot` (-1: bare-handed), towards the point x, y (in units): the basic attack, or the
  // special one; `charge` is how many ticks a shot, a throw or a windup was held for (see weapons.ts). `seen` is the
  // server tick the page was drawing the animals at, so the attack is judged against where the player saw them.
  | { k: 'attack'; special: boolean; slot: number; x: number; y: number; charge: number; seen?: number }
  // Use whatever is in slot `slot` on an animal: put a rope on it (or take yours off), or milk a cow.
  | { k: 'interact'; animal: number; slot: number }
  // Put one of the item in slot `slot` of the player's inventory down on a tile, as what it places (an acorn is
  // planted as a sapling).
  | { k: 'place'; x: number; y: number; slot: number }

// Why a command can be turned down, in words a player reads.
export const REFUSALS = {
  outside: 'That is outside the world.',
  occupied: 'Something is already built there.',
  standing: 'You are standing there.',
  noOre: 'A miner has to stand on ore.',
  reach: 'That is too far away.',
  missing: 'That building is gone.',
  noInventory: 'That has no inventory.',
  noDeposit: 'That does not take items by hand.',
  nothing: 'There was nothing to move.',
  notPlant: 'Only plants and rocks can be punched for now.',
  bare: 'This tree has no sticks left. Chop it down with an axe, or come back later.',
  needsPickaxe: 'You need a pickaxe to break rock.',
  needsAxe: 'You need an axe to take that down.',
  noAmmo: 'You have nothing to shoot.',
  needsTool: 'You need the right tool with you for that (see the recipe).',
  water: 'You cannot build on water.',
  sealed: 'The barrel is sealed.',
  inventoryFull: 'Your inventory is full.',
  unripe: 'It is still growing: it takes a tool to dig it up.',
  cannotApply: 'There is nothing to use that on there.',
  noFuel: 'Put some fuel in first.',
  barrelFull: 'The barrel is full, or has something else in it.',
  barrelEmpty: 'There is nothing in the barrel to take.',
  noWork: 'Put a tool and something it works on in first.',
  animalGone: 'That animal is gone.',
  leadTaken: 'Someone else is leading that animal.',
  noMilk: 'That cow has no milk yet.',
  nothingToDo: 'Hold a rope to lead it.',
  notEmpty: 'Something is already growing there.',
  noRecipe: 'There is no such recipe.',
  lacking: 'You do not have what that needs.',
  full: 'There is no room for it.',
  notPlaceable: 'That cannot be put down.',
  tooSoon: 'Too quick.',
  natural: 'Punch it instead.',
  late: 'The command was too far ahead of the server.',
} as const
export type Refusal = keyof typeof REFUSALS

export function isWithinReach(player: { x: number; y: number }, x: number, y: number): boolean {
  return distanceToTileSquared(player.x, player.y, x, y) <= PLAYER_REACH * PLAYER_REACH
}

// Whether a building can go on a tile, as the world is: the server's word on the tick the command runs, or the page's
// guess when it draws the preview (from the factory it has, which is a few ticks old).
export function checkBuild(
  world: FactoryWorld,
  seed: number,
  player: { x: number; y: number },
  x: number,
  y: number,
  kind: BuildingKind,
): Refusal | undefined {
  if (!isInsideWorld(x, y)) return 'outside'
  if (!isWithinReach(player, x, y)) return 'reach'
  if (world.entityAt(x, y)) return 'occupied'
  if (waterAt(seed, x, y)) return 'water'
  if (BUILDINGS[kind].solid && playerOverlapsTile(player, x, y)) return 'standing'
  if (kind === 'miner' && oreAt(seed, x, y) === NO_ITEM) return 'noOre'
  return undefined
}

// What players cannot walk into, as a world has it: water (with the world's seed), the tiles with a solid building (a
// tree, a miner, a chest), and a fence's post and rails.
export function solidIn(world: FactoryWorld, seed: () => number = () => Number.NaN): IsSolid {
  const kindAt = (x: number, y: number): BuildingKind | undefined => world.entityAt(x, y)?.kind
  return (x, y) => {
    const worldSeed = seed()
    if (!Number.isNaN(worldSeed) && waterAt(worldSeed, x, y)) return true
    const entity = world.entityAt(x, y)
    if (!entity || !BUILDINGS[entity.kind].solid) return false
    return entity.kind === 'fence' ? fenceBoxes(fenceMask(kindAt, x, y)) : true
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
// acorn is planted as a sapling, a fence item put up as a fence), or a seed sown in the garden plot there (`sow` is the
// plot's ID).
export function checkPlace(
  world: FactoryWorld,
  player: { x: number; y: number },
  inventory: Inventory,
  slot: number,
  x: number,
  y: number,
  seed?: number,
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
  if (!isInsideWorld(x, y)) return { ok: false, why: 'outside' }
  if (!isWithinReach(player, x, y)) return { ok: false, why: 'reach' }
  if (there) return { ok: false, why: 'occupied' }
  if (seed !== undefined && waterAt(seed, x, y)) return { ok: false, why: 'water' }
  if (BUILDINGS[kind].solid && playerOverlapsTile(player, x, y)) return { ok: false, why: 'standing' }
  return { ok: true, kind }
}

export function buildingAcceptsDeposits(kind: BuildingKind): boolean {
  return BUILDINGS[kind].acceptsDeposits
}
