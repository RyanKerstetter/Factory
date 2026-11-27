import {
  attackClear,
  BUILDINGS,
  CAMP_KINDS,
  CAMPS,
  CAMP_ROCKS,
  campRockSpots,
  chunkOfTile,
  dungeonBlocks,
  floorDiv,
  getItem,
  groundBlocks,
  hashInts,
  inSwing,
  isInsideWorld,
  monsterDef,
  MONSTER_MASS,
  JAB_WIDTH,
  moveBox,
  PLAYER_HALF_SIZE,
  Rng,
  SUB,
  tileMiddle,
  TPS,
  type CampKind,
  type Entity,
  type FactoryWorld,
  type IsSolid,
  type ItemId,
  type MonsterAct,
  type MonsterDef,
  type MonsterInfo,
  type MonsterPosition,
  type PlayerPosition,
  type Terrain,
} from '../../../packages/shared/src/index.ts'
import type { BeeState } from './bees.ts'
import type { Body } from './bodies.ts'
import type { Dropped } from './commands.ts'
import { CreatureSet, type HitEffects } from './creatures.ts'
import { pursue, sightClear, stepToward, straightClear, type Path } from './steering.ts'

// The monsters (see data/monsters.json): the skeletons that keep the mountains' camps (see `tendCamps`) and guard the
// dungeon's rooms (see dungeons.ts), the frost lich and what it calls up (see frost-lich.ts), the goblins (and their
// archers and shamans) that keep the meadow's camps and the mummies the desert's tombs, and the bees out of their hives (what they do is bees.ts's: here they are only kept, and hit). Like the animals,
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
//   winds up a charge and dashes through the player; an archer (a skeleton's or a goblin's) aims and looses an arrow, and a goblin shaman a hex; a wisp drifts after the nearest
//   player and bursts against them; a goblin walks up to the player and hits them. A monster winding up or making an attack (a skeleton's
//   swing, charge or dash, a goblin's jab, a mummy's slam) is not knocked back (nor stunned) by a hit; and a boss never
//   is. The charge and the arrow are aimed where the player was a moment before, so one who
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

// The camps: one round each skeletons' tent, goblins' lean-to and mummies' tomb standing in the world (see `isCampKind`:
// the seed grows them, and a camp made or spawned can be put down in its own land). Each keeps the monsters its kind
// has in data/camps.json (see CAMPS), first put CAMP_POST tiles out from what keeps it. One that is killed comes back
// its camp's `respawnSeconds` later, once a player is within CAMP_ACTIVE tiles of the camp and none is within
// CAMP_UNSEEN tiles (so they never appear in front of anyone); and as one comes back, the camp's rocks that have been
// broken come back too (see `refillRocks`). Broken, what keeps a camp is gone, and so is the camp: its monsters still
// standing stay, but none comes back. Looked after every CAMP_EVERY ticks.
const CAMP_POST = 2.2
// A camp's middle, where its monsters keep to (its fire), is this many tiles in front of (south of) what keeps it, which
// stands in the way.
const CAMP_FRONT = 2
const CAMP_ACTIVE = 64
const CAMP_UNSEEN = 14
const CAMP_EVERY = TPS
// A camp's monsters patrol: each walks (at PATROL_PACE of its chasing speed) to a spot within its camp's `patrolRadius`
// tiles of the camp's fire (PATROL_RADIUS for one with no camp), stands there PATROL_WAIT_MIN to PATROL_WAIT_MAX ticks,
// and picks another. Of PATROL_TRIES spots it takes the one furthest from the others of its camp (and where they are
// going), so they spread out rather than clump.
const PATROL_RADIUS = CAMPS['skeleton-camp'].patrolRadius
const PATROL_PACE = 0.4
const PATROL_WAIT_MIN = 2 * TPS
const PATROL_WAIT_MAX = 6 * TPS
const PATROL_TRIES = 8
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
  // A goblin's next attack, picked when it is ready (see `chance` in its spear's `throw`), kept until it has done it.
  next?: 'jab' | 'throw'
  act?: { k: 'swing' | 'charge' | 'dash' | 'recover' | 'aim' | 'jab' | 'throw' | 'slam'; at: number; until: number; angle: number; hit?: Set<number> }
  // When a mummy can next slam (see `slam` in its attack).
  slamReadyAt?: number
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
  // A boss: every player who has hurt it in this fight (by ID), each left one of its `rewards` when it falls.
  hurtBy?: Set<number>
  // The tick of its last blow (a goblin's jab, a mummy's), for the pages.
  struckAt?: number
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
  // Looses a twister (it blows through everything, hurting each player it reaches once): from a point, along `angle`,
  // at `speed` units a tick, for `ttl` ticks, `width` units across.
  twister: (item: ItemId, x: number, y: number, angle: number, speed: number, damage: number, ttl: number, width: number) => void
  // Lobs something up and over from a point to a point (units), coming down `ticks` later, `peak` units up at the top,
  // and bursting there, hurting every player within `radius` units.
  lob: (item: ItemId, x: number, y: number, toX: number, toY: number, ticks: number, peak: number, radius: number, damage: number) => void
  // Where a player was `ago` ticks before (or is, if that is not known), for aiming behind them.
  playerWas: (id: number, ago: number) => PlayerPosition | undefined
  // Puts a camp's rock back on a tile (see `refillRocks`).
  addRock?: (kind: 'rock' | 'tin-rock' | 'copper-rock', x: number, y: number) => void
}

