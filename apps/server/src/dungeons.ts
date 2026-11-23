import {
  addItems,
  chunkOfTile,
  createEntity,
  DUNGEON_LAYOUT,
  DUNGEON_SLOTS,
  DUNGEON_TRAPS,
  dungeonCorner,
  dungeonEntrance,
  dungeonSlotAt,
  dungeonTile,
  dungeonTrapAt,
  entityToState,
  inBossRooms,
  itemByKey,
  monsterDef,
  NO_ITEM,
  playerOverlapsTile,
  Rng,
  SUB,
  TPS,
  tileOfUnits,
  type FactoryWorld,
  type PlayerPosition,
  type StreamEvent,
  type Terrain,
  type WorldEvent,
  tileMiddle,
} from '../../../packages/shared/src/index.ts'
import type { Combat } from './combat.ts'
import type { Dropped } from './commands.ts'
import { LichFight } from './frost-lich.ts'
import type { Monsters } from './monsters.ts'

// The dungeon's copies (see dungeon.ts for the layout and where the copies are).
//
// A player who steps onto the way in, deep in the mountains' snow, is taken into a copy: the one another player is
// already in (so friends go in together), or else a fresh one, its guards in their rooms and its chest full. The stairs
// out (at the start, and once the lich has fallen the ones at the back of its hall) take a player back to just outside
// the way in. A copy nobody has been in for CLOSE_AFTER is cleared away (its
// chest, its monsters and whatever lies on its floor), and its slot is free again. None of it is saved: a player saved
// inside one comes back outside the way in.
//
// The door ('D') to the frost lich's rooms stays shut until every guard in the copy is dead. Through it is a waiting
// room, and then the line across the mouth of the lich's hall: whoever crosses it starts the fight. The door shuts
// behind everyone in the lich's rooms then (so nobody else gets in, but whoever is in the waiting room can still join
// in), and the lich's health is BOSS_HP_PER_PLAYER more of its own for every player there after the first. Its rooms
// start at BOSS_AIR (cold enough that only the warmest armour keeps a player moving) and get a degree colder every
// BOSS_COLD_EVERY ticks, so a slow fight freezes. When the lich falls the door opens and its chest can be opened; if
// everyone in its rooms falls or gets out, after GIVE_UP_AFTER the door opens and the lich is whole again, for the next
// try. See frost-lich.ts for the fight itself.
//
// The spike traps (DUNGEON_TRAPS): anything stepping on one (a player, or a monster: a skeleton walks into them as
// readily) sets it off; TRAP_DELAY ticks later its spikes come up, for
// TRAP_ACTIVE ticks, and everyone on it then is hurt once (TRAP_DAMAGE); then it takes TRAP_RECHARGE ticks to be ready
// again. So the way past one is to set it off, step back, and go while it recharges.

const CLOSE_AFTER = 20 * TPS
export const BOSS_AIR = -40
export const BOSS_COLD_EVERY = 6 * TPS
export const BOSS_HP_PER_PLAYER = 0.8
// How long the lich's rooms must be empty of challengers before the fight is given up (and the lich is whole again).
const GIVE_UP_AFTER = 3 * TPS
export const TRAP_DELAY = Math.round(0.4 * TPS)
export const TRAP_ACTIVE = TPS
export const TRAP_RECHARGE = 5 * TPS
export const TRAP_DAMAGE = 25
const TRAP_KNOCKBACK = Math.round(0.3 * SUB)
// What a copy's chest holds: each item, from `min` to `max` of it.
const LOOT: ReadonlyArray<readonly [string, number, number]> = [
  ['essence', 4, 7],
  ['bone', 3, 6],
  ['arrow', 8, 16],
  ['leather', 1, 3],
]

// `hit`: who has been hurt by the spikes this time ('p' and a player's ID, 'm' and a monster's).
type Trap = { readyAt: number; firesAt: number; until: number; hit: Set<string> }

