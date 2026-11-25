import {
  BEES,
  CHUNK_SIZE,
  chunkOfTile,
  chunksAround,
  entityToState,
  isFireKind,
  isSmoking,
  monsterDef,
  PLAYER_HALF_SIZE,
  Rng,
  SUB,
  tileOfUnits,
  type Entity,
  type FactoryWorld,
  type HiveEntity,
  type IsSolid,
  type PlayerPosition,
  type WorldEvent,
} from '../../../packages/shared/src/index.ts'
import type { Monster, Monsters } from './monsters.ts'
import { stepToward } from './steering.ts'

// The bees (see data/bees.json, and "bee" and "queen-bee" in data/monsters.json). Every beehive, wild or a bee box, may
// keep a colony: its queen and its worker bees, counted on the hive itself (HiveEntity's `queen` and `bees`), so a
// colony is saved with its hive. A bee in its hive is only that count; one out of it is a monster (so it is drawn, can be
// hit, and stings like one), kept here with what it is doing, and goes back to being a count when it flies home.
//
// - Foraging: every BEES.forageEvery a worker sets out from a hive with its queen in it for a sunflower within
//   BEES.forageRadius tiles (none there: none sets out), gathers at it for BEES.gather, and flies home: the hive's honey
//   goes up by one (to at most BEES.honeyMost); a punch knocks one out as a honeycomb. Hives are only looked after where something is going on (as the animals are: near a player, or
//   in a chunk a player has built in, so a bee box keeps working while its keeper is away).
// - Anger: a hive hit, or punched for a honeycomb (see `onHive` in commands.ts) sends every worker it has
//   after whoever did it: those out come back for them, and those in it come out. An angry bee flies straight at them
//   (over anything) and stings them (its `attack` in monsters.json) until they are more than its `leash` from where it
//   was angered, or gone, or it comes within BEES.smokeRadius of a smoking fire (one cooking leaves: `isSmoking`); then
//   it calms down and flies home.
// - A worker killed is one less in its hive. When the last of a hive's workers is killed, its queen leaves.
// - A hive destroyed: its workers come out angry, and its queen leaves. Once they calm down, they follow her.
// - A queen who has left looks for the nearest hive with no queen in it (a wild one left empty, or a bee box)
//   within BEES.searchRadius tiles (not the one she left), every SEEK_EVERY ticks, drifting where she is meanwhile; she
//   flies there and moves in, and her workers after her, each one more in that hive.
// - A bee whose queen is killed, with no home, drifts where it is.

// How often hives are looked after (their foraging), a queen looks for a home and an angry bee for smoke,
// in ticks; how near (units) a bee comes to where it is going to be there; how near a follower keeps to its queen.
const TEND_EVERY = 10
const SEEK_EVERY = 30
const SMOKE_EVERY = 10
const ARRIVE = Math.round(SUB * 0.3)
const FOLLOW_NEAR = Math.round(SUB * 1.2)
// A bee with nowhere to go drifts round a spot, this far out (units), and a gathering one round its flower.
const DRIFT = Math.round(SUB * 0.6)
const GATHER_DRIFT = Math.round(SUB * 0.25)
// Bees fly: nothing stands in their way.
const OPEN: IsSolid = () => false

type Job = 'out' | 'gather' | 'back' | 'chase' | 'follow' | 'seek' | 'drift'

// What a bee out of its hive is doing.
export type BeeState = {
  queen: boolean
  // Its hive (an entity ID; 0: none, its home gone), and whether it is moving in there (with its queen) rather than
  // coming home (a bee moving in is one more in the hive when it gets there).
  home: number
  joining: boolean
  // The queen it follows while it has no home (her monster ID; 0: none).
  swarm: number
  job: Job
  // A worker foraging: its sunflower, until when it gathers there, and whether it has (it brings honey home).
  flower: number
  until: number
  gathered: boolean
  // A queen looking for a home: the hive she is going to (0: none found yet), and the one she left (never back to it).
  to: number
  left: number
  // When it can sting again; where it was angered (its leash is from there); where it drifts round.
  stingAt: number
  fromX: number
  fromY: number
  driftX: number
  driftY: number
}

