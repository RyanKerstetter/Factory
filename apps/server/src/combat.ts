import {
  angleTo,
  areaReach,
  basicArea,
  BUILDINGS,
  canAttackWith,
  chunkOfTile,
  countOf,
  dungeonBlocks,
  floorDiv,
  inArea,
  flightTicks,
  PLAYER_HALF_SIZE,
  removeItems,
  SPIN_TICKS,
  strikeSpot,
  SUB,
  takeFromSlot,
  tileMiddle,
  tilesHitBy,
  toolIn,
  TPS,
  weaponIn,
  type AttackArea,
  type Command,
  type FactoryWorld,
  type ItemId,
  type PlayerPosition,
  type ToolKind,
  type Weapon,
  type WorldEvent,
} from '../../../packages/shared/src/index.ts'
import { giveDrops, hit, type CommandContext, type CommandOutcome, type Dropped } from './commands.ts'
import type { Creatures } from './creatures.ts'

// Attacks (see weapons.ts for each weapon's), and what is in flight: arrows, sling stones, and monsters' arrows and
// spells. Like the creatures, this is the server's alone: pages are told where each thing in flight is with the
// players' positions, and what an attack does to the world comes as world events. An attack runs from where the server
// has the player, towards the point the page aimed at.

// Every hit a player lands on a creature knocks it back HIT_KNOCKBACK units and stuns it for HIT_STUN_TICKS (a monster
// in the middle of its own attack, and a boss, is not knocked back: see monsters.ts); something shot knocks it back
// SHOT_KNOCKBACK.
export const HIT_KNOCKBACK = Math.round(0.45 * SUB)
export const HIT_STUN_TICKS = Math.round(0.25 * TPS)
const SHOT_KNOCKBACK = Math.round(0.3 * SUB)
// How close to a creature's middle (plus its size) something in flight has to come to hit it, in units.
const HIT_MARGIN = SUB / 6
// How many ticks early an attack is still let through (see `attack`).
const COOLDOWN_GRACE_TICKS = 2
// How long something in flight that stopped is still sent, where it stopped (see `end`).
const ENDED_TICKS = 8

type Projectile = {
  id: number
  item: ItemId
  x: number
  y: number
  vx: number
  vy: number
  ttl: number
  damage: number
  // The player who shot it, whom it never hits.
  owner: number
  // What lands on the ground where it comes down (an arrow or a sling stone that missed).
  lands: ItemId
  // A monster's (an archer's arrow, the frost lich's spells): it hurts any player, whether players can hurt each other
  // or not, and passes through creatures.
  hostile?: boolean
  // Something that falls where it is (an icicle): when its time is up it hurts every player within `radius` units.
  blast?: { radius: number }
  // A thrown weapon (a spear): wherever it stops, it sticks in the ground, as this item, to be knocked loose again.
  sticks?: ItemId
}

// A hit still to come of a player's attack (the second turn of a spin): at tick `at`, from where its player is then.
type Later = { at: number; owner: number; area: AttackArea; facing: number; damage: number; weapon: Weapon; tool: ToolKind | undefined }

// A shot being wound up (the bow being drawn, the sling going round): it flies at `at`, from where its player is then.
type Winding = { at: number; owner: number; item: ItemId; angle: number; speed: number; damage: number; lands: ItemId; ttl: number }

// What flying things need from the room on a tick.
export type CombatContext = {
  tick: number
  emit: (event: WorldEvent) => void
  // Puts an item on the ground at a point (units).
  dropAt: (item: ItemId, count: number, x: number, y: number) => void
  // What a creature killed by something in flight drops, round it.
  dropRound: (middle: PlayerPosition, salt: number, drops: Dropped) => void
  // A thrown weapon sticking in the ground at a point (units), as something to knock loose (or, where it cannot stand,
  // lying there).
  stick: (item: ItemId, x: number, y: number) => void
  // A player's own context, as their commands get, for the later hits of their attacks (undefined if they have gone).
  asPlayer: (id: number) => CommandContext | undefined
}

// The other players, for attacks to hit (the room's; with players not hurting each other, none are ever near).
export type PlayerTargets = {
  // The players other than `except` near a point (within `reach` and their size), where they were at the end of tick
  // `seen` (where the attacker saw them), or where they are without it.
  near: (point: PlayerPosition, reach: number, seen: number | undefined, except: number) => Array<{ id: number; x: number; y: number }>
  // Hurts a player, from a point, pushing them `knockback` units away.
  hurt: (id: number, damage: number, from: PlayerPosition, knockback: number) => void
  // Every player near a point (within `reach` and their size), as they are now, PvP or not: for monsters' attacks.
  everyone: (point: PlayerPosition, reach: number) => Array<{ id: number; x: number; y: number }>
  // Where a player is now (undefined if they have gone).
  position: (id: number) => PlayerPosition | undefined
}

