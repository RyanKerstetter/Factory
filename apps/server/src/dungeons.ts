import {
  addItems,
  animalDef,
  chunkOfTile,
  createEntity,
  DUNGEON_LAYOUT,
  DUNGEON_SLOTS,
  dungeonCorner,
  dungeonEntrance,
  dungeonSlotAt,
  dungeonTile,
  inBossHall,
  playerOverlapsTile,
  PLAYER_HALF_SIZE,
  WAVE_RADIUS,
  WAVE_SPEED,
  entityToState,
  itemByKey,
  NO_ITEM,
  Rng,
  SUB,
  TPS,
  tileOfUnits,
  type FactoryWorld,
  type PlayerPosition,
  type Terrain,
  type WorldEvent,
} from '../../../packages/shared/src/index.ts'
import type { Animals } from './animals.ts'
import type { Combat } from './combat.ts'

// The dungeon's copies (see dungeon.ts for the layout and where the copies are).
//
// The boss: at the top of each copy is the frost lich's great round hall, through one doorway. When a player walks in,
// an ice door seals the doorway behind them and the lich wakes. It never moves from the middle of its hall: the players
// move round it, dodging what it casts, which depends on how far away they are:
// - every SHARD_EVERY ticks, in turn, a ring of SHARD_COUNT ice shards flying out all round it, then a shotgun burst of
//   BURST_COUNT shards fanned at each player in the hall;
// - a player within WAVE_TRIGGER tiles sets off a wave of cold air (no more than every WAVE_EVERY ticks): after
//   WAVE_WINDUP it rolls out from the lich at WAVE_SPEED to WAVE_RADIUS tiles, hurting and throwing back each player its
//   front passes over (once a wave; it can be dashed through);
// - a player further than ICICLE_FROM tiles has icicles fall where they stand, every ICICLE_EVERY ticks (shown where
//   they will land, ICICLE_TICKS before).
// The hall starts at BOSS_AIR (cold enough that only the warmest
// armour keeps a player moving) and gets a degree colder every BOSS_COLD_EVERY ticks, so a slow fight freezes. When the
// lich falls the door opens and its chest can be opened; if everyone in the hall falls or gets out, after a moment the
// door opens and the lich is whole again, for the next try. A player who steps onto the way in,
// deep in the mountains' snow, is taken into a copy: the one another player is already in (so friends go in together),
// or else a fresh one, with its skeletons standing guard and its chest full. The chest stays shut while any of the
// copy's skeletons stand. The stairs out take a player back to just outside the way in. A copy nobody has been in for
// CLOSE_AFTER is cleared away (its chest, its skeletons and whatever lies on its floor), and its slot is free again.
// None of it is saved: a player saved inside one comes back outside the way in.

const CLOSE_AFTER = 20 * TPS
const SHARD_EVERY = Math.round(1.5 * TPS)
const SHARD_COUNT = 16
const SHARD_SPEED = Math.round((7 * SUB) / TPS)
const SHARD_TICKS = 2 * TPS
const SHARD_DAMAGE = 7
// A shotgun burst: how many shards, fanned over how wide an arc (radians), a little faster than the ring's.
const BURST_COUNT = 7
const BURST_ARC = 0.9
const BURST_SPEED = Math.round((9 * SUB) / TPS)
// The wave of cold air (see above). Speeds and distances in tiles; the front is WAVE_BAND tiles deep.
export const WAVE_TRIGGER = 4
const WAVE_EVERY = Math.round(2.4 * TPS)
export const WAVE_WINDUP = Math.round(0.5 * TPS)
const WAVE_BAND = 1.1
const WAVE_DAMAGE = 10
const WAVE_PUSH = 3 * SUB
const ICICLE_FROM = 6
const ICICLE_EVERY = Math.round(2.2 * TPS)
const ICICLE_TICKS = Math.round(1.2 * TPS)
const ICICLE_RADIUS = Math.round(0.9 * SUB)
const ICICLE_DAMAGE = 9
const ICICLE_SPREAD = 1.4
export const BOSS_AIR = -40
export const BOSS_COLD_EVERY = 4 * TPS
// How long the hall must be empty of challengers before the fight is given up (and the lich is whole again).
const GIVE_UP_AFTER = 3 * TPS
// What a copy's chest holds: each item, from `min` to `max` of it.
const LOOT: ReadonlyArray<readonly [string, number, number]> = [
  ['essence', 4, 7],
  ['bone', 3, 6],
  ['arrow', 8, 16],
  ['leather', 1, 3],
]

