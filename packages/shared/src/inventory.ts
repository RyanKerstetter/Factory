import { AMMO_SLOT, ARMOR_SLOT, FOOD_SLOT, PLAYER_SLOTS, STACK_SIZE, TRASH_SLOT } from './constants.ts'
import { ARMOR_SLOTS, getItem, NO_ITEM, stackLimit, type ArmorSlot, type ItemId } from './items.ts'

// An inventory is a row of slots, each holding up to a stack of one kind of item. Every change is made the same
// way on every machine (the same slots in the same order), since a chest's inventory is part of the simulation.
// A slot marked `only: 'ammo'` takes only ammunition (the player's ammunition slot), and one marked with an armour slot
// ('head', 'body', 'feet') only armour worn there; the marks are not sent, but put back on the player's inventory
// wherever one is made (see `playerInventory`). Nothing goes into a marked slot by itself but ammunition into the
// ammunition slot: armour is put on by moving it there. One marked 'trash' takes anything, but only moved there, and
// what is in it is thrown away when another kind of item is put there, or more of its kind than it has room for (see
// `moveBetween`); it does not count as had.
export type Slot = { item: ItemId; count: number; only?: 'ammo' | 'food' | 'trash' | ArmorSlot }
export type Inventory = { slots: Slot[]; stack: number }

export function createInventory(size: number, stack = STACK_SIZE): Inventory {
  return { slots: Array.from({ length: size }, () => ({ item: NO_ITEM, count: 0 })), stack }
}

// Whether a slot (if there is one) holds anything.
export function isFilled(slot: Slot | undefined): slot is Slot {
  return slot !== undefined && slot.count > 0 && slot.item !== NO_ITEM
}

// Whether an item is ammunition (tagged "ammo" in items.json).
export function isAmmo(item: ItemId): boolean {
  return item !== NO_ITEM && getItem(item).tags.includes('ammo')
}

// Whether an item may go in a slot.
export function fitsSlot(slot: Slot, item: ItemId): boolean {
  if (slot.only === undefined || slot.only === 'trash') return true
  if (slot.only === 'ammo') return isAmmo(item)
  if (slot.only === 'food') return isFood(item)
  return item !== NO_ITEM && getItem(item).armor?.slot === slot.only
}

// Whether an item goes into a slot by itself (picked up, crafted, taken from a chest): a plain slot, the ammunition
// slot for ammunition, or the food slot for more of what it already holds; never an armour slot.
function fillsBySelf(slot: Slot, item: ItemId): boolean {
  return slot.only === undefined || (slot.only === 'ammo' && isAmmo(item)) || (slot.only === 'food' && slot.count > 0 && slot.item === item)
}

// Whether an item can be eaten (and so go in the food slot).
export function isFood(item: ItemId): boolean {
  return item !== NO_ITEM && (getItem(item).heals ?? 0) > 0
}

// What a player wears: how many degrees warmer it keeps them, and how much less damage each hit does.
export function wornArmor(inventory: Inventory): { warmth: number; defense: number } {
  let warmth = 0
  let defense = 0
  for (let i = ARMOR_SLOT; i < ARMOR_SLOT + ARMOR_SLOTS.length; i++) {
    const slot = inventory.slots[i]
    const armor = slot && slot.count > 0 ? getItem(slot.item).armor : undefined
    warmth += armor?.warmth ?? 0
    defense += armor?.defense ?? 0
  }
  return { warmth, defense }
}

// The damage a hit does through armour: less by its defense, but never less than 1.
export function damageAfterArmor(damage: number, defense: number): number {
  return Math.max(1, Math.round(damage) - defense)
}

// A player's inventory: `from` (one sent, or an older one of another size) made PLAYER_SLOTS long, with its ammunition,
// armour and food slots marked; or an empty one.
export function playerInventory(from?: Inventory): Inventory {
  const made = createInventory(PLAYER_SLOTS, from?.stack)
  from?.slots.slice(0, PLAYER_SLOTS).forEach((slot, i) => (made.slots[i] = { item: slot.item, count: slot.count }))
  made.slots[AMMO_SLOT].only = 'ammo'
  ARMOR_SLOTS.forEach((part, i) => (made.slots[ARMOR_SLOT + i].only = part))
  made.slots[FOOD_SLOT].only = 'food'
  made.slots[TRASH_SLOT].only = 'trash'
  // Anything that is not ammunition in the ammunition slot (from an older save) is left where it is: it cannot be put
  // back in, only taken out.
  return made
}

