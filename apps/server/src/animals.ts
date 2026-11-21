import {
  addItems,
  ANIMALS,
  HUNGER_MAX,
  weaponIn,
  BUILDINGS,
  chunkOfTile,
  chunksAround,
  fenceBoxes,
  fenceMask,
  floorDiv,
  gateBoxes,
  gateIsOpen,
  PLAYER_MASS,
  pushApart,
  isInsideWorld,
  groundBlocks,
  boundsOf,
  dungeonBlocks,
  biomeAt,
  campSites,
  animalDef,
  hashInts,
  getItem,
  itemId,
  ITEMS,
  LEAD_BREAK,
  moveBox,
  overlapsSolid,
  PLAYER_HALF_SIZE,
  PLAYER_REACH,
  PUNCH_COOLDOWN_TICKS,
  pushOut,
  ropePull,
  Rng,
  statIndex,
  SUB,
  takeFromSlot,
  TPS,
  CHUNK_SIZE,
  type AnimalDef,
  type Hunt,
  type AnimalInfo,
  type AnimalPosition,
  type Entity,
  type FactoryWorld,
  type Inventory,
  type IsSolid,
  type ItemId,
  type PlayerPosition,
  type Sex,
  type Terrain,
  type WorldEvent,
  attackClear,
} from '../../../packages/shared/src/index.ts'
import { giveDrops, type CommandContext, type CommandOutcome } from './commands.ts'

// The animals: chickens and deer in the forest, wolves in the mountains, cows (see data/animals.json), and the
// skeletons that keep the mountains' camps (see `tendCamps`) and guard the dungeon (see dungeons.ts), run by the
// server only. They are not part of the factory's
// simulation, so nothing here has to come out the same on every page; pages are sent where the animals are with the
// players' positions and what each one is (AnimalInfo) on the log. Their random numbers come from the room's seed, so
// a test sees the same animals do the same things.
//
// What an animal does, picked again every second or so (see `decide`), most pressing first:
// - (watching all the while, see `watch`) a skittish one (a deer) runs from any player who comes near, and its herd with
//   it; a hostile one (a wolf, a skeleton) goes for a player who comes onto its ground or hurts it, and its pack with
//   it, and bites them until they are knocked out or have got far enough away (see `hunt` in animals.json). A pack that
//   flanks (wolves) spreads out round its prey and darts in from different sides, falling back between bites;
// - just hit: run from whoever hit it, for FLEE_TICKS (and a stunned one stands, and a knocked one slides);
// - led on a rope: a slow, aimless wander, and the rope does the rest (see `pullRopes`);
// - an adult that is well fed and ready: find a well-fed adult of the other sex and breed (a baby is born between them);
// - not well fed and getting hungry (half of `hungryAt`): eat what it likes from a feed box nearby, which leaves it
//   well fed for `wellFedMinutes`. Grass never makes an animal well fed: only a feed box does;
// - hungry (`hungryAt` or more): go to the nearest tuft of grass within `grassRadius` tiles and graze it away;
//   a little hungry (half of that): nibble a tuft only if one is right beside it;
// - away from the others of its kind: go back to them;
// - otherwise: wander a little, or stand.
// The numbers (how fast it gets hungry, and so on) are each kind's `life` in data/animals.json.

// A tuft of grass takes GRAZE_TICKS to eat; one this close (tiles) is nibbled even when the animal is only a little hungry.
const GRAZE_TICKS = 45
const NIBBLE_RADIUS = 3
// An animal that has just been hit runs from whoever hit it for FLEE_TICKS, at FLEE_PACE times its speed.
const FLEE_TICKS = 3 * TPS
const FLEE_DISTANCE = 7
// Knocked back, an animal slides, slowing by KNOCK_SLOWING percent a tick.
const KNOCK_SLOWING = 25
// How far an animal looks, in tiles: for others of its kind, a feed box, and a mate. It stays within HERD_SPREAD of
// the middle of its herd.
const HERD_RADIUS = 10
const HERD_SPREAD = 3
// A hostile animal that has strayed this far (tiles) from where it lives heads back.
const HOME_RANGE = 8
const FEEDER_RADIUS = 10
const MATE_RADIUS = 8
// No more babies where there are this many of the kind within CROWD_RADIUS tiles.
const CROWD_CAP = 16
const CROWD_RADIUS = 12
// A walk that gets nowhere for this many ticks is given up.
const STUCK_TICKS = 30
const FLEE_PACE = 1.8
// How often (ticks) an animal looks round for players, to run from or go for; how far a skittish one runs before it
// looks again (tiles); and how far a bite knocks a player back (units).
const WATCH_EVERY = 4
// A hostile animal that has given up a chase goes home and will not take up another for CALM_TICKS (unless it is hurt),
// and never goes for a player further than its leash, less LEASH_MARGIN tiles, from its home: so it does not give up
// and take up the same chase over and over at the edge of its ground.
const CALM_TICKS = 6 * TPS
const LEASH_MARGIN = 3
// Going home after giving up a chase, a hostile one runs, RETURN_PACE times as fast as it chases.
const RETURN_PACE = 1.5
// Pathfinding: a hunter whose straight way to where it is going is blocked (a wall, a fence, a tree) finds a way round
// over the tiles within PATH_REACH of it, looked for again every PATH_EVERY ticks.
const PATH_REACH = 18
const PATH_EVERY = 12
const SPOOK_DISTANCE = 14
const BITE_KNOCKBACK = SUB / 3
// Flanking: the pack spreads round its prey FLANK_RING tiles out, at least FLANK_SPREAD radians apart (or evenly all
// the way round, for a big pack), and one darts in to bite once it is within FLANK_LUNGE tiles of its place there.
const FLANK_RING = 3.2
const FLANK_SPREAD = 1.25
const FLANK_LUNGE = 1.6

// The skeletons' camps (see campSites in terrain.ts): each keeps CAMP_MIN to CAMP_MAX skeletons round its fire,
// CAMP_POST tiles out. One that is killed comes back CAMP_RESPAWN_TICKS later, once a player is within CAMP_ACTIVE
// tiles of the camp and none is within CAMP_UNSEEN tiles (so they never appear in front of anyone). Looked after every
// CAMP_EVERY ticks.
const CAMP_MIN = 3
const CAMP_MAX = 4
const CAMP_POST = 2
const CAMP_RESPAWN_TICKS = 150 * TPS
const CAMP_ACTIVE = 64
const CAMP_UNSEEN = 14
const CAMP_EVERY = TPS

// Spawning. The first time a chunk is grown, a herd turns up in it this often (percent); and every SPAWN_EVERY ticks,
// a player with fewer than NEAR_CAP animals within NEAR_RADIUS tiles gets a herd somewhere between SPAWN_NEAR and
// SPAWN_FAR tiles away (out of sight, in ground that has been grown). A fifth of a wild herd are babies.
const CHUNK_HERD_CHANCE = 12
const SPAWN_EVERY = 45 * TPS
const NEAR_CAP = 14
const NEAR_RADIUS = 48
const SPAWN_NEAR = 18
const SPAWN_FAR = 30
const WILD_BABIES = 20
// A wild animal (one nobody has led, fed or bred) further than this many tiles from every player is let go, so the world
// does not fill up as players wander. Anyone's own animals stay.
const DESPAWN_RADIUS = 128

type Goal =
  | { k: 'idle' }
  | { k: 'walk'; x: number; y: number; pace: number }
  | { k: 'graze'; grass: number; x: number; y: number; eating: number }
  | { k: 'feed'; feeder: number; x: number; y: number }
  | { k: 'mate'; partner: number }
  | { k: 'hunt' }
  // A hostile one running home after giving up a chase.
  | { k: 'home' }

