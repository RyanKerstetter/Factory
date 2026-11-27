import { BEES } from '../bees.ts'
import { BUILDINGS, type BuildingKind, type FireKind } from '../buildings.ts'
import { CACTUS_STAGES, CHEST_SLOTS, FEEDER_SLOTS, MINER_SLOTS, SAPLING_STAGES, SEEDLING_STAGES, SPROUT_STAGES, TPS } from '../constants.ts'
import { getCrop } from '../crops.ts'
import type { Direction } from '../geometry.ts'
import { addItems, countOf, createInventory, inventoryFromWire, inventoryToWire, inventoryTotals, removeItems, roomFor, type Inventory } from '../inventory.ts'
import { getItem, NO_ITEM, stackLimit, type ItemId } from '../items.ts'
import {
  BARREL_SLOTS,
  BARREL_SOLIDS,
  CAMPFIRE_COOK,
  CAMPFIRE_FUEL,
  CAMPFIRE_SLOTS,
  cookingOf,
  RACK_INPUT,
  RACK_SLOTS,
  rackRefusal,
  stepBarrel,
  stepCampfire,
  stepRack,
} from '../machines.ts'
import { stepAltar } from '../altar.ts'
import { isStationKind, STATION_LAYOUT, STATION_RECIPES, stationCan, stationMake, stationSlotsFor, type StationKind } from '../stations.ts'
import { stepLane, type BeltShape, type LaneItem } from './belt.ts'
import type { Hasher } from './hash.ts'

// A building or a plant in the simulation. Its state is plain data, so it can be hashed, sent and copied.
type EntityBase = { id: number; x: number; y: number; dir: Direction }

// A belt or an extractor (a belt that also pulls from the inventory behind it, through a link like any other).
// `shape` follows from the links into it (see `FactoryWorld.refreshShape`), so it is not sent or hashed.
export type BeltEntity = EntityBase & { kind: 'belt' | 'extractor'; lane: LaneItem[]; shape: BeltShape }
export type MinerEntity = EntityBase & { kind: 'miner'; ore: ItemId; progress: number; inv: Inventory }
// A chest, and the name a player gave it (shown when it is hovered; not part of the simulation's hash).
export type ChestEntity = EntityBase & { kind: 'chest'; hp: number; inv: Inventory; name?: string }
// Something with only the hits it has left in it: a bush, a rock, a tuft of grass, a fence, a sleeping bag, an ice door, a well,
// a worker skeleton (waiting: it does nothing yet), a wooden wall, a wooden or stone floor, a table (any kind), a chair.
export type PlantEntity = EntityBase & { kind: 'bush' | 'rock' | 'grass' | 'fence' | 'bed' | 'door' | 'well' | 'worker' | 'dummy' | 'sunflower' | 'clay' | 'copper-rock' | 'tin-rock' | 'cactus' | 'sand' | 'cobweb' | 'wood-wall' | 'wood-floor' | 'stone-floor' | 'table' | 'chair' | 'low-table' | 'round-table' | 'skeleton-camp' | 'goblin-camp' | 'tomb'; hp: number }
// A waystone, and the name a player gave it (what other waystones list it as; not part of the simulation's hash).
export type WaystoneEntity = EntityBase & { kind: 'waystone'; hp: number; name?: string }
// Something stuck in the ground, to be knocked loose by a hit (a piece of flint). `item` and `count` are what it gives.
export type LooseEntity = EntityBase & { kind: 'loose'; item: ItemId; count: number }
// A gate or a wooden door, and its mode (GATE_AUTO, GATE_OPEN or GATE_SHUT: see fences.ts).
export type GateEntity = EntityBase & { kind: 'gate' | 'wood-door'; hp: number; mode: number }
// A tree: the chopping it has left in it, and the punches towards knocking the next stick (or bark) loose.
export type TreeEntity = EntityBase & { kind: 'tree'; hp: number; punches: number }
// A sapling, a berry sprout, a sunflower seedling or a young cactus, which grows a stage on each of its random ticks and
// becomes a tree (after SAPLING_STAGES), a bush (after SPROUT_STAGES), a sunflower (after SEEDLING_STAGES) or a cactus
// (after CACTUS_STAGES).
export type SaplingEntity = EntityBase & { kind: YoungKind; stage: number }
export type YoungKind = 'sapling' | 'sprout' | 'seedling' | 'young-cactus'
export function isYoungKind(kind: string): kind is YoungKind {
  return kind === 'sapling' || kind === 'sprout' || kind === 'seedling' || kind === 'young-cactus'
}
// A beehive, wild or a bee box (see the server's bees.ts): its hits, how much honey is in it (honeycombs), how many
// worker bees live in it (in it or out and about), and whether its queen is in it (1) or not (0: it stands empty for a
// queen looking for a home).
export type HiveEntity = EntityBase & { kind: 'hive' | 'beebox'; hp: number; honey: number; bees: number; queen: number }
// Farmland: the crop in it (its number in crops.json, 0 for none), how far it has grown (in GROWTH_STEP a random
// tick, more when watered and fertilised), and how watered and how fertilised it is (0 to 100, falling over time).
export type PlotEntity = EntityBase & { kind: 'plot'; hp: number; crop: number; growth: number; water: number; fertility: number }
// A work station, the stump or the workbench (see stations.ts): its tool, input and output slots (STATION_LAYOUT), the
// recipe picked (its index in its station's list, plus one; 0 for none), how many ticks into it it is, and whether it
// is working (1) or waiting for Craft to be pressed (0).
export type StationEntity = EntityBase & { kind: StationKind; hp: number; inv: Inventory; recipe: number; progress: number; active: number }
// A feed trough: what is in it for the animals.
export type FeederEntity = EntityBase & { kind: 'feeder'; hp: number; inv: Inventory }
// A campfire, or an oven (see machines.ts).
export type CampfireEntity = EntityBase & {
  kind: FireKind
  hp: number
  inv: Inventory
  lit: number
  burn: number
  target: number
  heat: number
  cook: number
  burnt: number
}
// A barrel (see machines.ts): its liquid (its number in LIQUIDS, 0 for none) and how many buckets of it, whether it is
// sealed, what it is working on and how far, and the heat it gets from a fire beside it.
export type BarrelEntity = EntityBase & {
  kind: 'barrel'
  hp: number
  inv: Inventory
  liquid: number
  amount: number
  sealed: number
  process: number
  progress: number
  heat: number
  // The heat it gets from a fire over a chunk's edge (see BORDER_HEAT_STEP).
  border: number
}
// A drying rack (see machines.ts).
export type RackEntity = EntityBase & { kind: 'rack'; hp: number; inv: Inventory; progress: number; heat: number; border: number }
// A pedestal: one slot, for anything, which an altar beside it can draw on (see altar.ts).
export type PedestalEntity = EntityBase & { kind: 'pedestal'; hp: number; inv: Inventory }
// An altar (see altar.ts): its one slot, the ritual it is working through (its index in ALTAR_RECIPES, plus one; 0 for
// none) and how far, how long it still glows after one, and what the ritual took from where (its offerings, sent after
// its numbers).
export type AltarEntity = EntityBase & { kind: 'altar'; hp: number; inv: Inventory; recipe: number; progress: number; glow: number; offerings: number[] }

