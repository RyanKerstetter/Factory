import {
  attackClear,
  dashOf,
  getItem,
  WEAPONS,
  dungeonBlocks,
  tilesHitBy,
  strikeSpot,
  angleTo,
  BUILDINGS,
  chunkOfTile,
  countOf,
  floorDiv,
  inSwing,
  itemByKey,
  PLAYER_HALF_SIZE,
  removeItems,
  SUB,
  takeFromSlot,
  toolIn,
  weaponIn,
  type Command,
  type FactoryWorld,
  type ItemId,
  type PlayerPosition,
  type WorldEvent,
} from '../../../packages/shared/src/index.ts'
import type { Animals } from './animals.ts'
import { giveDrops, hit, type CommandContext, type CommandOutcome, type Dropped } from './commands.ts'

// Attacks (see weapons.ts for what each weapon's basic and special attacks are), and what is in flight: arrows, sling
// stones and thrown spears. Like the animals, this is the server's alone: pages are told where each thing in flight is
// with the players' positions, and what an attack does to the world comes as world events. An attack runs from where
// the server has the player, towards the point the page aimed at.

// A shot's damage and speed scale with how long it was charged, from MIN_CHARGE_SHARE of them up.
const MIN_CHARGE_SHARE = 0.35
// How close to an animal's middle (plus its size) something in flight has to come to hit it, in units.
const HIT_MARGIN = SUB / 6
// How long something in flight lasts before it comes down, in ticks; and how far a hit from one knocks back.
const FLIGHT_TICKS = 40
const SHOT_KNOCKBACK = SUB / 3
// How many ticks a dash (a lunge, a volley's hop back) takes, and how wide a lunge's stab reaches along it.
const LUNGE_WIDTH = Math.round(0.8 * SUB)
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
  // The player who shot or threw it, whom it never hits.
  owner: number
  // What lands on the ground where it comes down (an arrow that missed, a spear), and whether it does when it hits.
  lands: ItemId
  landsOnHit: boolean
  // A monster's (the frost lich's spells): it hurts any player, whether players can hurt each other or not, and passes
  // through monsters.
  hostile?: boolean
  // Something that falls where it is (an icicle): when its time is up it hurts every player within `radius` units.
  blast?: { radius: number }
}

// What flying things need from the room on a tick.
export type CombatContext = {
  tick: number
  emit: (event: WorldEvent) => void
  // Puts an item on the ground at a point (units).
  dropAt: (item: ItemId, count: number, x: number, y: number) => void
  // Sticks an item into the ground on the tile at a point (units), to be knocked loose by a hit; false where it cannot
  // (something is there, or water).
  stick: (item: ItemId, x: number, y: number) => boolean
  // What an animal killed by something in flight drops, round it.
  dropRound: (middle: PlayerPosition, salt: number, drops: Dropped) => void
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
}

export class Combat {
  private readonly flying = new Map<number, Projectile>()
  private readonly ended = new Map<number, { shot: Projectile; until: number }>()
  private nextId = 1

  constructor(
    private readonly world: FactoryWorld,
    private readonly animals: Animals | undefined,
    private readonly players?: PlayerTargets,
  ) {}

  // ---- attacking

