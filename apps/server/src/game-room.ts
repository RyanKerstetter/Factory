import {
  chunkCoords,
  CHUNK_SIZE,
  getItem,
  itemByKey,
  linkFromState,
  linkToState,
  dropFromState,
  entityFromState,
  BUILDINGS,
  hashInts,
  type BuildingKind,
  type DropState,
  type Entity,
  type EntityState,
  dropToState,
  PLAYER_MAX_HEALTH,
  GATE_AUTO,
  hpOf,
  TPS,
  BORDER_HEAT_EVERY,
  BORDER_HEAT_STEP,
  heatFrom,
  waterAt,
  withMachine,
  GATE_SHUT,
  isWithinReach,
  moveBox,
  PLAYER_HALF_SIZE,
  PLAYER_MASS,
  playerOverlapsTile,
  pushApart,
  entityToState,
  isInsideWorld,
  Rng,
  type AnimalPosition,
  chunkDistance,
  NO_ITEM,
  chunkOfTile,
  chunksAround,
  chunksOfWorldEvent,
  createEntity,
  createInventory,
  DEFAULT_PLANT_GENERATION,
  DROP_ITEMS_ON_GROUND,
  DROP_LIFETIME_TICKS,
  PICKUP_DELAY_TICKS,
  PICKUP_RADIUS,
  plantsInChunk,
  flintInChunk,
  itemId,
  NATURAL_DROP_BORN,
  slowIn,
  addItems,
  type PlantGeneration,
  inventoryToWire,
  applyWorldEvent,
  FactoryWorld,
  HASH_INTERVAL,
  MAX_COMMAND_LEAD,
  MAX_INPUTS_PER_TICK,
  MAX_PACKET_CHARS,
  MAX_QUEUED_INPUTS,
  playerInventory,
  PLAYER_SPAWN,
  PUNCH_COOLDOWN_TICKS,
  ReliableReceiver,
  ReliableSender,
  solidIn,
  stepPlayer,
  SUBSCRIBE_RADIUS,
  tileOfUnits,
  UNSUBSCRIBE_RADIUS,
  type ChunkSnapshot,
  type Command,
  type Inventory,
  type LinkResult,
  type LogMessage,
  type PlayerPosition,
  type RequestMessage,
  type StateMessage,
  type StreamEvent,
  type WorldEvent,
} from '../../../packages/shared/src/index.ts'
import { Animals, type AnimalContext } from './animals.ts'
import { Combat } from './combat.ts'
import { giveDrops, runCommand, scatterAt, type CommandContext } from './commands.ts'
import { itemKeys, itemRemap, remapEntity, SAVE_VERSION, type PlayerSave, type WorldSave } from './save.ts'

// How a room reaches one player. The Geckos channel in index.ts, or a pipe straight into a client in the tests.
export type PlayerTransport = {
  sendLog(message: LogMessage): void
  sendState(message: StateMessage): void
}

export type ServerPlayer = {
  readonly id: number
  readonly name: string
  readonly transport: PlayerTransport
  position: PlayerPosition
  inventory: Inventory
  // Movement inputs waiting to be played, [sequence, keys], oldest first; the last one queued and the last played.
  inputs: Array<[number, number]>
  lastQueuedInput: number
  lastPlayedInput: number
  // The chunks this player's client simulates.
  readonly chunks: Set<number>
  // The log to this player, and what has been written to it on the tick being run.
  readonly log: ReliableSender<{ th?: number; ev: StreamEvent[] }>
  outbox: StreamEvent[]
  readonly requests: ReliableReceiver<RequestMessage>
  // Chunks to send again at the end of the tick, because the client's hash did not match.
  readonly resync: Set<number>
  // When each chunk was last sent again for a bad hash, so a client that keeps getting it wrong is not flooded.
  readonly lastResync: Map<number, number>
  // The last tick this player punched on.
  lastPunchTick: number
  // What this player's page has been told about each animal near it (as JSON, to see when it changes).
  readonly animalsSent: Map<number, string>
  // The work station this player has open (0 for none): a station only works while someone is at it.
  using: number
  // The tick the player can attack again (every weapon shares it), and their health.
  attackReadyAt: number
  health: number
}

type QueuedCommand = { tick: number; playerId: number; seq: number; command: Command; late: boolean }

export type GameRoomOptions = {
  // Keep a copy of each chunk at the ticks its hash is sent, so a client that disagrees can be shown the server's
  // copy to compare with (development only: it costs a snapshot per chunk per HASH_INTERVAL).
  keepDumps?: boolean
  // Grow trees and bushes in each chunk the first time a player comes near it (on unless turned off; the factory's
  // tests turn it off so their buildings have the ground to themselves).
  plants?: boolean
  // How much grows, where it differs from DEFAULT_PLANT_GENERATION.
  plantGeneration?: Partial<PlantGeneration>
  // Whether what a punch knocks loose lands on the ground to be picked up (DROP_ITEMS_ON_GROUND unless given), or goes
  // straight into the puncher's inventory.
  dropsOnGround?: boolean
  // The world's name, as the menu shows it.
  name?: string
  // Whether animals spawn, wander and breed (on wherever plants grow, unless given), and whether wild herds turn up by
  // themselves (on unless turned off, for tests that put their own animals down).
  animals?: boolean
  wildAnimals?: boolean
}

