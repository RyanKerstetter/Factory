import {
  BOSS_HALL_RADIUS,
  dungeonBlocks,
  floorDiv,
  inBossHall,
  itemByKey,
  LICH_SPELLS,
  monsterDef,
  PLAYER_HALF_SIZE,
  Rng,
  SUB,
  TPS,
  type LichSpell,
  type PlayerPosition,
} from '../../../packages/shared/src/index.ts'
import type { Combat } from './combat.ts'
import type { Monster, Monsters } from './monsters.ts'

// The frost lich's fight, once it has started (see dungeons.ts for the hall, its door and the line across its mouth).
// The lich stands in the middle of its hall and never moves: the players move round it, dodging what it casts.
//
// Every `castEvery` it begins a spell, casting for `castTime` (its staff raised, glowing: the pages show which kind of
// spell is coming), and then the spell goes off. Which one is picked as the cast begins:
// - Now and then (`summon.chance`), once every archer it called up last time is dead and it has cast `summon.afterCasts`
//   times since, it calls up `summon.base` skeleton archers, and `summon.perExtraPlayer` more for each player after the first, round the edge of the hall, set on them.
// - Otherwise by where the players are: if more of them are within `closeRange` of it than further off (a tie either
//   way, at random), one of its close spells, else one of its far ones (at random each time):
//   - close: a blizzard, a whirl of cold wind round it, hurting everyone in it every so often, armour or not; or wisps,
//     coming in `wisps.perPlayer` waves over `wisps.over`, each wave one wisp for every player at once, on a ring halfway out to the wall (or, if no spot there will do, anywhere else in the
//     hall), never near a player or each other. They drift after the nearest player, slower than one runs, push each
//     other apart, and burst against them (see `frost-wisp` in monsters.json);
//   - far: icicles falling where each player stands (and more round them), shown where they will land before; or a
//     shotgun of shards of ice fanned at each player.
//
// Every number here is from the lich's "attack" in data/monsters.json (see LichSpells), where to tweak them.
const SPELLS = LICH_SPELLS
export const CAST_EVERY = SPELLS.castEvery
export const CAST_TICKS = SPELLS.castTime
const FIRST_CAST = SPELLS.firstCast
const CLOSE_RANGE = SPELLS.closeRange
const BLIZZARD = SPELLS.blizzard
const WISPS = SPELLS.wisps
const ICICLES = SPELLS.icicles
const SHARDS = SPELLS.shards
const SUMMON = SPELLS.summon
// Tries at a spot for a wisp on its ring, then anywhere else in the hall, before it takes the best spot it found.
const WISP_TRIES = 24

// What the fight needs from the room on a tick.
export type LichContext = {
  tick: number
  // The copy of the dungeon the hall is in.
  slot: number
  monsters: Monsters
  combat: Combat
  hurtPlayer: (id: number, damage: number, from: PlayerPosition, knockback: number, pierce?: boolean) => void
  // Tells the pages of the players in the copy about a spell, to draw it: where, how far it reaches (tiles), and for
  // how long (ticks).
  spell: (spell: LichSpell, x: number, y: number, radius: number, ticks: number) => void
}

export class LichFight {
  private casts = 0
  private nextCastAt: number
  private casting?: { spell: LichSpell; at: number }
  private blizzard?: { until: number; nextHurtAt: number }
  // The waves of wisps still to come: when each comes, and how many wisps in it.
  private wispsDue: Array<{ at: number; count: number }> = []
  private wisps: number[] = []
  private summoned: number[] = []
  private lastSummon = Number.NEGATIVE_INFINITY

  constructor(
    start: number,
    private readonly rng: Rng,
  ) {
    this.nextCastAt = start + FIRST_CAST
  }

  // Everything the fight called up (to take away when it is given up).
  calledUp(): number[] {
    return [...this.wisps, ...this.summoned]
  }