type Copy = {
  slot: number
  chest: number
  // The frost lich (its animal ID), and the fight with it while one is on: the door sealing the hall, when it started,
  // when the lich next casts shards (and how many times it has), a wave and icicles, the waves of cold air rolling out
  // (from when, and whom each has hit), and since when the hall has had nobody in it.
  boss: number
  fight?: {
    door: number
    startedAt: number
    nextShardsAt: number
    casts: number
    nextWaveAt: number
    nextIciclesAt: number
    waves: Array<{ from: number; hit: Set<number> }>
    emptySince?: number
  }
  // When it last had nobody in it (undefined while somebody is).
  emptySince: number | undefined
}

export type DungeonContext = {
  tick: number
  world: FactoryWorld
  terrain: Terrain
  emit: (event: WorldEvent) => void
  nextEntityId: () => number
  animals: Animals | undefined
  // Grows a chunk now if nobody has been near it (so the skeletons have ground to stand on).
  growChunk: (chunk: number) => void
  // Moves a player somewhere else at once.
  teleport: (id: number, position: PlayerPosition) => void
  // The room's attacks and what is in flight, for the lich's spells.
  combat: Combat
  // Hurts a player, from a point, pushing them `knockback` units away.
  hurtPlayer: (id: number, damage: number, from: PlayerPosition, knockback: number) => void
  // Tells every page of a wave of cold air (to draw it): from a point (units), starting in `delay` ticks.
  wave: (x: number, y: number, delay: number) => void
}

export class Dungeons {
  private readonly copies = new Map<number, Copy>()
  private readonly rng: Rng
  // The tick being run (for the hall's cold).
  private tick = 0

  constructor(seed: number) {
    this.rng = new Rng((seed ^ 0xd06e0) >>> 0)
  }

  // The tile a player leaving a copy comes back out on: just below the way in.
  static outside(terrain: Terrain): PlayerPosition | undefined {
    const entrance = dungeonEntrance(terrain)
    return entrance ? { x: entrance.x * SUB + SUB / 2, y: (entrance.y + 2) * SUB + SUB / 2 } : undefined
  }

  step(context: DungeonContext, players: ReadonlyArray<{ id: number; position: PlayerPosition }>): void {
    this.tick = context.tick
    const entrance = dungeonEntrance(context.terrain)
    if (!entrance) return
    const inside = new Map<number, number>()
    for (const player of players) {
      const x = tileOfUnits(player.position.x)
      const y = tileOfUnits(player.position.y)
      const slot = dungeonSlotAt(x, y)
      if (slot === undefined) {
        if (x === entrance.x && y === entrance.y) {
          const into = this.enter(context)
          if (into === undefined) continue
          inside.set(into, (inside.get(into) ?? 0) + 1)
          context.teleport(player.id, middleOf(dungeonTile(into, DUNGEON_LAYOUT.start)))
        }
        continue
      }
      const exit = dungeonTile(slot, DUNGEON_LAYOUT.exit)
      if (x === exit.x && y === exit.y) {
        context.teleport(player.id, Dungeons.outside(context.terrain)!)
        continue
      }
      inside.set(slot, (inside.get(slot) ?? 0) + 1)
    }
    for (const copy of this.copies.values()) this.fight(context, copy, players)
    for (const copy of [...this.copies.values()]) {
      if (inside.has(copy.slot)) copy.emptySince = undefined
      else if (copy.emptySince === undefined) copy.emptySince = context.tick
      else if (context.tick - copy.emptySince >= CLOSE_AFTER) this.close(context, copy)
    }
  }