// The order slots are filled in for an item: ammunition goes to the ammunition slot first; nothing goes where it
// does not fit.
function fillOrder(inventory: Inventory, item: ItemId): Slot[] {
  const fitting = inventory.slots.filter((slot) => fillsBySelf(slot, item))
  // Ammunition, and more of the food in the food slot, go to their own slot first.
  return isAmmo(item) || isFood(item) ? [...fitting.filter((slot) => slot.only), ...fitting.filter((slot) => !slot.only)] : fitting
}

export function countOf(inventory: Inventory, item: ItemId): number {
  let total = 0
  for (const slot of inventory.slots) if (slot.item === item && slot.only !== 'trash') total += slot.count
  return total
}

// How many of `item`, up to `wanted`, there is room for.
export function roomFor(inventory: Inventory, item: ItemId, wanted = Number.MAX_SAFE_INTEGER): number {
  let room = 0
  const stack = stackLimit(item, inventory.stack)
  for (const slot of inventory.slots) {
    if (!fillsBySelf(slot, item)) continue
    if (slot.count === 0) room += stack
    else if (slot.item === item) room += Math.max(0, stack - slot.count)
    if (room >= wanted) return wanted
  }
  return room
}

// Puts up to `count` of `item` in: first on the stacks of it already there, then in the empty slots, both from the
// first slot on (ammunition from the ammunition slot on). Returns how many went in.
export function addItems(inventory: Inventory, item: ItemId, count: number): number {
  let left = count
  const stack = stackLimit(item, inventory.stack)
  const order = fillOrder(inventory, item)
  for (const slot of order) {
    if (left === 0) break
    if (slot.item === item && slot.count > 0 && slot.count < stack) {
      const moved = Math.min(left, stack - slot.count)
      slot.count += moved
      left -= moved
    }
  }
  for (const slot of order) {
    if (left === 0) break
    if (slot.count === 0) {
      const moved = Math.min(left, stack)
      slot.item = item
      slot.count = moved
      left -= moved
    }
  }
  return count - left
}

// Takes up to `count` of `item` out, from the last slot that has it backwards. Returns how many came out.
export function removeItems(inventory: Inventory, item: ItemId, count: number): number {
  let left = count
  for (let i = inventory.slots.length - 1; i >= 0 && left > 0; i--) {
    const slot = inventory.slots[i]
    if (slot.item !== item || slot.count === 0 || (slot.only !== undefined && slot.only !== 'ammo' && slot.only !== 'food')) continue
    const moved = Math.min(left, slot.count)
    slot.count -= moved
    left -= moved
    if (slot.count === 0) slot.item = NO_ITEM
  }
  return count - left
}

// How many of an item a slot takes (0: it does not take it at all), by slot index.
export type SlotLimit = (index: number, item: ItemId) => number

// A player's (or any plain) inventory's slot limits: a stack, where the item fits.
export function plainLimit(inventory: Inventory): SlotLimit {
  return (index, item) => (inventory.slots[index] && fitsSlot(inventory.slots[index], item) ? stackLimit(item, inventory.stack) : 0)
}

// Moves up to `count` from slot `from` of `source` to slot `to` of `target` (which may be the same inventory): onto an
// empty slot or a stack of its kind, as far as it fits (what does not stays where it was); or, moving a whole stack
// onto one of another kind, swapping the two, if each fits where the other was (onto the trash slot, what was there is
// thrown away instead). `sourceLimit` and `targetLimit` say what each slot takes. Returns whether anything moved.
export function moveBetween(
  source: Inventory,
  from: number,
  sourceLimit: SlotLimit,
  target: Inventory,
  to: number,
  targetLimit: SlotLimit,
  count: number,
): boolean {
  const a = source.slots[from]
  const b = target.slots[to]
  if (!a || !b || a.count === 0 || count <= 0 || (source === target && from === to)) return false
  const moving = Math.min(count, a.count)
  const room = targetLimit(to, a.item)
  if (room === 0) return false
  // Onto the trash: what was in it (another kind) is gone; of the same kind, as much of it as there is no room for
  // beside what comes (so it goes on taking the same thing, keeping only the last of it).
  if (b.only === 'trash' && b.count > 0 && b.item !== a.item) {
    b.count = 0
    b.item = NO_ITEM
  }
  if (b.only === 'trash' && b.count > 0 && b.count + moving > room) {
    b.count = Math.max(0, room - moving)
    if (b.count === 0) b.item = NO_ITEM
  }
  if (b.count === 0 || b.item === a.item) {
    const moved = Math.min(moving, room - b.count)
    if (moved <= 0) return false
    b.item = a.item
    b.count += moved
    a.count -= moved
    if (a.count === 0) a.item = NO_ITEM
    return true
  }
  // Swapping: the whole stack, and each has to fit where the other was.
  if (moving < a.count || a.count > room || b.count > sourceLimit(from, b.item)) return false
  const { item, count: had } = b
  b.item = a.item
  b.count = a.count
  a.item = item
  a.count = had
  return true
}

