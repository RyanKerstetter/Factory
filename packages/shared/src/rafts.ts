import { PLAYER_HALF_SIZE, SUB, TPS } from './constants.ts'
import { floorDiv } from './geometry.ts'
import { getItem, NO_ITEM, type ItemId } from './items.ts'
import { walkDelta, type PlayerPosition } from './movement.ts'

// Rafts: a square deck of logs RAFT_SIZE a side, put down on water (see `raftFits`), that drifts, turns and is rowed
// with an oar (see the server's rafts.ts, which moves them: only the server does). Players walk onto one from the
// shore and ride it: while aboard, where a player stands is kept on the raft (`Aboard`, units from its middle, along
// its own unturned axes), so they move and turn with it, and walking moves them about its deck; they step off it only
// onto land (see `stepAboard`). The page plays its own player's steps aboard the same way, against the raft as it draws
// it, so riding is smooth.

// How big a raft is (units a side, 1.5 tiles), and half that.
export const RAFT_SIZE = Math.round(1.5 * SUB)
export const RAFT_HALF = RAFT_SIZE / 2
// How far from a raft's middle a player's middle stays while aboard (along each of its axes), so they stand on its
// deck and not over its edge.
export const RAFT_DECK = RAFT_HALF - 44
// How near a raft a player has to step (their middle, along each of its axes) to step aboard: their body over its
// edge, or across a small gap of water between the shore and it (it is put down right against the shore, but drifts).
const BOARD_REACH = RAFT_HALF + PLAYER_HALF_SIZE + 8
// Stepping off, where a player's middle lands: just far enough out past the raft's edge that all of them is off it,
// or (across a small gap of water between it and the shore) up to STEP_GAP further.
const STEP_OFF = PLAYER_HALF_SIZE + 2
const STEP_GAP = SUB / 4
// How far out over a raft's edge a player aboard can be (their middle, along each of its axes), stepping on or off it
// a step at a time with land just past it: so getting on and off is a walk, never a jump.
const OVERHANG = RAFT_HALF + STEP_OFF + STEP_GAP

// How a raft moves (the server's rafts.ts): an oar's stroke speeds it up by ROW_PUSH units a tick the way it is pulled
// (and, pulled from anywhere but its middle, turns it: SPIN_PUSH times what that would spin a plain square board); it
// goes no faster than RAFT_TOP_SPEED; the water slows it (RAFT_DRAG of its speed kept each tick, and RAFT_SPIN_DRAG of
// its turning: so it does not spin on and on); and, run into the shore or another raft, it stops, bouncing back
// RAFT_BOUNCE of its speed.
export const ROW_PUSH = Math.round((1.3 * SUB) / TPS)
export const SPIN_PUSH = 0.6
export const RAFT_TOP_SPEED = Math.round((4 * SUB) / TPS)
export const RAFT_DRAG = 0.975
export const RAFT_SPIN_DRAG = 0.94
export const RAFT_BOUNCE = 0.2
// Out in the deep sea (off the shelf: see `shelfWidthAt` in terrain.ts; where the sea is drawn dark), a raft is much
// slower: a stroke pushes it only DEEP_ROW_SHARE as hard, it goes no faster than RAFT_DEEP_TOP_SPEED, and the water
// slows it more (RAFT_DEEP_DRAG of its speed kept each tick).
export const DEEP_ROW_SHARE = 0.3
export const RAFT_DEEP_TOP_SPEED = Math.round((1.1 * SUB) / TPS)
export const RAFT_DEEP_DRAG = 0.94

// Where a raft is: its middle (units) and which way it is turned (radians, turning as a player's facing does).
export type RaftPose = { x: number; y: number; angle: number }
// A player aboard a raft: which raft, and where on it (units from its middle, along its own axes).
export type Aboard = { raft: number; x: number; y: number }

// A point (units) as a raft has it: from its middle, along its own axes.
export function toRaft(pose: RaftPose, point: PlayerPosition): { x: number; y: number } {
  const dx = point.x - pose.x
  const dy = point.y - pose.y
  const cos = Math.cos(pose.angle)
  const sin = Math.sin(pose.angle)
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }
}

// A point on a raft (units from its middle, along its own axes) as it is in the world, in whole units.
export function fromRaft(pose: RaftPose, local: { x: number; y: number }): PlayerPosition {
  const cos = Math.cos(pose.angle)
  const sin = Math.sin(pose.angle)
  return { x: Math.round(pose.x + local.x * cos - local.y * sin), y: Math.round(pose.y + local.x * sin + local.y * cos) }
}

// Whether a point (units) is on a raft, give or take `margin` units round its edge.
export function onRaft(pose: RaftPose, point: PlayerPosition, margin = 0): boolean {
  const local = toRaft(pose, point)
  return Math.abs(local.x) <= RAFT_HALF + margin && Math.abs(local.y) <= RAFT_HALF + margin
}

// Points round a raft's edge (and across its middle), every quarter of a tile, in units: what has to be over water for
// it to float there.
export function raftOutline(pose: RaftPose): PlayerPosition[] {
  const points: PlayerPosition[] = []
  const step = SUB / 4
  const steps = Math.ceil(RAFT_SIZE / step)
  for (let i = 0; i <= steps; i++) {
    const along = -RAFT_HALF + (RAFT_SIZE * i) / steps
    for (const local of [
      { x: along, y: -RAFT_HALF },
      { x: along, y: RAFT_HALF },
      { x: -RAFT_HALF, y: along },
      { x: RAFT_HALF, y: along },
      { x: along, y: 0 },
    ]) {
      points.push(fromRaft(pose, local))
    }
  }
  return points
}

