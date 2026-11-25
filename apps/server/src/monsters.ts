import {
  attackClear,
  BUILDINGS,
  campSites,
  chunkOfTile,
  goblinCampSites,
  tombSites,
  dungeonBlocks,
  floorDiv,
  getItem,
  groundBlocks,
  hashInts,
  inSwing,
  isInsideWorld,
  monsterDef,
  MONSTER_MASS,
  moveBox,
  PLAYER_HALF_SIZE,
  Rng,
  SUB,
  TPS,
  type FactoryWorld,
  type IsSolid,
  type ItemId,
  type MonsterAct,
  type MonsterDef,
  type MonsterInfo,
  type MonsterPosition,
  type PlayerPosition,
  type Terrain,
  WORLD_GEN,
} from '../../../packages/shared/src/index.ts'
import type { BeeState } from './bees.ts'
import type { Body } from './bodies.ts'
import type { Dropped } from './commands.ts'
import { CreatureSet, type HitEffects } from './creatures.ts'
import { pursue, sightClear, stepToward, straightClear, type Path } from './steering.ts'

// The monsters (see data/monsters.json): the skeletons that keep the mountains' camps (see `tendCamps`) and guard the
// dungeon's rooms (see dungeons.ts), the frost lich and what it calls up (see frost-lich.ts), the goblins that keep the
// meadow's camps and the mummies the desert's tombs, and the bees out of their hives (what they do is bees.ts's: here they are only kept, and hit). Like the animals,
// they are the server's alone: pages are sent where they are with the players' positions, and what each one is
// (MonsterInfo) whenever that changes.
//
// What a monster does:
// - It stands where it keeps (its post round a camp's fire, or in its room) until it sees a player within its
//   `aggroRadius` (walls hide them), and then goes for them, calling every other monster within ALERT_RADIUS that can
//   see it. Hurt, it goes for whoever hurt it, and calls the others the same way.
// - It gives a chase up once the player is more than its `leash` from where it keeps, or out of its sight for
//   LOST_TICKS, and goes back, not taking up another chase by itself for CALM_TICKS.
// - It attacks (see `attack` in monsters.json): a skeleton winds up and swings its sword close in, or from further off
//   winds up a charge and dashes through the player; an archer aims and looses an arrow; a wisp drifts after the nearest
//   player and bursts against them; a goblin walks up to the player and hits them. A skeleton winding up, swinging or dashing is not knocked back (nor stunned) by a
//   hit; and a boss never is. The charge and the arrow are aimed where the player was a moment before, so one who
//   keeps moving can get out of the way.
// - Every hit on it knocks it back a little and stuns it for a moment (see combat.ts).

// Going home after giving up, a monster goes RETURN_PACE times as fast as it chases.
const RETURN_PACE = 2
// How long a monster that gave up a chase leaves players alone, and how long a player out of its sight it chases.
const CALM_TICKS = 6 * TPS
const LOST_TICKS = 4 * TPS
// Noticing, or hurt, a monster calls the others within this many tiles that can see it.
const ALERT_RADIUS = 10
// Players are looked for every WATCH_EVERY ticks.
const WATCH_EVERY = 4
// A skeleton starts its swing with the player within this share of its reach (so it lands as they move).
const SWING_START = 0.8
// An arrow flies for as long as it takes to go this many times the archer's range.
const ARROW_FLIGHT = 1.5
// A wisp bursting against a player knocks them back this far (units).
const WISP_KNOCKBACK = Math.round(0.4 * SUB)

