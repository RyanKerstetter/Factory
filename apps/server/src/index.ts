import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomInt } from 'node:crypto'
import geckos, { type ServerChannel } from '@geckos.io/server'
import { cleanName, seedFromText, TICK_MS, type GameInfo, type RequestMessage, type SavedWorldInfo, type WorldSize } from '../../../packages/shared/src/index.ts'
import {
  AckMessageSchema,
  InputMessageSchema,
  JoinMessageSchema,
  NewGameSchema,
  PingMessageSchema,
  RequestMessageSchema,
} from '../../../packages/shared/src/protocol-schemas.ts'
import { GameRoom, type ServerPlayer } from './game-room.ts'
import { log } from './log.ts'
import { checkSave, savedInfo, type WorldSave } from './save.ts'
import { fromBytes, SaveFolder, toBytes } from './save-folder.ts'

// The game server: a small HTTP API to make, find, load, export and import worlds, the Geckos server the games are
// played over, and the saves folder the worlds are kept in.

const apiPort = readPort('API_PORT', 9300)
const geckosPort = readPort('GECKOS_PORT', 9301)
// WebRTC runs over UDP. Geckos puts every connection on one port, so opening WEBRTC_PORT_MIN in a firewall is enough.
const webrtcPortMin = readPort('WEBRTC_PORT_MIN', 10_000)
const webrtcPortMax = readPort('WEBRTC_PORT_MAX', webrtcPortMin)
// A STUN server lets the server find its public address behind NAT (most clouds). Empty turns it off.
const iceServers = (process.env.WEBRTC_ICE_SERVERS ?? 'stun:stun.l.google.com:19302')
  .split(',')
  .map((urls) => urls.trim())
  .filter(Boolean)
  .map((urls) => ({ urls }))
// In development the server keeps copies of chunks so a client whose hash disagrees can compare its copy with the
// server's. Off in production (NODE_ENV=production) unless DESYNC_DUMPS=1.
const keepDumps = process.env.DESYNC_DUMPS ? process.env.DESYNC_DUMPS === '1' : process.env.NODE_ENV !== 'production'
// A game with nobody in it is saved and closed after this long (it can be loaded again from the menu).
const EMPTY_ROOM_MS = 10 * 60_000
// Running worlds are saved this often, to the saves folder (SAVES_DIR, by default "saves" where the server is run).
const SAVE_EVERY_MS = 60_000
const saves = new SaveFolder(process.env.SAVES_DIR ?? 'saves')
// The longest world name, and the biggest file an import may be.
const NAME_LENGTH = 40
const IMPORT_LIMIT = 64 * 1024 * 1024
const CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

if (webrtcPortMax < webrtcPortMin) throw new Error('WEBRTC_PORT_MAX must not be lower than WEBRTC_PORT_MIN.')

function readPort(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < 1025 || value > 65_535) throw new Error(`${name} must be a whole number from 1025 to 65535.`)
  return value
}

const rooms = new Map<string, GameRoom>()

function newCode(): string {
  for (;;) {
    let code = ''
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARACTERS[randomInt(CODE_CHARACTERS.length)]
    if (!rooms.has(code)) return code
  }
}

function info(room: GameRoom): GameInfo {
  return { code: room.code, name: room.name, seed: room.seed, players: room.playerCount, playerNames: room.playerNames }
}

// Saves a running world to its file. A failure is logged and the world carries on (it is tried again next time).
async function saveRoom(room: GameRoom): Promise<void> {
  try {
    await saves.write(room.exportSave())
  } catch (error) {
    log.error('save failed', { game: room.code, error: error instanceof Error ? error.message : String(error) })
  }
}

// A code no running world and no saved world has.
async function freshCode(): Promise<string> {
  const saved = new Set((await saves.list()).map((save) => save.code))
  for (;;) {
    const code = newCode()
    if (!saved.has(code)) return code
  }
}

