import type { Inventory } from './inventory.ts'
import { getItem, NO_ITEM, type ToolKind } from './items.ts'

// The tool in a slot of an inventory (the picked hotbar slot, for what a player hits with), if it holds one. What a
// tool does when it hits is its weapon's (see weapons.ts).
export function toolIn(inventory: Inventory, slot: number): ToolKind | undefined {
  const held = inventory.slots[slot]
  if (!held || held.count === 0 || held.item === NO_ITEM) return undefined
  return getItem(held.item).tool
}
