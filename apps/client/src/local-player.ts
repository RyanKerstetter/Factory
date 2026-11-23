import {
  boardingRaft,
  fromRaft,
  keysDirection,
  moveBox,
  PLAYER_HALF_SIZE,
  PLAYER_MASS,
  pushApart,
  PLAYER_SPAWN,
  ropeForce,
  ropeMove,
  ropeStep,
  stepAboard,
  stepPlayer,
  SUB,
  type Aboard,
  type RaftPose,
  type IsSlow,
  type IsSolid,
  type PlayerPosition,
} from '../../../packages/shared/src/index.ts'

// The page's own player, predicted so it moves the moment a key is pressed. Each tick's keys are an input with a
// number; the input moves the player here at once and is sent to the server, which plays it on its own copy. When
// the server says where the player is and which input it has played up to, the inputs it has not played yet are played
// again on top of where it says, which lands where the page had the player unless something was lost on the way.
// This is rollback, for one entity only.
//
// Aboard a raft, what is predicted is where the player stands on it (`aboard`); where that is in the world follows the
// raft as the page draws it (`follow`), so the player rides it smoothly, turning with it.
const MAX_UNANSWERED = 120
// Where the player is, on which raft, and how fast a rope is pulling them along, as one input leaves them.
type PlayState = { position: PlayerPosition; aboard: Aboard | undefined; rope: { x: number; y: number } }
// How many of the latest inputs go in each message, so a lost message does not lose its input.
const REDUNDANT_INPUTS = 12
// When the server puts the player right, they are not drawn jumping there: they are drawn where they were, and eased
// onto where they are, the difference shrinking to a third every SMOOTHING_MS. A correction bigger than SMOOTHING_SNAP
// units (a teleport: into the dungeon, waking up at a bed) is drawn at once.
const SMOOTHING_MS = 110
const SMOOTHING_SNAP = 3 * SUB

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
  // The animals the player leads on a rope, where the page reckons they are now: the rope pulls the player here as it
  // does on the server (see `ropeForce`), so being dragged does not wait for the server to say so.
  tethers: (() => ReadonlyArray<{ x: number; y: number }>) | undefined
  // The animals and other players near the player, where the page last saw them: the player is pushed off them here as
  // it is on the server (see `pushApart`). `half` is how far each reaches from its middle, in units.
  crowd: (() => ReadonlyArray<{ x: number; y: number; half: number; mass: number }>) | undefined
  // The raft the player is aboard, and where on it they stand (and stood a tick ago), if they are on one.
  aboard: Aboard | undefined
  previousAboard: Aboard | undefined
  // How fast the ropes the player holds are pulling them along (units a tick: see `ropeStep`).
  rope = { x: 0, y: 0 }
  // The rafts near the player, where the page draws them (to step aboard, and ride).
  rafts: (() => ReadonlyArray<{ id: number; pose: RaftPose }>) | undefined
  // Whether the player can stand with their middle at a point (land, to step off a raft onto).
  canLand: ((point: PlayerPosition) => boolean) | undefined
  private nextSeq = 1
  private unanswered: Array<[number, number]> = []
  // The raft followed last, and which way it was turned then (to turn the player with it).
  private followed: { raft: number; angle: number } | undefined
  // How far from where it is the player is still drawn after a correction (units), and when that was worked out.
  private offset = { x: 0, y: 0 }
  private offsetAt = 0

  // The number of the last input made.
  get lastInput(): number {
    return this.nextSeq - 1
  }

  // Plays a tick of the keys, and gives the inputs to send (the newest few, so the server can fill in a lost one).
  step(keys: number): Array<[number, number]> {
    const input: [number, number] = [this.nextSeq++, keys]
    this.unanswered.push(input)
    if (this.unanswered.length > MAX_UNANSWERED) this.unanswered.shift()
    this.previous = this.position
    this.previousAboard = this.aboard
    const next = this.play({ position: this.position, aboard: this.aboard, rope: this.rope }, keys)
    this.position = next.position
    this.aboard = next.aboard
    this.rope = next.rope
    const { dx, dy } = keysDirection(keys)
    if (dx !== 0 || dy !== 0) this.facing = Math.atan2(dy, dx)
    return this.unanswered.slice(-REDUNDANT_INPUTS)
  }

  // The server's word: where the player was after it played input `played`, the raft they were aboard then, and where
  // on it, and how fast a rope was pulling them along (`rope`).
  reconcile(server: PlayerPosition, played: number, aboard?: Aboard, rope?: { x: number; y: number }): void {
    while (this.unanswered.length > 0 && this.unanswered[0][0] <= played) this.unanswered.shift()
    let state: PlayState = { position: server, aboard, rope: rope ?? { x: 0, y: 0 } }
    for (const [, keys] of this.unanswered) state = this.play(state, keys)
    this.rope = state.rope
    const position = state.position
    // Move where it was drawn from by the same amount, so a correction does not make it jump back and forth.
    const dx = position.x - this.position.x
    const dy = position.y - this.position.y
    if (dx !== 0 || dy !== 0) this.previous = { x: this.previous.x + dx, y: this.previous.y + dy }
    // Still drawn where it was, eased onto where it is now (see `smoothing`): by how far the server put them right.
    // On a raft, that is only how far their place on its deck changed (the raft moving on between the two is not a
    // correction: where they are drawn follows it every frame anyway). Stepping aboard, off, or from one raft to
    // another, it is not eased at all.
    const was = this.aboard
    const now = state.aboard
    let correction: { x: number; y: number } | undefined
    if (!was && !now) correction = { x: dx, y: dy }
    else if (was && now && was.raft === now.raft) {
      const pose = this.raftPose(now.raft)
      if (pose) {
        const from = fromRaft(pose, was)
        const to = fromRaft(pose, now)
        correction = { x: to.x - from.x, y: to.y - from.y }
      }
    }
    if (!correction) this.offset = { x: 0, y: 0 }
    else if (correction.x !== 0 || correction.y !== 0) {
      const at = performance.now()
      const left = this.smoothing(at)
      this.offset = { x: left.x - correction.x, y: left.y - correction.y }
      this.offsetAt = at
      if (Math.hypot(this.offset.x, this.offset.y) > SMOOTHING_SNAP) this.offset = { x: 0, y: 0 }
    }
    if (state.aboard?.raft !== this.aboard?.raft) this.previousAboard = state.aboard
    this.position = position
    this.aboard = state.aboard
  }

  // Where the player is, aboard a raft, as the raft is drawn now (and where they were a tick ago, on it as it is now, to
  // draw them between): they go where it goes, and turn as it turns.
  follow(): void {
    const aboard = this.aboard
    const pose = aboard ? this.raftPose(aboard.raft) : undefined
    if (!aboard || !pose) {
      this.followed = undefined
      return
    }
    this.position = fromRaft(pose, aboard)
    // Where it was a tick ago on the raft; on the tick it stepped aboard, where it stepped from (as the tick left it),
    // so the step on is drawn as smoothly as any other.
    if (this.previousAboard?.raft === aboard.raft) this.previous = fromRaft(pose, this.previousAboard)
    if (this.followed?.raft === aboard.raft) this.facing += pose.angle - this.followed.angle
    this.followed = { raft: aboard.raft, angle: pose.angle }
  }

  private raftPose(id: number): RaftPose | undefined {
    return this.rafts?.().find((raft) => raft.id === id)?.pose
  }

  // One tick of keys: aboard a raft, about its deck (or across onto another raft, or off it onto land); else stepping
  // aboard a raft walked onto, or walking, and then the pull of any rope.
  private play(state: PlayState, keys: number): PlayState {
    const speed = this.speedPercent?.(state.position) ?? 100
    // Aboard a raft, no rope pulls them (they keep to its deck, as on the server).
    if (state.aboard) {
      const pose = this.raftPose(state.aboard.raft)
      // A raft the page has not been told of yet: stay put on it until it has.
      if (!pose) return { ...state, rope: { x: 0, y: 0 } }
      const others = (this.rafts?.() ?? []).filter((other) => other.id !== state.aboard!.raft)
      const next = stepAboard(state.aboard, keys, pose, this.canLand ?? (() => false), speed, others)
      if ('off' in next) return { position: next.off, aboard: undefined, rope: { x: 0, y: 0 } }
      if ('board' in next) {
        const onto = this.raftPose(next.board.raft)
        return onto ? { position: fromRaft(onto, next.board), aboard: next.board, rope: { x: 0, y: 0 } } : { ...state, rope: { x: 0, y: 0 } }
      }
      const aboard = { raft: state.aboard.raft, x: next.x, y: next.y }
      return { position: fromRaft(pose, aboard), aboard, rope: { x: 0, y: 0 } }
    }
    const boarding = boardingRaft(state.position, keys, this.rafts?.() ?? [], speed)
    const boarded = boarding ? this.raftPose(boarding.raft) : undefined
    if (boarding && boarded) return { position: fromRaft(boarded, boarding), aboard: boarding, rope: { x: 0, y: 0 } }
    return { ...this.walk(state.position, keys, speed, state.rope), aboard: undefined }
  }

  // A tick of walking on land, and then the pull of any rope (a spring: see `ropeStep`) and the shove of anyone in
  // the way.
  private walk(position: PlayerPosition, keys: number, speed: number, rope: { x: number; y: number }): { position: PlayerPosition; rope: { x: number; y: number } } {
    let next = stepPlayer(position, keys, this.solid, this.slow, speed)
    const force = { x: 0, y: 0 }
    for (const animal of this.tethers?.() ?? []) {
      const pull = ropeForce(next, animal)
      force.x += pull.x
      force.y += pull.y
    }
    const pulled = ropeMove(next, ropeStep(rope, force, PLAYER_MASS), (dx, dy) => this.nudge(next, dx, dy))
    next = pulled.position
    for (const other of this.crowd?.() ?? []) {
      const push = pushApart(next, PLAYER_HALF_SIZE, PLAYER_MASS, other, other.half, other.mass)
      if (push) next = this.nudge(next, push.a.x, push.a.y)
    }
    return { position: next, rope: pulled.speed }
  }

  private nudge(position: PlayerPosition, dx: number, dy: number): PlayerPosition {
    return this.solid ? moveBox(position, dx, dy, PLAYER_HALF_SIZE, this.solid) : { x: position.x + dx, y: position.y + dy }
  }

  // How far from where it is the player is drawn at `now` (page time), easing onto it after a correction (units).
  smoothing(now: number): { x: number; y: number } {
    if (this.offset.x === 0 && this.offset.y === 0) return this.offset
    const left = Math.pow(1 / 3, Math.max(0, now - this.offsetAt) / SMOOTHING_MS)
    if (Math.hypot(this.offset.x, this.offset.y) * left < 1) {
      this.offset = { x: 0, y: 0 }
      return this.offset
    }
    return { x: this.offset.x * left, y: this.offset.y * left }
  }

  // Puts the player where the server first says it is (and on the raft it says they are aboard).
  place(position: PlayerPosition, aboard?: Aboard): void {
    this.offset = { x: 0, y: 0 }
    this.rope = { x: 0, y: 0 }
    this.position = { ...position }
    this.previous = { ...position }
    this.aboard = aboard
    this.previousAboard = aboard
  }
}