  // The copy a player stepping in goes into: one somebody is in now, or a new one (none, if every slot is taken).
  private enter(context: DungeonContext): number | undefined {
    const occupied = [...this.copies.values()].filter((copy) => copy.emptySince === undefined).sort((a, b) => a.slot - b.slot)[0]
    if (occupied) return occupied.slot
    for (let slot = 0; slot < DUNGEON_SLOTS; slot++) {
      if (this.copies.has(slot)) continue
      this.open(context, slot)
      return slot
    }
    return undefined
  }

  // Fills a fresh copy: its chest, full of loot, and its skeletons at their posts.
  private open(context: DungeonContext, slot: number): void {
    const corner = dungeonCorner(slot)
    for (let y = corner.y; y < corner.y + DUNGEON_LAYOUT.height; y += 8) {
      for (let x = corner.x; x < corner.x + DUNGEON_LAYOUT.width; x += 8) context.growChunk(chunkOfTile(x, y))
    }
    context.growChunk(chunkOfTile(corner.x + DUNGEON_LAYOUT.width - 1, corner.y + DUNGEON_LAYOUT.height - 1))
    const at = dungeonTile(slot, DUNGEON_LAYOUT.chest)
    const chest = createEntity(context.nextEntityId(), 'chest', at.x, at.y, 0, NO_ITEM)
    if (chest.kind === 'chest') {
      for (const [key, min, max] of LOOT) {
        const item = itemByKey(key)
        if (item) addItems(chest.inv, item.id, min + this.rng.nextInt(max - min + 1))
      }
    }
    context.emit({ t: 'add', e: entityToState(chest) })
    // The frost lich, in its hall.
    const lichAt = dungeonTile(slot, DUNGEON_LAYOUT.boss)
    const lich = context.animals?.spawn(animalDef('frost-lich'), lichAt.x * SUB + SUB / 2, lichAt.y * SUB + SUB / 2)
    if (lich) {
      lich.wild = false
      lich.dungeon = slot
    }
    const skeleton = animalDef('skeleton')
    const archer = animalDef('skeleton-archer')
    for (const [post, def] of [...DUNGEON_LAYOUT.guards.map((at) => [at, skeleton] as const), ...DUNGEON_LAYOUT.archers.map((at) => [at, archer] as const)]) {
      const tile = dungeonTile(slot, post)
      const guard = context.animals?.spawn(def, tile.x * SUB + SUB / 2, tile.y * SUB + SUB / 2)
      if (guard) {
        guard.wild = false
        guard.dungeon = slot
      }
    }
    this.copies.set(slot, { slot, chest: chest.id, boss: lich?.id ?? 0, emptySince: undefined })
  }

  // Clears a copy away: its chest, its skeletons, and anything left lying in it.
  private close(context: DungeonContext, copy: Copy): void {
    this.copies.delete(copy.slot)
    for (const animal of context.animals?.list() ?? []) if (animal.dungeon === copy.slot) context.animals!.all.delete(animal.id)
    const corner = dungeonCorner(copy.slot)
    const chunks = new Set<number>()
    for (let y = corner.y; y < corner.y + DUNGEON_LAYOUT.height + 8; y += 8) {
      for (let x = corner.x; x < corner.x + DUNGEON_LAYOUT.width + 8; x += 8) chunks.add(chunkOfTile(x, y))
    }
    for (const chunk of chunks) {
      for (const entity of [...(context.world.chunk(chunk)?.entities ?? [])]) {
        if (dungeonSlotAt(entity.x, entity.y) === copy.slot) context.emit({ t: 'remove', id: entity.id })
      }
      for (const drop of [...context.world.dropsInChunk(chunk)]) {
        if (dungeonSlotAt(tileOfUnits(drop.x), tileOfUnits(drop.y)) === copy.slot) context.emit({ t: 'drop-', id: drop.id })
      }
    }
  }