// The skeletons' camps (see campSites in terrain.ts): each keeps CAMP_MIN to CAMP_MAX skeletons, CAMP_ARCHERS_MIN to
// CAMP_ARCHERS_MAX of them archers, first put CAMP_POST tiles out from its fire. One that is killed comes back
// CAMP_RESPAWN_TICKS later, once a player is within CAMP_ACTIVE tiles of the camp and none is within CAMP_UNSEEN tiles
// (so they never appear in front of anyone). Looked after every CAMP_EVERY ticks. (The numbers from "camps" in
// data/world-gen.json.)
const CAMP_MIN = WORLD_GEN.camps.guardsMin
const CAMP_MAX = WORLD_GEN.camps.guardsMax
const CAMP_ARCHERS_MIN = WORLD_GEN.camps.archersMin
const CAMP_ARCHERS_MAX = WORLD_GEN.camps.archersMax
const CAMP_POST = 2.2
const CAMP_RESPAWN_TICKS = Math.round(WORLD_GEN.camps.respawnSeconds * TPS)
const CAMP_ACTIVE = 64
const CAMP_UNSEEN = 14
const CAMP_EVERY = TPS
// A camp's skeletons patrol: each walks (at PATROL_PACE of its chasing speed) to a spot within PATROL_RADIUS tiles of
// the camp's fire, stands there PATROL_WAIT_MIN to PATROL_WAIT_MAX ticks, and picks another. Of PATROL_TRIES spots it
// takes the one furthest from the others of its camp (and where they are going), so they spread out rather than clump.
const PATROL_RADIUS = WORLD_GEN.camps.patrolRadius
const PATROL_PACE = 0.4
const PATROL_WAIT_MIN = 2 * TPS
const PATROL_WAIT_MAX = 6 * TPS
const PATROL_TRIES = 8
// The goblins' camps on the meadow (see goblinCampSites in world-gen.ts, and `goblinCamps` in data/world-gen.json): kept
// like the skeletons', by GOBLINS_MIN to GOBLINS_MAX goblins, patrolling within GOBLIN_PATROL tiles of the fire.
const GOBLINS_MIN = WORLD_GEN.goblinCamps.goblinsMin
const GOBLINS_MAX = WORLD_GEN.goblinCamps.goblinsMax
const GOBLIN_PATROL = WORLD_GEN.goblinCamps.patrolRadius
const GOBLIN_RESPAWN_TICKS = Math.round(WORLD_GEN.goblinCamps.respawnSeconds * TPS)
// The mummies' tombs in the desert (see tombSites in world-gen.ts, and `tombs` in data/world-gen.json): kept the same
// way, by MUMMIES_MIN to MUMMIES_MAX mummies, patrolling within MUMMY_PATROL tiles of the tomb.
const MUMMIES_MIN = WORLD_GEN.tombs.mummiesMin
const MUMMIES_MAX = WORLD_GEN.tombs.mummiesMax
const MUMMY_PATROL = WORLD_GEN.tombs.patrolRadius
const MUMMY_RESPAWN_TICKS = Math.round(WORLD_GEN.tombs.respawnSeconds * TPS)
// Wisps that overlap push each other apart by this share of the overlap each tick.
const WISP_PUSH = 0.35

export type Monster = {
  id: number
  def: MonsterDef
  // Where its middle is, in units.
  x: number
  y: number
  hp: number
  // Its health when whole (a boss has more, the more players fight it: see dungeons.ts).
  maxHp: number
  // Where it keeps (units): it goes back there when it gives up a chase.
  homeX: number
  homeY: number
  // Being knocked back (units a tick), and stunned until.
  vx: number
  vy: number
  stunnedUntil: number
  // The player it is after (0 for none), since when it has not seen them, and until when it leaves players alone.
  target: number
  lostSince?: number
  calmUntil: number
  // When it can attack again (and charge again), and what it is doing: winding up a swing or a charge, dashing (and whom
  // it has hit on the way), recovering, or aiming (`at` when it started, `until` when it is done, `angle` which way).
  readyAt: number
  chargeReadyAt?: number
  act?: { k: 'swing' | 'charge' | 'dash' | 'recover' | 'aim'; at: number; until: number; angle: number; hit?: Set<number> }
  // A boss's spell being cast (shown on the pages; see frost-lich.ts).
  casting?: Extract<MonsterAct, { k: 'cast' }>
  // When it came (a wisp lasts its `lifetime`).
  bornAt: number
  path?: Path
  // A camp skeleton: which camp, and which of its places. A dungeon monster: the copy's slot.
  post?: { camp: number; slot: number }
  dungeon?: number
  // A camp skeleton's patrol: where it is walking to (units), and until when it stands there once it has arrived.
  patrol?: { x: number; y: number; waitUntil?: number }
  // A bee: what it is doing (see bees.ts).
  bee?: BeeState
}

// What the monsters need from the room on a tick.
export type MonsterContext = {
  world: FactoryWorld
  terrain: Terrain
  seed: number
  tick: number
  players: ReadonlyArray<{ id: number; position: PlayerPosition }>
  // Whether a chunk has been grown yet; monsters keep to ground that has.
  isGrown: (chunk: number) => boolean
  // What players cannot walk into, for where a monster pushes one.
  solidForPlayers: IsSolid
  // Hurts a player, from a point, pushing them `knockback` units away.
  hurtPlayer: (id: number, damage: number, from: PlayerPosition, knockback: number) => void
  // Looses something at the players (it flies through creatures): from a point, along `angle`, at `speed` units a
  // tick, for `ttl` ticks.
  shoot: (item: ItemId, x: number, y: number, angle: number, speed: number, damage: number, ttl: number) => void
  // Where a player was `ago` ticks before (or is, if that is not known), for aiming behind them.
  playerWas: (id: number, ago: number) => PlayerPosition | undefined
}