export type Bee = Monster & { bee: BeeState }

// What the bees need from the room on a tick.
export type HiveContext = {
  world: FactoryWorld
  tick: number
  emit: (event: WorldEvent) => void
  players: ReadonlyArray<{ id: number; position: PlayerPosition }>
  // Whether a chunk is where something is going on (see the animals' `isActive`).
  isActive: (chunk: number) => boolean
  hurtPlayer: (id: number, damage: number, from: PlayerPosition, knockback: number) => void
}

// Queens without a home when the world is saved, each with how many workers follow her: [x, y, followers] (units).
export type SwarmSave = Array<[number, number, number]>

// The kinds a colony lives in: a wild hive, or a bee box that a player made.
const HIVE_KINDS = ['hive', 'beebox'] as const

export function isHive(entity: Entity | undefined): entity is HiveEntity {
  return entity !== undefined && (HIVE_KINDS as readonly string[]).includes(entity.kind)
}

function middleOf(hive: { x: number; y: number }): PlayerPosition {
  return { x: hive.x * SUB + SUB / 2, y: hive.y * SUB + SUB / 2 }
}

export class Bees {
  // Every bee out of its hive, by its monster's ID.
  private readonly out = new Map<number, Bee>()
  // When each hive (by ID) next sends a worker out.
  private readonly colonies = new Map<number, { forageAt: number }>()
  private readonly rng: Rng

  constructor(private readonly monsters: Monsters, seed: number) {
    this.rng = new Rng((seed ^ 0xbee5) >>> 0)
  }

  // The bees out of their hives (for tests).
  list(): Bee[] {
    return [...this.out.values()]
  }

  // ---- what players do to hives

  onHive(hive: HiveEntity, what: 'hit' | 'destroyed' | 'punched', by: number): void {
    if (what === 'destroyed') this.destroyed(hive, by)
    else this.anger(hive, by)
  }

  // Every worker of a hive goes for a player: those out come back for them, and those in it come out.
  private anger(hive: HiveEntity, by: number): void {
    const from = middleOf(hive)
    const mine = this.workersOf(hive.id)
    for (const bee of mine) this.setOn(bee, by, from)
    for (let n = mine.length; n < hive.bees; n++) {
      const bee = this.spawn(false, from, { home: hive.id })
      this.setOn(bee, by, from)
    }
  }

  // A hive is gone: its workers come out angry (those out too), and its queen leaves, her workers following her once
  // they calm down.
  private destroyed(hive: HiveEntity, by: number): void {
    this.anger(hive, by)
    const queen = hive.queen === 1 ? this.spawn(true, middleOf(hive), { job: 'seek', left: hive.id }) : undefined
    for (const bee of this.out.values()) {
      if (bee.bee.queen || bee.bee.home !== hive.id) continue
      bee.bee.home = 0
      bee.bee.joining = false
      bee.bee.swarm = queen?.id ?? 0
    }
    this.colonies.delete(hive.id)
  }

  private setOn(bee: Bee, player: number, from: PlayerPosition): void {
    bee.target = player
    bee.bee.job = 'chase'
    bee.bee.fromX = from.x
    bee.bee.fromY = from.y
  }

  // ---- each tick

  step(context: HiveContext): void {
    this.buryDead(context)
    if (context.tick % TEND_EVERY === 0) this.tend(context)
    for (const bee of [...this.out.values()]) {
      if (!this.out.has(bee.id) || bee.stunnedUntil > context.tick) continue
      if (bee.bee.queen) this.stepQueen(context, bee)
      else this.stepWorker(context, bee)
    }
  }

