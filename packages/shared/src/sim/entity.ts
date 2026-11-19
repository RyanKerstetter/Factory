import { BUILDINGS, type BuildingKind } from '../buildings.ts'
import { CHEST_SLOTS, FEEDER_SLOTS, MINER_SLOTS, SAPLING_STAGES, SPROUT_STAGES, TREE_STICK_REGROW, TREE_STICKS } from '../constants.ts'
import { getCrop } from '../crops.ts'
import type { Direction } from '../geometry.ts'
import { addItems, createInventory, inventoryFromWire, inventoryToWire, removeItems, roomFor, type Inventory } from '../inventory.ts'
import { getItem, stackLimit, type ItemId } from '../items.ts'
import {
  BARREL_SLOTS,
  BARREL_SOLIDS,
  CAMPFIRE_COOK,
  CAMPFIRE_FUEL,
  CAMPFIRE_SLOTS,
  RACK_INPUT,
  RACK_SLOTS,
  rackRecipe,
  stepBarrel,
  stepCampfire,
  stepRack,
} from '../machines.ts'
import {
  STATION_INPUT_SLOT,
  STATION_OUTPUT_SLOT,
  STATION_RECIPES,
  STATION_SLOTS,
  stationRecipe,
  stationSlotFor,
  WORKBENCH_INPUT_SLOTS,
  WORKBENCH_SLOTS,
  workbenchCan,
  workbenchMake,
} from '../stations.ts'
import { stepLane, type BeltShape, type LaneItem } from './belt.ts'
import type { Hasher } from './hash.ts'

// A building or a plant in the simulation. Its state is plain data, so it can be hashed, sent and copied.
type EntityBase = { id: number; x: number; y: number; dir: Direction }

// A belt or an extractor (a belt that also pulls from the inventory behind it, through a link like any other).
// `shape` follows from the links into it (see `FactoryWorld.refreshShape`), so it is not sent or hashed.
export type BeltEntity = EntityBase & { kind: 'belt' | 'extractor'; lane: LaneItem[]; shape: BeltShape }
export type MinerEntity = EntityBase & { kind: 'miner'; ore: ItemId; progress: number; inv: Inventory }
export type ChestEntity = EntityBase & { kind: 'chest'; hp: number; inv: Inventory }
// A bush, a rock, a tuft of grass or a fence, with the hits it has left in it.
export type PlantEntity = EntityBase & { kind: 'bush' | 'rock' | 'grass' | 'fence'; hp: number }
// Something stuck in the ground, to be knocked loose by a hit: a piece of flint, a thrown spear. `item` and `count` are
// what it gives.
export type LooseEntity = EntityBase & { kind: 'loose'; item: ItemId; count: number }
// A gate, and its mode (GATE_AUTO, GATE_OPEN or GATE_SHUT: see fences.ts).
export type GateEntity = EntityBase & { kind: 'gate'; hp: number; mode: number }
// A tree: the chopping it has left in it, the sticks on it (up to TREE_STICKS), the punches towards knocking the next
// one loose, and its random ticks towards growing one back (TREE_STICK_REGROW of them).
export type TreeEntity = EntityBase & { kind: 'tree'; hp: number; sticks: number; punches: number; regrow: number }
// A sapling or a berry sprout, which grows a stage on each of its random ticks and becomes a tree (after
// SAPLING_STAGES) or a bush (after SPROUT_STAGES).
export type SaplingEntity = EntityBase & { kind: 'sapling' | 'sprout'; stage: number }
// A garden plot: the crop in it (its number in crops.json, 0 for none), how far it has grown (in GROWTH_STEP a random
// tick, more when watered and fertilised), and how watered and how fertilised it is (0 to 100, falling over time).
export type PlotEntity = EntityBase & { kind: 'plot'; hp: number; crop: number; growth: number; water: number; fertility: number }
// The stump (see stations.ts): its tool, input and output slots, how many ticks into the recipe it is, and whether it is
// working (1) or waiting for Craft to be pressed (0).
export type StationEntity = EntityBase & { kind: 'stump'; hp: number; inv: Inventory; progress: number; active: number }
// A feed box: what is in it for the animals.
export type FeederEntity = EntityBase & { kind: 'feeder'; hp: number; inv: Inventory }
// The workbench: its three input slots and output slot, the recipe picked (its index in stations.json, plus one; 0 for
// none), whether to keep making it, how far into it it is, and whether it is working.
export type WorkbenchEntity = EntityBase & { kind: 'workbench'; hp: number; inv: Inventory; recipe: number; repeat: number; progress: number; active: number }
// A campfire (see machines.ts).
export type CampfireEntity = EntityBase & {
  kind: 'campfire'
  hp: number
  inv: Inventory
  lit: number
  burn: number
  target: number
  heat: number
  cook: number
  burnt: number
}
// A barrel (see machines.ts): its liquid (LIQUID_NONE, _WATER, _TANNIN) and how many buckets of it, whether it is
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

