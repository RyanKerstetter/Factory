import {
  applyWorldEvent,
  chunkOfDrop,
  chunkOfTile,
  eventPhase,
  FactoryWorld,
  inventoryFromWire,
  playerInventory,
  NO_ITEM,
  type AnimalInfo,
  type LichSpell,
  type WaystoneInfo,
  type MonsterInfo,
  type ChunkSnapshot,
  type Inventory,
  type ItemId,
  type LogMessage,
  type Refusal,
  type StreamEvent,
  type Terrain,
  terrainOf,
} from '../../../packages/shared/src/index.ts'

export type Welcome = Extract<StreamEvent, { k: 'welcome' }>
export type CommandResult = { tick: number; seq: number; ok: boolean; why?: Refusal; moved?: number }
export type DesyncReport = { chunk: number; tick: number; hash: number }

export type MirrorCallbacks = {
  onWelcome?: (welcome: Welcome) => void
  onRoster?: (players: ReadonlyArray<[number, string]>) => void
  // Who the host is, and whether players can hurt each other.
  onRoom?: (room: { host: string; pvp: boolean; items: boolean }) => void
  // A player was hurt by another, and whether it knocked them out.
  onHurt?: (hurt: { id: number; amount: number; died: boolean }) => void
  // A target dummy was hit, this hard.
  onDummyHit?: (id: number, amount: number) => void
  // The player has truesight (see `sight` in protocol.ts).
  onSight?: () => void
  // What an animal near the player is, whenever it changes; and one that is gone.
  onAnimal?: (info: AnimalInfo) => void
  onAnimalGone?: (id: number, died?: number) => void
  onGear?: (gear: { id: number; held: number; armor: number[] }) => void
  onSwung?: (swing: { id: number; item: number; angle: number; charged?: 1 }) => void
  // What a monster near the player is, whenever it changes; and one that is gone.
  onMonster?: (info: MonsterInfo) => void
  onMonsterGone?: (id: number, died?: number) => void
  // A spike trap in the dungeon was set off; the frost lich cast a spell the page draws.
  onTrap?: (trap: { slot: number; trap: number; delay: number }) => void
  onSpell?: (spell: { spell: LichSpell; x: number; y: number; radius: number; ticks: number }) => void
  // Every waystone in the world; a player starting to travel between two, and the end of it.
  onWaystones?: (list: WaystoneInfo[]) => void
  onWarp?: (warp: { id: number; from: { x: number; y: number }; to: { x: number; y: number }; ticks: number }) => void
  onWarpEnd?: (id: number, arrived: boolean) => void
  // One of this page's commands has run (or been turned down), on the tick just simulated.
  onResult?: (result: CommandResult) => void
  // The player's inventory, as of the tick just simulated.
  onPlayerInventory?: (inventory: Inventory) => void
  // A chunk's copy here does not match the server's. The page should tell the server, which sends it again.
  onDesync?: (report: DesyncReport, local: ChunkSnapshot) => void
  // The server's copy of a chunk this page reported (development builds only).
  onDump?: (chunk: number, tick: number, server: ChunkSnapshot | null) => void
}

// This page's copy of the factory: the chunks near the player, simulated tick by tick from the server's log. It never
// guesses: it simulates a tick only when it has everything the server logged for it, so it is always a few ticks
// behind the server and never has to undo anything. What the player has just asked for is drawn over it as a
// prediction (see prediction.ts), not put in it.
//
// The log is complete up to `through`: a log message says how far it completes it, and so does each state message,
// with the number of the last log message sent before it (`noteState`).
export class FactoryMirror {
  readonly world = new FactoryWorld()
  seed = 0
  // The land (biomes, sea, cold), worked out from the seed and the settings in the welcome.
  terrain: Terrain | undefined
  playerId = 0
  // The last tick simulated. Before the welcome, nothing has been.
  simTick = -1
  through = -1
  started = false
  // How many times a chunk has been found to differ from the server's, and the chunks waiting to be sent again.
  desyncs = 0
  readonly desynced = new Set<number>()
  private readonly pending = new Map<number, StreamEvent[]>()
  private readonly assembling = new Map<number, ChunkSnapshot>()
  private lastLogSeq = 0
  private stateMarks: Array<{ t: number; s: number }> = []

  constructor(private readonly callbacks: MirrorCallbacks = {}) {}

  // A log message, in order (the reliable receiver has put them in order).
  receiveLog(message: LogMessage): void {
    for (const event of message.ev) {
      if (eventPhase(event) === 'now') this.applyNow(event)
      else {
        const tick = (event as { tick: number }).tick
        const list = this.pending.get(tick)
        if (list) list.push(event)
        else this.pending.set(tick, [event])
      }
    }
    this.lastLogSeq = message.s
    if (message.th !== undefined) this.through = Math.max(this.through, message.th)
    this.settleStateMarks()
  }

  // A state message said the server was on tick `t` after sending log message `s`.
  noteState(t: number, s: number): void {
    if (!this.started) return
    if (s <= this.lastLogSeq) this.through = Math.max(this.through, t)
    else {
      this.stateMarks.push({ t, s })
      if (this.stateMarks.length > 256) this.stateMarks.shift()
    }
  }

  canStep(): boolean {
    return this.started && this.simTick < this.through
  }

