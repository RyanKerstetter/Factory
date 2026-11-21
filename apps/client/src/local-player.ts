import {
  keysDirection,
  moveBox,
  PLAYER_HALF_SIZE,
  PLAYER_MASS,
  pushApart,
  PLAYER_SPAWN,
  ropePull,
  stepPlayer,
  type Dash,
  type IsSlow,
  type IsSolid,
  type PlayerPosition,
} from '../../../packages/shared/src/index.ts'

// The page's own player, predicted so it moves the moment a key is pressed. Each tick's keys are an input with a
// number; the input moves the player here at once and is sent to the server, which plays it on its own copy. When
// the server says where the player is and which input it has played up to, the inputs it has not played yet are played
// again on top of where it says, which lands where the page had the player unless something was lost on the way.
// This is rollback, for one entity only.
const MAX_UNANSWERED = 120
// How many of the latest inputs go in each message, so a lost message does not lose its input.
const REDUNDANT_INPUTS = 12

// How many inputs past a dash's start the page keeps taking it as made while the server has not said so (its attack
// lost, or refused without the page hearing).
const UNHEARD_DASH_INPUTS = 100

export class LocalPlayer {
  position: PlayerPosition = { ...PLAYER_SPAWN }
  // Where it was a tick ago, for drawing it moving smoothly between ticks.
  previous: PlayerPosition = { ...PLAYER_SPAWN }
  // Which way the player faces, in radians (0 is east, a quarter turn clockwise is south): the way the keys last
  // pointed, so it turns at once, and keeps facing that way when it stops or walks into a wall.
  facing = Math.PI / 2
  // What the player cannot walk into, as the page knows it. The page's factory is a few ticks behind the server's, so
  // near a building that has just gone up or come down the server can disagree, and `reconcile` puts it right.
  solid: IsSolid | undefined
  // What slows the player down (bushes), as the page knows it.
  slow: IsSlow | undefined
  // How fast the player can go where it is, in percent (slower when freezing: see cold.ts).
  speedPercent: ((position: PlayerPosition) => number) | undefined
  // The animals the player leads on a rope, where the page last saw them, and how hard each pulls: the rope pulls the
  // player here as it does on the server (see `ropePull`), so being dragged does not wait for the server to say so.
  tethers: (() => ReadonlyArray<{ x: number; y: number; mass: number }>) | undefined
  // The animals and other players near the player, where the page last saw them: the player is pushed off them here as
  // it is on the server (see `pushApart`). `half` is how far each reaches from its middle, in units.
  crowd: (() => ReadonlyArray<{ x: number; y: number; half: number; mass: number }>) | undefined
  private nextSeq = 1
  private unanswered: Array<[number, number]> = []
  // Dashes (see dashOf): each carries the player on with the inputs after the one it names, here as on the server; with
  // the number of the attack command that set it off.
  private dashes: Array<Dash & { command: number }> = []

  // The number of the last input made.
  get lastInput(): number {
    return this.nextSeq - 1
  }

  // A dash, from the input after the last one made, set off by attack command `command`.
  dash(dash: Dash, command: number): void {
    this.dashes.push({ ...dash, command })
  }

  // A dash the server would not make (its attack was refused).
  cancelDash(command: number): void {
    this.dashes = this.dashes.filter((dash) => dash.command !== command)
  }

  // Plays a tick of the keys, and gives the inputs to send (the newest few, so the server can fill in a lost one).
  step(keys: number): Array<[number, number]> {
    const input: [number, number] = [this.nextSeq++, keys]
    this.unanswered.push(input)
    if (this.unanswered.length > MAX_UNANSWERED) this.unanswered.shift()
    this.previous = this.position
    this.position = this.play(this.position, keys, input[0])
    const { dx, dy } = keysDirection(keys)
    if (dx !== 0 || dy !== 0) this.facing = Math.atan2(dy, dx)
    return this.unanswered.slice(-REDUNDANT_INPUTS)
  }

  // The server's word: where the player was after it played input `played`, with the dashes of attack commands up to
  // `dashedBy` in it.
  reconcile(server: PlayerPosition, played: number, dashedBy = 0): void {
    while (this.unanswered.length > 0 && this.unanswered[0][0] <= played) this.unanswered.shift()
    // Dashes the server has played all the way through are done with. One whose attack it has not had yet (it comes
    // by another way than the inputs) it will catch up on at once when it does (see catchUpDash on the server), so its
    // steps with inputs already played are taken here too, as they will be there: the player does not snap back.
    this.dashes = this.dashes.filter((dash) => (dash.command > dashedBy ? played - dash.after < UNHEARD_DASH_INPUTS : dash.after + dash.ticks > played))
    let position = server
    for (const dash of this.dashes) {
      if (dash.command <= dashedBy) continue
      const missed = Math.min(dash.ticks, played - dash.after)
      for (let i = 0; i < missed; i++) position = this.nudge(position, dash.vx, dash.vy)
    }
    for (const [seq, keys] of this.unanswered) position = this.play(position, keys, seq)
    // Move where it was drawn from by the same amount, so a correction does not make it jump back and forth.
    const dx = position.x - this.position.x
    const dy = position.y - this.position.y
    if (dx !== 0 || dy !== 0) this.previous = { x: this.previous.x + dx, y: this.previous.y + dy }
    this.position = position
  }

  // One tick of keys, and then the pull of any rope.
  private play(position: PlayerPosition, keys: number, seq: number): PlayerPosition {
    let next = stepPlayer(position, keys, this.solid, this.slow, this.speedPercent?.(position) ?? 100)
    for (const dash of this.dashes) if (seq > dash.after && seq <= dash.after + dash.ticks) next = this.nudge(next, dash.vx, dash.vy)
    for (const animal of this.tethers?.() ?? []) {
      const pull = ropePull(next, animal, animal.mass)
      if (pull) next = this.nudge(next, pull.player.dx, pull.player.dy)
    }
    for (const other of this.crowd?.() ?? []) {
      const push = pushApart(next, PLAYER_HALF_SIZE, PLAYER_MASS, other, other.half, other.mass)
      if (push) next = this.nudge(next, push.a.x, push.a.y)
    }
    return next
  }

  private nudge(position: PlayerPosition, dx: number, dy: number): PlayerPosition {
    return this.solid ? moveBox(position, dx, dy, PLAYER_HALF_SIZE, this.solid) : { x: position.x + dx, y: position.y + dy }
  }

  // Puts the player where the server first says it is.
  place(position: PlayerPosition): void {
    this.position = { ...position }
    this.previous = { ...position }
  }
}
