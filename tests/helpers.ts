import { GameRoom, type PlayerTransport, type ServerPlayer } from '../apps/server/src/game-room.ts'
import { FactoryMirror, type CommandResult } from '../apps/client/src/factory-mirror.ts'
import {
  ReliableReceiver,
  ReliableSender,
  type AnimalInfo,
  type Command,
  type Inventory,
  type LogMessage,
  type RequestMessage,
} from '../packages/shared/src/index.ts'

// A pretend network: messages wait in a queue until `deliver`, may be dropped, and come out shuffled.
export type Wire = { loss?: number; shuffle?: boolean; random?: () => number }

// A client wired straight to a room, through the same reliable stream the real page uses.
export class TestClient {
  readonly mirror: FactoryMirror
  readonly results: CommandResult[] = []
  inventory: Inventory | undefined
  readonly player: ServerPlayer
  desyncReports = 0
  // How many link results the server has sent this client (one per item over an edge it sees only one side of).
  linkResults = 0
  // What the server has told this client about the animals near it.
  readonly animals = new Map<number, AnimalInfo>()
  private readonly receiver = new ReliableReceiver<LogMessage>()
  private readonly requests: ReliableSender<{ r: RequestMessage['r'] }>
  private inbox: LogMessage[] = []
  private states: Array<{ t: number; s: number }> = []
  private outbox: RequestMessage[] = []

  constructor(readonly room: GameRoom, name: string, readonly wire: Wire = {}) {
    this.mirror = new FactoryMirror({
      onResult: (result) => this.results.push(result),
      onPlayerInventory: (inventory) => {
        this.inventory = inventory
      },
      onAnimal: (info) => {
        this.animals.set(info.id, info)
      },
      onAnimalGone: (id) => {
        this.animals.delete(id)
      },
      onDesync: (report) => {
        this.desyncReports++
        this.requests.send({ r: { k: 'desync', chunk: report.chunk, tick: report.tick, hash: report.hash } })
      },
    })
    this.requests = new ReliableSender((message) => this.outbox.push(message as RequestMessage), { resendMs: 0 })
    const transport: PlayerTransport = {
      sendLog: (message) => this.inbox.push(structuredClone(message)),
      sendState: (message) => this.states.push({ t: message.t, s: message.s }),
    }
    this.player = room.join(name, transport)
  }

  command(command: Command, tick = this.room.tick + 1): number {
    return this.requests.send({ r: { k: 'cmd', tick, c: command } })
  }

  // Hands over whatever is on the wire both ways, losing and shuffling some if the wire says so.
  deliver(): void {
    const random = this.wire.random ?? Math.random
    const lose = (): boolean => (this.wire.loss ?? 0) > 0 && random() < this.wire.loss!
    let inbox = this.inbox
    this.inbox = []
    if (this.wire.shuffle) inbox = inbox.map((message) => ({ message, key: random() })).sort((a, b) => a.key - b.key).map((entry) => entry.message)
    for (const message of inbox) {
      if (lose()) continue
      for (const ready of this.receiver.receive(message)) {
        this.linkResults += ready.ev.filter((event) => event.k === 'link').length
        this.mirror.receiveLog(ready)
      }
    }
    if (!lose()) this.room.receiveLogAck(this.player, this.receiver.acknowledged)
    for (const state of this.states) this.mirror.noteState(state.t, state.s)
    this.states = []
    const outbox = this.outbox
    this.outbox = []
    for (const message of outbox) {
      if (lose()) continue
      this.requests.acknowledge(this.room.receiveRequest(this.player, message))
    }
    this.requests.resend()
    this.room.resend(Number.POSITIVE_INFINITY)
  }

  // Simulates every tick the log is complete for.
  catchUp(): void {
    while (this.mirror.canStep()) this.mirror.step()
  }
}

// Runs the room `ticks` ticks, handing messages over and letting every client catch up after each.
export function run(room: GameRoom, clients: readonly TestClient[], ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    room.step()
    for (const client of clients) {
      client.deliver()
      client.catchUp()
    }
  }
}

// Every chunk the client simulates, compared with the server's: the chunks that differ.
export function differingChunks(room: GameRoom, client: TestClient): number[] {
  const differ: number[] = []
  for (const chunk of client.mirror.world.chunkIds) {
    if (client.mirror.desynced.has(chunk)) continue
    if (room.world.hashChunk(chunk) !== client.mirror.world.hashChunk(chunk)) differ.push(chunk)
  }
  return differ
}
