import geckos from '@geckos.io/client'
import {
  lagConfigFromQuery,
  ReliableReceiver,
  ReliableSender,
  withLag,
  type Command,
  type ErrorMessage,
  type InputMessage,
  type LagConfig,
  type LogMessage,
  type PongMessage,
  type Request,
  type RequestAckMessage,
  type RequestMessage,
  type StateMessage,
  type TerrainSettings,
} from '../../../packages/shared/src/index.ts'
import type { DesyncReport } from './factory-mirror.ts'
import type { FromLocalServer, ToLocalServer } from './local-server.worker.ts'
import { TickClock } from './tick-clock.ts'

export type ConnectionHandlers = {
  onLog: (message: LogMessage) => void
  onState: (message: StateMessage) => void
  // The server turned the page away, or said something went wrong.
  onError: (message: string) => void
  onDisconnect: () => void
}

export type Connection = {
  readonly clock: TickClock
  // The simulated lag, which can be changed live (window.lag in the console).
  readonly lag: LagConfig
  // Sends a command to run on `tick`; gives back the number it was sent with, which its result will carry.
  sendCommand(tick: number, command: Command): number
  sendDesync(report: DesyncReport): void
  sendInputs(inputs: ReadonlyArray<[number, number]>): void
  close(): void
}

const JOIN_RETRY_MS = 500
const PING_MS = 1_000
// How often requests waiting for an answer are looked at, and how long one waits before it is sent again (twice as long
// each time after).
const RESEND_CHECK_MS = 50
const REQUEST_RESEND_MS = 150
// How long a page that is leaving waits after saying so before it closes the connection (so the message gets out).
const LEAVE_GRACE_MS = 300
const NO_LAG: LagConfig = { latencyMs: 0, jitterMs: 0, loss: 0 }

// What carries a connection's messages: a Geckos channel (connect), or the Web Worker the world runs in (connectLocal).
// Everything else is the same whichever it is (see openConnection).
type Wire = {
  sendRequest(message: RequestMessage): void
  sendLogAck(s: number): void
  sendPing(c: number): void
  sendInputs(inputs: InputMessage['i']): void
  close(): void
}

// What comes in over a wire, to be handed to `incoming`.
type Incoming = {
  log(message: LogMessage): void
  state(message: StateMessage): void
  requestAck(s: number): void
  pong(c: number): void
  error(message: string): void
}

// A connection over a wire: the log handed on strictly in order, and the page's requests sent until they are answered
// (see reliable-stream.ts); the clock kept in step with the server's ticks (from the state and pings); pings, and
// resends, on timers from `start` (once the wire is up). Once it is closed, nothing more is handed on.
function openConnection(wire: Wire, handlers: ConnectionHandlers, lag: LagConfig): { connection: Connection; incoming: Incoming; start(): void; isClosed(): boolean } {
  const clock = new TickClock()
  const log = new ReliableReceiver<LogMessage>()
  const requests = new ReliableSender<{ r: Request }>((message) => wire.sendRequest(message), { resendMs: REQUEST_RESEND_MS })
  const timers: Array<ReturnType<typeof setInterval>> = []
  let closed = false

  const incoming: Incoming = {
    log: (message) => {
      if (closed) return
      for (const ready of log.receive(message)) handlers.onLog(ready)
      wire.sendLogAck(log.acknowledged)
    },
    state: (message) => {
      if (closed) return
      clock.observeTick(message.t, performance.now())
      handlers.onState(message)
    },
    requestAck: (s) => requests.acknowledge(s),
    pong: (c) => clock.observePong(c, performance.now()),
    error: (message) => {
      if (!closed) handlers.onError(message)
    },
  }
  const start = (): void => {
    const ping = (): void => wire.sendPing(performance.now())
    ping()
    timers.push(setInterval(ping, PING_MS))
    timers.push(setInterval(() => requests.resend(), RESEND_CHECK_MS))
  }
  const connection: Connection = {
    clock,
    lag,
    sendCommand: (tick, command) => requests.send({ r: { k: 'cmd', tick, c: command } }),
    sendDesync: (report) => {
      requests.send({ r: { k: 'desync', chunk: report.chunk, tick: report.tick, hash: report.hash } })
    },
    sendInputs: (inputs) => wire.sendInputs([...inputs]),
    close: () => {
      if (closed) return
      closed = true
      for (const timer of timers) clearInterval(timer)
      wire.close()
    },
  }
  return { connection, incoming, start, isClosed: () => closed }
}