export type Animal = {
  id: number
  def: AnimalDef
  // Where its middle is, in units.
  x: number
  y: number
  sex: Sex
  // In the order of the kind's stats (see animals.json).
  stats: number[]
  // Ticks since it was born; it is grown up once this reaches its growth stat.
  age: number
  hp: number
  hunger: number
  fedUntil: number
  breedReadyAt: number
  nextLayAt: number
  milk: number
  nextMilkAt: number
  // The player leading it on a rope, or 0.
  leader: number
  // Whether it is still wild: spawned by itself, and never led, fed from a feed box or bred.
  wild: boolean
  goal: Goal
  decideAt: number
  stuck: number
  // Being knocked back (units a tick), stunned until, running from a hit until.
  vx: number
  vy: number
  stunnedUntil: number
  fleeUntil: number
  // Where it lives (units): a hostile one keeps to the ground round it, and gives up a chase too far from it.
  homeX: number
  homeY: number
  // The player a hostile one is after (0 for none), and when it can bite again.
  target: number
  biteReadyAt: number
  // An archer drawing its bow: the tick it looses (0 while it is not), and which way it aims (radians).
  aimUntil: number
  aimAngle: number
  // A skeleton keeping a camp: which camp, and which of its places (see `tendCamps`).
  post?: { camp: number; slot: number }
  // A skeleton guarding a copy of the dungeon: the copy's slot (see dungeons.ts). These are never saved.
  dungeon?: number
  // A hostile one that gave up a chase: until when it will not take up another by itself.
  calmUntil?: number
  // The way round something in its way (tile middles, in units, next first), what it leads to, and when it was found.
  path?: { steps: Array<{ x: number; y: number }>; toX: number; toY: number; at: number }
}

// The animals, saved (see save.ts): each as its kind's key and what it is, and what the herd keeps between ticks. What
// each is doing, sliding or running from is not kept (it starts again standing), nor ropes (players come back as new
// players, so a rope is put back in its leader's things: see GameRoom).
export type AnimalSave = {
  nextId: number
  rng: number
  lastSpawn: number
  animals: Array<{
    id: number
    kind: string
    x: number
    y: number
    sex: Sex
    stats: number[]
    age: number
    hp: number
    hunger: number
    fedUntil: number
    breedReadyAt: number
    nextLayAt: number
    milk: number
    nextMilkAt: number
    wild: boolean
    homeX?: number
    homeY?: number
    post?: [number, number]
  }>
  // For each camp, in the order of campSites, when each of its places gets its skeleton back (0: it has one, or is
  // ready for one).
  camps?: number[][]
}

type Camp = { x: number; y: number; places: Array<{ id: number; respawnAt: number }> }

// What the animals need from the room on a tick.
export type AnimalContext = {
  world: FactoryWorld
  seed: number
  // The land (water, and which biome is where).
  terrain: Terrain
  tick: number
  emit: (event: WorldEvent) => void
  // Drops `count` of an item on the ground round a point.
  drop: (middle: PlayerPosition, salt: number, item: ItemId, count: number) => void
  // The players, whose positions the ropes pull on.
  players: ReadonlyArray<{ id: number; position: PlayerPosition; inventory: Inventory }>
  // Whether a chunk has been grown yet; animals keep to ground that has.
  isGrown: (chunk: number) => boolean
  // What players cannot walk into, for where a rope pulls a player.
  solidForPlayers: IsSolid
  // Hurts a player (bitten), from a point, pushing them `knockback` units away.
  hurtPlayer: (id: number, damage: number, from: PlayerPosition, knockback: number) => void
  // Looses an arrow at the players (it flies through animals): from a point, along `angle`, at `speed` units a tick,
  // for `ttl` ticks.
  shoot?: (item: ItemId, x: number, y: number, angle: number, speed: number, damage: number, ttl: number) => void
}

// How far back an attack can be judged against where the animals were (see `nearAt`): half a second. A page draws
// animals a little in the past (REMOTE_DELAY_TICKS, plus the time their positions take to reach it), and its attack
// takes time to get here, so by the time it runs they have moved on. A page with a slower connection than this is judged
// against where they were this long ago.
export const MAX_REWIND_TICKS = 15

export class Animals {
  readonly all = new Map<number, Animal>()
  // Where every animal was at the end of each of the last MAX_REWIND_TICKS ticks, oldest first.
  private readonly past: Array<{ tick: number; spots: Map<number, { x: number; y: number }> }> = []
  private nextId = 1
  private readonly rng: Rng
  private lastSpawn = 0
  // The tick being run (or last run).
  private tickNow = 0
  // The animals killed on the tick being run, and the damage of the blow that killed each (pages show it, and the
  // animal falling, before its drops).
  private readonly killed = new Map<number, number>()
  // The skeletons' camps, once the terrain is known (see `tendCamps`); and what a save said of them, until then.
  private camps: Camp[] | undefined
  private savedCamps: number[][] | undefined

  // `wild`: whether herds turn up by themselves (see CHUNK_HERD_CHANCE and SPAWN_EVERY).
  constructor(seed: number, private readonly wild = true) {
    this.rng = new Rng((seed ^ 0x5eed_a11) >>> 0)
  }

  // ---- saving them

  toSave(): AnimalSave {
    return {
      nextId: this.nextId,
      rng: this.rng.state,
      lastSpawn: this.lastSpawn,
      ...(this.camps ? { camps: this.camps.map((camp) => camp.places.map((place) => (place.id === 0 ? place.respawnAt : 0))) } : {}),
      animals: this.list().filter((animal) => animal.dungeon === undefined).map((animal) => ({
        id: animal.id,
        kind: animal.def.kind,
        x: animal.x,
        y: animal.y,
        sex: animal.sex,
        stats: [...animal.stats],
        age: animal.age,
        hp: animal.hp,
        hunger: animal.hunger,
        fedUntil: animal.fedUntil,
        breedReadyAt: animal.breedReadyAt,
        nextLayAt: animal.nextLayAt,
        milk: animal.milk,
        nextMilkAt: animal.nextMilkAt,
        wild: animal.wild,
        homeX: animal.homeX,
        homeY: animal.homeY,
        ...(animal.post ? { post: [animal.post.camp, animal.post.slot] as [number, number] } : {}),
      })),
    }
  }

  // Puts saved animals in (in place of any there are). An animal of a kind the game no longer has is left out.
  loadSave(saved: AnimalSave): void {
    this.all.clear()
    this.nextId = saved.nextId
    this.rng.state = saved.rng >>> 0
    this.lastSpawn = saved.lastSpawn
    this.camps = undefined
    this.savedCamps = saved.camps
    for (const animal of saved.animals) {
      const def = ANIMALS.find((candidate) => candidate.kind === animal.kind)
      if (!def) continue
      // Stats the kind has gained since are its base; ones it has lost are dropped.
      const stats = def.stats.map((stat, i) => animal.stats[i] ?? stat.base)
      const { post, ...rest } = animal
      this.all.set(animal.id, {
        ...rest,
        ...(post ? { post: { camp: post[0], slot: post[1] } } : {}),
        def,
        stats,
        homeX: animal.homeX ?? animal.x,
        homeY: animal.homeY ?? animal.y,
        target: 0,
        biteReadyAt: 0,
        aimUntil: 0,
        aimAngle: 0,
        leader: 0,
        goal: { k: 'idle' },
        decideAt: 0,
        stuck: 0,
        vx: 0,
        vy: 0,
        stunnedUntil: 0,
        fleeUntil: 0,
      })
    }
  }

  // ---- reading them

  get(id: number): Animal | undefined {
    return this.all.get(id)
  }

  // Notes where every animal is at the end of `tick` (after they have moved), for attacks judged against the past.
  remember(tick: number): void {
    const spots = new Map<number, { x: number; y: number }>()
    for (const animal of this.all.values()) spots.set(animal.id, { x: animal.x, y: animal.y })
    this.past.push({ tick, spots })
    while (this.past.length > MAX_REWIND_TICKS) this.past.shift()
  }

  // The animals near a point as they were at the end of tick `seen` (where a page drew them), each with where it was
  // then; or as they are now, without `seen` or when that is further back than is remembered. One born since is where
  // it is now.
  nearAt(point: PlayerPosition, reach: number, seen?: number): Array<{ animal: Animal; x: number; y: number }> {
    const then = seen === undefined ? undefined : this.past.find((entry) => entry.tick === seen) ?? (seen < (this.past[0]?.tick ?? 0) ? this.past[0] : undefined)
    const found: Array<{ animal: Animal; x: number; y: number }> = []
    for (const animal of this.list()) {
      const spot = then?.spots.get(animal.id) ?? animal
      if (Math.hypot(spot.x - point.x, spot.y - point.y) <= reach + animal.def.halfSize) found.push({ animal, x: spot.x, y: spot.y })
    }
    return found
  }