// A camp: a skeletons' or a goblins' (or a mummies' tomb), its middle (units), how far round it they patrol (tiles), how long one killed
// takes to come back (ticks), and its places.
type Camp = { x: number; y: number; kind: 'skeleton' | 'goblin' | 'mummy'; patrol: number; respawn: number; places: Array<{ id: number; respawnAt: number; archer: boolean }> }

export class Monsters extends CreatureSet<Monster> {
  private readonly rng: Rng
  private camps: Camp[] | undefined

  // `keepCamps`: whether the camps are kept (off for tests that want the mountains empty).
  constructor(seed: number, private readonly keepCamps = true) {
    super()
    this.rng = new Rng((seed ^ 0x5ce1e7) >>> 0)
  }

  // ---- what there is

  info(monster: Monster): MonsterInfo {
    const act = monster.casting ?? this.actInfo(monster)
    return {
      id: monster.id,
      kind: monster.def.kind,
      hp: Math.max(0, Math.round(monster.hp)),
      maxHp: monster.maxHp,
      ...(monster.target !== 0 ? { angry: true } : {}),
      ...(act ? { act } : {}),
    }
  }

  private actInfo(monster: Monster): MonsterAct | undefined {
    const act = monster.act
    if (!act || act.k === 'recover') return undefined
    return { k: act.k, angle: Math.round(act.angle * 100) / 100, ticks: act.until - act.at, at: act.at }
  }

  position(monster: Monster): MonsterPosition {
    return [monster.id, monster.x, monster.y]
  }

  // The camps' middles (units), for tests and the debug view.
  campMiddles(): ReadonlyArray<{ x: number; y: number }> {
    return this.camps ?? []
  }

  // ---- making them

  spawn(def: MonsterDef, x: number, y: number, options: { dungeon?: number; post?: { camp: number; slot: number }; hp?: number } = {}): Monster {
    const hp = options.hp ?? def.hp
    const monster: Monster = {
      id: this.nextId++,
      def,
      x,
      y,
      hp,
      maxHp: hp,
      homeX: x,
      homeY: y,
      vx: 0,
      vy: 0,
      stunnedUntil: 0,
      target: 0,
      calmUntil: 0,
      readyAt: 0,
      bornAt: this.tickNow,
      ...(options.dungeon !== undefined ? { dungeon: options.dungeon } : {}),
      ...(options.post ? { post: options.post } : {}),
    }
    return this.add(monster)
  }

  // Sets a monster on a player.
  provoke(id: number, playerId: number, tick: number): void {
    const monster = this.all.get(id)
    if (!monster) return
    monster.target = playerId
    monster.lostSince = undefined
    monster.calmUntil = tick
  }

  // A monster is whole again, after no one, back where it keeps (a boss whose challengers have all fallen or fled).
  reset(id: number, tick: number, hp?: number): void {
    const monster = this.all.get(id)
    if (!monster) return
    monster.target = 0
    monster.maxHp = hp ?? monster.def.hp
    monster.hp = monster.maxHp
    monster.x = monster.homeX
    monster.y = monster.homeY
    monster.act = undefined
    monster.casting = undefined
    monster.calmUntil = tick + CALM_TICKS
  }

  // ---- being hit (see combat.ts)

  // A monster is hurt by `amount` (less its armour, never all of it), from a point, by a player (`by`): knocked back
  // and stunned (unless it is winding up or thrusting, or is a boss), and it goes for whoever hurt it, calling the
  // others. Gives what it drops if that killed it.
  damage(id: number, amount: number, from: PlayerPosition, tick: number, effects: HitEffects = {}, by = 0): Dropped | undefined {
    const monster = this.all.get(id)
    if (!monster) return undefined
    const attacking = monster.act?.k === 'swing' || monster.act?.k === 'charge' || monster.act?.k === 'dash'
    this.takeBlow(monster, amount, from, tick, effects, monster.def.boss || attacking)
    if (monster.hp > 0) {
      if (by !== 0 && !monster.def.boss && monster.def.aggroRadius > 0) {
        monster.target = by
        monster.lostSince = undefined
        this.alert(monster, by, tick)
      }
      return undefined
    }
    const drops: Array<[string, number]> = []
    for (const drop of monster.def.drops) {
      const count = drop.min + this.rng.nextInt(drop.max - drop.min + 1)
      if (count > 0) drops.push([getItem(drop.item).key, count])
    }
    return drops
  }

