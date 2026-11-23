import {
  CHUNK_SIZE,
  coastAround,
  DEEP_ROW_SHARE,
  isShelf,
  floorDiv,
  isSeaAt,
  LEAD_LENGTH,
  ropeForce,
  ropeMove,
  ropeStep,
  ROPE_HELD,
  PLAYER_MASS,
  RAFT_BOUNCE,
  RAFT_DEEP_DRAG,
  RAFT_DEEP_TOP_SPEED,
  SUB,
  RAFT_DRAG,
  RAFT_SIZE,
  RAFT_SPIN_DRAG,
  RAFT_TOP_SPEED,
  raftFits,
  ROW_PUSH,
  SPIN_PUSH,
  type PlayerPosition,
  type RaftPose,
  type Terrain,
} from '../../../packages/shared/src/index.ts'

// The rafts (see the shared rafts.ts): where each is, and how it is moving, which only the server works out; pages are
// told where each is with the players' positions, and draw them between. A raft drifts on as it was rowed, slowing in
// the water, and turns as it was turned, slowing faster; it stops against the shore and against other rafts. Out in the
// deep sea, off the shelf, it is much slower (see DEEP_ROW_SHARE). A rope on the post in its middle pulls it along after a player, or
// holds it to a fence (see `tow`).

export type Raft = RaftPose & {
  id: number
  // How fast it goes, in units a tick, and how fast it turns, in radians a tick.
  vx: number
  vy: number
  spin: number
  // The player leading it on a rope, or 0; the fence it is tied to (its entity ID), or 0.
  leader: number
  post: number
  // While it is on a rope: which (`of`, so a new rope starts afresh), how fast the rope is pulling it along (units a
  // tick, besides its own drifting), and how far from a fence it is held (see ROPE_HELD).
  rope?: { of: string; vx: number; vy: number; reach: number }
}

// Below these it has stopped (units a tick, radians a tick).
const STILL = 0.05
const STILL_SPIN = 0.0002
// How a raft is saved: [id, x, y, angle, and the fence it is tied to, if it is]. A rope a player leads it on is not
// kept (it goes back in their things: see GameRoom).
export type RaftSave = Array<[number, number, number, number] | [number, number, number, number, number]>

export class Rafts {
  private readonly rafts = new Map<number, Raft>()
  private nextId = 1
  // Whether each tile is deep sea, worked out a chunk at a time as rafts come to it.
  private readonly deep = new Map<string, boolean>()

  // The land, to tell the deep sea from the shallows; without it, there is no deep sea.
  constructor(private readonly terrain?: Terrain) {}

  // Whether a raft is out in the deep sea: its middle over sea off the shelf, exactly where the sea is drawn dark (the
  // shared coast.ts, a chunk of tiles at a time).
  isDeep(raft: RaftPose): boolean {
    const terrain = this.terrain
    if (!terrain) return false
    const x = floorDiv(Math.round(raft.x), SUB)
    const y = floorDiv(Math.round(raft.y), SUB)
    const key = `${x},${y}`
    let deep = this.deep.get(key)
    if (deep === undefined) {
      const left = floorDiv(x, CHUNK_SIZE) * CHUNK_SIZE
      const top = floorDiv(y, CHUNK_SIZE) * CHUNK_SIZE
      const coast = coastAround(terrain, left, top, CHUNK_SIZE, CHUNK_SIZE)
      if (this.deep.size > 50_000) this.deep.clear()
      for (let ty = top; ty < top + CHUNK_SIZE; ty++) {
        for (let tx = left; tx < left + CHUNK_SIZE; tx++) {
          this.deep.set(`${tx},${ty}`, isSeaAt(terrain, tx, ty) && !isShelf(terrain, coast, tx, ty))
        }
      }
      deep = this.deep.get(key)!
    }
    return deep
  }

  // Every raft, in ID order.
  list(): Raft[] {
    return [...this.rafts.values()].sort((a, b) => a.id - b.id)
  }

  get(id: number): Raft | undefined {
    return this.rafts.get(id)
  }

  // Each raft and where it is, for players stepping aboard.
  poses(): Array<{ id: number; pose: RaftPose }> {
    return this.list().map((raft) => ({ id: raft.id, pose: { x: raft.x, y: raft.y, angle: raft.angle } }))
  }

  // Whether a raft can go where `pose` puts it: on water, clear of every other raft (but `except`).
  fits(pose: RaftPose, isWater: (x: number, y: number) => boolean, except = 0): boolean {
    return raftFits(pose, isWater, this.list().filter((raft) => raft.id !== except))
  }

  // A new raft, still, where `pose` puts it.
  add(pose: RaftPose): Raft {
    const raft: Raft = { id: this.nextId++, x: pose.x, y: pose.y, angle: pose.angle, vx: 0, vy: 0, spin: 0, leader: 0, post: 0 }
    this.rafts.set(raft.id, raft)
    return raft
  }

