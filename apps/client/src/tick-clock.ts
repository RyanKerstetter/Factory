import { TICK_MS } from '../../../packages/shared/src/index.ts'

// What tick the server is on, worked out from when its messages arrive. Each state message says which tick the server
// had just run; the soonest-arriving of the last few seconds' (the least held up on the way) sets `arrivalTick`, the
// tick of the message that would be arriving now. The round trip comes from pings.
const WINDOW_MS = 3_000

export class TickClock {
  rttMs = 100
  private samples: Array<{ at: number; offset: number }> = []
  private offset: number | undefined
  private pinged = false

  get ready(): boolean {
    return this.offset !== undefined
  }

  observeTick(serverTick: number, now: number): void {
    const offset = serverTick - now / TICK_MS
    this.samples.push({ at: now, offset })
    while (this.samples.length > 0 && now - this.samples[0].at > WINDOW_MS) this.samples.shift()
    let best = -Infinity
    for (const sample of this.samples) best = Math.max(best, sample.offset)
    this.offset = best
  }

  observePong(sentAt: number, now: number): void {
    const rtt = Math.max(0, now - sentAt)
    this.rttMs = this.pinged ? this.rttMs * 0.8 + rtt * 0.2 : rtt
    this.pinged = true
  }

  // The tick of the server message that would be arriving now (a fraction: part of the way to the next).
  arrivalTick(now: number): number {
    return now / TICK_MS + (this.offset ?? 0)
  }

  // The tick the server is on now: the one arriving plus the one-way trip.
  serverTick(now: number): number {
    return this.arrivalTick(now) + this.rttMs / 2 / TICK_MS
  }

  // The tick to stamp a command with: one the server has already run, so it runs the command on the very next tick
  // after it arrives, as soon as it can (a command is never held back for a tick of its own).
  commandTick(now: number): number {
    return Math.max(0, Math.floor(this.arrivalTick(now)))
  }
}
