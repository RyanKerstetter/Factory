import { chunkOfTile } from '../geometry.ts'
import type { ItemId } from '../items.ts'
import { chunkOfDrop, dropFromState, type DropState } from './drops.ts'
import { addToBuilding, entityFromState, hasInventory, takeFromBuilding, type EntityState } from './entity.ts'
import type { FactoryWorld } from './factory-world.ts'
import { linkFromState, type LinkState } from './links.ts'

// A change to the factory made by a command, at the start of a tick. The server works out what a command does,
// writes it down as these, and applies them to its own world with `applyWorldEvent`, the same function every client
// that simulates the chunk applies them with. So a command is done by one piece of code everywhere.
export type WorldEvent =
  | { t: 'add'; e: EntityState }
  | { t: 'remove'; id: number }
  // A building's whole state put in place of what it was (same ID, same tile): a seed planted in a plot, a station
  // started.
  | { t: 'set'; e: EntityState }
  | { t: 'inv'; id: number; item: ItemId; delta: number }
  // A plant or rock was hit: the hits it has left.
  | { t: 'hp'; id: number; hp: number }
  // The heat a barrel or drying rack gets from a fire in another chunk (see BORDER_HEAT_STEP).
  | { t: 'border'; id: number; heat: number }
  // A tree was punched: the punches towards knocking the next stick (or bark) loose.
  | { t: 'punches'; id: number; punches: number }
  // An item landed on the ground; one was picked up (all of it); some of one was picked up, leaving `count`.
  | { t: 'drop+'; d: DropState }
  | { t: 'drop-'; id: number }
  | { t: 'drop='; id: number; count: number }
  | { t: 'link+'; l: LinkState }
  | { t: 'link-'; id: number }

export function applyWorldEvent(world: FactoryWorld, event: WorldEvent): void {
  switch (event.t) {
    case 'add':
      world.addEntity(entityFromState(event.e))
      return
    case 'remove':
      world.removeEntity(event.id)
      return
    case 'set':
      if (world.entity(event.e.id)) world.replaceEntity(entityFromState(event.e))
      return
    case 'inv': {
      const entity = world.entity(event.id)
      if (!entity || !hasInventory(entity)) return
      if (event.delta > 0) addToBuilding(entity, event.item, event.delta)
      else takeFromBuilding(entity, event.item, -event.delta)
      return
    }
    case 'hp': {
      const entity = world.entity(event.id)
      if (entity && 'hp' in entity) entity.hp = event.hp
      return
    }
    case 'border': {
      const entity = world.entity(event.id)
      if (entity?.kind === 'barrel' || entity?.kind === 'rack') entity.border = event.heat
      return
    }
    case 'punches': {
      const entity = world.entity(event.id)
      if (entity?.kind === 'tree') entity.punches = event.punches
      return
    }
    case 'drop+':
      world.addDrop(dropFromState(event.d))
      return
    case 'drop-':
      world.removeDrop(event.id)
      return
    case 'drop=': {
      const drop = world.drop(event.id)
      if (drop) drop.count = event.count
      return
    }
    case 'link+':
      world.addLink(linkFromState(event.l))
      return
    case 'link-':
      world.removeLink(event.id)
      return
  }
}

// The chunks whose copies need an event: where the building is, or both ends of a link.
export function chunksOfWorldEvent(world: FactoryWorld, event: WorldEvent): number[] {
  switch (event.t) {
    case 'add':
    case 'set':
      return [chunkOfTile(event.e.x, event.e.y)]
    case 'remove':
    case 'inv':
    case 'hp':
    case 'border':
    case 'punches': {
      const chunk = world.chunkOfEntity(event.id)
      return chunk === undefined ? [] : [chunk]
    }
    case 'drop+':
      return [chunkOfDrop({ x: event.d[3], y: event.d[4] })]
    case 'drop-':
    case 'drop=': {
      const drop = world.drop(event.id)
      return drop ? [chunkOfDrop(drop)] : []
    }
    case 'link+':
      return event.l[3] === event.l[4] ? [event.l[3]] : [event.l[3], event.l[4]]
    case 'link-': {
      const link = world.link(event.id)
      if (!link) return []
      return link.fromChunk === link.toChunk ? [link.fromChunk] : [link.fromChunk, link.toChunk]
    }
  }
}