// How many entities and links go in one part of a chunk snapshot, so no part is too long to send.
const SNAPSHOT_ENTITIES_PER_PART = 50
const SNAPSHOT_LINKS_PER_PART = 200
const SNAPSHOT_DROPS_PER_PART = 200
// Something a player put down that has been hit heals, once it has gone HEAL_DELAY_TICKS without being hit: a point of
// hp every HEAL_EVERY_TICKS, back to whole (when its health bar goes away).
const HEAL_DELAY_TICKS = 6 * TPS
const HEAL_EVERY_TICKS = 10
// Grass spreads: every GRASS_SPREAD_TICKS, each chunk someone is near grows a tuft beside one it has (or, with none,
// anywhere in it), up to GRASS_MAX_PER_CHUNK tufts. Animals graze it away; this brings it back.
// Berry bushes come back too, slowly, so a world can never run out of them: every BERRY_SPREAD_TICKS, each chunk
// someone is near (with fewer than BERRY_MAX_PER_CHUNK bushes) grows a berry sprout beside a bush it has, in a patch of
// fewer than BERRY_PATCH_MAX; or, with none, somewhere in it. The sprout grows into a bush over its random ticks.
// Neither grows within WILD_KEEP_CLEAR tiles of anything a player has put down, so farms and bases are not overgrown.
const GRASS_SPREAD_TICKS = 40
const GRASS_MAX_PER_CHUNK = 40
const BERRY_SPREAD_TICKS = 60 * TPS
const BERRY_MAX_PER_CHUNK = 12
const BERRY_PATCH_MAX = 5
const WILD_KEEP_CLEAR = 4
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
]
// How many of each chunk's dumps are kept.
const DUMPS_KEPT = 4
// The fewest ticks between two resyncs of the same chunk for the same client.
const RESYNC_COOLDOWN = HASH_INTERVAL

// One game: its world, its players, and the tick that moves them on.
//
// Each tick:
//   1. every player's movement inputs are played;
//   2. the commands due on this tick run, in order of (tick, player, sequence), and what they change is logged;
//   3. phase A: every chunk moves its own buildings on;
//   4. phase B: the links move items between buildings; a result is logged to each client that simulates exactly
//      one end of the link (one that simulates both works it out itself);
//   5. phase C: chunk hashes are sent, clients start and stop simulating chunks as they move, and each client gets
//      its batch of the log for the tick, and where everyone is.
export class GameRoom {
  readonly world = new FactoryWorld()
  tick = 0
  // When the room last had no players, for closing rooms nobody uses.
  emptySince: number | undefined = Date.now()
  private nextEntity = 1
  private nextLink = 1
  private nextPlayer = 1
  private readonly players = new Map<number, ServerPlayer>()
  private commands: QueuedCommand[] = []
  private readonly subscribers = new Map<number, Set<ServerPlayer>>()
  private readonly dumps = new Map<number, Array<{ tick: number; snapshot: ChunkSnapshot }>>()
  private readonly keepDumps: boolean
  private readonly plants: boolean
  private readonly plantGeneration: PlantGeneration
  private readonly dropsOnGround: boolean
  private nextDrop = 1
  // The buildings that have been hit and not healed yet, and the tick each was last hit; and whether the hp being set
  // is healing (which is not a hit).
  private readonly hurt = new Map<number, number>()
  private healing = false
  // The work stations that have been started, to stop when nobody is at them.
  private readonly working = new Set<number>()
  // The animals, run here only (see animals.ts), if this game has them.
  readonly animals: Animals | undefined
  // Attacks, and the arrows, stones and spears in flight.
  readonly combat: Combat
  // Random numbers for what the room does by itself (grass spreading).
  private readonly rng: Rng
  // What slows players down (bushes).
  private readonly slow = slowIn(this.world)
  // The chunks whose plants have been grown, and the block of IDs each chunk's plants and flint were given.
  private readonly grown = new Set<number>()
  private readonly generated = new Map<number, { entity: number; plants: number; drop: number; flint: number }>()
  // What loading a save had to say (a chunk grown differently than when it was saved), for the server's log.
  readonly loadWarnings: string[] = []
  // What players cannot walk into.
  private readonly solid = solidIn(this.world, () => this.seed)
  // The world's name.
  readonly name: string
  // Everyone who has played here and is not here now, by name (lower case): where they were and what they had, for
  // when they come back.
  private readonly savedPlayers = new Map<string, PlayerSave>()

  constructor(readonly code: string, readonly seed: number, options: GameRoomOptions = {}) {
    this.name = options.name ?? code
    this.keepDumps = options.keepDumps ?? false
    this.plants = options.plants ?? true
    this.plantGeneration = { ...DEFAULT_PLANT_GENERATION, ...options.plantGeneration }
    this.dropsOnGround = options.dropsOnGround ?? DROP_ITEMS_ON_GROUND
    this.animals = (options.animals ?? this.plants) ? new Animals(seed, options.wildAnimals ?? true) : undefined
    this.rng = new Rng((seed ^ 0x6a55) >>> 0)
    this.combat = new Combat(this.world, this.animals, this.solid)
  }

  get playerCount(): number {
    return this.players.size
  }

  get playerNames(): string[] {
    return [...this.players.values()].map((player) => player.name)
  }

  // Whether someone of that name (in any case) is in the game now: two players cannot share a name, since a name is
  // what links a player to what they had (see `join`).
  hasPlayerNamed(name: string): boolean {
    const key = name.toLowerCase()
    return [...this.players.values()].some((player) => player.name.toLowerCase() === key)
  }

  // ---- players