  // An oar's stroke from `from` (units: where the player rowing stands on the raft), pulling the raft the way `angle`
  // points: it speeds up that way by ROW_PUSH (to at most RAFT_TOP_SPEED), and, pulled from off its middle, turns, the
  // more the further off its middle and the more across the pull is. In the deep sea, all of that is much less.
  row(id: number, from: PlayerPosition, angle: number): void {
    const raft = this.rafts.get(id)
    if (!raft) return
    const deep = this.isDeep(raft)
    const push = ROW_PUSH * (deep ? DEEP_ROW_SHARE : 1)
    const top = deep ? RAFT_DEEP_TOP_SPEED : RAFT_TOP_SPEED
    const dvx = Math.cos(angle) * push
    const dvy = Math.sin(angle) * push
    raft.vx += dvx
    raft.vy += dvy
    const speed = Math.hypot(raft.vx, raft.vy)
    if (speed > top) {
      raft.vx *= top / speed
      raft.vy *= top / speed
    }
    // A push at a point off its middle turns a square board by (where × push) × 6 / side², as a solid square of even
    // weight turns.
    const rx = from.x - raft.x
    const ry = from.y - raft.y
    raft.spin += ((rx * dvy - ry * dvx) * 6 * SPIN_PUSH) / (RAFT_SIZE * RAFT_SIZE)
  }

  // A tick: each raft moves on and turns, stopping (and bouncing back a little) against the shore and the other rafts,
  // and the water slows it.
  step(isWater: (x: number, y: number) => boolean): void {
    for (const raft of this.list()) {
      if (Math.abs(raft.vx) < STILL && Math.abs(raft.vy) < STILL && Math.abs(raft.spin) < STILL_SPIN) {
        raft.vx = raft.vy = raft.spin = 0
        continue
      }
      const fits = (pose: RaftPose): boolean => this.fits(pose, isWater, raft.id)
      // Along x, then along y, then turning, each stopped on its own, so it slides along the shore it runs into.
      if (raft.vx !== 0) {
        if (fits({ x: raft.x + raft.vx, y: raft.y, angle: raft.angle })) raft.x += raft.vx
        else raft.vx *= -RAFT_BOUNCE
      }
      if (raft.vy !== 0) {
        if (fits({ x: raft.x, y: raft.y + raft.vy, angle: raft.angle })) raft.y += raft.vy
        else raft.vy *= -RAFT_BOUNCE
      }
      if (raft.spin !== 0) {
        if (fits({ x: raft.x, y: raft.y, angle: raft.angle + raft.spin })) raft.angle += raft.spin
        else raft.spin *= -RAFT_BOUNCE
      }
      const drag = this.isDeep(raft) ? RAFT_DEEP_DRAG : RAFT_DRAG
      raft.vx *= drag
      raft.vy *= drag
      raft.spin *= RAFT_SPIN_DRAG
    }
  }

  // A rope pulls a raft towards what holds it (`anchor`, units: a player, or a fence's post; `of`, which rope it is),
  // as a spring (see LEAD_LENGTH in constants.ts: `ropeForce`, `ropeStep`; a raft weighs what a player does), as far as
  // the water lets it (it slides along the shore), and it stops drifting away. What holds it does not give: a raft does
  // not pull its player into the water. Tied to a fence, it is held within ROPE_HELD of it, once drawn in that far.
  tow(raft: Raft, anchor: PlayerPosition, isWater: (x: number, y: number) => boolean, of: string): void {
    if (raft.rope?.of !== of) raft.rope = { of, vx: 0, vy: 0, reach: Math.hypot(anchor.x - raft.x, anchor.y - raft.y) }
    const rope = raft.rope
    // As far along a move as the water lets it (halving the move until it fits, down to a unit).
    const slide = (dx: number, dy: number): void => {
      while (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
        if (this.fits({ x: raft.x + dx, y: raft.y + dy, angle: raft.angle }, isWater, raft.id)) {
          raft.x += dx
          raft.y += dy
          return
        }
        dx = Math.trunc(dx / 2)
        dy = Math.trunc(dy / 2)
      }
    }
    // Straight that way, then the rest of the way along each axis on its own (sliding along the shore). Gives where
    // it got to.
    const move = (mx: number, my: number): { x: number; y: number } => {
      const startX = raft.x
      const startY = raft.y
      slide(mx, my)
      slide(startX + mx - raft.x, 0)
      slide(0, startY + my - raft.y)
      return { x: raft.x, y: raft.y }
    }
    const speed = ropeStep({ x: rope.vx, y: rope.vy }, ropeForce(raft, anchor), PLAYER_MASS)
    const moved = ropeMove({ x: raft.x, y: raft.y }, speed, move)
    rope.vx = moved.speed.x
    rope.vy = moved.speed.y
    const dx = anchor.x - raft.x
    const dy = anchor.y - raft.y
    const distance = Math.hypot(dx, dy)
    if (distance <= LEAD_LENGTH) return
    const ux = dx / distance
    const uy = dy / distance
    if (raft.post !== 0) {
      rope.reach = Math.max(ROPE_HELD, Math.min(rope.reach, distance))
      if (distance > rope.reach) move(Math.round(ux * (distance - rope.reach)), Math.round(uy * (distance - rope.reach)))
    }
    const away = raft.vx * ux + raft.vy * uy
    if (away < 0) {
      raft.vx -= away * ux
      raft.vy -= away * uy
    }
  }

  // The raft tied to a fence (its entity ID), if one is.
  tiedTo(fence: number): Raft | undefined {
    return this.list().find((raft) => raft.post === fence)
  }

  toSave(): RaftSave {
    return this.list().map((raft) => {
      const saved: [number, number, number, number] = [raft.id, Math.round(raft.x), Math.round(raft.y), Math.round(raft.angle * 1000) / 1000]
      return raft.post !== 0 ? [...saved, raft.post] : saved
    })
  }

  loadSave(saved: RaftSave): void {
    for (const [id, x, y, angle, post] of saved) {
      this.rafts.set(id, { id, x, y, angle, vx: 0, vy: 0, spin: 0, leader: 0, post: post ?? 0 })
      this.nextId = Math.max(this.nextId, id + 1)
    }
  }
}