// The machines: buildings whose state is their slots and a row of numbers, in this order (how they are sent, saved
// and hashed), and how many slots each has. A new machine is a kind here, its entity type above, and what it does each
// tick in `stepEntity`.
const STATION_FIELDS = ['hp', 'recipe', 'progress', 'active'] as const
const FIRE_FIELDS = ['hp', 'lit', 'burn', 'target', 'heat', 'cook', 'burnt'] as const
const MACHINE_FIELDS = {
  stump: STATION_FIELDS,
  workbench: STATION_FIELDS,
  carpenter: STATION_FIELDS,
  campfire: FIRE_FIELDS,
  oven: FIRE_FIELDS,
  barrel: ['hp', 'liquid', 'amount', 'sealed', 'process', 'progress', 'heat', 'border'],
  rack: ['hp', 'progress', 'heat', 'border'],
  pedestal: ['hp'],
  altar: ['hp', 'recipe', 'progress', 'glow'],
} as const
export type MachineKind = keyof typeof MACHINE_FIELDS
// How many numbers an altar has before its offerings.
export const ALTAR_NUMBERS = MACHINE_FIELDS.altar.length
export const MACHINE_SLOTS: Readonly<Record<MachineKind, number>> = {
  stump: STATION_LAYOUT.stump.slots,
  workbench: STATION_LAYOUT.workbench.slots,
  carpenter: STATION_LAYOUT.carpenter.slots,
  campfire: CAMPFIRE_SLOTS,
  oven: CAMPFIRE_SLOTS,
  barrel: BARREL_SLOTS,
  rack: RACK_SLOTS,
  pedestal: 1,
  altar: 1,
}
export type MachineEntity = StationEntity | CampfireEntity | BarrelEntity | RackEntity | PedestalEntity | AltarEntity

export function isMachineKind(kind: string): kind is MachineKind {
  return Object.hasOwn(MACHINE_FIELDS, kind)
}

// A crop grows GROWTH_STEP on each random tick, as much again while its plot is watered, and up to that much again for
// being fertilised (in proportion to how much). Watering lasts a set time, WATERED_SECONDS: a plot's water (100 when
// watered) falls a point every WATER_FALL_EVERY ticks, the same on every page (see Chunk.step). Fertility falls
// FERTILITY_FALL a random tick, to nothing.
export const GROWTH_STEP = 10
export const WATERED_SECONDS = 180
export const WATER_FALL_EVERY = Math.round((WATERED_SECONDS * TPS) / 100)
const FERTILITY_FALL = 4