// A camp: what keeps it (its ID, kind and tile), its middle (units: the fire, CAMP_FRONT tiles in front of what keeps
// it), how far round it they patrol (tiles), how long one killed takes to come back (ticks), and its places (each with
// the monster that keeps it).
type Camp = {
  id: number
  kind: CampKind
  tileX: number
  tileY: number
  x: number
  y: number
  patrol: number
  respawn: number
  places: Array<{ id: number; respawnAt: number; def: MonsterDef }>
}

export class Monsters extends CreatureSet<Monster> {
  private readonly rng: Rng
  // By the ID of what keeps each.
  private readonly camps = new Map<number, Camp>()

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
      ...(monster.struckAt !== undefined ? { struck: monster.struckAt } : {}),
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
    return [...this.camps.values()]
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
    monster.hurtBy = undefined
    monster.calmUntil = tick + CALM_TICKS
  }

  // ---- being hit (see combat.ts)

  // A monster is hurt by `amount` (less its armour, never all of it), from a point, by a player (`by`): knocked back
  // and stunned (unless it is winding up or making an attack, or is a boss), and it goes for whoever hurt it, calling the
  // others. Gives what it drops if that killed it: a boss also leaves everyone who hurt it one of its `rewards`, bound
  // to them.
  damage(id: number, amount: number, from: PlayerPosition, tick: number, effects: HitEffects = {}, by = 0): Dropped | undefined {
    const monster = this.all.get(id)
    if (!monster) return undefined
    const attacking = monster.act?.k === 'swing' || monster.act?.k === 'charge' || monster.act?.k === 'dash' || monster.act?.k === 'jab' || monster.act?.k === 'slam'
    if (monster.def.boss && by !== 0) (monster.hurtBy ??= new Set()).add(by)
    this.takeBlow(monster, amount, from, tick, effects, monster.def.boss || attacking)
    if (monster.hp > 0) {
      if (by !== 0 && !monster.def.boss && monster.def.aggroRadius > 0) {
        monster.target = by
        monster.lostSince = undefined
        this.alert(monster, by, tick)
      }
      return undefined
    }
    const drops: Dropped = []
    for (const drop of monster.def.drops) {
      const count = drop.min + this.rng.nextInt(drop.max - drop.min + 1)
      if (count > 0) drops.push([getItem(drop.item).key, count])
    }
    const rewards = monster.def.rewards
    if (rewards.length > 0) {
      for (const player of [...(monster.hurtBy ?? [])].sort((a, b) => a - b)) drops.push([getItem(rewards[this.rng.nextInt(rewards.length)]).key, 1, 'bound', player])
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
    // Ones of a kind crowding together spread apart a little (a bee over anything); not one dashing.
    this.unclump(
      this.list().filter((monster) => monster.act?.k !== 'dash'),
      (monster) => (isBee(monster) ? () => false : blocked),
    )
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
      if (monster.act.k === 'aim' && (attack.kind === 'bow' || attack.kind === 'lob' || attack.kind === 'twister')) {
        // Aiming: it turns to follow where the player was a moment ago while it can see them, and looses at the end (an
        // arrow straight at them, or a spell lobbed up and over onto where they are).
        if (!target) {
          monster.act = undefined
          return
        }
        if (this.canSee(context, monster, target.position)) monster.act.angle = this.aimBehind(context, monster, target.id, attack.lead)
        if (tick < monster.act.until) return
        if (attack.kind === 'bow') {
          context.shoot(attack.item, monster.x, monster.y, monster.act.angle, attack.speed, attack.damage, Math.ceil((attack.range * ARROW_FLIGHT) / Math.max(1, attack.speed)))
        } else if (attack.kind === 'twister') {
          // On to where the player was, and `linger` past it.
          const at = context.playerWas(target.id, attack.lead) ?? target.position
          const away = Math.hypot(at.x - monster.x, at.y - monster.y)
          const ticks = Math.ceil(away / Math.max(1, attack.speed)) + attack.linger
          context.twister(attack.item, monster.x, monster.y, monster.act.angle, attack.speed, attack.damage, ticks, attack.width)
        } else {
          const at = context.playerWas(target.id, attack.lead) ?? target.position
          const away = Math.hypot(at.x - monster.x, at.y - monster.y)
          context.lob(attack.item, monster.x, monster.y, at.x, at.y, attack.base + Math.ceil(away / Math.max(1, attack.speed)), attack.peak, attack.radius, attack.damage)
        }
        monster.act = undefined
        monster.readyAt = tick + attack.cooldown
        return
      }
      if (attack.kind === 'melee' && monster.act.k === 'slam') {
        this.slam(context, monster, attack)
        return
      }
      if ((attack.kind === 'spear' || attack.kind === 'melee') && (monster.act.k === 'jab' || monster.act.k === 'throw')) {
        this.stab(context, monster, attack)
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
    // A mummy: up to the player, and hits them once it is close enough (after its windup, if it has one); now and then,
    // with them in front of it near enough, it slams instead.
    if (attack.kind === 'melee') {
      const within = monster.def.halfSize + PLAYER_HALF_SIZE + attack.reach
      const slam = attack.slam
      if (slam) {
        monster.slamReadyAt ??= tick + slam.cooldown
        if (tick >= monster.readyAt && tick >= monster.slamReadyAt && distance <= slam.ahead + slam.radius && this.canSee(context, monster, prey)) {
          monster.act = { k: 'slam', at: tick, until: tick + slam.windup, angle }
          monster.slamReadyAt = tick + slam.windup + slam.cooldown
          return
        }
      }
      if (distance <= within) {
        if (tick >= monster.readyAt && this.canSee(context, monster, prey)) {
          if (attack.windup > 0) {
            monster.act = { k: 'jab', at: tick, until: tick + attack.windup, angle }
            return
          }
          monster.readyAt = tick + attack.cooldown
          monster.struckAt = tick
          context.hurtPlayer(target.id, attack.damage, { x: monster.x, y: monster.y }, attack.knockback)
        }
        return
      }
      pursue(monster, monster.def.halfSize, prey.x, prey.y, monster.def.speed, Math.max(1, within - 4), blocked, tick)
      return
    }
    // A goblin: ready, it picks its next attack (a throw by its chance, else a jab) and keeps to it: a quick jab of its
    // spear close in (lunging in), or a spear thrown from wherever it is within its range.
    if (attack.kind === 'spear') {
      const within = monster.def.halfSize + PLAYER_HALF_SIZE + attack.reach + attack.lunge
      const ready = tick >= monster.readyAt
      const thrown = attack.throw
      if (ready) monster.next ??= this.rng.next() < thrown.chance ? 'throw' : 'jab'
      if (ready && monster.next === 'throw' && distance <= thrown.range && this.canSee(context, monster, prey)) {
        monster.act = { k: 'throw', at: tick, until: tick + thrown.windup, angle: this.aimBehind(context, monster, target.id, thrown.lead) }
        monster.next = undefined
        return
      }
      if (distance <= within) {
        if (ready && monster.next === 'jab' && this.canSee(context, monster, prey)) {
          monster.act = { k: 'jab', at: tick, until: tick + attack.windup, angle }
          monster.next = undefined
        }
        return
      }
      pursue(monster, monster.def.halfSize, prey.x, prey.y, monster.def.speed, Math.max(1, within - 4), blocked, tick)
      return
    }
    // A goblin shaman: where it can see the player within its range, it raises its staff to lob a spell at them.
    if (attack.kind === 'lob') {
      if (distance <= attack.range && this.canSee(context, monster, prey)) {
        if (tick >= monster.readyAt) monster.act = { k: 'aim', at: tick, until: tick + attack.aim, angle }
        return
      }
      pursue(monster, monster.def.halfSize, prey.x, prey.y, monster.def.speed, Math.round(attack.range * 0.75), blocked, tick)
      return
    }
    if (attack.kind === 'bow' || attack.kind === 'twister') {
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
      if (blocked(floorDiv(x, SUB), floorDiv(y, SUB)) !== false || !straightClear(home, x, y, blocked, monster.def.halfSize)) continue
      const score = others.reduce((nearest, other) => Math.min(nearest, Math.hypot(other.x - x, other.y - y)), Infinity)
      if (!best || score > best.score) best = { x, y, score }
    }
    return best ? { x: best.x, y: best.y } : { ...home }
  }

  // How far round its camp a camp's monster patrols (tiles).
  private patrolOf(monster: Monster): number {
    return monster.post !== undefined ? (this.camps.get(monster.post.camp)?.patrol ?? PATROL_RADIUS) : PATROL_RADIUS
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

  // A goblin's spear (or a mummy's blow): a jab, once its windup is over, lunging forward (up to its `lunge`, but not
  // into the player it is after, nor through anything in the way) and hurting everyone in a narrow strip its reach out
  // from there the way it faces (a mummy: everyone within its reach); or a spear thrown, once it is drawn back, at
  // where the player was a moment before (it keeps its own).
  private stab(context: MonsterContext, monster: Monster, attack: Extract<MonsterDef['attack'], { kind: 'spear' | 'melee' }>): void {
    const { tick } = context
    const act = monster.act!
    if (act.k === 'throw' && attack.kind === 'spear') {
      const thrown = attack.throw
      if (monster.target !== 0) {
        const target = context.players.find((player) => player.id === monster.target)
        if (target && this.canSee(context, monster, target.position)) act.angle = this.aimBehind(context, monster, target.id, thrown.lead)
      }
      if (tick < act.until) return
      context.shoot(thrown.item, monster.x, monster.y, act.angle, thrown.speed, thrown.damage, Math.ceil((thrown.range * ARROW_FLIGHT) / Math.max(1, thrown.speed)))
      monster.act = undefined
      monster.readyAt = tick + thrown.cooldown
      return
    }
    if (tick < act.until) return
    if (attack.kind === 'spear' && attack.lunge > 0) {
      const prey = context.players.find((player) => player.id === monster.target)?.position
      const room = prey ? Math.max(0, (prey.x - monster.x) * Math.cos(act.angle) + (prey.y - monster.y) * Math.sin(act.angle) - monster.def.halfSize - PLAYER_HALF_SIZE) : attack.lunge
      const lunge = Math.min(attack.lunge, room)
      Object.assign(monster, moveBox(monster, Math.round(Math.cos(act.angle) * lunge), Math.round(Math.sin(act.angle) * lunge), monster.def.halfSize, this.blockedFor(context)))
    }
    monster.struckAt = tick
    const reach = monster.def.halfSize + attack.reach
    for (const player of context.players) {
      const struck = attack.kind === 'spear' ? inSwing(monster, act.angle, reach, 0, player.position, PLAYER_HALF_SIZE, JAB_WIDTH) : Math.hypot(player.position.x - monster.x, player.position.y - monster.y) <= reach + PLAYER_HALF_SIZE
      if (struck) context.hurtPlayer(player.id, attack.damage, { x: monster.x, y: monster.y }, attack.knockback)
    }
    monster.act = undefined
    monster.readyAt = tick + attack.cooldown
  }

  // A mummy's slam, once its arms are up: brought down on the ground in front of it, hurting everyone within its radius
  // of there.
  private slam(context: MonsterContext, monster: Monster, attack: Extract<MonsterDef['attack'], { kind: 'melee' }>): void {
    const { tick } = context
    const act = monster.act!
    const slam = attack.slam
    if (!slam) {
      monster.act = undefined
      return
    }
    if (tick < act.until) return
    const middle = { x: monster.x + Math.cos(act.angle) * slam.ahead, y: monster.y + Math.sin(act.angle) * slam.ahead }
    for (const player of context.players) {
      if (Math.hypot(player.position.x - middle.x, player.position.y - middle.y) <= slam.radius + PLAYER_HALF_SIZE) context.hurtPlayer(player.id, slam.damage, { x: Math.round(middle.x), y: Math.round(middle.y) }, slam.knockback)
    }
    monster.struckAt = tick
    monster.act = undefined
    monster.readyAt = tick + attack.cooldown
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

  // Each camp keeps its monsters: a place whose one was killed waits its camp's `respawn` (CAMP_RESPAWN_TICKS,
  // GOBLIN_RESPAWN_TICKS, MUMMY_RESPAWN_TICKS), then gets a new one, once a player is near enough for it to matter and
  // none near enough to see it appear; and with it the camp's rocks that were broken come back. A camp is kept for as
  // long as what keeps it stands.
  private tendCamps(context: MonsterContext): void {
    const standing = new Set<number>()
    for (const kind of CAMP_KINDS) {
      for (const entity of context.world.ofKind(kind)) {
        standing.add(entity.id)
        if (!this.camps.has(entity.id)) this.camps.set(entity.id, this.makeCamp(context.seed, entity))
      }
    }
    for (const id of [...this.camps.keys()]) if (!standing.has(id)) this.camps.delete(id)
    const blocked = this.blockedFor(context)
    for (const camp of [...this.camps.values()].sort((a, b) => a.id - b.id)) {
      const near = (radius: number): boolean => context.players.some((player) => Math.hypot(player.position.x - camp.x, player.position.y - camp.y) <= radius * SUB)
      const due: number[] = []
      for (const [slot, place] of camp.places.entries()) {
        if (place.id !== 0) {
          if (this.all.has(place.id)) continue
          place.id = 0
          place.respawnAt = context.tick + camp.respawn
        }
        if (context.tick < place.respawnAt || !near(CAMP_ACTIVE) || near(CAMP_UNSEEN)) continue
        if (!context.isGrown(chunkOfTile(camp.tileX, camp.tileY))) continue
        due.push(slot)
      }
      // The rocks first (on their own spots, clear of anyone), then the monsters (clear of the rocks).
      if (due.length > 0) this.refillRocks(context, camp)
      for (const slot of due) {
        const place = camp.places[slot]
        // Its post on the ring round the camp (or a little round from it, where that is in the way).
        let spot: { x: number; y: number } | undefined
        for (let turn = 0; turn < 8 && !spot; turn++) {
          const angle = (slot / camp.places.length) * Math.PI * 2 + camp.id + turn * 0.4
          const x = Math.round(camp.x + Math.cos(angle) * CAMP_POST * SUB)
          const y = Math.round(camp.y + Math.sin(angle) * CAMP_POST * SUB)
          if (blocked(floorDiv(x, SUB), floorDiv(y, SUB)) === false) spot = { x, y }
        }
        if (!spot) continue
        const guard = this.spawn(place.def, spot.x, spot.y, { post: { camp: camp.id, slot } })
        // It keeps to the camp as a whole: it patrols round it, and chases a player no further than its leash from it.
        guard.homeX = camp.x
        guard.homeY = camp.y
        place.id = guard.id
      }
    }
  }

  // A camp round what keeps it: how many of each kind keep it (see CAMPS), by a hash of the seed and where it is; the
  // first kind's places round the ring, and the others' spread evenly between them.
  private makeCamp(seed: number, keeper: Entity): Camp {
    const { x, y } = keeper
    const kind = keeper.kind as CampKind
    const def = CAMPS[kind]
    const salt = 721 + CAMP_KINDS.indexOf(kind) * 20
    const counts = def.monsters.map((monster, i) => ({ def: monsterDef(monster.kind), count: monster.min + (hashInts(seed, x, y, salt + i) % (monster.max - monster.min + 1)) }))
    const [first, ...rest] = counts
    const others = rest.flatMap(({ def: other, count }) => Array.from({ length: count }, () => other))
    const total = first.count + others.length
    const defs = Array.from({ length: total }, () => first.def)
    others.forEach((other, i) => (defs[Math.floor(((i + 0.5) * total) / others.length)] = other))
    return {
      id: keeper.id,
      kind,
      tileX: x,
      tileY: y,
      ...tileMiddle(x, y + CAMP_FRONT),
      patrol: def.patrolRadius,
      respawn: def.respawn,
      places: defs.map((place) => ({ id: 0, respawnAt: 0, def: place })),
    }
  }

  // A camp's rocks (see CAMP_ROCKS and campRockSpots in world-gen.ts), each put back on its spot if it was broken: where
  // that is open ground, with nothing on it and nobody standing there.
  private refillRocks(context: MonsterContext, camp: Camp): void {
    if (!context.addRock) return
    const { rock, count } = CAMP_ROCKS[camp.kind]
    for (const spot of campRockSpots(context.seed, camp.tileX, camp.tileY, count)) {
      if (context.world.entityAt(spot.x, spot.y) || context.world.floorAt(spot.x, spot.y) || groundBlocks(context.terrain, spot.x, spot.y)) continue
      const middle = tileMiddle(spot.x, spot.y)
      const on = (at: { x: number; y: number }): boolean => Math.abs(at.x - middle.x) < SUB && Math.abs(at.y - middle.y) < SUB
      if ([...this.all.values()].some(on) || context.players.some((player) => on(player.position))) continue
      context.addRock(rock, spot.x, spot.y)
    }
  }
}

// Whether a monster is a bee (a worker or a queen), which bees.ts moves.
export function isBee(monster: Monster): boolean {
  return monster.def.attack.kind === 'sting' || monster.def.attack.kind === 'queen'
}