  join(name: string, transport: PlayerTransport): ServerPlayer {
    const player: ServerPlayer = {
      id: this.nextPlayer++,
      name,
      transport,
      position: { ...PLAYER_SPAWN },
      inventory: playerInventory(),
      inputs: [],
      lastQueuedInput: 0,
      lastPlayedInput: 0,
      chunks: new Set(),
      log: new ReliableSender((message) => transport.sendLog(message)),
      outbox: [],
      requests: new ReliableReceiver(),
      resync: new Set(),
      lastResync: new Map(),
      lastPunchTick: -PUNCH_COOLDOWN_TICKS,
      animalsSent: new Map(),
      using: 0,
      attackReadyAt: 0,
      health: PLAYER_MAX_HEALTH,
    }
    // Someone who has played here before comes back where they were, with what they had.
    const saved = this.savedPlayers.get(name.toLowerCase())
    if (saved) {
      this.savedPlayers.delete(name.toLowerCase())
      player.position = { x: saved.x, y: saved.y }
      player.health = saved.health
      saved.inventory.forEach((slot, i) => {
        const item = slot ? itemByKey(slot[0]) : undefined
        if (item && i < player.inventory.slots.length) Object.assign(player.inventory.slots[i], { item: item.id, count: slot![1] })
      })
    }
    this.players.set(player.id, player)
    this.emptySince = undefined
    // The client starts on the tick that has just been run: the chunks it is sent are as they are at its end.
    player.outbox.push({ k: 'welcome', tick: this.tick, playerId: player.id, seed: this.seed, code: this.code, name: this.name })
    player.outbox.push({ k: 'pinv', tick: this.tick, inv: inventoryToWire(player.inventory) })
    this.updateChunks(player, this.tick)
    this.sendRoster()
    this.flush(player, this.tick)
    return player
  }

  leave(player: ServerPlayer): void {
    if (!this.players.delete(player.id)) return
    this.savedPlayers.set(player.name.toLowerCase(), playerSave(player))
    // Animals they were leading are let go.
    for (const animal of this.animals?.list() ?? []) if (animal.leader === player.id) animal.leader = 0
    for (const chunk of player.chunks) this.subscribersOf(chunk).delete(player)
    player.chunks.clear()
    this.commands = this.commands.filter((queued) => queued.playerId !== player.id)
    if (this.players.size === 0) this.emptySince = Date.now()
    this.sendRoster()
    for (const other of this.players.values()) this.flush(other, this.tick)
  }

  // A request off the wire. Returns the answer to send back: the last request the room has everything up to.
  receiveRequest(player: ServerPlayer, message: RequestMessage): number {
    for (const { s, r } of player.requests.receive(message)) {
      if (r.k === 'cmd') {
        // A command that arrives after its tick runs on the next one. One stamped too far ahead is turned down.
        const next = this.tick + 1
        const late = r.tick > this.tick + MAX_COMMAND_LEAD
        this.commands.push({ tick: late ? next : Math.max(next, r.tick), playerId: player.id, seq: s, command: r.c, late })
      } else if (player.chunks.has(r.chunk)) {
        const last = player.lastResync.get(r.chunk)
        if (last === undefined || this.tick - last >= RESYNC_COOLDOWN) {
          player.lastResync.set(r.chunk, this.tick)
          this.resendChunk(player, r.chunk)
          if (this.keepDumps) {
            const dump = this.dumps.get(r.chunk)?.find((entry) => entry.tick === r.tick)?.snapshot ?? null
            player.outbox.push({ k: 'dump', tick: this.tick + 1, chunk: r.chunk, at: r.tick, dump })
          }
        }
      }
    }
    return player.requests.acknowledged
  }

  // Sends a chunk the player simulates again, as it is at the end of the next tick, in place of the player's copy.
  resendChunk(player: ServerPlayer, chunk: number): void {
    if (player.chunks.has(chunk)) player.resync.add(chunk)
  }

  receiveInputs(player: ServerPlayer, inputs: ReadonlyArray<[number, number]>): void {
    for (const [seq, keys] of inputs) {
      if (seq <= player.lastQueuedInput) continue
      player.inputs.push([seq, keys])
      player.lastQueuedInput = seq
    }
    if (player.inputs.length > MAX_QUEUED_INPUTS) player.inputs.splice(0, player.inputs.length - MAX_QUEUED_INPUTS)
  }

  receiveLogAck(player: ServerPlayer, seq: number): void {
    player.log.acknowledge(seq)
  }

  // Sends again whatever log messages have not been answered in time.
  resend(now = performance.now()): void {
    for (const player of this.players.values()) player.log.resend(now)
  }

  // ---- the tick