// What a young plant grows into, and how many random ticks it takes.
export const GROWS_INTO = {
  sapling: { kind: 'tree', stages: SAPLING_STAGES },
  sprout: { kind: 'bush', stages: SPROUT_STAGES },
  seedling: { kind: 'sunflower', stages: SEEDLING_STAGES },
  'young-cactus': { kind: 'cactus', stages: CACTUS_STAGES },
} as const
export type Entity =
  | BeltEntity
  | MinerEntity
  | ChestEntity
  | TreeEntity
  | PlantEntity
  | GateEntity
  | SaplingEntity
  | PlotEntity
  | FeederEntity
  | MachineEntity
  | LooseEntity
  | WaystoneEntity
  | HiveEntity

export function isBeltLike(entity: Entity): entity is BeltEntity {
  return entity.kind === 'belt' || entity.kind === 'extractor'
}

// Whether it is a work station (the stump, the workbench: see stations.ts).
export function isStation(entity: Entity): entity is StationEntity {
  return isStationKind(entity.kind)
}

export function hasInventory(entity: Entity): entity is MinerEntity | ChestEntity | FeederEntity | MachineEntity {
  return 'inv' in entity
}

export function isNatural(entity: Entity): entity is TreeEntity | PlantEntity | SaplingEntity | HiveEntity {
  return BUILDINGS[entity.kind].natural
}

// Whether hitting it does anything: a plant or a rock, or something a player put down.
export function isHittable(entity: Entity): boolean {
  return BUILDINGS[entity.kind].natural || BUILDINGS[entity.kind].breakable
}

// The hits something has left in it, or 0 for anything that is not hit.
export function hpOf(entity: Entity): number {
  if ('hp' in entity) return entity.hp
  return isYoungKind(entity.kind) ? 1 : 0
}

// A new building or plant. `ore` is what is under it, which only a miner cares about.
export function createEntity(id: number, kind: BuildingKind, x: number, y: number, dir: Direction, ore: ItemId): Entity {
  const facing = BUILDINGS[kind].rotatable ? dir : 0
  const hp = BUILDINGS[kind].maxHp
  switch (kind) {
    case 'belt':
    case 'extractor':
      return { id, kind, x, y, dir: facing, lane: [], shape: 'straight' }
    case 'miner':
      return { id, kind, x, y, dir: facing, ore, progress: 0, inv: createInventory(MINER_SLOTS) }
    case 'chest':
      return { id, kind, x, y, dir: facing, hp, inv: createInventory(CHEST_SLOTS) }
    case 'tree':
      return { id, kind, x, y, dir: 0, hp, punches: 0 }
    case 'bush':
    case 'rock':
    case 'grass':
    case 'fence':
    case 'bed':
    case 'door':
    case 'well':
    case 'worker':
    case 'dummy':
    case 'sunflower':
    case 'clay':
    case 'copper-rock':
    case 'tin-rock':
    case 'cactus':
    case 'sand':
    case 'cobweb':
    case 'wood-wall':
    case 'wood-floor':
    case 'stone-floor':
    case 'table':
    case 'chair':
    case 'low-table':
    case 'round-table':
    case 'waystone':
      return { id, kind, x, y, dir: 0, hp }
    case 'skeleton-camp':
    case 'goblin-camp':
    case 'tomb':
      return { id, kind, x, y, dir: 0, hp }
    case 'gate':
    case 'wood-door':
      return { id, kind, x, y, dir: 0, hp, mode: 0 }
    case 'loose':
      // What it gives is `ore` (the item), one of it.
      return { id, kind, x, y, dir: 0, item: ore, count: 1 }
    case 'sapling':
    case 'sprout':
    case 'seedling':
    case 'young-cactus':
      return { id, kind, x, y, dir: 0, stage: 0 }
    case 'hive':
      // A wild one has its colony in it; a bee box stands empty until a queen moves in.
      return { id, kind, x, y, dir: 0, hp, honey: 0, bees: BEES.workers, queen: 1 }
    case 'beebox':
      return { id, kind, x, y, dir: 0, hp, honey: 0, bees: 0, queen: 0 }
    case 'plot':
      return { id, kind, x, y, dir: 0, hp, crop: 0, growth: 0, water: 0, fertility: 0 }
    case 'feeder':
      return { id, kind, x, y, dir: 0, hp, inv: createInventory(FEEDER_SLOTS) }
    case 'stump':
    case 'workbench':
    case 'carpenter':
    case 'campfire':
    case 'oven':
    case 'barrel':
    case 'rack':
    case 'pedestal':
    case 'altar':
      return machineFrom(kind, id, x, y, createInventory(MACHINE_SLOTS[kind]), MACHINE_FIELDS[kind].map((field) => (field === 'hp' ? hp : 0)))
  }
}

