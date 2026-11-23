import {
  chunkOfTile,
  damageAfterArmor,
  floorDiv,
  moveBox,
  SUB,
  type IsSolid,
  type PlayerPosition,
} from '../../../packages/shared/src/index.ts'
import type { Dropped } from './commands.ts'

// What the server's creatures have in common: the animals (animals.ts) and the monsters (monsters.ts) are each kept by
// a CreatureSet, which does the bookkeeping they share (looking them up, where they were for attacks judged in the
// past, knockbacks, armour, kills), and leaves what they do to their own module. Combat (combat.ts) hurts either the
// same way.

// How far back an attack can be judged against where creatures (and players) were: half a second. A page draws them a
// little in the past (REMOTE_DELAY_TICKS, plus the time their positions take to reach it), and its attack takes time to
// get here, so by the time it runs they have moved on. A page with a slower connection than this is judged against
// where they were this long ago.
export const MAX_REWIND_TICKS = 15
// A knocked back creature slides, slowing by this many percent a tick (so a knockback adds up to about what it says).
const KNOCK_SLOWING = 25

// How a hit moves and holds what it hits: knocked back this many units, stunned for this many ticks.
export type HitEffects = { knockback?: number; stun?: number }

// A creature an attack can reach: where it was where the attacker saw it, and how far it reaches from its middle.
export type Target = { id: number; x: number; y: number; halfSize: number }

// What attacks can hurt besides players (see combat.ts): each CreatureSet is one of these.
export type Creatures = {
  // The ones near a point (within `reach` and their own size), where they were at the end of tick `seen` (where the
  // attacker saw them), or where they are now without it.
  nearAt(point: PlayerPosition, reach: number, seen?: number): Target[]
  // Where one is now (undefined if it is gone).
  where(id: number): PlayerPosition | undefined
  // Hurts one by `amount` (less its armour), from a point, by a player (`by`): what it drops, if that killed it.
  damage(id: number, amount: number, from: PlayerPosition, tick: number, effects?: HitEffects, by?: number): Dropped | undefined
}

// Where things were at the end of each of the last MAX_REWIND_TICKS ticks (by ID), oldest first, so an attack is
// judged against where its attacker saw them.
export class PositionHistory {
  private readonly past: Array<{ tick: number; spots: Map<number, PlayerPosition> }> = []

  remember(tick: number, things: Iterable<{ id: number; x: number; y: number }>): void {
    const spots = new Map<number, PlayerPosition>()
    for (const thing of things) spots.set(thing.id, { x: thing.x, y: thing.y })
    this.past.push({ tick, spots })
    while (this.past.length > MAX_REWIND_TICKS) this.past.shift()
  }

  // Where everything was at the end of tick `seen`: nothing without `seen` (then where they are now is what counts),
  // and as far back as is remembered for a tick further back than that.
  at(seen: number | undefined): ReadonlyMap<number, PlayerPosition> | undefined {
    if (seen === undefined) return undefined
    const oldest = this.past[0]
    if (oldest && seen < oldest.tick) return oldest.spots
    return this.past.find((entry) => entry.tick === seen)?.spots
  }
}

// What every creature is, whatever else it is.
export type Creature = {
  id: number
  // Where its middle is, in units.
  x: number
  y: number
  // Being knocked back (units a tick), and stunned until.
  vx: number
  vy: number
  stunnedUntil: number
  def: { halfSize: number; armor: number }
}

export abstract class CreatureSet<C extends Creature> implements Creatures {
  // Every one, by ID. They are only ever added with a new, higher ID, so this is in ID order too.
  readonly all = new Map<number, C>()
  protected nextId = 1
  // The tick being run (or last run).
  protected tickNow = 0
  private readonly history = new PositionHistory()
  // The ones killed on the tick being run, and the damage of the blow that killed each (pages show it, and it falling,
  // before its drops).
  private readonly killed = new Map<number, number>()