// The machines whose state is their slots and a row of numbers, in this order (how they are sent and hashed).
const MACHINE_FIELDS = {
  workbench: ['hp', 'recipe', 'repeat', 'progress', 'active'],
  campfire: ['hp', 'lit', 'burn', 'target', 'heat', 'cook', 'burnt'],
  barrel: ['hp', 'liquid', 'amount', 'sealed', 'process', 'progress', 'heat', 'border'],
  rack: ['hp', 'progress', 'heat', 'border'],
} as const
type MachineKind = keyof typeof MACHINE_FIELDS
export type MachineEntity = WorkbenchEntity | CampfireEntity | BarrelEntity | RackEntity

// A crop grows GROWTH_STEP on each random tick, and up to that much again each for being watered and being fertilised
// (in proportion to how much). Water falls WATER_FALL a random tick and fertility FERTILITY_FALL, to nothing.
export const GROWTH_STEP = 10
const WATER_FALL = 8
const FERTILITY_FALL = 4

// What a young plant grows into, and how many random ticks it takes.
export const GROWS_INTO = {
  sapling: { kind: 'tree', stages: SAPLING_STAGES },
  sprout: { kind: 'bush', stages: SPROUT_STAGES },
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
  | StationEntity
  | FeederEntity
  | MachineEntity
  | LooseEntity

export function isBeltLike(entity: Entity): entity is BeltEntity {
  return entity.kind === 'belt' || entity.kind === 'extractor'
}

export function isMachine(entity: Entity): entity is MachineEntity {
  return entity.kind in MACHINE_FIELDS
}

export function hasInventory(entity: Entity): entity is MinerEntity | ChestEntity | StationEntity | FeederEntity | MachineEntity {
  return 'inv' in entity
}

export function isNatural(entity: Entity): entity is TreeEntity | PlantEntity | SaplingEntity {
  return BUILDINGS[entity.kind].natural
}

// Whether hitting it does anything: a plant or a rock, or something a player put down.
export function isHittable(entity: Entity): boolean {
  return BUILDINGS[entity.kind].natural || BUILDINGS[entity.kind].breakable
}

// The hits something has left in it, or 0 for anything that is not hit.
export function hpOf(entity: Entity): number {
  if ('hp' in entity) return entity.hp
  return entity.kind === 'sapling' || entity.kind === 'sprout' ? 1 : 0
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
      return { id, kind, x, y, dir: 0, hp, sticks: TREE_STICKS, punches: 0, regrow: 0 }
    case 'bush':
    case 'rock':
    case 'grass':
    case 'fence':
      return { id, kind, x, y, dir: 0, hp }
    case 'gate':
      return { id, kind, x, y, dir: 0, hp, mode: 0 }
    case 'loose':
      // What it gives is `ore` (the item), one of it.
      return { id, kind, x, y, dir: 0, item: ore, count: 1 }
    case 'sapling':
    case 'sprout':
      return { id, kind, x, y, dir: 0, stage: 0 }
    case 'plot':
      return { id, kind, x, y, dir: 0, hp, crop: 0, growth: 0, water: 0, fertility: 0 }
    case 'stump':
      return { id, kind, x, y, dir: 0, hp, inv: createInventory(STATION_SLOTS), progress: 0, active: 0 }
    case 'feeder':
      return { id, kind, x, y, dir: 0, hp, inv: createInventory(FEEDER_SLOTS) }
    case 'workbench':
    case 'campfire':
    case 'barrel':
    case 'rack': {
      const slots = { workbench: WORKBENCH_SLOTS, campfire: CAMPFIRE_SLOTS, barrel: BARREL_SLOTS, rack: RACK_SLOTS }[kind]
      return machineFrom(kind, id, x, y, createInventory(slots), MACHINE_FIELDS[kind].map((field) => (field === 'hp' ? hp : 0)))
    }
  }
}