  step(): void {
    const tick = this.tick + 1
    const players = [...this.players.values()]

    // 1. Movement. A player whose client has sent extra inputs (its clock runs fast, or a burst arrived together)
    // catches up a little faster, but never more than MAX_INPUTS_PER_TICK a tick.
    for (const player of players) {
      const plays = Math.min(player.inputs.length, player.inputs.length > 3 ? MAX_INPUTS_PER_TICK : 1)
      for (let i = 0; i < plays; i++) {
        const [seq, keys] = player.inputs.shift()!
        player.position = stepPlayer(player.position, keys, this.solid, this.slow)
        player.lastPlayedInput = seq
      }
    }

    // 1a. Players on top of each other are pushed apart.
    this.pushPlayersApart(players)

    // 1b. Players pick up what they walk over, and what has lain too long is gone.
    for (const player of players) this.pickUp(player, tick)
    if (tick % HASH_INTERVAL === 0) {
      for (const drop of this.world.allDrops()) {
        if (drop.born !== NATURAL_DROP_BORN && tick - drop.born > DROP_LIFETIME_TICKS) this.logWorldEvent({ t: 'drop-', id: drop.id }, tick)
      }
    }

    // 2. Commands.
    const due = this.commands.filter((queued) => queued.tick <= tick)
    this.commands = this.commands.filter((queued) => queued.tick > tick)
    due.sort((a, b) => a.tick - b.tick || a.playerId - b.playerId || a.seq - b.seq)
    for (const queued of due) this.run(queued, tick)

    // 2b. The animals, and the grass they eat; work stations nobody is at stop; a shut gate a player walks over goes
    // back to opening by itself. What they change is logged like a command's.
    this.animals?.step(this.animalContext(tick))
    this.animals?.remember(tick)
    this.combat.step({
      tick,
      emit: (event) => this.logWorldEvent(event, tick),
      dropAt: (item, count, x, y) => this.logWorldEvent({ t: 'drop+', d: dropToState({ id: this.nextDrop++, item, count, x, y, born: tick }) }, tick),
      stick: (item, x, y) => {
        const tileX = tileOfUnits(x)
        const tileY = tileOfUnits(y)
        if (this.world.entityAt(tileX, tileY) || waterAt(this.seed, tileX, tileY) || !this.world.hasChunk(chunkOfTile(tileX, tileY))) return false
        this.logWorldEvent({ t: 'add', e: entityToState(createEntity(this.nextEntity++, 'loose', tileX, tileY, 0, item)) }, tick)
        return true
      },
      dropRound: (middle, salt, drops) =>
        giveDrops(
          {
            ...this.animalCommandContext(tick),
            drops: { nextId: () => this.nextDrop++, solid: this.solid },
          },
          middle,
          salt,
          drops,
        ),
    })
    this.spreadGrass(tick)
    this.spreadBorderHeat(tick)
    this.heal(tick)
    this.stopUnattendedStations(players, tick)
    this.resetGates(players, tick)

    // 3. Phase A.
    this.world.stepInterior(tick, this.seed)

    // 4. Phase B.
    const results: LinkResult[] = []
    this.world.exchange(undefined, results)
    for (const result of results) this.logLinkResult(result, tick)

    this.tick = tick

    // 5. Phase C.
    for (const chunk of this.world.chunkIds) {
      if ((tick + chunk) % HASH_INTERVAL !== 0) continue
      const subscribers = this.subscribers.get(chunk)
      if (!subscribers || subscribers.size === 0) continue
      const hash = this.world.hashChunk(chunk)
      for (const player of subscribers) player.outbox.push({ k: 'hash', tick, chunk, hash })
      if (this.keepDumps) {
        const kept = this.dumps.get(chunk) ?? []
        kept.push({ tick, snapshot: this.world.snapshotChunk(chunk) })
        this.dumps.set(chunk, kept.slice(-DUMPS_KEPT))
      }
    }
    const animalPositions = new Map<number, AnimalPosition[]>()
    for (const player of players) {
      this.updateChunks(player, tick)
      animalPositions.set(player.id, this.syncAnimals(player))
      this.flush(player, tick)
    }
    const positions: Array<[number, number, number]> = players.map((player) => [player.id, player.position.x, player.position.y])
    for (const player of players) {
      const near = animalPositions.get(player.id) ?? []
      const flying = this.combat.inChunks(player.chunks, tick)
      player.transport.sendState({
        t: tick,
        s: player.log.lastSeq,
        a: player.lastPlayedInput,
        p: positions,
        h: player.health,
        ...(near.length > 0 ? { n: near } : {}),
        ...(flying.length > 0 ? { j: flying } : {}),
      })
    }
  }

  private run(queued: QueuedCommand, tick: number): void {
    const player = this.players.get(queued.playerId)
    if (!player) return
    if (queued.late) {
      player.outbox.push({ k: 'result', tick, seq: queued.seq, ok: false, why: 'late' })
      return
    }
    const before = inventoryToWire(player.inventory).join()
    const outcome = runCommand(
      {
        world: this.world,
        seed: this.seed,
        tick,
        player,
        emit: (event) => this.logWorldEvent(event, tick),
        nextEntityId: () => this.nextEntity++,
        nextLinkId: () => this.nextLink++,
        ...(this.dropsOnGround ? { drops: { nextId: () => this.nextDrop++, solid: this.solid } } : {}),
        ...(this.animals ? { animals: this.animals } : {}),
        combat: this.combat,
        players: () => [...this.players.values()].map((other) => other.position),
        onWork: (id) => this.working.add(id),
      },
      queued.command,
    )
    player.outbox.push(
      outcome.ok
        ? { k: 'result', tick, seq: queued.seq, ok: true, ...(outcome.moved !== undefined ? { moved: outcome.moved } : {}) }
        : { k: 'result', tick, seq: queued.seq, ok: false, why: outcome.why },
    )
    const after = inventoryToWire(player.inventory)
    if (after.join() !== before) player.outbox.push({ k: 'pinv', tick, inv: after })
  }

  // A change a command made: applied here, and logged to every client that simulates a chunk it touches.
  private logWorldEvent(event: WorldEvent, tick: number): void {
    if (event.t === 'hp' && !this.healing) {
      const entity = this.world.entity(event.id)
      if (entity && BUILDINGS[entity.kind].breakable && event.hp < hpOf(entity)) this.hurt.set(event.id, tick)
    }
    const chunks = chunksOfWorldEvent(this.world, event)
    applyWorldEvent(this.world, event)
    const told = new Set<ServerPlayer>()
    for (const chunk of chunks) {
      for (const player of this.subscribers.get(chunk) ?? []) {
        if (told.has(player)) continue
        told.add(player)
        player.outbox.push({ k: 'world', tick, ev: event })
      }
    }
  }

  // A link's result goes to each client that simulates one end of it and not the other.
  private logLinkResult(result: LinkResult, tick: number): void {
    const link = this.world.link(result.link)
    if (!link || link.fromChunk === link.toChunk) return
    const from = this.subscribers.get(link.fromChunk)
    const to = this.subscribers.get(link.toChunk)
    for (const player of from ?? []) {
      if (!to?.has(player)) player.outbox.push({ k: 'link', tick, r: result })
    }
    for (const player of to ?? []) {
      if (!from?.has(player)) player.outbox.push({ k: 'link', tick, r: result })
    }
  }