function machineFrom(kind: MachineKind, id: number, x: number, y: number, inv: Inventory, values: readonly number[]): MachineEntity {
  const machine: Record<string, unknown> = { id, kind, x, y, dir: 0, inv }
  MACHINE_FIELDS[kind].forEach((field, i) => (machine[field] = values[i] ?? 0))
  // An altar's offerings come after its numbers.
  if (kind === 'altar') machine.offerings = values.slice(MACHINE_FIELDS.altar.length)
  return machine as MachineEntity
}

// A machine's state with some of its numbers changed (by name), for a `set` event.
export function withMachine(machine: MachineEntity, changes: Readonly<Record<string, number>>): EntityState {
  const fields: readonly string[] = MACHINE_FIELDS[machine.kind]
  const values = machineValues(machine).map((value, i) => changes[fields[i]] ?? value)
  return { id: machine.id, kind: machine.kind, x: machine.x, y: machine.y, dir: machine.dir, inv: inventoryToWire(machine.inv), n: values }
}

function machineValues(machine: MachineEntity): number[] {
  const values = MACHINE_FIELDS[machine.kind].map((field) => (machine as unknown as Record<string, number>)[field])
  return machine.kind === 'altar' ? [...values, ...machine.offerings] : values
}

// Phase A for one building: what each kind does on its own, without anything around it, by kind. A kind not here only
// changes when something is done to it (or on a random tick: see `randomTick`), and a chunk does not step it at all
// (see `stepsEachTick`), so nearly all of a world (its trees and rocks) costs nothing a tick. A new building that works
// by itself each tick is a step here.
// (An intersection, not Extract: a belt and an extractor share one type whose kind is either.)
export type EntityOf<K extends Entity['kind']> = Entity & { kind: K }
const STEPS: { readonly [K in Entity['kind']]?: (entity: EntityOf<K>) => void } = {
  belt: (belt) => stepLane(belt.lane),
  extractor: (extractor) => stepLane(extractor.lane),
  miner: stepMiner,
  stump: stepStation,
  workbench: stepStation,
  carpenter: stepStation,
  campfire: stepCampfire,
  oven: stepCampfire,
  barrel: stepBarrel,
  rack: stepRack,
  altar: stepAltar,
}

export function stepEntity(entity: Entity): void {
  ;(STEPS[entity.kind] as ((entity: Entity) => void) | undefined)?.(entity)
}

// Whether a chunk steps a kind of building every tick: one with a step (see STEPS), or farmland (its water dries
// on the clock: see Chunk.step).
export function stepsEachTick(kind: Entity['kind']): boolean {
  return STEPS[kind] !== undefined || kind === 'plot'
}

// How many ticks a miner takes to dig one of an item: its `mineTicks`, or MINE_TICKS for one that has none (the
// factory's ores, which had them, are gone).
export const MINE_TICKS = 60
export function mineTicksOf(item: ItemId): number {
  return getItem(item).mineTicks || MINE_TICKS
}

// A miner digs, unless its store is full (it waits until something takes from it).
function stepMiner(miner: MinerEntity): void {
  if (roomFor(miner.inv, miner.ore, 1) === 0) return
  miner.progress++
  if (miner.progress >= mineTicksOf(miner.ore)) {
    miner.progress = 0
    addItems(miner.inv, miner.ore, 1)
  }
}

// A random tick (see RANDOM_TICKS_PER_CHUNK): a crop in a garden
// plot grows (faster watered and fertilised), and the plot dries out and its fertility fades; a sapling, sprout or
// seedling or young cactus grows a stage, and after its last it is a tree, a bush, a sunflower or a cactus, which is given back to be put in its
// place (same ID, same tile).
// Anything else is left as it is.
export function randomTick(entity: Entity): Entity | undefined {
  if (entity.kind === 'plot') {
    const crop = getCrop(entity.crop)
    if (crop && entity.growth < growthNeeded(crop.growTicks)) {
      const step = GROWTH_STEP + (entity.water > 0 ? GROWTH_STEP : 0) + Math.floor((entity.fertility * GROWTH_STEP) / 100)
      entity.growth = Math.min(growthNeeded(crop.growTicks), entity.growth + step)
    }
    entity.fertility = Math.max(0, entity.fertility - FERTILITY_FALL)
    return undefined
  }
  if (entity.kind !== 'sapling' && entity.kind !== 'sprout' && entity.kind !== 'seedling' && entity.kind !== 'young-cactus') return undefined
  const grows = GROWS_INTO[entity.kind]
  entity.stage++
  if (entity.stage < grows.stages) return undefined
  return createEntity(entity.id, grows.kind, entity.x, entity.y, 0, 0)
}