export class Combat {
  private readonly flying = new Map<number, Projectile>()
  private readonly ended = new Map<number, { shot: Projectile; until: number }>()
  private winding: Winding[] = []
  private later: Later[] = []
  private nextId = 1

  constructor(
    private readonly world: FactoryWorld,
    private readonly creatures: readonly Creatures[],
    private readonly players?: PlayerTargets,
  ) {}

  // ---- attacking

  attack(context: CommandContext, command: Extract<Command, { k: 'attack' }>): CommandOutcome {
    const { player, tick } = context
    // A couple of ticks' grace: the page times the cooldown by its own clock, and an attack sent the moment it is over
    // can land on a tick or two early here.
    if (tick + COOLDOWN_GRACE_TICKS < player.attackReadyAt) return { ok: false, why: 'tooSoon' }
    if (!canAttackWith(player.inventory, command.slot)) return { ok: false, why: 'nothing' }
    const weapon = weaponIn(player.inventory, command.slot)
    // A charged attack: only with the button held down long enough (since its `charge`), a couple of ticks' grace again.
    const charged = command.charged ? weapon.charged : undefined
    if (command.charged) {
      if (!charged) return { ok: false, why: 'nothing' }
      if (player.chargeFrom === undefined || tick - player.chargeFrom + COOLDOWN_GRACE_TICKS < charged.charge) return { ok: false, why: 'tooSoon' }
    }
    player.chargeFrom = undefined
    const origin = { ...player.position }
    const facing = command.x === origin.x && command.y === origin.y ? 0 : angleTo(origin, command)
    // Creatures are judged where the player saw them (see Animals.nearAt), never later than the tick before this one,
    // which is where they are now.
    const seen = command.seen === undefined ? undefined : Math.min(command.seen, tick - 1)

    if (weapon.basic === 'shot') {
      if (weapon.ammo === undefined || countOf(player.inventory, weapon.ammo) === 0) return { ok: false, why: 'noAmmo' }
      removeItems(player.inventory, weapon.ammo, 1)
      // An arrow or a sling stone that misses (falls short at the end of its range, or hits a wall) lies where it came
      // down, to be picked up again. It flies once the windup is over; charged, it was drawn while the button was held,
      // so it flies at once, harder.
      const lands = weapon.ammo
      if (charged) {
        this.launch(origin, facing, weapon.ammo, charged.speed, charged.damage, lands, player.id, { ttl: flightTicks(charged.range, charged.speed) })
        player.attackReadyAt = tick + charged.cooldown
      } else {
        const ttl = flightTicks(weapon.range, weapon.speed)
        this.winding.push({ at: tick + weapon.windup, owner: player.id, item: weapon.ammo, angle: facing, speed: weapon.speed, damage: weapon.damage, lands, ttl })
        player.attackReadyAt = tick + weapon.windup + weapon.cooldown
      }
      return { ok: true, moved: 0 }
    }

    if (charged?.kind === 'throw') {
      // The weapon itself flies, and sticks in the ground where it stops.
      const held = player.inventory.slots[command.slot]
      const item = held.item
      takeFromSlot(player.inventory, command.slot, 1)
      this.launch(origin, facing, item, charged.speed, charged.damage, 0, player.id, { ttl: flightTicks(charged.range, charged.speed), sticks: item })
      player.attackReadyAt = tick + charged.cooldown
      return { ok: true, moved: 0 }
    }

    const area = charged?.area ?? basicArea(weapon)!
    const damage = charged?.damage ?? weapon.damage
    const tool = toolIn(player.inventory, command.slot)
    const moved = this.strike(context, area, origin, facing, damage, seen, weapon, tool)
    // An oar's stroke also pushes the raft its player is aboard the way it is aimed.
    if (weapon.basic === 'row' && !charged) context.rafts?.row(facing)
    // A spin goes round again: each later turn hits from where the player is then.
    for (let turn = 1; turn < (charged?.hits ?? 1); turn++) {
      this.later.push({ at: tick + turn * SPIN_TICKS, owner: player.id, area, facing, damage, weapon, tool })
    }
    player.attackReadyAt = tick + (charged?.cooldown ?? weapon.cooldown)
    return { ok: true, moved }
  }