// Whether a world of that name (in any case) is running or saved.
async function nameTaken(name: string): Promise<boolean> {
  const key = name.toLowerCase()
  if ([...rooms.values()].some((room) => room.name.toLowerCase() === key)) return true
  return (await saves.list()).some((save) => save.name.toLowerCase() === key)
}

// A name for an imported world that no other world has: its own, or with a number after it.
async function freeName(name: string): Promise<string> {
  if (!(await nameTaken(name))) return name
  for (let n = 2; ; n++) {
    const candidate = `${name.slice(0, NAME_LENGTH - 5)} (${n})`
    if (!(await nameTaken(candidate))) return candidate
  }
}

// Starts a saved world running (or gives the one already running).
async function loadWorld(code: string): Promise<GameRoom | undefined> {
  const running = rooms.get(code)
  if (running) return running
  const save = await saves.read(code)
  if (!save) return undefined
  const room = GameRoom.fromSave(save, { keepDumps })
  rooms.set(room.code, room)
  for (const warning of room.loadWarnings) log.warn('loaded world differs', { game: room.code, warning })
  log.info('game loaded', { game: room.code, name: room.name, games: rooms.size })
  return room
}

// ---- the HTTP API

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  response.end(JSON.stringify(data))
}

async function readJson(request: IncomingMessage, limit = 4_096): Promise<unknown> {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > limit) throw new Error('The request is too large.')
  }
  return body ? JSON.parse(body) : {}
}

// Sends a save as a file to download: gzipped JSON, as it is kept (any unzip tool opens it).
function sendSave(response: ServerResponse, save: WorldSave): void {
  const file = `${save.name.replace(/[^A-Za-z0-9 _-]/g, '').trim() || save.code}.json.gz`
  response.writeHead(200, {
    'Content-Type': 'application/gzip',
    'Content-Disposition': `attachment; filename="${file}"`,
    'Access-Control-Allow-Origin': '*',
  })
  response.end(toBytes(save))
}

// A request's body as bytes, up to a limit.
async function readBytes(request: IncomingMessage, limit: number): Promise<Buffer> {
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > limit) throw new Error('The request is too large.')
    parts.push(chunk as Buffer)
  }
  return Buffer.concat(parts)
}