  // The bees killed since the last tick: a worker is one less in its hive (the last of them gone, its queen leaves); a
  // queen's followers are left with nobody to follow.
  private buryDead(context: HiveContext): void {
    for (const [id, bee] of [...this.out]) {
      if (this.monsters.get(id)) continue
      this.out.delete(id)
      if (bee.bee.queen) {
        for (const other of this.out.values()) {
          if (other.bee.swarm !== id) continue
          other.bee.swarm = 0
          if (other.bee.job === 'follow') this.drift(other)
        }
        continue
      }
      if (bee.bee.home === 0 || bee.bee.joining) continue
      const hive = context.world.entity(bee.bee.home)
      if (!isHive(hive)) continue
      const bees = Math.max(0, hive.bees - 1)
      if (bees === 0 && hive.queen === 1) {
        context.emit({ t: 'set', e: entityToState({ ...hive, bees, queen: 0 }) })
        this.spawn(true, middleOf(hive), { job: 'seek', left: hive.id })
        this.colonies.delete(hive.id)
      } else context.emit({ t: 'set', e: entityToState({ ...hive, bees }) })
    }
  }

  // The hives where something is going on: each with its colony sends a worker out now and then, to a sunflower near
  // it.
  private tend(context: HiveContext): void {
    const { world, tick } = context
    for (const kind of HIVE_KINDS) {
      for (const entity of world.ofKind(kind)) {
        if (entity.queen !== 1 || entity.bees <= 0 || !context.isActive(chunkOfTile(entity.x, entity.y))) continue
        let colony = this.colonies.get(entity.id)
        if (!colony) {
          colony = { forageAt: tick + this.rng.nextInt(BEES.forageEvery) }
          this.colonies.set(entity.id, colony)
        }
        if (tick < colony.forageAt) continue
        colony.forageAt = tick + BEES.forageEvery
        if (this.workersOf(entity.id).length >= entity.bees) continue
        const flower = this.flowerNear(world, entity)
        if (flower) this.spawn(false, middleOf(entity), { home: entity.id, job: 'out', flower: flower.id })
      }
    }
  }

  // A grown sunflower within BEES.forageRadius tiles of a hive, picked at random.
  private flowerNear(world: FactoryWorld, hive: HiveEntity): Entity | undefined {
    const radius = BEES.forageRadius
    const found: Entity[] = []
    for (const chunk of chunksAround(chunkOfTile(hive.x, hive.y), Math.ceil(radius / CHUNK_SIZE))) {
      for (const entity of world.chunk(chunk)?.entities ?? []) {
        if (entity.kind === 'sunflower' && (entity.x - hive.x) ** 2 + (entity.y - hive.y) ** 2 <= radius * radius) found.push(entity)
      }
    }
    found.sort((a, b) => a.id - b.id)
    return found.length > 0 ? found[this.rng.nextInt(found.length)] : undefined
  }

  private stepWorker(context: HiveContext, bee: Bee): void {
    const state = bee.bee
    const { world, tick } = context
    if (bee.target !== 0 && (tick + bee.id) % SMOKE_EVERY === 0 && this.smokeNear(world, bee)) this.calm(bee)
    switch (state.job) {
      case 'chase': {
        const attack = bee.def.attack
        const target = context.players.find((player) => player.id === bee.target)
        if (!target || Math.hypot(target.position.x - state.fromX, target.position.y - state.fromY) > bee.def.leash) {
          this.calm(bee)
          return
        }
        if (!this.fly(bee, target.position.x, target.position.y, bee.def.halfSize + PLAYER_HALF_SIZE)) return
        if (attack.kind !== 'sting' || tick < state.stingAt) return
        state.stingAt = tick + attack.cooldown
        context.hurtPlayer(target.id, attack.damage, { x: bee.x, y: bee.y }, 0)
        return
      }
      case 'out': {
        const flower = world.entity(state.flower)
        if (flower?.kind !== 'sunflower') {
          state.job = 'back'
          return
        }
        if (this.fly(bee, flower.x * SUB + SUB / 2, flower.y * SUB + SUB / 2, ARRIVE)) {
          state.job = 'gather'
          state.until = tick + BEES.gather
          state.driftX = flower.x * SUB + SUB / 2
          state.driftY = flower.y * SUB + SUB / 2
        }
        return
      }
      case 'gather':
        this.hover(bee, tick, GATHER_DRIFT)
        if (tick < state.until) return
        state.gathered = world.entity(state.flower)?.kind === 'sunflower'
        state.job = 'back'
        return
      case 'back': {
        const hive = world.entity(state.home)
        if (!isHive(hive)) {
          state.home = 0
          state.joining = false
          this.calm(bee)
          return
        }
        if (this.fly(bee, hive.x * SUB + SUB / 2, hive.y * SUB + SUB / 2, ARRIVE)) this.enter(context, bee, hive)
        return
      }
      case 'follow': {
        const queen = this.out.get(state.swarm)
        if (!queen) {
          state.swarm = 0
          this.drift(bee)
          return
        }
        this.fly(bee, queen.x, queen.y, FOLLOW_NEAR)
        return
      }
      case 'seek':
      case 'drift':
        this.hover(bee, tick, DRIFT)
        return
    }
  }