  // In ID order, which is the order everything here goes through them in.
  list(): Animal[] {
    return [...this.all.values()].sort((a, b) => a.id - b.id)
  }

  inChunks(chunks: ReadonlySet<number>): Animal[] {
    return this.list().filter((animal) => chunks.has(chunkOfTile(floorDiv(animal.x, SUB), floorDiv(animal.y, SUB))))
  }

  info(animal: Animal): AnimalInfo {
    return {
      id: animal.id,
      kind: animal.def.kind,
      sex: animal.sex,
      stats: animal.stats,
      growth: Math.min(100, Math.floor((animal.age * 100) / growTicks(animal))),
      hp: animal.hp,
      hunger: Math.floor((animal.hunger * 100) / HUNGER_MAX),
      fed: animal.fedUntil > this.tickNow,
      leader: animal.leader,
      milk: animal.milk,
      doing: this.doing(animal),
      ...(animal.target !== 0 ? { angry: true } : {}),
      ...(animal.aimUntil !== 0 ? { aim: Math.round(animal.aimAngle * 100) / 100 } : {}),
    }
  }

  // What it is doing, in a few words.
  private doing(animal: Animal): string {
    if (animal.stunnedUntil > this.tickNow) return 'stunned'
    if (animal.fleeUntil > this.tickNow) return 'running away'
    if (animal.target !== 0) return 'hunting'
    if (animal.leader !== 0) return 'being led'
    switch (animal.goal.k) {
      case 'idle':
        return 'standing'
      case 'walk':
        return 'walking'
      case 'graze':
        return animal.goal.eating > 0 ? 'grazing' : 'going to grass'
      case 'feed':
        return 'going to the feed box'
      case 'mate':
        return 'going to its mate'
      case 'hunt':
        return 'hunting'
      case 'home':
        return 'going home'
    }
  }

  position(animal: Animal): AnimalPosition {
    return [animal.id, animal.x, animal.y]
  }

  // ---- making them

  // A new animal. Without `stats`, it is a wild one: each stat its base, give or take its spread.
  spawn(def: AnimalDef, x: number, y: number, options: { sex?: Sex; stats?: number[]; baby?: boolean } = {}): Animal {
    const stats = options.stats ?? def.stats.map((stat) => roundStat(clamp(stat.base + (this.random() * 2 - 1) * stat.spread, stat.min, stat.max)))
    const animal: Animal = {
      id: this.nextId++,
      def,
      x,
      y,
      sex: options.sex ?? (this.rng.nextInt(2) === 0 ? 'f' : 'm'),
      stats,
      age: 0,
      hp: def.hp,
      hunger: this.rng.nextInt(400),
      fedUntil: 0,
      breedReadyAt: 0,
      nextLayAt: 0,
      milk: 0,
      nextMilkAt: 0,
      leader: 0,
      wild: options.stats === undefined,
      goal: { k: 'idle' },
      decideAt: 0,
      stuck: 0,
      vx: 0,
      vy: 0,
      stunnedUntil: 0,
      fleeUntil: 0,
      homeX: x,
      homeY: y,
      target: 0,
      biteReadyAt: 0,
      aimUntil: 0,
      aimAngle: 0,
    }
    if (!options.baby) animal.age = growTicks(animal)
    this.all.set(animal.id, animal)
    return animal
  }

