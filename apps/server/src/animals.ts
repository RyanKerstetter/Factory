import {
  addItems,
  fencePost,
  removeItems,
  TIE_REACH,
  ANIMALS,
  HUNGER_MAX,
  BUILDINGS,
  chunkOfTile,
  chunksAround,
  fenceBoxes,
  fenceMask,
  floorDiv,
  gateBoxes,
  gateIsOpen,
  isInsideWorld,
  groundBlocks,
  boundsOf,
  biomeSiteAt,
  createEntity,
  entityToState,
  NO_ITEM,
  tileOfUnits,
  type BiomeSite,
  getItem,
  itemId,
  LEAD_BREAK,
  moveBox,
  overlapsSolid,
  PLAYER_HALF_SIZE,
  PLAYER_REACH,
  ropeForce,
  ropeMove,
  ropeStep,
  ROPE_HELD,
  PLAYER_MASS,
  Rng,
  statIndex,
  SUB,
  takeFromSlot,
  TPS,
  type AnimalDef,
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
} from '../../../packages/shared/src/index.ts'
import type { Body } from './bodies.ts'
import { giveDrops, type CommandContext, type CommandOutcome, type Dropped } from './commands.ts'
import { CreatureSet, type HitEffects } from './creatures.ts'
import { followTo, sightClear, stepToward, straightClear } from './steering.ts'

// Whether an animal is on a rope: led by a player, or tied to a fence. On a rope it does not wander off, run from
// players or go after them, breed, or go away by itself.
function onRope(animal: Pick<Animal, 'leader' | 'post'>): boolean {
  return animal.leader !== 0 || animal.post !== 0
}

// The animals: chickens and deer in the forest, wolves in the mountains, cows on the meadow, spiders in the desert (see
// data/animals.json), run by the server only (the skeletons and the frost lich are monsters: see monsters.ts). They are not part of the factory's
// simulation, so nothing here has to come out the same on every page; pages are sent where the animals are with the
// players' positions and what each one is (AnimalInfo) on the log. Their random numbers come from the room's seed, so
// a test sees the same animals do the same things.
//
// What an animal does, picked again every second or so (see `decide`), most pressing first:
// - (watching all the while, see `watch`) a skittish one (a deer) runs from any player who comes near, and its herd with
//   it; a hostile one (a wolf) goes for a player who comes onto its ground or hurts it, and its pack with
//   it, and bites them until they are knocked out or have got far enough away (see `hunt` in animals.json). A pack that
//   flanks (wolves) spreads out round its prey and darts in from different sides, falling back between bites;
// - just hit: run from whoever hit it, for FLEE_TICKS (and a stunned one stands, and a knocked one slides);
// - led on a rope: a slow, aimless wander, and the rope does the rest (see `pullRopes`);
// - an adult that is well fed and ready: find a well-fed adult of the other sex and breed (a baby is born between them);
// - not well fed and getting hungry (half of `hungryAt`): eat what it likes from a feed box nearby, which leaves it
//   well fed for `wellFedMinutes`. Grass never makes an animal well fed: only a feed box does;
// - hungry (`hungryAt` or more): go to the nearest tuft of grass within `grassRadius` tiles and graze it away;
//   a little hungry (half of that): nibble a tuft only if one is right beside it;
// - away from the others of its kind: go back to them (not one that lives alone, a spider);
// - otherwise: wander a little, or stand.
// And, whatever it is doing, a spider spins a cobweb round itself now and then (see `spin`).
// The numbers (how fast it gets hungry, and so on) are each kind's `life` in data/animals.json.

// A tuft of grass takes GRAZE_TICKS to eat; one this close (tiles) is nibbled even when the animal is only a little hungry.
const GRAZE_TICKS = 45
const NIBBLE_RADIUS = 3
// An animal that has just been hit runs from whoever hit it for FLEE_TICKS, at FLEE_PACE times its speed.
const FLEE_TICKS = 3 * TPS
const FLEE_DISTANCE = 7
// How far an animal looks, in tiles: for others of its kind, a feed box, and a mate. It stays within HERD_SPREAD of
// the middle of its herd.
const HERD_RADIUS = 10
const HERD_SPREAD = 3
const FEEDER_RADIUS = 10
const MATE_RADIUS = 8
// A walk that gets nowhere for this many ticks is given up.
const STUCK_TICKS = 30
// Food an animal could not get to is let be for this long (see `moveToward`).
const SHUN_TICKS = 20 * TPS
const FLEE_PACE = 1.8
// How often (ticks) an animal looks round for players, to run from or go for; how far a skittish one runs before it
// looks again (tiles); and how far a bite knocks a player back (units).
const WATCH_EVERY = 4
// A hunter that cannot get at its prey (behind a fence, over water) gives up: one that has not closed on them (come
// CLOSER_BY nearer than it was, counting from where they got to if they got further away) and not bitten them for
// UNREACHABLE_TICKS lets them be, and leaves them alone for
// IGNORE_TICKS after (unless they hurt it), so a penned wolf goes back to eating and breeding.
const UNREACHABLE_TICKS = 8 * TPS
const IGNORE_TICKS = 30 * TPS
const CLOSER_BY = SUB / 2
// A pack keeps away from other packs of its kind: one of them within half its `territory` of it, it walks off away from
// them, AVOID_TILES tiles at a time.
const AVOID_TILES = 8
// Pathfinding: a hunter whose straight way to where it is going is blocked (a wall, a fence, a tree) finds a way round
// (see steering.ts).
const SPOOK_DISTANCE = 22
const BITE_KNOCKBACK = SUB / 3
// Flanking: the pack spreads round its prey FLANK_RING tiles out, at least FLANK_SPREAD radians apart (or evenly all
// the way round, for a big pack), and one darts in to bite once it is within FLANK_LUNGE tiles of its place there.
const FLANK_RING = 3.2
const FLANK_SPREAD = 1.25
const FLANK_LUNGE = 1.6