  private stepQueen(context: HiveContext, queen: Bee): void {
    const state = queen.bee
    const { world, tick } = context
    if (state.to !== 0) {
      const hive = world.entity(state.to)
      if (!isHive(hive) || hive.queen !== 0) {
        state.to = 0
        return
      }
      if (this.fly(queen, hive.x * SUB + SUB / 2, hive.y * SUB + SUB / 2, ARRIVE)) this.moveIn(context, queen, hive)
      return
    }
    if ((tick + queen.id) % SEEK_EVERY === 0) {
      const hive = this.freeHiveNear(world, queen, state.left)
      if (hive) {
        state.to = hive.id
        return
      }
    }
    this.hover(queen, tick, DRIFT)
  }

  // The nearest hive with no queen in it within BEES.searchRadius tiles of a queen (not the one she left).
  private freeHiveNear(world: FactoryWorld, queen: Bee, left: number): HiveEntity | undefined {
    const tx = tileOfUnits(queen.x)
    const ty = tileOfUnits(queen.y)
    const radius = BEES.searchRadius
    let best: HiveEntity | undefined
    let bestDistance = radius * radius
    for (const chunk of chunksAround(chunkOfTile(tx, ty), Math.ceil(radius / CHUNK_SIZE))) {
      for (const entity of world.chunk(chunk)?.entities ?? []) {
        if (!isHive(entity) || entity.queen !== 0 || entity.id === left) continue
        const distance = (entity.x - tx) ** 2 + (entity.y - ty) ** 2
        if (distance > bestDistance || (distance === bestDistance && best && best.id < entity.id)) continue
        best = entity
        bestDistance = distance
      }
    }
    return best
  }

  // A queen moves into a hive: it has a queen again, and her workers make for it, each one more in it when it gets there.
  private moveIn(context: HiveContext, queen: Bee, hive: HiveEntity): void {
    context.emit({ t: 'set', e: entityToState({ ...hive, queen: 1 }) })
    for (const bee of this.out.values()) {
      if (bee.bee.swarm !== queen.id) continue
      bee.bee.swarm = 0
      bee.bee.home = hive.id
      bee.bee.joining = true
      if (bee.bee.job !== 'chase') bee.bee.job = 'back'
    }
    this.take(queen)
  }

  // A worker gets to its hive: it goes in, with honey if it gathered some; or, moving in, it is one more there.
  private enter(context: HiveContext, bee: Bee, hive: HiveEntity): void {
    if (bee.bee.joining) context.emit({ t: 'set', e: entityToState({ ...hive, bees: hive.bees + 1 }) })
    else if (bee.bee.gathered && hive.honey < BEES.honeyMost) context.emit({ t: 'set', e: entityToState({ ...hive, honey: hive.honey + 1 }) })
    this.take(bee)
  }

  // An angry bee calms down: back home, or after its queen, or it drifts where it is.
  private calm(bee: Bee): void {
    bee.target = 0
    if (bee.bee.home !== 0) bee.bee.job = 'back'
    else if (bee.bee.swarm !== 0 && this.out.has(bee.bee.swarm)) bee.bee.job = 'follow'
    else this.drift(bee)
  }

