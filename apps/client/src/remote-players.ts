// The other players, drawn where they were a little in the past, between two positions the server sent, so they
// move smoothly whatever the network does.
const KEPT = 40
// How far behind the newest position they are drawn, in ticks.
export const REMOTE_DELAY_TICKS = 3
// How far on (ticks) one is ever reckoned past the newest position sent (see `ahead`).
const MAX_AHEAD = 6

type Sample = { tick: number; x: number; y: number }
export type RemotePosition = { id: number; x: number; y: number; dx: number; dy: number }

export class RemotePlayers {
  private readonly samples = new Map<number, Sample[]>()
  // The positions last worked out, and for which tick: asked for again and again in a frame, they are worked out once.
  private worked: { tick: number; found: readonly RemotePosition[] } | undefined

  update(tick: number, players: ReadonlyArray<[number, number, number]>, skip: number): void {
    this.worked = undefined
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
  positionsAt(tick: number): readonly RemotePosition[] {
    if (this.worked?.tick === tick) return this.worked.found
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
    this.worked = { tick, found }
    return found
  }

  // Where one is reckoned to be `ahead` ticks after the newest position the server sent (at most MAX_AHEAD), going on
  // as it went between the last two: for where something is now, not where it is drawn (a little in the past).
  ahead(id: number, ahead: number): { x: number; y: number } | undefined {
    const list = this.samples.get(id)
    if (!list || list.length === 0) return undefined
    const last = list[list.length - 1]
    const before = list.length > 1 ? list[list.length - 2] : last
    const span = last.tick - before.tick
    if (span <= 0) return { x: last.x, y: last.y }
    const lead = Math.min(MAX_AHEAD, ahead) / span
    return { x: last.x + (last.x - before.x) * lead, y: last.y + (last.y - before.y) * lead }
  }

  // Where one is at `tick`, if it is known.
  positionOf(id: number, tick: number): RemotePosition | undefined {
    return this.positionsAt(tick).find((position) => position.id === id)
  }
}
