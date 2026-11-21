import {
  addItems,
  cloneInventory,
  countOf,
  addToBuilding,
  craftIn,
  getRecipe,
  roomInBuilding,
  takeFromBuilding,
  type Entity,
  getItem,
  hasInventory,
  inventoryTotals,
  moveSlot,
  moveBetween,
  plainLimit,
  slotLimitIn,
  NO_ITEM,
  removeItems,
  roomFor,
  takeFromSlot,
  type BuildingKind,
  type Command,
  type Direction,
  type FactoryWorld,
  type Inventory,
  type ItemId,
} from '../../../packages/shared/src/index.ts'

// What the player has asked for and the server has not answered yet, drawn over the world so the page answers at
// once: a building or sapling asked for is drawn as a ghost, one being taken away is drawn faded, a plant punched is
// shown a punch weaker, and items taken, put, moved, planted or crafted are shown already gone where they are going. None of it touches the simulation. Each command is dropped from here when its result is
// simulated (FactoryMirror's onResult), at which point the real thing has taken its place.
type Pending = { seq: number; command: Command; sentAt: number }

// A command whose result never comes (the page fell far behind, say) stops being drawn after this long.
const FORGET_AFTER_MS = 15_000

export class Prediction {
  private readonly pending = new Map<number, Pending>()

  get size(): number {
    return this.pending.size
  }

  // When the oldest command still waiting for its answer was sent (undefined with none waiting).
  oldestSentAt(): number | undefined {
    let oldest: number | undefined
    for (const pending of this.pending.values()) if (oldest === undefined || pending.sentAt < oldest) oldest = pending.sentAt
    return oldest
  }

  add(seq: number, command: Command, now: number): void {
    this.pending.set(seq, { seq, command, sentAt: now })
  }

  settle(seq: number): void {
    this.pending.delete(seq)
  }

  expire(now: number): void {
    for (const [seq, pending] of this.pending) if (now - pending.sentAt > FORGET_AFTER_MS) this.pending.delete(seq)
  }

  // The buildings and saplings asked for. A planting is shown as what it places; `player` is the inventory as the
  // server last said, to know what that is.
  builds(player: Inventory): Array<{ kind: BuildingKind; x: number; y: number; dir: Direction }> {
    const builds: Array<{ kind: BuildingKind; x: number; y: number; dir: Direction }> = []
    const inventory = cloneInventory(player)
    for (const { command } of this.pending.values()) {
      if (command.k === 'build') builds.push({ kind: command.kind, x: command.x, y: command.y, dir: command.dir })
      if (command.k !== 'place') continue
      const held = inventory.slots[command.slot]
      const kind = held && held.count > 0 ? getItem(held.item).places : undefined
      if (kind) builds.push({ kind, x: command.x, y: command.y, dir: 0 })
      takeFromSlot(inventory, command.slot, 1)
    }
    return builds
  }

  occupies(x: number, y: number): boolean {
    for (const { command } of this.pending.values()) {
      if ((command.k === 'build' || command.k === 'place') && command.x === x && command.y === y) return true
    }
    return false
  }

  // How many punches at a plant are waiting for an answer.
  punchesAt(id: number): number {
    let count = 0
    for (const { command } of this.pending.values()) if (command.k === 'punch' && command.id === id) count++
    return count
  }

  removals(): Set<number> {
    const ids = new Set<number>()
    for (const { command } of this.pending.values()) if (command.k === 'remove') ids.add(command.id)
    return ids
  }

  // The player's inventory and the inventories of buildings, as they will be once the takes and puts waiting for an
  // answer have run (as near as the page can tell: the server has the last word).
  predictInventories(player: Inventory, world: FactoryWorld): { player: Inventory; buildings: Map<number, Inventory> } {
    const predicted = { player: cloneInventory(player), buildings: new Map<number, Inventory>() }
    // An inventory by slot owner (0 the player, else a building's ID), copied from the world the first time, and what
    // each of its slots takes.
    const side = (id: number): { inv: Inventory; limit: (index: number, item: ItemId) => number } | undefined => {
      if (id === 0) return { inv: predicted.player, limit: plainLimit(predicted.player) }
      const entity = world.entity(id)
      if (!entity || !hasInventory(entity)) return undefined
      let inv = predicted.buildings.get(id)
      if (!inv) {
        inv = cloneInventory(entity.inv)
        predicted.buildings.set(id, inv)
      }
      const copy = { ...entity, inv } as Entity
      return { inv, limit: (index, item) => slotLimitIn(copy, index, item) }
    }
    for (const { command } of this.pending.values()) {
      if (command.k === 'move') {
        moveSlot(predicted.player, command.from, command.to)
        continue
      }
      if (command.k === 'slot') {
        const from = side(command.from.id)
        const to = side(command.to.id)
        if (from && to) moveBetween(from.inv, command.from.i, from.limit, to.inv, command.to.i, to.limit, command.count)
        continue
      }
      if (command.k === 'drop') {
        const from = side(command.from.id)
        if (from) takeFromSlot(from.inv, command.from.i, command.count)
        continue
      }
      if (command.k === 'place') {
        takeFromSlot(predicted.player, command.slot, 1)
        continue
      }
      if (command.k === 'craft') {
        const recipe = getRecipe(command.recipe)
        if (recipe) craftIn(predicted.player, recipe)
        continue
      }
      if (command.k !== 'take' && command.k !== 'put') continue
      const entity = world.entity(command.id)
      if (!entity || !hasInventory(entity)) continue
      let inventory = predicted.buildings.get(command.id)
      if (!inventory) {
        inventory = cloneInventory(entity.inv)
        predicted.buildings.set(command.id, inventory)
      }
      // The building as it will be, so a station puts each item in its own slot.
      const building = { ...entity, inv: inventory } as Entity & { inv: Inventory }
      if (command.k === 'take') transfer(predicted.player, command.item, command.max, building, 'take')
      else transfer(predicted.player, command.item, command.max, building, 'put')
    }
    return predicted
  }
}

// Moves items between the player and a building, as the server's take and put do.
function transfer(player: Inventory, item: ItemId, max: number, building: Entity & { inv: Inventory }, way: 'take' | 'put'): void {
  const from = way === 'take' ? building.inv : player
  const items = item === NO_ITEM ? inventoryTotals(from).map((total) => total.item) : [item]
  let left = max
  for (const kind of items) {
    const room = way === 'take' ? roomFor(player, kind, left) : roomInBuilding(building, kind, left)
    const count = Math.min(left, countOf(from, kind), room)
    if (count <= 0) continue
    // Only what really moves (a sealed barrel gives and takes nothing), so nothing is shown moving that will not.
    const moved = way === 'take' ? takeFromBuilding(building, kind, count) : addToBuilding(building, kind, count)
    if (way === 'take') addItems(player, kind, moved)
    else removeItems(player, kind, moved)
    left -= moved
  }
}
