import {
  animalDef,
  BUILDINGS,
  checkPlace,
  countOf,
  fenceMask,
  gateIsOpen,
  isHittable,
  PLAYER_HALF_SIZE,
  PLAYER_MASS,
  PLAYER_MAX_HEALTH,
  STATION_RECIPES,
  stationOutputFits,
  dashOf,
  stationRecipe,
  WORKBENCH_TOOL_SLOT,
  NO_ITEM,
  STATION_TOOL_SLOT,
  getCrop,
  growthNeeded,
  waterAt,
  coldSpeedPercent,
  frostOf,
  dungeonSlotAt,
  isInDungeons,
  BODY_NORMAL,
  ATTACK_SLOW_TICKS,
  snowAt,
  TPS,
  WAVE_RADIUS,
  WAVE_SPEED,
  WATER_FALL_EVERY,
  FOOD_SLOT,
  PLAYER_REACH,
  WEAPONS,
  ARMOR_SLOT,
  distanceToTileSquared,
  EAT_COOLDOWN_TICKS,
  airTemperatureAt,
  getRecipe,
  barrelPlan,
  BARREL_CAPACITY,
  itemByKey,
  LIQUIDS,
  RACK_INPUT,
  RACK_OUTPUT,
  type AnimalInfo,
  chunkCoords,
  CHUNK_SIZE,
  playerInventory as playerInventoryOf,
  DIR_X,
  DIR_Y,
  getItem,
  hasInventory,
  HOTBAR_SLOTS,
  canAfford,
  resourceDamage,
  weaponIn,
  tilesHitBy,
  KEY_SLOW,
  type Weapon,
  hpOf,
  RECIPES,
  toolIn,
  inventoryTotals,
  isBeltLike,
  isNatural,
  isWithinReach,
  opposite,
  REFUSALS,
  rotateCCW,
  rotateCW,
  roomFor,
  slowIn,
  solidIn,
  SUB,
  tileOfUnits,
  TICK_MS,
  type ChunkSnapshot,
  type Command,
  type Entity,
  type Inventory,
  type TerrainSettings,
  type ItemId,
  type Link,
} from '../../../packages/shared/src/index.ts'
import { animalSound, footstep, Sounds, surfaceAt, type SoundId } from './audio/sounds.ts'
import { DEFAULT_ZOOM, easeZoom, zoomAfterWheel } from './camera.ts'
import { connect, connectLocal, type ConnectionHandlers } from './connection.ts'
import { diffChunkSnapshots } from './desync-diff.ts'
import { FactoryMirror } from './factory-mirror.ts'
import { HeldKeys, isMovementAction, isTypingIn } from './input.ts'
import { attackPose, attackSwish, holdingPose } from './attack-shapes.ts'
import { LocalPlayer } from './local-player.ts'
import { machineProgress, machineView } from './machine-views.ts'
import { Prediction } from './prediction.ts'
import { REMOTE_DELAY_TICKS, RemotePlayers } from './remote-players.ts'
import { cropArt } from './render/art-catalog.ts'
import type { GameView } from './render/game-view.ts'
import { createPixiView } from './render/pixi-view.ts'
import type {
  AnimalView,
  AttackView,
  BuildingView,
  DebugView,
  DropView,
  GhostView,
  OverlayView,
  PlayerView,
  PlayerPose,
} from './render/world-renderer.ts'
import { createThreeView } from './render3d/three-view.ts'
import { HOTBAR_ACTIONS, Settings } from './settings.ts'
import { createDebugOverlay } from './ui/debug-overlay.ts'
import { copyText, element } from './ui/dom.ts'
import { createHotbarView } from './ui/hotbar-view.ts'
import { createHudView } from './ui/hud-view.ts'
import { createSnowstorm } from './ui/snowstorm-view.ts'
import { createFrostView } from './ui/frost-view.ts'
import { createInventoryPanels, type MachineView, type PanelsView } from './ui/inventory-view.ts'
import { createPauseMenu } from './ui/pause-menu-view.ts'
import type { BookEntry } from './ui/recipe-book.ts'
import { createTooltips } from './ui/tooltip.ts'

export type GameOptions = {
  container: HTMLElement
  code: string
  name: string
  // Singleplayer: the world is run in this browser (see connectLocal), from this seed and land, and nobody else can
  // join.
  local?: { seed: number; terrain?: TerrainSettings }
  // The player is going back to the menu: they chose to, or the game was lost. The message says why, if anything.
  onLeave: (message?: string, isError?: boolean) => void
}

// How far behind the newest tick the factory is drawn, in ticks. It starts at PLAYOUT_START and grows when the log
// does not arrive in time (the factory would stall), and shrinks back slowly while it does.
const PLAYOUT_MIN = 2
const PLAYOUT_START = 3
const PLAYOUT_MAX = 20
// How often the page's own elements are brought up to date, and the debug text.
const UI_MS = 100
const DEBUG_MS = 250
// How long to wait for the server's welcome before giving up.
const CONNECT_TIMEOUT_MS = 12_000
// How far the player walks between footsteps, in units, and between rustles while pushing through a bush.
const STEP_DISTANCE = 1.75 * SUB
const RUSTLE_DISTANCE = 1.1 * SUB
// How long a punched plant sways, an attack's shape flashes as it lands, a spark lasts, and a damage number rises.
const SHAKE_MS = 260
// How long a killed animal takes to fall over before it is gone.
const DEATH_MS = 450
const SWING_MS = 280
const SPARK_MS = 280
const NUMBER_MS = 900
// How far past reach (as a share of it) the player can walk from what they have open before it closes.
const CLOSE_AWAY = 1
// Refusals answered with a sound only.
const QUIET_REFUSALS: ReadonlySet<string> = new Set(['busy', 'noWork', 'needsTool', 'noRecipe', 'notFood', 'fullHealth', 'eatTooSoon'])
// How long a command can go unanswered before the player is told something is wrong.
const STALL_WARN_MS = 6_000
// How many hp each notch on a boss's health bar marks off.
const BOSS_NOTCH = 50

// A circle (tiles) as a polygon, for marks on the ground.
function circle(x: number, y: number, radius: number): Array<{ x: number; y: number }> {
  return Array.from({ length: 40 }, (_, i) => ({ x: x + Math.cos((i / 40) * Math.PI * 2) * radius, y: y + Math.sin((i / 40) * Math.PI * 2) * radius }))
}

// The frost lich's icicles: how long one takes to fall (as the server's ICICLE_TICKS), and how wide a ring shows where
// it will land (its reach, in tiles).
const ICICLE = itemByKey('icicle')?.id ?? -1
const ICICLE_FALL_MS = 1200
const ICICLE_RING = 0.9
// How heavy the snow is inside the ice crypt: a few flakes drifting down, out of the wind.
const DUNGEON_FLURRY = 0.12