// ---- some slots of an inventory (a machine's inputs, a station's input slots)

// How many of the items `match` takes are in some slots of an inventory.
export function countIn(inventory: Inventory, indices: readonly number[], match: (item: ItemId) => boolean): number {
  let total = 0
  for (const index of indices) {
    const slot = inventory.slots[index]
    if (slot && slot.count > 0 && match(slot.item)) total += slot.count
  }
  return total
}

// Takes up to `count` of the items `match` takes out of some slots, in their order. Gives how many came out.
export function takeIn(inventory: Inventory, indices: readonly number[], match: (item: ItemId) => boolean, count: number): number {
  let left = count
  for (const index of indices) {
    if (left === 0) break
    const slot = inventory.slots[index]
    if (!slot || slot.count === 0 || !match(slot.item)) continue
    left -= takeFromSlot(inventory, index, left)
  }
  return count - left
}

// Whether `count` more of an item fit in one slot: it is empty, or holds that item with room for them.
export function fitsIn(inventory: Inventory, index: number, item: ItemId, count = 1): boolean {
  const slot = inventory.slots[index]
  return slot !== undefined && (slot.count === 0 || slot.item === item) && slot.count + count <= stackLimit(item, inventory.stack)
}

// Puts `count` of an item into one slot, if they fit there (see fitsIn). Gives whether they did.
export function putIn(inventory: Inventory, index: number, item: ItemId, count: number): boolean {
  if (!fitsIn(inventory, index, item, count)) return false
  const slot = inventory.slots[index]
  slot.item = item
  slot.count += count
  return true
}

// Takes up to `count` out of one slot. Returns how many came out.
export function takeFromSlot(inventory: Inventory, index: number, count: number): number {
  const slot = inventory.slots[index]
  if (!slot || slot.count === 0) return 0
  const taken = Math.min(count, slot.count)
  slot.count -= taken
  if (slot.count === 0) slot.item = NO_ITEM
  return taken
}

// The item in the first slot that has one, which is what is taken out of an inventory by whatever pulls from it.
export function firstItem(inventory: Inventory): ItemId {
  for (const slot of inventory.slots) if (slot.count > 0) return slot.item
  return NO_ITEM
}

// Each kind of item it holds and how many, in item order.
export function inventoryTotals(inventory: Inventory): Array<{ item: ItemId; count: number }> {
  const totals = new Map<ItemId, number>()
  for (const slot of inventory.slots) {
    if (slot.count > 0) totals.set(slot.item, (totals.get(slot.item) ?? 0) + slot.count)
  }
  return [...totals.entries()].sort((a, b) => a[0] - b[0]).map(([item, count]) => ({ item, count }))
}

// As it is sent: the item and count of each slot in turn.
export function inventoryToWire(inventory: Inventory): number[] {
  const wire: number[] = []
  for (const slot of inventory.slots) wire.push(slot.item, slot.count)
  return wire
}

export function inventoryFromWire(wire: readonly number[], stack = STACK_SIZE): Inventory {
  const slots: Slot[] = []
  for (let i = 0; i + 1 < wire.length; i += 2) {
    const count = wire[i + 1]
    slots.push({ item: count > 0 ? wire[i] : NO_ITEM, count })
  }
  return { slots, stack }
}

export function cloneInventory(inventory: Inventory): Inventory {
  return { slots: inventory.slots.map((slot) => ({ ...slot })), stack: inventory.stack }
}