  attack(context: CommandContext, command: Extract<Command, { k: 'attack' }>): CommandOutcome {
    const { player, tick } = context
    // A couple of ticks' grace: the page times the cooldown by its own clock, and an attack sent the moment it is over
    // can land on a tick or two early here.
    if (tick + COOLDOWN_GRACE_TICKS < player.attackReadyAt) return { ok: false, why: 'tooSoon' }
    // Only with a weapon (or a tool) or an empty hand: holding anything else, there is no attack.
    const inHand = player.inventory.slots[command.slot]
    if (inHand && inHand.count > 0 && !WEAPONS.has(getItem(inHand.item).key)) return { ok: false, why: 'nothing' }
    const weapon = weaponIn(player.inventory, command.slot)
    const origin = { ...player.position }
    const facing = command.x === origin.x && command.y === origin.y ? 0 : angleTo(origin, command)
    // Animals are judged where the player saw them (see Animals.nearAt), never later than the tick before this one,
    // which is where they are now.
    const seen = command.seen === undefined ? undefined : Math.min(command.seen, tick - 1)
    const dir = { x: Math.cos(facing), y: Math.sin(facing) }
    let moved = 0

    if (!command.special) {
      if (weapon.basic === 'shot') {
        if (weapon.ammo === undefined || countOf(player.inventory, weapon.ammo) === 0) return { ok: false, why: 'noAmmo' }
        const share = Math.max(MIN_CHARGE_SHARE, Math.min(1, command.charge / Math.max(1, weapon.charge)))
        removeItems(player.inventory, weapon.ammo, 1)
        // Arrows that miss can be picked up again; sling stones are lost.
        const lands = weapon.ammo === itemByKey('arrow')?.id ? weapon.ammo : 0
        this.launch(origin, facing, weapon.ammo, Math.round(weapon.speed * (0.5 + share / 2)), weapon.damage * share, lands, false, FLIGHT_TICKS, player.id)
      } else if (weapon.basic === 'strike') {
        // A strike comes down on a spot in front: everything within its radius of there.
        const spot = strikeSpot(origin, facing, weapon.range)
        for (const { animal, x, y } of this.animals?.nearAt(spot, weapon.radius, seen) ?? []) {
          if (this.clear(origin, { x, y })) moved += this.hurt(context, animal.id, weapon.damage, spot, {})
        }
        for (const other of this.players?.near(spot, weapon.radius, seen, player.id) ?? []) if (this.clear(origin, other)) this.players!.hurt(other.id, weapon.damage, spot, 0)
        for (const target of tilesHitBy(this.world, weapon, origin, facing)) {
          const result = hit(context, target, toolIn(player.inventory, command.slot), weapon)
          if ('drops' in result) moved += giveDrops(context, { x: target.x * SUB + SUB / 2, y: target.y * SUB + SUB / 2 }, target.id, result.drops)
        }
      } else {
        for (const animal of this.animalsIn(origin, facing, weapon.range, weapon.arc, seen, weapon.width)) moved += this.hurt(context, animal.id, weapon.damage, origin, {})
        for (const other of this.playersIn(origin, facing, weapon.range, weapon.arc, seen, player.id, weapon.width)) this.players!.hurt(other.id, weapon.damage, origin, 0)
        // A basic attack also hits every plant, rock and building in its swing, so lining them up clears them faster.
        for (const target of tilesHitBy(this.world, weapon, origin, facing)) {
          const result = hit(context, target, toolIn(player.inventory, command.slot), weapon)
          if ('drops' in result) moved += giveDrops(context, { x: target.x * SUB + SUB / 2, y: target.y * SUB + SUB / 2 }, target.id, result.drops)
        }
      }
      player.attackReadyAt = tick + weapon.cooldown
      return { ok: true, moved }
    }

    const special = weapon.special
    // Bare hands have no special attack (their right click is for using things).
    if (!special) return { ok: false, why: 'nothing' }
    if (command.charge + 1 < special.windup) return { ok: false, why: 'tooSoon' }
    player.attackReadyAt = tick + special.cooldown
    const effects = { knockback: special.knockback, stun: special.stun }
    switch (special.kind) {
      case 'haymaker':
      case 'chop':
      case 'stun':
      case 'bash':
        for (const animal of this.animalsIn(origin, facing, special.range, special.arc, seen)) moved += this.hurt(context, animal.id, special.damage, origin, effects)
        for (const other of this.playersIn(origin, facing, special.range, special.arc, seen, player.id)) this.players!.hurt(other.id, special.damage, origin, special.knockback)
        break
      case 'smash': {
        const middle = { x: origin.x + dir.x * special.range, y: origin.y + dir.y * special.range }
        for (const { animal, x, y } of this.animals?.nearAt(middle, special.radius, seen) ?? []) {
          if (this.clear(origin, { x, y })) moved += this.hurt(context, animal.id, special.damage, middle, effects)
        }
        for (const other of this.players?.near(middle, special.radius, seen, player.id) ?? []) {
          if (this.clear(origin, other)) this.players!.hurt(other.id, special.damage, middle, special.knockback)
        }
        break
      }
      case 'lunge': {
        // The player dashes forward over a few ticks, through whatever is in the way: everything along the whole way
        // (and a stab's reach past its end) is hurt, judged along the way the dash goes.
        const along = dashAngle(command, facing)
        const reach = special.dash + special.range
        player.slide = this.dash(along, special.dash, command.input)
        for (const animal of this.animalsIn(origin, along, reach, special.arc, seen, LUNGE_WIDTH)) moved += this.hurt(context, animal.id, special.damage, origin, effects)
        for (const other of this.playersIn(origin, along, reach, special.arc, seen, player.id, LUNGE_WIDTH)) this.players!.hurt(other.id, special.damage, origin, special.knockback)
        break
      }
      case 'throw': {
        const held = player.inventory.slots[command.slot]
        if (!held || held.count === 0) return { ok: false, why: 'nothing' }
        const spear = held.item
        takeFromSlot(player.inventory, command.slot, 1)
        const share = Math.max(MIN_CHARGE_SHARE, Math.min(1, command.charge / Math.max(1, special.charge)))
        // It flies for as long as it takes to go `range` at full charge (less far, charged less), then lands.
        const flight = special.range > 0 ? Math.ceil(special.range / Math.max(1, special.speed)) : FLIGHT_TICKS
        this.launch(origin, facing, spear, Math.round(special.speed * (0.5 + share / 2)), special.damage * share, spear, true, flight, player.id)
        break
      }
      case 'volley': {
        if (weapon.ammo === undefined) return { ok: false, why: 'noAmmo' }
        const count = Math.min(special.count, countOf(player.inventory, weapon.ammo))
        if (count === 0) return { ok: false, why: 'noAmmo' }
        removeItems(player.inventory, weapon.ammo, count)
        for (let i = 0; i < count; i++) {
          this.launch(origin, facing + (i - (count - 1) / 2) * special.spread, weapon.ammo, special.speed, special.damage, weapon.ammo, false, FLIGHT_TICKS, player.id)
        }
        player.slide = this.dash(dashAngle(command, facing) + Math.PI, special.hop, command.input)
        break
      }
    }
    return { ok: true, moved }
  }