// How much growth a crop needs, from how many plain random ticks it takes.
export function growthNeeded(growTicks: number): number {
  return growTicks * GROWTH_STEP
}

// Whether farmland's crop is fully grown.
export function cropIsGrown(plot: PlotEntity): boolean {
  const crop = getCrop(plot.crop)
  return crop !== undefined && plot.growth >= growthNeeded(crop.growTicks)
}

// Which of a building's slots an item put in by hand can go to, and how many fit in each: a station's tool goes to its
// tool slot and what it works on to its input slots; a campfire (or an oven) takes fuel and what it can cook in their
// own slots; a barrel any
// solid; a drying rack one hide, while nothing else is on it (see rackRefusal). Nothing goes into a machine's output
// slots by hand. Anything else takes whatever fits.
function slotsFor(entity: Entity & { inv: Inventory }, item: ItemId): { slots: readonly number[]; limit: number } | undefined {
  const limit = stackLimit(item, entity.inv.stack)
  if (isStationKind(entity.kind)) {
    const route = stationSlotsFor(entity.kind, item)
    return route ? { slots: route.slots, limit: route.limit ?? limit } : undefined
  }
  switch (entity.kind) {
    case 'campfire':
    case 'oven': {
      // Something that is both fuel and cooked (leaves, which smoke) goes to be cooked first, then on the fire.
      const cooks = cookingOf(item, entity.kind) !== undefined
      if (getItem(item).fuel) return { slots: cooks ? [CAMPFIRE_COOK, CAMPFIRE_FUEL] : [CAMPFIRE_FUEL], limit }
      return cooks ? { slots: [CAMPFIRE_COOK], limit } : undefined
    }
    case 'barrel':
      return { slots: BARREL_SOLIDS, limit }
    case 'rack':
      return rackRefusal(entity, item) === undefined ? { slots: [RACK_INPUT], limit: 1 } : undefined
    case 'pedestal':
    case 'altar':
      // One slot, for anything.
      return { slots: [0], limit }
    default:
      return undefined
  }
}

// Whether a building takes nothing in and gives nothing out for now: a sealed barrel, an altar in the middle of a
// ritual.
export function isClosed(entity: Entity): boolean {
  return (entity.kind === 'barrel' && entity.sealed !== 0) || (entity.kind === 'altar' && entity.recipe !== 0)
}

// How many of `item` slot `index` of a building takes by hand (0: none: not that item, or an output slot, or a sealed
// barrel).
export function slotLimitIn(entity: Entity, index: number, item: ItemId): number {
  if (!hasInventory(entity) || isClosed(entity)) return 0
  if (!entity.inv.slots[index]) return 0
  const route = slotsFor(entity, item)
  if (!route) return entity.kind === 'chest' || entity.kind === 'feeder' || entity.kind === 'miner' ? stackLimit(item, entity.inv.stack) : 0
  return route.slots.includes(index) ? route.limit : 0
}

// How many of `item`, up to `wanted`, a building would take by hand.
export function roomInBuilding(entity: Entity, item: ItemId, wanted: number): number {
  if (!hasInventory(entity)) return 0
  if (isClosed(entity)) return 0
  const route = slotsFor(entity, item)
  if (!route) return entity.kind === 'chest' || entity.kind === 'feeder' || entity.kind === 'miner' ? roomFor(entity.inv, item, wanted) : 0
  let room = 0
  for (const index of route.slots) {
    const slot = entity.inv.slots[index]
    if (slot.count === 0) room += route.limit
    else if (slot.item === item) room += Math.max(0, route.limit - slot.count)
  }
  return Math.min(wanted, room)
}

// Puts up to `count` of `item` into a building, where `roomInBuilding` says it goes: onto stacks of it first, then into
// empty slots. Gives how many went in.
export function addToBuilding(entity: Entity, item: ItemId, count: number): number {
  if (!hasInventory(entity)) return 0
  const route = slotsFor(entity, item)
  if (!route) return roomInBuilding(entity, item, count) > 0 ? addItems(entity.inv, item, count) : 0
  let left = Math.min(count, roomInBuilding(entity, item, count))
  const moved = left
  for (const pass of ['same', 'empty'] as const) {
    for (const index of route.slots) {
      const slot = entity.inv.slots[index]
      if (left === 0) break
      if (pass === 'same' ? slot.count === 0 || slot.item !== item : slot.count !== 0) continue
      const put = Math.min(left, route.limit - slot.count)
      slot.item = item
      slot.count += put
      left -= put
    }
  }
  return moved - left
}

// Takes up to `count` of `item` out of a building. Gives how many came out. A sealed barrel gives nothing.
export function takeFromBuilding(entity: Entity, item: ItemId, count: number): number {
  if (!hasInventory(entity) || isClosed(entity)) return 0
  return removeItems(entity.inv, item, count)
}