  // A melee attack covering `area` from `origin` along `facing`: it hurts every creature and other player inside it
  // (judged where the attacker saw them, at `seen`), walls or not, and hits every plant, rock and
  // building in it too, so lining them up clears them faster. Gives how many items that dropped into the inventory.
  private strike(
    context: CommandContext,
    area: AttackArea,
    origin: PlayerPosition,
    facing: number,
    damage: number,
    seen: number | undefined,
    weapon: Weapon,
    tool: ToolKind | undefined,
  ): number {
    let moved = 0
    const reach = areaReach(area)
    // Knocked back from where a strike comes down, else from the attacker.
    const from = area.kind === 'circle' ? strikeSpot(origin, facing, area.distance) : origin
    for (const creatures of this.creatures) {
      for (const spot of creatures.nearAt(origin, reach, seen)) {
        if (inArea(area, origin, facing, spot, spot.halfSize)) moved += this.hurt(context, creatures, spot.id, damage, from)
      }
    }
    for (const other of this.players?.near(origin, reach, seen, context.player.id) ?? []) {
      if (inArea(area, origin, facing, other, PLAYER_HALF_SIZE)) this.players!.hurt(other.id, damage, from, 0)
    }
    for (const target of tilesHitBy(this.world, area, origin, facing)) {
      const result = hit(context, target, tool, weapon)
      if ('drops' in result) moved += giveDrops(context, tileMiddle(target.x, target.y), target.id, result.drops)
    }
    return moved
  }

  // Hurts a creature (knocked back and stunned a little); if that kills it, what it drops goes where the player's drops
  // go, round where it was. Gives how many items that was.
  private hurt(context: CommandContext, creatures: Creatures, id: number, damage: number, from: PlayerPosition): number {
    const where = creatures.where(id)
    const drops = creatures.damage(id, damage, from, context.tick, { knockback: HIT_KNOCKBACK, stun: HIT_STUN_TICKS }, context.player.id)
    return drops && where ? giveDrops(context, where, id, drops) : 0
  }

  private launch(
    from: PlayerPosition,
    angle: number,
    item: ItemId,
    speed: number,
    damage: number,
    lands: ItemId,
    owner: number,
    options: { ttl: number; sticks?: ItemId },
  ): void {
    const id = this.nextId++
    this.flying.set(id, {
      id,
      owner,
      item,
      x: from.x,
      y: from.y,
      vx: Math.round(Math.cos(angle) * speed),
      vy: Math.round(Math.sin(angle) * speed),
      ttl: options.ttl,
      damage: Math.max(1, Math.round(damage)),
      lands,
      ...(options.sticks ? { sticks: options.sticks } : {}),
    })
  }

  // ---- monsters' attacks and spells

  // Something a monster shoots (an arrow, a shard of ice) from a point (units) along `angle`, at `speed` units a tick,
  // for `ttl` ticks. It only hurts players, and flies through creatures.
  hostileShot(item: ItemId, x: number, y: number, angle: number, speed: number, damage: number, ttl: number): void {
    const id = this.nextId++
    this.flying.set(id, { id, owner: 0, item, x, y, vx: Math.round(Math.cos(angle) * speed), vy: Math.round(Math.sin(angle) * speed), ttl, damage, lands: 0, hostile: true })
  }

  // An icicle falling on a point (units): `ttl` ticks after this (while pages show it falling, and where), it shatters,
  // hurting every player within `radius` units.
  icicle(item: ItemId, x: number, y: number, ttl: number, radius: number, damage: number): void {
    const id = this.nextId++
    this.flying.set(id, { id, owner: 0, item, x, y, vx: 0, vy: 0, ttl, damage, lands: 0, hostile: true, blast: { radius } })
  }

  // ---- what is in flight

