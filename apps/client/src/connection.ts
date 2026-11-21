import geckos from '@geckos.io/client'
import {
  lagConfigFromQuery,
  ReliableReceiver,
  ReliableSender,
  withLag,
  type Command,
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
const RESEND_CHECK_MS = 50

// The page's connection to a game: one Geckos channel carrying the log (reliable and in order, see reliable-stream.ts),
// the page's requests (the same, the other way), and the unreliable state, pings and movement inputs. The page's
// address can ask for a simulated bad network: ?lag=100&jitter=30&loss=0.05.
export function connect(code: string, name: string, handlers: ConnectionHandlers): Connection {
  const clock = new TickClock()
  // The dev and preview servers forward Geckos' signalling (/.wrtc) from the page's own port to the game server.
  const raw = geckos({
    url: `${window.location.protocol}//${window.location.hostname}`,
    port: Number(window.location.port) || (window.location.protocol === 'https:' ? 443 : 80),
  })
  const { channel, config } = withLag(raw, lagConfigFromQuery(window.location.search))
  ;(window as unknown as { lag: LagConfig }).lag = config

  const log = new ReliableReceiver<LogMessage>()
  const requests = new ReliableSender<{ r: Request }>((message) => channel.emit('req', message), { resendMs: 150 })
  let joined = false
  let closed = false
  const timers: Array<ReturnType<typeof setInterval>> = []

  raw.onConnect((error) => {
    if (closed) return
    if (error) {
      handlers.onError(`Could not reach the game server (${error.message}).`)
      return
    }
    const join = (): void => {
      if (!joined && !closed) channel.emit('join', { code, name })
    }
    join()
    timers.push(setInterval(join, JOIN_RETRY_MS))
    const ping = (): void => channel.emit('ping', { c: performance.now() })
    ping()
    timers.push(setInterval(ping, PING_MS))
    timers.push(setInterval(() => requests.resend(), RESEND_CHECK_MS))
  })

  channel.on('log', (data) => {
    joined = true
    for (const message of log.receive(data as LogMessage)) handlers.onLog(message)
    channel.emit('ack', { s: log.acknowledged })
  })
  channel.on('state', (data) => {
    const state = data as StateMessage
    clock.observeTick(state.t, performance.now())
    handlers.onState(state)
  })
  channel.on('pong', (data) => clock.observePong((data as PongMessage).c, performance.now()))
  channel.on('req-ack', (data) => requests.acknowledge((data as RequestAckMessage).s))
  channel.on('error', (data) => handlers.onError((data as { message?: string }).message ?? 'The server sent an error.'))
  raw.onDisconnect(() => {
    if (!closed) handlers.onDisconnect()
  })

  return {
    clock,
    lag: config,
    sendCommand: (tick, command) => requests.send({ r: { k: 'cmd', tick, c: command } }),
    sendDesync: (report) => {
      requests.send({ r: { k: 'desync', chunk: report.chunk, tick: report.tick, hash: report.hash } })
    },
    sendInputs: (inputs) => channel.emit('input', { i: inputs }),
    close: () => {
      if (closed) return
      closed = true
      for (const timer of timers) clearInterval(timer)
      raw.close()
    },
  }
}

// Singleplayer: a world run in the player's own browser, by the game server in a Web Worker (local-server.worker.ts),
// and the page's connection to it. It carries the same messages as a network connection, through the same reliable
// streams, so the rest of the page cannot tell the difference; nothing leaves the player's machine.
export function connectLocal(seed: number, name: string, handlers: ConnectionHandlers, terrain?: TerrainSettings): Connection {
  const clock = new TickClock()
  const worker = new Worker(new URL('./local-server.worker.ts', import.meta.url), { type: 'module' })
  const post = (message: ToLocalServer): void => worker.postMessage(message)
  const log = new ReliableReceiver<LogMessage>()
  const requests = new ReliableSender<{ r: Request }>((message) => post({ t: 'req', message: message as RequestMessage }), { resendMs: 150 })
  let closed = false
  const timers: Array<ReturnType<typeof setInterval>> = []

  worker.onmessage = (event: MessageEvent<FromLocalServer>) => {
    if (closed) return
    const message = event.data
    switch (message.t) {
      case 'log':
        for (const ready of log.receive(message.message as LogMessage)) handlers.onLog(ready)
        post({ t: 'ack', s: log.acknowledged })
        return
      case 'state': {
        const state = message.message as StateMessage
        clock.observeTick(state.t, performance.now())
        handlers.onState(state)
        return
      }
      case 'req-ack':
        requests.acknowledge(message.s)
        return
      case 'pong':
        clock.observePong(message.c, performance.now())
        return
      case 'error':
        handlers.onError(message.message)
        return
    }
  }
  worker.onerror = (event) => {
    if (!closed) handlers.onError(`The world could not run in this browser (${event.message || 'the worker failed'}).`)
  }

  post({ t: 'start', seed, name, ...(terrain ? { terrain } : {}) })
  const ping = (): void => post({ t: 'ping', c: performance.now() })
  ping()
  timers.push(setInterval(ping, PING_MS))
  timers.push(setInterval(() => requests.resend(), RESEND_CHECK_MS))

  return {
    clock,
    lag: { latencyMs: 0, jitterMs: 0, loss: 0 },
    sendCommand: (tick, command) => requests.send({ r: { k: 'cmd', tick, c: command } }),
    sendDesync: (report) => {
      requests.send({ r: { k: 'desync', chunk: report.chunk, tick: report.tick, hash: report.hash } })
    },
    sendInputs: (inputs) => post({ t: 'input', i: [...inputs] }),
    close: () => {
      if (closed) return
      closed = true
      for (const timer of timers) clearInterval(timer)
      worker.terminate()
    },
  }
}