  // Starts and stops the player's client simulating chunks as the player moves: the chunks within SUBSCRIBE_RADIUS
  // of the player's are sent as they are now, and those further than UNSUBSCRIBE_RADIUS are let go.
  private updateChunks(player: ServerPlayer, tick: number): void {
    const centre = chunkOfTile(tileOfUnits(player.position.x), tileOfUnits(player.position.y))
    for (const chunk of [...player.chunks].sort((a, b) => a - b)) {
      if (chunkDistance(centre, chunk) <= UNSUBSCRIBE_RADIUS) continue
      player.chunks.delete(chunk)
      this.subscribersOf(chunk).delete(player)
      player.resync.delete(chunk)
      player.outbox.push({ k: 'unload', tick, chunk })
    }
    for (const chunk of chunksAround(centre, SUBSCRIBE_RADIUS)) {
      if (player.chunks.has(chunk)) continue
      player.chunks.add(chunk)
      this.subscribersOf(chunk).add(player)
      this.growPlants(chunk)
      this.pushSnapshot(player, chunk, tick)
    }
    for (const chunk of [...player.resync].sort((a, b) => a - b)) {
      if (player.chunks.has(chunk)) this.pushSnapshot(player, chunk, tick)
    }
    player.resync.clear()
  }

  // Grows a chunk's first trees, bushes and rocks, and lays its flint on the ground (see world-gen.ts), the first time
  // anyone comes near it. Nobody simulates the chunk yet, so they go straight into the world and reach clients in the
  // chunk's snapshot.
  private growPlants(chunk: number): void {
    if (this.grown.has(chunk)) return
    this.grown.add(chunk)
    if (!this.plants) return
    // Each plant and piece of flint grown gets the next ID in a block of the chunk's own, one for each the seed would
    // grow there (one on a tile already taken is not grown, but keeps its ID), so a save can grow them again with the
    // same IDs and keep only what has changed since (see `exportSave`).
    const block = { entity: this.nextEntity, plants: 0, drop: this.nextDrop, flint: 0 }
    const grown = generatedIn(this.seed, chunk, this.plantGeneration)
    block.plants = grown.entities.length
    block.flint = grown.drops.length
    this.nextEntity += block.plants
    this.nextDrop += block.flint
    for (const state of grown.entities) {
      const entity = entityFromState({ ...state, id: block.entity + state.id })
      if (!this.world.entityAt(entity.x, entity.y)) this.world.addEntity(entity)
    }
    for (const state of grown.drops) this.world.addDrop(dropFromState([block.drop + state[0], ...state.slice(1)] as DropState))
    this.generated.set(chunk, block)
    this.animals?.chunkGrown(this.animalContext(this.tick), chunkCoords(chunk))
  }