  // Hurts one: see each kind's.
  abstract damage(id: number, amount: number, from: PlayerPosition, tick: number, effects?: HitEffects, by?: number): Dropped | undefined

  get(id: number): C | undefined {
    return this.all.get(id)
  }

  // In ID order, which is the order everything goes through them in.
  list(): C[] {
    return [...this.all.values()]
  }

  // The ones in some chunks (what a page is told of).
  inChunks(chunks: ReadonlySet<number>): C[] {
    return this.list().filter((creature) => chunks.has(chunkOfTile(floorDiv(creature.x, SUB), floorDiv(creature.y, SUB))))
  }

  where(id: number): PlayerPosition | undefined {
    const creature = this.all.get(id)
    return creature ? { x: creature.x, y: creature.y } : undefined
  }

  // Takes one away (let go, cleared away): not killed, it drops nothing.
  remove(id: number): void {
    this.all.delete(id)
  }

  // Notes where each one is at the end of `tick` (after they have moved), for attacks judged against the past.
  remember(tick: number): void {
    this.history.remember(tick, this.all.values())
  }

  // The ones near a point as they were at the end of tick `seen` (where a page drew them), each where it was then; or
  // as they are now, without `seen`. One that came since is where it is now.
  nearAt(point: PlayerPosition, reach: number, seen?: number): Target[] {
    const then = this.history.at(seen)
    const found: Target[] = []
    for (const creature of this.all.values()) {
      const spot = then?.get(creature.id) ?? creature
      const halfSize = creature.def.halfSize
      if (Math.hypot(spot.x - point.x, spot.y - point.y) <= reach + halfSize) found.push({ id: creature.id, x: spot.x, y: spot.y, halfSize })
    }
    return found
  }

  // The damage of the blow that killed one on the tick being run, if it was killed (not let go or wandered off).
  killedBy(id: number): number | undefined {
    return this.killed.get(id)
  }

  // Forgets the tick's kills, once pages have been told of them.
  forgetKills(): void {
    this.killed.clear()
  }

  protected add(creature: C): C {
    this.all.set(creature.id, creature)
    return creature
  }

  // A blow lands on one: it loses `amount` less its armour (never all of it), and, unless it is `steady` (a boss, a
  // skeleton in the middle of its thrust), is knocked back away from `from` and stunned. If that kills it, it is gone,
  // noted as killed. Gives the damage dealt.
  protected takeBlow(creature: C & { hp: number }, amount: number, from: PlayerPosition, tick: number, effects: HitEffects, steady = false): number {
    const dealt = damageAfterArmor(amount, creature.def.armor)
    creature.hp -= dealt
    if (creature.hp <= 0) {
      this.all.delete(creature.id)
      this.killed.set(creature.id, dealt)
      return dealt
    }
    if (steady) return dealt
    if (effects.knockback) {
      const dx = creature.x - from.x
      const dy = creature.y - from.y
      const away = Math.hypot(dx, dy) || 1
      // A slide that adds up to about `knockback`, given how it slows.
      const speed = Math.round((effects.knockback * KNOCK_SLOWING) / 100)
      creature.vx = Math.round((dx / away) * speed)
      creature.vy = Math.round((dy / away) * speed)
    }
    if (effects.stun) creature.stunnedUntil = Math.max(creature.stunnedUntil, tick + effects.stun)
    return dealt
  }

  // A knocked back one slides on, slowing, kept out of what it cannot walk into.
  protected slide(creature: C, blocked: IsSolid): void {
    if (creature.vx === 0 && creature.vy === 0) return
    Object.assign(creature, moveBox(creature, creature.vx, creature.vy, creature.def.halfSize, blocked))
    creature.vx = Math.trunc((creature.vx * (100 - KNOCK_SLOWING)) / 100)
    creature.vy = Math.trunc((creature.vy * (100 - KNOCK_SLOWING)) / 100)
  }
}
