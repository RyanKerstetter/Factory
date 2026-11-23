import assert from 'node:assert/strict'
import test from 'node:test'
import { FactoryMirror } from '../apps/client/src/factory-mirror.ts'
import { ReliableReceiver, type LogMessage, type StateMessage } from '../packages/shared/src/index.ts'
import type { FromLocalServer, ToLocalServer } from '../apps/client/src/local-server.worker.ts'

// The singleplayer server is a Web Worker; here its global scope is stood in for, so the very module the page loads
// runs in the test: it is started, ticks on its own, and answers as a network server would.
test('the singleplayer server runs a world in a worker and talks to the page as a server would', async () => {
  const received: FromLocalServer[] = []
  const scope = {
    postMessage: (message: FromLocalServer) => received.push(structuredClone(message)),
    onmessage: null as ((event: { data: ToLocalServer }) => void) | null,
  }
  ;(globalThis as unknown as { self: typeof scope }).self = scope
  await import('../apps/client/src/local-server.worker.ts')
  const send = (data: ToLocalServer): void => scope.onmessage!({ data })

  send({ t: 'start', seed: 1234, name: 'Solo' })
  send({ t: 'ping', c: 42 })
  await new Promise((resolve) => setTimeout(resolve, 400))

  const logs = received.filter((message) => message.t === 'log')
  const states = received.filter((message) => message.t === 'state')
  assert.ok(logs.length > 0, 'it sent the log')
  assert.ok(states.length >= 8, `it ticked on its own, about 30 times a second (${states.length} states in 0.4 s)`)
  assert.ok(received.some((message) => message.t === 'pong' && message.c === 42), 'it answered the ping')

  // The page's copy of the world, fed from it, starts and matches the seed.
  const mirror = new FactoryMirror()
  const log = new ReliableReceiver<LogMessage>()
  for (const message of logs) for (const ready of log.receive(message.message as LogMessage)) mirror.receiveLog(ready)
  const last = states.at(-1)!.message as StateMessage
  mirror.noteState(last.t, last.s)
  assert.ok(mirror.started)
  assert.equal(mirror.seed, 1234)
  while (mirror.canStep()) mirror.step()
  assert.ok(mirror.world.chunkIds.length > 0, 'and has the chunks round the player')

  // A request is answered.
  send({ t: 'req', message: { s: 1, r: { k: 'cmd', tick: last.t + 2, c: { k: 'slot', from: { id: 0, i: 0 }, to: { id: 0, i: 1 }, count: 1 } } } })
  assert.ok(received.some((message) => message.t === 'req-ack' && message.s === 1))
  send({ t: 'stop' })
})