// Spawning. Each biome keeps a population of each kind that lives there (`population` in animals.json, for its size):
// when the world is made, it is filled to that; then every POPULATE_EVERY ticks, each biome a player is on is counted,
// and each kind short of it gets a herd POPULATE_CHANCE percent of the time, on its open ground at least SPAWN_AWAY
// tiles from every player (POPULATE_TRIES tries at a spot). A fifth of a wild herd are babies.
const POPULATE_EVERY = 30 * TPS
const POPULATE_CHANCE = 50
const POPULATE_TRIES = 20
const SPAWN_AWAY = 40
const WILD_BABIES = 20

type Goal =
  | { k: 'idle' }
  | { k: 'walk'; x: number; y: number; pace: number }
  | { k: 'graze'; grass: number; x: number; y: number; eating: number }
  | { k: 'feed'; feeder: number; x: number; y: number }
  | { k: 'mate'; partner: number }
  | { k: 'hunt' }

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
  // The fence it is tied to on a rope (its entity ID), or 0: it is held there as if led, pulled back to it.
  post: number
  // While it is on a rope: which (`of`: who leads it or what it is tied to, so a new rope starts afresh), how fast the
  // rope is pulling it along (units a tick), and how far from a fence it is held (see ROPE_HELD).
  rope?: { of: string; vx: number; vy: number; reach: number }
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
  // A hunter's pack (the ID of the first of it; 0 for an animal with no pack): it keeps with its own pack and away from
  // others of its kind.
  pack: number
  // The player a hostile one is after (0 for none), and when it can bite again.
  target: number
  biteReadyAt: number
  // A hunter on a chase: how far from its prey it is measured from (units), and when it last closed on them or bit them.
  chase?: { from: number; since: number }
  // A player a hunter could not get at, left alone until `until` (see UNREACHABLE_TICKS).
  ignoring?: { player: number; until: number }
  // A hostile one that was just hit: until when it backs off from its prey, not biting (its `recoil`).
  recoilUntil?: number
  // Food it could not get to (a tuft through a fence, a feed box out of reach), let be until `until` (see `moveToward`).
  shunned?: { id: number; until: number }
  // The way round something in its way (tile middles, in units, next first), what it leads to, and when it was found.
  path?: { steps: Array<{ x: number; y: number }>; toX: number; toY: number; at: number }
  // One that spins cobwebs (a spider): when it spins the next, and the cobwebs it has spun that still stand (their
  // IDs; see `spin`).
  nextWebAt?: number
  webs?: number[]
}

// The animals, saved (see save.ts): each as its kind's key and what it is, and what the herd keeps between ticks. What
// each is doing, sliding or running from is not kept (it starts again standing), nor ropes players hold (players come
// back as new players, so a rope is put back in its leader's things: see GameRoom); one tied to a fence stays tied.
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
    pack?: number
    // Saved before packs: where it lived (its pack was every one of its kind living at the same spot).
    homeX?: number
    homeY?: number
    post?: number
    // A spider's cobwebs still standing (see `spin`).
    webs?: number[]
  }>
}

// What the animals need from the room on a tick.
export type AnimalContext = {
  world: FactoryWorld
  seed: number
  // The land (water, and which biome is where).
  terrain: Terrain
  tick: number
  emit: (event: WorldEvent) => void
  // A new building's ID (a spider's cobweb).
  nextEntityId: () => number
  // Drops `count` of an item on the ground round a point.
  drop: (middle: PlayerPosition, salt: number, item: ItemId, count: number) => void
  // The players, whose positions the ropes pull on.
  // `rope`: how fast a rope is pulling them along (units a tick), while one is (see `pullRopes`).
  players: ReadonlyArray<{ id: number; position: PlayerPosition; inventory: Inventory; rope?: { x: number; y: number }; aboard?: unknown }>
  // Whether a chunk has been grown yet; animals keep to ground that has.
  isGrown: (chunk: number) => boolean
  // Whether the animals in a chunk are run this tick: near a player, or where a player has built something (a farm keeps
  // going while they are away). Elsewhere they wait as they are.
  isActive: (chunk: number) => boolean
  // What players cannot walk into, for where a rope pulls a player.
  solidForPlayers: IsSolid
  // Hurts a player (bitten), from a point, pushing them `knockback` units away.
  hurtPlayer: (id: number, damage: number, from: PlayerPosition, knockback: number) => void
}

export class Animals extends CreatureSet<Animal> {
  private readonly rng: Rng
  private lastSpawn = 0
  // Whether a tile is open land an animal can run over (not the sea or a pond, and grown), as of the last tick run:
  // for picking a way to run (see `fleeTo`).
  private open?: (x: number, y: number) => boolean
  // What animals cannot walk into on the tick being run: one for those that go through open gates, one for those that
  // do not (see `blockedFor`), made once a tick.
  private blocking?: { context: AnimalContext; throughGates: IsSolid; notThroughGates: IsSolid }

  // `wild`: whether herds turn up by themselves (see `populate`).
  constructor(seed: number, private readonly wild = true) {
    super()
    this.rng = new Rng((seed ^ 0x5eed_a11) >>> 0)
  }

  // ---- saving them

  toSave(): AnimalSave {
    return {
      nextId: this.nextId,
      rng: this.rng.state,
      lastSpawn: this.lastSpawn,
      animals: this.list().map((animal) => ({
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
        ...(animal.pack !== 0 ? { pack: animal.pack } : {}),
        ...(animal.post !== 0 ? { post: animal.post } : {}),
        ...(animal.webs?.length ? { webs: [...animal.webs] } : {}),
      })),
    }
  }