  // Whether a chest is a copy's, with its lich still standing (so it cannot be opened).
  guarded(id: number, animals: Animals | undefined): boolean {
    for (const copy of this.copies.values()) {
      if (copy.chest !== id) continue
      return copy.boss !== 0 ? animals?.get(copy.boss) !== undefined : (animals?.list() ?? []).some((animal) => animal.dungeon === copy.slot)
    }
    return false
  }

  // The air in a lich's hall while it is being fought (colder the longer it goes on), if a tile is in one; else none.
  airAt(x: number, y: number): number | undefined {
    const slot = dungeonSlotAt(x, y)
    const fight = slot === undefined ? undefined : this.copies.get(slot)?.fight
    if (!fight || !inBossHall(slot!, x, y)) return undefined
    return BOSS_AIR - Math.floor((this.tick - fight.startedAt) / BOSS_COLD_EVERY)
  }

  // Whether a copy's fight with its lich is on (for tests).
  fighting(slot: number): boolean {
    return this.copies.get(slot)?.fight !== undefined
  }

  // The fight in a copy's hall: started when a player walks in, cast on, won, or given up.
  private fight(context: DungeonContext, copy: Copy, players: ReadonlyArray<{ id: number; position: PlayerPosition }>): void {
    const lich = copy.boss ? context.animals?.get(copy.boss) : undefined
    const inHall = players.filter((player) => inBossHall(copy.slot, tileOfUnits(player.position.x), tileOfUnits(player.position.y)))
    const fight = copy.fight
    if (!fight) {
      if (!lich || inHall.length === 0) return
      // Nobody may be standing in the doorway as it seals.
      const doorTile = dungeonTile(copy.slot, DUNGEON_LAYOUT.door)
      if (players.some((player) => playerOverlapsTile(player.position, doorTile.x, doorTile.y))) return
      const door = createEntity(context.nextEntityId(), 'door', doorTile.x, doorTile.y, 0, NO_ITEM)
      context.emit({ t: 'add', e: entityToState(door) })
      copy.fight = {
        door: door.id,
        startedAt: context.tick,
        nextShardsAt: context.tick + 2 * TPS,
        casts: 0,
        nextWaveAt: context.tick + TPS,
        nextIciclesAt: context.tick + 3 * TPS,
        waves: [],
      }
      context.animals?.provoke(lich.id, inHall[0].id, context.tick)
      return
    }
    const open = (): void => {
      if (context.world.entity(fight.door)) context.emit({ t: 'remove', id: fight.door })
      copy.fight = undefined
    }
    // Won: the door opens (and the chest, see `guarded`).
    if (!lich) return open()
    // Everyone in the hall fallen or gone: after a moment, given up.
    if (inHall.length === 0) {
      fight.emptySince ??= context.tick
      if (context.tick - fight.emptySince >= GIVE_UP_AFTER) {
        open()
        context.animals?.calm(lich.id, context.tick)
      }
      return
    }
    fight.emptySince = undefined
    // After whoever is in the hall (if the one it was after is gone).
    if (!inHall.some((player) => player.id === lich.target)) context.animals?.provoke(lich.id, inHall[0].id, context.tick)
    this.rollWaves(context, fight, lich, inHall)
    const away = (player: { position: PlayerPosition }): number => Math.hypot(player.position.x - lich.x, player.position.y - lich.y) / SUB
    // Somebody close: a wave of cold air.
    if (context.tick >= fight.nextWaveAt && inHall.some((player) => away(player) <= WAVE_TRIGGER)) {
      fight.nextWaveAt = context.tick + WAVE_EVERY
      fight.waves.push({ from: context.tick + WAVE_WINDUP, hit: new Set() })
      context.wave(lich.x, lich.y, WAVE_WINDUP)
    }
    const shards = itemByKey('ice-shard')?.id ?? 0
    const icicle = itemByKey('icicle')?.id ?? 0
    if (context.tick >= fight.nextShardsAt) {
      fight.nextShardsAt = context.tick + SHARD_EVERY
      if (fight.casts++ % 2 === 0) {
        // A ring of shards all round, turned a little each time.
        const twist = (fight.casts * 0.37) % (Math.PI * 2)
        for (let i = 0; i < SHARD_COUNT; i++) {
          context.combat.hostileShot(shards, lich.x, lich.y, twist + (i / SHARD_COUNT) * Math.PI * 2, SHARD_SPEED, SHARD_DAMAGE, SHARD_TICKS)
        }
      } else {
        // A shotgun burst at each player in the hall.
        for (const player of inHall) {
          const aim = Math.atan2(player.position.y - lich.y, player.position.x - lich.x)
          for (let i = 0; i < BURST_COUNT; i++) {
            const angle = aim + (i / (BURST_COUNT - 1) - 0.5) * BURST_ARC
            context.combat.hostileShot(shards, lich.x, lich.y, angle, BURST_SPEED, SHARD_DAMAGE, SHARD_TICKS)
          }
        }
      }
    }
    // Somebody far: icicles on them.
    if (context.tick >= fight.nextIciclesAt) {
      const far = inHall.filter((player) => away(player) >= ICICLE_FROM)
      if (far.length > 0) fight.nextIciclesAt = context.tick + ICICLE_EVERY
      // Icicles on each player far off: one where they stand, and two near.
      for (const player of far) {
        context.combat.icicle(icicle, player.position.x, player.position.y, ICICLE_TICKS, ICICLE_RADIUS, ICICLE_DAMAGE)
        for (let n = 0; n < 2; n++) {
          const angle = this.rng.nextU32() / 0x1_0000_0000 * Math.PI * 2
          const x = Math.round(player.position.x + Math.cos(angle) * ICICLE_SPREAD * SUB)
          const y = Math.round(player.position.y + Math.sin(angle) * ICICLE_SPREAD * SUB)
          if (inBossHall(copy.slot, tileOfUnits(x), tileOfUnits(y))) context.combat.icicle(icicle, x, y, ICICLE_TICKS, ICICLE_RADIUS, ICICLE_DAMAGE)
        }
      }
    }
  }