type Copy = {
  slot: number
  chest: number
  // The frost lich and the guards (monster IDs), and the door to the lich's rooms (its entity, while it is shut).
  lich: number
  guards: number[]
  door?: number
  // The ice sealing the way out at the back of the lich's hall (its entity, while the lich stands).
  seal?: number
  fight?: { startedAt: number; lich: LichFight; emptySince?: number }
  traps: Trap[]
  // When it last had nobody in it (undefined while somebody is).
  emptySince: number | undefined
}

export type DungeonContext = {
  tick: number
  world: FactoryWorld
  terrain: Terrain
  emit: (event: WorldEvent) => void
  nextEntityId: () => number
  monsters: Monsters | undefined
  // Grows a chunk now if nobody has been near it (so the monsters have ground to stand on).
  growChunk: (chunk: number) => void
  // Moves a player somewhere else at once.
  teleport: (id: number, position: PlayerPosition) => void
  // The room's attacks and what is in flight, for the lich's spells.
  combat: Combat
  // Hurts a player, from a point, pushing them `knockback` units away (`pierce`: armour or not).
  hurtPlayer: (id: number, damage: number, from: PlayerPosition, knockback: number, pierce?: boolean) => void
  // Tells the pages of the players in a copy something (a trap going off, a spell).
  tell: (slot: number, event: StreamEvent) => void
  // Drops what a monster killed (by a trap) leaves, round where it fell.
  dropRound: (middle: PlayerPosition, salt: number, drops: Dropped) => void
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
    const inside = new Map<number, Array<{ id: number; position: PlayerPosition }>>()
    for (const player of players) {
      const x = tileOfUnits(player.position.x)
      const y = tileOfUnits(player.position.y)
      const slot = dungeonSlotAt(x, y)
      if (slot === undefined) {
        if (x === entrance.x && y === entrance.y) {
          const into = this.enter(context)
          if (into === undefined) continue
          const start = dungeonTile(into, DUNGEON_LAYOUT.start)
          context.teleport(player.id, tileMiddle(start.x, start.y))
        }
        continue
      }
      const exit = dungeonTile(slot, DUNGEON_LAYOUT.exit)
      const hallExit = dungeonTile(slot, DUNGEON_LAYOUT.hallExit)
      if ((x === exit.x && y === exit.y) || (x === hallExit.x && y === hallExit.y && !context.monsters?.get(this.copies.get(slot)?.lich ?? 0))) {
        context.teleport(player.id, Dungeons.outside(context.terrain)!)
        continue
      }
      const list = inside.get(slot) ?? []
      list.push(player)
      inside.set(slot, list)
    }
    for (const copy of [...this.copies.values()]) {
      const here = inside.get(copy.slot) ?? []
      this.door(context, copy, here)
      this.seal(context, copy)
      this.fight(context, copy, here)
      this.traps(context, copy, here)
      if (here.length > 0) copy.emptySince = undefined
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

  // Fills a fresh copy: its chest, full of loot, its guards in their rooms, and the lich in its hall.
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
    const spawn = (kind: string, post: { x: number; y: number }): number => {
      const tile = dungeonTile(slot, post)
      return context.monsters?.spawn(monsterDef(kind), tile.x * SUB + SUB / 2, tile.y * SUB + SUB / 2, { dungeon: slot }).id ?? 0
    }
    const lich = spawn('frost-lich', DUNGEON_LAYOUT.boss)
    const guards = [...DUNGEON_LAYOUT.guards.map((post) => spawn('skeleton', post)), ...DUNGEON_LAYOUT.archers.map((post) => spawn('skeleton-archer', post))]
    const traps = DUNGEON_TRAPS.map(() => ({ readyAt: 0, firesAt: -1, until: -1, hit: new Set<string>() }))
    this.copies.set(slot, { slot, chest: chest.id, lich, guards: guards.filter((id) => id !== 0), traps, emptySince: undefined })
  }

  // Clears a copy away: its chest, its monsters, and anything left lying in it.
  private close(context: DungeonContext, copy: Copy): void {
    this.copies.delete(copy.slot)
    for (const monster of context.monsters?.list() ?? []) if (monster.dungeon === copy.slot) context.monsters!.remove(monster.id)
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
  guarded(id: number, monsters: Monsters | undefined): boolean {
    for (const copy of this.copies.values()) if (copy.chest === id) return monsters?.get(copy.lich) !== undefined
    return false
  }

  // How many of a copy's guards are still standing (for tests).
  guardsLeft(slot: number, monsters: Monsters | undefined): number {
    return this.copies.get(slot)?.guards.filter((id) => monsters?.get(id)).length ?? 0
  }

  // The air in a lich's rooms while it is being fought (colder the longer it goes on), if a tile is in them; else none.
  airAt(x: number, y: number): number | undefined {
    const slot = dungeonSlotAt(x, y)
    const fight = slot === undefined ? undefined : this.copies.get(slot)?.fight
    if (!fight || !inBossRooms(slot!, x, y)) return undefined
    return BOSS_AIR - Math.floor((this.tick - fight.startedAt) / BOSS_COLD_EVERY)
  }

  // Whether a copy's fight with its lich is on (for tests).
  fighting(slot: number): boolean {
    return this.copies.get(slot)?.fight !== undefined
  }

  // The way out at the back of the lich's hall: sealed with ice while the lich stands, open once it has fallen.
  private seal(context: DungeonContext, copy: Copy): void {
    const standing = context.monsters?.get(copy.lich) !== undefined
    if (standing && copy.seal === undefined) {
      const tile = dungeonTile(copy.slot, DUNGEON_LAYOUT.hallExit)
      if (context.world.entityAt(tile.x, tile.y)) return
      const seal = createEntity(context.nextEntityId(), 'door', tile.x, tile.y, 0, NO_ITEM)
      context.emit({ t: 'add', e: entityToState(seal) })
      copy.seal = seal.id
    } else if (!standing && copy.seal !== undefined) {
      if (context.world.entity(copy.seal)) context.emit({ t: 'remove', id: copy.seal })
      copy.seal = undefined
    }
  }

  // The door to the lich's rooms: shut while any guard stands, or while the lich is being fought; open otherwise. It
  // waits to shut while somebody stands in the doorway.
  private door(context: DungeonContext, copy: Copy, players: ReadonlyArray<{ position: PlayerPosition }>): void {
    const guarded = copy.guards.some((id) => context.monsters?.get(id))
    const shut = guarded || copy.fight !== undefined
    const tile = dungeonTile(copy.slot, DUNGEON_LAYOUT.door)
    if (shut && copy.door === undefined) {
      if (players.some((player) => playerOverlapsTile(player.position, tile.x, tile.y))) return
      if (context.world.entityAt(tile.x, tile.y)) return
      const door = createEntity(context.nextEntityId(), 'door', tile.x, tile.y, 0, NO_ITEM)
      context.emit({ t: 'add', e: entityToState(door) })
      copy.door = door.id
    } else if (!shut && copy.door !== undefined) {
      if (context.world.entity(copy.door)) context.emit({ t: 'remove', id: copy.door })
      copy.door = undefined
    }
  }

  // The fight in a copy's hall: started when a player crosses the line, cast on, won, or given up.
  private fight(context: DungeonContext, copy: Copy, players: ReadonlyArray<{ id: number; position: PlayerPosition }>): void {
    const monsters = context.monsters
    const lich = monsters?.get(copy.lich)
    const corner = dungeonCorner(copy.slot)
    const inRooms = players.filter((player) => inBossRooms(copy.slot, tileOfUnits(player.position.x), tileOfUnits(player.position.y)))
    const fight = copy.fight
    if (!fight) {
      if (!lich || !monsters) return
      // Somebody on the line, or past it: the fight is on, for everyone in the lich's rooms.
      const crossed = inRooms.some((player) => tileOfUnits(player.position.y) - corner.y <= DUNGEON_LAYOUT.line)
      if (!crossed) return
      const hp = Math.round(lich.def.hp * (1 + BOSS_HP_PER_PLAYER * (inRooms.length - 1)))
      monsters.reset(lich.id, context.tick, hp)
      monsters.provoke(lich.id, inRooms[0].id, context.tick)
      copy.fight = { startedAt: context.tick, lich: new LichFight(context.tick, this.rng) }
      return
    }
    const end = (): void => {
      for (const id of fight.lich.calledUp()) monsters?.remove(id)
      copy.fight = undefined
    }
    // Won: the door opens (and the chest, see `guarded`).
    if (!lich || !monsters) return end()
    // Everyone in the lich's rooms fallen or gone: after a moment, given up.
    if (inRooms.length === 0) {
      fight.emptySince ??= context.tick
      if (context.tick - fight.emptySince >= GIVE_UP_AFTER) {
        end()
        monsters.reset(lich.id, context.tick)
      }
      return
    }
    fight.emptySince = undefined
    if (!inRooms.some((player) => player.id === lich.target)) monsters.provoke(lich.id, inRooms[0].id, context.tick)
    fight.lich.step(
      {
        tick: context.tick,
        slot: copy.slot,
        monsters,
        combat: context.combat,
        hurtPlayer: context.hurtPlayer,
        spell: (spell, x, y, radius, ticks) => context.tell(copy.slot, { k: 'spell', spell, x, y, radius, ticks }),
      },
      lich,
      inRooms,
    )
  }

  // The spike traps: set off by anything stepping on one (a player or a monster: not the lich, which never moves), then
  // the spikes, hurting everything on it then, then the recharge.
  private traps(context: DungeonContext, copy: Copy, players: ReadonlyArray<{ id: number; position: PlayerPosition }>): void {
    const { tick } = context
    const on = (position: PlayerPosition): number | undefined => {
      const x = tileOfUnits(position.x)
      const y = tileOfUnits(position.y)
      const index = dungeonTrapAt(x, y)
      // Only its floor: the wall its spikes come out of is rock.
      return index !== undefined && DUNGEON_TRAPS[index].tiles.some((tile) => dungeonTile(copy.slot, tile).x === x && dungeonTile(copy.slot, tile).y === y) ? index : undefined
    }
    // Everything that walks the copy's floor: its players, and its monsters.
    const walkers: Array<{ key: string; position: PlayerPosition; hurt: (from: PlayerPosition, knockback: number) => void }> = players.map((player) => ({
      key: `p${player.id}`,
      position: player.position,
      hurt: (from, knockback) => context.hurtPlayer(player.id, TRAP_DAMAGE, from, knockback),
    }))
    for (const monster of context.monsters?.list() ?? []) {
      if (monster.dungeon !== copy.slot || monster.def.boss) continue
      const position = { x: monster.x, y: monster.y }
      walkers.push({
        key: `m${monster.id}`,
        position,
        hurt: (from, knockback) => {
          const drops = context.monsters!.damage(monster.id, TRAP_DAMAGE, from, tick, { knockback })
          if (drops) context.dropRound(position, monster.id, drops)
        },
      })
    }
    for (const walker of walkers) {
      const index = on(walker.position)
      if (index === undefined) continue
      const trap = copy.traps[index]
      if (tick >= trap.readyAt) {
        trap.firesAt = tick + TRAP_DELAY
        trap.until = trap.firesAt + TRAP_ACTIVE
        trap.readyAt = trap.until + TRAP_RECHARGE
        trap.hit.clear()
        context.tell(copy.slot, { k: 'trap', slot: copy.slot, trap: index, delay: TRAP_DELAY })
      }
      if (tick >= trap.firesAt && tick < trap.until && !trap.hit.has(walker.key)) {
        trap.hit.add(walker.key)
        // Spikes from a wall push what they hit on the way they shoot; spikes from the floor only hurt.
        const dir = DUNGEON_TRAPS[index].wall?.dir
        const from = dir ? { x: walker.position.x - dir.x * SUB, y: walker.position.y - dir.y * SUB } : walker.position
        walker.hurt(from, dir ? TRAP_KNOCKBACK : 0)
      }
    }
  }

  // How many copies are open (for tests).
  get openCount(): number {
    return this.copies.size
  }
}