// Runs one game: the connection, the page's copy of the world, the player's input, and each frame. It works out
// what to draw and hands it to the world renderer (render/) and the page's elements (ui/); it draws nothing itself.
export async function startGame({ container, code, name, onLeave, local: solo }: GameOptions): Promise<() => void> {
  const root = element('div', 'game')
  const stage = element('div', 'game-stage')
  const hudRoot = element('div', 'game-hud')
  root.append(stage, hudRoot)
  container.replaceChildren(root)

  const settings = new Settings()
  const view = await createView(settings, stage)

  let disposed = false
  let welcomed = false
  let placed = false
  let lastStateTick = -1
  const roster = new Map<number, string>()
  let playerInventory: Inventory = playerInventoryOf()
  // The hotbar slot picked, 0 to HOTBAR_SLOTS - 1: what a right click puts down.
  let selectedSlot = 0
  // The slot that was picked before bare hands (Q), to go back to.
  let slotBeforeHand = 0
  let openBuilding: number | undefined
  let inventoryOpen = false
  let debug = false
  // The zoom drawn, easing towards where the wheel has put it, and when it last eased.
  let zoom = DEFAULT_ZOOM
  let zoomTarget = DEFAULT_ZOOM
  let zoomedAt = performance.now()
  let playout = PLAYOUT_START
  const local = new LocalPlayer()
  const remotes = new RemotePlayers()
  const prediction = new Prediction()
  const keys = new HeldKeys(settings)
  const sounds = new Sounds()
  sounds.setLevels({ ...settings.volumes, muted: settings.muted })
  // Which way each other player faces, kept while they stand still.
  const remoteFacing = new Map<number, number>()
  // When each plant was last punched, by ID, while it still sways.
  const shakes = new Map<number, number>()
  // The animals near the player: what each is (from the log), where each has been (from the state messages), which way
  // each last walked, when each was last hit, and where each was drawn on the last frame (in units). The one under the
  // mouse, if any.
  const animalInfo = new Map<number, AnimalInfo>()
  const animalTracks = new RemotePlayers()
  const animalFacesLeft = new Map<number, boolean>()
  // Which way each animal last walked, in radians.
  const animalFacing = new Map<number, number>()
  // The animals just killed, shown falling over for DEATH_MS before they are gone (and their drops show).
  const dying: Array<{ info: AnimalInfo; x: number; y: number; facing: number; facingLeft: boolean; at: number }> = []
  const animalHitAt = new Map<number, number>()
  let animalSpots = new Map<number, { x: number; y: number }>()
  let hoveredAnimal: number | undefined
  // What is in flight (arrows, stones, spears), and the player's health.
  const shotTracks = new RemotePlayers()
  const shotItems = new Map<number, number>()
  // The tick each one stopped on (it is drawn flying until then, and then not at all).
  const shotStopped = new Map<number, number>()
  // When each icicle was first seen (it is drawn falling from then), and those that have shattered.
  const shotSeen = new Map<number, number>()
  const shattered = new Set<number>()
  let health = PLAYER_MAX_HEALTH
  // How warm the player's body is, in tenths of a °C, as the server last said (see cold.ts).
  let bodyTenths = BODY_NORMAL * 10
  // The world's name (the server says it when the page joins).
  let worldName = solo ? 'Singleplayer' : code
  const localDumps = new Map<string, ChunkSnapshot>()

  // ---- the page's elements

  const inviteLink = (): string => `${window.location.origin}${window.location.pathname}?game=${code}`
  const copyInvite = async (): Promise<void> => {
    if (solo) {
      hud.toast('This is a singleplayer world, run in this browser: nobody else can join it.')
      return
    }
    hud.toast((await copyText(inviteLink())) ? 'Invite link copied.' : `Invite others with the code ${code}.`)
  }
  const hud = createHudView(hudRoot, () => void copyInvite())
  // The temperature where the player is, and the snow blowing over the view in the cold.
  const snow = createSnowstorm(stage)
  const frost = createFrostView(stage)
  // The health of a boss being fought, across the top of the screen.
  const bossFill = element('div', 'boss-fill')
  const bossName = element('span', 'boss-name')
  // Its health as a number over the bar, and the bar marked off every BOSS_NOTCH hp.
  const bossHp = element('span', 'boss-hp')
  const bossNotches = element('div', 'boss-notches')
  const bossBar = element('div', 'boss-bar', bossName, element('div', 'boss-track', bossFill, bossNotches, bossHp))
  let bossNotchesFor = 0
  bossBar.hidden = true
  hudRoot.append(bossBar)
  hud.setConnecting(solo ? 'Making the world…' : `Connecting to ${code}…`)
  const hotbar = createHotbarView(hudRoot, (slot) => {
    selectedSlot = slot
  })
  const closePanels = (): void => {
    inventoryOpen = false
    openBuilding = undefined
  }
  const panels = createInventoryPanels(hudRoot, {
    take: (id, item, max) => {
      send({ k: 'take', id, item, max })
      sounds.play('move')
    },
    put: (id, item, max) => {
      send({ k: 'put', id, item, max })
      sounds.play('move')
    },
    chest: (id, action) => {
      send({ k: 'chest', id, action })
      sounds.play('pickup')
    },
    rename: (id, chestName) => send({ k: 'rename', id, name: chestName }),
    slot: (from, to, count) => {
      send({ k: 'slot', from, to, count })
      sounds.play('move')
    },
    drop: (from, count, screen) => {
      const rect = view.canvas.getBoundingClientRect()
      const at = view.pick({ x: screen.x - rect.left, y: screen.y - rect.top })
      send({ k: 'drop', from, count, x: Math.round(at.x * SUB), y: Math.round(at.y * SUB) })
    },
    craft: (recipe, times) => craftByHand(recipe, times),
    press: (id, buttonId) => pressMachine(id, buttonId),
    recipe: (id, index, times) => machineRecipe(id, index, times),
    select: (slot) => {
      selectedSlot = slot
    },
    close: closePanels,
  })
  const debugOverlay = createDebugOverlay(hudRoot)
  // The room's settings: who the host is, and whether players can hurt each other (the host can change it).
  let room = { host: '', pvp: true }
  const roomListeners = new Set<() => void>()
  // When each player was last hurt by another, by ID, to flash them red.
  const playerHitAt = new Map<number, number>()
  const pause = createPauseMenu(
    hudRoot,
    settings,
    { onCopyInvite: () => void copyInvite(), onLeave: () => leave() },
    {
      // The connection (`mirror`) is made below, after this menu: until the server has welcomed the player, the name they
      // asked for stands in for the one the server gave them.
      get: () => {
        const me = welcomed ? (roster.get(mirror.playerId) ?? name) : name
        return { host: room.host, pvp: room.pvp, isHost: room.host !== '' && room.host.toLowerCase() === me.toLowerCase() }
      },
      setPvp: (on) => send({ k: 'pvp', on }),
      subscribe: (listener) => {
        roomListeners.add(listener)
        return () => roomListeners.delete(listener)
      },
    },
  )

  // The key hints in the top right, written with the keys the player has bound.
  const refreshHints = (): void => {
    const walk = (['up', 'left', 'down', 'right'] as const).map((action) => settings.keyLabel(action))
    const first = settings.keyLabel(HOTBAR_ACTIONS[0])
    const last = settings.keyLabel(HOTBAR_ACTIONS[HOTBAR_ACTIONS.length - 1])
    hud.setHints([
      [walk.every((key) => key.length === 1) ? walk.join('') : walk.join(' '), 'walk'],
      ['LMB', 'punch'],
      ['RMB', 'place / use'],
      ...(first && last ? [[`${first}–${last}`, 'hotbar'] as const] : []),
      ...(settings.keyLabel('inventory') ? [[settings.keyLabel('inventory'), 'inventory'] as const] : []),
      ['Esc', 'menu'],
    ])
  }
  refreshHints()
  const unsubscribeSettings = settings.subscribe(() => {
    sounds.setLevels({ ...settings.volumes, muted: settings.muted })
    refreshHints()
  })

  // ---- the world and the connection

  const mirror = new FactoryMirror({
    onWelcome: (welcome) => {
      welcomed = true
      if (welcome.name) worldName = welcome.name
      hud.setConnecting(undefined)
    },
    onRoster: (players) => {
      roster.clear()
      for (const [id, playerName] of players) roster.set(id, playerName)
    },
    onRoom: (next) => {
      room = next
      for (const listener of roomListeners) listener()
    },
    // A player hurt by another: it flashes red with the damage rising off it; knocked out, it is back at the spawn.
    onHurt: ({ id, amount, died }) => {
      const now = performance.now()
      playerHitAt.set(id, now)
      const spot = id === mirror.playerId ? local.position : remotes.positionsAt(lastRemoteTick).find((remote) => remote.id === id)
      if (spot) numbers.push({ x: spot.x / SUB, y: spot.y / SUB, text: `-${amount}`, at: now })
      // Hurt yourself: a thud and a grunt; someone else, the dull thump of the hit.
      sounds.play(id === mirror.playerId ? 'hurt' : 'hit/animal')
      if (died) hud.toast(id === mirror.playerId ? 'You were knocked out, and woke up back at the start.' : `${roster.get(id) ?? 'Someone'} was knocked out.`)
    },
    onAnimal: (info) => {
      const before = animalInfo.get(info.id)
      animalInfo.set(info.id, info)
      // An archer that stops aiming without being hurt has loosed its arrow.
      if (before?.aim !== undefined && info.aim === undefined && info.hp >= before.hp) sounds.play('attack/shoot')
      if (before && info.hp < before.hp) {
        const now = performance.now()
        const spot = animalSpots.get(info.id)
        animalHitAt.set(info.id, now)
        sounds.play(animalSound(info.kind))
        if (spot) {
          numbers.push({ x: spot.x / SUB, y: spot.y / SUB, text: `-${before.hp - info.hp}`, at: now })
          sparks.push({ x: spot.x / SUB, y: spot.y / SUB, at: now, color: 0xd9483b })
        }
      }
    },
    onGear: ({ id, held, armor }) => {
      gear.set(id, { held, armor })
    },
    onSwung: ({ id, item, special, angle }) => {
      const weapon = WEAPONS.get(item === NO_ITEM ? 'hand' : getItem(item as ItemId).key) ?? WEAPONS.get('hand')!
      flashes.push({ id, weapon, special, angle, at: performance.now() })
      remoteFacing.set(id, angle)
    },
    // A boss's wave of cold air: drawn rolling out from it, as the server rolls it (see dungeons.ts).
    onWave: ({ x, y, delay }) => {
      waves.push({ x: x / SUB, y: y / SUB, at: performance.now() + (delay * 1000) / TPS })
      sounds.play('wave')
    },
    onAnimalGone: (id, died) => {
      // Killed: the blow's number rises off it, and it falls over (its drops show once it has: see visibleDrops).
      const info = animalInfo.get(id)
      const spot = animalSpots.get(id)
      if (info && spot && died !== undefined) {
        const now = performance.now()
        numbers.push({ x: spot.x / SUB, y: spot.y / SUB, text: `-${died}`, at: now })
        sparks.push({ x: spot.x / SUB, y: spot.y / SUB, at: now, color: 0xd9483b })
        sounds.play(animalSound(info.kind))
        dying.push({ info, x: spot.x / SUB, y: spot.y / SUB, facing: animalFacing.get(id) ?? Math.PI, facingLeft: animalFacesLeft.get(id) ?? true, at: now })
      }
      animalInfo.delete(id)
      animalFacesLeft.delete(id)
      animalFacing.delete(id)
      animalHitAt.delete(id)
    },
    onResult: (result) => {
      prediction.settle(result.seq)
      if (!result.ok) local.cancelDash(result.seq)
      // A punch a little too soon after the last is simply not counted; it is not worth a message. Crafting and eating
      // that cannot be done only make their sound.
      if (!result.ok && result.why && QUIET_REFUSALS.has(result.why)) sounds.play('craft/fail')
      else if (!result.ok && result.why && result.why !== 'tooSoon') hud.toast(REFUSALS[result.why], 'error')
    },
    onPlayerInventory: (inventory) => {
      const before = new Map(inventoryTotals(playerInventory).map((total) => [total.item, total.count]))
      let gainedAny = false
      for (const { item, count } of inventoryTotals(inventory)) {
        const gained = count - (before.get(item) ?? 0)
        if (gained <= 0) continue
        hud.pickup(`+${gained} ${getItem(item).name}`)
        gainedAny = true
      }
      if (gainedAny) sounds.play('pickup')
      playerInventory = inventory
    },
    onDesync: (report, snapshot) => {
      connection.sendDesync(report)
      const { cx, cy } = chunkCoords(report.chunk)
      console.warn(`Chunk ${cx},${cy} differs from the server's at tick ${report.tick}; it is being sent again.`)
      if (import.meta.env.DEV) {
        localDumps.set(`${report.chunk}@${report.tick}`, snapshot)
        if (localDumps.size > 8) localDumps.delete(localDumps.keys().next().value!)
      }
    },
    onDump: (chunk, tick, server) => {
      const mine = localDumps.get(`${chunk}@${tick}`)
      const { cx, cy } = chunkCoords(chunk)
      if (!mine || !server) {
        console.info(`Chunk ${cx},${cy} at tick ${tick}: there is no copy from ${mine ? 'the server' : 'this page'} to compare.`)
        return
      }
      const lines = diffChunkSnapshots(mine, server)
      console.groupCollapsed(`Desync in chunk ${cx},${cy} at tick ${tick}: ${lines.length} difference(s)`)
      for (const line of lines) console.log(line)
      console.log('this page:', mine)
      console.log('server:', server)
      console.groupEnd()
    },
  })

  const handlers: ConnectionHandlers = {
    onLog: (message) => mirror.receiveLog(message),
    onState: (state) => {
      if (state.t <= lastStateTick) return
      lastStateTick = state.t
      mirror.noteState(state.t, state.s)
      const self = state.p.find((player) => player[0] === mirror.playerId)
      if (self && mirror.started) {
        if (!placed) {
          local.place({ x: self[1], y: self[2] })
          placed = true
        } else local.reconcile({ x: self[1], y: self[2] }, state.a, state.d ?? 0)
      }
      remotes.update(state.t, state.p, mirror.playerId)
      animalTracks.update(state.t, state.n ?? [], -1)
      shotTracks.update(state.t, (state.j ?? []).map(([id, , x, y]): [number, number, number] => [id, x, y]), -1)
      for (const [id, item, , , stopped] of state.j ?? []) {
        shotItems.set(id, item)
        if (stopped && !shotStopped.has(id)) shotStopped.set(id, state.t)
      }
      if (state.h !== undefined) health = state.h
      if (state.b !== undefined) bodyTenths = state.b
    },
    onError: (message) => {
      if (!welcomed) leave(message, true)
      else hud.toast(message, 'error')
    },
    onDisconnect: () => leave('The connection to the game was lost.', true),
  }
  // Online, the game server; in singleplayer, the world run in this browser.
  const connection = solo ? connectLocal(solo.seed, name, handlers, solo.terrain) : connect(code, name, handlers)
  // The player walks into what the page's copy of the world says is solid, and is pushed out of it, and is slowed by
  // what it says is slow (bushes).
  local.solid = solidIn(mirror.world, () => (mirror.started ? mirror.terrain : undefined))
  local.slow = slowIn(mirror.world)
  // Freezing, the player is slowed here as on the server (see cold.ts), by how cold the server says its body is.
  local.speedPercent = () => coldSpeedPercent(bodyTenths)
  // The animals and other players, which the player is pushed off when on top of them.
  let lastRemoteTick = 0
  local.crowd = () => {
    const crowd: Array<{ x: number; y: number; half: number; mass: number }> = []
    for (const info of animalInfo.values()) {
      const spot = animalSpots.get(info.id)
      const def = animalDef(info.kind)
      if (spot) crowd.push({ ...spot, half: def.halfSize, mass: def.mass })
    }
    for (const remote of remotes.positionsAt(lastRemoteTick)) crowd.push({ x: remote.x, y: remote.y, half: PLAYER_HALF_SIZE, mass: PLAYER_MASS })
    return crowd
  }
  // The animals this player leads, which the rope pulls the player towards.
  local.tethers = () => {
    const pulling: Array<{ x: number; y: number; mass: number }> = []
    for (const info of animalInfo.values()) {
      const spot = animalSpots.get(info.id)
      if (info.leader === mirror.playerId && spot) pulling.push({ ...spot, mass: animalDef(info.kind).mass })
    }
    return pulling
  }
  const connectTimer = setTimeout(() => {
    if (!welcomed) leave(solo ? 'The world could not start in this browser.' : 'Could not reach the game server.', true)
  }, CONNECT_TIMEOUT_MS)

  // ---- commands

  // Sends a command; gives its number (undefined if not sent).
  const send = (command: Command): number | undefined => {
    if (!welcomed) return undefined
    // Every number in a command must be a real one: NaN and Infinity go over the wire as null, which the server cannot
    // read. Such a command is a bug here; it is not sent.
    if (!finiteThroughout(command)) {
      console.error('Not sent: a command with a number that is not a number.', command)
      return undefined
    }
    const now = performance.now()
    const seq = connection.sendCommand(connection.clock.commandTick(now), command)
    prediction.add(seq, command, now)
    return seq
  }

  // The player's inventory as it will be once what has been asked for is done.
  const predictedInventory = (): Inventory => prediction.predictInventories(playerInventory, mirror.world).player

  // How much a hit with what is in the picked hotbar slot does to a plant or rock.
  const damageTo = (target: Entity): number => {
    if (isHarvest(target)) return 0
    const inventory = predictedInventory()
    return resourceDamage(target.kind, weaponIn(inventory, selectedSlot), toolIn(inventory, selectedSlot))
  }
  // A hit on a garden plot with a crop in it takes the crop, and leaves the plot as it was.
  const isHarvest = (target: Entity): boolean => target.kind === 'plot' && target.crop !== 0

  // The hits a plant or rock has left once the hits waiting for an answer have landed (as near as the page can tell:
  // they are counted as hits with what is held now).
  const punchesLeft = (plant: Entity): number => {
    const pending = prediction.punchesAt(plant.id)
    return pending === 0 ? hpOf(plant) : hpOf(plant) - pending * damageTo(plant)
  }

  // The plant or rock on a tile that a punch would land on: in reach, and not already punched down.
  const punchable = (x: number, y: number): Entity | undefined => {
    const entity = mirror.world.entityAt(x, y)
    if (!entity || !isHittable(entity) || punchesLeft(entity) <= 0) return undefined
    return isWithinReach(local.position, x, y) ? entity : undefined
  }


  // ---- attacking (see weapons.ts): the left button is the basic attack, the right the special one. A shot (bow,
  // sling) or a throw is held to charge, slowing the player; a special is held for its windup and lands, aimed at the
  // mouse, when let go. Every attack shares one cooldown. What it hits is the server's to say: the page draws the
  // swing and plays its sound at once.
  type Charging = { special: boolean; start: number; weapon: Weapon }
  let charging: Charging | undefined
  let attackReadyAt = 0
  // Until when the player is slowed by having just attacked (see ATTACK_SLOW_TICKS), in page time.
  let attackSlowUntil = 0
  // Until when the player stands still, making an attack.
  let attackStillUntil = 0
  // When the player was last told the game is not answering.
  let stallWarnedAt = Number.NEGATIVE_INFINITY
  // The attacks being made, by this player and the others (for their arms' swing and the swish behind the weapon, each
  // for SWING_MS); sparks where they hit something; and the numbers that rise off animals that are hurt. Positions in
  // tiles.
  const flashes: Array<{ id: number; weapon: Weapon; special: boolean; angle: number; at: number }> = []
  // Waves of cold air: from where (tiles), rolling out from when (ms; before then it is gathering).
  const waves: Array<{ x: number; y: number; at: number }> = []
  // What each other player holds and wears (see the `gear` event), and the slot this page last told the server it holds.
  const gear = new Map<number, { held: number; armor: number[] }>()
  let holdSent: number | undefined
  const sparks: Array<{ x: number; y: number; at: number; color: number }> = []
  const numbers: Array<{ x: number; y: number; text: string; at: number }> = []

  const heldWeapon = (): Weapon => weaponIn(predictedInventory(), selectedSlot)
  // Where the mouse points, in units (straight ahead of the player without a mouse).
  const aimPoint = (): { x: number; y: number } => {
    if (!pointer) return { x: local.position.x + Math.cos(local.facing) * SUB, y: local.position.y + Math.sin(local.facing) * SUB }
    // The ground under the mouse itself, not the middle of a tree or rock there, so the attack goes exactly that way.
    const world = view.aim(pointer)
    return { x: Math.round(world.x * SUB), y: Math.round(world.y * SUB) }
  }
  // Whether holding this attack slows the player down (charging a shot or a throw).
  const slowsWhileCharging = (held: Charging): boolean =>
    held.special ? held.weapon.special?.kind === 'throw' : held.weapon.basic === 'shot'
  // How long an attack has to be held, and the most it charges, in milliseconds.
  const windupMs = (held: Charging): number => (held.special ? (held.weapon.special?.windup ?? 0) : held.weapon.windup) * TICK_MS
  const fullMs = (held: Charging): number =>
    Math.max(windupMs(held), (held.special ? (held.weapon.special?.charge ?? 0) : held.weapon.charge) * TICK_MS)

  const attack = (special: boolean, weapon: Weapon, chargeMs: number): void => {
    if (!welcomed) return
    const now = performance.now()
    if (now < attackReadyAt) return
    const inventory = predictedInventory()
    const ammo = weapon.ammo
    const move = weapon.special
    if (special && !move) return
    const needsAmmo = (!special && weapon.basic === 'shot') || (special && move?.kind === 'volley')
    if (needsAmmo && (ammo === undefined || countOf(inventory, ammo) === 0)) {
      hud.toast(REFUSALS.noAmmo, 'error')
      attackReadyAt = now + 400
      return
    }
    const aim = aimPoint()
    const angle = Math.atan2(aim.y - local.position.y, aim.x - local.position.x)
    // With the tick the animals are drawn at, so the server judges the attack against where they are seen.
    const seen = Math.max(0, Math.round(lastRemoteTick))
    // The way it goes, in thousandths of a radian: the server dashes the player exactly this way too.
    const dir = Math.round(angle * 1000)
    const seq = send({ k: 'attack', special, slot: selectedSlot, x: aim.x, y: aim.y, charge: Math.round(chargeMs / TICK_MS), seen, input: local.lastInput, dir })
    // A lunge or a volley's hop carries the player, from the next input on, as the server will (see dashOf).
    if (seq !== undefined && special && move?.kind === 'lunge') local.dash(dashOf(dir / 1000, move.dash, local.lastInput), seq)
    if (seq !== undefined && special && move?.kind === 'volley') local.dash(dashOf(dir / 1000 + Math.PI, move.hop, local.lastInput), seq)
    attackReadyAt = now + (special ? (move?.cooldown ?? 0) : weapon.cooldown) * TICK_MS
    attackSlowUntil = now + ATTACK_SLOW_TICKS * TICK_MS
    // The player stands still while the attack is made, so the swing is not dragged about.
    attackStillUntil = now + SWING_MS
    local.facing = angle
    flashes.push({ id: mirror.playerId, weapon, special, angle, at: now })
    sounds.play(attackSound(special, weapon))
    if (!special && weapon.basic !== 'shot') showHits(weapon, angle, now)
  }

  // What a basic swing is about to hit, shown at once (the server has the last word, a moment later): everything it
  // reaches shakes and throws up a spark, with the sound of what it is. Animals are not guessed at: they flash, spark and
  // show their damage only once the server says they were hurt (see onAnimal), so the flash and the number always agree.
  const showHits = (weapon: Weapon, angle: number, now: number): void => {
    const targets = tilesHitBy(mirror.world, weapon, local.position, angle)
    for (const target of targets) {
      shakes.set(target.id, now)
      sparks.push({ x: target.x + 0.5, y: target.y + 0.5, at: now, color: hitColor(target.kind) })
    }
    const first = targets[0]
    if (first) sounds.play(hitSound(first.kind))
  }
  const hitColor = (kind: Entity['kind']): number =>
    kind === 'rock' ? 0xb9bcc2 : kind === 'bush' || kind === 'grass' || kind === 'plot' ? 0x6fbf4a : 0xc49562
  const hitSound = (kind: Entity['kind']): SoundId =>
    kind === 'rock' ? 'punch/stone' : kind === 'bush' || kind === 'grass' || kind === 'plot' ? 'punch/leaves' : 'punch/wood'

  const attackSound = (special: boolean, weapon: Weapon): SoundId => {
    if (!special) return weapon.basic === 'shot' ? 'attack/shoot' : weapon.basic === 'jab' ? 'attack/jab' : weapon.basic === 'thrust' ? 'attack/thrust' : 'attack/swing'
    const kind = weapon.special?.kind
    return kind === 'throw' ? 'attack/throw' : kind === 'volley' ? 'attack/shoot' : 'attack/heavy'
  }

  // Whether the player can attack: holding a weapon or a tool, or nothing (an empty slot, or Q). Holding anything else
  // (logs, seeds) there is no attack: fists are for an empty hand.
  const holdsWeaponOrNothing = (): boolean => {
    const inHand = predictedInventory().slots[selectedSlot]
    return !inHand || inHand.count === 0 || WEAPONS.has(getItem(inHand.item).key)
  }

  // Starts holding an attack (a shot, a throw, a windup), or does it at once if it needs no holding.
  const pressAttack = (special: boolean): void => {
    if (!holdsWeaponOrNothing()) return
    const weapon = heldWeapon()
    if (special && !weapon.special) return
    // A shot with nothing to shoot is not drawn back at all.
    const needsAmmo = (!special && weapon.basic === 'shot') || (special && weapon.special?.kind === 'volley')
    if (needsAmmo && (weapon.ammo === undefined || countOf(predictedInventory(), weapon.ammo) === 0)) {
      if (performance.now() >= attackReadyAt) hud.toast(REFUSALS.noAmmo, 'error')
      attackReadyAt = Math.max(attackReadyAt, performance.now() + 400)
      return
    }
    const held: Charging = { special, start: performance.now(), weapon }
    if (windupMs(held) === 0 && fullMs(held) === 0) attack(special, weapon, 0)
    else if (!special && weapon.basic !== 'shot') attack(false, weapon, 0)
    else charging = held
  }

  // Lets go of a held attack: it lands if it was held long enough.
  const releaseAttack = (special: boolean): void => {
    if (!charging || charging.special !== special) return
    const held = charging
    charging = undefined
    const heldFor = performance.now() - held.start
    if (heldFor >= windupMs(held)) attack(special, held.weapon, Math.min(heldFor, fullMs(held)))
  }

  // Whether a right click attacks: with a weapon (or a tool, which is one) it is the weapon's special attack, and
  // nothing else; bare-handed or holding anything else, it is for using things (opening, putting down, filling a bucket,
  // leading an animal), and never an attack.
  const rightClickAttacks = (): boolean => heldWeapon().key !== 'hand'

  // A right click on an animal: put a rope on it (or take it off), or milk it.
  const interact = (id: number): void => {
    if (!welcomed) return
    send({ k: 'interact', animal: id, slot: selectedSlot })
  }

  // A right click on a tile: opens a building with an inventory there, or puts down what the picked hotbar slot holds
  // (plants an acorn). A drag over tiles plants along it, skipping quietly where it cannot; a click says why not.
  const place = (x: number, y: number, quiet: boolean): void => {
    if (!welcomed) return
    const there = mirror.world.entityAt(x, y)
    if (there?.kind === 'gate') {
      if (!quiet) send({ k: 'toggle', id: there.id })
      return
    }
    // A bucket or compost is used on what it is pointed at: a pond, a barrel, a garden plot.
    const using = predictedInventory().slots[selectedSlot]
    const tool = using && using.count > 0 ? getItem(using.item) : undefined
    // A bucket fills at a pond, empties into a barrel or onto a plot, or is emptied out on bare ground.
    const dumps = tool?.bucket !== undefined && tool.bucket !== 'empty' && !there
    if (tool && tool.bucket && (there?.kind === 'barrel' || there?.kind === 'plot' || (!there && mirror.terrain !== undefined && waterAt(mirror.terrain, x, y)) || dumps)) {
      if (!quiet) send({ k: 'apply', x, y, slot: selectedSlot })
      return
    }
    // A sleeping bag: sleep in it, to wake up here next time you are knocked out.
    if (there?.kind === 'bed') {
      if (!quiet) sleepIn(there.id)
      return
    }
    if (there && hasInventory(there)) {
      if (!quiet) openBuilding = there.id
      return
    }
    const inventory = predictedInventory()
    const held = inventory.slots[selectedSlot]
    if (!held || held.count === 0) return
    if (!getItem(held.item).places && getItem(held.item).crop === undefined) {
      if (!quiet) hud.toast(REFUSALS.notPlaceable, 'error')
      return
    }
    if (prediction.occupies(x, y)) return
    const check = checkPlace(mirror.world, local.position, inventory, selectedSlot, x, y, mirror.terrain)
    if (!check.ok) {
      if (!quiet) hud.toast(REFUSALS[check.why], 'error')
      return
    }
    send({ k: 'place', x, y, slot: selectedSlot })
    sounds.play('plant')
  }

  // ---- input

  let pointer: { x: number; y: number } | undefined
  let leftDown = false
  let rightDown = false
  let lastDragTile = ''
  const tileUnderPointer = (): { x: number; y: number } | undefined => {
    if (!pointer) return undefined
    const at = view.pick(pointer)
    return { x: Math.floor(at.x), y: Math.floor(at.y) }
  }

  const canvas = view.canvas
  const onPointerMove = (event: PointerEvent): void => {
    pointer = { x: event.offsetX, y: event.offsetY }
    const tile = tileUnderPointer()
    if (!tile || pause.isOpen || !rightDown || charging || rightClickAttacks()) return
    const key = `${tile.x},${tile.y}`
    if (key === lastDragTile) return
    lastDragTile = key
    if (hoveredAnimal === undefined) place(tile.x, tile.y, true)
  }
  const onPointerDown = (event: PointerEvent): void => {
    pointer = { x: event.offsetX, y: event.offsetY }
    const tile = tileUnderPointer()
    if (!tile || pause.isOpen) return
    lastDragTile = `${tile.x},${tile.y}`
    if (event.button === 0) {
      leftDown = true
      pressAttack(false)
    } else if (event.button === 2) {
      rightDown = true
      if (rightClickAttacks()) pressAttack(true)
      else if (hoveredAnimal !== undefined) interact(hoveredAnimal)
      else place(tile.x, tile.y, false)
    }
  }
  const onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0) {
      leftDown = false
      releaseAttack(false)
    }
    if (event.button === 2) {
      rightDown = false
      releaseAttack(true)
    }
  }
  const onPointerLeave = (): void => {
    pointer = undefined
  }
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    // Lines or pages (some mice, some browsers) as pixels, a notch being about 100.
    const scale = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 800 : 1
    zoomTarget = zoomAfterWheel(zoomTarget, event.deltaY * scale)
  }
  const onContextMenu = (event: Event): void => event.preventDefault()

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingIn(event.target)) return
    if (event.code === 'Escape') {
      event.preventDefault()
      if (pause.isOpen) pause.back()
      else if (inventoryOpen || openBuilding !== undefined) closePanels()
      else {
        keys.clear()
        leftDown = false
        rightDown = false
        pause.open()
      }
      return
    }
    if (pause.isOpen) return
    if (event.code === 'F9' && import.meta.env.DEV) {
      event.preventDefault()
      corruptForTesting()
      return
    }
    const action = settings.actionOf(event.code)
    if (!action) return
    event.preventDefault()
    if (isMovementAction(action)) {
      keys.press(event.code)
      return
    }
    if (event.repeat) return
    const slot = HOTBAR_ACTIONS.indexOf(action)
    if (slot >= 0) {
      // Over a stack in the open inventory: swapped with that hotbar slot.
      const over = inventoryOpen || openBuilding !== undefined ? panels.hovered() : undefined
      if (over) {
        const from = over.side === 'player' ? { id: 0, i: over.index } : openBuilding !== undefined ? { id: openBuilding, i: over.index } : undefined
        if (from && !(from.id === 0 && from.i === slot)) {
          send({ k: 'slot', from, to: { id: 0, i: slot }, count: 100_000 })
          sounds.play('move')
        }
        return
      }
      selectedSlot = slot
      return
    }
    if (action === 'hand') {
      // During a windup or a charge, it is called off, and nothing else.
      if (charging) {
        charging = undefined
        return
      }
      // Bare hands, or, already bare-handed, back to what was held before.
      if (selectedSlot === -1) selectedSlot = slotBeforeHand
      else {
        slotBeforeHand = selectedSlot
        selectedSlot = -1
      }
      return
    }
    if (action === 'inventory') {
      if (inventoryOpen || openBuilding !== undefined) closePanels()
      else inventoryOpen = true
    } else if (action === 'eat') eat()
    else if (action === 'debug') debug = !debug
  }
  const onKeyUp = (event: KeyboardEvent): void => keys.release(event.code)
  // The browser lets the page make sound only once the player has pressed something.
  const unlockSound = (): void => sounds.unlock()
  const onBlur = (): void => {
    keys.clear()
    leftDown = false
    rightDown = false
  }

  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  // No browser menu on a right click anywhere in the game (over the panels as much as the world).
  window.addEventListener('contextmenu', onContextMenu)
  const disposeTooltips = createTooltips(hudRoot)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('pointerdown', unlockSound, true)
  window.addEventListener('keydown', unlockSound, true)

  // In a development build, F9 changes this page's copy of a chunk behind the log's back, to see a desync found and
  // put right (the chunk's next hash does not match, the server sends it again, and the console shows the difference).
  const corruptForTesting = (): void => {
    for (const chunkId of mirror.world.chunkIds) {
      const entity = mirror.world.chunk(chunkId)!.entities.find((candidate) => candidate.kind !== 'sapling')
      if (!entity) continue
      if (hasInventory(entity)) entity.inv.slots[entity.inv.slots.length - 1] = { item: 1, count: 7 }
      else if (isBeltLike(entity)) entity.lane.push({ item: 1, pos: 8, prev: 8 })
      else if (entity.kind === 'tree' || entity.kind === 'bush') entity.hp = entity.hp > 1 ? entity.hp - 1 : 2
      hud.toast(`Changed ${BUILDINGS[entity.kind].name.toLowerCase()} ${entity.id} on this page only: watch the desync be put right.`)
      return
    }
    hud.toast('There is nothing near here to change.')
  }

  // ---- each frame

  let lastFrameAt = performance.now()
  let localClock = 0
  let lastUiAt = 0
  let lastDebugAt = 0

  const frame = (): void => {
    if (disposed) return
    const now = performance.now()
    const elapsed = Math.min(250, now - lastFrameAt)
    lastFrameAt = now
    const clock = connection.clock

    // The player's own movement, a tick at a time, sent as it is played.
    if (placed && clock.ready) {
      localClock = Math.min(localClock + elapsed, TICK_MS * 6)
      while (localClock >= TICK_MS) {
        localClock -= TICK_MS
        // Charging a shot or a throw, or just after an attack, the player is slowed (so a fight cannot be run from
        // with the weapon swinging).
        const slow = (charging && slowsWhileCharging(charging)) || performance.now() < attackSlowUntil ? KEY_SLOW : 0
        const still = pause.isOpen || performance.now() < attackStillUntil
        connection.sendInputs(local.step(still ? 0 : keys.movement(view.turned) | slow))
        stepSounds()
      }
    }

    // The world, a few ticks behind the server: every tick the log is complete for, up to the playout point.
    let alpha = 1
    if (mirror.started && clock.ready) {
      const display = clock.arrivalTick(now) - playout
      const target = Math.floor(display)
      const catchingUp = target - mirror.simTick > 10
      const deadline = now + 8
      let steps = 0
      while (mirror.canStep() && mirror.simTick < target) {
        mirror.step()
        steps++
        if (!catchingUp && steps >= 3) break
        if (catchingUp && (steps & 15) === 0 && performance.now() > deadline) break
      }
      if (mirror.simTick < target && !mirror.canStep()) playout = Math.min(PLAYOUT_MAX, playout + 0.1)
      else playout = Math.max(PLAYOUT_MIN, playout - 0.002)
      alpha = Math.min(1, Math.max(0, display - mirror.simTick))
    }

    // The animals, drawn a little in the past like the other players, and the one under the mouse.
    const remoteTick = clock.ready ? clock.arrivalTick(now) - REMOTE_DELAY_TICKS : 0
    lastRemoteTick = remoteTick
    const animals = animalViews(remoteTick, now)

    // Holding the left button keeps attacking as the cooldown allows (a shot is held to charge instead). Crops are
    // harvested by what the attack covers, like anything else.
    if (leftDown && !pause.isOpen && !charging && holdsWeaponOrNothing()) {
      const weapon = heldWeapon()
      if (weapon.basic !== 'shot' && now >= attackReadyAt) attack(false, weapon, 0)
    }
    if (pause.isOpen) charging = undefined

    // The camera follows the player, drawn between its last two ticks.
    const t = localClock / TICK_MS
    const playerX = local.previous.x + (local.position.x - local.previous.x) * t
    const playerY = local.previous.y + (local.position.y - local.previous.y) * t
    const zoomNow = performance.now()
    zoom = easeZoom(zoom, zoomTarget, Math.min(100, zoomNow - zoomedAt))
    zoomedAt = zoomNow
    view.look({ x: playerX / SUB, y: playerY / SUB }, zoom)

    const buildings = visibleBuildings(remoteTick)
    const removing = new Set(prediction.removals())
    for (const building of buildings) {
      const entity = mirror.world.entity(building.id)
      if (entity && isNatural(entity) && punchesLeft(entity) <= 0) removing.add(entity.id)
    }
    // The cold: frost creeping over the view as the body cools, and snow blowing in cold air (only a few flakes
    // drifting down in the ice crypt, out of the wind).
    if (mirror.terrain) {
      const position = { x: Math.round(playerX), y: Math.round(playerY) }
      const inside = isInDungeons(tileOfUnits(position.x), tileOfUnits(position.y))
      frost.update(frostOf(bodyTenths / 10), elapsed)
      snow.update(inside ? DUNGEON_FLURRY : snowAt(airTemperatureAt(mirror.terrain, position.x / SUB, position.y / SUB)), elapsed)
    }
    view.draw({
      terrain: mirror.terrain,
      buildings,
      removingIds: removing,
      shaking: shaking(now),
      now,
      alpha,
      players: players(playerX, playerY, remoteTick, now),
      drops: visibleDrops(alpha),
      animals,
      attacks: attackView(now, playerX / SUB, playerY / SUB, remoteTick),
      overlay: overlay(buildings),
      ...(debug ? { debug: debugView() } : {}),
    })

    if (openBuilding !== undefined) panels.setProgress(workProgress(alpha))

    if (now - lastUiAt >= UI_MS) {
      lastUiAt = now
      prediction.expire(now)
      // Commands waiting a long time for their answer: the server is not hearing them (or not answering), so say so
      // rather than leaving the player wondering why nothing they do takes effect.
      const oldest = prediction.oldestSentAt()
      if (oldest !== undefined && now - oldest > STALL_WARN_MS && now - stallWarnedAt > STALL_WARN_MS * 3) {
        stallWarnedAt = now
        hud.toast('The game has not answered for a while: what you do may not be taking effect. Leaving and joining again will fix it.', 'error')
      }
      updateUi()
    }
    if (now - lastDebugAt >= DEBUG_MS) {
      lastDebugAt = now
      debugOverlay.update(debug ? debugLines(now) : undefined)
    }
  }
  view.start(frame)

  // How hard each punched plant still sways, from 1 at the punch down to 0, forgetting those that have stopped.
  const shaking = (now: number): Map<number, number> => {
    const amounts = new Map<number, number>()
    for (const [id, at] of shakes) {
      const amount = 1 - (now - at) / SHAKE_MS
      if (amount > 0) amounts.set(id, amount)
      else shakes.delete(id)
    }
    return amounts
  }

  // A footstep each time the player has walked STEP_DISTANCE, sounding like the ground it is on, and a quiet rustle
  // every RUSTLE_DISTANCE while it pushes through a bush. Only how far it really went counts, so walking into a wall is
  // quiet.
  let walked = 0
  let rustled = 0
  const stepSounds = (): void => {
    const moved = Math.hypot(local.position.x - local.previous.x, local.position.y - local.previous.y)
    if (moved === 0) {
      // Stopping and starting again steps (and rustles) at once.
      walked = STEP_DISTANCE * 0.6
      rustled = RUSTLE_DISTANCE
      return
    }
    const tileX = tileOfUnits(local.position.x)
    const tileY = tileOfUnits(local.position.y)
    if (local.slow?.(tileX, tileY)) {
      rustled += moved
      if (rustled >= RUSTLE_DISTANCE) {
        rustled = 0
        sounds.play('rustle')
      }
    } else rustled = RUSTLE_DISTANCE
    walked += moved
    if (walked < STEP_DISTANCE) return
    walked -= STEP_DISTANCE
    sounds.play(footstep(surfaceAt(mirror.terrain, tileX, tileY)))
  }

  // The items on the ground in view, with how long each has lain there (in ticks, between the last tick and the next).
  const visibleDrops = (alpha: number): DropView[] => {
    const bounds = view.visible()
    const found: DropView[] = []
    for (const chunkId of mirror.world.chunkIds) {
      const { cx, cy } = chunkCoords(chunkId)
      if ((cx + 1) * CHUNK_SIZE <= bounds.left || cx * CHUNK_SIZE > bounds.right + 1) continue
      if ((cy + 1) * CHUNK_SIZE <= bounds.top || cy * CHUNK_SIZE > bounds.bottom + 1) continue
      for (const drop of mirror.world.dropsInChunk(chunkId)) {
        // What an animal just killed drops shows once it has fallen.
        const fresh = mirror.simTick - drop.born < 2 * TPS
        if (fresh && dying.some((dead) => Math.hypot(dead.x - drop.x / SUB, dead.y - drop.y / SUB) < 2.5 && performance.now() - dead.at < DEATH_MS)) continue
        found.push({ id: drop.id, item: drop.item, x: drop.x / SUB, y: drop.y / SUB, age: mirror.simTick + alpha - drop.born })
      }
    }
    return found
  }

  // How far the open miner is through digging its next item, drawn between the factory's last tick and the next (the
  // way items glide on belts), so the bar fills smoothly whenever and however often the factory steps. A miner with a
  // full store is not digging, so its bar holds still.
  const workProgress = (alpha: number): number => {
    const opened = openBuilding !== undefined ? mirror.world.entity(openBuilding) : undefined
    const machine = opened ? machineProgress(opened, alpha) : undefined
    if (machine !== undefined) return machine
    if (!opened || opened.kind !== 'miner') return 0
    const digging = roomFor(opened.inv, opened.ore, 1) > 0
    return (opened.progress + (digging ? alpha : 0)) / getItem(opened.ore).mineTicks
  }

  // The swings of the player's attacks (each for SWING_MS), the windup or charge of the one being held, and what is in
  // flight, for the attack layer.
  const attackView = (now: number, x: number, y: number, tick: number): AttackView => {
    while (flashes.length > 0 && now - flashes[0].at > SWING_MS) flashes.shift()
    while (sparks.length > 0 && now - sparks[0].at > SPARK_MS) sparks.shift()
    while (numbers.length > 0 && now - numbers[0].at > NUMBER_MS) numbers.shift()
    const view: AttackView = { marks: [], swishes: [], shots: [], sparks: [], numbers: [] }
    // The swish behind each weapon as it swings, from where its player is now, tracing what the attack covers.
    const where = new Map(remotes.positionsAt(tick).map((remote) => [remote.id, { x: remote.x / SUB, y: remote.y / SUB }]))
    where.set(mirror.playerId, { x, y })
    for (const flash of flashes) {
      const from = where.get(flash.id)
      const swish = from ? attackSwish(flash.weapon, flash.special, from.x, from.y, flash.angle, (now - flash.at) / SWING_MS) : undefined
      if (swish) view.swishes.push(swish)
    }
    for (const spark of sparks) view.sparks.push({ x: spark.x, y: spark.y, age: (now - spark.at) / SPARK_MS, color: spark.color })
    // Each archer aiming: a thin red line out along its aim, as far as it shoots, so it can be stepped out of.
    for (const info of animalInfo.values()) {
      const shoot = info.aim === undefined ? undefined : animalDef(info.kind).hunt?.shoot
      const spot = shoot ? animalSpots.get(info.id) : undefined
      if (!shoot || !spot || info.aim === undefined) continue
      const length = shoot.range / SUB
      const cx = spot.x / SUB
      const cy = spot.y / SUB
      const ax = Math.cos(info.aim)
      const ay = Math.sin(info.aim)
      const half = 0.06
      view.marks.push({
        polygons: [[
          { x: cx + ax * 0.3 - ay * half, y: cy + ay * 0.3 + ax * half },
          { x: cx + ax * length - ay * half, y: cy + ay * length + ax * half },
          { x: cx + ax * length + ay * half, y: cy + ay * length - ax * half },
          { x: cx + ax * 0.3 + ay * half, y: cy + ay * 0.3 - ax * half },
        ]],
        color: 0xd9483b,
        fill: 0.45,
        stroke: 0.2,
      })
    }
    // Each wave of cold air: a small ring gathering round the lich, then a ring rolling out to its full reach and fading.
    const rollMs = (WAVE_RADIUS / WAVE_SPEED) * 1000
    while (waves.length > 0 && now - waves[0].at > rollMs) waves.shift()
    for (const wave of waves) {
      const gathering = now < wave.at
      const radius = gathering ? 0.6 + 0.5 * Math.sin((now / 60) % (Math.PI * 2)) * 0.2 : ((now - wave.at) / 1000) * WAVE_SPEED
      const outer = circle(wave.x, wave.y, Math.max(0.2, radius))
      const fade = gathering ? 0.6 : 1 - (now - wave.at) / rollMs
      // Strong blues, to show against the pale ice of the floor: the front, and a fainter ring trailing it.
      view.marks.push({ polygons: [outer], color: 0x3f8fe0, fill: (gathering ? 0.35 : 0.22) * fade, stroke: fade })
      if (!gathering && radius > 0.5) view.marks.push({ polygons: [circle(wave.x, wave.y, radius - 0.25)], color: 0x2a6fc4, fill: 0, stroke: 0.9 * fade })
      if (!gathering && radius > 1.2) view.marks.push({ polygons: [circle(wave.x, wave.y, radius - 1.1)], color: 0x3f8fe0, fill: 0, stroke: 0.45 * fade })
    }
    for (const number of numbers) view.numbers.push({ x: number.x, y: number.y, text: number.text, age: (now - number.at) / NUMBER_MS })
    const present = new Set<number>()
    for (const shot of shotTracks.positionsAt(tick)) {
      present.add(shot.id)
      const item = shotItems.get(shot.id)
      const stopped = shotStopped.get(shot.id)
      // Drawn flying until the tick it stopped on (it is drawn in the past, so it reaches what it hit), then gone.
      if (item === undefined || (stopped !== undefined && tick >= stopped)) {
        // An icicle shatters where it lands.
        if (item === ICICLE && !shattered.has(shot.id)) {
          shattered.add(shot.id)
          sparks.push({ x: shot.x / SUB, y: shot.y / SUB, at: now, color: 0xcfeaff })
          sounds.play('punch/stone')
        }
        continue
      }
      if (item === ICICLE) {
        // Falling from above, over where it will land: a ring on the ground there, filling as it comes down.
        if (!shotSeen.has(shot.id)) shotSeen.set(shot.id, now)
        const fall = Math.min(1, (now - shotSeen.get(shot.id)!) / ICICLE_FALL_MS)
        const ring = Array.from({ length: 24 }, (_, i) => ({
          x: shot.x / SUB + Math.cos((i / 24) * Math.PI * 2) * ICICLE_RING,
          y: shot.y / SUB + Math.sin((i / 24) * Math.PI * 2) * ICICLE_RING,
        }))
        view.marks.push({ polygons: [ring], color: 0x9fd6ff, fill: 0.08 + 0.3 * fall, stroke: 0.9 })
        view.shots.push({ id: shot.id, item, x: shot.x / SUB, y: shot.y / SUB, angle: 0, fall })
        continue
      }
      view.shots.push({ id: shot.id, item, x: shot.x / SUB, y: shot.y / SUB, angle: Math.atan2(shot.dy, shot.dx) })
    }
    for (const id of shotItems.keys()) {
      if (present.has(id)) continue
      shotItems.delete(id)
      shotStopped.delete(id)
      shotSeen.delete(id)
      shattered.delete(id)
    }
    return view
  }

  // The animals in view, as drawn on this frame, and which one is under the mouse.
  const animalViews = (tick: number, now: number): AnimalView[] => {
    const spots = new Map<number, { x: number; y: number }>()
    const views: AnimalView[] = []
    const mouse = pointer && !pause.isOpen ? view.pick(pointer) : undefined
    let hovered: number | undefined
    let hoveredDistance = Number.POSITIVE_INFINITY
    const leaderSpot = (id: number): { x: number; y: number } | undefined => {
      if (id === mirror.playerId) return { x: local.position.x / SUB, y: local.position.y / SUB }
      const remote = remotes.positionsAt(tick).find((candidate) => candidate.id === id)
      return remote ? { x: remote.x / SUB, y: remote.y / SUB } : undefined
    }
    for (const track of animalTracks.positionsAt(tick)) {
      const info = animalInfo.get(track.id)
      if (!info) continue
      const def = animalDef(info.kind)
      spots.set(track.id, { x: track.x, y: track.y })
      if (track.dx !== 0) animalFacesLeft.set(track.id, track.dx < 0)
      if (track.dx !== 0 || track.dy !== 0) animalFacing.set(track.id, Math.atan2(track.dy, track.dx))
      const baby = info.growth < 100
      const view: AnimalView = {
        id: track.id,
        kind: info.kind,
        x: track.x / SUB,
        y: track.y / SUB,
        size: def.size,
        baby,
        facingLeft: animalFacesLeft.get(track.id) ?? true,
        // An archer aiming turns to its aim.
        facing: info.aim ?? animalFacing.get(track.id) ?? Math.PI,
        hovered: false,
        hurt: now - (animalHitAt.get(track.id) ?? Number.NEGATIVE_INFINITY) < SHAKE_MS,
        angry: info.angry === true,
        male: info.sex === 'm',
        ...(info.aim !== undefined ? { aiming: true } : {}),
      }
      const leader = info.leader ? leaderSpot(info.leader) : undefined
      if (leader) view.leader = leader
      if (mouse) {
        const distance = Math.hypot(mouse.x - view.x, mouse.y - view.y)
        if (distance <= Math.max(0.45, def.size * (baby ? 0.35 : 0.55)) && distance < hoveredDistance) {
          hovered = track.id
          hoveredDistance = distance
        }
      }
      views.push(view)
    }
    animalSpots = spots
    hoveredAnimal = hovered
    for (const view of views) view.hovered = view.id === hovered
    // The ones just killed, falling over where they died.
    for (let i = dying.length - 1; i >= 0; i--) if (now - dying[i].at > DEATH_MS) dying.splice(i, 1)
    for (const dead of dying) {
      views.push({
        id: -dead.info.id,
        kind: dead.info.kind,
        x: dead.x,
        y: dead.y,
        size: animalDef(dead.info.kind).size,
        baby: dead.info.growth < 100,
        facingLeft: dead.facingLeft,
        facing: dead.facing,
        hovered: false,
        hurt: true,
        angry: false,
        male: dead.info.sex === 'm',
        dying: (now - dead.at) / DEATH_MS,
      })
    }
    return views
  }

  const visibleBuildings = (remoteTick: number): BuildingView[] => {
    const bounds = view.visible()
    // Where the players are, in units, for opening gates.
    const walkers = [local.position, ...remotes.positionsAt(remoteTick)]
    const viewOf = (entity: Entity): BuildingView => {
      if (entity.kind === 'fence' || entity.kind === 'gate') {
        const connect = fenceMask((x, y) => mirror.world.entityAt(x, y)?.kind, entity.x, entity.y)
        const open = entity.kind === 'gate' && gateIsOpen(entity, walkers)
        return { ...entity, connect, open }
      }
      if (entity.kind === 'campfire') return { ...entity, lit: entity.lit === 1 }
      if (entity.kind === 'barrel') {
        const plan = barrelPlan(entity)
        const composting = plan.ready && plan.recipe?.output === itemByKey('compost')?.id
        return { ...entity, barrel: { sealed: entity.sealed === 1, liquid: LIQUIDS[entity.liquid] ?? '', fill: entity.amount / BARREL_CAPACITY, composting } }
      }
      if (entity.kind === 'rack') {
        const rack = entity.inv.slots[RACK_OUTPUT].count > 0 ? 'done' : entity.inv.slots[RACK_INPUT].count > 0 ? 'drying' : 'empty'
        return { ...entity, rack }
      }
      if (entity.kind === 'stump') {
        const tool = entity.inv.slots[STATION_TOOL_SLOT]
        return tool && tool.count > 0 && tool.item !== NO_ITEM ? { ...entity, tool: tool.item } : entity
      }
      if (entity.kind === 'plot') {
        const art = entity.crop !== 0 ? cropArt(entity.crop, entity.growth) : undefined
        return art ? { ...entity, cropArt: art, water: entity.water } : { ...entity, water: entity.water }
      }
      return entity
    }
    // Wide enough that a tree whose canopy reaches into view is drawn.
    const margin = 1
    const found: BuildingView[] = []
    for (const chunkId of mirror.world.chunkIds) {
      const { cx, cy } = chunkCoords(chunkId)
      if ((cx + 1) * CHUNK_SIZE <= bounds.left - margin || cx * CHUNK_SIZE > bounds.right + margin) continue
      if ((cy + 1) * CHUNK_SIZE <= bounds.top - margin || cy * CHUNK_SIZE > bounds.bottom + margin) continue
      for (const entity of mirror.world.chunk(chunkId)!.entities) {
        if (entity.x < bounds.left - margin || entity.x > bounds.right + margin) continue
        if (entity.y < bounds.top - margin || entity.y > bounds.bottom + margin) continue
        found.push(viewOf(entity))
      }
    }
    return found
  }

  // A player's pose while their latest attack is still being made.
  const poseOf = (id: number, now: number): PlayerPose | undefined => {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const flash = flashes[i]
      if (flash.id !== id) continue
      return now - flash.at < SWING_MS ? attackPose(flash.weapon, flash.special, (now - flash.at) / SWING_MS) : undefined
    }
    return undefined
  }

  const players = (x: number, y: number, remoteTick: number, now: number): PlayerView[] => {
    const list: PlayerView[] = []
    if (placed) {
      const inventory = predictedInventory()
      const holding = inventory.slots[selectedSlot]
      const me: PlayerView = {
        id: mirror.playerId,
        name: roster.get(mirror.playerId) ?? name,
        x: x / SUB,
        y: y / SUB,
        facing: local.facing,
        local: true,
        held: holding && holding.count > 0 ? holding.item : 0,
        armor: [0, 1, 2].map((i) => {
          const worn = inventory.slots[ARMOR_SLOT + i]
          return worn && worn.count > 0 ? worn.item : 0
        }),
      }
      // Its arms: holding an attack (a bow drawn, a sling whirled, a spear pulled back, a special cocked), or making one.
      if (charging) {
        const full = fullMs(charging)
        me.pose = holdingPose(charging.weapon, charging.special, full > 0 ? Math.min(1, (now - charging.start) / full) : 1)
        const aim = aimPoint()
        me.facing = local.facing = Math.atan2(aim.y - local.position.y, aim.x - local.position.x)
      } else {
        const pose = poseOf(mirror.playerId, now)
        if (pose) me.pose = pose
      }
      if (now - (playerHitAt.get(mirror.playerId) ?? Number.NEGATIVE_INFINITY) < SHAKE_MS) me.hurt = true
      list.push(me)
    }
    const present = new Set<number>()
    for (const remote of remotes.positionsAt(remoteTick)) {
      present.add(remote.id)
      // Facing the way it is going, or the way it last went.
      if (remote.dx !== 0 || remote.dy !== 0) remoteFacing.set(remote.id, Math.atan2(remote.dy, remote.dx))
      const facing = remoteFacing.get(remote.id) ?? Math.PI / 2
      const hurt = now - (playerHitAt.get(remote.id) ?? Number.NEGATIVE_INFINITY) < SHAKE_MS
      const theirs = gear.get(remote.id)
      const pose = poseOf(remote.id, now)
      list.push({
        id: remote.id,
        name: roster.get(remote.id) ?? '',
        x: remote.x / SUB,
        y: remote.y / SUB,
        facing,
        local: false,
        ...(hurt ? { hurt } : {}),
        ...(theirs ? { held: theirs.held, armor: theirs.armor } : {}),
        ...(pose ? { pose } : {}),
      })
    }
    for (const id of remoteFacing.keys()) if (!present.has(id)) remoteFacing.delete(id)
    return list
  }

  const overlay = (buildings: readonly BuildingView[]): OverlayView => {
    // Holding a weapon or tool, a click is an attack the way the mouse points, not at a tile: no tile lights up.
    const hover = pointer && !pause.isOpen && !rightClickAttacks() ? tileUnderPointer() : undefined
    const target = hover && hoveredAnimal === undefined ? punchable(hover.x, hover.y) : undefined
    // With something that can be put down in the picked slot, a ghost of it under the mouse, red where it cannot go.
    let ghost: GhostView | undefined
    if (hover && !target && welcomed) {
      const inventory = predictedInventory()
      const held = inventory.slots[selectedSlot]
      const kind = held && held.count > 0 ? getItem(held.item).places : undefined
      if (kind) {
        const valid = !prediction.occupies(hover.x, hover.y) && checkPlace(mirror.world, local.position, inventory, selectedSlot, hover.x, hover.y, mirror.terrain).ok
        ghost = { kind, x: hover.x, y: hover.y, dir: 0, valid }
      }
    }
    const bars: Array<OverlayView['bars'][number]> = []
    for (const building of buildings) {
      if (building.kind !== 'tree' && building.kind !== 'bush' && building.kind !== 'rock' && !BUILDINGS[building.kind].breakable) continue
      const entity = mirror.world.entity(building.id)
      if (!entity) continue
      const max = BUILDINGS[entity.kind].maxHp
      const left = punchesLeft(entity)
      if (left < max && left > 0) bars.push({ x: entity.x, y: entity.y, fraction: left / max, tall: entity.kind === 'tree' })
    }
    const removing: Array<{ x: number; y: number }> = []
    for (const id of prediction.removals()) {
      const entity = mirror.world.entity(id)
      if (entity) removing.push({ x: entity.x, y: entity.y })
    }
    const opened = openBuilding !== undefined ? mirror.world.entity(openBuilding) : undefined
    // A named chest under the mouse shows its name.
    const hovered = hover ? mirror.world.entityAt(hover.x, hover.y) : undefined
    const named = hovered?.kind === 'chest' && hovered.name ? { x: hovered.x, y: hovered.y, name: hovered.name } : undefined
    return {
      ...(hover ? { hover } : {}),
      ...(target ? { target: { x: target.x, y: target.y } } : {}),
      ...(ghost ? { ghost } : {}),
      pending: prediction.builds(playerInventory).map((build) => ({ ...build, valid: true })),
      removing,
      bars,
      ...(opened ? { selected: { x: opened.x, y: opened.y } } : {}),
      ...(named ? { label: { x: named.x, y: named.y, text: named.name } } : {}),
    }
  }

  // ---- the page's elements, ten times a second

  const updateUi = (): void => {
    hud.update({
      code: solo ? worldName : `${worldName} · ${code}`,
      players: [...roster.values()],
      pingMs: connection.clock.ready ? connection.clock.rttMs : undefined,
    })
    const predicted = prediction.predictInventories(playerInventory, mirror.world)
    // A boss that is after someone: its name and health over the top of the screen.
    const boss = [...animalInfo.values()].find((info) => animalDef(info.kind).boss && info.angry)
    bossBar.hidden = !boss
    if (boss) {
      const def = animalDef(boss.kind)
      if (bossName.textContent !== def.name) bossName.textContent = def.name
      bossFill.style.transform = `scaleX(${Math.max(0, Math.min(1, boss.hp / def.hp))})`
      const hpText = `${Math.max(0, boss.hp)} / ${def.hp}`
      if (bossHp.textContent !== hpText) bossHp.textContent = hpText
      if (bossNotchesFor !== def.hp) {
        bossNotchesFor = def.hp
        bossNotches.replaceChildren()
        for (let at = BOSS_NOTCH; at < def.hp; at += BOSS_NOTCH) {
          const notch = element('i')
          notch.style.left = `${(at / def.hp) * 100}%`
          bossNotches.append(notch)
        }
      }
    }
    // The server is told which slot the player holds, so the others see it in their hand.
    if (welcomed && holdSent !== selectedSlot) {
      holdSent = selectedSlot
      send({ k: 'hold', slot: selectedSlot })
    }
    hotbar.update({
      slots: predicted.player.slots.slice(0, HOTBAR_SLOTS),
      selected: selectedSlot,
      keys: HOTBAR_ACTIONS.map((action) => settings.keyLabel(action)),
      health,
      food: predicted.player.slots[FOOD_SLOT] ?? { item: NO_ITEM, count: 0 },
      foodKey: settings.keyLabel('eat'),
      foodReady: 1 - Math.max(0, eatReadyAt - performance.now()) / (EAT_COOLDOWN_TICKS * TICK_MS),
    })
    const opened = openBuilding !== undefined ? mirror.world.entity(openBuilding) : undefined
    if (openBuilding !== undefined && (!opened || !hasInventory(opened))) openBuilding = undefined
    // Walked off well out of reach of what is open: it closes.
    if (opened && openBuilding !== undefined && Math.sqrt(distanceToTileSquared(local.position.x, local.position.y, opened.x, opened.y)) > PLAYER_REACH * CLOSE_AWAY) closePanels()
    panels.show(inventoryOpen || opened ? panelsView(opened, predicted) : undefined)
    // A work station only works while someone has it open, so the server is told which one this player has.
    const using = opened?.kind === 'stump' || opened?.kind === 'workbench' ? opened.id : 0
    if (using !== usingStation) {
      usingStation = using
      send({ k: 'use', id: using })
    }
  }
  let usingStation = 0

  // A machine's button: the stump's Craft, a campfire's Light and Put out, a barrel's Seal and Unseal.
  const pressMachine = (id: number, buttonId: string): void => {
    if (buttonId === 'craft') send({ k: 'work', id })
    else if (buttonId === 'light' || buttonId === 'douse' || buttonId === 'seal' || buttonId === 'unseal') send({ k: 'machine', id, action: buttonId })
  }

  // How many times over the player has what a recipe takes (each input `need` of it), up to `times`.
  const timesAfford = (player: Inventory, inputs: ReadonlyArray<readonly [ItemId, number]>, times: number): number =>
    Math.min(times, ...inputs.map(([item, need]) => Math.floor(countOf(player, item) / need)))

  // The Craft button under a station's recipe: what it takes for `times` more (or as many as the player has, with
  // Infinity) goes in from the player's inventory, and it starts. It keeps going while what is in it is enough.
  const machineRecipe = (id: number, index: number, times: number): void => {
    const machine = mirror.world.entity(id)
    if (machine?.kind !== 'stump' && machine?.kind !== 'workbench') return
    const recipe = STATION_RECIPES[machine.kind][index]
    if (!recipe) return
    // Busy making something else (that carries on); what it would make has nowhere to go (the output slot holds
    // something else, or is full); or nothing to make it from: it does not start.
    const station = prediction.predictInventories(playerInventory, mirror.world).buildings.get(id) ?? machine.inv
    if (machine.active !== 0 && workingOn(machine) !== index) return craftFailed()
    if (!stationOutputFits(machine.kind, station, recipe)) return craftFailed()
    if (timesAfford(predictedInventory(), recipe.inputs, times) === 0 && !workbenchReady(machine, recipe)) return craftFailed()
    sounds.play(craftSound(times))
    if (machine.kind === 'stump') return loadStation(id, index, times)
    // The tool it needs goes into its tool slot, from the player's things, if it has none there.
    const toolSlot = machine.inv.slots[WORKBENCH_TOOL_SLOT]
    if (recipe.tool && !(toolSlot && toolSlot.count > 0 && getItem(toolSlot.item).tool === recipe.tool)) {
      const tool = predictedInventory().slots.find((slot) => slot.count > 0 && getItem(slot.item).tool === recipe.tool)
      if (!tool) return craftFailed()
      send({ k: 'put', id, item: tool.item, max: 1 })
    }
    const more = timesAfford(predictedInventory(), recipe.inputs, times)
    if (more > 0) for (const [item, need] of recipe.inputs) send({ k: 'put', id, item, max: need * more })
    send({ k: 'work', id, recipe: index, repeat: true })
  }

  // A hand recipe, `times` times (as many as the player can make, with Infinity).
  const craftByHand = (index: number, times: number): void => {
    const recipe = getRecipe(index)
    if (!recipe) return
    const inventory = predictedInventory()
    const count = timesAfford(inventory, recipe.inputs, times)
    if (count === 0 || roomFor(inventory, recipe.output, recipe.count) < recipe.count) return craftFailed()
    sounds.play(craftSound(times))
    for (let i = 0; i < count; i++) send({ k: 'craft', recipe: index })
  }

  // Eats one of what the picked slot holds, if it is food and the player is hurt.
  // Eats one of what is in the food slot, if the cooldown is over and the player is hurt (else just a sound).
  let eatReadyAt = 0
  const eat = (): void => {
    const held = predictedInventory().slots[FOOD_SLOT]
    const food = held && held.count > 0 ? getItem(held.item) : undefined
    const now = performance.now()
    if (!food?.heals || health >= PLAYER_MAX_HEALTH || now < eatReadyAt) return void sounds.play('craft/fail')
    send({ k: 'eat', slot: FOOD_SLOT })
    eatReadyAt = now + EAT_COOLDOWN_TICKS * TICK_MS
    sounds.play('eat')
  }

  // Sleeps in a sleeping bag: the screen dims for a moment, and the player will wake up here.
  const sleepIn = (id: number): void => {
    send({ k: 'sleep', id })
    sounds.play('sleep')
    const dim = document.createElement('div')
    dim.className = 'sleep-fade'
    stage.append(dim)
    setTimeout(() => dim.remove(), 1600)
    hud.toast('Spawn point set.')
  }

  // A craft that cannot be done: its sound, and nothing more.
  const craftFailed = (): void => sounds.play('craft/fail')
  // The recipe a station is working on (its index), or -1.
  const workingOn = (machine: Entity): number => {
    if (machine.kind === 'workbench') return machine.recipe - 1
    if (machine.kind === 'stump') return stationRecipe('stump', machine.inv)?.index ?? -1
    return -1
  }
  // The sound of a craft: one (a click), some (shift: five), or all you can (ctrl).
  const craftSound = (times: number): SoundId => (times === 1 ? 'craft/one' : Number.isFinite(times) ? 'craft/some' : 'craft/all')
  // Whether a station already has what a recipe takes in it (so Craft starts it with nothing more put in).
  const workbenchReady = (machine: Entity & { inv: Inventory }, recipe: (typeof STATION_RECIPES.workbench)[number]): boolean =>
    recipe.inputs.every(([item, need]) => countOf(machine.inv, item) >= need)

  // The hand recipes, grouped by category in the order the categories first come in recipes.json.
  const craftingBook = (player: Inventory): BookEntry[] => {
    const categories = [...new Set(RECIPES.map((recipe) => recipe.category))]
    return [...RECIPES]
      .sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category))
      .map((recipe) => ({
        id: recipe.id,
        category: recipe.category,
        output: recipe.output,
        count: recipe.count,
        inputs: recipe.inputs.map(([item, need]) => ({ item, need, have: countOf(player, item) })),
        ready: canAfford(player, recipe),
      }))
  }

  // Puts what a stump recipe needs into it: the tool, if it needs one and does not have it, and enough input for
  // `times` more; and starts it.
  const loadStation = (id: number, index: number, times: number): void => {
    const station = mirror.world.entity(id)
    const recipe = STATION_RECIPES.stump[index]
    if (!station || station.kind !== 'stump' || !recipe) return
    const player = predictedInventory()
    const toolSlot = station.inv.slots[STATION_TOOL_SLOT]
    const hasTool = toolSlot.count > 0 && getItem(toolSlot.item).tool === recipe.tool
    if (recipe.tool && !hasTool) {
      const tool = player.slots.find((slot) => slot.count > 0 && getItem(slot.item).tool === recipe.tool)
      if (tool) send({ k: 'put', id, item: tool.item, max: 1 })
    }
    const [input, need] = recipe.inputs[0]
    const more = timesAfford(player, recipe.inputs, times)
    if (more > 0) send({ k: 'put', id, item: input, max: need * more })
    send({ k: 'work', id })
  }

  const panelsView = (opened: Entity | undefined, predicted: ReturnType<Prediction['predictInventories']>): PanelsView => {
    if (!opened || !hasInventory(opened)) return { player: predicted.player.slots, selected: selectedSlot, recipes: craftingBook(predicted.player) }
    const def = BUILDINGS[opened.kind]
    return {
      player: predicted.player.slots,
      selected: selectedSlot,
      building: {
        id: opened.id,
        kind: opened.kind,
        title: def.name,
        ...(opened.kind === 'chest' && opened.name ? { name: opened.name } : {}),
        slots: (predicted.buildings.get(opened.id) ?? opened.inv).slots,
        ...(opened.kind === 'miner' ? { mining: { item: opened.ore } } : {}),
        ...machinePanel(opened, predicted.player, predicted.buildings.get(opened.id) ?? opened.inv),
        acceptsDeposits: def.acceptsDeposits,
        inReach: isWithinReach(local.position, opened.x, opened.y),
        ...(opened.kind === 'barrel' && opened.sealed ? { locked: true } : {}),
        ...(chestGuarded(opened) ? { locked: true, guarded: true } : {}),
      },
    }
  }

  // Whether a chest is a dungeon's with its lich still standing in its copy (the server keeps it shut till it falls).
  const chestGuarded = (opened: Entity): boolean => {
    const slot = dungeonSlotAt(opened.x, opened.y)
    if (opened.kind !== 'chest' || slot === undefined) return false
    for (const info of animalInfo.values()) {
      const spot = animalSpots.get(info.id)
      if (info.kind === 'frost-lich' && spot && dungeonSlotAt(tileOfUnits(spot.x), tileOfUnits(spot.y)) === slot) return true
    }
    return false
  }

  const machinePanel = (opened: Entity, player: Inventory, inv: Inventory): { machine?: MachineView } => {
    const machine = machineView(opened, player, inv)
    return machine ? { machine } : {}
  }

  // ---- the debug view

  const debugView = (): DebugView => {
    const bounds = view.visible()
    const inView = (tile: { x: number; y: number }): boolean =>
      tile.x >= bounds.left && tile.x <= bounds.right && tile.y >= bounds.top && tile.y <= bounds.bottom
    const links: Array<DebugView['links'][number]> = []
    for (const id of mirror.world.linkIds) {
      const link = mirror.world.link(id)!
      const ends = linkEnds(link)
      if (ends && (inView(ends.from) || inView(ends.to))) links.push({ ...ends, remote: ends.remote, blocked: link.blocked })
    }
    return { chunks: mirror.world.chunkIds, desynced: [...mirror.desynced], links }
  }

  // Where a link's two ends are. Where this page has only one end, the other is worked out from which way it faces.
  const linkEnds = (link: Link): { from: { x: number; y: number }; to: { x: number; y: number }; remote: boolean } | undefined => {
    const from = mirror.world.entity(link.from)
    const to = mirror.world.entity(link.to)
    if (from && to) return { from, to, remote: false }
    if (from && isBeltLike(from)) return { from, to: { x: from.x + DIR_X[from.dir], y: from.y + DIR_Y[from.dir] }, remote: true }
    if (to && isBeltLike(to)) {
      const side = link.entry === 'back' ? opposite(to.dir) : link.entry === 'left' ? rotateCCW(to.dir) : rotateCW(to.dir)
      return { from: { x: to.x + DIR_X[side], y: to.y + DIR_Y[side] }, to, remote: true }
    }
    return undefined
  }

  const debugLines = (now: number): string[] => {
    const clock = connection.clock
    let remoteLinks = 0
    for (const id of mirror.world.linkIds) {
      const link = mirror.world.link(id)!
      if (!mirror.world.entity(link.from) || !mirror.world.entity(link.to)) remoteLinks++
    }
    const serverTick = clock.ready ? Math.floor(clock.serverTick(now)) : 0
    const lag = connection.lag
    return [
      `server tick   ~${serverTick}`,
      `world tick    ${mirror.simTick}  (${serverTick - mirror.simTick} behind, log to ${mirror.through})`,
      `playout       ${playout.toFixed(1)} ticks   rtt ${Math.round(clock.rttMs)} ms`,
      `chunks        ${mirror.world.chunkIds.length} simulated`,
      `links         ${mirror.world.linkIds.length} (${remoteLinks} take the server's word)`,
      `desyncs       ${mirror.desyncs}${mirror.desynced.size ? ` (${mirror.desynced.size} waiting)` : ''}`,
      `commands      ${prediction.size} waiting`,
      `position      ${(local.position.x / SUB).toFixed(1)}, ${(local.position.y / SUB).toFixed(1)}`,
      `view          ${view.describe()}, zoom ${zoom.toFixed(2)}×`,
      ...(lag.latencyMs || lag.jitterMs || lag.loss ? [`lag sim       ${lag.latencyMs} ms +${lag.jitterMs} jitter, ${Math.round(lag.loss * 100)}% loss`] : []),
      ...(import.meta.env.DEV ? ['F9            break a chunk here, to test desync repair'] : []),
      `animals       ${animalInfo.size} near`,
      ...animalLines(),
      ...plotLines(),
    ]
  }

  // The garden plot under the mouse: its crop, and how watered it is.
  const plotLines = (): string[] => {
    const hover = pointer ? tileUnderPointer() : undefined
    const plot = hover ? mirror.world.entityAt(hover.x, hover.y) : undefined
    if (plot?.kind !== 'plot') return []
    const crop = getCrop(plot.crop)
    const grown = crop ? `${crop.name} ${Math.floor((plot.growth * 100) / growthNeeded(crop.growTicks))}% grown` : 'nothing planted'
    return ['', `Garden plot   ${grown}`, plot.water > 0 ? `watered (${Math.ceil((plot.water * WATER_FALL_EVERY) / TPS)} s left)` : 'dry']
  }

  // The animal under the mouse, and its genetics.
  const animalLines = (): string[] => {
    const info = hoveredAnimal !== undefined ? animalInfo.get(hoveredAnimal) : undefined
    if (!info) return []
    const def = animalDef(info.kind)
    const leader = info.leader ? (roster.get(info.leader) ?? `player ${info.leader}`) : 'nobody'
    return [
      '',
      `${def.name} #${info.id}   ${info.sex === 'f' ? 'female' : 'male'}, ${info.growth < 100 ? `baby (${info.growth}% grown)` : 'adult'}`,
      `doing         ${info.doing}`,
      `hp ${info.hp}/${def.hp}   hunger ${info.hunger}% (hungry at ${Math.round((def.life.hungryAt * 100) / 1000)}%)   ${info.fed ? 'well fed' : 'not well fed'}   led by ${leader}`,
      ...(def.milk !== undefined ? [`milk          ${info.milk} ready`] : []),
      ...def.stats.map((stat, i) => `${stat.label.padEnd(18)}${info.stats[i]}   (wild ${stat.base} ± ${stat.spread})`),
    ]
  }

  // ---- leaving

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    clearTimeout(connectTimer)
    connection.close()
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('contextmenu', onContextMenu)
    disposeTooltips()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('pointerdown', unlockSound, true)
    window.removeEventListener('keydown', unlockSound, true)
    unsubscribeSettings()
    pause.dispose()
    panels.dispose()
    snow.dispose()
    frost.dispose()
    sounds.dispose()
    view.destroy()
  }
  const leave = (message?: string, isError = false): void => {
    if (disposed) return
    dispose()
    onLeave(message, isError)
  }

  return dispose
}

// Whether every number in a value is a finite number.
function finiteThroughout(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(finiteThroughout)
  if (value && typeof value === 'object') return Object.values(value).every(finiteThroughout)
  return true
}

// The view the settings ask for: 3D unless 2D was picked (or this browser cannot draw in 3D).
async function createView(settings: Settings, stage: HTMLElement): Promise<GameView> {
  if (settings.view === '3d') {
    try {
      return await createThreeView(stage)
    } catch (error) {
      console.warn('Could not start the 3D view, so the world is drawn in 2D.', error)
    }
  }
  return createPixiView(stage)
}