  // ---- each tick

  step(context: MonsterContext): void {
    this.tickNow = context.tick
    if (this.keepCamps && context.tick % CAMP_EVERY === 0) this.tendCamps(context)
    const blocked = this.blockedFor(context)
    for (const monster of this.list()) {
      if (!this.all.has(monster.id)) continue
      // Bees fly, knocked about over anything, and do what bees.ts has them do.
      if (isBee(monster)) {
        this.slide(monster, () => false)
        continue
      }
      this.slide(monster, blocked)
      if (monster.def.attack.kind === 'touch') {
        this.drift(context, monster)
        continue
      }
      if (monster.def.attack.kind === 'spells') continue
      if (monster.stunnedUntil > context.tick) continue
      if ((context.tick + monster.id) % WATCH_EVERY === 0) this.watch(context, monster)
      this.act(context, monster, blocked)
    }
    this.spreadWisps()
  }

  // Wisps that overlap push each other apart (they are not bodies, see `bodies`), kept out of the dungeon's walls.
  private spreadWisps(): void {
    const wisps = this.list().filter((monster) => monster.def.attack.kind === 'touch')
    const walls: IsSolid = (x, y) => dungeonBlocks(x, y)
    for (let i = 0; i < wisps.length; i++) {
      for (let j = i + 1; j < wisps.length; j++) {
        const a = wisps[i]
        const b = wisps[j]
        if (a.dungeon !== b.dungeon) continue
        // As far apart as they are drawn wide, so they never look to overlap.
        const apart = Math.max(a.def.halfSize + b.def.halfSize, ((a.def.size + b.def.size) / 2) * SUB)
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distance = Math.hypot(dx, dy)
        if (distance >= apart) continue
        if (distance < 1) {
          // Right on top of each other: apart along a way picked from their ids.
          const angle = a.id * 1.7 + b.id * 2.3
          dx = Math.cos(angle)
          dy = Math.sin(angle)
          distance = 1
        }
        const push = ((apart - distance) / 2) * WISP_PUSH + 1
        const px = Math.round((dx / distance) * push)
        const py = Math.round((dy / distance) * push)
        Object.assign(a, moveBox(a, -px, -py, a.def.halfSize, walls))
        Object.assign(b, moveBox(b, px, py, b.def.halfSize, walls))
      }
    }
  }

  // Noticing players, and giving chases up.
  private watch(context: MonsterContext, monster: Monster): void {
    const { tick } = context
    if (monster.target !== 0) {
      const target = context.players.find((player) => player.id === monster.target)
      const fromHome = target ? Math.hypot(target.position.x - monster.homeX, target.position.y - monster.homeY) : Infinity
      if (!target || fromHome > monster.def.leash) return this.giveUp(monster, tick)
      if (this.canSee(context, monster, target.position)) monster.lostSince = undefined
      else {
        monster.lostSince ??= tick
        if (tick - monster.lostSince >= LOST_TICKS) this.giveUp(monster, tick)
      }
      return
    }
    if (tick < monster.calmUntil || monster.def.aggroRadius <= 0) return
    let nearest: { id: number; distance: number } | undefined
    for (const player of context.players) {
      const distance = Math.hypot(player.position.x - monster.x, player.position.y - monster.y)
      if (distance > monster.def.aggroRadius || (nearest && distance >= nearest.distance)) continue
      if (Math.hypot(player.position.x - monster.homeX, player.position.y - monster.homeY) > monster.def.leash) continue
      if (!this.canSee(context, monster, player.position)) continue
      nearest = { id: player.id, distance }
    }
    if (!nearest) return
    monster.target = nearest.id
    monster.lostSince = undefined
    this.alert(monster, nearest.id, tick)
  }

  // Calls the monsters near one (within ALERT_RADIUS, that can see it) that are not after anyone onto a player; a camp's
  // skeleton calls every other of its camp, wherever they are on their patrols.
  private alert(monster: Monster, playerId: number, tick: number): void {
    for (const other of this.all.values()) {
      if (other === monster || other.target !== 0 || other.def.aggroRadius <= 0 || other.dungeon !== monster.dungeon) continue
      const campmate = monster.post !== undefined && other.post?.camp === monster.post.camp
      if (!campmate) {
        if (Math.hypot(other.x - monster.x, other.y - monster.y) > ALERT_RADIUS * SUB) continue
        if (!sightClear(other, monster)) continue
      }
      other.target = playerId
      other.lostSince = undefined
      other.calmUntil = tick
      other.patrol = undefined
    }
  }