function machineFrom(kind: MachineKind, id: number, x: number, y: number, inv: Inventory, values: readonly number[]): MachineEntity {
  const machine: Record<string, unknown> = { id, kind, x, y, dir: 0, inv }
  MACHINE_FIELDS[kind].forEach((field, i) => (machine[field] = values[i] ?? 0))
  return machine as MachineEntity
}

// A machine's state with some of its numbers changed (by name), for a `set` event.
export function withMachine(machine: MachineEntity, changes: Readonly<Record<string, number>>): EntityState {
  const fields: readonly string[] = MACHINE_FIELDS[machine.kind]
  const values = machineValues(machine).map((value, i) => changes[fields[i]] ?? value)
  return { id: machine.id, kind: machine.kind, x: machine.x, y: machine.y, dir: machine.dir, inv: inventoryToWire(machine.inv), n: values }
}

function machineValues(machine: MachineEntity): number[] {
  return MACHINE_FIELDS[machine.kind].map((field) => (machine as unknown as Record<string, number>)[field])
}

// Phase A for one building: what it does on its own, without anything around it.
export function stepEntity(entity: Entity): void {
  switch (entity.kind) {
    case 'belt':
    case 'extractor':
      stepLane(entity.lane)
      return
    case 'miner': {
      // A miner with a full store stops digging until something takes from it.
      if (roomFor(entity.inv, entity.ore, 1) === 0) return
      entity.progress++
      if (entity.progress >= getItem(entity.ore).mineTicks) {
        entity.progress = 0
        addItems(entity.inv, entity.ore, 1)
      }
      return
    }
    case 'stump': {
      // A working station stops when it runs out of input or room, or its tool is taken out.
      if (entity.active === 0) return
      const recipe = stationRecipe(entity.kind, entity.inv)
      if (!recipe) {
        entity.active = 0
        entity.progress = 0
        return
      }
      entity.progress++
      if (entity.progress < recipe.ticks) return
      entity.progress = 0
      const input = entity.inv.slots[STATION_INPUT_SLOT]
      const output = entity.inv.slots[STATION_OUTPUT_SLOT]
      input.count -= recipe.inputs[0][1]
      if (input.count === 0) input.item = 0
      output.item = recipe.output
      output.count += recipe.count
      return
    }
    case 'workbench': {
      // It makes the recipe picked, again and again while what is in it is enough.
      if (entity.active === 0) return
      const recipe = STATION_RECIPES.workbench[entity.recipe - 1]
      if (!recipe || !workbenchCan(entity.inv, recipe)) {
        entity.active = 0
        entity.progress = 0
        return
      }
      entity.progress++
      if (entity.progress < recipe.ticks) return
      entity.progress = 0
      workbenchMake(entity.inv, recipe)
      return
    }
    case 'campfire':
      stepCampfire(entity)
      return
    case 'barrel':
      stepBarrel(entity)
      return
    case 'rack':
      stepRack(entity)
      return
    case 'chest':
    case 'tree':
    case 'bush':
    case 'rock':
    case 'grass':
    case 'loose':
    case 'fence':
    case 'gate':
    case 'sapling':
    case 'sprout':
    case 'plot':
    case 'feeder':
      return
  }
}

// A random tick (see RANDOM_TICKS_PER_CHUNK): a tree short of sticks grows towards its next one; a crop in a garden
// plot grows (faster watered and fertilised), and the plot dries out and its fertility fades; a sapling or sprout grows
// a stage, and after its last it is a tree or a bush, which is given back to be put in its place (same ID, same tile).
// Anything else is left as it is.
export function randomTick(entity: Entity): Entity | undefined {
  if (entity.kind === 'tree') {
    if (entity.sticks >= TREE_STICKS) return undefined
    entity.regrow++
    if (entity.regrow >= TREE_STICK_REGROW) {
      entity.regrow = 0
      entity.sticks++
    }
    return undefined
  }
  if (entity.kind === 'plot') {
    const crop = getCrop(entity.crop)
    if (crop && entity.growth < growthNeeded(crop.growTicks)) {
      const step = GROWTH_STEP + Math.floor((entity.water * GROWTH_STEP) / 100) + Math.floor((entity.fertility * GROWTH_STEP) / 100)
      entity.growth = Math.min(growthNeeded(crop.growTicks), entity.growth + step)
    }
    entity.water = Math.max(0, entity.water - WATER_FALL)
    entity.fertility = Math.max(0, entity.fertility - FERTILITY_FALL)
    return undefined
  }
  if (entity.kind !== 'sapling' && entity.kind !== 'sprout') return undefined
  const grows = GROWS_INTO[entity.kind]
  entity.stage++
  if (entity.stage < grows.stages) return undefined
  return createEntity(entity.id, grows.kind, entity.x, entity.y, 0, 0)
}