const api = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      response.end()
      return
    }
    // The running worlds, for the join list.
    if (request.method === 'GET' && url.pathname === '/api/games') {
      return sendJson(response, 200, [...rooms.values()].map(info))
    }
    // A new world, by name (and seed).
    if (request.method === 'POST' && url.pathname === '/api/games') {
      const parsed = NewGameSchema.safeParse(await readJson(request))
      if (!parsed.success) return sendJson(response, 400, { error: 'That is not a valid new game.' })
      const name = parsed.data.name.replace(/\s+/g, ' ').trim().slice(0, NAME_LENGTH)
      if (!name) return sendJson(response, 400, { error: 'Give the world a name.' })
      if (await nameTaken(name)) return sendJson(response, 409, { error: 'There is already a world of that name.' })
      const seedText = parsed.data.seed?.trim()
      const seed = seedText ? seedFromText(seedText) : randomInt(1, 1_000_000_000)
      const terrain = { ...(parsed.data.size ? { size: parsed.data.size as WorldSize } : {}), ...(parsed.data.bumpiness !== undefined ? { bumpiness: parsed.data.bumpiness } : {}) }
      const room = new GameRoom(await freshCode(), seed, { keepDumps, name, terrain })
      rooms.set(room.code, room)
      await saveRoom(room)
      log.info('game created', { game: room.code, name, seed, games: rooms.size })
      return sendJson(response, 201, info(room))
    }
    const match = /^\/api\/games\/([A-Za-z0-9]{1,12})$/.exec(url.pathname)
    if (request.method === 'GET' && match) {
      const room = rooms.get(match[1].toUpperCase())
      return room ? sendJson(response, 200, info(room)) : sendJson(response, 404, { error: 'There is no game with that code.' })
    }
    // The saved worlds that are not running, for the load list.
    if (request.method === 'GET' && url.pathname === '/api/saves') {
      const list: SavedWorldInfo[] = (await saves.list()).filter((save) => !rooms.has(save.code)).map(savedInfo)
      return sendJson(response, 200, list)
    }
    // Start a saved world running.
    const load = /^\/api\/saves\/([A-Za-z0-9]{1,12})\/load$/.exec(url.pathname)
    if (request.method === 'POST' && load) {
      const room = await loadWorld(load[1].toUpperCase())
      return room ? sendJson(response, 200, info(room)) : sendJson(response, 404, { error: 'There is no saved world with that code.' })
    }
    // Delete a saved world for good. Not one that is running: everyone would have to leave it first.
    const deleted = /^\/api\/saves\/([A-Za-z0-9]{1,12})$/.exec(url.pathname)
    if (request.method === 'DELETE' && deleted) {
      const code = deleted[1].toUpperCase()
      if (rooms.has(code)) return sendJson(response, 409, { error: 'That world is being played: it can only be deleted once everyone has left.' })
      if (!(await saves.remove(code))) return sendJson(response, 404, { error: 'There is no saved world with that code.' })
      log.info('world deleted', { game: code })
      return sendJson(response, 200, { ok: true })
    }
    // A world as a file: as it is now if it is running, as last saved if not.
    const exported = /^\/api\/worlds\/([A-Za-z0-9]{1,12})\/export$/.exec(url.pathname)
    if (request.method === 'GET' && exported) {
      const code = exported[1].toUpperCase()
      const running = rooms.get(code)
      const save = running ? running.exportSave() : await saves.read(code)
      if (!save) return sendJson(response, 404, { error: 'There is no world with that code.' })
      if (running) await saves.write(save)
      return sendSave(response, save)
    }
    // A world from a file, added to the saved worlds (under a new code, and a new name if its own is taken).
    if (request.method === 'POST' && url.pathname === '/api/worlds/import') {
      // A save file as exported (gzipped), or its JSON unzipped.
      const checked = checkSave(fromBytes(await readBytes(request, IMPORT_LIMIT)))
      if (!checked.ok) return sendJson(response, 400, { error: checked.why })
      const save: WorldSave = { ...checked.save, code: await freshCode(), name: await freeName(checked.save.name.trim().slice(0, NAME_LENGTH) || 'Imported world') }
      await saves.write(save)
      log.info('world imported', { game: save.code, name: save.name })
      return sendJson(response, 201, savedInfo(save))
    }
    sendJson(response, 404, { error: 'Not found.' })
  } catch (error) {
    log.error('api request failed', { error: error instanceof Error ? error.message : String(error) })
    sendJson(response, 400, { error: 'The request could not be read.' })
  }
})
api.listen(apiPort, () => log.info('api listening', { port: apiPort }))

// ---- the game connection

const io = geckos({ portRange: { min: webrtcPortMin, max: webrtcPortMax }, iceServers, cors: { origin: '*', allowAuthorization: false } })