  // A tick of the fight, with the players in the lich's rooms.
  step(context: LichContext, lich: Monster, players: ReadonlyArray<{ id: number; position: PlayerPosition }>): void {
    const { tick } = context
    this.wisps = this.wisps.filter((id) => context.monsters.get(id))
    this.summoned = this.summoned.filter((id) => context.monsters.get(id))
    // A cast that is done goes off.
    if (this.casting && tick >= this.casting.at + CAST_TICKS) {
      const spell = this.casting.spell
      this.casting = undefined
      lich.casting = undefined
      this.cast(context, lich, spell, players)
    }
    if (!this.casting && tick >= this.nextCastAt && players.length > 0) {
      const spell = this.pick(lich, players)
      this.casting = { spell, at: tick }
      lich.casting = { k: 'cast', spell, ticks: CAST_TICKS, at: tick }
      this.nextCastAt = tick + CAST_EVERY
      this.casts++
      if (spell === 'summon') this.lastSummon = this.casts
    }
    // The blizzard, while it blows.
    const blizzard = this.blizzard
    if (blizzard) {
      if (tick >= blizzard.until) this.blizzard = undefined
      else if (tick >= blizzard.nextHurtAt) {
        blizzard.nextHurtAt = tick + BLIZZARD.every
        for (const player of players) {
          if (Math.hypot(player.position.x - lich.x, player.position.y - lich.y) <= BLIZZARD.radius + PLAYER_HALF_SIZE) {
            context.hurtPlayer(player.id, BLIZZARD.damage, lich, 0, true)
          }
        }
      }
    }
    // Wisps coming, a wave at a time: one for each player, all at once.
    while (this.wispsDue.length > 0 && tick >= this.wispsDue[0].at) {
      const wave = this.wispsDue.shift()!
      for (let i = 0; i < wave.count; i++) this.wisp(context, lich, players)
    }
  }

  // Which spell to cast, from where the players are (see above).
  private pick(lich: Monster, players: ReadonlyArray<{ position: PlayerPosition }>): LichSpell {
    const archersGone = this.summoned.length === 0
    if (archersGone && this.casts - this.lastSummon >= SUMMON.afterCasts && this.rng.next() < SUMMON.chance) return 'summon'
    const close = players.filter((player) => Math.hypot(player.position.x - lich.x, player.position.y - lich.y) <= CLOSE_RANGE).length
    const far = players.length - close
    const near = close > far || (close === far && this.rng.next() < 0.5)
    const either = this.rng.next() < 0.5
    return near ? (either ? 'blizzard' : 'wisps') : either ? 'icicles' : 'shards'
  }