// How much growth a crop needs, from how many plain random ticks it takes.
export function growthNeeded(growTicks: number): number {
  return growTicks * GROWTH_STEP
}

// Whether a garden plot's crop is fully grown.
export function cropIsGrown(plot: PlotEntity): boolean {
  const crop = getCrop(plot.crop)
  return crop !== undefined && plot.growth >= growthNeeded(crop.growTicks)
}

// Which of a building's slots an item put in by hand can go to, and how many fit in each: a station's tool goes to its
// tool slot and what it works on to its input slots; a campfire takes fuel and food in their own slots; a barrel any
// solid; a drying rack one hide. Nothing goes into a machine's output slots by hand. Anything else takes whatever fits.
function slotsFor(entity: Entity & { inv: Inventory }, item: ItemId): { slots: readonly number[]; limit: number } | undefined {
  const limit = stackLimit(item, entity.inv.stack)
  switch (entity.kind) {
    case 'stump': {
      const slot = stationSlotFor(entity.kind, item)
      return slot === undefined ? undefined : { slots: [slot], limit }
    }
    case 'workbench':
      return { slots: WORKBENCH_INPUT_SLOTS, limit }
    case 'campfire': {
      const def = getItem(item)
      if (def.fuel) return { slots: [CAMPFIRE_FUEL], limit }
      return def.cooks ? { slots: [CAMPFIRE_COOK], limit } : undefined
    }
    case 'barrel':
      return { slots: BARREL_SOLIDS, limit }
    case 'rack':
      return rackRecipe(item) ? { slots: [RACK_INPUT], limit: 1 } : undefined
    default:
      return undefined
  }
}

// How many of `item` slot `index` of a building takes by hand (0: none: not that item, or an output slot, or a sealed
// barrel).
export function slotLimitIn(entity: Entity, index: number, item: ItemId): number {
  if (!hasInventory(entity) || (entity.kind === 'barrel' && entity.sealed)) return 0
  if (!entity.inv.slots[index]) return 0
  const route = slotsFor(entity, item)
  if (!route) return entity.kind === 'chest' || entity.kind === 'feeder' || entity.kind === 'miner' ? stackLimit(item, entity.inv.stack) : 0
  return route.slots.includes(index) ? route.limit : 0
}

// How many of `item`, up to `wanted`, a building would take by hand.
export function roomInBuilding(entity: Entity, item: ItemId, wanted: number): number {
  if (!hasInventory(entity)) return 0
  if (entity.kind === 'barrel' && entity.sealed) return 0
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
  if (!hasInventory(entity) || (entity.kind === 'barrel' && entity.sealed)) return 0
  return removeItems(entity.inv, item, count)
}

