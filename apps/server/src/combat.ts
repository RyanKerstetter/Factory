import {
  tilesIn,
  angleTo,
  BUILDINGS,
  chunkOfTile,
  countOf,
  floorDiv,
  inSwing,
  itemByKey,
  moveBox,
  PLAYER_HALF_SIZE,
  removeItems,
  SUB,
  takeFromSlot,
  toolIn,
  weaponIn,
  type Command,
  type FactoryWorld,
  type IsSolid,
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
  // What lands on the ground where it comes down (an arrow that missed, a spear), and whether it does when it hits.
  lands: ItemId
  landsOnHit: boolean
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

export class Combat {
  private readonly flying = new Map<number, Projectile>()
  private readonly ended = new Map<number, { shot: Projectile; until: number }>()
  private nextId = 1

  constructor(
    private readonly world: FactoryWorld,
    private readonly animals: Animals | undefined,
    // What players cannot walk into (for a lunge or a hop) and what stops what is in flight.
    private readonly solid: IsSolid,
  ) {}

  // ---- attacking

  attack(context: CommandContext, command: Extract<Command, { k: 'attack' }>): CommandOutcome {
    const { player, tick } = context
    // A couple of ticks' grace: the page times the cooldown by its own clock, and an attack sent the moment it is over
    // can land on a tick or two early here.
    if (tick + COOLDOWN_GRACE_TICKS < player.attackReadyAt) return { ok: false, why: 'tooSoon' }
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
        this.launch(origin, facing, weapon.ammo, Math.round(weapon.speed * (0.5 + share / 2)), weapon.damage * share, lands, false)
      } else {
        for (const animal of this.animalsIn(origin, facing, weapon.range, weapon.arc, seen, weapon.width)) moved += this.hurt(context, animal.id, weapon.damage, origin, {})
        // A basic attack also hits every plant, rock and building in its swing, so lining them up clears them faster.
        for (const target of tilesIn(this.world, origin, facing, weapon.range, weapon.arc, weapon.width)) {
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
        break
      case 'smash': {
        const middle = { x: origin.x + dir.x * special.range, y: origin.y + dir.y * special.range }
        for (const { animal } of this.animals?.nearAt(middle, special.radius, seen) ?? []) moved += this.hurt(context, animal.id, special.damage, middle, effects)
        break
      }
      case 'lunge': {
        player.position = moveBox(origin, Math.round(dir.x * special.dash), Math.round(dir.y * special.dash), PLAYER_HALF_SIZE, this.solid)
        for (const animal of this.animalsIn(player.position, facing, special.range, special.arc, seen)) {
          moved += this.hurt(context, animal.id, special.damage, player.position, effects)
        }
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
        this.launch(origin, facing, spear, Math.round(special.speed * (0.5 + share / 2)), special.damage * share, spear, true, flight)
        break
      }
      case 'volley': {
        if (weapon.ammo === undefined) return { ok: false, why: 'noAmmo' }
        const count = Math.min(special.count, countOf(player.inventory, weapon.ammo))
        if (count === 0) return { ok: false, why: 'noAmmo' }
        removeItems(player.inventory, weapon.ammo, count)
        for (let i = 0; i < count; i++) {
          this.launch(origin, facing + (i - (count - 1) / 2) * special.spread, weapon.ammo, special.speed, special.damage, weapon.ammo, false)
        }
        player.position = moveBox(origin, -Math.round(dir.x * special.hop), -Math.round(dir.y * special.hop), PLAYER_HALF_SIZE, this.solid)
        break
      }
    }
    return { ok: true, moved }
  }

  // Hurts an animal; if that kills it, what it drops goes where the player's drops go. Gives how many items that was.
  private hurt(context: CommandContext, id: number, damage: number, from: PlayerPosition, effects: { knockback?: number; stun?: number }): number {
    const animal = this.animals?.get(id)
    if (!animal) return 0
    const where = { x: animal.x, y: animal.y }
    const drops = this.animals!.damage(id, damage, from, context.tick, effects)
    return drops ? giveDrops(context, where, id, drops) : 0
  }

  // The animals an attack reaches, judged where they were at tick `seen` (see Animals.nearAt).
  private animalsIn(origin: PlayerPosition, facing: number, range: number, arc: number, seen: number | undefined, width = 0): Array<{ id: number }> {
    if (!this.animals) return []
    return this.animals
      .nearAt(origin, range, seen)
      .filter((spot) => inSwing(origin, facing, range, arc, spot, spot.animal.def.halfSize, width))
      .map((spot) => spot.animal)
  }

  private launch(from: PlayerPosition, angle: number, item: ItemId, speed: number, damage: number, lands: ItemId, landsOnHit: boolean, flight = FLIGHT_TICKS): void {
    const id = this.nextId++
    this.flying.set(id, {
      id,
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
  step(context: CombatContext): void {
    for (const shot of [...this.flying.values()].sort((a, b) => a.id - b.id)) {
      const steps = Math.max(1, Math.ceil(Math.hypot(shot.vx, shot.vy) / (SUB / 4)))
      let done = false
      for (let i = 0; i < steps && !done; i++) {
        const x = shot.x + Math.round(shot.vx / steps)
        const y = shot.y + Math.round(shot.vy / steps)
        const tile = this.world.entityAt(floorDiv(x, SUB), floorDiv(y, SUB))
        if (tile && BUILDINGS[tile.kind].solid) {
          this.land(context, shot)
          done = true
          break
        }
        shot.x = x
        shot.y = y
        const target = this.animals?.near(shot, HIT_MARGIN)[0]
        if (target) {
          const where = { x: target.x, y: target.y }
          const from = { x: shot.x - shot.vx, y: shot.y - shot.vy }
          const drops = this.animals!.damage(target.id, shot.damage, from, context.tick, { knockback: SHOT_KNOCKBACK })
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

