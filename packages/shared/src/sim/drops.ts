import { SUB } from '../constants.ts'
import { chunkOfTile, floorDiv } from '../geometry.ts'
import type { ItemId } from '../items.ts'
import type { Hasher } from './hash.ts'

// An item lying on the ground: what it is, how many, where (in units, anywhere in a tile, not on a grid), and the tick
// it landed on. Drops belong to the chunk they lie in, like buildings, but any number can share a tile. The simulation
// never moves or changes them; only the server does, with world events (a plant dropping something, a player picking
// it up), so every copy of a chunk has the same ones.
export type Drop = { id: number; item: ItemId; count: number; x: number; y: number; born: number }

// The `born` of an item that has lain on the ground since the world was made (flint): it never goes away by itself.
export const NATURAL_DROP_BORN = -1

// A drop as it is sent: [id, item, count, x, y, born].
export type DropState = [number, number, number, number, number, number]

export function dropToState(drop: Drop): DropState {
  return [drop.id, drop.item, drop.count, drop.x, drop.y, drop.born]
}

export function dropFromState(state: DropState): Drop {
  const [id, item, count, x, y, born] = state
  return { id, item, count, x, y, born }
}

export function chunkOfDrop(drop: { x: number; y: number }): number {
  return chunkOfTile(floorDiv(drop.x, SUB), floorDiv(drop.y, SUB))
}

export function hashDrop(hasher: Hasher, drop: Drop): void {
  hasher.int(drop.id).int(drop.item).int(drop.count).int(drop.x).int(drop.y).int(drop.born)
}