// Moves up to `max` of `item` (NO_ITEM: of every kind, in item order) between a player's inventory and a building's, as
// the `take` and `put` commands do: as much as there is, and as fits where it goes. Changes both, and gives each kind
// moved and how many. The server runs it on a copy of the building and sends the moves; the page runs it to show them.
// Put in, it comes out of the player's ordinary slots only, never their food, ammunition, armour or trash slots
// (`putSlots`): unless `fromSlot` is the slot clicked, which goes first, whatever it is.
export function transferItems(player: Inventory, building: Entity, item: ItemId, max: number, way: 'take' | 'put', fromSlot?: number): Array<[ItemId, number]> {
  if (!hasInventory(building)) return []
  const kinds =
    item === NO_ITEM
      ? way === 'take'
        ? inventoryTotals(building.inv).map((total) => total.item)
        : [...new Set(putSlots(player, NO_ITEM, fromSlot).map((index) => player.slots[index].item))].sort((a, b) => a - b)
      : [item]
  const moves: Array<[ItemId, number]> = []
  let left = max
  for (const kind of kinds) {
    if (left === 0) break
    const sources = way === 'put' ? putSlots(player, kind, fromSlot) : []
    const have = way === 'take' ? countOf(building.inv, kind) : sources.reduce((sum, index) => sum + player.slots[index].count, 0)
    const room = way === 'take' ? roomFor(player, kind, left) : roomInBuilding(building, kind, left)
    const count = Math.min(left, have, room)
    if (count <= 0) continue
    // Only what really moves (a sealed barrel gives and takes nothing).
    const moved = way === 'take' ? takeFromBuilding(building, kind, count) : addToBuilding(building, kind, count)
    if (moved <= 0) continue
    if (way === 'take') addItems(player, kind, moved)
    else {
      let out = moved
      for (const index of sources) {
        const slot = player.slots[index]
        const taken = Math.min(out, slot.count)
        slot.count -= taken
        if (slot.count === 0) slot.item = NO_ITEM
        out -= taken
        if (out === 0) break
      }
    }
    moves.push([kind, moved])
    left -= moved
  }
  return moves
}

// The player's slots that items of `kind` (NO_ITEM: any) are put into a building from, in order: the slot clicked
// (`fromSlot`, if it holds some), then their ordinary slots from the last backwards (not the food, ammunition, armour
// or trash slots).
function putSlots(player: Inventory, kind: ItemId, fromSlot?: number): number[] {
  const holds = (index: number): boolean => {
    const slot = player.slots[index]
    return slot !== undefined && slot.count > 0 && (kind === NO_ITEM || slot.item === kind)
  }
  const order: number[] = []
  if (fromSlot !== undefined && holds(fromSlot)) order.push(fromSlot)
  for (let index = player.slots.length - 1; index >= 0; index--) {
    if (index !== fromSlot && player.slots[index].only === undefined && holds(index)) order.push(index)
  }
  return order
}

// A building as it is sent: in a snapshot, or when it is built.
export type EntityState =
  | { id: number; kind: 'belt' | 'extractor'; x: number; y: number; dir: Direction; lane: number[] }
  | { id: number; kind: 'miner'; x: number; y: number; dir: Direction; ore: ItemId; progress: number; inv: number[] }
  | { id: number; kind: 'chest'; x: number; y: number; dir: Direction; hp?: number; inv: number[]; name?: string }
  | { id: number; kind: 'tree'; x: number; y: number; dir: Direction; hp: number; punches: number }
  | { id: number; kind: 'bush' | 'rock' | 'grass' | 'fence' | 'bed' | 'door' | 'well' | 'worker' | 'dummy' | 'sunflower' | 'clay' | 'copper-rock' | 'tin-rock' | 'cactus' | 'sand' | 'cobweb' | 'wood-wall' | 'wood-floor' | 'stone-floor' | 'table' | 'chair' | 'low-table' | 'round-table' | 'skeleton-camp' | 'goblin-camp' | 'tomb'; x: number; y: number; dir: Direction; hp: number }
  | { id: number; kind: 'waystone'; x: number; y: number; dir: Direction; hp: number; name?: string }
  | { id: number; kind: 'gate' | 'wood-door'; x: number; y: number; dir: Direction; hp: number; mode: number }
  | { id: number; kind: 'loose'; x: number; y: number; dir: Direction; item: ItemId; count: number }
  | { id: number; kind: YoungKind; x: number; y: number; dir: Direction; stage: number }
  | { id: number; kind: 'hive' | 'beebox'; x: number; y: number; dir: Direction; hp: number; honey: number; bees: number; queen: number }
  | { id: number; kind: 'plot'; x: number; y: number; dir: Direction; hp: number; crop: number; growth: number; water: number; fertility: number }
  | { id: number; kind: 'feeder'; x: number; y: number; dir: Direction; hp: number; inv: number[] }
  // A machine: its slots, and its numbers in the order of MACHINE_FIELDS.
  | { id: number; kind: MachineKind; x: number; y: number; dir: Direction; inv: number[]; n: number[] }

