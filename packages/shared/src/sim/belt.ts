import { BELT_CAPACITY, BELT_GAP, BELT_LENGTH, BELT_SIDE_ENTRY, BELT_SPEED } from '../constants.ts'
import { opposite, rotateCCW, rotateCW, type Direction } from '../geometry.ts'
import { NO_ITEM, type ItemId } from '../items.ts'

// One item on a belt: what it is, how far along the belt it is (0 to BELT_LENGTH), and where it was a tick ago.
// `prev` is only for drawing it moving smoothly between ticks: it is not part of the hash or of a snapshot.
export type LaneItem = { item: ItemId; pos: number; prev: number }

// Which side of a belt an item comes in from, seen from the belt facing the way it carries: from behind, or from
// its left or right.
export type Entry = 'back' | 'left' | 'right'
export const ENTRIES: readonly Entry[] = ['back', 'left', 'right']

// How a belt is laid: straight, or turning a corner from its left or right side. A belt fed only from one side (and
// not from behind) turns the corner, and its items come in at its start rather than its middle.
export type BeltShape = 'straight' | 'left' | 'right'

// Which side an item travelling in direction `travel` comes into a belt facing `belt` from, or undefined if it would
// come in through the belt's front (the two face each other, and nothing passes).
export function entryFor(belt: Direction, travel: Direction): Entry | undefined {
  if (travel === belt) return 'back'
  if (travel === opposite(belt)) return undefined
  // Facing east, the left side is north: an item from there travels south, a quarter turn clockwise of east.
  return travel === rotateCW(belt) ? 'left' : travel === rotateCCW(belt) ? 'right' : undefined
}

export function shapeFor(inputs: Iterable<Entry>): BeltShape {
  let left = false
  let right = false
  for (const entry of inputs) {
    if (entry === 'back') return 'straight'
    if (entry === 'left') left = true
    else right = true
  }
  if (left && !right) return 'left'
  if (right && !left) return 'right'
  return 'straight'
}

// Where on a belt an item coming in from `entry` is put.
export function entryPosition(shape: BeltShape, entry: Entry): number {
  return entry === 'back' || entry === shape ? 0 : BELT_SIDE_ENTRY
}

// Phase A for a belt: every item moves BELT_SPEED towards the end, stopping BELT_GAP behind the one in front, and
// the first stops at the end, where it waits to be handed on. `lane` is kept with the first item first.
export function stepLane(lane: LaneItem[]): void {
  let limit = BELT_LENGTH
  for (const entry of lane) {
    entry.prev = entry.pos
    entry.pos = Math.max(entry.pos, Math.min(entry.pos + BELT_SPEED, limit))
    limit = entry.pos - BELT_GAP
  }
}

// Whether an item can be put at `pos`: the belt is not full, and nothing is within BELT_GAP of the spot.
export function laneHasRoomAt(lane: readonly LaneItem[], pos: number): boolean {
  if (lane.length >= BELT_CAPACITY) return false
  for (const entry of lane) {
    if (Math.abs(entry.pos - pos) < BELT_GAP) return false
  }
  return true
}

// Puts an item at `pos`, keeping the lane in order. `carry` is how far it moved this tick before it came in, so it is
// drawn coming in smoothly from the edge.
export function insertIntoLane(lane: LaneItem[], item: ItemId, pos: number, carry: number): void {
  let index = 0
  while (index < lane.length && lane[index].pos > pos) index++
  lane.splice(index, 0, { item, pos, prev: pos - carry })
}

// The item waiting at the end of the belt to be handed on, or NO_ITEM.
export function waitingItem(lane: readonly LaneItem[]): ItemId {
  const first = lane[0]
  return first && first.pos === BELT_LENGTH ? first.item : NO_ITEM
}

// Takes the waiting item off the end, and gives how far it moved on its last tick.
export function takeWaiting(lane: LaneItem[]): number {
  const first = lane.shift()
  return first ? first.pos - first.prev : 0
}
