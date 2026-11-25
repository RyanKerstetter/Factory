// How long each part of a frame takes on this computer, averaged over about a second, for the debug view (F3): the
// first thing to look at when the game runs slowly somewhere. A frame is timed as laps, one after another (the
// player's input, simulating the world, working out what to draw, handing it to the view, the page's own elements),
// and the view's own drawing is added once it is done (see GameView.stats).
const WINDOW_MS = 1000

export class FrameTimer {
  private readonly sums = new Map<string, number>()
  private lapAt = 0
  private frames = 0
  private worst = 0
  private frameStart = 0
  private windowStart = -1
  private report: string[] = []

  // Starts timing a frame (at `now`, from performance.now()).
  start(now: number): void {
    if (this.windowStart < 0) this.windowStart = now
    if (now - this.windowStart >= WINDOW_MS && this.frames > 0) this.summarise(now)
    this.frameStart = now
    this.lapAt = now
    this.frames++
  }

  // Ends a part of the frame: the time since the last lap (or the start) is put down to `part`.
  lap(part: string): void {
    const now = performance.now()
    this.add(part, now - this.lapAt)
    this.lapAt = now
  }

  // Puts time down to a part that was not timed as a lap (the view's drawing, timed by the view).
  add(part: string, ms: number): void {
    this.sums.set(part, (this.sums.get(part) ?? 0) + ms)
  }

  // Ends the frame, for the slowest one in the window.
  end(): void {
    this.worst = Math.max(this.worst, performance.now() - this.frameStart)
  }

  // The lines for the debug overlay: frames a second, the average and slowest frame's own work, and each part's share.
  lines(): readonly string[] {
    return this.report
  }

  private summarise(now: number): void {
    const frames = this.frames
    const seconds = (now - this.windowStart) / 1000
    let total = 0
    for (const ms of this.sums.values()) total += ms
    const parts = [...this.sums].map(([part, ms]) => `${part} ${(ms / frames).toFixed(2)}`)
    this.report = [`frame         ${(total / frames).toFixed(2)} ms work (slowest ${this.worst.toFixed(1)}), ${Math.round(frames / seconds)} fps`, `  ms a frame  ${parts.join('  ')}`]
    this.sums.clear()
    this.frames = 0
    this.worst = 0
    this.windowStart = now
  }
}
