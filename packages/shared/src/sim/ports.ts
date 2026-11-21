import { addItems, firstItem, removeItems, roomFor } from '../inventory.ts'
import { NO_ITEM, type ItemId } from '../items.ts'
import { entryPosition, insertIntoLane, laneHasRoomAt, takeWaiting, waitingItem, type Entry } from './belt.ts'
import type { Entity } from './entity.ts'

// A building's ports: the only way anything gets from one building to another. Each building has an output port
// (what it offers to whatever it is linked to) and an input port (what it will take in). A link moves one item from
// an output port to an input port in phase B, and nothing else ever reaches into another building's state.

// What the building offers, or NO_ITEM: the item waiting at the end of a belt, or the first item in an inventory.
export function offered(entity: Entity): ItemId {
  switch (entity.kind) {
    case 'belt':
    case 'extractor':
      return waitingItem(entity.lane)
    case 'miner':
    case 'chest':
      return firstItem(entity.inv)
    case 'tree':
    case 'bush':
    case 'sapling':
    case 'sprout':
    case 'rock':
    case 'grass':
    case 'loose':
    case 'fence':
    case 'bed':
    case 'door':
    case 'gate':
    case 'plot':
    case 'stump':
    case 'feeder':
    case 'workbench':
    case 'campfire':
    case 'barrel':
    case 'rack':
      return NO_ITEM
  }
}

// Takes the offered item out, and gives how far it moved this tick (see `insertIntoLane`).
export function takeOffered(entity: Entity): number {
  switch (entity.kind) {
    case 'belt':
    case 'extractor':
      return takeWaiting(entity.lane)
    case 'miner':
    case 'chest': {
      const item = firstItem(entity.inv)
      if (item !== NO_ITEM) removeItems(entity.inv, item, 1)
      return 0
    }
    case 'tree':
    case 'bush':
    case 'sapling':
    case 'sprout':
    case 'rock':
    case 'grass':
    case 'loose':
    case 'fence':
    case 'bed':
    case 'door':
    case 'gate':
    case 'plot':
    case 'stump':
    case 'feeder':
    case 'workbench':
    case 'campfire':
    case 'barrel':
    case 'rack':
      return 0
  }
}

// Whether the building would take `item` in from `entry` now.
export function accepts(entity: Entity, item: ItemId, entry: Entry): boolean {
  switch (entity.kind) {
    case 'belt':
    case 'extractor':
      return laneHasRoomAt(entity.lane, entryPosition(entity.shape, entry))
    case 'chest':
      return roomFor(entity.inv, item, 1) > 0
    case 'miner':
    case 'tree':
    case 'bush':
    case 'sapling':
    case 'sprout':
    case 'rock':
    case 'grass':
    case 'loose':
    case 'fence':
    case 'bed':
    case 'door':
    case 'gate':
    case 'plot':
    case 'stump':
    case 'feeder':
    case 'workbench':
    case 'campfire':
    case 'barrel':
    case 'rack':
      return false
  }
}

// Puts `item` in. Only called when `accepts` said yes (here, or on the server, which sent the result).
export function receive(entity: Entity, item: ItemId, entry: Entry, carry: number): void {
  switch (entity.kind) {
    case 'belt':
    case 'extractor':
      insertIntoLane(entity.lane, item, entryPosition(entity.shape, entry), carry)
      return
    case 'chest':
      addItems(entity.inv, item, 1)
      return
    case 'miner':
    case 'tree':
    case 'bush':
    case 'sapling':
    case 'sprout':
    case 'rock':
    case 'grass':
    case 'loose':
    case 'fence':
    case 'bed':
    case 'door':
    case 'gate':
    case 'plot':
    case 'stump':
    case 'feeder':
    case 'workbench':
    case 'campfire':
    case 'barrel':
    case 'rack':
      return
  }
}