  // A herd of a kind round a point (units), on tiles it can stand on. Gives how many there are.
  spawnHerd(context: AnimalContext, def: AnimalDef, x: number, y: number): number {
    const count = def.herd[0] + this.rng.nextInt(def.herd[1] - def.herd[0] + 1)
    let made = 0
    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const px = x + Math.round((this.random() * 2 - 1) * 2 * SUB)
        const py = y + Math.round((this.random() * 2 - 1) * 2 * SUB)
        const animal = { x: px, y: py, def, leader: 0 } as Animal
        if (overlapsSolid({ x: px, y: py }, this.blockedFor(animal, context), def.halfSize)) continue
        // The first two are one of each, so a herd can breed.
        const sex: Sex | undefined = n === 0 ? 'f' : n === 1 ? 'm' : undefined
        const baby = n >= 2 && this.rng.nextInt(100) < WILD_BABIES
        const spawned = this.spawn(def, px, py, { ...(sex ? { sex } : {}), baby })
        if (baby) spawned.age = this.rng.nextInt(growTicks(spawned))
        made++
        break
      }
    }
    return made
  }

  // The first time a chunk is grown, now and then a herd turns up in it, of a kind that lives in the biome there.
  chunkGrown(context: AnimalContext, chunk: { cx: number; cy: number }): void {
    if (!this.wild || this.rng.nextInt(100) >= CHUNK_HERD_CHANCE) return
    const x = (chunk.cx * CHUNK_SIZE + 4 + this.rng.nextInt(CHUNK_SIZE - 8)) * SUB + SUB / 2
    const y = (chunk.cy * CHUNK_SIZE + 4 + this.rng.nextInt(CHUNK_SIZE - 8)) * SUB + SUB / 2
    const def = this.pickKind(context, x, y)
    if (def) this.spawnHerd(context, def, x, y)
  }

  // ---- each tick

  step(context: AnimalContext): void {
    const { tick } = context
    this.tickNow = tick
    for (const animal of this.list()) {
      animal.age++
      if (tick % animal.def.life.hungerEvery === 0) animal.hunger = Math.min(HUNGER_MAX, animal.hunger + 1)
      this.produce(context, animal)
      this.slide(context, animal)
      if (animal.stunnedUntil > tick) continue
      if ((tick + animal.id) % WATCH_EVERY === 0) this.watch(context, animal)
      if (tick >= animal.decideAt) this.decide(context, animal)
      this.act(context, animal)
    }
    this.pullRopes(context)
    this.pushApart(context)
    // A boss stands where it was put, whatever pushes it.
    for (const animal of this.all.values()) {
      if (!animal.def.boss) continue
      animal.x = animal.homeX
      animal.y = animal.homeY
      animal.vx = 0
      animal.vy = 0
    }
    if (tick % CAMP_EVERY === 0) this.tendCamps(context)
    if (this.wild && tick - this.lastSpawn >= SPAWN_EVERY) {
      this.lastSpawn = tick
      this.despawnFarAway(context)
      this.spawnNearPlayers(context)
    }
  }

  // Eggs and milk.
  private produce(context: AnimalContext, animal: Animal): void {
    if (!isAdult(animal) || animal.sex !== 'f') return
    const { def } = animal
    if (def.lays !== undefined) {
      const every = Math.round(stat(animal, 'eggTime') * TPS)
      if (animal.nextLayAt === 0) animal.nextLayAt = context.tick + every
      else if (context.tick >= animal.nextLayAt) {
        animal.nextLayAt = context.tick + every
        context.drop(animal, animal.id, def.lays, 1)
      }
    }
    if (def.milk !== undefined && animal.milk < Math.round(stat(animal, 'milk')) && context.tick >= animal.nextMilkAt) {
      if (animal.nextMilkAt !== 0) animal.milk++
      animal.nextMilkAt = context.tick + def.life.milkEvery
    }
  }

  // Being knocked back: it slides, slowing, kept out of what it cannot walk into.
  private slide(context: AnimalContext, animal: Animal): void {
    if (animal.vx === 0 && animal.vy === 0) return
    Object.assign(animal, moveBox(animal, animal.vx, animal.vy, animal.def.halfSize, this.blockedFor(animal, context)))
    animal.vx = Math.trunc((animal.vx * (100 - KNOCK_SLOWING)) / 100)
    animal.vy = Math.trunc((animal.vy * (100 - KNOCK_SLOWING)) / 100)
  }

  private decide(context: AnimalContext, animal: Animal): void {
    const { tick } = context
    animal.decideAt = tick + 20 + this.rng.nextInt(30)
    // Running from a hit, hunting, or busy with something that is still going: carry on.
    if (animal.fleeUntil > tick || animal.target !== 0) return
    if (animal.goal.k === 'graze' || animal.goal.k === 'feed' || animal.goal.k === 'mate' || animal.goal.k === 'hunt' || animal.goal.k === 'home') return
    if (animal.leader !== 0) {
      animal.goal = this.wanderGoal(animal, 1.5, 0.35)
      return
    }
    const fed = animal.fedUntil > tick
    if (isAdult(animal) && fed && tick >= animal.breedReadyAt && this.crowd(animal) < CROWD_CAP) {
      const partner = this.nearest(animal, MATE_RADIUS, (other) => this.canMate(animal, other, tick))
      if (partner) {
        animal.goal = { k: 'mate', partner: partner.id }
        return
      }
    }
    const { life } = animal.def
    // Hungry, it goes for whichever is nearer, grass it can see or a feed box with something it eats; a little hungry,
    // it nibbles grass right beside it, or goes to a feed box.
    const lookFor = !animal.def.grazes ? 0 : animal.hunger >= life.hungryAt ? life.grassRadius : animal.hunger >= life.hungryAt / 2 ? NIBBLE_RADIUS : 0
    const feeder = !fed && animal.hunger >= life.hungryAt / 2 ? this.nearestFeeder(context, animal) : undefined
    const grass = lookFor > 0 ? this.nearestGrass(context, animal, lookFor) : undefined
    const away = (entity: Entity): number => Math.hypot(entity.x * SUB + SUB / 2 - animal.x, entity.y * SUB + SUB / 2 - animal.y)
    if (feeder && (!grass || away(feeder) <= away(grass))) {
      animal.goal = { k: 'feed', feeder: feeder.id, x: feeder.x * SUB + SUB / 2, y: feeder.y * SUB + SUB / 2 }
      return
    }
    if (grass) {
      animal.goal = { k: 'graze', grass: grass.id, x: grass.x * SUB + SUB / 2, y: grass.y * SUB + SUB / 2, eating: 0 }
      return
    }
    const herd = this.herdMiddle(animal)
    if (herd && Math.hypot(herd.x - animal.x, herd.y - animal.y) > HERD_SPREAD * SUB) {
      const spread = 1.5 * SUB
      animal.goal = {
        k: 'walk',
        x: herd.x + Math.round((this.random() * 2 - 1) * spread),
        y: herd.y + Math.round((this.random() * 2 - 1) * spread),
        pace: 0.8,
      }
      return
    }
    // A hostile one keeps to its ground: strayed from it, it heads back.
    if (animal.def.hunt && Math.hypot(animal.homeX - animal.x, animal.homeY - animal.y) > HOME_RANGE * SUB) {
      animal.goal = { k: 'walk', x: animal.homeX, y: animal.homeY, pace: 0.8 }
      return
    }
    animal.goal = this.rng.nextInt(100) < 40 ? this.wanderGoal(animal, 3, 0.45) : { k: 'idle' }
  }

  // ---- watching for players

  // A skittish animal runs from a player who comes near, and its herd with it; a hostile one goes for a player who
  // comes onto its ground, and keeps after them (see `act`) until they are gone or far enough from its home.
  private watch(context: AnimalContext, animal: Animal): void {
    const { def } = animal
    // A skittish one runs even on a rope (and drags whoever holds it); anything else on a rope just follows.
    if (animal.leader !== 0 && def.temper !== 'skittish') return
    if (def.temper === 'skittish' && def.fleeRadius > 0) {
      const threat = this.nearestPlayer(context, animal, def.fleeRadius)
      // Already running, with a while to go: it keeps on the way it is going.
      if (!threat || animal.fleeUntil > context.tick + FLEE_TICKS / 2) return
      this.spookHerd(animal, threat.position, context.tick)
      return
    }
    const hunt = def.hunt
    if (!hunt) return
    if (animal.target !== 0) {
      const target = context.players.find((player) => player.id === animal.target)
      // Gone, or got far enough from its ground: it gives up, and goes home.
      if (!target || Math.hypot(target.position.x - animal.homeX, target.position.y - animal.homeY) > hunt.leash) {
        animal.target = 0
        animal.goal = { k: 'home' }
        animal.decideAt = context.tick + 3 * TPS
        animal.calmUntil = context.tick + CALM_TICKS
      }
      return
    }
    if (context.tick < (animal.calmUntil ?? 0)) return
    // A player it can see, close by, on its ground (well within its leash, so it would not give up at once).
    const intruder = this.nearestPlayer(
      context,
      animal,
      hunt.aggroRadius,
      (player) =>
        Math.hypot(player.position.x - animal.homeX, player.position.y - animal.homeY) <= hunt.leash - LEASH_MARGIN * SUB &&
        this.canSee(animal, player.position),
    )
    if (!intruder) return
    // A pack animal (a wolf) calls its pack at once; a lone hunter (a skeleton) goes alone, and only calls the others
    // once it is hurt.
    if (hunt.packOnSight) this.rouse(animal, intruder.id, context.tick)
    else this.hunt(animal, intruder.id, context.tick)
  }

  // Whether nothing (a dungeon's walls) stands between an animal and a point.
  private canSee(animal: Animal, point: PlayerPosition): boolean {
    const distance = Math.hypot(point.x - animal.x, point.y - animal.y)
    const steps = Math.ceil(distance / (SUB / 2))
    for (let i = 1; i < steps; i++) {
      const x = animal.x + ((point.x - animal.x) * i) / steps
      const y = animal.y + ((point.y - animal.y) * i) / steps
      if (dungeonBlocks(floorDiv(Math.round(x), SUB), floorDiv(Math.round(y), SUB))) return false
    }
    return true
  }

  // A hostile animal goes for a player, by itself.
  private hunt(animal: Animal, playerId: number, tick: number): void {
    animal.target = playerId
    animal.goal = { k: 'hunt' }
    animal.fleeUntil = 0
    animal.calmUntil = 0
    animal.decideAt = tick + TPS
  }

  // Sets an animal running from a point (a little to one side or the other), and the rest of its herd near it.
  private spookHerd(animal: Animal, from: PlayerPosition, tick: number): void {
    this.spook(animal, from, tick)
    for (const other of this.all.values()) {
      if (other === animal || other.def !== animal.def || other.leader !== 0 || other.fleeUntil > tick) continue
      if (Math.hypot(other.x - animal.x, other.y - animal.y) <= HERD_RADIUS * SUB) this.spook(other, from, tick)
    }
  }

  private spook(animal: Animal, from: PlayerPosition, tick: number): void {
    const away = Math.atan2(animal.y - from.y, animal.x - from.x) + (this.random() - 0.5) * 1.2
    animal.fleeUntil = Math.max(animal.fleeUntil, tick + FLEE_TICKS)
    animal.goal = {
      k: 'walk',
      x: animal.x + Math.round(Math.cos(away) * SPOOK_DISTANCE * SUB),
      y: animal.y + Math.round(Math.sin(away) * SPOOK_DISTANCE * SUB),
      pace: animal.def.fleePace,
    }
    animal.decideAt = animal.fleeUntil
  }

  // A hostile animal goes for a player, and so does its pack: every one of its kind within `packRadius` of it (or of
  // one of the others roused) that is not after someone already.
  private rouse(animal: Animal, playerId: number, tick: number): void {
    const hunt = animal.def.hunt
    if (!hunt) return
    const pack = [animal]
    for (let i = 0; i < pack.length; i++) {
      const caller = pack[i]
      this.hunt(caller, playerId, tick)
      for (const other of this.all.values()) {
        if (pack.includes(other) || other.def !== animal.def || other.target !== 0 || other.leader !== 0) continue
        if (Math.hypot(other.x - caller.x, other.y - caller.y) <= hunt.packRadius) pack.push(other)
      }
    }
  }

  private nearestPlayer(
    context: AnimalContext,
    animal: Animal,
    radius: number,
    accept: (player: AnimalContext['players'][number]) => boolean = () => true,
  ): AnimalContext['players'][number] | undefined {
    let best: AnimalContext['players'][number] | undefined
    let bestDistance = radius
    for (const player of context.players) {
      const distance = Math.hypot(player.position.x - animal.x, player.position.y - animal.y)
      if (distance <= bestDistance && accept(player)) {
        best = player
        bestDistance = distance
      }
    }
    return best
  }

  private act(context: AnimalContext, animal: Animal): void {
    const goal = animal.goal
    switch (goal.k) {
      case 'idle':
        return
      case 'walk':
        if (this.moveToward(context, animal, goal.x, goal.y, goal.pace, 0.15 * SUB)) animal.goal = { k: 'idle' }
        return
      case 'graze': {
        const grass = context.world.entity(goal.grass)
        if (!grass || grass.kind !== 'grass') {
          this.giveUp(animal)
          return
        }
        if (!this.moveToward(context, animal, goal.x, goal.y, 1, 0.35 * SUB)) return
        goal.eating++
        if (goal.eating < GRAZE_TICKS) return
        context.emit({ t: 'remove', id: grass.id })
        animal.hunger = Math.max(0, animal.hunger - animal.def.life.grassFills)
        this.giveUp(animal)
        return
      }
      case 'feed': {
        const feeder = context.world.entity(goal.feeder)
        const food = feeder?.kind === 'feeder' ? feeder.inv.slots.find((slot) => slot.count > 0 && animal.def.foods.has(slot.item)) : undefined
        if (!feeder || !food) {
          this.giveUp(animal)
          return
        }
        // A feed box is solid, so it is eaten from beside it.
        if (!this.moveToward(context, animal, goal.x, goal.y, 1, 0.6 * SUB + animal.def.halfSize)) return
        context.emit({ t: 'inv', id: feeder.id, item: food.item, delta: -1 })
        animal.wild = false
        animal.fedUntil = context.tick + animal.def.life.wellFed
        animal.hunger = 0
        this.giveUp(animal)
        return
      }
      case 'hunt': {
        const hunt = animal.def.hunt
        const target = context.players.find((player) => player.id === animal.target)
        if (!hunt || !target) {
          animal.target = 0
          this.giveUp(animal)
          return
        }
        // Chase, and bite when close enough. A chase is not given up for being stuck (only by `watch`). A flanker goes
        // to its place round the prey first, and darts in from there when it can bite, falling back to it after.
        animal.stuck = 0
        // A boss never moves from its place: what it does is cast (see dungeons.ts).
        if (animal.def.boss) return
        if (hunt.shoot) return this.archer(context, animal, hunt, hunt.shoot, target.position)
        // Flanking only in the open: with something in the way, it finds its way to the prey first.
        if (hunt.flank && this.straightClear(animal, target.position.x, target.position.y, this.blockedFor(animal, context))) {
          const place = this.flankPlace(animal, target.position)
          const fromPlace = Math.hypot(place.x - animal.x, place.y - animal.y)
          const ready = context.tick >= animal.biteReadyAt
          const close = Math.hypot(target.position.x - animal.x, target.position.y - animal.y) <= (FLANK_RING + FLANK_LUNGE) * SUB
          if (!ready || (fromPlace > FLANK_LUNGE * SUB && !close)) {
            this.pursue(context, animal, place.x, place.y, hunt.pace, 0.25 * SUB)
            animal.stuck = 0
            return
          }
        }
        // A caster keeps its distance: backing off when the prey comes close, coming on when it is far.
        if (hunt.keepAway > 0) {
          const dx = animal.x - target.position.x
          const dy = animal.y - target.position.y
          const away = Math.hypot(dx, dy) || 1
          if (away < hunt.keepAway) {
            this.pursue(context, animal, target.position.x + (dx / away) * hunt.keepAway * 1.3, target.position.y + (dy / away) * hunt.keepAway * 1.3, hunt.pace, 0.3 * SUB)
          } else if (away > hunt.keepAway * 1.7) this.pursue(context, animal, target.position.x, target.position.y, hunt.pace, hunt.keepAway)
          animal.stuck = 0
          return
        }
        // It bites from up close: its own size, the player's, and its reach between them.
        const biteRange = animal.def.halfSize + PLAYER_HALF_SIZE + hunt.reach
        if (!this.pursue(context, animal, target.position.x, target.position.y, hunt.pace, biteRange)) return
        animal.stuck = 0
        if (context.tick < animal.biteReadyAt) return
        animal.biteReadyAt = context.tick + hunt.cooldown
        context.hurtPlayer(target.id, hunt.damage, { x: animal.x, y: animal.y }, BITE_KNOCKBACK)
        return
      }
      case 'home': {
        // Back home fast, round anything in the way.
        const pace = (animal.def.hunt?.pace ?? 1) * RETURN_PACE
        if (this.pursue(context, animal, animal.homeX, animal.homeY, pace, 0.6 * SUB)) this.giveUp(animal)
        animal.stuck = 0
        return
      }
      case 'mate': {
        const partner = this.all.get(goal.partner)
        if (!partner || !this.canMate(animal, partner, context.tick)) {
          this.giveUp(animal)
          return
        }
        if (!this.moveToward(context, animal, partner.x, partner.y, 1, 0.9 * SUB)) return
        this.breed(animal, partner, context.tick)
        return
      }
    }
  }

  // An archer after its prey: into range where it has a clear shot, then it stands and aims (turning to follow) for
  // `aim` ticks, and looses. Prey that gets out of range or out of sight while it aims makes it give the shot up.
  private archer(context: AnimalContext, animal: Animal, hunt: Hunt, shoot: NonNullable<Hunt['shoot']>, prey: PlayerPosition): void {
    animal.stuck = 0
    const distance = Math.hypot(prey.x - animal.x, prey.y - animal.y)
    const clear = distance <= shoot.range && attackClear(context.world, animal, prey) && this.canSee(animal, prey)
    if (animal.aimUntil !== 0) {
      if (!clear && distance > shoot.range * 1.25) {
        animal.aimUntil = 0
        return
      }
      animal.aimAngle = Math.atan2(prey.y - animal.y, prey.x - animal.x)
      if (context.tick < animal.aimUntil) return
      animal.aimUntil = 0
      animal.biteReadyAt = context.tick + hunt.cooldown
      const flight = Math.ceil((shoot.range * 1.5) / shoot.speed)
      context.shoot?.(shoot.item, animal.x, animal.y, animal.aimAngle, shoot.speed, shoot.damage, flight)
      return
    }
    if (clear) {
      // In range with a clear shot: it stands, and aims once it is ready to.
      if (context.tick >= animal.biteReadyAt) {
        animal.aimUntil = context.tick + shoot.aim
        animal.aimAngle = Math.atan2(prey.y - animal.y, prey.x - animal.x)
      }
      return
    }
    this.pursue(context, animal, prey.x, prey.y, hunt.pace, Math.round(shoot.range * 0.7))
  }

  // Where a flanker keeps round its prey: its pack (every one of its kind after the same player) spread round the prey
  // in the order they stand round it, centred on the side they came from, FLANK_RING tiles out.
  private flankPlace(animal: Animal, prey: PlayerPosition): PlayerPosition {
    const pack = this.list().filter((other) => other.def === animal.def && other.target === animal.target)
    const angleOf = (other: Animal): number => Math.atan2(other.y - prey.y, other.x - prey.x)
    let sx = 0
    let sy = 0
    for (const other of pack) {
      const angle = angleOf(other)
      sx += Math.cos(angle)
      sy += Math.sin(angle)
    }
    const middle = sx === 0 && sy === 0 ? angleOf(animal) : Math.atan2(sy, sx)
    const offset = (other: Animal): number => {
      const d = angleOf(other) - middle
      return Math.atan2(Math.sin(d), Math.cos(d))
    }
    pack.sort((a, b) => offset(a) - offset(b) || a.id - b.id)
    const n = pack.length
    const step = Math.min(FLANK_SPREAD, (Math.PI * 2) / n)
    const angle = middle + (pack.indexOf(animal) - (n - 1) / 2) * step
    return { x: Math.round(prey.x + Math.cos(angle) * FLANK_RING * SUB), y: Math.round(prey.y + Math.sin(angle) * FLANK_RING * SUB) }
  }

  // Goes towards a point like `moveToward`, but round what is in the way: straight there while nothing blocks the way,
  // and otherwise along a path over the tiles near it (found again every PATH_EVERY ticks, or when the point moves to
  // another tile). Gives whether it is within `near` of the point.
  private pursue(context: AnimalContext, animal: Animal, x: number, y: number, pace: number, near: number): boolean {
    const blocked = this.blockedFor(animal, context)
    if (this.straightClear(animal, x, y, blocked)) {
      animal.path = undefined
      return this.moveToward(context, animal, x, y, pace, near)
    }
    const toX = floorDiv(x, SUB)
    const toY = floorDiv(y, SUB)
    const path = animal.path
    if (!path || path.toX !== toX || path.toY !== toY || context.tick - path.at >= PATH_EVERY) {
      animal.path = { steps: this.findPath(animal, toX, toY, blocked), toX, toY, at: context.tick }
    }
    const steps = animal.path!.steps
    while (steps.length > 0 && Math.hypot(steps[0].x - animal.x, steps[0].y - animal.y) < 0.3 * SUB) steps.shift()
    // No way round found: straight at it after all.
    if (steps.length === 0) return this.moveToward(context, animal, x, y, pace, near)
    this.moveToward(context, animal, steps[0].x, steps[0].y, pace, 0)
    return Math.hypot(x - animal.x, y - animal.y) <= near
  }

  // Whether nothing it cannot walk into lies on the straight way from an animal to a point (looked at every half tile).
  private straightClear(animal: Animal, x: number, y: number, blocked: IsSolid): boolean {
    const steps = Math.ceil(Math.hypot(x - animal.x, y - animal.y) / (SUB / 2))
    for (let i = 1; i <= steps; i++) {
      const tileX = floorDiv(Math.round(animal.x + ((x - animal.x) * i) / steps), SUB)
      const tileY = floorDiv(Math.round(animal.y + ((y - animal.y) * i) / steps), SUB)
      if (blocked(tileX, tileY) !== false) return false
    }
    return true
  }

  // The tiles to walk through (their middles, next first) to reach a tile from where an animal stands, not cutting
  // corners, over the tiles within PATH_REACH of it; none if there is no way within that.
  private findPath(animal: Animal, toX: number, toY: number, blocked: IsSolid): Array<{ x: number; y: number }> {
    const fromX = floorDiv(animal.x, SUB)
    const fromY = floorDiv(animal.y, SUB)
    if (Math.abs(toX - fromX) > PATH_REACH || Math.abs(toY - fromY) > PATH_REACH) return []
    const span = PATH_REACH * 2 + 1
    const key = (x: number, y: number): number => (y - fromY + PATH_REACH) * span + (x - fromX + PATH_REACH)
    const inside = (x: number, y: number): boolean => Math.abs(x - fromX) <= PATH_REACH && Math.abs(y - fromY) <= PATH_REACH
    const open = (x: number, y: number): boolean => inside(x, y) && blocked(x, y) === false
    const came = new Map<number, number>([[key(fromX, fromY), -1]])
    const queue: Array<[number, number]> = [[fromX, fromY]]
    let found = false
    for (let i = 0; i < queue.length && !found; i++) {
      const [x, y] = queue[i]
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (came.has(key(nx, ny))) continue
        const target = nx === toX && ny === toY
        if (!target && !open(nx, ny)) continue
        // Diagonally only past two open tiles, so it never cuts a corner.
        if (dx !== 0 && dy !== 0 && (!open(x + dx, y) || !open(x, y + dy))) continue
        came.set(key(nx, ny), key(x, y))
        if (target) {
          found = true
          break
        }
        queue.push([nx, ny])
      }
    }
    if (!found) return []
    const steps: Array<{ x: number; y: number }> = []
    for (let at = key(toX, toY); at !== key(fromX, fromY); at = came.get(at)!) {
      const x = (at % span) - PATH_REACH + fromX
      const y = Math.floor(at / span) - PATH_REACH + fromY
      steps.unshift({ x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 })
    }
    return steps
  }

  private giveUp(animal: Animal): void {
    animal.goal = { k: 'idle' }
    animal.decideAt = Math.min(animal.decideAt, this.tickNow + 10)
  }

  // Walks towards a point at `pace` times the animal's speed. Gives whether it is within `near` of it. A walk that
  // gets nowhere for STUCK_TICKS is given up.
  private moveToward(context: AnimalContext, animal: Animal, x: number, y: number, pace: number, near: number): boolean {
    const dx = x - animal.x
    const dy = y - animal.y
    const distance = Math.hypot(dx, dy)
    if (distance <= near) {
      animal.stuck = 0
      return true
    }
    const speed = Math.max(1, Math.round(animal.def.speed * pace * (isAdult(animal) ? 1 : 0.8)))
    const step = Math.min(speed, distance)
    const blocked = this.blockedFor(animal, context)
    const from = pushOut(animal, blocked, animal.def.halfSize)
    const to = moveBox(from, Math.round((dx / distance) * step), Math.round((dy / distance) * step), animal.def.halfSize, blocked)
    if (to.x === animal.x && to.y === animal.y) {
      animal.stuck++
      if (animal.stuck >= STUCK_TICKS) {
        animal.stuck = 0
        this.giveUp(animal)
      }
    } else animal.stuck = 0
    animal.x = to.x
    animal.y = to.y
    return false
  }

  // What an animal cannot walk into: anything that blocks animals (a fence's post and rails; a gate's rail, and, open,
  // the gate itself unless it is being led through on a rope or is going for food), and ground that has not been grown
  // yet. So animals do not wander out through a gate left open.
  blockedFor(animal: Pick<Animal, 'leader'> & { goal?: Animal['goal'] }, context: AnimalContext): IsSolid {
    const throughGates =
      animal.leader !== 0 || animal.goal?.k === 'graze' || animal.goal?.k === 'feed' || animal.goal?.k === 'hunt' || animal.goal?.k === 'home'
    const kindAt = (x: number, y: number): Entity['kind'] | undefined => context.world.entityAt(x, y)?.kind
    const players = context.players.map((player) => player.position)
    return (x, y) => {
      if (!isInsideWorld(x, y) || !context.isGrown(chunkOfTile(x, y)) || groundBlocks(context.terrain, x, y)) return true
      const entity = context.world.entityAt(x, y)
      if (!entity || !BUILDINGS[entity.kind].blocksAnimals) return false
      if (entity.kind === 'fence') return fenceBoxes(fenceMask(kindAt, x, y))
      if (entity.kind === 'gate') return gateIsOpen(entity, players) ? !throughGates : gateBoxes(fenceMask(kindAt, x, y))
      // A solid building stands in the way with its own shape (a barrel's round, a tree's trunk).
      return boundsOf(entity.kind) ?? true
    }
  }

  // Animals on top of each other, or of a player, are pushed apart (see `pushApart`), each kept out of what it cannot
  // walk into.
  private pushApart(context: AnimalContext): void {
    const animals = this.list()
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i]
      for (let j = i + 1; j < animals.length; j++) {
        const b = animals[j]
        const push = pushApart(a, a.def.halfSize, a.def.mass, b, b.def.halfSize, b.def.mass)
        if (!push) continue
        Object.assign(a, moveBox(a, push.a.x, push.a.y, a.def.halfSize, this.blockedFor(a, context)))
        Object.assign(b, moveBox(b, push.b.x, push.b.y, b.def.halfSize, this.blockedFor(b, context)))
      }
      for (const player of context.players) {
        const push = pushApart(a, a.def.halfSize, a.def.mass, player.position, PLAYER_HALF_SIZE, PLAYER_MASS)
        if (!push) continue
        Object.assign(a, moveBox(a, push.a.x, push.a.y, a.def.halfSize, this.blockedFor(a, context)))
        player.position = moveBox(player.position, push.b.x, push.b.y, PLAYER_HALF_SIZE, context.solidForPlayers)
      }
    }
  }

  private breed(a: Animal, b: Animal, tick: number): void {
    const def = a.def
    const stats = def.stats.map((statDef, i) => {
      const middle = (a.stats[i] + b.stats[i]) / 2
      return roundStat(clamp(middle + (this.random() * 2 - 1) * statDef.spread * 0.3, statDef.min, statDef.max))
    })
    const baby = this.spawn(def, Math.round((a.x + b.x) / 2), Math.round((a.y + b.y) / 2), { stats, baby: true })
    baby.hunger = 0
    for (const parent of [a, b]) {
      parent.fedUntil = tick
      parent.breedReadyAt = tick + def.life.breedCooldown
      parent.goal = { k: 'idle' }
    }
  }

  private canMate(animal: Animal, other: Animal, tick: number): boolean {
    return (
      other !== animal &&
      other.def === animal.def &&
      other.sex !== animal.sex &&
      isAdult(other) &&
      other.fedUntil > tick &&
      tick >= other.breedReadyAt &&
      other.leader === 0
    )
  }

  private crowd(animal: Animal): number {
    let count = 0
    for (const other of this.all.values()) {
      if (other.def === animal.def && Math.hypot(other.x - animal.x, other.y - animal.y) <= CROWD_RADIUS * SUB) count++
    }
    return count
  }

  private nearest(animal: Animal, radius: number, accept: (other: Animal) => boolean): Animal | undefined {
    let best: Animal | undefined
    let bestDistance = radius * SUB
    for (const other of this.list()) {
      if (!accept(other)) continue
      const distance = Math.hypot(other.x - animal.x, other.y - animal.y)
      if (distance <= bestDistance) {
        best = other
        bestDistance = distance
      }
    }
    return best
  }

  // The middle of the others of its kind within HERD_RADIUS, if there are any.
  private herdMiddle(animal: Animal): PlayerPosition | undefined {
    let x = 0
    let y = 0
    let count = 0
    for (const other of this.all.values()) {
      if (other === animal || other.def !== animal.def) continue
      if (Math.hypot(other.x - animal.x, other.y - animal.y) > HERD_RADIUS * SUB) continue
      x += other.x
      y += other.y
      count++
    }
    return count === 0 ? undefined : { x: Math.round(x / count), y: Math.round(y / count) }
  }

  private wanderGoal(animal: Animal, tiles: number, pace: number): Goal {
    return {
      k: 'walk',
      x: animal.x + Math.round((this.random() * 2 - 1) * tiles * SUB),
      y: animal.y + Math.round((this.random() * 2 - 1) * tiles * SUB),
      pace,
    }
  }

  // The nearest of the buildings within `radius` tiles that `accept` takes.
  private nearestEntity(context: AnimalContext, animal: Animal, radius: number, accept: (entity: Entity) => boolean): Entity | undefined {
    const tileX = floorDiv(animal.x, SUB)
    const tileY = floorDiv(animal.y, SUB)
    let best: Entity | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const chunk of chunksAround(chunkOfTile(tileX, tileY), 1)) {
      for (const entity of context.world.chunk(chunk)?.entities ?? []) {
        const distance = Math.hypot(entity.x - tileX, entity.y - tileY)
        if (distance > radius || distance >= bestDistance || !accept(entity)) continue
        best = entity
        bestDistance = distance
      }
    }
    return best
  }

  private nearestGrass(context: AnimalContext, animal: Animal, radius: number): Entity | undefined {
    // A tuft another animal is already making for is left to it.
    const taken = new Set<number>()
    for (const other of this.all.values()) if (other.goal.k === 'graze') taken.add(other.goal.grass)
    return this.nearestEntity(context, animal, radius, (entity) => entity.kind === 'grass' && !taken.has(entity.id))
  }

  private nearestFeeder(context: AnimalContext, animal: Animal): Entity | undefined {
    return this.nearestEntity(
      context,
      animal,
      FEEDER_RADIUS,
      (entity) => entity.kind === 'feeder' && entity.inv.slots.some((slot) => slot.count > 0 && animal.def.foods.has(slot.item)),
    )
  }

  // ---- ropes

  // A rope stretched past LEAD_LENGTH pulls its player and its animal together; one stretched past LEAD_BREAK snaps,
  // and the rope falls to the ground.
  private pullRopes(context: AnimalContext): void {
    for (const animal of this.list()) {
      if (animal.leader === 0) continue
      const player = context.players.find((candidate) => candidate.id === animal.leader)
      if (!player || Math.hypot(player.position.x - animal.x, player.position.y - animal.y) > LEAD_BREAK) {
        animal.leader = 0
        context.drop(animal, animal.id, itemId('rope'), 1)
        continue
      }
      const pull = ropePull(player.position, animal, animal.def.mass)
      if (!pull) continue
      const moved = moveBox(animal, pull.animal.dx, pull.animal.dy, animal.def.halfSize, this.blockedFor(animal, context))
      animal.x = moved.x
      animal.y = moved.y
      player.position = moveBox(player.position, pull.player.dx, pull.player.dy, PLAYER_HALF_SIZE, context.solidForPlayers)
    }
  }

  // ---- what players do to them

  // An animal is hurt: it loses `amount` hp, is knocked back (`knockback` units, away from `from`) and stunned (`stun`
  // ticks), and runs from `from` (a skittish one's herd with it); a hostile one goes for the player who hurt it (`by`),
  // with its pack, instead. Gives what it drops if that killed it (a grown one: its meat, about as much as its meat
  // stat, and the rest, as in animals.json; a baby nothing; and the rope, if it was on one), or undefined if it lives.
  damage(
    id: number,
    amount: number,
    from: PlayerPosition,
    tick: number,
    effects: { knockback?: number; stun?: number } = {},
    by = 0,
  ): Array<[string, number]> | undefined {
    const animal = this.all.get(id)
    if (!animal) return undefined
    animal.hp -= amount
    const dx = animal.x - from.x
    const dy = animal.y - from.y
    const away = Math.hypot(dx, dy) || 1
    if (animal.hp > 0) {
      if (effects.knockback && !animal.def.boss) {
        // A slide that adds up to about `knockback`, given how it slows.
        const speed = Math.round((effects.knockback * KNOCK_SLOWING) / 100)
        animal.vx = Math.round((dx / away) * speed)
        animal.vy = Math.round((dy / away) * speed)
      }
      if (effects.stun) animal.stunnedUntil = tick + effects.stun
      if (animal.def.hunt && animal.leader === 0) {
        // Hurt, it goes for whoever hurt it, and calls the others of its kind near it (even one already on a chase).
        if (by !== 0) this.rouse(animal, by, tick)
        return undefined
      }
      if (animal.def.temper === 'skittish' && animal.leader === 0) {
        animal.fleeUntil = 0
        this.spookHerd(animal, from, tick)
        animal.fleeUntil += effects.stun ?? 0
        animal.decideAt = animal.fleeUntil
        return undefined
      }
      animal.fleeUntil = tick + (effects.stun ?? 0) + FLEE_TICKS
      animal.goal = {
        k: 'walk',
        x: animal.x + Math.round((dx / away) * FLEE_DISTANCE * SUB),
        y: animal.y + Math.round((dy / away) * FLEE_DISTANCE * SUB),
        pace: FLEE_PACE,
      }
      animal.decideAt = animal.fleeUntil
      return undefined
    }
    this.all.delete(animal.id)
    this.killed.set(animal.id, Math.max(1, Math.round(amount)))
    const drops: Array<[string, number]> = []
    if (animal.leader !== 0) drops.push(['rope', 1])
    if (isAdult(animal)) {
      for (const drop of animal.def.drops) {
        const key = itemKey(drop.item)
        if (drop.stat !== undefined) drops.push([key, Math.max(1, Math.round(animal.stats[drop.stat] + this.random() - 0.5))])
        else drops.push([key, drop.min + this.rng.nextInt(drop.max - drop.min + 1)])
      }
    }
    return drops
  }

  // Sets a hostile animal on a player (a boss, when its fight starts: see dungeons.ts).
  provoke(id: number, playerId: number, tick: number): void {
    const animal = this.all.get(id)
    if (animal) this.hunt(animal, playerId, tick)
  }

  // Calms a hostile animal: it forgets whom it was after, is whole again, and goes back to where it lives (a boss whose
  // challengers have all fallen or fled).
  calm(id: number, tick: number): void {
    const animal = this.all.get(id)
    if (!animal) return
    animal.target = 0
    animal.hp = animal.def.hp
    animal.x = animal.homeX
    animal.y = animal.homeY
    animal.goal = { k: 'idle' }
    animal.calmUntil = tick + CALM_TICKS
  }

  // Forgets the tick's kills, once pages have been told of them.
  forgetKills(): void {
    this.killed.clear()
  }

  // The damage of the blow that killed an animal on the tick being run, if it was killed (not let go or wandered off).
  killedBy(id: number): number | undefined {
    return this.killed.get(id)
  }

  // The animals whose middles are within `reach` of a point (their size counts), for what an attack hits.
  near(point: PlayerPosition, reach: number): Animal[] {
    return this.list().filter((animal) => Math.hypot(animal.x - point.x, animal.y - point.y) <= reach + animal.def.halfSize)
  }

  // Hitting an animal by clicking on it, with the basic attack's damage of what is in `slot` (what tests and older pages
  // use; the game attacks with `attack` commands, see combat.ts).
  strike(context: CommandContext, id: number, slot: number): CommandOutcome {
    const animal = this.all.get(id)
    const { player } = context
    if (!animal) return { ok: false, why: 'animalGone' }
    if (Math.hypot(player.position.x - animal.x, player.position.y - animal.y) > PLAYER_REACH) return { ok: false, why: 'reach' }
    if (context.tick - player.lastPunchTick < PUNCH_COOLDOWN_TICKS) return { ok: false, why: 'tooSoon' }
    player.lastPunchTick = context.tick
    const where = { x: animal.x, y: animal.y }
    const drops = this.damage(id, weaponIn(player.inventory, slot).damage, player.position, context.tick, {}, player.id)
    return { ok: true, moved: drops ? giveDrops(context, where, id, drops) : 0 }
  }

  // Using something on an animal: a rope puts it on a lead (or, if it is yours, takes the lead off again and gives the
  // rope back); otherwise a cow with milk is milked.
  interact(context: CommandContext, id: number, slot: number): CommandOutcome {
    const animal = this.all.get(id)
    const { player } = context
    if (!animal) return { ok: false, why: 'animalGone' }
    if (Math.hypot(player.position.x - animal.x, player.position.y - animal.y) > PLAYER_REACH) return { ok: false, why: 'reach' }
    const rope = itemId('rope')
    if (animal.leader === player.id) {
      animal.leader = 0
      if (addItems(player.inventory, rope, 1) === 0) giveDrops(context, animal, animal.id, [['rope', 1]])
      return { ok: true }
    }
    const held = player.inventory.slots[slot]
    if (held && held.count > 0 && held.item === rope) {
      if (animal.leader !== 0) return { ok: false, why: 'leadTaken' }
      takeFromSlot(player.inventory, slot, 1)
      animal.leader = player.id
      animal.wild = false
      animal.goal = { k: 'idle' }
      return { ok: true }
    }
    // Milking fills the empty bucket in hand (it becomes a bucket of milk), one bucket a time: she keeps the rest of
    // her milk for the next.
    if (animal.def.milk !== undefined && held && held.count > 0 && getItem(held.item).bucket === 'empty') {
      if (animal.milk === 0 || !isAdult(animal) || animal.sex !== 'f') return { ok: false, why: 'noMilk' }
      animal.milk--
      held.item = animal.def.milk
      held.count = 1
      return { ok: true }
    }
    return { ok: false, why: 'nothingToDo' }
  }

  // ---- the skeletons' camps

  // Each camp keeps its skeletons: a place whose skeleton was killed waits CAMP_RESPAWN_TICKS, then gets a new one, once
  // a player is near enough for it to matter and none near enough to see it appear.
  private tendCamps(context: AnimalContext): void {
    if (!this.camps) {
      this.camps = campSites(context.terrain).map((site, i): Camp => {
        const saved = this.savedCamps?.[i]
        const count = saved?.length ?? CAMP_MIN + (hashInts(context.seed, site.x, site.y, 721) % (CAMP_MAX - CAMP_MIN + 1))
        return { x: site.x * SUB + SUB / 2, y: site.y * SUB + SUB / 2, places: Array.from({ length: count }, (_, n) => ({ id: 0, respawnAt: saved?.[n] ?? 0 })) }
      })
      this.savedCamps = undefined
      for (const animal of this.all.values()) {
        const place = animal.post ? this.camps[animal.post.camp]?.places[animal.post.slot] : undefined
        if (place) place.id = animal.id
        else delete animal.post
      }
    }
    if (!this.wild) return
    const skeleton = animalDef('skeleton')
    const archer = animalDef('skeleton-archer')
    this.camps.forEach((camp, index) => {
      const near = (radius: number): boolean => context.players.some((player) => Math.hypot(player.position.x - camp.x, player.position.y - camp.y) <= radius * SUB)
      for (const [slot, place] of camp.places.entries()) {
        if (place.id !== 0) {
          if (this.all.has(place.id)) continue
          place.id = 0
          place.respawnAt = context.tick + CAMP_RESPAWN_TICKS
        }
        if (context.tick < place.respawnAt || !near(CAMP_ACTIVE) || near(CAMP_UNSEEN)) continue
        if (!context.isGrown(chunkOfTile(floorDiv(camp.x, SUB), floorDiv(camp.y, SUB)))) continue
        const angle = (slot / camp.places.length) * Math.PI * 2 + index
        const x = Math.round(camp.x + Math.cos(angle) * CAMP_POST * SUB)
        const y = Math.round(camp.y + Math.sin(angle) * CAMP_POST * SUB)
        // Every third place round a camp's fire is an archer's.
        const guard = this.spawn(slot % 3 === 1 ? archer : skeleton, x, y)
        guard.wild = false
        guard.post = { camp: index, slot }
        guard.homeX = camp.x
        guard.homeY = camp.y
        place.id = guard.id
      }
    })
  }

  // The camps' middles (units), for tests and the debug view.
  campMiddles(): ReadonlyArray<{ x: number; y: number }> {
    return this.camps ?? []
  }

  // ---- spawning

  private despawnFarAway(context: AnimalContext): void {
    for (const animal of this.list()) {
      if (!animal.wild || animal.leader !== 0) continue
      const near = context.players.some(
        (player) => Math.hypot(player.position.x - animal.x, player.position.y - animal.y) <= DESPAWN_RADIUS * SUB,
      )
      if (!near) this.all.delete(animal.id)
    }
  }

  private spawnNearPlayers(context: AnimalContext): void {
    for (const player of context.players) {
      let near = 0
      for (const animal of this.all.values()) {
        if (Math.hypot(animal.x - player.position.x, animal.y - player.position.y) <= NEAR_RADIUS * SUB) near++
      }
      if (near >= NEAR_CAP) continue
      for (let attempt = 0; attempt < 10; attempt++) {
        const angle = this.random() * Math.PI * 2
        const distance = (SPAWN_NEAR + this.random() * (SPAWN_FAR - SPAWN_NEAR)) * SUB
        const x = Math.round(player.position.x + Math.cos(angle) * distance)
        const y = Math.round(player.position.y + Math.sin(angle) * distance)
        const def = this.pickKind(context, x, y)
        if (!def) continue
        const probe = { leader: 0 }
        if (overlapsSolid({ x, y }, this.blockedFor(probe, context), def.halfSize)) continue
        this.spawnHerd(context, def, x, y)
        break
      }
    }
  }

  // A kind that lives in the biome at a point (units), picked by their weights; none at sea, or where none live.
  private pickKind(context: AnimalContext, x: number, y: number): AnimalDef | undefined {
    const biome = biomeAt(context.terrain, floorDiv(x, SUB), floorDiv(y, SUB))
    const kinds = biome ? ANIMALS.filter((def) => def.spawnWeight > 0 && def.biomes.includes(biome.key)) : []
    const total = kinds.reduce((sum, def) => sum + def.spawnWeight, 0)
    let roll = this.random() * total
    for (const def of kinds) {
      roll -= def.spawnWeight
      if (roll < 0) return def
    }
    return kinds[kinds.length - 1]
  }

  private random(): number {
    return this.rng.nextU32() / 0x1_0000_0000
  }
}

function stat(animal: Animal, key: string): number {
  const index = statIndex(animal.def, key)
  return index >= 0 ? animal.stats[index] : 0
}

// How long it takes to grow up, in ticks.
function growTicks(animal: Pick<Animal, 'def' | 'stats'>): number {
  return Math.max(1, Math.round(stat(animal as Animal, 'growth') * TPS))
}

export function isAdult(animal: Animal): boolean {
  return animal.age >= growTicks(animal)
}

function itemKey(id: ItemId): string {
  return ITEM_KEYS.get(id) ?? 'stick'
}
const ITEM_KEYS = new Map<ItemId, string>()
for (const item of ITEMS) ITEM_KEYS.set(item.id, item.key)

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundStat(value: number): number {
  return Math.round(value * 100) / 100
}