  private giveUp(monster: Monster, tick: number): void {
    monster.target = 0
    monster.patrol = undefined
    monster.lostSince = undefined
    monster.act = undefined
    monster.calmUntil = tick + CALM_TICKS
  }

  // Whether nothing solid lies between a monster and a point (a dungeon's walls, a tree, a rock).
  private canSee(context: MonsterContext, monster: Monster, point: PlayerPosition): boolean {
    return sightClear(monster, point) && attackClear(context.world, monster, point)
  }

  // Chasing and attacking, or going back to where it keeps.
  private act(context: MonsterContext, monster: Monster, blocked: IsSolid): void {
    const { tick } = context
    const attack = monster.def.attack
    // In the middle of an attack: it carries on with it, standing.
    if (monster.act) {
      if (monster.act.k === 'recover') {
        if (tick >= monster.act.until) monster.act = undefined
        return
      }
      const target = context.players.find((player) => player.id === monster.target)
      if (monster.act.k === 'aim' && attack.kind === 'bow') {
        // Aiming: it turns to follow where the player was a moment ago while it can see them, and looses at the end.
        if (!target) {
          monster.act = undefined
          return
        }
        if (this.canSee(context, monster, target.position)) monster.act.angle = this.aimBehind(context, monster, target.id, attack.lead)
        if (tick < monster.act.until) return
        context.shoot(attack.item, monster.x, monster.y, monster.act.angle, attack.speed, attack.damage, Math.ceil((attack.range * ARROW_FLIGHT) / Math.max(1, attack.speed)))
        monster.act = undefined
        monster.readyAt = tick + attack.cooldown
        return
      }
      if (attack.kind === 'blade') {
        this.blade(context, monster, attack, blocked)
        return
      }
      monster.act = undefined
      return
    }
    const target = context.players.find((player) => player.id === monster.target)
    if (!target) {
      // A camp's skeleton patrols round its camp; any other goes back to where it keeps.
      if (monster.post) this.patrol(context, monster, blocked)
      else pursue(monster, monster.def.halfSize, monster.homeX, monster.homeY, monster.def.speed * RETURN_PACE, SUB / 3, blocked, tick)
      return
    }
    const prey = target.position
    const distance = Math.hypot(prey.x - monster.x, prey.y - monster.y)
    const angle = Math.atan2(prey.y - monster.y, prey.x - monster.x)
    if (attack.kind === 'blade') {
      const within = (attack.swing.reach + PLAYER_HALF_SIZE) * SWING_START
      const ready = tick >= monster.readyAt
      // Close in: a swing, the way the player is.
      if (distance <= within && ready && this.canSee(context, monster, prey)) {
        monster.act = { k: 'swing', at: tick, until: tick + attack.swing.windup, angle }
        return
      }
      // Further off, now and then: a charge, `chance` of the times it could (else it closes in to swing, and does
      // not think of charging again for a while), so a fight does not open the same way every time.
      const charge = attack.charge
      if (distance >= charge.near && distance <= charge.from && ready && tick >= (monster.chargeReadyAt ?? 0) && this.canSee(context, monster, prey)) {
        if (this.rng.next() >= charge.chance) {
          monster.chargeReadyAt = tick + charge.cooldown
        } else {
          monster.act = { k: 'charge', at: tick, until: tick + charge.windup, angle: this.aimBehind(context, monster, target.id, charge.lead) }
          monster.chargeReadyAt = tick + charge.windup + charge.cooldown
          return
        }
      }
      if (distance > within * 0.7) pursue(monster, monster.def.halfSize, prey.x, prey.y, monster.def.speed, within * 0.7, blocked, tick)
      return
    }
    // A goblin or a mummy: up to the player, and hits them once it is close enough.
    if (attack.kind === 'melee') {
      const within = monster.def.halfSize + PLAYER_HALF_SIZE + attack.reach
      if (distance <= within) {
        if (tick >= monster.readyAt && this.canSee(context, monster, prey)) {
          monster.readyAt = tick + attack.cooldown
          context.hurtPlayer(target.id, attack.damage, { x: monster.x, y: monster.y }, attack.knockback)
        }
        return
      }
      pursue(monster, monster.def.halfSize, prey.x, prey.y, monster.def.speed, Math.max(1, within - 4), blocked, tick)
      return
    }
    if (attack.kind === 'bow') {
      const clear = distance <= attack.range && this.canSee(context, monster, prey)
      if (clear) {
        if (tick >= monster.readyAt) monster.act = { k: 'aim', at: tick, until: tick + attack.aim, angle: this.aimBehind(context, monster, target.id, attack.lead) }
        return
      }
      pursue(monster, monster.def.halfSize, prey.x, prey.y, monster.def.speed, Math.round(attack.range * 0.75), blocked, tick)
    }
  }