  // Players on top of each other are pushed apart, as animals are (see `pushApart`).
  private pushPlayersApart(players: readonly ServerPlayer[]): void {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i]
        const b = players[j]
        const push = pushApart(a.position, PLAYER_HALF_SIZE, PLAYER_MASS, b.position, PLAYER_HALF_SIZE, PLAYER_MASS)
        if (!push) continue
        a.position = moveBox(a.position, push.a.x, push.a.y, PLAYER_HALF_SIZE, this.solid)
        b.position = moveBox(b.position, push.b.x, push.b.y, PLAYER_HALF_SIZE, this.solid)
      }
    }
  }

  // A work station only works while a player who has it open is in reach of it.
  private stopUnattendedStations(players: readonly ServerPlayer[], tick: number): void {
    for (const id of [...this.working].sort((a, b) => a - b)) {
      const station = this.world.entity(id)
      if (!station || (station.kind !== 'stump' && station.kind !== 'workbench') || station.active === 0) {
        this.working.delete(id)
        continue
      }
      if (players.some((player) => player.using === id && isWithinReach(player.position, station.x, station.y))) continue
      this.working.delete(id)
      const state = entityToState(station)
      if (state.kind === 'stump') this.logWorldEvent({ t: 'set', e: { ...state, active: 0 } }, tick)
      else if (station.kind === 'workbench') this.logWorldEvent({ t: 'set', e: withMachine(station, { active: 0 }) }, tick)
    }
  }

  // The heat each barrel and drying rack gets from campfires in other chunks (which a page simulating its chunk may
  // not have), worked out every BORDER_HEAT_EVERY ticks and sent, rounded down to BORDER_HEAT_STEP, when it changes.
  private spreadBorderHeat(tick: number): void {
    if (tick % BORDER_HEAT_EVERY !== 0) return
    for (const chunk of this.world.chunkIds) {
      for (const entity of this.world.chunk(chunk)?.entities ?? []) {
        if (entity.kind !== 'barrel' && entity.kind !== 'rack') continue
        let heat = 0
        for (let y = entity.y - 2; y <= entity.y + 2; y++) {
          for (let x = entity.x - 2; x <= entity.x + 2; x++) {
            if (chunkOfTile(x, y) === chunk) continue
            const fire = this.world.entityAt(x, y)
            if (fire?.kind === 'campfire') heat = Math.max(heat, heatFrom(fire.heat, Math.max(Math.abs(x - entity.x), Math.abs(y - entity.y))))
          }
        }
        heat -= heat % BORDER_HEAT_STEP
        if (heat !== entity.border) this.logWorldEvent({ t: 'border', id: entity.id, heat }, tick)
      }
    }
  }

  // Buildings heal (see HEAL_DELAY_TICKS).
  private heal(tick: number): void {
    if (tick % HEAL_EVERY_TICKS !== 0) return
    this.healing = true
    for (const [id, lastHit] of [...this.hurt].sort((a, b) => a[0] - b[0])) {
      const entity = this.world.entity(id)
      const max = entity ? BUILDINGS[entity.kind].maxHp : 0
      if (!entity || hpOf(entity) >= max) {
        this.hurt.delete(id)
        continue
      }
      if (tick - lastHit < HEAL_DELAY_TICKS) continue
      this.logWorldEvent({ t: 'hp', id, hp: hpOf(entity) + 1 }, tick)
    }
    this.healing = false
  }

  // A gate shut by hand goes back to opening by itself once a player walks over it.
  private resetGates(players: readonly ServerPlayer[], tick: number): void {
    for (const player of players) {
      const tileX = tileOfUnits(player.position.x)
      const tileY = tileOfUnits(player.position.y)
      for (let y = tileY - 1; y <= tileY + 1; y++) {
        for (let x = tileX - 1; x <= tileX + 1; x++) {
          const gate = this.world.entityAt(x, y)
          if (gate?.kind !== 'gate' || gate.mode !== GATE_SHUT || !playerOverlapsTile(player.position, x, y)) continue
          this.logWorldEvent({ t: 'set', e: { id: gate.id, kind: 'gate', x, y, dir: gate.dir, hp: gate.hp, mode: GATE_AUTO } }, tick)
        }
      }
    }
  }

  // ---- saving

  // The world as it is now, to write to disk or export (see save.ts). A rope on an animal is put back in its leader's
  // things in the save (players come back as new players, so they cannot pick the rope up where it was).
  exportSave(now = Date.now()): WorldSave {
    const players: Record<string, PlayerSave> = {}
    for (const [name, saved] of this.savedPlayers) players[name] = saved
    for (const player of this.players.values()) players[player.name.toLowerCase()] = playerSave(player)
    for (const animal of this.animals?.list() ?? []) {
      const leader = animal.leader ? this.players.get(animal.leader) : undefined
      const saved = leader ? players[leader.name.toLowerCase()] : undefined
      if (!saved) continue
      const free = saved.inventory.findIndex((slot) => slot === null)
      if (free >= 0) saved.inventory[free] = ['rope', 1]
    }
    return {
      version: SAVE_VERSION,
      code: this.code,
      name: this.name,
      seed: this.seed,
      savedAt: now,
      tick: this.tick,
      next: { entity: this.nextEntity, link: this.nextLink, drop: this.nextDrop },
      grown: [...this.grown].sort((a, b) => a - b),
      items: itemKeys(),
      generation: this.plantGeneration,
      generated: [...this.generated].sort((a, b) => a[0] - b[0]).map(([chunk, block]) => [
        chunk,
        block.entity,
        block.plants,
        block.drop,
        block.flint,
        generatedIn(this.seed, chunk, this.plantGeneration).checksum,
      ]),
      chunks: this.changedChunks(),
      links: [...this.world.linkIds].map((id) => linkToState(this.world.link(id)!)),
      ...(this.animals ? { animals: this.animals.toSave() } : {}),
      players,
    }
  }

  // A room for a saved world, as it was saved (the code it was saved with, unless another is given).
  static fromSave(save: WorldSave, options: GameRoomOptions = {}, code = save.code): GameRoom {
    // Grown again as it was grown: with the rates it was saved with.
    const room = new GameRoom(code, save.seed, { ...options, name: save.name, ...(save.generation ? { plantGeneration: save.generation } : {}) })
    room.loadSave(save)
    return room
  }

  // Each chunk as saved: what is in it that the seed would not grow again just as it is (built, changed, or grown
  // since), and the IDs of what the seed grew that is gone. A chunk nobody has touched is not saved at all.
  private changedChunks(): WorldSave['chunks'] {
    const chunks = [...new Set([...this.world.chunkIds, ...this.generated.keys()])].sort((a, b) => a - b)
    const saved: WorldSave['chunks'] = []
    for (const chunk of chunks) {
      const { entities, drops } = this.world.snapshotChunk(chunk)
      const block = this.generated.get(chunk)
      const pristine = new Map<number, string>()
      const pristineDrops = new Map<number, string>()
      if (block) {
        const grown = generatedIn(this.seed, chunk, this.plantGeneration)
        for (const state of grown.entities) pristine.set(block.entity + state.id, JSON.stringify({ ...state, id: block.entity + state.id }))
        for (const state of grown.drops) pristineDrops.set(block.drop + state[0], JSON.stringify([block.drop + state[0], ...state.slice(1)]))
      }
      const changed = entities.filter((state) => pristine.get(state.id) !== JSON.stringify(state))
      const changedDrops = drops.filter((state) => pristineDrops.get(state[0]) !== JSON.stringify(state))
      const removed = [...pristine.keys()].filter((id) => !this.world.entity(id))
      const removedDrops = [...pristineDrops.keys()].filter((id) => !this.world.drop(id))
      if (changed.length === 0 && changedDrops.length === 0 && removed.length === 0 && removedDrops.length === 0) continue
      saved.push({
        chunk,
        entities: changed,
        drops: changedDrops,
        ...(removed.length > 0 ? { removed } : {}),
        ...(removedDrops.length > 0 ? { removedDrops } : {}),
      })
    }
    return saved
  }

  private loadSave(save: WorldSave): void {
    const remap = itemRemap(save.items)
    this.tick = save.tick
    this.nextEntity = save.next.entity
    this.nextLink = save.next.link
    this.nextDrop = save.next.drop
    for (const chunk of save.grown) this.grown.add(chunk)
    // What the seed grows in each chunk, less what was taken away and what was saved changed; and what was saved.
    const saved = new Map(save.chunks.map((chunk) => [chunk.chunk, chunk]))
    const generated = new Map((save.generated ?? []).map(([chunk, entity, plants, drop, flint, checksum]) => [chunk, { entity, plants, drop, flint, checksum }]))
    for (const chunk of [...new Set([...generated.keys(), ...saved.keys()])].sort((a, b) => a - b)) {
      const kept = saved.get(chunk)
      const entities = (kept?.entities ?? []).map((state) => remapEntity(state, remap))
      const drops = (kept?.drops ?? [])
        .map(([id, item, count, x, y, born]): DropState => [id, remap(item), count, x, y, born])
        .filter((drop) => drop[1] !== 0)
      const block = generated.get(chunk)
      if (block) {
        this.generated.set(chunk, { entity: block.entity, plants: block.plants, drop: block.drop, flint: block.flint })
        const grown = generatedIn(this.seed, chunk, this.plantGeneration)
        if (grown.checksum !== block.checksum || grown.entities.length !== block.plants || grown.drops.length !== block.flint) {
          this.loadWarnings.push(`chunk ${chunk} grows differently now than when it was saved (the world generator or its data changed)`)
        }
        const gone = new Set([...(kept?.removed ?? []), ...entities.map((state) => state.id)])
        const goneDrops = new Set([...(kept?.removedDrops ?? []), ...drops.map((state) => state[0])])
        const taken = new Set(entities.map((state) => `${state.x},${state.y}`))
        for (const state of grown.entities.slice(0, block.plants)) {
          const id = block.entity + state.id
          if (!gone.has(id) && !taken.has(`${state.x},${state.y}`)) entities.push({ ...state, id })
        }
        for (const state of grown.drops.slice(0, block.flint)) {
          const id = block.drop + state[0]
          if (!goneDrops.has(id)) drops.push([id, ...state.slice(1)] as DropState)
        }
      }
      this.world.loadChunk({ chunk, entities, links: [], drops })
    }
    for (const link of save.links) this.world.addLink(linkFromState(link))
    if (save.animals) this.animals?.loadSave(save.animals)
    for (const [name, player] of Object.entries(save.players)) this.savedPlayers.set(name.toLowerCase(), player)
  }

  // A command context with no player behind it, for what lands on the ground by itself (an animal shot dead).
  private animalCommandContext(tick: number): CommandContext {
    return {
      world: this.world,
      seed: this.seed,
      tick,
      player: { id: 0, position: { x: 0, y: 0 }, inventory: createInventory(0), lastPunchTick: 0, using: 0, attackReadyAt: 0 },
      emit: (event) => this.logWorldEvent(event, tick),
      nextEntityId: () => this.nextEntity++,
      nextLinkId: () => this.nextLink++,
    }
  }

  // What the animals need from the room on a tick.
  private animalContext(tick: number): AnimalContext {
    const emit = (event: WorldEvent): void => this.logWorldEvent(event, tick)
    return {
      world: this.world,
      seed: this.seed,
      tick,
      emit,
      drop: (middle, salt, item, count) =>
        scatterAt({ seed: this.seed, tick, emit }, { nextId: () => this.nextDrop++, solid: this.solid }, middle, salt, item, count),
      players: [...this.players.values()],
      isGrown: (chunk) => this.grown.has(chunk),
      solidForPlayers: this.solid,
    }
  }

  // Tells a player's page about the animals near it that it has not been told about, or that have changed, and that
  // the ones it knew of that are no longer near are gone. Gives where the near ones are, for the state message.
  private syncAnimals(player: ServerPlayer): AnimalPosition[] {
    if (!this.animals) return []
    const near = this.animals.inChunks(player.chunks)
    const seen = new Set<number>()
    for (const animal of near) {
      seen.add(animal.id)
      const info = this.animals.info(animal)
      const key = JSON.stringify(info)
      if (player.animalsSent.get(animal.id) === key) continue
      player.animalsSent.set(animal.id, key)
      player.outbox.push({ k: 'animal', a: info })
    }
    for (const id of [...player.animalsSent.keys()]) {
      if (seen.has(id)) continue
      player.animalsSent.delete(id)
      player.outbox.push({ k: 'animal-', id })
    }
    return near.map((animal) => this.animals!.position(animal))
  }

  // Grass grows back (see GRASS_SPREAD_TICKS), in the chunks players are near.
  private spreadGrass(tick: number): void {
    if (!this.plants) return
    if (tick % GRASS_SPREAD_TICKS === 0) this.spreadWild(tick, ['grass'], 'grass', GRASS_MAX_PER_CHUNK, 0)
    if (tick % BERRY_SPREAD_TICKS === 0) this.spreadWild(tick, ['bush', 'sprout'], 'sprout', BERRY_MAX_PER_CHUNK, BERRY_PATCH_MAX)
  }

  // In each chunk someone is near with fewer than `max` of `kinds`, one more (as `grows`): beside one it has, or with
  // none, anywhere in it. Not on water, in the clearing round the spawn, or near anything a player put down; and, with a
  // `patch` size, not beside one that is already in a patch that big.
  private spreadWild(tick: number, kinds: readonly BuildingKind[], grows: BuildingKind, max: number, patch: number): void {
    const clearing = this.plantGeneration.spawnClearing
    const near = (x: number, y: number, radius: number, test: (entity: Entity) => boolean): number => {
      let found = 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const entity = this.world.entityAt(x + dx, y + dy)
          if (entity && test(entity)) found++
        }
      }
      return found
    }
    for (const chunk of [...this.subscribers.keys()].sort((a, b) => a - b)) {
      if (!this.subscribers.get(chunk)?.size) continue
      const wild = (this.world.chunk(chunk)?.entities ?? []).filter((entity) => kinds.includes(entity.kind))
      if (wild.length >= max) continue
      let x: number
      let y: number
      if (wild.length > 0) {
        const from = wild[this.rng.nextInt(wild.length)]
        const [dx, dy] = NEIGHBOURS[this.rng.nextInt(NEIGHBOURS.length)]
        x = from.x + dx
        y = from.y + dy
        if (patch > 0 && near(from.x, from.y, 2, (entity) => kinds.includes(entity.kind)) >= patch) continue
      } else {
        const { cx, cy } = chunkCoords(chunk)
        x = cx * CHUNK_SIZE + this.rng.nextInt(CHUNK_SIZE)
        y = cy * CHUNK_SIZE + this.rng.nextInt(CHUNK_SIZE)
      }
      if (!isInsideWorld(x, y) || chunkOfTile(x, y) !== chunk || this.world.entityAt(x, y) || waterAt(this.seed, x, y)) continue
      if (Math.abs(x) <= clearing && Math.abs(y) <= clearing) continue
      if (near(x, y, WILD_KEEP_CLEAR, (entity) => !BUILDINGS[entity.kind].natural) > 0) continue
      this.logWorldEvent({ t: 'add', e: entityToState(createEntity(this.nextEntity++, grows, x, y, 0, NO_ITEM)) }, tick)
    }
  }

  // A player picks up every item on the ground within PICKUP_RADIUS that has lain there PICKUP_DELAY_TICKS, as much of
  // it as fits; what does not fit stays where it is.
  private pickUp(player: ServerPlayer, tick: number): void {
    const { x, y } = player.position
    let changed = false
    for (const chunk of chunksAround(chunkOfTile(tileOfUnits(x), tileOfUnits(y)), 1)) {
      for (const drop of this.world.dropsInChunk(chunk)) {
        if (tick - drop.born < PICKUP_DELAY_TICKS) continue
        if ((drop.x - x) ** 2 + (drop.y - y) ** 2 > PICKUP_RADIUS * PICKUP_RADIUS) continue
        const taken = addItems(player.inventory, drop.item, drop.count)
        if (taken === 0) continue
        changed = true
        this.logWorldEvent(taken === drop.count ? { t: 'drop-', id: drop.id } : { t: 'drop=', id: drop.id, count: drop.count - taken }, tick)
      }
    }
    if (changed) player.outbox.push({ k: 'pinv', tick, inv: inventoryToWire(player.inventory) })
  }

  private pushSnapshot(player: ServerPlayer, chunk: number, tick: number): void {
    const { entities, links, drops } = this.world.snapshotChunk(chunk)
    const parts = Math.max(
      1,
      Math.ceil(entities.length / SNAPSHOT_ENTITIES_PER_PART),
      Math.ceil(links.length / SNAPSHOT_LINKS_PER_PART),
      Math.ceil(drops.length / SNAPSHOT_DROPS_PER_PART),
    )
    for (let part = 0; part < parts; part++) {
      player.outbox.push({
        k: 'chunk',
        tick,
        chunk,
        entities: entities.slice(part * SNAPSHOT_ENTITIES_PER_PART, (part + 1) * SNAPSHOT_ENTITIES_PER_PART),
        links: links.slice(part * SNAPSHOT_LINKS_PER_PART, (part + 1) * SNAPSHOT_LINKS_PER_PART),
        drops: drops.slice(part * SNAPSHOT_DROPS_PER_PART, (part + 1) * SNAPSHOT_DROPS_PER_PART),
        last: part === parts - 1,
      })
    }
  }

  private subscribersOf(chunk: number): Set<ServerPlayer> {
    let set = this.subscribers.get(chunk)
    if (!set) this.subscribers.set(chunk, (set = new Set()))
    return set
  }

  private sendRoster(): void {
    const players = [...this.players.values()].map((player): [number, string] => [player.id, player.name])
    for (const player of this.players.values()) player.outbox.push({ k: 'roster', players })
  }

  // Sends what was logged for the player on this tick, in as many messages as it takes, the last saying that the log
  // is complete up to `tick`. A tick with nothing logged sends nothing: the state message says how far the log goes.
  private flush(player: ServerPlayer, tick: number): void {
    if (player.outbox.length === 0) return
    const events = player.outbox
    player.outbox = []
    let batch: StreamEvent[] = []
    let size = 0
    for (const event of events) {
      const length = JSON.stringify(event).length + 1
      if (batch.length > 0 && size + length > MAX_PACKET_CHARS) {
        player.log.send({ ev: batch })
        batch = []
        size = 0
      }
      batch.push(event)
      size += length
    }
    player.log.send({ th: tick, ev: batch })
  }
}