io.onConnection((channel: ServerChannel) => {
  let joined: { room: GameRoom; player: ServerPlayer } | undefined

  // A client sends `join` until it hears back, so a second one on the same connection is the same player.
  channel.on('join', (data) => {
    if (joined) return
    const parsed = JoinMessageSchema.safeParse(data)
    if (!parsed.success) return channel.emit('error', { message: 'A game code and a name are needed.' }, { reliable: true })
    const room = rooms.get(parsed.data.code.toUpperCase())
    if (!room) return channel.emit('error', { message: 'There is no game with that code.' }, { reliable: true })
    const name = cleanName(parsed.data.name)
    // A name is what links a player to what they had in a world, so two players in one game cannot share one.
    if (room.hasPlayerNamed(name)) {
      return channel.emit('error', { message: `Someone called ${name} is already playing in this world. Pick another name.` }, { reliable: true })
    }
    const player = room.join(name, {
      sendLog: (message) => channel.emit('log', message),
      sendState: (message) => channel.emit('state', message),
    })
    joined = { room, player }
    log.info('player joined', { game: room.code, player: player.id, name, players: room.playerCount })
  })

  channel.on('req', (data) => {
    if (!joined) return
    const parsed = RequestMessageSchema.safeParse(data)
    let request = parsed.success ? (parsed.data as RequestMessage) : undefined
    if (!request) {
      // One that cannot be read still has its place in the stream: it is answered as refused, so everything after it
      // is not held up waiting for it forever (which leaves the player able to walk, but nothing they do taking effect).
      const seq = (data as { s?: unknown } | null)?.s
      if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return
      log.warn('unreadable request', { game: joined.room.code, player: joined.player.id, data: JSON.stringify(data).slice(0, 400), problem: parsed.error?.issues[0]?.message })
      request = { s: seq, r: { k: 'bad' } }
    }
    const ack = joined.room.receiveRequest(joined.player, request)
    channel.emit('req-ack', { s: ack })
  })

  channel.on('input', (data) => {
    if (!joined) return
    const parsed = InputMessageSchema.safeParse(data)
    if (parsed.success) joined.room.receiveInputs(joined.player, parsed.data.i as Array<[number, number]>)
  })

  channel.on('ack', (data) => {
    if (!joined) return
    const parsed = AckMessageSchema.safeParse(data)
    if (parsed.success) joined.room.receiveLogAck(joined.player, parsed.data.s)
  })

  channel.on('ping', (data) => {
    const parsed = PingMessageSchema.safeParse(data)
    if (parsed.success) channel.emit('pong', { c: parsed.data.c, t: joined?.room.tick ?? 0 })
  })

  channel.onDisconnect(() => {
    if (!joined) return
    joined.room.leave(joined.player)
    log.info('player left', { game: joined.room.code, player: joined.player.id, players: joined.room.playerCount })
    joined = undefined
  })
})
io.listen(geckosPort)
log.info('game server listening', { port: geckosPort, webrtcUdp: `${webrtcPortMin}-${webrtcPortMax}`, desyncDumps: keepDumps })

// ---- the tick

// Every game ticks together, TPS times a second, on a timer that makes up for its own lateness. A server that falls
// more than a second behind (the machine slept) skips ahead rather than racing through the missed ticks.
let nextTickAt = performance.now()
function runTicks(): void {
  const now = performance.now()
  if (now - nextTickAt > 1_000) nextTickAt = now
  let ran = 0
  while (now >= nextTickAt && ran < 5) {
    for (const room of rooms.values()) {
      try {
        room.step()
      } catch (error) {
        log.error('tick failed', { game: room.code, tick: room.tick, error: error instanceof Error ? error.stack ?? error.message : String(error) })
      }
    }
    nextTickAt += TICK_MS
    ran++
  }
  for (const room of rooms.values()) room.resend(now)
  setTimeout(runTicks, Math.max(0, nextTickAt - performance.now()))
}
runTicks()

setInterval(() => {
  const now = Date.now()
  for (const room of rooms.values()) {
    if (room.emptySince !== undefined && now - room.emptySince > EMPTY_ROOM_MS) {
      rooms.delete(room.code)
      void saveRoom(room)
      log.info('game closed', { game: room.code, reason: 'empty', games: rooms.size })
    }
  }
}, 60_000).unref()

// Every running world is saved now and then, and all of them on the way down (Ctrl+C, or the host stopping it).
setInterval(() => {
  for (const room of rooms.values()) void saveRoom(room)
}, SAVE_EVERY_MS).unref()

let stopping = false
async function stop(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  log.info('saving before stopping', { signal, games: rooms.size })
  await Promise.all([...rooms.values()].map(saveRoom))
  process.exit(0)
}
process.on('SIGINT', () => void stop('SIGINT'))
process.on('SIGTERM', () => void stop('SIGTERM'))
