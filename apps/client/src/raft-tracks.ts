import type { RaftPose } from '../../../packages/shared/src/index.ts'

// The rafts near the player (see rafts.ts), drawn like the other players: a little in the past, between two poses the
// server sent, so they glide and turn smoothly whatever the network does.
const KEPT = 40

type Sample = { tick: number; pose: RaftPose }

export class RaftTracks {
  private readonly samples = new Map<number, Sample[]>()
  // Who is aboard which raft, as the server last said (player ID to raft ID).
  readonly riders = new Map<number, number>()
  // The rafts on a rope, as the server last said: the player leading it, or the fence it is tied to (0 for neither).
  readonly ropes = new Map<number, { leader: number; post: number }>()

  // The rafts near the player at a server tick ([id, x, y, angle in thousandths of a radian, leader, post]), and who is
  // aboard.
  update(tick: number, rafts: ReadonlyArray<[number, number, number, number, number, number]>, riders: ReadonlyArray<[number, number]>): void {
    const present = new Set<number>()
    this.ropes.clear()
    for (const [id, x, y, angle, leader, post] of rafts) {
      present.add(id)
      if (leader !== 0 || post !== 0) this.ropes.set(id, { leader, post })
      let list = this.samples.get(id)
      if (!list) this.samples.set(id, (list = []))
      if (list.length > 0 && list[list.length - 1].tick >= tick) continue
      list.push({ tick, pose: { x, y, angle: angle / 1000 } })
      if (list.length > KEPT) list.shift()
    }
    for (const id of [...this.samples.keys()]) if (!present.has(id)) this.samples.delete(id)
    this.riders.clear()
    for (const [player, raft] of riders) this.riders.set(player, raft)
  }

  // Where a raft is at `tick` (a fraction), if it is known.
  poseAt(id: number, tick: number): RaftPose | undefined {
    const list = this.samples.get(id)
    if (!list || list.length === 0) return undefined
    let before = list[0]
    let after = list[list.length - 1]
    for (let i = 0; i < list.length; i++) {
      if (list[i].tick <= tick) before = list[i]
      if (list[i].tick >= tick) {
        after = list[i]
        break
      }
    }
    const span = after.tick - before.tick
    const t = span > 0 ? Math.min(1, Math.max(0, (tick - before.tick) / span)) : 1
    return {
      x: before.pose.x + (after.pose.x - before.pose.x) * t,
      y: before.pose.y + (after.pose.y - before.pose.y) * t,
      angle: before.pose.angle + (after.pose.angle - before.pose.angle) * t,
    }
  }

  // Every raft known, and where it is at `tick`.
  posesAt(tick: number): Array<{ id: number; pose: RaftPose }> {
    const found: Array<{ id: number; pose: RaftPose }> = []
    for (const id of [...this.samples.keys()].sort((a, b) => a - b)) {
      const pose = this.poseAt(id, tick)
      if (pose) found.push({ id, pose })
    }
    return found
  }
}
