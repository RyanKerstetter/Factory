// The other players, drawn where they were a little in the past, between two positions the server sent, so they
// move smoothly whatever the network does.
const KEPT = 40
// How far behind the newest position they are drawn, in ticks.
export const REMOTE_DELAY_TICKS = 3

type Sample = { tick: number; x: number; y: number }
export type RemotePosition = { id: number; x: number; y: number; dx: number; dy: number }

export class RemotePlayers {
  private readonly samples = new Map<number, Sample[]>()

  update(tick: number, players: ReadonlyArray<[number, number, number]>, skip: number): void {
    const present = new Set<number>()
    for (const [id, x, y] of players) {
      if (id === skip) continue
      present.add(id)
      let list = this.samples.get(id)
      if (!list) this.samples.set(id, (list = []))
      if (list.length > 0 && list[list.length - 1].tick >= tick) continue
      list.push({ tick, x, y })
      if (list.length > KEPT) list.shift()
    }
    for (const id of [...this.samples.keys()]) if (!present.has(id)) this.samples.delete(id)
  }

  // Where each is at `tick` (a fraction), in units.
  positionsAt(tick: number): RemotePosition[] {
    const found: RemotePosition[] = []
    for (const [id, list] of this.samples) {
      if (list.length === 0) continue
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
      // Which way it is going, from the two positions it is drawn between (0, 0 when it stands still).
      found.push({ id, x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t, dx: after.x - before.x, dy: after.y - before.y })
    }
    return found
  }
}