  // Puts saved animals in (in place of any there are). An animal of a kind the game no longer has is left out.
  loadSave(saved: AnimalSave): void {
    this.all.clear()
    this.nextId = saved.nextId
    this.rng.state = saved.rng >>> 0
    this.lastSpawn = saved.lastSpawn
    // A hunter saved before packs: its pack is the first of its kind that lived at the same spot.
    const packs = new Map<string, number>()
    // In ID order, as they are kept (see CreatureSet.all).
    for (const animal of [...saved.animals].sort((a, b) => a.id - b.id)) {
      const def = ANIMALS.find((candidate) => candidate.kind === animal.kind)
      if (!def) continue
      // Stats the kind has gained since are its base; ones it has lost are dropped.
      const stats = def.stats.map((stat, i) => animal.stats[i] ?? stat.base)
      this.all.set(animal.id, {
        ...animal,
        def,
        stats,
        pack: animal.pack ?? (def.hunt && animal.homeX !== undefined ? packOf(packs, `${animal.kind}|${animal.homeX}|${animal.homeY}`, animal.id) : 0),
        target: 0,
        biteReadyAt: 0,
        leader: 0,
        post: animal.post ?? 0,
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
      ...(animal.post !== 0 ? { post: animal.post } : {}),
      milk: animal.milk,
      doing: this.doing(animal),
      ...(animal.target !== 0 ? { angry: true } : {}),
    }
  }

  // What it is doing, in a few words.
  private doing(animal: Animal): string {
    if (animal.stunnedUntil > this.tickNow) return 'stunned'
    if (animal.fleeUntil > this.tickNow) return 'running away'
    if (animal.target !== 0) return 'hunting'
    if (animal.leader !== 0) return 'being led'
    if (animal.post !== 0) return 'tied up'
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
      post: 0,
      wild: options.stats === undefined,
      goal: { k: 'idle' },
      decideAt: 0,
      stuck: 0,
      vx: 0,
      vy: 0,
      stunnedUntil: 0,
      fleeUntil: 0,
      pack: 0,
      target: 0,
      biteReadyAt: 0,
    }
    if (!options.baby) animal.age = growTicks(animal)
    return this.add(animal)
  }

  // A herd of a kind round a point (units), on tiles it can stand on. Gives how many there are. A pack of hunters is
  // one pack, and none turns up within its `territory` of a wolf of another pack of its kind (see `hunt`).
  spawnHerd(context: AnimalContext, def: AnimalDef, x: number, y: number): number {
    const territory = def.hunt?.territory
    if (territory !== undefined) {
      for (const other of this.all.values()) {
        if (other.def === def && Math.hypot(other.x - x, other.y - y) < territory) return 0
      }
    }
    let pack = 0
    // One that lives alone turns up alone.
    const count = def.solitary ? 1 : def.herd[0] + this.rng.nextInt(def.herd[1] - def.herd[0] + 1)
    let made = 0
    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const px = x + Math.round((this.random() * 2 - 1) * 2 * SUB)
        const py = y + Math.round((this.random() * 2 - 1) * 2 * SUB)
        const animal = { x: px, y: py, def, leader: 0 } as Animal
        if (overlapsSolid({ x: px, y: py }, this.blockedFor(animal, context), def.halfSize)) continue
        // The first two are one of each, so a herd can breed (one alone is either).
        const sex: Sex | undefined = count < 2 ? undefined : n === 0 ? 'f' : n === 1 ? 'm' : undefined
        const baby = n >= 2 && this.rng.nextInt(100) < WILD_BABIES
        const spawned = this.spawn(def, px, py, { ...(sex ? { sex } : {}), baby })
        if (baby) spawned.age = this.rng.nextInt(growTicks(spawned))
        if (territory !== undefined) {
          pack ||= spawned.id
          spawned.pack = pack
        }
        made++
        break
      }
    }
    return made
  }

  // ---- each tick

  step(context: AnimalContext): void {
    const { tick } = context
    this.tickNow = tick
    this.open = (x, y) => isInsideWorld(x, y) && context.isGrown(chunkOfTile(x, y)) && !groundBlocks(context.terrain, x, y)
    for (const animal of this.list()) {
      // Only where something is going on (see `isActive`): elsewhere it waits as it is, unless it is on a rope.
      if (!onRope(animal) && !context.isActive(chunkOfTile(tileOfUnits(animal.x), tileOfUnits(animal.y)))) continue
      animal.age++
      if (tick % animal.def.life.hungerEvery === 0) animal.hunger = Math.min(HUNGER_MAX, animal.hunger + 1)
      this.produce(context, animal)
      this.spin(context, animal)
      this.slide(animal, this.blockedFor(animal, context))
      if (animal.stunnedUntil > tick) continue
      if ((tick + animal.id) % WATCH_EVERY === 0) this.watch(context, animal)
      if (tick >= animal.decideAt) this.decide(context, animal)
      this.act(context, animal)
    }
    this.pullRopes(context)
    if (this.wild && tick - this.lastSpawn >= POPULATE_EVERY) {
      this.lastSpawn = tick
      this.populate(context)
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

  // A spider spins a cobweb now and then (its kind's `webs`: about every `every`, give or take a half), on a free tile
  // of land within `radius` tiles of it, while fewer than `most` of the cobwebs it has spun still stand, wherever they
  // are (it wanders off from them): once one is broken it may spin another.
  private spin(context: AnimalContext, animal: Animal): void {
    const webs = animal.def.webs
    if (!webs) return
    const { tick } = context
    const next = (): number => tick + Math.round(webs.every * (0.5 + this.random()))
    if (animal.nextWebAt === undefined) {
      animal.nextWebAt = next()
      return
    }
    if (tick < animal.nextWebAt) return
    animal.nextWebAt = next()
    const standing = (animal.webs ?? []).filter((id) => context.world.entity(id)?.kind === 'cobweb')
    animal.webs = standing
    if (standing.length >= webs.most) return
    const tx = tileOfUnits(animal.x)
    const ty = tileOfUnits(animal.y)
    const reach = webs.radius
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = tx - reach + this.rng.nextInt(reach * 2 + 1)
      const y = ty - reach + this.rng.nextInt(reach * 2 + 1)
      if (!isInsideWorld(x, y) || !context.isGrown(chunkOfTile(x, y)) || context.world.entityAt(x, y) || groundBlocks(context.terrain, x, y)) continue
      const id = context.nextEntityId()
      context.emit({ t: 'add', e: entityToState(createEntity(id, 'cobweb', x, y, 0, NO_ITEM)) })
      standing.push(id)
      return
    }
  }

  private decide(context: AnimalContext, animal: Animal): void {
    const { tick } = context
    animal.decideAt = tick + 20 + this.rng.nextInt(30)
    // Running from a hit, hunting, or busy with something that is still going: carry on.
    if (animal.fleeUntil > tick || animal.target !== 0) return
    // On its way to food (not yet eating): it looks again, and goes for what it would pick now if that is something
    // else (a feed box filled meanwhile, the grass it was after gone to another).
    if ((animal.goal.k === 'graze' && animal.goal.eating === 0) || animal.goal.k === 'feed') {
      const now = this.foodGoal(context, animal)
      const same = (goal: Goal): boolean =>
        (goal.k === 'graze' && animal.goal.k === 'graze' && goal.grass === animal.goal.grass) || (goal.k === 'feed' && animal.goal.k === 'feed' && goal.feeder === animal.goal.feeder)
      if (now && !same(now)) animal.goal = now
      return
    }
    if (animal.goal.k === 'graze' || animal.goal.k === 'mate' || animal.goal.k === 'hunt') return
    if (onRope(animal)) {
      animal.goal = this.wanderGoal(animal, 1.5, 0.35)
      return
    }
    const fed = animal.fedUntil > tick
    // However many there are already: a farm can grow as big as its feed boxes keep it fed.
    if (isAdult(animal) && fed && tick >= animal.breedReadyAt) {
      const partner = this.nearest(animal, MATE_RADIUS, (other) => this.canMate(animal, other, tick))
      if (partner) {
        animal.goal = { k: 'mate', partner: partner.id }
        return
      }
    }
    const food = this.foodGoal(context, animal)
    if (food) {
      animal.goal = food
      return
    }
    // A hunter keeps away from other packs of its kind: one near, it walks off away from it.
    const hunt = animal.def.hunt
    if (hunt && animal.pack !== 0) {
      const rival = this.nearest(animal, hunt.territory / 2 / SUB, (other) => other.def === animal.def && other.pack !== animal.pack)
      if (rival) {
        const to = this.fleeTo(animal, rival, AVOID_TILES)
        animal.goal = { k: 'walk', x: to.x, y: to.y, pace: 0.8 }
        return
      }
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
    animal.goal = this.rng.nextInt(100) < 40 ? this.wanderGoal(animal, 3, 0.45) : { k: 'idle' }
  }

  // ---- watching for players

  // A skittish animal runs from a player who comes near, and its herd with it; a hostile one goes for a player who
  // comes near, and never gives them up (see `act`) until they are gone from the game.
  private watch(context: AnimalContext, animal: Animal): void {
    const { def } = animal
    // A skittish one runs even on a rope (and drags whoever holds it); anything else on a rope just follows.
    if (onRope(animal) && def.temper !== 'skittish') return
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
      // Gone from the game: it lets them be.
      if (!context.players.some((player) => player.id === animal.target)) {
        animal.target = 0
        this.giveUp(animal)
      }
      return
    }
    // A player it can see, close by (not one it could not get at, a while ago).
    const intruder = this.nearestPlayer(context, animal, hunt.aggroRadius, (player) => !this.ignores(animal, player.id, context.tick) && sightClear(animal, player.position))
    // It calls its pack at once.
    if (intruder) this.rouse(animal, intruder.id, context.tick)
  }

  // A hostile animal goes for a player, by itself.
  private hunt(animal: Animal, playerId: number, tick: number): void {
    if (animal.target !== playerId) animal.chase = undefined
    animal.target = playerId
    animal.goal = { k: 'hunt' }
    animal.fleeUntil = 0
    animal.decideAt = tick + TPS
  }

  // Sets an animal running from a point (a little to one side or the other), and the rest of its herd near it.
  private spookHerd(animal: Animal, from: PlayerPosition, tick: number): void {
    this.spook(animal, from, tick)
    for (const other of this.all.values()) {
      if (other === animal || other.def !== animal.def || onRope(other) || other.fleeUntil > tick) continue
      if (Math.hypot(other.x - animal.x, other.y - animal.y) <= HERD_RADIUS * SUB) this.spook(other, from, tick)
    }
  }

  private spook(animal: Animal, from: PlayerPosition, tick: number): void {
    const to = this.fleeTo(animal, from, SPOOK_DISTANCE, (this.random() - 0.5) * 1.2)
    animal.fleeUntil = Math.max(animal.fleeUntil, tick + FLEE_TICKS)
    animal.goal = { k: 'walk', x: to.x, y: to.y, pace: animal.def.fleePace }
    animal.decideAt = animal.fleeUntil
  }

  // Where an animal runs to from a threat at `from`, up to `distance` tiles: straight away (turned by `turn`), unless
  // the land runs out that way (the sea, a pond, ground not grown yet: `open`), when it turns aside, trying a
  // sixteenth of a turn more at a time either way, and takes the way that leaves it furthest from the threat, so it
  // runs along the shore and out of a corner rather than into the water. Only the land counts: a fence is not
  // looked for, so a herd can still be penned in.
  private fleeTo(animal: Animal, from: PlayerPosition, distance: number, turn = 0): PlayerPosition {
    const base = Math.atan2(animal.y - from.y, animal.x - from.x) + turn
    const open = this.open
    const straight = { x: animal.x + Math.round(Math.cos(base) * distance * SUB), y: animal.y + Math.round(Math.sin(base) * distance * SUB) }
    if (!open) return straight
    const half = animal.def.halfSize
    // How many whole tiles it can run that way before the land runs out (its body and all).
    const runOf = (angle: number): number => {
      const ux = Math.cos(angle)
      const uy = Math.sin(angle)
      for (let step = 1; step <= distance; step++) {
        const x = animal.x + ux * (step * SUB + half)
        const y = animal.y + uy * (step * SUB + half)
        if (!open(Math.floor(x / SUB), Math.floor(y / SUB))) return step - 1
      }
      return distance
    }
    let best = straight
    let bestScore = Number.NEGATIVE_INFINITY
    for (let i = 0; i < 16; i++) {
      // 0, then a sixteenth each way, then two...
      const angle = base + (i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1) * (Math.PI / 8))
      const run = runOf(angle)
      if (run === 0) continue
      const end = { x: animal.x + Math.round(Math.cos(angle) * run * SUB), y: animal.y + Math.round(Math.sin(angle) * run * SUB) }
      // As far from the threat as it gets, and a run cut short counts for less (it would soon be stuck again).
      const score = Math.hypot(end.x - from.x, end.y - from.y) - (distance - run) * SUB * 0.5
      if (run === distance && i === 0) return end
      if (score > bestScore) {
        best = end
        bestScore = score
      }
    }
    return best
  }

  // A hostile animal goes for a player, and so does its pack: every one of its kind within `packRadius` of it (or of
  // one of the others roused) that is not after someone already.
  // Not one that is letting that player be (it could not get at them), unless it is the one hurt (`hurt`).
  private rouse(animal: Animal, playerId: number, tick: number, hurt = false): void {
    const hunt = animal.def.hunt
    if (!hunt) return
    if (hurt) animal.ignoring = undefined
    const pack = [animal]
    for (let i = 0; i < pack.length; i++) {
      const caller = pack[i]
      this.hunt(caller, playerId, tick)
      for (const other of this.all.values()) {
        if (pack.includes(other) || other.def !== animal.def || other.target !== 0 || onRope(other) || this.ignores(other, playerId, tick)) continue
        if (Math.hypot(other.x - caller.x, other.y - caller.y) <= hunt.packRadius) pack.push(other)
      }
    }
  }

  // Whether a hunter is letting a player be, having not been able to get at them a while ago.
  private ignores(animal: Animal, playerId: number, tick: number): boolean {
    return animal.ignoring !== undefined && animal.ignoring.player === playerId && tick < animal.ignoring.until
  }

  // A hunter that has come no nearer its prey and not bitten them for UNREACHABLE_TICKS gives up on them, and lets them
  // be for IGNORE_TICKS. Gives whether it gave up.
  private giveUpIfStuck(animal: Animal, prey: PlayerPosition, tick: number): boolean {
    const distance = Math.hypot(prey.x - animal.x, prey.y - animal.y)
    const chase = (animal.chase ??= { from: distance, since: tick })
    if (distance < chase.from - CLOSER_BY) {
      chase.from = distance
      chase.since = tick
    } else if (distance > chase.from) chase.from = distance
    if (tick - chase.since < UNREACHABLE_TICKS) return false
    animal.ignoring = { player: animal.target, until: tick + IGNORE_TICKS }
    animal.target = 0
    animal.chase = undefined
    this.giveUp(animal)
    return true
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
        // Chase, and bite when close enough; but not for ever at what it cannot get at (see UNREACHABLE_TICKS). A flanker
        // goes to its place round the prey first, and darts in from there when it can bite, falling back to it after.
        animal.stuck = 0
        if (this.giveUpIfStuck(animal, target.position, context.tick)) return
        // Just hit: it backs away from the prey, out to the flanking ring on its own side, until its recoil is over.
        if (context.tick < (animal.recoilUntil ?? 0)) {
          const away = Math.atan2(animal.y - target.position.y, animal.x - target.position.x)
          const back = { x: Math.round(target.position.x + Math.cos(away) * FLANK_RING * SUB), y: Math.round(target.position.y + Math.sin(away) * FLANK_RING * SUB) }
          this.pursue(context, animal, back.x, back.y, hunt.pace, 0.25 * SUB)
          animal.stuck = 0
          return
        }
        // Flanking only in the open: with something in the way, it finds its way to the prey first.
        if (hunt.flank && straightClear(animal, target.position.x, target.position.y, this.blockedFor(animal, context))) {
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
        // It bites from up close: its own size, the player's, and its reach between them.
        const biteRange = animal.def.halfSize + PLAYER_HALF_SIZE + hunt.reach
        if (!this.pursue(context, animal, target.position.x, target.position.y, hunt.pace, biteRange)) return
        animal.stuck = 0
        if (context.tick < animal.biteReadyAt) return
        animal.biteReadyAt = context.tick + hunt.cooldown
        if (animal.chase) animal.chase.since = context.tick
        context.hurtPlayer(target.id, hunt.damage, { x: animal.x, y: animal.y }, BITE_KNOCKBACK)
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

  // Goes towards a point like `moveToward`, but round what is in the way (see `followTo` in steering.ts). Gives whether
  // it is within `near` of the point.
  private pursue(context: AnimalContext, animal: Animal, x: number, y: number, pace: number, near: number): boolean {
    return followTo(animal, x, y, near, this.blockedFor(animal, context), context.tick, (tx, ty, within) => this.moveToward(context, animal, tx, ty, pace, within))
  }

  private giveUp(animal: Animal): void {
    animal.goal = { k: 'idle' }
    animal.decideAt = Math.min(animal.decideAt, this.tickNow + 10)
  }

  // Walks towards a point at `pace` times the animal's speed. Gives whether it is within `near` of it. A walk that
  // gets nowhere for STUCK_TICKS is given up (and food it could not get to, grass through a fence, is let be for
  // SHUN_TICKS, so it does not walk into the fence after it again and again).
  private moveToward(context: AnimalContext, animal: Animal, x: number, y: number, pace: number, near: number): boolean {
    const speed = Math.max(1, Math.round(animal.def.speed * pace * (isAdult(animal) ? 1 : 0.8)))
    const was = { x: animal.x, y: animal.y }
    if (stepToward(animal, animal.def.halfSize, x, y, speed, near, this.blockedFor(animal, context))) {
      animal.stuck = 0
      return true
    }
    if (animal.x !== was.x || animal.y !== was.y) animal.stuck = 0
    else if (++animal.stuck >= STUCK_TICKS) {
      animal.stuck = 0
      const food = animal.goal.k === 'graze' ? animal.goal.grass : animal.goal.k === 'feed' ? animal.goal.feeder : 0
      if (food !== 0) animal.shunned = { id: food, until: context.tick + SHUN_TICKS }
      this.giveUp(animal)
    }
    return false
  }

  // What a hungry animal goes for, if anything. Well fed (from a feed box), nothing: it does not graze. Else a feed box
  // with something it eats, once it is getting hungry, wherever grass is (a chicken goes to its seed box, not the grass
  // through the fence); and with such a box in reach, it waits for that rather than eat grass (a farm's planted grass
  // is left to grow). With none: hungry, the nearest grass it can see, or, a little hungry, a tuft right beside it.
  // Never what it could not get to a moment ago (`shunned`).
  private foodGoal(context: AnimalContext, animal: Animal): Goal | undefined {
    const { life } = animal.def
    if (animal.fedUntil > context.tick) return undefined
    if (animal.hunger < life.hungryAt / 2) return undefined
    const feeder = this.nearestFeeder(context, animal)
    if (feeder) return { k: 'feed', feeder: feeder.id, x: feeder.x * SUB + SUB / 2, y: feeder.y * SUB + SUB / 2 }
    const lookFor = !animal.def.grazes ? 0 : animal.hunger >= life.hungryAt ? life.grassRadius : NIBBLE_RADIUS
    const grass = lookFor > 0 ? this.nearestGrass(context, animal, lookFor) : undefined
    if (grass) return { k: 'graze', grass: grass.id, x: grass.x * SUB + SUB / 2, y: grass.y * SUB + SUB / 2, eating: 0 }
    return undefined
  }

  // Whether an animal is letting something be for now (see `shunned`).
  private shuns(animal: Animal, id: number): boolean {
    return animal.shunned !== undefined && animal.shunned.id === id && this.tickNow < animal.shunned.until
  }

  // What an animal cannot walk into: anything that blocks animals (a fence's post and rails; a gate's rail, and, open,
  // the gate itself unless it is being led through on a rope or is going for food), and ground that has not been grown
  // yet. So animals do not wander out through a gate left open.
  blockedFor(animal: Pick<Animal, 'leader'> & { goal?: Animal['goal'] }, context: AnimalContext): IsSolid {
    const throughGates =
      animal.leader !== 0 || animal.goal?.k === 'graze' || animal.goal?.k === 'feed' || animal.goal?.k === 'hunt'
    if (this.blocking?.context !== context) {
      const kindAt = (x: number, y: number): Entity['kind'] | undefined => context.world.entityAt(x, y)?.kind
      const players = context.players.map((player) => player.position)
      const blocks = (through: boolean): IsSolid => (x, y) => {
        if (!isInsideWorld(x, y) || !context.isGrown(chunkOfTile(x, y)) || groundBlocks(context.terrain, x, y)) return true
        const entity = context.world.entityAt(x, y)
        if (!entity || !BUILDINGS[entity.kind].blocksAnimals) return false
        if (entity.kind === 'fence') return fenceBoxes(fenceMask(kindAt, x, y))
        if (entity.kind === 'gate') return gateIsOpen(entity, players) ? !through : gateBoxes(fenceMask(kindAt, x, y))
        // A solid building stands in the way with its own shape (a barrel's round, a tree's trunk).
        return boundsOf(entity.kind) ?? true
      }
      this.blocking = { context, throughGates: blocks(true), notThroughGates: blocks(false) }
    }
    return throughGates ? this.blocking.throughGates : this.blocking.notThroughGates
  }

  // Each animal as a body, to be kept from standing on any other body (see bodies.ts): pushed, it is kept out of what
  // it cannot walk into.
  // Only those that are run (see `isActive`): the rest stand still, and so cannot be on top of each other.
  bodies(context: AnimalContext): Body[] {
    const run = this.list().filter((animal) => onRope(animal) || context.isActive(chunkOfTile(tileOfUnits(animal.x), tileOfUnits(animal.y))))
    return run.map((animal) => ({
      x: animal.x,
      y: animal.y,
      half: animal.def.halfSize,
      mass: animal.def.mass,
      move: (dx, dy) => {
        Object.assign(animal, moveBox(animal, dx, dy, animal.def.halfSize, this.blockedFor(animal, context)))
        return { x: animal.x, y: animal.y }
      },
    }))
  }

  private breed(a: Animal, b: Animal, tick: number): void {
    const def = a.def
    const stats = def.stats.map((statDef, i) => {
      const middle = (a.stats[i] + b.stats[i]) / 2
      return roundStat(clamp(middle + (this.random() * 2 - 1) * statDef.spread * 0.3, statDef.min, statDef.max))
    })
    const baby = this.spawn(def, Math.round((a.x + b.x) / 2), Math.round((a.y + b.y) / 2), { stats, baby: true })
    baby.hunger = 0
    // A pup is of its mother's pack.
    baby.pack = (a.sex === 'f' ? a : b).pack
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
      !onRope(other)
    )
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

  // The middle of the rest of an animal's herd within HERD_RADIUS of it (a pack of hunters is only its own pack: it does
  // not fall in with another pack that wanders near).
  private herdMiddle(animal: Animal): PlayerPosition | undefined {
    // One that lives alone has no herd.
    if (animal.def.solitary) return undefined
    let x = 0
    let y = 0
    let count = 0
    for (const other of this.all.values()) {
      if (other === animal || other.def !== animal.def) continue
      if (animal.def.hunt && other.pack !== animal.pack) continue
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
    // A tuft another animal is already making for is left to it (its own is not).
    const taken = new Set<number>()
    for (const other of this.all.values()) if (other !== animal && other.goal.k === 'graze') taken.add(other.goal.grass)
    return this.nearestEntity(context, animal, radius, (entity) => entity.kind === 'grass' && !taken.has(entity.id) && !this.shuns(animal, entity.id))
  }

  private nearestFeeder(context: AnimalContext, animal: Animal): Entity | undefined {
    return this.nearestEntity(
      context,
      animal,
      FEEDER_RADIUS,
      (entity) => entity.kind === 'feeder' && !this.shuns(animal, entity.id) && entity.inv.slots.some((slot) => slot.count > 0 && animal.def.foods.has(slot.item)),
    )
  }

  // ---- ropes

  // A rope stretched past LEAD_BREAK snaps, and the rope falls to the ground; so does one tied to a fence that is gone.
  // Each rope is a spring (see LEAD_LENGTH in constants.ts): it pulls the animal towards whoever leads it, and them
  // towards it just as hard, each sped up by that over its own weight (`ropeForce`, `ropeStep`), so a deer that runs
  // off drags its player along, and a cow follows. A fence does not give: what is tied to it is pulled in, and held
  // within ROPE_HELD of it once it has been drawn in that far.
  private pullRopes(context: AnimalContext): void {
    // How hard the ropes pull each player, by ID.
    const onPlayers = new Map<number, { x: number; y: number }>()
    for (const animal of this.list()) {
      let anchor: PlayerPosition
      let player: AnimalContext['players'][number] | undefined
      if (animal.post !== 0) {
        const fence = context.world.entity(animal.post)
        if (!fence || fence.kind !== 'fence') {
          animal.post = 0
          animal.rope = undefined
          context.drop(animal, animal.id, itemId('rope'), 1)
          continue
        }
        anchor = fencePost(fence)
      } else if (animal.leader !== 0) {
        player = context.players.find((candidate) => candidate.id === animal.leader)
        if (!player || Math.hypot(player.position.x - animal.x, player.position.y - animal.y) > LEAD_BREAK) {
          animal.leader = 0
          animal.rope = undefined
          context.drop(animal, animal.id, itemId('rope'), 1)
          continue
        }
        anchor = player.position
      } else {
        animal.rope = undefined
        continue
      }
      const of = `${animal.leader}:${animal.post}`
      if (animal.rope?.of !== of) animal.rope = { of, vx: 0, vy: 0, reach: Math.hypot(anchor.x - animal.x, anchor.y - animal.y) }
      const rope = animal.rope
      const blocked = this.blockedFor(animal, context)
      const force = ropeForce(animal, anchor)
      const speed = ropeStep({ x: rope.vx, y: rope.vy }, force, animal.def.mass)
      const moved = ropeMove(animal, speed, (dx, dy) => moveBox(animal, dx, dy, animal.def.halfSize, blocked))
      animal.x = moved.position.x
      animal.y = moved.position.y
      rope.vx = moved.speed.x
      rope.vy = moved.speed.y
      if (player) {
        const on = onPlayers.get(player.id) ?? { x: 0, y: 0 }
        onPlayers.set(player.id, { x: on.x - force.x, y: on.y - force.y })
        continue
      }
      // A fence holds it within ROPE_HELD (or as far as it was when tied, until it has been drawn in that far).
      const distance = Math.hypot(anchor.x - animal.x, anchor.y - animal.y)
      rope.reach = Math.max(ROPE_HELD, Math.min(rope.reach, distance))
      if (distance > rope.reach) {
        const stretch = distance - rope.reach
        const held = moveBox(
          animal,
          Math.round(((anchor.x - animal.x) / distance) * stretch),
          Math.round(((anchor.y - animal.y) / distance) * stretch),
          animal.def.halfSize,
          blocked,
        )
        animal.x = held.x
        animal.y = held.y
      }
    }
    // Each player pulled by the ropes they hold (and still moving on from a pull: `rope`). Aboard a raft, they keep to
    // its deck.
    for (const player of context.players) {
      const force = onPlayers.get(player.id)
      if (!force && !player.rope) continue
      if (player.aboard) {
        player.rope = undefined
        continue
      }
      const speed = ropeStep(player.rope ?? { x: 0, y: 0 }, force ?? { x: 0, y: 0 }, PLAYER_MASS)
      const moved = ropeMove(player.position, speed, (dx, dy) => moveBox(player.position, dx, dy, PLAYER_HALF_SIZE, context.solidForPlayers))
      player.position = moved.position
      player.rope = moved.speed.x === 0 && moved.speed.y === 0 ? undefined : moved.speed
    }
  }

  // ---- what players do to them

  // An animal is hurt: it loses `amount` hp, is knocked back (`knockback` units, away from `from`) and stunned (`stun`
  // ticks), and runs from `from` (a skittish one's herd with it); a hostile one goes for the player who hurt it (`by`),
  // with its pack, instead. Gives what it drops if that killed it (a grown one: its meat, about as much as its meat
  // stat, and the rest, as in animals.json; a baby nothing; and the rope, if it was on one), or undefined if it lives.
  damage(id: number, amount: number, from: PlayerPosition, tick: number, effects: HitEffects = {}, by = 0): Dropped | undefined {
    const animal = this.all.get(id)
    if (!animal) return undefined
    this.takeBlow(animal, amount, from, tick, effects)
    if (animal.hp > 0) {
      if (animal.def.hunt && !onRope(animal)) {
        // Hurt, it goes for whoever hurt it, and calls the others of its kind near it (even one already on a chase);
        // but first it backs off, and does not bite again until its recoil is over (after any stun).
        if (by !== 0) this.rouse(animal, by, tick, true)
        const until = Math.max(tick, animal.stunnedUntil) + animal.def.hunt.recoil
        animal.recoilUntil = until
        animal.biteReadyAt = Math.max(animal.biteReadyAt, until)
        return undefined
      }
      if (animal.def.temper === 'skittish' && !onRope(animal)) {
        animal.fleeUntil = 0
        this.spookHerd(animal, from, tick)
        animal.fleeUntil += effects.stun ?? 0
        animal.decideAt = animal.fleeUntil
        return undefined
      }
      animal.fleeUntil = tick + (effects.stun ?? 0) + FLEE_TICKS
      const to = this.fleeTo(animal, from, FLEE_DISTANCE)
      animal.goal = { k: 'walk', x: to.x, y: to.y, pace: FLEE_PACE }
      animal.decideAt = animal.fleeUntil
      return undefined
    }
    const drops: Array<[string, number]> = []
    if (onRope(animal)) drops.push(['rope', 1])
    if (isAdult(animal)) {
      for (const drop of animal.def.drops) {
        const key = getItem(drop.item).key
        if (drop.stat !== undefined) drops.push([key, Math.max(1, Math.round(animal.stats[drop.stat] + this.random() - 0.5))])
        else drops.push([key, drop.min + this.rng.nextInt(drop.max - drop.min + 1)])
      }
    }
    return drops
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
      if (onRope(animal)) return { ok: false, why: 'leadTaken' }
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

  // Ties an animal to a fence (see `tie` in the server's commands.ts): on the player's own rope (moved from their hand
  // to the fence), or else on a rope from their things.
  tie(context: CommandContext, id: number, fence: { id: number; x: number; y: number }): CommandOutcome {
    const animal = this.all.get(id)
    const { player } = context
    if (!animal) return { ok: false, why: 'animalGone' }
    const post = fencePost(fence)
    if (Math.hypot(post.x - animal.x, post.y - animal.y) > TIE_REACH) return { ok: false, why: 'tieFar' }
    if (animal.leader !== player.id) {
      if (onRope(animal)) return { ok: false, why: 'leadTaken' }
      if (removeItems(player.inventory, itemId('rope'), 1) === 0) return { ok: false, why: 'noRope' }
    }
    animal.leader = 0
    animal.post = fence.id
    animal.wild = false
    animal.goal = { k: 'idle' }
    return { ok: true }
  }

  // The animal tied to a fence (its entity ID), if one is.
  tiedTo(fence: number): Animal | undefined {
    return this.list().find((animal) => animal.post === fence)
  }

  // Unties the animal tied to a fence, giving the rope to the player (or dropping it, if they have no room).
  untie(context: CommandContext, fence: number): boolean {
    const animal = this.tiedTo(fence)
    if (!animal) return false
    animal.post = 0
    if (addItems(context.player.inventory, itemId('rope'), 1) === 0) giveDrops(context, context.player.position, animal.id, [['rope', 1]])
    return true
  }

  // ---- spawning

  // Keeps each island stocked (see POPULATE_EVERY): in each biome a player is on (or, `everywhere`, every biome, all
  // at once: when the world is made), each kind that lives there with fewer wild ones in it than its `population` asks
  // for gets a herd, now and then (POPULATE_CHANCE; `everywhere`, until it has enough), on open ground of the biome
  // well away from every player (SPAWN_AWAY), so herds are never seen turning up. The kind furthest short goes first.
  populate(context: AnimalContext, everywhere = false): void {
    if (!this.wild) return
    for (const site of context.terrain.sites) {
      if (!everywhere && !context.players.some((player) => biomeSiteAt(context.terrain, tileOfUnits(player.position.x), tileOfUnits(player.position.y)) === site)) continue
      const area = Math.PI * site.radius * site.radius
      const short = ANIMALS.filter((def) => def.population > 0 && def.biomes.includes(site.biome.key))
        .map((def) => ({ def, wanted: Math.round((def.population * area) / 10_000), have: this.wildIn(context, def, site) }))
        .filter((kind) => kind.have < kind.wanted)
        .sort((a, b) => a.have / a.wanted - b.have / b.wanted)
      for (const kind of short) {
        if (!everywhere) {
          if (this.random() * 100 >= POPULATE_CHANCE) continue
          this.herdIn(context, kind.def, site)
          continue
        }
        // At the start, herds until there are enough (or no room is found for one).
        while (kind.have < kind.wanted) {
          const made = this.herdIn(context, kind.def, site)
          if (made === 0) break
          kind.have += made
        }
      }
    }
  }

  // How many wild ones of a kind are in a biome.
  private wildIn(context: AnimalContext, def: AnimalDef, site: BiomeSite): number {
    let count = 0
    for (const animal of this.all.values()) {
      if (animal.wild && animal.def === def && biomeSiteAt(context.terrain, tileOfUnits(animal.x), tileOfUnits(animal.y)) === site) count++
    }
    return count
  }

  // A herd of a kind somewhere in a biome: a tile of it, grown, open, and SPAWN_AWAY tiles from every player (a few
  // tries). Gives how many there are (0 if no place would do).
  private herdIn(context: AnimalContext, def: AnimalDef, site: BiomeSite): number {
    for (let attempt = 0; attempt < POPULATE_TRIES; attempt++) {
      const angle = this.random() * Math.PI * 2
      const reach = Math.sqrt(this.random()) * site.radius
      const tileX = Math.floor(site.x + Math.cos(angle) * reach)
      const tileY = Math.floor(site.y + Math.sin(angle) * reach)
      if (biomeSiteAt(context.terrain, tileX, tileY) !== site || !context.isGrown(chunkOfTile(tileX, tileY))) continue
      const x = tileX * SUB + SUB / 2
      const y = tileY * SUB + SUB / 2
      if (context.players.some((player) => Math.hypot(player.position.x - x, player.position.y - y) < SPAWN_AWAY * SUB)) continue
      if (overlapsSolid({ x, y }, this.blockedFor({ leader: 0 }, context), def.halfSize)) continue
      const made = this.spawnHerd(context, def, x, y)
      if (made > 0) return made
    }
    return 0
  }

  private random(): number {
    return this.rng.nextU32() / 0x1_0000_0000
  }
}

// The pack of a hunter saved before packs, by where it lived: the first one's ID.
function packOf(packs: Map<string, number>, home: string, id: number): number {
  if (!packs.has(home)) packs.set(home, id)
  return packs.get(home)!
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundStat(value: number): number {
  return Math.round(value * 100) / 100
}