  // Simulates the next tick: the commands logged for it, phase A, phase B (with the server's results for the links
  // this page sees only one end of), then the hashes to check and the chunks to start or stop simulating.
  step(): void {
    const tick = this.simTick + 1
    const events = this.pending.get(tick) ?? []
    this.pending.delete(tick)

    for (const event of events) {
      if (event.k === 'world') {
        // The server only sends a building to pages that simulate its chunk; never start a chunk on a stray one.
        if (event.ev.t === 'add' && !this.world.hasChunk(chunkOfTile(event.ev.e.x, event.ev.e.y))) continue
        if (event.ev.t === 'drop+' && !this.world.hasChunk(chunkOfDrop({ x: event.ev.d[3], y: event.ev.d[4] }))) continue
        applyWorldEvent(this.world, event.ev)
      } else if (event.k === 'result') this.callbacks.onResult?.(event)
      else if (event.k === 'pinv') this.callbacks.onPlayerInventory?.(playerInventory(inventoryFromWire(event.inv)))
    }

    this.world.stepInterior(tick, this.seed)

    const accepted = new Map<number, ItemId>()
    const blocked = new Map<number, boolean>()
    for (const event of events) {
      if (event.k !== 'link') continue
      if (event.r.kind === 'accepted') accepted.set(event.r.link, event.r.item)
      else blocked.set(event.r.link, event.r.kind === 'blocked')
    }
    this.world.exchange({
      accepted: (link) => accepted.get(link) ?? NO_ITEM,
      blocked: (link) => blocked.get(link),
      mismatch: (link) => this.reportDesync(this.world.hasChunk(link.fromChunk) ? link.fromChunk : link.toChunk, tick),
    })

    for (const event of events) {
      switch (event.k) {
        case 'hash':
          if (this.world.hasChunk(event.chunk) && !this.desynced.has(event.chunk) && this.world.hashChunk(event.chunk) !== event.hash) {
            this.reportDesync(event.chunk, tick)
          }
          break
        case 'chunk': {
          const part = this.assembling.get(event.chunk)
          const snapshot = part ?? { chunk: event.chunk, entities: [], links: [], drops: [] }
          snapshot.entities.push(...event.entities)
          snapshot.links.push(...event.links)
          snapshot.drops.push(...(event.drops ?? []))
          if (event.last) {
            this.assembling.delete(event.chunk)
            this.world.loadChunk(snapshot)
            this.desynced.delete(event.chunk)
          } else this.assembling.set(event.chunk, snapshot)
          break
        }
        case 'unload':
          this.world.dropChunk(event.chunk)
          this.desynced.delete(event.chunk)
          break
        case 'dump':
          this.callbacks.onDump?.(event.chunk, event.at, event.dump)
          break
      }
    }
    this.simTick = tick
  }

  private applyNow(event: StreamEvent): void {
    if (event.k === 'welcome') {
      this.seed = event.seed
      this.terrain = terrainOf(event.seed, event.terrain)
      this.playerId = event.playerId
      this.simTick = event.tick - 1
      this.started = true
      this.callbacks.onWelcome?.(event)
    } else if (event.k === 'roster') {
      this.callbacks.onRoster?.(event.players)
    } else if (event.k === 'room') {
      this.callbacks.onRoom?.({ host: event.host, pvp: event.pvp, items: event.items === true })
    } else if (event.k === 'hurt') {
      this.callbacks.onHurt?.(event)
    } else if (event.k === 'dummy') {
      this.callbacks.onDummyHit?.(event.id, event.amount)
    } else if (event.k === 'sight') {
      this.callbacks.onSight?.()
    } else if (event.k === 'animal') {
      this.callbacks.onAnimal?.(event.a)
    } else if (event.k === 'gear') {
      this.callbacks.onGear?.(event)
    } else if (event.k === 'swung') {
      this.callbacks.onSwung?.(event)
    } else if (event.k === 'monster') {
      this.callbacks.onMonster?.(event.m)
    } else if (event.k === 'monster-') {
      this.callbacks.onMonsterGone?.(event.id, event.died)
    } else if (event.k === 'trap') {
      this.callbacks.onTrap?.(event)
    } else if (event.k === 'spell') {
      this.callbacks.onSpell?.(event)
    } else if (event.k === 'waystones') {
      this.callbacks.onWaystones?.(event.list)
    } else if (event.k === 'warp') {
      this.callbacks.onWarp?.(event)
    } else if (event.k === 'warp-') {
      this.callbacks.onWarpEnd?.(event.id, event.arrived)
    } else if (event.k === 'animal-') {
      this.callbacks.onAnimalGone?.(event.id, event.died)
    }
  }

  private settleStateMarks(): void {
    if (this.stateMarks.length === 0) return
    const kept: Array<{ t: number; s: number }> = []
    for (const mark of this.stateMarks) {
      if (mark.s <= this.lastLogSeq) this.through = Math.max(this.through, mark.t)
      else kept.push(mark)
    }
    this.stateMarks = kept
  }

  private reportDesync(chunk: number, tick: number): void {
    if (this.desynced.has(chunk)) return
    this.desynced.add(chunk)
    this.desyncs++
    this.callbacks.onDesync?.({ chunk, tick, hash: this.world.hashChunk(chunk) }, this.world.snapshotChunk(chunk))
  }
}