  private cast(context: LichContext, lich: Monster, spell: LichSpell, players: ReadonlyArray<{ id: number; position: PlayerPosition }>): void {
    const { tick, slot } = context
    const inHall = (x: number, y: number): boolean => inBossHall(slot, floorDiv(x, SUB), floorDiv(y, SUB))
    switch (spell) {
      case 'icicles': {
        const icicle = itemByKey('icicle')?.id ?? 0
        for (const player of players) {
          context.combat.icicle(icicle, player.position.x, player.position.y, ICICLES.warning, ICICLES.radius, ICICLES.damage)
          for (let n = 0; n < ICICLES.extra; n++) {
            const angle = this.rng.next() * Math.PI * 2
            const x = Math.round(player.position.x + Math.cos(angle) * ICICLES.spread)
            const y = Math.round(player.position.y + Math.sin(angle) * ICICLES.spread)
            if (inHall(x, y)) context.combat.icicle(icicle, x, y, ICICLES.warning, ICICLES.radius, ICICLES.damage)
          }
        }
        return
      }
      case 'shards': {
        const shard = itemByKey('ice-shard')?.id ?? 0
        for (const player of players) {
          const aim = Math.atan2(player.position.y - lich.y, player.position.x - lich.x)
          for (let i = 0; i < SHARDS.count; i++) {
            context.combat.hostileShot(shard, lich.x, lich.y, aim + (SHARDS.count > 1 ? i / (SHARDS.count - 1) - 0.5 : 0) * SHARDS.arc, SHARDS.speed, SHARDS.damage, SHARDS.duration)
          }
        }
        return
      }
      case 'blizzard':
        this.blizzard = { until: tick + BLIZZARD.duration, nextHurtAt: tick }
        context.spell('blizzard', lich.x, lich.y, BLIZZARD.radius / SUB, BLIZZARD.duration)
        return
      case 'wisps': {
        // `perPlayer` waves, spread evenly over `over`, each a wisp for every player (so more players, bigger waves, not
        // more of them).
        const waves = WISPS.perPlayer
        for (let i = 0; i < waves; i++) this.wispsDue.push({ at: tick + Math.round((i * WISPS.over) / Math.max(1, waves)), count: players.length })
        return
      }
      case 'summon': {
        const archer = monsterDef('skeleton-archer')
        const ring = (BOSS_HALL_RADIUS - 1.8) * SUB
        const count = SUMMON.base + SUMMON.perExtraPlayer * Math.max(0, players.length - 1)
        const turn = this.rng.next() * Math.PI * 2
        for (let i = 0; i < count; i++) {
          const angle = turn + (i / count) * Math.PI * 2
          const x = Math.round(lich.x + Math.cos(angle) * ring)
          const y = Math.round(lich.y + Math.sin(angle) * ring)
          if (!inHall(x, y) || dungeonBlocks(floorDiv(x, SUB), floorDiv(y, SUB))) continue
          const called = context.monsters.spawn(archer, x, y, { dungeon: slot })
          const nearest = [...players].sort((a, b) => Math.hypot(a.position.x - x, a.position.y - y) - Math.hypot(b.position.x - x, b.position.y - y))[0]
          if (nearest) context.monsters.provoke(called.id, nearest.id, tick)
          this.summoned.push(called.id)
          context.spell('summon', x, y, 0.8, TPS)
        }
        return
      }
    }
  }

  // A wisp, at a spot at least `wisps.clear` from every player and `wisps.apart` from the other wisps: on the ring halfway
  // out to the wall if one there will do, else anywhere in the hall; failing both, wherever it found furthest from the
  // players. Never right beside one.
  private wisp(context: LichContext, lich: Monster, players: ReadonlyArray<{ position: PlayerPosition }>): void {
    const others = this.wisps.map((id) => context.monsters.get(id)).filter((wisp): wisp is Monster => wisp !== undefined)
    const fromPlayers = (x: number, y: number): number => players.reduce((nearest, player) => Math.min(nearest, Math.hypot(player.position.x - x, player.position.y - y)), Infinity)
    let fallback: { x: number; y: number; distance: number } | undefined
    let spot: { x: number; y: number } | undefined
    for (let attempt = 0; attempt < WISP_TRIES * 2 && !spot; attempt++) {
      const angle = this.rng.next() * Math.PI * 2
      // The ring first; then anywhere out from the lich to near the wall.
      const out = attempt < WISP_TRIES ? BOSS_HALL_RADIUS / 2 : 1.5 + this.rng.next() * (BOSS_HALL_RADIUS - 3)
      const x = Math.round(lich.x + Math.cos(angle) * out * SUB)
      const y = Math.round(lich.y + Math.sin(angle) * out * SUB)
      if (!inBossHall(context.slot, floorDiv(x, SUB), floorDiv(y, SUB)) || dungeonBlocks(floorDiv(x, SUB), floorDiv(y, SUB))) continue
      const distance = fromPlayers(x, y)
      if (!fallback || distance > fallback.distance) fallback = { x, y, distance }
      if (distance < WISPS.clear) continue
      if (others.some((other) => Math.hypot(other.x - x, other.y - y) < WISPS.apart)) continue
      spot = { x, y }
    }
    spot ??= fallback
    if (!spot) return
    const wisp = context.monsters.spawn(monsterDef('frost-wisp'), spot.x, spot.y, { dungeon: context.slot })
    this.wisps.push(wisp.id)
    context.spell('wisps', spot.x, spot.y, 0.6, Math.round(0.5 * TPS))
  }
}