  // The waves of cold air rolling out from the lich: each player the front passes over is hurt and thrown back, once.
  private rollWaves(
    context: DungeonContext,
    fight: NonNullable<Copy['fight']>,
    lich: { x: number; y: number },
    inHall: ReadonlyArray<{ id: number; position: PlayerPosition }>,
  ): void {
    const perTick = (WAVE_SPEED * SUB) / TPS
    fight.waves = fight.waves.filter((wave) => {
      if (context.tick < wave.from) return true
      const front = (context.tick - wave.from) * perTick
      for (const player of inHall) {
        if (wave.hit.has(player.id)) continue
        const distance = Math.hypot(player.position.x - lich.x, player.position.y - lich.y)
        if (distance > front + PLAYER_HALF_SIZE || distance < front - WAVE_BAND * SUB) continue
        wave.hit.add(player.id)
        context.hurtPlayer(player.id, WAVE_DAMAGE, lich, WAVE_PUSH)
      }
      return front <= WAVE_RADIUS * SUB
    })
  }

  // How many copies are open (for tests).
  get openCount(): number {
    return this.copies.size
  }
}

function middleOf(tile: { x: number; y: number }): PlayerPosition {
  return { x: tile.x * SUB + SUB / 2, y: tile.y * SUB + SUB / 2 }
}