export function entityToState(entity: Entity): EntityState {
  const { id, x, y, dir } = entity
  switch (entity.kind) {
    case 'belt':
    case 'extractor': {
      const lane: number[] = []
      for (const item of entity.lane) lane.push(item.item, item.pos)
      return { id, kind: entity.kind, x, y, dir, lane }
    }
    case 'miner':
      return { id, kind: 'miner', x, y, dir, ore: entity.ore, progress: entity.progress, inv: inventoryToWire(entity.inv) }
    case 'chest':
      return { id, kind: 'chest', x, y, dir, hp: entity.hp, inv: inventoryToWire(entity.inv), ...(entity.name ? { name: entity.name } : {}) }
    case 'tree':
      return { id, kind: 'tree', x, y, dir, hp: entity.hp, punches: entity.punches }
    case 'bush':
    case 'rock':
    case 'grass':
    case 'fence':
    case 'bed':
    case 'door':
    case 'well':
    case 'worker':
    case 'dummy':
    case 'sunflower':
    case 'clay':
    case 'copper-rock':
    case 'tin-rock':
    case 'cactus':
    case 'sand':
    case 'cobweb':
    case 'wood-wall':
    case 'wood-floor':
    case 'stone-floor':
    case 'table':
    case 'chair':
    case 'low-table':
    case 'round-table':
    case 'skeleton-camp':
    case 'goblin-camp':
    case 'tomb':
      return { id, kind: entity.kind, x, y, dir, hp: entity.hp }
    case 'waystone':
      return { id, kind: 'waystone', x, y, dir, hp: entity.hp, ...(entity.name ? { name: entity.name } : {}) }
    case 'gate':
    case 'wood-door':
      return { id, kind: entity.kind, x, y, dir, hp: entity.hp, mode: entity.mode }
    case 'loose':
      return { id, kind: 'loose', x, y, dir, item: entity.item, count: entity.count }
    case 'sapling':
    case 'sprout':
    case 'seedling':
    case 'young-cactus':
      return { id, kind: entity.kind, x, y, dir, stage: entity.stage }
    case 'hive':
    case 'beebox':
      return { id, kind: entity.kind, x, y, dir, hp: entity.hp, honey: entity.honey, bees: entity.bees, queen: entity.queen }
    case 'plot':
      return { id, kind: 'plot', x, y, dir, hp: entity.hp, crop: entity.crop, growth: entity.growth, water: entity.water, fertility: entity.fertility }
    case 'feeder':
      return { id, kind: 'feeder', x, y, dir, hp: entity.hp, inv: inventoryToWire(entity.inv) }
    case 'stump':
    case 'workbench':
    case 'carpenter':
    case 'campfire':
    case 'oven':
    case 'barrel':
    case 'rack':
    case 'pedestal':
    case 'altar':
      return { id, kind: entity.kind, x, y, dir, inv: inventoryToWire(entity.inv), n: machineValues(entity) }
  }
}

export function entityFromState(state: EntityState): Entity {
  const { id, x, y, dir } = state
  switch (state.kind) {
    case 'belt':
    case 'extractor': {
      const lane: LaneItem[] = []
      for (let i = 0; i + 1 < state.lane.length; i += 2) {
        lane.push({ item: state.lane[i], pos: state.lane[i + 1], prev: state.lane[i + 1] })
      }
      return { id, kind: state.kind, x, y, dir, lane, shape: 'straight' }
    }
    case 'miner':
      return { id, kind: 'miner', x, y, dir, ore: state.ore, progress: state.progress, inv: inventoryFromWire(state.inv) }
    case 'chest': {
      // A chest saved when chests had fewer slots gets the new ones, empty, at the end.
      const inv = inventoryFromWire(state.inv)
      while (inv.slots.length < CHEST_SLOTS) inv.slots.push({ item: NO_ITEM, count: 0 })
      return { id, kind: 'chest', x, y, dir, hp: state.hp ?? BUILDINGS.chest.maxHp, inv, ...(state.name ? { name: state.name } : {}) }
    }
    case 'tree':
      return { id, kind: 'tree', x, y, dir, hp: state.hp, punches: state.punches }
    case 'bush':
    case 'rock':
    case 'grass':
    case 'fence':
    case 'bed':
    case 'door':
    case 'well':
    case 'worker':
    case 'dummy':
    case 'sunflower':
    case 'clay':
    case 'copper-rock':
    case 'tin-rock':
    case 'cactus':
    case 'sand':
    case 'cobweb':
    case 'wood-wall':
    case 'wood-floor':
    case 'stone-floor':
    case 'table':
    case 'chair':
    case 'low-table':
    case 'round-table':
    case 'skeleton-camp':
    case 'goblin-camp':
    case 'tomb':
      return { id, kind: state.kind, x, y, dir, hp: state.hp }
    case 'waystone':
      return { id, kind: 'waystone', x, y, dir, hp: state.hp, ...(state.name ? { name: state.name } : {}) }
    case 'gate':
    case 'wood-door':
      return { id, kind: state.kind, x, y, dir, hp: state.hp, mode: state.mode }
    case 'loose':
      return { id, kind: 'loose', x, y, dir, item: state.item, count: state.count }
    case 'sapling':
    case 'sprout':
    case 'seedling':
    case 'young-cactus':
      return { id, kind: state.kind, x, y, dir, stage: state.stage }
    case 'hive':
    case 'beebox':
      return { id, kind: state.kind, x, y, dir, hp: state.hp, honey: state.honey, bees: state.bees, queen: state.queen }
    case 'plot':
      return { id, kind: 'plot', x, y, dir, hp: state.hp, crop: state.crop, growth: state.growth, water: state.water, fertility: state.fertility }
    case 'feeder':
      return { id, kind: 'feeder', x, y, dir, hp: state.hp, inv: inventoryFromWire(state.inv) }
    case 'stump':
    case 'workbench':
    case 'carpenter':
    case 'campfire':
    case 'oven':
    case 'barrel':
    case 'rack':
    case 'pedestal':
    case 'altar':
      return machineFrom(state.kind, id, x, y, inventoryFromWire(state.inv), state.n)
  }
}