  // Lets fly the shots whose windup is over, then moves everything in flight on, in steps short enough not to pass
  // through anything: it stops in whatever solid it flies into, hurts the first creature (or, a monster's, player) it
  // reaches, and otherwise comes down when its time is up.
  step(context: CombatContext): void {
    // The later turns of spins, from where their players are now.
    const hits = this.later.filter((later) => later.at <= context.tick)
    this.later = this.later.filter((later) => later.at > context.tick)
    for (const later of hits) {
      const as = context.asPlayer(later.owner)
      if (as) this.strike(as, later.area, { ...as.player.position }, later.facing, later.damage, undefined, later.weapon, later.tool)
    }
    const due = this.winding.filter((shot) => shot.at <= context.tick)
    this.winding = this.winding.filter((shot) => shot.at > context.tick)
    for (const shot of due) {
      const from = this.players?.position(shot.owner)
      if (from) this.launch(from, shot.angle, shot.item, shot.speed, shot.damage, shot.lands, shot.owner, { ttl: shot.ttl })
    }
    for (const shot of [...this.flying.values()].sort((a, b) => a.id - b.id)) {
      if (shot.blast) {
        if (--shot.ttl > 0) continue
        for (const player of this.players?.everyone(shot, shot.blast.radius) ?? []) this.players!.hurt(player.id, shot.damage, shot, SHOT_KNOCKBACK)
        this.end(context, shot)
        continue
      }
      const steps = Math.max(1, Math.ceil(Math.hypot(shot.vx, shot.vy) / (SUB / 4)))
      let done = false
      for (let i = 0; i < steps && !done; i++) {
        const x = shot.x + Math.round(shot.vx / steps)
        const y = shot.y + Math.round(shot.vy / steps)
        const tile = this.world.entityAt(floorDiv(x, SUB), floorDiv(y, SUB))
        // Into something solid, or a dungeon's wall: it stops where it was, short of it.
        if ((tile && BUILDINGS[tile.kind].solid) || dungeonBlocks(floorDiv(x, SUB), floorDiv(y, SUB))) {
          this.land(context, shot)
          done = true
          break
        }
        shot.x = x
        shot.y = y
        const from = { x: shot.x - shot.vx, y: shot.y - shot.vy }
        const struck = shot.hostile ? this.players?.everyone(shot, HIT_MARGIN)[0] : this.players?.near(shot, HIT_MARGIN, undefined, shot.owner)[0]
        if (struck) {
          this.players!.hurt(struck.id, shot.damage, from, SHOT_KNOCKBACK)
          this.end(context, shot)
          this.stickIn(context, shot)
          done = true
          break
        }
        if (shot.hostile) continue
        for (const creatures of this.creatures) {
          const target = creatures.nearAt(shot, HIT_MARGIN)[0]
          if (!target) continue
          const drops = creatures.damage(target.id, shot.damage, from, context.tick, { knockback: SHOT_KNOCKBACK, stun: HIT_STUN_TICKS }, shot.owner)
          if (drops) context.dropRound({ x: target.x, y: target.y }, target.id, drops)
          this.end(context, shot)
          this.stickIn(context, shot)
          done = true
          break
        }
      }
      if (done) continue
      shot.ttl--
      if (shot.ttl <= 0) this.land(context, shot)
    }
  }

  // Something in flight comes down: what lands (an arrow, a sling stone) lies there, and a thrown spear sticks in the ground.
  private land(context: CombatContext, shot: Projectile): void {
    this.end(context, shot)
    if (shot.lands) context.dropAt(shot.lands, 1, shot.x, shot.y)
    this.stickIn(context, shot)
  }

  // A thrown weapon stops where it is: in the ground there.
  private stickIn(context: CombatContext, shot: Projectile): void {
    if (shot.sticks) context.stick(shot.sticks, shot.x, shot.y)
  }

  // Something in flight stops (in what it hit, or on the ground). Pages draw what is in flight a few ticks in the past,
  // so it is still sent, where it stopped and marked as stopped, for ENDED_TICKS: a page draws it flying all the way
  // there, rather than it vanishing short of what it hit.
  private end(context: CombatContext, shot: Projectile): void {
    this.flying.delete(shot.id)
    this.ended.set(shot.id, { shot, until: context.tick + ENDED_TICKS })
  }

  // What is in flight over some chunks, and what stopped there lately: [id, item, x, y, stopped (1) or not (0)].
  inChunks(chunks: ReadonlySet<number>, tick: number): Array<[number, number, number, number, number]> {
    const found: Array<[number, number, number, number, number]> = []
    for (const [id, ended] of this.ended) if (tick > ended.until) this.ended.delete(id)
    const near = (shot: Projectile): boolean => chunks.has(chunkOfTile(floorDiv(shot.x, SUB), floorDiv(shot.y, SUB)))
    for (const shot of this.flying.values()) if (near(shot)) found.push([shot.id, shot.item, shot.x, shot.y, 0])
    for (const { shot } of this.ended.values()) if (near(shot)) found.push([shot.id, shot.item, shot.x, shot.y, 1])
    return found
  }
}
