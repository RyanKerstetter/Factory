import { SUB } from '../../../packages/shared/src/index.ts'
import { RemotePlayers, type RemotePosition } from './remote-players.ts'

// How long a creature that has just been hit is lit up, and how long one killed takes to fall over before it is gone
// (its drops show once it has: see game.ts's visibleDrops).
export const HURT_MS = 260
export const DEATH_MS = 450

// One creature in view on a frame: where it is (units), which way it is going, and what it is.
export type TrackedCreature<Info> = RemotePosition & { info: Info }
// One just killed, falling over where it died (tiles), `fall` 0 to 1 of the way.
export type FallingCreature<Info> = { info: Info; x: number; y: number; facing: number; fall: number }

// The creatures of one kind near the player (the animals, or the monsters) as the page knows them: what each is (from
// the log), where each has been (from the state messages, drawn a little in the past like the other players), which way
// each last went, when each was last hurt, where each was drawn on the last frame, and those just killed, falling over.
export class CreatureTracks<Info extends { id: number; kind: string; hp: number }> {
  readonly info = new Map<number, Info>()
  private readonly tracks = new RemotePlayers()
  private readonly facing = new Map<number, number>()
  private readonly hurtAt = new Map<number, number>()
  // Where each was drawn on the last frame, in units.
  private spots = new Map<number, { x: number; y: number }>()
  private readonly dying: Array<{ info: Info; x: number; y: number; facing: number; at: number }> = []

  // Where the server says they are on a tick.
  update(tick: number, positions: ReadonlyArray<[number, number, number]>): void {
    this.tracks.update(tick, positions, -1)
  }

  // What one is now. Gives how much health it has lost since the page was last told (0 if none, or it is new to it).
  told(info: Info, now: number): number {
    const before = this.info.get(info.id)
    this.info.set(info.id, info)
    const lost = before ? before.hp - info.hp : 0
    if (lost > 0) this.hurtAt.set(info.id, now)
    return Math.max(0, lost)
  }

  // One is gone: out of range, or, `died`, killed (and then falling over where it was drawn, if `falls` says it does).
  // Gives what it was and where it was drawn (units), if the page knew.
  gone(id: number, died: number | undefined, now: number, falls: (info: Info) => boolean = () => true): { info: Info; spot: { x: number; y: number } } | undefined {
    const info = this.info.get(id)
    const spot = this.spots.get(id)
    const facing = this.facing.get(id) ?? Math.PI / 2
    this.info.delete(id)
    this.facing.delete(id)
    this.hurtAt.delete(id)
    if (!info || !spot) return undefined
    if (died !== undefined && falls(info)) this.dying.push({ info, x: spot.x / SUB, y: spot.y / SUB, facing, at: now })
    return { info, spot }
  }

  // Each one in view at `tick` (as drawn on this frame), noting where it is and which way it last went.
  at(tick: number): Array<TrackedCreature<Info>> {
    const spots = new Map<number, { x: number; y: number }>()
    const found: Array<TrackedCreature<Info>> = []
    for (const track of this.tracks.positionsAt(tick)) {
      const info = this.info.get(track.id)
      if (!info) continue
      spots.set(track.id, { x: track.x, y: track.y })
      if (track.dx !== 0 || track.dy !== 0) this.facing.set(track.id, Math.atan2(track.dy, track.dx))
      found.push({ ...track, info })
    }
    this.spots = spots
    return found
  }

  // Where one is reckoned to be `ahead` ticks after the newest position sent (units: see RemotePlayers.ahead).
  ahead(id: number, ahead: number): { x: number; y: number } | undefined {
    return this.tracks.ahead(id, ahead)
  }

  // Where one was drawn on the last frame (units), if it was.
  spot(id: number): { x: number; y: number } | undefined {
    return this.spots.get(id)
  }

  // Each one drawn on the last frame, with where (units).
  *drawn(): Generator<{ info: Info; x: number; y: number }> {
    for (const [id, spot] of this.spots) {
      const info = this.info.get(id)
      if (info) yield { info, ...spot }
    }
  }

  // Which way one last went (radians), or `otherwise`.
  facingOf(id: number, otherwise = Math.PI / 2): number {
    return this.facing.get(id) ?? otherwise
  }

  // Whether one is lit up for having just been hurt.
  isHurt(id: number, now: number): boolean {
    return now - (this.hurtAt.get(id) ?? Number.NEGATIVE_INFINITY) < HURT_MS
  }

  // The ones just killed that are still falling over (the rest are forgotten).
  falling(now: number): Array<FallingCreature<Info>> {
    for (let i = this.dying.length - 1; i >= 0; i--) if (now - this.dying[i].at > DEATH_MS) this.dying.splice(i, 1)
    return this.dying.map((dead) => ({ info: dead.info, x: dead.x, y: dead.y, facing: dead.facing, fall: (now - dead.at) / DEATH_MS }))
  }

  // Whether one fell near a point (tiles) a moment ago (what it drops shows once it has fallen).
  fellNear(x: number, y: number, now: number): boolean {
    return this.dying.some((dead) => Math.hypot(dead.x - x, dead.y - y) < 2.5 && now - dead.at < DEATH_MS)
  }
}