  // A camp's skeleton with no one to chase: off to a spot round the camp (see PATROL_RADIUS), standing a while there,
  // then another. Further out than its patrol (back from a chase), it hurries.
  private patrol(context: MonsterContext, monster: Monster, blocked: IsSolid): void {
    const { tick } = context
    monster.patrol ??= this.patrolSpot(monster, blocked)
    const spot = monster.patrol
    if (spot.waitUntil !== undefined) {
      if (tick >= spot.waitUntil) monster.patrol = this.patrolSpot(monster, blocked)
      return
    }
    const away = Math.hypot(monster.x - monster.homeX, monster.y - monster.homeY)
    const pace = away > (this.patrolOf(monster) + 1) * SUB ? RETURN_PACE : PATROL_PACE
    const speed = Math.max(1, Math.round(monster.def.speed * pace))
    if (pursue(monster, monster.def.halfSize, spot.x, spot.y, speed, SUB / 3, blocked, tick)) {
      spot.waitUntil = tick + PATROL_WAIT_MIN + this.rng.nextInt(PATROL_WAIT_MAX - PATROL_WAIT_MIN + 1)
    }
  }

  // Somewhere to patrol to round a camp skeleton's camp: open ground within PATROL_RADIUS of the fire, in a straight line
  // from it, as far as can be from the others of the camp and from where they are going.
  private patrolSpot(monster: Monster, blocked: IsSolid): { x: number; y: number } {
    const others: Array<{ x: number; y: number }> = []
    for (const other of this.all.values()) {
      if (other === monster || other.post === undefined || other.post.camp !== monster.post?.camp) continue
      others.push(other)
      if (other.patrol) others.push(other.patrol)
    }
    const home = { x: monster.homeX, y: monster.homeY }
    let best: { x: number; y: number; score: number } | undefined
    for (let attempt = 0; attempt < PATROL_TRIES * 3 && (!best || attempt < PATROL_TRIES); attempt++) {
      const angle = this.rng.next() * Math.PI * 2
      // Evenly over the round, not bunched in its middle.
      const out = Math.sqrt(this.rng.next()) * this.patrolOf(monster) * SUB
      const x = Math.round(home.x + Math.cos(angle) * out)
      const y = Math.round(home.y + Math.sin(angle) * out)
      if (blocked(floorDiv(x, SUB), floorDiv(y, SUB)) !== false || !straightClear(home, x, y, blocked)) continue
      const score = others.reduce((nearest, other) => Math.min(nearest, Math.hypot(other.x - x, other.y - y)), Infinity)
      if (!best || score > best.score) best = { x, y, score }
    }
    return best ? { x: best.x, y: best.y } : { ...home }
  }

  // How far round its camp a camp's monster patrols (tiles).
  private patrolOf(monster: Monster): number {
    return monster.post !== undefined ? (this.camps?.[monster.post.camp]?.patrol ?? PATROL_RADIUS) : PATROL_RADIUS
  }

  // The way from a monster to where a player was `lead` ticks ago (so a player who keeps moving is not where it aims).
  private aimBehind(context: MonsterContext, monster: Monster, playerId: number, lead: number): number {
    const was = context.playerWas(playerId, lead)
    return was ? Math.atan2(was.y - monster.y, was.x - monster.x) : (monster.act?.angle ?? 0)
  }