  // A dash, with the player's inputs after `input` (see dashOf); without it (an older page), a step a tick.
  private dash(angle: number, distance: number, input: number | undefined): { vx: number; vy: number; ticks: number; after?: number } {
    const dash = dashOf(angle, distance, input ?? 0)
    return input === undefined ? { vx: dash.vx, vy: dash.vy, ticks: dash.ticks } : dash
  }

  // Hurts an animal; if that kills it, what it drops goes where the player's drops go. Gives how many items that was.
  private hurt(context: CommandContext, id: number, damage: number, from: PlayerPosition, effects: { knockback?: number; stun?: number }): number {
    const animal = this.animals?.get(id)
    if (!animal) return 0
    const where = { x: animal.x, y: animal.y }
    const drops = this.animals!.damage(id, damage, from, context.tick, effects, context.player.id)
    return drops ? giveDrops(context, where, id, drops) : 0
  }

  // The other players an attack reaches, judged where the attacker saw them.
  private playersIn(
    origin: PlayerPosition,
    facing: number,
    range: number,
    arc: number,
    seen: number | undefined,
    except: number,
    width = 0,
  ): Array<{ id: number; x: number; y: number }> {
    return (this.players?.near(origin, range, seen, except) ?? []).filter(
      (other) => inSwing(origin, facing, range, arc, other, PLAYER_HALF_SIZE, width) && this.clear(origin, other),
    )
  }