// The page's connection to a game: one Geckos channel carrying the log (reliable and in order, see reliable-stream.ts),
// the page's requests (the same, the other way), and the unreliable state, pings and movement inputs. The page's
// address can ask for a simulated bad network: ?lag=100&jitter=30&loss=0.05.
export function connect(code: string, name: string, handlers: ConnectionHandlers): Connection {
  // The dev and preview servers forward Geckos' signalling (/.wrtc) from the page's own port to the game server.
  const raw = geckos({
    url: `${window.location.protocol}//${window.location.hostname}`,
    port: Number(window.location.port) || (window.location.protocol === 'https:' ? 443 : 80),
  })
  const { channel, config } = withLag(raw, lagConfigFromQuery(window.location.search))
  ;(window as unknown as { lag: LagConfig }).lag = config

  let joined = false
  let joining: ReturnType<typeof setInterval> | undefined
  // Leaving, the page says so, and the server takes the player out of the game at once (rather than when it notices
  // the connection has gone quiet). The page being closed says so too.
  const sayLeaving = (): void => {
    if (joined) channel.emit('leave', {}, { reliable: true })
  }
  const { connection, incoming, start, isClosed } = openConnection(
    {
      sendRequest: (message) => channel.emit('req', message),
      sendLogAck: (s) => channel.emit('ack', { s }),
      sendPing: (c) => channel.emit('ping', { c }),
      sendInputs: (inputs) => channel.emit('input', { i: inputs } satisfies InputMessage),
      close: () => {
        clearInterval(joining)
        window.removeEventListener('pagehide', sayLeaving)
        sayLeaving()
        setTimeout(() => raw.close(), LEAVE_GRACE_MS)
      },
    },
    handlers,
    config,
  )

  raw.onConnect((error) => {
    if (isClosed()) return
    if (error) {
      handlers.onError(`Could not reach the game server (${error.message}).`)
      return
    }
    // Asking to join again and again until the log starts to come (an ask can be lost on the way).
    const join = (): void => channel.emit('join', { code, name })
    join()
    joining = setInterval(join, JOIN_RETRY_MS)
    start()
  })
  channel.on('log', (data) => {
    if (!joined) {
      joined = true
      clearInterval(joining)
    }
    incoming.log(data as LogMessage)
  })
  channel.on('state', (data) => incoming.state(data as StateMessage))
  channel.on('pong', (data) => incoming.pong((data as PongMessage).c))
  channel.on('req-ack', (data) => incoming.requestAck((data as RequestAckMessage).s))
  channel.on('error', (data) => incoming.error((data as Partial<ErrorMessage>).message ?? 'The server sent an error.'))
  raw.onDisconnect(() => {
    if (!isClosed()) handlers.onDisconnect()
  })
  window.addEventListener('pagehide', sayLeaving)
  return connection
}

// Singleplayer: a world run in the player's own browser, by the game server in a Web Worker (local-server.worker.ts),
// and the page's connection to it. It carries the same messages as a network connection, through the same reliable
// streams, so the rest of the page cannot tell the difference; nothing leaves the player's machine.
export function connectLocal(seed: number, name: string, handlers: ConnectionHandlers, terrain?: TerrainSettings): Connection {
  const worker = new Worker(new URL('./local-server.worker.ts', import.meta.url), { type: 'module' })
  const post = (message: ToLocalServer): void => worker.postMessage(message)
  const { connection, incoming, start } = openConnection(
    {
      sendRequest: (message) => post({ t: 'req', message }),
      sendLogAck: (s) => post({ t: 'ack', s }),
      sendPing: (c) => post({ t: 'ping', c }),
      sendInputs: (i) => post({ t: 'input', i }),
      close: () => worker.terminate(),
    },
    handlers,
    NO_LAG,
  )
  worker.onmessage = (event: MessageEvent<FromLocalServer>) => {
    const message = event.data
    switch (message.t) {
      case 'log':
        return incoming.log(message.message)
      case 'state':
        return incoming.state(message.message)
      case 'req-ack':
        return incoming.requestAck(message.s)
      case 'pong':
        return incoming.pong(message.c)
      case 'error':
        return incoming.error(message.message)
    }
  }
  worker.onerror = (event) => incoming.error(`The world could not run in this browser (${event.message || 'the worker failed'}).`)
  post({ t: 'start', seed, name, ...(terrain ? { terrain } : {}) })
  start()
  return connection
}