  // A skeleton in the middle of a sword attack:
  // - winding up a swing, then swinging: everyone within its reach and arc (the way it was wound up) is hurt;
  // - winding up a charge, turning after where the player was a moment ago; then dashing that way, straight through
  //   anyone in its path (each hit once), until it has gone its distance or runs into something;
  // and after either, it stands a moment.
  private blade(context: MonsterContext, monster: Monster, attack: Extract<MonsterDef['attack'], { kind: 'blade' }>, blocked: IsSolid): void {
    const { tick } = context
    const act = monster.act!
    const recover = (): void => {
      monster.act = { k: 'recover', at: tick, until: tick + attack.recover, angle: act.angle }
      monster.readyAt = tick + attack.recover + attack.cooldown
    }
    if (act.k === 'swing') {
      if (tick < act.until) return
      const { reach, arc, damage, knockback } = attack.swing
      for (const player of context.players) {
        if (inSwing(monster, act.angle, reach, arc, player.position, PLAYER_HALF_SIZE)) {
          context.hurtPlayer(player.id, damage, monster, knockback)
        }
      }
      recover()
      return
    }
    const charge = attack.charge
    if (act.k === 'charge') {
      if (monster.target !== 0) act.angle = this.aimBehind(context, monster, monster.target, charge.lead)
      if (tick < act.until) return
      monster.act = { k: 'dash', at: tick, until: tick + Math.ceil(charge.distance / Math.max(1, charge.speed)), angle: act.angle, hit: new Set() }
      return
    }
    if (act.k !== 'dash') {
      monster.act = undefined
      return
    }
    const from = { x: monster.x, y: monster.y }
    const ax = Math.cos(act.angle)
    const ay = Math.sin(act.angle)
    Object.assign(monster, moveBox(monster, Math.round(ax * charge.speed), Math.round(ay * charge.speed), monster.def.halfSize, blocked))
    const travelled = Math.hypot(monster.x - from.x, monster.y - from.y)
    // Everyone the dash passed through this tick (within its width of the stretch it went), pushed on the way it goes.
    for (const player of context.players) {
      if (act.hit!.has(player.id)) continue
      const dx = player.position.x - from.x
      const dy = player.position.y - from.y
      const along = Math.max(0, Math.min(travelled, dx * ax + dy * ay))
      const off = Math.hypot(dx - ax * along, dy - ay * along)
      if (off > charge.width / 2 + PLAYER_HALF_SIZE) continue
      act.hit!.add(player.id)
      context.hurtPlayer(player.id, charge.damage, { x: player.position.x - Math.round(ax * SUB), y: player.position.y - Math.round(ay * SUB) }, charge.knockback)
    }
    if (tick >= act.until || travelled < charge.speed / 3) recover()
  }

  // A wisp: it drifts after the nearest player (in its copy of the dungeon), and bursts against one it reaches; it is
  // gone at the end of its life.
  private drift(context: MonsterContext, monster: Monster): void {
    const attack = monster.def.attack
    if (attack.kind !== 'touch') return
    if (context.tick - monster.bornAt >= attack.lifetime) {
      this.remove(monster.id)
      return
    }
    if (monster.stunnedUntil > context.tick) return
    let nearest: { id: number; position: PlayerPosition; distance: number } | undefined
    for (const player of context.players) {
      const distance = Math.hypot(player.position.x - monster.x, player.position.y - monster.y)
      if (distance > 40 * SUB || (nearest && distance >= nearest.distance)) continue
      nearest = { id: player.id, position: player.position, distance }
    }
    if (!nearest) return
    if (nearest.distance <= monster.def.halfSize + PLAYER_HALF_SIZE) {
      context.hurtPlayer(nearest.id, attack.damage, monster, WISP_KNOCKBACK)
      this.remove(monster.id)
      return
    }
    stepToward(monster, monster.def.halfSize, nearest.position.x, nearest.position.y, monster.def.speed, 0, (x, y) => dungeonBlocks(x, y))
  }

  // Each monster as a body, to be kept from standing on any other body (see bodies.ts): pushed, it is kept out of what it
  // cannot walk into; a boss never budges. Wisps are not bodies: they burst against whoever they touch.
  bodies(context: MonsterContext): Body[] {
    const blocked = this.blockedFor(context)
    // A skeleton dashing goes straight through whoever is in its way.
    return [...this.all.values()]
      .filter((monster) => monster.def.attack.kind !== 'touch' && !isBee(monster) && monster.act?.k !== 'dash')
      .map((monster) => ({
        x: monster.x,
        y: monster.y,
        half: monster.def.halfSize,
        mass: MONSTER_MASS,
        fixed: monster.def.boss === true,
        move: (dx, dy) => {
          Object.assign(monster, moveBox(monster, dx, dy, monster.def.halfSize, blocked))
          return { x: monster.x, y: monster.y }
        },
      }))
  }

  // What a monster cannot walk into: water and the dungeon's walls, ground not grown yet, and anything solid or that
  // fences animals in (a fence, a gate, a tree's trunk, with its own shape).
  private blockedFor(context: MonsterContext): IsSolid {
    return (x, y) => {
      if (!isInsideWorld(x, y) || !context.isGrown(chunkOfTile(x, y)) || groundBlocks(context.terrain, x, y)) return true
      const entity = context.world.entityAt(x, y)
      if (!entity) return false
      return BUILDINGS[entity.kind].solid || BUILDINGS[entity.kind].blocksAnimals
    }
  }