function hashInventory(hasher: Hasher, inventory: Inventory): void {
  hasher.int(inventory.slots.length)
  for (const slot of inventory.slots) hasher.int(slot.item).int(slot.count)
}

// Everything about a building that the simulation reads, in a fixed order.
export function hashEntity(hasher: Hasher, entity: Entity): void {
  hasher.int(entity.id).int(BUILDINGS[entity.kind].code).int(entity.x).int(entity.y).int(entity.dir)
  switch (entity.kind) {
    case 'belt':
    case 'extractor':
      hasher.int(entity.lane.length)
      for (const item of entity.lane) hasher.int(item.item).int(item.pos)
      return
    case 'miner':
      hasher.int(entity.ore).int(entity.progress)
      hashInventory(hasher, entity.inv)
      return
    case 'chest':
      hasher.int(entity.hp)
      hashInventory(hasher, entity.inv)
      return
    case 'tree':
      hasher.int(entity.hp).int(entity.punches)
      return
    case 'bush':
    case 'rock':
    case 'grass':
    case 'fence':
    case 'bed':
    case 'door':
    case 'well':
    case 'worker':
    case 'dummy':
    case 'sunflower':
    case 'clay':
    case 'copper-rock':
    case 'tin-rock':
    case 'cactus':
    case 'sand':
    case 'cobweb':
    case 'wood-wall':
    case 'wood-floor':
    case 'stone-floor':
    case 'table':
    case 'chair':
    case 'low-table':
    case 'round-table':
    case 'skeleton-camp':
    case 'goblin-camp':
    case 'tomb':
    case 'waystone':
      hasher.int(entity.hp)
      return
    case 'gate':
    case 'wood-door':
      hasher.int(entity.hp).int(entity.mode)
      return
    case 'loose':
      hasher.int(entity.item).int(entity.count)
      return
    case 'sapling':
    case 'sprout':
    case 'seedling':
    case 'young-cactus':
      hasher.int(entity.stage)
      return
    case 'hive':
    case 'beebox':
      hasher.int(entity.hp).int(entity.honey).int(entity.bees).int(entity.queen)
      return
    case 'plot':
      hasher.int(entity.hp).int(entity.crop).int(entity.growth).int(entity.water).int(entity.fertility)
      return
    case 'feeder':
      hasher.int(entity.hp)
      hashInventory(hasher, entity.inv)
      return
    case 'stump':
    case 'workbench':
    case 'carpenter':
    case 'campfire':
    case 'oven':
    case 'barrel':
    case 'rack':
    case 'pedestal':
    case 'altar':
      for (const value of machineValues(entity)) hasher.int(value)
      hashInventory(hasher, entity.inv)
      return
  }
}

// A station (the stump, the workbench) makes the recipe picked, again and again while what is in it is enough; it stops
// when it runs out, or has no room for what it makes, or its tool is taken out.
function stepStation(entity: StationEntity): void {
  if (entity.active === 0) return
  const kind: StationKind = entity.kind
  const recipe = STATION_RECIPES[kind][entity.recipe - 1]
  if (!recipe || !stationCan(kind, entity.inv, recipe)) {
    entity.active = 0
    entity.progress = 0
    return
  }
  entity.progress++
  if (entity.progress < recipe.ticks) return
  entity.progress = 0
  stationMake(kind, entity.inv, recipe)
}