// A building as it is sent: in a snapshot, or when it is built.
export type EntityState =
  | { id: number; kind: 'belt' | 'extractor'; x: number; y: number; dir: Direction; lane: number[] }
  | { id: number; kind: 'miner'; x: number; y: number; dir: Direction; ore: ItemId; progress: number; inv: number[] }
  | { id: number; kind: 'chest'; x: number; y: number; dir: Direction; hp?: number; inv: number[] }
  | { id: number; kind: 'tree'; x: number; y: number; dir: Direction; hp: number; sticks: number; punches: number; regrow: number }
  | { id: number; kind: 'bush' | 'rock' | 'grass' | 'fence'; x: number; y: number; dir: Direction; hp: number }
  | { id: number; kind: 'gate'; x: number; y: number; dir: Direction; hp: number; mode: number }
  | { id: number; kind: 'loose'; x: number; y: number; dir: Direction; item: ItemId; count: number }
  | { id: number; kind: 'sapling' | 'sprout'; x: number; y: number; dir: Direction; stage: number }
  | { id: number; kind: 'plot'; x: number; y: number; dir: Direction; hp: number; crop: number; growth: number; water: number; fertility: number }
  | { id: number; kind: 'stump'; x: number; y: number; dir: Direction; hp: number; inv: number[]; progress: number; active: number }
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
      return { id, kind: 'chest', x, y, dir, hp: entity.hp, inv: inventoryToWire(entity.inv) }
    case 'tree':
      return { id, kind: 'tree', x, y, dir, hp: entity.hp, sticks: entity.sticks, punches: entity.punches, regrow: entity.regrow }
    case 'bush':
    case 'rock':
    case 'grass':
    case 'fence':
      return { id, kind: entity.kind, x, y, dir, hp: entity.hp }
    case 'gate':
      return { id, kind: 'gate', x, y, dir, hp: entity.hp, mode: entity.mode }
    case 'loose':
      return { id, kind: 'loose', x, y, dir, item: entity.item, count: entity.count }
    case 'sapling':
    case 'sprout':
      return { id, kind: entity.kind, x, y, dir, stage: entity.stage }
    case 'plot':
      return { id, kind: 'plot', x, y, dir, hp: entity.hp, crop: entity.crop, growth: entity.growth, water: entity.water, fertility: entity.fertility }
    case 'stump':
      return { id, kind: 'stump', x, y, dir, hp: entity.hp, inv: inventoryToWire(entity.inv), progress: entity.progress, active: entity.active }
    case 'feeder':
      return { id, kind: 'feeder', x, y, dir, hp: entity.hp, inv: inventoryToWire(entity.inv) }
    case 'workbench':
    case 'campfire':
    case 'barrel':
    case 'rack':
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
    case 'chest':
      return { id, kind: 'chest', x, y, dir, hp: state.hp ?? BUILDINGS.chest.maxHp, inv: inventoryFromWire(state.inv) }
    case 'tree':
      return { id, kind: 'tree', x, y, dir, hp: state.hp, sticks: state.sticks, punches: state.punches, regrow: state.regrow }
    case 'bush':
    case 'rock':
    case 'grass':
    case 'fence':
      return { id, kind: state.kind, x, y, dir, hp: state.hp }
    case 'gate':
      return { id, kind: 'gate', x, y, dir, hp: state.hp, mode: state.mode }
    case 'loose':
      return { id, kind: 'loose', x, y, dir, item: state.item, count: state.count }
    case 'sapling':
    case 'sprout':
      return { id, kind: state.kind, x, y, dir, stage: state.stage }
    case 'plot':
      return { id, kind: 'plot', x, y, dir, hp: state.hp, crop: state.crop, growth: state.growth, water: state.water, fertility: state.fertility }
    case 'stump':
      return { id, kind: 'stump', x, y, dir, hp: state.hp, inv: inventoryFromWire(state.inv), progress: state.progress, active: state.active }
    case 'feeder':
      return { id, kind: 'feeder', x, y, dir, hp: state.hp, inv: inventoryFromWire(state.inv) }
    case 'workbench':
    case 'campfire':
    case 'barrel':
    case 'rack':
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
      hasher.int(entity.hp).int(entity.sticks).int(entity.punches).int(entity.regrow)
      return
    case 'bush':
    case 'rock':
    case 'grass':
    case 'fence':
      hasher.int(entity.hp)
      return
    case 'gate':
      hasher.int(entity.hp).int(entity.mode)
      return
    case 'loose':
      hasher.int(entity.item).int(entity.count)
      return
    case 'sapling':
    case 'sprout':
      hasher.int(entity.stage)
      return
    case 'plot':
      hasher.int(entity.hp).int(entity.crop).int(entity.growth).int(entity.water).int(entity.fertility)
      return
    case 'stump':
      hasher.int(entity.hp).int(entity.progress).int(entity.active)
      hashInventory(hasher, entity.inv)
      return
    case 'feeder':
      hasher.int(entity.hp)
      hashInventory(hasher, entity.inv)
      return
    case 'workbench':
    case 'campfire':
    case 'barrel':
    case 'rack':
      for (const value of machineValues(entity)) hasher.int(value)
      hashInventory(hasher, entity.inv)
      return
  }
}