// A player as saved: where they are, their health, and their inventory by item key.
function playerSave(player: ServerPlayer): PlayerSave {
  return {
    x: player.position.x,
    y: player.position.y,
    health: player.health,
    inventory: player.inventory.slots.map((slot) => (slot.count > 0 ? [getItem(slot.item).key, slot.count] : null)),
  }
}

// What the seed grows in a chunk the first time anyone comes near it: its plants and the pieces of flint lying in the
// ground (with IDs 0, 1, 2... to be added to the chunk's block), and a checksum of them, to tell when a save is loaded
// with a world generator that grows something else there now. (Flint used to lie about as items on the ground, `drops`;
// a world saved then still has them.)
function generatedIn(seed: number, chunk: number, rates: PlantGeneration): { entities: EntityState[]; drops: DropState[]; checksum: number } {
  const { cx, cy } = chunkCoords(chunk)
  const plants = plantsInChunk(seed, cx, cy, rates).map((plant, i) => entityToState(createEntity(i, plant.kind, plant.x, plant.y, 0, NO_ITEM)))
  const flint = itemId('flint')
  const pieces = flintInChunk(seed, cx, cy, rates).map(({ x, y }, i) => entityToState(createEntity(plants.length + i, 'loose', tileOfUnits(x), tileOfUnits(y), 0, flint)))
  const entities = [...plants, ...pieces]
  const drops: DropState[] = []
  const values: number[] = [entities.length, drops.length]
  for (const state of entities) values.push(BUILDINGS[state.kind].code, state.x, state.y)
  for (const [, , , x, y] of drops) values.push(x, y)
  return { entities, drops, checksum: hashInts(...values) }
}