// Whether a raft can be where `pose` puts it: all over water (`isWater`, by tile), and clear of the other rafts.
export function raftFits(pose: RaftPose, isWater: (x: number, y: number) => boolean, others: readonly RaftPose[]): boolean {
  for (const point of raftOutline(pose)) if (!isWater(floorDiv(point.x, SUB), floorDiv(point.y, SUB))) return false
  for (const other of others) {
    if (Math.hypot(other.x - pose.x, other.y - pose.y) > RAFT_SIZE * 1.5) continue
    if (raftOutline(pose).some((point) => onRaft(other, point)) || raftOutline(other).some((point) => onRaft(pose, point))) return false
  }
  return true
}

// Where a raft put down on a tile goes: its middle on the tile's middle, square to the world.
export function raftOnTile(x: number, y: number): RaftPose {
  return { x: x * SUB + SUB / 2, y: y * SUB + SUB / 2, angle: 0 }
}

// A tick of keys for a player aboard a raft (at `pose`): they walk about its deck the way the keys point in the world
// (whichever way the raft is turned), as fast as on land, but never off its edge, unless the way they walk takes them
// onto another raft (`others`, as `boardingRaft` boards one from land), which they step across onto (`board`), or onto
// land (`canLand`: whether a player can stand with their middle at a point, all of them clear of water and anything
// solid), where they step off (across a gap of up to STEP_GAP). Gives where they are on the raft now, or where they
// stepped across to.
export function stepAboard(
  local: { x: number; y: number },
  keys: number,
  pose: RaftPose,
  canLand: (point: PlayerPosition) => boolean,
  speedPercent = 100,
  others: ReadonlyArray<{ id: number; pose: RaftPose }> = [],
): { x: number; y: number } | { off: PlayerPosition } | { board: Aboard } {
  const { dx, dy } = walkDelta(keys, speedPercent)
  if (dx === 0 && dy === 0) return local
  const cos = Math.cos(pose.angle)
  const sin = Math.sin(pose.angle)
  const x = local.x + Math.round(dx * cos + dy * sin)
  const y = local.y + Math.round(-dx * sin + dy * cos)
  // On its deck, anywhere; out over its edge (just stepped aboard), anywhere no further out than they are.
  const within = (along: number, before: number): boolean => Math.abs(along) <= Math.max(RAFT_DECK, Math.abs(before))
  if (within(x, local.x) && within(y, local.y)) return { x, y }
  // Walking off its edge: onto another raft there.
  const onto = boardingRaft(fromRaft(pose, local), keys, others, speedPercent)
  if (onto) return { board: onto }
  // Onto land: once all of them is clear of the water where the step takes them, they are off it, just there.
  const there = fromRaft(pose, { x, y })
  if (canLand(there)) return { off: there }
  // With land just past the edge that way, they walk on out over the edge towards it, a step at a time (as far as
  // OVERHANG; past that, across a gap of water, they step over onto the land).
  for (let gap = 0; gap <= STEP_GAP; gap += STEP_GAP / 4) {
    const past = (along: number): number => (Math.abs(along) <= RAFT_DECK ? along : Math.sign(along) * (RAFT_HALF + STEP_OFF + gap))
    const landing = fromRaft(pose, { x: past(x), y: past(y) })
    if (!canLand(landing)) continue
    return Math.abs(x) <= OVERHANG && Math.abs(y) <= OVERHANG ? { x, y } : { off: landing }
  }
  // No land that way: no further out than the deck's edge (or than they are, over it).
  const clamp = (along: number, before: number): number => Math.sign(along) * Math.min(Math.abs(along), Math.max(RAFT_DECK, Math.abs(before)))
  return { x: clamp(x, local.x), y: clamp(y, local.y) }
}

// A tick of keys for a player on land: if it steps them onto a raft (their body over its edge, coming nearer it), the
// raft and where on it they are: just where the step takes them (still over its edge, so it is one step like any
// other; they walk on in from there); else undefined, and they walk as usual.
export function boardingRaft(
  position: PlayerPosition,
  keys: number,
  rafts: ReadonlyArray<{ id: number; pose: RaftPose }>,
  speedPercent = 100,
): Aboard | undefined {
  const { dx, dy } = walkDelta(keys, speedPercent)
  if (dx === 0 && dy === 0) return undefined
  const target = { x: position.x + dx, y: position.y + dy }
  for (const { id, pose } of rafts) {
    const next = toRaft(pose, target)
    const reach = Math.max(Math.abs(next.x), Math.abs(next.y))
    if (reach > BOARD_REACH) continue
    const now = toRaft(pose, position)
    if (reach >= Math.max(Math.abs(now.x), Math.abs(now.y))) continue
    return { raft: id, x: Math.round(next.x), y: Math.round(next.y) }
  }
  return undefined
}

// Whether an item is a raft (put down on water, not as a building: see the server's rafts.ts).
export function isRaftItem(item: ItemId): boolean {
  return item !== NO_ITEM && getItem(item).key === 'raft'
}
