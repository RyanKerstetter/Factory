import { TICK_MS, type RequestMessage, type TerrainSettings } from '../../../packages/shared/src/index.ts'
import { GameRoom, type ServerPlayer } from '../../server/src/game-room.ts'

// Singleplayer: the game server, run in a Web Worker in the player's own browser. It is the very GameRoom the hosted
// server runs (apps/server/src/game-room.ts), ticking TPS times a second here, so a world plays the same alone as
// online; only the wire is different: messages to and from the page (see connectLocal in connection.ts) instead of a
// network. The worker keeps the room ticking while the page draws, so neither holds the other up.

// What the page sends: start a world (once), and then what a network connection would carry.
export type ToLocalServer =
  | { t: 'start'; seed: number; name: string; terrain?: Partial<TerrainSettings> }
  | { t: 'req'; message: RequestMessage }
  | { t: 'input'; i: Array<[number, number]> }
  | { t: 'ack'; s: number }
  | { t: 'ping'; c: number }
  // Stop ticking (the page terminates the worker when the game ends; tests, which cannot, send this).
  | { t: 'stop' }

// What it sends back: the log and the state (as a server would), answers to requests and pings, and a failure.
export type FromLocalServer =
  | { t: 'log'; message: unknown }
  | { t: 'state'; message: unknown }
  | { t: 'req-ack'; s: number }
  | { t: 'pong'; c: number; tick: number }
  | { t: 'error'; message: string }

// A worker's global scope, with only what is used here (the page's TypeScript settings know a window, not a worker).
const scope = self as unknown as {
  postMessage(message: FromLocalServer): void
  onmessage: ((event: MessageEvent<ToLocalServer>) => void) | null
}

let room: GameRoom | undefined
let player: ServerPlayer | undefined

scope.onmessage = (event) => {
  const message = event.data
  if (message.t === 'start') {
    if (room) return
    room = new GameRoom('SOLO', message.seed, message.terrain ? { terrain: message.terrain } : {})
    player = room.join(message.name, {
      sendLog: (log) => scope.postMessage({ t: 'log', message: log }),
      sendState: (state) => scope.postMessage({ t: 'state', message: state }),
    })
    runTicks()
    return
  }
  if (!room || !player) return
  switch (message.t) {
    case 'stop':
      room = undefined
      player = undefined
      return
    case 'req':
      scope.postMessage({ t: 'req-ack', s: room.receiveRequest(player, message.message) })
      return
    case 'input':
      room.receiveInputs(player, message.i)
      return
    case 'ack':
      room.receiveLogAck(player, message.s)
      return
    case 'ping':
      scope.postMessage({ t: 'pong', c: message.c, tick: room.tick })
      return
  }
}

// The room's ticks, on time: as the hosted server does, it catches up (up to five at a time) if the worker was held up,
// and starts afresh after a long pause (the tab put to sleep) rather than racing through what it missed.
let nextTickAt = performance.now()
function runTicks(): void {
  if (!room) return
  const now = performance.now()
  if (now - nextTickAt > 1_000) nextTickAt = now
  let ran = 0
  try {
    while (now >= nextTickAt && ran < 5) {
      room.step()
      nextTickAt += TICK_MS
      ran++
    }
    room.resend(now)
  } catch (error) {
    scope.postMessage({ t: 'error', message: `The world stopped: ${error instanceof Error ? error.message : String(error)}` })
    return
  }
  setTimeout(runTicks, Math.max(0, nextTickAt - performance.now()))
}