  // ---- the camps

  // Each camp keeps its skeletons (or goblins, or a tomb its mummies): a place whose one was killed waits its camp's
  // `respawn` (CAMP_RESPAWN_TICKS, GOBLIN_RESPAWN_TICKS, MUMMY_RESPAWN_TICKS), then gets a new one, once a player is near enough for it to matter and
  // none near enough to see it appear.
  private tendCamps(context: MonsterContext): void {
    this.camps ??= [
      ...campSites(context.terrain).map((site): Camp => {
        const count = CAMP_MIN + (hashInts(context.seed, site.x, site.y, 721) % (CAMP_MAX - CAMP_MIN + 1))
        const archers = Math.min(count, CAMP_ARCHERS_MIN + (hashInts(context.seed, site.x, site.y, 722) % (CAMP_ARCHERS_MAX - CAMP_ARCHERS_MIN + 1)))
        // The archers' places, spread round the ring.
        const archerSlots = new Set(Array.from({ length: archers }, (_, i) => Math.floor(((i + 0.5) * count) / archers)))
        return {
          x: site.x * SUB + SUB / 2,
          y: site.y * SUB + SUB / 2,
          kind: 'skeleton',
          patrol: PATROL_RADIUS,
          respawn: CAMP_RESPAWN_TICKS,
          places: Array.from({ length: count }, (_, slot) => ({ id: 0, respawnAt: 0, archer: archerSlots.has(slot) })),
        }
      }),
      ...goblinCampSites(context.terrain).map((site): Camp => {
        const count = GOBLINS_MIN + (hashInts(context.seed, site.x, site.y, 741) % (GOBLINS_MAX - GOBLINS_MIN + 1))
        return {
          x: site.x * SUB + SUB / 2,
          y: site.y * SUB + SUB / 2,
          kind: 'goblin',
          patrol: GOBLIN_PATROL,
          respawn: GOBLIN_RESPAWN_TICKS,
          places: Array.from({ length: count }, () => ({ id: 0, respawnAt: 0, archer: false })),
        }
      }),
      ...tombSites(context.terrain).map((site): Camp => {
        const count = MUMMIES_MIN + (hashInts(context.seed, site.x, site.y, 761) % (MUMMIES_MAX - MUMMIES_MIN + 1))
        return {
          x: site.x * SUB + SUB / 2,
          y: site.y * SUB + SUB / 2,
          kind: 'mummy',
          patrol: MUMMY_PATROL,
          respawn: MUMMY_RESPAWN_TICKS,
          places: Array.from({ length: count }, () => ({ id: 0, respawnAt: 0, archer: false })),
        }
      }),
    ]
    const skeleton = monsterDef('skeleton')
    const archer = monsterDef('skeleton-archer')
    const goblin = monsterDef('goblin')
    const mummy = monsterDef('mummy')
    this.camps.forEach((camp, index) => {
      const near = (radius: number): boolean => context.players.some((player) => Math.hypot(player.position.x - camp.x, player.position.y - camp.y) <= radius * SUB)
      const ring = CAMP_POST
      for (const [slot, place] of camp.places.entries()) {
        if (place.id !== 0) {
          if (this.all.has(place.id)) continue
          place.id = 0
          place.respawnAt = context.tick + camp.respawn
        }
        if (context.tick < place.respawnAt || !near(CAMP_ACTIVE) || near(CAMP_UNSEEN)) continue
        if (!context.isGrown(chunkOfTile(floorDiv(camp.x, SUB), floorDiv(camp.y, SUB)))) continue
        const angle = (slot / camp.places.length) * Math.PI * 2 + index
        const x = Math.round(camp.x + Math.cos(angle) * ring * SUB)
        const y = Math.round(camp.y + Math.sin(angle) * ring * SUB)
        const def = camp.kind === 'goblin' ? goblin : camp.kind === 'mummy' ? mummy : place.archer ? archer : skeleton
        const guard = this.spawn(def, x, y, { post: { camp: index, slot } })
        // It keeps to the camp as a whole: it patrols round the fire, and chases a player no further than its leash from it.
        guard.homeX = camp.x
        guard.homeY = camp.y
        place.id = guard.id
      }
    })
  }
}

// Whether a monster is a bee (a worker or a queen), which bees.ts moves.
export function isBee(monster: Monster): boolean {
  return monster.def.attack.kind === 'sting' || monster.def.attack.kind === 'queen'
}