  private drift(bee: Bee): void {
    bee.bee.job = 'drift'
    bee.bee.driftX = bee.x
    bee.bee.driftY = bee.y
  }

  // Whether a bee is in smoke: within BEES.smokeRadius tiles of a fire cooking leaves.
  private smokeNear(world: FactoryWorld, bee: Bee): boolean {
    const tx = tileOfUnits(bee.x)
    const ty = tileOfUnits(bee.y)
    const radius = BEES.smokeRadius
    for (let y = ty - radius; y <= ty + radius; y++) {
      for (let x = tx - radius; x <= tx + radius; x++) {
        if ((x - tx) ** 2 + (y - ty) ** 2 > radius * radius) continue
        const fire = world.entityAt(x, y)
        if (fire && isFireKind(fire.kind) && 'heat' in fire && 'inv' in fire && isSmoking({ kind: fire.kind, inv: fire.inv, heat: fire.heat })) return true
      }
    }
    return false
  }

  // ---- moving

  // Flies straight towards a point (over anything), at its speed. Gives whether it is within `near` of it.
  private fly(bee: Bee, x: number, y: number, near: number): boolean {
    return stepToward(bee, bee.def.halfSize, x, y, bee.def.speed, near, OPEN)
  }

  // Drifts round its spot (`driftX`, `driftY`), `reach` units out, wandering round it.
  private hover(bee: Bee, tick: number, reach: number): void {
    const angle = tick * 0.07 + bee.id * 1.9
    const wobble = reach * (0.6 + 0.4 * Math.sin(tick * 0.031 + bee.id))
    stepToward(bee, bee.def.halfSize, bee.bee.driftX + Math.cos(angle) * wobble, bee.bee.driftY + Math.sin(angle) * wobble, Math.max(1, Math.round(bee.def.speed * 0.4)), 0, OPEN)
  }

  // ---- making them, and putting them away

  private spawn(queen: boolean, at: PlayerPosition, state: Partial<BeeState>): Bee {
    const monster = this.monsters.spawn(monsterDef(queen ? 'queen-bee' : 'bee'), at.x, at.y) as Bee
    monster.bee = {
      queen,
      home: 0,
      joining: false,
      swarm: 0,
      job: 'back',
      flower: 0,
      until: 0,
      gathered: false,
      to: 0,
      left: 0,
      stingAt: 0,
      fromX: at.x,
      fromY: at.y,
      driftX: at.x,
      driftY: at.y,
      ...state,
    }
    this.out.set(monster.id, monster)
    return monster
  }

  // A bee goes back in (or, a queen, moves in): no longer a monster.
  private take(bee: Bee): void {
    this.out.delete(bee.id)
    this.monsters.remove(bee.id)
  }

  // The workers of a hive out of it (not those moving in).
  private workersOf(hive: number): Bee[] {
    return [...this.out.values()].filter((bee) => !bee.bee.queen && bee.bee.home === hive && !bee.bee.joining)
  }

  // ---- saving

  // Every queen without a home, and how many follow her. (A worker out of its hive when the world is saved is still
  // counted in it, and comes back there.)
  toSave(): SwarmSave {
    const saved: SwarmSave = []
    for (const queen of this.out.values()) {
      if (!queen.bee.queen) continue
      const followers = [...this.out.values()].filter((bee) => bee.bee.swarm === queen.id).length
      saved.push([queen.x, queen.y, followers])
    }
    return saved
  }

  loadSave(saved: SwarmSave): void {
    for (const [x, y, followers] of saved) {
      const queen = this.spawn(true, { x, y }, { job: 'seek' })
      for (let n = 0; n < followers; n++) this.spawn(false, { x: x + ((n % 3) - 1) * (SUB / 3), y: y + (Math.floor(n / 3) % 3 - 1) * (SUB / 3) }, { job: 'follow', swarm: queen.id })
    }
  }
}