  // The animals an attack reaches, judged where they were at tick `seen` (see Animals.nearAt).
  private animalsIn(origin: PlayerPosition, facing: number, range: number, arc: number, seen: number | undefined, width = 0): Array<{ id: number }> {
    if (!this.animals) return []
    return this.animals
      .nearAt(origin, range, seen)
      .filter((spot) => inSwing(origin, facing, range, arc, spot, spot.animal.def.halfSize, width) && this.clear(origin, spot))
      .map((spot) => spot.animal)
  }

  private clear(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
    return attackClear(this.world, from, to)
  }

  private launch(
    from: PlayerPosition,
    angle: number,
    item: ItemId,
    speed: number,
    damage: number,
    lands: ItemId,
    landsOnHit: boolean,
    flight = FLIGHT_TICKS,
    owner = 0,
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
      ttl: flight,
      damage: Math.max(1, Math.round(damage)),
      lands,
      landsOnHit,
    })
  }

  // ---- what is in flight

  // Moves everything in flight on, in steps short enough not to pass through anything: it stops in whatever solid it
  // flies into, hurts the first animal it reaches, and otherwise comes down when its time is up.
  // ---- monsters' spells

  // A shard of ice flying from a point (units) along `angle`, at `speed` units a tick, for `ttl` ticks.
  hostileShot(item: ItemId, x: number, y: number, angle: number, speed: number, damage: number, ttl: number): void {
    const id = this.nextId++
    this.flying.set(id, {
      id,
      owner: 0,
      item,
      x,
      y,
      vx: Math.round(Math.cos(angle) * speed),
      vy: Math.round(Math.sin(angle) * speed),
      ttl,
      damage,
      lands: 0,
      landsOnHit: false,
      hostile: true,
    })
  }

  // An icicle falling on a point (units): `ttl` ticks after this (while pages show it falling, and where), it shatters,
  // hurting every player within `radius` units.
  icicle(item: ItemId, x: number, y: number, ttl: number, radius: number, damage: number): void {
    const id = this.nextId++
    this.flying.set(id, { id, owner: 0, item, x, y, vx: 0, vy: 0, ttl, damage, lands: 0, landsOnHit: false, hostile: true, blast: { radius } })
  }

  step(context: CombatContext): void {
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
        const struck = shot.hostile ? this.players?.everyone(shot, HIT_MARGIN)[0] : this.players?.near(shot, HIT_MARGIN, undefined, shot.owner)[0]
        if (struck) {
          this.players!.hurt(struck.id, shot.damage, { x: shot.x - shot.vx, y: shot.y - shot.vy }, SHOT_KNOCKBACK)
          if (shot.landsOnHit) this.land(context, shot)
          else this.end(context, shot)
          done = true
          break
        }
        const target = shot.hostile ? undefined : this.animals?.near(shot, HIT_MARGIN)[0]
        if (target) {
          const where = { x: target.x, y: target.y }
          const from = { x: shot.x - shot.vx, y: shot.y - shot.vy }
          const drops = this.animals!.damage(target.id, shot.damage, from, context.tick, { knockback: SHOT_KNOCKBACK }, shot.owner)
          if (drops) context.dropRound(where, target.id, drops)
          if (shot.landsOnHit) this.land(context, shot)
          else this.end(context, shot)
          done = true
        }
      }
      if (done) continue
      shot.ttl--
      if (shot.ttl <= 0) this.land(context, shot)
    }
  }

  // Something in flight comes down: a thrown spear sticks in the ground where it can (to be punched out again), and
  // what else lands (an arrow) lies there.
  private land(context: CombatContext, shot: Projectile): void {
    this.end(context, shot)
    if (!shot.lands) return
    if (shot.landsOnHit && context.stick(shot.lands, shot.x, shot.y)) return
    context.dropAt(shot.lands, 1, shot.x, shot.y)
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

// The way a dash goes: the way the page worked it out (`dir`, in thousandths of a radian), so both move the player
// exactly alike; else the way the player faces here.
function dashAngle(command: { dir?: number }, facing: number): number {
  return command.dir !== undefined ? command.dir / 1000 : facing
}
